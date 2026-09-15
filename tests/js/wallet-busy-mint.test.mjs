/* A busy mint is not a refusing mint. A 429 from the referee's rate limit, a
   503 or a dropped connection must never cost the wallet a pending claim, a
   transfer or a recovery; only a real verdict from the mint may end one.

   The referee's rate clock moves only when the wallet waits: the wallet's own
   setTimeout advances it by the delay the wallet chose and returns at once. So
   the real limiter lets a retry in only if the wallet honoured retry-after, and
   a minute of backing off costs these tests nothing. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { browserWallet } from "./helpers/browser-wallet.mjs";
import * as fixture from "./helpers/wallet-fixture.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const CENSUS = require("../../cards/nutft-census.json");
const PACK = CENSUS.mint.cards_per_pack;
const cashu = await import("@cashu/cashu-ts");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const STORE = "600b:nutft-wallet";

async function boot(t, extra) {
  let now = 1_000_000;
  const table = await createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI,
    rateClock: () => now, ...extra,
  });
  t.after(() => table.close());
  const waits = [];
  const setTimeout = (done, ms) => {
    waits.push(ms);
    now += ms;
    return setImmediate(done);
  };
  return { table, waits, setTimeout, pass: (ms) => { now += ms; } };
}

/* The wallet's fetch: records every answer, and lets a test answer instead of
   the mint (or throw, as a dropped connection does). */
function mintFetch(table, seen, intercept) {
  return async (url, options) => {
    const target = String(url) === CATALOG_URI ? `${table.url}/nutft/catalog` : String(url);
    const method = (options && options.method) || "GET";
    const path = new URL(target).pathname;
    const response = (intercept && intercept({ method, path })) || await fetch(target, options);
    const retryAfter = response.headers.get("retry-after");
    seen.push({ method, path, status: response.status, retryAfter });
    return response;
  };
}

const pendingIn = (storage) => JSON.parse(storage.get(STORE)).pending;
const spendWrites = async (table, count) => {
  for (let i = 0; i < count; i++) {
    const answer = await fetch(`${table.url}/nutft/trade`, { method: "POST", body: "{}" });
    assert.equal(answer.status, 400);
  }
};

test("a 429 during a booster claim keeps the pending record, and a later poll completes it",
  async (t) => {
    const clock = await boot(t, { mintWriteRateMax: 1 });
    await spendWrites(clock.table, 1);
    const storage = new Map();
    const seen = [];
    const pendingWhileWaiting = [];
    const wallet = await browserWallet(storage, mintFetch(clock.table, seen), {
      cashu,
      globals: {
        setTimeout: (done, ms) => {
          pendingWhileWaiting.push(pendingIn(storage));
          return clock.setTimeout(done, ms);
        },
      },
    });

    const issued = await wallet.buyBooster(clock.table.url);

    assert.equal(issued.cards.length, PACK, "the claim completed");
    const claims = seen.filter((entry) => entry.path === "/nutft/booster")
      .map((entry) => entry.status);
    assert.equal(claims[0], 429, "the first claim met a spent budget");
    assert.equal(claims.at(-1), 200, "and a later poll was let through");
    assert.ok(pendingWhileWaiting.length > 0);
    assert.ok(pendingWhileWaiting.every((pending) => pending && pending.type === "booster"),
      "the pending booster survived every refusal");
    assert.equal(pendingIn(storage), null, "only the claim that succeeded cleared it");
    assert.ok(clock.waits.every((ms) => ms <= 30_000), "no single wait is longer than 30 s");
  });

test("a 429 in the middle of a phrase recovery waits, resumes and recovers every card",
  async (t) => {
    const clock = await boot(t, { mintRecoveryRateMax: 10 });
    const buyer = await browserWallet(new Map(), mintFetch(clock.table, []), { cashu });
    await buyer.buyBooster(clock.table.url);
    const phrase = await buyer.recoveryPhrase();

    const storage = new Map();
    const seen = [];
    const progress = [];
    const wallet = await browserWallet(storage, mintFetch(clock.table, seen), {
      cashu, globals: { setTimeout: clock.setTimeout },
    });
    const count = await wallet.restoreSeed(clock.table.url, phrase, {
      onWaiting: (step) => progress.push(step),
    });

    assert.equal(count, PACK, "every card came back, so no batch was skipped");
    const refused = seen.filter((entry) => entry.status === 429);
    assert.ok(refused.length > 0, "the recovery budget ran out part-way");
    assert.equal(progress.length, refused.length, "every wait was reported on the status path");
    progress.forEach((step, index) => {
      assert.ok(step.waitMs >= Number(refused[index].retryAfter) * 1000,
        `wait ${index + 1} honoured retry-after`);
      assert.ok(step.waitMs <= 30_000, `wait ${index + 1} is capped at 30 s`);
    });
    /* Counted from storage: asking the mint would spend this test's tiny budget. */
    const keysetId = (await (await fetch(`${clock.table.url}/v1/keys`)).json()).keysets[0].id;
    const held = JSON.parse(storage.get(STORE)).tokens
      .flatMap((token) => cashu.getDecodedToken(token, [keysetId]).proofs);
    assert.equal(held.length, PACK, "and the wallet holds every one of them");
  });

test("a transfer refused with a 429 stays pending and completes when it is resumed", async (t) => {
  const clock = await boot(t, { mintWriteRateMax: 2 });
  const storage = new Map();
  const wallet = await browserWallet(storage, mintFetch(clock.table, []), { cashu });
  await wallet.buyBooster(clock.table.url);
  const recipient = await browserWallet(new Map(), mintFetch(clock.table, []), { cashu });
  const destination = await recipient.destination();
  const [card] = (await wallet.snapshot(clock.table.url)).owned;
  await spendWrites(clock.table, 1);

  await assert.rejects(wallet.tradeProof(clock.table.url, card.proof.secret, destination),
    /the mint is busy \(429\)/);
  const pending = pendingIn(storage);
  assert.equal(pending && pending.type, "trade", "the transfer is still pending");

  clock.pass(60_000);
  const result = await wallet.recoverPending();
  assert.match(result.token, /^cashuB/, "the same request, sent again, delivered the card");
  assert.equal(pendingIn(storage), null);
});

test("a 503 and a dropped connection are waited out like a 429", async (t) => {
  const clock = await boot(t);
  const storage = new Map();
  let failures = 0;
  const flaky = ({ method, path }) => {
    if (method !== "POST" || path !== "/nutft/booster" || failures === 2) return null;
    failures += 1;
    if (failures === 1) throw new TypeError("fetch failed");
    return new Response("", { status: 503 });
  };
  const wallet = await browserWallet(storage, mintFetch(clock.table, [], flaky), {
    cashu, globals: { setTimeout: clock.setTimeout },
  });

  const issued = await wallet.buyBooster(clock.table.url);

  assert.equal(failures, 2);
  assert.equal(issued.cards.length, PACK);
  assert.equal(pendingIn(storage), null);
});

/* The mint carries the request out, and then a gateway answers in JSON anyway. */
const committedThen = (path, status, error) => {
  let answered = false;
  return async (request, send) => {
    if (answered || request.method !== "POST" || request.path !== path) return null;
    answered = true;
    await send();
    return Response.json({ error }, { status });
  };
};

test("a transfer the mint committed behind a 504 with a JSON error is finished by the replay",
  async (t) => {
    const mint = await fixture.bootMint(t);
    const alice = await fixture.openWallet(mint, {
      intercept: committedThen("/nutft/trade", 504, "upstream timed out"),
    });
    await alice.wallet.buyBooster(mint.url);
    const [card] = (await alice.wallet.snapshotReadOnly(mint.url)).owned;
    const bob = await fixture.openWallet(mint);

    await assert.rejects(alice.wallet.tradeProof(mint.url, card.proof.secret, await bob.wallet.destination()),
      /could not answer \(504\)/);
    assert.equal(alice.saved().pending.type, "trade", "a JSON body on a 5xx is not the mint's verdict");

    const finished = await alice.wallet.recoverPending();
    const [first, again] = alice.posted("/nutft/trade");
    assert.equal(again.body.idempotency_key, first.body.idempotency_key, "the same request, replayed");
    assert.equal(await bob.wallet.importToken(mint.url, finished.token), 1, "and the card reached bob");
  });

test("a booster claim answered 500 with a JSON error after issuance is polled into the replay",
  async (t) => {
    const mint = await fixture.bootMint(t);
    const buyer = await fixture.openWallet(mint, {
      intercept: committedThen("/nutft/booster", 500, "internal server error"),
    });

    const issued = await buyer.wallet.buyBooster(mint.url);

    assert.equal(issued.cards.length, PACK);
    assert.equal(buyer.posted("/nutft/booster").length, 2, "polled once more, and replayed");
    const state = await (await fetch(`${mint.url}/nutft/state`)).json();
    assert.equal(state.sold, 1, "one pack, not two");
  });

test("a real refusal from the mint still ends a booster claim", async (t) => {
  const clock = await boot(t);
  const storage = new Map();
  const refuse = ({ method, path }) => (method === "POST" && path === "/nutft/booster"
    ? Response.json({ error: "outputs do not match the quoted pack" }, { status: 400 })
    : null);
  const wallet = await browserWallet(storage, mintFetch(clock.table, [], refuse), {
    cashu, globals: { setTimeout: clock.setTimeout },
  });

  await assert.rejects(wallet.buyBooster(clock.table.url), /outputs do not match the quoted pack/);
  assert.equal(pendingIn(storage), null, "a verdict discards the pending exactly as before");
});
