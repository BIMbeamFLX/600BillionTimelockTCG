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
  const LS_MATCH = "600b:match";
  const LS_PUBKEY = "600b:pubkey"; // the same key index.html's login writes
  const KIND_HANDSHAKE = 4600;     // invite + accept, discriminated by the t tag
  const KIND_RESULT = 31600;       // addressable, d = matchId
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

  function savedMatch() {
    try {
      const raw = localStorage.getItem(LS_MATCH);
      const value = raw ? JSON.parse(raw) : null;
      return value && typeof value.matchId === "string" ? value : null;
    } catch (err) {
      return null;
    }
  }
  function saveMatch(value) {
    try { localStorage.setItem(LS_MATCH, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }
  function forgetMatch() {
    try { localStorage.removeItem(LS_MATCH); } catch (err) { /* private mode */ }
  }

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
      net.attempt = 0;
      setStatus("live");
      /* One recovery mechanism, used for the very first connection and every one
       * after it: either resume a seat we hold, or replay the intent that has
       * not been answered yet. */
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
      /* 4009 SUPERSEDED: another connection legitimately claimed this seat.
       * Retrying would make two tabs evict each other forever. */
      if (ev && ev.code === 4009) return void setStatus("superseded");
      if (net.status === "gone" || net.status === "superseded") return;
      retry();
    };

    ws.onerror = () => { /* onclose always follows; nothing useful to add here */ };
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
      case "STATE": return onState(msg);
      case "FRAME": return H("onFrame", msg);
      case "REJECT": return H("onReject", msg);
      case "PEER": {
        if (msg.seat === 0 || msg.seat === 1) net.peers[msg.seat] = Boolean(msg.online);
        return H("onPeer", msg);
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
    /* Auto-open, no click: after a reload on stage the presenter should see the
     * board, not a dialog. */
    net.url = net.session.table || tableUrl();
    open();
    return { resuming: true, matchId: net.session.matchId, seat: net.session.seat };
  }

  function create(opts) {
    net.session = null;
    forgetMatch();
    net.attempt = 0;
    net.intent = {
      t: "CREATE", v: WIRE,
      name: String(opts.name || "Player").slice(0, 40),
      affinity: opts.affinity || "All",
      pubkey: opts.pubkey || null,
    };
    net.url = opts.table || tableUrl();
    if (net.ws && net.ws.readyState === 1) raw(net.intent);
    else open();
  }

  function join(opts) {
    net.session = null;
    forgetMatch();
    net.attempt = 0;
    net.intent = {
      t: "JOIN", v: WIRE,
      code: String(opts.code || "").trim().toUpperCase(),
      name: String(opts.name || "Player").slice(0, 40),
      affinity: opts.affinity || "All",
      pubkey: opts.pubkey || null,
    };
    net.url = opts.table || tableUrl();
    if (net.ws && net.ws.readyState === 1) raw(net.intent);
    else open();
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

  function leave() {
    net.session = null;
    net.intent = null;
    net.lastState = null;
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
    clearTimeout(net.timer);
    net.attempt = 0;
    if (net.ws && net.ws.readyState === 1) {
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
    if (!hasNip07()) throw new Error("no NIP-07 extension — install Alby or nos2x, or play anonymously");
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

  // ----------------------------------------------------------------- exports

  globalThis.E1Net = {
    WIRE,
    KIND_HANDSHAKE,
    KIND_RESULT,
    start, create, join, act, sendNostr, leave, resume, tables,
    tableUrl, publicTable, publicTableIsLocal,
    savedMatch,
    get status() { return net.status; },
    get session() { return net.session; },
    get lastState() { return net.lastState; },
    get peers() { return net.peers.slice(); },
    nostr: {
      hasNip07, login, logout, sign, publish, relays,
      savedPubkey, npub: npubEncode, npubDecode, toHexPubkey, shortNpub,
      inviteEvent, acceptEvent, resultEvent,
      parseInvite, subscribeInvites,
    },
  };
})();
