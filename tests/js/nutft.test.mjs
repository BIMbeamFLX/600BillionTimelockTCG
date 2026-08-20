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

async function browserWallet(storage, fetchImpl, nostr) {
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
    URL,
    setTimeout,
    btoa: (text) => Buffer.from(text, "binary").toString("base64"),
    ...(nostr ? { nostr } : {}),
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

test("browser wallet claims a paid sealed pack after its block arrives", async (t) => {
  const { createServer } = await import("node:http");
  const { DatabaseSync } = await import("node:sqlite");
  const { createMockFunding } = require("../../server/funding.js");
  let mint;
  const server = createServer((request, response) => mint.handle(
    request,
    response,
    new URL(request.url, `http://${request.headers.host}`),
  ));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let height = 900000;
  mint = createNutftMint({
    db,
    catalogUri: `${base}/nutft/catalog`,
    funding: createMockFunding({ settleAfterMs: 0 }),
    priceMsat: 21000,
    allowVirtual: "1",
    beaconSource: "lnd",
    beaconConfirmations: 1,
    beaconGetInfo: async () => ({ height, hash: String(height).padStart(64, "a") }),
  });
  const wallet = await browserWallet(new Map(), fetch);
  let invoice = null;
  const issued = await wallet.buyBooster(base, {
    timeoutMs: 5000,
    onInvoice(value) {
      invoice = value;
      height += 1;
    },
  });
  assert.ok(invoice?.paymentRequest, "the buyer sees the invoice before the reveal");
  assert.equal(issued.cards.length, 7);
  assert.equal((await wallet.snapshot(base)).owned.length, 7);
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
  const paidBody = bodyFor(quote, outs, "buy-1", quote.payment_hash);
  await assert.rejects(
    () => mint.signBooster({ ...paidBody, outputs: [] }),
    /one output is required per card/i,
    "bad outputs do not consume a settled invoice",
  );
  const result = await mint.signBooster(paidBody);
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

test("LNURL-pay serves a scannable booster and binds the description hash", async (t) => {
  // Without this a buyer copies a bolt11 out of a page and pastes it into a
  // wallet. With it they scan one QR. The description hash binding is the part
  // wallets actually verify, so it has to be the hash of the exact metadata the
  // wallet was served — not a regenerated equivalent.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const lnurlModule = require("../../server/lnurl.js");
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");

  let seenDescriptionHash = null;
  const lndModule = require("../../server/lnd.js");
  const realCreate = lndModule.createInvoice;
  lndModule.createInvoice = async (_c, args) => {
    seenDescriptionHash = args.descriptionHash;
    return { paymentRequest: "lnbc210n1pfake", paymentHash: "f".repeat(64) };
  };
  t.after(() => { lndModule.createInvoice = realCreate; });

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "https://tcg.example/nutft/catalog",
    lnd: { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 500 },
    priceMsat: 21000, publicBase: "https://tcg.example",
  });

  const hit = async (path) => {
    const out = {};
    const res = { writeHead(c) { out.code = c; return res; }, end(b) { out.body = JSON.parse(b); } };
    await mint.handle({ method: "GET" }, res, new URL(`https://tcg.example${path}`));
    return out.body;
  };

  const pay = await hit("/nutft/lnurlp");
  assert.equal(pay.tag, "payRequest");
  assert.equal(pay.minSendable, 21000);
  assert.equal(pay.maxSendable, 21000, "a booster has one price, so no slider");
  assert.equal(pay.callback, "https://tcg.example/nutft/lnurlp/callback");

  // A wallet refuses an amount outside the range; the mint must too.
  const wrong = await hit("/nutft/lnurlp/callback?amount=5000");
  assert.equal(wrong.status, "ERROR");
  assert.match(wrong.reason, /exactly 21000 msat/);

  const ok = await hit("/nutft/lnurlp/callback?amount=21000");
  assert.equal(ok.pr, "lnbc210n1pfake", "the wallet is handed an invoice");
  assert.equal(ok.successAction.tag, "url");
  assert.match(ok.successAction.url, /claim=f{64}/, "and a way to claim the pack after paying");

  // The binding wallets check: sha256 of the metadata that was served.
  assert.ok(seenDescriptionHash, "the invoice committed to a description hash");
  assert.equal(
    Buffer.from(seenDescriptionHash).toString("hex"),
    createHash("sha256").update(Buffer.from(pay.metadata, "utf8")).digest("hex"),
    "and it is the hash of the exact metadata string the wallet was served",
  );

  // The QR payload itself must be a real LNURL.
  const encoded = lnurlModule.encodeLnurl("https://tcg.example/nutft/lnurlp");
  assert.match(encoded, /^LNURL1[0-9A-Z]+$/, "bech32, uppercase for QR alphanumeric mode");
});

test("staging runs the whole payment path on virtual sats, and says so", async (t) => {
  // A staging deployment has to exercise quote -> invoice -> settle -> claim
  // -> the double-claim guard, because a bug in that path is exactly what
  // staging exists to catch. It must do it without being able to move a real
  // satoshi, and it must never be mistaken for production.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const funding = createMockFunding({ settleAfterMs: 60_000 });   // unpaid for now
  const mint = createNutftMint({
    db, catalogUri: "https://staging.example/nutft/catalog",
    funding, priceMsat: 21000, allowVirtual: "1",
  });

  const infoRes = { writeHead() { return infoRes; }, end(b) { infoRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, infoRes, new URL("https://x/v1/info"));
  assert.equal(infoRes.parsed.nuts["31"].paid, true);
  assert.equal(infoRes.parsed.nuts["31"].funding, "mock");
  assert.equal(infoRes.parsed.nuts["31"].virtual_sats, true, "staging announces that its money is not real");

  const quote = await mint.payableQuote();
  assert.match(quote.payment_request, /^lnbcmock/, "and its invoices cannot be mistaken for payable ones");

  // Unpaid behaves exactly as production does.
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: "v1", pack_id: quote.pack_id, state: quote.state, payment_hash: quote.payment_hash, outputs: [] }),
    /not settled/i,
    "an unpaid virtual invoice buys nothing either",
  );

  // Settle it, then the real thing: outputs, signatures, and the replay guard.
  funding.settle(quote.payment_hash);
  const keysRes = { writeHead() { return keysRes; }, end(b) { keysRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, keysRes, new URL("https://x/v1/keys"));
  const keyset = keysRes.parsed.keysets[0];
  const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
  const outs = quote.cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey, blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));
  const body = {
    idempotency_key: "v2", pack_id: quote.pack_id, state: quote.state, payment_hash: quote.payment_hash,
    outputs: outs.map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) })),
  };
  const result = await mint.signBooster(body);
  assert.equal(result.signatures.length, 7, "a settled virtual invoice mints a real pack of proofs");

  const next = await mint.payableQuote();
  await assert.rejects(
    () => mint.signBooster({ ...body, idempotency_key: "v3", pack_id: next.pack_id, state: next.state }),
    /different pack|already been claimed/i,
    "and the replay guard behaves the same as it will in production",
  );
});

test("a mock funding source refuses to start without being told it is staging", async (t) => {
  // Virtual money must never be a production surprise: a misconfigured unit
  // that quietly gives boosters away for fake sats would look like it works.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  assert.throws(
    () => createNutftMint({ db, catalogUri: "https://x/nutft/catalog", funding: createMockFunding({}) }),
    /NUTFT_ALLOW_VIRTUAL/,
    "it demands an explicit confirmation that this is staging",
  );
});

test("the node-less Cashu funding source guards the ways it can lose money", async (t) => {
  // A public mint hands anyone a real bolt11, which is what removes the node.
  // The failure modes are all about custody, so those are what is guarded.
  const { createCashuFunding } = require("../../server/funding-cashu.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  assert.throws(() => createCashuFunding({ db }), /NUTFT_CASHU_MINT/, "a mint URL is required");
  assert.throws(
    () => createCashuFunding({ db, mintUrl: "http://mint.example" }),
    /must be https/,
    "an http mint would expose the quote to the network path",
  );

  const funding = createCashuFunding({ db, mintUrl: "https://mint.example" });
  assert.equal(funding.name, "cashu");
  assert.equal(funding.custodial, true, "it declares that somebody else holds the sats");
  assert.equal(funding.virtual, false);
  assert.equal(funding.balanceSat(), 0, "and exposes the balance so a sweep can be scheduled");

  // A mint quote is priced in whole sats. Rounding would charge a price other
  // than the one advertised, so it refuses instead.
  await assert.rejects(
    () => funding.createInvoice({ amountMsat: 21500 }),
    /whole sats/,
    "a fractional sat is refused rather than rounded",
  );

  // Without a database the received ecash would live only in one reply.
  const noDb = createCashuFunding({ mintUrl: "https://mint.example" });
  assert.equal(noDb.balanceSat(), 0);
});

test("a mint quote id is a valid payment reference, not just a 32-byte hash", async (t) => {
  // The 64-hex assumption was baked in when lnd was the only funding source. A
  // Cashu mint quote is addressed by a UUID, so rejecting one on shape would
  // make the node-less backend unusable at the point of claiming a pack.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  const mint = createNutftMint({
    db, catalogUri: "https://x/nutft/catalog",
    funding: createMockFunding({}), allowVirtual: "1", priceMsat: 21000,
    beaconSource: "lnd", beaconConfirmations: 1,
    lnd: { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 500 },
    beaconGetInfo: async () => ({ height: 910000, hash: "c".repeat(64) }),
  });

  // revealFor takes a payment reference straight from the query string, so it
  // is where shape actually gets enforced.
  await assert.rejects(
    () => mint.revealFor("../../etc/passwd"),
    /not a valid payment reference/,
    "a path traversal attempt is refused on shape",
  );
  await assert.rejects(
    () => mint.revealFor("short"),
    /not a valid payment reference/,
    "and so is something too short to be any funding source's reference",
  );

  // A UUID passes the shape gate and fails on its merits instead — which is
  // exactly what a Cashu quote id must do.
  await assert.rejects(
    () => mint.revealFor("01a01ec3-491d-74e0-8413-cb60b99d8262"),
    /unknown payment_hash/,
    "a quote id is accepted as a reference and looked up",
  );

  // So does a 32-byte hash, so the lnd backend is unaffected by the change.
  await assert.rejects(
    () => mint.revealFor("a".repeat(64)),
    /unknown payment_hash/,
    "and a payment hash still works exactly as before",
  );
});

test("a buyer who pays and never comes back does not lose their money", async (t) => {
  // The bug this covers: taking the money only ever happened inside a buyer's
  // own claim request. Pay the invoice, close the tab, and the quote sat PAID
  // until it expired — the sale succeeded and the sats stayed with the mint
  // operator. A 100% loss on a completed sale.
  const { createCashuFunding } = require("../../server/funding-cashu.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  // A stand-in mint: quotes go UNPAID -> PAID, and minting can only happen once.
  const quotes = new Map();
  let minted = 0;
  const fakeWallet = {
    createMintQuoteBolt11: async (amount) => {
      const quote = `q-${quotes.size + 1}`;
      quotes.set(quote, { state: "UNPAID", amount, expiry: Math.floor(Date.now() / 1000) + 900 });
      return { quote, request: `lntbs${amount}n1fake`, amount, expiry: quotes.get(quote).expiry, state: "UNPAID" };
    },
    checkMintQuoteBolt11: async (quote) => quotes.get(quote) || { state: "UNKNOWN" },
    mintProofsBolt11: async (amount, quote) => {
      const row = quotes.get(quote);
      if (!row || row.state !== "PAID") throw new Error("quote is not payable");
      row.state = "ISSUED";                       // a mint issues exactly once
      minted += 1;
      return [{ amount, secret: `s-${quote}`, C: "02ab", id: "keyset" }];
    },
    loadMint: async () => {},
  };

  const funding = createCashuFunding({ db, mintUrl: "https://mint.example", wallet: fakeWallet });

  const invoice = await funding.createInvoice({ amountMsat: 21000 });
  assert.ok(invoice.paymentHash, "a quote was issued");
  assert.equal(funding.balanceSat(), 0, "and nothing is owed to us yet");

  // The buyer pays — and then vanishes. No claim request ever arrives.
  quotes.get(invoice.paymentHash).state = "PAID";

  // Before the fix this was the end of the story. Now the sweep collects it.
  const first = await funding.reconcile({});
  assert.equal(first.checked, 1, "the unclaimed quote is still being watched");
  assert.equal(first.collected, 1, "and the payment is collected without the buyer");
  assert.equal(funding.balanceSat(), 21, "the sats are ours and written down");
  assert.equal(minted, 1);

  // A second pass must not mint again — the quote is settled and off the list.
  const second = await funding.reconcile({});
  assert.equal(second.checked, 0, "a collected quote is not checked forever");
  assert.equal(minted, 1, "and is never minted twice");
  assert.equal(funding.balanceSat(), 21);
});

test("the claim path and the sweep can never both mint one quote", async (t) => {
  // Minting is not idempotent at the mint: two concurrent calls mean one wins
  // and one errors, and if the winner's write is the one that fails, the proofs
  // are gone with no retry that recovers them.
  const { createCashuFunding } = require("../../server/funding-cashu.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  const quotes = new Map();
  let concurrent = 0;
  let maxConcurrent = 0;
  let minted = 0;
  const fakeWallet = {
    createMintQuoteBolt11: async (amount) => {
      const quote = "q-race";
      quotes.set(quote, { state: "PAID", amount, expiry: Math.floor(Date.now() / 1000) + 900 });
      return { quote, request: "lntbs21n1fake", amount, expiry: quotes.get(quote).expiry, state: "UNPAID" };
    },
    checkMintQuoteBolt11: async (quote) => {
      await new Promise((r) => setTimeout(r, 10));
      return quotes.get(quote) || { state: "UNKNOWN" };
    },
    mintProofsBolt11: async (amount, quote) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent -= 1;
      const row = quotes.get(quote);
      if (row.state === "ISSUED") throw new Error("quote already issued");
      row.state = "ISSUED";
      minted += 1;
      return [{ amount, secret: "s", C: "02ab", id: "keyset" }];
    },
    loadMint: async () => {},
  };

  const funding = createCashuFunding({ db, mintUrl: "https://mint.example", wallet: fakeWallet });
  const invoice = await funding.createInvoice({ amountMsat: 21000 });

  // The buyer claims at the same moment the sweep runs.
  const [claimed] = await Promise.all([
    funding.isSettled(invoice.paymentHash),
    funding.reconcile({}),
    funding.isSettled(invoice.paymentHash),
  ]);

  assert.equal(claimed, true, "the buyer still gets their pack");
  assert.equal(maxConcurrent, 1, "only one mint call was ever in flight");
  assert.equal(minted, 1, "so the quote was minted exactly once");
  assert.equal(funding.balanceSat(), 21, "and counted exactly once");
});

test("the price ladder charges by how many packs have sold", async (t) => {
  // Three tiers: the first 2100 packs are cheap, the middle band costs more,
  // and the last thousand are the expensive ones. The price must follow what
  // has actually SOLD, and must be fixed at the moment of quoting — charging
  // someone a price they were never shown is the failure to avoid.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  const mint = createNutftMint({
    db, catalogUri: "https://x/nutft/catalog",
    funding: createMockFunding({}), allowVirtual: "1",
    priceSchedule: "2100:21000,19925:420000,20925:10000000",
  });

  const infoRes = { writeHead() { return infoRes; }, end(b) { infoRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, infoRes, new URL("http://x/v1/info"));
  const nut = infoRes.parsed.nuts["31"];
  assert.equal(nut.price_msat, 21000, "nothing sold yet, so the cheapest tier is live");
  assert.deepEqual(nut.price_tiers, [
    { up_to_packs: 2100, price_msat: 21000 },
    { up_to_packs: 19925, price_msat: 420000 },
    { up_to_packs: 20925, price_msat: 10000000 },
  ], "and the whole ladder is published, so nobody is surprised by the next step");

  const first = await mint.payableQuote();
  assert.equal(first.price_msat, 21000);

  // Walk the box forward without buying, and check each boundary.
  const priceAfter = (sold) => { mint.state.nextPack = sold + 1; return mint.payableQuote(); };
  assert.equal((await priceAfter(2099)).price_msat, 21000, "pack 2100 is still the cheap tier");
  assert.equal((await priceAfter(2100)).price_msat, 420000, "pack 2101 is not");
  assert.equal((await priceAfter(19924)).price_msat, 420000, "the middle band runs to 19925");
  assert.equal((await priceAfter(19925)).price_msat, 10000000, "and the last thousand are dear");
  assert.equal((await priceAfter(20924)).price_msat, 10000000, "including the very last pack");
  assert.equal((await priceAfter(999999)).price_msat, 10000000,
    "past the end the last price stands — a ladder that wrapped would sell the scarcest packs cheapest");

  // A single flat price still behaves as one tier.
  const flat = createNutftMint({
    db: new DatabaseSync(":memory:"), catalogUri: "https://y/nutft/catalog",
    funding: createMockFunding({}), allowVirtual: "1", priceMsat: 21000,
  });
  assert.equal((await flat.payableQuote()).price_msat, 21000);

  // A ladder that steps backwards can never reach its later tiers.
  assert.throws(
    () => createNutftMint({
      db: new DatabaseSync(":memory:"), catalogUri: "https://z/nutft/catalog",
      funding: createMockFunding({}), allowVirtual: "1",
      priceSchedule: "2100:21000,1000:420000",
    }),
    /thresholds must increase/,
    "and is refused rather than quietly ignored",
  );
});

test("a closed box sells to nobody, through any door", async (t) => {
  // The premine window: between "the mint is reachable" and "we announced it",
  // one person could quietly take the whole cheap tier. The box starts closed
  // and opens deliberately — and it must be closed at EVERY entry, because a
  // gate on the claim alone would take money and then refuse the cards.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  const mint = createNutftMint({
    db, catalogUri: "https://x/nutft/catalog", publicBase: "https://x",
    funding: createMockFunding({}), allowVirtual: "1", priceMsat: 21000,
    sales: "closed",
  });

  const hit = async (path) => {
    const out = {};
    const res = { writeHead(c) { out.code = c; return res; }, end(b) { out.body = JSON.parse(b); } };
    await mint.handle({ method: "GET" }, res, new URL(`https://x${path}`));
    return out.body;
  };

  await assert.rejects(() => mint.payableQuote(), /not open yet/i, "no invoice is created");

  /* This used to assert that the claim path refuses too. It must not, on a paid
     mint: the only way to reach a claim is a settled invoice, which was issued
     while the buyer was allowed to buy and which they have already paid. A gate
     here would mean closing the box confiscates a paid pack. So the claim fails
     for the honest reason — there is no invoice behind it — not for the sale. */
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: "c1", pack_id: "pack-0001", state: "x", outputs: [] }),
    /payment_hash is required|stale booster quote/i,
    "a claim with no paid invoice behind it still goes nowhere",
  );
  assert.match((await hit("/nutft/lnurlp")).reason, /not open to wallet payments/i, "the QR path is shut too");

  /* And the case that makes the claim gate necessary at all: with no price
     there is no invoice, so requirePaidFor waves everything through and the
     claim IS the sale. Removing the gate from every claim path would have left
     a free mint completely open — which is precisely the premine it guards. */
  const free = createNutftMint({
    db: new DatabaseSync(":memory:"), catalogUri: "https://x/nutft/catalog",
    publicBase: "https://x", allowVirtual: "1", priceMsat: 0, sales: "closed",
  });
  await assert.rejects(
    () => free.signBooster({ idempotency_key: "f1", pack_id: "pack-0001", state: "x", outputs: [] }),
    /not open yet/i,
    "a free mint refuses the claim, because that is its only door",
  );
  assert.match((await hit("/nutft/lnurlp/callback?amount=21000")).reason, /not open to wallet payments/i,
    "including its callback, which is the one that would have taken the money");

  const info = await hit("/v1/info");
  assert.equal(info.nuts["31"].sales, "closed", "and the mint says so out loud");
});

test("an allowlisted box sells only to the keys on the list", async (t) => {
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  // Mixed input on purpose: an npub and a bare hex key, because an operator
  // pastes whichever they have to hand.
  const npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
  const npubHex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const hexKey = "b".repeat(64);

  const mint = createNutftMint({
    db, catalogUri: "https://x/nutft/catalog", publicBase: "https://x",
    funding: createMockFunding({}), allowVirtual: "1", priceMsat: 21000,
    sales: "allowlist", allowlist: `${npub}, ${hexKey}`,
  });

  await assert.rejects(() => mint.payableQuote(), /sign the request/i,
    "an anonymous buyer is told what is missing, not just refused");
  /* Naming a key is not proving one. This used to succeed, which is what made
     the first version of the gate no gate at all. */
  await assert.rejects(() => mint.payableQuote({ buyer: npubHex }), /sign the request/i,
    "and claiming to be a listed key buys nothing");

  /* The list itself still accepts both spellings — checked by construction
     above, since an unparsed entry would have thrown at startup. */
  assert.ok(npubHex.length === 64 && hexKey.length === 64);

  // An empty list under allowlist mode would sell to nobody while looking open.
  assert.throws(
    () => createNutftMint({
      db: new DatabaseSync(":memory:"), catalogUri: "https://y/nutft/catalog",
      funding: createMockFunding({}), allowVirtual: "1", sales: "allowlist", allowlist: "",
    }),
    /would sell to nobody/i,
    "so it is refused at startup",
  );
});

test("early access needs a signature, not a claim", async (t) => {
  // The first version of this gate read the buyer's pubkey out of the request
  // body, which proved nothing: anyone could send a listed key and walk in.
  // These tests sign for real and then try to break the signature.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const nip98 = require("../../server/nip98.js");
  const { schnorr } = require("@noble/curves/secp256k1");
  const { DatabaseSync } = await import("node:sqlite");
  const { randomBytes } = await import("node:crypto");

  const hex = (b) => Buffer.from(b).toString("hex");
  const listedSec = randomBytes(32);
  const listedPub = hex(schnorr.getPublicKey(listedSec));
  const strangerSec = randomBytes(32);
  const strangerPub = hex(schnorr.getPublicKey(strangerSec));

  /* A FIXED base, not the wall clock. Subtracting a counter from Date.now()
     looked monotonic and is not: if the clock ticks over between two calls, two
     events land on the same second, hash to the same id, and the second is
     rightly refused as a replay. That failed only under the full suite, where
     the run is slow enough for the clock to move. */
  const base = Math.floor(Date.now() / 1000);
  let tick = 0;
  const sign = (sec, { path = "/nutft/quote", method = "GET", host = "x.example", at } = {}) => {
    const event = {
      pubkey: hex(schnorr.getPublicKey(sec)),
      created_at: at ?? (base - (tick += 1)),
      kind: 27235,
      tags: [["u", `https://${host}${path}`], ["method", method]],
      content: "",
    };
    event.id = nip98.eventId(event);
    event.sig = hex(schnorr.sign(event.id, sec));
    return "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
  };

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog", publicBase: "https://x.example",
    funding: createMockFunding({}), allowVirtual: "1", priceMsat: 21000,
    sales: "allowlist", allowlist: listedPub,
  });
  const proof = (header, over = {}) =>
    ({ header, method: "GET", path: "/nutft/quote", host: "x.example", ...over });

  // The hole that was there before: naming a listed key buys nothing now.
  await assert.rejects(() => mint.payableQuote({ proof: proof("") }), /sign the request/i,
    "an unsigned request is refused");
  await assert.rejects(() => mint.payableQuote({ buyer: listedPub }), /sign the request/i,
    "and so is one that merely claims to be the listed key");

  // A real signature from a listed key works.
  const ok = await mint.payableQuote({ proof: proof(sign(listedSec)) });
  assert.ok(ok.payment_request, "a signed, listed buyer gets an invoice");

  // Replay: the very same header a second time.
  const once = sign(listedSec);
  assert.ok(await mint.payableQuote({ proof: proof(once) }), "a fresh proof works once");
  await assert.rejects(() => mint.payableQuote({ proof: proof(once) }), /already been used/i,
    "and never a second time");

  // A valid signature from a key that is not listed.
  await assert.rejects(() => mint.payableQuote({ proof: proof(sign(strangerSec)) }), /not on the list/i,
    "a stranger's real signature is still refused");

  // Bound to method, path, host and clock.
  await assert.rejects(() => mint.payableQuote({ proof: proof(sign(listedSec, { method: "POST" })) }),
    /different method/i, "a POST proof cannot be replayed as a GET");
  await assert.rejects(() => mint.payableQuote({ proof: proof(sign(listedSec, { path: "/nutft/reveal" })) }),
    /different endpoint/i, "a proof for another endpoint is refused");
  await assert.rejects(() => mint.payableQuote({ proof: proof(sign(listedSec, { host: "evil.example" })) }),
    /different host/i, "and one minted for another deployment");
  await assert.rejects(
    () => mint.payableQuote({ proof: proof(sign(listedSec, { at: Math.floor(Date.now() / 1000) - 3600 })) }),
    /expired/i, "an hour-old capture is dead");

  // Tampering: keep a valid signature, change what it authorises.
  const tampered = JSON.parse(Buffer.from(sign(listedSec).slice(6), "base64").toString("utf8"));
  tampered.tags = [["u", "https://x.example/nutft/quote"], ["method", "GET"], ["extra", "x"]];
  await assert.rejects(
    () => mint.payableQuote({ proof: proof("Nostr " + Buffer.from(JSON.stringify(tampered)).toString("base64")) }),
    /does not match its contents/i,
    "changing the event after signing breaks the recomputed id",
  );
});

test("a paid booster stays claimable even if the list changes underneath it", async (t) => {
  // The gate belongs on issuance. Re-checking a credential at claim time would
  // confiscate an invoice somebody had already paid — taking money and refusing
  // the cards, which is the one outcome worth designing against.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  const funding = createMockFunding({});
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog",
    funding, allowVirtual: "1", priceMsat: 21000, sales: "open",
  });

  const quote = await mint.payableQuote();
  const keysRes = { writeHead() { return keysRes; }, end(b) { keysRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, keysRes, new URL("https://x.example/v1/keys"));
  const keyset = keysRes.parsed.keysets[0];
  const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
  const outs = quote.cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey, blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));

  // Paid, but never claimed yet.
  funding.settle(quote.payment_hash);

  // The claim carries no credential at all, and must still succeed.
  const result = await mint.signBooster({
    idempotency_key: "late-claim", pack_id: quote.pack_id, state: quote.state,
    payment_hash: quote.payment_hash,
    outputs: outs.map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) })),
  });
  assert.equal(result.signatures.length, 7, "the pack they paid for is still theirs");
});

test("the shop proves a key only when the mint asks for one", async (t) => {
  // The round trip that matters: a header built by site/nutft-wallet.js and
  // verified by server/nip98.js. Testing either half alone would only prove
  // that two of my own assumptions agree with each other.
  const { schnorr } = require("@noble/curves/secp256k1");
  const { randomBytes } = await import("node:crypto");
  const hex = (b) => Buffer.from(b).toString("hex");

  const sec = randomBytes(32);
  const pub = hex(schnorr.getPublicKey(sec));
  let signatures = 0;
  const signer = {
    getPublicKey: async () => pub,
    signEvent: async (event) => {
      signatures += 1;
      const full = { ...event, pubkey: pub };
      full.id = createHash("sha256").update(JSON.stringify([
        0, full.pubkey, full.created_at, full.kind, full.tags, full.content,
      ])).digest("hex");
      full.sig = hex(schnorr.sign(full.id, sec));
      return full;
    },
  };

  const previous = { sales: process.env.NUTFT_SALES, list: process.env.NUTFT_ALLOWLIST };
  t.after(() => {
    if (previous.sales === undefined) delete process.env.NUTFT_SALES;
    else process.env.NUTFT_SALES = previous.sales;
    if (previous.list === undefined) delete process.env.NUTFT_ALLOWLIST;
    else process.env.NUTFT_ALLOWLIST = previous.list;
  });

  // An open box: the extension must never be touched.
  process.env.NUTFT_SALES = "open";
  delete process.env.NUTFT_ALLOWLIST;
  const open = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:",
    nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(() => open.close());
  await (await browserWallet(new Map(), fetch, signer)).buyBooster(open.url);
  assert.equal(signatures, 0, "an ordinary sale never prompts for a signature");

  // Early access, with a key on the list.
  process.env.NUTFT_SALES = "allowlist";
  process.env.NUTFT_ALLOWLIST = pub;
  const gated = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:",
    nutftCatalogUri: "http://127.0.0.1/nutft/catalog" });
  t.after(() => gated.close());

  const listed = await browserWallet(new Map(), fetch, signer);
  const bought = await listed.buyBooster(gated.url);
  assert.equal(bought.length ?? bought.owned?.length ?? 7, 7, "a listed key gets its pack");
  /* Twice, and both are load-bearing: this mint is free, so requirePaidFor
     waves the claim through and the claim is its own door. A PAID mint signs
     only the quote — the settled invoice is the receipt, and re-checking there
     would confiscate a pack the buyer had already paid for. */
  assert.equal(signatures, 2, "signed once per gated door, and only on refusal");

  // A stranger's key: really signed, really refused.
  const strangerSec = randomBytes(32);
  const strangerPub = hex(schnorr.getPublicKey(strangerSec));
  const stranger = {
    getPublicKey: async () => strangerPub,
    signEvent: async (event) => {
      const full = { ...event, pubkey: strangerPub };
      full.id = createHash("sha256").update(JSON.stringify([
        0, full.pubkey, full.created_at, full.kind, full.tags, full.content,
      ])).digest("hex");
      full.sig = hex(schnorr.sign(full.id, strangerSec));
      return full;
    },
  };
  await assert.rejects(
    () => browserWallet(new Map(), fetch, stranger).then((w) => w.buyBooster(gated.url)),
    /not on the list/i,
    "an unlisted key is refused in the mint's own words, not as a bare status code",
  );

  // No extension at all: told what to do, not handed a 400.
  await assert.rejects(
    () => browserWallet(new Map(), fetch).then((w) => w.buyBooster(gated.url)),
    /install a nostr extension/i,
    "and someone without a signer is told why, not just refused",
  );
});
