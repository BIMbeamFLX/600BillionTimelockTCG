/* Committed purchases and possession certificates
   (docs/nutft-purchase-and-possession.md). */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { browserWallet } from "./helpers/browser-wallet.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { canonical, createNutftMint } = require("../../server/nutft-mint.js");
const CENSUS = require("../../cards/nutft-census.json");
const PACK = CENSUS.mint.cards_per_pack;
const cashu = await import("@cashu/cashu-ts");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const mapCatalog = (table) => (url, options) => fetch(String(url) === CATALOG_URI ? `${table.url}/nutft/catalog` : url, options);
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("purchase mode withholds the draw until a committed purchase", async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI, nutftPurchaseMode: true });
  t.after(() => table.close());
  const info = await (await fetch(`${table.url}/v1/info`)).json();
  assert.equal(info.nuts[31].purchase_mode, true);

  const quote = await (await fetch(`${table.url}/nutft/quote`)).json();
  assert.equal(quote.purchase_required, true);
  assert.equal(quote.cards, null);
  assert.equal("next_state" in quote, false, "the next state is part of the draw and stays withheld");
  assert.equal("beacon" in quote, false);

  const legacy = await post(`${table.url}/nutft/booster`, { idempotency_key: "legacy", pack_id: quote.pack_id, state: quote.state, outputs: [] });
  assert.equal(legacy.status, 400);
  assert.match((await legacy.json()).error, /committed purchases/);

  const wallet = await browserWallet(new Map(), mapCatalog(table), { cashu });
  await wallet.buyBooster(table.url);
  assert.equal((await wallet.snapshot(table.url)).owned.length, PACK);
  const state = await (await fetch(`${table.url}/nutft/state`)).json();
  assert.equal(state.sold, 1, "one purchase, one pack: the claim did not advance the state again");

  const stale = await post(`${table.url}/nutft/purchase`, { purchase_id: randomBytes(32).toString("hex"), pack_id: quote.pack_id, state: quote.state });
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).error, "stale booster quote");

  const bad = await post(`${table.url}/nutft/purchase`, { purchase_id: "short", pack_id: quote.pack_id, state: quote.state });
  assert.match((await bad.json()).error, /32 random bytes/);
});

test("a committed purchase survives a lost response", async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI, nutftPurchaseMode: true });
  t.after(() => table.close());
  let dropPurchase = true;
  const fetchImpl = async (url, options) => {
    const response = await mapCatalog(table)(url, options);
    if (dropPurchase && String(url).endsWith("/nutft/purchase")) {
      dropPurchase = false;
      throw new Error("simulated lost response");
    }
    return response;
  };
  const storage = new Map();
  await assert.rejects(() => browserWallet(storage, fetchImpl, { cashu }).then((wallet) => wallet.buyBooster(table.url)), /lost response/);
  const saved = JSON.parse(storage.get("600b:nutft-wallet"));
  assert.ok(saved.pending && saved.pending.body.purchase_id, "the pending record keeps the purchase_id");
  assert.equal(saved.pending.outputs.length, 0, "no outputs yet: the receipt never arrived");

  const recovered = await (await browserWallet(storage, fetchImpl, { cashu })).recoverPending();
  assert.equal(recovered.proofs.length, PACK);
  const state = await (await fetch(`${table.url}/nutft/state`)).json();
  assert.equal(state.sold, 1, "the replayed purchase_id returned the committed draw instead of drawing again");
  assert.equal((await (await browserWallet(storage, fetchImpl, { cashu })).snapshot(table.url)).owned.length, PACK);
});

test("an unclaimed purchase is released after the claim grace", async () => {
  let now = Date.parse("2026-09-10T12:00:00Z");
  const mint = createNutftMint({ catalogUri: CATALOG_URI, purchaseMode: true, clock: () => now });
  const first = await mint.payableQuote({});
  assert.equal(first.purchase_required, true);
  const id = randomBytes(32).toString("hex");
  const bought = await mint.purchase({ purchase_id: id, pack_id: first.pack_id, state: first.state });
  assert.equal(bought.status, "purchased");
  assert.equal(bought.cards.length, PACK);
  assert.equal(mint.state.nextPack, 2, "the purchase reserved the pack by advancing the state");

  const replay = await mint.purchase({ purchase_id: id, pack_id: first.pack_id, state: first.state });
  assert.deepEqual(replay, bought, "the same purchase_id with the same body replays the receipt");
  await assert.rejects(() => mint.purchase({ purchase_id: id, pack_id: first.pack_id, state: "different" }), /different purchase/);

  const second = await mint.payableQuote({});
  assert.notEqual(second.pack_id, first.pack_id, "the pack stays reserved while the purchase is open");

  now += 3601 * 1000;
  const released = await mint.payableQuote({});
  assert.equal(released.pack_id, first.pack_id, "after the claim grace the pack is quoted again");
  assert.equal(mint.state.nextPack, 1, "counts and state returned to what they were before the purchase");
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: id, purchase_id: id, pack_id: first.pack_id, state: first.state, outputs: [] }),
    /purchase expired/,
  );
  await assert.rejects(() => mint.purchase({ purchase_id: id, pack_id: first.pack_id, state: first.state }), /purchase expired/);
});

test("a possession certificate proves unspent cards without spending them", async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI });
  t.after(() => table.close());
  const wallet = await browserWallet(new Map(), mapCatalog(table), { cashu });
  await wallet.buyBooster(table.url);
  const owned = (await wallet.snapshot(table.url)).owned;
  const chosen = owned.slice(0, 3);
  const secrets = chosen.map((entry) => entry.proof.secret);
  const player = "ab".repeat(32);

  const certificate = await wallet.provePossession(table.url, secrets, player, "table-42");
  assert.equal(certificate.kind, "nutft/possession");
  assert.equal(certificate.version, 1);
  assert.equal(certificate.room, "table-42");
  assert.equal(certificate.player, player);
  /* Spread into this realm's arrays: the wallet runs in a vm context whose
     Array prototype differs, and the strict deep comparison checks it. */
  assert.deepEqual([...certificate.assets.map((asset) => asset.asset_id)], [...chosen.map((entry) => entry.tag[2])]);
  const { signature, ...payload } = certificate;
  const info = await (await fetch(`${table.url}/v1/info`)).json();
  const digest = createHash("sha256").update(canonical(payload)).digest("hex");
  assert.equal(cashu.schnorrVerifyDigest(signature, digest, info.nuts[31].catalog_issuer), true, "the catalog key signs the certificate");
  assert.equal((await wallet.snapshot(table.url)).owned.length, PACK, "nothing was spent");

  const forged = await post(`${table.url}/nutft/possession`, {
    player, room: "table-42", inputs: cashu.serializeProofs([chosen[0].proof]), authorizations: ["00".repeat(64)],
  });
  assert.equal(forged.status, 400);
  assert.match((await forged.json()).error, /not authorized/);

  const duplicate = await post(`${table.url}/nutft/possession`, {
    player, room: "table-42", inputs: cashu.serializeProofs([chosen[0].proof, chosen[0].proof]), authorizations: ["00".repeat(64), "00".repeat(64)],
  });
  assert.match((await duplicate.json()).error, /duplicate/);

  const other = await browserWallet(new Map(), mapCatalog(table), { cashu });
  await wallet.tradeProof(table.url, secrets[0], await other.destination());
  const spent = await post(`${table.url}/nutft/possession`, {
    player, room: "table-42", inputs: cashu.serializeProofs([chosen[0].proof]), authorizations: ["00".repeat(64)],
  });
  assert.match((await spent.json()).error, /already spent/);
  await assert.rejects(() => wallet.provePossession(table.url, [secrets[0]], player, "table-42"), /not in this wallet/);
  assert.equal((await wallet.provePossession(table.url, secrets.slice(1), player, "table-43")).assets.length, 2);
});
