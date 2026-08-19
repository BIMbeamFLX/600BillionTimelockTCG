import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { canonical } = require("../../server/nutft-mint.js");
const cashu = await import("@cashu/cashu-ts");

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("NutFT draw vector stays compatible with the manifest package", () => {
  const { selfTest } = require("../../server/nutft-draw.js");
  assert.equal(selfTest(require("../../cards/nutft-testvector.json")), true);
});

test("store issues one DLEQ/P2BK proof per card and preserves CardBinding", async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(() => table.close());
  const base = table.url;
  const catalog = await (await fetch(`${base}/nutft/catalog`)).json();
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
  const issue = await fetch(`${base}/nutft/booster`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pack_id: quote.pack_id,
      state: quote.state,
      outputs: outputs.map((output, i) => ({ amount: 1, id: output.blindedMessage.id, B_: output.blindedMessage.B_, nutft: {
        collection_id: quote.cards[i].collection_id,
        asset_id: quote.cards[i].asset_id,
        catalog_uri: quote.cards[i].catalog_uri,
      } })),
    }),
  });
  assert.equal(issue.status, 200);
  const issued = await issue.json();
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
      outputs: [{ amount: 1, id: wrongOutput.blindedMessage.id, B_: wrongOutput.blindedMessage.B_, nutft: { collection_id: inputTag[1], asset_id: inputTag[2], catalog_uri: inputTag[3] } }],
    }) });
    assert.equal(wrongTrade.status, 400);
    assert.equal(otherTag[2] !== inputTag[2], true);
  }
  const replacement = cashu.OutputData.createSingleP2PKData({ pubkey, blindKeys: true, additionalTags: [["nutft", ...inputTag]] }, 1, keyset.id);
  const tradeBody = {
    idempotency_key: "demo-trade-1",
    inputs: cashu.serializeProofs([signedInput]),
    outputs: [{ amount: 1, id: replacement.blindedMessage.id, B_: replacement.blindedMessage.B_, nutft: { collection_id: inputTag[1], asset_id: inputTag[2], catalog_uri: inputTag[3] } }],
  };
  const trade = await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tradeBody) });
  assert.equal(trade.status, 200);
  const tradeResult = await trade.json();
  const replacementProof = replacement.toProof({ ...tradeResult.signature, amount: cashu.Amount.from(1) }, proofKeyset);
  assert.equal(cashu.getTag(replacementProof.secret, "nutft")[4], inputTag[4]);
  assert.deepEqual(await (await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tradeBody) })).json(), tradeResult);
  assert.equal((await fetch(`${base}/nutft/trade`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...tradeBody, idempotency_key: "demo-trade-2" }) })).status, 400);
  const spent = await (await fetch(`${base}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: [cashu.hashToCurve(new TextEncoder().encode(proofs[0].secret)).toHex(true)] }) })).json();
  assert.equal(spent.states[0].state, "SPENT");
  assert.equal((await fetch(`${base}/v1/swap`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${base}/nutft/booster`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack_id: quote.pack_id, state: quote.state, outputs: [] }) })).status, 400);
});
