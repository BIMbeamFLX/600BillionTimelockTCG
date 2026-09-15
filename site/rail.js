/* ---------------------------------------------------------------------------
 * rail.js — the bar: Account, Music, Wallet, Chat, Share. (docs/rail.md)
 *
 * The Hypershell rail from nappelin's design handoff, rebuilt in plain DOM.
 * One classic tag is all a page adds: this file paints its own <style> from the
 * contract tokens (each with a literal fallback, so play.html, which never loads
 * 600b.css, draws the same bar), gives the body the padding the bar's edge
 * needs, and mounts once. Each panel is built once and kept; opening one shows
 * it, closing hides it, nothing is torn down.
 *
 * INSIDE A NAPPLET SHELL IT DOES NOTHING. The Hangar draws its own bar around
 * the frame. E1Rail still exists there, inert, so a caller's
 * `E1Rail.slot("music") || fallback` never throws.
 *
 * THE GREEN RULE. The account dot is the only green on the site, and exactly one
 * thing lights it: an `e1:auth` event whose detail.ok is true — the table
 * accepted a signed login. setBadge cannot reach it, and signing out puts it out
 * until the table verifies the next login.
 *
 * NOTHING HEAVY RIDES ALONG. The wallet script loads the first time the Wallet
 * panel opens with a card in storage to count, the QR encoder the first time
 * Share does. Chat points at Nappelin instead of pretending to be a room.
 *
 * Browser globals are reached through globalThis only, so the tests can run
 * this file against a stand-in scope (tests/js/rail.test.mjs).
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  const G = globalThis;
  if (G.E1Rail) return; // one bar per document: a second include changes nothing

  const doc = G.document;

  const NAMES = ["account", "music", "wallet", "chat", "share"];
  const TITLES = { account: "Account", music: "Music", wallet: "Wallet", chat: "Chat", share: "Share" };
  const EDGES = ["right", "bottom", "left", "top"];
  const EDGE_KEY = "600b:rail";
  const GUEST_KEY = "600b:rail-guest";
  const PUBKEY_KEY = "600b:pubkey"; // the key napplet.js and net.js sign in under
  const HEX64 = /^[0-9a-f]{64}$/;
  const NO_EXTENSION = "No compatible browser extension found. You can play as a guest.";
  const NAPPELIN = "https://nappelin.com/hangar/";
  /* The only query a shared link may carry, and only the values play.js and
     deck.html act on: ?rules=fast|classic, ?arena=3d|dom. */
  const SHARE_KEEP = { rules: ["fast", "classic"], arena: ["3d", "dom"] };
  const DASH = "—";

  /* Inside a shell? The adapter answers; a page without it asks the same three
     questions the adapter would. */
  function embedded() {
    const nap = G.E1Napplet;
    if (nap && typeof nap.embedded === "function") {
      try { return Boolean(nap.embedded()); } catch (err) { return false; }
    }
    if (G.napplet || G.nappletContext) return true;
    try {
      return /(?:^\?|[?&])embed=1(?:&|$)/.test(String((G.location && G.location.search) || ""));
    } catch (err) {
      return false;
    }
  }

  if (!doc || typeof doc.createElement !== "function" || embedded()) {
    G.E1Rail = Object.freeze({
      slot: () => null, open: () => false, close() {}, setBadge: () => false, edge: () => null,
    });
    return;
  }

  // ----------------------------------------------------------------- storage

  /* Storage getters throw in a sandboxed frame and setItem throws in private
     mode. A bar that forgets which edge it was on is fine; a page that throws
     is not. */
  const load = (area, key) => {
    try { return G[area] ? G[area].getItem(key) : null; } catch (err) { return null; }
  };
  const save = (area, key, value) => {
    try {
      if (!G[area]) return;
      if (value === null) G[area].removeItem(key);
      else G[area].setItem(key, value);
    } catch (err) { /* not kept */ }
  };

  // -------------------------------------------------------------------- edge

  const narrow = typeof G.matchMedia === "function" ? G.matchMedia("(max-width: 699.98px)") : null;
  const savedEdge = () => {
    const value = load("localStorage", EDGE_KEY);
    return EDGES.indexOf(value) >= 0 ? value : null;
  };
  const defaultEdge = () => (narrow && narrow.matches ? "bottom" : "right");
  let edge = savedEdge() || defaultEdge();

  // ------------------------------------------------------------------- style

  /* Right and left: 104px wide. Top and bottom: 64px tall. The same numbers are
     published as --tcg-rail-top/right/bottom/left on <html>, which is what the
     body padding reads and what any other fixed element on a page can read to
     stay clear of the bar. */
  const MONO = 'var(--mono, "IBM Plex Mono", ui-monospace, Consolas, monospace)';
  const HEADLINE = 'var(--headline, "Josefin Sans", Georgia, sans-serif)';
  const CSS = `
html[data-tcg-rail] { --tcg-rail-top: 0px; --tcg-rail-right: 0px; --tcg-rail-bottom: 0px; --tcg-rail-left: 0px; }
html[data-tcg-rail="right"] { --tcg-rail-right: 104px; }
html[data-tcg-rail="left"] { --tcg-rail-left: 104px; }
html[data-tcg-rail="bottom"] { --tcg-rail-bottom: calc(64px + env(safe-area-inset-bottom, 0px)); scroll-padding-bottom: var(--tcg-rail-bottom); }
html[data-tcg-rail="top"] { --tcg-rail-top: 64px; scroll-padding-top: var(--tcg-rail-top); }
html[data-tcg-rail] body { padding: var(--tcg-rail-top) var(--tcg-rail-right) var(--tcg-rail-bottom) var(--tcg-rail-left); }
/* The two pieces of site-wide fixed chrome that would otherwise sit under the bar. */
html[data-tcg-rail="top"] .nav { top: var(--tcg-rail-top); }
html[data-tcg-rail] .bug-button--float { right: calc(14px + var(--tcg-rail-right)); bottom: calc(14px + var(--tcg-rail-bottom)); }

.tcg-rail {
  position: fixed; z-index: 55; box-sizing: border-box; display: flex; margin: 0; padding: 0;
  background: var(--iron, #0f0c08); color: var(--brass-3, #8f6a2a);
  border: 0 solid rgba(231,191,118,.16); border-radius: 0; box-shadow: none;
  font: 400 13px/1.2 ${MONO}; letter-spacing: normal; text-align: center; text-transform: none;
}
html[data-tcg-rail="right"] .tcg-rail, html[data-tcg-rail="left"] .tcg-rail { top: 0; bottom: 0; width: 104px; flex-direction: column; }
html[data-tcg-rail="right"] .tcg-rail { right: 0; border-left-width: 1px; }
html[data-tcg-rail="left"] .tcg-rail { left: 0; border-right-width: 1px; }
html[data-tcg-rail="bottom"] .tcg-rail, html[data-tcg-rail="top"] .tcg-rail { left: 0; right: 0; flex-direction: row; }
html[data-tcg-rail="bottom"] .tcg-rail { bottom: 0; height: var(--tcg-rail-bottom); padding-bottom: env(safe-area-inset-bottom, 0px); border-top-width: 1px; }
html[data-tcg-rail="top"] .tcg-rail { top: 0; height: var(--tcg-rail-top); border-bottom-width: 1px; }
.tcg-rail [hidden] { display: none !important; }
.tcg-rail svg { display: block; flex: none; fill: currentColor; }

.tcg-rail__btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; flex: none;
  box-sizing: border-box; margin: 0; cursor: pointer; background: transparent; color: var(--brass-3, #8f6a2a);
  border: 0 solid transparent; border-radius: 0; box-shadow: none; font: inherit; line-height: 1.2;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--t, 200ms) ease-out, background-color var(--t, 200ms) ease-out, border-color var(--t, 200ms) ease-out;
}
.tcg-rail__btn:hover { color: var(--brass, #e7bf76); }
/* Inset: the tiles run edge to edge, and a ring drawn outside the rightmost one would leave the screen. */
.tcg-rail__btn:focus-visible { outline: 2px solid var(--brass, #e7bf76); outline-offset: -4px; box-shadow: none; }
.tcg-rail__btn[aria-expanded="true"] { background: rgba(231,191,118,.08); color: var(--brass, #e7bf76); }
html[data-tcg-rail="right"] .tcg-rail__btn, html[data-tcg-rail="left"] .tcg-rail__btn { padding: 16px 6px; border-bottom: 1px solid rgba(231,191,118,.12); }
html[data-tcg-rail="right"] .tcg-rail__btn { border-left: 2px solid transparent; }
html[data-tcg-rail="left"] .tcg-rail__btn { border-right: 2px solid transparent; }
html[data-tcg-rail="bottom"] .tcg-rail__btn, html[data-tcg-rail="top"] .tcg-rail__btn { padding: 10px 18px; border-right: 1px solid rgba(231,191,118,.12); }
html[data-tcg-rail="bottom"] .tcg-rail__btn { border-top: 2px solid transparent; }
html[data-tcg-rail="top"] .tcg-rail__btn { border-bottom: 2px solid transparent; }
html[data-tcg-rail="right"] .tcg-rail__btn[aria-expanded="true"] { border-left-color: var(--brass, #e7bf76); }
html[data-tcg-rail="left"] .tcg-rail__btn[aria-expanded="true"] { border-right-color: var(--brass, #e7bf76); }
html[data-tcg-rail="bottom"] .tcg-rail__btn[aria-expanded="true"] { border-top-color: var(--brass, #e7bf76); }
html[data-tcg-rail="top"] .tcg-rail__btn[aria-expanded="true"] { border-bottom-color: var(--brass, #e7bf76); }
.tcg-rail__icon { position: relative; display: flex; align-items: center; justify-content: center; width: 26px; height: 24px; }
.tcg-rail__btn.is-lit .tcg-rail__icon { color: var(--brass, #e7bf76); }
/* Icons and dots murmur in brass-3 at rest; words at 8.5px need brass-2 (7.4:1 on iron, brass-3 is 4:1). */
.tcg-rail__label { display: block; color: var(--brass-2, #c9973f); font-size: 8.5px; font-weight: 500; line-height: 1.2; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.tcg-rail__btn:hover .tcg-rail__label, .tcg-rail__btn[aria-expanded="true"] .tcg-rail__label { color: inherit; }
.tcg-rail__dot { position: absolute; width: 7px; height: 7px; }
.tcg-rail__dot--live { right: -5px; bottom: -1px; background: var(--signal, #6de8a6); }
.tcg-rail__dot--wait { right: -6px; top: -3px; background: var(--brass-2, #c9973f); animation: tcg-rail-blink 1s steps(1) infinite; }
@keyframes tcg-rail-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .2; } }
.tcg-rail__spacer { flex: 1 1 auto; }
html[data-tcg-rail="right"] .tcg-rail__move, html[data-tcg-rail="left"] .tcg-rail__move { padding-top: 12px; padding-bottom: 12px; border-bottom: 0; border-top: 1px solid rgba(231,191,118,.12); }
html[data-tcg-rail="bottom"] .tcg-rail__move, html[data-tcg-rail="top"] .tcg-rail__move { border-right: 0; border-left: 1px solid rgba(231,191,118,.12); }
@media (max-width: 699.98px) {
  html[data-tcg-rail="bottom"] .tcg-rail__btn, html[data-tcg-rail="top"] .tcg-rail__btn { flex: 1 1 0; min-width: 0; padding-left: 2px; padding-right: 2px; }
  html[data-tcg-rail="bottom"] .tcg-rail__spacer, html[data-tcg-rail="top"] .tcg-rail__spacer { display: none; }
}
/* A short window (a phone on its side) must still reach every button: the bar cannot scroll. */
@media (max-height: 459.98px) {
  html[data-tcg-rail="right"] .tcg-rail__btn, html[data-tcg-rail="left"] .tcg-rail__btn { padding-top: 8px; padding-bottom: 8px; gap: 4px; }
}
@media (max-height: 339.98px) {
  html[data-tcg-rail="right"] .tcg-rail__label, html[data-tcg-rail="left"] .tcg-rail__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}

.tcg-pop {
  position: absolute; z-index: 1; box-sizing: border-box; display: flex; flex-direction: column; margin: 0;
  background: var(--iron, #0f0c08); color: var(--body-ink, rgba(236,227,208,.82));
  border: 1px solid rgba(231,191,118,.28); border-radius: 0; box-shadow: none;
  font: 400 11.5px/1.75 ${MONO}; letter-spacing: normal; text-align: left; text-transform: none;
}
html[data-tcg-rail="right"] .tcg-pop, html[data-tcg-rail="left"] .tcg-pop { top: 0; width: min(372px, calc(100vw - 104px)); max-height: 100%; }
html[data-tcg-rail="right"] .tcg-pop { right: 100%; }
html[data-tcg-rail="left"] .tcg-pop { left: 100%; }
html[data-tcg-rail="bottom"] .tcg-pop, html[data-tcg-rail="top"] .tcg-pop { left: 0; right: 0; max-height: 62vh; max-height: 62dvh; }
html[data-tcg-rail="bottom"] .tcg-pop { bottom: 100%; }
html[data-tcg-rail="top"] .tcg-pop { top: 100%; }
.tcg-pop__panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; animation: tcg-rail-rise .18s ease-out; }
html[data-tcg-rail="bottom"] .tcg-pop__panel, html[data-tcg-rail="top"] .tcg-pop__panel { box-sizing: border-box; width: 100%; max-width: 640px; margin: 0 auto; }
.tcg-pop__panel:focus { outline: none; }
.tcg-pop__panel:focus-visible { outline: 2px solid var(--brass, #e7bf76); outline-offset: -3px; }
@keyframes tcg-rail-rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
.tcg-pop__head { display: flex; align-items: center; gap: 12px; flex: none; padding: 15px 18px; border-bottom: 1px solid rgba(231,191,118,.16); }
.tcg-pop__title { flex: 1 1 auto; margin: 0; padding: 0; color: var(--parchment, #ece3d0); font: 600 14px/1.2 ${HEADLINE}; letter-spacing: .14em; text-transform: uppercase; }
.tcg-pop__close {
  flex: none; margin: 0; padding: 4px 9px; cursor: pointer; background: transparent; color: var(--brass-3, #8f6a2a);
  border: 1px solid rgba(231,191,118,.25); border-radius: 0; box-shadow: none; font: 500 13px/1 ${MONO};
  transition: color var(--t, 200ms) ease-out, border-color var(--t, 200ms) ease-out;
}
.tcg-pop__close:hover { color: var(--brass, #e7bf76); border-color: var(--brass, #e7bf76); }
.tcg-pop__body { display: flex; flex-direction: column; gap: 14px; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 20px 18px; }
.tcg-pop__content { display: flex; flex-direction: column; gap: 14px; }
.tcg-pop__text { margin: 0; color: var(--body-ink, rgba(236,227,208,.82)); font-size: 11.5px; line-height: 1.75; }
.tcg-pop__quiet { margin: 0; color: var(--ink-quiet, rgba(236,227,208,.62)); font-size: 11px; line-height: 1.7; }
.tcg-pop__label { display: block; margin: 0 0 4px; color: var(--brass-2, #c9973f); font: 500 10px/1.4 ${MONO}; letter-spacing: .22em; text-transform: uppercase; }
.tcg-pop__box { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; background: var(--panel, rgba(231,191,118,.03)); border: 1px solid var(--emphasis, rgba(231,191,118,.25)); }
.tcg-pop__name { color: var(--parchment, #ece3d0); font: 600 13px/1.4 ${MONO}; letter-spacing: .06em; overflow-wrap: anywhere; }
.tcg-pop__meta { color: var(--brass-2, #c9973f); font-size: 10.5px; line-height: 1.6; overflow-wrap: anywhere; }
.tcg-pop__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.tcg-pop__num { display: block; color: var(--parchment, #ece3d0); font: 700 28px/1.1 ${HEADLINE}; letter-spacing: .03em; }
.tcg-pop__row { display: flex; align-items: center; gap: 9px; }
.tcg-pop__dot { flex: none; width: 7px; height: 7px; background: var(--brass-2, #c9973f); }
.tcg-pop__btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; box-sizing: border-box; margin: 0;
  padding: 12px 22px; cursor: pointer; text-align: center; text-decoration: none;
  background: transparent; color: var(--brass, #e7bf76); border: 1px solid var(--brass-2, #c9973f); border-radius: 0; box-shadow: none;
  font: 600 11px/1 ${MONO}; letter-spacing: .16em; text-transform: uppercase;
  transition: background-color var(--t, 200ms) ease-out, color var(--t, 200ms) ease-out, border-color var(--t, 200ms) ease-out;
}
.tcg-pop__btn:hover { color: var(--parchment, #ece3d0); border-color: var(--parchment, #ece3d0); }
.tcg-pop__btn--primary { background: var(--brass, #e7bf76); color: var(--iron, #0f0c08); border-color: var(--brass, #e7bf76); }
.tcg-pop__btn--primary:hover { background: var(--parchment, #ece3d0); color: var(--iron, #0f0c08); border-color: var(--parchment, #ece3d0); }
.tcg-pop__well { padding: 12px 14px; background: var(--well, rgba(231,191,118,.05)); border: 1px solid rgba(143,106,42,.6); color: var(--parchment, #ece3d0); font-size: 11.5px; line-height: 1.6; overflow-wrap: anywhere; user-select: all; }
.tcg-pop__qr { align-self: center; line-height: 0; border: 1px solid var(--emphasis, rgba(231,191,118,.25)); }
.tcg-pop__qr svg { width: 148px; height: 148px; }
.tcg-pop__status { margin: 0; color: var(--brass-2, #c9973f); font-size: 11px; line-height: 1.6; }
.tcg-pop__status:empty, .tcg-pop__slot:empty { display: none; }
.tcg-pop__slot .fxbar { flex-wrap: wrap; max-width: 100%; }
@media (prefers-reduced-motion: reduce) {
  .tcg-pop__panel, .tcg-rail__dot--wait { animation: none; }
  .tcg-rail__btn, .tcg-pop__btn, .tcg-pop__close { transition: none; }
}
@media print {
  .tcg-rail { display: none; }
  html[data-tcg-rail] body { padding: 0; }
}
`;

  if (!doc.getElementById("tcg-rail-css")) {
    const style = doc.createElement("style");
    style.id = "tcg-rail-css";
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
  /* Set now, from <head>: the body padding is in place before the first paint,
     so nothing on the page shifts when the bar itself arrives. */
  doc.documentElement.setAttribute("data-tcg-rail", edge);

  // ----------------------------------------------------------------- helpers

  /* Sibling files (wallet.html, play.html, nutft-wallet.js, qr.js) resolve
     against this script, so a page outside site/ still finds them. */
  const base = (() => {
    try { return (doc.currentScript && doc.currentScript.src) || ""; } catch (err) { return ""; }
  })();
  const siteUrl = (file) => {
    if (!base) return file;
    try { return new URL(file, base).href; } catch (err) { return file; }
  };

  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, cls, words) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (words !== undefined) node.textContent = words;
    return node;
  }

  function icon(box, size, shapes) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", box);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const shape of shapes) {
      const node = doc.createElementNS(SVG_NS, shape.tag || "path");
      for (const name of Object.keys(shape)) if (name !== "tag") node.setAttribute(name, String(shape[name]));
      svg.appendChild(node);
    }
    return svg;
  }

  function action(label, onClick, primary) {
    const node = el("button", primary ? "tcg-pop__btn tcg-pop__btn--primary" : "tcg-pop__btn", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /* A link dressed as a button. `external` opens a new tab, so a game in
     progress is never navigated away from. */
  function linkButton(label, href, options) {
    const opts = options || {};
    const node = el("a", opts.primary ? "tcg-pop__btn tcg-pop__btn--primary" : "tcg-pop__btn", label);
    node.href = href;
    if (opts.external) {
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    }
    return node;
  }

  const text = (words) => el("p", "tcg-pop__text", words);
  const quiet = (words) => el("p", "tcg-pop__quiet", words);

  function withTimeout(promise, ms) {
    let timer = null;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
      if (timer && typeof timer.unref === "function") timer.unref();
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  }

  /* A script this bar needs only when a panel opens. A failed load is not
     remembered, so the next open tries again. */
  const loading = new Map();
  function loadScript(file, globalName) {
    if (G[globalName]) return Promise.resolve(G[globalName]);
    if (loading.has(file)) return loading.get(file);
    const job = new Promise((resolve) => {
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        resolve(G[globalName] || null);
      };
      const tag = doc.createElement("script");
      tag.src = siteUrl(file);
      tag.async = true;
      tag.addEventListener("load", done);
      tag.addEventListener("error", done);
      timer = setTimeout(done, 15000);
      if (timer && typeof timer.unref === "function") timer.unref();
      (doc.head || doc.documentElement).appendChild(tag);
    }).then((value) => {
      if (!value) loading.delete(file);
      return value;
    });
    loading.set(file, job);
    return job;
  }

  /* BIP-173 npub, for the short line under a signed-in name. The same forty
     lines net.js and nostr-id.js carry: a content page has no business loading
     either of them for this. */
  const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  }
  function npub(hex) {
    const words = [];
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < 64; i += 2) {
      acc = (acc << 8) | parseInt(hex.slice(i, i + 2), 16);
      bits += 8;
      while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); }
    }
    if (bits) words.push((acc << (5 - bits)) & 31);
    const hrp = "npub";
    const expanded = [];
    for (const c of hrp) expanded.push(c.charCodeAt(0) >> 5);
    expanded.push(0);
    for (const c of hrp) expanded.push(c.charCodeAt(0) & 31);
    const mod = polymod(expanded.concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
    let checksum = "";
    for (let i = 0; i < 6; i++) checksum += B32[(mod >> (5 * (5 - i))) & 31];
    return "npub1" + words.map((w) => B32[w]).join("") + checksum;
  }
  const shortNpub = (hex) => {
    const full = npub(hex);
    return full.slice(0, 12) + "…" + full.slice(-5);
  };

  // ------------------------------------------------------------------- icons

  /* Path data lifted verbatim from the Hypershell prototype. The account mark is
     the one glyph drawn here — not nappelin's Pixel Pilot but the 600 Billion
     number: a brass plate with 600 punched through it and three slots beneath
     for the rest of the zeros. */
  const ICONS = {
    account: ["0 0 24 24", 24, [{ "fill-rule": "evenodd", d: "M0 0H24V24H0Z M2 5H8V7H4V9H8V15H2Z M4 11H6V13H4Z M9 5H15V15H9Z M11 7H13V13H11Z M16 5H22V15H16Z M18 7H20V13H18Z M2 17H8V19H2Z M9 17H15V19H9Z M16 17H22V19H16Z" }]],
    music: ["0 0 22 22", 22, [
      { tag: "rect", x: 2, y: 10, width: 4, height: 10 },
      { tag: "rect", x: 9, y: 4, width: 4, height: 16 },
      { tag: "rect", x: 16, y: 13, width: 4, height: 7 },
    ]],
    wallet: ["0 0 22 22", 22, [
      { "fill-rule": "evenodd", d: "M1 5H21V19H1Z M4 8V16H18V8Z" },
      { tag: "rect", x: 13, y: 10, width: 4, height: 4 },
    ]],
    chat: ["0 0 22 22", 22, [{ "fill-rule": "evenodd", d: "M1 2H21V16H12L7 20V16H1Z M4 5V13H18V5Z" }]],
    share: ["0 0 22 22", 20, [
      { tag: "rect", x: 2, y: 2, width: 6, height: 6 },
      { tag: "rect", x: 14, y: 2, width: 6, height: 6 },
      { tag: "rect", x: 8, y: 14, width: 6, height: 6 },
      { d: "M5 8h2v4h8V8h2v6H5Z" },
    ]],
  };
  /* The move button draws the bar's current edge as a filled side of a square. */
  const EDGE_BAR = { right: "M10 1H13V13H10Z", bottom: "M1 10H13V13H1Z", left: "M1 1H4V13H1Z", top: "M1 1H13V4H1Z" };

  // ------------------------------------------------------------------- state

  /* One slot per panel, created now, before the page has a body, so a page
     script can hand one to a library at any point and always get the same
     element back. The music slot is where the table mounts its sound controls. */
  const slots = Object.create(null);
  for (const name of NAMES) {
    slots[name] = el("div", "tcg-pop__slot");
    slots[name].setAttribute("data-slot", name);
  }

  const who = { pubkey: null, name: null, asked: false };
  let guest = load("sessionStorage", GUEST_KEY) === "1";
  let authed = false;                         // the last e1:auth said ok === true
  let authedKey = null;                       // who was signed in when it said so
  let authTicket = 0;
  const badges = { wallet: null, music: null };
  let waiting = 0;                            // transfers sent and not yet marked delivered
  const wallet = { busy: null, checkedAt: 0, held: null, distinct: null, mint: null, unfinished: false, empty: false };
  let openName = null;
  let ui = null;

  // ---------------------------------------------------------------- identity

  const net = () => (G.E1Net && G.E1Net.nostr) || null;
  const adapter = () => (G.E1Napplet && G.E1Napplet.identity) || null;
  const validKey = (value) => {
    const key = String(value || "").toLowerCase();
    return HEX64.test(key) ? key : null;
  };

  /* The same doors, in the same order, as the table: net.js where the page has
     it, the napplet adapter where it does not, a bare NIP-07 extension last.
     All three keep the key under 600b:pubkey, so every page agrees on who. */
  function hasSigner() {
    try {
      if (net() && typeof net().hasNip07 === "function") return Boolean(net().hasNip07());
      if (adapter() && typeof adapter().source === "function") return adapter().source() !== "none";
    } catch (err) {
      return false;
    }
    return Boolean(G.nostr && typeof G.nostr.getPublicKey === "function");
  }

  /** The signed-in key, or null. Never prompts. */
  async function currentKey() {
    try {
      if (net() && typeof net().savedPubkey === "function") return validKey(net().savedPubkey());
      if (adapter() && typeof adapter().current === "function") return validKey(await adapter().current());
    } catch (err) {
      return null;
    }
    return validKey(load("localStorage", PUBKEY_KEY));
  }

  let identityTicket = 0;
  async function refreshIdentity() {
    const ticket = ++identityTicket;
    const key = await currentKey();
    if (ticket !== identityTicket) return; // a newer refresh already answered
    if (key !== who.pubkey) {
      who.pubkey = key;
      who.name = null;
      who.asked = false;
    }
    paintAccount();
  }

  /* The table sends e1:auth only when its answer flips, so the dot follows the
     LAST word it sent — for the key that was signed in when it sent it. Signing
     out ends the table's session too (net.js closes its socket), so that last
     word becomes ok:false and the dot stays dark after signing back in, with any
     key, until the table verifies the new login. A key signed out and back in
     from another tab, while this page's login stands, shows it again; any other
     key does not. */
  const verified = () => authed && Boolean(who.pubkey) && who.pubkey === authedKey;

  function paintAccount() {
    if (!ui) return;
    ui.labels.account.textContent = who.pubkey ? "Account" : guest ? "Guest" : "Sign in";
    ui.buttons.account.classList.toggle("is-lit", Boolean(who.pubkey));
    ui.live.hidden = !verified();
    if (openName === "account") renderAccount();
  }

  /* e1:identity tells the page who the bar just signed in or out — the table
     resumes a saved seat and re-opens its lobby on it — and, once after load,
     who was already signed in. Sent after every DOMContentLoaded handler has
     run, so a page that listens from its own init still hears the first one. */
  function announceIdentity(pubkey) {
    if (typeof G.dispatchEvent !== "function" || typeof G.CustomEvent !== "function") return;
    try {
      G.dispatchEvent(new G.CustomEvent("e1:identity", { detail: { pubkey: pubkey || null } }));
    } catch (err) { /* a page with no event target has nobody listening either */ }
  }

  function renderAccount() {
    const parts = [];
    if (who.pubkey) {
      const box = el("div", "tcg-pop__box");
      box.append(el("span", "tcg-pop__label", "Signed in"));
      if (who.name) box.append(el("span", "tcg-pop__name", who.name));
      box.append(el("span", who.name ? "tcg-pop__meta" : "tcg-pop__name", shortNpub(who.pubkey)));
      parts.push(box);
      if (verified()) parts.push(text("The table has verified this key."));
      parts.push(quiet("Online duels seat you with this key. Nothing else here needs it."));
      parts.push(action("Sign out", signOut));
      askName();
    } else {
      const signer = hasSigner();
      if (!signer) parts.push(text(NO_EXTENSION));
      else if (guest) parts.push(text("You are playing as a guest. Nothing here needs an account."));
      else parts.push(text("You are not signed in. Everything here works without it — only online duels need it."));
      if (signer) parts.push(action("Sign in", signIn, true));
      if (!guest) parts.push(action("Play as a guest", playAsGuest));
    }
    fill("account", parts);
  }

  async function signIn() {
    say("account", "");
    let key = null;
    try {
      if (net() && typeof net().login === "function") key = await net().login();
      else if (adapter() && typeof adapter().login === "function") key = await adapter().login();
      else if (G.nostr && typeof G.nostr.getPublicKey === "function") {
        key = validKey(await G.nostr.getPublicKey());
        if (key) save("localStorage", PUBKEY_KEY, key);
      }
      key = validKey(key);
      if (!key) throw new Error("the extension returned no usable key");
    } catch (err) {
      say("account", hasSigner() ? "Sign-in did not complete: " + String((err && err.message) || err) : NO_EXTENSION);
      return;
    }
    guest = false;
    save("sessionStorage", GUEST_KEY, null);
    identityTicket += 1; // an older refresh still in flight must not undo this
    who.pubkey = key;
    who.name = null;
    who.asked = false;
    paintAccount();
    announceIdentity(key);
  }

  function signOut() {
    try {
      if (net() && typeof net().logout === "function") net().logout();
      else if (adapter() && typeof adapter().forget === "function") adapter().forget();
      else save("localStorage", PUBKEY_KEY, null);
    } catch (err) { /* the refresh below shows whatever is still signed in */ }
    refreshIdentity().then(() => {
      if (who.pubkey) {
        say("account", "This sign-in could not be forgotten here.");
        return;
      }
      say("account", "Signed out.");
      announceIdentity(null);
    });
  }

  function playAsGuest() {
    guest = true;
    save("sessionStorage", GUEST_KEY, "1");
    paintAccount();
  }

  /* A name only where it can be checked: net.js verifies the profile's
     signature. Pages without it show the key, never a name a relay made up. */
  function askName() {
    const nostr = net();
    const key = who.pubkey;
    if (!key || who.asked || !nostr || typeof nostr.profile !== "function") return;
    who.asked = true;
    Promise.resolve()
      .then(() => nostr.profile(key))
      .then((profile) => {
        const name = profile && typeof profile.name === "string" ? profile.name.trim().slice(0, 48) : "";
        if (!name || who.pubkey !== key) return;
        who.name = name;
        if (openName === "account") renderAccount();
      }, () => { /* no name; the key line stands */ });
  }

  async function onAuth(event) {
    const ticket = ++authTicket;
    authed = Boolean(event && event.detail && event.detail.ok === true);
    authedKey = null;
    paintAccount();
    if (!authed) return;
    /* Asked, not assumed: the table may have signed in through its own button,
       so the key it just verified is whatever is signed in right now. */
    const key = await currentKey();
    if (ticket !== authTicket) return; // the table has spoken again since
    authedKey = key;
    await refreshIdentity();
  }

  // ------------------------------------------------------------------- music

  /* Honest labels: PAUSED when the table's sound is muted, PLAYING only while
     its room tone actually runs, MUSIC otherwise. A page may say better. */
  function musicState() {
    if (badges.music) return badges.music;
    const fx = G.E1FX;
    if (!fx || typeof fx.get !== "function") return null;
    try {
      const now = fx.get();
      if (now.muted) return "paused";
      return now.ready && now.bed ? "playing" : null;
    } catch (err) {
      return null;
    }
  }

  function paintMusic() {
    if (!ui) return;
    const state = musicState();
    ui.labels.music.textContent = state === "playing" ? "Playing" : state === "paused" ? "Paused" : "Music";
    ui.buttons.music.classList.toggle("is-lit", state === "playing");
  }
  const paintMusicSoon = () => {
    if (G.E1FX || badges.music) setTimeout(paintMusic, 0);
  };

  function renderMusic() {
    const parts = [];
    if (slots.music.children.length) parts.push(quiet("Sound and motion for this table. M mutes it anywhere on the page."));
    else {
      parts.push(text("Sound plays at the table."));
      if (!G.E1FX) parts.push(linkButton("Open the table", siteUrl("play.html")));
    }
    fill("music", parts);
    paintMusic();
  }

  // ------------------------------------------------------------------ wallet

  const walletKey = () => (typeof G.NUTFT_STORE === "string" && G.NUTFT_STORE) || "600b:nutft-wallet";

  /* The wallet as storage holds it, read straight from storage, never by loading
     the wallet: the dot has to be right on a page that never opens the panel, and
     a wallet with no card in it has nothing to count. Nothing stored is an empty
     wallet; something that does not parse is null, and the wallet judges it. */
  function storedWallet() {
    const saved = load("localStorage", walletKey());
    if (!saved) return { tokens: [], outgoing: [], pending: null };
    try {
      const state = JSON.parse(saved);
      return state && typeof state === "object" ? state : null;
    } catch (err) {
      return null;
    }
  }

  function refreshWaiting() {
    const state = storedWallet();
    waiting = state && Array.isArray(state.outgoing) ? state.outgoing.length : 0;
    paintWallet();
  }

  function paintWallet() {
    if (!ui) return;
    ui.wait.hidden = !(badges.wallet === "pending" || waiting > 0);
    if (openName === "wallet") renderWallet();
  }

  /* Only the site's own NutFT mint counts: the page's origin, answering
     /v1/info with the NUT-31 capability. Anything else is "not reachable". */
  async function reachMint() {
    const loc = G.location;
    if (!loc || !/^https?:$/.test(String(loc.protocol)) || typeof G.fetch !== "function") return null;
    const origin = String(loc.origin || loc.protocol + "//" + loc.host);
    try {
      const response = await withTimeout(Promise.resolve(G.fetch(origin + "/v1/info", { cache: "no-store" })), 6000);
      if (!response || !response.ok) return null;
      const info = await response.json();
      return info && info.nuts && info.nuts[31] ? origin : null;
    } catch (err) {
      return null;
    }
  }

  /* Whether a token names `mintUrl`. A Cashu token carries its mint's URL as plain
     bytes (cashuB is CBOR, cashuA is JSON, both base64), so this needs no wallet
     library. The E1 mint's /v1/info says nothing about G, so G is asked only where
     this browser holds a card G issued — a G-less origin never issued one. */
  function namesMint(token, mintUrl) {
    try {
      const body = String(token).replace(/^cashu[AB]/, "").replace(/-/g, "+").replace(/_/g, "/");
      return G.atob(body).indexOf(mintUrl) >= 0;
    } catch (err) {
      return false;
    }
  }

  async function checkWallet() {
    wallet.held = null;
    wallet.distinct = null;
    wallet.mint = null;
    wallet.unfinished = false;
    wallet.empty = false;
    const stored = storedWallet();
    /* No card on this device: nothing to count, so no wallet library (it imports
       its Cashu code at runtime) and no mint is asked anything. */
    if (stored && !(Array.isArray(stored.tokens) && stored.tokens.length)) {
      wallet.empty = true;
      wallet.unfinished = Boolean(stored.pending);
      return;
    }
    const W = await loadScript("nutft-wallet.js", "NutFTWallet");
    let state = null;
    if (W && typeof W.read === "function") {
      try { state = await W.read(); } catch (err) { state = null; }
    }
    if (state) {
      waiting = Array.isArray(state.outgoing) ? state.outgoing.length : 0;
      wallet.unfinished = Boolean(state.pending);
    }
    const mint = await reachMint();
    wallet.mint = Boolean(mint);
    /* An unfinished transfer or booster is left alone: counting would ask the
       wallet to finish it first, and that belongs on wallet.html, where a person
       watches it happen. Without one, counting only reads. */
    if (!W || !state || !mint || wallet.unfinished) return;
    const tokens = Array.isArray(state.tokens) ? state.tokens : [];
    const mints = tokens.some((token) => namesMint(token, mint + "/g")) ? [mint, mint + "/g"] : [mint];
    const snapshot = typeof W.snapshotMany === "function"
      ? await withTimeout(W.snapshotMany(mints), 30000)
      : await withTimeout(W.snapshot(mint), 30000);
    const owned = snapshot && Array.isArray(snapshot.owned) ? snapshot.owned : null;
    if (!owned) return;
    wallet.held = owned.length;
    wallet.distinct = new Set(owned.map((item) => (Array.isArray(item.tag)
      ? item.tag[1] + "\n" + item.tag[2]
      : String(item.asset && item.asset.asset_id)))).size;
  }

  /* Asked on open, at most every 20 seconds, never twice at once. An empty wallet
     is only a storage read, so it is read again on every open: a booster bought
     on this page shows up at once. */
  function refreshWallet() {
    if (wallet.busy) return wallet.busy;
    if (wallet.checkedAt && !wallet.empty && Date.now() - wallet.checkedAt < 20000) return Promise.resolve();
    wallet.busy = checkWallet()
      .catch(() => {
        wallet.held = null;
        wallet.distinct = null;
      })
      .then(() => {
        wallet.busy = null;
        wallet.checkedAt = Date.now();
        paintWallet(); // re-renders the panel too, when it is open
      });
    renderWallet();
    return wallet.busy;
  }

  function renderWallet() {
    if (!ui) return;
    const checking = Boolean(wallet.busy);
    const stat = (label, value) => {
      const cell = el("div");
      cell.append(el("span", "tcg-pop__label", label), el("span", "tcg-pop__num", value === null ? DASH : String(value)));
      return cell;
    };
    const parts = [];
    if (!checking && wallet.empty) parts.push(text("No cards on this device yet."));
    else {
      const stats = el("div", "tcg-pop__stats");
      stats.append(stat("Cards held", wallet.held), stat("Different", wallet.distinct));
      const mint = el("div");
      mint.append(
        el("span", "tcg-pop__label", "Mint"),
        text(checking ? "Checking…" : wallet.mint === true ? "Reachable" : wallet.mint === false ? "Not reachable" : DASH),
      );
      parts.push(stats, mint);
    }
    if (waiting > 0) {
      const row = el("div", "tcg-pop__row");
      row.append(el("span", "tcg-pop__dot"), text(waiting === 1
        ? "1 card sent, not yet marked delivered."
        : waiting + " cards sent, not yet marked delivered."));
      parts.push(row);
    }
    if (!checking && wallet.unfinished) parts.push(text("Something in the wallet is unfinished. Open the wallet to finish it."));
    else if (!checking && !wallet.empty && wallet.checkedAt && wallet.held === null) parts.push(text("Not available here yet."));
    const box = el("div", "tcg-pop__box");
    box.append(el("span", "tcg-pop__label", "Not your account"), el("span", "tcg-pop__meta", "Your cards live in this browser, apart from signing in."));
    parts.push(box, linkButton("Open wallet", siteUrl("wallet.html"), { primary: true, external: true }));
    fill("wallet", parts);
  }

  // -------------------------------------------------------------- chat, share

  function renderChat() {
    fill("chat", [text("Chat lives in Nappelin."), linkButton("Open Nappelin", NAPPELIN, { external: true })]);
  }

  /* A shared link says which page, and which public table options, nothing
     more: no match, table code, relay, key or fragment survives. */
  function publicUrl(href) {
    let url;
    try { url = new URL(String(href || "")); } catch (err) { return ""; }
    const kept = new URLSearchParams();
    for (const name of Object.keys(SHARE_KEEP)) {
      const value = url.searchParams.get(name);
      if (SHARE_KEEP[name].indexOf(value) >= 0) kept.set(name, value);
    }
    const query = kept.toString();
    return url.protocol + "//" + url.host + url.pathname + (query ? "?" + query : "");
  }

  function renderShare() {
    const url = publicUrl(G.location && G.location.href);
    const well = el("div", "tcg-pop__well", url || DASH);
    const qr = el("div", "tcg-pop__qr");
    qr.hidden = true;
    const note = el("div", "tcg-pop__box");
    note.append(
      el("span", "tcg-pop__label", "What a link never carries"),
      el("span", "tcg-pop__meta", "Your table code, a match invitation or anything about who you are. A shared link only says which page you were on."),
    );
    fill("share", [text("A link straight back to this page."), well, qr, action("Copy link", () => copyLink(url, well), true), note]);
    if (!url) return;
    loadScript("qr.js", "E1QR").then((QR) => {
      if (!QR || typeof QR.svg !== "function" || !qr.parentNode) return;
      try {
        qr.innerHTML = QR.svg(url, { ec: "M", dark: "#0f0c08", light: "#ece3d0" });
        qr.hidden = false;
      } catch (err) { /* an unscannable code is worse than none */ }
    });
  }

  async function copyLink(url, well) {
    if (!url) return;
    try {
      await G.navigator.clipboard.writeText(url);
      say("share", "Link copied.");
    } catch (err) {
      try {
        const range = doc.createRange();
        range.selectNodeContents(well);
        const selection = G.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (ignored) { /* nothing to select with */ }
      say("share", "Select the link above and copy it.");
    }
  }

  // ------------------------------------------------------------ open / close

  const RENDER = {
    account() { renderAccount(); refreshIdentity(); },
    music: renderMusic,
    wallet() { renderWallet(); refreshWallet(); },
    chat: renderChat,
    share: renderShare,
  };

  /* Replaces a panel's words without dropping focus on the floor: if the
     focused control was one of the replaced nodes, the panel takes focus. */
  function fill(name, parts) {
    if (!ui) return;
    const panel = ui.panels[name];
    const hadFocus = panel.contains(doc.activeElement);
    ui.contents[name].replaceChildren(...parts);
    if (hadFocus && !panel.contains(doc.activeElement)) panel.focus();
  }

  function say(name, message) {
    if (ui) ui.status[name].textContent = message || "";
  }

  function open(name) {
    if (NAMES.indexOf(name) < 0) return false;
    mount();
    if (!ui) return false;
    if (openName && openName !== name) hide(openName);
    openName = name;
    say(name, "");
    ui.buttons[name].setAttribute("aria-expanded", "true");
    ui.panels[name].hidden = false;
    ui.pop.hidden = false;
    RENDER[name]();
    try { ui.panels[name].focus(); } catch (err) { /* focus is best effort */ }
    return true;
  }

  function hide(name) {
    ui.buttons[name].setAttribute("aria-expanded", "false");
    ui.panels[name].hidden = true;
  }

  /* Focus goes back to the button only when it was inside the panel: a click
     somewhere else on the page keeps the focus it just put there. */
  function close(restore) {
    if (!ui || !openName) return;
    const name = openName;
    const inside = ui.pop.contains(doc.activeElement);
    openName = null;
    hide(name);
    ui.pop.hidden = true;
    if (restore !== false && inside) ui.buttons[name].focus();
    paintMusic();
  }

  function toggle(name) {
    if (openName === name) close();
    else open(name);
  }

  function setEdge(next, remember) {
    if (EDGES.indexOf(next) < 0) return;
    edge = next;
    if (remember) save("localStorage", EDGE_KEY, next);
    doc.documentElement.setAttribute("data-tcg-rail", next);
    if (!ui) return;
    ui.edgeBar.setAttribute("d", EDGE_BAR[next]);
    ui.move.setAttribute("aria-label", "Move the bar to the " + EDGES[(EDGES.indexOf(next) + 1) % EDGES.length]);
  }

  // One Escape closes one layer: the panel, and nothing the page does with Escape.
  function onKey(event) {
    if (!openName || !event || (event.key !== "Escape" && event.key !== "Esc")) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
    close();
  }

  function onOutside(event) {
    if (!openName || !ui) return;
    const target = event && event.target;
    if (target && ui.rail.contains(target)) return;
    close(false);
  }

  function onStorage(event) {
    const key = event && event.key;
    if (key === null || key === undefined || key === PUBKEY_KEY) refreshIdentity();
    if (key === null || key === undefined || key === walletKey()) refreshWaiting();
  }

  // ------------------------------------------------------------------- mount

  function mount() {
    if (ui || !doc.body) return;
    const rail = el("aside", "tcg-rail");
    rail.id = "tcg-rail";
    rail.setAttribute("aria-label", "Your essentials");
    const pop = el("div", "tcg-pop");
    pop.hidden = true;
    const built = { rail, pop, buttons: {}, labels: {}, panels: {}, contents: {}, status: {} };

    for (const name of NAMES) {
      const button = el("button", "tcg-rail__btn");
      button.type = "button";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", "tcg-pop-" + name);
      const holder = el("span", "tcg-rail__icon");
      const [box, size, shapes] = ICONS[name];
      holder.appendChild(icon(box, size, shapes));
      const label = el("span", "tcg-rail__label", TITLES[name]);
      button.append(holder, label);
      button.addEventListener("click", () => toggle(name));
      rail.appendChild(button);
      built.buttons[name] = button;
      built.labels[name] = label;
      if (name === "account") {
        built.live = el("span", "tcg-rail__dot tcg-rail__dot--live");
        built.live.hidden = true;
        holder.appendChild(built.live);
      }
      if (name === "wallet") {
        built.wait = el("span", "tcg-rail__dot tcg-rail__dot--wait");
        built.wait.hidden = true;
        holder.appendChild(built.wait);
      }

      const panel = el("div", "tcg-pop__panel");
      panel.id = "tcg-pop-" + name;
      panel.hidden = true;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-labelledby", panel.id + "-title");
      panel.setAttribute("tabindex", "-1");
      const head = el("div", "tcg-pop__head");
      const title = el("h2", "tcg-pop__title", TITLES[name]);
      title.id = panel.id + "-title";
      const shut = el("button", "tcg-pop__close", "×");
      shut.type = "button";
      shut.setAttribute("aria-label", "Close " + TITLES[name]);
      shut.addEventListener("click", () => close());
      head.append(title, shut);
      const body = el("div", "tcg-pop__body");
      const content = el("div", "tcg-pop__content");
      const status = el("p", "tcg-pop__status");
      status.setAttribute("role", "status");
      body.append(content, status, slots[name]);
      panel.append(head, body);
      pop.appendChild(panel);
      built.panels[name] = panel;
      built.contents[name] = content;
      built.status[name] = status;
    }

    const move = el("button", "tcg-rail__btn tcg-rail__move");
    move.type = "button";
    const glyph = el("span", "tcg-rail__icon");
    const square = icon("0 0 14 14", 14, [{ "fill-rule": "evenodd", d: "M0 0H14V14H0Z M1 1V13H13V1Z" }, { d: EDGE_BAR[edge] }]);
    glyph.appendChild(square);
    move.append(glyph, el("span", "tcg-rail__label", "Move"));
    move.addEventListener("click", () => {
      close(false);
      setEdge(EDGES[(EDGES.indexOf(edge) + 1) % EDGES.length], true);
    });
    built.move = move;
    built.edgeBar = square.children[1];

    rail.append(el("span", "tcg-rail__spacer"), move, pop);
    ui = built;

    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onOutside, true);
    doc.addEventListener("focusin", onOutside, true);
    doc.addEventListener("keyup", paintMusicSoon, true);
    pop.addEventListener("click", paintMusicSoon);
    doc.body.appendChild(rail);

    setEdge(edge, false);
    paintAccount();
    paintMusic();
    refreshWaiting();
    refreshIdentity().then(() => {
      const key = who.pubkey;
      if (key) setTimeout(() => { if (who.pubkey === key) announceIdentity(key); }, 0);
    });
  }

  /* Window-level news is heard from the start, so an e1:auth that lands before
     the bar is built is not lost. */
  if (typeof G.addEventListener === "function") {
    G.addEventListener("e1:auth", onAuth);
    G.addEventListener("storage", onStorage);
    G.addEventListener("pageshow", () => { refreshIdentity(); refreshWaiting(); });
  }
  if (narrow) {
    const follow = () => { if (!savedEdge()) setEdge(defaultEdge(), false); };
    if (typeof narrow.addEventListener === "function") narrow.addEventListener("change", follow);
    else if (typeof narrow.addListener === "function") narrow.addListener(follow);
  }
  if (doc.readyState === "loading" || !doc.body) doc.addEventListener("DOMContentLoaded", mount);
  else mount();

  function setBadge(name, state) {
    const clear = state === null || state === undefined || state === false || state === "";
    if (name === "wallet" && (clear || state === "pending")) {
      badges.wallet = clear ? null : "pending";
      paintWallet();
      return true;
    }
    if (name === "music" && (clear || state === "playing" || state === "paused")) {
      badges.music = clear ? null : state;
      paintMusic();
      return true;
    }
    return false; // the account dot answers to e1:auth alone; chat and share carry no badge
  }

  G.E1Rail = Object.freeze({
    /** The panel's own mount point: the same element on every call, for the page's lifetime. */
    slot: (name) => slots[name] || null,
    /** Open a panel by name ("account", "music", "wallet", "chat", "share"). */
    open,
    /** Close whatever panel is open. */
    close: () => close(),
    /** "wallet": "pending" | null. "music": "playing" | "paused" | null. Anything else: false. */
    setBadge,
    /** The edge the bar sits on: "right", "bottom", "left" or "top". */
    edge: () => edge,
  });
})();
