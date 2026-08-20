"use strict";

/* NIP-98 — proving a nostr key over HTTP.
 *
 * The mint's allowlist needs a buyer to prove they hold a listed key. It used
 * to read the key out of the request body, which proves nothing at all: the
 * caller simply stated who they were. This is the replacement.
 *
 * The verification mirrors the NIP-42 path already in server/table.js — the
 * event id is RECOMPUTED from the canonical array and compared, then the
 * signature is checked against that id. Trusting the id a caller sent would let
 * anyone attach a valid signature to different contents.
 *
 * Three things bind a proof to one request, and all three matter:
 *
 *   created_at, within a short window, so a captured header expires.
 *   `u`, so a proof for one endpoint cannot be replayed at another.
 *   `method`, so a GET proof cannot be replayed as a POST.
 *
 * And because a header is capturable inside its window, event ids are
 * remembered for as long as that window lasts: one proof, one request. The set
 * is pruned by time and hard-capped, so a flood cannot grow it without bound —
 * and when it is full the answer is to refuse, not to forget. Forgetting under
 * pressure is exactly when replay becomes possible.
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/98.md
 */

const crypto = require("node:crypto");
const { schnorr } = require("@noble/curves/secp256k1");

const KIND_HTTP_AUTH = 27235;
const DEFAULT_MAX_AGE = 60;          // NIP-98 suggests 60s
const MAX_SEEN = 4096;

const isHex = (value, length) =>
  typeof value === "string" && value.length === length && /^[0-9a-f]+$/i.test(value);

const eventId = (event) => crypto.createHash("sha256").update(JSON.stringify([
  0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
])).digest("hex");

/* Exactly one tag of this name, or nothing. A proof carrying two `u` tags is
 * ambiguous about which endpoint it authorises, and ambiguity on an auth path
 * resolves in the attacker's favour. */
function singleTag(event, name) {
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const found = tags.filter((tag) => Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string");
  return found.length === 1 ? found[0][1] : null;
}

function createSeenStore(maxAgeSeconds) {
  const seen = new Map();            // id -> created_at
  return {
    /* Returns false when this id has been used already, or when the store is
       full. Full means refuse: dropping entries to make room is the one
       behaviour that would reopen replay under load. */
    admit(id, createdAt, now) {
      for (const [key, at] of seen) {
        if (now - at > maxAgeSeconds) seen.delete(key);
        else break;                  // insertion order is roughly time order
      }
      if (seen.has(id)) return false;
      if (seen.size >= MAX_SEEN) return false;
      seen.set(id, createdAt);
      return true;
    },
    get size() { return seen.size; },
  };
}

/* `expectPath` is compared exactly. `expectHost` is compared only when the
 * caller knows its own public host — behind a proxy the request's own Host
 * header is not trustworthy enough to gate money on, and a wrong guess here
 * would lock out every legitimate buyer. Where it is unknown the proof is
 * still bound to the path, the method and the clock. */
function verify(header, options = {}) {
  const maxAge = Number(options.maxAgeSeconds || DEFAULT_MAX_AGE);
  const now = Math.floor((options.now || Date.now()) / 1000);

  if (typeof header !== "string" || !/^Nostr\s+/i.test(header)) {
    return { ok: false, reason: "missing NIP-98 Authorization header" };
  }
  let event;
  try {
    event = JSON.parse(Buffer.from(header.replace(/^Nostr\s+/i, "").trim(), "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "authorization event is not valid base64 JSON" };
  }
  if (!event || typeof event !== "object") return { ok: false, reason: "authorization event is not an object" };
  if (event.kind !== KIND_HTTP_AUTH) return { ok: false, reason: "authorization event is not kind 27235" };
  if (!isHex(event.pubkey, 64) || !isHex(event.id, 64) || !isHex(event.sig, 128)) {
    return { ok: false, reason: "authorization event is malformed" };
  }
  if (!Number.isInteger(event.created_at) || Math.abs(now - event.created_at) > maxAge) {
    return { ok: false, reason: "authorization event is expired or not yet valid" };
  }

  const method = singleTag(event, "method");
  if (!method || method.toUpperCase() !== String(options.method || "GET").toUpperCase()) {
    return { ok: false, reason: "authorization event is for a different method" };
  }

  const raw = singleTag(event, "u");
  if (!raw) return { ok: false, reason: "authorization event has no u tag" };
  let target;
  try { target = new URL(raw); } catch { return { ok: false, reason: "u tag is not an absolute URL" }; }
  if (target.pathname !== options.path) {
    return { ok: false, reason: "authorization event is for a different endpoint" };
  }
  if (options.host && target.host.toLowerCase() !== String(options.host).toLowerCase()) {
    return { ok: false, reason: "authorization event is for a different host" };
  }

  /* Recompute, never trust the supplied id. */
  if (eventId(event) !== event.id.toLowerCase()) {
    return { ok: false, reason: "authorization event id does not match its contents" };
  }
  let signed = false;
  try { signed = schnorr.verify(event.sig, event.id, event.pubkey); } catch { signed = false; }
  if (!signed) return { ok: false, reason: "authorization signature is invalid" };

  /* Last, so a replay check is never spent on an event that was never valid. */
  if (options.seen && !options.seen.admit(event.id.toLowerCase(), event.created_at, now)) {
    return { ok: false, reason: "authorization event has already been used" };
  }

  return { ok: true, pubkey: event.pubkey.toLowerCase(), id: event.id.toLowerCase() };
}

module.exports = { verify, createSeenStore, eventId, KIND_HTTP_AUTH, DEFAULT_MAX_AGE, MAX_SEEN };
