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
 * what keeps play.html playable from file:// with no server running.
 *
 * INSIDE A NAPPLET SHELL the same file runs with a pipe instead of a network:
 * the table socket, the login signature, the identity and the relay traffic all
 * go through site/napplet.js (E1Napplet) when it is loaded, and every one of
 * those seams falls back to exactly the website path when it is not. */
(() => {
  "use strict";

  /* The napplet adapter, when the page loaded it. `present` means a shell object
   * is installed; the table channel can exist without one (a host page carries
   * it), which is why the socket asks the adapter and identity asks `present`. */
  const nap = () => globalThis.E1Napplet || null;
  const inShell = () => Boolean(nap() && nap().present);
  const shellIdentity = () => inShell() && typeof nap().has === "function" && nap().has("identity");
  const shellOutbox = () => inShell() && typeof nap().has === "function" && nap().has("outbox");
  /* Embedded in a shell, or previewed as if (`?embed=1`): the page lives by the
   * shell's rules, which E1Napplet.embedded() answers for every page. */
  const embeddedPage = () => {
    try { return Boolean(nap() && typeof nap().embedded === "function" && nap().embedded()); } catch (err) { return false; }
  };

  /* `localStorage` and `sessionStorage` are GETTERS that throw in a sandboxed
   * frame, at the point of access rather than on use — so they are only ever
   * reached through here, never named at a call site outside a try. */
  const storeOf = (name) => {
    try { return globalThis[name] || null; } catch (err) { return null; }
  };

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

  /* A wager is a whole number of sats or it is a friendly. Anything a text
   * field can produce — blank, a decimal, a minus sign, a word — is 0. */
  const satsOf = (value) => {
    const sats = Math.floor(Number(value));
    return Number.isFinite(sats) && sats > 0 ? sats : 0;
  };

  /* NO STAKES INSIDE A SHELL. A table code handed round a guild's game night must
   * grant a seat and nothing else, so an embedded page creates and queues for a
   * friendly whatever it was asked, and joins with an explicit stake of 0 — which
   * a table that plays for sats refuses with STAKE_MISMATCH instead of binding the
   * guest to its number. The lobby asks stakesAllowed() to hide the stake field. */
  const stakesAllowed = () => !embeddedPage();
  const stakeOf = (value) => (stakesAllowed() ? satsOf(value) : 0);

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
    /* A TABLES request waiting for its answer. Every tables() call made in the
     * meantime waits on the same one, so a lobby cannot spend its allowance
     * twice on one list. */
    tables: null,     // {waiters: [{resolve, reject, timer}], asked}
  };

  const H = (name, arg) => {
    if (name === "onError" && net.tables && endsTableList(arg)) settleTables(null, arg);
    const fn = net.handlers[name];
    if (typeof fn === "function") {
      try { fn(arg); } catch (err) { console.error(`E1Net.${name}`, err); }
    }
  };

  const param = (name) => {
    try { return new URLSearchParams(location.search).get(name); } catch (err) { return null; }
  };

  /* A TABLE CODE IS AN INVITATION: read once, never kept in an address. Inside
   * the Hangar the shell hands it over as a launch argument
   * (window.nappletContext.args.code, nappelin #105) and owns the URL. On the
   * website a share link carries ?code=, which leaves the address bar the first
   * time this page reads it, valid or not, so neither history nor a copied link
   * keeps it. Both are untrusted and checked against the code alphabet. */
  const TABLE_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
  const tableCode = (value) => (typeof value === "string" && TABLE_CODE.test(value) ? value : null);

  let addressCode; // undefined until the address has been read
  function takeAddressCode() {
    if (addressCode !== undefined) return addressCode;
    addressCode = tableCode(param("code"));
    try {
      const url = new URL(location.href);
      if (url.searchParams.has("code")) {
        url.searchParams.delete("code");
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      }
    } catch (err) { /* no address to rewrite: a sandboxed frame, a test */ }
    return addressCode;
  }

  /* The code this page was opened with — the shell's launch argument, else the
   * address's — handed out ONCE; every later call answers null. */
  let launchCodeRead = false;
  function launchCode() {
    if (launchCodeRead) return null;
    launchCodeRead = true;
    let given = null;
    try {
      const context = globalThis.nappletContext;
      given = context && context.args ? context.args.code : null;
    } catch (err) {
      given = null; // a getter that throws hands over nothing
    }
    return tableCode(given) || takeAddressCode();
  }

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
      if (!store) return null;
      const raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  };
  const writeJSON = (store, key, value) => {
    try { if (store) store.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode, quota */ }
  };

  function tabId() {
    try {
      let id = globalThis.sessionStorage.getItem(TAB_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        globalThis.sessionStorage.setItem(TAB_KEY, id);
      }
      return id;
    } catch (err) {
      return "no-session-storage";
    }
  }

  const seatMap = () => readJSON(storeOf("localStorage"), LS_SEATS) || {};
  const seatKey = (v) => `${v.matchId}:${v.seat}`;

  /* INSIDE A SHELL THE SEAT LIVES IN MEMORY, MIRRORED. A sandboxed frame has an
   * opaque origin: localStorage, sessionStorage, caches and navigator.locks all
   * throw there, so neither store above exists. The seat is kept in this
   * frame's memory, which covers everything but a reload, and copied to the
   * shell's own storage (E1Napplet.storage: async, per app, 512 KB) under the
   * website's key and map shape, each entry stamped with the pubkey that holds
   * it. A reloaded frame restores the newest entry of the identity signed in
   * NOW, so a Hangar guest never resumes another key's seat.
   *
   * The mirror is a convenience, not the record: a write that fails costs a
   * reload its auto-resume and nothing more, because AUTH_OK.active still names
   * every seat an identity holds. Two Hangar tabs share one app store, so each
   * write re-reads and merges, leaves entries it did not write alone, and
   * prunes its own beyond MIRROR_MAX. */
  const MIRROR_MAX = 8;
  const mirrored = embeddedPage() && Boolean(nap().storage);
  const memory = { session: null, touched: false, restored: !mirrored, writes: Promise.resolve() };

  const mirrorEntry = (v) => Boolean(v) && typeof v === "object" && typeof v.matchId === "string"
    && (v.seat === 0 || v.seat === 1) && typeof v.token === "string" && /^[0-9a-f]{64}$/.test(v.pubkey || "");
  const newestFirst = (a, b) => (Number(b.seenAt) || 0) - (Number(a.seenAt) || 0);

  function mirrorRead() {
    return Promise.resolve()
      .then(() => nap().storage.json(LS_SEATS, {}))
      .then((map) => (map && typeof map === "object" && !Array.isArray(map) ? map : {}), () => ({}));
  }

  function mirrorWrite(change) {
    memory.writes = memory.writes
      .then(mirrorRead)
      .then((map) => nap().storage.set(LS_SEATS, JSON.stringify(change(map))))
      .catch(() => { /* refused or over budget: memory still holds the seat */ });
  }

  function mirrorSave(value) {
    const pubkey = savedPubkey();
    if (!pubkey || value.seat === null || !value.token) return;
    const entry = {
      matchId: value.matchId, seat: value.seat, token: value.token,
      table: value.table || null, code: value.code || null, pubkey, seenAt: Date.now(),
    };
    mirrorWrite((map) => {
      map[seatKey(entry)] = entry;
      const mine = Object.values(map).filter(mirrorEntry).sort(newestFirst);
      for (const stale of mine.slice(MIRROR_MAX)) delete map[seatKey(stale)];
      return map;
    });
  }

  function savedMatch() {
    if (mirrored) return memory.session ? Object.assign({}, memory.session) : null;
    // This tab's own session always wins: a reload is not a new player.
    const mine = readJSON(storeOf("sessionStorage"), SS_MATCH);
    if (mine && typeof mine.matchId === "string") return mine;

    /* No session in this tab. Anything in the seat map was left by a tab that is
     * gone (cold restart) or still running (a second tab). Prefer the most
     * recently seen, and only hand over the token if its holder stopped beating. */
    const entries = Object.values(seatMap()).filter((v) => v && typeof v.matchId === "string");
    if (!entries.length) {
      // A seat saved by the previous single-key build, so an upgrade mid-match
      // does not quietly cost someone their table.
      const legacy = readJSON(storeOf("localStorage"), "600b:match");
      return legacy && typeof legacy.matchId === "string" ? legacy : null;
    }
    entries.sort((a, b) => (Number(b.seenAt) || 0) - (Number(a.seenAt) || 0));
    const best = entries[0];
    if (Date.now() - (Number(best.seenAt) || 0) >= STALE_MS) return best;
    // Still live elsewhere: land on the table, but as no one in particular.
    return { matchId: best.matchId, seat: null, token: null, table: best.table, code: best.code || null };
  }

  function saveMatch(value) {
    if (mirrored) {
      memory.touched = true;
      memory.session = value ? Object.assign({}, value) : null;
      if (value) mirrorSave(value);
      return;
    }
    writeJSON(storeOf("sessionStorage"), SS_MATCH, value);
    if (value && value.seat !== null && value.token) {
      const map = seatMap();
      map[seatKey(value)] = Object.assign({}, value, { tab: tabId(), seenAt: Date.now() });
      writeJSON(storeOf("localStorage"), LS_SEATS, map);
    }
  }

  function forgetMatch() {
    if (mirrored) {
      const held = memory.session;
      memory.touched = true;
      memory.session = null;
      if (held && held.seat !== null) mirrorWrite((map) => { delete map[seatKey(held)]; return map; });
      return;
    }
    const mine = readJSON(storeOf("sessionStorage"), SS_MATCH);
    try { globalThis.sessionStorage.removeItem(SS_MATCH); } catch (err) { /* private mode */ }
    if (!mine || mine.seat === null) return;
    const map = seatMap();
    if (map[seatKey(mine)]) {
      delete map[seatKey(mine)];
      writeJSON(storeOf("localStorage"), LS_SEATS, map);
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
    if (mirrored) return; // one frame, one seat: nobody to tell apart
    const s = net.session;
    if (!s || s.seat === null || !s.token) return;
    const map = seatMap();
    const entry = map[seatKey(s)];
    if (entry && entry.tab !== tabId()) return; // another tab owns this seat
    map[seatKey(s)] = Object.assign({}, entry || s, { tab: tabId(), seenAt: Date.now() });
    writeJSON(storeOf("localStorage"), LS_SEATS, map);
  }, BEAT_MS);
  // Under node (the client tests) a bare interval would hold the process open.
  if (heartbeat && typeof heartbeat.unref === "function") heartbeat.unref();

  /* Where the referee is. In order: an explicit ?table=, the table we were last
   * seated at, then the origin that served this page. On file:// there is no
   * third option and the answer is null — no server, no socket, hotseat only. */
  function tableUrl() {
    /* ?table= decides where this client's socket goes and, through the NIP-42
     * challenge, what it is asked to sign — so it is validated as a websocket
     * URL rather than passed through. A crafted link cannot make the page dial
     * an http endpoint or a javascript: URI, and the relay-tag check on the
     * login proof is what stops the referee at the other end being an impostor. */
    const q = param("table");
    if (q) return /^wss?:\/\/[^\s]+$/i.test(q) ? q : null;
    const saved = savedMatch();
    if (saved && saved.table) return saved.table;
    /* A napplet build may name its referee outright: a srcdoc frame has no
     * origin to derive one from (`location.protocol` is about:/null there). */
    const injected = globalThis.E1_TABLE_URL;
    if (typeof injected === "string" && /^wss?:\/\/[^\s]+$/i.test(injected)) return injected;
    if (location.protocol === "https:") return `wss://${location.host}/ws`;
    if (location.protocol === "http:") return `ws://${location.host}/ws`;
    if (nap() && typeof nap().embedded === "function" && nap().embedded()) return "wss://tcg.nappelin.com/ws";
    return null;
  }

  const httpOrigin = (wsUrl) => String(wsUrl || "").replace(/^ws/, "http").replace(/\/ws$/, "");

  const hostOf = (url) => {
    try { return new URL(url).host.toLowerCase(); } catch (err) { return null; }
  };

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
      ws = dial(url);
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
      if (net.ws === ws || !net.ws) settleTables(null, { code: "TABLE_CLOSED", message: "the table closed before it sent its list" });
      net.ws = null;
      net.authenticated = false;
      /* 4009 SUPERSEDED: another connection legitimately claimed this seat.
       * Retrying would make two tabs evict each other forever. */
      if (ev && ev.code === 4009) return void setStatus("superseded");
      if (net.status === "gone" || net.status === "superseded") return;
      retry();
    };

    ws.onerror = (err) => {
      /* A socket error is followed by onclose and says nothing more. A HOST
       * refusal (the shell would not open this table) is the one error with a
       * reason worth showing; the shim carries it, a WebSocket never does. */
      if (err && typeof err.message === "string" && err.message) {
        H("onError", { code: "TABLE_REFUSED", message: err.message });
      }
    };

    async function answerAuth(msg) {
      const pubkey = savedPubkey();
      /* The host signs the login for a table IT opened; the website asks NIP-07. */
      const hostSigner = ws && typeof ws.sign === "function" ? ws.sign : null;
      if (!pubkey || !(hostSigner || (hasNip07() && globalThis.nostr && globalThis.nostr.signEvent))) {
        H("onError", { code: "NIP07_REQUIRED", message: "sign in before opening a remote table" });
        return;
      }
      if (!/^[0-9a-f]{64}$/.test(msg.challenge || "") || typeof msg.relay !== "string") {
        H("onError", { code: "AUTH_FAILED", message: "the table sent an invalid login challenge" });
        return;
      }
      /* THE RELAY TAG MUST NAME THE TABLE WE ARE ACTUALLY TALKING TO, and this
       * check is the whole anti-replay property of NIP-42 rather than a
       * formality. Signing whatever the far end asked for meant a hostile table
       * could harvest a challenge from the real referee, serve it here, collect
       * the signature, and replay it to authenticate AS THIS PLAYER — after
       * which AUTH_OK hands over their unfinished matches and the claim ladder
       * hands over the seat.
       *
       * Hosts are compared, not whole URLs: a referee legitimately advertises
       * its PUBLIC_HOST name. If those disagree the login is refused loudly,
       * because a table that cannot name itself correctly is either
       * misconfigured or not the table it claims to be — and both deserve to
       * be seen rather than silently signed. */
      const named = hostOf(msg.relay);
      const dialled = hostOf(net.url);
      if (!named || !dialled || named !== dialled) {
        H("onError", {
          code: "AUTH_FAILED",
          message: `this table asked to be signed in as "${named || msg.relay}" while answering at "${dialled || net.url}" — refusing`,
        });
        return;
      }
      try {
        const login = {
          kind: KIND_AUTH,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["relay", msg.relay], ["challenge", msg.challenge]],
          content: "",
        };
        const event = await (hostSigner ? hostSigner(login) : sign(login));
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
      askTables(); // a list asked for while this socket was still signing in
    }

    ws.answerAuth = answerAuth;
    ws.acceptAuth = acceptAuth;
  }

  /* THE ONE PLACE A TABLE SOCKET IS MADE. Without the adapter it is exactly
   * `new WebSocket(url)`. With it, E1Napplet.table.connect decides: a real
   * socket on the website, or the host page's channel inside a shell — and the
   * result is dressed as a WebSocket (readyState, send, close, on*) so that
   * nothing else in this file knows the difference. `sign` exists only when a
   * host carries the channel: that is who signs the NIP-42 login there. */
  function dial(url) {
    const N = nap();
    if (!(N && N.table && typeof N.table.connect === "function")) return new WebSocket(url);
    const sock = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null };
    const hosted = N.table.available();
    const conn = N.table.connect(url, {
      onOpen() { sock.readyState = 1; if (sock.onopen) sock.onopen(); },
      onMessage(text) { if (sock.onmessage) sock.onmessage({ data: text }); },
      onClose(info) { sock.readyState = 3; if (sock.onclose) sock.onclose(info || {}); },
      onError(message) { if (sock.onerror) sock.onerror({ message: String(message || "") }); },
    });
    sock.send = (text) => conn.send(text);
    sock.close = (code, reason) => { sock.readyState = 2; conn.close(code, reason); };
    if (hosted) sock.sign = (event) => conn.sign(event);
    sock.connection = conn;
    return sock;
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
      case "TABLES": return settleTables(Array.isArray(msg.tables) ? msg.tables : []);
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
    takeAddressCode(); // out of the address bar, whatever else this page does
    /* A shell's seat store answers asynchronously (see `restoring`). Until it has,
     * there is nothing to resume yet: say so, and resume when it answers — unless
     * the page has chosen something else by then, which wins. */
    if (!memory.restored) {
      return {
        resuming: false,
        restoring: restoring.then(() => (net.session || net.intent ? { resuming: false } : resumeSaved())),
      };
    }
    return resumeSaved();
  }

  function resumeSaved() {
    const saved = savedMatch();
    const fromUrl = param("match");
    if (fromUrl) {
      // A shared link beats a stale local session for the same page.
      net.session = saved && saved.matchId === fromUrl
        ? saved
        : { matchId: fromUrl, seat: null, token: null, table: tableUrl(), code: takeAddressCode() };
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
      ...rulesetOf(opts),
      name: String(opts.name || "Player").slice(0, 40),
      affinity: opts.affinity || "All",
      stake: stakeOf(opts.stake),
      deck: deckOf(opts.deck),
      pubkey,
    };
    net.url = opts.table || tableUrl();
    if (net.ws && net.ws.readyState === 1 && net.authenticated) raw(net.intent);
    else open();
    return true;
  }

  /* A STACK THE PLAYER BUILT, on its way to the referee. Sent as a plain list of
   * card ids; absent means "deal me one", which is what every table did before.
   * Nothing is validated here beyond the shape — the referee refuses an illegal
   * Stack, and it is the only place a hand-rolled client cannot talk past. */
  /* The rules a table opens under. Sent only for Fast, so a Classic client's
   * messages are exactly what they always were; the referee may still refuse. */
  const rulesetOf = (opts) => (opts && opts.ruleset === "F1.0" ? { ruleset: "F1.0" } : {});

  const deckOf = (deck) =>
    (Array.isArray(deck) && deck.length ? deck.filter((id) => typeof id === "string") : undefined);

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
      /* Sent as an ACKNOWLEDGEMENT of the wager we were shown, not a request.
       * The referee refuses the join if the table's number has moved, so a
       * shared link can never bind someone to a stake they never saw. Inside a
       * shell that acknowledgement is always 0 (stakeOf). */
      stake: stakeOf(opts.stake),
      deck: deckOf(opts.deck),
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
      ...rulesetOf(opts),
      name: String((opts && opts.name) || "Player").slice(0, 40),
      affinity: (opts && opts.affinity) || "All",
      /* The referee pairs on this, so it is a filter and not a preference: a
       * friendly waits for a friendly, and 500 sats waits for 500 sats. */
      stake: stakeOf(opts && opts.stake),
      /* Paired on too: a Stack somebody built waits for another built Stack. */
      deck: deckOf(opts && opts.deck),
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
  function rejoin(matchId, table) {
    if (!/^m_[0-9a-f]{12}$/.test(String(matchId || ""))) return false;
    /* A match recovered from nostr may live on a referee this page has never
     * spoken to, so the table travels with it — validated, because it came off
     * a relay and decides where our socket goes. */
    const where = /^wss?:\/\//.test(String(table || "")) ? table : net.url || tableUrl();
    net.intent = null;
    net.queued = null;
    net.session = { matchId, seat: null, token: null, table: where, code: null };
    const sameTable = net.ws && net.ws.readyState === 1 && net.authenticated && net.url === where;
    if (sameTable) {
      return raw({ t: "RESUME", v: WIRE, matchId, pubkey: savedPubkey() || undefined });
    }
    // A different referee needs a fresh socket, and its own NIP-42 challenge.
    try { if (net.ws) net.ws.close(1000, "switching tables"); } catch (err) { /* already gone */ }
    net.ws = null;
    net.url = where;
    net.attempt = 0;
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

  /* A SOCKET FOR THE LOBBY, with no table in it yet: it signs in, hears
   * AUTH_OK.active and answers TABLES. Opened only when asked, never on load,
   * and not reopened when it drops — with no session and no intent, retry()
   * lets it go idle. A create, join, queue or rejoin afterwards rides on it. */
  function connect(opts) {
    if (net.ws && (net.ws.readyState === 0 || net.ws.readyState === 1)) return true;
    if (!savedPubkey()) {
      /* The shell's identity answers asynchronously: a lobby that asks the moment
       * it loads waits for that first answer instead of being told to sign in. */
      if (!shellPubkeyAsked) {
        shellPubkeyKnown.then(() => connect(opts));
        return true;
      }
      H("onError", { code: "NIP07_REQUIRED", message: "sign in before opening a remote table" });
      return false;
    }
    const url = (opts && opts.table) || net.url || tableUrl();
    if (!url) {
      H("onError", { code: "NO_TABLE", message: "no table server for this page — open it over http, or pass ?table=" });
      return false;
    }
    net.url = url;
    net.attempt = 0;
    open();
    return true;
  }

  const live = () => Boolean(net.ws && net.ws.readyState === 1 && net.authenticated);

  /* A page whose table socket a HOST carries (site/napplet.js, "the table
   * channel") has no network of its own: no HTTP to the referee, no relays. */
  const hostCarried = () => {
    try {
      const N = nap();
      return Boolean(N && N.table && typeof N.table.available === "function" && N.table.available());
    } catch (err) {
      return false;
    }
  };

  /* The errors that end a table list still waiting: the socket could not open
   * or sign in, the referee refused the list, or it is too old to know TABLES. */
  const TABLE_LIST_ENDERS = ["NIP07_REQUIRED", "AUTH_FAILED", "IDENTITY_MISMATCH", "RATE_LIMITED", "NO_TABLE", "TABLE_REFUSED"];
  function endsTableList(error) {
    if (!error) return false;
    if (TABLE_LIST_ENDERS.indexOf(error.code) >= 0) return true;
    return error.code === "BAD_MESSAGE" && /TABLES/.test(String(error.message || ""));
  }

  function settleTables(rows, error) {
    const pending = net.tables;
    if (!pending) return;
    net.tables = null;
    for (const waiter of pending.waiters) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(Object.assign(new Error(String(error.message || error.code)), { code: error.code }));
      else waiter.resolve(rows.slice());
    }
  }

  function askTables() {
    if (net.tables && !net.tables.asked) net.tables.asked = raw({ t: "TABLES", v: WIRE });
  }

  /* THE OPEN-TABLE LIST. An open, signed-in socket is asked first (TABLES), so
   * a player already connected needs nothing more. Without one, the website
   * reads /api/tables, the relay-free join path; a page whose socket a host
   * carries cannot, so it opens a lobby socket (connect) and asks there. Both
   * answer the same rows. A socket list that cannot be had rejects with an
   * Error carrying `code` (NIP07_REQUIRED, RATE_LIMITED, TABLE_CLOSED, TIMEOUT…),
   * and never hangs past TABLES_MS. */
  const TABLES_MS = 15000;
  function tables() {
    if (!live() && !hostCarried()) return tablesOverHttp();
    return new Promise((resolve, reject) => {
      if (!net.tables) net.tables = { waiters: [], asked: false };
      const waiter = { resolve, reject, timer: null };
      net.tables.waiters.push(waiter);
      waiter.timer = setTimeout(() => {
        const pending = net.tables;
        if (pending && pending.waiters.indexOf(waiter) >= 0) {
          pending.waiters.splice(pending.waiters.indexOf(waiter), 1);
          if (!pending.waiters.length) net.tables = null;
        }
        reject(Object.assign(new Error("the table did not send its list in time"), { code: "TIMEOUT" }));
      }, TABLES_MS);
      if (waiter.timer && typeof waiter.timer.unref === "function") waiter.timer.unref();
      if (live()) askTables();
      else connect(); // a refusal to connect is reported, and ends this list through H
    });
  }

  /* The relay-free join path. If every relay dies on stage, players still see
   * and join open tables. */
  async function tablesOverHttp() {
    const origin = httpOrigin(net.url || tableUrl());
    if (!origin) return [];
    const res = await fetch(origin + "/api/tables", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // ------------------------------------------------------------------- nostr

  /* "Is there an identity to play online with?" — a NIP-07 extension on the
   * website, the shell's signed-in key inside one. The name is historical. */
  const hasNip07 = () => {
    if (shellIdentity()) return nap().identity.source() !== "none";
    return Boolean(globalThis.nostr && globalThis.nostr.getPublicKey);
  };

  /* The shell's pubkey lives in memory: `localStorage` throws in a sandboxed
   * frame, and the key is the shell's to remember anyway. Warmed at load so a
   * page that asks synchronously (start, create) finds it without a click. */
  let shellPubkey = null;
  let shellPubkeyAsked = !shellIdentity(); // nothing to wait for outside a shell
  const shellPubkeyKnown = shellIdentity()
    ? Promise.resolve()
      .then(() => nap().identity.current())
      .then((key) => { if (key && !shellPubkey) shellPubkey = key; }, () => {})
      .then(() => { shellPubkeyAsked = true; })
    : Promise.resolve();

  /* A RELOADED FRAME COMES BACK TO ITS SEAT. The mirror and the shell's identity
   * both answer asynchronously: once both have, the newest mirrored seat of the
   * identity signed in now becomes this frame's session, and start() — which may
   * have run already and returned `restoring` — resumes it. Anything the page
   * chose meanwhile (create, join, queue, rejoin, leave) wins over the mirror. */
  const restoring = mirrored
    ? Promise.all([shellPubkeyKnown, mirrorRead()]).then(([, map]) => {
      const pubkey = savedPubkey();
      const newest = Object.values(map)
        .filter((entry) => mirrorEntry(entry) && entry.pubkey === pubkey)
        .sort(newestFirst)[0];
      if (newest && !memory.touched && !net.session && !net.intent) {
        memory.session = {
          matchId: newest.matchId, seat: newest.seat, token: newest.token,
          table: newest.table || null, code: newest.code || null,
        };
      }
    }).catch(() => { /* nothing to restore is an answer too */ }).then(() => { memory.restored = true; })
    : Promise.resolve();

  function savedPubkey() {
    if (shellIdentity()) return shellPubkey;
    try {
      const v = localStorage.getItem(LS_PUBKEY);
      return /^[0-9a-f]{64}$/.test(v || "") ? v : null;
    } catch (err) {
      return null;
    }
  }

  async function login() {
    if (shellIdentity()) {
      shellPubkey = await nap().identity.login(); // rejects when nobody is signed in to the shell
      return shellPubkey;
    }
    if (!hasNip07()) throw new Error("no NIP-07 extension — install Alby or nos2x to play online");
    const pubkey = await globalThis.nostr.getPublicKey();
    if (!/^[0-9a-f]{64}$/.test(pubkey || "")) throw new Error("the extension returned no usable pubkey");
    try { localStorage.setItem(LS_PUBKEY, pubkey); } catch (err) { /* private mode */ }
    return pubkey;
  }

  function logout() {
    shellPubkey = null;
    try { localStorage.removeItem(LS_PUBKEY); } catch (err) { /* private mode */ }
  }

  /* Events the host signed on our behalf, by id, with what its fan-out answered:
   * null when a relay took the event, the refusal otherwise. publish() reports
   * that answer rather than asking the host a second time. */
  const hostPublished = new Map();

  async function sign(unsigned) {
    /* THE SHELL HAS NO GENERAL SIGNER. It signs an outbox template (and
     * publishes it in the same breath) and a table login — nothing else. So a
     * handshake or result event is signed BY PUBLISHING IT, and the signed
     * event comes back for the referee's record; a zap request cannot be
     * signed there at all, which is the honest answer for a sandbox with no
     * wallet. Callers keep their sign → publish → sendNostr order untouched. */
    if (shellOutbox() && unsigned
        && (unsigned.kind === KIND_HANDSHAKE || unsigned.kind === KIND_RESULT)) {
      const res = await nap().outbox.publish(unsigned);
      const event = res.event;
      if (!event || typeof event.id !== "string" || typeof event.sig !== "string") {
        throw new Error(res.ok ? "the shell published but returned no signed event" : String(res.error || "the shell declined to publish"));
      }
      /* SIGNED IS NOT PUBLISHED. The host signs before it fans out, and relays
       * that refuse the event do not unsign it: the referee can still record it,
       * and publish() then says no relay took it, which is the website's order. */
      hostPublished.set(event.id, res.ok ? null : String(res.error || "no relay accepted it"));
      return event;
    }
    if (!hasNip07() || !globalThis.nostr || !globalThis.nostr.signEvent) {
      throw new Error(inShell() ? "the shell signs only through outbox.publish and table.sign" : "no NIP-07 signer");
    }
    return globalThis.nostr.signEvent(unsigned);
  }

  /* ?relay= is a developer convenience that routes EVERY relay read and write
   * through one host of the URL's choosing — including the profile lookup that
   * decides who gets paid. It is honoured only for a well-formed wss:/ws: URL,
   * and never silently: a page that is reading from one stranger's relay should
   * be able to say so. */
  function relays() {
    const override = param("relay");
    if (override && /^wss?:\/\/[^\s]+$/i.test(override)) return [override];
    return RELAYS;
  }

  /* Open, EVENT, resolve on OK, close after 3 s regardless. Publishing is
   * fire-and-forget by design: a dead relay degrades the beat, never the match. */
  function publish(event) {
    if (shellOutbox()) return publishThroughShell(event);
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

  /* The shell's outbox: the host signs an UNSIGNED template and fans it out
   * itself, so an event sign() already sent through it is reported as
   * published rather than offered twice. Same result shape as the fan-out. */
  async function publishThroughShell(event) {
    if (event && typeof event.id === "string" && hostPublished.has(event.id)) {
      const refused = hostPublished.get(event.id);
      hostPublished.delete(event.id);
      return refused === null
        ? { ok: true, accepted: ["shell"], tried: 1, event }
        : { ok: false, accepted: [], tried: 1, event, error: refused };
    }
    const res = await nap().outbox.publish(event);
    return { ok: Boolean(res.ok), accepted: res.ok ? ["shell"] : [], tried: 1, event: res.event || event, error: res.error };
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
        /* WHAT THIS TABLE PLAYS FOR. The invite carried no wager at all, so
         * following one off a relay was the one path that could seat a player
         * in a stake they were never shown — the referee refuses a join that
         * names the wrong number, but a client with no number to name simply
         * accepted whatever the host had set. */
        stake: satsOf(opts.stake),
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
        /* THE LOAD-BEARING FIELD FOR RECOVERY. Nostr is the session root: with
         * only a signed-in key, a browser that kept nothing can find its
         * unfinished matches and, from this, know which referee to reconnect
         * to. Taken from the referee's STATE rather than from `publicTable()`,
         * because the two seats may have reached the table by different names
         * and the announcement must be byte-identical to be comparable. */
        table: state.table || null,
        ruleset: state.ruleset || null,
        catalogDigest: state.catalogDigest || null,
        wire: WIRE,
        players,
        /* The agreed wager, in sats, or null for a friendly. Signed here and
         * nowhere else: this is the only record that both players consented to
         * the amount before they knew how the match would go. Taken from the
         * referee's STATE rather than from this browser's input box, so both
         * seats sign the same number even if one of them retyped theirs. */
        stake: satsOf(stake === undefined ? state.stake : stake) || null,
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
    const expiry = Array.isArray(event.tags) && event.tags.find((tag) => tag[0] === "expiration");
    if (expiry && !(Number(expiry[1]) > Math.floor(Date.now() / 1000))) return null;
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
      // Absent on invites from older builds, which is honestly "unknown", not 0.
      stake: Number.isInteger(body.stake) ? body.stake : null,
    };
  }

  /* One REQ per relay for invites addressed to me, plus open invites tagged
   * t=invite. Dedup by event id; the caller gets validated rows only.
   *
   * EVERY ROW IS SIGNATURE-VERIFIED BEFORE IT IS OFFERED, and this is not
   * belt-and-braces. Relays are not required to check signatures and several do
   * not, so without this an invite's `pubkey` is an unverified CLAIM that the
   * lobby renders as an identity — and its `table` is an attacker-chosen
   * destination for our socket, which is precisely the delivery vehicle a
   * challenge-replay attack needs. Shape first, cryptography second: there is
   * no point verifying a signature over something that is not an invite. */
  function subscribeInvites(pubkey, onInvite) {
    const seen = Object.create(null);
    const sockets = [];
    const since = Math.floor(Date.now() / 1000) - INVITE_TTL;
    const filter = { kinds: [KIND_HANDSHAKE], "#t": ["invite"], since, limit: 40 };
    if (/^[0-9a-f]{64}$/.test(pubkey || "")) filter["#p"] = [pubkey];
    const S = globalThis.E1Schnorr;
    if (!S || typeof S.verifyEvent !== "function") {
      /* NO VERIFIER, NO INVITES. Showing unverified rows would be worse than
       * showing none: they look identical to real ones and they point our
       * socket somewhere. */
      H("onError", {
        code: "NO_VERIFIER",
        message: "invites cannot be checked without site/schnorr.js, so none are offered",
      });
      return () => {};
    }
    const offer = (event) => {
      const invite = parseInvite(event);
      if (!invite || seen[invite.id]) return;
      seen[invite.id] = true; // claimed before the await, so two relays cannot race it
      S.verifyEvent(event).then(
        (ok) => { if (ok) onInvite(invite); },
        () => { /* an invite we cannot check is an invite we do not have */ }
      );
    };
    if (inShell()) return subscribeInvitesThroughShell(filter, offer);
    for (const url of relays()) {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        ws.onopen = () => ws.send(JSON.stringify(["REQ", "inv", filter]));
        ws.onmessage = (m) => {
          let event;
          try {
            const frame = JSON.parse(m.data);
            if (frame[0] !== "EVENT") return;
            event = frame[2];
          } catch (err) {
            return; // relays say all sorts of things
          }
          offer(event);
        };
        ws.onerror = () => { /* one dead relay is not a failure */ };
      } catch (err) { /* nor is one bad URL */ }
    }
    return () => { for (const ws of sockets) { try { ws.close(); } catch (err) { /* gone */ } } };
  }

  /* INSIDE A SHELL THE INVITES COME THROUGH ITS OUTBOX, never over a socket of our
   * own: a sandboxed frame has no network. The host verifies what its relays
   * send, but the lobby renders an invite's pubkey as an identity and points our
   * socket at its table, so every row is still parsed and verified here, exactly
   * as off a relay. A shell that cannot subscribe, or that ends the subscription,
   * is reported as INVITES_UNAVAILABLE and lists nothing: never a throw. */
  function subscribeInvitesThroughShell(filter, offer) {
    const N = nap();
    const unavailable = (message) => H("onError", { code: "INVITES_UNAVAILABLE", message });
    let canSubscribe = false;
    try { canSubscribe = Boolean(N.outbox && N.outbox.canSubscribe && N.outbox.canSubscribe()); } catch (err) { canSubscribe = false; }
    if (!canSubscribe) {
      unavailable("this shell offers no relay subscription, so no invites are listed");
      return () => {};
    }
    return N.outbox.subscribe([filter], offer, (reason) => {
      unavailable(`the shell ended the invite subscription (${reason})`);
    });
  }

  // ---- reading the record back off the relays -----------------------------

  /* One REQ fanned across every relay, deduped by event id, resolved on EOSE or
   * a deadline — whichever comes first. Fire-and-forget in the same spirit as
   * publish(): a dead relay shortens the answer, it never fails the call. */
  function query(filter, ms) {
    if (shellOutbox()) return nap().outbox.query(filter, ms);
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

  /* NOSTR IS THE SESSION ROOT. The referee can tell you which of ITS matches
   * you are seated at, which is the fast path and covers a reload. It cannot
   * tell you about a match on a referee you are not currently connected to —
   * and a player who changed machines does not necessarily remember which table
   * they were on. The signed start announcements do: they are addressed to both
   * players, they name the table, and a match with no published result has not
   * ended. That makes an npub, and nothing else, enough to find your way back.
   *
   * Every field here is UNTRUSTED. `table` decides where a socket goes, so its
   * scheme is checked before the row is ever offered — the same rule the invite
   * parser has always applied. */
  async function sessions(pubkey) {
    const key = String(pubkey || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) return [];
    const [rawStarts, rawResults] = await Promise.all([
      query({ kinds: [KIND_HANDSHAKE], "#t": ["start"], "#p": [key], limit: 60 }, 3500),
      query({ kinds: [KIND_RESULT], "#p": [key], limit: 60 }, 3500),
    ]);
    /* Signature-checked before any of it is believed. An unverified start
     * announcement is an attacker-chosen `table` offered to the player as
     * somewhere to reconnect, which is the same trust a relay must never have. */
    const [starts, results] = await Promise.all([
      verifiedEvents(rawStarts, { kind: KIND_HANDSHAKE }),
      verifiedEvents(rawResults, { kind: KIND_RESULT }),
    ]);
    const finished = new Set();
    for (const event of results) {
      for (const tag of event.tags || []) {
        if (Array.isArray(tag) && tag[0] === "d" && typeof tag[1] === "string") finished.add(tag[1]);
      }
    }
    const seen = new Set();
    const out = [];
    for (const event of starts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))) {
      let body;
      try {
        body = JSON.parse(event.content);
      } catch (err) {
        continue;
      }
      if (!body || body.v !== 1 || body.kind !== "start") continue;
      if (!/^m_[0-9a-f]{12}$/.test(body.matchId || "")) continue;
      if (finished.has(body.matchId) || seen.has(body.matchId)) continue;
      if (!/^wss?:\/\//.test(body.table || "")) continue; // where our socket would go
      if (!Array.isArray(body.players) || body.players.length !== 2) continue;
      const mine = body.players.find((p) => p && p.pubkey === key);
      if (!mine) continue; // addressed to us, but not a seat we hold
      seen.add(body.matchId);
      out.push({
        matchId: body.matchId,
        table: body.table,
        seat: mine.seat,
        opponent: (body.players.find((p) => p && p.pubkey !== key) || {}).name || null,
        stake: Number.isInteger(body.stake) ? body.stake : 0,
        startedAt: event.created_at || 0,
      });
    }
    return out;
  }

  /* THIS FUNCTION CHOOSES WHO GETS PAID, so nothing it returns may rest on a
   * relay's word. A REQ's filter is a REQUEST, not a guarantee: a relay may
   * answer with any event it likes, and whoever answered first with the largest
   * created_at used to decide the winner's lightning address. One hostile relay
   * out of three — or a crafted ?relay= — was enough to redirect a stake.
   *
   * So: the kind and the author are re-checked against what we asked for, and
   * the signature is verified here rather than assumed. */
  async function verifiedEvents(events, want) {
    const S = globalThis.E1Schnorr;
    if (!S || typeof S.verifyEvent !== "function") return [];
    const out = [];
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      if (want.kind !== undefined && event.kind !== want.kind) continue;
      if (want.author && event.pubkey !== want.author) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await S.verifyEvent(event)) out.push(event);
    }
    return out;
  }

  /* Kind 0 metadata: the display name for the table, and — the reason this
   * exists — the lightning address a winner can actually be paid at. */
  async function profile(pubkey) {
    if (!/^[0-9a-f]{64}$/.test(pubkey || "")) return null;
    const raw = await query({ kinds: [0], authors: [pubkey], limit: 4 }, 2500);
    const events = await verifiedEvents(raw, { kind: 0, author: pubkey });
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
    /* THE INVOICE IS CHECKED BEFORE IT IS OFFERED. A wallet endpoint answers
     * with a bolt11 and we hand it to a WebLN wallet, some of which approve
     * inside a spending budget without asking — so an endpoint that returned an
     * invoice for a different amount than the one on screen would be paid
     * silently. bolt11 encodes its amount in the human-readable part, which is
     * enough to refuse a mismatch without decoding the whole thing. */
    const billed = bolt11Sats(body.pr);
    if (billed === null) throw new Error("that wallet returned something that is not a lightning invoice");
    if (billed !== 0 && billed !== sats) {
      throw new Error(`that wallet asked for ${billed} sats instead of ${sats} — refusing`);
    }
    return { invoice: body.pr, sats, billed, lud16: String(opts.lud16).toLowerCase() };
  }

  /* The amount out of a bolt11's human-readable part: `lnbc<amount><multiplier>`
   * where the multiplier is m/u/n/p against one bitcoin. Returns sats, 0 for an
   * open-amount invoice, or null if this is not a bolt11 at all. Deliberately
   * only the HRP — the payload is a bech32 TLV stream, and decoding all of it
   * to answer "how much" would be a second parser to get wrong. */
  function bolt11Sats(invoice) {
    const match = /^ln(?:bcrt|tbs|bc|tb)(\d+)?([munp])?1/i.exec(String(invoice || ""));
    if (!match) return null;
    if (!match[1]) return 0; // no amount named: the payer chooses
    const digits = BigInt(match[1]);
    const SATS_PER_BTC = 100000000n;
    const scale = { m: 1000n, u: 1000000n, n: 1000000000n, p: 1000000000000n };
    const unit = (match[2] || "").toLowerCase();
    if (!unit) return Number(digits * SATS_PER_BTC);
    const milliSats = (digits * SATS_PER_BTC * 1000n) / scale[unit];
    return milliSats % 1000n === 0n ? Number(milliSats / 1000n) : Number(milliSats) / 1000;
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
    start, create, join, act, sendNostr, leave, resume, tables, connect,
    queue, unqueue, rejoin, stakesAllowed, launchCode,
    tableUrl, publicTable, publicTableIsLocal,
    savedMatch, saveMatch,
    get status() { return net.status; },
    get session() { return net.session; },
    get lastState() { return net.lastState; },
    get peers() { return net.peers.slice(); },
    get queued() { return net.queued ? Object.assign({}, net.queued) : null; },
    get active() { return net.active.slice(); },
    nostr: {
      hasNip07, login, logout, sign, publish, relays, query, profile, sessions,
      savedPubkey, npub: npubEncode, npubDecode, toHexPubkey, shortNpub,
      inviteEvent, acceptEvent, resultEvent, startEvent, parseStake,
      parseInvite, subscribeInvites,
      hasWebln, payEndpoint, zapInvoice, payWithWebln,
    },
  };
})();
