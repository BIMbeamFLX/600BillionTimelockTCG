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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOBBY_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "lobby.js"), "utf8");
const KEY = "b".repeat(64);
const WORDS = {
  noIdentity: "Sign in to Nappelin to play online. Hotseat and games against the computer work now.",
  stakes: "This table plays for sats; stakes are not available in Nappelin yet.",
  unreachable: "The table server cannot be reached right now. Hotseat and games against the computer work now.",
  invites: "Invites cannot be listed here right now. You can still join with a table code.",
};

function stubElement(id) {
  return {
    id, hidden: false, textContent: "", value: "", className: "", innerHTML: "", disabled: false,
    checked: false, dataset: {}, children: [], listeners: {}, attributes: {},
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    append(...kids) { this.children.push(...kids); },
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
    fire(type) { for (const fn of this.listeners[type] || []) fn({}); },
  };
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
    tables: async () => [],
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
  for (const id of ["createTable", "joinTable", "findMatch", "refreshTables", "checkInvites"]) {
    assert.equal(byId(id).disabled, true, `${id} waits for an identity`);
  }
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
