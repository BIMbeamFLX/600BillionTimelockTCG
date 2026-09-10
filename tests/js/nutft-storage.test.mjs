/* The storage port: a shell store instead of localStorage, and the promise it
   makes, which is that a refused write stops the operation. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { browserWallet } from "./helpers/browser-wallet.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const CENSUS = require("../../cards/nutft-census.json");
const PACK = CENSUS.mint.cards_per_pack;
const cashu = await import("@cashu/cashu-ts");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const mapCatalog = (table) => (url, options) =>
  fetch(String(url) === CATALOG_URI ? `${table.url}/nutft/catalog` : url, options);

/* A shell store: asynchronous, and able to refuse. `failFrom` counts writes and
   rejects from that write onward, the way a quota or a dead host would. */
function shellStorage(backing = new Map(), { failFrom = Infinity } = {}) {
  let writes = 0;
  return {
    backing,
    get writes() {
      return writes;
    },
    getItem: async (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: async (key, value) => {
      writes += 1;
      if (writes >= failFrom) throw new Error("the shell refused the write");
      backing.set(key, value);
    },
  };
}

test("the wallet runs on an asynchronous shell store", async (t) => {
  const table = await createTable({
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    nutftCatalogUri: CATALOG_URI,
  });
  t.after(() => table.close());

  const storage = shellStorage();
  /* No localStorage at all in this context: a napplet does not have one, and the
     wallet must not reach for it. */
  const wallet = await browserWallet(new Map(), mapCatalog(table), {
    cashu,
    globals: { NUTFT_STORAGE: storage, localStorage: undefined },
  });

  await wallet.buyBooster(table.url);
  assert.equal((await wallet.snapshot(table.url)).owned.length, PACK);
  assert.ok(storage.backing.has("600b:nutft-wallet"), "the wallet landed in the shell store");
  assert.ok(storage.writes > 0);

  const reloaded = await browserWallet(new Map(), mapCatalog(table), {
    cashu,
    globals: { NUTFT_STORAGE: storage, localStorage: undefined },
  });
  assert.equal((await reloaded.snapshot(table.url)).owned.length, PACK, "a fresh wallet reads the same store");
});

test("a refused write stops the operation instead of pretending it finished", async (t) => {
  const table = await createTable({
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    nutftCatalogUri: CATALOG_URI,
  });
  t.after(() => table.close());

  const storage = shellStorage(new Map(), { failFrom: 1 });
  const wallet = await browserWallet(new Map(), mapCatalog(table), {
    cashu,
    globals: { NUTFT_STORAGE: storage, localStorage: undefined },
  });

  await assert.rejects(() => wallet.buyBooster(table.url), /refused the write/);
  assert.equal(storage.backing.size, 0, "nothing was stored");

  /* The wallet must not carry a state the store never accepted. Reading it back
     has to show the empty wallet, not the one the failed write described. */
  /* Length, not deep equality: the wallet runs in its own vm realm, so its empty
     array is not prototype-identical to this one. */
  const state = await wallet.read();
  assert.equal(state.tokens.length, 0, "no tokens are claimed after a refused write");
  assert.ok(!state.pending, "no pending is claimed either");
});

test("without an injected store the port still uses localStorage", async (t) => {
  const table = await createTable({
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    nutftCatalogUri: CATALOG_URI,
  });
  t.after(() => table.close());

  const local = new Map();
  const wallet = await browserWallet(local, mapCatalog(table), { cashu });
  await wallet.buyBooster(table.url);
  assert.equal((await wallet.snapshot(table.url)).owned.length, PACK);
  assert.ok(local.has("600b:nutft-wallet"), "the page path is unchanged");
});
