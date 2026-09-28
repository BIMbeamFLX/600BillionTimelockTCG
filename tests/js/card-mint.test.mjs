/**
 * LNURLcash cards (server/card-mint.js): an E1 pack paid over LNURL-pay and
 * issued as seal notes to the key named in the comment, through the booster's
 * own draw, state chain, invoice claim and supply; moves with receipts, the
 * lookup a wallet collects with, restarts, and the vendored card rules pinned
 * to their provenance.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createNutftMint } = require("../../server/nutft-mint.js");
const { createMockFunding } = require("../../server/funding.js");
const { createCardMint } = require("../../server/card-mint.js");
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

function setup(t, db = new DatabaseSync(":memory:")) {
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const nutft = createNutftMint({
    db, catalogUri: `${BASE}/nutft/catalog`, funding, priceMsat: 21000,
    allowVirtual: "1", sales: "open", publicBase: BASE,
  });
  t.after(() => nutft.stop());
  return { db, funding, nutft, cardMint: createCardMint({ nutft, db, publicBase: BASE }) };
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
