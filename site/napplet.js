/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — the napplet adapter.
 *
 * The game ships twice from one codebase: as an ordinary website, and as a
 * napplet running inside a shell that hands it capabilities (NAPs) instead of
 * letting it reach the platform directly. This module is the seam. Every page
 * asks THIS for identity, storage, theme, publishing, assets, the table socket
 * and the player's collection, and never touches `localStorage`, `window.nostr`
 * or a bare palette itself.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: a missing capability is a FALLBACK, not
 * a failure. docs/napplet-spec.md fixes what each degradation is, and they are
 * implemented literally — a napplet that white-screens because the shell
 * declined one optional domain is worse than one that quietly does less. The
 * website is simply the case where every optional domain is absent, which is
 * why running as a plain page is not a special mode: it is the fallback path,
 * exercised every time anyone opens the site.
 *
 * Nothing here is async-optional: the shell's storage and identity are
 * promise-based, so this surface is too, even where the fallback could answer
 * instantly. One shape, or every caller grows two branches.
 *
 * Every browser global is reached through `globalThis` on purpose: the tests
 * evaluate this file against a stand-in scope, and a bare `window` would throw
 * there before a single fallback was exercised.
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  /* The nappelin Hangar installs `window.napplet` with ONLY the granted domains
   * as properties (docs/napplet-spec.md, 2026-09-13). The two older names are
   * kept because guessing one is how this silently never activates. */
  const shell = globalThis.napplet || globalThis.Napplet || globalThis.NAPPLET || null;
  const has = (domain) => Boolean(shell && shell[domain]);
  const win = () => globalThis.window || globalThis;

  /* Storage is 512 KB inside a shell (spec, flagged gap 4). That is not a lot,
   * and the failure is silent truncation of somebody's saved Stacks, so the cap
   * is enforced HERE rather than discovered later. */
  const QUOTA = 512 * 1024;

  const FALLBACK_THEME = {
    background: "#09080B",
    text: "#FFF7EC",
    primary: "#FF6A00",
    surface: "#19151F",
    border: "rgba(185,145,228,.27)",
    muted: "#C7BBCC",
  };

  /* nappelin's own tokens (iron, parchment, brass), painted when the game runs
   * inside the Hangar and the shell offers no theme domain of its own. play.html's
   * `html.embedded` CSS block carries the same values as the no-JS fallback. */
  const NAPPELIN_THEME = {
    background: "#0f0c08",
    text: "#ece3d0",
    primary: "#e7bf76",
    surface: "#1a150e",
    border: "rgba(231,191,118,.28)",
    muted: "#c9b48a",
    tokens: {
      "--black": "#0f0c08",
      "--soot": "#15110c",
      "--panel": "#1a150e",
      "--panel-2": "#1f1911",
      "--cream": "#ece3d0",
      "--muted": "#c9b48a",
      "--line": "rgba(231,191,118,.28)",
      "--orange": "#e7bf76",
      "--orange-soft": "#c9973f",
      "--gold": "#e7bf76",
      "--purple": "#c9973f",
      "--purple-deep": "#8f6a2a",
      "--good": "#6de8a6",
    },
  };

  /* Brand-fixed and never themed. A shell may repaint the chrome; it may not
   * repaint what an affinity looks like, because the five Plate colours are how
   * a player reads the board and they must match the printed cards. */
  const AFFINITY = { P: "#F3C244", B: "#F7931A", K: "#FFF7EC", S: "#7447B8", T: "#17BEBB" };

  const HEX64 = /^[0-9a-f]{64}$/;

  const call = (fn, arg) => {
    if (typeof fn !== "function") return;
    try { fn(arg); } catch (err) { /* a handler's error is the handler's problem */ }
  };

  // ------------------------------------------------------------------- embed

  /* Inside a shell: the prelude object is the gate; `nappletContext` exists only
   * for roster launches and is a bonus; `?embed=1` is the local preview. */
  function embedded() {
    if (shell && typeof shell === "object") return true;
    if (globalThis.nappletContext) return true;
    try {
      const search = String((globalThis.location || win().location || {}).search || "");
      return /(?:^\?|[?&])embed=1(?:&|$)/.test(search);
    } catch (err) {
      return false;
    }
  }

  /* The host window, or null when this document IS the top window. */
  const hostWindow = () => {
    const p = globalThis.parent;
    return p && p !== win() && typeof p.postMessage === "function" ? p : null;
  };

  /* Leaving the napplet: the host closes it. On the website there is no host,
   * so the caller keeps its own navigation. */
  function escape() {
    const host = embedded() ? hostWindow() : null;
    if (!host) return false;
    try { host.postMessage({ type: "nappelin.escape" }, "*"); return true; } catch (err) { return false; }
  }

  // ------------------------------------------------------------------ storage

  const localGet = (key) => {
    try { return globalThis.localStorage.getItem(key); } catch (err) { return null; }
  };
  const localSet = (key, value) => {
    try { globalThis.localStorage.setItem(key, value); return true; } catch (err) { return false; }
  };
  const localDel = (key) => {
    try { globalThis.localStorage.removeItem(key); return true; } catch (err) { return false; }
  };

  const storage = {
    async get(key) {
      if (has("storage")) {
        try { return await shell.storage.getItem(key); } catch (err) { return null; }
      }
      return localGet(key);
    },
    async set(key, value) {
      const text = String(value);
      /* Refused loudly rather than truncated quietly: a half-written deck list
       * parses as valid JSON surprisingly often, and then the loss looks like a
       * bug in the game rather than a full disk. */
      if (text.length > QUOTA) throw new Error(`${key} is over the ${QUOTA} byte storage budget`);
      if (has("storage")) {
        try { await shell.storage.setItem(key, text); return true; } catch (err) { return false; }
      }
      return localSet(key, text);
    },
    async remove(key) {
      if (has("storage")) {
        try { await shell.storage.removeItem(key); return true; } catch (err) { return false; }
      }
      return localDel(key);
    },
    async json(key, fallback) {
      const raw = await storage.get(key);
      if (!raw) return fallback === undefined ? null : fallback;
      try { return JSON.parse(raw); } catch (err) { return fallback === undefined ? null : fallback; }
    },
    async setJson(key, value) {
      return storage.set(key, JSON.stringify(value));
    },
  };

  // ----------------------------------------------------------------- identity

  const LS_PUBKEY = "600b:pubkey"; // the key the website's own login already writes

  /* NIP-44 is the only bridge a bearer wallet may use between devices. The
   * npub identifies the encrypted record; it is not a password and cannot open
   * anything. All encryption stays on the host side through this adapter, just
   * like signing. A napplet that does not expose NIP-44 refuses sync with a
   * backup-file fallback -- missing capability never becomes a key leak. */
  const nip44Provider = () => {
    if (has("identity")) {
      const provided = shell.identity.nip44 || shell.nip44;
      if (provided && typeof provided.encrypt === "function"
          && typeof provided.decrypt === "function") return provided;
      return null;
    }
    const provided = globalThis.nostr && globalThis.nostr.nip44;
    return provided && typeof provided.encrypt === "function"
      && typeof provided.decrypt === "function" ? provided : null;
  };

  const nip07 = () => globalThis.nostr || null;

  /* The shell's identity surface is ONE call: `getPublicKey()`, empty string when
   * nobody is signed in. There is no `get()`, no `request()`, no `signEvent` —
   * the host signs only through outbox.publish and table.sign. */
  async function shellPubkey() {
    if (!has("identity") || typeof shell.identity.getPublicKey !== "function") return null;
    try {
      const key = String((await shell.identity.getPublicKey()) || "").toLowerCase();
      return HEX64.test(key) ? key : null;
    } catch (err) {
      return null;
    }
  }

  const identity = {
    /** Where the current identity comes from, for UI that must be honest about it. */
    source() {
      if (has("identity")) return "shell";
      if (nip07() && nip07().getPublicKey) return "nip07";
      return "none";
    },
    /** The signed-in pubkey, or null. Never prompts. */
    async current() {
      if (has("identity")) return shellPubkey();
      const saved = localGet(LS_PUBKEY);
      return HEX64.test(saved || "") ? saved : null;
    },
    /** Asks. May prompt the extension; rejects if nobody can answer. */
    async login() {
      if (has("identity")) {
        /* The shell never prompts from here: signing in is the Hangar's own
         * flow, so an empty answer is reported as exactly that. */
        const key = await shellPubkey();
        if (!key) throw new Error("the shell returned no usable identity — sign in to the shell first");
        return key;
      }
      if (!(nip07() && nip07().getPublicKey)) {
        /* The spec's fallback for a missing identity domain is anonymous
         * labels, and that is right for LOCAL play — but an online seat is
         * bound to a key, so this refuses rather than seating a ghost. */
        throw new Error("no identity: install a NIP-07 extension, or run this inside a napplet shell");
      }
      const key = await nip07().getPublicKey();
      if (!HEX64.test(key || "")) throw new Error("the extension returned no usable pubkey");
      localSet(LS_PUBKEY, key);
      return key;
    },
    /* A general signer exists only as a NIP-07 extension. The shell signs two
     * things and two things only — an outbox template and a table login — and
     * each has its own door (outbox.publish, table.connect().sign). */
    async sign(event) {
      if (nip07() && typeof nip07().signEvent === "function") return nip07().signEvent(event);
      if (shell) throw new Error("the shell signs only through outbox.publish and table.sign");
      throw new Error("no signer available");
    },
    nip44: {
      available: () => Boolean(nip44Provider()),
      async encrypt(pubkey, plaintext) {
        if (!HEX64.test(String(pubkey || ""))) {
          throw new Error("NIP-44 needs a valid recipient pubkey");
        }
        const provider = nip44Provider();
        if (!provider) throw new Error("this signer does not offer NIP-44 encryption");
        return provider.encrypt(pubkey, String(plaintext));
      },
      async decrypt(pubkey, ciphertext) {
        if (!HEX64.test(String(pubkey || ""))) {
          throw new Error("NIP-44 needs a valid sender pubkey");
        }
        const provider = nip44Provider();
        if (!provider) throw new Error("this signer does not offer NIP-44 decryption");
        return provider.decrypt(pubkey, String(ciphertext));
      },
    },
    forget() {
      localDel(LS_PUBKEY);
    },
  };

  // -------------------------------------------------------------------- theme

  /* The shell's palette is mapped onto the SAME custom properties the site's own
   * stylesheet already uses, so a themed napplet and the plain website run one
   * set of rules. The affinity colours are re-asserted afterwards precisely
   * because a shell theme must not be able to reach them. */
  function applyTheme(colors, tokens) {
    const root = globalThis.document && globalThis.document.documentElement;
    if (!root || !root.style || typeof root.style.setProperty !== "function") return;
    const palette = Object.assign({}, FALLBACK_THEME, colors || {});
    /* MAPPED ONTO THE TOKENS THE SITE ACTUALLY USES. An earlier version wrote
     * `primary` to `--orange`, which is only a legacy alias in 600b.css — the
     * single action colour is `--ember`, so a shell theme repainted nothing a
     * player could see. Surfaces are likewise a family, not one token: `--soot`,
     * `--panel-2` and `--steel` are all panel-coloured and were being left
     * behind by the shell's background while `--panel` moved. */
    const map = {
      "--black": palette.background,
      "--cream": palette.text,
      "--ember": palette.primary,
      "--orange": palette.primary, // the legacy alias, kept in step
      "--panel": palette.surface,
      "--panel-2": palette.surface,
      "--soot": palette.surface,
      "--steel": palette.surface,
      "--line": palette.border,
      "--line-strong": palette.border,
      "--muted": palette.muted,
      "--ink-dim": palette.muted,
    };
    for (const [name, value] of Object.entries(map)) root.style.setProperty(name, value);
    // Exact tokens (nappelin's palette names its surfaces individually) win over the family map.
    for (const [name, value] of Object.entries(tokens || {})) root.style.setProperty(name, value);
    for (const [symbol, value] of Object.entries(AFFINITY)) {
      root.style.setProperty(`--plate-${symbol}`, value);
    }
  }

  const theme = {
    tokens: () => Object.assign({}, FALLBACK_THEME),
    affinity: () => Object.assign({}, AFFINITY),
    /** Paint now and repaint on every shell change. Safe to call on any page. */
    start() {
      if (!has("theme")) {
        /* Inside the Hangar with no theme domain the chrome takes nappelin's
         * tokens, not 600B's: the frame sits inside someone else's page. */
        return embedded() ? applyTheme(NAPPELIN_THEME, NAPPELIN_THEME.tokens) : applyTheme(null);
      }
      let current = null;
      try { current = shell.theme.colors ? shell.theme.colors : (shell.theme.get && shell.theme.get()); }
      catch (err) { current = null; }
      applyTheme(current);
      const onChanged = shell.theme.onChanged || shell.themeOnChanged;
      if (typeof onChanged === "function") {
        try { onChanged((next) => applyTheme(next && (next.colors || next))); } catch (err) { /* fixed palette */ }
      }
      return undefined;
    },
  };

  // ------------------------------------------------------------------- outbox

  /* Publishing. Inside a shell this is the outbox NAP: the HOST signs an
   * UNSIGNED template and fans it out to its relays, answering a result message
   * that carries `error` on failure (it never rejects on a relay refusal). On
   * the website it is site/net.js's own relay fan-out. The spec's fallback for a
   * missing outbox is "results stay local", so a refusal here is reported, never
   * thrown — a match that cannot be announced is still a match that was played. */
  const outbox = {
    available: () => has("outbox") || Boolean(globalThis.E1Net && globalThis.E1Net.nostr),
    async publish(template) {
      if (has("outbox")) {
        try {
          const msg = await shell.outbox.publish(template);
          if (msg && msg.error) {
            const error = msg.error;
            return { ok: false, via: "shell", error: String((error && error.message) || error) };
          }
          const event = (msg && (msg.event || msg.result)) || msg || null;
          return { ok: true, via: "shell", event };
        } catch (err) {
          return { ok: false, via: "shell", error: String(err && err.message) };
        }
      }
      if (globalThis.E1Net && globalThis.E1Net.nostr) {
        let event = template;
        /* The website has no host signer, so an unsigned template is signed here
         * — by the same NIP-07 door identity.sign uses — before the fan-out. */
        if (event && !event.sig) event = await identity.sign(event);
        const res = await globalThis.E1Net.nostr.publish(event);
        return { ok: res.ok, via: "relays", accepted: res.accepted, tried: res.tried, event };
      }
      return { ok: false, via: "none", error: "results stay local: no outbox and no relays" };
    },
    /** Events matching `filters`, from the shell's relays or the site's own. Never throws. */
    async query(filters, ms) {
      if (has("outbox") && typeof shell.outbox.query === "function") {
        try {
          const msg = await shell.outbox.query(filters);
          return msg && Array.isArray(msg.events) ? msg.events : [];
        } catch (err) {
          return [];
        }
      }
      if (globalThis.E1Net && globalThis.E1Net.nostr && typeof globalThis.E1Net.nostr.query === "function") {
        try { return await globalThis.E1Net.nostr.query(filters, ms); } catch (err) { return []; }
      }
      return [];
    },
  };

  // ----------------------------------------------------------------- resource

  /* Card art. Inside a shell it arrives as bytes through the resource NAP; on
   * the website it is simply a URL. A page that could only ASK whether the
   * domain existed, without being able to fetch through it, had to fall back to
   * text cards in exactly the case the NAP was built for — a shell that
   * provides art and forbids direct fetch.
   *
   * The spec asks for an in-memory LRU, and the reason is object URLs: each one
   * pins its blob for the life of the document, so 296 card faces held forever
   * is a leak with a number attached. Evicted entries are revoked. */
  const RESOURCE_CACHE = 64;
  const artCache = new Map(); // path -> object URL, insertion-ordered = LRU

  function rememberArt(path, url) {
    artCache.set(path, url);
    while (artCache.size > RESOURCE_CACHE) {
      const oldest = artCache.keys().next().value;
      const stale = artCache.get(oldest);
      artCache.delete(oldest);
      try { globalThis.URL.revokeObjectURL(stale); } catch (err) { /* already gone */ }
    }
  }

  const resource = {
    available: () => has("resource"),
    /** Raw bytes through the shell, or null when there is no resource domain. */
    async bytes(path) {
      if (!has("resource") || typeof shell.resource.bytes !== "function") return null;
      try { return await shell.resource.bytes(path); } catch (err) { return null; }
    },
    /** Something an <img src> can use: an object URL in a shell, else the path. */
    async url(path) {
      if (!has("resource")) return path;
      if (artCache.has(path)) {
        const held = artCache.get(path);
        artCache.delete(path); // re-inserted below, so it becomes the newest
        artCache.set(path, held);
        return held;
      }
      const bytes = await resource.bytes(path);
      if (!bytes) return path; // the domain exists but had nothing: fall back
      try {
        const url = globalThis.URL.createObjectURL(new globalThis.Blob([bytes]));
        rememberArt(path, url);
        return url;
      } catch (err) {
        return path;
      }
    },
  };

  // -------------------------------------------------------------------- table

  /* THE TRANSPORT SEAM. A napplet has a pipe, not a network: the table socket is
   * opened by the HOST page on the napplet's behalf and relayed over
   * postMessage (docs/napplet-spec.md, "the table channel", 2026-09-13). The
   * host also signs the NIP-42 login — with the same key its outbox uses — but
   * ONLY a kind 22242 whose relay tag names the table it opened. When there is
   * no host channel, `connect` is a real WebSocket and `sign` is NIP-07, so
   * site/net.js has one shape either way.
   *
   * Requests carry a fresh id and are matched on it; the unsolicited
   * `table.opened` / `table.message` / `table.closed` are matched on channel.
   * Only messages from the parent window are listened to. */
  const OPEN_MS = 8000;
  const SIGN_MS = 60000; // a host may ask a human before it signs
  let requestCounter = 0;
  const replies = new Map();  // id -> reply handler
  const channels = new Map(); // channel -> connection
  let listening = false;

  const freshId = () => {
    requestCounter += 1;
    return `t${requestCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  function onHostMessage(event) {
    if (!event || event.source !== globalThis.parent) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type === "table.open.result" || msg.type === "table.sign.result") {
      const reply = replies.get(msg.id);
      if (!reply) return;
      replies.delete(msg.id);
      reply(msg);
      return;
    }
    const conn = channels.get(msg.channel);
    if (!conn) return;
    if (msg.type === "table.opened") conn.opened();
    else if (msg.type === "table.message") conn.message(msg.data);
    else if (msg.type === "table.closed") conn.closed(msg);
  }

  function listen() {
    if (listening) return;
    const w = win();
    if (typeof w.addEventListener !== "function") return;
    listening = true;
    w.addEventListener("message", onHostMessage);
  }

  const post = (msg) => {
    const host = hostWindow();
    if (!host) throw new Error("no host window to carry the table channel");
    host.postMessage(msg, "*");
  };

  /* One request, one reply, one deadline. A host that never answers is a host
   * that is not there — a plain iframe of a page that is not nappelin — and the
   * caller must see a refusal rather than wait forever. */
  function ask(type, fields, ms, onReply) {
    const id = freshId();
    const timer = setTimeout(() => {
      if (!replies.delete(id)) return;
      onReply({ type: `${type}.result`, id, ok: false, error: `the host did not answer ${type}` });
    }, ms);
    if (timer && typeof timer.unref === "function") timer.unref();
    replies.set(id, (msg) => { clearTimeout(timer); onReply(msg); });
    try {
      post(Object.assign({ type, id }, fields));
    } catch (err) {
      clearTimeout(timer);
      replies.delete(id);
      throw err;
    }
  }

  function connectHost(url, handlers) {
    const h = handlers || {};
    listen();
    const conn = {
      via: "host",
      channel: null,
      isClosed: false,
      send(text) {
        if (conn.isClosed || !conn.channel) return false;
        try { post({ type: "table.send", channel: conn.channel, data: String(text) }); return true; } catch (err) { return false; }
      },
      close() {
        if (conn.isClosed) return;
        conn.isClosed = true;
        if (!conn.channel) return; // the open reply, when it comes, closes it
        // The channel stays registered until the host's `table.closed` lands, which is what reports the close.
        try { post({ type: "table.close", channel: conn.channel }); } catch (err) { /* host gone */ }
      },
      sign(event) {
        return new Promise((resolve, reject) => {
          if (!conn.channel || conn.isClosed) return reject(new Error("the table is not open"));
          try {
            ask("table.sign", { channel: conn.channel, event }, SIGN_MS, (msg) => {
              if (msg.ok && msg.event) resolve(msg.event);
              else reject(new Error(String(msg.error || "the host refused to sign the table login")));
            });
          } catch (err) {
            reject(err);
          }
        });
      },
      opened() { call(h.onOpen); },
      message(data) { call(h.onMessage, typeof data === "string" ? data : String(data)); },
      closed(msg) {
        channels.delete(conn.channel);
        conn.isClosed = true;
        call(h.onClose, { code: msg.code, reason: msg.reason });
      },
    };
    ask("table.open", { url }, OPEN_MS, (msg) => {
      if (!msg.ok || typeof msg.channel !== "string") {
        conn.isClosed = true;
        const error = String(msg.error || "the host refused to open the table");
        call(h.onError, error);
        call(h.onClose, { code: 1006, reason: error });
        return;
      }
      if (conn.isClosed) {
        // Closed by the caller before the host answered: hand the channel straight back.
        try { post({ type: "table.close", channel: msg.channel }); } catch (err) { /* host gone */ }
        return;
      }
      conn.channel = msg.channel;
      channels.set(msg.channel, conn);
    });
    return conn;
  }

  function connectSocket(url, handlers) {
    const h = handlers || {};
    const ws = new globalThis.WebSocket(url);
    ws.onopen = () => call(h.onOpen);
    ws.onmessage = (m) => call(h.onMessage, m && m.data);
    ws.onclose = (ev) => call(h.onClose, { code: ev && ev.code, reason: ev && ev.reason });
    ws.onerror = () => { /* onclose always follows; nothing useful to add */ };
    return {
      via: "websocket",
      channel: null,
      socket: ws,
      send(text) {
        if (ws.readyState !== 1) return false;
        ws.send(text);
        return true;
      },
      close(code, reason) {
        try { ws.close(code, reason); } catch (err) { /* already gone */ }
      },
      sign(event) {
        const signer = nip07();
        if (!(signer && typeof signer.signEvent === "function")) {
          return Promise.reject(new Error("no NIP-07 signer"));
        }
        return Promise.resolve(signer.signEvent(event));
      },
    };
  }

  const table = {
    /** True when a host page can carry the socket. The channel needs no prelude object. */
    available() {
      if (has("table")) return true;
      try {
        if (shell && shell.shell && typeof shell.shell.supports === "function"
            && shell.shell.supports("table") === true) return true;
      } catch (err) { /* a supports() that throws supports nothing */ }
      return embedded() && Boolean(hostWindow());
    },
    /**
     * Open the table at `url`. handlers: { onOpen(), onMessage(text), onClose({code, reason}),
     * onError(message) }. Returns { send(text), close(), sign(event), channel, via }.
     * `sign` resolves a signed kind 22242 login for THIS table, from the host or NIP-07.
     */
    connect(url, handlers) {
      return table.available() ? connectHost(url, handlers) : connectSocket(url, handlers);
    },
  };

  // --------------------------------------------------------------- collection

  /* WHAT THE PLAYER OWNS, asked of the shell rather than of a wallet. Bearlett
   * (the collection napplet) stores a `nutft/inventory` and nappelin answers the
   * `collection` intent from it. Counts only — no proofs, no secrets, no pubkeys —
   * and every field is checked before a Stack rule is allowed to read it. */
  const INVENTORY_KEYS = ["v", "kind", "edition", "collection_id", "catalog_uri", "mint", "at", "cards"];
  const INVENTORY_MAX = 4096;
  const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
  const URL_MAX = 2048;
  const isHttpsUrl = (value) => {
    if (typeof value !== "string" || !value || value.length > URL_MAX) return false;
    try { return new globalThis.URL(value).protocol === "https:"; } catch (err) { return false; }
  };
  /* Bearlett emits `catalog_uri: ""` for a wallet that holds no cards (the
   * catalog is null until a proof names one), so empty is a legal value here
   * and an https URL is the only other one. `at` is floored unix seconds. */
  const isCatalogUri = (value) => value === "" || isHttpsUrl(value);

  /** The §4a validator: a plain inventory object, or null for anything else. */
  function parseInventory(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (keys.length !== INVENTORY_KEYS.length || keys.some((k) => INVENTORY_KEYS.indexOf(k) < 0)) return null;
    if (value.v !== 1 || value.kind !== "nutft/inventory") return null;
    if (typeof value.edition !== "string" || !value.edition) return null;
    if (typeof value.collection_id !== "string" || !value.collection_id) return null;
    if (!isCatalogUri(value.catalog_uri) || !isHttpsUrl(value.mint)) return null;
    if (!Number.isInteger(value.at) || value.at < 0) return null;
    if (!Array.isArray(value.cards) || value.cards.length > INVENTORY_MAX) return null;
    const cards = [];
    let previous = null;
    for (const card of value.cards) {
      if (!card || typeof card !== "object" || Array.isArray(card)) return null;
      const own = Object.keys(card);
      if (own.length !== 2 || own.indexOf("asset_id") < 0 || own.indexOf("count") < 0) return null;
      if (typeof card.asset_id !== "string" || !ASSET_ID.test(card.asset_id)) return null;
      if (!Number.isInteger(card.count) || card.count < 1) return null;
      if (previous !== null && !(previous < card.asset_id)) return null; // sorted, no duplicates
      previous = card.asset_id;
      cards.push({ asset_id: card.asset_id, count: card.count });
    }
    return {
      v: 1,
      kind: "nutft/inventory",
      edition: value.edition,
      collection_id: value.collection_id,
      catalog_uri: value.catalog_uri,
      mint: value.mint,
      at: value.at,
      cards,
    };
  }

  const collection = {
    parse: parseInventory,
    /** asset_id -> count, the shape the Stack rules read. */
    counts(inventory) {
      const map = new Map();
      for (const card of (inventory && inventory.cards) || []) map.set(card.asset_id, card.count);
      return map;
    },
    /** Whether any collection app in the shell holds an inventory. Never throws. */
    async available() {
      if (!has("intent") || typeof shell.intent.available !== "function") return false;
      try {
        const answer = await shell.intent.available("collection");
        if (answer === true) return true;
        return Boolean(answer && (answer.available === true || answer.ok === true));
      } catch (err) {
        return false;
      }
    },
    /** The validated inventory for `edition`, or null when nothing (valid) is stored. */
    async inventory(edition) {
      const wanted = typeof edition === "string" && edition ? edition : "600b-e1";
      if (!has("intent") || typeof shell.intent.invoke !== "function") return null;
      try {
        const result = await shell.intent.invoke({
          archetype: "collection",
          action: "inventory",
          convention: "napplet:collection/inventory",
          payload: { edition: wanted },
        });
        const parsed = parseInventory(result && result.inventory);
        return parsed && parsed.edition === wanted ? parsed : null;
      } catch (err) {
        return null;
      }
    },
  };

  // ------------------------------------------------------------------ network

  /* A sandboxed napplet may not reach arbitrary hosts, which is exactly the
   * constraint that puts sats stakes out of scope for napplet v1 (spec). The
   * settlement UI asks this before offering to fetch an invoice, so it can
   * degrade to showing a lightning address instead of failing at a wall. */
  const canReachInternet = () => !has("sandbox") || Boolean(shell.sandbox && shell.sandbox.fetch);

  // -------------------------------------------------------------------- shape

  /* tiny | large, per the spec's layout contract. Reported rather than acted on,
   * so each page decides what to collapse.
   *
   * PASS THE ELEMENT YOU ARE LAYING OUT. A napplet is a panel inside someone
   * else's window, so the viewport is the wrong question — a 320px panel on a
   * 1600px monitor is tiny, and the previous version, which only ever measured
   * `documentElement`, called it large. CSS container queries are still the
   * better tool and the pages use them; this exists for logic that must branch
   * in JS, and it is honest about what it measured. */
  const shape = (element) => {
    const doc = globalThis.document;
    const box = element && typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect().width
      : (doc && doc.documentElement && doc.documentElement.clientWidth) || 0;
    return box > 0 && box < 360 ? "tiny" : "large";
  };

  const API = {
    QUOTA,
    NAPPELIN_THEME,
    present: Boolean(shell),
    has,
    embedded,
    escape,
    storage,
    identity,
    theme,
    outbox,
    resource,
    table,
    collection,
    canReachInternet,
    shape,
    applyTheme,
    /** Every optional domain, and what this page is actually running with. */
    report() {
      return {
        shell: Boolean(shell),
        embedded: embedded(),
        identity: identity.source(),
        storage: has("storage") ? "shell" : "localStorage",
        theme: has("theme") ? "shell" : (embedded() ? "nappelin palette" : "fallback palette"),
        outbox: has("outbox") ? "shell" : (globalThis.E1Net ? "relays" : "local only"),
        resource: has("resource") ? "shell" : "urls",
        table: table.available() ? "host channel" : "websocket",
        collection: has("intent") ? "intent" : "wallet",
        shape: shape(),
      };
    },
  };

  globalThis.E1Napplet = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
