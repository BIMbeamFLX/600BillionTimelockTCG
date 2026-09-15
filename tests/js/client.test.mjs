/* site/net.js — the client transport, tested without a browser.
 *
 * The load-bearing case is the FIRST one: play.html opened from file:// with no
 * server must open no socket at all. That is the property that keeps the local
 * hotseat playable when the referee, the network or the venue wifi is gone, and
 * it is the one a future "just connect on load" convenience would quietly break.
 *
 * Run: node --test tests/js/client.test.mjs   (the DIRECTORY form fails on Windows) */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { schnorr } = require("@noble/curves/secp256k1");
const { createHash } = require("node:crypto");
/* Loading the real verifier, not a stub: net.js now refuses to believe an
 * unsigned start announcement, and a test that skipped that would be testing a
 * path no browser takes. */
require("../../site/schnorr.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NET_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "net.js"), "utf8");

/* net.js is a browser IIFE that assigns globalThis.E1Net. Loading it against a
 * stubbed environment is the whole harness: no jsdom, no build step. */
function loadNet(env) {
  /* `env.store` lets two loadNet calls share one localStorage — that is what
   * "two tabs of the same browser" means, and the only way to reproduce a second
   * tab taking the first tab's seat. sessionStorage is always fresh, because
   * that is exactly what a new tab gets. */
  const store = env.store || new Map(Object.entries(env.storage || {}));
  // Passing the same `session` map back models a RELOAD of that same tab;
  // omitting it models a brand new tab.
  const session = env.session || new Map();
  const opened = [];
  const sockets = [];
  globalThis.location = env.location;
  if (env.nostr) globalThis.nostr = env.nostr;
  else delete globalThis.nostr;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.sessionStorage = {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v)),
    removeItem: (k) => session.delete(k),
  };
  globalThis.WebSocket = function (url) {
    opened.push(url);
    if (env.failOnSocket) throw new Error(`a socket was opened: ${url}`);
    this.readyState = 0;
    this.sent = [];
    this.send = (raw) => this.sent.push(JSON.parse(raw));
    this.close = () => {};
    sockets.push(this);
  };
  delete globalThis.E1Net;
  new Function(NET_JS)();
  return { net: globalThis.E1Net, opened, sockets, store, session };
}

const FILE_ENV = {
  location: { protocol: "file:", host: "", href: "file:///C:/x/site/play.html", search: "" },
  failOnSocket: true,
};
const HTTP_ENV = {
  location: { protocol: "http:", host: "bitbeam:8777", href: "http://bitbeam:8777/play.html", search: "" },
};
const NIP07_PUBKEY = "a".repeat(64);

/* WHICH SEED DEALS THE CARDS A TEST NEEDS. Hard-coding one made these tests
 * hostages of the deck builder: every change to how a Stack is generated
 * reshuffles every opening hand, and the tests failed for a reason that had
 * nothing to do with what they were checking. This asks the engine instead,
 * using play.js's own seed derivation (site/play.js: seeds.public = base,
 * hidden = [base ^ 0x5f3759df, base + 7717]). */
function seedDealing(names, affinityA = "Power", affinityB = "Signal") {
  const E = require("../../site/engine.js");
  const CARDS = require("../../site/play-data.js");
  E.setCatalog(CARDS);
  const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  for (let base = 1; base < 6000; base++) {
    let state;
    try {
      state = E.createGame({
        seats: [{ name: "Player 1", affinity: affinityA }, { name: "Player 2", affinity: affinityB }],
        seeds: { public: base, hidden: [(base ^ 0x5f3759df) | 0, (base + 7717) | 0] },
        policy: { freeform: "deny" },
      });
    } catch (error) {
      continue;
    }
    const hand = (state.zones["0:wallet"] || []).map((uid) => byId[state.objects[uid].cardId].name);
    if (names.every((name) => hand.includes(name))) return String(base);
  }
  throw new Error(`no seed deals ${names.join(" + ")}`);
}

const ZAP_SEED = seedDealing(["Zap", "Power Plant — Hydro"]);


test("from file:// with no saved match, net.js opens NOTHING", () => {
  const { net, opened } = loadNet(FILE_ENV);
  assert.equal(net.tableUrl(), null, "there is no referee to derive from a file: URL");
  const started = net.start({});
  assert.equal(started.resuming, false);
  assert.equal(net.status, "idle");
  assert.deepEqual(opened, [], "a cold page must construct no WebSocket");
});

test("create() with no table fails with a code, not a stack trace", () => {
  const { net, opened } = loadNet(FILE_ENV);
  let code = null;
  net.start({ onError: (m) => { code = m.code; } });
  net.create({ name: "felix", affinity: "Power", pubkey: NIP07_PUBKEY });
  assert.equal(code, "NO_TABLE");
  assert.deepEqual(opened, []);
});

test("a saved match auto-resumes, and only then — the reload path", () => {
  const saved = {
    matchId: "m_0123456789ab", seat: 1, token: "a".repeat(32),
    table: "ws://bitbeam:8777/ws", code: "K7M2QF",
  };
  const cold = loadNet(HTTP_ENV);
  cold.net.start({});
  assert.deepEqual(cold.opened, [], "no saved match, no socket — even over http");

  const warm = loadNet({ ...HTTP_ENV, storage: {
    "600b:match": JSON.stringify(saved),
    "600b:pubkey": NIP07_PUBKEY,
  } });
  const started = warm.net.start({});
  assert.equal(started.resuming, true);
  assert.equal(started.seat, 1);
  assert.deepEqual(warm.opened, ["ws://bitbeam:8777/ws"], "it reconnects to the table it was seated at");
});

/* Playing both sides on one machine — the demo. localStorage belongs to the
 * ORIGIN, not the tab, and it used to hold ONE record, which broke this twice:
 * the second tab resumed on the first tab's token and superseded it, and
 * whichever tab saved last destroyed the other's credential, so a reload came
 * back as the wrong seat. */
test("two tabs at one table keep two separate seats", () => {
  const shared = new Map([["600b:pubkey", NIP07_PUBKEY]]);
  const HOST = { matchId: "m_0123456789ab", seat: 0, token: "a".repeat(32),
    table: "ws://bitbeam:8777/ws", code: "K7M2QF" };
  const GUEST = { ...HOST, seat: 1, token: "b".repeat(32) };
  const link = { ...HTTP_ENV.location, search: "?match=m_0123456789ab&code=K7M2QF" };

  // Tab one takes seat 0.
  const host = loadNet({ ...HTTP_ENV, store: shared });
  host.net.start({});
  host.net.saveMatch(HOST);
  const map = JSON.parse(shared.get("600b:seats"));
  assert.deepEqual(Object.keys(map), ["m_0123456789ab:0"], "the map is keyed by seat");
  assert.ok(map["m_0123456789ab:0"].tab, "and records which tab holds it");
  assert.ok(map["m_0123456789ab:0"].seenAt, "and when that tab was last alive");

  // Tab two follows the share link while tab one is live: it lands on the table
  // but must not arrive holding seat 0's token.
  const guest = loadNet({ location: link, store: shared });
  const started = guest.net.start({});
  assert.equal(started.resuming, true, "it still lands on the right table");
  assert.equal(started.matchId, "m_0123456789ab");
  assert.equal(started.seat, null, "but it is NOT the seated player");
  assert.equal(guest.net.session.token, null, "and it must not hold the host's token");

  // It then takes the free seat, which must not clobber the host's credential.
  guest.net.saveMatch(GUEST);
  assert.deepEqual(
    Object.keys(JSON.parse(shared.get("600b:seats"))).sort(),
    ["m_0123456789ab:0", "m_0123456789ab:1"],
    "both seats survive in storage",
  );

  // Each tab's own reload returns it to its own seat.
  const hostAgain = loadNet({ ...HTTP_ENV, store: shared, session: host.session });
  assert.equal(hostAgain.net.start({}).seat, 0, "the host reloads back into seat 0");
  const guestAgain = loadNet({ location: link, store: shared, session: guest.session });
  assert.equal(guestAgain.net.start({}).seat, 1, "the guest reloads back into seat 1");

  // A cold restart (browser closed, so no sessionStorage anywhere) reclaims the
  // most recently held seat: nothing is beating, so there is nobody to displace.
  const cold = JSON.parse(shared.get("600b:seats"));
  cold["m_0123456789ab:0"].seenAt = Date.now() - 600000; // abandoned long ago
  cold["m_0123456789ab:1"].seenAt = Date.now() - 60000;  // the seat last played
  shared.set("600b:seats", JSON.stringify(cold));
  const reopened = loadNet({ ...HTTP_ENV, store: shared });
  assert.equal(reopened.net.start({}).seat, 1, "a stale credential is ours again");
});

/* An upgrade must not cost a player the table they are sitting at. */
test("a seat saved by the previous single-key build still resumes", () => {
  const legacy = {
    matchId: "m_0123456789ab", seat: 1, token: "a".repeat(32),
    table: "ws://bitbeam:8777/ws", code: "K7M2QF",
  };
  const warm = loadNet({ ...HTTP_ENV, storage: {
    "600b:match": JSON.stringify(legacy),
    "600b:pubkey": NIP07_PUBKEY,
  } });
  const started = warm.net.start({});
  assert.equal(started.resuming, true);
  assert.equal(started.seat, 1);
  assert.deepEqual(warm.opened, ["ws://bitbeam:8777/ws"]);
});

test("the table URL is derived from the page, and ?table= overrides it", () => {
  const derived = loadNet(HTTP_ENV);
  assert.equal(derived.net.tableUrl(), "ws://bitbeam:8777/ws");

  const https = loadNet({ location: { protocol: "https:", host: "t.example:8777", href: "", search: "" } });
  assert.equal(https.net.tableUrl(), "wss://t.example:8777/ws");

  const override = loadNet({
    location: { ...HTTP_ENV.location, search: "?table=ws://elsewhere:9000/ws" },
  });
  assert.equal(override.net.tableUrl(), "ws://elsewhere:9000/ws");
});

/* A loopback address written into an invite is unjoinable from the other
 * machine, silently — the exact failure that eats a demo slot. */
test("publicTable never advertises a loopback address if it can avoid it", () => {
  const { net } = loadNet({
    location: { protocol: "http:", host: "bitbeam.tail1a2b.ts.net:8777", href: "", search: "" },
    storage: {
      "600b:match": JSON.stringify({ matchId: "m_0123456789ab", seat: 0, token: "b".repeat(32) }),
      "600b:pubkey": NIP07_PUBKEY,
    },
  });
  net.start({});
  assert.equal(net.publicTable(), "ws://bitbeam.tail1a2b.ts.net:8777/ws");
  assert.equal(net.publicTableIsLocal(), false);

  const local = loadNet(HTTP_ENV);
  assert.equal(local.net.tableUrl(), "ws://bitbeam:8777/ws");
  const loop = loadNet({ location: { protocol: "http:", host: "localhost:8777", href: "", search: "" } });
  loop.net.start({});
  assert.equal(loop.net.publicTableIsLocal(), true, "and it must SAY so rather than publish it");
});

test("npub encodes, decodes and round trips — the lobby's only identity path", () => {
  const { net } = loadNet(FILE_ENV);
  const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const npub = net.nostr.npub(hex);
  assert.match(npub, /^npub1[0-9a-z]+$/);
  assert.equal(net.nostr.toHexPubkey(npub), hex);
  assert.equal(net.nostr.toHexPubkey(hex), hex, "hex passes through");
  assert.equal(net.nostr.toHexPubkey(npub.slice(0, -1) + "q"), null, "a bad checksum is rejected");
  assert.equal(net.nostr.toHexPubkey("not an npub"), null);
});

/* An invite is a stranger's JSON that decides where our socket goes. */
test("an invite from a relay is untrusted input", () => {
  const { net } = loadNet(FILE_ENV);
  const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const invite = (body, tags) => ({ id: "e1", pubkey: hex, kind: 4600, created_at: 1, tags, content: JSON.stringify(body) });
  const ok = { v: 1, kind: "invite", matchId: "m_0123456789ab", code: "K7M2QF", table: "ws://host:8777/ws" };

  assert.ok(net.nostr.parseInvite(invite(ok)), "a well-formed invite parses");
  assert.ok(net.nostr.parseInvite(invite(ok, [["expiration", String(Math.floor(Date.now() / 1000) + 60)]])), "a live NIP-40 invite parses");
  assert.equal(net.nostr.parseInvite(invite(ok, [["expiration", String(Math.floor(Date.now() / 1000) - 1)]])), null, "an expired NIP-40 invite is not offered");
  assert.equal(net.nostr.parseInvite(invite({ ...ok, table: "javascript:alert(1)" })), null);
  assert.equal(net.nostr.parseInvite(invite({ ...ok, table: "http://host/" })), null, "the scheme must be ws or wss");
  assert.equal(net.nostr.parseInvite(invite({ ...ok, matchId: "../../etc" })), null);
  assert.equal(net.nostr.parseInvite(invite({ ...ok, code: "0O1I23" })), null, "the code alphabet excludes 0/O/1/I");
  assert.equal(net.nostr.parseInvite(invite({ ...ok, v: 2 })), null, "an unknown payload version is refused");
  assert.equal(net.nostr.parseInvite({ kind: 1, content: "{}" }), null);
  assert.equal(net.nostr.parseInvite(null), null);
});

test("the signed events carry the versioned payloads the spec fixes", () => {
  const { net } = loadNet(FILE_ENV);
  const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const inv = net.nostr.inviteEvent({
    matchId: "m_0123456789ab", code: "K7M2QF", table: "ws://host:8777/ws",
    name: "felix", affinity: "Power", ruleset: "E1.0", catalogDigest: "sha256:x", to: hex,
  });
  assert.equal(inv.kind, 4600);
  const tag = (ev, k) => ev.tags.filter((t) => t[0] === k).map((t) => t[1]);
  assert.deepEqual(tag(inv, "t"), ["invite"]);
  assert.deepEqual(tag(inv, "p"), [hex]);
  assert.equal(tag(inv, "expiration").length, 1, "NIP-40, so a stale invite stops being offered");
  assert.equal(JSON.parse(inv.content).v, 1);
  assert.equal(JSON.parse(inv.content).wire, 1);

  const open = net.nostr.inviteEvent({ matchId: "m_0123456789ab", code: "K7M2QF", table: "ws://h/ws" });
  assert.deepEqual(tag(open, "p"), [], "an open table carries no p tag at all");

  const acc = net.nostr.acceptEvent({ matchId: "m_0123456789ab", invite: "e1", table: "ws://h/ws", to: hex });
  assert.deepEqual(tag(acc, "t"), ["accept"]);
  assert.deepEqual(tag(acc, "e"), ["e1"]);

  /* Both players must sign the referee's exact bytes, or two correct results
   * would compare as disputed. */
  const over = { resultTags: [["d", "m_0123456789ab"]], resultContent: "{\"v\":1}", resultCreatedAt: 123 };
  const res = net.nostr.resultEvent(over);
  assert.equal(res.kind, 31600);
  assert.equal(res.content, over.resultContent, "content is passed through, never re-serialised");
  assert.equal(res.tags, over.resultTags);
  assert.equal(res.created_at, 123);
});

/* ------------------------------------------------------------ the lobby view
 *
 * site/play.js owns the DOM and therefore the two beats a headless transport
 * test cannot reach: what the person following the host's SHARE LINK is shown,
 * and whether the signed result can still be published after a reload. Both are
 * demo-day-visible, so they get a stub DOM rather than no coverage at all.
 * play.js only ever touches getElementById / createElement / querySelectorAll,
 * so the stub is small enough to be honest. */
const PLAY_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "play.js"), "utf8");
const ENGINE_JS = path.join(HERE, "..", "..", "site", "engine.js");

function stubElement(id) {
  const style = {
    setProperty(name, value) { this[name] = String(value); },
    getPropertyValue(name) { return this[name] || ""; },
  };
  const node = {
    id, hidden: false, textContent: "", value: "", className: "", innerHTML: "",
    disabled: false, dataset: {}, children: [], style, listeners: {}, attributes: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    append(...kids) {
      for (const kid of kids) {
        if (kid && typeof kid === "object") kid._parent = this;
        this.children.push(kid);
      }
    },
    appendChild(kid) {
      if (kid && typeof kid === "object") kid._parent = this;
      this.children.push(kid);
      return kid;
    },
    closest: () => null,
    querySelectorAll: () => [],
    focus() {},
    remove() {
      if (!this._parent) return;
      this._parent.children = this._parent.children.filter((child) => child !== this);
      this._parent = null;
    },
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
  };
  /* Backed by className, the way a browser's is: play.js writes its state
   * classes (targetable, canplay, committed ...) through classList and the 3D
   * table reads them back off the node, so the stub has to keep them. */
  const classes = () => String(node.className || "").split(/\s+/).filter(Boolean);
  const write = (list) => { node.className = list.join(" "); };
  node.classList = {
    add(...names) {
      const list = classes();
      for (const name of names) if (name && list.indexOf(name) < 0) list.push(name);
      write(list);
    },
    remove(...names) { write(classes().filter((name) => names.indexOf(name) < 0)); },
    toggle(name, force) {
      const on = force === undefined ? !this.contains(name) : Boolean(force);
      if (on) this.add(name); else this.remove(name);
      return on;
    },
    contains: (name) => classes().indexOf(name) >= 0,
  };
  return node;
}

/* Loads play.js against a stub DOM and returns handles to poke at it. The
 * DOMContentLoaded listener is fired by hand, which is what runs initNet(). */
function loadPlay(netStub, fxStub) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubElement(id));
    return nodes.get(id);
  };
  const fired = {};
  const body = byId("body");
  globalThis.document = {
    body,
    getElementById: byId,
    createElement: (tag) => stubElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.window = {
    addEventListener(type, fn) { (fired[type] = fired[type] || []).push(fn); },
    E1Net: netStub,
  };
  // node defines a getter-only globalThis.navigator, so it has to be replaced
  // rather than assigned.
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: () => Promise.resolve() } },
    configurable: true,
  });
  globalThis.E1Engine = require(ENGINE_JS);
  globalThis.E1_CARDS = require(path.join(HERE, "..", "..", "site", "play-data.js"));
  // play.html loads the precon library too; without it a "precon:" seat choice
  // would fall through to an affinity name and refuse to construct.
  globalThis.E1_PRECONS = require(path.join(HERE, "..", "..", "site", "precons.js"));
  globalThis.E1Engine.setCatalog(globalThis.E1_CARDS);
  globalThis.E1Net = netStub;
  if (fxStub) globalThis.E1FX = fxStub;
  else delete globalThis.E1FX;
  new Function(PLAY_JS)();
  for (const fn of fired.DOMContentLoaded || []) fn();
  return { byId, fired, game: globalThis.window.E1_GAME || globalThis.E1_GAME };
}

/* A transport stub that records what play.js asks of it and hands back the
 * handlers so a STATE can be delivered as the referee would. */
function netStub(extra) {
  const calls = [];
  const stub = {
    status: "live", peers: [true, false], lastState: null, session: null,
    handlers: null,
    start(handlers) { stub.handlers = handlers; return { resuming: false }; },
    create(o) { calls.push(["create", o]); },
    join(o) { calls.push(["join", o]); },
    act(action) { calls.push(["act", action]); return true; },
    sendNostr(role, ev) { calls.push(["nostr", role, ev]); return true; },
    leave() {}, resume() {}, tables: async () => [],
    tableUrl: () => "ws://bitbeam:8777/ws",
    publicTable: () => "ws://bitbeam:8777/ws",
    publicTableIsLocal: () => false,
    savedMatch: () => null,
    nostr: {
      hasNip07: () => true,
      savedPubkey: () => "a".repeat(64),
      shortNpub: () => "npub1…",
      npub: () => "npub1x",
      login: async () => "a".repeat(64),
      logout() {}, relays: () => [],
      sign: async (e) => Object.assign({ id: "e".repeat(64), sig: "s".repeat(128) }, e),
      publish: async () => ({ ok: true, accepted: ["r"], tried: 1 }),
      resultEvent: (over) => ({ kind: 31600, created_at: over.resultCreatedAt, tags: over.resultTags, content: over.resultContent }),
      inviteEvent: () => ({ kind: 4600, tags: [], content: "{}" }),
      acceptEvent: () => ({ kind: 4600, tags: [], content: "{}" }),
      subscribeInvites: () => () => {},
      toHexPubkey: (v) => v,
      parseInvite: () => null,
    },
    calls,
  };
  return Object.assign(stub, extra || {});
}

const STATE_BASE = {
  t: "STATE", v: 1, matchId: "m_0123456789ab", code: "K7M2QF",
  ruleset: "E1.0", catalogDigest: null, players: [
    { seat: 0, name: "felix", pubkey: "a".repeat(64), affinity: "Power", online: true },
    { seat: 1, name: null, pubkey: null, affinity: null, online: false },
  ],
  view: null, events: [], full: true, publicHash: null, result: null,
};

/* Waits for what a test asserts instead of a fixed tick. One setImmediate was
 * enough in isolation but not under the parallel full suite, where the NutFT
 * check and its prompt had not settled yet. Bounded, so a real regression
 * fails with a message rather than hanging the run. */
async function waitFor(check, what, turns = 500) {
  for (let turn = 0; turn < turns; turn += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, turn < 50 ? 0 : 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const leaveSolo = (byId, game) => {
  if (game.state && !game.state.result) game.dispatch("CONCEDE", 0, {});
  byId("endRematch").click();
};

/* Earlier tests' tables can still be walking on their own timers, and they
   paint into whatever document is current. So a wait that reads the board
   first repaints THIS table ("Cancel targeting" is a pure re-render) and then
   reads it in the same synchronous turn. */
const paintedNow = (byId, check) => () => {
  byId("cancelTarget").click();
  return check();
};

/** Every value a node's textContent is given, kept so a wait can ask what THIS table painted. */
function recordText(node) {
  const written = [];
  let text = "";
  Object.defineProperty(node, "textContent", {
    get: () => text,
    set: (value) => { text = value; written.push(value); },
  });
  return written;
}

function clientGame(seed = 990000) {
  return globalThis.E1Engine.createGame({
    seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
    seeds: { public: seed, hidden: [seed + 1, seed + 2] },
    firstPlayer: 0,
    modules: { stake: true, toss: true },
  });
}

function clientSeed(state, seat, name, zone = "network") {
  const card = globalThis.E1_CARDS.find((entry) => entry.name === name);
  assert.ok(card, `missing fixture card ${name}`);
  const uid = `o${state.nextUid++}`;
  state.objects[uid] = {
    uid, cardId: card.id, owner: seat, controller: seat, zone: `${seat}:${zone}`,
    committed: false, bootDelay: false, damage: 0, damageSources: {}, counters: {}, attachedTo: null,
    rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
    token: false, tokenProfile: null, chosenAffinity: null, chosenSeat: null,
    controlSource: null, activations: {}, maskedCardId: null, sovereign: false,
    copyBaseCardId: null, affinityOverride: null, typeAdditions: [], adaptive: false,
    entersSeq: state.seq, prevUid: null,
  };
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

function latestUidNode(byId, zoneId, uid) {
  const children = byId(zoneId).children;
  for (let index = children.length - 1; index >= 0; index--) {
    if (children[index]?.dataset?.uid === uid) return children[index];
  }
  return null;
}

/* Loads matchmaking.js — and site/lobby.js, the lobby it mounts — against the
 * same stub DOM. `nav` records where the lobby tried to send the browser, which
 * is the hand-off itself. */
function loadLobby(netStub) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubElement(id));
    return nodes.get(id);
  };
  const fired = {};
  const nav = [];
  globalThis.document = {
    body: byId("body"),
    readyState: "complete",
    getElementById: byId,
    createElement: (tag) => stubElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.window = {
    addEventListener(type, fn) { (fired[type] = fired[type] || []).push(fn); },
    E1Net: netStub,
  };
  globalThis.location = {
    protocol: "http:", host: "bitbeam:8777", search: "",
    href: "http://bitbeam:8777/matchmaking.html",
    assign(url) { nav.push(url); },
  };
  globalThis.E1Net = netStub;
  new Function(fs.readFileSync(path.join(HERE, "..", "..", "site", "lobby.js"), "utf8"))();
  new Function(fs.readFileSync(path.join(HERE, "..", "..", "site", "matchmaking.js"), "utf8"))();
  for (const fn of fired.DOMContentLoaded || []) fn();
  return { byId, nav, fired };
}

/* A stand-in for the side bar (site/rail.js): an Account panel that opens. */
function barStub() {
  const opened = [];
  return {
    opened,
    slot: (name) => (name === "account" ? {} : null),
    open(name) { opened.push(name); return true; },
  };
}

/* Loads a page with the bar drawn, a signer that records its use, and a window
   that records the e1:auth the page sends. Cleans the globals up after. */
function withBar(t, load, stubExtra) {
  const bar = barStub();
  globalThis.E1Rail = bar;
  t.after(() => { delete globalThis.E1Rail; });
  const signer = { logins: 0, key: "a".repeat(64) };
  const stub = netStub(stubExtra);
  stub.nostr.login = async () => { signer.logins += 1; return signer.key; };
  stub.nostr.savedPubkey = () => signer.key;
  const page = load(stub);
  const auth = [];
  globalThis.window.dispatchEvent = (event) => { if (event.type === "e1:auth") auth.push(event.detail.ok); };
  const identity = (pubkey) => {
    signer.key = pubkey;
    for (const fn of page.fired["e1:identity"] || []) fn({ detail: { pubkey } });
  };
  return { ...page, bar, signer, stub, auth, identity };
}

/* THIS BEHAVIOUR MOVED, IT DID NOT GO AWAY. The host panel and the share-link
 * Join belong to the lobby napplet now; the assertions follow them there. */
test("the host's share link offers a Join, not the host panel", () => {
  const stub = netStub();
  const { byId } = loadLobby(stub);

  // The HOST's own view of an open table: the panel with the code to read out.
  stub.lastState = { ...STATE_BASE, seat: 0, role: "seat", status: "open", downgraded: false, claimable: true };
  stub.handlers.onState(stub.lastState);
  assert.equal(byId("hostPanel").hidden, false, "the host must see the code panel");
  assert.equal(byId("tableCode").textContent, "K7M2QF");
  assert.equal(byId("joinTable").disabled, true, "a host must not be able to join its own table");

  /* The INVITED player following ?match=…&code=… carries no credential, so the
   * referee downgrades them to a spectator — of an empty table. Showing them the
   * host panel left both people staring at the same screen. */
  const guest = netStub();
  const g = loadLobby(guest);
  guest.lastState = { ...STATE_BASE, seat: null, role: "spectator", status: "open", downgraded: true, downgradeReason: "no seat credential", claimable: true };
  guest.handlers.onState(guest.lastState);
  assert.equal(g.byId("hostPanel").hidden, true, "the joiner was shown the host panel");
  assert.equal(g.byId("joinCode").value, "K7M2QF", "the code to join with must be prefilled");
  assert.match(g.byId("netNotice").textContent, /press Join to take seat 1/);
  assert.equal(g.byId("joinTable").disabled, false, "the joiner must be able to press Join");

  // And pressing Join sends the code the link carried.
  g.byId("joinTable").click();
  const join = guest.calls.find((c) => c[0] === "join");
  assert.ok(join, "Join sent nothing");
  assert.equal(join[1].code, "K7M2QF");

  // Neither of them was ever sent to the table: nobody has been dealt a seat.
  assert.deepEqual(g.nav, [], "an undealt table must not open the board");
});

test("the lobby leaves for the table only once a seat is dealt", () => {
  const stub = netStub();
  const { nav } = loadLobby(stub);

  stub.lastState = { ...STATE_BASE, seat: 1, role: "seat", status: "playing", view: { seq: 0 } };
  stub.handlers.onState(stub.lastState);

  assert.equal(nav.length, 1, "a dealt seat opens the table exactly once");
  assert.match(nav[0], /^play\.html\?match=m_0123456789ab&code=K7M2QF$/);

  // A repeated STATE must not navigate a second time.
  stub.handlers.onState(stub.lastState);
  assert.equal(nav.length, 1, "the hand-off fired twice");
});

test("a published challenge carries the stake the referee confirmed", () => {
  const stub = netStub();
  let options;
  stub.nostr.inviteEvent = (value) => {
    options = value;
    return { kind: 4600, tags: [], content: "{}" };
  };
  const { byId } = loadLobby(stub);
  stub.lastState = { ...STATE_BASE, seat: 0, role: "seat", status: "open", stake: 750 };
  stub.handlers.onState(stub.lastState);
  byId("publishInvite").click();
  assert.equal(options.stake, 750, "the invite omitted the amount the guest would be asked to play for");
});

test("an invalid challenge npub cannot silently become an open invite", () => {
  const stub = netStub();
  let invitations = 0;
  stub.nostr.toHexPubkey = () => null;
  stub.nostr.inviteEvent = () => {
    invitations += 1;
    return { kind: 4600, tags: [], content: "{}" };
  };
  const { byId } = loadLobby(stub);
  stub.lastState = { ...STATE_BASE, seat: 0, role: "seat", status: "open", stake: 0 };
  stub.handlers.onState(stub.lastState);
  byId("challengeNpub").value = "not-an-npub";
  byId("publishInvite").click();
  assert.equal(invitations, 0);
  assert.match(byId("netNotice").textContent, /valid npub/i);
});

test("a relay invite shows and acknowledges its stake before joining", () => {
  const stub = netStub();
  let offer;
  stub.nostr.subscribeInvites = (_pubkey, onInvite) => {
    offer = onInvite;
    return () => {};
  };
  const { byId } = loadLobby(stub);
  byId("checkInvites").click();
  offer({
    code: "K7M2QF", table: "ws://bitbeam:8777/ws", pubkey: "b".repeat(64),
    host: { name: "Anna", affinity: "Signal" }, stake: 750,
  });
  const row = byId("inviteList").children.at(-1);
  assert.match(row.textContent + row.children.map((child) => child.textContent).join(" "), /750.*sats/i);
  row.children.at(-1).click();
  const join = stub.calls.find((call) => call[0] === "join");
  assert.equal(join[1].stake, 750, "the join did not echo the amount the guest accepted");
});

for (const [where, load] of [["lobby", loadLobby], ["table", loadPlay]]) {
  test(`the ${where} signs in through the side bar's Account panel when the bar is drawn`, (t) => {
    const { byId, bar, signer } = withBar(t, load);
    signer.key = null;
    byId("nostrLogin").click();
    assert.deepEqual(bar.opened, ["account"], "the button opens the bar's one sign-in door");
    assert.equal(signer.logins, 0, "the page must not open a second signer of its own");
  });

  test(`the ${where} leaves signing out to the bar, and hears it`, (t) => {
    const { byId, auth, identity } = withBar(t, load);
    assert.equal(byId("nostrLogout").hidden, true, "no second Sign out while the bar has one");
    assert.equal(byId("nostrWho").hidden, false, "who is signed in still shows here");

    identity(null);
    assert.equal(byId("nostrWho").hidden, true);
    assert.equal(byId("nostrLogin").hidden, false);
    assert.deepEqual(auth, [false], "a signed-out page never keeps the verified dot");
  });

  test(`the ${where} resumes a pending seat when the bar signs in, once`, (t) => {
    const resumed = [];
    const { byId, identity } = withBar(t, load, {
      session: { matchId: "m_0123456789ab", seat: 0, token: null },
      resume() { resumed.push(true); return true; },
    });
    identity("a".repeat(64));
    assert.deepEqual(resumed, [], "the bar's load-time word names the key already drawn");

    identity(null);
    identity("b".repeat(64));
    assert.deepEqual(resumed, [true], "a sign-in in the bar reopens the seat");
    assert.equal(byId("nostrLogin").hidden, true);
  });

  test(`inside a napplet the ${where}'s own button still signs in`, async (t) => {
    // Embedded, the bar stays on the page but inert: no slot, and open() refuses.
    globalThis.E1Rail = { slot: () => null, open: () => false };
    t.after(() => { delete globalThis.E1Rail; });
    const stub = netStub();
    let logins = 0;
    let key = null;
    stub.nostr.savedPubkey = () => key;
    stub.nostr.login = async () => { logins += 1; key = "a".repeat(64); return key; };
    const { byId } = load(stub);
    byId("nostrLogin").click();
    await waitFor(() => logins === 1 && byId("nostrLogin").hidden, "the page's own sign-in");
    assert.equal(byId("nostrLogout").hidden, false, "without a bar, Sign out stays on the page");
  });
}

test("the table sends a player back to the lobby, it does not host one", () => {
  const stub = netStub();
  const { byId } = loadPlay(stub);

  // An open table is the lobby's business; the board must not pretend otherwise.
  stub.lastState = { ...STATE_BASE, seat: 0, role: "seat", status: "open", downgraded: false, claimable: true };
  stub.handlers.onState(stub.lastState);
  assert.equal(byId("table").hidden, true, "an undealt table must not show a board");
  assert.equal(byId("setup").hidden, false);
  assert.match(byId("netNotice").textContent, /lobby/i, "the player was not told where the table opens");
});

test("a NutFT-marked Stack proves non-basic possession while Basics stay free", async () => {
  /* E1-004, not E1-001. Genesis is capped at ONE copy per Stack, so three
     Genesis Lotus stopped being a legal Stack and this fixture began failing on
     itself rather than on the thing under test. */
  const saved = { Owned: [...Array(37).fill("E1-002"), ...Array(3).fill("E1-004")] };
  const storage = new Map([
    ["600b:decks", JSON.stringify(saved)],
    ["600b:nutft-decks", JSON.stringify({ Owned: true })],
  ]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.location = { origin: "http://table.test" };
  let count = 2;
  globalThis.NutFTWallet = { snapshotReadOnly: async () => ({ owned: Array.from({ length: count }, () => ({ tag: ["1", "600B-E1", "E1-004"] })) }) };
  const { byId, game } = loadPlay(netStub());
  byId("deckA").value = "custom:Owned";
  byId("deckB").value = "Signal";
  byId("start").click();
  await waitFor(() => /needs 3, wallet controls 2/.test(byId("prompt").textContent), "the possession failure prompt");
  assert.equal(game.state, null);
  assert.match(byId("prompt").textContent, /needs 3, wallet controls 2/);
  await waitFor(() => !byId("start").disabled, "Start to unlock after the failed check");
  count = 3;
  byId("start").click();
  await waitFor(() => game.state, "the verified Stack to start");
  assert.ok(game.state, "the verified Stack should start after all 40 proofs pass");
});

test("a shell-stored NutFT marker still gates its shell-stored Stack", async (t) => {
  /* E1-004, not E1-001. Genesis is capped at ONE copy per Stack, so three
     Genesis Lotus stopped being a legal Stack and this fixture began failing on
     itself rather than on the thing under test. */
  const saved = { Owned: [...Array(37).fill("E1-002"), ...Array(3).fill("E1-004")] };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.E1Napplet = { storage: { json: async (key) => key === "600b:decks" ? saved : { Owned: true } } };
  globalThis.NutFTWallet = { snapshotReadOnly: async () => ({ owned: [] }) };
  globalThis.location = { origin: "http://table.test" };
  t.after(() => { delete globalThis.E1Napplet; });
  const { byId, game } = loadPlay(netStub());
  await new Promise((resolve) => setImmediate(resolve));
  byId("deckA").value = "custom:Owned";
  byId("deckB").value = "Signal";
  byId("start").click();
  await waitFor(() => /needs 3, wallet controls 0/.test(byId("prompt").textContent), "the possession failure prompt");
  assert.equal(game.state, null);
  assert.match(byId("prompt").textContent, /needs 3, wallet controls 0/);
});

test("a stale NutFT marker cannot turn a missing Stack into an empty ownership check", async () => {
  const storage = new Map([
    ["600b:decks", "{}"],
    ["600b:nutft-decks", JSON.stringify({ Ghost: true })],
  ]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem() {} };
  globalThis.NutFTWallet = { snapshotReadOnly: async () => ({ owned: [] }) };
  globalThis.location = { origin: "http://table.test" };
  const { byId, game } = loadPlay(netStub());
  byId("deckA").value = "custom:Ghost";
  byId("deckB").value = "Signal";
  byId("start").click();
  await waitFor(() => /Ghost.*no saved card list/i.test(byId("prompt").textContent), "the missing card list prompt");
  assert.equal(game.state, null);
  assert.match(byId("prompt").textContent, /Ghost.*no saved card list/i);
});

test("NutFT verification locks Start against duplicate submissions", async () => {
  /* E1-004, not E1-001. Genesis is capped at ONE copy per Stack, so three
     Genesis Lotus stopped being a legal Stack and this fixture began failing on
     itself rather than on the thing under test. */
  const saved = { Owned: [...Array(37).fill("E1-002"), ...Array(3).fill("E1-004")] };
  const storage = new Map([
    ["600b:decks", JSON.stringify(saved)],
    ["600b:nutft-decks", JSON.stringify({ Owned: true })],
  ]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem() {} };
  globalThis.location = { origin: "http://table.test" };
  let release;
  let checks = 0;
  globalThis.NutFTWallet = { snapshotReadOnly: () => {
    checks += 1;
    return new Promise((resolve) => { release = resolve; });
  } };
  const { byId, game } = loadPlay(netStub());
  byId("deckA").value = "custom:Owned";
  byId("deckB").value = "Signal";
  byId("start").click();
  byId("start").click();
  assert.equal(checks, 1);
  assert.equal(byId("start").disabled, true);
  release({ owned: Array.from({ length: 3 }, () => ({ tag: ["1", "600B-E1", "E1-004"] })) });
  await waitFor(() => game.state, "the verified Stack to start");
  assert.ok(game.state);
});

test("a seed that cannot mean anything stays in setup with a useful error", () => {
  /* This asserted that "bananas" was refused. It is not: the field is labelled
     "word or number" and a word is hashed, which is the point of a seed people
     can share out loud. What IS refused is a number the engine cannot hold --
     the case the other half of this merge caught, where Number(text) | 0 wrapped
     silently and dealt the game belonging to a different seed. */
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const { byId, game } = loadPlay(netStub());
  byId("seed").value = "99999999999999";
  byId("start").click();
  assert.equal(game.state, null, "an out-of-range number does not start a game");
  assert.match(byId("prompt").textContent, /-?2147483647|between/i);
});

test("a word is a seed, not an error", () => {
  /* Asserting on the PROMPT, not on game.state: startGame() runs an async NutFT
     verification before it deals, so the state is not there by the time click()
     returns. What this is for is that a word is not turned away — the field is
     labelled "word or number", and hashing it is the point. */
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const { byId } = loadPlay(netStub());
  byId("seed").value = "bananas";
  byId("start").click();
  assert.doesNotMatch(byId("prompt").textContent, /2147483647|between/i,
    "a word is not refused the way an impossible number is");
});

test("a catalog mismatch blocks remote actions instead of only showing a banner", () => {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const stub = netStub();
  const { game } = loadPlay(stub);
  stub.handlers.onState({
    ...STATE_BASE,
    seat: 0,
    role: "seat",
    status: "playing",
    catalogDigest: "sha256:not-this-build",
    view: globalThis.E1Engine.view(clientGame(), 0),
  });
  assert.equal(game.dispatch("PASS_PRIORITY", 0), false);
  assert.equal(stub.calls.some((call) => call[0] === "act"), false);
});

test("a declined start signature stays retryable and a signed wager keeps its stake", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const stub = netStub();
  let attempts = 0;
  stub.nostr.startEvent = () => ({ kind: 4600, tags: [], content: "{}" });
  stub.nostr.sign = async (event) => {
    attempts += 1;
    if (attempts === 1) throw new Error("declined");
    return { ...event, id: "e".repeat(64), sig: "s".repeat(128) };
  };
  loadPlay(stub);
  const playing = { ...STATE_BASE, seat: 0, role: "seat", status: "playing", stake: 750, view: null };
  stub.lastState = playing;
  stub.handlers.onState(playing);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.has("600b:announced"), false, "declining the signer permanently consumed the announcement");

  stub.handlers.onState(playing);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(JSON.parse(storage.get("600b:announced"))[0].stake, 750);
});

/* The client-side lobby test that stood here was removed with the lobby it
 * exercised: matchmaking is its own napplet now, so play.html no longer has
 * #refreshTables or #tableList and there is nothing here to click. The
 * behaviour it protected did not go untested - net.test.mjs still asserts
 * hostOnline on the referee, which is where the rule actually lives. */

test("a finished match can be published from a STATE alone — no live OVER needed", () => {
  const stub = netStub();
  const { byId, game } = loadPlay(stub);

  /* The reload path. The referee used to hand out the signable bytes exactly
   * once, in the live OVER: a seat that was away or merely refreshed could never
   * publish its result, so the agreement counter could never leave "none". */
  const content = JSON.stringify({ v: 1, kind: "result", winners: [0] });
  const tags = [["d", "m_0123456789ab"], ["winner", "a".repeat(64)]];
  stub.lastState = {
    ...STATE_BASE, seat: 0, role: "seat", status: "over", downgraded: false, claimable: false,
    view: null, result: { winners: [0], losers: [1], reason: "concede" },
    resultContent: content, resultTags: tags, resultCreatedAt: 1785310322,
    transcriptHash: "sha256:t", headHash: "sha256:h", verify: { ok: true, divergedAt: null },
  };
  stub.handlers.onState(stub.lastState);

  assert.ok(game.over, "STATE for a finished match must rebuild the signable payload");
  assert.equal(game.over.resultContent, content);
  assert.deepEqual(game.over.resultTags, tags);
  assert.equal(byId("publishResult").hidden, false, "the publish button stayed hidden after a reload");

  // Pressing it signs the referee's EXACT bytes, so agreement is a string compare.
  byId("publishResult").click();

  /* A result belongs to ONE match. Sitting down at a new table without pressing
   * Leave must not leave the previous match's bytes under the button, which
   * would sign a finished match a second time. */
  stub.lastState = { ...STATE_BASE, matchId: "m_ffffffffffff", seat: 0, role: "seat", status: "playing", claimable: false, view: null };
  stub.handlers.onState(stub.lastState);
  assert.equal(game.over, null, "the previous match's result survived into a new one");
  assert.equal(byId("publishResult").hidden, true);
});

test("Remote Command asks for and forwards Convert Uptime's Avatar cost", () => {
  const stub = netStub();
  const { byId } = loadPlay(stub);
  const state = clientGame(990100);
  const sacrifice = clientSeed(state, 1, "FLX, Culture Curator");
  const card = globalThis.E1_CARDS.find((entry) => entry.name === "Convert Uptime");
  const remoteUid = clientSeed(state, 1, "Convert Uptime", "wallet");
  state.awaiting = { kind: "remotePlay", seat: 0, payer: 1, uid: remoteUid, cardId: card.id };
  state.priority = { seat: null, passed: [false, false], window: "remote-play" };

  stub.handlers.onState({
    ...STATE_BASE, seat: 0, role: "seat", status: "playing", claimable: false, view: state,
  });
  byId("continue").click();
  assert.equal(stub.calls.filter((call) => call[0] === "act").length, 0,
    "the client must wait for the mandatory Avatar cost");

  const avatar = latestUidNode(byId, "foeNetwork", sacrifice);
  assert.ok(avatar, "the remote payer's Avatar must be offered as the cost");
  avatar.click();

  const sent = stub.calls.find((call) => call[0] === "act");
  assert.ok(sent, "the completed remote play sent no action");
  assert.equal(sent[1].type, "REMOTE_PLAY_CARD");
  assert.deepEqual(sent[1].payload.additionalCosts, [sacrifice]);
});

test("mandatory unlock cards cannot be toggled out of the submitted selection", () => {
  const stub = netStub();
  const { byId } = loadPlay(stub);
  const state = clientGame(990200);
  const required = clientSeed(state, 0, "Power Plant — Hydro");
  const selectable = clientSeed(state, 0, "FLX, Culture Curator");
  state.objects[required].committed = true;
  state.objects[selectable].committed = true;
  state.awaiting = {
    kind: "unlock", seat: 0, required: [required], selectable: [selectable], caps: { Avatar: 1 },
  };
  state.priority = { seat: null, passed: [false, false], window: "unlock" };

  stub.handlers.onState({
    ...STATE_BASE, seat: 0, role: "seat", status: "playing", claimable: false, view: state,
  });
  latestUidNode(byId, "youNetwork", selectable).click();
  latestUidNode(byId, "youNetwork", required).click();
  byId("continue").click();

  const sent = stub.calls.find((call) => call[0] === "act");
  assert.ok(sent, "the unlock choice sent no action");
  assert.equal(sent[1].type, "CHOOSE_UNLOCK");
  assert.deepEqual(sent[1].payload.uids.sort(), [required, selectable].sort());
});

test("variable-target cards stay open until the player confirms every target", () => {
  const stub = netStub();
  const { byId } = loadPlay(stub);
  const state = clientGame(990300);
  const card = globalThis.E1_CARDS.find((entry) => entry.name === "Power Burst");
  const remoteUid = clientSeed(state, 1, "Power Burst", "wallet");
  state.awaiting = { kind: "remotePlay", seat: 0, payer: 1, uid: remoteUid, cardId: card.id };
  state.priority = { seat: null, passed: [false, false], window: "remote-play" };

  stub.handlers.onState({
    ...STATE_BASE, seat: 0, role: "seat", status: "playing", claimable: false, view: state,
  });
  byId("continue").click();
  const menu = byId("body").children.at(-1);
  const xTwo = menu?.children.find((node) => node.textContent === "X = 2");
  assert.ok(xTwo, "the X chooser did not offer X = 2");
  xTwo.click();

  byId("youBar").click();
  assert.equal(stub.calls.filter((call) => call[0] === "act").length, 0,
    "a variable target card was submitted after its first target");
  byId("foeBar").click();
  assert.equal(stub.calls.filter((call) => call[0] === "act").length, 0,
    "a variable target card must wait for explicit confirmation");
  byId("continue").click();

  const sent = stub.calls.find((call) => call[0] === "act");
  assert.ok(sent, "confirming variable targets sent no action");
  assert.equal(sent[1].type, "REMOTE_PLAY_CARD");
  assert.deepEqual(sent[1].payload.targets, [
    { kind: "seat", seat: 0 },
    { kind: "seat", seat: 1 },
  ]);
});

test("a player is a clickable target: Zap resolves at the opponent's face", () => {
  const { byId, game } = loadPlay(netStub(), {
    emit() {},
    get: () => ({ motionActive: "reduced" }),
  });

  /* A seed whose Power opening hand holds Zap ("any target") and Power Plant —
   * Hydro, found at run time rather than pinned. Before the playerbar became a target surface, an "any" pick could
   * only land on an Avatar node: an empty enemy Network left NOTHING
   * clickable and the play was stuck at "Cancel targeting". */
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
  assert.ok(game.state, "the hotseat game must start");
  assert.equal(game.state.policy.freeform, "deny", "released hotseat play uses scripted rules only");
  assert.equal(byId("youUptimeMeter").style.getPropertyValue("--uptime-ratio"), "100%",
    "full Uptime has no full graphical meter");

  // A stub zone never clears its children, so the freshest render sits at the
  // END: scan backwards for the node whose face is the named card.
  const lastCard = (zoneId, name) => {
    const kids = byId(zoneId).children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const img = kids[i].children && kids[i].children[0];
      if (img && img.alt === name) return kids[i];
    }
    return null;
  };

  // Resource down, then commit it for the 1 Power that Zap costs.
  lastCard("youHand", "Power Plant — Hydro").click();
  lastCard("youNetwork", "Power Plant — Hydro").click(); // one ability: fires immediately
  assert.equal(game.state.seats[0].buffer.P, 1, "the plant must bank 1 Power");

  lastCard("youHand", "Zap").click();
  byId("foeBar").click();

  const item = game.state.queue[0];
  assert.ok(item, "Zap must be announced onto the Queue");
  assert.deepEqual(item.targets, [{ kind: "seat", seat: 1 }], "the chosen target is the opponent");

  // Resolve through the same button the player presses.
  for (let i = 0; i < 6 && game.state.queue.length; i++) byId("continue").click();
  assert.equal(game.state.queue.length, 0, "the Queue must resolve");
  // Resolution immediately produces mundane pass/phase events as play moves on.
  // They must not evict the hit that the player is still trying to read.
  byId("continue").click();
  byId("continue").click();
  assert.equal(game.state.seats[1].uptime, 18, "Zap's 2 damage lands on the chosen player");
  assert.equal(byId("foeUptimeMeter").style.getPropertyValue("--uptime-ratio"), "90%",
    "damage did not change the graphical Uptime meter");
  assert.ok(byId("actionFx").children.some((node) => /takes 2 damage/i.test(node.textContent)),
    "the damage action produced no visible action animation");
  assert.ok(byId("actionFx").children.every((node) => /(?:^|\s)reduced(?:\s|$)/.test(node.className)),
    "the reduced-motion setting did not switch action feedback to its static fallback");

  /* The console verify() must replay this hotseat: it needs the createGame
   * config, which the table now keeps. Before, it passed config:null and
   * every hotseat verify died of SCHEMA before replaying a single action. */
  const verdict = game.verify();
  assert.equal(verdict.ok, true, JSON.stringify(verdict.error));
  assert.equal(verdict.divergedAt, null, "a self-played transcript must not diverge");
});

test("the attack UI forms and submits an original-rules Mesh group", () => {
  const { byId, game } = loadPlay(netStub());
  byId("deckA").value = "Signal";
  byId("deckB").value = "Power";
  byId("seed").value = ZAP_SEED;
  byId("start").click();

  const first = clientSeed(game.state, 0, "Cuddy, Signal Organizer");
  const second = clientSeed(game.state, 0, "BK, Mesh Pack");
  game.state.objects[first].bootDelay = false;
  game.state.objects[second].bootDelay = false;
  game.state.turn.active = 0;
  game.state.turn.phase = "clash";
  game.state.turn.step = "attackers";
  game.state.awaiting = { kind: "attackers", seat: 0 };
  game.state.priority = { seat: null, passed: [false, false] };
  game.dispatch("NOT_AN_ACTION", 0, {}); // rejected, but refreshes the DOM fixture

  latestUidNode(byId, "youNetwork", first).click();
  latestUidNode(byId, "youNetwork", second).click();
  assert.equal(byId("meshGroup").hidden, false, "two Mesh attackers offered no grouping control");
  byId("meshGroup").click();
  assert.match(byId("meshGroup").textContent, /Split Mesh/);
  byId("continue").click();

  assert.equal(game.state.clash.meshGroups[first], "mesh-1");
  assert.equal(game.state.clash.meshGroups[second], "mesh-1");
});

test("online create and join require a NIP-07 identity before opening a socket", () => {
  const { net, opened } = loadNet(HTTP_ENV);
  const codes = [];
  net.start({ onError: (m) => codes.push(m.code) });
  assert.equal(net.create({ name: "felix", affinity: "Power", pubkey: null }), false);
  assert.equal(net.join({ code: "K7M2QF", name: "anna", affinity: "Signal", pubkey: null }), false);
  assert.deepEqual(codes, ["NIP07_REQUIRED", "NIP07_REQUIRED"]);
  assert.deepEqual(opened, [], "identity failures must happen before network access");
});

test("online intents wait for a signed NIP-42 challenge", async () => {
  const signed = [];
  const { net, sockets } = loadNet({
    ...HTTP_ENV,
    storage: { "600b:pubkey": NIP07_PUBKEY },
    nostr: {
      getPublicKey: async () => NIP07_PUBKEY,
      signEvent: async (event) => {
        signed.push(event);
        return { ...event, pubkey: NIP07_PUBKEY, id: "e".repeat(64), sig: "f".repeat(128) };
      },
    },
  });
  assert.equal(net.create({ name: "felix", affinity: "Power", pubkey: NIP07_PUBKEY }), true);
  const socket = sockets[0];
  socket.readyState = 1;
  socket.onopen();
  assert.deepEqual(socket.sent, [], "CREATE was sent before identity proof");

  socket.onmessage({ data: JSON.stringify({
    t: "AUTH", v: 1, challenge: "c".repeat(64), relay: "ws://bitbeam:8777/ws", kind: 22242,
  }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(signed.length, 1);
  assert.equal(signed[0].kind, 22242);
  assert.deepEqual(signed[0].tags, [
    ["relay", "ws://bitbeam:8777/ws"],
    ["challenge", "c".repeat(64)],
  ]);
  assert.equal(socket.sent[0].t, "AUTH");
  assert.equal(socket.sent.some((msg) => msg.t === "CREATE"), false);

  socket.onmessage({ data: JSON.stringify({ t: "AUTH_OK", v: 1, pubkey: NIP07_PUBKEY }) });
  assert.equal(socket.sent.at(-1).t, "CREATE");
});

test("player names are rendered as text in the turn HUD", () => {
  const { byId, game } = loadPlay(netStub());
  const payload = '<img src=x onerror="globalThis.pwned=true">';
  byId("nameA").value = payload;
  byId("nameB").value = "Opponent";
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;

  byId("start").click();

  assert.ok(game.state, "the fixture must start a real game");
  assert.equal(
    byId("youName").textContent,
    payload,
    "the name must remain visible as literal text"
  );
  assert.ok(!byId("turnchip").innerHTML.includes("<img"), "the name reached an HTML parser");
});

test("the clash preview promises exactly what the engine then does", () => {
  /* The preview mirrors engine.js by hand (minimal lethal in order, Overflow,
   * First Strike in its own step). A preview that disagrees with the engine is
   * worse than no preview, so this plays real clashes out — blocked ones
   * included — and holds the promise against the result. */
  const { byId, game } = loadPlay(netStub());
  byId("deckA").value = "precon:Relay Swarm";
  byId("deckB").value = "precon:Relay Swarm";
  byId("seed").value = "600";
  byId("start").click();
  assert.ok(game.state, "the hotseat game must start");

  /* Pressing Continue alone never puts an Avatar on the board, so there is
   * never anything to clash with. The bot policy builds both boards through
   * the same dispatch the UI uses; the clash steps themselves are driven
   * through the real DOM path, which is what this test is about. */
  const E = globalThis.E1Engine;
  assert.equal(typeof E.previewClash, "function", "the UI has no authoritative preview API");
  const NPC = require(path.join(HERE, "..", "..", "site", "npc.js"));
  const catalogById = Object.fromEntries(globalThis.E1_CARDS.map((c) => [c.id, c]));
  const compiledCache = {};
  const compiled = (id) => (compiledCache[id] ||= E.compileCard(catalogById[id]));
  const botMove = () => {
    const state = game.state;
    const seat = NPC.waitingSeat(state);
    if (seat === null) return false;
    const prefs = { affinity: "Signal" };
    for (const move of NPC.candidates(E, state, seat, compiled, prefs)) {
      const before = game.state.seq;
      game.dispatch(move.type, seat, move.payload);
      if (game.state.seq !== before) return true;
    }
    return false;
  };

  // The stub never clears a zone, so the freshest render is at the END.
  const nodeFor = (zoneId, uid) => {
    const kids = byId(zoneId).children;
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i] && kids[i].dataset && kids[i].dataset.uid === uid) return kids[i];
    }
    return null;
  };
  const seatOf = () => (game.state.awaiting ? game.state.awaiting.seat : game.state.turn.active);

  let checked = 0;
  let blockedSeen = 0;
  for (let step = 0; step < 400 && !game.state.result && checked < 6; step++) {
    const state = game.state;
    const awaiting = state.awaiting;

    if (awaiting && awaiting.kind === "attackers") {
      byId("quickClash").click(); // select every eligible attacker
      byId("continue").click();
      continue;
    }

    if (awaiting && awaiting.kind === "blockers") {
      // Answer the first attacker with the first Avatar that legally can.
      const me = seatOf();
      const attackersNow = state.clash.attackers.filter((uid) => state.objects[uid]);
      for (const attacker of attackersNow) {
        const node = nodeFor("foeNetwork", attacker);
        if (!node) continue;
        node.click(); // select the attacker to block
        for (const mine of state.zones[`${me}:network`] || []) {
          const blocker = nodeFor("youNetwork", mine);
          if (!blocker) continue;
          blocker.click(); // assign, if the engine allows it
          if (game.state === state) continue;
          break;
        }
        break;
      }

      // The promise, captured the moment before it is confirmed.
      const plan = game.preview();
      const defender = plan.defenderSeat;
      const uptimeBefore = state.seats[defender].uptime;
      const doomed = [...plan.dying];
      const survivors = plan.rows
        .flatMap((row) => [row.uid, ...row.blockers])
        .filter((uid) => doomed.indexOf(uid) < 0);
      if (plan.rows.some((row) => row.blockers.length)) blockedSeen += 1;

      byId("continue").click(); // declare blocks
      for (let i = 0; i < 8 && game.state.turn.phase === "clash"; i++) byId("continue").click();

      const after = game.state;
      assert.equal(
        after.seats[defender].uptime,
        uptimeBefore - plan.toPlayer,
        `preview promised ${plan.toPlayer} to the player, the engine did ` +
          `${uptimeBefore - after.seats[defender].uptime}`
      );
      for (const uid of doomed) {
        assert.ok(!after.objects[uid], `preview said ${uid} dies, but it is still on the board`);
      }
      for (const uid of survivors) {
        assert.ok(after.objects[uid], `preview let ${uid} live, but the engine removed it`);
      }
      checked += 1;
      continue;
    }

    if (!botMove()) break; // nothing left to do: stop rather than spin
  }

  assert.ok(checked >= 2, `only ${checked} clash(es) were verified`);
  assert.ok(blockedSeen >= 1, "no blocked clash was exercised — the hard path went untested");
});

// -------------------------------------------------- nostr as the session root

/* `sessions()` fans two REQs across the relays it reads, one socket per relay:
 * the first query's sockets, then the second's. Driving the stub sockets by hand
 * is the harness: open them, feed EVENTs, then EOSE so the query resolves on
 * agreement rather than on its deadline. */
function answerRelays(sockets, query, events) {
  const fan = sockets.length / 2;
  const relays = sockets.slice(query * fan, (query + 1) * fan);
  for (const ws of relays) {
    ws.readyState = 1;
    if (ws.onopen) ws.onopen();
  }
  // One relay carries everything; the others are silent but must still EOSE, or
  // the query waits out its full deadline.
  for (const event of events) {
    relays[0].onmessage({ data: JSON.stringify(["EVENT", "q", event]) });
  }
  for (const ws of relays) ws.onmessage({ data: JSON.stringify(["EOSE", "q"]) });
}

const SK = (label) => Uint8Array.from(createHash("sha256").update(`client:${label}`).digest());
const MINE = SK("mine");
const FOE = SK("foe");
const MY_KEY = Buffer.from(schnorr.getPublicKey(MINE)).toString("hex");
const FOE_KEY = Buffer.from(schnorr.getPublicKey(FOE)).toString("hex");

const eventIdOf = (event) => createHash("sha256").update(JSON.stringify([
  0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
])).digest("hex");

/** Really signed by the opponent, because net.js verifies before it believes. */
function signed(sk, event) {
  const full = Object.assign({ pubkey: Buffer.from(schnorr.getPublicKey(sk)).toString("hex") }, event);
  full.id = eventIdOf(full);
  full.sig = Buffer.from(schnorr.sign(full.id, sk)).toString("hex");
  return full;
}

const startEventFor = (matchId, over) =>
  signed(FOE, Object.assign(
    {
      kind: 4600,
      created_at: 1785310000,
      tags: [["t", "start"], ["m", matchId], ["p", MY_KEY], ["p", FOE_KEY]],
      content: JSON.stringify({
        v: 1,
        kind: "start",
        matchId,
        table: "ws://bitbeam:8777/ws",
        players: [
          { seat: 0, pubkey: MY_KEY, name: "felix", affinity: "Power" },
          { seat: 1, pubkey: FOE_KEY, name: "anna", affinity: "Signal" },
        ],
        stake: 500,
      }),
    },
    over || {}
  ));

const resultEventFor = (matchId) => signed(FOE, {
  kind: 31600,
  created_at: 1785311000,
  tags: [["d", matchId], ["p", MY_KEY]],
  content: "{}",
});

test("an npub alone finds the matches it has not finished", async () => {
  const { net, sockets } = loadNet(HTTP_ENV);
  const pending = net.nostr.sessions(MY_KEY);
  answerRelays(sockets, 0, [startEventFor("m_0000000000a1")]);
  answerRelays(sockets, 1, []); // no results published: the match is still live
  const found = await pending;

  assert.equal(found.length, 1);
  assert.equal(found[0].matchId, "m_0000000000a1");
  assert.equal(found[0].table, "ws://bitbeam:8777/ws", "and it names the referee to return to");
  assert.equal(found[0].seat, 0);
  assert.equal(found[0].opponent, "anna");
  assert.equal(found[0].stake, 500);
});

test("a match with a published result is over, not resumable", async () => {
  const { net, sockets } = loadNet(HTTP_ENV);
  const pending = net.nostr.sessions(MY_KEY);
  answerRelays(sockets, 0, [startEventFor("m_0000000000b1"), startEventFor("m_0000000000b2")]);
  answerRelays(sockets, 1, [resultEventFor("m_0000000000b2")]);
  const found = await pending;

  assert.deepEqual(found.map((m) => m.matchId), ["m_0000000000b1"]);
});

test("a start announcement off a relay is untrusted input", async () => {
  /* `table` decides where our socket goes, so a stranger's event must not be
   * able to point it anywhere it likes. */
  const { net, sockets } = loadNet(HTTP_ENV);
  const pending = net.nostr.sessions(MY_KEY);

  const notAWebsocket = startEventFor("m_0000000000c1", {
    content: JSON.stringify({
      v: 1, kind: "start", matchId: "m_0000000000c1", table: "https://evil.example/steal",
      players: [{ seat: 0, pubkey: MY_KEY }, { seat: 1, pubkey: FOE_KEY }],
    }),
  });
  const notMyMatch = startEventFor("m_0000000000c2", {
    content: JSON.stringify({
      v: 1, kind: "start", matchId: "m_0000000000c2", table: "ws://bitbeam:8777/ws",
      players: [{ seat: 0, pubkey: FOE_KEY }, { seat: 1, pubkey: "c".repeat(64) }],
    }),
  });
  const junk = startEventFor("m_0000000000c3", { content: "not json at all" });
  const wrongShape = startEventFor("m_0000000000c4", {
    content: JSON.stringify({ v: 1, kind: "start", matchId: "nope", table: "ws://x/ws" }),
  });
  const good = startEventFor("m_0000000000c5");

  answerRelays(sockets, 0, [notAWebsocket, notMyMatch, junk, wrongShape, good]);
  answerRelays(sockets, 1, []);
  const found = await pending;

  assert.deepEqual(
    found.map((m) => m.matchId),
    ["m_0000000000c5"],
    "only the well-formed announcement naming a websocket and seating us survives"
  );
});

test("the website reads nappelin's relay beside the public three, and publishes to the public three", () => {
  const { net, opened } = loadNet(HTTP_ENV);
  const reads = ["wss://relay.nappelin.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
  assert.deepEqual(net.nostr.relays(), reads, "what the leaderboard names as the relays it asks");
  net.nostr.query({ kinds: [0], authors: [MY_KEY] }, 1);
  assert.deepEqual(opened, reads, "a look or profile published only on nappelin's relay is found there");
  opened.length = 0;
  net.nostr.subscribeInvites(MY_KEY, () => {});
  assert.deepEqual(opened, reads, "and so are the invites a Hangar tab sends there first");
  opened.length = 0;
  net.nostr.publish({ id: "e".repeat(64), kind: 4600, tags: [], content: "{}" });
  assert.deepEqual(opened, reads.slice(1), "a publish still goes to the public three");
  const pinned = loadNet({ ...HTTP_ENV, location: { ...HTTP_ENV.location, search: "?relay=wss://relay.example" } });
  assert.deepEqual(pinned.net.nostr.relays(), ["wss://relay.example"], "?relay= still routes every read and write");
});

test("asking without an identity asks no relay anything", async () => {
  const { net, opened } = loadNet(HTTP_ENV);
  assert.deepEqual(await net.nostr.sessions(""), []);
  assert.deepEqual(await net.nostr.sessions("not-a-pubkey"), []);
  assert.deepEqual(opened, [], "a malformed key must not open a socket");
});

test("rejoining refuses a table URL that is not a websocket", () => {
  /* The recovered row carries a table, and that value came off a relay — so it
   * decides where our socket goes and cannot be taken at face value. A signed-in
   * identity is required for the socket to open at all, which is why one is
   * present here: without it `open()` correctly refuses before reaching this. */
  const signedIn = { ...HTTP_ENV, storage: { "600b:pubkey": MY_KEY } };
  const { net, opened } = loadNet(signedIn);
  net.rejoin("m_0000000000d1", "https://evil.example/steal");
  assert.equal(opened.length, 1);
  assert.equal(opened[0], "ws://bitbeam:8777/ws", "it fell back to this page's own table");

  const later = loadNet(signedIn);
  assert.equal(later.net.rejoin("not-a-match-id", "ws://bitbeam:8777/ws"), false);
  assert.deepEqual(later.opened, [], "a malformed match id opens nothing");
});

// ------------------------------------------- the login proof names its table

/** Boot a signed-in tab that already holds a match, so a socket opens at once. */
function signedInTab(overrides) {
  const signed = [];
  const env = {
    ...HTTP_ENV,
    storage: { "600b:pubkey": NIP07_PUBKEY },
    session: new Map([["600b:match", JSON.stringify({
      matchId: "m_0000000000f1", seat: 0, token: "t".repeat(32),
      table: "ws://bitbeam:8777/ws", code: "K7M2QF",
    })]]),
    nostr: {
      getPublicKey: async () => NIP07_PUBKEY,
      signEvent: async (event) => {
        signed.push(event);
        return { ...event, pubkey: NIP07_PUBKEY, id: "i".repeat(64), sig: "s".repeat(128) };
      },
    },
    ...(overrides || {}),
  };
  const loaded = loadNet(env);
  const errors = [];
  loaded.net.start({ onError: (e) => errors.push(e), onState: () => {}, onStatus: () => {} });
  return { ...loaded, signed, errors };
}

const authFrom = (relay) => ({
  data: JSON.stringify({ t: "AUTH", v: 1, challenge: "c".repeat(64), relay, kind: 22242, expiresIn: 600 }),
});

test("a login challenge naming another table is refused, not signed", async () => {
  /* THE ANTI-REPLAY PROPERTY OF NIP-42 IS THE RELAY TAG. Signing whatever the
   * far end asked for let a hostile table harvest a challenge from the real
   * referee, serve it here, take the signature, and replay it to authenticate
   * AS THIS PLAYER — after which the referee hands over their unfinished
   * matches and the claim ladder hands over the seat. */
  const tab = signedInTab();
  assert.equal(tab.sockets.length, 1, "a saved match opens a socket with no click");

  tab.sockets[0].onmessage(authFrom("ws://evil.example/ws"));
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(tab.signed, [], "the extension must never be asked to sign it");
  assert.equal(tab.sockets[0].sent.length, 0, "and nothing goes back on the wire");
  const failure = tab.errors.find((e) => e.code === "AUTH_FAILED");
  assert.ok(failure, "the player is told, rather than silently left unauthenticated");
  assert.match(failure.message, /evil\.example/, "and the message names what it refused");
  assert.match(failure.message, /bitbeam/, "alongside who actually answered");
});

test("a login challenge from the table we dialled is signed", async () => {
  const tab = signedInTab();
  tab.sockets[0].readyState = 1;
  tab.sockets[0].onmessage(authFrom("ws://bitbeam:8777/ws"));
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(tab.signed.length, 1, "the honest case still works");
  assert.equal(tab.signed[0].kind, 22242);
  const relayTag = tab.signed[0].tags.find((t) => t[0] === "relay");
  const challengeTag = tab.signed[0].tags.find((t) => t[0] === "challenge");
  assert.equal(relayTag[1], "ws://bitbeam:8777/ws");
  assert.equal(challengeTag[1], "c".repeat(64));
  assert.equal(tab.sockets[0].sent[0].t, "AUTH");
});

test("a table that renames itself between reconnects cannot slip a proof past us", async () => {
  /* Hosts are compared rather than whole URLs, because a referee legitimately
   * advertises its PUBLIC_HOST name — but the host itself must match, or the
   * proof is for a different machine. */
  const tab = signedInTab();
  tab.sockets[0].readyState = 1;
  tab.sockets[0].onmessage(authFrom("wss://bitbeam:8777/ws")); // same host, other scheme
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(tab.signed.length, 1, "a scheme difference is a proxy, not an impostor");

  const other = signedInTab();
  other.sockets[0].readyState = 1;
  other.sockets[0].onmessage(authFrom("ws://bitbeam.evil.example:8777/ws"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(other.signed, [], "a lookalike hostname is still a different machine");
});

test("a malformed challenge is refused before the signer is ever asked", async () => {
  const tab = signedInTab();
  tab.sockets[0].onmessage({ data: JSON.stringify({ t: "AUTH", v: 1, challenge: "nope", relay: "ws://bitbeam:8777/ws" }) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(tab.signed, []);
  assert.ok(tab.errors.some((e) => e.code === "AUTH_FAILED"));
});

test("the Queue zone is actually DRAWN, not merely populated in state", () => {
  /* A regression this suite could not see: two `function renderQueue` in one
   * scope, the later winning, so render() called the lobby's queue-status
   * helper instead of the board's — and the Queue, the one zone every played
   * card passes through, silently stopped being drawn. Every existing test
   * still passed, because they all asserted `game.state.queue` and never once
   * asked whether the player could SEE it. */
  const { byId, game } = loadPlay(netStub(), { emit() {}, get: () => ({ motionActive: "reduced" }) });
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();

  const lastCard = (zoneId, name) => {
    const kids = byId(zoneId).children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const img = kids[i].children && kids[i].children[0];
      if (img && img.alt === name) return kids[i];
    }
    return null;
  };

  lastCard("youHand", "Power Plant — Hydro").click();
  lastCard("youNetwork", "Power Plant — Hydro").click();
  lastCard("youHand", "Zap").click();
  byId("foeBar").click();

  assert.ok(game.state.queue[0], "the engine announced it");
  assert.equal(byId("queueWrap").hidden, false, "and the Queue wrapper is revealed");
  assert.ok(lastCard("queue", "Zap"), "and the card is rendered INTO the Queue zone");
});

test("the Network's two rails are drawn, and cards stay direct children", () => {
  /* The rails are CSS `order` plus one break element precisely so that cards
   * remain direct children of the zone — three helpers in this file resolve a
   * card by scanning direct children, and nesting would make every card
   * invisible to them without failing loudly. */
  const { byId, game } = loadPlay(netStub(), { emit() {}, get: () => ({ motionActive: "reduced" }) });
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();

  const lastCard = (zoneId, name) => {
    const kids = byId(zoneId).children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const img = kids[i].children && kids[i].children[0];
      if (img && img.alt === name) return kids[i];
    }
    return null;
  };

  lastCard("youHand", "Power Plant — Hydro").click();
  const plant = lastCard("youNetwork", "Power Plant — Hydro");
  /* THE LOAD-BEARING ASSERTION. The rails are CSS `order` plus one break
   * element specifically so cards stay direct children; nesting them would make
   * every card invisible to this very helper — silently, since a missing node
   * reads as "not played yet" rather than as a layout change. */
  assert.ok(plant, "a Resource must be findable as a DIRECT child of the Network");
  assert.match(plant.className, /(?:^|\s)netres(?:\s|$)/, "and it sits on the back rail");
  assert.equal(plant.dataset.uid, game.state.zones["0:network"][0], "and it is the card the engine put there");
  assert.ok(game.state.zones["0:network"].length >= 1);
});

/* ------------------------------------------------------- the napplet hand-off
 *
 * Matchmaking and the table are two PAGES now, so a dealt seat has to survive a
 * navigation rather than a screen swap. Nothing new carries it: net.js already
 * writes the session to sessionStorage on the STATE that seats you, and
 * sessionStorage is exactly what a same-tab navigation keeps. These two tests
 * pin that hand-off end to end, because it is the only thing holding the split
 * together — if it breaks, a found match drops the player at an empty table.
 */
const LOBBY_ENV = {
  location: { protocol: "http:", host: "bitbeam:8777", href: "http://bitbeam:8777/matchmaking.html", search: "" },
};
const TABLE_ENV = {
  location: { protocol: "http:", host: "bitbeam:8777", href: "http://bitbeam:8777/play.html", search: "" },
};
const SEATING_STATE = {
  t: "STATE", v: 1, matchId: "m_0123456789ab", seat: 1, token: "b".repeat(32),
  code: "K7M2QF", status: "playing", view: { seq: 0 }, players: [{ seat: 0, online: true }, { seat: 1, online: true }],
};

test("a seat dealt in the lobby survives the navigation to the table", () => {
  /* ONE TAB, TWO PAGES. The same localStorage and the same sessionStorage
   * travel across a same-tab navigation, which is what these shared maps are. */
  const store = new Map([["600b:pubkey", NIP07_PUBKEY]]);
  const session = new Map();

  // ---- matchmaking.html: ask for an opponent, and the referee seats us.
  const lobby = loadNet({ ...LOBBY_ENV, store, session });
  lobby.net.start({});
  assert.deepEqual(lobby.opened, [], "a cold lobby opens no socket until it is asked to");

  lobby.net.queue({ name: "felix", affinity: "Power", pubkey: NIP07_PUBKEY, stake: 0 });
  assert.deepEqual(lobby.opened, ["ws://bitbeam:8777/ws"], "asking for a match dials the referee");
  lobby.sockets[0].onmessage({ data: JSON.stringify(SEATING_STATE) });

  assert.equal(lobby.net.session.seat, 1, "the lobby holds the seat the referee dealt");
  assert.ok(session.has("600b:match"), "and the seat was persisted where a navigation can find it");
  assert.equal(JSON.parse(session.get("600b:match")).matchId, "m_0123456789ab");

  // ---- play.html: the same tab, a new document. The seat is simply there.
  const table = loadNet({ ...TABLE_ENV, store, session });
  const started = table.net.start({});
  assert.equal(started.resuming, true, "the table resumes the match the lobby handed it");
  assert.equal(started.seat, 1, "and at the same seat");
  assert.deepEqual(table.opened, ["ws://bitbeam:8777/ws"], "it reconnects to the table it was seated at");
});

test("the table claims the handed-off seat with the signed identity", async () => {
  const store = new Map([["600b:pubkey", NIP07_PUBKEY]]);
  const session = new Map([["600b:match", JSON.stringify({
    matchId: "m_0123456789ab", seat: 1, token: null, table: "ws://bitbeam:8777/ws", code: "K7M2QF",
  })]]);
  const nostr = {
    getPublicKey: async () => NIP07_PUBKEY,
    signEvent: async (event) => ({ ...event, pubkey: NIP07_PUBKEY, id: "e".repeat(64), sig: "f".repeat(128) }),
  };

  const table = loadNet({ ...TABLE_ENV, store, session, nostr });
  table.net.start({});
  const socket = table.sockets[0];
  socket.readyState = 1;
  socket.onopen();
  assert.deepEqual(socket.sent, [], "nothing is claimed before the identity is proven");

  socket.onmessage({ data: JSON.stringify({
    t: "AUTH", v: 1, challenge: "c".repeat(64), relay: "ws://bitbeam:8777/ws", kind: 22242,
  }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  socket.onmessage({ data: JSON.stringify({ t: "AUTH_OK", v: 1, pubkey: NIP07_PUBKEY }) });

  const resume = socket.sent.at(-1);
  assert.equal(resume.t, "RESUME", "the table takes its seat back by resuming");
  assert.equal(resume.matchId, "m_0123456789ab");
  assert.equal(resume.pubkey, NIP07_PUBKEY, "the signed identity IS the claim");
  assert.equal(resume.token, undefined, "no token had to cross the page boundary");
});

/* ------------------------------------------------------------ the Fast table */

test("the local table deals a Fast game on Fast cards, and attacks go through the table", () => {
  globalThis.E1_CARDS_FAST = require(path.join(HERE, "..", "..", "site", "play-data-fast.js"));
  globalThis.E1_PRECONS_FAST = require(path.join(HERE, "..", "..", "site", "precons-fast.js"));
  const { byId, game } = loadPlay(netStub());
  byId("rules").value = "F1.0";
  byId("deckA").value = "precon:Power Surge";
  byId("deckB").value = "precon:Key Custody";
  byId("nameA").value = "A";
  byId("nameB").value = "B";
  byId("seed").value = "fast";
  game.startGame();
  const state = game.state;
  assert.ok(state, byId("prompt").textContent);
  assert.equal(state.ruleset, "F1.0");
  assert.equal(state.catalogDigest, globalThis.E1Engine.buildCatalog(globalThis.E1_CARDS_FAST).digest);
  assert.equal(byId("continue").textContent, "End turn", "Fast's one button");
  assert.match(byId("resourceChip").textContent, /^Pool 1\/1$/);

  // Put a ready Avatar on each side and attack through the table's own dispatch.
  const fast = globalThis.E1_CARDS_FAST;
  const vanilla = fast.find((card) => card.type === "Avatar" && card.abilities.length === 0 && card.keywords.length === 0);
  const place = (seat) => {
    const uid = `o${state.nextUid++}`;
    state.objects[uid] = {
      uid, cardId: vanilla.id, owner: seat, controller: seat, zone: `${seat}:network`, committed: false,
      bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
      revealedTo: [0, 1], revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
    };
    state.zones[`${seat}:network`].push(uid);
    return uid;
  };
  const mine = place(0);
  const uptime = state.seats[1].uptime;
  assert.equal(game.dispatch("DECLARE_ATTACK", 0, { attacker: mine, target: { kind: "seat", seat: 1 } }), true);
  assert.equal(game.state.seats[1].uptime, uptime - vanilla.action);
  assert.equal(game.state.objects[mine].committed, true);
});

test("a remote Fast view switches the table to the Fast card values", () => {
  globalThis.E1_CARDS_FAST = require(path.join(HERE, "..", "..", "site", "play-data-fast.js"));
  const stub = netStub();
  const { byId, game } = loadPlay(stub);
  const E = globalThis.E1Engine;
  E.setCatalog(globalThis.E1_CARDS_FAST, "F1.0");
  const full = E.createGame({
    ruleset: "F1.0",
    seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
    seeds: { public: 5, hidden: [6, 7] },
    firstPlayer: 0,
  });
  stub.lastState = Object.assign({}, STATE_BASE, {
    ruleset: "F1.0", catalogDigest: full.catalogDigest, seat: 0, view: E.view(full, 0), status: "playing",
  });
  stub.handlers.onState(stub.lastState);
  // A mismatched card set refuses to send anything; the Fast digest matches the Fast cards.
  assert.equal(game.dispatch("PASS_PRIORITY", 0, {}), true);
  assert.equal(stub.calls.filter((call) => call[0] === "act").length, 1);
  assert.equal(byId("continue").textContent, "End turn");
});

test("the hand-limit discard is the player's choice, and End turn waits for it", () => {
  /* The first player draws to eight on turn one. Continue used to throw away
   * the first card in hand without asking; now it waits until the player has
   * clicked exactly the cards that go. */
  globalThis.E1_CARDS_FAST = require(path.join(HERE, "..", "..", "site", "play-data-fast.js"));
  globalThis.E1_PRECONS_FAST = require(path.join(HERE, "..", "..", "site", "precons-fast.js"));
  const { byId, game } = loadPlay(netStub());
  byId("rules").value = "F1.0";
  byId("deckA").value = "Power";
  byId("deckB").value = "Keys";
  byId("nameA").value = "A";
  byId("nameB").value = "B";
  byId("seed").value = "discard";
  game.startGame();
  assert.equal(game.state.zones["0:wallet"].length, 8, "the first player holds eight");
  byId("endturn").click();
  assert.equal(game.state.awaiting && game.state.awaiting.kind, "discard", "End turn stops at the discard");
  assert.equal(game.state.zones["0:wallet"].length, 8, "nothing was thrown away unasked");
  assert.equal(byId("continue").textContent, "Discard 0/1");
  const seqBefore = game.state.seq;
  byId("continue").click();
  assert.equal(game.state.seq, seqBefore, "Continue without a pick does nothing");
  assert.match(byId("prompt").textContent, /Choose 1 card to discard/);

  const chosen = game.state.zones["0:wallet"][5];
  latestUidNode(byId, "youHand", chosen).click();
  assert.equal(byId("continue").textContent, "Discard 1/1");
  byId("continue").click();
  assert.equal(game.state.zones["0:wallet"].length, 7);
  assert.equal(game.state.zones["0:wallet"].includes(chosen), false, "the chosen card left the hand");
  assert.equal(game.state.objects[chosen], undefined, "and was archived under a new uid");
});

/* ------------------------------------------------------------- the 3D table
 *
 * site/arena3d.js is a WebGL scene and cannot run here. What CAN be pinned is
 * the contract play.js keeps with it (docs/arena3d.md): the arena is created
 * only when asked for, synced after every render with the card nodes bound by
 * uid, told every cue fx.js gets in the same pass, told which cards glow, and
 * dropped for the classic table the moment it cannot be built. A fake arena
 * records those calls. */
function fakeArena() {
  const calls = { sync: [], setState: [], hover: [], cue: [], disposed: 0 };
  return {
    calls,
    sync: (view, seat, bind) => calls.sync.push({ view, seat, bind }),
    setState: (uid, state) => calls.setState.push({ uid, state }),
    hover: (uid) => calls.hover.push(uid),
    fx: { cue: (name, detail) => calls.cue.push({ name, detail }) },
    dispose: () => { calls.disposed += 1; },
    rectOf: () => null,
  };
}

/* play.js under a fake E1Arena3D. `search` is the page's query string; the
 * arena scripts answer supported() with yes, and create() is recorded (or made
 * to throw). The stub document answers querySelectorAll with nothing, and the
 * arena is bound through exactly that call -- so this walks the zones the way
 * the real DOM would, gcard nodes only, `[data-uid]` honoured. */
function loadPlayWith3D(t, search, options) {
  const created = [];
  const store = new Map(Object.entries((options && options.storage) || {}));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.E1Arena3D = {
    supported: () => true,
    create: (opts) => {
      if (options && options.createThrows) throw new Error("no WebGL2 context");
      const arena = fakeArena();
      arena.opts = opts;
      created.push(arena);
      return arena;
    },
  };
  globalThis.THREE = { REVISION: "186" };
  globalThis.location = { protocol: "http:", host: "bitbeam:8777", href: "http://bitbeam:8777/play.html", search };
  t.after(() => { delete globalThis.E1Arena3D; delete globalThis.THREE; });
  const loaded = loadPlay(netStub(), { emit() {}, get: () => ({ motionActive: "full" }) });
  const zones = ["youHand", "youNetwork", "foeHand", "foeNetwork", "queue"];
  globalThis.document.querySelectorAll = (selector) => {
    const wanted = Array.from(String(selector).matchAll(/\.([\w-]+)/g), (m) => m[1]);
    const out = [];
    for (const id of zones) {
      for (const kid of loaded.byId(id).children) {
        if (!kid || typeof kid !== "object") continue;
        const classes = String(kid.className || "").split(/\s+/);
        if (classes.indexOf("gcard") < 0 || !wanted.every((name) => classes.indexOf(name) >= 0)) continue;
        if (/data-uid/.test(selector) && !kid.dataset.uid) continue;
        out.push(kid);
      }
    }
    return out;
  };
  return Object.assign(loaded, { created, store });
}

const fire = (node, type, event) => { for (const fn of node.listeners[type] || []) fn(event || {}); };

test("the 3D table is created on demand, synced every frame, told every cue and every glow", (t) => {
  const { byId, game, created } = loadPlayWith3D(t, "?arena=3d");
  assert.equal(created.length, 0, "no arena before there is a table to draw");
  assert.equal(byId("arenaTable").value, "3d", "the controls say what the link asked for");
  assert.equal(byId("arenaSetup").value, "3d");

  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
  assert.ok(game.state, "the hotseat game must start");
  assert.equal(created.length, 1, "one arena, mounted by the first render of the table");
  const arena = created[0];
  assert.equal(game.arena, arena, "E1_GAME.arena exposes it for the proof");
  assert.equal(game.arenaMode, "3d");
  assert.equal(arena.opts.host, byId("board"), "mounted on the board");
  assert.equal(arena.opts.THREE, globalThis.THREE);
  assert.equal(typeof arena.opts.faces.urlFor, "function");
  assert.match(String(arena.opts.back), /600B-Timelock-card-back/, "the card back goes through the face path");
  assert.equal(arena.opts.plates.Power, "../art/world-plates/power.png");
  assert.equal(typeof arena.opts.reduced, "function");
  assert.equal(typeof arena.opts.onLost, "function");
  assert.equal(arena.opts.stats, false, "no diagnostics chip unless the link asks for one");
  assert.equal(arena.opts.quality, "auto");
  assert.match(byId("board").className, /(?:^|\s)arena3d(?:\s|$)/, "the board wears the 3D class");

  /* urlFor answers with the repo file here (no E1Faces), for a card, an id or an object. */
  const zap = globalThis.E1_CARDS.find((card) => card.name === "Zap");
  assert.equal(arena.opts.faces.urlFor(zap), "../art/cards/node-runner-web/" + encodeURIComponent(zap.face));
  assert.equal(arena.opts.faces.urlFor(zap.id), arena.opts.faces.urlFor({ cardId: zap.id }));
  assert.equal(arena.opts.faces.urlFor(null), null);

  assert.ok(arena.calls.sync.length >= 1, "synced after the first render");
  let last = arena.calls.sync[arena.calls.sync.length - 1];
  assert.equal(last.seat, 0);
  assert.ok(last.bind.nodes instanceof Map, "nodes is a uid -> node map");
  for (const uid of game.state.zones["0:wallet"]) {
    assert.equal(last.bind.nodes.get(uid), latestUidNode(byId, "youHand", uid), `hand card ${uid} is bound`);
  }
  assert.equal(last.bind.foeHandCount, game.state.zones["1:wallet"].length);
  assert.equal(typeof last.bind.marks, "function");

  const lastCard = (zoneId, name) => {
    const kids = byId(zoneId).children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const img = kids[i].children && kids[i].children[0];
      if (img && img.alt === name) return kids[i];
    }
    return null;
  };

  /* A play: the render that follows it syncs again, the new node is bound
   * under the uid the engine minted, and the cue reaches arena.fx.cue with
   * the detail fx.js got (uid and seat included). */
  const syncsBefore = arena.calls.sync.length;
  lastCard("youHand", "Power Plant — Hydro").click();
  assert.ok(arena.calls.sync.length > syncsBefore, "sync follows the render after a play");
  last = arena.calls.sync[arena.calls.sync.length - 1];
  const plant = game.state.zones["0:network"][0];
  assert.equal(last.bind.nodes.get(plant), latestUidNode(byId, "youNetwork", plant), "the played card's hitbox is bound");
  const landed = arena.calls.cue.find((cue) => cue.name === "resource:play");
  assert.ok(landed, "resource:play forwarded to arena.fx.cue");
  assert.equal(landed.detail.uid, plant);
  assert.equal(landed.detail.seat, 0);
  const canplay = arena.calls.setState.find((call) => call.state.canplay === true);
  assert.ok(canplay, "a playable card is lit through setState");

  /* Hover and focus on a hitbox reach the arena; leaving it clears. */
  const held = latestUidNode(byId, "youNetwork", plant);
  fire(held, "mouseenter");
  fire(held, "mouseleave");
  fire(held, "focus");
  fire(held, "blur");
  assert.deepEqual(arena.calls.hover.slice(-4), [plant, null, plant, null]);

  /* A target pick: the enemy Avatar Zap may hit is marked targetable on its
   * node, and that class is what the arena is told. */
  lastCard("youNetwork", "Power Plant — Hydro").click(); // bank 1 Power
  assert.equal(game.state.seats[0].buffer.P, 1);
  const foeAvatar = clientSeed(game.state, 1, "Cuddy, Signal Organizer");
  arena.calls.setState.length = 0;
  arena.calls.cue.length = 0;
  lastCard("youHand", "Zap").click();
  assert.match(latestUidNode(byId, "foeNetwork", foeAvatar).className, /(?:^|\s)targetable(?:\s|$)/);
  const lit = arena.calls.setState.find((call) => call.uid === foeAvatar && call.state.targetable === true);
  assert.ok(lit, "setState(targetable) during a target request");
  const request = arena.calls.cue.find((cue) => cue.name === "target:request");
  assert.ok(request, "the pick cue is forwarded too");
  assert.ok(request.detail.uids.includes(foeAvatar), "naming the candidates it lit");

  byId("foeBar").click();
  const queued = arena.calls.cue.find((cue) => cue.name === "card:play");
  assert.ok(queued, "card:play forwarded to arena.fx.cue when Zap is announced");
  assert.equal(queued.detail.qid, game.state.queue[0].qid);
  assert.equal(queued.detail.uid, `queue:${game.state.queue[0].qid}`, "named the way the arena registry names Queue items");
  assert.equal(queued.detail.seat, 0);
  assert.ok(arena.calls.cue.some((cue) => cue.name === "target:choose"));

  /* Classic, chosen on the board: the arena is disposed, the class drops, the
   * choice is saved, and no further sync reaches the dead arena. */
  byId("arenaTable").value = "dom";
  fire(byId("arenaTable"), "change");
  assert.equal(arena.calls.disposed, 1, "the arena is disposed");
  assert.equal(game.arena, null);
  assert.equal(game.arenaMode, "dom");
  assert.doesNotMatch(byId("board").className, /arena3d/);
  assert.equal(byId("arenaSetup").value, "dom", "the setup select follows");
  assert.equal(globalThis.localStorage.getItem("600b:arena"), "dom", "the choice is saved");
  const syncsAfter = arena.calls.sync.length;
  byId("continue").click();
  assert.equal(arena.calls.sync.length, syncsAfter, "a disposed arena hears nothing");
  assert.equal(created.length, 1, "and no second arena appears while Classic is chosen");
});

test("?arenastats=1 asks the 3D table for its diagnostics chip", (t) => {
  const { byId, created } = loadPlayWith3D(t, "?rules=fast&arena=3d&assets=local&arenastats=1");
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
  assert.equal(created.length, 1);
  assert.equal(created[0].opts.stats, true);
});

test("?arena=dom never creates an arena, whatever the saved choice", (t) => {
  const { byId, game, created } = loadPlayWith3D(t, "?arena=dom", { storage: { "600b:arena": "3d" } });
  assert.equal(byId("arenaTable").value, "dom");
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
  assert.ok(game.state);
  byId("continue").click();
  byId("continue").click();
  assert.equal(created.length, 0, "the classic table asks for no arena");
  assert.equal(game.arena, null);
  assert.equal(game.arenaMode, "dom");
  assert.doesNotMatch(byId("board").className, /arena3d/);
});

test("the saved table choice is honoured, through the shell's storage inside a napplet", async (t) => {
  /* No link flag: the saved choice decides, read through E1Napplet.storage
   * exactly like the Stack library. A shell answers asynchronously, and a
   * game already on the table follows the late answer. */
  let saved = "dom";
  const writes = [];
  globalThis.E1Napplet = {
    storage: {
      get: async (key) => (key === "600b:arena" ? saved : null),
      set: async (key, value) => { writes.push([key, value]); return true; },
      json: async () => ({}),
    },
  };
  t.after(() => { delete globalThis.E1Napplet; });
  const { byId, game, created } = loadPlayWith3D(t, "");
  assert.equal(game.arenaMode, "3d", "before the shell answers, 3D is the default where it runs");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(game.arenaMode, "dom", "the shell's saved choice wins once it lands");
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
  assert.equal(created.length, 0);

  byId("arenaSetup").value = "3d";
  fire(byId("arenaSetup"), "change");
  assert.equal(created.length, 1, "choosing 3D mid-game mounts the arena on the running table");
  assert.deepEqual(writes, [["600b:arena", "3d"]], "and the choice goes to the shell's storage");
  saved = "3d";
});

test("an arena that cannot be built falls back to the classic table with a notice", async (t) => {
  const { byId, game } = loadPlayWith3D(t, "?arena=3d", { createThrows: true });
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
  assert.ok(game.state, "the game starts regardless");
  assert.equal(game.arena, null);
  assert.equal(game.arenaMode, "dom");
  assert.doesNotMatch(byId("board").className, /arena3d/);
  assert.match(byId("netNotice").textContent, /3D table unavailable here; showing the classic table/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(byId("prompt").textContent, /3D table unavailable here/, "the table itself says so");
  assert.equal(byId("arenaTable").value, "dom", "the select shows what is actually on screen");
  /* Playing on is the classic table, and nothing tries the arena again on its own. */
  const lastCard = (zoneId, name) => {
    const kids = byId(zoneId).children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const img = kids[i].children && kids[i].children[0];
      if (img && img.alt === name) return kids[i];
    }
    return null;
  };
  lastCard("youHand", "Power Plant — Hydro").click();
  assert.equal(game.state.zones["0:network"].length, 1);
  assert.equal(game.arena, null);
  leaveSolo(byId, game);
});

/* ------------------------------------------------------- the NutFT wallet door
 *
 * play.html carries no nutft-wallet.js tag any more: site/collection-stack.js
 * loads it when this device holds a wallet and something asks. The possession
 * gate above keeps its word through that door — it still refuses a NutFT Stack
 * it cannot verify, and it still verifies one it can. */
const COLLECTION_JS = path.join(HERE, "..", "..", "site", "collection-stack.js");
const walletTags = (byId) => byId("body").children.filter((node) => node && /nutft-wallet\.js$/.test(String(node.src || "")));

test("a NutFT Stack on a device with no wallet is refused without loading one", async () => {
  require(COLLECTION_JS);
  delete globalThis.NutFTWallet;
  const saved = { Owned: [...Array(37).fill("E1-002"), ...Array(3).fill("E1-004")] };
  const storage = new Map([["600b:decks", JSON.stringify(saved)], ["600b:nutft-decks", JSON.stringify({ Owned: true })]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem() {} };
  globalThis.location = { origin: "http://table.test" };
  const { byId, game } = loadPlay(netStub());
  /* Read what THIS table wrote: under a loaded test run an earlier table can
     repaint the prompt between two polls and hide the refusal. */
  const prompts = recordText(byId("prompt"));
  byId("deckA").value = "custom:Owned";
  byId("deckB").value = "Signal";
  byId("start").click();
  await waitFor(() => prompts.some((line) => /needs 3, wallet controls 0/.test(line)), "the possession failure prompt");
  assert.equal(game.state, null);
  assert.equal(walletTags(byId).length, 0, "no wallet, no wallet script");
});

test("a NutFT Stack loads the wallet script on demand and starts once its proofs check out", async () => {
  require(COLLECTION_JS);
  delete globalThis.NutFTWallet;
  const saved = { Owned: [...Array(37).fill("E1-002"), ...Array(3).fill("E1-004")] };
  const storage = new Map([
    ["600b:decks", JSON.stringify(saved)],
    ["600b:nutft-decks", JSON.stringify({ Owned: true })],
    ["600b:nutft-wallet", JSON.stringify({ privateKey: "k", pubkey: "p", tokens: ["cashuB1"] })],
  ]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem() {} };
  globalThis.location = { origin: "http://table.test" };
  const { byId, game } = loadPlay(netStub());
  byId("deckA").value = "custom:Owned";
  byId("deckB").value = "Signal";
  byId("start").click();
  await waitFor(() => walletTags(byId).length === 1, "the wallet script tag");
  assert.equal(byId("start").disabled, true, "Start waits for the check");
  const origins = [];
  globalThis.NutFTWallet = {
    read: async () => ({ tokens: ["cashuB1"] }),
    snapshotReadOnly: async (origin) => {
      origins.push(origin);
      return { owned: Array.from({ length: 3 }, () => ({ tag: ["1", "600B-E1", "E1-004"] })), spent: [], invalid: [], unreadable: [] };
    },
  };
  for (const tag of walletTags(byId)) for (const fn of tag.listeners.load || []) fn();
  await waitFor(() => game.state, "the verified Stack to start");
  assert.ok(origins.includes("http://table.test"), "the snapshot asked this site's mint");
  assert.equal(walletTags(byId).length, 1, "one tag, however many asked");
  delete globalThis.NutFTWallet;
  leaveSolo(byId, game);
});

/* ---------------------------------------------------------------- my collection
 *
 * The setup form offers "My collection (n of 40 cards yours)" in both Stack
 * menus when the player holds cards, and one plain line when they do not —
 * inside the Hangar through the collection intent, with storage that throws the
 * way an opaque origin's does, and on the website through a wallet that is only
 * loaded when this device holds one. */
const FAST_DATA = path.join(HERE, "..", "..", "site", "play-data-fast.js");
const FAST_PRECONS = path.join(HERE, "..", "..", "site", "precons-fast.js");

/* The freshest "My collection" option in a menu: the stub's innerHTML = "" keeps
   old children, so a rebuilt menu is scanned from the end. */
function collectionOption(byId, id) {
  const kids = byId(id).children;
  for (let index = kids.length - 1; index >= 0; index--) {
    const option = (kids[index].children || []).find((child) => child && child.value === "collection");
    if (option) return option;
  }
  return null;
}

/* Cards that sit in the same quota under both rules, picked by what they are. */
function collectionFixture(counts) {
  const fast = require(FAST_DATA);
  const classic = Object.fromEntries(require(path.join(HERE, "..", "..", "site", "play-data.js")).map((card) => [card.id, card]));
  const clean = (card) => !/\bStake\b/.test(card.text || "") && card.rarity !== "genesis" && card.rarity !== "basic"
    && classic[card.id].type === card.type;
  const power = (test) => fast.filter((card) => card.affinity.length === 1 && card.affinity[0] === "Power" && clean(card) && test(card));
  const avatars = power((card) => card.type === "Avatar");
  const spells = power((card) => card.type === "Zap" || card.type === "Operation");
  const permanent = fast.find((card) => card.affinity[0] === "Neutral" && card.type === "Hardware" && clean(card));
  const cards = [
    ...avatars.slice(0, counts.avatars.length).map((card, index) => ({ asset_id: card.id, count: counts.avatars[index] })),
    ...spells.slice(0, counts.spells.length).map((card, index) => ({ asset_id: card.id, count: counts.spells[index] })),
    ...(counts.permanent ? [{ asset_id: permanent.id, count: counts.permanent }] : []),
  ].sort((a, b) => (a.asset_id < b.asset_id ? -1 : 1));
  return {
    v: 1, kind: "nutft/inventory", edition: "600b-e1", collection_id: "600B-E1",
    catalog_uri: "https://tcg.nappelin.com/nutft/catalog", mint: "https://tcg.nappelin.com", at: 1757900000, cards,
  };
}

/* Just enough of a Hangar: the domains it grants, a signed-in key (or none) and
   the collection intent's answer. */
function hangar({ identity = "f".repeat(64), inventory = null, intent = true } = {}) {
  const asked = [];
  return {
    asked,
    present: true,
    has: (domain) => (domain === "intent" ? intent : ["identity", "storage"].includes(domain)),
    storage: { json: async () => ({}), get: async () => null, set: async () => true },
    identity: { current: async () => identity },
    collection: {
      inventory: async (edition) => { asked.push(edition); return inventory; },
      counts: (answer) => new Map(answer.cards.map((card) => [card.asset_id, card.count])),
    },
  };
}

/* An opaque origin: reading `localStorage` at all throws. */
function opaqueStorage(t) {
  const denied = () => { throw new Error("SecurityError: storage is not available in an opaque origin"); };
  Object.defineProperty(globalThis, "localStorage", { get: denied, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { get: denied, configurable: true });
  t.after(() => {
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(globalThis, name, { value: undefined, writable: true, configurable: true });
    }
  });
}

const ownerCards = (state, seat) => Object.values(state.objects).filter((object) => object.owner === seat).map((object) => object.cardId).sort();
const changeRules = (byId, value) => {
  byId("rules").value = value;
  for (const fn of byId("rules").listeners.change || []) fn();
};

test("inside the Hangar, My collection is in both Stack menus and deals a legal Fast game", async (t) => {
  require(COLLECTION_JS);
  globalThis.E1_CARDS_FAST = require(FAST_DATA);
  globalThis.E1_PRECONS_FAST = require(FAST_PRECONS);
  opaqueStorage(t);
  const inventory = collectionFixture({ avatars: [2, 2, 2], spells: [2, 2], permanent: 2 });
  const shell = hangar({ inventory });
  globalThis.E1Napplet = shell;
  let snapshots = 0;
  globalThis.NutFTWallet = { snapshotReadOnly: async () => { snapshots += 1; throw new Error("a collection Stack asks no wallet"); } };
  t.after(() => { delete globalThis.E1Napplet; delete globalThis.NutFTWallet; });

  const { byId, game } = loadPlay(netStub());
  await waitFor(() => collectionOption(byId, "deckA") && collectionOption(byId, "deckB"), "My collection in both menus");
  assert.deepEqual(shell.asked, ["600b-e1"], "the collection intent was asked once, for Edition One");
  assert.equal(collectionOption(byId, "deckA").textContent, "My collection (12 of 40 cards yours)");
  assert.equal(byId("collectionNote").hidden, false);
  assert.equal(byId("collectionNote").textContent, "Your collection: 12 cards. “My collection” is in both Stack menus.");
  assert.match(byId("collectionNote").className, /(?:^|\s)has-cards(?:\s|$)/);

  changeRules(byId, "F1.0");
  assert.equal(collectionOption(byId, "deckB").textContent, "My collection (12 of 40 cards yours)", "relabelled for Fast");
  byId("deckA").value = "collection";
  byId("deckB").value = "Signal";
  byId("seed").value = "my-collection";
  byId("start").click();
  assert.ok(game.state, byId("prompt").textContent);
  assert.equal(game.state.ruleset, "F1.0");
  assert.equal(snapshots, 0, "no possession check: a collection Stack claims none");

  const owned = new Map(inventory.cards.map((card) => [card.asset_id, card.count]));
  const expected = globalThis.E1CollectionStack.buildCollectionStack(globalThis.E1_CARDS_FAST, owned, { profile: "F1.0", precons: globalThis.E1_PRECONS_FAST });
  assert.deepEqual(ownerCards(game.state, 0), expected.ids.slice().sort(), "seat one plays exactly the collection Stack");
  for (const card of inventory.cards) {
    assert.ok(ownerCards(game.state, 0).filter((id) => id === card.asset_id).length >= card.count, `${card.asset_id} is in the Stack`);
  }
  leaveSolo(byId, game);
});

test("My collection is counted under the rules chosen, and Classic deals it too", async (t) => {
  require(COLLECTION_JS);
  globalThis.E1_CARDS_FAST = require(FAST_DATA);
  globalThis.E1_PRECONS_FAST = require(FAST_PRECONS);
  opaqueStorage(t);
  /* Sixteen Power Avatars: Fast takes up to twenty, Classic only fourteen. */
  globalThis.E1Napplet = hangar({ inventory: collectionFixture({ avatars: [4, 4, 4, 4], spells: [] }) });
  t.after(() => { delete globalThis.E1Napplet; });
  const { byId, game } = loadPlay(netStub());
  await waitFor(() => collectionOption(byId, "deckA"), "My collection");
  assert.equal(collectionOption(byId, "deckA").textContent, "My collection (14 of 40 cards yours)", "Classic");
  changeRules(byId, "F1.0");
  assert.equal(collectionOption(byId, "deckA").textContent, "My collection (16 of 40 cards yours)", "Fast");
  changeRules(byId, "E1.0");
  byId("deckA").value = "Keys";
  byId("deckB").value = "collection";
  byId("seed").value = "classic-collection";
  byId("start").click();
  assert.ok(game.state, byId("prompt").textContent);
  assert.equal(game.state.ruleset, "E1.0");
  assert.equal(ownerCards(game.state, 1).length, 40, "seat two's collection Stack was dealt");
  leaveSolo(byId, game);
});

test("a guest and a member without cards each get the line that fits, and no option", async (t) => {
  require(COLLECTION_JS);
  opaqueStorage(t);
  const member = "No cards in your collection yet. A card bought on tcg.nappelin.com is locked to that site's wallet: send it to your collection's address in the wallet there first, then paste the token into the collection.";
  const noCards = () => Object.assign(collectionFixture({ avatars: [], spells: [] }), { cards: [] });
  const cases = [
    [hangar({ identity: "", inventory: null }), "Sign in to use your cards. You can play with a starter stack now."],
    [hangar({ inventory: null }), member],
    [hangar({ inventory: noCards() }), member],
    [hangar({ identity: "", inventory: Object.assign(noCards(), { cards: [{ asset_id: "600B-E1-001", count: 2 }] }) }),
      "Your collection holds 2 cards this edition does not know. You can play with a starter stack now."],
    [hangar({ intent: false }), "No card collection is reachable in this shell. You can play with a starter stack now."],
  ];
  t.after(() => { delete globalThis.E1Napplet; });
  for (const [shell, words] of cases) {
    globalThis.E1Napplet = shell;
    const { byId, game } = loadPlay(netStub());
    await waitFor(() => byId("collectionNote").textContent === words, words);
    assert.equal(byId("collectionNote").hidden, false);
    assert.doesNotMatch(byId("collectionNote").className, /has-cards/);
    assert.equal(collectionOption(byId, "deckA"), null, "nothing to offer, so no option");
    byId("deckA").value = "Power";
    byId("deckB").value = "Signal";
    byId("start").click();
    assert.ok(game.state, "a starter stack plays now");
  }
});

test("a cold website table never loads the NutFT wallet, and signing in changes the line", async () => {
  require(COLLECTION_JS);
  delete globalThis.E1Napplet;
  delete globalThis.NutFTWallet;
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  globalThis.location = { origin: "https://tcg.nappelin.com", protocol: "https:", search: "" };
  const stub = netStub();
  stub.nostr.savedPubkey = () => null;
  const { byId, fired } = loadPlay(stub);
  await waitFor(() => byId("collectionNote").textContent === "Sign in to use your cards. You can play with a starter stack now.", "the guest line");
  for (const fn of fired["e1:identity"] || []) fn({ detail: { pubkey: "a".repeat(64) } });
  assert.equal(byId("collectionNote").textContent,
    "No cards in this browser's wallet yet. Cards you buy or claim in the shop land here. You can play with a starter stack now.", "on the website the cards are this browser's wallet, not a collection to paste into");
  for (const fn of fired["e1:identity"] || []) fn({ detail: { pubkey: null } });
  assert.match(byId("collectionNote").textContent, /^Sign in to use your cards\./, "and signing out changes it back");
  assert.equal(walletTags(byId).length, 0, "no wallet on this device, so no wallet script");
  assert.equal(collectionOption(byId, "deckA"), null);
  assert.equal([...storage.keys()].some((key) => /nutft/.test(key)), false, "nothing was written for the wallet");
});

test("a website wallet with cards is read when the table opens, and offered", async (t) => {
  require(COLLECTION_JS);
  delete globalThis.E1Napplet;
  delete globalThis.NutFTWallet;
  t.after(() => { delete globalThis.NutFTWallet; });
  const storage = new Map([["600b:nutft-wallet", JSON.stringify({ privateKey: "k", pubkey: "p", tokens: ["cashuB1", "cashuB2"] })]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem() {} };
  globalThis.location = { origin: "https://tcg.nappelin.com", protocol: "https:", search: "" };
  const { byId } = loadPlay(netStub());
  await waitFor(() => walletTags(byId).length === 1, "the wallet script, loaded because a wallet is here");
  const inventory = collectionFixture({ avatars: [3, 1], spells: [1], permanent: 0 });
  const proofs = inventory.cards.flatMap((card) => Array.from({ length: card.count }, () => ({ tag: ["1", "600B-E1", card.asset_id] })));
  const origins = [];
  globalThis.NutFTWallet = {
    read: async () => ({ tokens: ["cashuB1", "cashuB2"] }),
    snapshotReadOnly: async (origin) => {
      origins.push(origin);
      return { owned: [...proofs, { tag: ["1", "600B-E1", "E1-999"] }], spent: [], invalid: [], unreadable: [] };
    },
  };
  for (const fn of walletTags(byId)[0].listeners.load || []) fn();
  await waitFor(() => collectionOption(byId, "deckA"), "My collection from the wallet");
  assert.deepEqual(origins, ["https://tcg.nappelin.com"], "this site's mint, asked once");
  assert.equal(collectionOption(byId, "deckA").textContent, "My collection (5 of 40 cards yours)");
  assert.equal(byId("collectionNote").textContent,
    "Your collection: 5 cards. “My collection” is in both Stack menus. 1 more card is not part of this edition.");
});

/* ------------------------------------------------------------ a member's look
 *
 * site/identity-look.js has its own tests for the ladder. These hold play.js to
 * where it mounts a look: which seat wears one, the name on the bar (as text),
 * the avatar menu's choice winning, the shell's doors inside the Hangar, and a
 * late look that must stay off a seat that has changed hands. */
const LOOK_JS = path.join(HERE, "..", "..", "site", "identity-look.js");
const OTHER = SK("other");
const OTHER_KEY = Buffer.from(schnorr.getPublicKey(OTHER)).toString("hex");
const kindZero = (sk, meta) => signed(sk, { kind: 0, created_at: 1789000000, tags: [], content: JSON.stringify(meta) });
const portraitOf = (bar) => bar.children.find((child) => child && child.className === "portrait") || null;
const ticks = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** net.js's relay query, one filter per call, answering per author when the test says so. */
function lookRelays() {
  const answers = new Map();
  const asked = [];
  const slot = (author) => {
    if (!answers.has(author)) {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      answers.set(author, { promise, resolve });
    }
    return answers.get(author);
  };
  return {
    asked,
    query: (filter) => {
      asked.push(filter);
      return slot(filter.authors[0]).promise.then((events) => events.filter((event) => filter.kinds.includes(event.kind)));
    },
    send: (author, events) => slot(author).resolve(events),
  };
}

/** The resolver on the page, and a count of the signatures it has checked. */
function withLook(t) {
  globalThis.E1Look = require(LOOK_JS);
  const verify = globalThis.E1Schnorr.verifyEvent;
  const seen = { verified: 0 };
  globalThis.E1Schnorr.verifyEvent = async (event) => {
    try {
      return await verify(event);
    } finally {
      seen.verified += 1;
    }
  };
  t.after(() => {
    delete globalThis.E1Look;
    globalThis.E1Schnorr.verifyEvent = verify;
  });
  return seen;
}

const startSolo = (byId) => {
  byId("npcB").checked = true;
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = ZAP_SEED;
  byId("start").click();
};

/* The NPC keeps moving on a timer, and play.js finds `document` at call time:
   a solo game left running paints its seats into whichever test runs next. So
   every solo game here ends with a rugpull and the way back to setup, which
   clears the bot's timers and the table's state. */
test("an NPC game dresses the signed-in player's seat in their kind 0 look, and its name stays text", async (t) => {
  withLook(t);
  const relays = lookRelays();
  const stub = netStub();
  Object.assign(stub.nostr, { savedPubkey: () => MY_KEY, query: relays.query, shortNpub: () => "npub1mine…" });
  const { byId, game } = loadPlay(stub);

  const menu = byId("avatarA");
  assert.equal(menu.children[0].textContent, "My Nappelin look");
  assert.equal(menu.value, menu.children[0].value, "with an identity the look is the default");
  assert.equal(byId("avatarB").children[0].textContent, "No Avatar - just my name", "seat two is offered nobody's look");

  startSolo(byId);
  assert.ok(game.state, "the game starts without waiting for a relay");
  assert.equal(byId("youName").textContent, "Player 1", "the typed name paints first");
  assert.equal(portraitOf(byId("youBar")), null, "and no picture is waited for");

  const markup = "<img src=x onerror=alert(1)>FLX";
  const youNames = recordText(byId("youName"));
  relays.send(MY_KEY, [kindZero(MINE, { display_name: markup, name: "flx", picture: "https://example.com/flx.png" })]);
  await waitFor(() => youNames.includes(markup), "the landed look to repaint the seat by itself");
  byId("cancelTarget").click(); // and read the whole board in one synchronous turn
  assert.equal(byId("youName").textContent, markup);
  assert.equal(byId("youName").innerHTML, "", "the name never reached an HTML parser");
  const portrait = portraitOf(byId("youBar"));
  assert.equal(portrait.getAttribute("src"), "https://example.com/flx.png");
  assert.equal(portrait.dataset.look, "picture");
  assert.equal(portrait.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(portrait.getAttribute("alt"), `${markup} avatar`);
  const chip = byId("turnchip").children.map((part) => (typeof part === "string" ? part : part.textContent)).join("");
  assert.match(chip, /Player 1/, "the turn chip and the log keep the name the seat plays under");

  assert.equal(byId("foeName").textContent, "NPC");
  assert.equal(portraitOf(byId("foeBar")), null, "the NPC wears nobody's look");
  byId("continue").click();
  byId("continue").click();
  assert.equal(relays.asked.length, 2, "two filters, asked once for the page, not once per render");
  leaveSolo(byId, game);
});

test("the avatar the player picks wins over their look", async (t) => {
  const seen = withLook(t);
  const relays = lookRelays();
  const stub = netStub();
  Object.assign(stub.nostr, { savedPubkey: () => MY_KEY, query: relays.query });
  const { byId, game } = loadPlay(stub);
  relays.send(MY_KEY, [kindZero(MINE, { display_name: "FLX", picture: "https://example.com/flx.png" })]);

  const menu = byId("avatarA");
  const pick = menu.children.find((option) => option.textContent === "Rootzoll");
  menu.value = pick.value;
  fire(menu, "change");
  startSolo(byId);
  await waitFor(() => seen.verified > 0, "the look to be checked");
  await ticks();
  game.dispatch("PASS_PRIORITY", 0); // a render of this table, after the look has landed

  assert.equal(byId("youName").textContent, "Player 1", "a picked avatar keeps the typed name too");
  const portrait = portraitOf(byId("youBar"));
  assert.ok(portrait, "the picked character is on the bar");
  assert.match(String(portrait.src), /node-runner-web\/Rootzoll/, "as its card face, with no portraits.js here");
  assert.equal(portrait.getAttribute("src"), undefined, "the look's picture was never painted");
  assert.equal(portrait.dataset.look, "");
  leaveSolo(byId, game);
});

test("online, each seat wears the look of the key the referee gives it, and a late look stays off a seat that changed hands", async (t) => {
  const seen = withLook(t);
  const relays = lookRelays();
  const stub = netStub();
  /* No identity on this page: at a networked table the referee's STATE names
     every key, and nothing but each seat's own binding may repaint it. */
  Object.assign(stub.nostr, { savedPubkey: () => null, query: relays.query });
  const { byId } = loadPlay(stub);
  const painted = recordText(byId("foeName"));
  const youNames = recordText(byId("youName"));
  const deal = (foe) => {
    const E = globalThis.E1Engine;
    const full = E.createGame({
      seats: [{ name: "felix", affinity: "Power" }, { name: foe.name, affinity: "Signal" }],
      seeds: { public: 4242, hidden: [4243, 4244] },
      firstPlayer: 0,
    });
    stub.lastState = {
      ...STATE_BASE, seat: 0, role: "seat", status: "playing", view: E.view(full, 0),
      players: [
        { seat: 0, name: "felix", pubkey: MY_KEY, affinity: "Power", online: true },
        { seat: 1, name: foe.name, pubkey: foe.pubkey, affinity: "Signal", online: true },
      ],
    };
    stub.handlers.onState(stub.lastState);
  };

  deal({ name: "anna", pubkey: FOE_KEY });
  assert.equal(byId("foeName").textContent, "anna", "the seat's own name paints first");
  await ticks(0); // the query itself goes out a microtask after the render that wanted it
  assert.deepEqual(relays.asked.map((filter) => filter.authors[0]).filter((key, i, all) => all.indexOf(key) === i).sort(),
    [MY_KEY, FOE_KEY].sort(), "both seats' keys are asked for, from the referee's STATE");

  // A rematch against somebody else, before anna's relay has answered.
  deal({ name: "bob", pubkey: OTHER_KEY });
  assert.equal(byId("foeName").textContent, "bob");
  /* Counted by what this table paints: another test's table can still be
     finishing a timer, and it would never paint "bob". */
  const bobPaints = () => painted.filter((name) => name === "bob").length;
  const before = bobPaints();
  relays.send(FOE_KEY, [kindZero(FOE, { display_name: "Anna", picture: "https://example.com/anna.png" })]);
  await waitFor(() => seen.verified >= 1, "anna's late look to be checked");
  await ticks();
  assert.equal(bobPaints(), before, "anna's late look repainted a seat she no longer holds");
  assert.equal(painted.includes("Anna"), false);
  byId("cancelTarget").click(); // repaint THIS table, then read it in the same turn
  assert.equal(byId("foeName").textContent, "bob");
  assert.equal(portraitOf(byId("foeBar")), null);

  relays.send(OTHER_KEY, [kindZero(OTHER, { display_name: "Bob", picture: "https://example.com/bob.png" })]);
  relays.send(MY_KEY, [kindZero(MINE, { name: "flx" })]);
  await waitFor(() => painted.includes("Bob") && youNames.includes("flx"), "bob's and my looks to repaint our seats");
  byId("cancelTarget").click(); // then read the board in one synchronous turn
  assert.equal(byId("foeName").textContent, "Bob");
  assert.equal(portraitOf(byId("foeBar")).getAttribute("src"), "https://example.com/bob.png");
  assert.equal(byId("youName").textContent, "flx");
  assert.equal(portraitOf(byId("youBar")), null, "a look with no picture keeps the seat's default portrait");
});

test("inside the Hangar the look comes through the shell's outbox and resource NAP, and nothing else", async (t) => {
  withLook(t);
  const avatar = Buffer.concat([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64"),
    Buffer.from("member"),
  ]);
  const x = createHash("sha256").update(avatar).digest("hex");
  const blossom = `https://blossom.bimcvp.com/${x}`;
  const look = signed(MINE, {
    kind: 30077, created_at: 1789000100, content: "",
    tags: [["d", ""], ["imeta", "role avatar", `x ${x}`, "m image/png", `url ${blossom}.png`, "dim 1024x1024"]],
  });
  const queried = [];
  const requested = [];
  globalThis.E1Napplet = {
    present: true,
    has: (domain) => ["identity", "outbox", "resource", "storage"].includes(domain),
    embedded: () => true,
    escape: () => false,
    identity: { current: async () => MY_KEY, source: () => "shell" },
    outbox: {
      query: async (filters) => {
        queried.push(filters);
        return [{ event: look, sidecar: { relayHints: ["wss://relay.nappelin.com"] } }, { event: kindZero(MINE, { name: "flx" }) }];
      },
    },
    resource: {
      bytes: async (url) => {
        requested.push(url);
        return url === blossom ? new Blob([avatar]) : null;
      },
    },
    storage: { get: async () => null, set: async () => true, json: async (key, fallback) => fallback },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("a napplet opens no network of its own");
  t.after(() => {
    delete globalThis.E1Napplet;
    globalThis.fetch = realFetch;
  });
  const stub = netStub();
  Object.assign(stub.nostr, {
    savedPubkey: () => null, // the shell's key arrives through E1Napplet.identity, after the first paint
    query: () => assert.fail("inside the Hangar the relays are the shell's"),
  });
  const { byId, game } = loadPlay(stub);
  /* The menu is built once before the shell's key lands and once after; the
     stub DOM keeps old options on innerHTML = "", so look for the choice itself. */
  const offersLook = () => {
    const menu = byId("avatarA");
    const mine = menu.children.find((option) => option.textContent === "My Nappelin look");
    return Boolean(mine) && menu.value === mine.value;
  };
  await waitFor(offersLook, "the shell's key to offer the look");

  startSolo(byId);
  await waitFor(paintedNow(byId, () => {
    const portrait = portraitOf(byId("youBar"));
    return Boolean(portrait) && /^blob:/.test(portrait.getAttribute("src") || "");
  }), "the verified avatar on the seat");
  assert.equal(portraitOf(byId("youBar")).dataset.look, "avatar");
  assert.equal(byId("youName").textContent, "flx");
  assert.deepEqual(queried.map((filters) => filters.map((filter) => filter.kinds[0])), [[30077, 0]], "one query through the shell");
  assert.deepEqual(requested, [blossom], "the bytes by hash, from the Blossom host the Hangar grants the TCG");
  leaveSolo(byId, game);
});

// ------------------------------------------------------------- music cues

/* NAP-CUE (nappelin #107): inside a Hangar that routes cues, the table sends the
 * music its moments and moods. The adapter's wire and throttles are tested in
 * napplet.test.mjs; here `send` only records what play.js asked for. */
function cueHangar({ available = true } = {}) {
  const shell = hangar();
  const sent = [];
  const focus = [];
  return Object.assign(shell, {
    sent,
    focus,
    embedded: () => true,
    escape() {},
    link: { available: () => false, open: async () => ({ ok: false, error: "unavailable" }) },
    cue: {
      available: () => available,
      send(fields) { sent.push(fields.mood ? `mood:${fields.mood}` : `moment:${fields.moment}`); return Promise.resolve({ ok: true, accepted: true }); },
      onFocus(fn) { focus.push(fn); return () => {}; },
    },
  });
}

function fxRecorder() {
  const calls = [];
  return {
    calls,
    stub: {
      emit() {}, init() {}, get: () => ({ motionActive: "reduced" }),
      duckBed: (depth) => calls.push(["duckBed", depth]),
      unduckBed: () => calls.push(["unduckBed"]),
      holdPressure: (on) => calls.push(["holdPressure", on]),
    },
  };
}

/* A hotseat Fast table with one vanilla Avatar on seat one's side. */
function cueTable(t, shell, fx) {
  globalThis.E1_CARDS_FAST = require(FAST_DATA);
  globalThis.E1_PRECONS_FAST = require(FAST_PRECONS);
  opaqueStorage(t);
  globalThis.E1Napplet = shell;
  t.after(() => { delete globalThis.E1Napplet; });
  const loaded = loadPlay(netStub(), fx && fx.stub);
  const { byId, game } = loaded;
  byId("rules").value = "F1.0";
  byId("deckA").value = "precon:Power Surge";
  byId("deckB").value = "precon:Key Custody";
  byId("seed").value = "music";
  game.startGame();
  assert.ok(game.state, byId("prompt").textContent);
  const vanilla = globalThis.E1_CARDS_FAST.find((card) => card.type === "Avatar" && card.abilities.length === 0 && card.keywords.length === 0);
  const state = game.state;
  const uid = `o${state.nextUid++}`;
  state.objects[uid] = {
    uid, cardId: vanilla.id, owner: 0, controller: 0, zone: "0:network", committed: false,
    bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [0, 1], revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
  };
  state.zones["0:network"].push(uid);
  return { ...loaded, uid, vanilla };
}

/* Walks the active seat's turn to its end through the table's own dispatch, synchronously
 * (the table's auto-walk runs on a timer), discarding down to the hand limit on the way. */
function passTurn(byId, game) {
  const from = game.state.turn.active;
  for (let step = 0; step < 40 && game.state.turn.active === from && !game.state.result; step += 1) {
    const { awaiting, priority } = game.state;
    if (awaiting && awaiting.kind === "discard") {
      const hand = game.state.zones[`${awaiting.seat}:wallet`];
      game.dispatch("DISCARD_TO_LIMIT", awaiting.seat, { uids: hand.slice(0, hand.length - game.state.handLimit) });
    } else {
      assert.ok(!awaiting, `an unexpected decision: ${awaiting && awaiting.kind}`);
      game.dispatch("PASS_PRIORITY", priority.seat);
    }
  }
  assert.notEqual(game.state.turn.active, from, "the turn changed hands");
}

test("a scripted local game sends turn, attack, lethal, match-end and its moods in order, each once", (t) => {
  const shell = cueHangar();
  const { byId, game, uid, vanilla } = cueTable(t, shell);
  // The first hit leaves seat two at exactly the tension line.
  assert.ok(vanilla.action <= 6);
  game.state.seats[1].uptime = 6 + vanilla.action;
  byId("cancelTarget").click();
  assert.deepEqual(shell.sent, ["mood:calm"], "the first screen is calm, and the dealt table still is");

  assert.equal(game.dispatch("DECLARE_ATTACK", 0, { attacker: uid, target: { kind: "seat", seat: 1 } }), true);
  assert.deepEqual(shell.sent.slice(1), ["moment:attack", "mood:battle"]);
  for (let i = 0; i < 3; i += 1) byId("cancelTarget").click();
  assert.equal(shell.sent.length, 3, "a render that changes nothing sends nothing");

  passTurn(byId, game);
  assert.ok(game.state.seats[1].uptime <= 6, "seat two is low");
  assert.deepEqual(shell.sent.slice(3), ["moment:turn", "mood:tension"]);
  passTurn(byId, game);
  assert.deepEqual(shell.sent.slice(5), ["moment:turn"], "tension holds: the mood did not change");
  game.state.seats[1].uptime = vanilla.action; // the next hit is the last

  assert.equal(game.dispatch("DECLARE_ATTACK", 0, { attacker: uid, target: { kind: "seat", seat: 1 } }), true);
  assert.ok(game.state.result, "the second hit ends it");
  assert.deepEqual(shell.sent.slice(6), ["moment:attack", "moment:lethal", "moment:match-end", "mood:victory"], "hotseat hears victory");
  byId("cancelTarget").click();
  assert.equal(shell.sent.length, 10, "the ending is sent once");
  assert.ok(!shell.sent.includes("moment:booster-open"), "the napplet has no shop");

  leaveSolo(byId, game);
  assert.deepEqual(shell.sent.slice(10), ["mood:calm"], "leaving the table is calm");
});

test("a concession ends a hotseat table in victory, and without the feature nothing is sent at all", (t) => {
  const shell = cueHangar();
  const { byId, game } = cueTable(t, shell);
  game.dispatch("CONCEDE", 0, {});
  assert.deepEqual(shell.sent.slice(-2), ["moment:match-end", "mood:victory"], "hotseat: whoever conceded, the screen hears victory");
  leaveSolo(byId, game);

  const off = cueHangar({ available: false });
  const table = cueTable(t, off);
  table.game.dispatch("DECLARE_ATTACK", 0, { attacker: table.uid, target: { kind: "seat", seat: 1 } });
  leaveSolo(table.byId, table.game);
  assert.deepEqual(off.sent, [], "no feature, no cue");
});

test("shell music playing ducks the bed and holds the pressure pulse; idle gives both back", (t) => {
  const shell = cueHangar();
  const fx = fxRecorder();
  const { byId, game } = cueTable(t, shell, fx);
  assert.equal(shell.focus.length, 1, "one focus subscription");
  const [focus] = shell.focus;
  focus("playing");
  focus("playing");
  assert.deepEqual(fx.calls, [["duckBed", 0.35], ["holdPressure", true]], "on change only");
  focus("idle");
  assert.deepEqual(fx.calls.slice(2), [["unduckBed"], ["holdPressure", false]]);
  leaveSolo(byId, game);
});

test("a seat that loses at a referee's table hears defeat, and a finished match seen first is not re-announced", (t) => {
  const shell = cueHangar();
  opaqueStorage(t);
  globalThis.E1Napplet = shell;
  t.after(() => { delete globalThis.E1Napplet; });
  const stub = netStub();
  const { byId } = loadPlay(stub);
  const E = globalThis.E1Engine;
  const view = E.view(clientGame(990123), 1);
  stub.handlers.onState({ ...STATE_BASE, seat: 1, role: "seat", status: "playing", claimable: false, view });
  assert.deepEqual(shell.sent, ["mood:calm"]);
  const over = structuredClone(view);
  over.result = { winners: [0], losers: [1], reason: "concede" };
  stub.handlers.onFrame({ view: over, events: [{ t: "GAME_OVER", winners: [0], reason: "concede" }] });
  assert.deepEqual(shell.sent.slice(1), ["moment:match-end", "mood:defeat"]);
  byId("leaveTable").click();
  assert.deepEqual(shell.sent.slice(3), ["mood:calm"], "leaving the table is calm");

  const reloaded = structuredClone(over);
  reloaded.gameId = "g_reloaded";
  stub.handlers.onState({ ...STATE_BASE, seat: 1, role: "seat", status: "over", claimable: false, view: reloaded, result: over.result });
  assert.deepEqual(shell.sent.slice(4), ["mood:defeat"], "the mood, but no second match-end");
  byId("leaveTable").click();
});

test("a draw is calm for every seat: nobody lost, and calm hands the music back", (t) => {
  const shell = cueHangar();
  opaqueStorage(t);
  globalThis.E1Napplet = shell;
  t.after(() => { delete globalThis.E1Napplet; });
  const stub = netStub();
  const { byId } = loadPlay(stub);
  const view = globalThis.E1Engine.view(clientGame(990456), 1);
  view.seats[0].uptime = 3; // tension first, so the draw has a mood to change
  stub.handlers.onState({ ...STATE_BASE, seat: 1, role: "seat", status: "playing", claimable: false, view });
  assert.deepEqual(shell.sent, ["mood:calm", "mood:tension"]);
  const over = structuredClone(view);
  over.result = { winners: [], losers: [0, 1], reason: "draw" };
  stub.handlers.onFrame({ view: over, events: [{ t: "GAME_OVER", winners: [], reason: "draw" }] });
  assert.deepEqual(shell.sent.slice(2), ["moment:match-end", "mood:calm"], "not defeat, and not victory");
  byId("leaveTable").click();
  assert.equal(shell.sent.length, 4, "leaving a drawn table is already calm");
});
