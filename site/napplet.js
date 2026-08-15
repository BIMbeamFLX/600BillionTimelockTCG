/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — the napplet adapter.
 *
 * The game ships twice from one codebase: as an ordinary website, and as a
 * napplet running inside a shell that hands it capabilities (NAPs) instead of
 * letting it reach the platform directly. This module is the seam. Every page
 * asks THIS for identity, storage, theme, publishing and assets, and never
 * touches `localStorage`, `window.nostr` or a bare palette itself.
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
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  /* The shell injects its SDK before the app runs. Several names are checked
   * because the surface is not frozen yet (spec, flagged gap 1) and guessing
   * one is how this silently never activates. */
  const shell = globalThis.napplet || globalThis.Napplet || globalThis.NAPPLET || null;
  const has = (domain) => Boolean(shell && shell[domain]);

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

  /* Brand-fixed and never themed. A shell may repaint the chrome; it may not
   * repaint what an affinity looks like, because the five Plate colours are how
   * a player reads the board and they must match the printed cards. */
  const AFFINITY = { P: "#F3C244", B: "#F7931A", K: "#FFF7EC", S: "#7447B8", T: "#17BEBB" };

  // ------------------------------------------------------------------ storage

  const localGet = (key) => {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  };
  const localSet = (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch (err) { return false; }
  };
  const localDel = (key) => {
    try { localStorage.removeItem(key); return true; } catch (err) { return false; }
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

  const identity = {
    /** Where the current identity comes from, for UI that must be honest about it. */
    source() {
      if (has("identity")) return "shell";
      if (globalThis.nostr && globalThis.nostr.getPublicKey) return "nip07";
      return "none";
    },
    /** The signed-in pubkey, or null. Never prompts. */
    async current() {
      if (has("identity")) {
        try {
          const who = await shell.identity.get();
          const key = who && (who.pubkey || who.npub || who);
          return /^[0-9a-f]{64}$/.test(String(key)) ? String(key) : null;
        } catch (err) { return null; }
      }
      const saved = localGet(LS_PUBKEY);
      return /^[0-9a-f]{64}$/.test(saved || "") ? saved : null;
    },
    /** Asks. May prompt the shell or the extension; rejects if neither exists. */
    async login() {
      if (has("identity")) {
        const who = await shell.identity.request();
        const key = who && (who.pubkey || who.npub || who);
        if (!/^[0-9a-f]{64}$/.test(String(key))) throw new Error("the shell returned no usable identity");
        return String(key);
      }
      if (!(globalThis.nostr && globalThis.nostr.getPublicKey)) {
        /* The spec's fallback for a missing identity domain is anonymous
         * labels, and that is right for LOCAL play — but an online seat is
         * bound to a key, so this refuses rather than seating a ghost. */
        throw new Error("no identity: install a NIP-07 extension, or run this inside a napplet shell");
      }
      const key = await globalThis.nostr.getPublicKey();
      if (!/^[0-9a-f]{64}$/.test(key || "")) throw new Error("the extension returned no usable pubkey");
      localSet(LS_PUBKEY, key);
      return key;
    },
    async sign(event) {
      if (has("identity") && shell.identity.signEvent) return shell.identity.signEvent(event);
      if (globalThis.nostr && globalThis.nostr.signEvent) return globalThis.nostr.signEvent(event);
      throw new Error("no signer available");
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
  function applyTheme(colors) {
    const root = document.documentElement;
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
    for (const [symbol, value] of Object.entries(AFFINITY)) {
      root.style.setProperty(`--plate-${symbol}`, value);
    }
  }

  const theme = {
    tokens: () => Object.assign({}, FALLBACK_THEME),
    affinity: () => Object.assign({}, AFFINITY),
    /** Paint now and repaint on every shell change. Safe to call on any page. */
    start() {
      if (!has("theme")) return applyTheme(null);
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

  /* Publishing. Inside a shell this is the outbox NAP; on the website it is
   * site/net.js's own relay fan-out. The spec's fallback for a missing outbox is
   * "results stay local", so a refusal here is reported, never thrown — a match
   * that cannot be announced is still a match that was played. */
  const outbox = {
    available: () => has("outbox") || Boolean(globalThis.E1Net && globalThis.E1Net.nostr),
    async publish(event) {
      if (has("outbox")) {
        try {
          await shell.outbox.publish(event);
          return { ok: true, via: "shell" };
        } catch (err) {
          return { ok: false, via: "shell", error: String(err && err.message) };
        }
      }
      if (globalThis.E1Net && globalThis.E1Net.nostr) {
        const res = await globalThis.E1Net.nostr.publish(event);
        return { ok: res.ok, via: "relays", accepted: res.accepted, tried: res.tried };
      }
      return { ok: false, via: "none", error: "results stay local: no outbox and no relays" };
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
    const box = element && typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect().width
      : (document.documentElement && document.documentElement.clientWidth) || 0;
    return box > 0 && box < 360 ? "tiny" : "large";
  };

  const API = {
    QUOTA,
    present: Boolean(shell),
    has,
    storage,
    identity,
    theme,
    outbox,
    canReachInternet,
    shape,
    applyTheme,
    /** Every optional domain, and what this page is actually running with. */
    report() {
      return {
        shell: Boolean(shell),
        identity: identity.source(),
        storage: has("storage") ? "shell" : "localStorage",
        theme: has("theme") ? "shell" : "fallback palette",
        outbox: has("outbox") ? "shell" : (globalThis.E1Net ? "relays" : "local only"),
        resource: has("resource") ? "shell" : "urls",
        shape: shape(),
      };
    },
  };

  globalThis.E1Napplet = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
