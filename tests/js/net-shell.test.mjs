/* site/net.js inside a napplet shell — the table socket as a PIPE.
 *
 * A fake nappelin Hangar implements the table channel (docs/napplet-spec.md,
 * "the table channel", 2026-09-13) over real `ws` sockets to an in-process
 * referee, and signs the NIP-42 login with a test key. net.js never sees a
 * WebSocket; it sees E1Napplet.table.connect. The website path is covered by
 * client.test.mjs and must stay byte-for-byte the same in behaviour.
 *
 * Run: node --test tests/js/net-shell.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const WebSocket = require("ws");
const { schnorr } = require("@noble/curves/secp256k1");
// The real verifier: invites, starts and profiles are believed only once it says so.
require("../../site/schnorr.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NET_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "net.js"), "utf8");
const NAPPLET_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "napplet.js"), "utf8");
const tmpDb = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "600b-shell-")), name);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const HOST_SK = Uint8Array.from(createHash("sha256").update("test:hangar-identity").digest());
const HOST_PUBKEY = hex(schnorr.getPublicKey(HOST_SK));
const hostOf = (url) => { try { return new URL(url).host; } catch (err) { return null; } };

function signEvent(template, sk) {
  const event = Object.assign({ pubkey: hex(schnorr.getPublicKey(sk)) }, template);
  event.id = createHash("sha256").update(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])).digest("hex");
  event.sig = hex(schnorr.sign(event.id, sk));
  return event;
}

/* The host side of the channel, §3b: allowlist, one ws per channel, the five
 * sign rules. `sk === null` models nobody signed in at the Hangar. A host holds
 * frames: `host.frame`/`parent`/`deliver` are the first one's, `openFrame()`
 * makes the next, and `frame.kill()` is the iframe being removed — nothing
 * reaches it any more, nothing it sends arrives, and its tables are closed. */
const FRAMES = new Set();
function fakeHangar({ sk = HOST_SK, allow = () => true } = {}) {
  const channels = new Map();
  const owners = new Map();
  const host = { signRequests: 0, channels, frames: [], sent: [] };
  let n = 0;
  host.openFrame = () => {
    const listeners = [];
    const frame = { dead: false };
    frame.window = { addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); } };
    frame.deliver = (data, source = frame.parent) => { if (!frame.dead) for (const fn of listeners) fn({ source, data }); };
    frame.parent = { postMessage: (msg) => queueMicrotask(() => { if (!frame.dead) handle(msg, frame); }) };
    frame.kill = () => {
      frame.dead = true;
      for (const [channel, ws] of channels) if (owners.get(channel) === frame) ws.close(1000, "session closed");
    };
    host.frames.push(frame);
    FRAMES.add(frame);
    return frame;
  };
  function handle(msg, frame) {
    const answer = (reply) => frame.deliver(reply);
    if (msg.type === "table.open") {
      if (!allow(msg.url)) return answer({ type: "table.open.result", id: msg.id, ok: false, error: "table origin not allowed" });
      const channel = `c${++n}`;
      const ws = new WebSocket(msg.url);
      channels.set(channel, ws);
      owners.set(channel, frame);
      ws.on("open", () => answer({ type: "table.opened", channel }));
      ws.on("message", (raw) => answer({ type: "table.message", channel, data: String(raw) }));
      ws.on("close", (code, reason) => { channels.delete(channel); answer({ type: "table.closed", channel, code, reason: String(reason) }); });
      ws.on("error", () => {});
      return answer({ type: "table.open.result", id: msg.id, ok: true, channel });
    }
    if (msg.type === "table.send") {
      host.sent.push(msg.data);
      // Test hook: a referee that answers something itself (`reply(text)`) instead of the real one.
      if (host.answerFor && host.answerFor(JSON.parse(msg.data), (data) => answer({ type: "table.message", channel: msg.channel, data: JSON.stringify(data) }))) return;
      const ws = channels.get(msg.channel);
      if (ws && ws.readyState === 1) ws.send(msg.data);
      return;
    }
    if (msg.type === "table.close") { const ws = channels.get(msg.channel); if (ws) ws.close(1000, "closed by napplet"); return; }
    if (msg.type === "table.sign") {
      host.signRequests += 1;
      const refuse = (error) => answer({ type: "table.sign.result", id: msg.id, ok: false, error });
      const ws = channels.get(msg.channel);
      if (!ws) return refuse("no such channel");
      if (!sk) return refuse("sign in first");
      const e = msg.event || {};
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const relay = tags.find((t) => t[0] === "relay");
      const challenge = tags.find((t) => t[0] === "challenge");
      const ok = e.kind === 22242 && e.content === "" && tags.length === 2 && relay && challenge
        && /^[0-9a-f]{64}$/.test(challenge[1]) && hostOf(relay[1]) === hostOf(ws.url);
      if (!ok) return refuse("the host signs only a table login for the table you opened");
      return answer({ type: "table.sign.result", id: msg.id, ok: true, event: signEvent(e, sk) });
    }
  }
  const first = host.openFrame();
  host.frame = first.window;
  host.parent = first.parent;
  host.deliver = first.deliver;
  host.close = () => { for (const ws of channels.values()) { try { ws.close(); } catch (err) { /* gone */ } } };
  return host;
}

/* A srcdoc sandbox: storage GETTERS throw, `location` is about:, and the host
 * page is `parent`. Loads napplet.js and then net.js against that world. */
function loadShell({ host, shell, nostr, location, tableUrl } = {}) {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`SecurityError: ${name}`); } });
  }
  if (host) { globalThis.window = host.frame; globalThis.parent = host.parent; } else { delete globalThis.window; delete globalThis.parent; }
  if (shell) globalThis.napplet = shell; else delete globalThis.napplet;
  if (nostr) globalThis.nostr = nostr; else delete globalThis.nostr;
  if (tableUrl) globalThis.E1_TABLE_URL = tableUrl; else delete globalThis.E1_TABLE_URL;
  globalThis.location = location || { protocol: "about:", host: "", href: "about:srcdoc", search: "" };
  globalThis.WebSocket = WebSocket;
  delete globalThis.E1Napplet;
  new Function(NAPPLET_JS)();
  delete globalThis.E1Net;
  new Function(NET_JS)();
  const log = { errors: [], states: [] };
  const started = globalThis.E1Net.start({ onError: (e) => log.errors.push(e), onState: (s) => log.states.push(s) });
  return { net: globalThis.E1Net, N: globalThis.E1Napplet, log, started };
}

const shellWith = (extra) => Object.assign({
  identity: { getPublicKey: async () => HOST_PUBKEY },
  shell: { ready: () => {}, supports: () => false },
}, extra);

async function waitFor(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const got = check();
    if (got) return got;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

async function referee(t, name, extra) {
  const table = await createTable(Object.assign({ port: 0, dbPath: tmpDb(name), host: "127.0.0.1", publicHost: "127.0.0.1", rateMax: 1000000 }, extra || {}));
  t.after(async () => {
    // Frames go first: a frame that saw its table close would keep dialling a referee that is gone.
    for (const frame of FRAMES) frame.kill();
    FRAMES.clear();
    await table.close();
  });
  return table;
}

/* The relays behind the fake Hangars: one event log, so a tab that publishes and a
 * tab that subscribes meet the way two Hangars meet on relay.nappelin.com. */
function relayBus() {
  const events = [];
  const subscriptions = new Set();
  const matches = (filter, event) => {
    if (filter.ids && !filter.ids.includes(event.id)) return false;
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    if (filter.since && event.created_at < filter.since) return false;
    for (const [key, wanted] of Object.entries(filter)) {
      if (key[0] === "#" && !event.tags.some((tag) => tag[0] === key.slice(1) && wanted.includes(tag[1]))) return false;
    }
    return true;
  };
  const any = (filters, event) => filters.some((filter) => matches(filter, event));
  return {
    events,
    subscriptions,
    publish(event) {
      events.push(event);
      for (const sub of subscriptions) if (any(sub.filters, event)) sub.push(event);
    },
    query: (filters) => events.filter((event) => any(filters, event)),
    subscribe(filters, push) {
      const sub = { filters, push };
      subscriptions.add(sub);
      for (const event of events) if (any(filters, event)) push(event);
      return () => subscriptions.delete(sub);
    },
  };
}

/* The Hangar's outbox as a napplet sees it: the Kehto 0.20 prelude over the relay-pool
 * router that nappelin's host.ts builds (its relay lists are an empty Map). A publish is
 * signed first and refused with "relay list unavailable" unless it names allowed relays
 * with `toOutbox: false`; query and subscription results are `{ event, sidecar }`;
 * `subscribe(filters)` returns a handle with `on("event" | "closed")` and `close()`. */
const HANGAR_RELAYS = ["wss://relay.nappelin.com", "wss://relay.bimcvp.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
function kehtoOutbox(bus, sk, { refuse = null, alive = () => true } = {}) {
  const calls = { publish: [], query: [], subscribe: [], close: 0 };
  const hint = (event) => ({ event, sidecar: { relayHints: [HANGAR_RELAYS[0]] } });
  const reply = (value) => (alive() ? new Promise((resolve) => setTimeout(() => resolve(value), 1)) : new Promise(() => {}));
  return {
    calls,
    publish(template, options) {
      calls.publish.push({ template, options });
      if (!sk) return reply({ type: "outbox.publish.result", id: "p", ok: false, error: "sign in first" });
      const event = signEvent(template, sk);
      const relays = ((options && options.relays) || []).filter((url) => HANGAR_RELAYS.includes(url));
      if (!options || options.toOutbox !== false || !relays.length) {
        return reply({ type: "outbox.publish.result", id: "p", ok: false, event, eventId: event.id, error: "relay list unavailable" });
      }
      if (refuse) return reply({ type: "outbox.publish.result", id: "p", ok: false, event, eventId: event.id, error: refuse });
      bus.publish(event);
      return reply({ type: "outbox.publish.result", id: "p", ok: true, event, eventId: event.id, relays: Object.fromEntries(relays.map((url) => [url, true])) });
    },
    query(filters) {
      const list = Array.isArray(filters) ? filters : [filters];
      calls.query.push(list);
      return reply({ type: "outbox.query.result", id: "q", events: bus.query(list).map(hint) });
    },
    subscribe(filters) {
      const list = Array.isArray(filters) ? filters : [filters];
      calls.subscribe.push(list);
      const handlers = { event: new Set(), closed: new Set() };
      const off = bus.subscribe(list, (event) => setTimeout(() => {
        if (alive()) for (const fn of handlers.event) fn(hint(event));
      }, 1));
      return {
        on(name, fn) { handlers[name].add(fn); return { close: () => handlers[name].delete(fn) }; },
        close() { calls.close += 1; off(); handlers.event.clear(); handlers.closed.clear(); },
        /* Test hook: the shell ends the subscription itself (`outbox.closed`). */
        end(reason) { off(); for (const fn of handlers.closed) fn(reason); },
      };
    },
  };
}

/* One napplet frame in a scope of its own: its own `window`, `parent`, `location` and
 * prelude, and a srcdoc sandbox's storage getters, which throw. Two frames can then play
 * each other in one process, which a single globalThis cannot hold. Globals the scope
 * does not name (setTimeout, URL, JSON) are the real ones. `sockets` lists every raw
 * WebSocket or fetch the frame tried: a napplet has neither, so it must stay empty. */
function loadFrame(frame, napplet, extra) {
  const scope = {};
  const sandboxed = (name) => ({ configurable: true, get() { throw new Error(`SecurityError: ${name} is not available in a sandboxed frame`); } });
  for (const name of ["localStorage", "sessionStorage", "caches"]) Object.defineProperty(scope, name, sandboxed(name));
  const navigator = Object.defineProperty({}, "locks", sandboxed("navigator.locks"));
  const sockets = [];
  const values = Object.assign({
    globalThis: scope,
    window: frame.window,
    parent: frame.parent,
    napplet,
    navigator,
    location: { protocol: "about:", host: "", href: "about:srcdoc", search: "" },
    WebSocket: function RawSocket(url) { sockets.push(String(url)); throw new Error("a napplet frame has no sockets of its own"); },
    fetch: async (url) => { sockets.push(String(url)); throw new Error("a napplet frame has no network of its own"); },
    E1Schnorr: globalThis.E1Schnorr,
  }, extra || {});
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(scope, name, { configurable: true, writable: true, value });
  }
  new Function("scope", `with (scope) {\n${NAPPLET_JS}\n;\n${NET_JS}\n}`)(scope);
  return { scope, net: scope.E1Net, N: scope.E1Napplet, sockets };
}

const keyOf = (label) => Uint8Array.from(createHash("sha256").update(`test:hangar:${label}`).digest());

/* A Hangar tab: one signed-in identity, one app store and one table channel, holding
 * frames that come and go the way a napplet is closed and opened again. `open()` starts
 * a frame the way play.js does (E1Net.start with handlers) and tracks its latest view. */
function hangarTab(t, label, { bus = relayBus(), sk = keyOf(label), storage = new Map() } = {}) {
  const host = fakeHangar({ sk });
  t.after(() => host.close());
  const tab = { label, host, bus, sk, pubkey: sk ? hex(schnorr.getPublicKey(sk)) : "", storage, clients: [] };
  tab.open = ({ storageApi, scope } = {}) => {
    const frame = tab.clients.length ? host.openFrame() : host.frames[0];
    const alive = () => !frame.dead;
    // The prelude answers asynchronously; a removed frame's questions are never answered.
    const later = (fn) => (alive() ? new Promise((resolve) => setTimeout(() => resolve(fn()), 1)) : new Promise(() => {}));
    const outbox = kehtoOutbox(bus, sk, { alive });
    const napplet = {
      shell: { ready() {}, supports: () => false },
      identity: { getPublicKey: () => later(() => tab.pubkey) },
      storage: storageApi || {
        getItem: (key) => later(() => (storage.has(key) ? storage.get(key) : null)),
        setItem: (key, value) => later(() => { storage.set(key, String(value)); }),
        removeItem: (key) => later(() => { storage.delete(key); }),
        keys: () => later(() => [...storage.keys()]),
      },
      outbox,
    };
    const client = Object.assign(loadFrame(frame, napplet, scope), { tab, frame, outbox, view: null });
    const log = { errors: [], states: [], frames: [], overs: [], rejects: [], peers: [], active: [], queued: [] };
    client.log = log;
    client.handlers = {
      onError: (e) => log.errors.push(e),
      onState: (s) => { log.states.push(s); if (s.view) client.view = s.view; },
      onFrame: (f) => { log.frames.push(f); client.view = f.view; },
      onReject: (r) => { log.rejects.push(r); if (r.view) client.view = r.view; },
      onOver: (o) => log.overs.push(o),
      onPeer: (p) => log.peers.push(p),
      onActive: (a) => log.active.push(a),
      onQueued: (q) => log.queued.push(q),
    };
    client.started = client.net.start(client.handlers);
    tab.clients.push(client);
    return client;
  };
  tab.mirror = () => JSON.parse(storage.get("600b:seats") || "{}");
  return tab;
}

/* Every access throws: a shell storage domain that is there but refuses everything. */
const refusingStorage = () => new Proxy({}, { get(target, name) { throw new Error(`storage refused ${String(name)}`); } });

test("a napplet opens, logs in and creates a table through the host channel", async (t) => {
  const table = await referee(t, "s1.db");
  const host = fakeHangar();
  t.after(host.close);
  const { net, log, started } = loadShell({ host, shell: shellWith() });
  assert.equal(started.resuming, false, "throwing storage getters are a fallback, not a crash");
  assert.equal(await net.nostr.login(), HOST_PUBKEY, "identity comes from the shell");
  assert.equal(net.nostr.savedPubkey(), HOST_PUBKEY, "and is remembered in memory, not localStorage");

  assert.ok(net.create({ name: "felix", affinity: "Power", pubkey: HOST_PUBKEY, table: table.wsUrl }));
  const state = await waitFor(() => log.states[0]);
  assert.equal(state.seat, 0);
  assert.match(state.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(net.status, "live");
  assert.deepEqual(log.errors, []);
  assert.equal(host.signRequests, 1, "the host signed the NIP-42 login");
  assert.equal(host.channels.size, 1, "the socket lives in the host page");
  net.leave();
  await waitFor(() => host.channels.size === 0);
});

test("a login for a table other than the one dialled is refused before the host is asked", async (t) => {
  const table = await referee(t, "s2.db", { publicUrl: "wss://tcg.example/ws" });
  const host = fakeHangar();
  t.after(host.close);
  const { net, log } = loadShell({ host, shell: shellWith() });
  await net.nostr.login();
  net.create({ name: "felix", affinity: "Power", pubkey: HOST_PUBKEY, table: table.wsUrl });
  const failed = await waitFor(() => log.errors.find((e) => e.code === "AUTH_FAILED"));
  assert.match(failed.message, /refusing/);
  assert.equal(host.signRequests, 0, "net.js's own relay-host check fires first");
  assert.equal(log.states.length, 0);
  net.leave();
});

test("the host refuses a table.sign whose relay names another host, and a refusal surfaces as AUTH_FAILED", async (t) => {
  const table = await referee(t, "s3.db");
  const host = fakeHangar({ sk: null }); // nobody signed in at the Hangar
  t.after(host.close);
  const { net, N, log } = loadShell({ host, shell: shellWith() });

  // Straight at the adapter: a crafted login for a foreign relay is refused by the host rule.
  const opened = [];
  const conn = N.table.connect(table.wsUrl, { onOpen: () => opened.push(1) });
  await waitFor(() => opened.length);
  await assert.rejects(
    () => conn.sign({ kind: 22242, created_at: 1, content: "", tags: [["relay", "wss://evil.example/ws"], ["challenge", "a".repeat(64)]] }),
    /only a table login for the table you opened|sign in first/
  );
  conn.close();

  // Through net.js: the refusal is reported, the intent is never sent.
  await net.nostr.login();
  net.create({ name: "felix", affinity: "Power", pubkey: HOST_PUBKEY, table: table.wsUrl });
  const failed = await waitFor(() => log.errors.find((e) => e.code === "AUTH_FAILED"));
  assert.match(failed.message, /sign in first/);
  assert.equal(log.states.length, 0);
  net.leave();
});

test("a message from a window that is not the host is ignored", async (t) => {
  const table = await referee(t, "s4.db");
  const host = fakeHangar();
  t.after(host.close);
  const { net, log } = loadShell({ host, shell: shellWith() });
  await net.nostr.login();
  net.create({ name: "felix", affinity: "Power", pubkey: HOST_PUBKEY, table: table.wsUrl });
  await waitFor(() => log.states[0]);
  const channel = [...host.channels.keys()][0];
  const bogus = JSON.stringify({ t: "ERROR", v: 1, code: "FORGED", message: "not from the host" });
  host.deliver({ type: "table.message", channel, data: bogus }, {});
  assert.equal(log.errors.length, 0, "a foreign event.source never reaches net.js");
  host.deliver({ type: "table.message", channel, data: bogus });
  assert.equal(log.errors[0].code, "FORGED", "the same bytes from the host do");
  net.leave();
});

test("the host refusing to open a table is reported and retried, never thrown", async (t) => {
  const host = fakeHangar({ allow: () => false });
  const { net, log } = loadShell({ host, shell: shellWith() });
  await net.nostr.login();
  net.create({ name: "felix", affinity: "Power", pubkey: HOST_PUBKEY, table: "wss://nowhere.example/ws" });
  const refused = await waitFor(() => log.errors.find((e) => e.code === "TABLE_REFUSED"));
  assert.match(refused.message, /not allowed/);
  assert.equal(net.status, "reconnecting");
  net.leave();
});

test("relay traffic goes through the shell outbox as unsigned templates", async () => {
  const published = [];
  const shell = shellWith({
    outbox: {
      publish: async (template) => { published.push(template); return { type: "outbox.publish.result", event: signEvent(template, HOST_SK) }; },
      query: async (filters) => ({ type: "outbox.query.result", events: [{ id: "e1", kind: filters.kinds[0] }] }),
    },
  });
  const { net } = loadShell({ host: fakeHangar(), shell });
  const template = net.nostr.inviteEvent({ matchId: "m_0123456789ab", code: "ABCDEF", table: "wss://t.example/ws", name: "f", affinity: "Power" });
  const signed = await net.nostr.sign(template);
  assert.equal(published.length, 1);
  assert.equal(published[0].sig, undefined, "the shell is handed an UNSIGNED template");
  assert.equal(signed.pubkey, HOST_PUBKEY);
  const res = await net.nostr.publish(signed);
  assert.deepEqual([res.ok, res.accepted, res.tried], [true, ["shell"], 1]);
  assert.equal(published.length, 1, "publish() recognises what sign() already sent — no second copy");
  assert.deepEqual(await net.nostr.query({ kinds: [31600] }), [{ id: "e1", kind: 31600 }]);
  await assert.rejects(() => net.nostr.sign({ kind: 9734, tags: [], content: "" }), /outbox\.publish and table\.sign/);
});

test("a publish through the Hangar's outbox names its relays, so the router does not refuse it", async () => {
  const bus = relayBus();
  const outbox = kehtoOutbox(bus, HOST_SK);
  const { net, N } = loadShell({ host: fakeHangar(), shell: shellWith({ outbox }) });
  const template = net.nostr.inviteEvent({ matchId: "m_0123456789ab", code: "ABCDEF", table: "wss://t.example/ws", name: "f", affinity: "Power" });

  const res = await N.outbox.publish(template);
  assert.equal(res.ok, true, res.error);
  const { options } = outbox.calls.publish[0];
  assert.equal(options.toOutbox, false, "nappelin has no NIP-65 relay lists to find");
  assert.deepEqual(options.relays, ["wss://relay.nappelin.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]);
  assert.equal(bus.events.length, 1);
  assert.equal(bus.events[0].pubkey, HOST_PUBKEY, "the host signed it");

  const unnamed = await kehtoOutbox(relayBus(), HOST_SK).publish(template);
  assert.deepEqual([unnamed.ok, unnamed.error], [false, "relay list unavailable"], "the router this fake follows refuses an unnamed publish");
});

test("query results arrive as { event, sidecar } and are handed on bare", async () => {
  const bus = relayBus();
  const signed = signEvent({ kind: 0, created_at: 1, tags: [], content: "{\"name\":\"felix\"}" }, HOST_SK);
  bus.publish(signed);
  const { net, N } = loadShell({ host: fakeHangar(), shell: shellWith({ outbox: kehtoOutbox(bus, HOST_SK) }) });
  assert.deepEqual(await N.outbox.query({ kinds: [0], authors: [HOST_PUBKEY] }), [signed]);
  assert.deepEqual(await net.nostr.query({ kinds: [0], authors: [HOST_PUBKEY] }), [signed]);
  const profile = await net.nostr.profile(HOST_PUBKEY);
  assert.equal(profile.name, "felix", "a verified kind 0 read through the shell reaches the profile");
});

test("relays that refuse a host-signed event do not unsign it", async () => {
  /* The host signs before its relays answer. A refusal used to throw out of sign(), so
   * play.js reported "signing was declined" and never handed the referee its record. */
  const bus = relayBus();
  const outbox = kehtoOutbox(bus, HOST_SK, { refuse: "publish denied" });
  const { net } = loadShell({ host: fakeHangar(), shell: shellWith({ outbox }) });
  const template = net.nostr.inviteEvent({ matchId: "m_0123456789ab", code: "ABCDEF", table: "wss://t.example/ws", name: "f", affinity: "Power" });
  const signed = await net.nostr.sign(template);
  assert.equal(signed.pubkey, HOST_PUBKEY);
  assert.match(signed.sig, /^[0-9a-f]{128}$/);
  const res = await net.nostr.publish(signed);
  assert.deepEqual([res.ok, res.accepted, res.tried, res.error], [false, [], 1, "publish denied"]);
  assert.equal(outbox.calls.publish.length, 1, "the host is not asked a second time");

  const nobody = loadShell({ host: fakeHangar(), shell: shellWith({ outbox: kehtoOutbox(bus, null) }) });
  await assert.rejects(() => nobody.net.nostr.sign(template), /sign in first/, "a host that could not sign still refuses");
});

const STRANGER_SK = Uint8Array.from(createHash("sha256").update("test:stranger").digest());
const inviteFrom = (net, sk, fields) => signEvent(net.nostr.inviteEvent(Object.assign({
  matchId: "m_0123456789ab", code: "K7M2QF", table: "wss://tcg.nappelin.com/ws", name: "anna", affinity: "Signal",
}, fields)), sk);
/* A napplet frame has no sockets of its own: any raw WebSocket net.js made would be a bug. */
function forbidRawSockets() {
  const made = [];
  globalThis.WebSocket = function (url) { made.push(url); throw new Error(`a raw socket to ${url}`); };
  return made;
}

test("invites arrive through the shell's outbox subscription, each one verified here", async () => {
  const bus = relayBus();
  const outbox = kehtoOutbox(bus, HOST_SK);
  const { net, log } = loadShell({ host: fakeHangar(), shell: shellWith({ outbox }) });
  const raw = forbidRawSockets();
  const early = inviteFrom(net, STRANGER_SK, { to: HOST_PUBKEY });
  const forged = Object.assign({}, inviteFrom(net, STRANGER_SK, { to: HOST_PUBKEY, code: "ZZZZZZ", matchId: "m_ffffffffffff" }));
  forged.content = forged.content.replace("ZZZZZZ", "YYYYYY"); // the signature no longer covers it
  bus.publish(early);
  bus.publish(forged);
  bus.publish(signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [["p", HOST_PUBKEY]], content: "hi" }, STRANGER_SK));

  const got = [];
  const unsubscribe = net.nostr.subscribeInvites(HOST_PUBKEY, (invite) => got.push(invite));
  await waitFor(() => got.length === 1);
  assert.equal(got[0].code, "K7M2QF");
  assert.equal(got[0].pubkey, hex(schnorr.getPublicKey(STRANGER_SK)));
  const [filter] = outbox.calls.subscribe[0];
  assert.deepEqual([filter.kinds, filter["#t"], filter["#p"]], [[4600], ["invite"], [HOST_PUBKEY]]);

  bus.publish(inviteFrom(net, STRANGER_SK, { to: HOST_PUBKEY, code: "Q2W3E4", matchId: "m_00000000000a" }));
  await waitFor(() => got.length === 2);
  assert.equal(got[1].code, "Q2W3E4", "a live invite is delivered too");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(got.some((invite) => invite.code === "YYYYYY" || invite.code === "ZZZZZZ"), false, "a forged row is never offered");

  unsubscribe();
  assert.equal(outbox.calls.close, 1, "unsubscribing closes the host's subscription");
  bus.publish(inviteFrom(net, STRANGER_SK, { to: HOST_PUBKEY, code: "R5T6Y7", matchId: "m_00000000000b" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(got.length, 2);
  assert.deepEqual(raw, [], "no socket of its own");
  assert.deepEqual(log.errors, []);
});

test("without a shell subscription invites are reported unavailable, never thrown", async () => {
  const bus = relayBus();
  const noOutbox = loadShell({ host: fakeHangar(), shell: shellWith() });
  const raw = forbidRawSockets();
  assert.equal(typeof noOutbox.net.nostr.subscribeInvites(HOST_PUBKEY, () => {}), "function");
  assert.equal(noOutbox.log.errors[0].code, "INVITES_UNAVAILABLE");
  assert.deepEqual(raw, [], "a shell without an outbox still gets no socket of its own");

  const publishOnly = kehtoOutbox(bus, HOST_SK);
  delete publishOnly.subscribe;
  const older = loadShell({ host: fakeHangar(), shell: shellWith({ outbox: publishOnly }) });
  older.net.nostr.subscribeInvites(HOST_PUBKEY, () => {});
  assert.equal(older.log.errors[0].code, "INVITES_UNAVAILABLE");
  assert.equal(older.N.outbox.canSubscribe(), false);

  const ends = [];
  const website = loadShell({ nostr: { getPublicKey: async () => HOST_PUBKEY } });
  const off = website.N.outbox.subscribe([{ kinds: [4600] }], () => {}, (reason) => ends.push(reason));
  assert.equal(typeof off, "function");
  await waitFor(() => ends.length);
  assert.deepEqual(ends, ["unavailable"], "the adapter reports it once, and asynchronously");

  const outbox = kehtoOutbox(bus, HOST_SK);
  const ended = loadShell({ host: fakeHangar(), shell: shellWith({ outbox }) });
  const handles = [];
  const subscribe = outbox.subscribe;
  outbox.subscribe = (filters) => { const handle = subscribe(filters); handles.push(handle); return handle; };
  ended.net.nostr.subscribeInvites(HOST_PUBKEY, () => {});
  handles[0].end("relay list unavailable");
  const report = await waitFor(() => ended.log.errors.find((e) => e.code === "INVITES_UNAVAILABLE"));
  assert.match(report.message, /relay list unavailable/, "a subscription the shell ends says why");
});

// --------------------------------------------------------- the seat inside a shell

const unhandled = (t) => {
  const seen = [];
  const note = (reason) => seen.push(reason);
  process.on("unhandledRejection", note);
  t.after(() => process.off("unhandledRejection", note));
  return seen;
};

test("inside a shell the seat lives in memory, mirrored to the shell's storage under its identity", async (t) => {
  const table = await referee(t, "m1.db");
  const alice = hangarTab(t, "alice");
  const a = alice.open();
  assert.equal(a.started.resuming, false);
  assert.deepEqual(await a.started.restoring, { resuming: false }, "nothing mirrored, nothing to resume");

  assert.ok(a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey, table: table.wsUrl }));
  const open = await waitFor(() => a.log.states[0]);
  assert.equal(open.seat, 0);
  const key = `${open.matchId}:0`;
  const entry = await waitFor(() => alice.mirror()[key]);
  assert.deepEqual(
    [entry.matchId, entry.seat, entry.token, entry.table, entry.code, entry.pubkey],
    [open.matchId, 0, open.token, table.wsUrl, open.code, alice.pubkey],
  );
  assert.equal(a.net.savedMatch().token, open.token, "memory answers at once; the mirror is only for a reload");
  assert.deepEqual(a.sockets, [], "no socket and no fetch of its own");

  a.net.leave();
  await waitFor(() => !alice.mirror()[key]);
  assert.equal(a.net.savedMatch(), null, "leaving forgets the seat in both places");
  assert.deepEqual(a.log.errors, []);
});

test("a reloaded frame finds its seat in the mirror and takes it back", async (t) => {
  const table = await referee(t, "m2.db");
  const bus = relayBus();
  const alice = hangarTab(t, "alice", { bus });
  const bob = hangarTab(t, "bob", { bus });
  const a = alice.open();
  const b = bob.open();
  a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey, table: table.wsUrl });
  const open = await waitFor(() => a.log.states[0]);
  b.net.join({ code: open.code, name: "bob", affinity: "Signal", pubkey: bob.pubkey, table: table.wsUrl });
  const seated = await waitFor(() => b.log.states.find((s) => s.seat === 1 && s.status === "playing"));
  await waitFor(() => bob.mirror()[`${seated.matchId}:1`]);

  b.frame.kill(); // the Hangar closes the napplet, or the page reloads
  await waitFor(() => a.log.peers.some((p) => p.seat === 1 && p.online === false));
  const again = bob.open();
  assert.equal(again.started.resuming, false, "the mirror answers later than start() returns");
  const resumed = await again.started.restoring;
  assert.deepEqual([resumed.resuming, resumed.matchId, resumed.seat], [true, seated.matchId, 1]);
  const back = await waitFor(() => again.log.states.find((s) => s.matchId === seated.matchId));
  assert.deepEqual([back.seat, back.status, back.role, back.downgraded], [1, "playing", "seat", false]);
  assert.ok(back.view, "the whole view comes back with the seat");
  await waitFor(() => a.log.peers.some((p) => p.seat === 1 && p.online === true));
  assert.equal(bob.host.signRequests, 2, "one host-signed login per frame");
  assert.deepEqual(again.sockets, []);
});

test("a frame signed in as someone else never resumes a mirrored seat", async (t) => {
  const table = await referee(t, "m3.db");
  const storage = new Map();
  const alice = hangarTab(t, "alice", { storage });
  const a = alice.open();
  a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey, table: table.wsUrl });
  const open = await waitFor(() => a.log.states[0]);
  const mirror = await waitFor(() => (alice.mirror()[`${open.matchId}:0`] ? alice.mirror() : null));
  a.frame.kill();
  // Junk beside the real entry is ignored, never resumed.
  mirror.junk = { matchId: "m_000000000000", seat: 0, token: 7 };
  mirror["m_111111111111:1"] = { matchId: "m_111111111111", seat: 1, token: "t", pubkey: "not a key", seenAt: Date.now() + 1000 };
  storage.set("600b:seats", JSON.stringify(mirror));

  const guest = hangarTab(t, "guest", { storage }); // one app store, a different Hangar guest key
  const g = guest.open();
  assert.deepEqual(await g.started.restoring, { resuming: false });
  assert.equal(g.net.savedMatch(), null);
  assert.equal(guest.host.channels.size, 0, "no table is opened for a seat that is not this identity's");

  const back = alice.open();
  assert.equal((await back.started.restoring).resuming, true, "while alice, reopened, is back at her table");
  await waitFor(() => back.log.states.find((s) => s.matchId === open.matchId && s.seat === 0));
});

test("a storage that refuses every access costs the lobby nothing: create, join and resume", async (t) => {
  const table = await referee(t, "m4.db");
  const rejections = unhandled(t);
  const bus = relayBus();
  const alice = hangarTab(t, "alice", { bus });
  const bob = hangarTab(t, "bob", { bus });
  const a = alice.open({ storageApi: refusingStorage() });
  const b = bob.open({ storageApi: refusingStorage() });

  a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey, table: table.wsUrl });
  const open = await waitFor(() => a.log.states[0]);
  b.net.join({ code: open.code, name: "bob", affinity: "Signal", pubkey: bob.pubkey, table: table.wsUrl });
  const seated = await waitFor(() => b.log.states.find((s) => s.seat === 1 && s.status === "playing"));
  assert.equal(b.net.savedMatch().token, seated.token, "the credential is held in memory");

  // The socket drops: the frame resumes from memory, token and all.
  for (const ws of bob.host.channels.values()) ws.close();
  const resumed = await waitFor(() => b.log.states.find((s) => s !== seated && s.seat === 1), 8000);
  assert.deepEqual([resumed.matchId, resumed.downgraded], [seated.matchId, false]);

  // The frame reloads: nothing could be mirrored, so the identity finds the seat again.
  b.frame.kill();
  const again = bob.open({ storageApi: refusingStorage() });
  assert.deepEqual(await again.started.restoring, { resuming: false });
  assert.ok(again.net.rejoin(seated.matchId, table.wsUrl));
  const back = await waitFor(() => again.log.states.find((s) => s.matchId === seated.matchId && s.seat === 1));
  assert.equal(back.status, "playing");
  assert.equal(again.log.active[0][0].matchId, seated.matchId, "AUTH_OK.active names the seat the reload lost");

  assert.deepEqual([...a.log.errors, ...b.log.errors, ...again.log.errors], []);
  assert.deepEqual([...a.sockets, ...b.sockets, ...again.sockets], []);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(rejections, [], "no storage failure escaped as a rejection");
});

// ------------------------------------------------------ the table list, inside a shell

const sentOf = (host, type) => host.sent.filter((data) => JSON.parse(data).t === type).length;

test("inside a shell tables() signs in a lobby socket and reads TABLES there, never HTTP", async (t) => {
  const table = await referee(t, "l1.db");
  const alice = hangarTab(t, "alice");
  const bob = hangarTab(t, "bob");
  const a = alice.open();
  a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey, table: table.wsUrl });
  const open = await waitFor(() => a.log.states[0]);

  const b = bob.open({ scope: { E1_TABLE_URL: table.wsUrl } });
  await b.started.restoring;
  assert.equal(bob.host.channels.size, 0, "a lobby that has not asked for anything opens nothing");
  const rows = await b.net.tables();
  assert.deepEqual(rows.map((row) => row.code), [open.code]);
  assert.deepEqual(rows, await (await fetch(`${table.url}/api/tables`)).json(), "the rows the website reads");
  assert.deepEqual(b.sockets, [], "and no fetch of its own");
  assert.deepEqual([b.net.status, bob.host.signRequests], ["live", 1]);
  assert.deepEqual(b.log.active, [[]], "the lobby socket hears AUTH_OK.active");

  const [first, second] = await Promise.all([b.net.tables(), b.net.tables()]);
  assert.deepEqual(first, second);
  assert.equal(sentOf(bob.host, "TABLES"), 2, "two lists asked for at once share one TABLES");

  b.net.join({ code: rows[0].code, name: "bob", affinity: "Signal", pubkey: bob.pubkey });
  const seated = await waitFor(() => b.log.states.find((s) => s.seat === 1));
  assert.equal(seated.status, "playing");
  assert.equal(bob.host.signRequests, 1, "the join rides the lobby socket, with no second login");
  assert.deepEqual(await b.net.tables(), [], "a full table is listed no more");
});

test("a table list that cannot be had rejects with a code and keeps the socket", async (t) => {
  const table = await referee(t, "l2.db");
  const nobody = hangarTab(t, "nobody", { sk: null }); // nobody signed in at the Hangar
  const n = nobody.open({ scope: { E1_TABLE_URL: table.wsUrl } });
  await n.started.restoring;
  await assert.rejects(() => n.net.tables(), (err) => err.code === "NIP07_REQUIRED");
  assert.equal(n.log.errors[0].code, "NIP07_REQUIRED", "and the page hears why");
  assert.equal(nobody.host.channels.size, 0);

  const eager = hangarTab(t, "eager");
  const e = eager.open({ scope: { E1_TABLE_URL: table.wsUrl } });
  // Asked the moment the frame loads, before the shell's identity has answered: it waits for it.
  for (let i = 0; i < 10; i++) await e.net.tables();
  await assert.rejects(() => e.net.tables(), (err) => err.code === "RATE_LIMITED");
  assert.equal(e.net.status, "live", "a lobby that refreshed too eagerly keeps its socket");

  const older = hangarTab(t, "older");
  older.host.answerFor = (msg, reply) => msg.t === "TABLES" && (reply({ t: "ERROR", v: 1, code: "BAD_MESSAGE", message: "unknown message TABLES" }), true);
  const o = older.open({ scope: { E1_TABLE_URL: table.wsUrl } });
  await assert.rejects(() => o.net.tables(), (err) => err.code === "BAD_MESSAGE", "a referee that predates TABLES says so");
});

test("on the website tables() reads /api/tables until a signed-in socket is open, then asks that", async (t) => {
  const table = await referee(t, "l3.db");
  const sk = keyOf("website");
  const pubkey = hex(schnorr.getPublicKey(sk));
  const { net, log } = loadShell({
    nostr: { getPublicKey: async () => pubkey, signEvent: async (e) => signEvent(e, sk) },
    location: { protocol: "http:", host: `127.0.0.1:${table.port}`, href: `${table.url}/play.html`, search: "" },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => pubkey, setItem() {}, removeItem() {} } });
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { fetched.push(String(url)); return realFetch(url, init); };
  t.after(() => { globalThis.fetch = realFetch; });

  assert.deepEqual(await net.tables(), []);
  assert.deepEqual(fetched, [`${table.url}/api/tables`]);
  net.create({ name: "felix", affinity: "Power", pubkey, table: table.wsUrl });
  const open = await waitFor(() => log.states[0]);
  assert.deepEqual((await net.tables()).map((row) => row.code), [open.code]);
  assert.equal(fetched.length, 1, "the live socket is asked instead of HTTP");
  net.leave();
});

test("tableUrl() in a srcdoc frame: the build constant, else nappelin's referee", () => {
  const host = fakeHangar();
  assert.equal(loadShell({ host, shell: shellWith() }).net.tableUrl(), "wss://tcg.nappelin.com/ws");
  assert.equal(loadShell({ host, shell: shellWith(), tableUrl: "wss://tcg.zapburg.com/ws" }).net.tableUrl(), "wss://tcg.zapburg.com/ws");
  assert.equal(loadShell({ host, shell: shellWith(), tableUrl: "javascript:alert(1)" }).net.tableUrl(), "wss://tcg.nappelin.com/ws");
});

test("the website path through the adapter is a plain WebSocket and NIP-07", async (t) => {
  const table = await referee(t, "s5.db");
  const sk = Uint8Array.from(createHash("sha256").update("test:website-player").digest());
  const pubkey = hex(schnorr.getPublicKey(sk));
  const { net, N, log } = loadShell({
    nostr: { getPublicKey: async () => pubkey, signEvent: async (e) => signEvent(e, sk) },
    location: { protocol: "http:", host: "127.0.0.1", href: "http://127.0.0.1/play.html", search: "" },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => pubkey, setItem() {}, removeItem() {} } });
  assert.equal(N.table.available(), false, "no host window, no channel");
  net.create({ name: "felix", affinity: "Power", pubkey, table: table.wsUrl });
  const state = await waitFor(() => log.states[0]);
  assert.equal(state.seat, 0);
  assert.deepEqual(log.errors, []);
  net.leave();
});
