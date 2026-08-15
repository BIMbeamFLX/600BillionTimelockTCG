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
  globalThis.location = env.location;
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
    this.send = () => {};
    this.close = () => {};
  };
  delete globalThis.E1Net;
  new Function(NET_JS)();
  return { net: globalThis.E1Net, opened, store, session };
}

const FILE_ENV = {
  location: { protocol: "file:", host: "", href: "file:///C:/x/site/play.html", search: "" },
  failOnSocket: true,
};
const HTTP_ENV = {
  location: { protocol: "http:", host: "bitbeam:8777", href: "http://bitbeam:8777/play.html", search: "" },
};

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
  net.create({ name: "felix", affinity: "Power", pubkey: null });
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

  const warm = loadNet({ ...HTTP_ENV, storage: { "600b:match": JSON.stringify(saved) } });
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
  const shared = new Map();
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
  const warm = loadNet({ ...HTTP_ENV, storage: { "600b:match": JSON.stringify(legacy) } });
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
  const invite = (body) => ({ id: "e1", pubkey: hex, kind: 4600, created_at: 1, content: JSON.stringify(body) });
  const ok = { v: 1, kind: "invite", matchId: "m_0123456789ab", code: "K7M2QF", table: "ws://host:8777/ws" };

  assert.ok(net.nostr.parseInvite(invite(ok)), "a well-formed invite parses");
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
  const node = {
    id, hidden: false, textContent: "", value: "", className: "", innerHTML: "",
    disabled: false, dataset: {}, children: [], style: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    closest: () => null,
    querySelectorAll: () => [],
    remove() {},
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
  };
  return node;
}

/* Loads play.js against a stub DOM and returns handles to poke at it. The
 * DOMContentLoaded listener is fired by hand, which is what runs initNet(). */
function loadPlay(netStub) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubElement(id));
    return nodes.get(id);
  };
  const fired = {};
  globalThis.document = {
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
  new Function(PLAY_JS)();
  for (const fn of fired.DOMContentLoaded || []) fn();
  return { byId, game: globalThis.window.E1_GAME || globalThis.E1_GAME };
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
    act() { return true; },
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

test("the host's share link offers a Join, not the host panel", () => {
  const stub = netStub();
  const { byId } = loadPlay(stub);

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
  const g = loadPlay(guest);
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
});

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

test("a player is a clickable target: Zap resolves at the opponent's face", () => {
  const { byId, game } = loadPlay(netStub());

  /* Seed 70's Power opening hand holds Zap ("any target") and Power Plant —
   * Hydro. Before the playerbar became a target surface, an "any" pick could
   * only land on an Avatar node: an empty enemy Network left NOTHING
   * clickable and the play was stuck at "Cancel targeting". */
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = "70";
  byId("start").click();
  assert.ok(game.state, "the hotseat game must start");

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
  assert.equal(game.state.seats[1].uptime, 17, "Zap's 3 damage lands on the chosen player");

  /* The console verify() must replay this hotseat: it needs the createGame
   * config, which the table now keeps. Before, it passed config:null and
   * every hotseat verify died of SCHEMA before replaying a single action. */
  const verdict = game.verify();
  assert.equal(verdict.ok, true, JSON.stringify(verdict.error));
  assert.equal(verdict.divergedAt, null, "a self-played transcript must not diverge");
});

test("player names are rendered as text in the turn HUD", () => {
  const { byId, game } = loadPlay(netStub());
  const payload = '<img src=x onerror="globalThis.pwned=true">';
  byId("nameA").value = payload;
  byId("nameB").value = "Opponent";
  byId("deckA").value = "Power";
  byId("deckB").value = "Signal";
  byId("seed").value = "70";

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
