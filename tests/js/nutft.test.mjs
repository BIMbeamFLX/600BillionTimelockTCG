import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { canonical } = require("../../server/nutft-mint.js");
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

test("store issues one DLEQ/P2BK proof per card and preserves CardBinding", async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(() => table.close());
  const base = table.url;
  const info = await (await fetch(`${base}/v1/info`)).json();
  assert.equal(info.nuts[31].output_openings, true);
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
      idempotency_key: "demo-booster-1",
      outputs: outputs.map((output) => ({ amount: 1, id: output.blindedMessage.id, B_: output.blindedMessage.B_, nutft: opening(output) })),
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
  assert.equal((await fetch(`${base}/v1/swap`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${base}/nutft/booster`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack_id: quote.pack_id, state: quote.state, outputs: [] }) })).status, 400);
});

test("the browser wallet reloads a bought booster from its own storage", async (t) => {
  // Regression: snapshot() read `keyset` without ever binding it, so wallet.html
  // threw ReferenceError on every load and could never show a card. The mint-side
  // test above stayed green throughout, because it never loads the wallet module.
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(() => table.close());

  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.NUTFT_CASHU_URL = "@cashu/cashu-ts";
  t.after(() => { delete globalThis.localStorage; delete globalThis.NUTFT_CASHU_URL; delete globalThis.NutFTWallet; });

  require("../../site/nutft-wallet.js");
  const wallet = globalThis.NutFTWallet;

  const bought = await wallet.buyBooster(table.url);
  assert.equal(bought.proofs.length, 7);
  assert.ok(store.get("600b:nutft-wallet"), "the booster is persisted to browser storage");

  // The reload path: exactly what wallet.html:56 calls on every page load.
  const { catalog, owned } = await wallet.snapshot(table.url);
  assert.equal(owned.length, 7, "every bought card comes back on reload");
  assert.equal(catalog.collection_id, "600B-E1");
  for (const card of owned) {
    assert.equal(card.state, "UNSPENT");
    assert.equal(card.proof.amount.toString(), "1");
    assert.equal(card.asset.asset_binding, card.tag[4], "CardBinding survives the round trip");
    assert.ok(card.asset.face && card.asset.face.sha256, "the Blossom face hash is present");
  }
  assert.deepEqual(
    owned.map((card) => card.tag[2]).sort(),
    bought.cards.map((card) => card.asset_id).sort(),
    "reload returns the same seven assets the mint issued",
  );
});

test("a restarted mint remembers what it already sold", async (t) => {
  // Regression: counts, nextPack and spent secrets lived only in memory, so
  // `systemctl restart tcg-table` — the last step of the deploy runbook — reset
  // sold to 0 and re-issued pack-0001 with the identical cards. The supply cap
  // held only until the next restart.
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nutft-durable-"));
  const dbPath = join(dir, "mint.db");
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps the db file briefly */ } });

  const buy = async (base) => {
    const keys = await (await fetch(`${base}/v1/keys`)).json();
    const keyset = keys.keysets[0];
    const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
    const quote = await (await fetch(`${base}/nutft/quote`)).json();
    const outputs = quote.cards.map((card) => cashu.OutputData.createSingleP2PKData({
      pubkey,
      blindKeys: true,
      additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
    }, 1, keyset.id));
    const response = await fetch(`${base}/nutft/booster`, {
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
    assert.equal(response.status, 200);
    return { quote, issued: await response.json() };
  };

  const first = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  const one = await buy(first.url);
  const afterFirst = await (await fetch(`${first.url}/nutft/state`)).json();
  assert.equal(afterFirst.sold, 1);
  assert.equal(afterFirst.next_pack, "pack-0002");
  first.close();

  // Same database, new process-lifetime: this is what a systemctl restart does.
  const second = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(() => second.close());
  const resumed = await (await fetch(`${second.url}/nutft/state`)).json();
  assert.equal(resumed.sold, 1, "the restarted mint still knows pack-0001 is gone");
  assert.equal(resumed.next_pack, "pack-0002", "it does not re-issue pack-0001");
  assert.equal(resumed.state, afterFirst.state, "the published commitment survives the restart");
  assert.deepEqual(resumed.remaining, afterFirst.remaining, "the supply counts survive the restart");

  const two = await buy(second.url);
  assert.equal(two.quote.pack_id, "pack-0002");
  assert.notDeepEqual(
    two.issued.cards.map((card) => card.asset_id),
    one.issued.cards.map((card) => card.asset_id),
    "the second pack is not a replay of the first",
  );
});

test("a mint that has sold refuses to restart under a different catalog_uri", async (t) => {
  // catalog_uri is hashed into every asset_binding, so resuming under a new one
  // would issue cards that disagree with the ones already in people's wallets.
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nutft-binding-"));
  const dbPath = join(dir, "mint.db");
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows keeps the db file briefly */ } });

  const first = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  first.close();

  await assert.rejects(
    () => createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: "https://example.test/nutft/catalog" }),
    /different catalog_uri/,
    "the mint refuses rather than splitting the binding",
  );
});

test("real signing secrets replace the publicly-derivable demo keys", async (t) => {
  // The demo derived its mint key from a fixed public string, so anyone could
  // recompute the private key and forge signatures. Production passes a secret.
  const { createNutftMint } = require("../../server/nutft-mint.js");

  const demo = createNutftMint({ catalogUri: "http://127.0.0.1/nutft/catalog" });
  const withSecret = createNutftMint({
    catalogUri: "http://127.0.0.1/nutft/catalog",
    mintSeed: "11".repeat(32),
    catalogKey: "22".repeat(32),
  });

  const demoInfo = await (async () => {
    // reach the keyset the same way the HTTP handler does
    const res = { code: 0, body: null };
    const fake = { writeHead() { return fake; }, end(b) { res.body = b; } };
    await demo.handle({ method: "GET" }, fake, new URL("http://x/v1/keys"));
    return JSON.parse(res.body);
  })();
  const secretInfo = await (async () => {
    const res = { body: null };
    const fake = { writeHead() { return fake; }, end(b) { res.body = b; } };
    await withSecret.handle({ method: "GET" }, fake, new URL("http://x/v1/keys"));
    return JSON.parse(res.body);
  })();

  assert.notEqual(
    demoInfo.keysets[0].id,
    secretInfo.keysets[0].id,
    "a real mint seed yields a different keyset than the demo key",
  );

  assert.throws(
    () => createNutftMint({ catalogUri: "http://127.0.0.1/nutft/catalog", requireProductionKeys: true }),
    /publicly-derivable demo keys/,
    "the production guard refuses to boot on demo keys",
  );
  assert.doesNotThrow(
    () => createNutftMint({ catalogUri: "http://127.0.0.1/nutft/catalog", requireProductionKeys: true, mintSeed: "33".repeat(32), catalogKey: "44".repeat(32) }),
    "with real secrets the production guard is satisfied",
  );
});
