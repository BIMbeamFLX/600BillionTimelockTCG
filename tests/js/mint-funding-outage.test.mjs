/* A paid claim must survive the mint's own outages. When the funding backend or
   the chain source does not answer, the mint says 503 with Retry-After -- never a
   4xx, which the wallet reads as a verdict -- and the wallet keeps the claim and
   its payment hash until the mint gives a definitive answer.
   (Ported from the nappelin-com-3e review of PR #73, scenario d3.) */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { browserWallet } from "./helpers/browser-wallet.mjs";
import { STORE, cashu } from "./helpers/wallet-fixture.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { createNutftMint } = require("../../server/nutft-mint.js");
const { createMockFunding } = require("../../server/funding.js");

const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const G_CATALOG = "http://127.0.0.1/g/nutft/catalog";
const G_SET = 82;

/* A referee with a paid G mint whose funding backend can be made to refuse the
   next isSettled call, as lnd does when its REST port is unreachable. */
async function paidTable(t) {
  const funding = createMockFunding({ settleAfterMs: 0 });
  const settled = funding.isSettled.bind(funding);
  let outages = 0;
  funding.isSettled = async (...args) => {
    if (outages > 0) {
      outages -= 1;
      throw new Error("connect ECONNREFUSED 10.0.0.5:9740");
    }
    return settled(...args);
  };
  const table = await createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI,
    gNutftEnabled: true, gNutftDbPath: ":memory:", gNutftCollectionId: "600B-G",
    gNutftCensusPath: require.resolve("../../cards/g-census.json"),
    gNutftCatalogUri: G_CATALOG, gNutftFunding: funding,
    gNutftAllowVirtual: "1", gNutftSales: "open", gNutftOnePerKey: false, gNutftPriceMsat: 210_000,
  });
  t.after(() => table.close());
  return { table, G: `${table.url}/g`, failNextSettlementCheck: () => { outages += 1; } };
}

/* A browser wallet on that referee. `answer(request)` may reply instead of the
   mint; every reply to a claim is recorded. */
async function walletOn(paid, { storage = new Map(), answer } = {}) {
  const claims = [];
  const waits = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url) === G_CATALOG ? `${paid.table.url}/g/nutft/catalog` : String(url);
    const request = { method: options.method || "GET", path: new URL(target).pathname };
    const response = (answer && answer(request)) || await fetch(target, options);
    if (request.path === "/g/nutft/booster") {
      claims.push({ status: response.status, retryAfter: response.headers.get("retry-after") });
    }
    return response;
  };
  const wallet = await browserWallet(storage, fetchImpl, {
    cashu,
    globals: {
      setTimeout: (done, ms) => {
        waits.push({ ms, pending: JSON.parse(storage.get(STORE)).pending });
        return setImmediate(done);
      },
    },
  });
  return { wallet, storage, claims, waits, saved: () => JSON.parse(storage.get(STORE)) };
}

test("a funding backend that fails once answers 503, and the paid claim is still collected",
  async (t) => {
    const paid = await paidTable(t);
    const buyer = await walletOn(paid);
    let invoice = null;

    paid.failNextSettlementCheck();
    const issued = await buyer.wallet.buyBooster(paid.G, { onInvoice: (details) => { invoice = details; } });

    assert.equal(issued.cards.length, G_SET, "the set was collected");
    assert.deepEqual(buyer.claims.map((claim) => claim.status), [503, 200],
      "the outage was a 503, and the next poll went through");
    assert.equal(buyer.claims[0].retryAfter, "5");
    assert.ok(buyer.waits.length > 0);
    for (const { pending } of buyer.waits) {
      assert.equal(pending && pending.body.payment_hash, invoice.paymentHash,
        "while it waited, the wallet still held the claim and its payment hash");
    }
    assert.equal(buyer.saved().pending, null);
  });

test("an older mint's 400 'cannot confirm payment right now' is waited out too", async (t) => {
  const paid = await paidTable(t);
  let answered = false;
  const buyer = await walletOn(paid, {
    answer: (request) => {
      if (answered || request.method !== "POST" || request.path !== "/g/nutft/booster") return null;
      answered = true;
      return Response.json({
        error: "the mint cannot confirm payment right now — your invoice is unaffected, try again shortly",
      }, { status: 400 });
    },
  });

  const issued = await buyer.wallet.buyBooster(paid.G);

  assert.equal(issued.cards.length, G_SET);
  assert.deepEqual(buyer.claims.map((claim) => claim.status), [400, 200]);
});

test("a paid claim outlives a refusal the wallet does not recognise, and ends on a definitive one",
  async (t) => {
    const paid = await paidTable(t);
    let reply = "the mint says something new";
    const buyer = await walletOn(paid, {
      answer: (request) => (reply && request.method === "POST" && request.path === "/g/nutft/booster"
        ? Response.json({ error: reply }, { status: 400 })
        : null),
    });

    await assert.rejects(buyer.wallet.buyBooster(paid.G), /something new/);
    const kept = buyer.saved().pending;
    assert.ok(kept && kept.body.payment_hash, "an unrecognised answer keeps the claim and its payment hash");

    reply = "this invoice has already been claimed";
    await assert.rejects(buyer.wallet.recoverPending(), /already been claimed/);
    assert.equal(buyer.saved().pending, null, "a definitive verdict ends it");

    /* Free of the claim, the next purchase starts over at the quote. (The mint
       still holds this test's paid, uncollected pack, and says so.) */
    reply = null;
    await assert.rejects(buyer.wallet.buyBooster(paid.G), /paid for and is being collected/);
  });

test("a chain source that does not answer makes the quote, the reveal and the claim 503", async (t) => {
  let height = 900_000;
  let chainDown = true;
  const db = new DatabaseSync(":memory:");
  const mint = createNutftMint({
    db, catalogUri: CATALOG_URI, funding: createMockFunding({ settleAfterMs: 0 }), allowVirtual: "1",
    priceMsat: 21_000, sales: "open", beaconSource: "lnd", beaconConfirmations: 1,
    beaconGetInfo: async () => {
      if (chainDown) throw new Error("connect ECONNREFUSED 10.0.0.9:8080");
      return { height, hash: String(height).padStart(64, "b") };
    },
  });
  const server = http.createServer((req, res) => mint.handle(req, res, new URL(req.url, "http://127.0.0.1")));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    mint.stop();
    server.closeAllConnections();
    server.close(() => { db.close(); resolve(); });
  }));
  const url = `http://127.0.0.1:${server.address().port}`;

  // The quote commits to a height, so it cannot be issued while the chain is down.
  const refusedQuote = await fetch(`${url}/nutft/quote`);

  chainDown = false;
  const quote = await (await fetch(`${url}/nutft/quote`)).json();
  assert.equal(quote.sealed, true);
  height += 1;
  chainDown = true;

  const answers = {
    quote: refusedQuote,
    reveal: await fetch(`${url}/nutft/reveal?payment_hash=${quote.payment_hash}`),
    claim: await fetch(`${url}/nutft/booster`, {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: "claim-1", pack_id: quote.pack_id, state: quote.state,
        payment_hash: quote.payment_hash, outputs: [],
      }),
    }),
  };
  for (const [name, response] of Object.entries(answers)) {
    assert.equal(response.status, 503, `${name}: the chain being down is not the buyer's error`);
    assert.equal(response.headers.get("retry-after"), "5", name);
    assert.match((await response.json()).error, /cannot read the chain right now/, name);
  }
});
