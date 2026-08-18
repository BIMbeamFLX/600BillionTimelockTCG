/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — Table Transport v1. The referee server.
 *
 * One process, one port. It serves the static site AND the match socket, so
 * `node server/table.js` is the only thing started on demo day.
 *
 * The owner's binding split is honoured exactly:
 *   NOSTR  — invite/accept handshake and the signed win/loss result. Nothing else.
 *   SOCKET — every play, live, low latency.
 *   SQLITE — the match transcript, one row per action.
 * No move ever becomes a nostr event, and THIS PROCESS NEVER OPENS A RELAY
 * CONNECTION. Only browsers talk to relays, so relay flakiness cannot reach the
 * referee.
 *
 * The server holds the only unredacted state and the only hidden seeds. Clients
 * receive E.view(state, seat) and E.redactEvents(events, seat) — real fog of
 * war, not UI-side hiding.
 *
 * ZERO RULES CODE LIVES HERE. Every client action is one E.apply() and one
 * transaction; every rejection is the engine's own error code, verbatim.
 *
 * Protocol: docs/net-protocol.md (normative).
 * ------------------------------------------------------------------------- */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { DatabaseSync } = require("node:sqlite");
const { WebSocketServer } = require("ws");
const { schnorr } = require("@noble/curves/secp256k1");

const REPO = path.resolve(__dirname, "..");
const E = require(path.join(REPO, "site", "engine.js"));
const CARDS = require(path.join(REPO, "site", "play-data.js"));

const CATALOG = E.setCatalog(CARDS);

// ------------------------------------------------------------------ constants

const WIRE = 1;
const HAND_AFFINITIES = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock"];
/* No 0/O/1/I: the code gets read aloud across a room. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EVENT_CAP = 240;
const EVENT_RING = 600; // unredacted ring; the tail of it is what a STATE ships
const PING_MS = 15000;
const RATE_WINDOW_MS = 10000;
/* Accepted actions only. 30/10 s was below what a human legitimately does while
 * picking targets or emptying a hand of Resources, and rejections were charged
 * to the same budget, so ordinary card clicks closed the socket. */
const RATE_MAX_ACT = 150;
/* Rejections get their own, much looser budget. This is not an anti-cheat
 * measure — it is the only thing that stops a scripted loop wedging the table,
 * and no human comes close to it. */
const RATE_MAX_REJECT = 400;
const RATE_MAX_CONTROL = 30;
const MAX_PAYLOAD = 64 * 1024;
const MINT_ATTEMPTS = 40;
const KIND_HANDSHAKE = 4600;
const KIND_RESULT = 31600;
const KIND_AUTH = 22242;
const AUTH_MAX_AGE_SECONDS = 10 * 60;

const nowIso = () => new Date().toISOString();
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const rand32 = () => crypto.randomInt(0, 2 ** 31 - 1);

/* A 31-bit seed derived from a label, matching rand32's range. Used only to
 * DECORRELATE the pinned demo seeds: hidden = [pin+1, pin+2] meant a seat that
 * learned the public seed knew both hidden ones by addition. */
const seedFrom = (label) =>
  crypto.createHash("sha256").update(String(label)).digest().readUInt32BE(0) >>> 1;

function makeCode() {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

const isHex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const isHex128 = (v) => typeof v === "string" && /^[0-9a-f]{128}$/.test(v);

function pruneAddressRates(rates, now, windowMs) {
  for (const [address, timestamps] of rates) {
    const active = timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (active.length) rates.set(address, active);
    else rates.delete(address);
  }
}

function hostnameFromHostHeader(header) {
  if (typeof header !== "string" || !header || header.includes("://")) return null;
  try {
    const parsed = new URL(`http://${header}`);
    if (
      parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch (err) {
    return null;
  }
}

// -------------------------------------------------------------------- schema

/* Inlined rather than a server/schema.sql: one fewer file to drift out of sync
 * with the code that reads it. */
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS matches (
  match_id        TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('open','playing','over')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  config_json     TEXT NOT NULL,
  ruleset         TEXT NOT NULL,
  catalog_digest  TEXT NOT NULL,
  state_json      TEXT,
  seat0_name      TEXT NOT NULL,
  seat0_affinity  TEXT NOT NULL,
  seat0_pubkey    TEXT,
  seat0_token     TEXT NOT NULL,
  seat1_name      TEXT,
  seat1_affinity  TEXT,
  seat1_pubkey    TEXT,
  seat1_token     TEXT,
  head_seq        INTEGER NOT NULL DEFAULT 0,
  head_hash       TEXT,
  public_hash     TEXT,
  transcript_hash TEXT,
  result_json     TEXT,
  verify_json     TEXT,
  ended_at        TEXT,
  -- The exact bytes both seats sign over nostr. Persisted (not just broadcast
  -- once in OVER) so the closing beat survives a reload, a reconnect and a
  -- referee restart.
  result_content    TEXT,
  result_tags_json  TEXT,
  result_created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_matches_open ON matches(status, created_at DESC);

CREATE TABLE IF NOT EXISTS entries (
  match_id    TEXT    NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  seat        INTEGER NOT NULL CHECK (seat IN (0,1)),
  at          TEXT    NOT NULL DEFAULT '',
  action_json TEXT    NOT NULL,
  prev        TEXT    NOT NULL,
  state_hash  TEXT    NOT NULL,
  hash        TEXT    NOT NULL,
  public_hash TEXT    NOT NULL,
  received_at TEXT    NOT NULL,
  PRIMARY KEY (match_id, seq)
);

CREATE TABLE IF NOT EXISTS rejects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    TEXT    NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  at          TEXT    NOT NULL,
  seat        INTEGER,
  head_seq    INTEGER NOT NULL,
  code        TEXT    NOT NULL,
  message     TEXT,
  action_json TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS nostr_events (
  match_id    TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('invite','accept','result')),
  pubkey      TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  kind        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  event_json  TEXT NOT NULL,
  content     TEXT NOT NULL,
  sig_checked INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  PRIMARY KEY (match_id, role, pubkey)
);
`;

// ------------------------------------------------------------------ the table

/**
 * Boot a referee. Returns once the socket is listening.
 * @param {{port?:number, dbPath?:string, siteDir?:string, host?:string,
 *   pinSeed?:number, maxPayload?:number, controlMax?:number,
 *   publicHost?:string, trustedHosts?:string[], allowedOrigins?:string[]}} opts
 */
async function createTable(opts) {
  const options = opts || {};
  const dbPath = options.dbPath || path.join(__dirname, "matches.db");
  const siteDir = options.siteDir || path.join(REPO, "site");
  const host = options.host || "0.0.0.0";
  const trustedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const addTrustedHost = (value) => {
    const hostname = hostnameFromHostHeader(value);
    if (!hostname) throw new Error(`invalid trusted host: ${value}`);
    trustedHosts.add(hostname);
  };
  if (host !== "0.0.0.0" && host !== "::") {
    addTrustedHost(host.includes(":") && !host.startsWith("[") ? `[${host}]` : host);
  }
  if (options.publicHost) addTrustedHost(options.publicHost);
  for (const value of Array.isArray(options.trustedHosts) ? options.trustedHosts : []) {
    addTrustedHost(value);
  }
  const requestHostAllowed = (req) => {
    const requestHostname = hostnameFromHostHeader(req.headers.host);
    return Boolean(requestHostname && trustedHosts.has(requestHostname));
  };
  const pinSeed = Number.isInteger(options.pinSeed) ? options.pinSeed : null;
  const maxPayload = Number.isInteger(options.maxPayload) && options.maxPayload > 0
    ? options.maxPayload
    : MAX_PAYLOAD;
  /* Two seat/gameplay budgets, and the split is the point: a human playing a card game is
   * REJECTED constantly (they click a card they cannot afford, in the wrong
   * phase, that is not a Resource) and must never be disconnected for it. The
   * action budget meters only what the engine accepted; the reject budget is a
   * runaway-loop guard and nothing else. Raised only by the headless tests,
   * which act at machine speed and are not the threat model. Control traffic
   * has the separate address-scoped budget below. */
  const rateMax = Number.isInteger(options.rateMax) ? options.rateMax : RATE_MAX_ACT;
  const rejectMax = Number.isInteger(options.rejectMax)
    ? options.rejectMax
    : Math.max(RATE_MAX_REJECT, rateMax);
  const controlMax = Number.isInteger(options.controlMax)
    ? options.controlMax
    : RATE_MAX_CONTROL;
  /* WHO IS BEHIND THE PROXY. The pre-auth rate buckets key on the TCP peer,
   * because a connection has not proved an identity yet. In the prescribed
   * deployment that peer is a reverse proxy on loopback, so every player shares
   * one pre-auth bucket and a burst of arrivals — a launch spike, a wifi-driven
   * reconnect storm — locks legitimate players out of the AUTH handshake before
   * they can identify. This restores a per-client bucket WITHOUT trusting
   * attacker-controlled headers: X-Forwarded-For is consulted ONLY when the real
   * TCP peer is an operator-declared trusted proxy, and then only its RIGHTMOST
   * hop — the address the trusted proxy itself observed, which a client cannot
   * forge by pre-injecting the header. Unset (the default) ignores XFF entirely.
   *   trustProxy: "loopback"  → trust 127.0.0.1/::1 as the proxy (the zapburg case)
   *   trustProxy: ["10.0.0.2"] → trust these exact peer IPs */
  const trustProxy = (() => {
    const raw = options.trustProxy;
    if (!raw) return { mode: "none", set: new Set() };
    if (Array.isArray(raw)) return { mode: "list", set: new Set(raw.map(String)) };
    const token = String(raw).trim().toLowerCase();
    if (token === "loopback" || token === "true" || token === "1" || token === "yes") {
      return { mode: "loopback", set: new Set() };
    }
    // A bare string may still be a comma-list of IPs.
    const list = token.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? { mode: "list", set: new Set(list) } : { mode: "none", set: new Set() };
  })();
  const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  const clientAddress = (req) => {
    const peer = req.socket.remoteAddress || "unknown";
    const trusted =
      trustProxy.mode === "loopback" ? LOOPBACK.has(peer)
      : trustProxy.mode === "list" ? trustProxy.set.has(peer)
      : false;
    if (!trusted) return peer;
    const forwarded = req.headers["x-forwarded-for"];
    if (!forwarded) return peer;
    const hops = String(forwarded).split(",").map((s) => s.trim()).filter(Boolean);
    // Rightmost hop = the address the trusted proxy connected from. A client
    // that pre-injects XFF only prepends to it, so this stays unforgeable.
    return hops.length ? hops[hops.length - 1] : peer;
  };
  const allowedOrigins = new Set(
    (Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []).map((value) => {
      const origin = new URL(value).origin;
      if (!/^https?:\/\//.test(origin)) throw new Error(`invalid allowed origin: ${value}`);
      return origin.toLowerCase();
    })
  );
  /* An explicitly advertised table URL. Validated here rather than at first use,
   * because a malformed one produces invites that fail on someone else's
   * machine, which is the hardest kind of bug to hear about. */
  const publicUrl = (() => {
    if (!options.publicUrl) return null;
    const parsed = new URL(options.publicUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error(`publicUrl must be ws:// or wss://: ${options.publicUrl}`);
    }
    return parsed.href.replace(/\/$/, "");
  })();
  if (publicUrl) addTrustedHost(new URL(publicUrl).host);

  const startedAt = Date.now();

  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(DDL);

  /* CREATE TABLE IF NOT EXISTS does nothing to a database that predates a
   * column, and SQLite has no ADD COLUMN IF NOT EXISTS. A demo laptop carrying
   * yesterday's matches.db must still boot, so add what is missing. */
  const columns = new Set(db.prepare("PRAGMA table_info(matches)").all().map((r) => r.name));
  for (const [name, type] of [
    ["result_content", "TEXT"],
    ["result_tags_json", "TEXT"],
    ["result_created_at", "INTEGER"],
    /* The agreed wager in sats, 0 for a friendly. The referee never holds,
     * escrows or moves a satoshi — it records what both seats agreed to before
     * either knew how the match would go, which is the only moment consent to a
     * wager means anything. Settlement is wallet to wallet, afterwards. */
    ["stake", "INTEGER"],
  ]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE matches ADD COLUMN ${name} ${type}`);
  }

  const q = {
    insertMatch: db.prepare(`INSERT INTO matches
      (match_id, code, status, created_at, updated_at, config_json, ruleset, catalog_digest,
       state_json, seat0_name, seat0_affinity, seat0_pubkey, seat0_token, stake, head_seq)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`),
    byCode: db.prepare("SELECT * FROM matches WHERE code = ?"),
    byId: db.prepare("SELECT * FROM matches WHERE match_id = ?"),
    openTables: db.prepare(
      "SELECT match_id, code, created_at, seat0_name, seat0_pubkey, seat0_affinity, stake FROM matches WHERE status = 'open' ORDER BY created_at DESC LIMIT 50"
    ),
    /* Every unfinished match this identity holds a seat at. This is the query
     * that makes a cleared browser survivable: the credential is gone, the seat
     * is not, and the npub finds it. */
    activeOf: db.prepare(`SELECT match_id, code, status, updated_at,
      seat0_pubkey, seat1_pubkey, seat0_name, seat1_name
      FROM matches WHERE status IN ('open','playing') AND (seat0_pubkey = ? OR seat1_pubkey = ?)
      ORDER BY updated_at DESC LIMIT 10`),
    dropMatch: db.prepare("DELETE FROM matches WHERE match_id = ?"),
    playing: db.prepare("SELECT * FROM matches WHERE status IN ('open','playing')"),
    seatOne: db.prepare(`UPDATE matches SET seat1_name=?, seat1_affinity=?, seat1_pubkey=?,
      seat1_token=?, config_json=?, state_json=?, status='playing', ruleset=?, catalog_digest=?,
      public_hash=?, updated_at=? WHERE match_id=?`),
    setToken: db.prepare("UPDATE matches SET seat0_token = CASE WHEN ?=0 THEN ? ELSE seat0_token END, seat1_token = CASE WHEN ?=1 THEN ? ELSE seat1_token END, updated_at=? WHERE match_id=?"),
    setPubkey: db.prepare("UPDATE matches SET seat0_pubkey = CASE WHEN ?=0 THEN ? ELSE seat0_pubkey END, seat1_pubkey = CASE WHEN ?=1 THEN ? ELSE seat1_pubkey END, updated_at=? WHERE match_id=?"),
    insertEntry: db.prepare(`INSERT INTO entries
      (match_id, seq, seat, at, action_json, prev, state_hash, hash, public_hash, received_at)
      VALUES (?,?,?,'',?,?,?,?,?,?)`),
    updateHead: db.prepare(`UPDATE matches SET head_seq=?, head_hash=?, public_hash=?,
      state_json=?, result_json=?, status=?, updated_at=? WHERE match_id=?`),
    entriesOf: db.prepare("SELECT * FROM entries WHERE match_id = ? ORDER BY seq ASC"),
    insertReject: db.prepare(`INSERT INTO rejects (match_id, at, seat, head_seq, code, message, action_json)
      VALUES (?,?,?,?,?,?,?)`),
    finish: db.prepare(`UPDATE matches SET status='over', result_json=?, verify_json=?,
      transcript_hash=?, head_hash=?, public_hash=?, ended_at=?, updated_at=?,
      result_content=?, result_tags_json=?, result_created_at=? WHERE match_id=?`),
    upsertNostr: db.prepare(`INSERT INTO nostr_events
      (match_id, role, pubkey, event_id, kind, created_at, event_json, content, sig_checked, received_at)
      VALUES (?,?,?,?,?,?,?,?,1,?)
      ON CONFLICT(match_id, role, pubkey) DO UPDATE SET
        event_id=excluded.event_id, kind=excluded.kind, created_at=excluded.created_at,
        event_json=excluded.event_json, content=excluded.content,
        sig_checked=excluded.sig_checked, received_at=excluded.received_at`),
    nostrOf: db.prepare("SELECT event_json FROM nostr_events WHERE match_id=? AND role=? ORDER BY created_at ASC"),
    agreement: db.prepare(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT content) AS distinct_content FROM nostr_events WHERE match_id=? AND role='result'"
    ),
  };

  /** matchId -> live record. The DB is the source of truth; this is the hot copy. */
  const matches = new Map();
  const byCode = new Map();
  /* The matchmaking queue is LIVE CONNECTIONS, never rows: a waiting player
   * writes nothing to the database and the match is minted at the instant two
   * identities are paired, with both seats already filled. That is what stops a
   * queued player leaving a ghost table behind — the trap the open-table list
   * has always had, where you join a code whose host went to lunch. */
  const queue = [];
  const controlRates = new Map();
  const authRates = new Map();

  // ------------------------------------------------------------ match minting

  /* E.createGame THROWS when the auto-built deck contains a Stake card and the
   * Stake module is off (measured: Keys succeeds on 9 of 25 random seeds, All on
   * 21 of 25). Until buildDeckList filters those cards (D-12) the only safe move
   * is to re-roll the seeds until the deck constructs, so the failure can never
   * reach a client. A pinned seed is tried FIRST so the rehearsed demo opening is
   * reproducible. */
  function mintGame(seat0, seat1) {
    const attempts = [];
    /* HASHED, NOT ADJACENT. `hidden = [pin+1, pin+2]` meant that knowing the
     * public seed gave you both hidden ones by addition — and the public seed
     * was in every seat's own view, so PIN_SEED alone handed a modified client
     * the opponent's whole deck over the socket. The pinned opening stays
     * reproducible (the same pin yields the same deal), it simply no longer
     * says anything about the hidden streams. */
    if (pinSeed !== null) {
      attempts.push({
        public: seedFrom(`${pinSeed}:public`),
        hidden: [seedFrom(`${pinSeed}:0`), seedFrom(`${pinSeed}:1`)],
      });
    }
    for (let i = 0; i < MINT_ATTEMPTS; i++) {
      attempts.push({ public: rand32(), hidden: [rand32(), rand32()] });
    }
    /* §3.4 the deck commitment is published in every view. Unsalted it is a free
     * oracle: a 31-bit hidden seed can be brute-forced offline and CONFIRMED
     * against the commitment, so the seeds carried only ~31 bits of real
     * secrecy. A per-match salt keeps the commitment's promise — the deck was
     * fixed before play — while telling an attacker nothing. It is part of the
     * config, so it is written to config_json, folded into gameId (killing that
     * oracle too), and published with the config in the post-match OVER bundle,
     * which is exactly when opening the commitment becomes the point. */
    const salts = [hex(16), hex(16)];
    let last = null;
    for (const seeds of attempts) {
      const config = {
        seats: [
          { name: seat0.name, affinity: seat0.affinity, pubkey: seat0.pubkey, salt: salts[0] },
          { name: seat1.name, affinity: seat1.affinity, pubkey: seat1.pubkey, salt: salts[1] },
        ],
        seeds,
        policy: { freeform: "deny" },
      };
      try {
        return { config, state: E.createGame(config) };
      } catch (err) {
        last = err; // deck build hit an unsupported module; re-roll (D-12)
      }
    }
    const error = new Error("DECK_BUILD_FAILED: " + String(last && last.message));
    error.code = "DECK_BUILD_FAILED";
    throw error;
  }

  // ------------------------------------------------------------- record shape

  function newRecord(row) {
    return {
      matchId: row.match_id,
      code: row.code,
      status: row.status,
      createdAt: row.created_at,
      stake: Number.isInteger(row.stake) ? row.stake : 0,
      config: row.config_json && row.config_json !== "{}" ? JSON.parse(row.config_json) : null,
      state: null,
      ruleset: row.ruleset,
      catalogDigest: row.catalog_digest,
      players: [
        {
          seat: 0,
          name: row.seat0_name,
          affinity: row.seat0_affinity,
          pubkey: row.seat0_pubkey,
          token: row.seat0_token,
          online: false,
        },
        row.seat1_token
          ? {
              seat: 1,
              name: row.seat1_name,
              affinity: row.seat1_affinity,
              pubkey: row.seat1_pubkey,
              token: row.seat1_token,
              online: false,
            }
          : null,
      ],
      headSeq: row.head_seq,
      headHash: row.head_hash,
      publicHash: row.public_hash,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      /* Rebuilt from the row, not from finishMatch — which is never re-run on a
       * restart. Without this a referee reboot erased the signable bytes from
       * the process and NOBODY, connected or not, could ever sign that match. */
      transcriptHash: row.transcript_hash,
      verify: row.verify_json ? JSON.parse(row.verify_json) : null,
      resultContent: row.result_content || null,
      resultTags: row.result_tags_json ? JSON.parse(row.result_tags_json) : null,
      resultCreatedAt: row.result_created_at === null ? null : row.result_created_at,
      endedAt: row.ended_at || null,
      events: [], // unredacted ring
      conns: [null, null],
      spectators: new Set(),
      rate: [[], []],
      rejectRate: [[], []],
    };
  }

  function remember(rec) {
    matches.set(rec.matchId, rec);
    byCode.set(rec.code, rec.matchId);
    return rec;
  }

  /* Recovery is ONE ROW READ, never a replay: a demo must not depend on 300
   * engine applications succeeding while an audience watches. E.replay is the
   * verification path only. */
  function loadMatch(matchId) {
    if (matches.has(matchId)) return matches.get(matchId);
    const row = q.byId.get(matchId);
    if (!row) return null;
    const rec = newRecord(row);
    if (row.state_json) {
      try {
        rec.state = JSON.parse(row.state_json);
      } catch (err) {
        rec.state = null;
      }
    }
    // A match that finished under an older build (or before this column existed)
    // still owes both seats a signable result.
    if (rec.status === "over" && !rec.resultContent) rebuildResultPayload(rec);
    if (!rec.state && rec.config && row.status !== "open") {
      // Last resort. Loud, because it means state_json was lost or corrupt.
      console.warn(`[table] ${matchId}: state_json unusable, replaying transcript`);
      const log = readLog(matchId);
      const replayed = E.replay(rec.config, log.map((e) => e.action));
      if (!replayed.error) {
        rec.state = replayed.state;
        rec.events = replayed.events.slice(-EVENT_RING);
      }
    }
    return remember(rec);
  }

  function findByCode(code) {
    const known = byCode.get(code);
    if (known && matches.has(known)) return matches.get(known);
    const row = q.byCode.get(code);
    return row ? loadMatch(row.match_id) : null;
  }

  function readLog(matchId) {
    return q.entriesOf.all(matchId).map((r) => ({
      seq: r.seq,
      seat: r.seat,
      at: "",
      action: JSON.parse(r.action_json),
      prev: r.prev,
      stateHash: r.state_hash,
      hash: r.hash,
    }));
  }

  /* Boot recovery. The event ring is regenerated from the transcript because
   * engine events are FREE — E.replay(config, log) returns them deterministically
   * — which is exactly why there is no events table. If it fails, the board is
   * still correct and only the scrollback is short. */
  function recover() {
    let n = 0;
    for (const row of q.playing.all()) {
      const rec = loadMatch(row.match_id);
      if (!rec) continue;
      n++;
      if (rec.status === "playing" && rec.config && !rec.events.length) {
        try {
          const replayed = E.replay(rec.config, readLog(rec.matchId).map((e) => e.action));
          if (!replayed.error) rec.events = replayed.events.slice(-EVENT_RING);
        } catch (err) {
          console.warn(`[table] ${row.match_id}: event backfill failed — short scrollback`);
        }
      }
    }
    if (n) console.log(`[table] recovered ${n} match(es) from ${dbPath}`);
  }

  // ------------------------------------------------------------------ sending

  const send = (ws, msg) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const fail = (ws, code, message) =>
    send(ws, { t: "ERROR", v: WIRE, code, message: message || code });

  const eventId = (event) => crypto.createHash("sha256").update(JSON.stringify([
    0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
  ])).digest("hex");

  function authTag(event, name) {
    const tags = Array.isArray(event.tags) ? event.tags : [];
    const matches = tags.filter((tag) => Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string");
    return matches.length === 1 ? matches[0][1] : null;
  }

  function handleAuth(conn, msg) {
    const event = msg.event;
    const fresh = event && Number.isInteger(event.created_at) &&
      Math.abs(Math.floor(Date.now() / 1000) - event.created_at) <= AUTH_MAX_AGE_SECONDS;
    const shape = typeof conn.authChallenge === "string" && event &&
      typeof event === "object" && event.kind === KIND_AUTH &&
      event.content === "" && isHex64(event.pubkey) && isHex64(event.id) && isHex128(event.sig) &&
      authTag(event, "challenge") === conn.authChallenge &&
      authTag(event, "relay") === conn.authRelay;
    const computed = shape ? eventId(event) : null;
    let signatureOk = false;
    if (fresh && computed === event.id) {
      try {
        signatureOk = schnorr.verify(event.sig, event.id, event.pubkey);
      } catch (err) {
        signatureOk = false;
      }
    }
    if (!fresh || !shape || computed !== event.id || !signatureOk) {
      return fail(conn.ws, "AUTH_FAILED", "invalid or expired NIP-42 authentication event");
    }
    conn.pubkey = event.pubkey;
    conn.authChallenge = null; // one challenge, one proof; replay on this connection also fails
    send(conn.ws, {
      t: "AUTH_OK", v: WIRE, pubkey: conn.pubkey, eventId: event.id,
      /* SIGNING IN IS THE SESSION. A seat token lives in one browser; the seat
       * itself belongs to an identity. Cleared storage, a private window or a
       * second machine used to mean the match was simply unreachable — the row
       * was still there, still playing, and nothing could name it. */
      active: activeFor(conn.pubkey),
    });
  }

  /* Every unfinished match this identity is seated at, newest first. Answered
   * from the DB, so it survives a referee restart; `opponentOnline` comes from
   * the live map because that is the one thing the row cannot know. */
  function activeFor(pubkey) {
    if (!isHex64(pubkey)) return [];
    return q.activeOf.all(pubkey, pubkey).map((row) => {
      const seat = row.seat0_pubkey === pubkey ? 0 : 1;
      const rec = matches.get(row.match_id);
      const foe = rec && rec.conns[1 - seat];
      return {
        matchId: row.match_id,
        code: row.code,
        status: row.status,
        seat,
        opponent: (seat === 0 ? row.seat1_name : row.seat0_name) || null,
        opponentOnline: Boolean(foe && foe.readyState === 1),
        updatedAt: row.updated_at,
      };
    });
  }

  function authenticatedPubkey(conn, msg) {
    if (!conn.pubkey) {
      fail(conn.ws, "NIP07_REQUIRED", "complete the signed NIP-42 challenge before opening a remote table");
      return null;
    }
    if (msg.pubkey && String(msg.pubkey).toLowerCase() !== conn.pubkey) {
      fail(conn.ws, "IDENTITY_MISMATCH", "the message pubkey differs from the authenticated NIP-07 identity");
      return null;
    }
    return conn.pubkey;
  }

  const viewFor = (rec, seat) => (rec.state ? E.view(rec.state, seat === undefined ? null : seat) : null);

  function eventsFor(rec, seat) {
    return E.redactEvents(rec.events.slice(-EVENT_CAP), seat === undefined ? null : seat);
  }

  function playersOf(rec) {
    return [0, 1].map((seat) => {
      const p = rec.players[seat];
      if (!p) return { seat, name: null, pubkey: null, affinity: null, online: false };
      return {
        seat,
        name: p.name,
        pubkey: p.pubkey || null,
        affinity: p.affinity,
        online: Boolean(rec.conns[seat] && rec.conns[seat].readyState === 1),
      };
    });
  }

  function stateMessage(rec, conn, extra) {
    const seat = conn.seat;
    const spectator = seat === null;
    const msg = {
      t: "STATE",
      v: WIRE,
      matchId: rec.matchId,
      code: rec.code,
      seat,
      status: rec.status,
      /* The match's own clock. Both seats sign a start announcement over these
       * bytes, and two independently signed events are only comparable if the
       * timestamp comes from the match rather than from either browser. */
      createdAt: rec.createdAt,
      /* What both seats agreed to play for, in sats, 0 for a friendly. Sent so
       * both clients sign byte-identical start announcements, and so a player
       * can always see the wager they are in without trusting their own memory
       * of what they typed. */
      stake: rec.stake || 0,
      role: spectator ? "spectator" : "seat",
      downgraded: Boolean(extra && extra.downgraded),
      downgradeReason: (extra && extra.downgradeReason) || null,
      table: publicTableUrl(),
      ruleset: rec.ruleset,
      catalogDigest: rec.catalogDigest,
      players: playersOf(rec),
      view: rec.state ? viewFor(rec, spectator ? null : seat) : null,
      events: rec.state ? eventsFor(rec, spectator ? null : seat) : [],
      full: true,
      publicHash: rec.publicHash || null,
      result: rec.result || null,
      /* A table that is still open and still has a free seat says so, so a cold
       * browser following the host's share link is offered the seat instead of
       * being silently downgraded to an audience of one empty table. */
      claimable: rec.status === "open" && !rec.players[1],
    };
    /* A finished match hands back the bytes to sign in EVERY state message, not
     * only in the one live OVER. A reload, a reconnect, or a referee restart
     * must not be able to destroy the closing beat of the demo. */
    if (rec.status === "over") {
      if (!rec.resultContent) rebuildResultPayload(rec);
      msg.resultContent = rec.resultContent || null;
      msg.resultTags = rec.resultTags || null;
      msg.resultCreatedAt = rec.resultCreatedAt === undefined ? null : rec.resultCreatedAt;
      msg.transcriptHash = rec.transcriptHash || null;
      msg.headHash = rec.headHash || null;
      msg.verify = rec.verify || null;
    }
    // The token is a credential; it appears exactly once, in the first STATE of
    // a connection, and never for a spectator.
    if (!spectator && !conn.tokenSent) {
      msg.token = rec.players[seat].token;
      conn.tokenSent = true;
      // Remembered per match, so moving to a new one re-issues rather than
      // silently seating a player with no way back into it.
      conn.tokenSentFor = rec.matchId;
    }
    return msg;
  }

  function broadcast(rec, build) {
    for (const seat of [0, 1]) {
      const ws = rec.conns[seat];
      if (ws) send(ws, build(seat));
    }
    for (const ws of rec.spectators) send(ws, build(null));
  }

  function peer(rec, seat, online) {
    broadcast(rec, () => ({ t: "PEER", v: WIRE, seat, online }));
  }

  // ------------------------------------------------------------- the hot path

  /* One accepted action: validate with the engine, COMMIT, then acknowledge.
   * Anything the opponent has seen is already on disk — that is what makes
   * "SQLite is the single source of truth" true rather than aspirational. */
  function handleAct(conn, msg) {
    const rec = conn.rec;
    if (!rec) return fail(conn.ws, "NO_SUCH_MATCH", "not seated at a table");
    if (conn.seat === null) return fail(conn.ws, "BAD_MESSAGE", "spectators cannot act");
    if (!rec.state) return fail(conn.ws, "NO_SUCH_MATCH", "the match has not started");
    const action = msg.action;
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      return fail(conn.ws, "BAD_MESSAGE", "action must be an object with a type");
    }
    /* `at` is hashed by entryHash, so it must be deterministic or replay stops
     * reproducing the chain. Wall clock lives in entries.received_at, outside the
     * hash. Forced here rather than trusted from the client. */
    action.at = "";

    const before = rec.state;
    const r = E.apply(before, action, { authenticatedSeat: conn.seat });
    if (r.error) {
      /* A REJECT is the normal outcome of clicking a card — CANNOT_AFFORD,
       * NOT_RESOURCE, WRONG_PHASE are what browsing your own hand looks like on
       * the wire. Charging those to the action budget kicked players off the
       * socket for playing the game, so rejects have their own far looser
       * counter that exists purely to stop a runaway loop. */
      if (!rejectOk(rec, conn.seat)) return kick(conn, "too many rejected actions");
      q.insertReject.run(
        rec.matchId, nowIso(), conn.seat, before.seq,
        r.error.code, r.error.message || null, JSON.stringify(action)
      );
      return send(conn.ws, {
        t: "REJECT",
        v: WIRE,
        seq: action.seq,
        code: r.error.code,
        message: r.error.message || r.error.code,
        detail: r.error.detail === undefined ? null : r.error.detail,
        // A desynced client is CORRECTED in the same message it is scolded by.
        view: E.view(before, conn.seat),
      });
    }

    // Only ACCEPTED actions are metered, and the meter is checked after the
    // engine has agreed, never before it.
    if (!rateOk(rec, conn.seat)) return kick(conn, "too many actions");

    const next = r.state;
    const prev = rec.headHash || before.gameId; // seq 0 anchors on gameId, as play.js does
    const stateHash = E.hashState(next);
    const entry = { seq: action.seq, seat: action.seat, at: "", action, prev, stateHash };
    entry.hash = E.entryHash(entry);
    const publicHash = E.publicHash(next);
    const result = next.result || null;
    const status = result ? "over" : "playing";

    db.exec("BEGIN IMMEDIATE");
    try {
      q.insertEntry.run(
        rec.matchId, entry.seq, entry.seat, JSON.stringify(action),
        entry.prev, entry.stateHash, entry.hash, publicHash, nowIso()
      );
      q.updateHead.run(
        entry.seq + 1, entry.hash, publicHash, JSON.stringify(next),
        result ? JSON.stringify(result) : null, status, nowIso(), rec.matchId
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      // The state is NOT advanced: what was not durable was never played.
      return send(conn.ws, {
        t: "REJECT",
        v: WIRE,
        seq: action.seq,
        code: "NOT_DURABLE",
        message: "the referee could not persist that action",
        detail: String(err && err.message),
        view: E.view(before, conn.seat),
      });
    }

    rec.state = next;
    rec.headSeq = entry.seq + 1;
    rec.headHash = entry.hash;
    rec.publicHash = publicHash;
    rec.result = result;
    rec.status = status;
    for (const event of r.events) rec.events.push(event);
    if (rec.events.length > EVENT_RING) rec.events.splice(0, rec.events.length - EVENT_RING);

    const chain = { seq: entry.seq, seat: entry.seat, at: "", prev: entry.prev, stateHash: entry.stateHash, hash: entry.hash };
    broadcast(rec, (seat) => ({
      t: "FRAME",
      v: WIRE,
      seq: next.seq,
      by: action.seat,
      view: E.view(next, seat),
      events: E.redactEvents(r.events, seat),
      /* `entry` deliberately omits `action`: an opponent's payload can name uids
       * the viewing seat is not entitled to (DISCARD_TO_LIMIT, REVEAL). The chain
       * fields alone prove continuity; the full transcript arrives in OVER. */
      entry: chain,
      publicHash,
    }));

    if (result) finishMatch(rec);
  }

  function meter(bucket, seat, max) {
    const now = Date.now();
    const hits = bucket[seat].filter((t) => now - t < RATE_WINDOW_MS);
    hits.push(now);
    bucket[seat] = hits;
    return hits.length <= max;
  }

  const rateOk = (rec, seat) => meter(rec.rate, seat, rateMax);
  const rejectOk = (rec, seat) => meter(rec.rejectRate, seat, rejectMax);
  /* WHO A BUDGET BELONGS TO. This bucketed on the TCP peer — which, in the
   * deployment the docs prescribe, is a reverse proxy on 127.0.0.1, so EVERY
   * PLAYER SHARED ONE 30-PER-10s BUDGET. A stranger's chatter closed a seated
   * host's socket, and thirty reconnects across all players in one window shut
   * the door on everybody. Flaky wifi produces reconnect storms, so the failure
   * landed hardest exactly when the game most needed to look reliable.
   *
   * Once a connection has proved an identity, that identity is who it is; the
   * address is only the fallback for traffic that has not authenticated yet,
   * which is where a shared bucket is actually the correct answer. */
  const budgetKey = (conn) => (conn.pubkey ? `k:${conn.pubkey}` : `a:${conn.address}`);
  const addressOk = (rates, conn, max) => {
    const now = Date.now();
    const key = budgetKey(conn);
    const hits = (rates.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
    hits.push(now);
    rates.set(key, hits);
    return hits.length <= max;
  };
  const controlOk = (conn) => addressOk(controlRates, conn, controlMax);
  const authOk = (conn) => addressOk(authRates, conn, Math.max(5, controlMax));

  function kick(conn, why) {
    fail(conn.ws, "RATE_LIMITED", why);
    try { conn.ws.close(4029, "RATE_LIMITED"); } catch (err) { /* already gone */ }
  }

  // --------------------------------------------------------------- match over

  function transcriptHashOf(log) {
    return E.sha256hex(
      E.canonicalJSON(log.map((e) => ({ seq: e.seq, seat: e.seat, at: e.at, action: e.action })))
    );
  }

  function resultPayload(rec, log, tHash) {
    const state = rec.state;
    const result = rec.result || { winners: [], losers: [0, 1], reason: "draw" };
    const players = [0, 1].map((seat) => ({
      seat,
      pubkey: (rec.players[seat] && rec.players[seat].pubkey) || null,
      name: rec.players[seat] ? rec.players[seat].name : null,
      affinity: rec.players[seat] ? rec.players[seat].affinity : null,
    }));
    return {
      v: 1,
      kind: "result",
      matchId: rec.matchId,
      gameId: state.gameId,
      ruleset: state.ruleset,
      catalogDigest: state.catalogDigest,
      topology: "table",
      wire: WIRE,
      players,
      winners: result.winners || [],
      losers: result.losers || [],
      reason: result.reason || null,
      turns: state.turn ? state.turn.number : 0,
      actions: log.length,
      publicHash: rec.publicHash,
      transcriptHash: tHash,
      headHash: rec.headHash,
      startedAt: rec.createdAt,
      endedAt: rec.endedAt,
    };
  }

  function resultTags(rec, payload) {
    const tags = [
      ["d", rec.matchId],
      ["m", rec.matchId],
    ];
    const keys = [0, 1].map((s) => (rec.players[s] && rec.players[s].pubkey) || null);
    for (const k of keys) if (k) tags.push(["p", k]);
    /* winners is an ARRAY: the engine produces {"winners":[],"reason":"draw"} on a
     * simultaneous loss, which a singular winnerSeat field cannot represent. */
    if (payload.winners.length === 1 && keys[payload.winners[0]]) {
      tags.push(["winner", keys[payload.winners[0]]]);
    } else if (payload.winners.length === 0) {
      tags.push(["outcome", "draw"]);
    }
    tags.push(["t", "600b-timelock-tcg"]);
    tags.push(["alt", "600B Timelock TCG match result"]);
    return tags;
  }

  /* THE CLOSING BEAT MUST BE RECOVERABLE. These bytes used to exist only in the
   * single OVER broadcast: a seat that was disconnected at the moment the match
   * ended, or that merely reloaded afterwards, could never rebuild them, so its
   * "Publish result" button never appeared and the agreement counter could never
   * leave "none". Now finishMatch persists them, every STATE for a finished
   * match carries them, and this rebuilds them for any row that predates that. */
  function rebuildResultPayload(rec) {
    if (rec.status !== "over") return null;
    const log = readLog(rec.matchId);
    const tHash = rec.transcriptHash || transcriptHashOf(log);
    rec.transcriptHash = tHash;
    if (!rec.state) {
      const row = q.byId.get(rec.matchId);
      if (row && row.state_json) {
        try { rec.state = JSON.parse(row.state_json); } catch (err) { /* handled below */ }
      }
    }
    if (!rec.state) return null; // nothing to describe; the row is beyond repair
    const payload = resultPayload(rec, log, tHash);
    rec.resultContent = JSON.stringify(payload);
    rec.resultTags = resultTags(rec, payload);
    rec.resultCreatedAt = Math.floor(Date.parse(rec.endedAt || rec.createdAt) / 1000);
    return payload;
  }

  /* One builder, two callers: the live broadcast and the re-send that follows a
   * RESUME into a finished match. A returning client must receive the SAME bytes
   * its opponent already signed, or agreement is a string compare that fails. */
  function overMessage(rec) {
    if (!rec.resultContent) rebuildResultPayload(rec);
    const verify = rec.verify || { ok: false, divergedAt: null, headHash: null, error: null };
    return {
      t: "OVER",
      v: WIRE,
      matchId: rec.matchId,
      result: rec.result,
      headHash: rec.headHash,
      publicHash: rec.publicHash,
      transcriptHash: rec.transcriptHash || null,
      verify: {
        ok: verify.ok,
        divergedAt: verify.divergedAt === undefined ? null : verify.divergedAt,
        headHash: verify.headHash || null,
        error: verify.error || null,
      },
      config: rec.config,
      transcript: readLog(rec.matchId),
      resultTags: rec.resultTags || null,
      resultContent: rec.resultContent || null,
      resultCreatedAt: rec.resultCreatedAt === undefined ? null : rec.resultCreatedAt,
    };
  }

  function finishMatch(rec) {
    rec.endedAt = nowIso();
    // Verify over what was PERSISTED, not over memory: the trust beat is computed
    // from the DB or it proves nothing.
    const log = readLog(rec.matchId);
    const tHash = transcriptHashOf(log);
    let verify;
    try {
      verify = E.verifyMatch({ config: rec.config, log });
    } catch (err) {
      verify = { ok: false, divergedAt: null, headHash: null, error: { code: "ENGINE_PANIC", message: String(err && err.message) } };
    }
    rec.status = "over";
    rec.transcriptHash = tHash;
    rec.verify = verify;

    const payload = resultPayload(rec, log, tHash);
    /* Both clients sign these exact bytes. Re-stringifying a parsed object in two
     * browsers is a needless risk; agreement is then a string compare. */
    rec.resultContent = JSON.stringify(payload);
    rec.resultTags = resultTags(rec, payload);
    rec.resultCreatedAt = Math.floor(Date.parse(rec.endedAt) / 1000);

    // Written in the SAME statement as the verdict: the bytes to sign are part
    // of the result, not a side effect of having been connected when it landed.
    q.finish.run(
      JSON.stringify(rec.result), JSON.stringify(verify), tHash,
      rec.headHash, rec.publicHash, rec.endedAt, nowIso(),
      rec.resultContent, JSON.stringify(rec.resultTags), rec.resultCreatedAt, rec.matchId
    );

    const over = overMessage(rec);
    broadcast(rec, () => over);
  }

  // ------------------------------------------------------------ create / join

  /* A wager is a whole number of sats, nothing else. Capped because a fat
   * finger on a stake field is a worse experience than a low ceiling, and
   * because the referee is recording a promise it can neither enforce nor
   * refund — it should not be recording life savings. */
  const MAX_STAKE = 1000000;
  const cleanStake = (value) => {
    const sats = Number(value);
    if (!Number.isInteger(sats) || sats <= 0) return 0;
    return Math.min(sats, MAX_STAKE);
  };

  function handleCreate(conn, msg) {
    const name = String(msg.name || "Player").slice(0, 40);
    const affinity = HAND_AFFINITIES.indexOf(msg.affinity) >= 0 ? msg.affinity : "All";
    const pubkey = authenticatedPubkey(conn, msg);
    if (!pubkey) return;
    /* An open table this connection is still hosting is closed first. Two
     * CREATEs on one socket used to leave the first as an advertised row with
     * nobody sitting at it — exactly the trap LEAVE exists to prevent, arrived
     * at by a different door. */
    if (conn.rec && conn.seat === 0 && conn.rec.status === "open" && !conn.rec.players[1]) {
      handleLeave(conn);
    }
    const matchId = "m_" + hex(6);
    let code = makeCode();
    for (let i = 0; i < 20 && q.byCode.get(code); i++) code = makeCode();
    const token = hex(16);
    const at = nowIso();
    q.insertMatch.run(
      matchId, code, "open", at, at, "{}", "E1.0", CATALOG.digest,
      null, name, affinity, pubkey, token, cleanStake(msg.stake)
    );
    const rec = remember(newRecord(q.byId.get(matchId)));
    seat(conn, rec, 0);
    send(conn.ws, stateMessage(rec, conn));
  }

  function handleJoin(conn, msg) {
    const pubkey = authenticatedPubkey(conn, msg);
    if (!pubkey) return;
    const code = String(msg.code || "").trim().toUpperCase();
    const rec = findByCode(code);
    if (!rec) return fail(conn.ws, "NO_SUCH_MATCH", "no table with that code");
    // Open rows from builds before mandatory NIP-07 have no recoverable owner.
    // Starting one would create a match whose host can never authenticate.
    if (!rec.players[0] || !isHex64(rec.players[0].pubkey)) {
      return fail(conn.ws, "NO_SUCH_MATCH", "that legacy table is no longer joinable");
    }
    if (rec.status === "over") return fail(conn.ws, "MATCH_OVER", "that match is finished");
    if (rec.players[1]) return fail(conn.ws, "MATCH_FULL", "both seats are taken");
    /* A presenter who fumbles and types their OWN code into the join box used to
     * end up registered at conns[0] AND conns[1]: the match started against
     * itself, left the lobby, held both seats' unredacted views on one socket,
     * and the real opponent got MATCH_FULL forever with no way back.
     * SEATED, not merely attached — a spectator downgraded onto this table is
     * usually the person the host sent the link to, and JOIN is exactly how they
     * take the free seat. */
    if (conn.rec === rec && conn.seat !== null) {
      return fail(conn.ws, "MATCH_FULL", "you are already seated at this table");
    }

    const name = String(msg.name || "Player").slice(0, 40);
    const affinity = HAND_AFFINITIES.indexOf(msg.affinity) >= 0 ? msg.affinity : "All";
    // Belt and braces for the same fumble from a second tab of the same login.
    if (pubkey && rec.players[0].pubkey === pubkey) {
      return fail(conn.ws, "MATCH_FULL", "you cannot take both seats at one table");
    }
    /* NOBODY IS DEALT INTO A WAGER THEY DID NOT ACCEPT. A guest that states a
     * stake is stating the one it was shown; if the table's has changed since,
     * or the link was shared with a different number attached, the join is
     * refused rather than quietly binding them to the host's figure. Omitting
     * it still works, and means "whatever the table says". */
    if (msg.stake !== undefined && cleanStake(msg.stake) !== (rec.stake || 0)) {
      return fail(conn.ws, "STAKE_MISMATCH", `this table plays for ${rec.stake || 0} sats`);
    }
    const token = hex(16);

    let minted;
    try {
      minted = mintGame(rec.players[0], { name, affinity, pubkey });
    } catch (err) {
      return fail(conn.ws, "DECK_BUILD_FAILED", String(err && err.message));
    }

    rec.players[1] = { seat: 1, name, affinity, pubkey, token, online: false };
    rec.config = minted.config;
    rec.state = minted.state;
    rec.status = "playing";
    rec.ruleset = minted.state.ruleset;
    rec.catalogDigest = minted.state.catalogDigest;
    rec.publicHash = E.publicHash(minted.state);
    rec.events = [];

    q.seatOne.run(
      name, affinity, pubkey, token, JSON.stringify(minted.config), JSON.stringify(minted.state),
      rec.ruleset, rec.catalogDigest, rec.publicHash, nowIso(), rec.matchId
    );

    seat(conn, rec, 1);
    for (const s of [0, 1]) {
      const ws = rec.conns[s];
      if (ws) send(ws, stateMessage(rec, ws.conn));
    }
    for (const ws of rec.spectators) send(ws, stateMessage(rec, ws.conn));
  }

  // ----------------------------------------------------------- matchmaking

  const queueIndex = (conn) => queue.findIndex((entry) => entry.conn === conn);
  const queueLive = (entry) =>
    Boolean(entry.conn.pubkey) && entry.conn.ws.readyState === 1;

  const queuedMessage = (position) => ({
    t: "QUEUED",
    v: WIRE,
    queued: position !== null,
    position,
    waiting: queue.length,
  });

  /* Everyone still waiting is told where they now stand. A queue you cannot see
   * move is indistinguishable from a queue that is broken. */
  function announceQueue() {
    for (let i = 0; i < queue.length; i++) send(queue[i].conn.ws, queuedMessage(i + 1));
  }

  function leaveQueue(conn, tell) {
    const index = queueIndex(conn);
    if (index >= 0) queue.splice(index, 1);
    if (tell) send(conn.ws, queuedMessage(null));
    if (index >= 0) announceQueue();
    return index >= 0;
  }

  /* Both seats are written in ONE transaction. A half-created pair is the worst
   * of both worlds: a table whose host is unreachable and a guest with no
   * board. */
  function pairUp(first, second) {
    const seats = [first, second].map((entry) => ({
      name: entry.name,
      affinity: entry.affinity,
      pubkey: entry.conn.pubkey,
    }));
    const minted = mintGame(seats[0], seats[1]); // throws DECK_BUILD_FAILED (D-12)
    const matchId = "m_" + hex(6);
    let code = makeCode();
    for (let i = 0; i < 20 && q.byCode.get(code); i++) code = makeCode();
    const tokens = [hex(16), hex(16)];
    const at = nowIso();
    const publicHash = E.publicHash(minted.state);

    db.exec("BEGIN IMMEDIATE");
    try {
      q.insertMatch.run(
        matchId, code, "open", at, at, "{}", minted.state.ruleset, minted.state.catalogDigest,
        null, seats[0].name, seats[0].affinity, seats[0].pubkey, tokens[0], first.stake
      );
      q.seatOne.run(
        seats[1].name, seats[1].affinity, seats[1].pubkey, tokens[1],
        JSON.stringify(minted.config), JSON.stringify(minted.state),
        minted.state.ruleset, minted.state.catalogDigest, publicHash, at, matchId
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    const rec = remember(newRecord(q.byId.get(matchId)));
    rec.state = minted.state;
    rec.events = [];
    seat(first.conn, rec, 0);
    seat(second.conn, rec, 1);
    for (const n of [0, 1]) send(rec.conns[n], stateMessage(rec, rec.conns[n].conn));
    return rec;
  }

  /* Two tabs of one npub must never be paired with each other: the engine would
   * deal it happily and one person would hold both hands.
   *
   * AND THE STAKES MUST MATCH. Pairing on the wager is what makes it an
   * agreement rather than an announcement — both seats then sign the identical
   * number by construction, and nobody is ever dealt into a game for sats they
   * did not ask to play for. A friendly is stake 0 and pairs with friendlies. */
  function findPair() {
    for (let i = 0; i < queue.length; i++) {
      for (let j = i + 1; j < queue.length; j++) {
        if (queue[j].conn.pubkey === queue[i].conn.pubkey) continue;
        if (queue[j].stake !== queue[i].stake) continue;
        return [i, j];
      }
    }
    return null;
  }

  function pumpQueue() {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!queueLive(queue[i])) queue.splice(i, 1);
    }
    let pair;
    while ((pair = findPair())) {
      // The higher index first, so the lower one is still valid after the splice.
      const second = queue.splice(pair[1], 1)[0];
      const first = queue.splice(pair[0], 1)[0];
      try {
        pairUp(first, second);
      } catch (err) {
        /* Neither player is put back in the queue: a re-roll that failed 40
         * times will fail again, and silently looping is worse than saying so. */
        for (const entry of [first, second]) {
          fail(entry.conn.ws, "DECK_BUILD_FAILED", String(err && err.message));
        }
      }
    }
    announceQueue();
  }

  function handleQueue(conn, msg) {
    const pubkey = authenticatedPubkey(conn, msg);
    if (!pubkey) return;
    /* Queueing while seated would deal a second board this connection cannot
     * show. Leaving the table first is one click, and the client does it. */
    if (conn.rec && conn.seat !== null && conn.rec.status !== "over") {
      return fail(conn.ws, "MATCH_FULL", "leave your current match before queueing");
    }
    const name = String(msg.name || "Player").slice(0, 40);
    const affinity = HAND_AFFINITIES.indexOf(msg.affinity) >= 0 ? msg.affinity : "All";
    const stake = cleanStake(msg.stake);
    const index = queueIndex(conn);
    if (index >= 0) Object.assign(queue[index], { name, affinity, stake });
    else queue.push({ conn, name, affinity, stake, at: Date.now() });
    pumpQueue();
  }

  function handleUnqueue(conn) {
    leaveQueue(conn, true);
  }

  /* Leaving is a real message, not just a closed socket. An OPEN table whose
   * host walks away has no game, no transcript and nothing to audit — and left
   * in the list it is a trap, because the next player joins it and waits at an
   * empty table for someone who is never coming back. A match in progress is
   * only detached: the seat still belongs to that identity, and the way to end
   * a game is to concede it, which is an engine action like any other. */
  function handleLeave(conn) {
    leaveQueue(conn, true);
    const rec = conn.rec;
    if (!rec) return;
    const closing = conn.seat === 0 && rec.status === "open" && !rec.players[1];
    detach(conn);
    conn.seat = null;
    conn.tokenSent = false;
    if (!closing) return;
    for (const ws of rec.spectators) fail(ws, "NO_SUCH_MATCH", "the host closed this table");
    matches.delete(rec.matchId);
    byCode.delete(rec.code);
    q.dropMatch.run(rec.matchId);
  }

  // ---------------------------------------------------------------- resume

  function seat(conn, rec, n) {
    /* SITTING DOWN LEAVES THE LINE. Nothing else did this: CREATE, JOIN and
     * RESUME all seated a connection while leaving its queue entry standing,
     * and pumpQueue only pruned entries whose socket had died. So a player who
     * pressed "Find opponent", got bored, and then hosted a table or joined a
     * friend's code stayed in the queue — and the next stranger to queue was
     * PAIRED WITH THEM, yanking them out of a live match and into a game
     * against someone they had never met, while their real opponent watched
     * them go offline mid-turn. */
    leaveQueue(conn, false);
    if (conn.rec && conn.rec !== rec) detach(conn);
    /* A credential is per MATCH, not per connection. `tokenSent` was a flag on
     * the socket, so the second match a connection ever sat at — every rematch,
     * every queue-into-a-new-game — was seated with no token at all, and could
     * only be recovered through the weaker identity rung. */
    if (conn.rec !== rec || conn.tokenSentFor !== rec.matchId) conn.tokenSent = false;
    conn.rec = rec;
    conn.seat = n;
    if (n === null) {
      rec.spectators.add(conn.ws);
      return;
    }
    rec.spectators.delete(conn.ws); // a spectator that is granted a seat stops being one
    const held = rec.conns[n];
    if (held && held !== conn.ws) {
      /* TAKEOVER, NOT REFUSAL. One rule covers reload, sleep/wake, a second tab
       * and moving machines — and it can never lock a player out of their own
       * match on stage, which is the failure that actually happens live. */
      fail(held, "SUPERSEDED", "this seat was claimed by another connection");
      try { held.close(4009, "SUPERSEDED"); } catch (err) { /* already gone */ }
      if (held.conn) held.conn.rec = null;
    }
    rec.conns[n] = conn.ws;
  }

  function handleResume(conn, msg) {
    const pubkey = authenticatedPubkey(conn, msg);
    if (!pubkey) return;
    const rec = loadMatch(String(msg.matchId || ""));
    if (!rec) return fail(conn.ws, "NO_SUCH_MATCH", "unknown match");
    const token = typeof msg.token === "string" ? msg.token : null;

    // The claim ladder, in strict priority order.
    let granted = null;
    let downgradeReason = null;
    let freshToken = false;

    if (token) {
      for (const n of [0, 1]) {
        if (rec.players[n] && rec.players[n].token === token) granted = n;
      }
      if (granted === null) downgradeReason = "unknown token";
      else if (rec.players[granted].pubkey !== pubkey) {
        return fail(conn.ws, "IDENTITY_MISMATCH", "the seat token belongs to another NIP-07 identity");
      }
    }
    if (granted === null && pubkey) {
      for (const n of [0, 1]) {
        const p = rec.players[n];
        const live = rec.conns[n] && rec.conns[n].readyState === 1;
        if (granted === null && p && p.pubkey === pubkey && !live) {
          granted = n;
          freshToken = true;
        }
      }
      if (granted === null && !downgradeReason) downgradeReason = "seat held by a live connection";
    }
    /* Only when nothing more specific was learned. This used to overwrite the
     * true reason unconditionally, so a player whose own seat was held by their
     * own zombie socket was told their identity did not own it — pointing the
     * diagnosis in precisely the wrong direction, in the one message a stuck
     * player actually reads. */
    if (granted === null && !token && !downgradeReason) {
      downgradeReason = "NIP-07 identity does not own a seat";
    }

    if (granted === null) {
      /* NEVER a hard error: a stranger opening the link mid-match becomes an
       * audience member, not a crash. But a table that is still OPEN with a free
       * seat is not that case — it is the host's own share link, and the person
       * following it came to play. `claimable` in the STATE tells them so; the
       * client turns it into a Join, not a host panel. */
      seat(conn, rec, null);
      return send(conn.ws, stateMessage(rec, conn, { downgraded: true, downgradeReason }));
    }

    if (freshToken) {
      const next = hex(16);
      rec.players[granted].token = next;
      q.setToken.run(granted, next, granted, next, nowIso(), rec.matchId);
    }
    conn.tokenSent = false; // a resumed seat always gets its (possibly new) token
    /* A seat that was kicked for rate and reconnected used to be kicked again on
     * its first action, because the window survived the disconnect. Coming back
     * clears the slate. */
    rec.rate[granted] = [];
    rec.rejectRate[granted] = [];
    seat(conn, rec, granted);
    send(conn.ws, stateMessage(rec, conn));
    /* A seat that missed the single live OVER — it was asleep, disconnected, or
     * simply reloaded — is handed the whole bundle again so its "Publish result"
     * button appears and both signatures can still be collected. */
    if (rec.status === "over") send(conn.ws, overMessage(rec));
    const other = rec.conns[1 - granted];
    if (other) send(other, { t: "PEER", v: WIRE, seat: granted, online: true });
  }

  // ----------------------------------------------------------------- nostr in

  /* VERIFIED, NOT MERELY STORED. This used to keep sig_checked = 0 and say so
   * honestly, on the grounds that a curve dependency was unjustified risk — but
   * NIP-42 login made @noble/curves a dependency anyway, so the same three lines
   * that authenticate a seat now certify what it publishes. An event whose id
   * does not match its own bytes, or whose signature does not verify, is not a
   * record of anything and is refused rather than written down. That is what a
   * ladder computed from these rows needs to be worth anything. */
  function handleNostr(conn, msg) {
    const rec = conn.rec;
    if (!rec) return fail(conn.ws, "NO_SUCH_MATCH", "not seated at a table");
    const role = msg.role;
    if (["invite", "accept", "result"].indexOf(role) < 0) {
      return fail(conn.ws, "BAD_MESSAGE", "role must be invite|accept|result");
    }
    const ev = msg.event;
    if (!ev || typeof ev !== "object" || !isHex64(ev.pubkey) || typeof ev.content !== "string") {
      return fail(conn.ws, "BAD_MESSAGE", "malformed nostr event");
    }
    /* SEAT BINDING IS STILL LOAD-BEARING, EVEN NOW THAT SIGNATURES ARE CHECKED.
     * It is tempting to think verification made this redundant; it did not. A
     * third keypair produces a PERFECT signature under a key that is simply not
     * one of the two seats, so without this rule one player could submit both
     * "sides" of the agreement and drive the broadcast to confirmed — or to
     * disputed — on their own, which the lobby renders verbatim. Verification
     * proves an event is genuine. This proves it is genuinely YOURS. */
    const me = conn.seat === null ? null : rec.players[conn.seat];
    if (!me) return fail(conn.ws, "BAD_MESSAGE", "spectators cannot submit events");
    if (!me.pubkey) {
      return fail(conn.ws, "NIP07_REQUIRED", "this legacy seat has no NIP-07 identity");
    }
    if (ev.pubkey !== me.pubkey) {
      return fail(conn.ws, "BAD_MESSAGE", "a seat may only submit an event under its own pubkey");
    }
    // And a result before the match is over is not a result.
    if (role === "result" && rec.status !== "over") {
      return fail(conn.ws, "BAD_MESSAGE", "no result before OVER");
    }
    /* The id must be the hash of the event's OWN bytes before the signature over
     * that id means anything: without this check a valid signature could be
     * pasted onto altered content. */
    if (!isHex64(ev.id) || !isHex128(ev.sig) || eventId(ev) !== ev.id) {
      return fail(conn.ws, "BAD_MESSAGE", "that event's id does not match its own bytes");
    }
    let signatureOk = false;
    try {
      signatureOk = schnorr.verify(ev.sig, ev.id, ev.pubkey);
    } catch (err) {
      signatureOk = false;
    }
    if (!signatureOk) return fail(conn.ws, "BAD_MESSAGE", "that event's signature does not verify");
    q.upsertNostr.run(
      rec.matchId, role, ev.pubkey, String(ev.id || ""), Number(ev.kind) || 0,
      Number(ev.created_at) || 0, JSON.stringify(ev), ev.content, nowIso()
    );
    if (role !== "result") return;

    const row = q.agreement.get(rec.matchId);
    const agreement =
      row.n === 0 ? "none" : row.n === 1 ? "pending" : row.distinct_content === 1 ? "confirmed" : "disputed";
    const events = q.nostrOf.all(rec.matchId, "result").map((r) => JSON.parse(r.event_json));
    broadcast(rec, () => ({ t: "NOSTR", v: WIRE, role: "result", agreement, events }));
  }

  // ------------------------------------------------------------------ sockets

  function detach(conn) {
    const rec = conn.rec;
    if (!rec) return;
    if (conn.seat === null) rec.spectators.delete(conn.ws);
    else if (rec.conns[conn.seat] === conn.ws) {
      rec.conns[conn.seat] = null;
      peer(rec, conn.seat, false);
    }
    conn.rec = null;
  }

  const server = http.createServer((req, res) => serveHttp(req, res));
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    perMessageDeflate: true,
    maxPayload,
    verifyClient(info, done) {
      if (!requestHostAllowed(info.req)) {
        return done(false, 403, "host not allowed");
      }
      const header = info.req.headers.origin;
      if (!header) return done(true); // native clients and the headless verifier
      let origin;
      try {
        origin = new URL(header);
      } catch (err) {
        return done(false, 403, "origin not allowed");
      }
      const sameHost =
        origin.host.toLowerCase() === String(info.req.headers.host || "").toLowerCase();
      const browserScheme = origin.protocol === "http:" || origin.protocol === "https:";
      const explicitlyAllowed = allowedOrigins.has(origin.origin.toLowerCase());
      return done(browserScheme && (sameHost || explicitlyAllowed), 403, "origin not allowed");
    },
  });

  wss.on("connection", (ws, req) => {
    /* The TCP peer is authoritative. X-Forwarded-For is attacker input unless a
     * deployment explicitly declares a trusted proxy via trustProxy — see
     * clientAddress, which only then reads the proxy's observed hop. */
    const address = clientAddress(req);
    const conn = {
      ws, rec: null, seat: null, tokenSent: false, tokenSentFor: null, address,
      pubkey: null, authChallenge: hex(32), authRelay: publicTableUrl(),
    };
    ws.conn = conn;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch (err) {
        if (!controlOk(conn)) return kick(conn, "too many bad messages");
        return fail(ws, "BAD_MESSAGE", "not JSON");
      }
      if (!msg || typeof msg !== "object") {
        if (!controlOk(conn)) return kick(conn, "too many bad messages");
        return fail(ws, "BAD_MESSAGE", "not an object");
      }
      if (msg.v !== WIRE) {
        if (!controlOk(conn)) return kick(conn, "too many bad messages");
        return fail(ws, "BAD_VERSION", `this table speaks wire v${WIRE}`);
      }
      const normalAct =
        conn.rec && conn.seat !== null && msg.t === "ACT" &&
        msg.action && typeof msg.action === "object" &&
        typeof msg.action.type === "string";
      const initialAuth = msg.t === "AUTH" && !conn.pubkey;
      if (initialAuth && !authOk(conn)) return kick(conn, "too many authentication attempts");
      if (!normalAct && !initialAuth && !controlOk(conn)) {
        return kick(conn, "too many control or bad messages");
      }
      try {
        switch (msg.t) {
          case "AUTH": return handleAuth(conn, msg);
          case "CREATE": return handleCreate(conn, msg);
          case "JOIN": return handleJoin(conn, msg);
          case "ACT": return handleAct(conn, msg);
          case "RESUME": return handleResume(conn, msg);
          case "QUEUE": return handleQueue(conn, msg);
          case "UNQUEUE": return handleUnqueue(conn);
          case "LEAVE": return handleLeave(conn);
          case "NOSTR": return handleNostr(conn, msg);
          default: return fail(ws, "BAD_MESSAGE", `unknown message ${msg.t}`);
        }
      } catch (err) {
        // A referee that dies on a crafted payload is a denial of service.
        console.error("[table] handler threw:", err);
        if (normalAct && !controlOk(conn)) return kick(conn, "too many bad messages");
        return fail(ws, "BAD_MESSAGE", String(err && err.message));
      }
    });

    /* A dropped socket leaves the queue too, and the people behind it are told
     * their new position — otherwise the queue fills with connections that
     * cannot be paired and everyone waits behind a ghost. */
    const gone = () => { leaveQueue(conn, false); detach(conn); };
    ws.on("close", gone);
    ws.on("error", gone);
    send(ws, {
      t: "AUTH", v: WIRE, challenge: conn.authChallenge,
      relay: conn.authRelay, kind: KIND_AUTH, expiresIn: AUTH_MAX_AGE_SECONDS,
    });
  });

  /* The ONLY reliable way to notice a slept laptop: its TCP connection dies
   * silently and would otherwise look alive forever. Two missed pongs = 30 s. */
  const heartbeat = setInterval(() => {
    pruneAddressRates(controlRates, Date.now(), RATE_WINDOW_MS);
    pruneAddressRates(authRates, Date.now(), RATE_WINDOW_MS);
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch (err) { /* already gone */ }
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (err) { /* already gone */ }
    }
  }, PING_MS);
  heartbeat.unref();

  // --------------------------------------------------------------- http/static

  const STATIC_ROOTS = {
    art: path.join(REPO, "art"),
    cards: path.join(REPO, "cards"),
    rules: path.join(REPO, "rules"),
  };
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".md": "text/markdown; charset=utf-8",
    /* The intro page serves a real video; without this it goes out as
     * application/octet-stream and strict browsers (Safari especially) refuse
     * to play it. */
    ".mp4": "video/mp4",
  };

  /* THE PAGE AND THE REFEREE CAN LIVE ON DIFFERENT ORIGINS, and when they do the
   * lobby is dead without this: a browser will open the socket (that gate is
   * Origin-checked separately) but silently refuse to read /api/tables, so the
   * relay-free join path — the fallback for when every relay is down — returns
   * nothing with no error anyone can see.
   *
   * The allowance is EXACTLY the origins a deployment named in TABLE_ORIGINS,
   * echoed back one at a time. No wildcard: `*` would let any page on the
   * internet enumerate open tables and poll finished matches, and the same list
   * already decides who may open a socket, so there is one answer to "who is
   * this table for" rather than two that can drift apart. */
  function corsHeaders(req) {
    const origin = String((req && req.headers && req.headers.origin) || "").toLowerCase();
    if (!origin || !allowedOrigins.has(origin)) return { vary: "origin" };
    return {
      vary: "origin",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-max-age": "600",
    };
  }

  function json(res, code, value, req) {
    const body = JSON.stringify(value);
    res.writeHead(code, Object.assign({
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    }, corsHeaders(req)));
    res.end(body);
  }

  function serveHttp(req, res) {
    /* Every JSON answer carries this request's CORS verdict, so no call site can
     * forget it and quietly break a cross-origin lobby. */
    const reply = (code, value) => json(res, code, value, req);
    if (!requestHostAllowed(req)) return reply(403, { error: "host not allowed" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req)).end();
      return;
    }
    let url;
    let pathname;
    try {
      url = new URL(req.url, "http://localhost");
      pathname = decodeURIComponent(url.pathname);
    } catch (err) {
      return reply(400, { error: "bad url" });
    }
    /* A NUL SURVIVES decodeURIComponent AND THE TRAVERSAL GUARD, and then
     * fs.stat throws SYNCHRONOUSLY — inside the request listener, where nothing
     * catches it. `GET /%00` was one unauthenticated request that dropped the
     * process and every live match with it. Rejected here, before any path is
     * built from it. */
    if (pathname.indexOf("\0") >= 0) return reply(400, { error: "bad url" });

    if (pathname === "/api/health") {
      return reply(200, {
        ok: true,
        matches: matches.size,
        // So the lobby can say "2 players searching" before anyone commits to
        // waiting, rather than only after they have joined the queue.
        queued: queue.length,
        uptime: Math.round((Date.now() - startedAt) / 1000),
      });
    }
    if (pathname === "/api/tables") {
      // The RELAY-FREE join path: if every relay dies on stage, players still
      // see and join tables.
      return reply(200, q.openTables.all().filter((r) => isHex64(r.seat0_pubkey)).map((r) => {
        const rec = matches.get(r.match_id);
        const host = rec && rec.conns[0];
        return {
          matchId: r.match_id,
          code: r.code,
          name: r.seat0_name,
          pubkey: r.seat0_pubkey,
          affinity: r.seat0_affinity,
          createdAt: r.created_at,
          stake: Number.isInteger(r.stake) ? r.stake : 0,
          /* Whether anyone is actually sitting there. A code whose host closed
           * the tab looks identical to a live one in a bare list, and joining it
           * is a wait with no end. */
          hostOnline: Boolean(host && host.readyState === 1),
        };
      }));
    }
    if (pathname.startsWith("/api/match/")) {
      const id = pathname.slice("/api/match/".length);
      const row = q.byId.get(id);
      if (!row) return reply(404, { error: "NO_SUCH_MATCH" });
      /* OUT-OF-BAND VERIFICATION IS A POST-MATCH ACT. `config` carries the two
       * hidden seeds, which generate both decklists, both shuffles and every
       * future draw — anyone holding them can reconstruct the opponent's hand
       * for the rest of the match. matchId is not a secret: it is in every
       * STATE and, while the table is open, in /api/tables. So nothing that
       * describes a LIVE match is served here. The entries are gated with it:
       * a transcript is the opponent's actions.
       * The full bundle still reaches both seats in OVER, and lands here the
       * moment the match is finished, which is when verification is the point. */
      if (row.status !== "over") {
        return reply(200, {
          matchId: row.match_id,
          status: row.status,
          headSeq: row.head_seq,
          headHash: row.head_hash,
          publicHash: row.public_hash,
        });
      }
      return reply(200, {
        matchId: row.match_id,
        status: row.status,
        config: row.config_json === "{}" ? null : JSON.parse(row.config_json),
        entries: readLog(id),
        result: row.result_json ? JSON.parse(row.result_json) : null,
        verify: row.verify_json ? JSON.parse(row.verify_json) : null,
        transcriptHash: row.transcript_hash,
        headHash: row.head_hash,
        publicHash: row.public_hash,
        // The signable bytes, so the closing beat is recoverable even from a
        // cold page that never held a socket when the match ended.
        resultContent: row.result_content || null,
        resultTags: row.result_tags_json ? JSON.parse(row.result_tags_json) : null,
        resultCreatedAt: row.result_created_at === null ? null : row.result_created_at,
      });
    }

    /* The site root is the cinematic gate: intro.html plays the film, then its
     * Skip/end opens index.html. The homepage stays reachable at /index.html
     * with all its links and metadata unchanged. */
    const rel = pathname === "/" ? "intro.html" : pathname.replace(/^\/+/, "");
    const head = rel.split("/")[0];
    const root = STATIC_ROOTS[head] ? REPO : siteDir;
    const file = path.resolve(root, rel);
    // Traversal guard: a resolved path outside the allowed roots is a 403,
    // never a read.
    const allowed = [siteDir, ...Object.values(STATIC_ROOTS)];
    if (!allowed.some((base) => file === base || file.startsWith(base + path.sep))) {
      res.writeHead(403).end("forbidden");
      return;
    }
    sendFile(req, res, file);
  }

  /* Text assets only. Card art and world plates are already compressed formats;
   * gzipping them burns CPU to make them very slightly larger. */
  const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".md"]);
  /* Compressing engine.js on every request is 300 KB of pointless work, and the
   * site is a fixed, small set of files. Keyed by mtime so an edit invalidates
   * itself — this must never serve yesterday's play.js during development. */
  const gzipCache = new Map();

  /* THE TABLE SHIPPED ~3.9 MB OF UNCOMPRESSED JS ON EVERY SINGLE NAVIGATION.
   * `cache-control: no-cache` does not mean "do not store" — it means "ask me
   * first" — so pairing it with an ETag keeps every asset always-fresh (a stale
   * play.js against a new engine.js is a desync, never worth risking) while
   * turning a repeat visit into a 304 with no body at all. Compression handles
   * the first visit; revalidation handles the rest. */
  function sendFile(req, res, file) {
    fs.stat(file, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
      const base = {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": "no-cache",
        etag,
        vary: "accept-encoding",
      };
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, base).end();
        return;
      }
      /* Binary assets — video, images, fonts — are STREAMED with Range support,
       * never read whole into memory. A 28 MB intro video must seek, Safari
       * refuses a <video> whose server does not answer 206, and buffering the
       * file per request is memory the referee should not spend. Compressible
       * text keeps the gzip path below. */
      if (!COMPRESSIBLE.has(ext)) {
        base["accept-ranges"] = "bytes";
        const size = stat.size;
        let start = 0;
        let end = size - 1;
        let status = 200;
        const range = req.headers["range"];
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (!m || (m[1] === "" && m[2] === "")) {
            res.writeHead(416, Object.assign({}, base, { "content-range": `bytes */${size}` })).end();
            return;
          }
          if (m[1] === "") start = Math.max(0, size - Number(m[2]));
          else {
            start = Number(m[1]);
            if (m[2] !== "") end = Math.min(end, Number(m[2]));
          }
          if (start > end || start >= size) {
            res.writeHead(416, Object.assign({}, base, { "content-range": `bytes */${size}` })).end();
            return;
          }
          status = 206;
          base["content-range"] = `bytes ${start}-${end}/${size}`;
        }
        res.writeHead(status, Object.assign({}, base, { "content-length": end - start + 1 }));
        if (req.method === "HEAD") return res.end();
        const stream = fs.createReadStream(file, { start, end });
        stream.on("error", () => res.destroy());
        stream.pipe(res);
        return;
      }
      const wantsGzip =
        COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
      const cached = wantsGzip ? gzipCache.get(file) : null;
      if (cached && cached.etag === etag) {
        res.writeHead(200, Object.assign({}, base, {
          "content-encoding": "gzip",
          "content-length": cached.body.length,
        }));
        res.end(cached.body);
        return;
      }
      fs.readFile(file, (err, body) => {
        if (err) {
          res.writeHead(404, { "content-type": "text/plain" }).end("not found");
          return;
        }
        if (!wantsGzip) {
          res.writeHead(200, Object.assign({}, base, { "content-length": body.length }));
          res.end(body);
          return;
        }
        zlib.gzip(body, (zipErr, out) => {
          // A compression failure is not a serving failure: send the bytes.
          if (zipErr) {
            res.writeHead(200, Object.assign({}, base, { "content-length": body.length }));
            res.end(body);
            return;
          }
          if (gzipCache.size > 64) gzipCache.clear();
          gzipCache.set(file, { etag, body: out });
          res.writeHead(200, Object.assign({}, base, {
            "content-encoding": "gzip",
            "content-length": out.length,
          }));
          res.end(out);
        });
      });
    });
  }

  let boundPort = 0;
  /* WHAT AN INVITE ACTUALLY CARRIES. Hardcoding `ws://` and the bound port was
   * right on a LAN and wrong everywhere else: behind a TLS reverse proxy the
   * page is https, the proxy answers on 443, and an invite reading
   * ws://host:8777/ws is BOTH mixed-content-blocked by the browser and aimed at
   * a port the internet cannot reach — silently, because nothing here fails.
   * The scheme and the port are deployment facts, not process facts, so a
   * deployment states them. PUBLIC_URL is the one-variable answer; PUBLIC_HOST
   * alone keeps its old meaning for a LAN or Tailscale table. */
  const publicTableUrl = () => {
    if (publicUrl) return publicUrl;
    const scheme = options.publicScheme === "wss" ? "wss" : "ws";
    const host = options.publicHost || "localhost";
    return `${scheme}://${host}:${boundPort}/ws`;
  };

  recover();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port === undefined ? 8777 : options.port, host, resolve);
  });
  boundPort = server.address().port;

  return {
    port: boundPort,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${boundPort}`,
    wsUrl: `ws://${host === "0.0.0.0" ? "localhost" : host}:${boundPort}/ws`,
    db,
    matches,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) {
        try { ws.terminate(); } catch (err) { /* already gone */ }
      }
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

module.exports = { createTable, pruneAddressRates, KIND_HANDSHAKE, KIND_RESULT, WIRE };

if (require.main === module) {
  const port = Number(process.env.PORT || 8777);
  const dbPath = process.env.DB || path.join(__dirname, "matches.db");
  const pinSeed = process.env.PIN_SEED ? Number(process.env.PIN_SEED) : null;
  /* RATE_MAX exists for headless soak runs, which act far faster than any human.
   * Leave it unset for the demo — the default is what protects the table. */
  const rateMax = process.env.RATE_MAX ? Number(process.env.RATE_MAX) : null;
  const controlMax = process.env.CONTROL_RATE_MAX ? Number(process.env.CONTROL_RATE_MAX) : null;
  const maxPayload = process.env.MAX_PAYLOAD ? Number(process.env.MAX_PAYLOAD) : null;
  const allowedOrigins = process.env.TABLE_ORIGINS
    ? process.env.TABLE_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  createTable({
    port, dbPath, pinSeed, rateMax, controlMax, maxPayload, allowedOrigins,
    /* Behind the prescribed Caddy-on-loopback proxy set TRUST_PROXY=loopback so
     * each real client keeps its own pre-auth rate bucket. Only turn this on when
     * a trusted proxy actually fronts the table; unset, X-Forwarded-For is ignored. */
    trustProxy: process.env.TRUST_PROXY,
    publicHost: process.env.PUBLIC_HOST,
    /* Behind TLS set PUBLIC_URL=wss://your.host/ws — one variable, and the
     * scheme and port stop being guesses. PUBLIC_HOST alone still covers a LAN
     * or Tailscale table on the bound port. */
    publicUrl: process.env.PUBLIC_URL,
    publicScheme: process.env.PUBLIC_SCHEME,
  })
    .then((table) => {
      console.log(`[table] 600B referee on ${table.url}  (ws ${table.wsUrl})`);
      console.log(`[table] db ${dbPath} · catalog ${CATALOG.size} cards ${CATALOG.digest}`);
      if (pinSeed !== null) console.log(`[table] PIN_SEED=${pinSeed} — rehearsed opening`);
    })
    .catch((err) => {
      console.error("[table] failed to start:", err);
      process.exit(1);
    });
}
