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
const { DatabaseSync } = require("node:sqlite");
const { WebSocketServer } = require("ws");

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
const RATE_MAX_ACT = 30;
const MINT_ATTEMPTS = 40;
const KIND_HANDSHAKE = 4600;
const KIND_RESULT = 31600;

const nowIso = () => new Date().toISOString();
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const rand32 = () => crypto.randomInt(0, 2 ** 31 - 1);

function makeCode() {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

const isHex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

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
  ended_at        TEXT
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
 * @param {{port?:number, dbPath?:string, siteDir?:string, host?:string, pinSeed?:number}} opts
 */
async function createTable(opts) {
  const options = opts || {};
  const dbPath = options.dbPath || path.join(__dirname, "matches.db");
  const siteDir = options.siteDir || path.join(REPO, "site");
  const host = options.host || "0.0.0.0";
  const pinSeed = Number.isInteger(options.pinSeed) ? options.pinSeed : null;
  /* Generous enough to be invisible to a human, tight enough that a runaway loop
   * cannot wedge the table. Raised only by the headless tests, which act at
   * machine speed and are not the threat model. */
  const rateMax = Number.isInteger(options.rateMax) ? options.rateMax : RATE_MAX_ACT;
  const startedAt = Date.now();

  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(DDL);

  const q = {
    insertMatch: db.prepare(`INSERT INTO matches
      (match_id, code, status, created_at, updated_at, config_json, ruleset, catalog_digest,
       state_json, seat0_name, seat0_affinity, seat0_pubkey, seat0_token, head_seq)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`),
    byCode: db.prepare("SELECT * FROM matches WHERE code = ?"),
    byId: db.prepare("SELECT * FROM matches WHERE match_id = ?"),
    openTables: db.prepare(
      "SELECT match_id, code, created_at, seat0_name, seat0_pubkey, seat0_affinity FROM matches WHERE status = 'open' ORDER BY created_at DESC LIMIT 50"
    ),
    playing: db.prepare("SELECT * FROM matches WHERE status IN ('open','playing')"),
    seatOne: db.prepare(`UPDATE matches SET seat1_name=?, seat1_affinity=?, seat1_pubkey=?,
      seat1_token=?, config_json=?, state_json=?, status='playing', ruleset=?, catalog_digest=?,
      public_hash=?, updated_at=? WHERE match_id=?`),
    setToken: db.prepare("UPDATE matches SET seat0_token = CASE WHEN ?=0 THEN ? ELSE seat0_token END, seat1_token = CASE WHEN ?=1 THEN ? ELSE seat1_token END, updated_at=? WHERE match_id=?"),
    insertEntry: db.prepare(`INSERT INTO entries
      (match_id, seq, seat, at, action_json, prev, state_hash, hash, public_hash, received_at)
      VALUES (?,?,?,'',?,?,?,?,?,?)`),
    updateHead: db.prepare(`UPDATE matches SET head_seq=?, head_hash=?, public_hash=?,
      state_json=?, result_json=?, status=?, updated_at=? WHERE match_id=?`),
    entriesOf: db.prepare("SELECT * FROM entries WHERE match_id = ? ORDER BY seq ASC"),
    insertReject: db.prepare(`INSERT INTO rejects (match_id, at, seat, head_seq, code, message, action_json)
      VALUES (?,?,?,?,?,?,?)`),
    finish: db.prepare(`UPDATE matches SET status='over', result_json=?, verify_json=?,
      transcript_hash=?, head_hash=?, public_hash=?, ended_at=?, updated_at=? WHERE match_id=?`),
    upsertNostr: db.prepare(`INSERT INTO nostr_events
      (match_id, role, pubkey, event_id, kind, created_at, event_json, content, sig_checked, received_at)
      VALUES (?,?,?,?,?,?,?,?,0,?)
      ON CONFLICT(match_id, role, pubkey) DO UPDATE SET
        event_id=excluded.event_id, kind=excluded.kind, created_at=excluded.created_at,
        event_json=excluded.event_json, content=excluded.content, received_at=excluded.received_at`),
    nostrOf: db.prepare("SELECT event_json FROM nostr_events WHERE match_id=? AND role=? ORDER BY created_at ASC"),
    agreement: db.prepare(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT content) AS distinct_content FROM nostr_events WHERE match_id=? AND role='result'"
    ),
  };

  /** matchId -> live record. The DB is the source of truth; this is the hot copy. */
  const matches = new Map();
  const byCode = new Map();

  // ------------------------------------------------------------ match minting

  /* E.createGame THROWS when the auto-built deck contains a Stake card and the
   * Stake module is off (measured: Keys succeeds on 9 of 25 random seeds, All on
   * 21 of 25). Until buildDeckList filters those cards (D-12) the only safe move
   * is to re-roll the seeds until the deck constructs, so the failure can never
   * reach a client. A pinned seed is tried FIRST so the rehearsed demo opening is
   * reproducible. */
  function mintGame(seat0, seat1) {
    const attempts = [];
    if (pinSeed !== null) attempts.push({ public: pinSeed, hidden: [pinSeed + 1, pinSeed + 2] });
    for (let i = 0; i < MINT_ATTEMPTS; i++) {
      attempts.push({ public: rand32(), hidden: [rand32(), rand32()] });
    }
    let last = null;
    for (const seeds of attempts) {
      const config = {
        seats: [
          { name: seat0.name, affinity: seat0.affinity, pubkey: seat0.pubkey },
          { name: seat1.name, affinity: seat1.affinity, pubkey: seat1.pubkey },
        ],
        seeds,
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
      events: [], // unredacted ring
      conns: [null, null],
      spectators: new Set(),
      rate: [[], []],
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
    };
    // The token is a credential; it appears exactly once, in the first STATE of
    // a connection, and never for a spectator.
    if (!spectator && !conn.tokenSent) {
      msg.token = rec.players[seat].token;
      conn.tokenSent = true;
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
    if (!rateOk(rec, conn.seat)) {
      fail(conn.ws, "RATE_LIMITED", "too many actions");
      try { conn.ws.close(4029, "RATE_LIMITED"); } catch (err) { /* already gone */ }
      return;
    }

    /* `at` is hashed by entryHash, so it must be deterministic or replay stops
     * reproducing the chain. Wall clock lives in entries.received_at, outside the
     * hash. Forced here rather than trusted from the client. */
    action.at = "";

    const before = rec.state;
    const r = E.apply(before, action, { authenticatedSeat: conn.seat });
    if (r.error) {
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

  function rateOk(rec, seat) {
    const now = Date.now();
    const hits = rec.rate[seat].filter((t) => now - t < RATE_WINDOW_MS);
    hits.push(now);
    rec.rate[seat] = hits;
    return hits.length <= rateMax;
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
    q.finish.run(
      JSON.stringify(rec.result), JSON.stringify(verify), tHash,
      rec.headHash, rec.publicHash, rec.endedAt, nowIso(), rec.matchId
    );
    rec.status = "over";
    rec.transcriptHash = tHash;
    rec.verify = verify;

    const payload = resultPayload(rec, log, tHash);
    /* Both clients sign these exact bytes. Re-stringifying a parsed object in two
     * browsers is a needless risk; agreement is then a string compare. */
    rec.resultContent = JSON.stringify(payload);
    rec.resultTags = resultTags(rec, payload);
    rec.resultCreatedAt = Math.floor(Date.parse(rec.endedAt) / 1000);

    broadcast(rec, () => ({
      t: "OVER",
      v: WIRE,
      matchId: rec.matchId,
      result: rec.result,
      headHash: rec.headHash,
      publicHash: rec.publicHash,
      transcriptHash: tHash,
      verify: {
        ok: verify.ok,
        divergedAt: verify.divergedAt === undefined ? null : verify.divergedAt,
        headHash: verify.headHash || null,
        error: verify.error || null,
      },
      config: rec.config,
      transcript: log,
      resultTags: rec.resultTags,
      resultContent: rec.resultContent,
      resultCreatedAt: rec.resultCreatedAt,
    }));
  }

  // ------------------------------------------------------------ create / join

  function handleCreate(conn, msg) {
    const name = String(msg.name || "Player").slice(0, 40);
    const affinity = HAND_AFFINITIES.indexOf(msg.affinity) >= 0 ? msg.affinity : "All";
    const pubkey = isHex64(msg.pubkey) ? msg.pubkey : null;
    const matchId = "m_" + hex(6);
    let code = makeCode();
    for (let i = 0; i < 20 && q.byCode.get(code); i++) code = makeCode();
    const token = hex(16);
    const at = nowIso();
    q.insertMatch.run(
      matchId, code, "open", at, at, "{}", "E1.0", CATALOG.digest,
      null, name, affinity, pubkey, token
    );
    const rec = remember(newRecord(q.byId.get(matchId)));
    seat(conn, rec, 0);
    send(conn.ws, stateMessage(rec, conn));
  }

  function handleJoin(conn, msg) {
    const code = String(msg.code || "").trim().toUpperCase();
    const rec = findByCode(code);
    if (!rec) return fail(conn.ws, "NO_SUCH_MATCH", "no table with that code");
    if (rec.status === "over") return fail(conn.ws, "MATCH_OVER", "that match is finished");
    if (rec.players[1]) return fail(conn.ws, "MATCH_FULL", "both seats are taken");

    const name = String(msg.name || "Player").slice(0, 40);
    const affinity = HAND_AFFINITIES.indexOf(msg.affinity) >= 0 ? msg.affinity : "All";
    const pubkey = isHex64(msg.pubkey) ? msg.pubkey : null;
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

  // ---------------------------------------------------------------- resume

  function seat(conn, rec, n) {
    if (conn.rec && conn.rec !== rec) detach(conn);
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
    const rec = loadMatch(String(msg.matchId || ""));
    if (!rec) return fail(conn.ws, "NO_SUCH_MATCH", "unknown match");
    const token = typeof msg.token === "string" ? msg.token : null;
    const pubkey = isHex64(msg.pubkey) ? msg.pubkey : null;

    // The claim ladder, in strict priority order.
    let granted = null;
    let downgradeReason = null;
    let freshToken = false;

    if (token) {
      for (const n of [0, 1]) {
        if (rec.players[n] && rec.players[n].token === token) granted = n;
      }
      if (granted === null) downgradeReason = "unknown token";
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
    if (granted === null && !token && !pubkey) downgradeReason = "no seat credential";

    if (granted === null) {
      // NEVER a hard error: a stranger opening the link mid-match becomes an
      // audience member, not a crash.
      seat(conn, rec, null);
      return send(conn.ws, stateMessage(rec, conn, { downgraded: true, downgradeReason }));
    }

    if (freshToken) {
      const next = hex(16);
      rec.players[granted].token = next;
      q.setToken.run(granted, next, granted, next, nowIso(), rec.matchId);
    }
    conn.tokenSent = false; // a resumed seat always gets its (possibly new) token
    seat(conn, rec, granted);
    send(conn.ws, stateMessage(rec, conn));
    const other = rec.conns[1 - granted];
    if (other) send(other, { t: "PEER", v: WIRE, seat: granted, online: true });
  }

  // ----------------------------------------------------------------- nostr in

  /* Stored verbatim. The server does NOT verify schnorr signatures (D-11):
   * secp256k1 schnorr is not in node:crypto and a curve dependency days before a
   * demo is unjustified risk. Seat authentication is the server-issued token,
   * full stop; sig_checked = 0 records the limitation honestly. */
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
  const wss = new WebSocketServer({ server, path: "/ws", perMessageDeflate: true });

  wss.on("connection", (ws) => {
    const conn = { ws, rec: null, seat: null, tokenSent: false };
    ws.conn = conn;
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch (err) {
        return fail(ws, "BAD_MESSAGE", "not JSON");
      }
      if (!msg || typeof msg !== "object") return fail(ws, "BAD_MESSAGE", "not an object");
      if (msg.v !== WIRE) return fail(ws, "BAD_VERSION", `this table speaks wire v${WIRE}`);
      try {
        switch (msg.t) {
          case "CREATE": return handleCreate(conn, msg);
          case "JOIN": return handleJoin(conn, msg);
          case "ACT": return handleAct(conn, msg);
          case "RESUME": return handleResume(conn, msg);
          case "NOSTR": return handleNostr(conn, msg);
          default: return fail(ws, "BAD_MESSAGE", `unknown message ${msg.t}`);
        }
      } catch (err) {
        // A referee that dies on a crafted payload is a denial of service.
        console.error("[table] handler threw:", err);
        return fail(ws, "BAD_MESSAGE", String(err && err.message));
      }
    });

    ws.on("close", () => detach(conn));
    ws.on("error", () => detach(conn));
  });

  /* The ONLY reliable way to notice a slept laptop: its TCP connection dies
   * silently and would otherwise look alive forever. Two missed pongs = 30 s. */
  const heartbeat = setInterval(() => {
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
  };

  function json(res, code, value) {
    const body = JSON.stringify(value);
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
  }

  function serveHttp(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch (err) {
      return json(res, 400, { error: "bad url" });
    }
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        matches: matches.size,
        uptime: Math.round((Date.now() - startedAt) / 1000),
      });
    }
    if (pathname === "/api/tables") {
      // The RELAY-FREE join path: if every relay dies on stage, players still
      // see and join tables.
      return json(res, 200, q.openTables.all().map((r) => ({
        matchId: r.match_id,
        code: r.code,
        name: r.seat0_name,
        pubkey: r.seat0_pubkey,
        affinity: r.seat0_affinity,
        createdAt: r.created_at,
      })));
    }
    if (pathname.startsWith("/api/match/")) {
      const id = pathname.slice("/api/match/".length);
      const row = q.byId.get(id);
      if (!row) return json(res, 404, { error: "NO_SUCH_MATCH" });
      return json(res, 200, {
        matchId: row.match_id,
        status: row.status,
        config: row.config_json === "{}" ? null : JSON.parse(row.config_json),
        entries: readLog(id),
        result: row.result_json ? JSON.parse(row.result_json) : null,
        verify: row.verify_json ? JSON.parse(row.verify_json) : null,
        transcriptHash: row.transcript_hash,
        headHash: row.head_hash,
        publicHash: row.public_hash,
      });
    }

    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
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
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-cache",
      });
      res.end(body);
    });
  }

  let boundPort = 0;
  const publicTableUrl = () => `ws://${options.publicHost || "localhost"}:${boundPort}/ws`;

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

module.exports = { createTable, KIND_HANDSHAKE, KIND_RESULT, WIRE };

if (require.main === module) {
  const port = Number(process.env.PORT || 8777);
  const dbPath = process.env.DB || path.join(__dirname, "matches.db");
  const pinSeed = process.env.PIN_SEED ? Number(process.env.PIN_SEED) : null;
  /* RATE_MAX exists for headless soak runs, which act far faster than any human.
   * Leave it unset for the demo — the default is what protects the table. */
  const rateMax = process.env.RATE_MAX ? Number(process.env.RATE_MAX) : null;
  createTable({ port, dbPath, pinSeed, rateMax, publicHost: process.env.PUBLIC_HOST })
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
