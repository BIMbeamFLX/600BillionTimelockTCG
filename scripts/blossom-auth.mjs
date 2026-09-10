/* Blossom authorization for the publishing scripts (BUD-11).
 *
 * One kind-24242 event per request, signed by the key in PALACE_NSEC (nsec1...
 * or 64-char hex). The key is read once and never logged. The header carries
 * the event as base64url without padding, the form BUD-11 specifies since
 * April 2026; the mirrors this project uses also accept the older padded
 * base64, so a script that still sends that keeps working.
 */

import { createHash, randomBytes } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";

export function decodeBech32(nsec) {
  // Minimal bech32 decode, enough for nsec1: no external dependency touches
  // the key. Checksum is verified; a typo fails loudly instead of signing junk.
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const lower = nsec.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1) throw new Error("key does not look like bech32");
  const hrp = lower.slice(0, sep);
  const data = [...lower.slice(sep + 1)].map((c) => CHARSET.indexOf(c));
  if (data.includes(-1)) throw new Error("key has an invalid bech32 character");
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
  if (polymod(hrpExpand.concat(data)) !== 1) throw new Error("bech32 checksum does not verify");
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
  if (hrp !== "nsec") throw new Error(`expected an nsec key, got ${hrp}`);
  if (bytes.length !== 32) throw new Error("decoded key is not 32 bytes");
  return Buffer.from(bytes);
}

export function loadKey(env = process.env) {
  const raw = (env.PALACE_NSEC ?? "").trim();
  if (!raw) throw new Error("PALACE_NSEC is not set. Set it in THIS shell; it never leaves the process.");
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return decodeBech32(raw);
}

export function publicKeyHex(secret) {
  return Buffer.from(schnorr.getPublicKey(secret)).toString("hex");
}

/* `verb` is one of upload, delete, list, get, media; `sha` is the blob hash
   the event is about (the `x` tag). Returns the Authorization header value. */
export function signedAuth(secret, verb, sha, description, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    pubkey: publicKeyHex(secret),
    created_at: now,
    kind: 24242,
    tags: [["t", verb], ["x", sha], ["expiration", String(now + ttlSeconds)]],
    content: description,
  };
  const payload = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  event.id = createHash("sha256").update(payload).digest("hex");
  event.sig = Buffer.from(schnorr.sign(event.id, secret, randomBytes(32))).toString("hex");
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64url")}`;
}
