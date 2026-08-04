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
        case "grant":
          if (op.scope === "target") {
            spec.push({ kind: "avatar", prompt: `Avatar to gain ${op.keyword}` });
          }
          break;
        case "unlock":
        case "commit":
          spec.push({
            kind: op.kind === "permanent" ? "permanent" : "type:" + op.kind,
            prompt: `${op.kind === "permanent" ? "card" : op.kind} to ${op.op}`,
          });
          break;
        case "bounce":
          spec.push({ kind: "avatar", prompt: "Avatar to return to its owner's Wallet" });
          break;
        case "moveTop":
          if (op.seat === undefined) spec.push({ kind: "seat", prompt: "player who draws from their Stack" });
          break;
        case "coldStorage":
          spec.push({ kind: "avatar", prompt: "Avatar to Cold Storage" });
          break;
        case "prevent":
          if (op.target !== "you") spec.push({ kind: "any", prompt: "target to shield" });
          break;
        case "invalidate":
          spec.push({
            kind: "queue",
            affinity: op.filter && op.filter.affinity,
            prompt: (op.filter && op.filter.affinity ? op.filter.affinity + " " : "") + "card on the Queue",
          });
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
            : ability.kind === "activated" &&
              Boolean(ability.ops) &&
              ability.ops.every((op) => op.op === "generate"),
      });
      compiled.targetSpec = targetSpecFor(compiled.ops);
      if (compiled.manual) {
        compiled.manualEnvelope = ability.manualEnvelope || deriveEnvelope(ability.text, card);
      }
      return compiled;
    });
    card.playOps = cardPlayOps(card);
    // "Choose one —": each mode carries its own ops and target spec.
    const modal = card.abilities.find((a) => a.kind === "modal" && !a.manual && a.modes);
    card.playModes = modal
      ? modal.modes.map((mode) => ({ text: mode.text, ops: mode.ops, targetSpec: targetSpecFor(mode.ops) }))
      : null;
    card.playTargetSpec = targetSpecFor(card.playOps);
    // An Attachment is played AT a host: the host is the play's target.
    const attach = (card.keywords || []).find((k) => k.name === "Attach");
    if (attach && !card.playTargetSpec.length) {
      const to = attach.to || "Avatar";
      const kind =
        to === "Avatar" ? "avatar" : to === "Firewall" ? "keyword:Firewall" : "type:" + to;
      card.playTargetSpec = [{ kind, prompt: `${to} to attach ${card.name} to` }];
    }
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
  // ------------------------------------------------------------ core.js

  const HAND_LIMIT = 7;
  const START_UPTIME = 20;
  const MIN_STACK = 40;

  const PHASE_ORDER = ["open", "build1", "clash", "build2", "close"];
  const PHASE_STEPS = {
    open: ["unlock", "maintenance", "draw"],
    build1: ["main"],
    clash: ["start", "attackers", "blockers", "order", "firstStrike", "damage", "end"],
    build2: ["main"],
    close: ["endStep", "cleanup"],
  };
  /* The eight visible slots of the printed turn structure, in order. play.html
   * renders this ribbon; the engine's (phase, step) pair is the authority. */
  const TURN_RIBBON = [
    { phase: "open", step: "unlock", label: "Unlock" },
    { phase: "open", step: "maintenance", label: "Maintenance" },
    { phase: "open", step: "draw", label: "Draw" },
    { phase: "build1", step: "main", label: "Build I" },
    { phase: "clash", step: null, label: "Clash" },
    { phase: "build2", step: "main", label: "Build II" },
    { phase: "close", step: "endStep", label: "End" },
    { phase: "close", step: "cleanup", label: "Cleanup" },
  ];

  const DEFAULT_POLICY = {
    priority: "full",
    manualConsent: "ask",
    freeform: "allow",
    manualBudget: null,
    assistedAnnounce: "advisory",
  };

  const HARD_CAPS = {
    uptimeSwing: 20,
    objectsTouched: 8,
    cardsDrawn: 7,
    bufferAdded: 8,
    opsPerDelta: 12,
  };

  let defaultCatalog = null;

  function setCatalog(cards) {
    defaultCatalog = Array.isArray(cards) ? buildCatalog(cards) : cards;
    return defaultCatalog;
  }

  /* The catalog is injected, never stored in state: it keeps the state small
   * and makes redaction a one-field operation (hide a card by omitting cardId). */
  function resolveCtx(ctx) {
    const given = ctx || {};
    let catalog = given.catalog || null;
    if (Array.isArray(catalog)) catalog = buildCatalog(catalog);
    if (!catalog) {
      if (!defaultCatalog && root && Array.isArray(root.E1_CARDS)) setCatalog(root.E1_CARDS);
      catalog = defaultCatalog;
    }
    if (!catalog || !catalog.byId) fail("CATALOG_MISMATCH", "no card catalog available");
    return {
      catalog,
      authenticatedSeat:
        given.authenticatedSeat === undefined ? null : given.authenticatedSeat,
      policy: given.policy || null,
      verifySignatures: Boolean(given.verifySignatures),
    };
  }

  const cardOf = (ctx, cardId) => {
    const card = ctx.catalog.byId[cardId];
    if (!card) fail("CATALOG_MISMATCH", `unknown card ${cardId}`);
    return card;
  };
  const cardFor = (env, uid) => cardOf(env.ctx, objectOf(env.state, uid).cardId);

  // ----------------------------------------------------------- zone helpers

  const zoneKey = (seat, zone) => `${seat}:${zone}`;
  const zoneSeat = (key) => Number(key.split(":")[0]);
  const zoneName = (key) => key.split(":")[1];

  function zoneArray(state, key) {
    const list = state.zones[key];
    if (!list) fail("NOT_IN_ZONE", `unknown zone ${key}`);
    return list;
  }

  function objectOf(state, uid) {
    const object = state.objects[uid];
    if (!object) fail("UNKNOWN_OBJECT", `unknown object ${uid}`);
    return object;
  }

  const objectsIn = (state, key) => zoneArray(state, key).map((uid) => state.objects[uid]);

  function mintUid(state) {
    // "o"-prefixed on purpose: integer-like keys order differently under
    // JSON.stringify than under a code-unit-sorted canonicaliser, and anywhere
    // those two meet is a silent hash divergence.
    const uid = "o" + state.nextUid;
    state.nextUid += 1;
    return uid;
  }

  function removeFromZone(state, key, uid) {
    const list = zoneArray(state, key);
    const index = list.indexOf(uid);
    if (index < 0) fail("NOT_IN_ZONE", `${uid} is not in ${key}`);
    list.splice(index, 1);
  }

  function insertIntoZone(state, key, uid, position) {
    const list = zoneArray(state, key);
    if (position === undefined || position === null || position >= list.length) list.push(uid);
    else list.splice(Math.max(0, position), 0, uid);
  }

  function newObjectRecord(state, ctx, cardId, owner, controller, key, prevUid) {
    const card = cardOf(ctx, cardId);
    const zone = zoneName(key);
    return {
      uid: mintUid(state),
      cardId,
      owner,
      controller,
      zone: key,
      committed: false,
      // §5.2 Boot Delay is a RULE for every Avatar entering the Network, not a
      // printed keyword. play.js:513 read it off card.keywords, so only the
      // handful of cards that print the word were ever delayed.
      bootDelay: zone === "network" && card.isAvatar,
      damage: 0,
      counters: {},
      attachedTo: null,
      rebootShields: 0,
      facedown: false,
      revealedTo: [],
      revealedUntil: null,
      token: false,
      entersSeq: state.seq,
      prevUid: prevUid || null,
    };
  }

  /* §6.1 — every zone change except Network->Network mints a fresh object with
   * no memory of the old one. This is also an anti-cheat primitive: shuffling a
   * hidden zone re-mints every uid in it, so uid tracking conveys exactly what
   * a physical table conveys and no more. prevUid keeps the audit chain, and is
   * stripped from every view. */
  function moveUid(env, uid, toZone, options) {
    const state = env.state;
    const object = objectOf(state, uid);
    const settings = options || {};
    const fromKey = object.zone;
    const publicZone = toZone === "network" || toZone === "queue" || toZone === "stake";
    const toSeat =
      settings.seat !== undefined && settings.seat !== null
        ? settings.seat
        : publicZone
          ? object.controller
          : object.owner; // §17.2 a controlled card leaves to its OWNER's zone
    const toKey = zoneKey(toSeat, toZone);
    const networkToNetwork = zoneName(fromKey) === "network" && toZone === "network";

    removeFromZone(state, fromKey, uid);
    if (networkToNetwork) {
      object.zone = toKey;
      object.controller = toSeat;
      insertIntoZone(state, toKey, uid, settings.position);
      return object;
    }
    delete state.objects[uid];
    const record = newObjectRecord(state, env.ctx, object.cardId, object.owner, toSeat, toKey, uid);
    record.token = object.token;
    record.facedown = toZone === "cold" ? Boolean(settings.facedown) : false;
    state.objects[record.uid] = record;
    insertIntoZone(state, toKey, record.uid, settings.position);
    pruneReferences(state, uid);
    // Zone-change triggers, raised after the move so watchers see the settled
    // board. The moved card never watches its own move (triggerMatches).
    const movedCard = cardOf(env.ctx, record.cardId);
    if (toZone === "network" && zoneName(fromKey) !== "network") {
      raiseTriggers(env, "enters", {
        uid: record.uid,
        seat: toSeat,
        type: movedCard.type,
        affinity: movedCard.affinity,
      });
    }
    if (zoneName(fromKey) === "network" && toZone === "archive") {
      raiseTriggers(env, "network-archived", {
        uid: record.uid,
        seat: object.controller,
        type: movedCard.type,
        affinity: movedCard.affinity,
      });
    }
    return record;
  }

  /* §3.1 invariant 5: effects and queue targets never point at a dead uid. */
  function pruneReferences(state, deadUid) {
    state.effects = state.effects.filter(
      (effect) => effect.targetUid !== deadUid && effect.sourceUid !== deadUid
    );
    for (const item of state.queue) {
      item.targets = item.targets.filter((t) => t.kind !== "object" || t.uid !== deadUid);
      if (item.objectUid === deadUid) item.objectUid = null;
      if (item.sourceUid === deadUid) item.sourceUid = null;
    }
    for (const key of ["attackers", "blockedOnce"]) {
      state.clash[key] = state.clash[key].filter((uid) => uid !== deadUid);
    }
    delete state.clash.meshGroups[deadUid];
    delete state.clash.blocks[deadUid];
    delete state.clash.order[deadUid];
    delete state.clash.assignment[deadUid];
    for (const attacker of Object.keys(state.clash.blocks)) {
      state.clash.blocks[attacker] = state.clash.blocks[attacker].filter((u) => u !== deadUid);
      if (state.clash.order[attacker]) {
        state.clash.order[attacker] = state.clash.order[attacker].filter((u) => u !== deadUid);
      }
    }
    for (const object of Object.values(state.objects)) {
      if (object.attachedTo === deadUid) object.attachedTo = null;
    }
  }

  // -------------------------------------------------- stats and continuous effects

  /* §17 layer 7: printed stats, then counters, then modifier effects oldest
   * first. Total ordering with a uid tie-break so no comparison returns 0. */
  function effectsFor(state, uid) {
    const object = state.objects[uid];
    const matching = state.effects.filter((effect) => {
      if (effect.kind !== "mod") return false;
      if (effect.scope === "object") return effect.targetUid === uid;
      if (effect.scope === "controlledAvatars") return effect.controller === object.controller;
      return false;
    });
    matching.sort((a, b) => a.startedSeq - b.startedSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return matching;
  }

  function statsOf(state, ctx, uid) {
    const object = objectOf(state, uid);
    const card = cardOf(ctx, object.cardId);
    if (!card.isAvatar) return { action: 0, resilience: 0 };
    let action = card.action || 0;
    let resilience = card.resilience || 0;
    // "Action and Resilience are each equal to the number of …" — a live base.
    const statStatic = card.abilities.find((a) => a.kind === "stat-static" && a.statCount);
    if (statStatic) {
      const n = statStaticCount(state, ctx, statStatic.statCount, object);
      action = n;
      resilience = n;
    }
    const plusOne = object.counters["+1/+1"] || 0; // §18.2
    action += plusOne;
    resilience += plusOne;
    for (const effect of effectsFor(state, uid)) {
      if (effect.scope === "controlledAvatars" && !card.isAvatar) continue;
      action += effect.action || 0;
      resilience += effect.resilience || 0;
    }
    for (const grants of attachmentGrants(state, ctx, uid)) {
      action += grants.action || 0;
      resilience += grants.resilience || 0;
    }
    return { action, resilience };
  }

  /* Everything a live attachment grants its host, read fresh each time — the
   * grants arrive when the Attachment fastens and leave when it leaves. */
  function attachmentGrants(state, ctx, uid) {
    const grants = [];
    for (const seat of seatsOf(state)) {
      for (const attachUid of zoneArray(state, zoneKey(seat, "network"))) {
        const object = state.objects[attachUid];
        if (!object || object.attachedTo !== uid || !object.cardId) continue;
        for (const ability of cardOf(ctx, object.cardId).abilities) {
          if (ability.kind === "attach-static" && ability.grants) grants.push(ability.grants);
        }
      }
    }
    return grants;
  }

  function statStaticCount(state, ctx, spec, object) {
    let n = 0;
    const seats = spec.whose === "you" ? [object.controller] : seatsOf(state);
    for (const seat of seats) {
      for (const uid of zoneArray(state, zoneKey(seat, "network"))) {
        const other = state.objects[uid];
        if (!other || !other.cardId) continue;
        const card = cardOf(ctx, other.cardId);
        if (spec.type && card.type.indexOf(spec.type) < 0) continue;
        if (spec.affinity && card.affinity.indexOf(spec.affinity) < 0) continue;
        if (spec.namedSelf && other.cardId !== object.cardId) continue;
        if (spec.avatars && !card.isAvatar) continue;
        if (spec.notKeyword && hasKeywordUid(state, ctx, uid, spec.notKeyword)) continue;
        n += 1;
      }
    }
    return n;
  }

  function keywordsOf(state, ctx, uid) {
    const object = objectOf(state, uid);
    const card = cardOf(ctx, object.cardId);
    const names = card.keywords.map((k) => k.name);
    for (const effect of state.effects) {
      if (effect.kind !== "grant" || effect.targetUid !== uid) continue;
      if (effect.remove) {
        const index = names.indexOf(effect.keyword);
        if (index >= 0) names.splice(index, 1);
      } else if (names.indexOf(effect.keyword) < 0) {
        names.push(effect.keyword);
      }
    }
    for (const grants of attachmentGrants(state, ctx, uid)) {
      for (const name of grants.keywords || []) {
        if (names.indexOf(name) < 0) names.push(name);
      }
    }
    // Firewall is printed as a subtype on several cards, never as a keyword.
    if (/Firewall/.test(card.subtype || "") && names.indexOf("Firewall") < 0) names.push("Firewall");
    return names;
  }

  const hasKeywordUid = (state, ctx, uid, name) => keywordsOf(state, ctx, uid).indexOf(name) >= 0;

  function shieldedFrom(state, ctx, uid) {
    const card = cardOf(ctx, objectOf(state, uid).cardId);
    const entry = card.keywords.find((k) => k.name === "Shielded");
    if (entry) return entry.from;
    for (const grants of attachmentGrants(state, ctx, uid)) {
      if (grants.shieldedFrom) return grants.shieldedFrom;
    }
    return null;
  }

  // ------------------------------------------------------------- costs (§11, §12)

  const emptyBuffer = () => ({ P: 0, B: 0, K: 0, S: 0, T: 0, N: 0 });
  const bufferTotal = (buffer) => BUFFER_KEYS.reduce((sum, key) => sum + buffer[key], 0);

  function canPay(buffer, cost) {
    if (!cost) return true;
    const pool = Object.assign({}, buffer);
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if (pool[symbol] < need) return false;
      pool[symbol] -= need;
    }
    return bufferTotal(pool) >= (cost.generic || 0);
  }

  /* The documented canonical auto-payment, reproducing play.js's pay() exactly:
   * specific symbols first, then generic from N, then P,B,K,S,T in that order.
   * Convenience in the UI, authority in the engine — both paths run the same
   * validator below, so an explicit payment can never take a cheaper route. */
  function autoPayment(buffer, cost) {
    const payment = emptyBuffer();
    if (!cost) return payment;
    const pool = Object.assign({}, buffer);
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if (pool[symbol] < need) fail("CANNOT_AFFORD", `not enough ${symbol} in the Buffer`);
      pool[symbol] -= need;
      payment[symbol] += need;
    }
    let generic = cost.generic || 0;
    for (const key of ["N", "P", "B", "K", "S", "T"]) {
      while (generic > 0 && pool[key] > 0) {
        pool[key] -= 1;
        payment[key] += 1;
        generic -= 1;
      }
    }
    if (generic > 0) fail("CANNOT_AFFORD", "not enough Resources in the Buffer");
    return payment;
  }

  /* play.js:139 auto-spent in a fixed order, which is the engine making a player
   * decision — with several ways to satisfy a generic cost it could pick a
   * strictly worse assignment. A payment is now stated and verified. */
  function verifyPayment(buffer, cost, payment) {
    for (const key of BUFFER_KEYS) {
      const amount = payment[key] || 0;
      if (!Number.isInteger(amount) || amount < 0) fail("BAD_PAYMENT", `bad amount for ${key}`);
      if (amount > buffer[key]) fail("BAD_PAYMENT", `Buffer holds no ${amount} ${key}`);
    }
    if (!cost) {
      if (bufferTotal(payment) !== 0) fail("BAD_PAYMENT", "payment offered for a free cost");
      return payment;
    }
    let specific = 0;
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if ((payment[symbol] || 0) < need) fail("BAD_PAYMENT", `${symbol} must be paid with ${symbol}`);
      specific += need;
    }
    const total = bufferTotal(payment);
    if (total !== specific + (cost.generic || 0)) {
      fail("BAD_PAYMENT", `payment totals ${total}, cost totals ${specific + (cost.generic || 0)}`);
    }
    return payment;
  }

  function spendBuffer(seat, buffer, payment) {
    for (const key of BUFFER_KEYS) buffer[key] -= payment[key] || 0;
    return payment;
  }

  /* §12.1 Classic resource burn. play.js:488 burned only the active seat at
   * phase ends while :459/:599 burned both at Clash — internally inconsistent.
   * The Buffer empties for BOTH controllers at every phase boundary and at
   * Clash start and end. This is not damage and cannot be prevented. */
  function burnBuffers(env, reason) {
    for (const seat of [0, 1]) {
      const player = env.state.seats[seat];
      const total = bufferTotal(player.buffer);
      if (!total) continue;
      player.uptime -= total;
      player.buffer = emptyBuffer();
      emit(env, "BURN", { seat, amount: total, reason });
    }
  }

  // -------------------------------------------------------------------- events

  /* Structured, never pre-formatted prose: play.js:99 formatted at write time
   * and a string cannot be redacted after the fact. The UI owns all wording. */
  function emit(env, t, pub, priv) {
    const event = { t, seq: env.state.seq, pub: pub || {} };
    if (priv) event.priv = priv;
    env.events.push(event);
    return event;
  }

  function redactEvents(events, seat) {
    const key = String(seat);
    return events.map((event) => {
      const out = { t: event.t, seq: event.seq };
      Object.assign(out, event.pub);
      if (event.priv && seat !== null && event.priv[key]) Object.assign(out, event.priv[key]);
      return out;
    });
  }
  // --------------------------------------------------- createGame (§7, §8, §18.4)

  const intOr = (value, fallback) => (Number.isInteger(value) ? value : fallback);

  /* Deck construction consumes rng.hidden[seat] in a fixed, documented order:
   * seat 0's deck is built (pool filtered in catalog order) and shuffled, then
   * seat 1's, then seat 0 draws its opening seven, then seat 1. Order of
   * consumption is part of the rules — change it and every seed changes. */
  function buildDeckList(catalog, affinity, stream) {
    const inAffinity = (card) =>
      affinity === "All" ||
      card.affinity.indexOf(affinity) >= 0 ||
      card.affinity.indexOf("Neutral") >= 0;
    const pool = catalog.ids.map((id) => catalog.byId[id]).filter(inAffinity);
    const take = (test, count) => {
      const options = pool.filter(test);
      const out = [];
      if (!options.length) return out;
      for (let i = 0; i < count; i++) out.push(options[nextInt(stream, options.length)].id);
      return out;
    };
    return [
      ...take((c) => c.isResource, 17),
      ...take((c) => c.isAvatar, 14),
      ...take((c) => c.type === "Zap" || c.type === "Operation", 5),
      ...take((c) => c.type === "Hardware" || c.type === "Protocol", 4),
    ];
  }

  function newSeat(config) {
    return {
      name: String(config.name || "Player"),
      pubkey: config.pubkey || null,
      uptime: intOr(config.uptime, START_UPTIME),
      buffer: emptyBuffer(),
      deckCommit: null,
      conceded: false,
      deckedOut: false,
      counters: {},
      autoPass: {
        emptyQueue: config.autoPass ? Boolean(config.autoPass.emptyQueue) : true,
        noLegalResponse: config.autoPass ? Boolean(config.autoPass.noLegalResponse) : false,
      },
      stats: {
        rejectedActions: 0,
        manualProposed: 0,
        manualAccepted: 0,
        manualRejected: 0,
        manualFreeform: 0,
        envelopeViolations: 0,
      },
    };
  }

  function createGame(config, ctx) {
    const context = resolveCtx(ctx);
    const settings = config || {};
    const seatConfigs = settings.seats || [{ name: "Player 1" }, { name: "Player 2" }];
    if (seatConfigs.length !== 2) fail("SCHEMA", "the E1 Classic Profile is exactly two players");
    const seeds = settings.seeds || {};
    if (!Number.isInteger(seeds.public) || !Array.isArray(seeds.hidden) || seeds.hidden.length !== 2) {
      // The factory is pure: it takes every seed as an input and generates none.
      fail("SCHEMA", "config.seeds must be {public:int, hidden:[int,int]}");
    }

    const gameId = settings.gameId || "g_" + sha256hex(canonicalJSON(settings)).slice(0, 12);
    const firstPlayer = settings.firstPlayer === 1 ? 1 : 0;
    const state = {
      v: 1,
      gameId,
      ruleset: settings.ruleset || "E1.0",
      catalogDigest: context.catalog.digest,
      modules: {
        stake: Boolean(settings.modules && settings.modules.stake),
        toss: Boolean(settings.modules && settings.modules.toss),
      },
      policy: Object.assign({}, DEFAULT_POLICY, settings.policy || {}),
      seq: 0,
      prevHash: null,
      status: "playing",
      result: null,
      seats: seatConfigs.map(newSeat),
      objects: {},
      nextUid: 1,
      zones: {},
      queue: [],
      nextQid: 1,
      turn: {
        number: 1,
        active: firstPlayer,
        firstPlayer,
        phase: "open",
        step: "unlock",
        resourcePlays: { used: 0, allowed: 1 },
        repeatCleanup: false,
      },
      priority: { seat: null, passed: [false, false], window: "setup" },
      clash: emptyClash(),
      awaiting: null,
      pendingChoice: null,
      pendingTriggers: { 0: [], 1: [] },
      pendingManual: null,
      manualOpen: [],
      manualBudgetUsed: [0, 0],
      nextMid: 1,
      nextChoiceId: 1,
      effects: [],
      nextEid: 1,
      handLimit: intOr(settings.handLimit, HAND_LIMIT),
      rng: {
        public: newStream(seeds.public),
        hidden: [newStream(seeds.hidden[0]), newStream(seeds.hidden[1])],
      },
    };
    for (const seat of [0, 1]) {
      for (const zone of ZONE_NAMES) state.zones[zoneKey(seat, zone)] = [];
    }

    const env = { state, ctx: context, events: [] };
    for (const seat of [0, 1]) {
      const seatConfig = seatConfigs[seat];
      const stream = state.rng.hidden[seat];
      const deck = Array.isArray(seatConfig.deck) && seatConfig.deck.length
        ? seatConfig.deck.slice()
        : buildDeckList(context.catalog, seatConfig.affinity || "All", stream);
      // An illegal decklist is the cheapest cheat there is; it never reaches
      // the table. Validate before a single object is minted.
      if (deck.length < MIN_STACK) fail("SCHEMA", `seat ${seat} Stack is ${deck.length}, minimum ${MIN_STACK}`);
      for (const cardId of deck) {
        const card = cardOf(context, cardId);
        if (!state.modules.stake && /\bStake\b/.test(card.text || "")) {
          fail("SCHEMA", `${card.name} needs the Stake module (§19.1)`);
        }
      }
      shuffleInPlace(deck, stream);
      const salt = String(seatConfig.salt === undefined ? "" : seatConfig.salt);
      // §3.4 the commitment is over position -> cardId, never over uids:
      // §6.1 re-minting invalidates a uid commitment at the first shuffle.
      state.seats[seat].deckCommit =
        "sha256:" + sha256hex(salt + canonicalJSON(deck.map((cardId, i) => [i, cardId])));
      for (const cardId of deck) {
        const record = newObjectRecord(state, context, cardId, seat, seat, zoneKey(seat, "stack"), null);
        state.objects[record.uid] = record;
        state.zones[zoneKey(seat, "stack")].push(record.uid);
      }
    }
    for (const seat of [0, 1]) drawCards(env, seat, 7);

    enterStep(env, true);
    advanceUntilPriority(env);
    return state;
  }

  const emptyClash = () => ({
    step: null,
    attackers: [],
    meshGroups: {},
    blocks: {},
    order: {},
    assignment: {},
    blockedOnce: [],
    damageDone: { firstStrike: false, regular: false },
  });

  // ------------------------------------------------------------ drawing

  function drawCards(env, seat, count) {
    const state = env.state;
    for (let i = 0; i < count; i++) {
      const stack = zoneArray(state, zoneKey(seat, "stack"));
      if (!stack.length) {
        // §2.2 the loss is recorded, not applied here; a state check owns it,
        // so a simultaneous double-deck-out can still produce a draw.
        state.seats[seat].deckedOut = true;
        emit(env, "DECKED", { seat });
        return;
      }
      const uid = stack[0];
      const cardId = state.objects[uid].cardId;
      const record = moveUid(env, uid, "wallet", { seat });
      emit(env, "DRAW", { seat, count: 1, uid: record.uid }, { [String(seat)]: { cardId } });
    }
  }

  // ------------------------------------------------------- state checks (§16)

  function stateChecks(env) {
    const state = env.state;
    for (let guard = 0; guard < 64; guard++) {
      let changed = false;
      for (const seat of [0, 1]) {
        for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
          const object = state.objects[uid];
          if (!object) continue;
          const card = cardOf(env.ctx, object.cardId);

          if (object.token && zoneName(object.zone) !== "network") continue;
          if (card.isAvatar) {
            const { resilience } = statsOf(state, env.ctx, uid);
            const lethal = object.damage >= resilience;
            if (resilience <= 0) {
              // §15.3 Reboot cannot replace being archived for 0 Resilience.
              moveUid(env, uid, "archive");
              emit(env, "ARCHIVED", { uid, cardId: object.cardId, reason: "resilience" });
              changed = true;
              continue;
            }
            if (lethal) {
              if (object.rebootShields > 0) {
                // §14 Reboot: not decommissioned, damage removed, Commit it,
                // remove it from combat, consume the shield.
                object.rebootShields -= 1;
                object.damage = 0;
                object.committed = true;
                removeFromCombat(state, uid);
                emit(env, "REBOOT", { uid, cardId: object.cardId });
              } else {
                moveUid(env, uid, "archive");
                emit(env, "DECOMMISSIONED", { uid, cardId: object.cardId });
              }
              changed = true;
              continue;
            }
          }
          /* An Attachment without a living host archives. Checking attachedTo
           * alone was dead code: pruneReferences nulls it the moment the host
           * remints, so the orphan looked "never attached" and floated on. */
          if (cardOf(env.ctx, object.cardId).keywords.some((k) => k.name === "Attach")) {
            const host = object.attachedTo ? state.objects[object.attachedTo] : null;
            if (!host || zoneName(host.zone) !== "network") {
              moveUid(env, uid, "archive");
              emit(env, "ARCHIVED", { uid, cardId: object.cardId, reason: "attachment" });
              changed = true;
            }
          }
        }
      }
      // §18.1 a token outside the Network ceases to exist.
      for (const uid of Object.keys(state.objects)) {
        const object = state.objects[uid];
        if (object.token && zoneName(object.zone) !== "network") {
          removeFromZone(state, object.zone, uid);
          delete state.objects[uid];
          pruneReferences(state, uid);
          emit(env, "TOKEN_GONE", { uid });
          changed = true;
        }
      }
      // §17 effects whose source left the zone that sustained it.
      const liveEffects = state.effects.filter((effect) => {
        if (!effect.expires || effect.expires.kind !== "whileSourceInZone") return true;
        const source = state.objects[effect.sourceUid];
        return Boolean(source) && zoneName(source.zone) === (effect.expires.zone || "network");
      });
      if (liveEffects.length !== state.effects.length) {
        state.effects = liveEffects;
        changed = true;
      }
      // §18.3 reveals expire; a state check clears them.
      for (const object of Object.values(state.objects)) {
        const until = object.revealedUntil;
        if (!until) continue;
        if (state.turn.number > until.turn || (state.turn.number === until.turn && until.phase && until.phase !== state.turn.phase)) {
          object.revealedTo = [];
          object.revealedUntil = null;
          changed = true;
        }
      }
      if (!changed) break;
    }
    recomputeResult(env);
  }

  function removeFromCombat(state, uid) {
    state.clash.attackers = state.clash.attackers.filter((u) => u !== uid);
    delete state.clash.blocks[uid];
    delete state.clash.order[uid];
    delete state.clash.assignment[uid];
    for (const attacker of Object.keys(state.clash.blocks)) {
      state.clash.blocks[attacker] = state.clash.blocks[attacker].filter((u) => u !== uid);
      if (state.clash.order[attacker]) {
        state.clash.order[attacker] = state.clash.order[attacker].filter((u) => u !== uid);
      }
    }
  }

  /* §2.2 including the draw. play.js:201-205 tested alive.length === 1, so a
   * simultaneous loss left both players "alive" and the game hung forever. */
  function recomputeResult(env) {
    const state = env.state;
    if (state.result) return;
    const losers = [];
    const reasons = {};
    for (const seat of [0, 1]) {
      const player = state.seats[seat];
      if (player.conceded) {
        losers.push(seat);
        reasons[seat] = "concede";
      } else if (player.uptime <= 0) {
        losers.push(seat);
        reasons[seat] = "uptime";
      } else if (player.deckedOut) {
        losers.push(seat);
        reasons[seat] = "decked";
      }
    }
    if (!losers.length) return;
    if (losers.length === 2) {
      state.result = { winners: [], reason: "draw", losers };
    } else {
      state.result = { winners: [1 - losers[0]], reason: reasons[losers[0]], losers };
    }
    state.status = "over";
    state.priority.seat = null;
    state.awaiting = null;
    state.pendingChoice = null;
    emit(env, "GAME_OVER", { winners: state.result.winners, reason: state.result.reason });
  }

  // ---------------------------------------------------- the op interpreter (ops.js)

  /* One resumable interpreter, two authors: compiled card ops and MANUAL_PROPOSE
   * deltas run through the same code, so the manual path cannot drift from the
   * automatic path and a card the Python compiler later learns to script
   * migrates from one author to the other with zero engine change. */
  function frameOps(env, item) {
    // Manual deltas and raised triggers both carry their ops on the item —
    // a trigger's "that player" was bound at raise time and must not be
    // re-read from the card.
    if (item.kind === "manual" || item.kind === "triggered") return item.ops;
    const card = cardOf(env.ctx, item.cardId);
    if (item.kind === "ability") {
      const ability = card.abilities[item.abilityIndex];
      return (ability && ability.ops) || [];
    }
    if (card.playModes && item.modes && item.modes.length) {
      const mode = card.playModes[item.modes[0]];
      return (mode && mode.ops) || [];
    }
    return card.playOps;
  }

  function nextTarget(env, item) {
    const cursor = item.resume.acc.targetIndex || 0;
    item.resume.acc.targetIndex = cursor + 1;
    return item.targets[cursor] || null;
  }

  const seatsOf = (state) => [0, 1];

  /* Turn-scoped prevention shields, consumed before damage lands. A shield
   * may be capped ("the next 2") or affinity-gated ("the next time a Keys
   * source would…"); cleanup sweeps them with the turn. */
  function consumePrevention(env, target, amount, sourceUid) {
    const state = env.state;
    const shields = state.prevention || [];
    for (let i = 0; i < shields.length && amount > 0; i++) {
      const shield = shields[i];
      if (shield.turn !== state.turn.number) continue;
      const matches =
        (shield.kind === "seat" && target.kind === "seat" && shield.seat === target.seat) ||
        (shield.kind === "object" && target.kind === "object" && shield.uid === target.uid);
      if (!matches) continue;
      if (shield.fromAffinity) {
        const source = sourceUid && state.objects[sourceUid];
        const sourceCard = source && cardOf(env.ctx, source.cardId);
        if (!sourceCard || sourceCard.affinity.indexOf(shield.fromAffinity) < 0) continue;
        shields.splice(i, 1);
        emit(env, "PREVENTED", { amount, reason: "shield" });
        return 0; // the whole event
      }
      const used = Math.min(shield.amount, amount);
      shield.amount -= used;
      amount -= used;
      emit(env, "PREVENTED", { amount: used, reason: "shield" });
      if (!shield.amount) shields.splice(i, 1);
      i -= 1;
    }
    return amount;
  }

  function damageTarget(env, target, amount, sourceUid) {
    if (!target) return;
    const state = env.state;
    amount = consumePrevention(env, target, amount, sourceUid);
    if (amount <= 0) return;
    if (target.kind === "seat") {
      state.seats[target.seat].uptime -= amount; // §15.1
      emit(env, "DAMAGE", { to: "seat", seat: target.seat, amount, sourceUid: sourceUid || null });
      if (amount > 0 && sourceUid) {
        const source = state.objects[sourceUid];
        if (source && source.controller !== target.seat) {
          raiseTriggers(env, "self-deals-player-damage", { sourceUid, seat: target.seat });
        }
      }
      return;
    }
    const object = state.objects[target.uid];
    if (!object) return; // §11.2 do as much as possible
    if (sourceUid && isShieldedFromSource(env, target.uid, sourceUid)) {
      emit(env, "PREVENTED", { uid: target.uid, amount, reason: "shielded" });
      return;
    }
    object.damage += amount; // §15.2 marked until Cleanup
    emit(env, "DAMAGE", { to: "object", uid: target.uid, amount, sourceUid: sourceUid || null });
    if (amount > 0) raiseTriggers(env, "self-damaged", { uid: target.uid, seat: object.controller });
  }

  function isShieldedFromSource(env, uid, sourceUid) {
    const shield = shieldedFrom(env.state, env.ctx, uid);
    if (!shield) return false;
    const source = env.state.objects[sourceUid];
    if (!source) return false;
    return cardOf(env.ctx, source.cardId).affinity.indexOf(shield) >= 0;
  }

  function addModEffect(env, uid, action, resilience, duration, sourceUid, scope, controller) {
    const state = env.state;
    const effect = {
      id: "e" + state.nextEid,
      sourceUid: sourceUid || null,
      layer: 7,
      kind: "mod",
      scope: scope || "object",
      targetUid: uid || null,
      controller: controller === undefined ? null : controller,
      action: action || 0,
      resilience: resilience || 0,
      grants: [],
      removes: [],
      expires:
        duration === "eot"
          ? { kind: "eot", turn: state.turn.number }
          : { kind: "whileSourceInZone", uid: sourceUid || null, zone: "network" },
      startedSeq: state.seq,
    };
    state.nextEid += 1;
    state.effects.push(effect);
    return effect;
  }

  /* Returns "done" or "pause". On pause the op index is NOT advanced: the frame
   * re-enters at the same op once CHOOSE stores the pick into acc. */
  function runFrame(env, item) {
    const ops = frameOps(env, item);
    while (item.resume.opIndex < ops.length) {
      const op = ops[item.resume.opIndex];
      const outcome = runOp(env, item, op);
      if (outcome === "pause") return "pause";
      item.resume.opIndex += 1;
    }
    return "done";
  }

  /* Amounts may be a number, "x" (the X the player paid for), or a live count
   * of Network cards: {count:{type,affinity}} counted for op.seat when a
   * trigger bound one, else for the controller. */
  function resolveAmount(env, item, op, raw) {
    if (raw === "x") return item.x || 0;
    if (raw && typeof raw === "object" && raw.count) {
      const state = env.state;
      const seat = op.seat !== undefined && op.seat !== null ? op.seat : item.controller;
      let n = 0;
      for (const uid of zoneArray(state, zoneKey(seat, "network"))) {
        const card = cardOf(env.ctx, state.objects[uid].cardId);
        if (raw.count.type && card.type.indexOf(raw.count.type) < 0) continue;
        if (raw.count.affinity && card.affinity.indexOf(raw.count.affinity) < 0) continue;
        n += 1;
      }
      return n;
    }
    return typeof raw === "number" ? raw : 0;
  }

  function runOp(env, item, op) {
    const state = env.state;
    const controller = item.controller;
    const sourceUid = item.sourceUid;
    switch (op.op) {
      case "generate": {
        let key;
        if (op.affinity === "neutral") key = "N";
        else if (op.affinity === "choice") {
          // A junction offers exactly the affinities it names; an open choice
          // offers all five. A pre-seeded choice outside the offer is a cheat,
          // not a preference, and fails rather than resolves.
          const allowed =
            Array.isArray(op.options) && op.options.length
              ? op.options.map((name) => AFFINITY_SYMBOL[name] || name)
              : SYMBOLS;
          const chosen = item.resume.acc["choice" + item.resume.opIndex];
          if (!chosen) {
            return raiseChoice(env, item, {
              kind: "mode",
              prompt: "Choose an affinity to generate",
              options: allowed.map((symbol) => ({ kind: "symbol", symbol })),
              min: 1,
              max: 1,
              slot: "choice" + item.resume.opIndex,
            });
          }
          if (allowed.indexOf(chosen) < 0) fail("BAD_CHOICE", "that affinity is not offered");
          key = chosen;
        } else key = AFFINITY_SYMBOL[op.affinity] || "N";
        // A trigger may generate for the event's player ("its controller
        // generates…") rather than for the ability's controller.
        const beneficiary = op.seat !== undefined && op.seat !== null ? op.seat : controller;
        state.seats[beneficiary].buffer[key] += op.amount;
        emit(env, "GENERATE", { seat: beneficiary, symbol: key, amount: op.amount });
        return "done";
      }
      case "damage": {
        const amount = resolveAmount(env, item, op, op.amount);
        // A trigger bound "that player" at raise time.
        if (op.seat !== undefined && op.seat !== null) {
          damageTarget(env, { kind: "seat", seat: op.seat }, amount, sourceUid);
          return "done";
        }
        // "... and N damage to you" — the card's own controller.
        if (op.target === "controller") {
          damageTarget(env, { kind: "seat", seat: controller }, amount, sourceUid);
          return "done";
        }
        if (op.target === "each-player") {
          for (const seat of seatsOf(state)) damageTarget(env, { kind: "seat", seat }, amount, sourceUid);
          return "done";
        }
        if (op.target === "each-avatar") {
          for (const seat of seatsOf(state)) {
            for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
              if (!cardOf(env.ctx, state.objects[uid].cardId).isAvatar) continue;
              // "each Avatar with/without Broadcast" — a keyword filter.
              if (op.filter && op.filter.keyword) {
                const has = hasKeywordUid(state, env.ctx, uid, op.filter.keyword);
                if (has !== Boolean(op.filter.has)) continue;
              }
              damageTarget(env, { kind: "object", uid }, amount, sourceUid);
            }
          }
          return "done";
        }
        damageTarget(env, nextTarget(env, item), amount, sourceUid);
        return "done";
      }
      case "draw":
        drawCards(env, controller, op.amount);
        return "done";
      case "uptime": {
        // play.js:285 was `op.target === "player" ? controller : controller` —
        // a no-op ternary, so "target player gains N Uptime" always healed the
        // controller. The target is now a real seat target; a trigger may have
        // bound the seat already.
        const target =
          op.seat !== undefined && op.seat !== null
            ? { kind: "seat", seat: op.seat }
            : op.target === "player"
              ? nextTarget(env, item)
              : { kind: "seat", seat: controller };
        const seat = target && target.kind === "seat" ? target.seat : controller;
        const delta = resolveAmount(env, item, op, op.amount);
        state.seats[seat].uptime += delta;
        emit(env, "UPTIME", { seat, delta });
        return "done";
      }
      case "discard": {
        // Seeded from rng.public and honouring op.target. play.js:293 used
        // Math.random(), the one live nondeterminism in the old engine.
        // A trigger may have bound the discarding seat already.
        const target = op.target === "player" && op.seat === undefined ? nextTarget(env, item) : null;
        const seat =
          op.seat !== undefined && op.seat !== null
            ? op.seat
            : target && target.kind === "seat"
              ? target.seat
              : 1 - controller;
        const count = resolveAmount(env, item, op, op.amount);
        for (let i = 0; i < count; i++) {
          const wallet = zoneArray(state, zoneKey(seat, "wallet"));
          if (!wallet.length) break;
          const index = nextInt(state.rng.public, wallet.length);
          const uid = wallet[index];
          // §18.4 log the eligible set and the result so the draw is auditable.
          emit(env, "RANDOM_PICK", { seat, eligible: wallet.slice(), picked: uid, stream: "public" });
          moveUid(env, uid, "archive");
        }
        emit(env, "DISCARD", { seat, count });
        return "done";
      }
      case "pump": {
        const action = resolveAmount(env, item, op, op.action);
        const resilience = resolveAmount(env, item, op, op.resilience);
        if (op.target === "target-avatar") {
          const target = nextTarget(env, item);
          if (target && target.kind === "object" && state.objects[target.uid]) {
            addModEffect(env, target.uid, action, resilience, op.duration, sourceUid, "object");
            emit(env, "PUMP", { uid: target.uid, action, resilience });
          }
          return "done";
        }
        if (op.target === "this-avatar" && sourceUid && state.objects[sourceUid]) {
          addModEffect(env, sourceUid, action, resilience, op.duration, sourceUid, "object");
          emit(env, "PUMP", { uid: sourceUid, action, resilience });
          return "done";
        }
        // "Avatars you control get +A/+R" is a scope, not a snapshot: it must
        // keep applying to whatever the controller has, so it is an effect.
        addModEffect(env, null, action, resilience, op.duration, sourceUid, "controlledAvatars", controller);
        emit(env, "PUMP", { scope: "controlledAvatars", seat: controller, action, resilience });
        return "done";
      }
      case "decommission": {
        if (op.scope === "all") {
          for (const seat of seatsOf(state)) {
            for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
              if (cardOf(env.ctx, state.objects[uid].cardId).type.indexOf(op.kind) >= 0) {
                emit(env, "DECOMMISSIONED", { uid, cardId: state.objects[uid].cardId });
                moveUid(env, uid, "archive");
              }
            }
          }
          return "done";
        }
        const target = nextTarget(env, item);
        if (target && target.kind === "object" && state.objects[target.uid]) {
          emit(env, "DECOMMISSIONED", { uid: target.uid, cardId: state.objects[target.uid].cardId });
          moveUid(env, target.uid, "archive");
        }
        return "done";
      }
      case "reboot": {
        // §14 Reboot creates a replacement shield for the rest of the turn.
        // play.js:334 unlocked and cleared damage instead, which is a different
        // (and strictly better) effect than the printed keyword.
        const target =
          op.scope === "target"
            ? nextTarget(env, item)
            : op.scope === "attached"
              ? { kind: "object", uid: (state.objects[sourceUid] || {}).attachedTo }
              : { kind: "object", uid: sourceUid };
        if (target && target.uid && target.kind === "object" && state.objects[target.uid]) {
          state.objects[target.uid].rebootShields += 1;
          emit(env, "REBOOT_SHIELD", { uid: target.uid });
        }
        return "done";
      }
      case "mayPay": {
        /* "You may pay X. If you do, …" / "… unless you pay X." One optional
         * cost, a pay/decline choice, and two nested op lists. Nested ops must
         * never pause — the parser only emits bound, choice-free ops, and the
         * runner fails loudly rather than corrupt the resume state. */
        const buffer = state.seats[controller].buffer;
        const chosen = item.resume.acc["choice" + item.resume.opIndex];
        if (chosen === undefined) {
          if (!canPay(buffer, op.cost)) return runNested(env, item, op.else || []);
          return raiseChoice(env, item, {
            kind: "mayPay",
            prompt: op.prompt || "Pay the optional cost?",
            options: [
              { kind: "option", value: "pay", label: op.payLabel || "Pay" },
              { kind: "option", value: "decline", label: "Decline" },
            ],
            min: 1,
            max: 1,
            slot: "choice" + item.resume.opIndex,
          });
        }
        const pick = Array.isArray(chosen) ? chosen[0] && chosen[0].value : chosen;
        if (pick === "pay" && canPay(buffer, op.cost)) {
          settleCost(env, controller, op.cost, null);
          return runNested(env, item, op.then || []);
        }
        return runNested(env, item, op.else || []);
      }
      case "grant": {
        // A keyword grant — on itself, or on a chosen Avatar — delegated to the
        // one effect factory so expiry works the same everywhere.
        const uid =
          op.scope === "self" ? sourceUid : (nextTarget(env, item) || {}).uid;
        if (uid && state.objects[uid]) {
          runManualOp(env, item, {
            op: "grantKeyword",
            uid,
            keyword: op.keyword,
            duration: op.duration || "eot",
          });
        }
        return "done";
      }
      case "unlock":
      case "commit": {
        const target = nextTarget(env, item);
        if (target && target.kind === "object" && state.objects[target.uid]) {
          runManualOp(env, item, {
            op: "setCommitted",
            uid: target.uid,
            value: op.op === "commit",
          });
        }
        return "done";
      }
      case "bounce": {
        const target = nextTarget(env, item);
        if (target && target.kind === "object" && state.objects[target.uid]) {
          const bounced = state.objects[target.uid];
          emit(env, "MOVE", { uid: target.uid, cardId: bounced.cardId, toZone: "wallet" });
          moveUid(env, target.uid, "wallet");
        }
        return "done";
      }
      case "moveTop": {
        // "Target player moves the top N cards of their Stack into their Wallet."
        const target = op.seat !== undefined && op.seat !== null
          ? { kind: "seat", seat: op.seat }
          : nextTarget(env, item);
        const seat = target && target.kind === "seat" ? target.seat : controller;
        return runManualOp(env, item, {
          op: "moveTopOfStack",
          seat,
          toZone: op.toZone || "wallet",
          count: resolveAmount(env, item, op, op.amount),
        });
      }
      case "prevent": {
        // A shield for the rest of the turn, on the controller or a chosen target.
        const shieldTarget =
          op.target === "you" ? { kind: "seat", seat: controller } : nextTarget(env, item);
        if (shieldTarget) {
          state.prevention = state.prevention || [];
          state.prevention.push({
            kind: shieldTarget.kind === "seat" ? "seat" : "object",
            seat: shieldTarget.seat !== undefined ? shieldTarget.seat : null,
            uid: shieldTarget.uid || null,
            amount: resolveAmount(env, item, op, op.amount) || 0,
            fromAffinity: op.fromAffinity || null,
            turn: state.turn.number,
          });
        }
        return "done";
      }
      case "invalidate": {
        // The set's counterspell. The queue target was validated on play; the
        // affinity filter is re-checked here in case the Queue changed.
        const target = nextTarget(env, item);
        if (target && target.kind === "queue") {
          const index = state.queue.findIndex((q) => q.qid === target.qid);
          if (index >= 0) {
            const queued = state.queue[index];
            const queuedCard = queued.cardId ? cardOf(env.ctx, queued.cardId) : null;
            const wanted = op.filter && op.filter.affinity;
            if (!wanted || (queuedCard && queuedCard.affinity.indexOf(wanted) >= 0)) {
              invalidateQueueItem(env, index, "invalidated");
            }
          }
        }
        return "done";
      }
      case "coldStorage": {
        // "Cold Storage target Avatar. Its controller gains Uptime equal to
        // its Action." The stat is read BEFORE the move, as printed.
        const target = nextTarget(env, item);
        if (target && target.kind === "object" && state.objects[target.uid]) {
          const object = state.objects[target.uid];
          const owner = object.controller;
          const gain = op.gainAction ? statsOf(state, env.ctx, target.uid).action : 0;
          emit(env, "MOVE", { uid: target.uid, cardId: object.cardId, toZone: "cold" });
          moveUid(env, target.uid, "cold");
          if (gain > 0) {
            state.seats[owner].uptime += gain;
            emit(env, "UPTIME", { seat: owner, delta: gain });
          }
        }
        return "done";
      }
      default:
        return runManualOp(env, item, op);
    }
  }

  /* Run a mayPay branch inline. A nested op that tried to pause would leave
   * the outer op's resume cursor pointing at the wrong frame — that is a
   * compiler bug, and it fails loudly instead of resolving wrongly. */
  function runNested(env, item, ops) {
    for (const nested of ops) {
      const outcome = runOp(env, item, nested);
      if (outcome !== "done") fail("SCHEMA", "a nested optional-cost op may not pause");
    }
    return "done";
  }

  function raiseChoice(env, item, request) {
    const state = env.state;
    state.pendingChoice = {
      id: "c" + state.nextChoiceId,
      seat: item.controller,
      kind: request.kind,
      prompt: request.prompt,
      options: request.options,
      min: request.min,
      max: request.max,
      forQid: item.qid || null,
      slot: request.slot,
    };
    state.nextChoiceId += 1;
    state.priority.seat = null;
    emit(env, "CHOICE_REQUIRED", { seat: item.controller, choiceId: state.pendingChoice.id, kind: request.kind, prompt: request.prompt });
    return "pause";
  }
  // ------------------------------------------------------------ manual.js

  /* 234 of 302 abilities are resolved by a human — 140 of them static. The
   * engine does not pretend to adjudicate what a card MEANS. It adjudicates
   * three things and those three are enough: the SHAPE of the claim (a program
   * in a closed, typed, bounded vocabulary — never a free-form state patch),
   * the BLAST RADIUS (self-scoped or across the table), and the RECORD. */

  const MANUAL_OPS = {
    addUptime: ["seat", "delta"],
    addBuffer: ["seat", "symbol", "amount"],
    spendBuffer: ["seat", "symbol", "amount"],
    moveObject: ["uid", "toZone", "position"],
    moveRandomFromZone: ["fromZone", "toZone", "count"],
    moveTopOfStack: ["seat", "count", "toZone"],
    shuffleZone: ["zone"],
    setCommitted: ["uid", "value"],
    addDamage: ["uid", "amount"],
    removeDamage: ["uid"],
    addCounter: ["uid", "name", "amount"],
    addTempMod: ["uid", "action", "resilience", "duration"],
    grantKeyword: ["uid", "keyword", "duration"],
    removeKeyword: ["uid", "keyword", "duration"],
    setController: ["uid", "seat"],
    addRebootShield: ["uid", "delta"],
    createToken: ["cardId", "seat", "count"],
    setResourcePlays: ["seat", "delta"],
    invalidateQueueItem: ["qid"],
    revealZone: ["seat", "zone", "toSeats", "duration"],
    note: ["text"],
  };

  /* There is deliberately no setState primitive, and turn.*, priority.*, rng.*,
   * seq, prevHash, owner, uid, cardId and result are unreachable from any
   * manual edit — consent cannot make those safe. Consequence worth stating:
   * the turn machine advances only via PASS_PRIORITY, so no manual edit can
   * ever desync two peers' phase machines. */

  function validateManualOps(ops) {
    if (!Array.isArray(ops) || !ops.length) fail("SCHEMA", "a manual delta needs at least one op");
    if (ops.length > HARD_CAPS.opsPerDelta) fail("MANUAL_HARD_CAP", "too many ops in one delta");
    for (const op of ops) {
      if (!op || typeof op !== "object" || Array.isArray(op)) fail("SCHEMA", "op must be an object");
      const allowed = MANUAL_OPS[op.op];
      if (!allowed) fail("SCHEMA", `unknown manual op ${op && op.op}`);
      for (const key of Object.keys(op)) {
        if (key !== "op" && allowed.indexOf(key) < 0) fail("SCHEMA", `unknown key ${key} on ${op.op}`);
      }
      for (const key of Object.keys(op)) {
        const value = op[key];
        if (typeof value === "number" && !Number.isInteger(value)) {
          fail("SCHEMA", `${op.op}.${key} must be an integer`);
        }
      }
      if (op.op === "note" && String(op.text || "").length > 280) {
        fail("SCHEMA", "note is limited to 280 characters");
      }
    }
  }

  /* Layer 2 — Envelope: could this card plausibly do that? Rejected BEFORE the
   * opponent ever sees it. Above the envelope sit hard caps no envelope can
   * raise, so a compiler bug cannot authorise a game-ending edit. */
  function checkEnvelope(env, seat, envelope, ops) {
    let uptimeSwing = 0;
    let objectsTouched = 0;
    let cardsDrawn = 0;
    let bufferAdded = 0;
    const touched = {};
    for (const op of ops) {
      if (envelope && op.op !== "note" && envelope.ops.indexOf(op.op) < 0) {
        env.state.seats[seat].stats.envelopeViolations += 1;
        fail("MANUAL_OUT_OF_ENVELOPE", `${op.op} is not in this ability's envelope`);
      }
      const amount = Math.abs(op.delta || op.amount || op.count || 0);
      if (envelope && amount > envelope.maxAmount && op.op !== "note") {
        env.state.seats[seat].stats.envelopeViolations += 1;
        fail("MANUAL_OUT_OF_ENVELOPE", `${op.op} amount ${amount} exceeds ${envelope.maxAmount}`);
      }
      if (op.op === "addUptime" || op.op === "addDamage") uptimeSwing += amount;
      if (op.op === "moveTopOfStack") cardsDrawn += op.count || 0;
      if (op.op === "addBuffer") bufferAdded += op.amount || 0;
      if (op.uid) touched[op.uid] = true;
      if (op.op === "moveRandomFromZone" || op.op === "moveTopOfStack") objectsTouched += op.count || 0;
      if (envelope && !envelope.mayCreateTokens && op.op === "createToken") {
        fail("MANUAL_OUT_OF_ENVELOPE", "this ability cannot create tokens");
      }
      if (envelope && !envelope.mayChangeController && op.op === "setController") {
        fail("MANUAL_OUT_OF_ENVELOPE", "this ability cannot change control");
      }
      if (envelope && op.toZone && envelope.zones.length && envelope.zones.indexOf(op.toZone) < 0) {
        fail("MANUAL_OUT_OF_ENVELOPE", `this ability does not name the ${op.toZone}`);
      }
    }
    objectsTouched += Object.keys(touched).length;
    if (envelope && objectsTouched > envelope.maxObjectsTouched) {
      env.state.seats[seat].stats.envelopeViolations += 1;
      fail("MANUAL_OUT_OF_ENVELOPE", "too many objects touched");
    }
    if (envelope && uptimeSwing > envelope.maxUptimeSwing && uptimeSwing > 0) {
      env.state.seats[seat].stats.envelopeViolations += 1;
      fail("MANUAL_OUT_OF_ENVELOPE", "Uptime swing beyond this ability's envelope");
    }
    if (uptimeSwing > HARD_CAPS.uptimeSwing) fail("MANUAL_HARD_CAP", "Uptime swing over the hard cap");
    if (objectsTouched > HARD_CAPS.objectsTouched) fail("MANUAL_HARD_CAP", "too many objects");
    if (cardsDrawn > HARD_CAPS.cardsDrawn) fail("MANUAL_HARD_CAP", "too many cards drawn");
    if (bufferAdded > HARD_CAPS.bufferAdded) fail("MANUAL_HARD_CAP", "too many Resources added");
  }

  /* Layer 4 — Redaction safety. Naming a uid in the opponent's Wallet PROVES
   * you know what is in it. Checked against the redacted view, not the full
   * state, so it cannot be got wrong by accident. */
  function visibleUids(state, seat) {
    const seen = Object.create(null);
    for (const key of Object.keys(state.zones)) {
      const zone = zoneName(key);
      const owner = zoneSeat(key);
      const isPublic = ["network", "archive", "queue", "stake"].indexOf(zone) >= 0;
      const coldVisible = zone === "cold";
      if (isPublic || coldVisible || (zone === "wallet" && owner === seat)) {
        for (const uid of state.zones[key]) seen[uid] = true;
      }
    }
    for (const uid of Object.keys(state.objects)) {
      if ((state.objects[uid].revealedTo || []).indexOf(seat) >= 0) seen[uid] = true;
    }
    return seen;
  }

  function checkReferences(env, seat, ops) {
    const seen = visibleUids(env.state, seat);
    for (const op of ops) {
      if (op.uid && !seen[op.uid]) {
        fail("MANUAL_ILLEGAL_REFERENCE", `${op.uid} is not visible to seat ${seat}`);
      }
      if (op.op === "moveObject" && op.toZone && ZONE_NAMES.indexOf(op.toZone) < 0) {
        fail("SCHEMA", `unknown zone ${op.toZone}`);
      }
    }
  }

  /* §9.2 Tiers — computed by the ENGINE, never asserted by the proposer, so a
   * client cannot mislabel a cross-table edit as self-scoped. Tier A is
   * self-limiting and applies immediately; anything else needs consent. */
  function tierOf(state, seat, ops) {
    for (const op of ops) {
      if (op.op === "note") continue;
      const uid = op.uid;
      if (uid) {
        const object = state.objects[uid];
        if (!object || object.controller !== seat) return "B";
        if (["network", "wallet", "archive", "cold"].indexOf(zoneName(object.zone)) < 0) return "B";
      }
      switch (op.op) {
        case "addUptime":
          // Losing your own Uptime, or giving the opponent Uptime, is Tier A.
          if (op.seat === seat && op.delta <= 0) break;
          if (op.seat !== seat && op.delta >= 0) break;
          return "B";
        case "spendBuffer":
          if (op.seat !== seat) return "B";
          break;
        case "setCommitted":
          if (op.value !== true) return "B"; // unlocking yourself is a benefit
          break;
        case "addDamage":
          return "B";
        case "removeDamage":
          return "B";
        case "moveObject":
          // Archiving or Cold-Storing your own Network card is a cost.
          if (["archive", "cold"].indexOf(op.toZone) < 0) return "B";
          break;
        default:
          return "B";
      }
    }
    return "A";
  }

  function runManualOp(env, item, op) {
    const state = env.state;
    switch (op.op) {
      case "addUptime":
        state.seats[op.seat].uptime += op.delta;
        emit(env, "UPTIME", { seat: op.seat, delta: op.delta, manual: true });
        return "done";
      case "addBuffer":
        state.seats[op.seat].buffer[op.symbol] += op.amount;
        emit(env, "GENERATE", { seat: op.seat, symbol: op.symbol, amount: op.amount, manual: true });
        return "done";
      case "spendBuffer": {
        const buffer = state.seats[op.seat].buffer;
        if (buffer[op.symbol] < op.amount) fail("CANNOT_AFFORD", `no ${op.amount} ${op.symbol}`);
        buffer[op.symbol] -= op.amount;
        emit(env, "SPEND", { seat: op.seat, symbol: op.symbol, amount: op.amount });
        return "done";
      }
      case "moveObject": {
        const object = objectOf(state, op.uid);
        emit(env, "MOVE", { uid: op.uid, cardId: object.cardId, toZone: op.toZone, manual: true });
        moveUid(env, op.uid, op.toZone, { position: op.position });
        return "done";
      }
      case "moveRandomFromZone": {
        // Hidden zones are reachable only positionally: exactly enough for
        // "opponent discards at random" with zero information transfer.
        const from = op.fromZone;
        for (let i = 0; i < (op.count || 1); i++) {
          const list = zoneArray(state, from);
          if (!list.length) break;
          const index = nextInt(state.rng.public, list.length);
          const uid = list[index];
          emit(env, "RANDOM_PICK", { zone: from, eligible: list.slice(), picked: uid, stream: "public" });
          moveUid(env, uid, zoneName(op.toZone), { seat: zoneSeat(op.toZone) });
        }
        return "done";
      }
      case "moveTopOfStack": {
        for (let i = 0; i < (op.count || 1); i++) {
          const stack = zoneArray(state, zoneKey(op.seat, "stack"));
          if (!stack.length) {
            state.seats[op.seat].deckedOut = true;
            break;
          }
          moveUid(env, stack[0], op.toZone, { seat: op.seat });
        }
        emit(env, "MOVE_TOP", { seat: op.seat, count: op.count || 1, toZone: op.toZone });
        return "done";
      }
      case "shuffleZone": {
        const list = zoneArray(state, op.zone);
        const seat = zoneSeat(op.zone);
        shuffleInPlace(list, state.rng.hidden[seat]);
        // §6.1 corollary: re-mint every uid, or watching a card go
        // wallet -> stack -> wallet identifies a card the opponent would have
        // lost track of at a physical shuffle.
        const remade = [];
        for (const uid of list.slice()) {
          const record = moveUid(env, uid, zoneName(op.zone), { seat });
          remade.push(record.uid);
        }
        state.zones[op.zone] = remade;
        emit(env, "SHUFFLE", { zone: op.zone });
        return "done";
      }
      case "setCommitted": {
        const target = objectOf(state, op.uid);
        const wasCommitted = target.committed;
        target.committed = Boolean(op.value);
        emit(env, "COMMIT", { uid: op.uid, value: Boolean(op.value) });
        if (!wasCommitted && target.committed) {
          const card = cardOf(env.ctx, target.cardId);
          raiseTriggers(env, "committed", {
            uid: op.uid,
            seat: target.controller,
            type: card.type,
            affinity: card.affinity,
          });
        }
        return "done";
      }
      case "addDamage":
        objectOf(state, op.uid).damage += op.amount;
        emit(env, "DAMAGE", { to: "object", uid: op.uid, amount: op.amount, manual: true });
        return "done";
      case "removeDamage":
        objectOf(state, op.uid).damage = 0;
        emit(env, "HEAL", { uid: op.uid });
        return "done";
      case "addCounter": {
        const object = objectOf(state, op.uid);
        object.counters[op.name] = (object.counters[op.name] || 0) + op.amount;
        emit(env, "COUNTER", { uid: op.uid, name: op.name, amount: op.amount });
        return "done";
      }
      case "addTempMod":
        addModEffect(env, op.uid, op.action, op.resilience, op.duration || "eot", item.sourceUid, "object");
        emit(env, "PUMP", { uid: op.uid, action: op.action || 0, resilience: op.resilience || 0, manual: true });
        return "done";
      case "grantKeyword":
      case "removeKeyword": {
        const state2 = env.state;
        state2.effects.push({
          id: "e" + state2.nextEid,
          sourceUid: item.sourceUid || null,
          layer: 6,
          kind: "grant",
          scope: "object",
          targetUid: op.uid,
          controller: null,
          keyword: op.keyword,
          remove: op.op === "removeKeyword",
          expires:
            op.duration === "eot"
              ? { kind: "eot", turn: state2.turn.number }
              : { kind: "static" },
          startedSeq: state2.seq,
        });
        state2.nextEid += 1;
        emit(env, "KEYWORD", { uid: op.uid, keyword: op.keyword, remove: op.op === "removeKeyword" });
        return "done";
      }
      case "setController": {
        const object = objectOf(state, op.uid);
        object.controller = op.seat;
        object.bootDelay = cardOf(env.ctx, object.cardId).isAvatar; // §17.2
        const list = zoneArray(state, object.zone);
        if (zoneName(object.zone) === "network" && zoneSeat(object.zone) !== op.seat) {
          list.splice(list.indexOf(op.uid), 1);
          object.zone = zoneKey(op.seat, "network");
          state.zones[object.zone].push(op.uid);
        }
        emit(env, "CONTROL", { uid: op.uid, seat: op.seat });
        return "done";
      }
      case "addRebootShield":
        objectOf(state, op.uid).rebootShields += op.delta;
        emit(env, "REBOOT_SHIELD", { uid: op.uid, delta: op.delta });
        return "done";
      case "createToken": {
        cardOf(env.ctx, op.cardId); // must be catalog-backed
        for (let i = 0; i < (op.count || 1); i++) {
          const record = newObjectRecord(state, env.ctx, op.cardId, op.seat, op.seat, zoneKey(op.seat, "network"), null);
          record.token = true;
          state.objects[record.uid] = record;
          state.zones[zoneKey(op.seat, "network")].push(record.uid);
          emit(env, "TOKEN", { uid: record.uid, cardId: op.cardId, seat: op.seat });
        }
        return "done";
      }
      case "setResourcePlays":
        if (op.seat === state.turn.active) state.turn.resourcePlays.allowed += op.delta;
        emit(env, "RESOURCE_PLAYS", { seat: op.seat, delta: op.delta });
        return "done";
      case "invalidateQueueItem": {
        const index = state.queue.findIndex((q) => q.qid === op.qid);
        if (index >= 0) invalidateQueueItem(env, index, "invalidated");
        return "done";
      }
      case "revealZone": {
        for (const uid of zoneArray(state, zoneKey(op.seat, op.zone))) {
          const object = state.objects[uid];
          object.revealedTo = Array.from(new Set(object.revealedTo.concat(op.toSeats || [0, 1]))).sort();
          object.revealedUntil = { turn: state.turn.number, phase: state.turn.phase };
        }
        emit(env, "REVEAL", { seat: op.seat, zone: op.zone, toSeats: op.toSeats || [0, 1] });
        return "done";
      }
      case "note":
        emit(env, "NOTE", { text: String(op.text || "") });
        return "done";
      default:
        fail("SCHEMA", `unhandled op ${op.op}`);
        return "done";
    }
  }

  function runManualDelta(env, proposal) {
    const item = {
      kind: "manual",
      qid: null,
      controller: proposal.seat,
      sourceUid: proposal.sourceUid || null,
      cardId: null,
      targets: [],
      ops: proposal.ops,
      resume: { opIndex: 0, acc: {} },
    };
    const outcome = runFrame(env, item);
    if (outcome === "pause") fail("SCHEMA", "a manual delta may not require a choice");
    emit(env, "MANUAL_APPLIED", {
      mid: proposal.mid,
      seat: proposal.seat,
      tier: proposal.tier,
      ops: proposal.ops,
    });
  }

  function closeManualOpen(state, mid, status) {
    for (const entry of state.manualOpen) {
      if (entry.mid === mid) entry.status = status;
    }
    state.manualOpen = state.manualOpen.filter((entry) => entry.status === "announced");
  }

  // ------------------------------------------------------------- rules.js

  /* §10.6 an ability outlives its source, which is why the Queue holds ITEMS,
   * not objects. Last element is the TOP (LIFO, §10.2). */
  function pushQueue(env, item) {
    const state = env.state;
    item.qid = "q" + state.nextQid;
    state.nextQid += 1;
    item.addedSeq = state.seq;
    item.resume = { opIndex: 0, acc: {} };
    state.queue.push(item);
    emit(env, "QUEUED", {
      qid: item.qid,
      seat: item.controller,
      cardId: item.cardId,
      kind: item.kind,
      targets: item.targets, // §11.2 targets are announced; hiding them would
    });                       // break the response window
    return item;
  }

  function targetLegal(env, target, spec) {
    const state = env.state;
    if (!target) return false;
    if (target.kind === "seat") return target.seat === 0 || target.seat === 1;
    if (target.kind === "queue") {
      const queued = state.queue.find((q) => q.qid === target.qid);
      if (!queued) return false;
      if (spec && spec.affinity) {
        const queuedCard = queued.cardId ? cardOf(env.ctx, queued.cardId) : null;
        return Boolean(queuedCard && queuedCard.affinity.indexOf(spec.affinity) >= 0);
      }
      return true;
    }
    if (target.kind !== "object") return false;
    const object = state.objects[target.uid];
    if (!object || zoneName(object.zone) !== "network") return false;
    if (!spec) return true;
    const card = cardOf(env.ctx, object.cardId);
    if (spec.kind === "avatar" || spec.kind === "any") return card.isAvatar;
    if (spec.kind === "permanent") return true; // any Network card
    if (spec.kind.indexOf("type:") === 0) return card.type.indexOf(spec.kind.slice(5)) >= 0;
    return true;
  }

  function validateTargets(env, spec, targets, sourceAffinity) {
    if (targets.length !== spec.length) {
      fail("TARGET_COUNT", `this item takes ${spec.length} target(s), got ${targets.length}`);
    }
    for (let i = 0; i < spec.length; i++) {
      const target = targets[i];
      const want = spec[i];
      if (want.kind === "seat" && target.kind !== "seat") fail("ILLEGAL_TARGET", "a player is required");
      if (want.kind === "any" && target.kind === "seat") continue;
      if (!targetLegal(env, target, want)) fail("ILLEGAL_TARGET", `illegal target for ${want.prompt}`);
      if (target.kind === "object" && sourceAffinity) {
        const shield = shieldedFrom(env.state, env.ctx, target.uid);
        // §14 Shielded from [Affinity]: cannot be targeted by that affinity.
        if (shield && sourceAffinity.indexOf(shield) >= 0) {
          fail("ILLEGAL_TARGET", `that object is Shielded from ${shield}`);
        }
      }
    }
  }

  /* §11.2 — if every target is illegal the whole item is invalidated by the
   * rules: it goes to its owner's Archive and its paid costs are not refunded. */
  function invalidateQueueItem(env, index, reason) {
    const item = env.state.queue[index];
    env.state.queue.splice(index, 1);
    if (item.objectUid && env.state.objects[item.objectUid]) {
      moveUid(env, item.objectUid, "archive");
    }
    emit(env, "INVALIDATED", { qid: item.qid, cardId: item.cardId, reason });
  }

  function announceManual(env, item, uid) {
    const state = env.state;
    const card = cardOf(env.ctx, item.cardId);
    let announced = 0;
    card.abilities.forEach((ability, index) => {
      if (!ability.manual) return;
      state.manualOpen.push({
        mid: "m" + state.nextMid,
        seat: item.controller,
        status: "announced",
        warrant: { kind: "static", uid: uid || null, abilityIndex: index },
        cardId: item.cardId,
        cardText: ability.text,
        atSeq: state.seq,
      });
      state.nextMid += 1;
      announced += 1;
    });
    if (!announced && !card.playOps.length && !card.isPermanent) {
      // A Zap or Operation the compiler could not script at all.
      state.manualOpen.push({
        mid: "m" + state.nextMid,
        seat: item.controller,
        status: "announced",
        warrant: { kind: "static", uid: uid || null, abilityIndex: 0 },
        cardId: item.cardId,
        cardText: card.text,
        atSeq: state.seq,
      });
      state.nextMid += 1;
      announced += 1;
    }
    if (announced) emit(env, "MANUAL_ANNOUNCED", { seat: item.controller, cardId: item.cardId, count: announced });
  }

  function resolveTopOfQueue(env) {
    const state = env.state;
    const index = state.queue.length - 1;
    if (index < 0) return;
    const item = state.queue[index];
    const card = item.cardId ? cardOf(env.ctx, item.cardId) : null;

    if (item.resume.opIndex === 0) {
      const spec = item.kind === "ability"
        ? card.abilities[item.abilityIndex].targetSpec
        : item.kind === "triggered"
          ? [] // a trigger's references were bound when it was raised
          : card && card.playModes && item.modes && item.modes.length
            ? card.playModes[item.modes[0]].targetSpec
            : card ? card.playTargetSpec : [];
      if (spec.length) {
        const legal = item.targets.filter((t, i) => targetLegal(env, t, spec[i]));
        if (!legal.length) {
          invalidateQueueItem(env, index, "all targets illegal");
          return;
        }
      }
    }

    const outcome = runFrame(env, item);
    if (outcome === "pause") return; // stays on the Queue with its cursor

    state.queue.splice(index, 1);
    if (item.kind === "card" && item.objectUid && state.objects[item.objectUid]) {
      if (card.isPermanent) {
        // §11.4 the card enters the Network under its controller's control.
        const record = moveUid(env, item.objectUid, "network", { seat: item.controller });
        emit(env, "ENTERS", { uid: record.uid, cardId: item.cardId, seat: item.controller });
        // An Attachment fastens to the host it targeted. A host that left in
        // response leaves the Attachment unattached, and the state check
        // archives orphans — §11.2 do as much as possible.
        const attach = (card.keywords || []).find((k) => k.name === "Attach");
        const host = attach && item.targets[0];
        if (host && host.kind === "object" && state.objects[host.uid]) {
          if (zoneName(state.objects[host.uid].zone) === "network") {
            record.attachedTo = host.uid;
          }
        }
        announceManual(env, item, record.uid);
      } else {
        // §9.4 archived first, then announced, so a manual delta that moves the
        // card again starts from the right zone.
        const record = moveUid(env, item.objectUid, "archive");
        emit(env, "ARCHIVED", { uid: record.uid, cardId: item.cardId, reason: "resolved" });
        announceManual(env, item, record.uid);
      }
    } else if (item.kind === "ability") {
      const ability = card.abilities[item.abilityIndex];
      if (ability.manual) announceManual(env, item, item.sourceUid);
      emit(env, "RESOLVED", { qid: item.qid, cardId: item.cardId, abilityIndex: item.abilityIndex });
    }
  }

  // ------------------------------------------------------- the turn machine

  const stepsOf = (phase) => PHASE_STEPS[phase];

  function grantsPriority(state) {
    const step = state.turn.step;
    // §9.1 / §9.5 no player receives priority during Unlock or Cleanup.
    if (step === "unlock") return false;
    if (step === "cleanup") return false;
    return true;
  }

  /* Turn-based actions for the step we just entered. Returns "skip" when the
   * step has nothing to do and no decision to await (§9.3 Clash steps are
   * skipped when they cannot apply). */
  function enterStep(env, initial) {
    const state = env.state;
    const phase = state.turn.phase;
    const step = state.turn.step;
    state.priority.window = `${phase}:${step}`;
    state.awaiting = null;

    if (phase === "clash") state.clash.step = step;

    switch (step) {
      case "unlock": {
        const seat = state.turn.active;
        for (const uid of zoneArray(state, zoneKey(seat, "network"))) {
          state.objects[uid].committed = false;
          // §5.2 Boot Delay ends when its controller BEGINS a turn with it.
          state.objects[uid].bootDelay = false;
        }
        emit(env, "UNLOCK", { seat });
        return "ok";
      }
      case "maintenance":
        raiseTriggers(env, "maintenance", { active: state.turn.active, seat: state.turn.active });
        return "ok";
      case "draw":
        // §8 the first player does draw during their first turn.
        drawCards(env, state.turn.active, 1);
        return "ok";
      case "main":
        return "ok";
      case "start":
        burnBuffers(env, "clash begins"); // §12.1
        return "ok";
      case "attackers": {
        const seat = state.turn.active;
        const eligible = zoneArray(state, zoneKey(seat, "network")).filter((uid) => canAttack(env, uid));
        if (!eligible.length) {
          emit(env, "ATTACKERS", { seat, attackers: [] });
          return "skipRest";
        }
        state.awaiting = { kind: "attackers", seat };
        return "await";
      }
      case "blockers": {
        if (!state.clash.attackers.length) return "skipRest";
        state.awaiting = { kind: "blockers", seat: 1 - state.turn.active };
        return "await";
      }
      case "order": {
        // §13.3 raised only when an attacker has two or more blockers, and
        // decided by the ATTACKER's controller. play.js had no such decision.
        const needed = state.clash.attackers.filter(
          (uid) => (state.clash.blocks[uid] || []).length >= 2
        );
        if (!needed.length) {
          for (const uid of state.clash.attackers) {
            state.clash.order[uid] = (state.clash.blocks[uid] || []).slice();
          }
          return "skip";
        }
        for (const uid of state.clash.attackers) {
          state.clash.order[uid] = (state.clash.blocks[uid] || []).slice();
        }
        state.awaiting = { kind: "order", seat: state.turn.active };
        return "await";
      }
      case "firstStrike": {
        if (!state.clash.attackers.length) return "skip";
        if (!combatants(env).some((uid) => hasKeywordUid(state, env.ctx, uid, "First Strike"))) {
          return "skip";
        }
        return startDamageStep(env, true);
      }
      case "damage": {
        if (!state.clash.attackers.length) return "skip";
        return startDamageStep(env, false);
      }
      case "end": {
        for (const uid of state.clash.attackers) removeFromCombat(state, uid);
        state.clash = emptyClash();
        burnBuffers(env, "clash ends"); // §12.1
        return "ok";
      }
      case "endStep":
        return "ok";
      case "cleanup": {
        const seat = state.turn.active;
        const wallet = zoneArray(state, zoneKey(seat, "wallet"));
        if (wallet.length > state.handLimit) {
          // A player decision. play.js:463 silently discarded from the end of
          // the array, which is the engine choosing which cards you lose.
          state.awaiting = { kind: "discard", seat, count: wallet.length - state.handLimit };
          return "await";
        }
        runCleanup(env);
        return "ok";
      }
      default:
        return "ok";
    }
    /* eslint-disable-next-line no-unreachable */
  }

  function runCleanup(env) {
    const state = env.state;
    for (const seat of [0, 1]) {
      for (const uid of zoneArray(state, zoneKey(seat, "network"))) {
        state.objects[uid].damage = 0; // §9.5 all marked damage is removed
        state.objects[uid].rebootShields = 0; // §14 shields last the turn
      }
    }
    state.effects = state.effects.filter(
      (effect) => !(effect.expires && effect.expires.kind === "eot")
    );
    if (state.prevention) {
      state.prevention = state.prevention.filter((s) => s.turn === state.turn.number + 1);
    }
    emit(env, "CLEANUP", { seat: state.turn.active });
  }

  function endTurn(env) {
    const state = env.state;
    state.turn.active = 1 - state.turn.active;
    if (state.turn.active === state.turn.firstPlayer) state.turn.number += 1;
    state.turn.phase = "open";
    state.turn.step = "unlock";
    state.turn.resourcePlays = { used: 0, allowed: 1 };
    state.turn.repeatCleanup = false;
    state.clash = emptyClash();
    emit(env, "TURN", { number: state.turn.number, seat: state.turn.active });
    return enterStep(env);
  }

  /* Advance until a step actually wants something. A Clash step that cannot
   * apply ("skip") is stepped straight through rather than opening an empty
   * priority window; an attack that never happened skips the rest of the phase. */
  function nextStep(env) {
    for (let guard = 0; guard < 64; guard++) {
      const outcome = advanceOneStep(env);
      if (outcome === "skip") continue;
      if (outcome === "skipRest") {
        const after = skipRestOfPhase(env);
        if (after === "skip") continue;
        return after;
      }
      return outcome;
    }
    return "ok";
  }

  /* Buffers burn for BOTH seats at every phase boundary (§12.1). */
  function advanceOneStep(env) {
    const state = env.state;
    const steps = stepsOf(state.turn.phase);
    const index = steps.indexOf(state.turn.step);
    if (index + 1 < steps.length) {
      state.turn.step = steps[index + 1];
      return enterStep(env);
    }
    if (state.turn.phase === "close") {
      if (state.turn.repeatCleanup) {
        state.turn.repeatCleanup = false;
        state.turn.step = "cleanup";
        return enterStep(env);
      }
      burnBuffers(env, "end of phase");
      return endTurn(env);
    }
    burnBuffers(env, "end of phase");
    const phaseIndex = PHASE_ORDER.indexOf(state.turn.phase);
    state.turn.phase = PHASE_ORDER[phaseIndex + 1];
    state.turn.step = stepsOf(state.turn.phase)[0];
    emit(env, "PHASE", { phase: state.turn.phase, seat: state.turn.active });
    return enterStep(env);
  }

  function skipRestOfPhase(env) {
    const state = env.state;
    const steps = stepsOf(state.turn.phase);
    state.turn.step = steps[steps.length - 1];
    return enterStep(env);
  }

  /* Runs turn-based actions until somebody must act: a priority window, an
   * awaited declaration, a pending choice or a pending manual proposal. */
  function advanceUntilPriority(env) {
    const state = env.state;
    for (let guard = 0; guard < 400; guard++) {
      if (state.result) return;
      if (state.pendingChoice || state.pendingManual) {
        state.priority.seat = null;
        return;
      }
      stateChecks(env);
      if (state.result) return;
      collectTriggers(env);
      if (state.awaiting) {
        state.priority.seat = null;
        return;
      }
      if (grantsPriority(state)) {
        state.priority.seat = state.turn.active;
        state.priority.passed = [false, false];
        applyAutoPass(env);
        return;
      }
      nextStep(env);
    }
  }

  /* autoPass.emptyQueue keeps the local table at one Continue click per step:
   * the NON-active seat, holding no reason to respond, passes automatically.
   * It is emitted as a visible event, never as a hidden shortcut. */
  function applyAutoPass(env) {
    const state = env.state;
    for (let guard = 0; guard < 8; guard++) {
      const seat = state.priority.seat;
      if (seat === null || seat === state.turn.active) return;
      if (state.pendingChoice || state.pendingManual || state.awaiting) return;
      const player = state.seats[seat];
      if (!player.autoPass.emptyQueue || state.queue.length) return;
      emit(env, "PASS_PRIORITY", { seat, auto: true });
      const advanced = registerPass(env, seat);
      if (advanced) return;
    }
  }

  /* Returns true when the pass ended the window (resolved an item or advanced
   * the step), because the caller must then stop auto-passing. */
  function registerPass(env, seat) {
    const state = env.state;
    state.priority.passed[seat] = true;
    if (!state.priority.passed[0] || !state.priority.passed[1]) {
      state.priority.seat = 1 - seat;
      return false;
    }
    state.priority.passed = [false, false];
    if (state.queue.length) {
      resolveTopOfQueue(env); // §10.1 both passed with items: the top resolves
      stateChecks(env);
      collectTriggers(env);
      if (state.pendingChoice || state.pendingManual) {
        state.priority.seat = null;
        return true;
      }
      // §10.1 the active player then receives priority again.
      state.priority.seat = state.turn.active;
      applyAutoPass(env);
      return true;
    }
    nextStep(env);
    advanceUntilPriority(env);
    return true;
  }

  /* ------------------------------------------------------------- triggers
   *
   * The produce side of §10.4 — this half simply did not exist: the pending
   * lists were initialised, ordered and consumed, and nothing ever filled
   * them, which is why every "When/Whenever/At" card was assisted. Game
   * moments call raiseTriggers() with an event name and its context; matching
   * scripted abilities stage themselves, and collectTriggers() below already
   * queues them at the next checkpoint. Staging is deferred, never recursive:
   * a trigger's own ops can raise more triggers without reentering the queue.
   */

  function raiseTriggers(env, on, ctx) {
    const state = env.state;
    for (const seat of seatsOf(state)) {
      for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
        const object = state.objects[uid];
        if (!object || !object.cardId) continue;
        const card = cardOf(env.ctx, object.cardId);
        card.abilities.forEach((ability, abilityIndex) => {
          if (ability.kind !== "triggered" || ability.manual) return;
          if (!ability.ops || !ability.trigger) return;
          if (!triggerMatches(state, ability.trigger, on, ctx, uid, seat, object)) return;
          state.nextTriggerId = state.nextTriggerId || 1;
          const pendingId = "t" + state.nextTriggerId;
          state.nextTriggerId += 1;
          state.pendingTriggers[String(seat)].push({
            kind: "triggered",
            pendingId,
            controller: seat,
            sourceUid: uid,
            cardId: object.cardId,
            targets: [],
            ops: bindTriggerOps(ability.ops, ctx, uid),
            abilityIndex,
          });
          emit(env, "TRIGGERED", { seat, uid, cardId: object.cardId, on });
        });
      }
    }
  }

  function triggerMatches(state, trigger, on, ctx, uid, seat, object) {
    if (trigger.on !== on) return false;
    // "attached X's controller" — the watcher rides a host; no host, no watch.
    if (trigger.whose === "host") {
      const host = object && object.attachedTo ? state.objects[object.attachedTo] : null;
      if (!host) return false;
      if (on === "maintenance") return ctx.active === host.controller;
      if (on === "committed") return ctx.uid === object.attachedTo;
      return false;
    }
    switch (on) {
      case "maintenance":
        // "your Maintenance" fires only on the controller's own turn;
        // "each player's" fires on both.
        return trigger.whose === "each" || ctx.active === seat;
      case "self-damaged":
        return ctx.uid === uid;
      case "self-deals-player-damage":
        return ctx.sourceUid === uid;
      case "enters":
      case "network-archived":
        if (ctx.uid === uid) return false; // a card never watches itself move
        return !trigger.what || (ctx.type || "").indexOf(trigger.what) >= 0;
      case "card-queued":
        if (trigger.whose === "you" && ctx.seat !== seat) return false;
        if (trigger.affinity && (ctx.affinity || []).indexOf(trigger.affinity) < 0) return false;
        return !trigger.what || (ctx.type || "").indexOf(trigger.what) >= 0;
      case "committed":
        if (ctx.uid === uid) return false;
        if (trigger.what && (ctx.type || "").indexOf(trigger.what) < 0) return false;
        if (trigger.affinity && (ctx.affinity || []).indexOf(trigger.affinity) < 0) return false;
        if (trigger.whose === "opponent" && ctx.seat === seat) return false;
        return true;
      default:
        return false;
    }
  }

  /* "that player" and "it" resolve at raise time into the plain seat/uid
   * fields the op runner honours, so the queued item is self-contained.
   * Recurses into optional-cost branches — a nested op is as bound as a
   * top-level one, or the archive-self of an unless-cost dies of UNKNOWN_OBJECT. */
  function bindTriggerOps(ops, ctx, sourceUid) {
    return ops.map((op) => {
      const bound = cloneJson(op);
      if (bound.target === "event-player") {
        bound.seat = ctx.seat;
        delete bound.target;
      }
      if (bound.target === "self-object") {
        bound.uid = sourceUid;
        delete bound.target;
      }
      if (Array.isArray(bound.then)) bound.then = bindTriggerOps(bound.then, ctx, sourceUid);
      if (Array.isArray(bound.else)) bound.else = bindTriggerOps(bound.else, ctx, sourceUid);
      return bound;
    });
  }

  /* §10.4 the active player places their triggers on the Queue first, then the
   * non-active player — so the non-active player's triggers end up on TOP and
   * resolve FIRST. This is the one counter-intuitive line in §10. */
  function collectTriggers(env) {
    const state = env.state;
    for (const seat of [state.turn.active, 1 - state.turn.active]) {
      const waiting = state.pendingTriggers[String(seat)];
      if (!waiting.length) continue;
      if (waiting.length >= 2) {
        state.awaiting = { kind: "triggers", seat };
        return;
      }
      for (const trigger of waiting.splice(0)) pushQueue(env, trigger);
    }
  }

  // ------------------------------------------------------------------ clash

  function canAttack(env, uid) {
    const state = env.state;
    const object = state.objects[uid];
    if (!object) return false;
    const card = cardOf(env.ctx, object.cardId);
    if (!card.isAvatar) return false;
    /* §13.1 attackers are declared FROM THE NETWORK. Without this the Wallet and
     * the Archive are attack-legal: a modified client could declare its whole
     * opening hand, pay nothing, and the defender would see only uid shells and
     * so could not even evaluate a block. DECLARE_BLOCKERS has always checked
     * the zone; this is the same check on the other side of the same phase. */
    if (zoneName(object.zone) !== "network") return false;
    if (object.committed) return false; // §13.1
    if (object.bootDelay) return false; // §5.2
    const keywords = keywordsOf(state, env.ctx, uid);
    if (keywords.indexOf("Firewall") >= 0) return false; // §14 Firewall
    // "can't attack unless defending player controls a … Resource"
    for (const ability of card.abilities) {
      const need = ability.kind === "clash-static" && ability.rule && ability.rule.attackNeedsDefender;
      if (!need) continue;
      const defender = 1 - object.controller;
      const holds = zoneArray(state, zoneKey(defender, "network")).some((other) => {
        const otherCard = cardOf(env.ctx, state.objects[other].cardId);
        return otherCard.type.indexOf("Resource") >= 0 && otherCard.affinity.indexOf(need.affinity) >= 0;
      });
      if (!holds) return false;
    }
    return true;
  }

  /* Clash rules a card or its attachments impose. */
  function clashRules(state, ctx, uid) {
    const rules = [];
    for (const ability of cardOf(ctx, objectOf(state, uid).cardId).abilities) {
      if (ability.kind === "clash-static" && ability.rule) rules.push(ability.rule);
    }
    for (const grants of attachmentGrants(state, ctx, uid)) {
      if (grants.onlyBlockedBy) rules.push({ onlyBlockedBy: grants.onlyBlockedBy });
    }
    return rules;
  }

  function canBlock(env, blockerUid, attackerUid) {
    const state = env.state;
    const blocker = state.objects[blockerUid];
    const attacker = state.objects[attackerUid];
    if (!blocker || !attacker) return false;
    if (!cardOf(env.ctx, blocker.cardId).isAvatar) return false;
    if (blocker.committed) return false; // §13.2 a committed Avatar cannot block
    const blockerKeywords = keywordsOf(state, env.ctx, blockerUid);
    const attackerKeywords = keywordsOf(state, env.ctx, attackerUid);
    // §14 Broadcast
    if (attackerKeywords.indexOf("Broadcast") >= 0) {
      const ok =
        blockerKeywords.indexOf("Broadcast") >= 0 || blockerKeywords.indexOf("Broadcast Guard") >= 0;
      if (!ok) return false;
    }
    // §14 Shielded from [Affinity] cannot be blocked by that affinity
    const shield = shieldedFrom(state, env.ctx, attackerUid);
    if (shield && cardOf(env.ctx, blocker.cardId).affinity.indexOf(shield) >= 0) return false;
    // Scripted clash rules: "can't be blocked by …", "… except by …",
    // "can't block Avatars with Action N or greater".
    for (const rule of clashRules(state, env.ctx, attackerUid)) {
      if (rule.cantBeBlockedBy && blockerKeywords.indexOf(rule.cantBeBlockedBy) >= 0) return false;
      if (rule.onlyBlockedBy && blockerKeywords.indexOf(rule.onlyBlockedBy) < 0) return false;
    }
    for (const rule of clashRules(state, env.ctx, blockerUid)) {
      if (rule.cantBlockActionGE !== undefined) {
        if (statsOf(state, env.ctx, attackerUid).action >= rule.cantBlockActionGE) return false;
      }
    }
    // §14 Backchannel — [Resource]
    const backchannel = cardOf(env.ctx, attacker.cardId).keywords.find((k) => k.name === "Backchannel");
    if (backchannel) {
      const defender = blocker.controller;
      const holds = zoneArray(state, zoneKey(defender, "network")).some((uid) => {
        const card = cardOf(env.ctx, state.objects[uid].cardId);
        return card.isResource && (card.subtype || "").indexOf(backchannel.resource) >= 0;
      });
      if (holds) return false;
    }
    return true;
  }

  const combatants = (env) => {
    const state = env.state;
    const out = state.clash.attackers.slice();
    for (const attacker of Object.keys(state.clash.blocks)) {
      for (const uid of state.clash.blocks[attacker]) out.push(uid);
    }
    return out.filter((uid) => state.objects[uid]);
  };

  const dealsInStep = (env, uid, firstStrike) =>
    hasKeywordUid(env.state, env.ctx, uid, "First Strike") === firstStrike;

  /* Minimal lethal in order, then excess to the defending player only with
   * Overflow (§13.3, §14). Offered to the UI as a prefilled template so the
   * common case is one click, but always verified by the engine. */
  function canonicalAssignment(env, firstStrike) {
    const state = env.state;
    const assignment = {};
    for (const attackerUid of state.clash.attackers) {
      if (!state.objects[attackerUid] || !dealsInStep(env, attackerUid, firstStrike)) continue;
      const blockers = (state.clash.order[attackerUid] || []).filter((uid) => state.objects[uid]);
      const power = statsOf(state, env.ctx, attackerUid).action;
      const rows = [];
      if (!state.clash.blockedOnce.includes(attackerUid)) {
        rows.push({ to: "seat:" + (1 - state.objects[attackerUid].controller), amount: power });
      } else {
        let remaining = power;
        for (const blockerUid of blockers) {
          const blocker = state.objects[blockerUid];
          const lethal = Math.max(0, statsOf(state, env.ctx, blockerUid).resilience - blocker.damage);
          const give = Math.min(remaining, lethal);
          if (give > 0) rows.push({ to: blockerUid, amount: give });
          remaining -= give;
        }
        if (remaining > 0 && hasKeywordUid(state, env.ctx, attackerUid, "Overflow")) {
          rows.push({ to: "seat:" + (1 - state.objects[attackerUid].controller), amount: remaining });
        }
      }
      assignment[attackerUid] = rows;
    }
    return assignment;
  }

  function startDamageStep(env, firstStrike) {
    const state = env.state;
    const blocked = state.clash.attackers.filter(
      (uid) => state.objects[uid] && dealsInStep(env, uid, firstStrike) && (state.clash.order[uid] || []).length
    );
    if (!blocked.length) {
      applyCombatDamage(env, canonicalAssignment(env, firstStrike), firstStrike);
      return "ok";
    }
    state.awaiting = { kind: "damage", seat: state.turn.active, firstStrike };
    return "await";
  }

  function applyCombatDamage(env, assignment, firstStrike) {
    const state = env.state;
    for (const attackerUid of state.clash.attackers) {
      if (!state.objects[attackerUid] || !dealsInStep(env, attackerUid, firstStrike)) continue;
      for (const row of assignment[attackerUid] || []) {
        if (typeof row.to === "string" && row.to.indexOf("seat:") === 0) {
          damageTarget(env, { kind: "seat", seat: Number(row.to.slice(5)) }, row.amount, attackerUid);
        } else {
          damageTarget(env, { kind: "object", uid: row.to }, row.amount, attackerUid);
        }
      }
    }
    // §13.4 each blocker deals damage to the attacker it blocks; combat damage
    // in the same step is simultaneous.
    for (const attackerUid of Object.keys(state.clash.blocks)) {
      for (const blockerUid of state.clash.blocks[attackerUid]) {
        if (!state.objects[blockerUid] || !state.objects[attackerUid]) continue;
        if (!dealsInStep(env, blockerUid, firstStrike)) continue;
        const power = statsOf(state, env.ctx, blockerUid).action;
        damageTarget(env, { kind: "object", uid: attackerUid }, power, blockerUid);
      }
    }
    state.clash.damageDone[firstStrike ? "firstStrike" : "regular"] = true;
    emit(env, "COMBAT_DAMAGE", { firstStrike });
    // §13.4 triggers caused by that damage wait for the damage event and the
    // state checks to complete.
    stateChecks(env);
  }
  // ---------------------------------------------------------- actions.js

  /* A per-type key whitelist. UNKNOWN KEYS ARE REJECTED, NOT IGNORED — that is
   * what stops payload smuggling. Every number is checked with
   * Number.isInteger, every uid must be a known string, every seat is 0 or 1. */
  const ENVELOPE_KEYS = ["type", "seat", "seq", "at", "sig", "pubkey", "payload"];
  const ACTION_KEYS = {
    SEED_COMMIT: ["commit"],
    SEED_REVEAL: ["r", "salt"],
    PASS_PRIORITY: [],
    CONCEDE: [],
    PLAY_RESOURCE: ["uid"],
    PLAY_CARD: ["uid", "targets", "modes", "x", "additionalCosts", "payment"],
    ACTIVATE_ABILITY: ["uid", "abilityIndex", "targets", "modes", "x", "payment"],
    ACTIVATE_RESOURCE_ABILITY: ["uid", "abilityIndex", "choice"],
    DECLARE_ATTACKERS: ["attackers"],
    DECLARE_BLOCKERS: ["blocks"],
    ORDER_BLOCKERS: ["order"],
    ASSIGN_COMBAT_DAMAGE: ["assignment"],
    CHOOSE: ["choiceId", "selection"],
    ORDER_TRIGGERS: ["qids"],
    DISCARD_TO_LIMIT: ["uids"],
    REVEAL: ["uids", "to"],
    MANUAL_PROPOSE: ["warrant", "ops", "reason"],
    MANUAL_ACCEPT: ["mid"],
    MANUAL_REJECT: ["mid", "reason"],
    MANUAL_WITHDRAW: ["mid"],
    MANUAL_RESOLVE: ["mid"],
    MANUAL_FLAG: ["mid", "reason"],
  };

  /* Legal after the game is over — everything else is GAME_OVER. */
  const POST_GAME = ["CONCEDE", "MANUAL_ACCEPT", "MANUAL_REJECT", "MANUAL_FLAG"];
  /* Legal while a Tier-B proposal is awaiting a verdict. */
  const DURING_CONSENT = ["CONCEDE", "MANUAL_ACCEPT", "MANUAL_REJECT", "MANUAL_WITHDRAW", "MANUAL_FLAG"];

  function validateSchema(action) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      fail("SCHEMA", "action must be an object");
    }
    for (const key of Object.keys(action)) {
      if (ENVELOPE_KEYS.indexOf(key) < 0) fail("SCHEMA", `unknown envelope key ${key}`);
    }
    const allowed = ACTION_KEYS[action.type];
    if (!allowed) fail("SCHEMA", `unknown action type ${action.type}`);
    if (action.seat !== 0 && action.seat !== 1) fail("SCHEMA", "seat must be 0 or 1");
    if (!Number.isInteger(action.seq)) fail("SCHEMA", "seq must be an integer");
    if (action.at !== undefined && typeof action.at !== "string") fail("SCHEMA", "at must be a string");
    const payload = action.payload || {};
    if (typeof payload !== "object" || Array.isArray(payload)) fail("SCHEMA", "payload must be an object");
    for (const key of Object.keys(payload)) {
      if (allowed.indexOf(key) < 0) fail("SCHEMA", `unknown payload key ${key} for ${action.type}`);
    }
    deepIntegerCheck(payload, "payload");
    return payload;
  }

  function deepIntegerCheck(value, path) {
    if (value === null) return;
    if (typeof value === "number") {
      if (!Number.isInteger(value)) fail("SCHEMA", `${path} must be an integer`);
      if (!Number.isSafeInteger(value)) fail("SCHEMA", `${path} is out of integer range`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => deepIntegerCheck(item, `${path}[${i}]`));
      return;
    }
    if (typeof value === "object") {
      for (const key of Object.keys(value)) deepIntegerCheck(value[key], `${path}.${key}`);
    }
  }

  const requireUid = (state, uid) => {
    if (typeof uid !== "string" || !state.objects[uid]) fail("UNKNOWN_OBJECT", `unknown uid ${uid}`);
    return state.objects[uid];
  };

  const requirePriority = (env, seat) => {
    if (env.state.priority.seat !== seat) fail("NO_PRIORITY", "you do not hold priority");
  };

  const requireAwaiting = (env, kind, seat) => {
    const awaiting = env.state.awaiting;
    if (!awaiting || awaiting.kind !== kind) fail("WRONG_STEP", `no ${kind} declaration is due`);
    if (awaiting.seat !== seat) fail("NOT_YOUR_SEAT", `seat ${awaiting.seat} must declare`);
    return awaiting;
  };

  const normalizeTargets = (targets) => {
    if (targets === undefined) return [];
    if (!Array.isArray(targets)) fail("SCHEMA", "targets must be an array");
    return targets.map((target) => {
      if (!target || typeof target !== "object") fail("SCHEMA", "bad target");
      if (target.kind === "object") return { kind: "object", uid: String(target.uid) };
      if (target.kind === "seat") return { kind: "seat", seat: target.seat };
      if (target.kind === "queue") return { kind: "queue", qid: String(target.qid) };
      return fail("SCHEMA", `bad target kind ${target.kind}`);
    });
  };

  // ------------------------------------------------------------- handlers

  const HANDLERS = {
    PASS_PRIORITY(env, payload, action) {
      requirePriority(env, action.seat);
      emit(env, "PASS_PRIORITY", { seat: action.seat, auto: false });
      registerPass(env, action.seat);
    },

    /* §2.1 always legal for your own seat, at any time, with no priority, even
     * paused, even with a pending prompt: a concession cannot be answered. */
    CONCEDE(env, payload, action) {
      env.state.seats[action.seat].conceded = true;
      emit(env, "CONCEDE", { seat: action.seat });
      recomputeResult(env);
    },

    /* §5.1 / §12.2 a special action: never queued, cannot be answered, and the
     * active player keeps priority afterwards. */
    PLAY_RESOURCE(env, payload, action) {
      const state = env.state;
      if (action.seat !== state.turn.active) fail("NOT_YOUR_SEAT", "only the active player");
      requirePriority(env, action.seat);
      if (["build1", "build2"].indexOf(state.turn.phase) < 0) fail("WRONG_PHASE", "Build I or Build II only");
      if (state.queue.length) fail("QUEUE_NOT_EMPTY", "the Queue must be empty");
      if (state.turn.resourcePlays.used >= state.turn.resourcePlays.allowed) {
        fail("RESOURCE_PLAY_USED", "you have already played a Resource this turn");
      }
      const object = requireUid(state, payload.uid);
      if (object.zone !== zoneKey(action.seat, "wallet")) fail("NOT_IN_ZONE", "that card is not in your Wallet");
      const card = cardOf(env.ctx, object.cardId);
      if (!card.isResource) fail("NOT_RESOURCE", `${card.name} is not a Resource`);
      const record = moveUid(env, payload.uid, "network", { seat: action.seat });
      state.turn.resourcePlays.used += 1;
      emit(env, "ENTERS", { uid: record.uid, cardId: object.cardId, seat: action.seat, resourcePlay: true });
      announceManual(env, { controller: action.seat, cardId: object.cardId }, record.uid);
      state.priority.seat = action.seat;
      state.priority.passed = [false, false];
    },

    /* §11 steps 1-7 in ONE action on purpose: "once payment is complete,
     * choices and costs are locked", so a half-announced card is not a legal
     * intermediate state a peer may observe or respond to. */
    PLAY_CARD(env, payload, action) {
      const state = env.state;
      requirePriority(env, action.seat);
      const object = requireUid(state, payload.uid);
      if (object.zone !== zoneKey(action.seat, "wallet")) fail("NOT_IN_ZONE", "that card is not in your Wallet");
      const card = cardOf(env.ctx, object.cardId);
      if (card.isResource) fail("NOT_RESOURCE", "play a Resource with PLAY_RESOURCE");
      if (card.type !== "Zap") {
        // §5.6 / §9.2 sorcery speed: your own Build phase, Queue empty.
        if (action.seat !== state.turn.active) fail("NOT_YOUR_SEAT", "only on your own turn");
        if (["build1", "build2"].indexOf(state.turn.phase) < 0) fail("WRONG_PHASE", "Build I or Build II only");
        if (state.queue.length) fail("QUEUE_NOT_EMPTY", "the Queue must be empty");
      }
      const targets = normalizeTargets(payload.targets);
      let playSpec = card.playTargetSpec;
      if (card.playModes) {
        const mode = Array.isArray(payload.modes) ? payload.modes[0] : undefined;
        if (!Number.isInteger(mode) || mode < 0 || mode >= card.playModes.length) {
          fail("SCHEMA", "choose one of this card's modes");
        }
        playSpec = card.playModes[mode].targetSpec;
      }
      validateTargets(env, playSpec, targets, card.affinity);
      const payment = settleCost(env, action.seat, costWithX(card.costParsed, payload.x), payload.payment);
      const record = moveUid(env, payload.uid, "queue", { seat: action.seat });
      pushQueue(env, {
        kind: "card",
        controller: action.seat,
        objectUid: record.uid,
        cardId: object.cardId,
        sourceUid: record.uid,
        abilityIndex: null,
        targets,
        modes: payload.modes || [],
        x: payload.x || 0,
        paid: payment,
        manual: null,
      });
      // "Whenever a player plays a … card on the Queue" — raised after the
      // push, so the triggers land above it and resolve first (§10.2 LIFO).
      raiseTriggers(env, "card-queued", {
        seat: action.seat,
        type: card.type,
        affinity: card.affinity,
      });
    },

    ACTIVATE_ABILITY(env, payload, action) {
      const state = env.state;
      requirePriority(env, action.seat);
      const object = requireUid(state, payload.uid);
      if (object.controller !== action.seat) fail("NOT_CONTROLLER", "you do not control that object");
      if (zoneName(object.zone) !== "network") fail("NOT_IN_ZONE", "that object is not on the Network");
      const card = cardOf(env.ctx, object.cardId);
      const ability = card.abilities[payload.abilityIndex];
      if (!ability || ability.kind !== "activated") fail("SCHEMA", "not an activated ability");
      if (ability.resourceAbility) fail("SCHEMA", "use ACTIVATE_RESOURCE_ABILITY (§10.3)");
      const targets = normalizeTargets(payload.targets);
      validateTargets(env, ability.targetSpec, targets, card.affinity);
      payAbilityCost(env, action.seat, object, ability, payload.payment);
      pushQueue(env, {
        kind: "ability",
        controller: action.seat,
        objectUid: null,
        cardId: object.cardId,
        sourceUid: payload.uid,
        abilityIndex: payload.abilityIndex,
        targets,
        modes: payload.modes || [],
        x: payload.x || 0,
        paid: {},
        manual: null,
      });
    },

    /* §10.3 resolves immediately, never enters the Queue, and is legal even
     * while paying a cost — the client sends these first, then PLAY_CARD. */
    ACTIVATE_RESOURCE_ABILITY(env, payload, action) {
      const state = env.state;
      const object = requireUid(state, payload.uid);
      if (object.controller !== action.seat) fail("NOT_CONTROLLER", "you do not control that object");
      if (zoneName(object.zone) !== "network") fail("NOT_IN_ZONE", "that object is not on the Network");
      const card = cardOf(env.ctx, object.cardId);
      const ability = card.abilities[payload.abilityIndex];
      if (!ability || !ability.resourceAbility) fail("NOT_RESOURCE", "not a Resource ability");
      payAbilityCost(env, action.seat, object, ability, null);
      const item = {
        kind: "manual",
        qid: null,
        controller: action.seat,
        sourceUid: payload.uid,
        cardId: object.cardId,
        targets: [],
        ops: ability.ops,
        resume: { opIndex: 0, acc: {} },
      };
      if (payload.choice) {
        for (let i = 0; i < ability.ops.length; i++) item.resume.acc["choice" + i] = payload.choice;
      }
      const outcome = runFrame(env, item);
      if (outcome === "pause") fail("BAD_CHOICE", "this Resource ability needs an affinity choice");
    },

    DECLARE_ATTACKERS(env, payload, action) {
      const state = env.state;
      requireAwaiting(env, "attackers", action.seat);
      const declared = Array.isArray(payload.attackers) ? payload.attackers : [];
      const seen = Object.create(null);
      for (const entry of declared) {
        const uid = typeof entry === "string" ? entry : entry.uid;
        if (seen[uid]) fail("SCHEMA", "duplicate attacker");
        seen[uid] = true;
        requireUid(state, uid);
        if (state.objects[uid].controller !== action.seat) fail("NOT_CONTROLLER", uid);
        // §13.1 declared from the Network, and refused with the SAME code the
        // blocker path uses so the two declarations answer alike.
        if (zoneName(state.objects[uid].zone) !== "network") {
          fail("NOT_IN_ZONE", "that object is not on the Network", { uid });
        }
        if (!canAttack(env, uid)) fail("CANNOT_ATTACK", `${uid} cannot attack`);
        state.clash.attackers.push(uid);
        // §13.1 declaring an Avatar as an attacker commits it.
        state.objects[uid].committed = true;
        if (entry && entry.mesh) state.clash.meshGroups[uid] = String(entry.mesh);
      }
      state.awaiting = null;
      emit(env, "ATTACKERS", { seat: action.seat, attackers: state.clash.attackers.slice() });
      if (!state.clash.attackers.length) skipRestOfPhase(env);
    },

    /* Defending seat only, atomic. §13.2 blocker unlocked, each blocker on at
     * most one attacker, blocking does not Commit. */
    DECLARE_BLOCKERS(env, payload, action) {
      const state = env.state;
      requireAwaiting(env, "blockers", action.seat);
      const blocks = payload.blocks || {};
      const used = Object.create(null);
      for (const attackerUid of Object.keys(blocks)) {
        if (state.clash.attackers.indexOf(attackerUid) < 0) fail("CANNOT_BLOCK", "not an attacker");
        const list = blocks[attackerUid];
        if (!Array.isArray(list)) fail("SCHEMA", "blocks values must be arrays");
        for (const blockerUid of list) {
          requireUid(state, blockerUid);
          if (used[blockerUid]) fail("CANNOT_BLOCK", "a blocker may block one attacker");
          used[blockerUid] = true;
          if (state.objects[blockerUid].controller !== action.seat) fail("NOT_CONTROLLER", blockerUid);
          if (zoneName(state.objects[blockerUid].zone) !== "network") fail("NOT_IN_ZONE", blockerUid);
          if (!canBlock(env, blockerUid, attackerUid)) fail("CANNOT_BLOCK", `${blockerUid} cannot block that attacker`);
        }
        if (list.length) {
          state.clash.blocks[attackerUid] = list.slice();
          // §13.2 once blocked, an attacker stays blocked for the rest of
          // Clash even if every blocker leaves combat.
          if (state.clash.blockedOnce.indexOf(attackerUid) < 0) {
            state.clash.blockedOnce.push(attackerUid);
          }
        }
      }
      state.awaiting = null;
      emit(env, "BLOCKERS", { seat: action.seat, blocks: cloneJson(state.clash.blocks) });
    },

    ORDER_BLOCKERS(env, payload, action) {
      const state = env.state;
      requireAwaiting(env, "order", action.seat);
      const order = payload.order || {};
      for (const attackerUid of Object.keys(order)) {
        const declared = state.clash.blocks[attackerUid] || [];
        const given = order[attackerUid];
        if (!Array.isArray(given) || given.length !== declared.length) {
          fail("SCHEMA", "an ordering must list every blocker exactly once");
        }
        for (const uid of declared) {
          if (given.indexOf(uid) < 0) fail("SCHEMA", `${uid} missing from the ordering`);
        }
        state.clash.order[attackerUid] = given.slice();
      }
      state.awaiting = null;
      emit(env, "ORDER", { seat: action.seat, order: cloneJson(state.clash.order) });
    },

    ASSIGN_COMBAT_DAMAGE(env, payload, action) {
      const state = env.state;
      const awaiting = requireAwaiting(env, "damage", action.seat);
      const firstStrike = Boolean(awaiting.firstStrike);
      const canonical = canonicalAssignment(env, firstStrike);
      const assignment = payload.assignment === undefined || payload.assignment === null
        ? canonical
        : payload.assignment;
      if (assignment !== canonical) verifyAssignment(env, assignment, firstStrike);
      state.awaiting = null;
      state.clash.assignment = cloneJson(assignment);
      applyCombatDamage(env, assignment, firstStrike);
    },

    /* The single answering action for every prompt. The engine holds no
     * callbacks: the parked Queue item carries resume:{opIndex, acc} and the
     * interpreter re-enters where it paused. Continuations became state. */
    CHOOSE(env, payload, action) {
      const state = env.state;
      const pending = state.pendingChoice;
      if (!pending) fail("NO_PENDING_CHOICE", "nothing to choose");
      // A stale answer from a laggy peer can never resolve the wrong prompt.
      if (pending.id !== payload.choiceId) fail("BAD_CHOICE", "that prompt is no longer open");
      if (pending.seat !== action.seat) fail("NOT_YOUR_SEAT", "not your choice");
      const selection = payload.selection;
      if (!Array.isArray(selection)) fail("BAD_CHOICE", "selection must be an array");
      if (selection.length < pending.min || selection.length > pending.max) {
        fail("BAD_CHOICE", `choose between ${pending.min} and ${pending.max}`);
      }
      const picks = selection.map((index) => {
        if (!Number.isInteger(index) || index < 0 || index >= pending.options.length) {
          fail("BAD_CHOICE", "selection out of range");
        }
        return pending.options[index];
      });
      const item = state.queue.find((q) => q.qid === pending.forQid);
      state.pendingChoice = null;
      if (item) {
        item.resume.acc[pending.slot] = picks.length === 1 && picks[0].symbol ? picks[0].symbol : picks;
        const outcome = runFrame(env, item);
        if (outcome === "done") {
          const index = state.queue.indexOf(item);
          state.queue.splice(index, 1);
          finishResolvedItem(env, item);
        }
      }
      emit(env, "CHOSE", { seat: action.seat, choiceId: pending.id, count: picks.length });
      state.priority.seat = state.turn.active;
      state.priority.passed = [false, false];
    },

    ORDER_TRIGGERS(env, payload, action) {
      const state = env.state;
      requireAwaiting(env, "triggers", action.seat);
      const waiting = state.pendingTriggers[String(action.seat)];
      const qids = payload.qids || [];
      if (qids.length !== waiting.length) fail("SCHEMA", "list every waiting trigger once");
      const ordered = [];
      for (const qid of qids) {
        const trigger = waiting.find((t) => t.pendingId === qid);
        if (!trigger || ordered.indexOf(trigger) >= 0) fail("SCHEMA", `unknown trigger ${qid}`);
        ordered.push(trigger);
      }
      state.pendingTriggers[String(action.seat)] = [];
      for (const trigger of ordered) pushQueue(env, trigger);
      state.awaiting = null;
      emit(env, "TRIGGERS_ORDERED", { seat: action.seat, count: ordered.length });
    },

    DISCARD_TO_LIMIT(env, payload, action) {
      const state = env.state;
      requireAwaiting(env, "discard", action.seat);
      const wallet = zoneArray(state, zoneKey(action.seat, "wallet"));
      const uids = payload.uids || [];
      if (wallet.length - uids.length !== state.handLimit) {
        fail("HAND_LIMIT", `discard exactly ${wallet.length - state.handLimit}`);
      }
      for (const uid of uids) {
        requireUid(state, uid);
        if (state.objects[uid].zone !== zoneKey(action.seat, "wallet")) fail("NOT_IN_ZONE", uid);
      }
      for (const uid of uids) {
        emit(env, "DISCARDED", { seat: action.seat, uid, cardId: state.objects[uid].cardId });
        moveUid(env, uid, "archive");
      }
      state.awaiting = null;
      runCleanup(env);
    },

    /* §18.3, and the end-of-match deck reveal that makes the log verifiable. */
    REVEAL(env, payload, action) {
      const state = env.state;
      const to = Array.isArray(payload.to) ? payload.to : [0, 1];
      for (const uid of payload.uids || []) {
        const object = requireUid(state, uid);
        if (object.owner !== action.seat && state.status !== "over") {
          fail("NOT_CONTROLLER", "you may only reveal your own cards");
        }
        object.revealedTo = Array.from(new Set(object.revealedTo.concat(to))).sort();
        object.revealedUntil = { turn: state.turn.number, phase: state.turn.phase };
      }
      emit(env, "REVEAL", { seat: action.seat, uids: payload.uids || [], to });
    },

    MANUAL_PROPOSE(env, payload, action) {
      const state = env.state;
      if (state.pendingManual) fail("MANUAL_CONSENT_PENDING", "a proposal is already awaiting a verdict");
      const warrant = payload.warrant || {};
      const ops = payload.ops || [];
      validateManualOps(ops);

      let envelope = null;
      let sourceUid = null;
      let cardText = "";
      if (warrant.kind === "freeform") {
        if (state.policy.freeform === "deny") fail("MANUAL_FREEFORM_DISABLED", "free-form edits are off");
        if (!payload.reason) fail("SCHEMA", "a free-form proposal needs a reason");
        cardText = String(warrant.note || payload.reason);
        state.seats[action.seat].stats.manualFreeform += 1;
      } else if (warrant.kind === "open") {
        const entry = state.manualOpen.find((e) => e.mid === warrant.mid);
        if (!entry) fail("MANUAL_NO_WARRANT", "no such announced ability");
        if (entry.seat !== action.seat) fail("MANUAL_NO_WARRANT", "not your announced ability");
        sourceUid = entry.warrant.uid;
        const card = cardOf(env.ctx, entry.cardId);
        const ability = card.abilities[entry.warrant.abilityIndex];
        envelope = ability ? ability.manualEnvelope : deriveEnvelope(entry.cardText, card);
        cardText = entry.cardText;
      } else if (warrant.kind === "static" || warrant.kind === "trigger") {
        const object = requireUid(state, warrant.uid);
        if (object.controller !== action.seat) fail("MANUAL_NO_WARRANT", "you do not control that object");
        const card = cardOf(env.ctx, object.cardId);
        const ability = card.abilities[warrant.abilityIndex];
        if (!ability || !ability.manual) fail("MANUAL_NO_WARRANT", "that ability is not assisted");
        envelope = ability.manualEnvelope;
        sourceUid = warrant.uid;
        cardText = ability.text;
      } else if (warrant.kind === "queue") {
        const item = state.queue.find((q) => q.qid === warrant.qid);
        if (!item) fail("MANUAL_NO_WARRANT", "no such queue item");
        if (item.controller !== action.seat) fail("MANUAL_NO_WARRANT", "not your queue item");
        const card = cardOf(env.ctx, item.cardId);
        envelope = deriveEnvelope(card.text, card);
        sourceUid = item.sourceUid;
        cardText = card.text;
      } else {
        fail("MANUAL_NO_WARRANT", "a proposal needs a warrant");
      }

      checkEnvelope(env, action.seat, envelope, ops);   // layer 2, before the opponent sees it
      checkReferences(env, action.seat, ops);            // layer 4, against the proposer's own view
      const tier = tierOf(state, action.seat, ops);      // layer 3, computed by the engine
      state.seats[action.seat].stats.manualProposed += 1;

      const proposal = {
        mid: "m" + state.nextMid,
        seat: action.seat,
        tier,
        warrant,
        cardText,
        sourceUid,
        ops,
        reason: payload.reason ? String(payload.reason) : null,
        proposedSeq: state.seq,
      };
      state.nextMid += 1;

      if (tier === "A") {
        // Self-limiting: applies immediately, logged, visible, attributed.
        // With 234/302 abilities assisted, an ack for every self-targeted cost
        // would make the game unplayable. The mitigation is MANUAL_FLAG.
        emit(env, "MANUAL_PROPOSED", { mid: proposal.mid, seat: action.seat, tier, cardText, ops });
        runManualDelta(env, proposal);
        if (warrant.kind === "open") closeManualOpen(state, warrant.mid, "resolved");
        return;
      }
      if (state.policy.manualBudget !== null) {
        if (state.manualBudgetUsed[action.seat] >= state.policy.manualBudget) {
          fail("MANUAL_BUDGET", "Tier-B proposal budget spent for this turn");
        }
        state.manualBudgetUsed[action.seat] += 1;
      }
      state.pendingManual = proposal;
      state.priority.seat = null;
      emit(env, "MANUAL_PROPOSED", { mid: proposal.mid, seat: action.seat, tier, cardText, ops });
    },

    MANUAL_ACCEPT(env, payload, action) {
      const state = env.state;
      const proposal = state.pendingManual;
      if (!proposal || proposal.mid !== payload.mid) fail("NO_PENDING_CHOICE", "no such proposal");
      if (action.seat === proposal.seat) fail("NOT_YOUR_SEAT", "the opponent decides");
      state.pendingManual = null;
      state.seats[action.seat].stats.manualAccepted += 1;
      emit(env, "MANUAL_ACCEPTED", { mid: proposal.mid, seat: action.seat });
      runManualDelta(env, proposal);
      if (proposal.warrant.kind === "open") closeManualOpen(state, proposal.warrant.mid, "resolved");
    },

    /* §9.3 reject => fizzle. §11.2 already prescribes this outcome for an item
     * that cannot do what it says, so a bad-faith rejecter cannot freeze the
     * game — they can only make a card fizzle, which is loud, logged and
     * rate-measurable through seats[].stats.manualRejected. */
    MANUAL_REJECT(env, payload, action) {
      const state = env.state;
      const proposal = state.pendingManual;
      if (!proposal || proposal.mid !== payload.mid) fail("NO_PENDING_CHOICE", "no such proposal");
      if (action.seat === proposal.seat) fail("NOT_YOUR_SEAT", "the opponent decides");
      state.pendingManual = null;
      state.seats[action.seat].stats.manualRejected += 1;
      if (proposal.warrant.kind === "queue") {
        const index = state.queue.findIndex((q) => q.qid === proposal.warrant.qid);
        if (index >= 0) invalidateQueueItem(env, index, "manual proposal rejected");
      }
      if (proposal.warrant.kind === "open") closeManualOpen(state, proposal.warrant.mid, "fizzled");
      emit(env, "MANUAL_REJECTED", {
        mid: proposal.mid,
        seat: action.seat,
        proposer: proposal.seat,
        reason: payload.reason ? String(payload.reason) : null,
        cardText: proposal.cardText,
      });
    },

    MANUAL_WITHDRAW(env, payload, action) {
      const state = env.state;
      const proposal = state.pendingManual;
      if (!proposal || proposal.mid !== payload.mid) fail("NO_PENDING_CHOICE", "no such proposal");
      if (action.seat !== proposal.seat) fail("NOT_YOUR_SEAT", "only the proposer may withdraw");
      state.pendingManual = null;
      emit(env, "MANUAL_WITHDRAWN", { mid: proposal.mid, seat: action.seat });
    },

    /* Closes an announced ability with no delta: "it did nothing / we handled
     * it". The referee does not rule on the card's meaning; it rules that
     * somebody closed the record. */
    MANUAL_RESOLVE(env, payload, action) {
      const state = env.state;
      const entry = state.manualOpen.find((e) => e.mid === payload.mid);
      if (!entry) fail("NO_PENDING_CHOICE", "no such announced ability");
      if (entry.seat !== action.seat) fail("NOT_YOUR_SEAT", "not your announced ability");
      closeManualOpen(state, payload.mid, "resolved");
      emit(env, "MANUAL_RESOLVED", { mid: payload.mid, seat: action.seat });
    },

    /* Changes nothing mechanically and cannot be refused. A permanent,
     * hash-chained complaint — the thing that makes Tier A tolerable. */
    MANUAL_FLAG(env, payload, action) {
      emit(env, "MANUAL_FLAGGED", {
        mid: payload.mid,
        seat: action.seat,
        reason: String(payload.reason || ""),
      });
    },

    SEED_COMMIT(env, payload, action) {
      env.state.seats[action.seat].seedCommit = String(payload.commit);
      emit(env, "SEED_COMMIT", { seat: action.seat });
    },

    SEED_REVEAL(env, payload, action) {
      const state = env.state;
      const player = state.seats[action.seat];
      const expected = "sha256:" + sha256hex(String(payload.r) + String(payload.salt));
      if (player.seedCommit && player.seedCommit !== expected) fail("SCHEMA", "reveal does not match commitment");
      player.seedReveal = { r: payload.r, salt: String(payload.salt) };
      emit(env, "SEED_REVEAL", { seat: action.seat });
      const both = state.seats[0].seedReveal && state.seats[1].seedReveal;
      if (both) {
        const combined = (state.seats[0].seedReveal.r ^ state.seats[1].seedReveal.r) >>> 0;
        state.rng.public = newStream(combined | 0);
        state.turn.firstPlayer = combined & 1; // §8.3
        state.turn.active = state.turn.firstPlayer;
        emit(env, "SEED_SETTLED", { firstPlayer: state.turn.firstPlayer });
      }
    },
  };

  function finishResolvedItem(env, item) {
    const card = item.cardId ? cardOf(env.ctx, item.cardId) : null;
    if (item.kind === "card" && item.objectUid && env.state.objects[item.objectUid]) {
      if (card.isPermanent) {
        const record = moveUid(env, item.objectUid, "network", { seat: item.controller });
        emit(env, "ENTERS", { uid: record.uid, cardId: item.cardId, seat: item.controller });
        announceManual(env, item, record.uid);
      } else {
        const record = moveUid(env, item.objectUid, "archive");
        emit(env, "ARCHIVED", { uid: record.uid, cardId: item.cardId, reason: "resolved" });
        announceManual(env, item, record.uid);
      }
    }
  }

  /* An X in the printed cost ("XB") charges X generic per X symbol, at the
   * value the player announced. Without this, X cards silently played for
   * their colored part alone — free damage is not a rules profile. */
  function costWithX(cost, x) {
    if (!cost || !cost.x) return cost;
    const announced = Number.isInteger(x) && x >= 0 ? x : 0;
    const effective = Object.assign({}, cost);
    effective.generic = (effective.generic || 0) + announced * cost.x;
    delete effective.x;
    return effective;
  }

  function settleCost(env, seat, cost, payment) {
    const buffer = env.state.seats[seat].buffer;
    if (!cost) return emptyBuffer();
    if (!canPay(buffer, cost)) fail("CANNOT_AFFORD", "not enough Resources in the Buffer");
    const settled = payment ? verifyPayment(buffer, cost, payment) : autoPayment(buffer, cost);
    spendBuffer(seat, buffer, settled);
    emit(env, "PAID", { seat, payment: settled, auto: !payment });
    return settled;
  }

  function payAbilityCost(env, seat, object, ability, payment) {
    if (ability.commit) {
      // §19.4 an ability with Commit is usable once per Unlock.
      if (object.committed) fail("CANNOT_AFFORD", "that object is already committed");
      if (object.bootDelay) fail("CANNOT_AFFORD", "Boot Delay: it cannot pay a Commit cost yet");
    }
    const settled = settleCost(env, seat, ability.costParsed, payment);
    if (ability.commit) {
      object.committed = true;
      const card = cardOf(env.ctx, object.cardId);
      raiseTriggers(env, "committed", {
        uid: object.uid,
        seat: object.controller,
        type: card.type,
        affinity: card.affinity,
      });
    }
    if (ability.archiveSelf) moveUid(env, object.uid, "archive");
    return settled;
  }

  function verifyAssignment(env, assignment, firstStrike) {
    const state = env.state;
    for (const attackerUid of Object.keys(assignment)) {
      if (state.clash.attackers.indexOf(attackerUid) < 0) fail("BAD_DAMAGE_ASSIGNMENT", "not an attacker");
      if (!dealsInStep(env, attackerUid, firstStrike)) fail("BAD_DAMAGE_ASSIGNMENT", "wrong damage step");
      const rows = assignment[attackerUid];
      if (!Array.isArray(rows)) fail("SCHEMA", "assignment rows must be an array");
      const power = statsOf(state, env.ctx, attackerUid).action;
      let total = 0;
      for (const row of rows) {
        if (!Number.isInteger(row.amount) || row.amount < 0) fail("SCHEMA", "bad damage amount");
        total += row.amount;
      }
      if (total > power) fail("BAD_DAMAGE_ASSIGNMENT", "more damage assigned than Action");
      const order = state.clash.order[attackerUid] || [];
      const given = Object.create(null);
      for (const row of rows) given[row.to] = (given[row.to] || 0) + row.amount;
      let mustBeLethal = true;
      for (const blockerUid of order) {
        const blocker = state.objects[blockerUid];
        if (!blocker) continue;
        const lethal = Math.max(0, statsOf(state, env.ctx, blockerUid).resilience - blocker.damage);
        const dealt = given[blockerUid] || 0;
        // §13.3 at least lethal to each earlier blocker before the next.
        if (!mustBeLethal && dealt > 0) fail("BAD_DAMAGE_ASSIGNMENT", "blocker order violated");
        if (dealt < lethal) mustBeLethal = false;
      }
      for (const key of Object.keys(given)) {
        if (typeof key === "string" && key.indexOf("seat:") === 0) {
          if (!hasKeywordUid(state, env.ctx, attackerUid, "Overflow")) {
            if (state.clash.blockedOnce.indexOf(attackerUid) >= 0) {
              fail("BAD_DAMAGE_ASSIGNMENT", "only Overflow may hit the player through blockers");
            }
          } else if (!mustBeLethal) {
            fail("BAD_DAMAGE_ASSIGNMENT", "assign lethal to every blocker before Overflow");
          }
        } else if (order.indexOf(key) < 0 && (state.clash.blocks[attackerUid] || []).indexOf(key) < 0) {
          fail("BAD_DAMAGE_ASSIGNMENT", "that object is not blocking this attacker");
        }
      }
    }
  }
  // ------------------------------------------------------------ apply()

  const hashState = (state) => sha256hex(canonicalJSON(state));

  /* Every action, same order, no exceptions (§6.1). */
  function apply(state, action, ctx) {
    let context;
    try {
      context = resolveCtx(ctx);
    } catch (error) {
      return { state, events: [], error: errorValue(error) };
    }
    try {
      if (!state || typeof state !== "object") fail("SCHEMA", "state must be an object");
      // Views are tagged. One flag prevents the whole class of "the client
      // accidentally advanced its own game" bugs.
      if (state.redacted) fail("REDACTED_STATE", "apply() refuses a redacted state");
      if (state.catalogDigest !== context.catalog.digest) {
        fail("CATALOG_MISMATCH", "this catalog is not the one the game started with");
      }

      const payload = validateSchema(action); // 2. strict schema whitelist

      // 1. game over
      if (state.result && POST_GAME.indexOf(action.type) < 0) fail("GAME_OVER", "the game is over");
      if (state.status === "paused" && POST_GAME.indexOf(action.type) < 0) {
        fail("GAME_PAUSED", "the game is paused");
      }
      // 3. optimistic concurrency: kills duplicate submission, double-click
      //    races and replay attacks in one field.
      if (action.seq !== state.seq) fail("SEQ_MISMATCH", `expected seq ${state.seq}, got ${action.seq}`);
      // 4. action.seat is a CLAIM, not a credential.
      if (context.authenticatedSeat !== null && context.authenticatedSeat !== action.seat) {
        fail("NOT_YOUR_SEAT", "authenticated seat does not match the claim");
      }
      if (state.pendingManual && DURING_CONSENT.indexOf(action.type) < 0) {
        fail("MANUAL_CONSENT_PENDING", "a manual proposal is awaiting a verdict");
      }
      if (state.pendingChoice && ["CHOOSE", "CONCEDE", "MANUAL_FLAG"].indexOf(action.type) < 0) {
        fail("NO_PENDING_CHOICE", "answer the open prompt first");
      }

      const draft = cloneJson(state); // 7. mutate a draft, never the input
      const env = { state: draft, ctx: context, events: [] };
      const before = draft.priority.passed.slice();

      HANDLERS[action.type](env, payload, action); // 5, 6, 7

      // Any non-PASS action resets the pass count (§10.1: both players get
      // another chance to respond before the top item resolves).
      if (action.type !== "PASS_PRIORITY" && draft.priority.passed.join() === before.join()) {
        draft.priority.passed = [false, false];
      }

      stateChecks(env);              // 8. to fixpoint
      collectTriggers(env);          // 9. non-active player's triggers on top
      recomputeResult(env);          // 11. including the simultaneous-loss draw
      if (!draft.result && !draft.pendingChoice && !draft.pendingManual && !draft.awaiting) {
        if (draft.priority.seat === null) advanceUntilPriority(env); // 12.
        else applyAutoPass(env);
      }

      draft.prevHash = "sha256:" + hashState(state); // 13. chain anchor
      draft.seq = state.seq + 1;
      for (const event of env.events) event.seq = draft.seq;
      return { state: draft, events: env.events, error: null };
    } catch (error) {
      // A referee that throws on a crafted payload is a denial of service.
      const value = errorValue(error);
      if (state && state.seats && action && (action.seat === 0 || action.seat === 1)) {
        // Counting rejections must not mutate the caller's state, so it is
        // reported in the error rather than written. The host may fold it in.
        value.detail = Object.assign({ seat: action.seat }, value.detail || {});
      }
      return { state, events: [], error: value };
    }
  }

  function errorValue(error) {
    if (error instanceof RulesError) {
      return { code: error.code, message: error.message, detail: error.detail };
    }
    return { code: "ENGINE_PANIC", message: String((error && error.message) || error), detail: null };
  }

  function applyMany(state, actions, ctx) {
    let current = state;
    const events = [];
    for (let i = 0; i < actions.length; i++) {
      const result = apply(current, actions[i], ctx);
      if (result.error) return { state: current, events, error: result.error, failedAt: i };
      current = result.state;
      for (const event of result.events) events.push(event);
    }
    return { state: current, events, error: null, failedAt: null };
  }

  const replay = (config, log, ctx) => applyMany(createGame(config, ctx), log || [], ctx);

  /* Append-only, hash-chained, held by the host outside the state. `prev` stops
   * a peer quietly rewriting turn 2 after turn 7; `stateHash` stops a peer
   * claiming a different outcome from the same actions. The engine STORES
   * signatures and never verifies them — verification is transport's job. */
  const entryHash = (entry) =>
    sha256hex(
      canonicalJSON({
        seq: entry.seq,
        seat: entry.seat,
        at: entry.at || "",
        action: entry.action,
        prev: entry.prev,
        stateHash: entry.stateHash,
      })
    );

  function verifyMatch(bundle, ctx) {
    const config = bundle.config;
    const log = bundle.log || [];
    let state;
    try {
      state = createGame(config, ctx);
    } catch (error) {
      return { ok: false, result: null, headHash: null, divergedAt: -1, error: errorValue(error) };
    }
    let prev = state.gameId;
    for (let i = 0; i < log.length; i++) {
      const entry = log[i];
      const result = apply(state, entry.action, ctx);
      if (result.error) {
        return { ok: false, result: state.result, headHash: hashState(state), divergedAt: i, error: result.error };
      }
      state = result.state;
      const stateHash = hashState(state);
      if (entry.stateHash && entry.stateHash !== stateHash) {
        return { ok: false, result: state.result, headHash: stateHash, divergedAt: i, error: { code: "SEQ_MISMATCH", message: "state hash mismatch", detail: null } };
      }
      if (entry.prev && entry.prev !== prev) {
        return { ok: false, result: state.result, headHash: stateHash, divergedAt: i, error: { code: "SEQ_MISMATCH", message: "chain break", detail: null } };
      }
      prev = entryHash({ seq: entry.seq, seat: entry.seat, at: entry.at, action: entry.action, prev, stateHash });
    }
    return { ok: true, result: state.result, headHash: hashState(state), divergedAt: null, error: null };
  }

  // -------------------------------------------------------------- view.js

  /* Built BY CONSTRUCTION from an allowlist. There is no `delete` here, no
   * spread of a state object and no Object.assign from state: a deletion-based
   * redactor fails SILENTLY the day someone adds a field, and that failure is a
   * permanent information leak. If a new state field is forgotten here it is
   * simply absent from the view — a broken UI, which is loud. */
  const PUBLIC_ZONES = ["network", "archive", "cold", "stake", "queue"];

  function publicObjectRecord(object) {
    return {
      uid: object.uid,
      cardId: object.cardId,
      owner: object.owner,
      controller: object.controller,
      zone: object.zone,
      committed: object.committed,
      bootDelay: object.bootDelay,
      damage: object.damage,
      counters: cloneJson(object.counters),
      attachedTo: object.attachedTo,
      rebootShields: object.rebootShields,
      facedown: object.facedown,
      revealedTo: object.revealedTo.slice(),
      revealedUntil: object.revealedUntil ? cloneJson(object.revealedUntil) : null,
      token: object.token,
      entersSeq: object.entersSeq,
      // prevUid is deliberately absent: §6.1 provenance is audit-only.
    };
  }

  const shellRecord = (object) => ({ uid: object.uid, owner: object.owner, zone: object.zone });

  const seatView = (player) => ({
    name: player.name,
    pubkey: player.pubkey,
    uptime: player.uptime,
    buffer: cloneJson(player.buffer),
    deckCommit: player.deckCommit,
    conceded: player.conceded,
    deckedOut: player.deckedOut,
    counters: cloneJson(player.counters),
    autoPass: cloneJson(player.autoPass),
    // Public on purpose: reject rates and envelope violations are social
    // anti-cheat pressure, visible mid-game and to matchmaking afterwards.
    stats: cloneJson(player.stats),
  });

  function view(state, seat) {
    if (state && state.redacted) {
      // Idempotence: view(view(s,n),n) deep-equals view(s,n), so a view is
      // valid input to every read-only helper and legalActions runs
      // client-side on exactly the code path the server uses.
      if (state.forSeat === seat) return cloneJson(state);
      fail("REDACTED_STATE", "cannot re-redact a view for a different seat");
    }
    if (seat === "audit") return cloneJson(state);
    const spectator = seat === null || seat === undefined;

    const out = {
      redacted: true,
      forSeat: spectator ? null : seat,
      v: state.v,
      gameId: state.gameId,
      ruleset: state.ruleset,
      catalogDigest: state.catalogDigest,
      modules: cloneJson(state.modules),
      policy: cloneJson(state.policy),
      seq: state.seq,
      prevHash: state.prevHash,
      status: state.status,
      result: state.result ? cloneJson(state.result) : null,
      seats: [seatView(state.seats[0]), seatView(state.seats[1])],
      handLimit: state.handLimit,
      objects: {},
      zones: {},
      zoneCounts: {},
      queue: [],
      turn: cloneJson(state.turn),
      priority: cloneJson(state.priority),
      clash: cloneJson(state.clash),
      awaiting: state.awaiting ? cloneJson(state.awaiting) : null,
      pendingChoice: null,
      pendingTriggers: {
        0: state.pendingTriggers["0"].length,
        1: state.pendingTriggers["1"].length,
      },
      /* A seat must be able to FORM the ORDER_TRIGGERS action it is REQUIRED to
       * submit when awaiting.kind === "triggers", and that action must list every
       * waiting pendingId (ORDER_TRIGGERS: "list every waiting trigger once").
       * The counts above cannot express it, so a networked seat holding only a
       * view could not take an action the rules oblige it to take. Own seat only:
       * the opponent and a spectator still see counts alone. */
      myTriggers: spectator
        ? []
        : state.pendingTriggers[String(seat)].map((t) => ({
            pendingId: t.pendingId,
            cardId: t.cardId,
          })),
      // Consent is meaningless unless both seats see the whole proposal.
      pendingManual: state.pendingManual ? cloneJson(state.pendingManual) : null,
      manualOpen: cloneJson(state.manualOpen),
      effects: cloneJson(state.effects),
      rng: {
        /* NO SEED, PUBLIC OR HIDDEN, EVER LEAVES. Only the draw counters do,
         * which prove the referee performed exactly the number of draws the log
         * accounts for. The public seed used to ship whole for §18.4 audit, but
         * under a referee that is a live oracle: a seat that knows the public
         * seed can test candidate hidden seeds against gameId and deckCommit,
         * and under PIN_SEED it derived them outright. Verification does not
         * need it mid-match — the OVER bundle carries the full config and the
         * transcript, which is where E.verifyMatch belongs. */
        public: { alg: state.rng.public.alg, n: state.rng.public.n },
        hidden: state.rng.hidden.map((stream) => ({ alg: stream.alg, n: stream.n })),
      },
    };

    for (const key of Object.keys(state.zones)) {
      const zone = zoneName(key);
      const owner = zoneSeat(key);
      const list = state.zones[key];
      out.zoneCounts[key] = list.length;

      if (PUBLIC_ZONES.indexOf(zone) >= 0) {
        out.zones[key] = list.slice();
        for (const uid of list) {
          const object = state.objects[uid];
          if (zone === "cold" && object.facedown && !spectator && object.owner !== seat) {
            out.objects[uid] = shellRecord(object);
          } else {
            out.objects[uid] = publicObjectRecord(object);
          }
        }
        continue;
      }
      if (zone === "wallet") {
        if (!spectator && owner === seat) {
          out.zones[key] = list.slice();
          for (const uid of list) out.objects[uid] = publicObjectRecord(state.objects[uid]);
        } else if (!spectator) {
          // The opponent's Wallet is an ordered array of SHELLS. Required, not
          // optional: §18.4 demands that a random choice log its eligible set,
          // and the eligible set for a random discard IS this uid list.
          out.zones[key] = list.slice();
          for (const uid of list) out.objects[uid] = shellRecord(state.objects[uid]);
        } else {
          out.zones[key] = { n: list.length };
        }
        continue;
      }
      // §6 the Stack is Hidden, full stop — including from its own owner. A
      // count object cannot be accidentally indexed, mapped, or fed to code
      // that assumes a uid.
      out.zones[key] = { n: list.length };
    }

    // Revealed cards (§18.3) are surfaced wherever they sit.
    for (const uid of Object.keys(state.objects)) {
      const object = state.objects[uid];
      if (!spectator && object.revealedTo.indexOf(seat) >= 0) {
        out.objects[uid] = publicObjectRecord(object);
      }
    }

    for (const item of state.queue) {
      out.queue.push({
        qid: item.qid,
        kind: item.kind,
        controller: item.controller,
        objectUid: item.objectUid,
        cardId: item.cardId,
        sourceUid: item.sourceUid,
        abilityIndex: item.abilityIndex,
        targets: cloneJson(item.targets), // §11.2 targets are announced
        modes: cloneJson(item.modes),
        x: item.x,
        paid: cloneJson(item.paid),
        manual: item.manual ? cloneJson(item.manual) : null,
        addedSeq: item.addedSeq,
      });
    }

    if (state.pendingChoice) {
      out.pendingChoice =
        !spectator && state.pendingChoice.seat === seat
          ? cloneJson(state.pendingChoice)
          : { seat: state.pendingChoice.seat, kind: state.pendingChoice.kind, id: state.pendingChoice.id };
    }
    return out;
  }

  /* The INTERSECTION of view(s,0) and view(s,1): shared reality only. Under
   * split hidden streams the two peers hold legitimately different full states,
   * so hashState() correctly differs and cannot be compared — publicHash()
   * compares what both must agree on and localises divergence to the exact
   * action that caused it. */
  function publicState(state) {
    const spectator = view(state, null);
    const out = {};
    for (const key of Object.keys(spectator).sort()) {
      if (key === "redacted" || key === "forSeat") continue;
      out[key] = spectator[key];
    }
    return out;
  }

  const publicHash = (state) => sha256hex(canonicalJSON(publicState(state)));

  // -------------------------------------------------------- legalActions()

  /* Computed from the REDACTED state when served to a client: the COUNT of
   * legal actions discloses the contents of a hidden hand. */
  function legalActions(source, seat) {
    const state = source;
    const out = [];
    const push = (type, payload) => out.push({ type, seat, seq: state.seq, payload: payload || {} });
    if (!state || state.result) {
      if (state && !state.result) return out;
      return out;
    }
    if (state.pendingManual) {
      if (state.pendingManual.seat !== seat) {
        push("MANUAL_ACCEPT", { mid: state.pendingManual.mid });
        push("MANUAL_REJECT", { mid: state.pendingManual.mid });
      } else {
        push("MANUAL_WITHDRAW", { mid: state.pendingManual.mid });
      }
      push("CONCEDE");
      return out;
    }
    if (state.pendingChoice && state.pendingChoice.seat === seat && state.pendingChoice.options) {
      push("CHOOSE", { choiceId: state.pendingChoice.id, selection: [] });
      push("CONCEDE");
      return out;
    }
    push("CONCEDE");
    for (const entry of state.manualOpen || []) {
      if (entry.seat === seat) push("MANUAL_RESOLVE", { mid: entry.mid });
    }

    const awaiting = state.awaiting;
    if (awaiting && awaiting.seat === seat) {
      if (awaiting.kind === "attackers") push("DECLARE_ATTACKERS", { attackers: [] });
      if (awaiting.kind === "blockers") push("DECLARE_BLOCKERS", { blocks: {} });
      if (awaiting.kind === "order") push("ORDER_BLOCKERS", { order: {} });
      if (awaiting.kind === "damage") push("ASSIGN_COMBAT_DAMAGE", { assignment: null });
      if (awaiting.kind === "discard") push("DISCARD_TO_LIMIT", { uids: [] });
      if (awaiting.kind === "triggers") push("ORDER_TRIGGERS", { qids: [] });
      return out;
    }
    if (state.priority.seat !== seat) return out;
    push("PASS_PRIORITY");

    const wallet = state.zones[zoneKey(seat, "wallet")];
    const network = state.zones[zoneKey(seat, "network")];
    if (Array.isArray(wallet)) {
      for (const uid of wallet) {
        const object = state.objects[uid];
        if (!object || !object.cardId) continue;
        push("PLAY_CARD", { uid });
        if (state.turn.active === seat && state.turn.resourcePlays.used < state.turn.resourcePlays.allowed) {
          push("PLAY_RESOURCE", { uid });
        }
      }
    }
    if (Array.isArray(network)) {
      for (const uid of network) {
        const object = state.objects[uid];
        if (!object || !object.cardId) continue;
        push("ACTIVATE_ABILITY", { uid, abilityIndex: 0 });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- exports

  const create = () =>
    Object.freeze({
      createGame,
      apply,
      applyMany,
      replay,
      view,
      publicState,
      publicHash,
      hashState,
      legalActions,
      canonicalJSON,
      redactEvents,
      verifyMatch,
      entryHash,
      setCatalog,
      buildCatalog,
    });

  return {
    create,
    createGame,
    apply,
    applyMany,
    replay,
    view,
    publicState,
    publicHash,
    hashState,
    legalActions,
    redactEvents,
    verifyMatch,
    entryHash,
    setCatalog,
    buildCatalog,
    compileCard,
    canonicalJSON,
    cloneJson,
    sha256hex,
    nextU32,
    nextInt,
    shuffleInPlace,
    newStream,
    statsOf,
    keywordsOf,
    shieldedFrom,
    canAttack,
    canBlock,
    canPay,
    autoPayment,
    verifyPayment,
    tierOf,
    deriveEnvelope,
    visibleUids,
    resolveCtx,
    RulesError,
    HARD_CAPS,
    MANUAL_OPS,
    ACTION_KEYS,
    TURN_RIBBON,
    PHASE_ORDER,
    PHASE_STEPS,
    SYMBOLS,
    BUFFER_KEYS,
    AFFINITY_SYMBOL,
    SYMBOL_AFFINITY,
    ZONE_NAMES,
    zoneKey,
    zoneName,
    zoneSeat,
  };
});
