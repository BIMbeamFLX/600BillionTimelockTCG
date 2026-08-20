import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { canonical, createNutftMint } = require("../../server/nutft-mint.js");
const cashu = await import("@cashu/cashu-ts");

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const opening = (output) => ({
  secret: new TextDecoder().decode(output.secret),
  blinding_factor: output.blindingFactor.toString(16).padStart(64, "0"),
  p2pk_e: output.ephemeralE,
});

test("NutFT draw vector stays compatible with the manifest package", () => {
  const { selfTest } = require("../../server/nutft-draw.js");
  assert.equal(selfTest(require("../../cards/nutft-testvector.json")), true);
});

test("NutFT catalog URI must be an absolute web URL", () => {
  assert.throws(() => createNutftMint({ catalogUri: "relative/catalog" }), /Invalid URL/);
  assert.throws(() => createNutftMint({ catalogUri: "file:///tmp/catalog" }), /absolute HTTP\(S\) URL/);
});

test("persisted mint refuses CardBinding configuration drift", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "600b-nutft-config-"));
  const dbPath = join(dir, "mint.db");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  await table.close();
  await assert.rejects(
    () => createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "https://example.test/nutft/catalog" }),
    /different NutFT census, collection, or catalog URI/,
  );
});

async function browserWallet(storage, fetchImpl) {
  const source = await readFile(new URL("../../site/nutft-wallet.js", import.meta.url), "utf8");
  const context = {
    __cashu: cashu,
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    TextEncoder,
    TextDecoder,
    Uint8Array,
  };
  vm.runInNewContext(source, context, { filename: "nutft-wallet.js" });
  return context.NutFTWallet;
}

test("browser wallet survives reload and preserves corrupted storage", async (t) => {
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());
  const storage = new Map();
  const fetchImpl = (url, options) => fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);
  await (await browserWallet(storage, fetchImpl)).buyBooster(table.url);
  const reloaded = await browserWallet(storage, fetchImpl);
  const snapshot = await reloaded.snapshot(table.url);
  assert.equal(snapshot.owned.length, 7);
  assert.equal(snapshot.spent.length, 0);
  assert.equal(snapshot.invalid.length, 0);
  const recipientStorage = new Map();
  const recipient = await browserWallet(recipientStorage, fetchImpl);
  const recipientPubkey = await recipient.destination();
  const transfer = await reloaded.tradeProof(table.url, snapshot.owned[0].proof.secret, recipientPubkey);
  assert.match(transfer.token, /^cashu/);
  assert.equal((await reloaded.snapshot(table.url)).owned.length, 6);
  assert.equal(await recipient.importToken(table.url, transfer.token), 1);
  assert.equal((await recipient.snapshot(table.url)).owned.length, 1);
  const backup = await recipient.exportBackup();
  const restoredStorage = new Map();
  const restored = await browserWallet(restoredStorage, fetchImpl);
  assert.equal(await restored.restoreBackup(backup), 1);
  assert.equal((await restored.snapshot(table.url)).owned.length, 1);
  await assert.rejects(() => restored.restoreBackup(backup), /requires an empty wallet/);
  await assert.rejects(() => restored.restoreBackup("not json"), /not valid JSON/);
  let dropTradeResponse = true;
  const flakyFetch = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (dropTradeResponse && String(url).endsWith("/nutft/trade")) {
      dropTradeResponse = false;
      throw new Error("simulated lost response");
    }
    return response;
  };
  const secondCard = (await reloaded.snapshot(table.url)).owned[0].proof.secret;
  await assert.rejects(() => browserWallet(storage, flakyFetch).then((wallet) => wallet.tradeProof(table.url, secondCard, recipientPubkey)), /lost response/);
  const recovered = await (await browserWallet(storage, fetchImpl)).recoverPending();
  assert.match(recovered.token, /^cashu/);
  assert.equal((await (await browserWallet(storage, fetchImpl)).snapshot(table.url)).owned.length, 5);
  storage.set("600b:nutft-wallet", "{broken");
  await assert.rejects(() => browserWallet(storage, fetchImpl).then((wallet) => wallet.read()), /corrupted/);
  assert.equal(storage.get("600b:nutft-wallet"), "{broken");
});

test("store issues one DLEQ/P2BK proof per card and preserves CardBinding", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "600b-nutft-"));
  const dbPath = join(dir, "mint.db");
  let table = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(async () => { await table.close(); rmSync(dir, { recursive: true, force: true }); });
  let base = table.url;
  const info = await (await fetch(`${base}/v1/info`)).json();
  assert.equal(info.nuts[31].output_openings, true);
  const catalog = await (await fetch(`${base}/nutft/catalog`)).json();
  assert.equal(info.nuts[31].catalog_issuer, catalog.issuer_pubkey);
  assert.equal(typeof catalog.assets[0].type_line, "string");
  assert.equal(typeof catalog.assets[0].face.sha256, "string");
  const { signature, issuer_pubkey: issuer, ...catalogPayload } = catalog;
  const catalogDigest = createHash("sha256").update(canonical(catalogPayload)).digest("hex");
  assert.equal(cashu.schnorrVerifyDigest(signature, catalogDigest, issuer), true);
  const keys = await (await fetch(`${base}/v1/keys`)).json();
  const keyset = keys.keysets[0];
  const privateKey = cashu.createRandomSecretKey();
  const pubkey = hex(cashu.getPubKeyFromPrivKey(privateKey));
  const quote = await (await fetch(`${base}/nutft/quote`)).json();
  const outputs = quote.cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey,
    blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));
  const boosterBody = {
    idempotency_key: "demo-booster-1",
    pack_id: quote.pack_id,
    state: quote.state,
    outputs: outputs.map((output) => ({ amount: 1, id: output.blindedMessage.id, B_: output.blindedMessage.B_, nutft: opening(output) })),
  };
  const issue = await fetch(`${base}/nutft/booster`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(boosterBody),
  });
  assert.equal(issue.status, 200);
  const issued = await issue.json();
  assert.deepEqual(await (await fetch(`${base}/nutft/booster`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(boosterBody) })).json(), issued);
  const proofKeyset = { id: keyset.id, keys: keyset.keys };
  const proofs = outputs.map((output, i) => output.toProof({ ...issued.signatures[i], amount: cashu.Amount.from(1) }, proofKeyset));
  assert.equal(issued.unit, "600B-E1");
  assert.equal(proofs.length, 7);
  assert.ok(proofs.every((proof) => proof.amount.toString() === "1" && proof.p2pk_e && proof.dleq));
  assert.deepEqual(proofs.map((proof) => cashu.getTag(proof.secret, "nutft")[2]), issued.cards.map((card) => card.asset_id));
  assert.ok(proofs.every((proof) => cashu.hasValidDleq(proof, proofKeyset, { require: true })));
  const token = cashu.getEncodedToken({ mint: base, unit: issued.unit, proofs });
  assert.equal(cashu.getDecodedToken(token, [keyset.id]).proofs.length, 7);
  const state = await (await fetch(`${base}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: [cashu.hashToCurve(new TextEncoder().encode(proofs[0].secret)).toHex(true)] }) })).json();
  assert.equal(state.states[0].state, "UNSPENT");
  const signedInput = cashu.signP2PKProof(proofs[0], cashu.maybeDeriveP2BKPrivateKeys(hex(privateKey), proofs[0])[0]);
  const inputTag = cashu.getTag(proofs[0].secret, "nutft");
  const otherIndex = proofs.findIndex((proof, index) => index > 0 && cashu.getTag(proof.secret, "nutft")[2] !== inputTag[2]);
  if (otherIndex >= 0) {
    const otherTag = cashu.getTag(proofs[otherIndex].secret, "nutft");
    const wrongOutput = cashu.OutputData.createSingleP2PKData({ pubkey, blindKeys: true, additionalTags: [["nutft", ...inputTag]] }, 1, keyset.id);
    const wrongTrade = await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      idempotency_key: "demo-trade-wrong-binding",
      inputs: cashu.serializeProofs([cashu.signP2PKProof(proofs[otherIndex], cashu.maybeDeriveP2BKPrivateKeys(hex(privateKey), proofs[otherIndex])[0])]),
      outputs: [{ amount: 1, id: wrongOutput.blindedMessage.id, B_: wrongOutput.blindedMessage.B_, nutft: opening(wrongOutput) }],
    }) });
    assert.equal(wrongTrade.status, 400);
    assert.equal(otherTag[2] !== inputTag[2], true);
  }
  const replacement = cashu.OutputData.createSingleP2PKData({ pubkey, blindKeys: true, additionalTags: [["nutft", ...inputTag]] }, 1, keyset.id);
  const tradeBody = {
    idempotency_key: "demo-trade-1",
    inputs: cashu.serializeProofs([signedInput]),
    outputs: [{ amount: 1, id: replacement.blindedMessage.id, B_: replacement.blindedMessage.B_, nutft: opening(replacement) }],
  };
  const trade = await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tradeBody) });
  assert.equal(trade.status, 200);
  const tradeResult = await trade.json();
  const replacementProof = replacement.toProof({ ...tradeResult.signature, amount: cashu.Amount.from(1) }, proofKeyset);
  assert.equal(cashu.getTag(replacementProof.secret, "nutft")[4], inputTag[4]);
  assert.deepEqual(await (await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tradeBody) })).json(), tradeResult);
  const changedBody = structuredClone(tradeBody);
  changedBody.outputs[0].nutft.blinding_factor = "1".padStart(64, "0");
  assert.equal((await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(changedBody) })).status, 400);
  assert.equal((await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...tradeBody, idempotency_key: "demo-trade-2" }) })).status, 400);
  const spent = await (await fetch(`${base}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: [cashu.hashToCurve(new TextEncoder().encode(proofs[0].secret)).toHex(true)] }) })).json();
  assert.equal(spent.states[0].state, "SPENT");
  const keysetId = keyset.id;
  await table.close();
  table = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  base = table.url;
  assert.equal((await (await fetch(`${base}/v1/keys`)).json()).keysets[0].id, keysetId);
  const spentAfterRestart = await (await fetch(`${base}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: [cashu.hashToCurve(new TextEncoder().encode(proofs[0].secret)).toHex(true)] }) })).json();
  assert.equal(spentAfterRestart.states[0].state, "SPENT");
  assert.deepEqual(await (await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tradeBody) })).json(), tradeResult);
  const mintState = await (await fetch(`${base}/nutft/state`)).json();
  assert.equal(mintState.next_pack, "pack-0002");
  assert.deepEqual(mintState.tier_odds, { genesis: 0.15, vault: 1.05, rare: 15.48, uncommon: 16.66, common: 66.65 });
  assert.equal((await fetch(`${base}/v1/swap`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${base}/v1/melt`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${base}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: ["not-a-curve-point"] }) })).status, 400);
  assert.equal((await fetch(`${base}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: "not-an-array" }) })).status, 400);
  assert.equal((await fetch(`${base}/nutft/booster`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack_id: quote.pack_id, state: quote.state, outputs: [] }) })).status, 400);
});
