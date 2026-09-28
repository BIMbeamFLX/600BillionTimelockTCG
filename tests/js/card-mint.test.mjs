/**
 * LNURLcash cards (server/card-mint.js): an E1 pack paid over LNURL-pay and
 * issued as seal notes to the key named in the comment, through the booster's
 * own draw, state chain, invoice claim and supply; moves with receipts, the
 * lookup a wallet collects with, restarts, and the vendored card rules pinned
 * to their provenance. Then what the #78 review found: a card invoice the
 * NutFT routes would hand to anyone with its hash, paid packs released or
 * lost, a start that one bad card or a second process could break.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createNutftMint } = require("../../server/nutft-mint.js");
const { createMockFunding } = require("../../server/funding.js");
const { createCardMint, CARD_STATES } = require("../../server/card-mint.js");
const cards = require("../../server/vendor/lnurlcash-cards.js");
const { schnorr } = await import("@noble/curves/secp256k1");
const { DatabaseSync } = await import("node:sqlite");
const CENSUS = require("../../cards/nutft-census.json");

const BASE = "https://tcg.test";
const DOMAIN = "tcg.test";
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const holder = () => {
  const key = new Uint8Array(randomBytes(32));
  return { key, pub: new Uint8Array(schnorr.getPublicKey(key)) };
};

function setup(t, db = new DatabaseSync(":memory:"), extra = {}) {
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const nutft = createNutftMint({
    db, catalogUri: `${BASE}/nutft/catalog`, funding, priceMsat: 21000,
    allowVirtual: "1", sales: "open", publicBase: BASE, ...extra,
  });
  t.after(() => nutft.stop());
  const cardMint = createCardMint({ nutft, db, publicBase: BASE, sweepEveryMs: 0 });
  return { db, funding, nutft, cardMint };
}

/* The node's answer counted: how often the mint asks it whether a payment settled. */
function countSettleChecks(funding) {
  const counted = { calls: 0 };
  const isSettled = funding.isSettled.bind(funding);
  funding.isSettled = (...args) => { counted.calls++; return isSettled(...args); };
  return counted;
}

/* Moves an invoice's creation back in time, as if it had waited that long. */
const age = (db, hash, seconds) => db.prepare("UPDATE nutft_invoices SET created_at = ? WHERE payment_hash = ?")
  .run(new Date(Date.now() - seconds * 1000).toISOString(), hash);

/* Asks for a pack for `owner`, and leaves it unpaid. */
async function quotePack(cardMint, owner) {
  const invoice = (await get(cardMint, `/cards/lnurlp/callback?amount=21000&comment=${cards.encodeCp1(owner)}`)).body;
  assert.ok(invoice.pr, JSON.stringify(invoice));
  return invoice.verify.split("/").pop();
}

async function get(cardMint, path) {
  const res = {
    writeHead(status, headers) { res.status = status; res.headers = headers; return res; },
    end(body) { res.body = JSON.parse(body); },
  };
  assert.equal(await cardMint.handle({ method: "GET" }, res, new URL(BASE + path)), true, path);
  return res;
}

/* Asks for a pack for `owner` and pays it through the mock. */
async function buyPack({ cardMint, funding }, owner) {
  const invoice = (await get(cardMint, `/cards/lnurlp/callback?amount=21000&comment=${cards.encodeCp1(owner)}`)).body;
  assert.ok(invoice.pr, JSON.stringify(invoice));
  const hash = invoice.verify.split("/").pop();
  funding.settle(hash);
  return { invoice, hash };
}

const held = async (cardMint, owner) => (await get(cardMint, `/cards?owner=${hex(owner)}`)).body.cards;

test("the vendored card rules are the bytes their provenance names", () => {
  const bundle = readFileSync(new URL("../../server/vendor/lnurlcash-cards.js", import.meta.url));
  const provenance = JSON.parse(readFileSync(new URL("../../server/vendor/lnurlcash-cards.provenance.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(bundle).digest("hex"), provenance.sha256);
  assert.match(bundle.toString("utf8", 0, 300), new RegExp(`bearlett ${provenance.commit} src/cards/mint.ts`));
  assert.equal(provenance.entry, "src/cards/mint.ts");
});

test("discovery names the catalog's issuer, the endpoints and the pack", async (t) => {
  const mint = setup(t);
  const found = await get(mint.cardMint, "/.well-known/lnurlcash-cards");
  assert.equal(found.headers["access-control-allow-origin"], "*");
  const info = { writeHead() { return info; }, end(b) { info.parsed = JSON.parse(b); } };
  await mint.nutft.handle({ method: "GET" }, info, new URL(`${BASE}/v1/info`));
  assert.deepEqual(found.body, {
    v: 0,
    issuer: info.parsed.nuts["31"].catalog_issuer,
    withdraw: `${BASE}/cards/w`,
    lookup: `${BASE}/cards`,
    packs: [{ lnurlp: `${BASE}/cards/lnurlp`, edition: "600b-e1", collection_id: "600B-E1", catalog_uri: `${BASE}/nutft/catalog` }],
  });
});

test("a pack paid over LNURL-pay arrives at the key in the comment, drawn as a booster is", async (t) => {
  const mint = setup(t);
  const { cardMint, nutft } = mint;
  const pay = (await get(cardMint, "/cards/lnurlp")).body;
  assert.equal(pay.tag, "payRequest");
  assert.equal(pay.minSendable, 21000);
  assert.equal(pay.maxSendable, 21000);
  assert.ok(pay.commentAllowed >= 64, "room for cp1<key>");
  const alice = holder();
  const before = nutft.state.nextPack;

  // nothing yet: the invoice is not paid
  const invoice = (await get(cardMint, `/cards/lnurlp/callback?amount=21000&comment=${cards.encodeCp1(alice.pub)}`)).body;
  const hash = invoice.verify.split("/").pop();
  assert.deepEqual(await held(cardMint, alice.pub), []);
  assert.equal((await get(cardMint, `/cards/verify/${hash}`)).body.settled, false);

  mint.funding.settle(hash);
  const verify = (await get(cardMint, `/cards/verify/${hash}`)).body;
  assert.deepEqual(verify, { status: "OK", settled: true, preimage: null, pr: invoice.pr });
  const got = await held(cardMint, alice.pub);
  assert.equal(got.length, CENSUS.mint.cards_per_pack);
  const issuer = cards.hexToBytes((await get(cardMint, "/.well-known/lnurlcash-cards")).body.issuer);
  const names = [];
  for (const consignment of got) {
    const card = cards.verifyConsignment(consignment, issuer);
    assert.equal(typeof card, "object", String(card));
    assert.deepEqual([...card.head.owner], [...alice.pub]);
    assert.match(card.head.description, /^600B-E1#\d+$/);
    names.push(card.head.name);
  }
  // the booster's own draw and state chain: one pack further, its cards
  assert.equal(nutft.state.nextPack, before + 1);
  assert.ok(names.every((name) => /^E1-\d{3}$/.test(name)), names.join(","));
  // the invoice is claimed: asking again delivers nothing a second time
  assert.equal(await nutft.claimCards(hash, () => { throw new Error("delivered twice"); }), null);
  assert.equal((await held(cardMint, alice.pub)).length, CENSUS.mint.cards_per_pack);
  // and the supply books still balance: a snapshot signs
  assert.ok(nutft.supply.snapshot(), "the supply ledger signs the new figures");
});

test("a wrong amount, or no key to issue to, buys nothing", async (t) => {
  const { cardMint } = setup(t);
  const alice = holder();
  assert.match((await get(cardMint, `/cards/lnurlp/callback?amount=1000&comment=${cards.encodeCp1(alice.pub)}`)).body.reason, /exactly 21000 msat/);
  assert.match((await get(cardMint, "/cards/lnurlp/callback?amount=21000")).body.reason, /cp1/);
  assert.match((await get(cardMint, "/cards/lnurlp/callback?amount=21000&comment=hello")).body.reason, /cp1/);
  assert.match((await get(cardMint, "/cards?owner=zz")).body.reason, /64 hex/);
});

test("a card moves with the mint's receipt, and a restart keeps the move", async (t) => {
  const db = new DatabaseSync(":memory:");
  const mint = setup(t, db);
  const alice = holder();
  const bob = holder();
  await buyPack(mint, alice.pub);
  const [first] = await held(mint.cardMint, alice.pub);
  const issuer = cards.hexToBytes((await get(mint.cardMint, "/.well-known/lnurlcash-cards")).body.issuer);
  const card = cards.verifyConsignment(first, issuer);
  const move = cards.makeMove(card.head, alice.key, bob.pub, DOMAIN);
  const info = (await get(mint.cardMint, `/cards/w?p=${cards.encodeCp1(card.q)}`)).body;
  assert.equal(info.callback, `${BASE}/cards/w/cb`);
  assert.equal(info.maxWithdrawable, 1000);
  const query = new URLSearchParams({ k1: move.k1, p1: move.p1, state: move.state });
  const moved = (await get(mint.cardMint, `/cards/w/cb?${query}`)).body;
  assert.equal(moved.status, "OK", JSON.stringify(moved));
  assert.match(moved.receipt, /^[0-9a-f]{128}$/);
  // asked again: the same answer, nothing moves twice
  assert.deepEqual((await get(mint.cardMint, `/cards/w/cb?${query}`)).body, moved);
  const atBob = await held(mint.cardMint, bob.pub);
  assert.equal(atBob.length, 1);
  assert.equal(cards.verifyConsignment(atBob[0], issuer).states.length, 2);

  // a restart rebuilds every card from the database
  const again = createCardMint({ nutft: mint.nutft, db, publicBase: BASE });
  assert.equal((await held(again, bob.pub)).length, 1);
  assert.equal((await held(again, alice.pub)).length, CENSUS.mint.cards_per_pack - 1);
  assert.match((await get(again, `/cards/w?p=${cards.encodeCp1(card.q)}`)).body.reason, /already spent/);
});

test("every other burn of a card is refused", async (t) => {
  const mint = setup(t);
  const alice = holder();
  await buyPack(mint, alice.pub);
  const [first] = await held(mint.cardMint, alice.pub);
  const issuer = cards.hexToBytes((await get(mint.cardMint, "/.well-known/lnurlcash-cards")).body.issuer);
  const card = cards.verifyConsignment(first, issuer);
  const move = cards.makeMove(card.head, alice.key, alice.pub, DOMAIN);
  for (const query of [
    { k1: move.k1, pr: "lnbc10n1pay" },
    { k1: move.k1, p1: move.p1, state: move.state, amount: "500", p2: move.p1 },
    { k1: move.k1, p1: move.p1 },
  ]) {
    assert.equal((await get(mint.cardMint, `/cards/w/cb?${new URLSearchParams(query)}`)).body.reason, cards.ONLY_MOVES);
  }
  // a stranger's key opens nothing
  const eve = holder();
  const stolen = cards.makeMove(card.head, eve.key, eve.pub, DOMAIN);
  const theft = new URLSearchParams({ k1: stolen.k1, p1: stolen.p1, state: stolen.state });
  assert.match((await get(mint.cardMint, `/cards/w/cb?${theft}`)).body.reason, /does not open/);
});

test("a card pack's invoice collects nothing through the NutFT routes", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const { hash } = await buyPack(mint, alice.pub);
  // the owner is on the invoice's row from the start, not written after it
  const row = mint.db.prepare("SELECT pack_id, state, card_owner FROM nutft_invoices WHERE payment_hash = ?").get(hash);
  assert.equal(row.card_owner, hex(alice.pub));
  // whoever knows the payment hash: no reveal, no booster
  await assert.rejects(mint.nutft.revealFor(hash), /LNURLcash cards/);
  await assert.rejects(
    mint.nutft.signBooster({ idempotency_key: "mallory", pack_id: row.pack_id, state: row.state, payment_hash: hash, outputs: [] }),
    /LNURLcash cards/,
  );
  // and the pack still goes to alice's key
  assert.equal((await get(mint.cardMint, `/cards/verify/${hash}`)).body.settled, true);
  assert.equal((await held(mint.cardMint, alice.pub)).length, CENSUS.mint.cards_per_pack);
});

test("a paid pack is never sold again, and the sweep issues it unasked", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const bob = holder();
  const { hash } = await buyPack(mint, alice.pub);
  // alice closed her wallet before it collected, two hours ago
  age(mint.db, hash, 2 * 3600);
  const refused = (await get(mint.cardMint, `/cards/lnurlp/callback?amount=21000&comment=${cards.encodeCp1(bob.pub)}`)).body;
  assert.match(refused.reason, /paid for and its cards are being issued/);
  await mint.cardMint.sweep();
  const found = (await get(mint.cardMint, `/cards?owner=${hex(alice.pub)}`)).body;
  assert.equal(found.cards.length, CENSUS.mint.cards_per_pack);
  assert.equal(found.used, true);
  // the next pack is for sale again
  await quotePack(mint.cardMint, bob.pub);
});

test("a pack that expired unpaid is closed, and asking for a key's cards stays cheap", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const hash = await quotePack(mint.cardMint, alice.pub);
  const checks = countSettleChecks(mint.funding);
  // still fresh: asking for alice's cards asks the node about her pack
  await held(mint.cardMint, alice.pub);
  assert.equal(checks.calls, 1);
  // expired, but a payment may still be in flight: the sweep asks, and keeps it
  age(mint.db, hash, 900 + 60);
  await mint.cardMint.sweep();
  assert.equal(checks.calls, 2);
  assert.deepEqual(mint.nutft.openCardInvoices(), [hash]);
  // past the margin: closed for good, and nothing asks again
  age(mint.db, hash, 900 + 600 + 60);
  await mint.cardMint.sweep();
  const row = mint.db.prepare("SELECT claimed, card_closed FROM nutft_invoices WHERE payment_hash = ?").get(hash);
  assert.deepEqual({ ...row }, { claimed: 0, card_closed: "lapsed" });
  await mint.cardMint.sweep();
  await held(mint.cardMint, alice.pub);
  assert.equal(checks.calls, 3);
  assert.deepEqual(mint.nutft.openCardInvoices(), []);
});

test("an unpaid pack holds its pack past the invoice's expiry, for a payment in flight", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const bob = holder();
  const hash = await quotePack(mint.cardMint, alice.pub);
  // expired, but a payment may still be landing: nobody else is sold the pack
  age(mint.db, hash, 900 + 30);
  const refused = (await get(mint.cardMint, `/cards/lnurlp/callback?amount=21000&comment=${cards.encodeCp1(bob.pub)}`)).body;
  assert.match(refused.reason, /already has an active invoice/);
  // it landed after all: alice gets the pack she paid for
  mint.funding.settle(hash);
  assert.equal((await get(mint.cardMint, `/cards/verify/${hash}`)).body.settled, true);
  assert.equal((await held(mint.cardMint, alice.pub)).length, CENSUS.mint.cards_per_pack);
  // past the margin an unpaid pack holds nothing
  const next = await quotePack(mint.cardMint, alice.pub);
  age(mint.db, next, 900 + 600 + 30);
  await quotePack(mint.cardMint, bob.pub);
});

test("a payment that came after its pack was sold again is refunded, not retried", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const bob = holder();
  const late = await quotePack(mint.cardMint, alice.pub);
  // past even the margin, so bob is sold the same pack and collects it;
  // no payment settles that late, but should one, it is not lost in a retry
  age(mint.db, late, 900 + 600 + 30);
  const { hash } = await buyPack(mint, bob.pub);
  assert.equal((await get(mint.cardMint, `/cards/verify/${hash}`)).body.settled, true);
  assert.equal((await held(mint.cardMint, bob.pub)).length, CENSUS.mint.cards_per_pack);
  // then alice's payment, in flight at the expiry, settles after all
  mint.funding.settle(late);
  const errors = [];
  const logged = console.error;
  console.error = (...line) => errors.push(line.join(" "));
  try {
    for (let ask = 0; ask < 2; ask++) {
      const answer = (await get(mint.cardMint, `/cards/verify/${late}`)).body;
      assert.equal(answer.status, "ERROR");
      assert.match(answer.reason, /sold to someone else: ask the operator for a refund/);
    }
    await mint.cardMint.sweep();
  } finally {
    console.error = logged;
  }
  assert.equal(errors.filter((line) => line.includes("REFUND DUE") && line.includes(late)).length, 1);
  assert.equal(mint.db.prepare("SELECT card_closed FROM nutft_invoices WHERE payment_hash = ?").get(late).card_closed, "stale");
  assert.deepEqual(await held(mint.cardMint, alice.pub), []);
});

test("a card mint starts only where its cards can work", async (t) => {
  const paid = setup(t);
  for (const [publicBase, reason] of [
    ["http://192.168.1.5:8787", /https public origin/],
    ["https://tcg.test/tcg", /https public origin/],
    ["", /NUTFT_PUBLIC_BASE or PUBLIC_URL/],
  ]) {
    assert.throws(() => createCardMint({ nutft: paid.nutft, db: new DatabaseSync(":memory:"), publicBase }), reason);
  }
  const committed = createNutftMint({
    db: new DatabaseSync(":memory:"), catalogUri: `${BASE}/nutft/catalog`, funding: createMockFunding(),
    priceMsat: 21000, allowVirtual: "1", sales: "open", publicBase: BASE, purchaseMode: "1",
  });
  t.after(() => committed.stop());
  assert.throws(() => createCardMint({ nutft: committed, db: new DatabaseSync(":memory:"), publicBase: BASE }), /NUTFT_PURCHASE_MODE/);
  const free = createNutftMint({ db: new DatabaseSync(":memory:"), catalogUri: `${BASE}/nutft/catalog`, publicBase: BASE });
  t.after(() => free.stop());
  assert.throws(() => createCardMint({ nutft: free, db: new DatabaseSync(":memory:"), publicBase: BASE }), /paid mint/);
});

test("a card mint keeps the origin its cards name", async (t) => {
  const mint = setup(t);
  assert.throws(
    () => createCardMint({ nutft: mint.nutft, db: mint.db, publicBase: "https://elsewhere.test", sweepEveryMs: 0 }),
    /ran under https:\/\/tcg\.test/,
  );
  // the same origin, written with a trailing slash, is the same origin
  createCardMint({ nutft: mint.nutft, db: mint.db, publicBase: `${BASE}/`, sweepEveryMs: 0 });
});

test("a card that does not check out is quarantined, and the rest start", async (t) => {
  const mint = setup(t);
  const alice = holder();
  await buyPack(mint, alice.pub);
  const [first] = await held(mint.cardMint, alice.pub);
  const assetId = cards.bytesToHex(cards.decodeState(cards.hexToBytes(first.states[0])).assetId);
  mint.db.prepare("UPDATE card_ledger SET consignment = ? WHERE asset_id = ?")
    .run(JSON.stringify({ ...first, genesis: "00".repeat(64) }), assetId);
  const errors = [];
  const logged = console.error;
  console.error = (...line) => errors.push(line.join(" "));
  let again;
  try {
    again = createCardMint({ nutft: mint.nutft, db: mint.db, publicBase: BASE, sweepEveryMs: 0 });
  } finally {
    console.error = logged;
  }
  assert.ok(errors.some((line) => line.includes(`QUARANTINED card ${assetId}`)), errors.join("\n"));
  assert.equal((await held(again, alice.pub)).length, CENSUS.mint.cards_per_pack - 1);
  // its row is kept for the operator
  assert.ok(mint.db.prepare("SELECT 1 FROM card_ledger WHERE asset_id = ?").get(assetId));
});

test("the lookup says whether a key ever held a card", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const bob = holder();
  await buyPack(mint, alice.pub);
  const [first] = await held(mint.cardMint, alice.pub);
  const issuer = cards.hexToBytes((await get(mint.cardMint, "/.well-known/lnurlcash-cards")).body.issuer);
  const toBob = cards.makeMove(cards.verifyConsignment(first, issuer).head, alice.key, bob.pub, DOMAIN);
  assert.equal((await get(mint.cardMint, `/cards/w/cb?${new URLSearchParams({ k1: toBob.k1, p1: toBob.p1, state: toBob.state })}`)).body.status, "OK");
  const back = cards.makeMove(toBob.next, bob.key, alice.pub, DOMAIN);
  assert.equal((await get(mint.cardMint, `/cards/w/cb?${new URLSearchParams({ k1: back.k1, p1: back.p1, state: back.state })}`)).body.status, "OK");
  assert.deepEqual((await get(mint.cardMint, `/cards?owner=${hex(bob.pub)}`)).body, { cards: [], used: true });
  assert.deepEqual((await get(mint.cardMint, `/cards?owner=${hex(holder().pub)}`)).body, { cards: [], used: false });
});

test("a second process cannot fork a card", async (t) => {
  const mint = setup(t);
  const alice = holder();
  const bob = holder();
  const carol = holder();
  await buyPack(mint, alice.pub);
  const [first] = await held(mint.cardMint, alice.pub);
  const other = createCardMint({ nutft: mint.nutft, db: mint.db, publicBase: BASE, sweepEveryMs: 0 });
  const issuer = cards.hexToBytes((await get(mint.cardMint, "/.well-known/lnurlcash-cards")).body.issuer);
  const head = cards.verifyConsignment(first, issuer).head;
  const toBob = cards.makeMove(head, alice.key, bob.pub, DOMAIN);
  assert.equal((await get(mint.cardMint, `/cards/w/cb?${new URLSearchParams({ k1: toBob.k1, p1: toBob.p1, state: toBob.state })}`)).body.status, "OK");
  // the other process still holds alice's state in memory: its move is refused
  const toCarol = cards.makeMove(head, alice.key, carol.pub, DOMAIN);
  const logged = console.error;
  console.error = () => {};
  let forked;
  try {
    forked = await get(other, `/cards/w/cb?${new URLSearchParams({ k1: toCarol.k1, p1: toCarol.p1, state: toCarol.state })}`);
  } finally {
    console.error = logged;
  }
  assert.equal(forked.body.status, "ERROR");
  assert.equal(forked.status, 500);
  assert.deepEqual((await get(mint.cardMint, `/cards?owner=${hex(carol.pub)}`)).body.cards, []);
  assert.equal((await held(mint.cardMint, bob.pub)).length, 1);
});

test("a pack whose issue fails is held not at all, and tried again later, not every sweep", async (t) => {
  const db = new DatabaseSync(":memory:");
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const nutft = createNutftMint({
    db, catalogUri: `${BASE}/nutft/catalog`, funding, priceMsat: 21000,
    allowVirtual: "1", sales: "open", publicBase: BASE,
  });
  t.after(() => nutft.stop());
  // the card mint's own writes fail while the disk is "full"
  let full = false;
  const cardDb = new Proxy(db, {
    get(target, name) {
      if (name !== "prepare") return typeof target[name] === "function" ? target[name].bind(target) : target[name];
      return (sql) => {
        const statement = target.prepare(sql);
        if (!/INSERT INTO card_ledger/.test(sql)) return statement;
        return {
          run: (...args) => {
            if (full) throw new Error("database or disk is full");
            return statement.run(...args);
          },
        };
      };
    },
  });
  let clock = 1_000_000;
  const cardMint = createCardMint({ nutft, db: cardDb, publicBase: BASE, sweepEveryMs: 0, now: () => clock });
  const alice = holder();
  const { hash } = await buyPack({ cardMint, funding }, alice.pub);
  const checks = countSettleChecks(funding);
  const ledger = cardMint.ledger;
  full = true;
  const logged = console.error;
  console.error = () => {};
  try {
    assert.equal((await get(cardMint, `/cards/verify/${hash}`)).status, 500);
    await cardMint.sweep();
    // nothing held that is not on disk, and nothing reloaded to find that out
    assert.equal(cardMint.ledger, ledger);
    assert.deepEqual(await held(cardMint, alice.pub), []);
    // the next sweeps leave the pack be until its wait is over
    const tried = checks.calls;
    await cardMint.sweep();
    assert.equal(checks.calls, tried);
    full = false;
    clock += 30_000;
    await cardMint.sweep();
  } finally {
    console.error = logged;
  }
  assert.equal((await held(cardMint, alice.pub)).length, CENSUS.mint.cards_per_pack);
  assert.equal(cardMint.ledger, ledger);
});

test("with the card mint off, a paid pack waiting for it says so", async (t) => {
  const db = new DatabaseSync(":memory:");
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const nutft = createNutftMint({
    db, catalogUri: `${BASE}/nutft/catalog`, funding, priceMsat: 21000,
    allowVirtual: "1", sales: "open", publicBase: BASE,
  });
  t.after(() => nutft.stop());
  const cardMint = createCardMint({ nutft, db, publicBase: BASE, sweepEveryMs: 0 });
  const alice = holder();
  const hash = await quotePack(cardMint, alice.pub);
  funding.settle(hash);
  // switched off before it issued the pack: the shop waits, and says why
  cardMint.stop();
  await assert.rejects(nutft.payableQuote({}), /the card mint is off: the shop waits until it is on again/);
  // on again, it issues the pack, and the shop goes on
  const again = createCardMint({ nutft, db, publicBase: BASE, sweepEveryMs: 0 });
  await again.sweep();
  assert.equal((await held(again, alice.pub)).length, CENSUS.mint.cards_per_pack);
  await quotePack(again, holder().pub);
});

test("a card moves at most CARD_STATES - 1 times here, and says so after that", async (t) => {
  assert.equal(CARD_STATES, 1000);
  const db = new DatabaseSync(":memory:");
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const nutft = createNutftMint({
    db, catalogUri: `${BASE}/nutft/catalog`, funding, priceMsat: 21000,
    allowVirtual: "1", sales: "open", publicBase: BASE,
  });
  t.after(() => nutft.stop());
  const cardMint = createCardMint({ nutft, db, publicBase: BASE, sweepEveryMs: 0, maxStates: 2 });
  const alice = holder();
  const bob = holder();
  await buyPack({ cardMint, funding }, alice.pub);
  const [first] = await held(cardMint, alice.pub);
  const issuer = cards.hexToBytes((await get(cardMint, "/.well-known/lnurlcash-cards")).body.issuer);
  const toBob = cards.makeMove(cards.verifyConsignment(first, issuer).head, alice.key, bob.pub, DOMAIN);
  assert.equal((await get(cardMint, `/cards/w/cb?${new URLSearchParams({ k1: toBob.k1, p1: toBob.p1, state: toBob.state })}`)).body.status, "OK");
  const back = cards.makeMove(toBob.next, bob.key, alice.pub, DOMAIN);
  const refused = (await get(cardMint, `/cards/w/cb?${new URLSearchParams({ k1: back.k1, p1: back.p1, state: back.state })}`)).body;
  assert.equal(refused.reason, cards.MOVED_OUT);
});
