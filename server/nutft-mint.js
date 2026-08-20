"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { schnorr } = require("@noble/curves/secp256k1");
const { censusHash, hashParts, loadCensus, openPack } = require("./nutft-draw.js");
const lnd = require("./lnd.js");
const { createBeacon } = require("./beacon.js");
const lnurl = require("./lnurl.js");
const { toPubkeyHex } = require("./lnurl.js");
const nip98 = require("./nip98.js");
const { createFunding } = require("./funding.js");

const REPO = path.resolve(__dirname, "..");
const CENSUS_PATH = path.join(REPO, "cards", "nutft-census.json");
const VERSION = "1";

const text = (value) => new TextEncoder().encode(value);
const hex = (value) => Buffer.from(value).toString("hex");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assetBinding(reference) {
  return crypto.createHash("sha256")
    .update(Buffer.from("Cashu_NutFT_v1"))
    .update(Buffer.from(canonical(reference)))
    .digest("hex");
}

function json(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 512 * 1024) {
        tooLarge = true;
        body = "";
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("request too large"));
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(new Error(`invalid JSON: ${error.message}`)); }
    });
    req.on("error", reject);
  });
}

function createNutftMint(options = {}) {
  const census = JSON.parse(fs.readFileSync(options.censusPath || CENSUS_PATH, "utf8"));
  const catalog = loadCensus(census);
  const tierOdds = Object.fromEntries(Object.entries(census.tiers)
    .filter(([, tier]) => tier.share_of_mint != null)
    .map(([name, tier]) => [name.toLowerCase(), Number(tier.share_of_mint.toFixed(2))]));
  const collectionId = options.collectionId || process.env.NUTFT_COLLECTION_ID || "600B-E1";
  const catalogUri = options.catalogUri || process.env.NUTFT_CATALOG_URI || "http://localhost:8777/nutft/catalog";
  if (!/^https?:$/.test(new URL(catalogUri).protocol)) throw new Error("NUTFT_CATALOG_URI must be an absolute HTTP(S) URL");
  const beacon = (options.beacon || process.env.NUTFT_BEACON || "00".repeat(32)).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(beacon)) throw new Error("NUTFT_BEACON must be 32-byte hex");

  const cards = new Map(census.cards.map((card) => [card.id, card]));
  const basicId = catalog.basic[0];
  const initialCommitment = censusHash(catalog.counts);
  const db = options.db;
  const memory = { meta: new Map(), spent: new Set(), operations: new Map() };
  let q;
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nutft_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nutft_spent (y TEXT PRIMARY KEY);
      /* An invoice is bound to the pack it was quoted for. Without that binding
         one settled payment could be replayed against whatever pack happens to
         be next, which is the same card bought twice for one price. */
      CREATE TABLE IF NOT EXISTS nutft_invoices (
        payment_hash TEXT PRIMARY KEY,
        pack_id      TEXT NOT NULL,
        state        TEXT NOT NULL,
        amount_msat  INTEGER NOT NULL,
        claimed      INTEGER NOT NULL DEFAULT 0,
        target_height INTEGER,
        created_at   TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nutft_operations (
        type TEXT NOT NULL,
        operation_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        PRIMARY KEY (type, operation_key)
      );
    `);
    q = {
      meta: db.prepare("SELECT value FROM nutft_meta WHERE key = ?"),
      putMeta: db.prepare("INSERT OR REPLACE INTO nutft_meta (key, value) VALUES (?, ?)"),
      spent: db.prepare("SELECT 1 FROM nutft_spent WHERE y = ?"),
      putSpent: db.prepare("INSERT INTO nutft_spent (y) VALUES (?)"),
      operation: db.prepare("SELECT request_hash, response_json FROM nutft_operations WHERE type = ? AND operation_key = ?"),
      putOperation: db.prepare("INSERT INTO nutft_operations (type, operation_key, request_hash, response_json) VALUES (?, ?, ?, ?)"),
      invoice: db.prepare("SELECT * FROM nutft_invoices WHERE payment_hash = ?"),
      activeInvoices: db.prepare("SELECT * FROM nutft_invoices WHERE pack_id = ? AND claimed = 0 ORDER BY created_at DESC"),
      putInvoice: db.prepare("INSERT OR REPLACE INTO nutft_invoices (payment_hash, pack_id, state, amount_msat, claimed, created_at, target_height) VALUES (?, ?, ?, ?, 0, ?, ?)"),
      claimInvoice: db.prepare("UPDATE nutft_invoices SET claimed = 1 WHERE payment_hash = ? AND claimed = 0"),
    };
  }
  const getMeta = (key) => db ? q.meta.get(key)?.value : memory.meta.get(key);
  const putMeta = (key, value) => db ? q.putMeta.run(key, value) : memory.meta.set(key, value);
  const getOrCreate = (key, create) => {
    const found = getMeta(key);
    if (found) return found;
    const value = create();
    putMeta(key, value);
    return value;
  };
  const getOperation = (type, key) => {
    const row = db ? q.operation.get(type, key) : memory.operations.get(`${type}:${key}`);
    return row && { requestHash: row.request_hash || row.requestHash, result: JSON.parse(row.response_json || JSON.stringify(row.result)) };
  };
  const putOperation = (type, key, requestHash, result) => db
    ? q.putOperation.run(type, key, requestHash, JSON.stringify(result))
    : memory.operations.set(`${type}:${key}`, { requestHash, result });
  const isSpent = (y) => db ? Boolean(q.spent.get(y)) : memory.spent.has(y);
  const putSpent = (y) => db ? q.putSpent.run(y) : memory.spent.add(y);
  const configuration = canonical({ census_sha256: census.census_sha256, collection_id: collectionId, catalog_uri: catalogUri });
  const storedConfiguration = getMeta("configuration");
  if (storedConfiguration && storedConfiguration !== configuration) throw new Error("mint database belongs to a different NutFT census, collection, or catalog URI");
  if (!storedConfiguration) putMeta("configuration", configuration);
  const storedState = getMeta("state");
  const state = storedState ? JSON.parse(storedState) : { counts: { ...catalog.counts }, nextPack: 1, state: initialCommitment };
  if (!storedState) putMeta("state", JSON.stringify(state));
  /* Lightning. With no LND_REST_URL there is no funding source and the mint
     stays exactly as it is today: free, and honest about being a demo. Wiring a
     node in is what turns it into a shop, and nothing else changes. */
  /* The funding source is behind a two-function interface, so which node or
     wallet API takes the money is not the mint's business and can change
     without touching this file. */
  const funding = options.lnd === null && !options.funding ? null : createFunding(options);
  const invoiceTtlSeconds = Number(options.invoiceTtlSeconds || process.env.NUTFT_INVOICE_TTL_SECONDS || 900);
  if (!Number.isFinite(invoiceTtlSeconds) || invoiceTtlSeconds < 60) throw new Error("NUTFT_INVOICE_TTL_SECONDS must be at least 60");
  const lndConfig = funding && funding.name === "lnd" ? (options.lnd || lnd.readConfig(options.lndOptions || {})) : null;
  /* The price ladder. Written as "soldBelow:msat" pairs, cheapest first:
   *   NUTFT_PRICE_SCHEDULE="2100:21000,19925:420000,20925:10000000"
   * reads as "the first 2100 packs cost 21 sat, up to 19925 they cost 420, and
   * the rest cost 10000". A single NUTFT_PRICE_MSAT still works and behaves as
   * one flat tier, so nothing that exists today has to change.
   *
   * The price is decided when a booster is QUOTED, and the invoice fixes it from
   * then on. A buyer quoted at 21 sat pays 21 sat even if the tier turns over
   * while they are reaching for their phone — the alternative is charging
   * someone a price they were never shown. */
  const parseSchedule = (raw) => String(raw).split(",").map((part, index) => {
    const [upTo, msat] = part.split(":").map((piece) => Number(String(piece).trim()));
    if (!Number.isFinite(upTo) || !Number.isFinite(msat) || upTo <= 0 || msat <= 0) {
      throw new Error(`NUTFT_PRICE_SCHEDULE entry ${index + 1} is not "packs:msat": ${part}`);
    }
    return { upTo, msat };
  });

  const scheduleRaw = options.priceSchedule || process.env.NUTFT_PRICE_SCHEDULE || "";
  const priceTiers = scheduleRaw
    ? parseSchedule(scheduleRaw)
    : [{ upTo: Infinity, msat: Number(options.priceMsat || process.env.NUTFT_PRICE_MSAT || 21000) }];
  for (let i = 1; i < priceTiers.length; i += 1) {
    if (priceTiers[i].upTo <= priceTiers[i - 1].upTo) {
      throw new Error("NUTFT_PRICE_SCHEDULE thresholds must increase; a later tier that starts earlier can never be reached");
    }
  }
  /* Past the last threshold the last price stands, rather than reverting to the
     cheapest — a ladder that wraps around would sell the scarcest packs for the
     introductory price. */
  const priceFor = (soldCount) => (priceTiers.find((tier) => soldCount < tier.upTo) || priceTiers[priceTiers.length - 1]).msat;
  /* Who may buy, and whether anyone may. Deploying a mint that is already
     selling means the window between "it is reachable" and "we announced it" is
     a window in which one person can quietly take the whole cheap tier. The box
     therefore starts CLOSED unless told otherwise, and opens deliberately.

       closed     nobody buys; everything else stays testable
       allowlist  only the listed nostr keys buy
       open       anyone buys

     Default is "open" so an existing free demo behaves exactly as it does now;
     a PAID mint with no explicit setting is the case worth guarding, and that is
     checked below. */
  const salesMode = String(options.sales || process.env.NUTFT_SALES || "open").toLowerCase();
  if (!["open", "closed", "allowlist"].includes(salesMode)) {
    throw new Error(`NUTFT_SALES must be open, closed or allowlist — got ${salesMode}`);
  }
  const allowlist = new Set();
  for (const entry of String(options.allowlist || process.env.NUTFT_ALLOWLIST || "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const hex = toPubkeyHex(trimmed);
    /* A mistyped key names itself instead of taking the mint down at boot —
       but it must not silently become "nobody", which is why it is logged. */
    if (hex) allowlist.add(hex);
    else console.error(`[nutft] NUTFT_ALLOWLIST entry is not an npub or 32-byte hex, ignored: ${trimmed}`);
  }
  if (salesMode === "allowlist" && !allowlist.size) {
    throw new Error("NUTFT_SALES=allowlist with an empty NUTFT_ALLOWLIST would sell to nobody; set the list or use closed");
  }
  /* One proof, one request, for as long as a proof stays fresh. */
  const seenAuth = nip98.createSeenStore(nip98.DEFAULT_MAX_AGE);

  const priceMsat = priceFor(0);
  const paidMint = Boolean(funding);
  if (paidMint && !(priceMsat > 0)) throw new Error("the booster price must be a positive number of msat");

  /* The payment reference is whatever the funding source calls a payment: lnd
     gives a 32-byte hash, a Cashu mint gives a quote UUID. The mint stores it
     and hands it back, so it only needs to be unambiguous and safe to put in a
     URL and a SQL parameter — not to have one particular shape. */
  const isPaymentRef = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);

  /* Collection must not depend on the buyer coming back. A funding source that
     only learns about a payment when someone claims their pack loses every sale
     where the buyer paid and then closed the tab — the payment succeeded and
     the money was never taken. Where the backend can sweep, run it on a timer.
     unref() so this never holds the process open by itself. */
  let reconcileTimer = null;
  if (funding && typeof funding.reconcile === "function") {
    const everyMs = Math.max(30_000, Number(options.reconcileMs || process.env.NUTFT_RECONCILE_MS || 120_000));
    const sweep = () => {
      Promise.resolve()
        .then(() => funding.reconcile({}))
        .catch((error) => console.error("[nutft] reconcile pass failed:", error && error.message));
    };
    reconcileTimer = setInterval(sweep, everyMs);
    if (reconcileTimer && typeof reconcileTimer.unref === "function") reconcileTimer.unref();
  }
  const stop = () => { if (reconcileTimer) clearInterval(reconcileTimer); reconcileTimer = null; };

  /* The block-commitment beacon. Off by default: without it the mint keeps the
     fixed beacon it has today, which is fine for a free demo and disqualifying
     for a paid one, because the whole box is then precomputable offline. Turned
     on, a sale commits to a block height above the current tip and the cards are
     unknowable — to the buyer AND to the mint — until that block exists. */
  /* LNURL-pay needs to hand a wallet an absolute callback URL, so the mint has
     to know where it is publicly reachable. Derived from PUBLIC_URL, which
     already names the canonical host, so there is one place to change hosts. */
  const publicBase = (options.publicBase || process.env.NUTFT_PUBLIC_BASE || "" ||
    (process.env.PUBLIC_URL || "").replace(/^ws/, "http").replace(/\/ws$/, "")).replace(/\/$/, "");
  const payMetadata = lnurl.metadataFor("600B Timelock TCG — one booster, 7 cards");

  const beaconLive = String(options.beaconSource ?? process.env.NUTFT_BEACON_SOURCE ?? "") === "lnd";
  /* The beacon reads the chain; the funding source takes the money. They are
     independent, and conflating them broke as soon as a node-less funding
     source existed: paying through a Cashu mint left the beacon with no chain
     to read even when an lnd was configured purely to read blocks.
     NOTE, and it matters for a node-less deployment: a Cashu mint sells
     invoices but publishes no block data, so going node-less removes the
     beacon's chain source. Either keep an lnd for blocks alone, or accept a
     third party for them — and a third party that can lie about a block hash
     can choose which pack you get, which is the property the beacon exists to
     remove. */
  const chainConfig = options.chainLnd || (options.beaconGetInfo ? {} : null)
    || lndConfig || (options.lnd && options.lnd !== null ? options.lnd : null)
    || lnd.readConfig(options.lndOptions || {});
  if (beaconLive && !chainConfig && !options.beaconGetInfo) {
    throw new Error("NUTFT_BEACON_SOURCE=lnd needs a chain source: set LND_REST_URL, "
      + "which may point at a node used only for reading blocks");
  }
  /* Virtual money must never be a production surprise. The mint says which
     backend it is on, and refuses to run a mock one unless told explicitly. */
  if (funding && funding.virtual && String(options.allowVirtual ?? process.env.NUTFT_ALLOW_VIRTUAL ?? "") !== "1") {
    throw new Error("NUTFT_FUNDING=mock issues virtual sats and settles them itself; "
      + "set NUTFT_ALLOW_VIRTUAL=1 to confirm this is a staging deployment");
  }
  const chain = beaconLive
    ? createBeacon({ db, lnd: chainConfig, confirmations: options.beaconConfirmations, getInfo: options.beaconGetInfo })
    : null;

  const mintSeed = Buffer.from(getOrCreate("mint_seed", () => crypto.randomBytes(32).toString("hex")), "hex");
  const catalogPrivateKey = Buffer.from(getOrCreate("catalog_private_key", () => crypto.randomBytes(32).toString("hex")), "hex");
  let cashu;

  const ready = import("@cashu/cashu-ts").then((module) => {
    cashu = module;
    const keyset = cashu.createNewMintKeys(1, mintSeed, { unit: collectionId });
    return keyset;
  });

  const reference = (assetId) => ({ collection_id: collectionId, asset_id: assetId, catalog_uri: catalogUri });
  const declaration = (assetId) => ({ ...reference(assetId), asset_binding: assetBinding(reference(assetId)) });
  const cardInfo = (assetId) => {
    const card = cards.get(assetId);
    if (!card) throw new Error(`unknown asset_id: ${assetId}`);
    return { ...card, asset_id: assetId, ...declaration(assetId) };
  };
  const catalogPayload = () => ({
    collection_id: collectionId,
    schema: "600b-nutft-catalog-v1",
    catalog_uri: catalogUri,
    census_sha256: census.census_sha256,
    assets: census.cards.map((card) => cardInfo(card.id)),
  });
  const signedCatalog = () => {
    const payload = catalogPayload();
    const digest = crypto.createHash("sha256").update(canonical(payload)).digest();
    return {
      ...payload,
      issuer_pubkey: hex(schnorr.getPublicKey(catalogPrivateKey)),
      signature: hex(schnorr.sign(digest, catalogPrivateKey)),
    };
  };
  const catalogIssuer = () => hex(schnorr.getPublicKey(catalogPrivateKey));
  const current = () => state.state;
  const packId = () => `pack-${String(state.nextPack).padStart(4, "0")}`;
  const atomic = (work) => {
    if (!db) return work();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  let saleChain = Promise.resolve();
  const serializeSale = (work) => {
    const run = saleChain.then(work, work);
    saleChain = run.catch(() => {});
    return run;
  };

  async function quote(beaconOverride) {
    const b = beaconOverride || beacon;
    const id = packId();
    const counts = { ...state.counts };
    const paid = openPack(counts, catalog.pools, catalog.slots, b, id);
    const ids = [...paid, basicId];
    const nextState = hashParts(current(), id, b, ids.join(",")).toString("hex");
    return {
      pack_id: id,
      state: current(),
      next_state: nextState,
      cards: ids.map(cardInfo),
      unit: collectionId,
      amount: 1,
      catalog_uri: catalogUri,
      beacon: b,
    };
  }

  /* A quote the buyer can actually pay. The invoice is bound to this pack id,
     so a settled payment buys the pack it was quoted for and no other. */
  /* The gate. Checked at EVERY entry that can reach an invoice, not only at the
     claim: gating the claim alone would let an unlisted buyer pay and then be
     refused their cards, which is taking money for nothing.

     `buyer` is the pubkey proven by the caller. It is undefined on the
     wallet-driven LNURL path, which cannot sign a nostr event — so while the
     box is gated that path refuses rather than quietly letting anyone through
     the side door. */
  /* `proof` is a NIP-98 Authorization header, not a name the caller chose. The
     first version of this read the pubkey out of the request body, which proved
     nothing whatsoever — anyone could send a listed key and walk through. */
  function requireMayBuy(proof) {
    if (salesMode === "open") return;
    if (salesMode === "closed") {
      throw new Error("the box is not open yet — boosters are not on sale");
    }
    if (!proof || !proof.header) {
      throw new Error("early access: sign the request with your nostr key to buy a booster");
    }
    const checked = nip98.verify(proof.header, {
      method: proof.method,
      path: proof.path,
      host: proof.host,
      seen: seenAuth,
    });
    if (!checked.ok) throw new Error(`early access: ${checked.reason}`);
    if (!allowlist.has(checked.pubkey)) {
      throw new Error("early access: this key is not on the list yet");
    }
    return checked.pubkey;
  }

  async function payableQuoteOnce(opts = {}) {
    requireMayBuy(opts.proof);
    const base = await quote();
    /* Read once, here, and used for the invoice, the record and the reply — so
       the three can never disagree about what this booster costs. */
    const priceNow = priceFor(state.nextPack - 1);
    if (!paidMint) return { ...base, price_msat: 0, paid: false };
    for (const row of q ? q.activeInvoices.all(base.pack_id) : []) {
      let settled;
      try { settled = await funding.isSettled(row.payment_hash); }
      catch (error) { throw new Error("the mint cannot confirm an existing checkout right now — try again shortly"); }
      const created = Date.parse(row.created_at);
      if (settled || !Number.isFinite(created) || created + invoiceTtlSeconds * 1000 > Date.now()) {
        throw new Error("this booster already has an active invoice — pay or claim it, or try again after it expires");
      }
    }
    /* A funding-source failure is ours, not the buyer's, and its message names
       the node's address and port. Log the detail, hand back a plain sentence:
       an operational fault must not double as a map of the deployment. */
    /* With the beacon live the sale commits to a block that does not exist yet,
       so the cards cannot be computed here and are deliberately withheld: this
       IS the sealed pack. They are revealed once that block is mined. */
    let commitment = null;
    if (chain) {
      try {
        commitment = await chain.commitHeight();
      } catch (error) {
        console.error("[nutft] beacon commitHeight failed:", error && error.message);
        throw new Error("the mint cannot read the chain right now — try again shortly");
      }
    }
    let invoice;
    try {
      /* memo and descriptionHash are mutually exclusive, and the choice is made
         HERE rather than left to each driver. LNURL-pay requires the invoice to
         commit sha256(metadata) in the bolt11 `h` field, and a backend handed
         both fields will often honour the description and silently drop the
         hash — producing a `d` field, no error, and an LNURL payment the
         buyer's wallet refuses for a reason nothing on our side logs. */
      invoice = await funding.createInvoice(opts.descriptionHash
        ? { amountMsat: priceNow, descriptionHash: opts.descriptionHash, expirySeconds: invoiceTtlSeconds }
        : { amountMsat: priceNow, memo: `600B booster ${base.pack_id}`, expirySeconds: invoiceTtlSeconds });
    } catch (error) {
      console.error("[nutft] lnd createInvoice failed:", error && error.message);
      throw new Error("the mint cannot reach its funding source right now — try again shortly");
    }
    const { paymentRequest, paymentHash } = invoice;
    if (q) q.putInvoice.run(paymentHash, base.pack_id, base.state, priceNow, new Date().toISOString(), commitment ? commitment.targetHeight : null);
    const head = {
      paid: true, price_msat: priceNow,
      payment_request: paymentRequest, payment_hash: paymentHash,
      /* Travels with the invoice so the page can label it before it is scanned. */
      test_mint: Boolean(funding && funding.testMint),
    };
    if (!commitment) return { ...base, ...head };
    return {
      pack_id: base.pack_id, state: base.state, unit: base.unit, amount: base.amount,
      catalog_uri: base.catalog_uri, ...head,
      sealed: true,
      cards: null,
      target_height: commitment.targetHeight,
      tip_height: commitment.tipHeight,
      note: "sealed pack: the cards resolve against Bitcoin block "
        + commitment.targetHeight + ", which is not mined yet. Pay, then reveal.",
    };
  }

  const payableQuote = (opts) => serializeSale(() => payableQuoteOnce(opts));

  /* Opening a sealed pack. The beacon is the hash of the block the sale
     committed to — not the tip, not a later block — so the buyer receives the
     pack that block determines and nothing else. Until it is mined the honest
     answer is "not yet", with the height so they can watch it themselves. */
  async function revealFor(paymentHash) {
    if (!chain) throw new Error("this mint does not seal packs");
    if (!isPaymentRef(paymentHash)) throw new Error("payment_hash is not a valid payment reference");
    const row = q ? q.invoice.get(paymentHash) : null;
    if (!row) throw new Error("unknown payment_hash: quote the booster first");
    if (!row.target_height) throw new Error("this sale was not sealed against a block");
    let hash;
    try {
      hash = await chain.beaconFor(row.target_height);
    } catch (error) {
      console.error("[nutft] beacon lookup failed:", error && error.message);
      throw new Error("the mint cannot read the chain right now — your sale is unaffected, try again shortly");
    }
    if (!hash) {
      return { sealed: true, target_height: row.target_height, cards: null,
        note: `block ${row.target_height} is not mined yet` };
    }
    const resolved = await quote(hash);
    return { sealed: false, target_height: row.target_height, beacon: hash,
      pack_id: resolved.pack_id, state: resolved.state, next_state: resolved.next_state,
      cards: resolved.cards, unit: resolved.unit, amount: resolved.amount, catalog_uri: resolved.catalog_uri };
  }

  /* Settlement is checked against lnd, never trusted from the request, and the
     row is claimed with a conditional UPDATE so two racing requests cannot both
     see claimed = 0 and both get a pack for one payment. */
  async function requirePaidFor(expected, paymentHash, claim = true) {
    if (!paidMint) return;
    if (typeof paymentHash !== "string") throw new Error("payment_hash is required to buy a booster");
    if (!isPaymentRef(paymentHash)) throw new Error("payment_hash is not a valid payment reference");
    const row = q ? q.invoice.get(paymentHash) : null;
    if (!row) throw new Error("unknown payment_hash: quote the booster first");
    if (row.pack_id !== expected.pack_id) throw new Error("this invoice was quoted for a different pack");
    if (row.claimed) throw new Error("this invoice has already been claimed");
    let settledNow;
    try {
      settledNow = await funding.isSettled(paymentHash);
    } catch (error) {
      console.error("[nutft] lnd isSettled failed:", error && error.message);
      throw new Error("the mint cannot confirm payment right now — your invoice is unaffected, try again shortly");
    }
    if (!settledNow) throw new Error("invoice is not settled yet");
    if (!claim) return;
    const claimed = q.claimInvoice.run(paymentHash);
    if (!claimed || claimed.changes !== 1) throw new Error("this invoice has already been claimed");
  }

  function parseNutftSecret(secret, p2pkE) {
    if (typeof secret !== "string") throw new Error("NutFT output secret is required");
    let parsed;
    try { parsed = JSON.parse(secret); }
    catch { throw new Error("NutFT output secret is invalid JSON"); }
    if (JSON.stringify(parsed) !== secret || !Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== "P2PK" || !parsed[1] || typeof parsed[1] !== "object") {
      throw new Error("NutFT output secret is not canonical P2PK");
    }
    const tags = parsed[1].tags;
    const matches = Array.isArray(tags) ? tags.filter((tag) => Array.isArray(tag) && tag[0] === "nutft") : [];
    if (matches.length !== 1 || matches[0].length !== 6 || matches[0].some((value) => typeof value !== "string" || !value)) {
      throw new Error("NutFT secret must contain exactly one canonical nutft tag");
    }
    const tag = matches[0].slice(1);
    if (tag[0] !== VERSION) throw new Error("unsupported NutFT version");
    const assetReference = { collection_id: tag[1], asset_id: tag[2], catalog_uri: tag[3] };
    if (tag[4] !== assetBinding(assetReference)) throw new Error("NutFT asset binding is invalid");
    if (typeof p2pkE !== "string") throw new Error("NutFT demo outputs must use P2BK");
    cashu.pointFromHex(parsed[1].data);
    cashu.pointFromHex(p2pkE);
    return { reference: assetReference, binding: tag[4] };
  }

  function validateOutput(output, expected, keysetId) {
    if (!output || output.amount !== 1 || output.id !== keysetId || typeof output.B_ !== "string") {
      throw new Error("NutFT output must have amount=1 and the active keyset id");
    }
    const opening = output.nutft;
    if (!opening || typeof opening.blinding_factor !== "string" || !/^[0-9a-f]{64}$/.test(opening.blinding_factor) || /^0+$/.test(opening.blinding_factor)) {
      throw new Error("NutFT output blinding factor is invalid");
    }
    const parsed = parseNutftSecret(opening.secret, opening.p2pk_e);
    const recomputed = cashu.blindMessage(text(opening.secret), BigInt(`0x${opening.blinding_factor}`)).B_.toHex(true);
    if (recomputed !== cashu.pointFromHex(output.B_).toHex(true)) throw new Error("NutFT output opening does not match B_");
    if (expected && canonical(parsed.reference) !== canonical(expected)) throw new Error(`CardBinding mismatch for ${expected.asset_id}`);
    if (!cards.has(parsed.reference.asset_id) || parsed.reference.collection_id !== collectionId) throw new Error(`unknown asset_id: ${parsed.reference.asset_id}`);
    return parsed;
  }

  async function keysResponse() {
    const keyset = await ready;
    return {
      keysets: [{ id: keyset.keysetId, unit: collectionId, active: true, input_fee_ppk: 0, keys: Object.fromEntries(Object.entries(keyset.pubKeys).map(([amount, key]) => [amount, hex(key)])) }],
    };
  }

  /* Deliberately NOT gated on a live credential. The gate belongs on issuance:
     an unlisted buyer never obtains a payable invoice, so an invoice that exists
     was obtained by a listed one, and the settled payment row carries that fact
     forward. Re-checking here would confiscate a legitimately issued, already
     paid invoice the moment a list changed — taking money and refusing the
     cards, which is the one outcome worth designing against. It also removes a
     membership oracle: the old check ran before anything else, so one
     unauthenticated request could test whether any key was on the list. */
  async function signBoosterOnce(body, proof) {
    const keyset = await ready;
    if (typeof body.idempotency_key !== "string" || !body.idempotency_key) throw new Error("booster idempotency_key is required");
    /* Over the body alone. The NIP-98 proof is deliberately a separate argument
       and never part of this hash: it carries a fresh signature every time, so
       folding it in would give a retried request a different fingerprint, and
       the idempotency check would then reject the buyer's own second attempt
       after a dropped connection. Authentication is not part of what was asked
       for — which is also why it must never be read out of the body. */
    const requestHash = crypto.createHash("sha256").update(canonical(body)).digest("hex");
    const previous = getOperation("booster", body.idempotency_key);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new Error("idempotency_key was already used for a different booster");
      return previous.result;
    }
    /* On a PAID mint the sales gate is deliberately NOT checked in this
       function. The settled invoice required below IS the entitlement: it was
       issued while the buyer was allowed to buy, and they paid for it. Checking
       again here would mean that closing the box — or editing the allowlist —
       confiscates a pack somebody had already paid for. Taking the money and
       refusing the cards is the one outcome worth designing against, and it is
       exactly what the earlier version of this check did.

       A FREE mint has no such receipt: requirePaidFor returns immediately when
       paidMint is false, so there the claim IS the sale and this is the only
       place a gate can stand. It runs before any other work, so a closed free
       mint gives nothing away — not even whether a pack is still available.

       Idempotent replays above are intentionally allowed through: they return a
       pack that was already issued, and refusing to re-answer for something we
       already handed over would only lose a buyer their cards to a dropped
       connection. */
    if (!paidMint) requireMayBuy(proof);

    /* A sealed sale is signed against the block it committed to. Resolving
       against anything else would hand over a different pack than the one the
       chain determined, which is the whole property being sold. */
    let saleBeacon;
    if (chain) {
      const row = q ? q.invoice.get(String(body.payment_hash || "")) : null;
      if (!row || !row.target_height) throw new Error("unknown payment_hash: quote the booster first");
      saleBeacon = await chain.beaconFor(row.target_height);
      if (!saleBeacon) throw new Error(`block ${row.target_height} is not mined yet — the pack is still sealed`);
    }
    const expected = await quote(saleBeacon);
    if (body.pack_id !== expected.pack_id || body.state !== expected.state) throw new Error("stale booster quote");
    /* Confirm entitlement before disclosing output-validation details, without
       consuming the invoice until the request itself has passed validation. */
    await requirePaidFor(expected, body.payment_hash, false);
    if (!Array.isArray(body.outputs) || body.outputs.length !== expected.cards.length) throw new Error("one output is required per card");
    for (let i = 0; i < expected.cards.length; i += 1) validateOutput(body.outputs[i], reference(expected.cards[i].asset_id), keyset.keysetId);

    /* Validate the full request before claiming its payment. A malformed output
       must not burn a settled invoice and strand the buyer without a pack. */
    await requirePaidFor(expected, body.payment_hash);

    const signatures = body.outputs.map((output) => {
      const blind = cashu.createBlindSignature(cashu.pointFromHex(output.B_), keyset.privKeys["1"], keyset.keysetId);
      const dleq = cashu.createDLEQProof(cashu.pointFromHex(output.B_), keyset.privKeys["1"]);
      return {
        id: keyset.keysetId,
        amount: 1,
        C_: blind.C_.toHex(true),
        dleq: { s: hex(dleq.s), e: hex(dleq.e) },
      };
    });

    const nextCounts = { ...state.counts };
    const resolved = openPack(nextCounts, catalog.pools, catalog.slots, beacon, expected.pack_id);
    const nextState = { counts: nextCounts, state: expected.next_state, nextPack: state.nextPack + 1 };
    const result = { ...expected, cards: expected.cards, signatures, keyset_id: keyset.keysetId, resolved };
    atomic(() => {
      putMeta("state", JSON.stringify(nextState));
      putOperation("booster", body.idempotency_key, requestHash, result);
    });
    Object.assign(state, nextState);
    return result;
  }

  const signBooster = (body, proof) => serializeSale(() => signBoosterOnce(body, proof));

  async function trade(body) {
    const keyset = await ready;
    if (typeof body.idempotency_key !== "string" || !body.idempotency_key) throw new Error("trade idempotency_key is required");
    const requestHash = crypto.createHash("sha256").update(canonical(body)).digest("hex");
    const previous = getOperation("trade", body.idempotency_key);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new Error("idempotency_key was already used for a different trade");
      return previous.result;
    }
    const inputs = cashu.deserializeProofs(body.inputs || []);
    if (inputs.length !== 1 || !Array.isArray(body.outputs) || body.outputs.length !== 1) throw new Error("demo trade accepts one card at a time");
    const input = inputs[0];
    const parsedInput = parseNutftSecret(input.secret, input.p2pk_e);
    const inputReference = parsedInput.reference;
    if (input.id !== keyset.keysetId || inputReference.collection_id !== collectionId || input.amount.toString() !== "1" || !cards.has(inputReference.asset_id)) throw new Error("input CardBinding is invalid");
    const y = cashu.hashToCurve(text(input.secret)).toHex(true);
    if (isSpent(y)) throw new Error("input proof is already spent");
    if (!cashu.verifyUnblindedSignature({ id: input.id, secret: text(input.secret), C: cashu.pointFromHex(input.C) }, keyset.privKeys["1"])) throw new Error("input signature is invalid");
    if (!cashu.isP2PKSpendAuthorised(input)) throw new Error("input owner witness is invalid");
    const outputBinding = validateOutput(body.outputs[0], inputReference, keyset.keysetId);
    if (outputBinding.binding !== parsedInput.binding) throw new Error("replacement CardBinding must equal input CardBinding");
    const output = body.outputs[0];
    const blind = cashu.createBlindSignature(cashu.pointFromHex(output.B_), keyset.privKeys["1"], keyset.keysetId);
    const dleq = cashu.createDLEQProof(cashu.pointFromHex(output.B_), keyset.privKeys["1"]);
    const result = {
      trade_id: body.idempotency_key,
      unit: collectionId,
      asset_id: inputReference.asset_id,
      signature: { id: keyset.keysetId, amount: 1, C_: blind.C_.toHex(true), dleq: { s: hex(dleq.s), e: hex(dleq.e) } },
    };
    // Commit only after every input, destination, binding, and signature check passed.
    atomic(() => {
      putSpent(y);
      putOperation("trade", body.idempotency_key, requestHash, result);
    });
    return result;
  }

  /* Bind a NIP-98 proof to the method and path of THIS request, so a signature
     for one endpoint can never be presented at another. The host comes from the
     mint's own configured public base, not the request's Host header, which is
     attacker-controlled behind a proxy — and is left unchecked when the mint has
     no configured base, since guessing it wrong would lock out every buyer. */
  const proofFrom = (req, url, method) => ({
    header: (req.headers && (req.headers.authorization || req.headers.Authorization)) || "",
    method,
    path: url.pathname,
    host: publicBase ? new URL(publicBase).host : null,
  });

  async function handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/v1/info") {
        return json(res, 200, { name: "600B NutFT demo mint", version: "0.1.0", nuts: { 31: { supported: true, versions: [1], output_openings: true, p2bk: true, dleq: true, paid: paidMint, price_msat: paidMint ? priceFor(state.nextPack - 1) : 0, price_tiers: paidMint && priceTiers.length > 1 ? priceTiers.map((t) => ({ up_to_packs: t.upTo === Infinity ? null : t.upTo, price_msat: t.msat })) : undefined, funding: funding ? funding.name : "none", virtual_sats: Boolean(funding && funding.virtual), test_mint: Boolean(funding && funding.testMint), sales: salesMode, catalog_issuer: catalogIssuer() }, 7: { supported: true } } });
      }
      if (req.method === "GET" && url.pathname === "/v1/keys") return json(res, 200, await keysResponse());
      if (req.method === "POST" && url.pathname === "/v1/checkstate") {
        const body = await readBody(req);
        await ready;
        if (!Array.isArray(body.Ys) || body.Ys.length > 256) throw new Error("Ys must be an array of at most 256 points");
        for (const Y of body.Ys) {
          if (typeof Y !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(Y)) throw new Error("Ys contains an invalid curve point");
          cashu.pointFromHex(Y);
        }
        return json(res, 200, { states: body.Ys.map((Y) => ({ Y, state: isSpent(Y) ? "SPENT" : "UNSPENT" })) });
      }
      if (req.method === "POST" && url.pathname === "/nutft/trade") return json(res, 200, await trade(await readBody(req)));
      if (req.method === "GET" && url.pathname === "/nutft/catalog") {
        return json(res, 200, signedCatalog());
      }
      if (req.method === "GET" && url.pathname === "/nutft/state") {
        return json(res, 200, { unit: collectionId, state: current(), census_sha256: census.census_sha256, next_pack: packId(), sold: state.nextPack - 1, packs: census.mint.packs, tier_odds: tierOdds, remaining: state.counts });
      }
      if (req.method === "GET" && url.pathname === "/nutft/quote") {
        return json(res, 200, await payableQuote({ proof: proofFrom(req, url, "GET") }));
      }
      /* LUD-06 step 1: what a wallet reads when it scans the QR. */
      if (req.method === "GET" && url.pathname === "/nutft/lnurlp") {
        if (!paidMint) return json(res, 200, lnurl.error("this mint is free — no payment is needed"));
        if (!publicBase) return json(res, 200, lnurl.error("mint is not configured with a public URL"));
        /* A wallet cannot prove a nostr key, so a gated box cannot serve this
           path at all. Saying so is better than handing over a payable invoice
           that will not be honoured. */
        if (salesMode !== "open") return json(res, 200, lnurl.error("the box is not open to wallet payments yet"));
        return json(res, 200, lnurl.payRequest({
          callbackUrl: `${publicBase}/nutft/lnurlp/callback`,
          amountMsat: priceFor(state.nextPack - 1),
          metadata: payMetadata,
        }));
      }
      /* LUD-06 step 2: the wallet asks for the invoice. This is where the sale
         is actually created, so a scan that is never paid costs a quote and
         nothing else. successAction carries the claim link, because after
         paying by QR the buyer has no other way to learn their payment_hash. */
      if (req.method === "GET" && url.pathname === "/nutft/lnurlp/callback") {
        if (!paidMint) return json(res, 200, lnurl.error("this mint is free — no payment is needed"));
        if (salesMode !== "open") return json(res, 200, lnurl.error("the box is not open to wallet payments yet"));
        const amount = Number(url.searchParams.get("amount"));
        const wanted = priceFor(state.nextPack - 1);
        if (!Number.isFinite(amount) || amount !== wanted) {
          /* A wallet that read the pay request just before a tier turned over
             would send the old amount. Say the current price rather than a bare
             refusal, so the wallet can re-read and try again. */
          return json(res, 200, lnurl.error(`a booster costs exactly ${wanted} msat`));
        }
        try {
          const sale = await payableQuote({ descriptionHash: lnurl.descriptionHash(payMetadata) });
          return json(res, 200, {
            pr: sale.payment_request,
            routes: [],
            successAction: {
              tag: "url",
              description: "Open your booster",
              url: `${publicBase}/shop.html?shop=mint&claim=${sale.payment_hash}`,
            },
          });
        } catch (error) {
          return json(res, 200, lnurl.error(error.message));
        }
      }
      if (req.method === "GET" && url.pathname === "/nutft/reveal") {
        return json(res, 200, await revealFor(url.searchParams.get("payment_hash") || ""));
      }
      if (req.method === "POST" && url.pathname === "/nutft/booster") {
        /* The proof rides on the header, never in the body. A body field would
           be the same mistake as before: something the caller writes rather
           than something they prove. It is only consulted on a free mint —
           signBooster explains why a paid one must not re-check. */
        return json(res, 200, await signBooster(await readBody(req), proofFrom(req, url, "POST")));
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  /* signBooster and payableQuote are exported so the payment gate can be
     tested directly, without standing up an HTTP server and an lnd. */
  return { handle, catalogUri, collectionId, initialCommitment, state, signBooster, payableQuote, revealFor, paidMint, funding, stop, sealed: Boolean(chain) };
}

module.exports = { assetBinding, canonical, createNutftMint };
