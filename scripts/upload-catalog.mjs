/* Publish a mint's signed catalog to the Blossom mirrors.
 *
 * The mint freezes its signed catalog at boot and serves the exact bytes under
 * /blossom/<sha256>, advertising the hash in /v1/info as catalog_blob_sha256.
 * This script fetches those bytes from the mint, checks the hash, uploads them
 * to every mirror that does not serve them yet (BUD-02 PUT /upload, kind-24242
 * auth signed by PALACE_NSEC), and verifies each mirror afterwards. Mirrors
 * that hold the blob then belong in NUTFT_CATALOG_MIRRORS, so the mint can
 * advertise them.
 *
 *   $env:PALACE_NSEC = "<nsec>"; node scripts/upload-catalog.mjs https://tcg.nappelin.com          # dry run
 *   $env:PALACE_NSEC = "<nsec>"; node scripts/upload-catalog.mjs https://tcg.nappelin.com/g --go   # G edition
 *   node scripts/upload-catalog.mjs <mint> --mirrors https://a.example,https://b.example --go
 */

import { createHash } from "node:crypto";
import { loadKey, publicKeyHex, signedAuth } from "./blossom-auth.mjs";

// The same three, in the same order, as site/faces.js and upload-blobs.mjs.
const DEFAULT_MIRRORS = ["https://blossom.primal.net", "https://blossom.bimcvp.com", "https://nostr.download"];

const args = process.argv.slice(2);
const mintUrl = (args.find((arg) => /^https?:\/\//.test(arg)) || "").replace(/\/+$/, "");
const GO = args.includes("--go");
const mirrorsIdx = args.indexOf("--mirrors");
const mirrors = (mirrorsIdx >= 0 ? String(args[mirrorsIdx + 1] || "").split(",") : DEFAULT_MIRRORS)
  .map((entry) => entry.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function fail(message) {
  console.error(`upload-catalog: ${message}`);
  process.exit(1);
}
if (!mintUrl) fail("usage: node scripts/upload-catalog.mjs <mint url> [--mirrors a,b] [--go]");
if (!mirrors.length) fail("no mirrors given");

async function isLive(mirror, sha) {
  try {
    const res = await fetch(`${mirror}/${sha}`, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function upload(mirror, sha, bytes, secret) {
  try {
    const res = await fetch(`${mirror}/upload`, {
      method: "PUT",
      headers: {
        Authorization: signedAuth(secret, "upload", sha, `upload nutft-catalog ${sha.slice(0, 12)}.json`),
        "Content-Type": "application/json",
        "X-SHA-256": sha,
      },
      body: bytes,
      signal: AbortSignal.timeout(120000),
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: error.name === "TimeoutError" ? "timeout" : "error" };
  }
}

async function verify(mirror, sha) {
  try {
    const res = await fetch(`${mirror}/${sha}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, status: res.status };
    const got = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    return { ok: got === sha, status: got === sha ? res.status : "hash mismatch" };
  } catch (error) {
    return { ok: false, status: error.name === "TimeoutError" ? "timeout" : "error" };
  }
}

const info = await (await fetch(`${mintUrl}/v1/info`)).json().catch(() => null);
const capability = info && info.nuts && info.nuts[31];
if (!capability || !/^[0-9a-f]{64}$/.test(capability.catalog_blob_sha256 || "")) fail("mint does not advertise catalog_blob_sha256 in /v1/info");
const sha = capability.catalog_blob_sha256;

const blobResponse = await fetch(`${mintUrl}/blossom/${sha}`);
if (!blobResponse.ok) fail(`mint does not serve /blossom/${sha} (${blobResponse.status})`);
const bytes = Buffer.from(await blobResponse.arrayBuffer());
const got = createHash("sha256").update(bytes).digest("hex");
if (got !== sha) fail(`mint blob hashes to ${got.slice(0, 12)}, expected ${sha.slice(0, 12)}`);
console.log(`catalog ${capability.catalog_uri || "(uri not advertised)"}  blob ${sha}  ${bytes.length} bytes`);
console.log(`advertised mirrors: ${(capability.catalog_blob_urls || []).join(", ") || "none"}`);

const secret = GO ? loadKey() : null;
if (secret) console.log(`signing as ${publicKeyHex(secret).slice(0, 16)}…`);
console.log(`mode: ${GO ? "EXECUTE" : "dry run (pass --go to execute)"}`);

for (const mirror of mirrors) {
  const host = new URL(mirror).hostname;
  if (await isLive(mirror, sha)) {
    console.log(`  ${host}: already live`);
    continue;
  }
  if (!GO) {
    console.log(`  ${host}: missing (would upload)`);
    continue;
  }
  const result = await upload(mirror, sha, bytes, secret);
  const check = result.ok ? await verify(mirror, sha) : { ok: false, status: result.status };
  console.log(`  ${host}: upload ${result.status}, verify ${check.status}`);
}

const live = [];
for (const mirror of mirrors) if (await isLive(mirror, sha)) live.push(mirror);
console.log(`live on ${live.length}/${mirrors.length} mirrors${live.length ? `: NUTFT_CATALOG_MIRRORS=${live.join(",")}` : ""}`);
if (GO && live.length < 2) fail("fewer than two mirrors serve the catalog; fix that before advertising them");
