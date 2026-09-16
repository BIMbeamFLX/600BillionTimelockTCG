/* site/lobby.js — the online lobby, mounted the way its two pages mount it.
 *
 * matchmaking.html's own behaviour is held by tests/js/client.test.mjs (loadLobby).
 * These tests are about what the lobby does inside the Hangar, where the page is
 * the table: no sign-in button, the shell's identity, no stakes, the launch code,
 * the table list's reasons, the invites, and "My collection". A stub DOM in the
 * shape client.test.mjs uses: getElementById hands every id its own node, and a
 * test reads what the lobby wrote there.
 *
 * Run: node --test tests/js/lobby.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, "..", "..", "site");
const LOBBY_JS = fs.readFileSync(path.join(SITE, "lobby.js"), "utf8");
const KEY = "b".repeat(64);
const WORDS = {
  noIdentity: "Sign in to Nappelin to play online. Hotseat and games against the computer work now.",
  stakes: "This table plays for sats; stakes are not available in Nappelin yet.",
  unreachable: "The table server cannot be reached right now. Hotseat and games against the computer work now.",
  invites: "Invites cannot be listed here right now. You can still join with a table code.",
  otherRules: "That table plays other rules. Pick Ready for a starter Stack, then join again.",
  signInForTables: "Sign in first to see open tables.",
};

/* client.test.mjs's stub element, which play.js runs in too. */
function stubElement(id) {
  const style = {
    setProperty(name, value) { this[name] = String(value); },
    getPropertyValue(name) { return this[name] || ""; },
  };
  const node = {
    id, hidden: false, textContent: "", value: "", className: "", innerHTML: "", disabled: false,
    checked: false, dataset: {}, children: [], style, listeners: {}, attributes: {},
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
    prepend(kid) { this.children.unshift(kid); },
    closest: () => null,
    querySelectorAll: () => [],
    focus() {},
    remove() {
      if (!this._parent) return;
      this._parent.children = this._parent.children.filter((child) => child !== this);
      this._parent = null;
    },
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
    fire(type) { for (const fn of this.listeners[type] || []) fn({}); },
  };
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

/* The words a node shows, its own and its children's, the way a reader sees a row. */
const said = (node) => [node.textContent, ...node.children.map((child) => (typeof child === "string" ? child : said(child)))].join(" ").trim();
const lastRow = (node) => node.children.at(-1);
const buttonsOf = (row) => row.children.filter((child) => child && child.listeners && child.listeners.click);

/* A transport stub: what the lobby asks for, and the handlers it hands over. */
function netStub(extra) {
  const calls = [];
  const stub = {
    status: "idle", lastState: null, session: null, queued: null, active: [], handlers: null,
    start(handlers) { stub.handlers = handlers; calls.push(["start"]); return { resuming: false }; },
    create(o) { calls.push(["create", o]); return true; },
    join(o) { calls.push(["join", o]); return true; },
    queue(o) { calls.push(["queue", o]); stub.queued = { position: 1, waiting: 1 }; return true; },
    unqueue() { calls.push(["unqueue"]); stub.queued = null; return true; },
    rejoin(id) { calls.push(["rejoin", id]); return true; },
    tables: async () => { calls.push(["tables"]); return []; },
    tableUrl: () => "wss://tcg.nappelin.com/ws",
    publicTable: () => "wss://tcg.nappelin.com/ws",
    publicTableIsLocal: () => false,
    sendNostr(role, event) { calls.push(["nostr", role, event]); return true; },
    nostr: {
      savedPubkey: () => KEY,
      shortNpub: () => "npub1bbbb…bbbbb",
      toHexPubkey: (value) => (/^[0-9a-f]{64}$/.test(value) ? value : null),
      subscribeInvites: () => () => {},
      inviteEvent: (o) => ({ kind: 4600, tags: [], content: JSON.stringify(o) }),
      sign: async (event) => Object.assign({ id: "e".repeat(64), sig: "s".repeat(128), pubkey: KEY }, event),
      publish: async () => ({ ok: true, accepted: ["shell"], tried: 1 }),
      login: async () => KEY,
      logout() {},
    },
    calls,
  };
  return Object.assign(stub, extra || {});
}
const called = (net, name) => net.calls.filter((call) => call[0] === name);

/* Just enough of the Hangar's adapter for the lobby: embedded, a key that answers
 * when the test says so, and storage that holds no saved Stacks. */
function hangar({ key = KEY } = {}) {
  let answer;
  const answered = new Promise((resolve) => { answer = resolve; });
  return {
    present: true,
    embedded: () => true,
    has: (domain) => ["identity", "outbox", "storage"].includes(domain),
    identity: { current: () => answered },
    storage: { json: async (name, fallback) => fallback },
    land: () => answer(key || null),
  };
}

/* Mounts a fresh lobby into a fresh stub document. */
function mountLobby(net, hooks, { napplet = null } = {}) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubElement(id));
    return nodes.get(id);
  };
  const fired = {};
  globalThis.document = {
    getElementById: byId,
    createElement: (tag) => stubElement(tag),
    createTextNode: (text) => text,
  };
  globalThis.window = { addEventListener(type, fn) { (fired[type] = fired[type] || []).push(fn); } };
  if (napplet) globalThis.E1Napplet = napplet; else delete globalThis.E1Napplet;
  delete globalThis.E1Lobby;
  new Function(LOBBY_JS)();
  const root = byId("lobby");
  const lobby = globalThis.E1Lobby.mount(root, net, hooks);
  return { lobby, byId, root, fired };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the lobby's own words are the ones this file checks", () => {
  mountLobby(netStub(), {}, { napplet: hangar() });
  assert.deepEqual({ ...globalThis.E1Lobby.WORDS }, WORDS);
});

test("inside the Hangar there is no sign-in button, and without the shell's key the lobby says so in one line", async () => {
  const net = netStub();
  net.nostr.savedPubkey = () => null;
  const shell = hangar({ key: null });
  const { root, byId, fired } = mountLobby(net, {}, { napplet: shell });

  assert.doesNotMatch(root.innerHTML, /nostrLogin|nostrLogout|Sign in with|NIP-07|stakeSats|Copy join link|localnote/, "none of the website's doors are drawn");
  assert.equal(byId("nostrLogin").listeners.click, undefined, "and nothing is wired to one");
  assert.equal(fired["e1:identity"], undefined, "nor to the website's side bar");
  assert.equal(byId("lobbyIdentity").hidden, false);
  assert.equal(byId("lobbyIdentity").textContent, WORDS.noIdentity);
  for (const id of ["createTable", "joinTable", "findMatch"]) {
    assert.equal(byId(id).disabled, true, `${id} waits for an identity`);
  }
  for (const id of ["refreshTables", "checkInvites"]) {
    assert.equal(byId(id).disabled, false, `${id} stays pressable, and answers in its list`);
  }
  byId("refreshTables").click();
  await settle();
  assert.equal(said(lastRow(byId("tableList"))), WORDS.signInForTables, "open tables, signed out: sign in first");
  byId("createTable").click();
  assert.equal(byId("netNotice").textContent, WORDS.noIdentity, "an action tried anyway gets the same line");
  byId("checkInvites").click();
  assert.equal(said(lastRow(byId("inviteList"))), WORDS.noIdentity);
  assert.deepEqual(net.calls.filter(([name]) => name !== "start"), [], "and the table is asked for nothing");
  shell.land();
  await settle();
  assert.equal(byId("lobbyIdentity").textContent, WORDS.noIdentity, "a shell that answers with nobody changes nothing");

  /* Inside the Hangar a reload is the identity change: the next frame reads the key signed in now. */
  const member = netStub();
  member.nostr.savedPubkey = () => null; // net.js has not heard the shell's answer yet
  const signedIn = hangar();
  const next = mountLobby(member, {}, { napplet: signedIn });
  assert.equal(next.byId("lobbyIdentity").hidden, false, "the first paint cannot know yet");
  signedIn.land();
  await settle();
  assert.equal(next.byId("lobbyIdentity").hidden, true, "the shell's key, once it answers, is the identity");
  assert.equal(next.byId("createTable").disabled, false);
  next.byId("createTable").click();
  assert.equal(called(member, "create")[0][1].pubkey, KEY, "and it is the key the table is asked to seat");
});

test("inside the Hangar: create, join by code, and the quick match with its Stop — every one for no stake", () => {
  const net = netStub();
  const { byId, root } = mountLobby(net, {}, { napplet: hangar() });
  assert.deepEqual(net.calls[0], ["start"], "the lobby starts the transport unless the page does");
  assert.doesNotMatch(root.innerHTML, /stakeSats|stakenote|Play for/, "no stake field");

  byId("netName").value = "felix";
  byId("netAffinity").value = "Signal";
  byId("netRules").value = "F1.0";
  byId("createTable").click();
  assert.deepEqual(net.calls.at(-1), ["create", { name: "felix", affinity: "Signal", ruleset: "F1.0", pubkey: KEY, stake: 0, deck: undefined }]);
  assert.equal(byId("netNotice").textContent, "Opening a table…");

  byId("joinCode").value = "k7m2qo";
  byId("joinTable").click();
  assert.equal(byId("netNotice").textContent, "A table code is six characters, no 0/O/1/I.", "a code that cannot exist is refused here");
  assert.equal(called(net, "join").length, 0);
  byId("joinCode").value = " k7m2qf ";
  byId("joinTable").click();
  const [, join] = called(net, "join")[0];
  assert.deepEqual([join.code, join.stake, join.pubkey, join.table, join.ruleset], ["K7M2QF", 0, KEY, undefined, undefined], "an explicit 0, never undefined");

  byId("findMatch").click();
  assert.deepEqual(net.calls.at(-1), ["queue", { name: "felix", affinity: "Signal", ruleset: "F1.0", pubkey: KEY, stake: 0, deck: undefined }]);
  assert.equal(byId("netNotice").textContent, "Looking for an opponent…");
  assert.deepEqual([byId("findMatch").hidden, byId("cancelFind").hidden, byId("queueChip").hidden], [true, false, false]);
  assert.equal(byId("queueChip").textContent, "searching · you are first in line");
  net.queued = { position: 2, waiting: 3 };
  net.handlers.onQueued({ queued: true, position: 2, waiting: 3 });
  assert.equal(byId("queueChip").textContent, "searching · 2 of 3 waiting");
  byId("cancelFind").click();
  assert.deepEqual(net.calls.at(-1), ["unqueue"]);
  assert.deepEqual([byId("findMatch").hidden, byId("cancelFind").hidden, byId("queueChip").hidden], [false, true, true]);
  assert.equal(byId("netNotice").textContent, "Stopped looking.");

  net.handlers.onError({ code: "STAKE_MISMATCH", message: "this table plays for 2100 sats" });
  assert.equal(byId("netNotice").textContent, WORDS.stakes, "a staked table's refusal, in plain words");
  assert.match(byId("netNotice").className, /bad/);
});

test("an open table keeps the lobby and shows its code; a dealt seat hands the page the board", () => {
  const net = netStub();
  const seen = { lobby: [], seat: [] };
  const hooks = { start: false, onLobby: (msg) => seen.lobby.push(msg), onSeat: (msg, invite) => seen.seat.push([msg, invite]) };
  const { lobby, byId } = mountLobby(net, hooks, { napplet: hangar() });
  assert.deepEqual(net.calls, [], "a page that routes the referee's messages starts the transport itself");

  const open = { t: "STATE", matchId: "m_0123456789ab", code: "K7M2QF", seat: 0, role: "seat", status: "open", downgraded: false, stake: 0 };
  net.lastState = open;
  lobby.handlers.onState(open);
  assert.equal(byId("hostPanel").hidden, false);
  assert.equal(byId("tableCode").textContent, "K7M2QF");
  assert.equal(byId("netNotice").textContent, "Table open. Read the code aloud, or send an invite.", "no link to send: the shell owns the address");
  assert.equal(byId("joinTable").disabled, true, "a host cannot join its own table");
  assert.deepEqual(seen.lobby, [open], "the page brings the lobby into view");

  const playing = { ...open, status: "playing", view: { seq: 0 } };
  lobby.handlers.onState(playing);
  assert.deepEqual(seen.seat, [[playing, null]], "the page shows the board");
  assert.equal(byId("hostPanel").hidden, true, "and a lobby shown again later has no stale code in it");
});

test("the open tables say why they could not be listed, for every code a list is refused with", async () => {
  const net = netStub();
  const { byId } = mountLobby(net, {}, { napplet: hangar() });
  const reasons = {
    NIP07_REQUIRED: WORDS.noIdentity,
    AUTH_FAILED: "The table could not confirm your Nappelin sign-in. Try again in a moment.",
    IDENTITY_MISMATCH: "This seat belongs to a different Nappelin account.",
    RATE_LIMITED: "Too many requests too quickly. Wait a few seconds, then try again.",
    NO_TABLE: WORDS.unreachable,
    TABLE_REFUSED: WORDS.unreachable,
    TABLE_CLOSED: WORDS.unreachable,
    TIMEOUT: WORDS.unreachable,
    BAD_MESSAGE: "This table server cannot list open tables. Join with a table code instead.",
  };
  for (const [code, words] of Object.entries(reasons)) {
    net.tables = async () => { throw Object.assign(new Error(`refused: ${code}`), { code }); };
    byId("refreshTables").click();
    await settle();
    assert.equal(said(lastRow(byId("tableList"))), words, code);
  }
  net.tables = async () => { throw new Error("no code at all"); };
  byId("refreshTables").click();
  await settle();
  assert.equal(said(lastRow(byId("tableList"))), WORDS.unreachable, "an error without a code is the table server out of reach");

  net.tables = async () => [
    { code: "K7M2QF", name: "anna", affinity: "Signal", stake: 0, hostOnline: true },
    { code: "Q2W3E4", name: "bob", affinity: "Power", stake: 2100, hostOnline: false },
  ];
  byId("refreshTables").click();
  await settle();
  const [friendly, staked] = byId("tableList").children.slice(-2);
  assert.equal(said(friendly), "K7M2QF · anna · Signal Join");
  assert.equal(said(staked), "Q2W3E4 · bob · Power · plays for sats · host away", "a table for sats is listed, and its number is not shown");
  assert.equal(buttonsOf(staked).length, 0, "and it is not offered");
  buttonsOf(friendly)[0].click();
  const [, join] = called(net, "join")[0];
  assert.deepEqual([join.code, join.stake], ["K7M2QF", 0]);

  net.tables = async () => [];
  byId("refreshTables").click();
  await settle();
  assert.equal(said(lastRow(byId("tableList"))), "No open tables.");
});

test("a host's own table is offered back, never joined, and a refused join says why in plain words", async () => {
  for (const napplet of [hangar(), null]) {
    const net = netStub();
    const { byId } = mountLobby(net, {}, { napplet });
    const where = napplet ? "Hangar" : "website";
    net.tables = async () => [
      { matchId: "m_0123456789ab", code: "K7M2QF", name: "felix", pubkey: KEY, affinity: "Power", stake: 0, ruleset: "E1.0", hostOnline: false },
      { matchId: "m_ba9876543210", code: "Q2W3E4", name: "anna", pubkey: "c".repeat(64), affinity: "Signal", stake: 0, ruleset: "E1.0", hostOnline: false },
    ];
    byId("refreshTables").click();
    await settle();
    const [mine, theirs] = byId("tableList").children.slice(-2);
    assert.equal(said(mine), "K7M2QF · felix · Power · your table Rejoin", `${where}: the host's own row after a reload`);
    assert.equal(said(theirs), "Q2W3E4 · anna · Signal · host away Join");
    buttonsOf(mine)[0].click();
    assert.deepEqual(called(net, "rejoin"), [["rejoin", "m_0123456789ab"]], `${where}: taken back by its match id`);
    assert.deepEqual(called(net, "join"), [], "never joined");
    assert.equal(byId("netNotice").textContent, "Taking your seat…");

    net.handlers.onError({ code: "OWN_TABLE", message: "that is your own table" });
    assert.equal(byId("netNotice").textContent, "That is your own table.", `${where}: not "both seats are taken"`);
    net.handlers.onError({ code: "HOST_AWAY", message: "the host of that table is away" });
    assert.equal(byId("netNotice").textContent, "The host of that table is away right now. Try again when they are back.");
  }
});

test("on the website the list keeps its own words and its stakes", async () => {
  const net = netStub();
  const { byId, root } = mountLobby(net, {}, {});
  assert.match(root.innerHTML, /id="stakeSats"/, "the website still plays for sats");
  net.tables = async () => { throw new Error("HTTP 502"); };
  byId("refreshTables").click();
  await settle();
  assert.equal(said(lastRow(byId("tableList"))), "Could not reach the table's /api/tables — is the referee running?");
  net.tables = async () => [{ code: "Q2W3E4", name: "bob", affinity: "Power", stake: 2100, hostOnline: true }];
  byId("refreshTables").click();
  await settle();
  const row = lastRow(byId("tableList"));
  assert.equal(said(row), "Q2W3E4 · bob · Power · 2,100 sats Join for 2100 sats");
  buttonsOf(row)[0].click();
  assert.equal(called(net, "join")[0][1].stake, 2100, "the website echoes the stake it showed");
});

test("invites arrive verified through net.js; inside the Hangar one for sats is listed not offered, and a shell without them says so", () => {
  const net = netStub();
  let offer;
  net.nostr.subscribeInvites = (pubkey, onInvite) => {
    assert.equal(pubkey, KEY);
    offer = onInvite;
    return () => {};
  };
  const { byId } = mountLobby(net, {}, { napplet: hangar() });
  byId("checkInvites").click();
  assert.equal(said(lastRow(byId("inviteList"))), "Listening for invites…");
  offer({ id: "i1", code: "K7M2QF", table: "wss://tcg.nappelin.com/ws", pubkey: "c".repeat(64), host: { name: "anna", affinity: "Signal" }, stake: 0, ruleset: "F1.0" });
  offer({ id: "i2", code: "Q2W3E4", table: "wss://tcg.nappelin.com/ws", pubkey: "d".repeat(64), host: { name: "bob", affinity: "Power" }, stake: 500, ruleset: "E1.0" });
  const [friendly, staked] = byId("inviteList").children.slice(-2);
  assert.equal(said(friendly), "K7M2QF · anna (Signal) · npub1bbbb…bbbbb Join");
  assert.equal(said(staked), "Q2W3E4 · bob (Power) · npub1bbbb…bbbbb · plays for sats");
  assert.equal(buttonsOf(staked).length, 0);
  buttonsOf(friendly)[0].click();
  const [, join] = called(net, "join")[0];
  assert.deepEqual([join.code, join.stake, join.table], ["K7M2QF", 0, "wss://tcg.nappelin.com/ws"], "the invite's own table, for no stake");

  net.nostr.subscribeInvites = () => {
    net.handlers.onError({ code: "INVITES_UNAVAILABLE", message: "this shell offers no relay subscription, so no invites are listed" });
    return () => {};
  };
  byId("checkInvites").click();
  assert.equal(said(lastRow(byId("inviteList"))), WORDS.invites, "one line, in the list it would have filled");
  assert.notEqual(byId("netNotice").textContent, WORDS.invites, "not a red notice over the whole lobby");
});

test("an invite is sent through the shell, which signs it, and the table records it", async () => {
  const net = netStub();
  const { byId } = mountLobby(net, {}, { napplet: hangar() });
  net.lastState = { matchId: "m_0123456789ab", code: "K7M2QF", seat: 0, status: "open", ruleset: "F1.0", catalogDigest: "sha256:x", stake: 0 };
  byId("challengeNpub").value = "c".repeat(64);
  byId("publishInvite").click();
  await settle();
  const [, role, event] = called(net, "nostr")[0];
  assert.equal(role, "invite");
  assert.equal(event.pubkey, KEY, "signed by the shell's key");
  assert.deepEqual(JSON.parse(event.content).to, "c".repeat(64));
  assert.equal(byId("netNotice").textContent, "Invite sent.");
});

test("the code the frame was launched with fills Join once, and nothing is joined by itself", () => {
  const reads = [];
  const net = netStub({ launchCode: () => { reads.push(1); return reads.length === 1 ? "K7M2QF" : null; } });
  const { byId, lobby } = mountLobby(net, {}, { napplet: hangar() });
  assert.equal(byId("joinCode").value, "K7M2QF");
  assert.equal(lobby.launchCode, "K7M2QF", "the page is told, so it can open the online lobby");
  assert.equal(reads.length, 1, "read once, at mount");
  assert.deepEqual(called(net, "join"), [], "prefilled, never joined");
  lobby.refresh();
  lobby.open();
  assert.equal(reads.length, 1, "not read again");
});

test("My collection is offered once the member holds cards, and a table is opened and joined with that Stack under its rules", () => {
  const net = netStub();
  let cards = 0;
  const stacks = [];
  const hooks = {
    collection: () => ({ cards }),
    stack: (ruleset) => {
      stacks.push(ruleset);
      return cards ? { ids: Array.from({ length: 40 }, (_, i) => `${ruleset}:${i}`), fromCollection: 12, filled: 28 } : { ids: [], fromCollection: 0 };
    },
  };
  const { byId, root, lobby } = mountLobby(net, hooks, { napplet: hangar() });
  assert.match(root.innerHTML, /id="deckCollection"/);
  assert.equal(byId("deckCollectionRow").hidden, true, "nothing to offer yet");

  cards = 12;
  lobby.refresh();
  assert.equal(byId("deckCollectionRow").hidden, false);
  assert.equal(byId("deckCollectionLabel").textContent, "12 of 40 cards yours");

  byId("deckReady").checked = false;
  byId("deckCollection").checked = true;
  byId("netRules").value = "F1.0";
  byId("deckCollection").fire("change");
  byId("createTable").click();
  const [, create] = called(net, "create")[0];
  assert.equal(create.ruleset, "F1.0");
  assert.equal(create.deck.length, 40);
  assert.equal(create.deck[0], "F1.0:0", "built under the rules of the table it opens");

  byId("joinCode").value = "K7M2QF";
  byId("netRules").value = "E1.0";
  byId("joinTable").click();
  assert.equal(called(net, "join")[0][1].deck[0], "E1.0:0", "a bare code has no rules to read, so the lobby's choice stands in");
  let offer;
  net.nostr.subscribeInvites = (pubkey, onInvite) => { offer = onInvite; return () => {}; };
  byId("checkInvites").click();
  offer({ id: "i", code: "Q2W3E4", table: "wss://tcg.nappelin.com/ws", pubkey: "c".repeat(64), host: { name: "anna" }, stake: 0, ruleset: "F1.0" });
  buttonsOf(lastRow(byId("inviteList")))[0].click();
  assert.equal(called(net, "join")[1][1].deck[0], "F1.0:0", "an invite names the host's rules, and the Stack follows them");

  cards = 0;
  lobby.refresh();
  assert.equal(byId("deckCollectionRow").hidden, true);
  assert.deepEqual([byId("deckCollection").checked, byId("deckReady").checked], [false, true], "a choice whose cards are gone falls back to Ready");
  const website = mountLobby(netStub(), {}, {});
  assert.doesNotMatch(website.root.innerHTML, /deckCollection/, "a page that cannot build the Stack does not offer it");
});

test("a joining Stack is built under its table's rules: from the list, by a listed code, and a bare code the table refuses", async () => {
  const net = netStub();
  const hooks = {
    collection: () => ({ cards: 12 }),
    stack: (ruleset) => ({ ids: Array.from({ length: 40 }, (_, i) => `${ruleset}:${i}`), fromCollection: 12, filled: 28 }),
  };
  const { byId } = mountLobby(net, hooks, { napplet: hangar() });
  byId("deckReady").checked = false;
  byId("deckCollection").checked = true;
  byId("netRules").value = "E1.0";
  byId("deckCollection").fire("change");

  net.tables = async () => [
    { code: "K7M2QF", name: "anna", affinity: "Signal", stake: 0, ruleset: "F1.0", hostOnline: true },
    { code: "Q2W3E4", name: "bob", affinity: "Power", stake: 0, ruleset: "E1.0", hostOnline: true },
  ];
  byId("refreshTables").click();
  await settle();
  const [fast] = byId("tableList").children.slice(-2);
  buttonsOf(fast)[0].click();
  assert.equal(called(net, "join")[0][1].deck[0], "F1.0:0", "the row's rules, not the lobby's Classic");

  byId("joinCode").value = "k7m2qf";
  byId("joinTable").click();
  assert.equal(called(net, "join")[1][1].deck[0], "F1.0:0", "a typed code that is listed finds its row");

  byId("joinCode").value = "Z9Y8X7";
  byId("joinTable").click();
  assert.equal(called(net, "join")[2][1].deck[0], "E1.0:0", "a bare code with no row keeps the lobby's rules");
  net.handlers.onError({ code: "BAD_DECK", message: "Timelock Channel — Midnight appears 5 times; 4 is the limit (§7)", ruleset: "F1.0" });
  assert.equal(byId("netNotice").textContent, WORDS.otherRules, "a table that plays other rules says so in one line");
  assert.match(byId("netNotice").className, /bad/);

  net.handlers.onError({ code: "BAD_DECK", message: "Genesis Lotus appears 2 times; 1 is the limit (§7)", ruleset: "E1.0" });
  assert.equal(byId("netNotice").textContent, "Genesis Lotus appears 2 times; 1 is the limit (§7)",
    "under the rules the Stack was built for, the refusal is about the Stack");
  net.handlers.onError({ code: "BAD_DECK", message: "a Stack needs at least 40 cards (§7) — this one has 39" });
  assert.match(byId("netNotice").textContent, /at least 40 cards/, "and a refusal that names no rules keeps its own words");
});

// ------------------------------------------------------ the table page inside the Hangar

const PLAY_JS = fs.readFileSync(path.join(SITE, "play.js"), "utf8");
const E = require("../../site/engine.js");
const CARDS = require("../../site/play-data.js");
const FAST = require("../../site/play-data-fast.js");
const PRECONS = require("../../site/precons.js");
const PRECONS_FAST = require("../../site/precons-fast.js");
require("../../site/collection-stack.js");

/* A srcdoc sandbox: merely reading localStorage or sessionStorage throws. */
function sandboxStorage(t) {
  const denied = () => { throw new Error("SecurityError: storage is not available in an opaque origin"); };
  for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, name, { get: denied, configurable: true });
  t.after(() => {
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(globalThis, name, { value: undefined, writable: true, configurable: true });
    }
  });
}

/* The Hangar's adapter as the table page reads it. */
function tableHangar({ key = KEY, inventory = null, link = null, embedded = true } = {}) {
  const escaped = [];
  return {
    present: embedded,
    embedded: () => embedded,
    escape: () => { escaped.push(true); return true; },
    has: (domain) => embedded && ["identity", "storage", "intent", ...(link ? ["link"] : [])].includes(domain),
    identity: { current: async () => key || null, source: () => (key ? "shell" : "none") },
    storage: { json: async (name, fallback) => fallback, get: async () => null, set: async () => true },
    collection: {
      inventory: async () => inventory,
      counts: (answer) => new Map(answer.cards.map((card) => [card.asset_id, card.count])),
    },
    link: link || { available: () => false, open: async () => ({ ok: false, error: "unavailable" }) },
    escaped,
  };
}

/* The transport play.js and the lobby share. */
function tableNet(extra) {
  const net = netStub(extra);
  Object.assign(net, {
    peers: [true, true],
    act(action) { net.calls.push(["act", action]); return true; },
    leave() { net.calls.push(["leave"]); net.lastState = null; net.session = null; },
    resume() { net.calls.push(["resume"]); return true; },
    savedMatch: () => null,
    stakesAllowed: () => false,
  });
  Object.assign(net.nostr, {
    hasNip07: () => false,
    npub: () => "npub1x",
    relays: () => [],
    resultEvent: (over) => ({ kind: 31600, created_at: over.resultCreatedAt, tags: over.resultTags, content: over.resultContent }),
    acceptEvent: () => ({ kind: 4600, tags: [], content: "{}" }),
    parseInvite: () => null,
  });
  return net;
}

/* play.html in a stub document, with site/lobby.js beside it: the DOMContentLoaded
 * listener is fired by hand, which is what mounts the lobby inside the Hangar. */
function loadTable(net, napplet, { look = null } = {}) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubElement(id));
    return nodes.get(id);
  };
  const fired = {};
  globalThis.document = {
    body: byId("body"),
    getElementById: byId,
    createElement: (tag) => stubElement(tag),
    createTextNode: (text) => text,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.window = {
    addEventListener(type, fn) { (fired[type] = fired[type] || []).push(fn); },
    dispatchEvent() {},
    confirm: () => true,
  };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
  globalThis.location = { protocol: "about:", host: "", href: "about:srcdoc", search: "" };
  Object.assign(globalThis, {
    E1Engine: E, E1_CARDS: CARDS, E1_CARDS_FAST: FAST, E1_PRECONS: PRECONS, E1_PRECONS_FAST: PRECONS_FAST,
    E1Net: net, E1Napplet: napplet,
  });
  E.setCatalog(CARDS);
  delete globalThis.E1FX;
  if (look) globalThis.E1Look = look; else delete globalThis.E1Look;
  delete globalThis.E1Lobby;
  new Function(LOBBY_JS)();
  new Function(PLAY_JS)();
  for (const fn of fired.DOMContentLoaded || []) fn();
  return { byId, fired, game: globalThis.window.E1_GAME };
}

async function waitFor(check, what, turns = 400) {
  for (let turn = 0; turn < turns; turn += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, turn < 50 ? 0 : 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const MATCH = "m_0123456789ab";
const openState = (extra) => ({
  t: "STATE", v: 1, matchId: MATCH, code: "K7M2QF", seat: 0, role: "seat", status: "open", downgraded: false, stake: 0,
  ruleset: "E1.0", catalogDigest: null, view: null, events: [],
  players: [{ seat: 0, name: "felix", pubkey: KEY, affinity: "Power", online: true }, { seat: 1, name: null, pubkey: null, affinity: null, online: false }],
  ...extra,
});
function playingState(extra) {
  const full = E.createGame({
    seats: [{ name: "felix", affinity: "Power" }, { name: "anna", affinity: "Signal" }],
    seeds: { public: 4242, hidden: [4243, 4244] },
    firstPlayer: 0,
  });
  return openState({
    status: "playing", view: E.view(full, 0),
    players: [{ seat: 0, name: "felix", pubkey: KEY, affinity: "Power", online: true }, { seat: 1, name: "anna", pubkey: "c".repeat(64), affinity: "Signal", online: true }],
    ...extra,
  });
}

test("inside the Hangar the table page finds an opponent in place: a dealt seat shows the board, and leaving shows the lobby again", (t) => {
  sandboxStorage(t);
  const net = tableNet();
  const shell = tableHangar();
  const { byId, game } = loadTable(net, shell);
  assert.match(byId("lobby").innerHTML, /id="createTable"/, "the lobby is built into the table page");
  assert.doesNotMatch(byId("lobby").innerHTML, /nostrLogin|matchmaking\.html/, "the website's sign-in row and its door to another page are gone");
  assert.equal(byId("nostrLogin").listeners.click, undefined);
  assert.equal(called(net, "start").length, 1, "one transport, started once, by the page");

  byId("createTable").click();
  assert.equal(called(net, "create")[0][1].stake, 0);
  const open = openState();
  net.lastState = open;
  net.handlers.onState(open);
  assert.equal(byId("hostPanel").hidden, false, "an open table is the lobby's");
  assert.equal(byId("tableCode").textContent, "K7M2QF");
  assert.equal(game.mode, "hotseat", "and no board is dealt for it");

  const playing = playingState();
  net.lastState = playing;
  net.handlers.onState(playing);
  assert.equal(byId("table").hidden, false, "the guest sat down: the board shows in place");
  assert.equal(byId("setup").hidden, true);
  assert.equal(game.mode, "seat");
  assert.equal(byId("foeName").textContent, "anna");
  assert.deepEqual(shell.escaped, [], "nothing asked the Hangar to close the game");

  net.handlers.onError({ code: "RATE_LIMITED" });
  assert.match(byId("prompt").textContent, /Too many actions too quickly/, "while the board is up, a refusal is the board's");

  byId("leaveTable").click();
  assert.equal(called(net, "leave").length, 1);
  assert.deepEqual([byId("table").hidden, byId("setup").hidden, game.mode], [true, false, "hotseat"], "leaving shows the lobby again");
  assert.equal(byId("hostPanel").hidden, true, "without the code of the table it left");
  assert.deepEqual(shell.escaped, [], "and the game stays open");
});

test("a reloaded frame that takes its own open table back shows it over the first screen, and leaves a chosen game alone", (t) => {
  sandboxStorage(t);
  const net = tableNet();
  const { byId } = loadTable(net, tableHangar());
  assert.deepEqual([byId("first").hidden, byId("lobby").hidden], [false, true], "the first screen, nothing chosen");
  const open = openState({ token: "t".repeat(32) }); // what the mirrored seat's RESUME answers
  net.lastState = open;
  net.handlers.onState(open);
  assert.equal(byId("lobby").hidden, false, "the lobby is brought into view");
  assert.equal(byId("modeOnline").getAttribute("aria-pressed"), "true");
  assert.deepEqual([byId("hostPanel").hidden, byId("tableCode").textContent], [false, "K7M2QF"], "with the host's own code to read aloud");

  const local = tableNet();
  const page = loadTable(local, tableHangar());
  page.byId("modeHotseat").click();
  local.lastState = open;
  local.handlers.onState(open);
  assert.deepEqual([page.byId("lobby").hidden, page.byId("localSetup").hidden], [true, false], "a chosen local game is not pushed aside");
});

test("inside the Hangar a finished match goes back to the lobby, and the settlement screen never appears", (t) => {
  sandboxStorage(t);
  const over = {
    matchId: MATCH, result: { winners: [1], losers: [0], reason: "uptime" }, verify: { ok: true },
    resultContent: JSON.stringify({ turns: 7, actions: 40, stake: 500 }), resultTags: [["d", MATCH]], resultCreatedAt: 1789000000,
  };
  const net = tableNet();
  const shell = tableHangar();
  const { byId } = loadTable(net, shell);
  const staked = playingState({ stake: 500 });
  net.lastState = staked;
  net.handlers.onState(staked);
  net.handlers.onOver(over);
  assert.equal(byId("endVerdict").textContent, "YOU LOST");
  assert.equal(byId("endStake").hidden, true, "no settlement inside the Hangar, not even for a seat taken back from a match for sats");
  assert.equal(byId("endStake").children.length, 0);
  assert.equal(byId("endRematch").textContent, "Find another opponent");
  byId("endRematch").click();
  assert.equal(called(net, "leave").length, 1);
  assert.deepEqual([byId("table").hidden, byId("setup").hidden], [true, false], "the lobby, on this page");
  assert.deepEqual(shell.escaped, [], "not the Hangar's close");

  /* The same ending on the website still asks the loser to keep their word. */
  const site = tableNet();
  const page = loadTable(site, tableHangar({ embedded: false }));
  site.lastState = staked;
  site.handlers.onState(staked);
  site.handlers.onOver(over);
  assert.equal(page.byId("endStake").hidden, false);
  assert.match(said(page.byId("endStake")), /You owe 500 sats/);
});

test("My collection online: the Hangar's lobby opens a table with the Stack the member's cards deal", async (t) => {
  sandboxStorage(t);
  const power = FAST.filter((card) => card.type === "Avatar" && card.affinity.length === 1 && card.affinity[0] === "Power"
    && card.rarity !== "genesis" && !/\bStake\b/.test(card.text || ""));
  const cards = power.slice(0, 6).map((card) => ({ asset_id: card.id, count: 2 })).sort((a, b) => (a.asset_id < b.asset_id ? -1 : 1));
  const inventory = {
    v: 1, kind: "nutft/inventory", edition: "600b-e1", collection_id: "600B-E1",
    catalog_uri: "https://tcg.nappelin.com/nutft/catalog", mint: "https://tcg.nappelin.com", at: 1757900000, cards,
  };
  const net = tableNet();
  const { byId } = loadTable(net, tableHangar({ inventory }));
  await waitFor(() => byId("deckCollectionRow").hidden === false, "My collection in the lobby's Stack choice");
  assert.equal(byId("deckCollectionLabel").textContent, "12 of 40 cards yours");

  byId("netRules").value = "F1.0";
  byId("deckReady").checked = false;
  byId("deckCollection").checked = true;
  byId("deckCollection").fire("change");
  byId("createTable").click();
  const [, create] = called(net, "create")[0];
  const owned = new Map(cards.map((card) => [card.asset_id, card.count]));
  const expected = globalThis.E1CollectionStack.buildCollectionStack(FAST, owned, { profile: "F1.0", precons: PRECONS_FAST });
  assert.equal(create.ruleset, "F1.0");
  assert.deepEqual(create.deck, expected.ids, "the Stack collection-stack.js deals for these cards under Fast");
  assert.equal(create.stake, 0);
  for (const card of cards) assert.equal(create.deck.filter((id) => id === card.asset_id).length, 2, `${card.asset_id} goes to the table`);
});

// -------------------------------------------------------- the first screen inside the Hangar

const NAPPLET_JS = fs.readFileSync(path.join(SITE, "napplet.js"), "utf8");
const { schnorr } = require("@noble/curves/secp256k1");
const { createHash } = require("node:crypto");
require("../../site/schnorr.js");
const SHOP = "https://tcg.nappelin.com/shop.html";
const COLLECTION_WORDS = globalThis.E1CollectionStack.WORDS;
const MEMBER_SK = Uint8Array.from(createHash("sha256").update("lobby:member").digest());
const MEMBER = Buffer.from(schnorr.getPublicKey(MEMBER_SK)).toString("hex");

function signedBy(sk, template) {
  const event = Object.assign({ pubkey: Buffer.from(schnorr.getPublicKey(sk)).toString("hex") }, template);
  event.id = createHash("sha256").update(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])).digest("hex");
  event.sig = Buffer.from(schnorr.sign(event.id, sk)).toString("hex");
  return event;
}

const EMPTY_INVENTORY = {
  v: 1, kind: "nutft/inventory", edition: "600b-e1", collection_id: "600B-E1",
  catalog_uri: "", mint: "https://tcg.nappelin.com", at: 1757900000, cards: [],
};

/* The prelude a Hangar installs, with only the domains a test grants, under the real
 * adapter (site/napplet.js), so the table reads it exactly as it does in the frame. */
function realAdapter({ key = MEMBER, inventory = EMPTY_INVENTORY, intent = true, link = null, outbox = null, resource = null, storage = null } = {}) {
  const asked = { link: [] };
  const shell = {
    identity: { getPublicKey: async () => key || "" },
    storage: storage || { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  };
  if (intent) shell.intent = { invoke: async () => ({ ok: true, inventory }), available: async () => true };
  if (link) shell.link = { open: (url, options) => { asked.link.push([url, options]); return link(url); } };
  if (outbox) shell.outbox = outbox;
  if (resource) shell.resource = resource;
  globalThis.napplet = shell;
  delete globalThis.E1Napplet;
  new Function(NAPPLET_JS)();
  delete globalThis.napplet;
  return { N: globalThis.E1Napplet, asked };
}

/* net.js before it has heard the shell's key: the table and the lobby ask the shell. */
const shellNet = (extra) => {
  const net = tableNet(extra);
  net.nostr.savedPubkey = () => null;
  return net;
};
const flush = async (turns = 8) => { for (let i = 0; i < turns; i += 1) await Promise.resolve(); };

test("the first screen inside the Hangar: the member's look, three ways to play, and the collection line with its door", async (t) => {
  sandboxStorage(t);
  const look = require("../../site/identity-look.js");
  const picture = "https://example.com/flx.png";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64");
  const profile = signedBy(MEMBER_SK, { kind: 0, created_at: 1789000000, tags: [], content: JSON.stringify({ display_name: "FLX", picture }) });
  const { N, asked } = realAdapter({
    link: async () => ({ status: "opened" }),
    outbox: { query: async () => ({ type: "outbox.query.result", events: [{ event: profile }] }) },
    resource: { bytes: async (url) => (url === picture ? new Blob([png]) : null) },
  });
  const net = shellNet();
  const { byId, fired } = loadTable(net, N, { look });
  byId("netName").value = "Player"; // the lobby markup's own default

  assert.equal(byId("first").hidden, false, "the first screen is the page inside the Hangar");
  assert.equal(byId("coach").hidden, true, "the first-game tour does not open over the first screen");
  assert.deepEqual(["modeNpc", "modeHotseat", "modeOnline"].map((id) => byId(id).getAttribute("aria-pressed")),
    ["false", "false", "false"], "three ways to play, none chosen yet");
  assert.deepEqual([byId("localSetup").hidden, byId("lobby").hidden], [true, true], "nothing opens before a choice");

  await waitFor(() => byId("firstName").textContent === "FLX", "the member's name from their look");
  assert.equal(byId("netName").value, "FLX", "and the seat the lobby opens plays under it");
  await waitFor(() => /^blob:/.test(byId("firstPortrait").getAttribute("src") || ""), "their picture, through the shell");
  assert.equal(byId("firstPortrait").hidden, false);
  assert.equal(byId("firstPortrait").dataset.look, "picture");
  assert.equal(byId("firstIdentity").hidden, true, "signed in: no identity line");

  await waitFor(() => byId("firstCollection").textContent === COLLECTION_WORDS.empty, "the empty collection's line");
  assert.equal(byId("firstCollection").hidden, false);
  assert.equal(byId("shopDoor").hidden, false, "one button on the empty line");
  byId("shopDoor").click();
  assert.equal(byId("shopDoor").disabled, true, "one ask at a time");
  await waitFor(() => byId("shopDoor").disabled === false, "the host's answer");
  assert.deepEqual(asked.link, [[SHOP, undefined]], "the fixed address, asked of the Hangar once");
  assert.equal(byId("firstCollection").textContent, COLLECTION_WORDS.empty);

  byId("modeNpc").click();
  assert.deepEqual([byId("localSetup").hidden, byId("lobby").hidden, byId("npcB").checked], [false, true, true]);
  assert.equal(byId("modeNpc").getAttribute("aria-pressed"), "true");
  assert.equal(byId("coach").hidden, false, "the tour opens with the local game it teaches");
  byId("modeHotseat").click();
  assert.deepEqual([byId("localSetup").hidden, byId("npcB").checked, byId("modeNpc").getAttribute("aria-pressed")], [false, false, "false"]);
  byId("modeOnline").click();
  assert.deepEqual([byId("localSetup").hidden, byId("lobby").hidden, byId("modeOnline").getAttribute("aria-pressed")], [true, false, "true"]);
  assert.equal(byId("coach").hidden, true, "and never sits over the lobby, or a table code read aloud there");
  await waitFor(() => called(net, "tables").length === 1, "the open tables, asked once the lobby is in view");
  assert.equal(byId("lobbyIdentity").hidden, true);
  byId("netName").value = "flx at the table";
  byId("firstName").textContent = "";
  for (const fn of fired["e1:identity"] || []) fn({ detail: {} }); // anything that repaints the page
  assert.equal(byId("firstName").textContent, "FLX", "the first screen was painted again");
  assert.equal(byId("netName").value, "flx at the table", "a name the member typed is theirs to keep");
});

test("inside the Hangar the first-game tour remembers it is done through the shell's storage, and waits for its answer", async (t) => {
  sandboxStorage(t);
  const rejections = [];
  const note = (reason) => rejections.push(reason);
  process.on("unhandledRejection", note);
  t.after(() => process.off("unhandledRejection", note));
  const COACH = "600b:coach";
  const withStorage = (storage) => Object.assign(tableHangar(), { storage: Object.assign({ json: async (name, fallback) => fallback }, storage) });

  // One app store, two frames: the tour finished in the first never comes back in the next.
  const store = new Map();
  const shared = { get: async (key) => (store.has(key) ? store.get(key) : null), set: async (key, value) => { store.set(key, String(value)); return true; } };
  const first = loadTable(tableNet(), withStorage(shared));
  first.byId("modeNpc").click();
  await flush();
  assert.equal(first.byId("coach").hidden, false, "a first visit is taught");
  first.byId("coachSkip").click();
  await flush();
  assert.deepEqual([first.byId("coach").hidden, store.get(COACH)], [true, "done"], "done, and stored in the shell");
  const next = loadTable(tableNet(), withStorage(shared));
  next.byId("modeNpc").click();
  await flush();
  assert.equal(next.byId("coach").hidden, true, "the next frame remembers");

  // An answer still on its way: no tour, not even for a local game already chosen.
  let answer;
  const slow = loadTable(tableNet(), withStorage({
    get: (key) => (key === COACH ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve(null)),
    set: async () => true,
  }));
  slow.byId("modeHotseat").click();
  await flush();
  assert.equal(slow.byId("coach").hidden, true, "nothing is shown before the stored answer is known");
  answer(null);
  await flush();
  assert.equal(slow.byId("coach").hidden, false, "and a first visit is taught once it is");

  /* Storage that throws on every access, twice over: an adapter whose answers reject,
   * and the real adapter over a shell storage domain that throws. The tour teaches,
   * and finishing it throws nothing. */
  const throwing = () => { throw new Error("storage refused"); };
  const shellStorage = { getItem: throwing, setItem: throwing, removeItem: throwing };
  for (const shell of [withStorage({ get: async () => throwing(), set: async () => throwing() }), realAdapter({ storage: shellStorage }).N]) {
    const refusing = loadTable(shellNet(), shell);
    refusing.byId("modeNpc").click();
    await flush();
    assert.equal(refusing.byId("coach").hidden, false, "an answer that could not be read is a tour not done yet");
    refusing.byId("coachNext").click();
    refusing.byId("coachSkip").click();
    await flush();
    assert.equal(refusing.byId("coach").hidden, true);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(rejections, [], "no refusal escaped");
});

test("on the website the tour's flag stays in localStorage, which may throw", (t) => {
  sandboxStorage(t);
  const page = loadTable(tableNet(), undefined);
  assert.equal(page.byId("coach").hidden, false, "no adapter and a throwing localStorage: the tour teaches");
  assert.doesNotThrow(() => page.byId("coachSkip").click(), "and finishing it cannot fail");
  assert.equal(page.byId("coach").hidden, true);

  const written = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key) => (key === "600b:coach" ? "done" : null), setItem: (key, value) => written.push([key, value]), removeItem() {} },
  });
  const done = loadTable(tableNet(), undefined);
  assert.equal(done.byId("coach").hidden, true, "a tour done in this browser stays done");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: (key, value) => written.push([key, value]), removeItem() {} },
  });
  const fresh = loadTable(tableNet(), undefined);
  fresh.byId("coachSkip").click();
  assert.deepEqual(written.filter(([key]) => key === "600b:coach"), [["600b:coach", "done"]], "and finishing it writes it there");
});

test("inside the Hangar a subscription is closed when the lobby is put away, a board shows, a table is left or ends, and the frame unloads", async (t) => {
  sandboxStorage(t);
  const handles = [];
  const outbox = {
    query: async () => ({ type: "outbox.query.result", events: [] }),
    subscribe(filters, options) {
      const handle = { filters, options, closed: 0, on() {}, close() { handle.closed += 1; } };
      handles.push(handle);
      return handle;
    },
  };
  const unloading = {};
  globalThis.window = { addEventListener: (type, fn) => { (unloading[type] = unloading[type] || []).push(fn); } };
  const { N } = realAdapter({ outbox }); // the adapter listens for pagehide on the frame's window
  const net = shellNet();
  // net.js's invites, through the same door: the shell's outbox subscription.
  net.nostr.subscribeInvites = (pubkey, onInvite) => N.outbox.subscribe([{ kinds: [4600], "#t": ["invite"], "#p": [pubkey] }], onInvite);
  const { byId } = loadTable(net, N);
  const open = () => handles.filter((handle) => !handle.closed).length;
  const subscribeAnything = () => N.outbox.subscribe([{ kinds: [31600] }], () => {});
  await waitFor(() => !["", "Not signed in"].includes(byId("firstName").textContent), "the member's key");

  byId("modeOnline").click();
  byId("checkInvites").click();
  assert.equal(open(), 1, "the lobby listens for invites");
  byId("modeNpc").click();
  assert.equal(open(), 0, "a local game puts the lobby away, and its subscription with it");

  byId("modeOnline").click();
  byId("checkInvites").click();
  assert.equal(open(), 1);
  const playing = playingState();
  net.lastState = playing;
  net.handlers.onState(playing);
  assert.equal(byId("table").hidden, false);
  assert.equal(open(), 0, "the board takes the lobby's place");

  subscribeAnything();
  byId("leaveTable").click();
  assert.deepEqual([open(), byId("lobby").hidden], [0, false], "leaving a table closes what is open, and shows the lobby");

  net.lastState = playing;
  net.handlers.onState(playing);
  subscribeAnything();
  net.handlers.onOver({
    matchId: MATCH, result: { winners: [0], losers: [1], reason: "uptime" }, verify: { ok: true },
    resultContent: JSON.stringify({ turns: 7, actions: 40 }), resultTags: [["d", MATCH]], resultCreatedAt: 1789000000,
  });
  assert.equal(open(), 0, "a table that ends closes it");

  subscribeAnything();
  subscribeAnything();
  for (const fn of unloading.pagehide || []) fn({});
  assert.equal(open(), 0, "and so does the frame unloading");
  assert.ok(handles.every((handle) => handle.closed === 1), "each one closed once");
  assert.ok(handles.every((handle) => JSON.stringify(handle.options.relays) === JSON.stringify(["wss://relay.nappelin.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"])));
});

test("each service the Hangar does not give says so in one line, and the door only opens where it can", async (t) => {
  sandboxStorage(t);
  const cases = [
    [{ key: "", intent: false }, "Not signed in", COLLECTION_WORDS.noCollection, false],
    [{ key: "", inventory: EMPTY_INVENTORY }, "Not signed in", COLLECTION_WORDS.guest, false],
    [{ inventory: EMPTY_INVENTORY }, null, COLLECTION_WORDS.empty, false],
    [{ inventory: EMPTY_INVENTORY, link: async () => ({ status: "opened" }) }, null, COLLECTION_WORDS.empty, true],
  ];
  for (const [grants, name, line, door] of cases) {
    const { N } = realAdapter(grants);
    const net = shellNet();
    const { byId } = loadTable(net, N);
    await waitFor(() => byId("firstCollection").textContent === line, line);
    assert.equal(byId("shopDoor").hidden, !door, `door for ${line} with${grants.link ? "" : "out"} a link domain`);
    if (name) {
      await waitFor(() => byId("firstName").textContent === name, name);
      assert.equal(byId("bootNote").hidden, true, "the shell answered: the loading line is gone");
      assert.equal(byId("firstIdentity").hidden, false);
      assert.equal(byId("firstIdentity").textContent, WORDS.noIdentity, "no key: one line, and local play still offered");
      byId("modeOnline").click();
      assert.equal(byId("lobbyIdentity").hidden, true, "and the lobby below it does not say it twice");
      assert.equal(byId("firstIdentity").hidden, false, "the one line stays in view with the lobby");
      assert.equal(called(net, "tables").length, 0, "nobody to seat, so no table is asked");
    } else {
      await waitFor(() => byId("firstName").textContent !== "", "the member's short npub");
      assert.equal(byId("firstName").textContent, "npub1bbbb…bbbbb");
      assert.equal(byId("firstIdentity").hidden, true);
    }
  }
});

test("the shop door: a refusal, and a host that never answers for 30 s, leave the line as it was", async (t) => {
  sandboxStorage(t);
  const { N, asked } = realAdapter({ link: async () => ({ status: "denied" }) });
  const { byId } = loadTable(shellNet(), N);
  await waitFor(() => byId("shopDoor").hidden === false, "the door on the empty line");
  byId("shopDoor").click();
  await waitFor(() => byId("shopDoor").disabled === false, "the refusal");
  assert.equal(asked.link.length, 1);
  assert.equal(byId("firstCollection").textContent, COLLECTION_WORDS.empty, "refused: the words stay");
  assert.equal(byId("shopDoor").hidden, false, "and so does the door");

  const silent = realAdapter({ link: () => new Promise(() => {}) });
  const page = loadTable(shellNet(), silent.N);
  await waitFor(() => page.byId("shopDoor").hidden === false, "the door on the empty line");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  page.byId("shopDoor").click();
  await flush();
  assert.equal(silent.asked.link.length, 1, "the host was asked");
  t.mock.timers.tick(29999);
  await flush();
  assert.equal(page.byId("shopDoor").disabled, true, "still waiting just before 30 s");
  t.mock.timers.tick(1);
  await flush();
  t.mock.timers.reset();
  assert.equal(page.byId("shopDoor").disabled, false, "30 s of silence is a refusal");
  assert.equal(page.byId("firstCollection").textContent, COLLECTION_WORDS.empty, "and the words stay");
});

test("a frame launched with a table code opens the online lobby with the code in Join, and joins nothing", (t) => {
  sandboxStorage(t);
  const reads = [];
  const net = tableNet({ launchCode: () => { reads.push(1); return reads.length === 1 ? "K7M2QF" : null; } });
  const { byId } = loadTable(net, tableHangar());
  assert.equal(byId("modeOnline").getAttribute("aria-pressed"), "true");
  assert.deepEqual([byId("lobby").hidden, byId("localSetup").hidden], [false, true]);
  assert.equal(byId("joinCode").value, "K7M2QF");
  assert.equal(reads.length, 1);
  assert.deepEqual(called(net, "join"), [], "never joined by itself");
});
