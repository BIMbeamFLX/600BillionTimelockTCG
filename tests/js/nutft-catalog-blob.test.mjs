/* The catalog as a content-addressed blob, the wallet fetching it by hash,
   any NutFT unit being accepted, and large tokens surviving encoding. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserWallet } from "./helpers/browser-wallet.mjs";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const { canonical } = require("../../server/nutft-mint.js");
const CENSUS = require("../../cards/nutft-census.json");
const PACK = CENSUS.mint.cards_per_pack;
const cashu = await import("@cashu/cashu-ts");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";

test("the catalog is served as an immutable content-addressed blob", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nutft-blob-"));
  const dbPath = join(dir, "mint.db");
  /* Every table this test opens is closed before the directory goes, whether
     the assertions passed or not; a server left open would hold the test
     process alive and the database file locked. */
  const tables = [];
  t.after(async () => {
    for (const open of tables) await Promise.resolve(open.close()).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });
  let table = await createTable({
    port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: CATALOG_URI,
    nutftCatalogMirrors: " https://mirror-a.test, https://mirror-b.test/ ",
  });
  tables.push(table);
  const info = await (await fetch(`${table.url}/v1/info`)).json();
  const sha = info.nuts[31].catalog_blob_sha256;
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(info.nuts[31].catalog_uri, CATALOG_URI);
  assert.deepEqual(info.nuts[31].catalog_blob_urls, [`https://mirror-a.test/${sha}`, `https://mirror-b.test/${sha}`]);

  const viaBlob = await fetch(`${table.url}/blossom/${sha}`);
  assert.equal(viaBlob.status, 200);
  assert.equal(viaBlob.headers.get("access-control-allow-origin"), "*");
  assert.match(viaBlob.headers.get("cache-control"), /immutable/);
  const blobBytes = Buffer.from(await viaBlob.arrayBuffer());
  assert.equal(createHash("sha256").update(blobBytes).digest("hex"), sha, "the path is the hash of the bytes");
  const viaUrl = Buffer.from(await (await fetch(`${table.url}/nutft/catalog`)).arrayBuffer());
  assert.ok(blobBytes.equals(viaUrl), "the catalog URL and the blob serve identical bytes");

  const head = await fetch(`${table.url}/blossom/${sha}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(blobBytes.length));
  assert.equal((await fetch(`${table.url}/blossom/${"0".repeat(64)}`)).status, 404);

  const { signature, issuer_pubkey: issuer, ...payload } = JSON.parse(blobBytes.toString("utf8"));
  const digest = createHash("sha256").update(canonical(payload)).digest("hex");
  assert.equal(info.nuts[31].catalog_sha256, digest, "the payload digest is still what the capability advertises");
  assert.equal(cashu.schnorrVerifyDigest(signature, digest, issuer), true);

  await table.close();
  tables.length = 0;
  table = await createTable({ port: 0, host: "127.0.0.1", dbPath, nutftCatalogUri: CATALOG_URI });
  tables.push(table);
  const again = await (await fetch(`${table.url}/v1/info`)).json();
  assert.equal(again.nuts[31].catalog_blob_sha256, sha, "the blob hash survives a restart: the signature is deterministic");
  assert.equal(again.nuts[31].catalog_blob_urls.length, 0, "no mirrors configured, none advertised");
});

test("browser wallet loads the catalog by hash and accepts any NutFT unit", async (t) => {
  const table = await createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI,
    nutftCollectionId: "600B-TEST", nutftCatalogMirrors: "https://mirror.test",
  });
  t.after(() => table.close());
  const info = await (await fetch(`${table.url}/v1/info`)).json();
  const sha = info.nuts[31].catalog_blob_sha256;
  const blobUrl = `${table.url}/blossom/${sha}`;
  const mirrorUrl = `https://mirror.test/${sha}`;
  let mode = "blob";
  const requests = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    requests.push(target);
    if (target === CATALOG_URI) {
      if (mode === "blob") throw new Error("the catalog URL is offline");
      return fetch(`${table.url}/nutft/catalog`, options);
    }
    if (target === blobUrl && mode === "tamper") {
      return new Response("{\"tampered\":true}", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target === mirrorUrl) return new Response("not here", { status: 404 });
    return fetch(url, options);
  };

  const storage = new Map();
  const wallet = await browserWallet(storage, fetchImpl, { cashu });
  await wallet.buyBooster(table.url);
  const snapshot = await wallet.snapshot(table.url);
  assert.equal(snapshot.owned.length, PACK, "a 600B-TEST unit is accepted and the catalog came from the mint's /blossom path");
  assert.ok(requests.includes(blobUrl), "the wallet asked for the catalog by hash");

  mode = "tamper";
  requests.length = 0;
  const cold = await browserWallet(new Map([["600b:nutft-wallet", storage.get("600b:nutft-wallet")]]), fetchImpl, { cashu });
  assert.equal((await cold.snapshot(table.url)).owned.length, PACK, "a tampered blob is rejected and the catalog URL is used instead");
  assert.ok(requests.includes(blobUrl) && requests.includes(mirrorUrl) && requests.includes(CATALOG_URI),
    "blob, mirror, then the catalog URL, in that order of trust");

  const pinned = await browserWallet(new Map(), fetchImpl, { cashu, globals: { NUTFT_UNITS: ["600B-E1"] } });
  await assert.rejects(() => pinned.snapshot(table.url), /not one this page accepts/);
});

test("tokens above 32 KiB encode as one base64url payload", async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI });
  t.after(() => table.close());
  const fetchImpl = (url, options) => fetch(String(url) === CATALOG_URI ? `${table.url}/nutft/catalog` : url, options);
  const wallet = await browserWallet(new Map(), fetchImpl, { cashu });
  await wallet.buyBooster(table.url);
  const proofs = (await wallet.snapshot(table.url)).owned.map((entry) => entry.proof);
  assert.equal(proofs.length, PACK);
  const keysetId = (await (await fetch(`${table.url}/v1/keys`)).json()).keysets[0].id;
  const many = Array.from({ length: 150 }, (_, i) => proofs[i % proofs.length]);
  const encoded = wallet.encodeToken(cashu, { mint: table.url, unit: "600B-E1", proofs: many });
  assert.ok(encoded.length > 32 * 1024, `token is ${encoded.length} characters`);
  assert.match(encoded, /^cashuB[A-Za-z0-9_-]+$/, "base64url with no padding anywhere");
  assert.equal(cashu.getDecodedToken(encoded, [keysetId]).proofs.length, many.length);
});
