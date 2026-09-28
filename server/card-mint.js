"use strict";

/*
 * LNURLcash cards for the 600B TCG (bearlett docs/CARDS-LNURLCASH.md).
 *
 * The E1 pack sale -- the same draw, state chain, invoice and supply as a
 * NutFT booster (server/nutft-mint.js, claimCards) -- delivered as seal notes
 * a holder's own key moves: each card is a 1000 msat LUD-25 note, signed at
 * genesis and on every move with the collection's catalog key. The rules that
 * make that true are Bearlett's own, bundled and pinned in
 * server/vendor/lnurlcash-cards.js (scripts/vendor-lnurlcash.mjs). This file
 * stores them, sells packs over LNURL-pay and speaks LUD-25:
 *
 *   GET /.well-known/lnurlcash-cards   discovery: issuer, endpoints, packs
 *   GET /cards/lnurlp                  LUD-06: a pack, for the key in the comment
 *   GET /cards/lnurlp/callback         the invoice
 *   GET /cards/verify/<hash>           LUD-21; a paid pack is issued here
 *   GET /cards?owner=<x-only hex>      a key's live cards, and whether it ever held one
 *   GET /cards/w                       LUD-25 informational GET, ?p= or ?k1=
 *   GET /cards/w/cb                    a move: k1, p1 and the next state
 *
 * Every answer is JSON a browser may read from any origin, as LNURL wants,
 * and every refusal is LUD-01's {"status": "ERROR", "reason"}. A paid pack
 * never waits for its buyer: a sweep issues it, whoever asks or not.
 *
 * One process owns the card tables: every write refuses to replace a card's
 * history with one no longer than it, so a second process moving the same
 * card fails instead of forking it.
 */

const crypto = require("node:crypto");
const lnurl = require("./lnurl.js");
const { cardOrigin, cardsProblems, orThrow } = require("./mint-env.js");
const cards = require("./vendor/lnurlcash-cards.js");

const X_ONLY = /^[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;
const DISCOVERY = "/.well-known/lnurlcash-cards";

function createCardMint({ nutft, db, publicBase, edition = "600b-e1", prefix = "/cards", sweepEveryMs = 30_000 }) {
  if (!nutft || !db) throw new Error("a card mint needs its NutFT mint and that mint's database");
  /* The same rules the boot check applies (server/mint-env.js), for a card
     mint made without it. */
  orThrow((add) => cardsProblems(add, "1", {
    backend: nutft.saleNow().paid ? "paid" : "none",
    purchaseMode: nutft.purchaseMode,
    publicBase,
  }));
  const base = cardOrigin(publicBase);
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS card_ledger (asset_id TEXT PRIMARY KEY, consignment TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS card_serials (name TEXT PRIMARY KEY, issued INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS card_invoices (
      payment_hash TEXT PRIMARY KEY, pr TEXT NOT NULL, amount_msat INTEGER NOT NULL
    );
  `);
  const q = {
    meta: db.prepare("SELECT value FROM card_meta WHERE key = ?"),
    putMeta: db.prepare("INSERT INTO card_meta (key, value) VALUES (?, ?)"),
    cards: db.prepare("SELECT asset_id, consignment FROM card_ledger ORDER BY asset_id"),
    /* Compare-and-swap: a new card, or a longer history than the one on disk. */
    putCard: db.prepare(`
      INSERT INTO card_ledger (asset_id, consignment) VALUES (?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET consignment = excluded.consignment
      WHERE json_array_length(card_ledger.consignment, '$.states')
        < json_array_length(excluded.consignment, '$.states')
    `),
    serial: db.prepare("SELECT issued FROM card_serials WHERE name = ?"),
    putSerial: db.prepare("INSERT OR REPLACE INTO card_serials (name, issued) VALUES (?, ?)"),
    invoice: db.prepare("SELECT * FROM card_invoices WHERE payment_hash = ?"),
    putInvoice: db.prepare("INSERT OR REPLACE INTO card_invoices (payment_hash, pr, amount_msat) VALUES (?, ?, ?)"),
  };

  /* Every card names this origin for good: the first one a card mint ran
     under is kept, and another refuses the start rather than strand them. */
  const pinned = q.meta.get("public_origin");
  if (!pinned) q.putMeta.run("public_origin", base);
  else if (pinned.value !== base) {
    throw new Error(`the card mint ran under ${pinned.value}, and every card it issued names that origin for good; `
      + `it will not start under ${base}`);
  }

  /* Two keys. The catalog key is the issuer: it signs every genesis and every
     move, and it is the key the signed catalog names. The mint key only signs
     LUD-25's cs1 certificates; it is this card mint's own, made once. */
  let mintKey = q.meta.get("mint_key");
  if (!mintKey) {
    mintKey = { value: crypto.randomBytes(32).toString("hex") };
    q.putMeta.run("mint_key", mintKey.value);
  }
  const assetIdOf = (consignment) =>
    cards.bytesToHex(cards.decodeState(cards.hexToBytes(consignment.states[0])).assetId);
  const options = {
    withdraw: `${base}${prefix}/w`,
    issuerKey: new Uint8Array(nutft.catalogKey),
    mintKey: cards.hexToBytes(mintKey.value),
    /* Written before the ledger holds it: a move this mint vouched for is on
       disk before its receipt leaves, so a restart can never make it movable
       twice. Inside a pack's claim this runs in the claim's transaction. */
    persist: (consignment) => {
      const written = q.putCard.run(assetIdOf(consignment), JSON.stringify(consignment));
      if (Number(written.changes) !== 1) throw new Error("another process changed this card first");
    },
  };
  /* Every card rebuilt from disk and checked in full on boot. A card that does
     not check out is quarantined: left out, its row kept for the operator,
     said out loud. A changed issuer key or withdraw URL refuses the start. */
  const load = () => {
    const rows = q.cards.all();
    const saved = [];
    const ids = [];
    for (const row of rows) {
      try {
        saved.push(JSON.parse(row.consignment));
        ids.push(row.asset_id);
      } catch {
        console.error(`[cards] QUARANTINED card ${row.asset_id}: its record is not JSON`);
      }
    }
    return cards.CardLedger.restore(options, saved, (problem, at) => {
      console.error(`[cards] QUARANTINED card ${ids[at]}: ${problem}`);
    });
  };
  let ledger = load();

  const nextSerial = (name) => {
    const row = q.serial.get(name);
    const issued = (row ? row.issued : 0) + 1;
    q.putSerial.run(name, issued);
    return issued;
  };
  /* Runs inside nutft's claim transaction: serials, cards and the claimed
     invoice commit together or not at all. */
  let delivering = false;
  const deliver = (assetIds, ownerHex) => {
    delivering = true;
    const owner = cards.hexToBytes(ownerHex);
    return assetIds.map((name) => ledger.issue(name, `${nutft.collectionId}#${nextSerial(name)}`, owner));
  };
  async function collect(paymentHash) {
    try {
      return await nutft.claimCards(paymentHash, deliver);
    } catch (error) {
      /* The transaction rolled back; the ledger may hold cards it did not keep. */
      if (delivering) ledger = load();
      throw error;
    } finally {
      delivering = false;
    }
  }

  /* Every open pack, oldest first: a paid one is issued, an expired unpaid
     one closed (nutft-mint.js claimCardsOnce). One sweep at a time; a node
     that cannot answer ends this round, and the next one tries again. */
  let sweeping = null;
  function sweep() {
    sweeping ??= (async () => {
      for (const paymentHash of nutft.openCardInvoices()) {
        try {
          await collect(paymentHash);
        } catch (error) {
          if (error && error.unavailable) break;
          if (!(error && error.stale)) console.error("[cards] pack", paymentHash.slice(0, 16), error && error.message);
        }
      }
    })().finally(() => { sweeping = null; });
    return sweeping;
  }
  const timer = sweepEveryMs > 0 ? setInterval(() => { void sweep(); }, sweepEveryMs) : null;
  if (timer && timer.unref) timer.unref();

  const metadata = lnurl.metadataFor(`A pack of 600B cards (${edition}), as LNURLcash notes only your key moves`);
  const discovery = () => ({
    v: 0,
    issuer: cards.bytesToHex(ledger.issuer),
    withdraw: options.withdraw,
    lookup: `${base}${prefix}`,
    packs: [{
      lnurlp: `${base}${prefix}/lnurlp`,
      edition,
      collection_id: nutft.collectionId,
      catalog_uri: nutft.catalogUri,
    }],
  });

  const noteInfo = (found, k1) => ({
    tag: "withdrawRequest",
    callback: `${base}${prefix}/w/cb`,
    ...(k1 ? { k1 } : {}),
    minWithdrawable: cards.CARD_MSAT,
    maxWithdrawable: cards.CARD_MSAT,
    defaultDescription: "A 600B card",
    mintPubkey: ledger.mintPubkey,
    c: found.c,
  });

  /* Always true: the request was this card mint's to answer. */
  function send(res, body, status = 200) {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      /* LNURL services answer every origin: the Hangar and the web wallet
         read these from pages that are not this site. */
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(body));
    return true;
  }

  /* True if the request was this card mint's to answer. */
  async function handle(req, res, url) {
    const path = url.pathname;
    const mine = path === DISCOVERY || path === prefix || path.startsWith(`${prefix}/`);
    if (!mine) return false;
    if (req.method !== "GET") return send(res, lnurl.error("a card mint answers GET only"), 405);
    const params = url.searchParams;
    try {
      if (path === DISCOVERY) return send(res, discovery());
      if (path === `${prefix}/lnurlp`) {
        const sale = nutft.saleNow();
        if (!sale.paid) return send(res, lnurl.error("this mint sells no packs for sats"));
        if (!sale.open) return send(res, lnurl.error("the box is not open to wallet payments yet"));
        return send(res, {
          ...lnurl.payRequest({ callbackUrl: `${base}${prefix}/lnurlp/callback`, amountMsat: sale.priceMsat, metadata }),
          /* the comment names the key the pack is for: cp1<x-only key> */
          commentAllowed: 100,
        });
      }
      if (path === `${prefix}/lnurlp/callback`) {
        const sale = nutft.saleNow();
        if (!sale.paid || !sale.open) return send(res, lnurl.error("the box is not open to wallet payments yet"));
        if (Number(params.get("amount")) !== sale.priceMsat) {
          return send(res, lnurl.error(`a pack costs exactly ${sale.priceMsat} msat`));
        }
        const owner = cards.decodeCp1(String(params.get("comment") || "").trim());
        if (!owner) return send(res, lnurl.error("name the key the pack is for: cp1<key> as the comment"));
        let quoted;
        try {
          quoted = await nutft.payableQuote({
            descriptionHash: lnurl.descriptionHash(metadata),
            cardOwner: cards.bytesToHex(owner),
          });
        } catch (error) {
          /* A refusal here is a verdict the buyer can act on (a pack already
             has a live invoice, the box closed): say it, as the NutFT path does. */
          if (error && error.unavailable) throw error;
          return send(res, lnurl.error(error.message));
        }
        q.putInvoice.run(quoted.payment_hash, quoted.payment_request, quoted.price_msat);
        return send(res, {
          pr: quoted.payment_request,
          routes: [],
          verify: `${base}${prefix}/verify/${quoted.payment_hash}`,
        });
      }
      const verify = new RegExp(`^${prefix}/verify/([0-9a-f]{64})$`).exec(path);
      if (verify) {
        const row = q.invoice.get(verify[1]);
        if (!row) return send(res, lnurl.error("no pack was sold for this payment"));
        const settled = await nutft.funding.isSettled(row.payment_hash, row.amount_msat);
        /* Paid is enough to issue: the owner was named before paying. */
        if (settled) {
          try {
            await collect(row.payment_hash);
          } catch (error) {
            /* Definitive: asking again changes nothing. */
            if (error && error.stale) return send(res, lnurl.error(error.message));
            throw error;
          }
        }
        return send(res, { status: "OK", settled: Boolean(settled), preimage: null, pr: row.pr });
      }
      if (path === prefix) {
        const owner = String(params.get("owner") || "");
        if (!X_ONLY.test(owner)) return send(res, lnurl.error("name an owner key: 64 hex digits"));
        /* A key's newest packs that may be paid right now are issued as it
           asks; everything older is the sweep's, so asking stays cheap. */
        for (const paymentHash of nutft.freshCardInvoices(owner)) {
          if (!HASH.test(paymentHash)) continue;
          try {
            await collect(paymentHash);
          } catch (error) {
            /* One pack that cannot be issued must not hide the cards a key
               already holds; a node that cannot answer is worth saying. */
            if (error && error.unavailable) throw error;
            if (!(error && error.stale)) console.error("[cards] pack", paymentHash.slice(0, 16), error && error.message);
          }
        }
        return send(res, ledger.lookupOwner(cards.hexToBytes(owner)));
      }
      if (path === `${prefix}/w`) {
        const k1 = params.get("k1");
        const p = params.get("p");
        const key = p ? cards.decodeCp1(p) : null;
        const found = k1 ? ledger.lookupSpend(k1) : key ? ledger.lookup(key) : null;
        if (!found) return send(res, lnurl.error("ask for a card by k1 or p"));
        if (found.refused) return send(res, lnurl.error(found.refused));
        return send(res, noteInfo(found, k1));
      }
      if (path === `${prefix}/w/cb`) {
        const one = (name) => (params.has(name) ? params.get(name) : undefined);
        const answer = ledger.burn({
          k1s: params.getAll("k1"),
          p1: one("p1"),
          state: one("state"),
          amount: one("amount"),
          p2: one("p2"),
          pr: one("pr"),
        });
        if (answer.refused) return send(res, lnurl.error(answer.refused));
        return send(res, { status: "OK", c: answer.c, receipt: cards.bytesToHex(answer.receipt) });
      }
      return send(res, lnurl.error("not found"), 404);
    } catch (error) {
      /* Nothing moved and nothing was issued: the ledger writes first and
         the claim is one transaction. Asking again is safe. */
      console.error("[cards]", error && error.message);
      const reason = error && error.unavailable ? error.message : "the card mint could not do that right now — try again";
      return send(res, lnurl.error(reason), error && error.unavailable ? 503 : 500);
    }
  }

  /* Stops the sweep; the database stays open, it is the NutFT mint's. */
  const stop = () => { if (timer) clearInterval(timer); };

  return { handle, discovery, sweep, stop, get ledger() { return ledger; } };
}

module.exports = { createCardMint };
