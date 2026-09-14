/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — a member's own look at their seat.
 *
 * A seat that belongs to a key may wear what that key says it looks like. Two
 * events say it, and they are read in this order:
 *
 *   kind 30077 (NIP-3D, nappelin.com specs/nip-visual-identity.md): the look,
 *     bound to hashes. One `imeta` tag per representation, NIP-92 fields:
 *       ["imeta", "role avatar", "x <sha256>", "m image/png",
 *        "url https://blossom.bimcvp.com/<sha256>.png", "dim 1024x1024"]
 *     Nobody publishes one yet (the Hangar will sign one when a character is
 *     delivered), so it is read first and costs nothing while it is absent.
 *   kind 0: `picture`, `display_name`, `name`. The live path for the alpha.
 *
 * The image ladder is role avatar, then role fullbody, then the kind 0 picture,
 * then nothing, which the table answers with its own default portrait. The name
 * ladder is display_name, then name, then the short npub.
 *
 * NEVER BLOCK. resolve() gives up waiting when its relay query runs out of time
 * and answers with the fallback; a relay that answers later still upgrades the
 * look through `onLate`. The table paints its default first and repaints when a
 * look lands, and book() makes sure that repaint only reaches a seat that still
 * belongs to the key the answer is about.
 *
 * Everything from outside is injected (the query, the bytes or a fetch, the
 * signature check, the hash, the clock), so every rung is tested in node
 * (tests/js/identity-look.test.mjs) and this file opens no socket by itself.
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  const HEX64 = /^[0-9a-f]{64}$/;
  const LOOK_KIND = 30077;
  const TIMEOUT_MS = 2500; // the relay query's hard deadline
  const FETCH_MS = 8000; // one image source's deadline
  const MAX_BYTES = 3 * 1024 * 1024;
  /* agent-api uploads a character's image here, and the Hangar grants this host
   * to the TCG's resource requests (nappelin host.ts, TCG_FACE_ORIGINS). */
  const BLOSSOM = "https://blossom.bimcvp.com";
  const NAME_MAX = 40; // what the lobby lets a typed seat name be
  const LATE = {}; // a deadline won the race
  const BIG = {}; // a source over the cap: the same hash elsewhere is no smaller

  /* A call that may be missing, throw or reject, always as a promise. */
  const attempt = (fn, ...args) => Promise.resolve().then(() => fn(...args));
  const pause = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  /* The promise's value, or LATE once `ms` has passed. The loser keeps running. */
  const within = (promise, ms, deps) =>
    Promise.race([promise, attempt(deps.sleep || pause, ms).then(() => LATE)]);

  /* The characters that reorder or hide text: bidi marks, embeddings, overrides
   * and isolates, zero-width spaces, invisible operators, the byte order mark.
   * Told by number, so no such character has to sit in this source. */
  const hidden = (code) => code === 0x200b || code === 0x200e || code === 0x200f || code === 0xfeff
    || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2064) || (code >= 0x2066 && code <= 0x2069);

  /* Relay text for a seat: one line, bounded, with what reorders or hides text
   * taken out. Escaping is the renderer's job, and the table only ever assigns
   * these to textContent. */
  function cleanText(value) {
    if (typeof value !== "string") return null;
    const text = Array.from(value, (ch) => {
      const code = ch.codePointAt(0);
      return code < 0x20 || (code >= 0x7f && code < 0xa0) ? " " : hidden(code) ? "" : ch;
    }).join("").replace(/\s+/g, " ").trim();
    return Array.from(text).slice(0, NAME_MAX).join("").trim() || null;
  }

  /* http(s) only, no credentials, bounded. A picture field is whatever a relay
   * handed over, so `javascript:`, `data:` and `blob:` never become a source. */
  function safeUrl(raw) {
    if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return null;
    try {
      const url = new URL(raw.trim());
      const web = url.protocol === "https:" || url.protocol === "http:";
      return web && !url.username && !url.password ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  /** Kind 0 content: `{ name, nameVia, picture }`, or null when it is not a profile. */
  function parseProfile(event) {
    let meta = null;
    try {
      meta = JSON.parse(event && event.content);
    } catch (error) {
      return null;
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
    const display = cleanText(meta.display_name);
    const name = cleanText(meta.name);
    return {
      name: display || name,
      nameVia: display ? "display_name" : name ? "name" : "none",
      picture: safeUrl(meta.picture),
    };
  }

  /** The representations of a kind 30077: `[{ role, x, m, url, dim, size, alt }]`, in tag order. */
  function parseLook(event) {
    const out = [];
    for (const tag of event && Array.isArray(event.tags) ? event.tags : []) {
      if (!Array.isArray(tag) || tag[0] !== "imeta") continue;
      const field = new Map(); // a Map, so a "__proto__" field is only a field
      for (const raw of tag.slice(1)) {
        const gap = typeof raw === "string" ? raw.indexOf(" ") : -1;
        if (gap > 0 && !field.has(raw.slice(0, gap))) field.set(raw.slice(0, gap), raw.slice(gap + 1).trim());
      }
      const x = String(field.get("x") || "").toLowerCase();
      if (!field.get("role") || !HEX64.test(x)) continue; // the hash is the identity of the media
      const size = Number(field.get("size"));
      out.push({
        role: field.get("role"),
        x,
        m: field.get("m") || null,
        url: safeUrl(field.get("url")),
        dim: field.get("dim") || null,
        size: size > 0 ? size : null,
        alt: cleanText(field.get("alt")),
      });
    }
    return out;
  }

  /* What an <img> will draw, told by the bytes and not by a claimed MIME type. */
  function sniff(bytes) {
    const ascii = (at, text) => bytes.length >= at + text.length
      && Array.from(text).every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
    if (bytes[0] === 0x89 && ascii(1, "PNG")) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (ascii(0, "GIF8")) return "image/gif";
    if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
    if (ascii(4, "ftypavi")) return "image/avif"; // avif and avis
    return null;
  }

  async function digest(bytes, deps) {
    if (typeof deps.sha256 === "function") return String(await deps.sha256(bytes)).toLowerCase();
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* One source's bytes: the injected `bytes` (a shell's resource NAP), else a
   * `fetch` that stops reading at the cap. Bytes, BIG, or null for "not here". */
  async function read(url, deps, max, abort) {
    if (typeof deps.bytes === "function") return deps.bytes(url);
    if (typeof deps.fetch !== "function") return null;
    const response = await deps.fetch(url, {
      credentials: "omit", referrerPolicy: "no-referrer", signal: abort ? abort.signal : undefined,
    });
    if (!response || !response.ok) return null;
    const headers = response.headers;
    if (Number(headers && typeof headers.get === "function" && headers.get("content-length")) > max) return BIG;
    const reader = response.body && typeof response.body.getReader === "function" ? response.body.getReader() : null;
    if (!reader) return response.arrayBuffer();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        attempt(() => reader.cancel()).catch(() => {});
        return BIG;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    chunks.reduce((at, chunk) => (all.set(chunk, at), at + chunk.byteLength), 0);
    return all;
  }

  /* One source, checked: under the cap, the sha256 when one is known, a format
   * an <img> draws. Answers an object URL, BIG, or null. */
  async function load(url, x, deps) {
    const max = deps.maxBytes || MAX_BYTES;
    const abort = typeof AbortController === "function" ? new AbortController() : null;
    const reading = attempt(read, url, deps, max, abort);
    reading.catch(() => {}); // a source that fails after its deadline is nobody's error
    try {
      let data = await within(reading, deps.fetchTimeout || FETCH_MS, deps);
      if (data === LATE) {
        if (abort) abort.abort();
        return null;
      }
      if (data === BIG) return BIG;
      if (!data) return null;
      if (typeof data.size === "number" && data.size > max) return BIG; // a Blob knows before it is read
      if (typeof data.arrayBuffer === "function") data = await data.arrayBuffer();
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
        : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (!bytes) return null;
      if (bytes.byteLength > max) return BIG;
      if (x && (await digest(bytes, deps)) !== x) return null;
      const type = sniff(bytes);
      if (!type) return null;
      const blob = new Blob([bytes], { type });
      return deps.objectUrl ? deps.objectUrl(blob) : globalThis.URL.createObjectURL(blob);
    } catch (error) {
      return null;
    }
  }

  /* The image ladder. Each imeta entry is one rung: its bytes come by hash from
   * Blossom, then from its own `url` hint, and a mismatch, a refusal or a format
   * we cannot draw drops to the next entry. */
  async function climbImage(look, profile, deps) {
    for (const role of ["avatar", "fullbody"]) {
      for (const rep of look.filter((entry) => entry.role === role)) {
        if (rep.size && rep.size > (deps.maxBytes || MAX_BYTES)) continue; // declared too big: never fetched
        const sources = [`${deps.blossom || BLOSSOM}/${rep.x}`, rep.url];
        for (const url of sources.filter((item, i) => item && sources.indexOf(item) === i)) {
          const got = await load(url, rep.x, deps);
          if (got === BIG) break;
          if (got) return { url: got, via: role };
        }
      }
    }
    if (profile && profile.picture) {
      /* No hash to check a kind 0 picture against. Where the page may load
       * images itself (the website) the URL is the answer; inside a shell the
       * bytes have to come through it. */
      if (deps.hotlink) return { url: profile.picture, via: "picture" };
      const got = await load(profile.picture, null, deps);
      if (got && got !== BIG) return { url: got, via: "picture" };
    }
    return { url: null, via: "none" };
  }

  const shortName = (pubkey, deps) => {
    let short = null;
    try {
      short = typeof deps.npub === "function" ? cleanText(deps.npub(pubkey)) : null;
    } catch (error) {
      short = null;
    }
    return short || `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
  };

  const blank = (pubkey, deps) => ({
    pubkey,
    name: pubkey ? shortName(pubkey, deps) : null,
    nameVia: pubkey ? "npub" : "none",
    image: { url: null, via: "none" },
  });

  const dTag = (event) => {
    const tag = event.tags.find((item) => Array.isArray(item) && item[0] === "d");
    return tag && typeof tag[1] === "string" ? tag[1] : "";
  };

  /* Signatures are checked one at a time and only until one holds, so only an
   * event that is used costs a verification. No verifier, no trust. */
  async function firstVerified(events, deps) {
    for (const event of events) {
      if (await attempt(deps.verify, event).then((ok) => ok === true, () => false)) return event;
    }
    return null;
  }

  async function climb(pubkey, events, deps) {
    const mine = (Array.isArray(events) ? events : [])
      // The Hangar's outbox answers { event, sidecar } items; a relay answers events.
      .map((item) => (item && item.event && typeof item.event === "object" ? item.event : item))
      .filter((event) => event && event.pubkey === pubkey && Array.isArray(event.tags) && typeof event.content === "string")
      .sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
    const profileEvent = await firstVerified(mine.filter((event) => event.kind === 0), deps);
    // The default look (`["d", ""]`) first, each group newest first: sort is stable.
    const looks = mine.filter((event) => event.kind === LOOK_KIND)
      .sort((a, b) => (dTag(a) === "" ? 0 : 1) - (dTag(b) === "" ? 0 : 1));
    const lookEvent = await firstVerified(looks, deps);
    const profile = profileEvent ? parseProfile(profileEvent) : null;
    const image = await climbImage(lookEvent ? parseLook(lookEvent) : [], profile, deps);
    const named = Boolean(profile && profile.name);
    return {
      pubkey,
      name: named ? profile.name : shortName(pubkey, deps),
      nameVia: named ? profile.nameVia : "npub",
      image,
    };
  }

  /**
   * What `pubkey` looks like: `{ pubkey, name, nameVia, image: { url, via } }`.
   * `via` is avatar | fullbody | picture | none; `nameVia` is display_name | name | npub | none.
   * deps: query(filters) (required for any answer), verify(event), bytes(url) or fetch,
   * hotlink, npub(hex), sha256(bytes), objectUrl(blob), sleep(ms), timeout, fetchTimeout,
   * maxBytes, blossom, onLate(look).
   */
  async function resolve(pubkey, deps) {
    const d = deps || {};
    const key = typeof pubkey === "string" ? pubkey.trim().toLowerCase() : "";
    if (!HEX64.test(key)) return blank(null, d);
    const filters = [{ kinds: [LOOK_KIND], authors: [key], limit: 8 }, { kinds: [0], authors: [key], limit: 1 }];
    const asked = attempt(d.query, filters).catch(() => []);
    const answer = await within(asked, Number.isFinite(d.timeout) ? d.timeout : TIMEOUT_MS, d);
    if (answer !== LATE) return climb(key, answer, d).catch(() => blank(key, d));
    if (typeof d.onLate === "function") {
      asked.then((events) => climb(key, events, d)).then((look) => {
        if (look.image.url || look.nameVia !== "npub") d.onLate(look);
      }).catch(() => {});
    }
    return blank(key, d);
  }

  /**
   * One lookup per key for the life of the page, and seats that change hands.
   * `seat(key, pubkey, onChange)` says whom a seat shows now and answers the look
   * known so far (null before the first answer). When an answer lands, on time or
   * late, every seat STILL showing that key hears it once; a seat that has changed
   * hands does not. A look that replaces another revokes the object URL it held.
   */
  function book(deps) {
    const d = deps || {};
    const known = new Map(); // pubkey -> look
    const asked = new Set();
    const seats = new Map(); // seat key -> { pubkey, onChange }
    const revoke = (url) => {
      if (!/^blob:/.test(url || "")) return; // only an object URL is ours; a hotlinked picture is not
      try {
        if (d.revoke) d.revoke(url);
        else globalThis.URL.revokeObjectURL(url);
      } catch (error) {
        /* already gone */
      }
    };
    function land(pubkey, look, late) {
      const held = known.get(pubkey);
      if (held && !late) return; // a late answer already upgraded this key
      if (held && held.image.url !== look.image.url) revoke(held.image.url);
      known.set(pubkey, look);
      if (!held && !look.image.url && look.nameVia === "npub") return; // nothing to repaint
      const told = new Set();
      for (const seat of seats.values()) {
        if (seat.pubkey !== pubkey || typeof seat.onChange !== "function" || told.has(seat.onChange)) continue;
        told.add(seat.onChange);
        attempt(seat.onChange, look).catch(() => {});
      }
    }
    return {
      seat(key, pubkey, onChange) {
        const pk = typeof pubkey === "string" && HEX64.test(pubkey) ? pubkey : null;
        if (!pk) {
          seats.delete(key);
          return null;
        }
        seats.set(key, { pubkey: pk, onChange });
        if (!asked.has(pk)) {
          asked.add(pk);
          resolve(pk, Object.assign({}, d, { onLate: (look) => land(pk, look, true) }))
            .then((look) => land(pk, look, false), () => land(pk, blank(pk, d), false));
        }
        return known.get(pk) || null;
      },
      /** An image the browser would not draw: its key keeps the name, loses the image. */
      broken(url) {
        for (const [pubkey, look] of known) {
          if (url && look.image.url === url) land(pubkey, Object.assign({}, look, { image: { url: null, via: "none" } }), true);
        }
      },
      peek: (pubkey) => known.get(pubkey) || null,
    };
  }

  const API = {
    resolve,
    book,
    parseProfile,
    parseLook,
    safeUrl,
    sniff,
    LIMITS: Object.freeze({ timeout: TIMEOUT_MS, fetchTimeout: FETCH_MS, maxBytes: MAX_BYTES, blossom: BLOSSOM }),
  };
  globalThis.E1Look = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
