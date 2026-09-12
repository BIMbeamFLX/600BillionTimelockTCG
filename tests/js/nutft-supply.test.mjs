/* The supply ledger: signed, chained snapshots of what the mint has issued. */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const { canonical, createNutftMint } = require("../../server/nutft-mint.js");
const { SUPPLY_KIND, SUPPLY_PAGE, SUPPLY_SCHEMA, createSupplyLedger, eventId } = require("../../server/nutft-supply.js");
const { schnorr } = require("@noble/curves/secp256k1");
const CENSUS = require("../../cards/nutft-census.json");
const cashu = await import("@cashu/cashu-ts");

const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const PAID = CENSUS.mint.paid_cards_per_pack;
/* Only cards with printed copies are counted; the free Basic has none. */
const PRINTED = Object.fromEntries(CENSUS.cards.filter((card) => card.copies).map((card) => [card.id, card.copies]));
const sum = (counts) => Object.values(counts).reduce((total, n) => total + n, 0);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const opening = (output) => ({
  secret: new TextDecoder().decode(output.secret),
  blinding_factor: output.blindingFactor.toString(16).padStart(64, "0"),
  p2pk_e: output.ephemeralE,
});
const verified = (event) => eventId(event) === event.id && schnorr.verify(event.sig, event.id, event.pubkey);
const content = (event) => JSON.parse(event.content);

/* The mint behind a real socket, so bodies travel as they do in production. */
async function serve(mint) {
  const server = http.createServer((req, res) => {
    mint.handle(req, res, new URL(req.url, "http://127.0.0.1")).catch((error) => {
      res.writeHead(500);
      res.end(error.message);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: async (path) => (await fetch(base + path)).json(),
    post: async (path, body) => (await fetch(base + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })).json(),
    /* fetch keeps its connection alive; close() alone would wait for it. */
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/* One well-formed P2BK output per card of a drawn pack. */
function outputsFor(cards, keysetId) {
  const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
  return cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey,
    blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keysetId)).map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) }));
}

/* A free-mint claim over HTTP: quote, outputs, booster. */
async function claimPack(api) {
  const keyset = (await api.get("/v1/keys")).keysets[0];
  const quote = await api.get("/nutft/quote");
  const issued = await api.post("/nutft/booster", {
    idempotency_key: `supply-${quote.pack_id}`,
    pack_id: quote.pack_id,
    state: quote.state,
    outputs: outputsFor(quote.cards, keyset.id),
  });
  assert.ok(issued.signatures, `the claim went through: ${JSON.stringify(issued).slice(0, 200)}`);
  return issued;
}

/* Everything a test opens is closed in reverse, whether it passed or not. */
function janitor(t) {
  const open = [];
  t.after(async () => {
    for (const close of open.reverse()) {
      try { await close(); } catch { /* already closed by the test itself */ }
    }
  });
  return (close) => { open.push(close); return close; };
}

test("the mint attests its supply at boot, after a claim, and across a restart", async (t) => {
  const later = janitor(t);
  const dir = mkdtempSync(join(tmpdir(), "nutft-supply-"));
  later(() => rmSync(dir, { recursive: true, force: true }));
  const boot = async () => {
    const db = new DatabaseSync(join(dir, "mint.db"));
    later(() => db.close());
    const mint = createNutftMint({ db, lnd: null, catalogUri: CATALOG_URI, supplyIntervalSeconds: 0 });
    later(() => mint.stop());
    const api = await serve(mint);
    later(api.close);
    return { db, mint, api };
  };

  let { db, mint, api } = await boot();
  const info = await api.get("/v1/info");
  assert.equal(info.nuts[31].supply_kind, SUPPLY_KIND);
  assert.deepEqual(info.nuts[31].supply_relays, []);

  const first = await api.get("/nutft/supply");
  assert.equal(first.fault, null);
  assert.equal(first.kind, SUPPLY_KIND);
  assert.equal(first.issuer, info.nuts[31].catalog_issuer, "the ledger is signed with the catalog key");
  assert.equal(first.events.length, 1, "boot takes the first snapshot");
  const genesis = first.events[0];
  assert.equal(genesis.kind, SUPPLY_KIND);
  assert.equal(genesis.pubkey, first.issuer);
  assert.ok(verified(genesis), "id and BIP-340 signature check out");
  assert.deepEqual(genesis.tags, [["x", CENSUS.census_sha256]]);
  const g = content(genesis);
  assert.equal(genesis.content, canonical(g), "the content is canonical JSON");
  assert.equal(g.schema, SUPPLY_SCHEMA);
  assert.equal(g.collection_id, "600B-E1");
  assert.equal(g.catalog_uri, CATALOG_URI);
  assert.equal(g.census_sha256, CENSUS.census_sha256);
  assert.equal(g.seq, 1);
  assert.equal(g.prev, null);
  assert.equal(g.sold, 0);
  assert.equal(g.packs, CENSUS.mint.packs);
  assert.equal(g.issued_per_pack, PAID);
  assert.equal("state" in g, false, "the draw commitment follows allocation, not issuance, and is not attested here");
  assert.deepEqual(g.remaining, PRINTED, "nothing sold: every printed copy remains, and only printed cards are counted");
  assert.equal((await api.get("/nutft/state")).supply.id, genesis.id, "/nutft/state carries the latest attestation");

  assert.equal(mint.supply.snapshot(), null, "nothing moved, nothing to sign");
  await claimPack(api);
  assert.equal((await api.get("/nutft/supply")).events.length, 1, "a sale alone publishes nothing; the timer does");
  const second = mint.supply.snapshot();
  assert.ok(second && verified(second));
  const s = content(second);
  assert.equal(s.seq, 2);
  assert.equal(s.prev, genesis.id);
  assert.equal(s.sold, 1);
  assert.deepEqual(second.tags, [["x", CENSUS.census_sha256], ["e", genesis.id, "", "prev"]]);
  assert.ok(second.created_at >= genesis.created_at);
  assert.equal(sum(PRINTED) - sum(s.remaining), PAID, "one pack: exactly the paid cards left the mint");
  assert.ok(Object.keys(PRINTED).every((id) => s.remaining[id] <= g.remaining[id]), "no count grew");
  assert.equal(mint.supply.snapshot(), null);
  assert.equal((await api.get("/nutft/state")).supply.id, second.id);

  await api.close();
  mint.stop();
  db.close();
  ({ db, mint, api } = await boot());
  const after = await api.get("/nutft/supply");
  assert.deepEqual(after.events.map((event) => event.id), [genesis.id, second.id], "the chain survives a restart unchanged");
  assert.equal(mint.supply.latest().id, second.id);
  assert.equal(mint.supply.snapshot(), null, "a restart with nothing sold adds nothing");
});

/* The interaction with committed purchases (docs/nutft-purchase-and-possession.md).
   A reservation moves the mint's own counts, and its release moves them back,
   so allocation is not monotone. Issuance is, and issuance is what is signed. */
test("a reservation is not an issue, and releasing one is not a loss", async (t) => {
  let now = Date.parse("2026-09-10T12:00:00Z");
  const mint = createNutftMint({
    catalogUri: CATALOG_URI, purchaseMode: true, clock: () => now, supplyIntervalSeconds: 0,
  });
  t.after(() => mint.stop());
  const api = await serve(mint);
  t.after(api.close);

  const genesis = mint.supply.latest();
  assert.equal(content(genesis).sold, 0);

  /* A purchase opens: allocation moves, issuance does not. */
  const quote = await mint.payableQuote({});
  const bought = await mint.purchase({ purchase_id: randomBytes(32).toString("hex"), pack_id: quote.pack_id, state: quote.state });
  assert.equal(bought.status, "purchased");
  assert.equal(mint.state.nextPack, 2, "the mint reserved the pack");
  assert.equal(sum(PRINTED) - sum(mint.state.counts), PAID, "and took its cards out of its own counts");
  assert.equal(mint.supply.snapshot(), null, "but nobody holds a card, so there is nothing new to attest");
  assert.equal(mint.supply.fault(), null, "and the books still balance");

  /* It expires: allocation moves back. Issuance still has not moved, and the
     ledger must not read that rollback as stock reappearing. */
  now += (3601 + 900) * 1000;
  await mint.payableQuote({});
  assert.equal(mint.state.nextPack, 1, "the pack went back on the shelf");
  assert.equal(mint.supply.snapshot(), null, "still nothing issued, still nothing to say");
  assert.equal(mint.supply.fault(), null, "a release is not a count that grew");

  /* Bought and claimed: now a card is in somebody's hands. */
  const keyset = (await api.get("/v1/keys")).keysets[0];
  const again = await mint.payableQuote({});
  const id = randomBytes(32).toString("hex");
  const purchased = await mint.purchase({ purchase_id: id, pack_id: again.pack_id, state: again.state });
  await mint.signBooster({
    idempotency_key: id, purchase_id: id, pack_id: again.pack_id, state: again.state,
    outputs: outputsFor(purchased.cards, keyset.id),
  });
  const issued = mint.supply.snapshot();
  assert.ok(issued && verified(issued), "the claim is what the ledger attests");
  assert.equal(content(issued).sold, 1);
  assert.equal(content(issued).prev, genesis.id);
  assert.equal(sum(PRINTED) - sum(content(issued).remaining), PAID);
  assert.equal(mint.supply.snapshot(), null);
});

test("a ledger whose books do not balance refuses to attest, and the mint still serves", async (t) => {
  const later = janitor(t);
  const dir = mkdtempSync(join(tmpdir(), "nutft-supply-fault-"));
  later(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "mint.db");

  let db = new DatabaseSync(path);
  let mint = createNutftMint({ db, lnd: null, catalogUri: CATALOG_URI, supplyIntervalSeconds: 0 });
  let api = await serve(mint);
  const genesisId = mint.supply.latest().id;
  await claimPack(api);
  const attested = mint.supply.snapshot();
  assert.equal(content(attested).sold, 1);
  await api.close();
  mint.stop();
  db.close();

  /* Roll the pack counter back by hand while the card counts keep their
     decrements: the shape of a partially restored backup. */
  db = new DatabaseSync(path);
  later(() => db.close());
  const stored = JSON.parse(db.prepare("SELECT value FROM nutft_meta WHERE key = 'state'").get().value);
  db.prepare("UPDATE nutft_meta SET value = ? WHERE key = 'state'").run(JSON.stringify({ ...stored, nextPack: 1 }));
  const logged = [];
  mint = createNutftMint({ db, lnd: null, catalogUri: CATALOG_URI, supplyIntervalSeconds: 0, supplyLog: (m) => logged.push(m) });
  later(() => mint.stop());
  api = await serve(mint);
  later(api.close);

  assert.equal(logged.length, 1, "the refusal is logged once at boot");
  assert.match(logged[0], /refuses to attest/);
  const chain = await api.get("/nutft/supply");
  assert.match(chain.fault, /packs sold went from 1 to 0/);
  assert.deepEqual(chain.events.map((event) => event.id), [genesisId, attested.id], "nothing false was added to the chain");
  assert.equal((await api.get("/nutft/state")).supply.id, attested.id, "the last true attestation stays on offer");
  assert.throws(() => mint.supply.snapshot(), /refuses to attest/);
  assert.equal(mint.supply.fault(), chain.fault);
  assert.equal((await api.get("/nutft/quote")).cards.length, CENSUS.mint.cards_per_pack, "the shop still answers");
});

/* A ledger over two cards, driven by hand. */
function ledgerFor(figures, extra = {}) {
  return createSupplyLedger({
    privateKey: Buffer.from(schnorr.utils.randomPrivateKey()),
    canonical,
    collectionId: "600B-T",
    catalogUri: "http://127.0.0.1/nutft/catalog",
    censusSha256: "ab".repeat(32),
    packs: 3,
    issuedPerPack: 2,
    copies: { A: 4, B: 2 },
    read: () => figures.current,
    log: () => {},
    ...extra,
  });
}

test("the ledger signs only books that balance and never moves backwards", () => {
  const figures = { current: { remaining: { A: 4, B: 2 }, sold: 0 } };
  const ledger = ledgerFor(figures);
  const one = ledger.snapshot();
  assert.equal(content(one).seq, 1);
  assert.equal(ledger.snapshot(), null);

  figures.current = { remaining: { A: 3, B: 1 }, sold: 1 };
  const two = ledger.snapshot();
  assert.equal(content(two).prev, one.id);

  const refused = (next, pattern) => {
    const head = ledger.latest().id;
    figures.current = next;
    assert.throws(() => ledger.snapshot(), pattern);
    assert.match(ledger.fault(), pattern);
    assert.equal(ledger.latest().id, head, "nothing was signed");
  };
  refused({ remaining: { A: 3, B: 2 }, sold: 1 }, /remaining\[B\] grew from 1 to 2/);
  refused({ remaining: { A: 3, B: 1 }, sold: 0 }, /packs sold went from 1 to 0/);
  /* Moves forward in every direction the comparison checks, and still does
     not add up: three cards gone, two packs sold, two cards to a pack. */
  refused({ remaining: { A: 2, B: 1 }, sold: 2 }, /3 cards left the mint but 2 packs x 2 is 4/);
  refused({ remaining: { A: 0, B: -1 }, sold: 3 }, /remaining\[B\] is -1, outside 0\.\.2/);

  figures.current = { remaining: { A: 1, B: 1 }, sold: 2 };
  const three = ledger.snapshot();
  assert.equal(ledger.fault(), null, "a good snapshot clears the fault");
  assert.equal(content(three).seq, 3);
  figures.current = { remaining: { A: 0, B: 0 }, sold: 3 };
  assert.equal(content(ledger.snapshot()).seq, 4);
  refused({ remaining: { A: 0, B: 0 }, sold: 4 }, /sold is 4, outside 0\.\.3/);
  assert.equal(ledger.events().length, 4);
  assert.ok(ledger.events().every(verified));
  assert.equal(ledger.chain().issuer, ledger.issuer);
});

test("the ledger refuses a backwards clock and a foreign key size", () => {
  let clock = 1_000;
  const figures = { current: { remaining: { A: 4, B: 2 }, sold: 0 } };
  const ledger = ledgerFor(figures, { now: () => clock });
  const one = ledger.snapshot();
  clock = 900;
  figures.current = { remaining: { A: 3, B: 1 }, sold: 1 };
  const two = ledger.snapshot();
  assert.equal(two.created_at, one.created_at, "a clock that stepped back does not date the chain backwards");
  assert.throws(() => ledgerFor(figures, { privateKey: Buffer.alloc(31) }), /32-byte/);
  assert.throws(() => ledgerFor(figures, { intervalSeconds: 30 }), /at least 60/);
  assert.throws(() => ledgerFor(figures, { relays: "http://relay.example" }), /ws:\/\/ or wss:\/\//);
  assert.equal(ledgerFor(figures).intervalSeconds, 86_400, "one snapshot a day unless told otherwise");
  assert.deepEqual(ledgerFor(figures, { relays: " wss://a.example, ws://b.example " }).relays, ["wss://a.example", "ws://b.example"]);
});

/* A relay that answers every EVENT with the verdict it is built with. */
async function relayThat(accepts, t) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const seen = [];
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const [type, event] = JSON.parse(String(data));
      if (type !== "EVENT") return;
      seen.push(event.id);
      socket.send(JSON.stringify(["OK", event.id, accepts, accepts ? "" : "blocked: not on the allowlist"]));
    });
  });
  t.after(() => server.close());
  return { url: `ws://127.0.0.1:${server.address().port}`, seen };
}

test("publishing offers every pending snapshot once and marks what a relay took", async (t) => {
  const good = await relayThat(true, t);
  const refusing = await relayThat(false, t);
  const figures = { current: { remaining: { A: 4, B: 2 }, sold: 0 } };
  const ledger = ledgerFor(figures, { relays: [refusing.url, good.url], publishTimeoutMs: 2_000 });
  const one = ledger.snapshot();
  figures.current = { remaining: { A: 3, B: 1 }, sold: 1 };
  const two = ledger.snapshot();

  assert.deepEqual(await ledger.publish(), { pending: 0, published: 2 });
  assert.deepEqual(good.seen, [one.id, two.id], "both snapshots reached the relay that takes them");
  assert.deepEqual(refusing.seen, [one.id, two.id], "the refusing relay was offered them too");
  assert.deepEqual(await ledger.publish(), { pending: 0, published: 0 });
  assert.equal(good.seen.length, 2, "nothing is offered twice once a relay has taken it");

  const stubborn = ledgerFor({ current: { remaining: { A: 4, B: 2 }, sold: 0 } }, { relays: refusing.url, publishTimeoutMs: 2_000 });
  stubborn.snapshot();
  assert.deepEqual(await stubborn.publish(), { pending: 1, published: 0 }, "a refused snapshot stays pending");

  const unreachable = ledgerFor({ current: { remaining: { A: 4, B: 2 }, sold: 0 } }, { relays: "ws://127.0.0.1:1", publishTimeoutMs: 1_500 });
  unreachable.snapshot();
  assert.deepEqual(await unreachable.publish(), { pending: 1, published: 0 }, "a dead relay is a pending snapshot, not a crash");
  assert.deepEqual(await ledgerFor(figures).publish(), { pending: 0, published: 0 }, "no relays, nothing to do");
});

/* A chain longer than one response, and the walk back through it. */
function longLedger(count) {
  const figures = { current: { remaining: { A: 300 }, sold: 0 } };
  const ledger = createSupplyLedger({
    privateKey: Buffer.from(schnorr.utils.randomPrivateKey()),
    canonical,
    collectionId: "600B-T",
    catalogUri: "http://127.0.0.1/nutft/catalog",
    censusSha256: "ab".repeat(32),
    packs: 300,
    issuedPerPack: 1,
    copies: { A: 300 },
    read: () => figures.current,
    log: () => {},
    intervalSeconds: 0,
  });
  for (let sold = 0; sold < count; sold += 1) {
    figures.current = { remaining: { A: 300 - sold }, sold };
    assert.ok(ledger.snapshot(), `snapshot ${sold + 1} was signed`);
  }
  return ledger;
}

test("the chain is served a bounded page at a time, newest first by default", () => {
  const count = SUPPLY_PAGE * 2 + 37;
  const ledger = longLedger(count);
  const seqs = (page) => page.events.map((event) => JSON.parse(event.content).seq);

  const tail = ledger.chain();
  assert.equal(tail.total, count, "the response says how long the whole chain is");
  assert.equal(tail.page_size, SUPPLY_PAGE);
  assert.equal(tail.events.length, SUPPLY_PAGE, "and never carries more than a page");
  assert.equal(tail.first_seq, count - SUPPLY_PAGE + 1);
  assert.equal(tail.last_seq, count);
  assert.deepEqual(seqs(tail), Array.from({ length: SUPPLY_PAGE }, (_, i) => count - SUPPLY_PAGE + 1 + i),
    "no argument means the newest page, which is what a client with no history wants");

  const first = ledger.chain(1);
  assert.equal(first.first_seq, 1);
  assert.equal(first.last_seq, SUPPLY_PAGE);
  assert.equal(JSON.parse(first.events[0].content).prev, null, "the chain still starts where it started");

  /* Walking from the beginning reaches the head, and every page joins the
     one before it: that is what a returning client does from its witness. */
  const walked = [];
  let from = 1;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = ledger.chain(from);
    if (walked.length) {
      assert.equal(JSON.parse(page.events[0].content).prev, walked[walked.length - 1].id,
        "each page names the last event of the page before it");
    }
    walked.push(...page.events);
    if (page.last_seq >= page.total) break;
    from = page.last_seq + 1;
  }
  assert.equal(walked.length, count, "the walk covers the whole chain");
  assert.deepEqual(walked.map((event) => JSON.parse(event.content).seq), Array.from({ length: count }, (_, i) => i + 1));
  assert.ok(walked.every(verified), "and every snapshot along it is signed");

  const short = ledger.chain(count - 5);
  assert.equal(short.events.length, 6, "a page near the head is as short as what is left");
  assert.equal(short.last_seq, count);

  const beyond = ledger.chain(count + 1);
  assert.deepEqual(beyond.events, [], "past the head there is nothing yet, which is an answer and not an error");
  assert.equal(beyond.total, count, "and the length of the chain is still told truthfully");
  assert.equal(beyond.first_seq, 0);

  assert.deepEqual(ledger.chain(0).events, ledger.chain().events, "a nonsensical start falls back to the newest page");
});

test("the route pages, and refuses a sequence number it cannot read", async (t) => {
  const mint = createNutftMint({ lnd: null, catalogUri: CATALOG_URI, supplyIntervalSeconds: 0 });
  t.after(() => mint.stop());
  const api = await serve(mint);
  t.after(api.close);

  const whole = await api.get("/nutft/supply");
  assert.equal(whole.total, 1);
  assert.equal(whole.first_seq, 1);
  assert.equal(whole.last_seq, 1);
  assert.equal(whole.page_size, SUPPLY_PAGE);
  assert.equal(whole.events.length, 1);
  assert.deepEqual(await api.get("/nutft/supply?from=1"), whole, "asking for the only page gives the only page");

  const empty = await api.get("/nutft/supply?from=2");
  assert.deepEqual(empty.events, []);
  assert.equal(empty.total, 1);

  for (const bad of ["0", "-1", "abc", "1.5", ""]) {
    const answer = await api.get(`/nutft/supply?from=${bad}`);
    assert.match(answer.error, /positive snapshot sequence number/, `from=${bad} is refused`);
  }
});
