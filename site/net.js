/* 600B Timelock TCG — table transport (client side).
 *
 * The owner's split, honoured exactly:
 *   NOSTR  — the match invite/accept handshake and the signed win/loss result.
 *            Nothing else. No move is ever a relay event.
 *   SOCKET — every play, live, low latency.
 *   SQLITE — lives on the referee; this file never sees it.
 *
 * This module holds NO rules and NO DOM. It is the wire, the reconnect loop and
 * the three nostr moments, exposed as globalThis.E1Net. play.js owns the board;
 * server/table.js owns the state. Protocol: docs/net-protocol.md (normative).
 *
 * Nothing here opens a socket on its own. A page that has never joined a table
 * and carries no ?match/?table in its URL stays completely offline, which is
 * what keeps play.html playable from file:// with no server running. */
(() => {
  "use strict";

  const WIRE = 1;
  const LS_PUBKEY = "600b:pubkey"; // the same key index.html's login writes
  const KIND_HANDSHAKE = 4600;     // invite + accept, discriminated by the t tag
  const KIND_RESULT = 31600;       // addressable, d = matchId
  const KIND_AUTH = 22242;         // NIP-42 ephemeral connection proof
  const KIND_ZAP_REQUEST = 9734;   // NIP-57, the stake settlement the loser signs
  const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
  const BACKOFF = [250, 500, 1000, 2000, 4000];
  const PUBLISH_MS = 3000;
  const INVITE_TTL = 3600;

  // ------------------------------------------------------------------ bech32

  /* Copied from index.html rather than shared. Refactoring a login that works,
   * days before a demo, is not a trade worth making — and net.js must load on
   * play.html, which does not include index.html's inline script. BIP-173. */
  const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(vals) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of vals) {
      const b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  }
  function hrpExpand(hrp) {
    const out = [];
    for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
    out.push(0);
    for (const c of hrp) out.push(c.charCodeAt(0) & 31);
    return out;
  }
  function toWords(bytes) {
    const out = [];
    let acc = 0, bits = 0;
    for (const b of bytes) {
      acc = (acc << 8) | b; bits += 8;
      while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); }
    }
    if (bits) out.push((acc << (5 - bits)) & 31);
    return out;
  }
  function npubEncode(hex) {
    if (!/^[0-9a-f]{64}$/.test(hex || "")) return "";
    const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
    const words = toWords(bytes);
    const vals = hrpExpand("npub").concat(words, [0, 0, 0, 0, 0, 0]);
    const mod = polymod(vals) ^ 1;
    let checksum = "";
    for (let i = 0; i < 6; i++) checksum += B32[(mod >> (5 * (5 - i))) & 31];
    return "npub1" + words.map((w) => B32[w]).join("") + checksum;
  }
  /* The lobby's "challenge an npub" field: humans hold npub1…, the protocol
   * holds hex. Checksum-verified, because a mistyped npub must fail here rather
   * than silently address the invite to nobody. */
  function npubDecode(npub) {
    const value = String(npub || "").trim().toLowerCase();
    if (value.indexOf("npub1") !== 0) return null;
    const body = value.slice(5);
    const words = [];
    for (const ch of body) {
      const index = B32.indexOf(ch);
      if (index < 0) return null;
      words.push(index);
    }
    if (words.length < 7) return null;
    if (polymod(hrpExpand("npub").concat(words)) !== 1) return null;
    const data = words.slice(0, -6);
    let acc = 0, bits = 0;
    const bytes = [];
    for (const w of data) {
      acc = (acc << 5) | w; bits += 5;
      while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
    }
    if (bytes.length !== 32) return null;
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* Accepts either form and returns hex, or null. */
  const toHexPubkey = (value) => {
    const v = String(value || "").trim();
    if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
    return npubDecode(v);
  };

  const shortNpub = (hex) => {
    const np = npubEncode(hex);
    return np ? np.slice(0, 12) + "…" + np.slice(-5) : "";
  };

  // ------------------------------------------------------------------- state

  const net = {
    ws: null,
    url: null,
    status: "idle",   // idle | connecting | live | reconnecting | superseded | gone
    attempt: 0,
    timer: null,
    /* A CREATE or JOIN that has not yet produced a STATE. It is replayed on a
     * reconnect and dropped the moment a STATE lands, so a flapping socket can
     * never open two tables. */
    intent: null,
    session: null,    // {matchId, seat, token, table, code}
    handlers: {},
    lastState: null,
    peers: [false, false],
    authenticated: false,
    /* Where we stand in the matchmaking queue, or null when not searching. */
    queued: null,     // {position, waiting}
    /* Every unfinished match our npub holds a seat at, straight from AUTH_OK.
     * This is what makes a cleared browser recoverable: the seat credential is
     * gone, the seat is not, and signing in is what finds it. */
    active: [],
  };

  const H = (name, arg) => {
    const fn = net.handlers[name];
    if (typeof fn === "function") {
      try { fn(arg); } catch (err) { console.error(`E1Net.${name}`, err); }
    }
  };

  const param = (name) => {
    try { return new URLSearchParams(location.search).get(name); } catch (err) { return null; }
  };

  /* A seat credential is the TAB's, not the browser's — but localStorage is
   * shared by every tab of an origin, and one key held one record. Playing both
   * sides on one machine therefore broke twice over: the second tab resumed on
   * the first tab's token and superseded it, and whichever tab saved last
   * destroyed the other's credential outright, so a reload came back as the
   * wrong seat.
   *
   * So sessionStorage is the store — it is per tab and survives a reload, which
   * is exactly the lifetime a seat has. localStorage keeps a per-seat map purely
   * so a CLOSED browser can still reclaim its seat; entries there are stamped
   * with the tab holding them and a heartbeat, and a tab may only adopt one that
   * has stopped beating. That separates the two situations which look identical
   * in storage: another tab is playing that seat right now (leave it alone and
   * take the free one), versus the browser was closed and reopened (it is ours). */
  const SS_MATCH = "600b:match";   // this tab's live session
  const TAB_KEY = "600b:tab";
  const LS_SEATS = "600b:seats";   // {"<matchId>:<seat>": {…credential, tab, seenAt}}
  const BEAT_MS = 4000;
  const STALE_MS = 12000; // three missed beats — long enough to survive a GC pause

  const readJSON = (store, key) => {
    try {
      const raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  };
  const writeJSON = (store, key, value) => {
    try { store.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode, quota */ }
  };

  function tabId() {
    try {
      let id = sessionStorage.getItem(TAB_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        sessionStorage.setItem(TAB_KEY, id);
      }
      return id;
    } catch (err) {
      return "no-session-storage";
    }
  }

  const seatMap = () => readJSON(localStorage, LS_SEATS) || {};
  const seatKey = (v) => `${v.matchId}:${v.seat}`;

  function savedMatch() {
    // This tab's own session always wins: a reload is not a new player.
    const mine = readJSON(sessionStorage, SS_MATCH);
    if (mine && typeof mine.matchId === "string") return mine;

    /* No session in this tab. Anything in the seat map was left by a tab that is
     * gone (cold restart) or still running (a second tab). Prefer the most
     * recently seen, and only hand over the token if its holder stopped beating. */
    const entries = Object.values(seatMap()).filter((v) => v && typeof v.matchId === "string");
    if (!entries.length) {
      // A seat saved by the previous single-key build, so an upgrade mid-match
      // does not quietly cost someone their table.
      const legacy = readJSON(localStorage, "600b:match");
      return legacy && typeof legacy.matchId === "string" ? legacy : null;
    }
    entries.sort((a, b) => (Number(b.seenAt) || 0) - (Number(a.seenAt) || 0));
    const best = entries[0];
    if (Date.now() - (Number(best.seenAt) || 0) >= STALE_MS) return best;
    // Still live elsewhere: land on the table, but as no one in particular.
    return { matchId: best.matchId, seat: null, token: null, table: best.table, code: best.code || null };
  }

  function saveMatch(value) {
    writeJSON(sessionStorage, SS_MATCH, value);
    if (value && value.seat !== null && value.token) {
      const map = seatMap();
      map[seatKey(value)] = Object.assign({}, value, { tab: tabId(), seenAt: Date.now() });
      writeJSON(localStorage, LS_SEATS, map);
    }
  }

  function forgetMatch() {
    const mine = readJSON(sessionStorage, SS_MATCH);
    try { sessionStorage.removeItem(SS_MATCH); } catch (err) { /* private mode */ }
    if (!mine || mine.seat === null) return;
    const map = seatMap();
    if (map[seatKey(mine)]) {
      delete map[seatKey(mine)];
      writeJSON(localStorage, LS_SEATS, map);
    }
  }

  /* Only the tab that owns a seat beats, and only for its own entry — so a
   * spectator tab never masquerades as the seat holder, and two tabs at one
   * table keep two separate credentials alive.
   *
   * The beat REWRITES a missing entry rather than skipping it. Two tabs each
   * read-modify-write the whole map, so one can clobber the other's entry by
   * writing a copy it read a moment too early; if a beat only ever refreshed an
   * existing entry, whoever lost that race would vanish from storage for good.
   * Restoring it makes the map converge no matter who writes last. */
  const heartbeat = setInterval(() => {
    const s = net.session;
    if (!s || s.seat === null || !s.token) return;
    const map = seatMap();
    const entry = map[seatKey(s)];
    if (entry && entry.tab !== tabId()) return; // another tab owns this seat
    map[seatKey(s)] = Object.assign({}, entry || s, { tab: tabId(), seenAt: Date.now() });
    writeJSON(localStorage, LS_SEATS, map);
  }, BEAT_MS);
  // Under node (the client tests) a bare interval would hold the process open.
  if (heartbeat && typeof heartbeat.unref === "function") heartbeat.unref();

  /* Where the referee is. In order: an explicit ?table=, the table we were last
   * seated at, then the origin that served this page. On file:// there is no
   * third option and the answer is null — no server, no socket, hotseat only. */
  function tableUrl() {
    const q = param("table");
    if (q) return q;
    const saved = savedMatch();
    if (saved && saved.table) return saved.table;
    if (location.protocol === "https:") return `wss://${location.host}/ws`;
    if (location.protocol === "http:") return `ws://${location.host}/ws`;
    return null;
  }

  const httpOrigin = (wsUrl) => String(wsUrl || "").replace(/^ws/, "http").replace(/\/ws$/, "");

  const isLoopback = (url) => {
    try {
      const host = new URL(url).hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch (err) {
      return false;
    }
  };

  /* Which URL to WRITE INTO AN INVITE. The referee advertises STATE.table from
   * its own PUBLIC_HOST, which defaults to localhost — and a loopback address in
   * an invite is unjoinable from the other machine, silently. So: prefer a
   * non-loopback advertised URL, else the URL we ourselves connected through,
   * else say plainly that this table is only reachable from this machine. */
  function publicTable() {
    const advertised = net.lastState && net.lastState.table;
    const ours = net.url || tableUrl(); // answerable before a socket exists
    if (advertised && !isLoopback(advertised)) return advertised;
    if (ours && !isLoopback(ours)) return ours;
    return advertised || ours || null;
  }
  const publicTableIsLocal = () => isLoopback(publicTable());

  function setStatus(status) {
    if (net.status === status) return;
    net.status = status;
    H("onStatus", { status, attempt: net.attempt, session: net.session });
  }

  // ------------------------------------------------------------------ socket

  function open() {
    if (net.ws && (net.ws.readyState === 0 || net.ws.readyState === 1)) return;
    if (net.session && net.session.matchId && !savedPubkey()) {
      setStatus("idle");
      H("onError", { code: "NIP07_REQUIRED", message: "sign in with NIP-07 before opening a remote table" });
      return;
    }
    const url = net.url || tableUrl();
    if (!url) {
      H("onError", { code: "NO_TABLE", message: "no table server for this page — open it over http, or pass ?table=" });
      return;
    }
    net.url = url;
    setStatus(net.attempt ? "reconnecting" : "connecting");
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      return retry();
    }
    net.ws = ws;

    ws.onopen = () => {
      net.authenticated = false;
      // The referee sends a one-use NIP-42 challenge. No table intent leaves
      // this browser until the NIP-07 extension has signed it and the referee
      // has verified the Schnorr signature.
    };

    const sendIntent = () => {
      if (net.session && net.session.matchId) {
        const hello = { t: "RESUME", v: WIRE, matchId: net.session.matchId };
        if (net.session.token) hello.token = net.session.token;
        const pubkey = savedPubkey();
        if (pubkey) hello.pubkey = pubkey;
        raw(hello);
      } else if (net.intent) {
        raw(net.intent);
      }
    };

    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch (err) { return; }
      if (!msg || msg.v !== WIRE) return;
      receive(msg);
    };

    ws.onclose = (ev) => {
      net.ws = null;
      net.authenticated = false;
      /* 4009 SUPERSEDED: another connection legitimately claimed this seat.
       * Retrying would make two tabs evict each other forever. */
      if (ev && ev.code === 4009) return void setStatus("superseded");
      if (net.status === "gone" || net.status === "superseded") return;
      retry();
    };

    ws.onerror = () => { /* onclose always follows; nothing useful to add here */ };

    async function answerAuth(msg) {
      const pubkey = savedPubkey();
      if (!pubkey || !hasNip07() || !globalThis.nostr.signEvent) {
        H("onError", { code: "NIP07_REQUIRED", message: "a NIP-07 signer is required for online play" });
        return;
      }
      if (!/^[0-9a-f]{64}$/.test(msg.challenge || "") || typeof msg.relay !== "string") {
        H("onError", { code: "AUTH_FAILED", message: "the table sent an invalid login challenge" });
        return;
      }
      try {
        const event = await sign({
          kind: KIND_AUTH,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["relay", msg.relay], ["challenge", msg.challenge]],
          content: "",
        });
        if (!event || event.pubkey !== pubkey) throw new Error("the signer returned a different identity");
        raw({ t: "AUTH", v: WIRE, event });
      } catch (err) {
        H("onError", { code: "AUTH_FAILED", message: String(err && err.message || err) });
      }
    }

    function acceptAuth(msg) {
      const pubkey = savedPubkey();
      if (!pubkey || msg.pubkey !== pubkey) {
        H("onError", { code: "IDENTITY_MISMATCH", message: "the referee authenticated a different identity" });
        return;
      }
      net.authenticated = true;
      net.attempt = 0;
      /* THE GREETING CARRIES THE SESSION. A seat token lives in one browser; the
       * seat belongs to an npub. This list is how a cleared profile, a private
       * window or a different machine finds its way back to a match in progress. */
      net.active = Array.isArray(msg.active) ? msg.active : [];
      setStatus("live");
      H("onActive", net.active.slice());
      sendIntent();
    }

    ws.answerAuth = answerAuth;
    ws.acceptAuth = acceptAuth;
  }

  /* Forever, no give-up state and no dialog: on stage the board stays on screen,
   * stale but readable, and the chip says "reconnecting". */
  function retry() {
    if (!net.session && !net.intent) return void setStatus("idle");
    const base = BACKOFF[Math.min(net.attempt, BACKOFF.length - 1)];
    net.attempt += 1;
    const wait = Math.round(base * (0.8 + Math.random() * 0.4));
    setStatus("reconnecting");
    clearTimeout(net.timer);
    net.timer = setTimeout(open, wait);
  }

  function raw(msg) {
    if (!net.ws || net.ws.readyState !== 1) return false;
    net.ws.send(JSON.stringify(msg));
    return true;
  }

  function receive(msg) {
    switch (msg.t) {
      case "AUTH": return net.ws && net.ws.answerAuth ? net.ws.answerAuth(msg) : undefined;
      case "AUTH_OK": return net.ws && net.ws.acceptAuth ? net.ws.acceptAuth(msg) : undefined;
      case "STATE": return onState(msg);
      case "FRAME": return H("onFrame", msg);
      case "REJECT": return H("onReject", msg);
      case "PEER": {
        if (msg.seat === 0 || msg.seat === 1) net.peers[msg.seat] = Boolean(msg.online);
        return H("onPeer", msg);
      }
      case "QUEUED": {
        net.queued = msg.queued ? { position: msg.position, waiting: msg.waiting } : null;
        /* A queue intent that has been answered by a seat is spent. One that is
         * still waiting must survive a dropped socket, or a reconnect silently
         * drops the player out of the line they are staring at. */
        if (!msg.queued) net.intent = null;
        return H("onQueued", msg);
      }
      case "OVER": return H("onOver", msg);
      case "NOSTR": return H("onNostr", msg);
      case "ERROR": return onError(msg);
      default: return undefined;
    }
  }

  function onState(msg) {
    net.intent = null; // answered; never replay it
    net.lastState = msg;
    if (msg.seat === 0 || msg.seat === 1) {
      const next = {
        matchId: msg.matchId,
        seat: msg.seat,
        token: msg.token || (net.session && net.session.token) || null,
        table: net.url,
        code: msg.code || null,
      };
      net.session = next;
      saveMatch(next);
    } else {
      // A spectator keeps enough to reconnect, but holds no credential.
      net.session = { matchId: msg.matchId, seat: null, token: null, table: net.url, code: msg.code || null };
    }
    for (const p of msg.players || []) net.peers[p.seat] = Boolean(p.online);
    H("onState", msg);
  }

  function onError(msg) {
    /* A stale match in localStorage against a fresh database would otherwise
     * retry forever. Drop the credential, tell the page, stop. */
    if (msg.code === "NO_SUCH_MATCH" || msg.code === "BAD_TOKEN" || msg.code === "MATCH_OVER") {
      if (net.session) {
        net.session = null;
        forgetMatch();
      }
      net.intent = null;
      setStatus("gone");
    }
    H("onError", msg);
  }

  // -------------------------------------------------------------- public API

  function start(handlers) {
    net.handlers = handlers || {};
    const saved = savedMatch();
    const fromUrl = param("match");
    if (fromUrl) {
      // A shared link beats a stale local session for the same page.
      net.session = saved && saved.matchId === fromUrl
        ? saved
        : { matchId: fromUrl, seat: null, token: null, table: tableUrl(), code: param("code") || null };
    } else if (saved) {
      net.session = saved;
    }
    if (!net.session) return { resuming: false };
    if (!savedPubkey()) {
      H("onError", { code: "NIP07_REQUIRED", message: "sign in with NIP-07 before opening a remote table" });
      return { resuming: false, loginRequired: true, matchId: net.session.matchId, seat: net.session.seat };
    }
    /* Auto-open, no click: after a reload on stage the presenter should see the
     * board, not a dialog. */
    net.url = net.session.table || tableUrl();
    open();
    return { resuming: true, matchId: net.session.matchId, seat: net.session.seat };
  }

  function create(opts) {
    const pubkey = toHexPubkey(opts && opts.pubkey);
    if (!pubkey) {
      H("onError", { code: "NIP07_REQUIRED", message: "sign in with NIP-07 before creating a table" });
      return false;
    }
    net.session = null;
    forgetMatch();
    net.attempt = 0;
    net.intent = {
      t: "CREATE", v: WIRE,
      name: String(opts.name || "Player").slice(0, 40),
      affinity: opts.affinity || "All",
      pubkey,
    };
    net.url = opts.table || tableUrl();
    if (net.ws && net.ws.readyState === 1 && net.authenticated) raw(net.intent);
    else open();
    return true;
  }

  function join(opts) {
    const pubkey = toHexPubkey(opts && opts.pubkey);
    if (!pubkey) {
      H("onError", { code: "NIP07_REQUIRED", message: "sign in with NIP-07 before joining a table" });
      return false;
    }
    net.session = null;
    forgetMatch();
    net.attempt = 0;
    net.intent = {
      t: "JOIN", v: WIRE,
      code: String(opts.code || "").trim().toUpperCase(),
      name: String(opts.name || "Player").slice(0, 40),
      affinity: opts.affinity || "All",
      pubkey,
    };
    net.url = opts.table || tableUrl();
    if (net.ws && net.ws.readyState === 1 && net.authenticated) raw(net.intent);
    else open();
    return true;
  }

  /* MATCHMAKING. The intent slot is reused deliberately: a player waiting in the
   * line must still be waiting after a dropped socket, and `intent` is already
   * the thing that is replayed once the reconnect authenticates. */
  function queue(opts) {
    const pubkey = toHexPubkey(opts && opts.pubkey);
    if (!pubkey) {
      H("onError", { code: "NIP07_REQUIRED", message: "sign in with NIP-07 before searching for an opponent" });
      return false;
    }
    net.session = null;
    forgetMatch();
    net.attempt = 0;
    net.intent = {
      t: "QUEUE", v: WIRE,
      name: String((opts && opts.name) || "Player").slice(0, 40),
      affinity: (opts && opts.affinity) || "All",
      pubkey,
    };
    net.url = (opts && opts.table) || tableUrl();
    if (net.ws && net.ws.readyState === 1 && net.authenticated) raw(net.intent);
    else open();
    return true;
  }

  function unqueue() {
    net.intent = null;
    net.queued = null;
    return raw({ t: "UNQUEUE", v: WIRE });
  }

  /* Rejoin a match this identity owns a seat at — the row the referee named in
   * AUTH_OK. No token is needed: the signed identity IS the claim. */
  function rejoin(matchId) {
    if (!/^m_[0-9a-f]{12}$/.test(String(matchId || ""))) return false;
    net.intent = null;
    net.queued = null;
    net.session = { matchId, seat: null, token: null, table: net.url || tableUrl(), code: null };
    if (net.ws && net.ws.readyState === 1 && net.authenticated) {
      return raw({ t: "RESUME", v: WIRE, matchId, pubkey: savedPubkey() || undefined });
    }
    net.url = net.session.table;
    open();
    return true;
  }

  /* Actions only, never state. A send while disconnected is DROPPED, not queued:
   * its seq has almost certainly moved on and the referee would reject it. The
   * fresh STATE that follows the reconnect drives whatever comes next. */
  function act(action) {
    return raw({ t: "ACT", v: WIRE, action });
  }

  function sendNostr(role, event) {
    return raw({ t: "NOSTR", v: WIRE, role, event });
  }

  /* Leaving is TOLD to the referee before the socket goes, not merely implied by
   * a closed tab. The two look identical from the far end otherwise, and the
   * difference matters: a dropped socket is someone coming back, while a leave
   * means an open table nobody is sitting at should stop being advertised. */
  function leave() {
    raw({ t: "LEAVE", v: WIRE });
    net.session = null;
    net.intent = null;
    net.lastState = null;
    net.queued = null;
    forgetMatch();
    setStatus("gone");
    try { if (net.ws) net.ws.close(1000, "left"); } catch (err) { /* already gone */ }
    net.ws = null;
    clearTimeout(net.timer);
    net.status = "idle";
  }

  function resume() {
    // The panic button: force a fresh RESUME without waiting for the backoff.
    if (!net.session) return false;
    if (!savedPubkey()) {
      H("onError", { code: "NIP07_REQUIRED", message: "sign in with NIP-07 before opening a remote table" });
      return false;
    }
    clearTimeout(net.timer);
    net.attempt = 0;
    if (net.ws && net.ws.readyState === 1 && net.authenticated) {
      const hello = { t: "RESUME", v: WIRE, matchId: net.session.matchId };
      if (net.session.token) hello.token = net.session.token;
      const pubkey = savedPubkey();
      if (pubkey) hello.pubkey = pubkey;
      return raw(hello);
    }
    try { if (net.ws) net.ws.close(); } catch (err) { /* already gone */ }
    net.ws = null;
    open();
    return true;
  }

  /* The relay-free join path. If every relay dies on stage, players still see
   * and join open tables. */
  async function tables() {
    const origin = httpOrigin(net.url || tableUrl());
    if (!origin) return [];
    const res = await fetch(origin + "/api/tables", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // ------------------------------------------------------------------- nostr

  const hasNip07 = () => Boolean(globalThis.nostr && globalThis.nostr.getPublicKey);

  function savedPubkey() {
    try {
      const v = localStorage.getItem(LS_PUBKEY);
      return /^[0-9a-f]{64}$/.test(v || "") ? v : null;
    } catch (err) {
      return null;
    }
  }

  async function login() {
    if (!hasNip07()) throw new Error("no NIP-07 extension — install Alby or nos2x to play online");
    const pubkey = await globalThis.nostr.getPublicKey();
    if (!/^[0-9a-f]{64}$/.test(pubkey || "")) throw new Error("the extension returned no usable pubkey");
    try { localStorage.setItem(LS_PUBKEY, pubkey); } catch (err) { /* private mode */ }
    return pubkey;
  }

  function logout() {
    try { localStorage.removeItem(LS_PUBKEY); } catch (err) { /* private mode */ }
  }

  async function sign(unsigned) {
    if (!hasNip07() || !globalThis.nostr.signEvent) throw new Error("no NIP-07 signer");
    return globalThis.nostr.signEvent(unsigned);
  }

  function relays() {
    const override = param("relay");
    return override ? [override] : RELAYS;
  }

  /* Open, EVENT, resolve on OK, close after 3 s regardless. Publishing is
   * fire-and-forget by design: a dead relay degrades the beat, never the match. */
  function publish(event) {
    const urls = relays();
    return new Promise((resolve) => {
      const accepted = [];
      const sockets = [];
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        for (const ws of sockets) { try { ws.close(); } catch (err) { /* already gone */ } }
        resolve({ ok: accepted.length > 0, accepted, tried: urls.length });
      };
      setTimeout(finish, PUBLISH_MS);
      for (const url of urls) {
        try {
          const ws = new WebSocket(url);
          sockets.push(ws);
          ws.onopen = () => ws.send(JSON.stringify(["EVENT", event]));
          ws.onmessage = (m) => {
            try {
              const [type, , ok] = JSON.parse(m.data);
              if (type === "OK" && ok === true && accepted.indexOf(url) < 0) accepted.push(url);
            } catch (err) { /* relays say all sorts of things */ }
          };
          ws.onerror = () => { /* counted by omission */ };
        } catch (err) { /* a bad relay URL is not fatal */ }
      }
    });
  }

  // ---- the three signed moments, and nothing else -------------------------

  function inviteEvent(opts) {
    const now = Math.floor(Date.now() / 1000);
    const tags = [
      ["t", "invite"],
      ["m", opts.matchId],
    ];
    // A p tag makes the invite ADDRESSED, not private: content is plaintext.
    if (/^[0-9a-f]{64}$/.test(opts.to || "")) tags.push(["p", opts.to]);
    tags.push(["expiration", String(now + INVITE_TTL)]); // NIP-40
    tags.push(["alt", "600B Timelock TCG match invite"]);
    return {
      kind: KIND_HANDSHAKE,
      created_at: now,
      tags,
      content: JSON.stringify({
        v: 1,
        kind: "invite",
        matchId: opts.matchId,
        code: opts.code,
        table: opts.table,
        host: { name: opts.name, affinity: opts.affinity },
        ruleset: opts.ruleset,
        catalogDigest: opts.catalogDigest,
        wire: WIRE,
      }),
    };
  }

  function acceptEvent(opts) {
    const now = Math.floor(Date.now() / 1000);
    const tags = [
      ["t", "accept"],
      ["m", opts.matchId],
    ];
    if (/^[0-9a-f]{64}$/.test(opts.to || "")) tags.push(["p", opts.to]);
    if (opts.invite) tags.push(["e", opts.invite]);
    tags.push(["expiration", String(now + INVITE_TTL)]);
    tags.push(["alt", "600B Timelock TCG match accept"]);
    return {
      kind: KIND_HANDSHAKE,
      created_at: now,
      tags,
      content: JSON.stringify({
        v: 1,
        kind: "accept",
        matchId: opts.matchId,
        invite: opts.invite || null,
        table: opts.table,
        guest: { name: opts.name, affinity: opts.affinity },
      }),
    };
  }

  /* EVERY MATCH IS ANNOUNCED AT BOTH ENDS. The start event is the opening
   * bracket the result event closes: it names the two identities, the ruleset
   * and card set they agreed to play under, and the stake they agreed to — all
   * signed BEFORE a card is drawn, so neither side can invent the terms
   * afterwards.
   *
   * Both seats sign byte-identical content, which is only possible because
   * every field comes from the referee's STATE rather than from either browser's
   * clock or key order. `created_at` is derived from the match row for the same
   * reason: two independently signed start events must be comparable. */
  function startEvent(state, stake) {
    const players = (state.players || [])
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, pubkey: p.pubkey || null, name: p.name || null, affinity: p.affinity || null }));
    const createdAt = Math.floor(Date.parse(state.createdAt || "") / 1000);
    const tags = [
      ["t", "start"],
      ["t", "600b-timelock-tcg"],
      ["m", state.matchId],
    ];
    for (const p of players) if (/^[0-9a-f]{64}$/.test(p.pubkey || "")) tags.push(["p", p.pubkey]);
    tags.push(["alt", "600B Timelock TCG match start"]);
    return {
      kind: KIND_HANDSHAKE,
      created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify({
        v: 1,
        kind: "start",
        matchId: state.matchId,
        ruleset: state.ruleset || null,
        catalogDigest: state.catalogDigest || null,
        wire: WIRE,
        players,
        /* The agreed wager, in sats, or null for a friendly. Signed here and
         * nowhere else: this is the only record that both players consented to
         * the amount before they knew how the match would go. */
        stake: Number.isInteger(stake) && stake > 0 ? stake : null,
      }),
    };
  }

  const parseStake = (event) => {
    try {
      const body = JSON.parse(event.content);
      return body && body.kind === "start" && Number.isInteger(body.stake) ? body.stake : null;
    } catch (err) {
      return null;
    }
  };

  /* The referee hands both clients the SAME bytes for tags and content, so two
   * independently signed results are byte-comparable. Re-stringifying a parsed
   * object in two browsers is a needless risk — pass OVER through untouched. */
  function resultEvent(over) {
    return {
      kind: KIND_RESULT,
      created_at: over.resultCreatedAt || Math.floor(Date.now() / 1000),
      tags: over.resultTags,
      content: over.resultContent,
    };
  }

  // ---- incoming invites are UNTRUSTED -------------------------------------

  function parseInvite(event) {
    if (!event || event.kind !== KIND_HANDSHAKE || typeof event.content !== "string") return null;
    let body;
    try { body = JSON.parse(event.content); } catch (err) { return null; }
    if (!body || body.v !== 1 || body.kind !== "invite") return null;
    if (!/^m_[0-9a-f]{12}$/.test(body.matchId || "")) return null;
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(body.code || "")) return null;
    // A table URL out of a stranger's event decides where our socket goes: the
    // scheme is checked before the row is ever offered.
    if (!/^wss?:\/\//.test(body.table || "")) return null;
    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      matchId: body.matchId,
      code: body.code,
      table: body.table,
      host: body.host && typeof body.host === "object" ? body.host : { name: "?", affinity: "?" },
      ruleset: body.ruleset || null,
      catalogDigest: body.catalogDigest || null,
    };
  }

  /* One REQ per relay for invites addressed to me, plus open invites tagged
   * t=invite. Dedup by event id; the caller gets validated rows only. */
  function subscribeInvites(pubkey, onInvite) {
    const seen = Object.create(null);
    const sockets = [];
    const since = Math.floor(Date.now() / 1000) - INVITE_TTL;
    const filter = { kinds: [KIND_HANDSHAKE], "#t": ["invite"], since, limit: 40 };
    if (/^[0-9a-f]{64}$/.test(pubkey || "")) filter["#p"] = [pubkey];
    for (const url of relays()) {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        ws.onopen = () => ws.send(JSON.stringify(["REQ", "inv", filter]));
        ws.onmessage = (m) => {
          try {
            const [type, , event] = JSON.parse(m.data);
            if (type !== "EVENT") return;
            const invite = parseInvite(event);
            if (!invite || seen[invite.id]) return;
            seen[invite.id] = true;
            onInvite(invite);
          } catch (err) { /* relays say all sorts of things */ }
        };
        ws.onerror = () => { /* one dead relay is not a failure */ };
      } catch (err) { /* nor is one bad URL */ }
    }
    return () => { for (const ws of sockets) { try { ws.close(); } catch (err) { /* gone */ } } };
  }

  // ---- reading the record back off the relays -----------------------------

  /* One REQ fanned across every relay, deduped by event id, resolved on EOSE or
   * a deadline — whichever comes first. Fire-and-forget in the same spirit as
   * publish(): a dead relay shortens the answer, it never fails the call. */
  function query(filter, ms) {
    const urls = relays();
    const budget = Number.isFinite(ms) ? ms : PUBLISH_MS;
    return new Promise((resolve) => {
      const seen = Object.create(null);
      const out = [];
      const sockets = [];
      let done = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        for (const ws of sockets) { try { ws.close(); } catch (err) { /* already gone */ } }
        resolve(out);
      };
      setTimeout(finish, budget);
      for (const url of urls) {
        try {
          const ws = new WebSocket(url);
          sockets.push(ws);
          ws.onopen = () => ws.send(JSON.stringify(["REQ", "q", filter]));
          ws.onmessage = (m) => {
            try {
              const frame = JSON.parse(m.data);
              if (frame[0] === "EVENT" && frame[2] && !seen[frame[2].id]) {
                seen[frame[2].id] = true;
                out.push(frame[2]);
              } else if (frame[0] === "EOSE") {
                done += 1;
                if (done >= sockets.length) finish();
              }
            } catch (err) { /* relays say all sorts of things */ }
          };
          ws.onerror = () => { done += 1; };
        } catch (err) { /* a bad relay URL is not fatal */ }
      }
    });
  }

  /* Kind 0 metadata: the display name for the table, and — the reason this
   * exists — the lightning address a winner can actually be paid at. */
  async function profile(pubkey) {
    if (!/^[0-9a-f]{64}$/.test(pubkey || "")) return null;
    const events = await query({ kinds: [0], authors: [pubkey], limit: 4 }, 2500);
    events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    for (const event of events) {
      try {
        const meta = JSON.parse(event.content);
        if (meta && typeof meta === "object") {
          return {
            pubkey,
            name: meta.display_name || meta.name || null,
            picture: typeof meta.picture === "string" ? meta.picture : null,
            lud16: typeof meta.lud16 === "string" ? meta.lud16 : null,
            about: typeof meta.about === "string" ? meta.about : null,
          };
        }
      } catch (err) { /* a profile that is not JSON is a profile we do not have */ }
    }
    return { pubkey, name: null, picture: null, lud16: null, about: null };
  }

  // ---- settlement ---------------------------------------------------------

  /* THE APP NEVER HOLDS, MOVES OR CUSTODIES SATS. It resolves the winner's own
   * lightning address to an invoice and hands that invoice to the loser. Paying
   * it is an act the player takes in their own wallet, with their wallet's own
   * confirmation — there is no escrow to trust, nothing of ours to steal, and a
   * refused zap costs the match nothing because the result is already signed. */
  async function payEndpoint(lud16) {
    const value = String(lud16 || "").trim().toLowerCase();
    const at = value.indexOf("@");
    if (at <= 0) throw new Error("that identity has no lightning address");
    const name = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (!/^[a-z0-9._-]+$/.test(name) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      throw new Error("that lightning address is not a valid one");
    }
    const res = await fetch(`https://${domain}/.well-known/lnurlp/${name}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`the wallet at ${domain} did not answer`);
    const meta = await res.json();
    if (!meta || typeof meta.callback !== "string") throw new Error("that wallet returned no pay endpoint");
    return meta;
  }

  /* NIP-57. Returns a bolt11 the loser may pay, or throws with a reason a human
   * can act on. Nothing is paid here. */
  async function zapInvoice(opts) {
    const sats = Number(opts && opts.sats);
    if (!Number.isInteger(sats) || sats <= 0) throw new Error("a stake must be a whole number of sats");
    const meta = await payEndpoint(opts.lud16);
    const msats = sats * 1000;
    if (Number.isFinite(meta.minSendable) && msats < meta.minSendable) {
      throw new Error(`that wallet's minimum is ${Math.ceil(meta.minSendable / 1000)} sats`);
    }
    if (Number.isFinite(meta.maxSendable) && msats > meta.maxSendable) {
      throw new Error(`that wallet's maximum is ${Math.floor(meta.maxSendable / 1000)} sats`);
    }
    const url = new URL(meta.callback);
    url.searchParams.set("amount", String(msats));
    /* A zap receipt is public and addressed to the winner, so the ladder can see
     * the stake was actually settled. Only public nostr data goes in the URL. */
    if (meta.allowsNostr && /^[0-9a-f]{64}$/.test(meta.nostrPubkey || "") && hasNip07()) {
      try {
        const request = await sign({
          kind: KIND_ZAP_REQUEST,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["p", opts.to],
            ["amount", String(msats)],
            ["relays", ...relays()],
            ["m", opts.matchId || ""],
            ["alt", "600B Timelock TCG stake settlement"],
          ],
          content: opts.comment || "600B Timelock TCG — stake settled",
        });
        url.searchParams.set("nostr", JSON.stringify(request));
      } catch (err) { /* an unsigned zap is still a payment; carry on */ }
    }
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("the wallet would not issue an invoice");
    const body = await res.json();
    if (!body || typeof body.pr !== "string") {
      throw new Error(String((body && body.reason) || "the wallet returned no invoice"));
    }
    return { invoice: body.pr, sats, lud16: String(opts.lud16).toLowerCase() };
  }

  const hasWebln = () => Boolean(globalThis.webln && globalThis.webln.sendPayment);

  /* Called ONLY from an explicit click, and the wallet still asks the player to
   * confirm. There is no code path that pays anything on its own. */
  async function payWithWebln(invoice) {
    if (!hasWebln()) throw new Error("no WebLN wallet in this browser");
    await globalThis.webln.enable();
    return globalThis.webln.sendPayment(invoice);
  }

  // ----------------------------------------------------------------- exports

  globalThis.E1Net = {
    WIRE,
    KIND_HANDSHAKE,
    KIND_RESULT,
    KIND_ZAP_REQUEST,
    start, create, join, act, sendNostr, leave, resume, tables,
    queue, unqueue, rejoin,
    tableUrl, publicTable, publicTableIsLocal,
    savedMatch, saveMatch,
    get status() { return net.status; },
    get session() { return net.session; },
    get lastState() { return net.lastState; },
    get peers() { return net.peers.slice(); },
    get queued() { return net.queued ? Object.assign({}, net.queued) : null; },
    get active() { return net.active.slice(); },
    nostr: {
      hasNip07, login, logout, sign, publish, relays, query, profile,
      savedPubkey, npub: npubEncode, npubDecode, toHexPubkey, shortNpub,
      inviteEvent, acceptEvent, resultEvent, startEvent, parseStake,
      parseInvite, subscribeInvites,
      hasWebln, payEndpoint, zapInvoice, payWithWebln,
    },
  };
})();
