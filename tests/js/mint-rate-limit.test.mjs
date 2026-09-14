/* The mint's per-client HTTP budgets: what they count, whom they count, what a
   refused client is told, and that the limiter's memory stays bounded. The
   referee's rate clock is injected, so a minute passes without waiting one. */

import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { createRateLimiter } = require("../../server/rate-limit.js");
const { createMockFunding } = require("../../server/funding.js");

const CATALOG_URI = "http://127.0.0.1/nutft/catalog";

async function boot(t, extra) {
  let now = 1_000_000;
  const table = await createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI,
    rateClock: () => now, ...extra,
  });
  t.after(() => table.close());
  table.wait = (ms) => { now += ms; };
  return table;
}

/** A raw request, so any header can be sent and every header read back. */
function call(table, method, path, { headers = {}, body } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const length = payload ? Buffer.byteLength(payload) : 0;
  const sent = payload
    ? { "content-type": "application/json", "content-length": length, ...headers }
    : headers;
  const target = { hostname: "127.0.0.1", port: table.port, method, path, headers: sent };
  return new Promise((resolve, reject) => {
    const req = request(target, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* a blob */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

const post = (table, path, body, headers) => call(table, "POST", path, { headers, body });
const write = (table, headers) => post(table, "/v1/checkstate", { Ys: [] }, headers);

test("the 21st mint write in a minute is refused with the wait and the route's own headers",
  async (t) => {
    const table = await boot(t, { allowedOrigins: ["https://600.wtf"] });
    const origin = { origin: "https://600.wtf" };
    const writes = [
      () => post(table, "/v1/checkstate", { Ys: [] }, origin),
      () => post(table, "/v1/restore", { outputs: [] }, origin),
      () => post(table, "/nutft/trade", {}, origin),
      () => post(table, "/nutft/booster", {}, origin),
    ];
    const answers = [];
    for (let i = 0; i < 20; i++) answers.push(await writes[i % writes.length]());
    assert.deepEqual(answers.map((answer) => answer.status === 429), Array(20).fill(false),
      "twenty writes fit");

    const refused = await post(table, "/nutft/purchase", {}, origin);
    assert.equal(refused.status, 429, "every POST route draws on the same write budget");
    assert.deepEqual(refused.json, { error: "rate limited", retry_after: 3 });
    assert.equal(refused.headers["retry-after"], "3", "20 a minute earns one write back every 3 s");
    assert.equal(refused.headers["cache-control"], "no-store");
    assert.match(refused.headers["content-type"], /^application\/json/);
    for (const name of ["access-control-allow-origin", "access-control-allow-methods", "vary"]) {
      assert.equal(refused.headers[name], answers[0].headers[name],
        `${name} is what the route itself sends`);
    }
  });

test("the 61st drawing GET in a minute is refused; quote, reveal, eligibility and invoice share it",
  async (t) => {
    const table = await boot(t);
    const drawing = [
      "/nutft/quote", "/nutft/reveal?payment_hash=00", "/nutft/eligibility",
      "/nutft/lnurlp/callback?amount=1",
    ];
    const statuses = [];
    for (let i = 0; i < 60; i++) {
      statuses.push((await call(table, "GET", drawing[i % drawing.length])).status);
    }
    assert.equal(statuses.includes(429), false, "sixty fit");

    const refused = await call(table, "GET", "/nutft/eligibility");
    assert.equal(refused.status, 429);
    assert.equal(refused.json.retry_after, 1, "60 a minute earns one back every second");
    assert.equal((await write(table)).status, 200, "writes are a budget of their own");
  });

test("behind a trusted proxy the budget is the forwarded client's, not the proxy's", async (t) => {
  const table = await boot(t, { trustProxy: "loopback" });
  const alice = { "x-forwarded-for": "198.51.100.1" };
  for (let i = 0; i < 20; i++) assert.equal((await write(table, alice)).status, 200);
  assert.equal((await write(table, alice)).status, 429, "alice spent hers");
  assert.equal((await write(table, { "x-forwarded-for": "198.51.100.2" })).status, 200,
    "bob, arriving through the same proxy, is unaffected");
  const prepended = { "x-forwarded-for": "198.51.100.2, 198.51.100.1" };
  assert.equal((await write(table, prepended)).status, 429,
    "the rightmost hop is the client, so a prepended address buys alice nothing");
});

test("with no trusted proxy a forged X-Forwarded-For buys no fresh budget", async (t) => {
  const table = await boot(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await write(table, { "x-forwarded-for": `203.0.113.${i}` })).status, 200);
  }
  assert.equal((await write(table, { "x-forwarded-for": "203.0.113.99" })).status, 429);
});

test("reading the mint is never limited, even by a client with no budget left", async (t) => {
  // Strings, as the environment delivers them.
  const table = await boot(t, { mintWriteRateMax: "1", mintQuoteRateMax: "1" });
  assert.equal((await write(table)).status, 200);
  assert.equal((await write(table)).status, 429);
  assert.equal((await call(table, "GET", "/nutft/eligibility")).status, 200);
  assert.equal((await call(table, "GET", "/nutft/eligibility")).status, 429);

  const sha = (await call(table, "GET", "/v1/info")).json.nuts[31].catalog_blob_sha256;
  const reads = [
    "/v1/info", "/v1/keys", "/nutft/catalog", `/blossom/${sha}`, "/nutft/state", "/nutft/supply",
    "/nutft/lnurlp",
  ];
  for (let round = 0; round < 3; round++) {
    for (const path of reads) {
      assert.equal((await call(table, "GET", path)).status, 200, `GET ${path}`);
    }
  }
  assert.equal((await call(table, "HEAD", "/nutft/catalog")).status, 200);
});

test("a spent budget comes back: one write after retry_after, all twenty after a minute",
  async (t) => {
    const table = await boot(t);
    for (let i = 0; i < 20; i++) await write(table);
    const refused = await write(table);
    assert.equal(refused.status, 429);

    table.wait(refused.json.retry_after * 1000);
    assert.equal((await write(table)).status, 200, "retry_after is honest");
    assert.equal((await write(table)).status, 429, "and it earned exactly one");

    table.wait(60_000);
    for (let i = 0; i < 20; i++) {
      assert.equal((await write(table)).status, 200, `write ${i + 1} after a quiet minute`);
    }
    assert.equal((await write(table)).status, 429);
  });

test("the E1 and G mints share one policy and one budget per client", async (t) => {
  const table = await boot(t, {
    gNutftEnabled: true,
    gNutftDbPath: ":memory:",
    gNutftCatalogUri: "http://127.0.0.1/g/nutft/catalog",
    gNutftFunding: createMockFunding({ settleAfterMs: 0 }),
    gNutftAllowVirtual: "1",
    gNutftSales: "open",
    gNutftOnePerKey: false,
  });
  for (let i = 0; i < 10; i++) {
    assert.equal((await post(table, "/v1/checkstate", { Ys: [] })).status, 200);
    assert.equal((await post(table, "/g/v1/checkstate", { Ys: [] })).status, 200);
  }
  assert.equal((await post(table, "/g/v1/checkstate", { Ys: [] })).status, 429);
  assert.equal((await post(table, "/v1/checkstate", { Ys: [] })).status, 429);
  assert.equal((await call(table, "GET", "/g/nutft/state")).status, 200, "a G read is still free");
});

test("a refused client is logged once a minute, by limit and address and nothing it sent",
  async (t) => {
    const lines = [];
    t.mock.method(console, "warn", (...args) => { lines.push(args.join(" ")); });
    const logged = () => lines.filter((line) => line.includes("rate limited"));
    const table = await boot(t, { trustProxy: "loopback" });
    const alice = { "x-forwarded-for": "198.51.100.1", authorization: "Nostr dG9rZW4tc2VjcmV0" };

    for (let i = 0; i < 25; i++) {
      await post(table, "/nutft/purchase", { purchase_id: "body-secret" }, alice);
    }
    for (let i = 0; i < 65; i++) {
      await call(table, "GET", "/nutft/reveal?payment_hash=query-secret", { headers: alice });
    }
    assert.deepEqual(logged(), ["[table] rate limited: mint-write for 198.51.100.1 (20 per 60s)"],
      "71 refusals across two limits make one line, with no path, query, body or token in it");

    for (let i = 0; i < 21; i++) await write(table, { "x-forwarded-for": "198.51.100.2" });
    assert.deepEqual(logged().slice(1), [
      "[table] rate limited: mint-write for 198.51.100.2 (20 per 60s)",
    ], "another client gets its own line");

    table.wait(60_000);
    for (let i = 0; i < 21; i++) await write(table, alice);
    assert.equal(logged().length, 3, "a minute later alice can be logged again");
  });

test("a mint budget that is not a positive integer stops the referee at boot", async () => {
  for (const bad of ["0", "-5", "ten", "2.5"]) {
    await assert.rejects(
      createTable({
        port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI,
        mintQuoteRateMax: bad,
      }),
      /MINT_QUOTE_RATE_MAX must be a positive integer/,
      `MINT_QUOTE_RATE_MAX=${bad}`,
    );
  }
});

test("the limiter keeps at most maxKeys buckets and drops the least recently used", () => {
  const limits = { w: { max: 2, windowMs: 1000 } };
  const limiter = createRateLimiter({ limits, clock: () => 0, maxKeys: 2 });
  limiter.take("w", "a");
  limiter.take("w", "b");
  limiter.take("w", "a"); // a is spent and is now the most recently used
  limiter.take("w", "c"); // over the cap: b goes
  assert.equal(limiter.size, 2);
  assert.equal(limiter.take("w", "a").ok, false, "a was kept, spent");
  assert.equal(limiter.take("w", "b").ok, true);
  assert.equal(limiter.take("w", "b").ok, true, "b was dropped, so it returned with a full bucket");
  assert.equal(limiter.size, 2);
});

test("the limiter forgets a bucket once it has refilled, and not before", () => {
  let now = 0;
  const limits = { w: { max: 2, windowMs: 1000 } };
  const limiter = createRateLimiter({ limits, clock: () => now });
  limiter.take("w", "a");
  limiter.take("w", "b");
  limiter.take("w", "b");
  now = 500;
  limiter.prune();
  assert.equal(limiter.size, 1, "a earned its token back and is gone; b is still owed one");
  now = 1000;
  limiter.prune();
  assert.equal(limiter.size, 0);
});
