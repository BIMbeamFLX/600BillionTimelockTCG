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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NET_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "net.js"), "utf8");

/* net.js is a browser IIFE that assigns globalThis.E1Net. Loading it against a
 * stubbed environment is the whole harness: no jsdom, no build step. */
function loadNet(env) {
  const store = new Map(Object.entries(env.storage || {}));
  const opened = [];
  globalThis.location = env.location;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
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
  return { net: globalThis.E1Net, opened, store };
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
