/* site/rail.js — the side bar, tested without a browser.
 *
 * The bar is chrome on every page, so what it must never do matters as much as
 * what it does: never load the wallet with the page, never light green on its
 * own, never put a match code in a shared link, never appear inside a napplet
 * shell. rail.js reaches every browser global through globalThis, so each test
 * evaluates it against a fresh stand-in scope with a stub DOM just large enough
 * to be honest about the calls the bar makes.
 *
 * Run: node --test tests/js/rail.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, "..", "..", "site", "rail.js"), "utf8");
const KEY = "b".repeat(64);
const NAMES = ["account", "music", "wallet", "chat", "share"];

// ------------------------------------------------------------------ stub DOM

class StubNode {
  constructor(doc, tag, ns) {
    this.ownerDocument = doc;
    this.localName = tag;
    this.namespaceURI = ns || null;
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.listeners = new Map();
    this.own = "";
    this.hidden = false;
    this.id = "";
    this.className = "";
  }

  get textContent() { return this.own + this.children.map((kid) => kid.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this.own = String(value); }

  appendChild(kid) {
    if (kid.parentNode) kid.remove();
    kid.parentNode = this;
    this.children.push(kid);
    return kid;
  }
  append(...kids) { for (const kid of kids) this.appendChild(kid); }
  replaceChildren(...kids) {
    for (const kid of this.children) kid.parentNode = null;
    this.children = [];
    this.own = "";
    this.append(...kids);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((kid) => kid !== this);
    this.parentNode = null;
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  removeAttribute(name) { this.attrs.delete(name); }

  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    const write = (list) => { this.className = list.join(" "); };
    return {
      contains: (name) => names().includes(name),
      add: (...added) => write([...new Set([...names(), ...added])]),
      remove: (...removed) => write(names().filter((name) => !removed.includes(name))),
      toggle: (name, force) => {
        const on = force === undefined ? !names().includes(name) : Boolean(force);
        write(on ? [...new Set([...names(), name])] : names().filter((each) => each !== name));
        return on;
      },
    };
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((each) => each !== fn));
  }
  fire(type, extra) {
    const event = {
      type, target: this, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...extra,
    };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    return event;
  }
  click() { return this.fire("click"); }
  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.fire("focusin", { target: this });
  }
}

class StubDocument extends StubNode {
  constructor(readyState) {
    super(null, "#document");
    this.ownerDocument = this;
    this.readyState = readyState;
    this.documentElement = new StubNode(this, "html");
    this.head = new StubNode(this, "head");
    this.documentElement.appendChild(this.head);
    this.body = null;
    if (readyState !== "loading") this.addBody();
    this.activeElement = this.body;
  }
  addBody() {
    this.body = new StubNode(this, "body");
    this.documentElement.appendChild(this.body);
    return this.body;
  }
  createElement(tag) { return new StubNode(this, tag); }
  createElementNS(ns, tag) { return new StubNode(this, tag, ns); }
  getElementById(id) { return find(this.documentElement, (node) => node.id === id); }
}

function findAll(root, match, out = []) {
  if (!root) return out;
  if (match(root)) out.push(root);
  for (const kid of root.children) findAll(kid, match, out);
  return out;
}
const find = (root, match) => findAll(root, match)[0] || null;

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

/** A page: a document, storage, a location and a window to hear events on. */
function makeScope(options = {}) {
  const doc = new StubDocument(options.ready || "complete");
  const href = options.href || "http://localhost:8790/index.html";
  const url = new URL(href);
  const heard = new Map();
  const scope = {
    document: doc,
    localStorage: options.localStorage || memoryStorage(options.storage),
    sessionStorage: memoryStorage(),
    location: { href, search: url.search, protocol: url.protocol, host: url.host, origin: url.origin, pathname: url.pathname },
    matchMedia: (media) => ({ media, matches: Boolean(options.narrow), addEventListener() {}, removeEventListener() {} }),
    navigator: { clipboard: { writeText: async () => {} } },
    atob: (text) => globalThis.atob(text),
    fetch: options.fetch || (async () => ({ ok: false, status: 404, json: async () => ({}) })),
    addEventListener(type, fn) {
      if (!heard.has(type)) heard.set(type, []);
      heard.get(type).push(fn);
    },
    removeEventListener() {},
    heard,
    dispatched: [],
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init ? init.detail : undefined;
      }
    },
    ...(options.globals || {}),
  };
  /** What the bar itself dispatches on the window (e1:identity). */
  scope.dispatchEvent = (event) => {
    scope.dispatched.push(event);
    for (const fn of heard.get(event.type) || []) fn(event);
    return true;
  };
  /** Dispatch on the window, the way play.js sends e1:auth. */
  scope.emit = (type, detail) => { for (const fn of heard.get(type) || []) fn({ type, detail }); };
  return scope;
}

/** Evaluates rail.js with `scope` standing in for globalThis. */
function run(scope) {
  // eslint-disable-next-line no-new-func
  new Function("globalThis", SOURCE)(scope);
  return scope.E1Rail;
}

const bar = (scope) => scope.document.getElementById("tcg-rail");
const button = (scope, name) => find(bar(scope), (node) => node.getAttribute("aria-controls") === `tcg-pop-${name}`);
const panel = (scope, name) => scope.document.getElementById(`tcg-pop-${name}`);
const byClass = (root, name) => find(root, (node) => node.classList.contains(name));
const label = (scope, name) => byClass(button(scope, name), "tcg-rail__label").textContent;
const scripts = (scope) => findAll(scope.document.documentElement, (node) => node.localName === "script");
const numbers = (scope) => findAll(panel(scope, "wallet"), (node) => node.classList.contains("tcg-pop__num")).map((node) => node.textContent);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const identities = (scope) => scope.dispatched.filter((event) => event.type === "e1:identity").map((event) => event.detail.pubkey);
function press(root, words) {
  const target = find(root, (node) => node.localName === "button" && node.textContent === words);
  assert.ok(target, `there is a "${words}" button`);
  target.click();
}

async function waitFor(check, what, turns = 200) {
  for (let turn = 0; turn < turns; turn += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, turn < 20 ? 0 : 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

// ------------------------------------------------------------------- mounting

test("the bar is injected once, however often the script is included", () => {
  const scope = makeScope();
  const first = run(scope);
  const second = run(scope);
  assert.equal(second, first, "a second include hands back the same bar");
  assert.equal(findAll(scope.document.head, (node) => node.id === "tcg-rail-css").length, 1, "one <style>");
  assert.equal(findAll(scope.document.body, (node) => node.id === "tcg-rail").length, 1, "one bar");

  const aside = bar(scope);
  assert.equal(aside.localName, "aside");
  assert.equal(aside.getAttribute("aria-label"), "Your essentials");
  const order = findAll(aside, (node) => node.classList.contains("tcg-rail__btn") && node.getAttribute("aria-controls"))
    .map((node) => node.getAttribute("aria-controls").replace("tcg-pop-", ""));
  assert.deepEqual(order, NAMES, "Account, Music, Wallet, Chat, Share, in that order");
  for (const name of NAMES) {
    assert.ok(panel(scope, name), `${name}: aria-controls names a real panel`);
    assert.equal(button(scope, name).getAttribute("aria-expanded"), "false");
    assert.equal(button(scope, name).type, "button", "a button, reachable from the keyboard");
  }
});

test("inside a napplet shell the bar does nothing at all", async () => {
  const variants = [
    { globals: { E1Napplet: { embedded: () => true } } },
    { href: "http://localhost:8790/play.html?embed=1" },
    { globals: { napplet: { identity: {} } } },
  ];
  for (const variant of variants) {
    const touched = [];
    const spy = {
      getItem(key) { touched.push(key); return null; },
      setItem(key) { touched.push(key); },
      removeItem(key) { touched.push(key); },
    };
    const scope = makeScope({ ...variant, localStorage: spy });
    const api = run(scope);
    await settle();
    await settle();
    const why = JSON.stringify(variant);
    assert.deepEqual(scope.dispatched, [], `${why}: no events either`);
    assert.equal(scope.document.head.children.length, 0, `${why}: no style`);
    assert.equal(scope.document.body.children.length, 0, `${why}: no bar`);
    assert.equal(scope.document.documentElement.getAttribute("data-tcg-rail"), null, `${why}: no page padding`);
    assert.equal(scope.document.listeners.size, 0, `${why}: no document listeners`);
    assert.equal(scope.heard.size, 0, `${why}: no window listeners`);
    assert.deepEqual(touched, [], `${why}: storage untouched`);
    assert.equal(api.slot("music"), null, "slot() is safe to ask and answers null");
    assert.equal(api.open("account"), false);
    assert.equal(api.setBadge("wallet", "pending"), false);
    assert.equal(api.edge(), null);
    api.close();
  }
});

// ----------------------------------------------------------------------- edge

test("the edge starts right, cycles right, bottom, left, top, and is remembered", () => {
  const scope = makeScope();
  const api = run(scope);
  const html = scope.document.documentElement;
  assert.equal(api.edge(), "right");
  assert.equal(html.getAttribute("data-tcg-rail"), "right", "the page padding follows the edge");

  const move = byClass(bar(scope), "tcg-rail__move");
  assert.equal(move.getAttribute("aria-label"), "Move the bar to the bottom", "the control names where it will go");
  const seen = [];
  for (let step = 0; step < 4; step += 1) {
    move.click();
    seen.push(api.edge());
    assert.equal(html.getAttribute("data-tcg-rail"), api.edge());
    assert.equal(scope.localStorage.map.get("600b:rail"), api.edge(), "persisted as 600b:rail");
  }
  assert.deepEqual(seen, ["bottom", "left", "top", "right"]);

  assert.equal(run(makeScope({ storage: { "600b:rail": "left" } })).edge(), "left", "a returning visitor keeps it");
  assert.equal(run(makeScope({ storage: { "600b:rail": "diagonal" } })).edge(), "right", "junk is ignored");
});

test("under 700px the bar defaults to the bottom, and a stored choice still wins", () => {
  assert.equal(run(makeScope({ narrow: true })).edge(), "bottom");
  assert.equal(run(makeScope({ narrow: true, storage: { "600b:rail": "right" } })).edge(), "right");
});

test("storage that refuses everything costs the bar its memory, not the page", () => {
  const refuse = () => { throw new Error("denied"); };
  const scope = makeScope({ localStorage: { getItem: refuse, setItem: refuse, removeItem: refuse } });
  const api = run(scope);
  assert.equal(api.edge(), "right");
  byClass(bar(scope), "tcg-rail__move").click();
  assert.equal(api.edge(), "bottom", "the move still happens for this page");
});

// ---------------------------------------------------------------------- share

test("a shared link keeps rules and arena and drops everything else", () => {
  const cases = [
    [
      `http://bitbeam:8777/play.html?match=m_0123456789ab&code=K7M2QF&table=ws://elsewhere:9000/ws&relay=wss://relay.example&pubkey=${KEY}&rules=fast&arena=3d#seat-1`,
      "http://bitbeam:8777/play.html?rules=fast&arena=3d",
    ],
    ["https://tcg.zapburg.com/matchmaking.html?code=K7M2QF&match=m_0123456789ab", "https://tcg.zapburg.com/matchmaking.html"],
    ["http://localhost:8790/play.html?rules=%3Cscript%3E&arena=dom", "http://localhost:8790/play.html?arena=dom"],
    // Only values the pages act on survive: a harmless-looking word is still not one of them.
    ["http://localhost:8790/play.html?arena=webgl&rules=turbo", "http://localhost:8790/play.html"],
    ["http://localhost:8790/play.html?arena=3d&rules=K7M2QF", "http://localhost:8790/play.html?arena=3d"],
    ["http://localhost:8790/deck.html?rules=classic&arena=DOM", "http://localhost:8790/deck.html?rules=classic"],
    ["http://user:secret@localhost:8790/cards.html?embed=0&assets=local&arenastats=1", "http://localhost:8790/cards.html"],
  ];
  for (const [href, expected] of cases) {
    const scope = makeScope({ href });
    const api = run(scope);
    assert.equal(api.open("share"), true);
    const well = byClass(panel(scope, "share"), "tcg-pop__well");
    assert.equal(well.textContent, expected, href);
    for (const secret of ["K7M2QF", "m_0123456789ab", "elsewhere", "relay.example", KEY, "secret", "seat-1"]) {
      assert.ok(!panel(scope, "share").textContent.includes(secret), `${secret} must not reach the Share panel`);
    }
  }
});

test("the QR encoder loads when Share opens, and not before", () => {
  const scope = makeScope();
  const api = run(scope);
  assert.equal(scripts(scope).length, 0, "a page load fetches nothing for the bar");
  api.open("share");
  assert.deepEqual(scripts(scope).map((node) => node.src), ["qr.js"]);
});

// ---------------------------------------------------------------------- music

test("slot('music') is one element for the life of the page, before and after the bar mounts", () => {
  const scope = makeScope({ ready: "loading" });
  const api = run(scope);
  assert.equal(scope.document.documentElement.getAttribute("data-tcg-rail"), "right", "padding is set from <head>");
  const early = api.slot("music");
  assert.ok(early && early.localName === "div", "there is a slot before the page has a body");
  assert.equal(api.slot("music"), early);

  scope.document.addBody();
  scope.document.readyState = "interactive";
  scope.document.fire("DOMContentLoaded");
  assert.equal(api.slot("music"), early, "mounting does not swap it");
  assert.ok(panel(scope, "music").contains(early), "it lives inside the Music panel");

  early.appendChild(scope.document.createElement("div")); // the table's sound controls
  api.open("music");
  api.close();
  api.open("wallet");
  api.open("music");
  assert.equal(api.slot("music"), early, "opening and closing panels keeps it");
  assert.ok(panel(scope, "music").contains(early));
  assert.equal(early.children.length, 1, "and keeps what was mounted into it");
  assert.notEqual(api.slot("wallet"), early);
  assert.equal(api.slot("nonsense"), null);
});

test("away from the table, Music says where the sound is and Chat points at Nappelin", () => {
  const scope = makeScope();
  const api = run(scope);
  api.open("music");
  assert.match(panel(scope, "music").textContent, /Sound plays at the table\./);
  const toTable = find(panel(scope, "music"), (node) => node.localName === "a");
  assert.equal(toTable.href, "play.html");

  api.open("chat");
  assert.match(panel(scope, "chat").textContent, /Chat lives in Nappelin\./);
  const toNappelin = find(panel(scope, "chat"), (node) => node.localName === "a");
  assert.equal(toNappelin.href, "https://nappelin.com/hangar/");
  assert.equal(toNappelin.target, "_blank", "a game in progress is never navigated away from");
  assert.match(toNappelin.rel, /noopener/);
  assert.equal(find(panel(scope, "chat"), (node) => node.localName === "input"), null, "no fake room to type into");
});

// --------------------------------------------------------------------- green

test("the account dot stays dark until the table accepts a login, and goes dark on ok:false", async () => {
  let saved = KEY;
  const E1Net = { nostr: { savedPubkey: () => saved, hasNip07: () => true, login: async () => KEY, logout() { saved = null; } } };
  const scope = makeScope({ globals: { E1Net } });
  const api = run(scope);
  await settle();
  const live = byClass(bar(scope), "tcg-rail__dot--live");
  assert.equal(label(scope, "account"), "Account");
  assert.equal(live.hidden, true, "signed in is not the same as verified");

  assert.equal(api.setBadge("account", "live"), false, "no page can switch green on");
  assert.equal(live.hidden, true);
  for (const detail of [{ ok: "true" }, { ok: 1 }, {}, null]) {
    scope.emit("e1:auth", detail);
    await settle();
    assert.equal(live.hidden, true, `only detail.ok === true counts, not ${JSON.stringify(detail)}`);
  }

  scope.emit("e1:auth", { ok: true });
  await settle();
  assert.equal(live.hidden, false, "AUTH_OK lights it");
  scope.emit("e1:auth", { ok: false });
  await settle();
  assert.equal(live.hidden, true, "a closed seat puts it out");

  scope.emit("e1:auth", { ok: true });
  await settle();
  api.open("account");
  assert.match(panel(scope, "account").textContent, /The table has verified this key\./,
    "words that fit the lobby, which has no seat, as well as the table");
  const signOut = find(panel(scope, "account"), (node) => node.localName === "button" && node.textContent === "Sign out");
  signOut.click();
  await settle();
  assert.equal(live.hidden, true, "signing out puts it out");
  assert.equal(label(scope, "account"), "Sign in");
});

test("the dot follows the table's last word, for the key that was signed in when it spoke", async () => {
  /* play.js sends e1:auth only when its answer flips. Signing out ends the
     table's session (net.js closes the socket), and the table page then says
     ok:false, which this stand-in does the way play.js does. */
  const other = "c".repeat(64);
  let saved = KEY;
  let next = KEY;
  const scope = makeScope();
  scope.E1Net = { nostr: {
    savedPubkey: () => saved, hasNip07: () => true,
    login: async () => { saved = next; return next; },
    logout() { saved = null; scope.emit("e1:auth", { ok: false }); },
  } };
  const api = run(scope);
  await settle();
  const live = byClass(bar(scope), "tcg-rail__dot--live");
  const account = panel(scope, "account");

  scope.emit("e1:auth", { ok: true });
  await settle();
  assert.equal(live.hidden, false, "the table said ok");
  scope.emit("storage", null);
  await settle();
  assert.equal(live.hidden, false, "a storage refresh is not the table speaking");

  // Another tab signs out and back in with the same key: this page's login still stands.
  saved = null;
  scope.emit("storage", null);
  await settle();
  assert.equal(live.hidden, true, "signed out elsewhere is dark here too");
  saved = KEY;
  scope.emit("storage", null);
  await settle();
  assert.equal(live.hidden, false, "the same key back, and the table has said nothing new: its last word stands");

  api.open("account");
  press(account, "Sign out");
  await settle();
  assert.equal(live.hidden, true, "signed out is dark");
  press(account, "Sign in");
  await settle();
  assert.equal(live.hidden, true, "the same key again, but signing out ended the table's session");
  assert.doesNotMatch(account.textContent, /verified/);
  scope.emit("e1:auth", { ok: true });
  await settle();
  assert.equal(live.hidden, false, "until the table verifies the new login");

  press(account, "Sign out");
  await settle();
  next = other;
  press(account, "Sign in");
  await settle();
  assert.equal(live.hidden, true, "a different key is not the one the table verified");
  scope.emit("e1:auth", { ok: true });
  await settle();
  assert.equal(live.hidden, false, "until the table verifies this one");
});

test("an answer to an older e1:auth never rebinds the dot to another key", async () => {
  const asks = [];
  const identity = { source: () => "nip07", current: () => new Promise((resolve) => asks.push(resolve)) };
  const scope = makeScope({ globals: { E1Napplet: { embedded: () => false, identity } } });
  run(scope);
  asks.shift()(KEY); // the bar's own first look
  await settle();
  const live = byClass(bar(scope), "tcg-rail__dot--live");

  scope.emit("e1:auth", { ok: true });
  scope.emit("e1:auth", { ok: false });
  scope.emit("e1:auth", { ok: true });
  assert.equal(asks.length, 2, "each ok asked who is signed in");
  const [older, latest] = asks.splice(0, 2);
  latest(KEY);
  await settle();
  while (asks.length) asks.shift()(KEY);
  await settle();
  assert.equal(live.hidden, false, "the latest ok binds the signed-in key");

  older("c".repeat(64)); // the older question answers last, naming someone else
  await settle();
  while (asks.length) asks.shift()(KEY);
  await settle();
  assert.equal(live.hidden, false, "and a stale answer does not move it");
});

test("a signed-out page never shows green, whatever the table says", async () => {
  const E1Net = { nostr: { savedPubkey: () => null, hasNip07: () => false } };
  const scope = makeScope({ globals: { E1Net } });
  run(scope);
  scope.emit("e1:auth", { ok: true });
  await settle();
  assert.equal(byClass(bar(scope), "tcg-rail__dot--live").hidden, true);
});

// -------------------------------------------------------------------- account

test("with no extension the Account panel says so in plain words, and a guest is a choice", () => {
  const E1Napplet = { embedded: () => false, identity: { source: () => "none", current: async () => null } };
  const scope = makeScope({ globals: { E1Napplet } });
  const api = run(scope);
  assert.equal(label(scope, "account"), "Sign in");
  api.open("account");
  assert.match(panel(scope, "account").textContent, /No compatible browser extension found\. You can play as a guest\./);
  assert.equal(find(panel(scope, "account"), (node) => node.textContent === "Sign in" && node.localName === "button"), null,
    "no sign-in button that cannot work");
  find(panel(scope, "account"), (node) => node.localName === "button" && node.textContent === "Play as a guest").click();
  assert.equal(label(scope, "account"), "Guest");
  assert.equal(scope.sessionStorage.map.get("600b:rail-guest"), "1");
});

test("e1:identity says who was signed in at load, then every sign-in and sign-out the panel makes", async () => {
  const other = "c".repeat(64);
  let saved = KEY;
  const E1Net = { nostr: {
    savedPubkey: () => saved, hasNip07: () => true,
    login: async () => { saved = other; return other; },
    logout() { saved = null; },
  } };
  const scope = makeScope({ globals: { E1Net } });
  const api = run(scope);
  await waitFor(() => identities(scope).length === 1, "the load-time identity");
  assert.deepEqual(identities(scope), [KEY], "once, with the saved key");
  await settle();
  await settle();
  assert.equal(identities(scope).length, 1, "and only once");

  api.open("account");
  press(panel(scope, "account"), "Sign out");
  await waitFor(() => identities(scope).length === 2, "the sign-out");
  assert.deepEqual(identities(scope), [KEY, null]);

  press(panel(scope, "account"), "Sign in");
  await waitFor(() => identities(scope).length === 3, "the sign-in");
  assert.deepEqual(identities(scope), [KEY, null, other]);
});

test("the load-time identity reaches a page that starts listening from its own DOMContentLoaded", async () => {
  /* rail.js is included before the page's scripts, so its DOMContentLoaded
     handler runs first, and a browser drains microtasks between handlers. An
     announcement made on a microtask would be gone before play.js listens. */
  const E1Net = { nostr: { savedPubkey: () => KEY, hasNip07: () => true } };
  const scope = makeScope({ ready: "loading", globals: { E1Net } });
  run(scope);
  const heardByPage = [];
  scope.document.addEventListener("DOMContentLoaded", () => {
    scope.addEventListener("e1:identity", (event) => heardByPage.push(event.detail.pubkey));
  });
  scope.document.addBody();
  scope.document.readyState = "interactive";
  for (const handler of [...scope.document.listeners.get("DOMContentLoaded")]) {
    handler({ type: "DOMContentLoaded" });
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve(); // the checkpoint between handlers
  }
  await waitFor(() => heardByPage.length === 1, "the page's own listener hearing the saved key");
  assert.deepEqual(heardByPage, [KEY]);
});

test("nobody signed in at load and a refused sign-in announce nothing", async () => {
  const E1Net = { nostr: {
    savedPubkey: () => null, hasNip07: () => true,
    login: async () => { throw new Error("the extension was dismissed"); },
    logout() {},
  } };
  const scope = makeScope({ globals: { E1Net } });
  const api = run(scope);
  await settle();
  await settle();
  assert.deepEqual(identities(scope), []);
  api.open("account");
  press(panel(scope, "account"), "Sign in");
  await settle();
  await settle();
  assert.deepEqual(identities(scope), [], "a sign-in that did not happen is not news");
  assert.match(panel(scope, "account").textContent, /Sign-in did not complete: the extension was dismissed/);
});

// ---------------------------------------------------------------- keyboard

test("Escape closes the open panel and gives focus back to its button", () => {
  const scope = makeScope();
  run(scope);
  const opener = button(scope, "account");
  opener.focus();
  opener.click();
  const account = panel(scope, "account");
  assert.equal(account.hidden, false);
  assert.equal(opener.getAttribute("aria-expanded"), "true");
  assert.ok(account.contains(scope.document.activeElement), "focus moved into the panel");

  const escape = scope.document.fire("keydown", { key: "Escape", target: scope.document.activeElement });
  assert.equal(account.hidden, true);
  assert.equal(opener.getAttribute("aria-expanded"), "false");
  assert.equal(scope.document.activeElement, opener, "focus is back on the button");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.stopped, true, "one Escape closes one layer, not the page's too");
  const later = scope.document.fire("keydown", { key: "Escape" });
  assert.equal(later.defaultPrevented, false, "with nothing open, Escape belongs to the page");

  opener.click();
  opener.click();
  assert.equal(account.hidden, true, "a second click closes");

  opener.click();
  const elsewhere = scope.document.createElement("p");
  scope.document.body.appendChild(elsewhere);
  scope.document.fire("pointerdown", { target: elsewhere });
  assert.equal(account.hidden, true, "a click outside closes");
  assert.notEqual(scope.document.activeElement, opener, "without pulling focus back to the bar");
});

// --------------------------------------------------------------------- wallet

/** A stand-in cashuB token: base64url of CBOR-shaped bytes that carry the mint URL verbatim. */
const cashuToken = (mint) => "cashuB" + Buffer.concat([
  Buffer.from([0xa3, 0x61, 0x6d, 0x78, mint.length]), Buffer.from(mint),
  Buffer.from([0x61, 0x75, 0x67]), Buffer.from("600B-E1"), Buffer.from([0x61, 0x74, 0x81]),
]).toString("base64url");
const walletStorage = (state) => ({ "600b:nutft-wallet": JSON.stringify({ privateKey: "", pubkey: "", outgoing: [], ...state }) });

test("the wallet script loads when the Wallet panel opens, never with the page", async () => {
  const stored = {
    privateKey: "", pubkey: "", tokens: [cashuToken("http://localhost:8790")],
    outgoing: [{ token: "cashuBx", asset_id: "E1-001", at: "2026-09-14T10:00:00Z" }],
  };
  const scope = makeScope({ storage: { "600b:nutft-wallet": JSON.stringify(stored) } });
  const api = run(scope);
  const walletScripts = () => scripts(scope).filter((node) => /nutft-wallet\.js$/.test(node.src));
  assert.equal(byClass(bar(scope), "tcg-rail__dot--wait").hidden, false,
    "a sent card still waiting shows on the button without loading anything");
  for (const name of ["account", "music", "chat", "share"]) {
    api.open(name);
    api.close();
  }
  assert.equal(walletScripts().length, 0, "no other panel loads the wallet");

  api.open("wallet");
  assert.equal(walletScripts().length, 1, "opening Wallet does");
  assert.equal(walletScripts()[0].src, "nutft-wallet.js");
  assert.deepEqual(numbers(scope), ["—", "—"], "nothing is counted before anything answered");

  let snapshots = 0;
  scope.NutFTWallet = {
    read: async () => ({ tokens: [], outgoing: [], pending: null }),
    snapshotManyReadOnly: async () => { snapshots += 1; return { owned: [] }; },
  };
  walletScripts()[0].fire("load");
  await waitFor(() => /Not available here yet\./.test(panel(scope, "wallet").textContent), "the unavailable copy");
  assert.deepEqual(numbers(scope), ["—", "—"], "an unreachable mint is dashes, not zero");
  assert.match(panel(scope, "wallet").textContent, /Not reachable/);
  assert.equal(snapshots, 0, "no mint, no count");
  const open = find(panel(scope, "wallet"), (node) => node.localName === "a");
  assert.equal(open.href, "wallet.html");
});

test("an empty wallet shows its empty state and never loads the wallet script or asks a mint", async () => {
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    return { ok: true, json: async () => ({ nuts: { 31: { supported: true } } }) };
  };
  const cases = [
    ["nothing stored", {}],
    ["no tokens, one card still on its way out", walletStorage({ tokens: [], outgoing: [{ token: "cashuBx", asset_id: "E1-001" }] })],
    ["no tokens, a booster being bought", walletStorage({ tokens: [], pending: { type: "booster" } })],
  ];
  for (const [why, storage] of cases) {
    const scope = makeScope({ href: "https://tcg.zapburg.com/index.html", storage, fetch });
    const api = run(scope);
    api.open("wallet");
    await waitFor(() => /No cards on this device yet\./.test(panel(scope, "wallet").textContent), `${why}: the empty state`);
    const words = panel(scope, "wallet").textContent;
    assert.deepEqual(numbers(scope), [], `${why}: no counts to show`);
    assert.doesNotMatch(words, /Not available here yet/, why);
    assert.equal(/1 card sent, not yet marked delivered\./.test(words), why.includes("on its way out"), `${why}: the waiting row`);
    assert.equal(/unfinished/.test(words), why.includes("booster"), `${why}: the unfinished note`);
    api.close();
    api.open("wallet");
    await settle();
    await settle();
    assert.deepEqual(scripts(scope), [], `${why}: nutft-wallet.js is never loaded`);
  }
  assert.deepEqual(fetched, [], "and no mint is asked anything");
});

test("an origin that never issued a G card is never asked for G", async () => {
  const fetched = [];
  const asked = [];
  const token = cashuToken("https://tcg.zapburg.com");
  const NutFTWallet = {
    read: async () => ({ tokens: [token], outgoing: [], pending: null }),
    snapshotManyReadOnly: async (mints) => {
      asked.push(mints);
      return { owned: [{ tag: ["1", "600b-e1", "E1-001"] }] };
    },
  };
  const scope = makeScope({
    href: "https://tcg.zapburg.com/shop.html",
    storage: walletStorage({ tokens: [token] }),
    fetch: async (url) => {
      fetched.push(url);
      return url.includes("/g/")
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, json: async () => ({ nuts: { 31: { supported: true } } }) };
    },
    globals: { NutFTWallet },
  });
  run(scope).open("wallet");
  await waitFor(() => numbers(scope)[0] === "1", "the count");
  assert.deepEqual(asked, [["https://tcg.zapburg.com"]], "the wallet counts at the E1 mint alone");
  assert.deepEqual(fetched, ["https://tcg.zapburg.com/v1/info"], "and nothing is asked of /g/");
});

test("with the site's own mint answering, the panel counts what the wallet verified", async () => {
  const fetched = [];
  const asked = [];
  const tokens = [cashuToken("https://tcg.zapburg.com"), cashuToken("https://tcg.zapburg.com/g")];
  const NutFTWallet = {
    read: async () => ({ tokens, outgoing: [], pending: null }),
    snapshotManyReadOnly: async (mints) => {
      asked.push(mints);
      return { owned: [{ tag: ["1", "600b-e1", "E1-001"] }, { tag: ["1", "600b-e1", "E1-001"] }, { tag: ["1", "600b-e1", "E1-002"] }] };
    },
  };
  const scope = makeScope({
    href: "https://tcg.zapburg.com/shop.html",
    storage: walletStorage({ tokens }),
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, json: async () => ({ nuts: { 31: { supported: true } } }) };
    },
    globals: { NutFTWallet },
  });
  const api = run(scope);
  api.open("wallet");
  await waitFor(() => numbers(scope)[0] === "3", "the count");
  assert.deepEqual(numbers(scope), ["3", "2"], "three cards, two different");
  assert.match(panel(scope, "wallet").textContent, /Reachable/);
  assert.deepEqual(fetched, ["https://tcg.zapburg.com/v1/info"]);
  assert.deepEqual(asked, [["https://tcg.zapburg.com", "https://tcg.zapburg.com/g"]],
    "the same mints wallet.html reads, where this browser holds a card G issued");
  assert.equal(scripts(scope).length, 0, "a page that already has the wallet loads nothing");
});

test("an unfinished transfer is left for wallet.html to finish, not counted over", async () => {
  let snapshots = 0;
  const token = cashuToken("https://tcg.zapburg.com");
  const NutFTWallet = {
    read: async () => ({ tokens: [token], outgoing: [], pending: { type: "trade" } }),
    snapshotManyReadOnly: async () => { snapshots += 1; return { owned: [] }; },
  };
  const scope = makeScope({
    href: "https://tcg.zapburg.com/index.html",
    storage: walletStorage({ tokens: [token], pending: { type: "trade" } }),
    fetch: async () => ({ ok: true, json: async () => ({ nuts: { 31: {} } }) }),
    globals: { NutFTWallet },
  });
  run(scope).open("wallet");
  await waitFor(() => /unfinished/.test(panel(scope, "wallet").textContent), "the unfinished note");
  assert.equal(snapshots, 0, "counting would finish it first; that is not the bar's to do");
  assert.deepEqual(numbers(scope), ["—", "—"]);
});
