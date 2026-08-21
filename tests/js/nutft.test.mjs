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
const CENSUS = require("../../cards/nutft-census.json");
/* The pack size belongs to the census, not to this file: the mint fills slots
   straight out of cards/nutft-census.json, so a resize there has to move every
   count here with it rather than leave nineteen literals lying around. */
const PACK = CENSUS.mint.cards_per_pack;
const cashu = await import("@cashu/cashu-ts");

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const opening = (output) => ({
  secret: new TextDecoder().decode(output.secret),
  blinding_factor: output.blindingFactor.toString(16).padStart(64, "0"),
  p2pk_e: output.ephemeralE,
});

/* Well-formed outputs for a quote. Worth a helper rather than a fourth copy:
   the mint validates outputs BEFORE it consumes the invoice, so a test that
   passes `outputs: []` stops at the output check and never reaches the payment
   one — and would then assert the wrong refusal while looking correct. */
async function outputsFor(mint, quote, origin) {
  const res = { writeHead() { return res; }, end(b) { res.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, res, new URL(`${origin}/v1/keys`));
  const keyset = res.parsed.keysets[0];
  const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
  const built = quote.cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey, blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));
  return built.map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) }));
}

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
  assert.equal(snapshot.owned.length, PACK);
  assert.equal(snapshot.spent.length, 0);
  assert.equal(snapshot.invalid.length, 0);
  const recipientStorage = new Map();
  const recipient = await browserWallet(recipientStorage, fetchImpl);
  const recipientPubkey = await recipient.destination();
  const transfer = await reloaded.tradeProof(table.url, snapshot.owned[0].proof.secret, recipientPubkey);
  assert.match(transfer.token, /^cashu/);
  assert.equal((await reloaded.snapshot(table.url)).owned.length, PACK - 1);
  const poisonedState = JSON.parse(storage.get("600b:nutft-wallet"));
  poisonedState.tokens.push(transfer.token);
  storage.set("600b:nutft-wallet", JSON.stringify(poisonedState));
  const poisonedSnapshot = await (await browserWallet(storage, fetchImpl)).snapshot(table.url);
  assert.equal(poisonedSnapshot.owned.length, PACK - 1, "a proof addressed to another key is not owned");
  assert.match(poisonedSnapshot.invalid[0].error, /not addressed to this wallet/i);
  const keysetId = (await (await fetch(`${table.url}/v1/keys`)).json()).keysets[0].id;
  const decodedTransfer = cashu.getDecodedToken(transfer.token, [keysetId]);
  const duplicateToken = cashu.getEncodedToken({
    mint: table.url,
    unit: decodedTransfer.unit,
    proofs: [decodedTransfer.proofs[0], decodedTransfer.proofs[0]],
  });
  await assert.rejects(
    () => recipient.importToken(table.url, duplicateToken),
    /duplicate proof/i,
    "one incoming token cannot count the same proof twice",
  );
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
  assert.equal((await (await browserWallet(storage, fetchImpl)).snapshot(table.url)).owned.length, PACK - 2);

  // A reverse proxy serves HTML for a 502. That is transport failure, not a
  // mint refusal: the trade may already have spent its input and the pending
  // replacement is the only way to recover the card.
  let gatewayTradeResponse = true;
  const gatewayFetch = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (gatewayTradeResponse && String(url).endsWith("/nutft/trade")) {
      gatewayTradeResponse = false;
      return new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
    }
    return response;
  };
  const thirdCard = (await (await browserWallet(storage, fetchImpl)).snapshot(table.url)).owned[0].proof.secret;
  await assert.rejects(
    () => browserWallet(storage, gatewayFetch).then((wallet) => wallet.tradeProof(table.url, thirdCard, recipientPubkey)),
    /non-JSON error.*preserved/i,
  );
  const gatewayRecovered = await (await browserWallet(storage, fetchImpl)).recoverPending();
  assert.match(gatewayRecovered.token, /^cashu/);
  assert.equal((await (await browserWallet(storage, fetchImpl)).snapshot(table.url)).owned.length, PACK - 3);

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
  assert.equal(issued.cards.length, PACK);
  assert.equal((await wallet.snapshot(base)).owned.length, PACK);
});

test("browser wallet claims the invoice from an LNURL success link", async (t) => {
  const { createServer } = await import("node:http");
  const { DatabaseSync } = await import("node:sqlite");
  const { createMockFunding } = require("../../server/funding.js");
  let mint;
  const server = createServer((request, response) => mint.handle(
    request, response, new URL(request.url, `http://${request.headers.host}`),
  ));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  mint = createNutftMint({
    db, catalogUri: `${base}/nutft/catalog`, funding: createMockFunding({}),
    priceMsat: 21000, allowVirtual: "1",
  });
  const quote = await mint.payableQuote();
  const wallet = await browserWallet(new Map(), fetch);
  const issued = await wallet.claimBooster(base, quote.payment_hash, { timeoutMs: 1000 });
  assert.equal(issued.cards.length, PACK);
  assert.equal((await wallet.snapshot(base)).owned.length, PACK);
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
  const census = CENSUS;
  const censusById = new Map(census.cards.map((card) => [card.id, card]));
  assert.equal(catalog.assets.length, census.cards.length);
  for (const asset of catalog.assets) {
    assert.equal(asset.tier, censusById.get(asset.asset_id).tier, `${asset.asset_id} uses the scored mint tier`);
    assert.equal("rarity" in asset, false, `${asset.asset_id} does not leak the legacy rarity ladder into the mint catalog`);
  }
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
  assert.equal(proofs.length, PACK);
  assert.ok(proofs.every((proof) => proof.amount.toString() === "1" && proof.p2pk_e && proof.dleq));
  assert.deepEqual(proofs.map((proof) => cashu.getTag(proof.secret, "nutft")[2]), issued.cards.map((card) => card.asset_id));
  assert.ok(proofs.every((proof) => cashu.hasValidDleq(proof, proofKeyset, { require: true })));
  const token = cashu.getEncodedToken({ mint: base, unit: issued.unit, proofs });
  assert.equal(cashu.getDecodedToken(token, [keyset.id]).proofs.length, PACK);
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
  /* Pinned to the literals on purpose: these are the shares the shop prints and
     a buyer quotes back. Deriving them from the census here would assert the
     server against itself and let a resize move the published odds in silence. */
  assert.deepEqual(mintState.tier_odds, { genesis: 0.06, vault: 0.45, rare: 6.64, uncommon: 21.43, common: 71.42 });
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
  assert.throws(
    () => createNutftMint({ catalogUri: "http://127.0.0.1/nutft/catalog", lnd: fakeLnd, priceMsat: 21000 }),
    /paid mint requires a database/i,
    "a payable invoice is never issued without durable claim state",
  );
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
  assert.equal(quote.body.cards.length, PACK);

  // Unpaid: the mint must refuse before it signs anything.
  const unpaidBody = { idempotency_key: "k1", pack_id: quote.body.pack_id, state: quote.body.state, payment_hash: quote.body.payment_hash, outputs: await outputsFor(mint, quote.body, "https://x") };
  await assert.rejects(() => mint.signBooster(unpaidBody), /not settled/i, "an unsettled invoice buys nothing");

  // A payment_hash the mint never issued.
  await assert.rejects(
    () => mint.signBooster({ ...unpaidBody, payment_hash: "bb".repeat(32) }),
    /unknown payment_hash/i,
    "a made-up payment hash is refused",
  );

  // Missing entirely.
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: "k2", pack_id: quote.body.pack_id, state: quote.body.state, outputs: unpaidBody.outputs }),
    /payment_hash is required/i,
    "no payment hash at all is refused",
  );
});

test("an active invoice reserves the next pack without blocking it forever", async (t) => {
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");
  const settled = new Set();
  let issued = 0;
  const funding = {
    name: "test",
    async createInvoice() {
      issued += 1;
      const paymentHash = String(issued).padStart(64, "a");
      return { paymentRequest: `invoice-${issued}`, paymentHash };
    },
    async isSettled(hash) { return settled.has(hash); },
  };
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, funding, catalogUri: "http://127.0.0.1/nutft/catalog", priceMsat: 21000,
  });

  const [first, collision] = await Promise.allSettled([mint.payableQuote(), mint.payableQuote()]);
  assert.equal(first.status, "fulfilled");
  assert.equal(collision.status, "rejected");
  assert.match(collision.reason.message, /active invoice/i);

  settled.add(first.value.payment_hash);
  /* A settled invoice now says something different from an unsettled one --
     it is not "an active invoice" to pay, it is a booster somebody already
     bought. The reservation itself is unchanged; the "without blocking it
     forever" half of this test's own title is covered by the tombstone test
     below, which is the part that was never actually asserted here. */
  await assert.rejects(() => mint.payableQuote(), /paid for and is being collected/i,
    "a paid reservation stays reserved until claim");
  settled.clear();
  db.prepare("UPDATE nutft_invoices SET created_at = ? WHERE payment_hash = ?")
    .run("2000-01-01T00:00:00.000Z", first.value.payment_hash);
  const replacement = await mint.payableQuote();
  assert.equal(replacement.pack_id, first.value.pack_id, "an expired unpaid checkout releases the unsold pack");
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

  /* A settled invoice survives a bad request. Two probes, because they stop at
     different checks: an empty array never reaches output validation at all,
     while a malformed blinding factor gets past the count and dies inside it.
     Both must leave the invoice claimable. */
  const paidBody = bodyFor(quote, outs, "buy-1", quote.payment_hash);
  await assert.rejects(
    () => mint.signBooster({ ...paidBody, outputs: [] }),
    /one output is required per card/i,
    "the wrong number of outputs does not consume a settled invoice",
  );
  const malformed = bodyFor(quote, outs, "bad-output", quote.payment_hash);
  malformed.outputs[0].nutft.blinding_factor = "0".repeat(64);
  await assert.rejects(() => mint.signBooster(malformed), /blinding factor is invalid/i,
    "and neither does an output that is the right shape and the wrong contents");

  const result = await mint.signBooster(paidBody);
  assert.equal(result.signatures.length, PACK, "a settled invoice mints the whole pack");
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

  // Before the block exists, nobody can open it.
  const early = await mint.revealFor(quote.payment_hash);
  assert.equal(early.sealed, true);
  assert.equal(early.cards, null, "an unmined block reveals nothing");
  await assert.rejects(
    () => mint.signBooster({ idempotency_key: "s1", pack_id: quote.pack_id, state: quote.state, payment_hash: quote.payment_hash, outputs: [] }),
    /not mined yet|still sealed/i,
    "and the mint will not sign against a block that does not exist",
  );

  // The block arrives, but an unpaid buyer cannot inspect the pack and choose
  // whether it is valuable enough to settle the already-reserved invoice.
  height += 1;
  await assert.rejects(() => mint.revealFor(quote.payment_hash), /not settled/i);
  settled.add(quote.payment_hash);
  const opened = await mint.revealFor(quote.payment_hash);
  assert.equal(opened.sealed, false);
  assert.equal(opened.cards.length, PACK, "the pack opens to every card in it");
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

  // Issuance must advance the same cards that the committed block revealed.
  // Using the static demo beacon here silently corrupts the remaining census.
  const keysRes = { writeHead() { return keysRes; }, end(b) { keysRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, keysRes, new URL("http://x/v1/keys"));
  const keyset = keysRes.parsed.keysets[0];
  const pubkey = hex(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
  const outputs = opened.cards.map((card) => cashu.OutputData.createSingleP2PKData({
    pubkey, blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));
  const issuedPack = await mint.signBooster({
    idempotency_key: "sealed-1", pack_id: quote.pack_id, state: quote.state,
    payment_hash: quote.payment_hash,
    outputs: outputs.map((output) => ({ amount: 1, id: output.blindedMessage.id, B_: output.blindedMessage.B_, nutft: opening(output) })),
  });
  assert.deepEqual(
    issuedPack.resolved,
    opened.cards.slice(0, -1).map((card) => card.asset_id),
    "the committed beacon advances exactly the six capped cards it revealed",
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

  /* Unpaid behaves exactly as production does. Real outputs, deliberately: with
     an empty array this now stops at the output check and never reaches the
     payment one, so it would have asserted the wrong refusal. */
  const vOuts = await outputsFor(mint, quote, "https://x");
  const vBody = (key) => ({
    idempotency_key: key, pack_id: quote.pack_id, state: quote.state,
    /* A fresh array each time: the malformed-output case below rewrites one
       entry, and sharing the reference would corrupt the good claim too. */
    payment_hash: quote.payment_hash, outputs: vOuts.map((o) => ({ ...o })),
  });
  await assert.rejects(() => mint.signBooster(vBody("v1")), /not settled/i,
    "an unpaid virtual invoice buys nothing either");

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
  assert.equal(result.signatures.length, PACK, "a settled virtual invoice mints a real pack of proofs");

  /* The replay guard proper: a spent invoice presented against the NEXT pack.
     Outputs built for that pack, deliberately — outputs are validated before
     the invoice is consumed now, so reusing the old pack's outputs would be
     turned away by the CardBinding check and this would assert the wrong
     refusal while still passing. */
  const next = await mint.payableQuote();
  const nextOuts = await outputsFor(mint, next, "https://x");
  await assert.rejects(
    () => mint.signBooster({
      idempotency_key: "v3", pack_id: next.pack_id, state: next.state,
      payment_hash: quote.payment_hash, outputs: nextOuts,
    }),
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
     there is no invoice, so requireSettled waves everything through and the
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

  /* Both spellings, tested for real. An earlier version of this asserted
     `npubHex.length === 64` and called it coverage; it was a tautology, and the
     justification with it was wrong — a key that fails to parse is LOGGED AND
     IGNORED, not thrown on (see the parse loop in nutft-mint.js). So npub
     support could have broken silently. Two assertions close that:

     one, the parser directly. */
  const lnurl = require("../../server/lnurl.js");
  assert.equal(lnurl.toPubkeyHex(npub), npubHex, "an npub resolves to its hex key");
  assert.equal(lnurl.toPubkeyHex(hexKey.toUpperCase()), hexKey, "and hex is accepted case-insensitively");

  /* Two, that the mint really put it on the list. A mint listing ONLY the npub
     refuses to start if the list comes out empty — so construction succeeding
     IS the proof that the npub parsed into an entry. */
  const npubOnly = createNutftMint({
    db: new DatabaseSync(":memory:"), catalogUri: "https://z/nutft/catalog",
    funding: createMockFunding({}), allowVirtual: "1", sales: "allowlist", allowlist: npub,
  });
  assert.ok(npubOnly, "a list of one npub is a list of one key, not an empty one");

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
    funding: createMockFunding({ settleAfterMs: 60_000 }), allowVirtual: "1", priceMsat: 21000,
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
  db.prepare("UPDATE nutft_invoices SET created_at = ? WHERE payment_hash = ?")
    .run("2000-01-01T00:00:00.000Z", ok.payment_hash);

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

test("a buyer can ask whether they may buy without buying anything", async (t) => {
  /* Before this the only way to find out was to press Buy. The shop drew a live
     button, the mint refused after the click, and an early-access buyer learned
     they were not on the list from a failed purchase.

     /nutft/quote cannot answer the question: it creates a real invoice and
     reserves the pack, so polling it would burn boosters and then refuse the
     buyer their own next click. This endpoint has to answer without writing
     anything, and that is what the second half of this test measures. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const nip98 = require("../../server/nip98.js");
  const { schnorr } = require("@noble/curves/secp256k1");
  const { DatabaseSync } = await import("node:sqlite");
  const { randomBytes } = await import("node:crypto");

  const hexOf = (b) => Buffer.from(b).toString("hex");
  const listedSec = randomBytes(32);
  const listedPub = hexOf(schnorr.getPublicKey(listedSec));
  const strangerSec = randomBytes(32);

  /* A nonce per event. Two signatures inside the same second are the same
     event, hash to the same id, and the second is correctly refused as a
     replay -- which would be the replay store passing, not this endpoint. */
  let nonce = 0;
  const sign = (sec, path = "/nutft/eligibility") => {
    nonce += 1;
    const event = {
      pubkey: hexOf(schnorr.getPublicKey(sec)), created_at: Math.floor(Date.now() / 1000),
      kind: 27235, content: "",
      tags: [["u", `https://x.example${path}`], ["method", "GET"], ["nonce", String(nonce)]],
    };
    event.id = nip98.eventId(event);
    event.sig = hexOf(schnorr.sign(event.id, sec));
    return "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
  };

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog", publicBase: "https://x.example",
    funding, allowVirtual: "1", priceMsat: 21000,
    sales: "allowlist", allowlist: listedPub,
  });

  const ask = async (header) => {
    const res = { writeHead(code) { res.code = code; return res; }, end(b) { res.parsed = JSON.parse(b); } };
    await mint.handle(
      { method: "GET", headers: header ? { authorization: header } : {} },
      res, new URL("https://x.example/nutft/eligibility"),
    );
    return res;
  };

  /* Unsigned: a plain answer, not an error. "No" is a successful reply to the
     question that was asked. */
  const anonymous = await ask("");
  assert.equal(anonymous.code, 200, "the question was answered, not refused");
  assert.equal(anonymous.parsed.sales, "allowlist");
  assert.equal(anonymous.parsed.may_buy, false);
  assert.match(anonymous.parsed.reason, /sign the request/i,
    "and it says what is missing rather than leaving the buyer to guess");

  // A real signature from a key nobody listed.
  const stranger = await ask(sign(strangerSec));
  assert.equal(stranger.code, 200);
  assert.equal(stranger.parsed.may_buy, false);
  assert.match(stranger.parsed.reason, /not on the list/i);

  // A real signature from a listed key.
  const listed = await ask(sign(listedSec));
  assert.equal(listed.code, 200);
  assert.equal(listed.parsed.may_buy, true, "a listed key is told yes before it clicks");
  assert.equal(listed.parsed.sales, "allowlist");

  /* THE POINT. Asking must cost nothing: the pack on the counter, the sold
     count and the invoice table are all exactly as they were. A probe that
     moved any of them would sell the box to whoever checked it most. */
  const stateRes = { writeHead() { return stateRes; }, end(b) { stateRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, stateRes, new URL("https://x.example/nutft/state"));
  assert.equal(stateRes.parsed.sold, 0, "no pack was sold by asking");
  assert.equal(mint.state.nextPack, 1, "and the pack on the counter is still the first one");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nutft_invoices").get().n, 0,
    "not one invoice was written");

  /* The yes has to survive being acted on: quoting after a yes still works, so
     the probe did not quietly consume the buyer's turn. */
  const quote = await mint.payableQuote({ proof: {
    header: sign(listedSec, "/nutft/quote"), method: "GET", path: "/nutft/quote", host: "x.example",
  } });
  assert.ok(quote.payment_request, "and the yes it gave was a true one");
});

test("the eligibility answer never describes anybody but the caller", async (t) => {
  /* An early-access roster is a list of people about to hold something
     valuable. The endpoint answers about one key -- the one that signed -- and
     its reply must not leak the list, its length, or whether some other key is
     on it. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const nip98 = require("../../server/nip98.js");
  const { schnorr } = require("@noble/curves/secp256k1");
  const { DatabaseSync } = await import("node:sqlite");
  const { randomBytes } = await import("node:crypto");

  const hexOf = (b) => Buffer.from(b).toString("hex");
  const keys = Array.from({ length: 7 }, () => {
    const sec = randomBytes(32);
    return { sec, pub: hexOf(schnorr.getPublicKey(sec)) };
  });

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog", publicBase: "https://x.example",
    sales: "allowlist", allowlist: keys.map((k) => k.pub).join(","),
  });

  const event = {
    pubkey: keys[0].pub, created_at: Math.floor(Date.now() / 1000), kind: 27235, content: "",
    tags: [["u", "https://x.example/nutft/eligibility"], ["method", "GET"]],
  };
  event.id = nip98.eventId(event);
  event.sig = hexOf(schnorr.sign(event.id, keys[0].sec));

  const res = { writeHead(code) { res.code = code; return res; }, end(b) { res.body = b; res.parsed = JSON.parse(b); } };
  await mint.handle(
    { method: "GET", headers: { authorization: "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64") } },
    res, new URL("https://x.example/nutft/eligibility"),
  );

  assert.equal(res.parsed.may_buy, true);
  assert.deepEqual(Object.keys(res.parsed).sort(), ["may_buy", "reason", "sales"],
    "three fields, and nothing that grew in beside them");
  /* Seven listed keys and no seven anywhere in the body is the whole
     assertion. */
  for (const other of keys.slice(1)) {
    assert.equal(res.body.includes(other.pub), false, "another listed key is never named");
  }
  assert.equal(res.body.includes(keys[0].pub), false,
    "and the caller is not echoed back either -- they signed it, they know it");
  assert.equal(/(^|[^0-9])7([^0-9]|$)/.test(res.body), false, "the size of the list is not published");
});

test("eligibility says no to a key that has already taken its starter set", async (t) => {
  /* NUTFT_ONE_PER_KEY lives in payableQuoteOnce, not in requireMayBuy, so an
     answer built on requireMayBuy alone would say yes to a key that is out of
     allocation -- and the buyer would be refused at the click anyway, which is
     the exact failure this endpoint exists to remove. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const nip98 = require("../../server/nip98.js");
  const { schnorr } = require("@noble/curves/secp256k1");
  const { DatabaseSync } = await import("node:sqlite");
  const { randomBytes } = await import("node:crypto");

  const hexOf = (b) => Buffer.from(b).toString("hex");
  const key = () => { const sec = randomBytes(32); return { sec, pub: hexOf(schnorr.getPublicKey(sec)) }; };
  const alice = key(), bob = key();

  let nonce = 0;
  const proofFor = (who, path) => {
    nonce += 1;
    const event = {
      pubkey: who.pub, created_at: Math.floor(Date.now() / 1000), kind: 27235, content: "",
      tags: [["u", `https://g.example${path}`], ["method", "GET"], ["nonce", String(nonce)]],
    };
    event.id = nip98.eventId(event);
    event.sig = hexOf(schnorr.sign(event.id, who.sec));
    return "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
  };

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const funding = createMockFunding({});
  const mint = createNutftMint({
    db, catalogUri: "https://g.example/nutft/catalog", publicBase: "https://g.example",
    funding, allowVirtual: "1", priceMsat: 210_000,
    sales: "allowlist", allowlist: `${alice.pub},${bob.pub}`, onePerKey: true,
  });

  const ask = async (who) => {
    const res = { writeHead(code) { res.code = code; return res; }, end(b) { res.parsed = JSON.parse(b); } };
    await mint.handle(
      { method: "GET", headers: { authorization: proofFor(who, "/nutft/eligibility") } },
      res, new URL("https://g.example/nutft/eligibility"),
    );
    return res.parsed;
  };

  assert.equal((await ask(alice)).may_buy, true, "before she buys, Alice is told yes");

  const quote = await mint.payableQuote({ proof: {
    header: proofFor(alice, "/nutft/quote"), method: "GET", path: "/nutft/quote", host: "g.example",
  } });
  funding.settle(quote.payment_hash);
  const issued = await mint.signBooster({
    idempotency_key: "alice-1", pack_id: quote.pack_id, state: quote.state,
    payment_hash: quote.payment_hash,
    outputs: await outputsFor(mint, quote, "https://g.example"),
  });
  assert.equal(issued.signatures.length, PACK, "she takes her one set");

  const after = await ask(alice);
  assert.equal(after.may_buy, false, "and is told so before she reaches for the button again");
  assert.match(after.reason, /already taken its allocation/i,
    "in the same words the quote uses, so the two cannot drift apart");

  // Per KEY, not per mint: the flag must not shut the shop for everyone else.
  assert.equal((await ask(bob)).may_buy, true, "a different listed key is unaffected");
});

test("a shut till says who you are without promising a sale", async (t) => {
  /* The cutover state. Somebody who signs in the night before the box opens
     gets an honest "not yet" rather than a yes they cannot act on -- and
     `closed` is decided before any signature is looked at, so the mint learns
     nothing about a key it is not going to serve. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog", publicBase: "https://x.example",
    sales: "closed",
  });

  const res = { writeHead(code) { res.code = code; return res; }, end(b) { res.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET", headers: {} }, res, new URL("https://x.example/nutft/eligibility"));
  assert.equal(res.code, 200);
  assert.equal(res.parsed.sales, "closed", "the shop can tell a shut till from a refused key");
  assert.equal(res.parsed.may_buy, false);
  assert.match(res.parsed.reason, /not open yet/i);
});

test("an open box needs no signature to answer yes", async (t) => {
  /* E1 sells to anybody. Asking must not turn an open sale into one that pops a
     nostr extension -- the answer is already known without a key. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog", publicBase: "https://x.example", sales: "open",
  });

  const res = { writeHead(code) { res.code = code; return res; }, end(b) { res.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET", headers: {} }, res, new URL("https://x.example/nutft/eligibility"));
  assert.equal(res.code, 200);
  assert.equal(res.parsed.sales, "open");
  assert.equal(res.parsed.may_buy, true, "an unsigned request is enough where the box is open");
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

  /* ALLOWLIST, not open. This test is named for the paid-claim decision and
     used to run with sales:"open" — where requireMayBuy returns on its first
     line, so the whole thing passed against a full revert of the security fix.
     It proved nothing it claimed to prove. */
  const { schnorr } = require("@noble/curves/secp256k1");
  const { randomBytes } = await import("node:crypto");
  const buyerSec = randomBytes(32);
  const buyerPub = Buffer.from(schnorr.getPublicKey(buyerSec)).toString("hex");

  const funding = createMockFunding({});
  const mint = createNutftMint({
    db, catalogUri: "https://x.example/nutft/catalog", publicBase: "https://x.example",
    funding, allowVirtual: "1", priceMsat: 21000,
    sales: "allowlist", allowlist: buyerPub,
  });

  /* Bought properly: a real signature, from a listed key, at quote time. */
  const nip98 = require("../../server/nip98.js");
  const authEvent = {
    pubkey: buyerPub, created_at: Math.floor(Date.now() / 1000), kind: 27235, content: "",
    tags: [["u", "https://x.example/nutft/quote"], ["method", "GET"]],
  };
  authEvent.id = nip98.eventId(authEvent);
  authEvent.sig = Buffer.from(schnorr.sign(authEvent.id, buyerSec)).toString("hex");
  const quote = await mint.payableQuote({ proof: {
    header: "Nostr " + Buffer.from(JSON.stringify(authEvent)).toString("base64"),
    method: "GET", path: "/nutft/quote", host: "x.example",
  } });
  assert.ok(quote.payment_request, "the gate let a listed buyer through at quote time");
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

  /* And now the point: the claim carries NO credential whatsoever. The mint is
     still in allowlist mode, so a gate on this path would refuse — and would be
     refusing a pack this buyer has already paid for. */
  const result = await mint.signBooster({
    idempotency_key: "late-claim", pack_id: quote.pack_id, state: quote.state,
    payment_hash: quote.payment_hash,
    outputs: outs.map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) })),
  });
  assert.equal(result.signatures.length, PACK, "the pack they paid for is still theirs");
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
  /* Asserted on the real shape. This was once a `?? PACK` fallback compared
     against PACK — a chain that reaches the literal whenever the shape is
     unexpected, so it read as coverage while asserting PACK === PACK. */
  assert.equal(bought.cards.length, PACK, "a listed key gets a whole pack");
  /* Twice, and both are load-bearing: this mint is free, so requireSettled
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

test("verifying a signature costs an attacker nothing that persists", async (t) => {
  // The first version consumed a replay slot inside verify(), before anyone had
  // decided the key was allowed. A signature is free to produce, so a stranger
  // could fill a store that refuses when full and lock every listed buyer out
  // of their own early access. Fail-closed had become the weapon.
  const nip98 = require("../../server/nip98.js");
  const { schnorr } = require("@noble/curves/secp256k1");
  const { randomBytes } = await import("node:crypto");
  const hex = (b) => Buffer.from(b).toString("hex");

  const sec = randomBytes(32);
  const event = {
    pubkey: hex(schnorr.getPublicKey(sec)), created_at: Math.floor(Date.now() / 1000),
    kind: 27235, content: "", tags: [["u", "https://m.example/nutft/quote"], ["method", "GET"]],
  };
  event.id = nip98.eventId(event);
  event.sig = hex(schnorr.sign(event.id, sec));
  const header = "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64");
  const opts = { method: "GET", path: "/nutft/quote", host: "m.example" };

  const first = nip98.verify(header, opts);
  const second = nip98.verify(header, opts);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true, "verify() is pure — it does not spend a replay slot");
  assert.equal(first.id, second.id);
  assert.ok(first.createdAt && first.now, "and it hands back what the caller needs to admit");
});

test("the replay store refuses rather than forgets, and cannot be stranded", async (t) => {
  const { createSeenStore, MAX_SEEN } = require("../../server/nip98.js");
  const now = 1_700_000_000;

  const store = createSeenStore(60);
  assert.equal(store.maxAgeSeconds, 60, "the store publishes its own window so verify cannot drift from it");

  assert.equal(store.admit("a".repeat(64), now, now), true, "a fresh id is admitted");
  assert.equal(store.admit("a".repeat(64), now, now), false, "the same id never twice");

  // Full means refuse. Evicting to make room is the one behaviour that would
  // reopen replay under exactly the load an attacker creates.
  const full = createSeenStore(60);
  for (let i = 0; i < MAX_SEEN; i += 1) full.admit(i.toString(16).padStart(64, "0"), now, now);
  assert.equal(full.size, MAX_SEEN);
  assert.equal(full.admit("f".repeat(64), now, now), false, "a full store refuses");
  assert.equal(full.admit("0".repeat(64), now, now), false, "and has forgotten nothing it held");

  // Time passing must actually free it.
  assert.equal(full.admit("f".repeat(64), now + 61, now + 61), true, "once the window passes it fills again");

  /* A future-dated head must not strand the entries behind it. created_at comes
     from the client and the acceptance window tolerates skew in both
     directions, so the prune loop cannot stop at the first live-looking entry:
     one such proof would double how long the store stays full. */
  const stranded = createSeenStore(60);
  stranded.admit("1".repeat(64), now + 55, now);     // future-dated, looks fresh forever
  for (let i = 0; i < 10; i += 1) stranded.admit(`2${i}`.padStart(64, "0"), now, now);
  assert.equal(stranded.size, 11);
  stranded.admit("3".repeat(64), now + 200, now + 200);
  assert.equal(stranded.size, 1, "the sweep reached past the future-dated entry and cleared the rest");
});

test("a mint that cannot be reached keeps the booster you paid for", async (t) => {
  // The regression this exists for: reading the mint's error was rewritten to
  // swallow a non-JSON body, and submitPending discards the pending on any
  // refusal it does not recognise. A 502 from a proxy — an HTML page, not JSON —
  // therefore destroyed the outputs of a buyer who had already paid. Before the
  // rewrite the raw .json() threw and the pending survived by accident.
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());

  const storage = new Map();
  let breakClaim = false;
  const fetchImpl = async (url, options) => {
    if (breakClaim && String(url).endsWith("/nutft/booster")) {
      return new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502, headers: { "content-type": "text/html" },
      });
    }
    return fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);
  };

  breakClaim = true;
  await assert.rejects(
    () => browserWallet(storage, fetchImpl).then((w) => w.buyBooster(table.url)),
    /non-JSON error|preserved for retry/i,
    "the buyer is told the truth: a gateway failed, not that the mint refused",
  );

  const saved = JSON.parse(storage.get("600b:nutft-wallet"));
  assert.ok(saved.pending, "and the pending SURVIVES — those outputs are the booster");

  // And it really is recoverable once the gateway is back.
  breakClaim = false;
  const recovered = await (await browserWallet(storage, fetchImpl)).recoverPending();
  assert.equal(recovered.cards.length, PACK, "the same outputs claim the same pack");
  assert.equal(JSON.parse(storage.get("600b:nutft-wallet")).pending, null, "and the pending is then cleared");
});

test("a malformed output must not burn the invoice behind it", async (t) => {
  // The invoice is claimed inside the issuance transaction, not when settlement
  // is checked. It used to be consumed in requirePaidFor, before the outputs
  // were even validated, so a single bad output left a paying buyer with a
  // spent invoice, no cards, and no retry that could recover either.
  //
  // This test outlived two different fixes for that. The first reordered the
  // checks; the second — the one that stands — moved the claim into the same
  // atomic() as issuance, which covers every failure after settlement rather
  // than only a malformed output. The test did not need to change for either,
  // which is the point of asserting the PROPERTY and not the mechanism.
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());

  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const mint = createNutftMint({
    db, catalogUri: "https://burn.example/nutft/catalog",
    funding, priceMsat: 21000, allowVirtual: "1",
  });

  const quote = await mint.payableQuote();
  const good = await outputsFor(mint, quote, "https://burn.example");
  funding.settle(quote.payment_hash);

  const body = (key, outputs) => ({
    idempotency_key: key, pack_id: quote.pack_id, state: quote.state,
    payment_hash: quote.payment_hash, outputs,
  });

  const mangled = good.map((o) => ({ ...o }));
  mangled[3] = { ...mangled[3], B_: "not-a-point" };
  await assert.rejects(() => mint.signBooster(body("burn-1", mangled)), /hex|B_|output|point/i,
    "the malformed output is refused");

  const recovered = await mint.signBooster(body("burn-2", good));
  assert.equal(recovered.signatures.length, PACK,
    "and the invoice survives it — the buyer gets the pack they paid for");
});

test("one unreadable token does not take the whole wallet with it", async (t) => {
  // The bug this exists for: proofs() decoded every token in a bare flatMap, so
  // a single token this mint cannot open threw and the WHOLE wallet went dark.
  // Not a rare state -- a token from before a keyset rotation, or one bought
  // from a different mint entirely, can never decode here. It blanked the
  // wallet page, dropped the Stack Builder out of OG mode for good, and made
  // every trade impossible, with no way out but clearing storage and losing
  // every good card too.
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());
  const fetchImpl = (url, options) => fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);

  const storage = new Map();
  await (await browserWallet(storage, fetchImpl)).buyBooster(table.url);
  const good = await (await browserWallet(storage, fetchImpl)).snapshot(table.url);
  assert.equal(good.owned.length, PACK, "the pack is there to begin with");

  /* A token from somewhere this mint cannot read. Its shape is a valid cashu
     token; its keyset is not one this mint has ever issued. */
  const saved = JSON.parse(storage.get("600b:nutft-wallet"));
  saved.tokens.push("cashuBo2FteBtodHRwOi8vMTI3LjAuMC4xOjEvbm90LWEtbWludGF1Y3NhdGF0gaJhaUgBE10Iy15HS2Fwgw==");
  storage.set("600b:nutft-wallet", JSON.stringify(saved));

  const after = await (await browserWallet(storage, fetchImpl)).snapshot(table.url);
  assert.equal(after.owned.length, PACK, "every good card is still readable");
  assert.equal(after.unreadable.length, 1, "and the one this mint cannot open is reported, not fatal");
  assert.match(after.unreadable[0].error, /.+/, "with the reason it could not be read");

  /* The bucket is its own, not folded into `invalid`: an invalid proof is one
     the mint HAS an opinion about, an unreadable token is one it cannot open. */
  assert.equal(after.invalid.length, 0, "an unreadable token is not an invalid proof");
});

test("a dead token does not block trading the cards around it", async (t) => {
  // The wallet fix let snapshot() survive an unreadable token. Trading is the
  // other path through the same decode, and it is the one that costs a card:
  // tradeProof spends the input proof at the mint, so if it refused to run
  // while a dead token sat in storage, the only workaround would be clearing
  // storage -- destroying every good card to move one.
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());
  const fetchImpl = (url, options) => fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);

  const storage = new Map();
  await (await browserWallet(storage, fetchImpl)).buyBooster(table.url);

  // A token from a mint this one has never heard of, wedged in beside the pack.
  const saved = JSON.parse(storage.get("600b:nutft-wallet"));
  saved.tokens.push("cashuBo2FteBtodHRwOi8vMTI3LjAuMC4xOjEvbm90LWEtbWludGF1Y3NhdGF0gaJhaUgBE10Iy15HS2Fwgw==");
  storage.set("600b:nutft-wallet", JSON.stringify(saved));

  const recipient = await browserWallet(new Map(), fetchImpl);
  const recipientPubkey = await recipient.destination();

  const sender = await browserWallet(storage, fetchImpl);
  const before = await sender.snapshot(table.url);
  assert.equal(before.owned.length, PACK);
  assert.equal(before.unreadable.length, 1, "the dead token is present for the whole test");

  const card = before.owned[0];
  const transfer = await sender.tradeProof(table.url, card.proof.secret, recipientPubkey);
  assert.match(transfer.token, /^cashu/, "the trade goes through with the dead token still in storage");

  const after = await (await browserWallet(storage, fetchImpl)).snapshot(table.url);
  assert.equal(after.owned.length, PACK - 1, "the sender is one card lighter");
  assert.equal(after.unreadable.length, 1, "and the dead token is still just sitting there, harmless");

  assert.equal(await recipient.importToken(table.url, transfer.token), 1, "the recipient takes it");
  const got = await recipient.snapshot(table.url);
  assert.equal(got.owned.length, 1);
  assert.equal(got.owned[0].asset.asset_id, card.asset.asset_id, "and it is the same card that was sent");
});

test("a sent card survives the tab being closed", async (t) => {
  // The hole this closes cost a real card during development. finishPending
  // built the recipient's token, returned it, and wrote NOTHING. At that moment
  // the sender no longer holds the card, the recipient does not have it yet,
  // and the token is locked to a key only the recipient has -- so the single
  // copy lived in whatever variable the caller happened to keep. A reload, a
  // closed tab or a crash between the trade and the hand-off destroyed the card
  // outright, claimable by nobody, forever.
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());
  const fetchImpl = (url, options) => fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);

  const storage = new Map();
  await (await browserWallet(storage, fetchImpl)).buyBooster(table.url);
  const recipient = await browserWallet(new Map(), fetchImpl);
  const recipientPubkey = await recipient.destination();

  const sender = await browserWallet(storage, fetchImpl);
  const card = (await sender.snapshot(table.url)).owned[0];
  const sent = await sender.tradeProof(table.url, card.proof.secret, recipientPubkey);

  /* Throw away everything the caller was handed, and reload from storage --
     exactly what closing the tab does. */
  const reloaded = await browserWallet(storage, fetchImpl);
  const pendingTransfers = await reloaded.outgoing();
  assert.equal(pendingTransfers.length, 1, "the transfer is still findable after a reload");
  assert.equal(pendingTransfers[0].token, sent.token, "and it is the same token the recipient needs");

  assert.equal(await recipient.importToken(table.url, pendingTransfers[0].token), 1,
    "recovered from storage alone, it still claims the card");

  /* Forgetting is deliberate: this wallet cannot see whether the other side
     claimed it, so only a person can say the transfer is done. */
  assert.equal(await reloaded.forgetOutgoing(sent.token), 0, "and it clears only when told");
  assert.equal((await (await browserWallet(storage, fetchImpl)).outgoing()).length, 0);
});

test("sending a card never quietly finishes a different transfer", async (t) => {
  // tradeProof opened with `if (state.pending) return submitPending(...)`, so
  // asking to send card X while an older transfer was unfinished completed the
  // OLDER trade and handed back a token for card Y -- while the caller had
  // every reason to believe it had just sent X.
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());
  const fetchImpl = (url, options) => fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);

  const storage = new Map();
  await (await browserWallet(storage, fetchImpl)).buyBooster(table.url);
  const recipientPubkey = await (await browserWallet(new Map(), fetchImpl)).destination();

  // Wedge a pending in, the way a dropped response leaves one.
  const owned = (await (await browserWallet(storage, fetchImpl)).snapshot(table.url)).owned;
  let drop = true;
  const flaky = async (url, options) => {
    if (drop && String(url).endsWith("/nutft/trade")) { drop = false; throw new Error("simulated lost response"); }
    return fetchImpl(url, options);
  };
  await assert.rejects(
    () => browserWallet(storage, flaky).then((w) => w.tradeProof(table.url, owned[0].proof.secret, recipientPubkey)),
    /lost response/,
  );
  assert.ok(JSON.parse(storage.get("600b:nutft-wallet")).pending, "a pending is sitting there");

  await assert.rejects(
    () => browserWallet(storage, fetchImpl).then((w) => w.tradeProof(table.url, owned[1].proof.secret, recipientPubkey)),
    /finish the transfer already in progress/i,
    "a second send is refused rather than completing the first one under its name",
  );

  // The explicit route still works, and finishes the transfer that was actually started.
  const recovered = await (await browserWallet(storage, fetchImpl)).recoverPending();
  assert.match(recovered.token, /^cashu/);
  assert.equal((await (await browserWallet(storage, fetchImpl)).outgoing()).length, 1,
    "and it is written down like any other outgoing transfer");
});

test("a second tab cannot overwrite the pending the first one is waiting on", async (t) => {
  // read() returned a process-local cache and never looked at storage again, so
  // a wallet opened before another tab created a pending could not see it. The
  // send guard passed, and the trade's write() then replaced the booster pending
  // with its own. For a PAID booster that destroys the outputs: the sats are
  // gone and there is nothing left to claim with. Two open tabs is the normal
  // case here -- the site moves players between shop.html and wallet.html.
  const catalogUri = "http://127.0.0.1/nutft/catalog";
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: catalogUri });
  t.after(() => table.close());
  const fetchImpl = (url, options) => fetch(url === catalogUri ? `${table.url}/nutft/catalog` : url, options);

  // One storage, two wallet instances: that IS two tabs.
  const storage = new Map();
  await (await browserWallet(storage, fetchImpl)).buyBooster(table.url);
  const recipientPubkey = await (await browserWallet(new Map(), fetchImpl)).destination();

  const tabB = await browserWallet(storage, fetchImpl);
  const owned = (await tabB.snapshot(table.url)).owned;      // tabB caches state here

  // Tab A leaves a pending behind, the way a dropped response does.
  const tabA = await browserWallet(storage, fetchImpl);
  let drop = true;
  const flaky = async (url, options) => {
    if (drop && String(url).endsWith("/nutft/trade")) { drop = false; throw new Error("simulated lost response"); }
    return fetchImpl(url, options);
  };
  const tabAFlaky = await browserWallet(storage, flaky);
  await assert.rejects(() => tabAFlaky.tradeProof(table.url, owned[0].proof.secret, recipientPubkey), /lost response/);
  const parked = JSON.parse(storage.get("600b:nutft-wallet")).pending;
  assert.ok(parked, "tab A parked a pending in shared storage");

  // Tab B, which cached its state BEFORE that, must still see it.
  await assert.rejects(
    () => tabB.tradeProof(table.url, owned[1].proof.secret, recipientPubkey),
    /finish the transfer already in progress/i,
    "the other tab's pending is visible, so the send is refused instead of overwriting it",
  );
  assert.deepEqual(JSON.parse(storage.get("600b:nutft-wallet")).pending, parked,
    "and the parked pending is untouched");
});

test("the phoenixd funding source refuses to leak its own password", async (t) => {
  // That password is a bearer credential for a funded node. Plain HTTP across a
  // network hands it to anyone on the path, so a non-loopback host has to be a
  // deliberate choice rather than a default nobody noticed.
  const phoenixd = require("../../server/phoenixd.js");

  assert.equal(phoenixd.readConfig({ url: "" }), null, "no URL, no backend");

  assert.throws(() => phoenixd.readConfig({ url: "http://127.0.0.1:9740" }),
    /no password/i, "a URL without a password is a misconfiguration, not a default");

  assert.throws(() => phoenixd.readConfig({ url: "http://10.0.0.5:9740", password: "x" }),
    /in clear over the network/i, "and a remote host over plain http is refused by default");

  assert.ok(phoenixd.readConfig({ url: "http://127.0.0.1:9740", password: "x" }),
    "loopback is the ordinary case and needs no flag");
  assert.ok(phoenixd.readConfig({ url: "https://phoenix.example", password: "x" }),
    "so is a remote host behind TLS");
  assert.ok(phoenixd.readConfig({ url: "http://10.0.0.5:9740", password: "x", allowRemote: true }),
    "and a private hop can be declared deliberately");
});

test("a phoenixd mint prices in whole sats or says why not", async (t) => {
  // phoenixd invoices in sats. Rounding a fractional price would quietly charge
  // something other than the number on the page, so it is a configuration error
  // rather than something to paper over.
  const phoenixd = require("../../server/phoenixd.js");
  const config = phoenixd.readConfig({ url: "http://127.0.0.1:1", password: "x", timeoutMs: 200 });

  await assert.rejects(() => phoenixd.createInvoice(config, { amountMsat: 21_500 }),
    /whole number of sats/i, "a price that is not whole sats is refused before any connection");

  /* And a node that is not there must look like a failure, never like a sale. */
  await assert.rejects(() => phoenixd.createInvoice(config, { amountMsat: 21_000 }),
    /phoenixd request failed|did not answer in time/i,
    "an unreachable node is an error, not a silent success");
});

test("an underpaid invoice is not a sale", async (t) => {
  // BOLT 4 lets a payer send up to twice what was asked, and phoenixd sets
  // isPaid without regard to how much actually arrived. So the received figure
  // is the only one worth reading -- and nothing else in the system compares it
  // against what was invoiced, because only the caller knows that number.
  const phoenixd = require("../../server/phoenixd.js");
  const http = await import("node:http");

  let reply = { receivedSat: 0, isPaid: true };
  let status = 200;
  const server = http.createServer((req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const config = phoenixd.readConfig({
    url: `http://127.0.0.1:${server.address().port}`, password: "x", timeoutMs: 2000,
  });

  reply = { receivedSat: 0, isPaid: true };
  assert.equal(await phoenixd.isSettled(config, "h", 21_000), false,
    "isPaid with nothing received is not a payment");

  reply = { receivedSat: 20, isPaid: true, completedAt: 1 };
  assert.equal(await phoenixd.isSettled(config, "h", 21_000), false,
    "20 sat against a 21 sat invoice is short, however complete phoenixd calls it");

  reply = { receivedSat: 21, isPaid: true, completedAt: 1 };
  assert.equal(await phoenixd.isSettled(config, "h", 21_000), true, "exactly the price is a sale");

  reply = { receivedSat: 42, isPaid: true, completedAt: 1 };
  assert.equal(await phoenixd.isSettled(config, "h", 21_000), true,
    "and an overpayment is still a sale — BOLT 4 permits it and the buyer gets their pack");

  status = 404;
  assert.equal(await phoenixd.isSettled(config, "h", 21_000), false,
    "a payment that does not exist yet is not paid");

  status = 500;
  await assert.rejects(() => phoenixd.isSettled(config, "h", 21_000), /could not report/i,
    "and a node that cannot answer is an error, never a silent sale");
});

test("phoenixd reports what it can spend apart from what it merely owes itself", async (t) => {
  // With no channel open, an incoming payment lands in the FEE CREDIT rather
  // than the balance: it counts towards opening a channel later, it cannot be
  // spent or withdrawn, and ACINQ do not refund it. At maxFeeCredit incoming
  // payments start being REFUSED, so a shop can sell happily, pay nobody, and
  // then stop taking money with nothing in our logs to explain it.
  const phoenixd = require("../../server/phoenixd.js");
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ balanceSat: 0, feeCreditSat: 25210 }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const config = phoenixd.readConfig({
    url: `http://127.0.0.1:${server.address().port}`, password: "x", timeoutMs: 2000,
  });

  const state = await phoenixd.balance(config);
  assert.equal(state.balanceSat, 0, "nothing is spendable");
  assert.equal(state.feeCreditSat, 25210, "and the fee credit is visible rather than hidden behind it");
  assert.equal(await phoenixd.balanceSat(config), 0,
    "balanceSat means spendable, so a payout path cannot mistake fee credit for money it can send");
});

test("the state endpoint says whether the till is open", async (t) => {
  /* The shop reads /nutft/state and nothing else. `sales` used to live only in
     /v1/info, so a CLOSED mint still drew a live "Buy a booster" button and the
     refusal arrived after the click, from the server. That is the cutover state
     production starts in, so the shop has to be able to see it BEFORE the
     click -- a control that looks live and does nothing is exactly what that
     page says it exists not to be. */
  const { DatabaseSync } = await import("node:sqlite");
  const { createNutftMint } = require("../../server/nutft-mint.js");

  const hitOn = (mint) => async (path) => {
    const out = { code: 0, body: null };
    const res = { writeHead(c) { out.code = c; return res; }, end(b) { out.body = b ? JSON.parse(b) : null; } };
    await mint.handle({ method: "GET", on: () => {}, setEncoding: () => {} }, res, new URL(`http://x${path}`));
    return out;
  };

  for (const sales of ["open", "closed"]) {
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    const mint = createNutftMint({ db, catalogUri: "http://127.0.0.1/nutft/catalog", sales });
    const hit = hitOn(mint);

    const state = await hit("/nutft/state");
    assert.equal(state.code, 200);
    assert.equal(state.body.sales, sales, `/nutft/state must publish sales=${sales}`);

    const info = await hit("/v1/info");
    assert.equal(info.body.nuts["31"].sales, sales, "the two endpoints must not disagree");
  }
});

test("a paid booster is reserved for its buyer, and does not become a tombstone", async (t) => {
  /* `settled ||` short-circuited the age check, so a PAID but never-claimed
     invoice blocked its pack forever -- and nextPack only advances on a claim,
     so that pack stays "next" forever too. One buyer paying and closing the tab
     stopped the whole shop, and the error told them to wait for an expiry that
     could not arrive.

     Nothing has to be given back when the hold lapses: state.counts is
     decremented in the CLAIM, so an unclaimed pack never left the mint. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");

  const settled = new Set();
  let issued = 0;
  const fakeLnd = { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 1000 };
  const lnd = require("../../server/lnd.js");
  const realCreate = lnd.createInvoice, realSettled = lnd.isSettled;
  lnd.createInvoice = async () => {
    issued += 1;
    return { paymentRequest: `lnbc-fake-${issued}`, paymentHash: "aa".repeat(16) + String(issued).padStart(32, "0") };
  };
  lnd.isSettled = async (_c, hash) => settled.has(hash);
  t.after(() => { lnd.createInvoice = realCreate; lnd.isSettled = realSettled; });

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const mint = createNutftMint({
    db, catalogUri: "http://127.0.0.1/nutft/catalog", lnd: fakeLnd, priceMsat: 21000,
    invoiceTtlSeconds: 60, claimGraceSeconds: 60,
  });
  const quote = async () => {
    const out = { code: 0, body: null };
    const res = { writeHead(c) { out.code = c; return res; }, end(b) { out.body = b ? JSON.parse(b) : null; } };
    await mint.handle({ method: "GET", on: () => {}, setEncoding: () => {} }, res, new URL("http://x/nutft/quote"));
    return out;
  };
  const stateNow = () => JSON.parse(db.prepare("SELECT value FROM nutft_meta WHERE key = 'state'").get().value);

  const first = await quote();
  assert.equal(first.code, 200);
  const countsBefore = JSON.stringify(stateNow().counts);

  settled.add(first.body.payment_hash);        // paid, and then abandoned

  const during = await quote();
  assert.equal(during.code, 400, "while the hold stands the pack belongs to whoever paid");
  assert.match(during.body.error, /paid for and is being collected/);

  // Age the row rather than sleeping through the grace window.
  db.prepare("UPDATE nutft_invoices SET created_at = ? WHERE payment_hash = ?")
    .run(new Date(Date.now() - 7200_000).toISOString(), first.body.payment_hash);

  const after = await quote();
  assert.equal(after.code, 200, "once the hold lapses the booster is buyable again");

  assert.equal(JSON.stringify(stateNow().counts), countsBefore,
    "no card ever left the mint: counts are decremented in the claim, and nothing was claimed");
  assert.equal(stateNow().nextPack, 1, "and the pack number did not move either");
});

test("a paid booster may not be held for less time than an unpaid one", async (t) => {
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  assert.throws(
    () => createNutftMint({
      db, catalogUri: "http://127.0.0.1/nutft/catalog",
      lnd: { url: "http://fake", macaroon: "00", ca: null, insecure: false, timeoutMs: 1000 },
      priceMsat: 21000, invoiceTtlSeconds: 900, claimGraceSeconds: 120,
    }),
    /at least NUTFT_INVOICE_TTL_SECONDS/,
  );
});

test("one allocation per key: the second attempt is refused, and only for that key", async (t) => {
  /* The G rule: sign in with nostr, take exactly one set, and be flagged. The
     flag is written in the SAME transaction as the issuance, so this walks the
     whole path -- quote, settle, claim -- rather than asserting on the quote
     alone. A limit that only holds until somebody actually pays is not a
     limit. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { createMockFunding } = require("../../server/funding.js");
  const { DatabaseSync } = await import("node:sqlite");
  const { schnorr } = require("@noble/curves/secp256k1");
  const { randomBytes } = await import("node:crypto");
  const nip98 = require("../../server/nip98.js");
  const cashu = require("@cashu/cashu-ts");
  const hexOf = (b) => Buffer.from(b).toString("hex");

  const key = () => { const sec = randomBytes(32); return { sec, pub: hexOf(schnorr.getPublicKey(sec)) }; };
  const alice = key(), bob = key();

  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const funding = createMockFunding({});
  const mint = createNutftMint({
    db, catalogUri: "https://g.example/nutft/catalog", publicBase: "https://g.example",
    funding, allowVirtual: "1", priceMsat: 210_000,
    sales: "allowlist", allowlist: `${alice.pub},${bob.pub}`, onePerKey: true,
  });

  /* A FRESH event per request. Two calls inside the same second produce the
     same created_at, and NIP-98 event ids are a hash of the event -- so reusing
     the builder handed the mint a replayed authorization, and it correctly
     refused with "already been used". That is the replay store working, not the
     one-per-key rule, and asserting on it would have proved the wrong thing. */
  let nonce = 0;
  const proofFor = (who, path) => {
    const url = `https://g.example${path}`;
    nonce += 1;
    const event = {
      pubkey: who.pub, created_at: Math.floor(Date.now() / 1000), kind: 27235, content: "",
      tags: [["u", url], ["method", "GET"], ["nonce", String(nonce)]],
    };
    event.id = nip98.eventId(event);
    event.sig = hexOf(schnorr.sign(event.id, who.sec));
    return { header: "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64"),
             method: "GET", path, host: "g.example" };
  };

  const keysRes = { writeHead() { return keysRes; }, end(b) { keysRes.parsed = JSON.parse(b); } };
  await mint.handle({ method: "GET" }, keysRes, new URL("https://g.example/v1/keys"));
  const keyset = keysRes.parsed.keysets[0];

  const buyOne = async (who, tag) => {
    const quote = await mint.payableQuote({ proof: proofFor(who, "/nutft/quote") });
    const pubkey = hexOf(cashu.getPubKeyFromPrivKey(cashu.createRandomSecretKey()));
    const outs = quote.cards.map((card) => cashu.OutputData.createSingleP2PKData({
      pubkey, blindKeys: true,
      additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
    }, 1, keyset.id));
    funding.settle(quote.payment_hash);
    return mint.signBooster({
      idempotency_key: tag, pack_id: quote.pack_id, state: quote.state,
      payment_hash: quote.payment_hash,
      outputs: outs.map((o) => ({ amount: 1, id: o.blindedMessage.id, B_: o.blindedMessage.B_, nutft: opening(o) })),
    });
  };

  const first = await buyOne(alice, "alice-1");
  assert.equal(first.signatures.length, PACK, "a listed key gets its one set");

  await assert.rejects(() => mint.payableQuote({ proof: proofFor(alice, "/nutft/quote") }),
    /already taken its allocation/i, "and cannot come back for a second");

  /* Per KEY, not per mint: the flag must not close the shop for everyone else. */
  const second = await buyOne(bob, "bob-1");
  assert.equal(second.signatures.length, PACK, "a different listed key is unaffected");
});

test("a one-per-key mint refuses to start where it cannot tell keys apart", async (t) => {
  /* In `open` mode no signature is asked for, so there is no key to count
     against. A limit that cannot identify anybody is not a weaker limit -- it
     is the absence of one wearing its name, which is worse than saying no. */
  const { createNutftMint } = require("../../server/nutft-mint.js");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  assert.throws(
    () => createNutftMint({ db, catalogUri: "https://g.example/nutft/catalog", sales: "open", onePerKey: true }),
    /needs NUTFT_SALES=allowlist/,
  );
});

test("a sequential pool hands out its cards in census order, not by hash", async (t) => {
  /* "The first twenty-one sets carry a Genesis card" cannot be said with the
     hashed draw: a hash has no notion of first. A sequential pool takes the
     earliest card that still has copies, and packs are issued strictly in
     order, so the census order IS the queue -- and an announced rule can be
     checked against the published census by counting, with no beacon and no
     hashing. */
  const draw = require("../../server/nutft-draw.js");

  const census = {
    mint: { slots: { common: 1, uncommon: 0, prime: 1 }, sequential: ["prime"] },
    cards: [
      // Deliberately NOT alphabetical: sorting would destroy the whole point.
      { id: "G-zeta-good", copies: 2, pool: "prime" },
      { id: "G-alpha-good", copies: 1, pool: "prime" },
      { id: "G-mid-plain", copies: 5, pool: "prime" },
      { id: "C-1", copies: 40, pool: "common" },
    ],
  };
  const catalog = draw.loadCensus(census);
  assert.deepEqual([...catalog.sequential], ["prime"], "the pool is marked sequential");
  assert.deepEqual(catalog.pools.prime, ["G-zeta-good", "G-alpha-good", "G-mid-plain"],
    "and keeps census order rather than being sorted");

  const counts = { ...catalog.counts };
  const beacon = "00".repeat(32);
  const primeOf = (n) => draw.openPack(counts, catalog.pools, catalog.slots, beacon,
    `pack-${String(n).padStart(4, "0")}`, catalog.sequential)
    .find((id) => id.startsWith("G-"));

  assert.equal(primeOf(1), "G-zeta-good", "pack 1 takes the first card the census lists");
  assert.equal(primeOf(2), "G-zeta-good", "a card with two copies fills two consecutive packs");
  assert.equal(primeOf(3), "G-alpha-good", "then the next one, in census order");
  assert.equal(primeOf(4), "G-mid-plain", "and the good ones are gone once they are gone");
  assert.equal(primeOf(5), "G-mid-plain");
});

test("the hashed draw is untouched by the sequential option", async (t) => {
  /* E1 must keep drawing exactly as it did. A census with no `sequential` key
     produces an empty set, the pools are still sorted, and openPack takes the
     hashed path — so this is the regression guard for the edition that is
     already sold. */
  const draw = require("../../server/nutft-draw.js");
  const census = {
    mint: { slots: { common: 1, uncommon: 0, prime: 1 } },
    cards: [
      { id: "P-z", copies: 3, pool: "prime" },
      { id: "P-a", copies: 3, pool: "prime" },
      { id: "C-1", copies: 40, pool: "common" },
    ],
  };
  const catalog = draw.loadCensus(census);
  assert.equal(catalog.sequential.size, 0, "no sequential pools were declared");
  assert.deepEqual(catalog.pools.prime, ["P-a", "P-z"], "hashed pools are still sorted");

  /* Same inputs, same cards, whether or not an empty set is passed. */
  const a = draw.openPack({ ...catalog.counts }, catalog.pools, catalog.slots, "11".repeat(32), "pack-0001");
  const b = draw.openPack({ ...catalog.counts }, catalog.pools, catalog.slots, "11".repeat(32), "pack-0001", catalog.sequential);
  assert.deepEqual(a, b, "passing an empty sequential set changes nothing");
});
