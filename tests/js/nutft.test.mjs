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

test("a paid mint sells nothing until the invoice actually settles", async (t) => {
  // The demo minted a full pack for free. With a funding source configured the
  // signatures must be unreachable until lnd says the invoice settled — and one
  // settled invoice must buy exactly one pack.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");

  const settled = new Set();
  let issued = 0;
  const fakeLnd = { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 1000 };
  const lndModule = require("../../server/lnd.js");
  const realCreate = lndModule.createInvoice;
  const realSettled = lndModule.isSettled;
  lndModule.createInvoice = async () => {
    issued += 1;
    const hash = "aa".repeat(16) + String(issued).padStart(32, "0");
    return { paymentRequest: `lnbc-fake-${issued}`, paymentHash: hash };
  };
  lndModule.isSettled = async (_config, hash) => settled.has(hash);
  t.after(() => { lndModule.createInvoice = realCreate; lndModule.isSettled = realSettled; });

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({ db, catalogUri: "http://127.0.0.1/nutft/catalog", lnd: fakeLnd, priceMsat: 21000 });

  const hit = async (method, path, body) => {
    const out = { code: 0, body: null };
    const res = { writeHead(c) { out.code = c; return res; }, end(b) { out.body = b ? JSON.parse(b) : null; } };
    await mint.handle({ method, on: () => {}, setEncoding: () => {} }, res, new URL(`http://x${path}`));
    return out;
  };

  const info = await hit("GET", "/v1/info");
  assert.equal(info.body.nuts["31"].paid, true, "the mint advertises that it charges");
  assert.equal(info.body.nuts["31"].price_msat, 21000);

  const quote = await hit("GET", "/nutft/quote");
  assert.equal(quote.code, 200);
  assert.equal(quote.body.paid, true);
  assert.equal(quote.body.price_msat, 21000);
  assert.ok(quote.body.payment_request, "the quote carries an invoice to pay");
  assert.match(quote.body.payment_hash, /^[0-9a-f]{64}$/);
  assert.equal(quote.body.cards.length, 7);

  // Unpaid: the mint must refuse before it signs anything.
  const unpaidBody = { idempotency_key: "k1", pack_id: quote.body.pack_id, state: quote.body.state, payment_hash: quote.body.payment_hash, outputs: [] };
  await assert.rejects(() => mint.signBooster(unpaidBody), /not settled/i, "an unsettled invoice buys nothing");

  // A payment_hash the mint never issued.
  await assert.rejects(
    () => mint.signBooster({ ...unpaidBody, payment_hash: "bb".repeat(32) }),
    /unknown payment_hash/i,
    "a made-up payment hash is refused",
  );

  // Missing entirely.
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: "k2", pack_id: quote.body.pack_id, state: quote.body.state, outputs: [] }),
    /payment_hash is required/i,
    "no payment hash at all is refused",
  );
});

test("one settled invoice buys exactly one pack, and never a second", async (t) => {
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");

  const settled = new Set();
  let issued = 0;
  const lndModule = require("../../server/lnd.js");
  const realCreate = lndModule.createInvoice;
  const realSettled = lndModule.isSettled;
  lndModule.createInvoice = async () => {
    issued += 1;
    return { paymentRequest: `lnbc-fake-${issued}`, paymentHash: String(issued).padStart(64, "c") };
  };
  lndModule.isSettled = async (_c, hash) => settled.has(hash);
  t.after(() => { lndModule.createInvoice = realCreate; lndModule.isSettled = realSettled; });

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "http://127.0.0.1/nutft/catalog",
    lnd: { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 1000 },
    priceMsat: 21000,
  });

  const keysRes = { writeHead() { return keysRes; }, end(b) { keysRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, keysRes, new URL("http://x/v1/keys"));
  const keyset = keysRes.parsed.keysets[0];
  const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));

  const quote = await mint.payableQuote();
  const outputsFor = (qq) => qq.cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey, blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));
  const bodyFor = (qq, outs, key, hash) => ({
    idempotency_key: key, pack_id: qq.pack_id, state: qq.state, payment_hash: hash,
    outputs: outs.map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) })),
  });

  // The buyer pays.
  settled.add(quote.payment_hash);
  const outs = outputsFor(quote);
  const result = await mint.signBooster(bodyFor(quote, outs, "buy-1", quote.payment_hash));
  assert.equal(result.signatures.length, 7, "a settled invoice mints the whole pack");
  assert.equal(result.unit, "600B-E1");

  // The same settled invoice must not buy the next pack too.
  const second = await mint.payableQuote();
  assert.notEqual(second.pack_id, quote.pack_id, "the box advanced");
  await assert.rejects(
    () => mint.signBooster(bodyFor(second, outputsFor(second), "buy-2", quote.payment_hash)),
    /different pack|already been claimed/i,
    "a spent invoice cannot be replayed against the next pack",
  );

  // And an invoice quoted for a pack that has since passed is refused too.
  settled.add(second.payment_hash);
  await assert.rejects(
    () => mint.signBooster(bodyFor(quote, outputsFor(quote), "buy-3", second.payment_hash)),
    /stale booster quote|different pack/i,
    "an invoice cannot be aimed at a pack it was not quoted for",
  );
});

test("a sealed pack cannot be known at purchase, and resolves to its own block", async (t) => {
  // The fairness core. With a fixed beacon the whole box is a pure function of
  // public data, so a buyer can precompute which pack holds a Genesis card and
  // simply wait for it. Committing to a block above the tip makes the contents
  // unknowable at the moment money changes hands — to the buyer and the mint.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");

  let height = 900000;
  const hashAt = (n) => (n % 2 ? "b" : "e").repeat(64).slice(0, 64 - String(n).length) + String(n);
  const lndModule = require("../../server/lnd.js");

  const realCreate = lndModule.createInvoice;
  const realSettled = lndModule.isSettled;
  let issued = 0;
  const settled = new Set();
  lndModule.createInvoice = async () => {
    issued += 1;
    return { paymentRequest: `lnbc-${issued}`, paymentHash: String(issued).padStart(64, "d") };
  };
  lndModule.isSettled = async (_c, h) => settled.has(h);
  t.after(() => { lndModule.createInvoice = realCreate; lndModule.isSettled = realSettled; });

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "http://127.0.0.1/nutft/catalog",
    lnd: { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 500 },
    priceMsat: 21000, beaconSource: "lnd", beaconConfirmations: 1,
    beaconGetInfo: async () => ({ height, hash: hashAt(height) }),
  });
  assert.equal(mint.sealed, true, "the mint seals packs");

  const quote = await mint.payableQuote();
  assert.equal(quote.sealed, true);
  assert.equal(quote.cards, null, "the pack is sealed: no cards are disclosed at purchase");
  assert.equal(quote.target_height, height + 1, "it commits to a block above the tip");
  assert.ok(quote.payment_request, "and it is payable");

  // Before the block exists, nobody can open it — not even after paying.
  settled.add(quote.payment_hash);
  const early = await mint.revealFor(quote.payment_hash);
  assert.equal(early.sealed, true);
  assert.equal(early.cards, null, "an unmined block reveals nothing");
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: "s1", pack_id: quote.pack_id, state: quote.state, payment_hash: quote.payment_hash, outputs: [] }),
    /not mined yet|still sealed/i,
    "and the mint will not sign against a block that does not exist",
  );

  // The block arrives.
  height += 1;
  const opened = await mint.revealFor(quote.payment_hash);
  assert.equal(opened.sealed, false);
  assert.equal(opened.cards.length, 7, "the pack opens to seven cards");
  assert.equal(opened.beacon, hashAt(quote.target_height), "against the hash of the committed block");

  // The same sale always opens the same way, even once the chain moves on.
  height += 4;
  const again = await mint.revealFor(quote.payment_hash);
  assert.equal(again.beacon, opened.beacon, "a later tip does not change a sealed sale");
  assert.deepEqual(again.cards.map((c) => c.asset_id), opened.cards.map((c) => c.asset_id));

  // And a different block would have produced a different pack — which is the
  // whole point: the contents are a function of a value nobody controlled.
  const otherDb = new DatabaseSync(":memory:");
  t.after(() => otherDb.close());
  let otherHeight = 900500;
  const otherMint = createNutftMint({
    db: otherDb, catalogUri: "http://127.0.0.1/nutft/catalog",
    lnd: { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 500 },
    priceMsat: 21000, beaconSource: "lnd", beaconConfirmations: 1,
    beaconGetInfo: async () => ({ height: otherHeight, hash: hashAt(otherHeight) }),
  });
  const otherQuote = await otherMint.payableQuote();
  settled.add(otherQuote.payment_hash);
  otherHeight += 1;
  const otherOpened = await otherMint.revealFor(otherQuote.payment_hash);
  assert.notEqual(otherOpened.beacon, opened.beacon, "a different block");
  assert.notDeepEqual(
    otherOpened.cards.map((c) => c.asset_id),
    opened.cards.map((c) => c.asset_id),
    "yields a different pack from the same pack_id — the beacon really drives the draw",
  );
});
