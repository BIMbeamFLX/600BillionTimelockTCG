/* The referee's side of the wallet's contract: a 4xx means the mint refused and
   nothing happened, so the wallet may drop what it holds. A failure that is not
   a verdict -- the database refusing a write -- must commit nothing and answer
   5xx, so the wallet sends the same request again. And the rate limit answers
   before the mint runs, never after it has acted. */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { browserWallet } from "./helpers/browser-wallet.mjs";
import { PACK, STORE, bootMint, cashu, openWallet } from "./helpers/wallet-fixture.mjs";

const require = createRequire(import.meta.url);
const { createNutftMint } = require("../../server/nutft-mint.js");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";

/* A real SQLite database whose next INSERT into a named table fails with a real
   SQLite error, inside whatever transaction the mint has open at the time. */
function databaseWithFaults() {
  const db = new DatabaseSync(":memory:");
  const prepare = db.prepare.bind(db);
  const armed = new Set();
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const table = /^\s*INSERT INTO (\w+)/i.exec(sql)?.[1];
    if (!table) return statement;
    return new Proxy(statement, {
      get: (target, name) => (name === "run"
        ? (...args) => {
          if (armed.delete(table)) db.exec("INSERT INTO a_table_that_does_not_exist VALUES (1)");
          return target.run(...args);
        }
        : (typeof target[name] === "function" ? target[name].bind(target) : target[name])),
    });
  };
  return { db, failNextInsertInto: (table) => armed.add(table) };
}

async function serveMint(t) {
  const { db, failNextInsertInto } = databaseWithFaults();
  const mint = createNutftMint({ db, catalogUri: CATALOG_URI });
  const answers = [];
  const server = http.createServer(async (req, res) => {
    const end = res.end.bind(res);
    res.end = (...args) => { answers.push({ method: req.method, path: req.url, status: res.statusCode }); return end(...args); };
    await mint.handle(req, res, new URL(req.url, "http://127.0.0.1"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => {
    mint.stop();
    server.closeAllConnections();
    server.close(resolve);
  }));
  const fetchImpl = (target, options) => fetch(String(target) === CATALOG_URI ? `${url}/nutft/catalog` : target, options);
  const wallet = (storage = new Map()) => browserWallet(storage, fetchImpl, {
    cashu, globals: { setTimeout: (done) => setImmediate(done) },
  });
  return { url, mint, answers, failNextInsertInto, wallet };
}

test("a storage failure while committing a transfer commits nothing, answers 500, and the resend goes through",
  async (t) => {
    const served = await serveMint(t);
    const storage = new Map();
    const alice = await served.wallet(storage);
    await alice.buyBooster(served.url);
    const [card] = (await alice.snapshotReadOnly(served.url)).owned;
    const bob = await served.wallet();

    served.failNextInsertInto("nutft_signatures");
    await assert.rejects(alice.tradeProof(served.url, card.proof.secret, await bob.destination()),
      /could not answer \(500\)/);
    assert.deepEqual(served.answers.filter((answer) => answer.path === "/nutft/trade").map((answer) => answer.status),
      [500], "not a 4xx: the failure was the mint's, not a verdict on the request");
    assert.equal((await alice.snapshotReadOnly(served.url)).spent.length, 0,
      "the rolled-back transaction left the card unspent");
    assert.equal(JSON.parse(storage.get(STORE)).pending.type, "trade", "and the wallet kept the transfer");

    const finished = await alice.recoverPending();
    assert.equal(await bob.importToken(served.url, finished.token), 1, "the resend carried it out");
    assert.equal((await alice.snapshotReadOnly(served.url)).owned.length, PACK - 1);
  });

test("a storage failure while issuing a booster commits nothing and the next poll issues it once",
  async (t) => {
    const served = await serveMint(t);
    const buyer = await served.wallet();

    served.failNextInsertInto("nutft_signatures");
    const issued = await buyer.buyBooster(served.url);

    assert.equal(issued.cards.length, PACK);
    assert.deepEqual(served.answers.filter((answer) => answer.path === "/nutft/booster").map((answer) => answer.status),
      [500, 200]);
    assert.equal(served.mint.state.nextPack, 2, "one pack left the box, not two");
  });

test("the rate limit answers before the mint runs, so a refused transfer spends nothing", async (t) => {
  const mint = await bootMint(t, { mintWriteRateMax: 2 });
  const alice = await openWallet(mint);
  await alice.wallet.buyBooster(mint.url);
  const [card] = (await alice.wallet.snapshotReadOnly(mint.url)).owned;
  const bob = await openWallet(mint);
  const spend = await fetch(`${mint.url}/nutft/trade`, { method: "POST", body: "{}" });
  assert.equal(spend.status, 400, "the last write of this minute");

  await assert.rejects(alice.wallet.tradeProof(mint.url, card.proof.secret, await bob.wallet.destination()),
    /busy \(429\)/);
  assert.equal((await alice.wallet.snapshotReadOnly(mint.url)).spent.length, 0,
    "the mint never saw the transfer");

  mint.pass(60_000);
  const finished = await alice.wallet.recoverPending();
  assert.equal(await bob.wallet.importToken(mint.url, finished.token), 1);
});
