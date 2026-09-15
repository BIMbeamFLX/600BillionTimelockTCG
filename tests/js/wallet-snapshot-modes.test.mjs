/* Two ways to look at a wallet. snapshot() and snapshotMany() finish an
   unfinished booster or transfer before counting, for the wallet page. The
   read-only twins only count, so a badge or a deck check can never send, retry
   or rewrite a pending record that another tab has open. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { browserWallet } from "./helpers/browser-wallet.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const PACK = require("../../cards/nutft-census.json").mint.cards_per_pack;
const cashu = await import("@cashu/cashu-ts");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const STORE = "600b:nutft-wallet";

/* A wallet holding one booster, with a transfer the mint has already carried
   out but whose answer never arrived: the input card is spent at the mint and
   the pending record is the only claim on the recipient's token. */
async function walletWithUnfinishedTransfer(t) {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI });
  t.after(() => table.close());
  const sent = [];
  let dropNextTrade = false;
  const fetchImpl = async (url, options) => {
    const target = String(url) === CATALOG_URI ? `${table.url}/nutft/catalog` : String(url);
    const method = (options && options.method) || "GET";
    sent.push(`${method} ${new URL(target).pathname}`);
    const response = await fetch(target, options);
    if (dropNextTrade && method === "POST" && target.endsWith("/nutft/trade")) {
      dropNextTrade = false;
      throw new TypeError("the connection dropped after the mint answered");
    }
    return response;
  };
  const storage = new Map();
  const wallet = await browserWallet(storage, fetchImpl, { cashu });
  await wallet.buyBooster(table.url);
  const recipient = await browserWallet(new Map(), fetchImpl, { cashu });
  const [card] = (await wallet.snapshot(table.url)).owned;
  dropNextTrade = true;
  await assert.rejects(wallet.tradeProof(table.url, card.proof.secret, await recipient.destination()),
    /could not be reached/);
  assert.equal(JSON.parse(storage.get(STORE)).pending.type, "trade");
  return { table, wallet, storage, sent };
}

test("snapshotMany still finishes an unfinished transfer before it counts", async (t) => {
  const { table, wallet, storage, sent } = await walletWithUnfinishedTransfer(t);
  sent.length = 0;

  const view = await wallet.snapshotMany([table.url]);

  assert.ok(sent.includes("POST /nutft/trade"), "the transfer was sent again under its key");
  const saved = JSON.parse(storage.get(STORE));
  assert.equal(saved.pending, null, "and finished");
  assert.equal(saved.outgoing.length, 1, "the recipient's token is kept for handing over");
  assert.equal(view.owned.length, PACK - 1);
  assert.equal(view.spent.length, 0, "the spent card left the wallet when the transfer finished");
});

test("the read-only views count without sending, retrying or rewriting the pending transfer",
  async (t) => {
    const { table, wallet, storage, sent } = await walletWithUnfinishedTransfer(t);
    const before = storage.get(STORE);
    sent.length = 0;

    const many = await wallet.snapshotManyReadOnly([table.url]);
    const one = await wallet.snapshotReadOnly(table.url);

    assert.equal(storage.get(STORE), before, "the wallet state is byte for byte what it was");
    assert.deepEqual(sent.filter((request) => request.startsWith("POST")),
      ["POST /v1/checkstate", "POST /v1/checkstate"], "the only POSTs asked about proof states");
    for (const view of [many, one]) {
      assert.equal(view.owned.length, PACK - 1);
      assert.equal(view.spent.length, 1, "the card in the unfinished transfer counts as spent");
    }

    const finished = await wallet.recoverPending();
    assert.match(finished.token, /^cashuB/, "the untouched pending can still be finished afterwards");
  });
