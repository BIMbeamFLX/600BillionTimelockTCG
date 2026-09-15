/* A referee with a free E1 mint and browser wallets that talk to it, for the
   tests about how the wallet reserves, gives back and recovers counter slots.
   Every mint request a wallet sends is recorded, and a test may answer one
   itself (optionally after letting the real mint handle it). The referee's rate
   clock moves only when a wallet waits, so backing off costs no real time. */

import { createRequire } from "node:module";
import { browserWallet } from "./browser-wallet.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../../server/table.js");

export const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
export const STORE = "600b:nutft-wallet";
export const PACK = require("../../../cards/nutft-census.json").mint.cards_per_pack;
export const ASSETS = require("../../../cards/nutft-census.json").cards.length;
export const cashu = await import("@cashu/cashu-ts");

export async function bootMint(t, extra = {}) {
  let now = 1_000_000;
  const table = await createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI,
    rateClock: () => now, ...extra,
  });
  t.after(() => table.close());
  return {
    table,
    url: table.url,
    pass: (ms) => { now += ms; },
    setTimeout: (done, ms) => { now += ms; return setImmediate(done); },
  };
}

/* intercept(request, send) may return a Response to answer instead of the mint,
   call send() to let the mint answer first, or return nothing. */
export async function openWallet(mint, { storage = new Map(), intercept, globals = {} } = {}) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url) === CATALOG_URI ? `${mint.url}/nutft/catalog` : String(url);
    const request = {
      method: options.method || "GET",
      path: new URL(target).pathname,
      body: typeof options.body === "string" ? JSON.parse(options.body) : null,
    };
    requests.push(request);
    const send = () => fetch(target, options);
    return (intercept && await intercept(request, send)) || send();
  };
  const wallet = await browserWallet(storage, fetchImpl, {
    cashu, globals: { setTimeout: mint.setTimeout, ...globals },
  });
  return {
    wallet,
    storage,
    requests,
    saved: () => JSON.parse(storage.get(STORE)),
    counter: () => Object.values(JSON.parse(storage.get(STORE)).counters || {})[0] || 0,
    posted: (path) => requests.filter((request) => request.method === "POST" && request.path === path),
  };
}

/* A wallet holding `boosters` packs, to send cards from. */
export async function supplier(mint, boosters = 1) {
  const from = await openWallet(mint);
  for (let i = 0; i < boosters; i++) await from.wallet.buyBooster(mint.url);
  return from;
}

/* The token that hands `proof` to the wallet whose destination is `pubkey`. */
export async function handOver(from, mint, proof, pubkey) {
  return (await from.wallet.tradeProof(mint.url, proof.secret, pubkey)).token;
}
