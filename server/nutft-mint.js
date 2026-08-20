"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { schnorr } = require("@noble/curves/secp256k1");
const { censusHash, hashParts, loadCensus, openPack } = require("./nutft-draw.js");

const REPO = path.resolve(__dirname, "..");
const CENSUS_PATH = path.join(REPO, "cards", "nutft-census.json");
const VERSION = "1";

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
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 512 * 1024) {
        tooLarge = true;
        body = "";
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("request too large"));
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
  const db = options.db;
  const memory = { meta: new Map(), spent: new Set(), operations: new Map() };
  let q;
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nutft_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nutft_spent (y TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS nutft_operations (
        type TEXT NOT NULL,
        operation_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        PRIMARY KEY (type, operation_key)
      );
    `);
    q = {
      meta: db.prepare("SELECT value FROM nutft_meta WHERE key = ?"),
      putMeta: db.prepare("INSERT OR REPLACE INTO nutft_meta (key, value) VALUES (?, ?)"),
      spent: db.prepare("SELECT 1 FROM nutft_spent WHERE y = ?"),
      putSpent: db.prepare("INSERT INTO nutft_spent (y) VALUES (?)"),
      operation: db.prepare("SELECT request_hash, response_json FROM nutft_operations WHERE type = ? AND operation_key = ?"),
      putOperation: db.prepare("INSERT INTO nutft_operations (type, operation_key, request_hash, response_json) VALUES (?, ?, ?, ?)"),
    };
  }
  const getMeta = (key) => db ? q.meta.get(key)?.value : memory.meta.get(key);
  const putMeta = (key, value) => db ? q.putMeta.run(key, value) : memory.meta.set(key, value);
  const getOrCreate = (key, create) => {
    const found = getMeta(key);
    if (found) return found;
    const value = create();
    putMeta(key, value);
    return value;
  };
  const getOperation = (type, key) => {
    const row = db ? q.operation.get(type, key) : memory.operations.get(`${type}:${key}`);
    return row && { requestHash: row.request_hash || row.requestHash, result: JSON.parse(row.response_json || JSON.stringify(row.result)) };
  };
  const putOperation = (type, key, requestHash, result) => db
    ? q.putOperation.run(type, key, requestHash, JSON.stringify(result))
    : memory.operations.set(`${type}:${key}`, { requestHash, result });
  const isSpent = (y) => db ? Boolean(q.spent.get(y)) : memory.spent.has(y);
  const putSpent = (y) => db ? q.putSpent.run(y) : memory.spent.add(y);
  const storedState = getMeta("state");
  const state = storedState ? JSON.parse(storedState) : { counts: { ...catalog.counts }, nextPack: 1, state: initialCommitment };
  if (!storedState) putMeta("state", JSON.stringify(state));
  const mintSeed = Buffer.from(getOrCreate("mint_seed", () => crypto.randomBytes(32).toString("hex")), "hex");
  const catalogPrivateKey = Buffer.from(getOrCreate("catalog_private_key", () => crypto.randomBytes(32).toString("hex")), "hex");
  let cashu;

  const ready = import("@cashu/cashu-ts").then((module) => {
    cashu = module;
    const keyset = cashu.createNewMintKeys(1, mintSeed, { unit: collectionId });
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
  const atomic = (work) => {
    if (!db) return work();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

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

  function parseNutftSecret(secret, p2pkE) {
    if (typeof secret !== "string") throw new Error("NutFT output secret is required");
    let parsed;
    try { parsed = JSON.parse(secret); }
    catch { throw new Error("NutFT output secret is invalid JSON"); }
    if (JSON.stringify(parsed) !== secret || !Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== "P2PK" || !parsed[1] || typeof parsed[1] !== "object") {
      throw new Error("NutFT output secret is not canonical P2PK");
    }
    const tags = parsed[1].tags;
    const matches = Array.isArray(tags) ? tags.filter((tag) => Array.isArray(tag) && tag[0] === "nutft") : [];
    if (matches.length !== 1 || matches[0].length !== 6 || matches[0].some((value) => typeof value !== "string" || !value)) {
      throw new Error("NutFT secret must contain exactly one canonical nutft tag");
    }
    const tag = matches[0].slice(1);
    if (tag[0] !== VERSION) throw new Error("unsupported NutFT version");
    const assetReference = { collection_id: tag[1], asset_id: tag[2], catalog_uri: tag[3] };
    if (tag[4] !== assetBinding(assetReference)) throw new Error("NutFT asset binding is invalid");
    if (typeof p2pkE !== "string") throw new Error("NutFT demo outputs must use P2BK");
    cashu.pointFromHex(parsed[1].data);
    cashu.pointFromHex(p2pkE);
    return { reference: assetReference, binding: tag[4] };
  }

  function validateOutput(output, expected, keysetId) {
    if (!output || output.amount !== 1 || output.id !== keysetId || typeof output.B_ !== "string") {
      throw new Error("NutFT output must have amount=1 and the active keyset id");
    }
    const opening = output.nutft;
    if (!opening || typeof opening.blinding_factor !== "string" || !/^[0-9a-f]{64}$/.test(opening.blinding_factor) || /^0+$/.test(opening.blinding_factor)) {
      throw new Error("NutFT output blinding factor is invalid");
    }
    const parsed = parseNutftSecret(opening.secret, opening.p2pk_e);
    const recomputed = cashu.blindMessage(text(opening.secret), BigInt(`0x${opening.blinding_factor}`)).B_.toHex(true);
    if (recomputed !== cashu.pointFromHex(output.B_).toHex(true)) throw new Error("NutFT output opening does not match B_");
    if (expected && canonical(parsed.reference) !== canonical(expected)) throw new Error(`CardBinding mismatch for ${expected.asset_id}`);
    if (!cards.has(parsed.reference.asset_id) || parsed.reference.collection_id !== collectionId) throw new Error(`unknown asset_id: ${parsed.reference.asset_id}`);
    return parsed;
  }

  async function keysResponse() {
    const keyset = await ready;
    return {
      keysets: [{ id: keyset.keysetId, unit: collectionId, active: true, input_fee_ppk: 0, keys: Object.fromEntries(Object.entries(keyset.pubKeys).map(([amount, key]) => [amount, hex(key)])) }],
    };
  }

  async function signBooster(body) {
    const keyset = await ready;
    if (typeof body.idempotency_key !== "string" || !body.idempotency_key) throw new Error("booster idempotency_key is required");
    const requestHash = crypto.createHash("sha256").update(canonical(body)).digest("hex");
    const previous = getOperation("booster", body.idempotency_key);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new Error("idempotency_key was already used for a different booster");
      return previous.result;
    }
    const expected = quote();
    if (body.pack_id !== expected.pack_id || body.state !== expected.state) throw new Error("stale booster quote");
    if (!Array.isArray(body.outputs) || body.outputs.length !== expected.cards.length) throw new Error("one output is required per card");
    for (let i = 0; i < expected.cards.length; i += 1) validateOutput(body.outputs[i], reference(expected.cards[i].asset_id), keyset.keysetId);

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

    const nextCounts = { ...state.counts };
    const resolved = openPack(nextCounts, catalog.pools, catalog.slots, beacon, expected.pack_id);
    const nextState = { counts: nextCounts, state: expected.next_state, nextPack: state.nextPack + 1 };
    const result = { ...expected, cards: expected.cards, signatures, keyset_id: keyset.keysetId, resolved };
    atomic(() => {
      putMeta("state", JSON.stringify(nextState));
      putOperation("booster", body.idempotency_key, requestHash, result);
    });
    Object.assign(state, nextState);
    return result;
  }

  async function trade(body) {
    const keyset = await ready;
    if (typeof body.idempotency_key !== "string" || !body.idempotency_key) throw new Error("trade idempotency_key is required");
    const requestHash = crypto.createHash("sha256").update(canonical(body)).digest("hex");
    const previous = getOperation("trade", body.idempotency_key);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new Error("idempotency_key was already used for a different trade");
      return previous.result;
    }
    const inputs = cashu.deserializeProofs(body.inputs || []);
    if (inputs.length !== 1 || !Array.isArray(body.outputs) || body.outputs.length !== 1) throw new Error("demo trade accepts one card at a time");
    const input = inputs[0];
    const parsedInput = parseNutftSecret(input.secret, input.p2pk_e);
    const inputReference = parsedInput.reference;
    if (input.id !== keyset.keysetId || inputReference.collection_id !== collectionId || input.amount.toString() !== "1" || !cards.has(inputReference.asset_id)) throw new Error("input CardBinding is invalid");
    const y = cashu.hashToCurve(text(input.secret)).toHex(true);
    if (isSpent(y)) throw new Error("input proof is already spent");
    if (!cashu.verifyUnblindedSignature({ id: input.id, secret: text(input.secret), C: cashu.pointFromHex(input.C) }, keyset.privKeys["1"])) throw new Error("input signature is invalid");
    if (!cashu.isP2PKSpendAuthorised(input)) throw new Error("input owner witness is invalid");
    const outputBinding = validateOutput(body.outputs[0], inputReference, keyset.keysetId);
    if (outputBinding.binding !== parsedInput.binding) throw new Error("replacement CardBinding must equal input CardBinding");
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
    atomic(() => {
      putSpent(y);
      putOperation("trade", body.idempotency_key, requestHash, result);
    });
    return result;
  }

  async function handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/v1/info") {
        return json(res, 200, { name: "600B NutFT demo mint", version: "0.1.0", nuts: { 31: { supported: true, versions: [1], output_openings: true, p2bk: true, dleq: true }, 7: { supported: true } } });
      }
      if (req.method === "GET" && url.pathname === "/v1/keys") return json(res, 200, await keysResponse());
      if (req.method === "POST" && url.pathname === "/v1/checkstate") {
        const body = await readBody(req);
        await ready;
        if (!Array.isArray(body.Ys) || body.Ys.length > 256) throw new Error("Ys must be an array of at most 256 points");
        for (const Y of body.Ys) {
          if (typeof Y !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(Y)) throw new Error("Ys contains an invalid curve point");
          cashu.pointFromHex(Y);
        }
        return json(res, 200, { states: body.Ys.map((Y) => ({ Y, state: isSpent(Y) ? "SPENT" : "UNSPENT" })) });
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
