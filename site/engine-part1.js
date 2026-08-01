/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — E1 Referee Core.
 *
 * A pure, deterministic, serialisable, action-driven, redactable rules engine.
 * No DOM, no window, no Math.random, no Date.now. Every state change arrives as
 * a validated action; every random draw comes from a seeded stream that lives
 * inside the state, so replaying the action log reproduces the state exactly.
 *
 *   createGame(config, ctx)        -> state
 *   apply(state, action, ctx)      -> { state, events, error }
 *   applyMany(state, actions, ctx) -> { state, events, error, failedAt }
 *   view(state, seat)              -> redacted state (0 | 1 | null | "audit")
 *   legalActions(stateOrView, seat)-> [actionTemplate]
 *   hashState(state) / publicHash(state) / canonicalJSON(value)
 *   replay(config, log, ctx)       -> { state, events, error, failedAt }
 *   verifyMatch({config, log})     -> { ok, result, headHash, divergedAt }
 *
 * Loads in a browser via <script src="engine.js"> and under node via require().
 * Sections below mirror the module layout of the design spec: canonical, sha256,
 * rng, catalog, core, actions, manual, ops, rules, view.
 * ------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory(root);
  root.E1Engine = Object.assign(root.E1Engine || {}, api);
  if (typeof module === "object" && module.exports) module.exports = root.E1Engine;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  // ------------------------------------------------------------- errors

  /* Rules failures are values, not exceptions, at the apply() boundary. Inside
   * the reducer they travel as throws so any validator can abort the draft from
   * arbitrary depth without every caller threading an error return. */
  class RulesError extends Error {
    constructor(code, message, detail) {
      super(message || code);
      this.name = "RulesError";
      this.code = code;
      this.detail = detail === undefined ? null : detail;
    }
  }

  const fail = (code, message, detail) => {
    throw new RulesError(code, message, detail);
  };

  // ------------------------------------------------- canonical.js

  /* Sorted-key, whitespace-free JSON. The integer guard is the point of the
   * whole function: a float that reaches state is a replay divergence waiting
   * for a different JS engine, and this is the one place it can be stopped. */
  function canonicalWrite(value, out, path) {
    if (value === null) {
      out.push("null");
      return;
    }
    const type = typeof value;
    if (type === "boolean") {
      out.push(value ? "true" : "false");
      return;
    }
    if (type === "number") {
      if (!Number.isFinite(value)) fail("SCHEMA", `canonicalJSON: non-finite number at ${path}`);
      if (!Number.isInteger(value)) fail("SCHEMA", `canonicalJSON: non-integer ${value} at ${path}`);
      if (!Number.isSafeInteger(value)) fail("SCHEMA", `canonicalJSON: unsafe integer at ${path}`);
      if (Object.is(value, -0)) fail("SCHEMA", `canonicalJSON: negative zero at ${path}`);
      out.push(String(value));
      return;
    }
    if (type === "string") {
      out.push(JSON.stringify(value));
      return;
    }
    if (Array.isArray(value)) {
      out.push("[");
      for (let i = 0; i < value.length; i++) {
        if (i) out.push(",");
        canonicalWrite(value[i], out, `${path}[${i}]`);
      }
      out.push("]");
      return;
    }
    if (type === "object") {
      if (value instanceof Map || value instanceof Set) {
        fail("SCHEMA", `canonicalJSON: Map/Set at ${path}`);
      }
      // Default Array#sort compares UTF-16 code units, which is exactly the
      // ordering the spec fixes. localeCompare would be locale-dependent.
      const keys = Object.keys(value).sort();
      out.push("{");
      let first = true;
      for (const key of keys) {
        const item = value[key];
        if (item === undefined) fail("SCHEMA", `canonicalJSON: undefined at ${path}.${key}`);
        if (!first) out.push(",");
        first = false;
        out.push(JSON.stringify(key), ":");
        canonicalWrite(item, out, `${path}.${key}`);
      }
      out.push("}");
      return;
    }
    fail("SCHEMA", `canonicalJSON: unsupported ${type} at ${path}`);
  }

  function canonicalJSON(value) {
    const out = [];
    canonicalWrite(value, out, "$");
    return out.join("");
  }

  /* The round trip is also the serialisability assertion: a Map, Set, class
   * instance or function is destroyed here and a test catches it immediately. */
  const cloneJson = (value) => JSON.parse(JSON.stringify(value));

  // ------------------------------------------------------ sha256.js

  /* Vendored because crypto.subtle is async (a synchronous reducer cannot await
   * it) and node:crypto does not exist in a browser. FNV-1a was rejected: its
   * multiplier is invertible, so a colliding suffix is algebraic, and the manual
   * `note` op hands an attacker a controlled byte run inside the hashed state. */
  const SHA_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function utf8Bytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      } else {
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 63),
          0x80 | ((code >> 6) & 63),
          0x80 | (code & 63)
        );
      }
    }
    return out;
  }

  function sha256hex(text) {
    const bytes = utf8Bytes(text);
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // Length is written as a 64-bit big-endian count; the high word is derived
    // with division rather than shifts because bitLength can exceed 2^32.
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
    bytes.push((low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const j = offset + i * 4;
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15];
        const y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const hex = (n) => n.toString(16).padStart(8, "0");
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
  }

  // ---------------------------------------------------------- rng.js

  /* mulberry32: one int32 of state, so a stream serialises as a JSON number and
   * Math.imul / |0 / >>>0 are bit-exact on every engine and trivial to port. */
  function nextU32(stream) {
    const a = (stream.s + 0x6d2b79f5) | 0;
    stream.s = a;
    stream.n += 1;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /* Integer rejection sampling: unbiased AND float-free. Math.floor(rand()*n)
   * drags IEEE-754 into a value another implementation must reproduce exactly.
   * Rejection makes the draw count data-dependent, which is why `n` is tracked
   * and hashed rather than assumed. */
  function nextInt(stream, n) {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      x = nextU32(stream);
    } while (x >= limit);
    return x % n;
  }

  /* Fisher-Yates, descending, nextInt(i+1), swap. No variants. */
  function shuffleInPlace(list, stream) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = nextInt(stream, i + 1);
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  const newStream = (seed) => ({ alg: "mulberry32", s: seed | 0, n: 0 });

  // ------------------------------------------------------ catalog.js

  const SYMBOLS = ["P", "B", "K", "S", "T"];
  const BUFFER_KEYS = ["P", "B", "K", "S", "T", "N"];
  const AFFINITY_SYMBOL = { Power: "P", Bitcoin: "B", Keys: "K", Signal: "S", Timelock: "T" };
  const SYMBOL_AFFINITY = { P: "Power", B: "Bitcoin", K: "Keys", S: "Signal", T: "Timelock" };
  const ZONE_NAMES = ["stack", "wallet", "network", "archive", "cold", "stake", "queue"];
  const ZONE_NOUNS = {
    stack: "stack", wallet: "wallet", hand: "wallet", network: "network",
    archive: "archive", "cold storage": "cold", cold: "cold", stake: "stake", queue: "queue",
  };

  const isResourceCard = (card) => card.type === "Basic Resource" || card.type === "Resource";
  const isAvatarCard = (card) => card.type.indexOf("Avatar") >= 0;
  const isPermanentCard = (card) =>
    isResourceCard(card) || /Avatar|Hardware|Protocol/.test(card.type);
  const cardHasKeyword = (card, name) => card.keywords.some((k) => k.name === name);

  /* Strict cost grammar. play.js:379-382 scraped any capital letter out of the
   * cost string, so an assisted ability whose "cost" is really a fragment of
   * prose ("Other Zombies have \"K") charged the player a Keys Resource. A cost
   * we cannot parse confidently charges nothing and is flagged instead. */
  function parseAbilityCost(cost, cardName) {
    const result = { costParsed: null, commit: false, archiveSelf: false, strictCost: true };
    const raw = String(cost || "").trim();
    if (!raw) return result;
    const parsed = { generic: 0 };
    let sawSymbol = false;
    for (const piece of raw.split(/\s*(?:,|—|--)\s*/)) {
      const token = piece.trim();
      if (!token) continue;
      if (/^Commit$/i.test(token)) {
        result.commit = true;
        continue;
      }
      if (cardName && new RegExp(`^Commit and archive ${escapeRe(cardName)}$`, "i").test(token)) {
        result.commit = true;
        result.archiveSelf = true;
        continue;
      }
      if (/^Maintenance$/i.test(token)) continue;
      if (/^X$/i.test(token)) continue; // X is chosen at announce, not printed here
      if (/^\d+$/.test(token)) {
        parsed.generic += Number(token);
        sawSymbol = true;
        continue;
      }
      if (/^[PBKST]+$/.test(token)) {
        for (const ch of token) parsed[ch] = (parsed[ch] || 0) + 1;
        sawSymbol = true;
        continue;
      }
      result.strictCost = false;
      return result; // prose: charge nothing, let the manual layer handle it
    }
    if (sawSymbol) result.costParsed = parsed;
    return result;
  }

  const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* §2.3 manualEnvelope, derived mechanically from printed text. Kept in JS as
   * well as in build_play_data.py so the engine works against catalogs built
   * before that change landed; a `manualEnvelope` already in the data wins. */
  const ENVELOPE_VERBS = [
    [/\b(decommission|archiv\w*|destroy|exile|return)\b/i, ["moveObject"]],
    [/\bdeals?\b[^.]*\bdamage\b|\bdamage\b/i, ["addDamage", "addUptime", "removeDamage"]],
    [/gets?\s*[+-]\d+\s*(?:\/|Action)/i, ["addTempMod"]],
    [/\bdraws?\b/i, ["moveTopOfStack"]],
    [/\bgenerates?\b/i, ["addBuffer"]],
    [/\bgains?\s+\w*\s*Uptime\b|\bUptime\b/i, ["addUptime"]],
    [/\b(marker|counter)s?\b/i, ["addCounter"]],
    [/\bgain control\b|\bunder your control\b/i, ["setController"]],
    [/\bInvalidate\b/i, ["invalidateQueueItem"]],
    [/\b(unlock|commit)s?\b/i, ["setCommitted"]],
    [/\bshuffles?\b/i, ["shuffleZone"]],
    [/\breveals?\b/i, ["revealZone"]],
    [/\bdiscards?\b/i, ["moveObject", "moveRandomFromZone"]],
    [/\bReboot\b/i, ["addRebootShield"]],
    [/\bResource play\b|\badditional Resource\b/i, ["setResourcePlays"]],
    [/\bpays?\b|\bspends?\b/i, ["spendBuffer"]],
  ];

  function deriveEnvelope(text, card) {
    const body = String(text || "");
    const ops = new Set(["note"]); // a bare announcement is always in envelope
    for (const [pattern, verbs] of ENVELOPE_VERBS) {
      if (pattern.test(body)) for (const verb of verbs) ops.add(verb);
    }
    const numbers = (body.match(/\d+/g) || []).map(Number).filter(Number.isInteger);
    const statFloor = Math.max(card.action || 0, card.resilience || 0, 1);
    const maxAmount = numbers.length ? Math.max(...numbers) : statFloor;
    const touchesUptime = /\bUptime\b|\bdamage\b/i.test(body);
    const sweeping = /\beach\b|\ball\b|\bevery\b/i.test(body);
    const zones = [];
    for (const [noun, zone] of Object.entries(ZONE_NOUNS)) {
      if (new RegExp(`\\b${escapeRe(noun)}\\b`, "i").test(body) && zones.indexOf(zone) < 0) {
        zones.push(zone);
      }
    }
    return {
      ops: Array.from(ops).sort(),
      maxAmount: Math.max(maxAmount, 1),
      maxUptimeSwing: touchesUptime ? Math.max(maxAmount, 1) : 0,
      maxObjectsTouched: sweeping ? 999 : 2,
      mayTargetOpponent: /\btarget\b|\beach\b|\bopponent\b|\bplayer\b/i.test(body),
      zones: zones.sort(),
      mayCreateTokens: /\btoken\b/i.test(body),
      mayChangeController: /\bgain control\b|\bunder your control\b/i.test(body),
    };
  }

  /* What each compiled op needs the player to choose at announcement (§11.2).
   * Targets are locked when the item goes on the Queue, so this list is
   * computed once at announce and consumed positionally at resolution. */
  function targetSpecFor(ops) {
    const spec = [];
    for (const op of ops || []) {
      switch (op.op) {
        case "damage":
          if (op.target === "any") spec.push({ kind: "any", prompt: "target for damage" });
          else if (op.target === "avatar") spec.push({ kind: "avatar", prompt: "Avatar to damage" });
          else if (op.target === "player") spec.push({ kind: "seat", prompt: "player to damage" });
          break;
        case "pump":
          if (op.target === "target-avatar") spec.push({ kind: "avatar", prompt: "Avatar to pump" });
          break;
        case "decommission":
          if (op.scope === "target") {
            spec.push({ kind: "type:" + op.kind, prompt: `${op.kind} to decommission` });
          }
          break;
        case "reboot":
          if (op.scope === "target") spec.push({ kind: "avatar", prompt: "Avatar to Reboot" });
          break;
        case "uptime":
          if (op.target === "player") spec.push({ kind: "seat", prompt: "player to gain Uptime" });
          break;
        case "discard":
          if (op.target === "player") spec.push({ kind: "seat", prompt: "player who discards" });
          break;
        default:
          break;
      }
    }
    return spec;
  }

  /* Ops that fire when a permanent resolves, or when a Zap/Operation resolves. */
  function cardPlayOps(card) {
    const ops = [];
    for (const ability of card.abilities) {
      if (ability.manual || !ability.ops) continue;
      if (ability.kind === "play" || ability.kind === "static") ops.push(...ability.ops);
    }
    return ops;
  }

  function compileCard(raw) {
    const card = cloneJson(raw);
    card.abilities = (card.abilities || []).map((ability) => {
      const cost = parseAbilityCost(ability.cost, card.name);
      const compiled = Object.assign({}, ability, {
        costParsed: ability.costParsed !== undefined ? ability.costParsed : cost.costParsed,
        commit: ability.commit !== undefined ? ability.commit : cost.commit,
        archiveSelf: cost.archiveSelf,
        strictCost: cost.strictCost,
        resourceAbility:
          ability.resourceAbility !== undefined
            ? ability.resourceAbility
            : Boolean(ability.ops) && ability.ops.every((op) => op.op === "generate"),
      });
      compiled.targetSpec = targetSpecFor(compiled.ops);
      if (compiled.manual) {
        compiled.manualEnvelope = ability.manualEnvelope || deriveEnvelope(ability.text, card);
      }
      return compiled;
    });
    card.playOps = cardPlayOps(card);
    card.playTargetSpec = targetSpecFor(card.playOps);
    card.isResource = isResourceCard(card);
    card.isAvatar = isAvatarCard(card);
    card.isPermanent = isPermanentCard(card);
    return card;
  }

  /* The digest covers rules-facing fields only. Flavour, help text and artwork
   * filenames change constantly and must not invalidate an in-flight match. */
  function rulesFacing(card) {
    return {
      id: card.id,
      name: card.name,
      type: card.type,
      subtype: card.subtype,
      affinity: card.affinity,
      cost: card.cost,
      costParsed: card.costParsed || null,
      action: card.action === null || card.action === undefined ? null : card.action,
      resilience: card.resilience === null || card.resilience === undefined ? null : card.resilience,
      keywords: card.keywords,
      abilities: card.abilities.map((a) => ({
        kind: a.kind,
        cost: a.cost,
        text: a.text,
        ops: a.ops || null,
        manual: Boolean(a.manual),
      })),
    };
  }

  function buildCatalog(cards) {
    if (!Array.isArray(cards)) fail("CATALOG_MISMATCH", "catalog must be an array of cards");
    const byId = Object.create(null);
    const ids = [];
    for (const raw of cards) {
      if (!raw || typeof raw.id !== "string") fail("CATALOG_MISMATCH", "card without a string id");
      if (byId[raw.id]) fail("CATALOG_MISMATCH", `duplicate card id ${raw.id}`);
      byId[raw.id] = compileCard(raw);
      ids.push(raw.id);
    }
    const digest =
      "sha256:" + sha256hex(canonicalJSON(ids.map((id) => rulesFacing(byId[id]))));
    return { byId, ids, digest, size: ids.length };
  }

  /* ------------------------------ end of section: canonical / sha256 / rng /
   * catalog. The remaining sections (core, actions, manual, ops, rules, view)
   * continue inside this same factory closure. */
