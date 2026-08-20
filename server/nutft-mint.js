"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { schnorr } = require("@noble/curves/secp256k1");
const { censusHash, hashParts, loadCensus, openPack } = require("./nutft-draw.js");

const REPO = path.resolve(__dirname, "..");
const CENSUS_PATH = path.join(REPO, "cards", "nutft-census.json");
const VERSION = "1";

/* Durable mint state. The demo held counts, spent secrets and trade receipts in
 * memory, so every restart re-issued pack-0001 with the same cards and the supply
 * cap only ever held until the next deploy. A mint handing out bearer proofs that
 * people keep cannot be allowed to forget what it already sold. */
const MINT_DDL = `
CREATE TABLE IF NOT EXISTS nutft_mint (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  census_sha256  TEXT NOT NULL,
  catalog_uri    TEXT NOT NULL,
  collection_id  TEXT NOT NULL,
  next_pack      INTEGER NOT NULL,
  commitment     TEXT NOT NULL,
  counts_json    TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nutft_spent (
  y         TEXT PRIMARY KEY,
  asset_id  TEXT NOT NULL,
  spent_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nutft_trades (
  idempotency_key TEXT PRIMARY KEY,
  result_json     TEXT NOT NULL,
  traded_at       TEXT NOT NULL
);
`;

const text = (value) => new TextEncoder().encode(value);
const hex = (value) => Buffer.from(value).toString("hex");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assetBinding(reference) {
  return crypto.createHash("sha256")
    .update(Buffer.from("Cashu_NutFT_v1"))
    .update(Buffer.from(canonical(reference)))
    .digest("hex");
}

function json(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) reject(new Error("request too large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(new Error(`invalid JSON: ${error.message}`)); }
    });
    req.on("error", reject);
  });
}

function createNutftMint(options = {}) {
  const census = JSON.parse(fs.readFileSync(options.censusPath || CENSUS_PATH, "utf8"));
  const catalog = loadCensus(census);
  const collectionId = options.collectionId || process.env.NUTFT_COLLECTION_ID || "600B-E1";
  const catalogUri = options.catalogUri || process.env.NUTFT_CATALOG_URI || "http://localhost:8777/nutft/catalog";
  const beacon = (options.beacon || process.env.NUTFT_BEACON || "00".repeat(32)).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(beacon)) throw new Error("NUTFT_BEACON must be 32-byte hex");

  const cards = new Map(census.cards.map((card) => [card.id, card]));
  const basicId = catalog.basic[0];
  const initialCommitment = censusHash(catalog.counts);
  const state = { counts: { ...catalog.counts }, nextPack: 1, state: initialCommitment };
  const spent = new Set();
  const trades = new Map();

  /* No db keeps the original in-memory behaviour, which is what the offline demo
   * and most tests want. Anything that sells a card for real passes one in. */
  const db = options.db || null;
  const now = () => new Date().toISOString();
  if (db) {
    db.exec(MINT_DDL);
    const row = db.prepare("SELECT * FROM nutft_mint WHERE id = 1").get();
    if (!row) {
      db.prepare(`INSERT INTO nutft_mint
        (id, census_sha256, catalog_uri, collection_id, next_pack, commitment, counts_json, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)`)
        .run(census.census_sha256, catalogUri, collectionId, 1, initialCommitment, JSON.stringify(state.counts), now());
    } else {
      /* Resuming a sold-into mint under a different census, catalog_uri or
       * collection would issue cards whose CardBinding disagrees with the ones
       * already in people's wallets — and catalog_uri is hashed into every
       * binding, so that split is permanent rather than merely wrong. Refuse to
       * start instead of minting a second, incompatible run. */
      const mismatch = row.census_sha256 !== census.census_sha256 ? ["census_sha256", row.census_sha256, census.census_sha256]
        : row.catalog_uri !== catalogUri ? ["catalog_uri", row.catalog_uri, catalogUri]
        : row.collection_id !== collectionId ? ["collection_id", row.collection_id, collectionId]
        : null;
      if (mismatch) {
        throw new Error(`this mint has already sold ${row.next_pack - 1} pack(s) under a different ${mismatch[0]}: `
          + `stored ${mismatch[1]}, configured ${mismatch[2]}. Refusing to start.`);
      }
      state.counts = JSON.parse(row.counts_json);
      state.nextPack = row.next_pack;
      state.state = row.commitment;
      for (const spentRow of db.prepare("SELECT y FROM nutft_spent").all()) spent.add(spentRow.y);
      for (const tradeRow of db.prepare("SELECT idempotency_key, result_json FROM nutft_trades").all()) {
        trades.set(tradeRow.idempotency_key, JSON.parse(tradeRow.result_json));
      }
    }
  }
  const catalogPrivateKey = crypto.createHash("sha256").update("600B NutFT catalog issuer").digest();
  let cashu;

  const ready = import("@cashu/cashu-ts").then((module) => {
    cashu = module;
    const seed = crypto.createHash("sha256").update("600B NutFT demo mint key").digest();
    const keyset = cashu.createNewMintKeys(1, seed, { unit: collectionId });
    return keyset;
  });

  const reference = (assetId) => ({ collection_id: collectionId, asset_id: assetId, catalog_uri: catalogUri });
  const declaration = (assetId) => ({ ...reference(assetId), asset_binding: assetBinding(reference(assetId)) });
  const cardInfo = (assetId) => {
    const card = cards.get(assetId);
    if (!card) throw new Error(`unknown asset_id: ${assetId}`);
    return { asset_id: assetId, ...declaration(assetId), name: card.name, tier: card.tier, face: card.face };
  };
  const catalogPayload = () => ({
    collection_id: collectionId,
    schema: "600b-nutft-catalog-v1",
    catalog_uri: catalogUri,
    census_sha256: census.census_sha256,
    assets: census.cards.map((card) => cardInfo(card.id)),
  });
  const signedCatalog = () => {
    const payload = catalogPayload();
    const digest = crypto.createHash("sha256").update(canonical(payload)).digest();
    return {
      ...payload,
      issuer_pubkey: hex(schnorr.getPublicKey(catalogPrivateKey)),
      signature: hex(schnorr.sign(digest, catalogPrivateKey)),
    };
  };
  const current = () => state.state;
  const packId = () => `pack-${String(state.nextPack).padStart(4, "0")}`;

  function quote() {
    const id = packId();
    const counts = { ...state.counts };
    const paid = openPack(counts, catalog.pools, catalog.slots, beacon, id);
    const ids = [...paid, basicId];
    const nextState = hashParts(current(), id, beacon, ids.join(",")).toString("hex");
    return {
      pack_id: id,
      state: current(),
      next_state: nextState,
      cards: ids.map(cardInfo),
      unit: collectionId,
      amount: 1,
      catalog_uri: catalogUri,
      beacon,
    };
  }

  function validateOutput(output, expected, keysetId) {
    if (!output || output.amount !== 1 || output.id !== keysetId || typeof output.B_ !== "string") {
      throw new Error("NutFT output must have amount=1 and the active keyset id");
    }
    const declarationValue = output.nutft;
    if (!declarationValue || canonical(declarationValue) !== canonical(reference(expected.asset_id))) {
      throw new Error(`CardBinding mismatch for ${expected.asset_id}`);
    }
    cashu.pointFromHex(output.B_);
  }

  async function keysResponse() {
    const keyset = await ready;
    return {
      keysets: [{ id: keyset.keysetId, unit: collectionId, active: true, input_fee_ppk: 0, keys: Object.fromEntries(Object.entries(keyset.pubKeys).map(([amount, key]) => [amount, hex(key)])) }],
    };
  }

  async function signBooster(body) {
    const keyset = await ready;
    const expected = quote();
    if (body.pack_id !== expected.pack_id || body.state !== expected.state) throw new Error("stale booster quote");
    if (!Array.isArray(body.outputs) || body.outputs.length !== expected.cards.length) throw new Error("one output is required per card");
    for (let i = 0; i < expected.cards.length; i += 1) validateOutput(body.outputs[i], expected.cards[i], keyset.keysetId);

    const signatures = body.outputs.map((output) => {
      const blind = cashu.createBlindSignature(cashu.pointFromHex(output.B_), keyset.privKeys["1"], keyset.keysetId);
      const dleq = cashu.createDLEQProof(cashu.pointFromHex(output.B_), keyset.privKeys["1"]);
      return {
        id: keyset.keysetId,
        amount: 1,
        C_: blind.C_.toHex(true),
        dleq: { s: hex(dleq.s), e: hex(dleq.e) },
      };
    });

    /* Disk first, memory second. If the write fails the caller gets an error and
     * never sees these signatures, instead of walking away with cards the mint
     * has no record of selling. */
    const nextCounts = { ...state.counts };
    const resolved = openPack(nextCounts, catalog.pools, catalog.slots, beacon, expected.pack_id);
    if (db) {
      db.prepare("UPDATE nutft_mint SET next_pack = ?, commitment = ?, counts_json = ?, updated_at = ? WHERE id = 1")
        .run(state.nextPack + 1, expected.next_state, JSON.stringify(nextCounts), now());
    }
    state.counts = nextCounts;
    state.state = expected.next_state;
    state.nextPack += 1;
    return { ...expected, cards: expected.cards, signatures, keyset_id: keyset.keysetId, resolved };
  }

  async function trade(body) {
    const keyset = await ready;
    if (typeof body.idempotency_key !== "string" || !body.idempotency_key) throw new Error("trade idempotency_key is required");
    if (trades.has(body.idempotency_key)) return trades.get(body.idempotency_key);
    const inputs = cashu.deserializeProofs(body.inputs || []);
    if (inputs.length !== 1 || !Array.isArray(body.outputs) || body.outputs.length !== 1) throw new Error("demo trade accepts one card at a time");
    const input = inputs[0];
    const tag = cashu.getTag(input.secret, "nutft");
    if (!tag || tag.length !== 5 || tag[0] !== VERSION) throw new Error("input is not a NutFT proof");
    const inputReference = { collection_id: tag[1], asset_id: tag[2], catalog_uri: tag[3] };
    if (tag[4] !== assetBinding(inputReference) || inputReference.collection_id !== collectionId || input.amount.toString() !== "1") throw new Error("input CardBinding is invalid");
    const y = cashu.hashToCurve(text(input.secret)).toHex(true);
    if (spent.has(y)) throw new Error("input proof is already spent");
    if (!cashu.verifyUnblindedSignature({ id: input.id, secret: text(input.secret), C: cashu.pointFromHex(input.C) }, keyset.privKeys["1"])) throw new Error("input signature is invalid");
    if (!cashu.isP2PKSpendAuthorised(input)) throw new Error("input owner witness is invalid");
    validateOutput(body.outputs[0], { asset_id: inputReference.asset_id }, keyset.keysetId);
    const output = body.outputs[0];
    const blind = cashu.createBlindSignature(cashu.pointFromHex(output.B_), keyset.privKeys["1"], keyset.keysetId);
    const dleq = cashu.createDLEQProof(cashu.pointFromHex(output.B_), keyset.privKeys["1"]);
    const result = {
      trade_id: body.idempotency_key,
      unit: collectionId,
      asset_id: inputReference.asset_id,
      signature: { id: keyset.keysetId, amount: 1, C_: blind.C_.toHex(true), dleq: { s: hex(dleq.s), e: hex(dleq.e) } },
    };
    // Commit only after every input, destination, binding, and signature check passed.
    if (db) {
      const at = now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO nutft_spent (y, asset_id, spent_at) VALUES (?, ?, ?)").run(y, inputReference.asset_id, at);
        db.prepare("INSERT INTO nutft_trades (idempotency_key, result_json, traded_at) VALUES (?, ?, ?)")
          .run(body.idempotency_key, JSON.stringify(result), at);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    spent.add(y);
    trades.set(body.idempotency_key, result);
    return result;
  }

  async function handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/v1/info") {
        return json(res, 200, { name: "600B NutFT demo mint", version: "0.1.0", nuts: { 31: { supported: true, versions: [1], p2bk: true, dleq: true }, 7: { supported: true } } });
      }
      if (req.method === "GET" && url.pathname === "/v1/keys") return json(res, 200, await keysResponse());
      if (req.method === "POST" && url.pathname === "/v1/checkstate") {
        const body = await readBody(req);
        return json(res, 200, { states: (body.Ys || []).map((Y) => ({ Y, state: spent.has(Y) ? "SPENT" : "UNSPENT" })) });
      }
      if (req.method === "POST" && url.pathname === "/nutft/trade") return json(res, 200, await trade(await readBody(req)));
      if (req.method === "GET" && url.pathname === "/nutft/catalog") {
        return json(res, 200, signedCatalog());
      }
      if (req.method === "GET" && url.pathname === "/nutft/state") {
        return json(res, 200, { unit: collectionId, state: current(), census_sha256: census.census_sha256, next_pack: packId(), sold: state.nextPack - 1, packs: census.mint.packs, remaining: state.counts });
      }
      if (req.method === "GET" && url.pathname === "/nutft/quote") return json(res, 200, quote());
      if (req.method === "POST" && url.pathname === "/nutft/booster") return json(res, 200, await signBooster(await readBody(req)));
      return json(res, 404, { error: "not found" });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  return { handle, catalogUri, collectionId, initialCommitment, state };
}

module.exports = { assetBinding, canonical, createNutftMint };
