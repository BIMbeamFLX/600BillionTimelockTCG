/* Publish the card faces to the Blossom mirrors, and clean up orphaned blobs.
 *
 * The face pipeline is content-addressed: a re-rendered face is a NEW blob and
 * the old hash becomes an orphan on the mirrors. This script closes the loop
 * check_blobs.py only observes:
 *
 *   1. UPLOAD every face in cards/e1-blob-manifest.json that no mirror serves
 *      (BUD-02: PUT /upload, kind-24242 auth signed by the key you provide).
 *   2. With --clean-before <git-ref>, DELETE blobs that ref's manifest listed
 *      but the current manifest no longer does -- the orphans of a redesign.
 *
 * Uploads run before deletes on purpose: if the run dies halfway, the mirrors
 * hold too much, never too little.
 *
 * The signing key comes from the PALACE_NSEC environment variable (nsec1... or
 * 64-char hex). It is read once, never logged, and never leaves this process.
 *
 *   $env:PALACE_NSEC = "<nsec>"; node scripts/upload-blobs.mjs             # dry run
 *   $env:PALACE_NSEC = "<nsec>"; node scripts/upload-blobs.mjs --go --clean-before fee50fd
 */

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { schnorr } from "@noble/curves/secp256k1.js";

const ROOT = new URL("..", import.meta.url);
const FACES_DIR = new URL("art/cards/node-runner-web/", ROOT);
const MANIFEST = new URL("cards/e1-blob-manifest.json", ROOT);
// The same three, in the same order, as site/faces.js and check_blobs.py.
const MIRRORS = ["https://blossom.primal.net", "https://blossom.bimcvp.com", "https://nostr.download"];

const args = process.argv.slice(2);
const GO = args.includes("--go");
const cleanIdx = args.indexOf("--clean-before");
const CLEAN_REF = cleanIdx >= 0 ? args[cleanIdx + 1] : null;
if (cleanIdx >= 0 && !CLEAN_REF) fail("--clean-before needs a git ref");

function fail(message) {
  console.error(`upload-blobs: ${message}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- key */

function decodeBech32(nsec) {
  // Minimal bech32 decode, enough for nsec1: no external dependency touches
  // the key. Checksum is verified; a typo fails loudly instead of signing junk.
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const lower = nsec.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1) fail("key does not look like bech32");
  const hrp = lower.slice(0, sep);
  const data = [...lower.slice(sep + 1)].map((c) => CHARSET.indexOf(c));
  if (data.includes(-1)) fail("key has an invalid bech32 character");
  const polymod = (values) => {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  };
  const hrpExpand = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (polymod(hrpExpand.concat(data)) !== 1) fail("bech32 checksum does not verify");
  const words = data.slice(0, -6);
  let acc = 0, bits = 0;
  const bytes = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  if (hrp !== "nsec") fail(`expected an nsec key, got ${hrp}`);
  if (bytes.length !== 32) fail("decoded key is not 32 bytes");
  return Buffer.from(bytes);
}

function loadKey() {
  const raw = (process.env.PALACE_NSEC ?? "").trim();
  if (!raw) fail("PALACE_NSEC is not set. Set it in THIS shell; it never leaves the process.");
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return decodeBech32(raw);
}

/* ------------------------------------------------------- nostr signing */

function signedAuth(secret, verb, sha, name) {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    pubkey: Buffer.from(schnorr.getPublicKey(secret)).toString("hex"),
    created_at: now,
    kind: 24242,
    tags: [["t", verb], ["x", sha], ["expiration", String(now + 3600)]],
    content: `${verb} ${name}`,
  };
  const payload = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  event.id = createHash("sha256").update(payload).digest("hex");
  event.sig = Buffer.from(schnorr.sign(event.id, secret, randomBytes(32))).toString("hex");
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

/* ------------------------------------------------------------- mirrors */

async function isLive(mirror, sha) {
  try {
    const res = await fetch(`${mirror}/${sha}.webp`, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function upload(mirror, sha, name, bytes, secret) {
  // A mirror that hangs or drops the socket is a result, not a crash.
  try {
    const res = await fetch(`${mirror}/upload`, {
      method: "PUT",
      headers: { Authorization: signedAuth(secret, "upload", sha, name), "Content-Type": "image/webp" },
      body: bytes,
      signal: AbortSignal.timeout(120000),
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: error.name === "TimeoutError" ? "timeout" : "error" };
  }
}

async function removeBlob(mirror, sha, secret) {
  try {
    const res = await fetch(`${mirror}/${sha}`, {
      method: "DELETE",
      headers: { Authorization: signedAuth(secret, "delete", sha, sha) },
      signal: AbortSignal.timeout(60000),
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: error.name === "TimeoutError" ? "timeout" : "error" };
  }
}

/* ----------------------------------------------------------- manifests */

function manifestEntries(text) {
  const manifest = JSON.parse(text);
  const items = Object.values(manifest).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
  return items.map((i) => ({ file: i.file, sha256: i.sha256 }));
}

async function pool(items, limit, worker) {
  const results = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const mine = items[index++];
        results.push(await worker(mine));
      }
    }),
  );
  return results;
}

/* ------------------------------------------------------------------ run */

const secret = loadKey();
const pubkey = Buffer.from(schnorr.getPublicKey(secret)).toString("hex");
console.log(`signing as ${pubkey.slice(0, 16)}…  mode: ${GO ? "EXECUTE" : "dry run (pass --go to execute)"}`);

const current = manifestEntries(readFileSync(MANIFEST, "utf8"));
console.log(`current manifest: ${current.length} faces`);

// Phase 1 — upload whatever no mirror serves.
const missing = [];
for (const entry of current) {
  const live = await Promise.all(MIRRORS.map((m) => isLive(m, entry.sha256)));
  if (!live.some(Boolean)) missing.push(entry);
}
console.log(`unpublished: ${missing.length}`);

let uploadFailures = 0;
if (GO && missing.length) {
  await pool(missing, 4, async (entry) => {
    const bytes = readFileSync(new URL(encodeURIComponent(entry.file), FACES_DIR));
    const got = createHash("sha256").update(bytes).digest("hex");
    if (got !== entry.sha256) fail(`${entry.file}: disk hash ${got.slice(0, 12)} != manifest ${entry.sha256.slice(0, 12)}`);
    const results = await Promise.all(MIRRORS.map((m) => upload(m, entry.sha256, entry.file, bytes, secret)));
    const okCount = results.filter((r) => r.ok).length;
    if (!okCount) uploadFailures += 1;
    console.log(
      `  ${okCount ? "up" : "FAIL"} ${entry.file}  ${results.map((r, i) => `${new URL(MIRRORS[i]).hostname}:${r.status}`).join("  ")}`,
    );
  });
}

// Phase 2 — clean orphans: blobs the old manifest listed, the current one dropped.
if (CLEAN_REF) {
  const oldText = execFileSync("git", ["show", `${CLEAN_REF}:cards/e1-blob-manifest.json`], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const currentShas = new Set(current.map((e) => e.sha256));
  const orphans = manifestEntries(oldText).filter((e) => !currentShas.has(e.sha256));
  console.log(`orphans from ${CLEAN_REF}: ${orphans.length}`);
  if (GO) {
    await pool(orphans, 4, async (entry) => {
      const results = await Promise.all(
        MIRRORS.map(async (m) => ((await isLive(m, entry.sha256)) ? removeBlob(m, entry.sha256, secret) : { ok: true, status: "absent" })),
      );
      console.log(
        `  rm ${entry.file}  ${results.map((r, i) => `${new URL(MIRRORS[i]).hostname}:${r.status}`).join("  ")}`,
      );
    });
  }
}

// Verify: after an execute run, every current hash must be live somewhere.
if (GO) {
  const still = [];
  for (const entry of current) {
    const live = await Promise.all(MIRRORS.map((m) => isLive(m, entry.sha256)));
    if (!live.some(Boolean)) still.push(entry.file);
  }
  if (still.length) fail(`${still.length} faces still unpublished after upload: ${still.slice(0, 5).join(", ")}…`);
  console.log(`verified: all ${current.length} faces live on at least one mirror.`);
  if (uploadFailures) console.log(`note: ${uploadFailures} faces were rejected by every mirror on first PUT but passed verification via retry or cache.`);
} else {
  console.log("dry run complete. Nothing was uploaded or deleted.");
}
