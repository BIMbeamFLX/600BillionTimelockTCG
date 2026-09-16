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
  // `options` holds what each query and subscription asked the router for, in order.
  const calls = { publish: [], query: [], subscribe: [], close: 0, options: { query: [], subscribe: [] } };
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
    query(filters, options) {
      const list = Array.isArray(filters) ? filters : [filters];
      calls.query.push(list);
      calls.options.query.push(options);
      return reply({ type: "outbox.query.result", id: "q", events: bus.query(list).map(hint) });
    },
    subscribe(filters, options) {
      const list = Array.isArray(filters) ? filters : [filters];
      calls.subscribe.push(list);
      calls.options.subscribe.push(options);
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
function loadFrame(frame, napplet, extra, pageScripts = "") {
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
  new Function("scope", `with (scope) {\n${NAPPLET_JS}\n;\n${NET_JS}\n;\n${pageScripts}\n}`)(scope);
  return { scope, net: scope.E1Net, N: scope.E1Napplet, sockets };
}

/* The whole table page in a frame of its own: play.html's scripts after the transport
 * (site/lobby.js, then play.js), over a stub document in client.test.mjs's shape, with
 * the frame's DOMContentLoaded fired by hand. `byId` reads what the page painted. */
const SITE_DIR = path.join(HERE, "..", "..", "site");
const TABLE_PAGE_JS = ["lobby.js", "play.js"].map((name) => fs.readFileSync(path.join(SITE_DIR, name), "utf8")).join("\n;\n");
const CARDS = require("../../site/play-data.js");
function stubNode(id) {
  const node = {
    id, hidden: false, textContent: "", value: "", className: "", innerHTML: "", disabled: false, checked: false,
    dataset: {}, children: [], listeners: {}, attributes: {},
    style: { setProperty(name, value) { this[name] = String(value); }, getPropertyValue(name) { return this[name] || ""; } },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    append(...kids) { for (const kid of kids) this.children.push(kid); },
    appendChild(kid) { this.children.push(kid); return kid; },
    prepend(kid) { this.children.unshift(kid); },
    closest: () => null,
    querySelectorAll: () => [],
    focus() {},
    remove() {},
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
  };
  const classes = () => String(node.className || "").split(" ").filter(Boolean);
  node.classList = {
    add(...names) { node.className = [...new Set([...classes(), ...names])].join(" "); },
    remove(...names) { node.className = classes().filter((name) => !names.includes(name)).join(" "); },
    toggle(name, force) {
      const on = force === undefined ? !classes().includes(name) : Boolean(force);
      if (on) this.add(name); else this.remove(name);
      return on;
    },
    contains: (name) => classes().includes(name),
  };
  return node;
}
function loadTableFrame(frame, napplet, extra) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, stubNode(id));
    return nodes.get(id);
  };
  const fired = {};
  const window = {
    addEventListener(type, fn) {
      if (type === "message") frame.window.addEventListener(type, fn);
      else (fired[type] = fired[type] || []).push(fn);
    },
    dispatchEvent() {},
    confirm: () => true,
  };
  const document = {
    body: byId("body"), getElementById: byId, createElement: (tag) => stubNode(tag), createTextNode: (text) => text,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
  const page = Object.assign({
    window, document, E1Engine: E, E1_CARDS: CARDS, E1CollectionStack: require("../../site/collection-stack.js"),
  }, extra || {});
  const loaded = loadFrame(frame, napplet, page, TABLE_PAGE_JS);
  for (const fn of fired.DOMContentLoaded || []) fn();
  return Object.assign(loaded, { byId, game: window.E1_GAME });
}

const keyOf = (label) => Uint8Array.from(createHash("sha256").update(`test:hangar:${label}`).digest());

/* A Hangar tab: one signed-in identity, one app store and one table channel, holding
 * frames that come and go the way a napplet is closed and opened again. `open()` starts
 * a frame the way play.js does (E1Net.start with handlers) and tracks its latest view. */
function hangarTab(t, label, { bus = relayBus(), sk = keyOf(label), storage = new Map() } = {}) {
  const host = fakeHangar({ sk });
  t.after(() => host.close());
  const tab = { label, host, bus, sk, pubkey: sk ? hex(schnorr.getPublicKey(sk)) : "", storage, clients: [] };
  /* The next frame and the prelude the Hangar installs in it. */
  const nextFrame = (storageApi) => {
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
    return { frame, napplet, outbox };
  };
  /* The table page itself in the next frame: it mounts the lobby and starts E1Net. */
  tab.openTable = ({ scope } = {}) => {
    const { frame, napplet, outbox } = nextFrame();
    const client = Object.assign(loadTableFrame(frame, napplet, scope), { tab, frame, outbox });
    tab.clients.push(client);
    return client;
  };
  tab.open = ({ storageApi, scope } = {}) => {
    const { frame, napplet, outbox } = nextFrame(storageApi);
    const client = Object.assign(loadFrame(frame, napplet, scope), { tab, frame, outbox, view: null });
    const log = { errors: [], states: [], frames: [], overs: [], rejects: [], peers: [], active: [], queued: [], nostr: [] };
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
      onNostr: (n) => log.nostr.push(n),
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

test("every read through the Hangar's outbox names the relays its publish does: looks, profiles, sessions and invites", async () => {
  /* nappelin's router has no NIP-65 relay lists. A query that names no relays only finds a
   * member's kind 0 through whatever fallback the router keeps, so each one names them. */
  const bus = relayBus();
  const outbox = kehtoOutbox(bus, HOST_SK);
  const { net, N } = loadShell({ host: fakeHangar(), shell: shellWith({ outbox }) });
  const look = require("../../site/identity-look.js");
  bus.publish(signEvent({ kind: 0, created_at: 1, tags: [], content: JSON.stringify({ display_name: "Felix" }) }, HOST_SK));

  await N.outbox.publish(net.nostr.inviteEvent({ matchId: "m_0123456789ab", code: "ABCDEF", table: "wss://t.example/ws", name: "f", affinity: "Power" }));
  const published = outbox.calls.publish[0].options.relays;
  assert.deepEqual(published, ["wss://relay.nappelin.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]);

  assert.equal((await net.nostr.profile(HOST_PUBKEY)).name, "Felix", "net.js profile()");
  assert.deepEqual(await net.nostr.sessions(HOST_PUBKEY), [], "net.js sessions()");
  const seen = await look.resolve(HOST_PUBKEY, { query: (filters) => N.outbox.query(filters), verify: (event) => globalThis.E1Schnorr.verifyEvent(event) });
  assert.deepEqual([seen.name, seen.nameVia], ["Felix", "display_name"], "an opponent's look, the way play.js asks for it");
  const unsubscribe = net.nostr.subscribeInvites(HOST_PUBKEY, () => {});
  unsubscribe();

  assert.equal(outbox.calls.options.query.length, 4, "one profile, two for sessions, one look");
  assert.equal(outbox.calls.options.subscribe.length, 1);
  for (const options of [...outbox.calls.options.query, ...outbox.calls.options.subscribe]) {
    assert.deepEqual(options, { relays: published }, "the same four relays, and nothing else asked of the router");
  }
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
  const { net, log, pubkey } = websitePage(table, "website");
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

// ---------------------------------------------------------- no stakes inside a shell

const sentMessage = (host, type) => {
  const data = host.sent.find((text) => JSON.parse(text).t === type);
  return data ? JSON.parse(data) : null;
};

/* A website page at the referee's own origin, signed in with NIP-07. */
function websitePage(table, label) {
  const sk = keyOf(label);
  const pubkey = hex(schnorr.getPublicKey(sk));
  const page = loadShell({
    nostr: { getPublicKey: async () => pubkey, signEvent: async (e) => signEvent(e, sk) },
    location: { protocol: "http:", host: `127.0.0.1:${table.port}`, href: `${table.url}/play.html`, search: "" },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => pubkey, setItem() {}, removeItem() {} } });
  return Object.assign(page, { pubkey });
}

test("inside a shell every table is a friendly, whatever stake the lobby passes", async (t) => {
  const table = await referee(t, "k1.db");
  const alice = hangarTab(t, "alice");
  const a = alice.open();
  assert.equal(a.net.stakesAllowed(), false);
  a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey, table: table.wsUrl, stake: 2100 });
  const open = await waitFor(() => a.log.states[0]);
  assert.equal(open.stake, 0);
  assert.equal(sentMessage(alice.host, "CREATE").stake, 0, "CREATE carries stake 0");
  a.net.leave();

  const bob = hangarTab(t, "bob");
  const carol = hangarTab(t, "carol");
  const b = bob.open();
  const c = carol.open();
  b.net.queue({ name: "bob", affinity: "Power", pubkey: bob.pubkey, table: table.wsUrl, stake: 500 });
  c.net.queue({ name: "carol", affinity: "Signal", pubkey: carol.pubkey, table: table.wsUrl });
  const dealt = await waitFor(() => b.log.states.find((s) => s.status === "playing"));
  assert.equal(dealt.stake, 0);
  assert.equal(sentMessage(bob.host, "QUEUE").stake, 0, "QUEUE waits for a friendly");
});

test("a staked table refuses an embedded join with STAKE_MISMATCH and seats nobody", async (t) => {
  const table = await referee(t, "k2.db");
  const site = websitePage(table, "website-host");
  assert.equal(site.net.stakesAllowed(), true, "the website still plays for sats");
  site.net.create({ name: "host", affinity: "Power", pubkey: site.pubkey, table: table.wsUrl, stake: 2100 });
  const staked = await waitFor(() => site.log.states[0]);
  assert.equal(staked.stake, 2100);

  const guest = hangarTab(t, "guest");
  const g = guest.open();
  // Even a lobby that passes the number it was shown joins with an explicit 0 from the embed.
  g.net.join({ code: staked.code, name: "guest", affinity: "Signal", pubkey: guest.pubkey, table: table.wsUrl, stake: 2100 });
  const refused = await waitFor(() => g.log.errors.find((e) => e.code === "STAKE_MISMATCH"));
  assert.match(refused.message, /2100 sats/);
  assert.equal(sentMessage(guest.host, "JOIN").stake, 0);
  assert.equal(g.log.states.length, 0, "the guest is never seated");
  assert.equal(g.net.session, null);
  const row = table.db.prepare("SELECT status, seat1_pubkey FROM matches WHERE match_id=?").get(staked.matchId);
  assert.deepEqual([row.status, row.seat1_pubkey], ["open", null]);
  const listed = await (await fetch(`${table.url}/api/tables`)).json();
  assert.deepEqual(listed.map((entry) => [entry.code, entry.stake]), [[staked.code, 2100]], "still open, still for sats");
  site.net.leave();
});

// ------------------------------------------------------------ the launch code

test("the code a frame was launched with is read once, checked again, and never throws", () => {
  const host = fakeHangar();
  const launched = (context) => loadFrame(host.openFrame(), shellWith(), context === undefined ? {} : { nappletContext: context });

  const frozen = launched(Object.freeze({ args: Object.freeze({ code: "K7M2QF" }) }));
  assert.equal(frozen.net.launchCode(), "K7M2QF");
  assert.equal(frozen.net.launchCode(), null, "a second read hands over nothing");

  assert.equal(launched(undefined).net.launchCode(), null, "no launch context");
  assert.equal(launched(Object.freeze({ target: { pubkey: HOST_PUBKEY } })).net.launchCode(), null, "a context without args");
  for (const code of ["k7m2qf", "K7M2Q0", "K7M2QI", "K7M2QFX", " K7M2QF", 123456, null, ["K7M2QF"]]) {
    assert.equal(launched({ args: { code } }).net.launchCode(), null, `untrusted ${JSON.stringify(code)}`);
  }

  const throwingArgs = launched(Object.defineProperty({}, "args", { get() { throw new Error("no args for you"); } }));
  assert.equal(throwingArgs.net.launchCode(), null);
  const throwingCode = launched({ args: Object.defineProperty({}, "code", { get() { throw new Error("no code"); } }) });
  assert.equal(throwingCode.net.launchCode(), null);
  const throwingContext = launched(undefined);
  Object.defineProperty(throwingContext.scope, "nappletContext", { configurable: true, get() { throw new Error("SecurityError"); } });
  assert.equal(throwingContext.net.launchCode(), null);
});

test("on the website a ?code= is read once and taken out of the address bar, valid or not", (t) => {
  const replaced = [];
  globalThis.history = { state: { board: 1 }, replaceState: (state, title, url) => replaced.push([state, url]) };
  t.after(() => { delete globalThis.history; });
  const at = (query) => ({
    protocol: "https:", host: "tcg.nappelin.com", search: query,
    href: `https://tcg.nappelin.com/matchmaking.html${query}#lobby`,
  });

  const shared = loadShell({ location: at("?match=m_0123456789ab&code=K7M2QF&rules=F1.0") });
  assert.deepEqual(replaced, [[{ board: 1 }, "/matchmaking.html?match=m_0123456789ab&rules=F1.0#lobby"]]);
  assert.equal(shared.net.session.code, "K7M2QF", "the shared link's session still knows its code");
  assert.equal(shared.net.launchCode(), "K7M2QF");
  assert.equal(shared.net.launchCode(), null);
  shared.net.start({});
  assert.equal(replaced.length, 1, "read once: a second start() does not rewrite the address again");

  replaced.length = 0;
  const junk = loadShell({ location: at("?code=nope") });
  assert.deepEqual(replaced.map(([, url]) => url), ["/matchmaking.html#lobby"], "an invalid code leaves the address too");
  assert.equal(junk.net.launchCode(), null);

  replaced.length = 0;
  loadShell({ location: at("?rules=F1.0") });
  assert.deepEqual(replaced, [], "an address without a code is left alone");
});

// ------------------------------------------------------------ two shells, one table

const E = require("../../site/engine.js");

/* One legal, uneventful move for `seat`, taken from the engine's own list for the view
 * this seat holds: pass priority, or declare nothing when the game waits on it. */
function quietMove(client) {
  const view = client.view;
  const seat = client.log.states.at(-1) && client.log.states.at(-1).seat;
  if (!view || view.result || (seat !== 0 && seat !== 1)) return null;
  const legal = E.legalActions(view, seat);
  const pick = legal.find((action) => action.type === "PASS_PRIORITY")
    || legal.find((action) => ["DECLARE_ATTACKERS", "DECLARE_BLOCKERS"].includes(action.type));
  return pick ? Object.assign({ at: "" }, pick) : null;
}

/* Play's own order for a signed moment (site/play.js signAndSend): sign, publish, record. */
async function signAndSend(client, role, template) {
  const signed = await client.net.nostr.sign(template);
  const published = await client.net.nostr.publish(signed);
  client.net.sendNostr(role, signed);
  return { signed, published };
}

test("two Hangar tabs meet by invite, play a table to OVER through their hosts, and survive a reload", async (t) => {
  const table = await referee(t, "e2e.db");
  const rejections = unhandled(t);
  const bus = relayBus();
  const build = { E1_TABLE_URL: table.wsUrl }; // what scripts/build_napplet.py injects
  const alice = hangarTab(t, "alice", { bus });
  const bob = hangarTab(t, "bob", { bus });
  const a = alice.open({ scope: build });
  const b = bob.open({ scope: build });
  await Promise.all([a.started.restoring, b.started.restoring]);

  // Bob listens for invites before there are any; Alice opens a table and invites him.
  const invites = [];
  b.net.nostr.subscribeInvites(bob.pubkey, (invite) => invites.push(invite));
  a.net.create({ name: "alice", affinity: "Power", pubkey: alice.pubkey });
  const open = await waitFor(() => a.log.states.find((s) => s.status === "open"));
  const invited = await signAndSend(a, "invite", a.net.nostr.inviteEvent({
    matchId: open.matchId, code: open.code, table: a.net.publicTable(), name: "alice", affinity: "Power",
    ruleset: open.ruleset, catalogDigest: open.catalogDigest, stake: open.stake, to: bob.pubkey,
  }));
  assert.equal(invited.published.ok, true, invited.published.error);
  assert.equal(invited.signed.pubkey, alice.pubkey, "Alice's host signed the invite");
  const invite = await waitFor(() => invites[0]);
  assert.deepEqual([invite.code, invite.matchId, invite.pubkey, invite.stake], [open.code, open.matchId, alice.pubkey, 0]);

  // He sees the same table in the list over the socket, and joins it by its code.
  const rows = await b.net.tables();
  assert.ok(rows.some((row) => row.code === invite.code), "the invited table is listed over TABLES");
  b.net.join({ code: invite.code, name: "bob", affinity: "Signal", pubkey: bob.pubkey, table: invite.table, stake: invite.stake });
  const seated = await waitFor(() => b.log.states.find((s) => s.seat === 1 && s.status === "playing"));
  await waitFor(() => a.log.states.find((s) => s.seat === 0 && s.status === "playing"));
  assert.equal(seated.matchId, open.matchId);

  // Bob's frame is reloaded mid-game: the mirror hands the seat back.
  await waitFor(() => bob.mirror()[`${seated.matchId}:1`]);
  b.frame.kill();
  const b2 = bob.open({ scope: build });
  assert.equal((await b2.started.restoring).resuming, true);
  await waitFor(() => b2.log.states.find((s) => s.matchId === seated.matchId && s.seat === 1 && s.view));

  // A few legal moves from the engine's own list, then Alice concedes.
  let moved = 0;
  for (let round = 0; round < 40 && moved < 6; round += 1) {
    const client = [a, b2].find((c) => quietMove(c));
    if (!client) break;
    const move = quietMove(client);
    assert.ok(client.net.act(move));
    await waitFor(() => (client.view.seq > move.seq) || client.log.rejects.some((r) => r.seq === move.seq));
    if (client.view.seq > move.seq) moved += 1;
    else break;
    await waitFor(() => [a, b2].every((c) => c.view.seq === client.view.seq));
  }
  assert.ok(moved >= 4, `the seats played legal moves over their hosts (${moved})`);
  assert.ok(a.net.act({ type: "CONCEDE", seat: 0, seq: a.view.seq, at: "", payload: {} }));
  const [overA, overB] = await Promise.all([waitFor(() => a.log.overs[0]), waitFor(() => b2.log.overs[0])]);
  assert.deepEqual(overB.result.winners, [1]);
  assert.equal(overA.resultContent, overB.resultContent, "both seats hold the same bytes to sign");

  // Both results go out through each tab's own outbox, and the referee sees them agree.
  const results = await Promise.all([
    signAndSend(a, "result", a.net.nostr.resultEvent(overA)),
    signAndSend(b2, "result", b2.net.nostr.resultEvent(overB)),
  ]);
  for (const { published } of results) assert.equal(published.ok, true, published.error);
  const onRelays = bus.events.filter((event) => event.kind === 31600);
  assert.deepEqual(onRelays.map((event) => event.pubkey).sort(), [alice.pubkey, bob.pubkey].sort());
  assert.equal(onRelays[0].content, onRelays[1].content, "identical content, two signatures");
  const agreed = await waitFor(() => b2.log.nostr.find((n) => n.agreement === "confirmed"));
  assert.equal(agreed.events.length, 2);

  assert.deepEqual([...a.sockets, ...b.sockets, ...b2.sockets], [], "no socket or fetch of their own, ever");
  assert.deepEqual([...a.log.errors, ...b2.log.errors], []);
  assert.deepEqual(rejections, []);
});

test("two Hangar tabs open a table and join it by its code in their table pages' lobbies, and both boards show", async (t) => {
  const table = await referee(t, "lobbies.db");
  E.setCatalog(CARDS);
  const bus = relayBus();
  const build = { E1_TABLE_URL: table.wsUrl };
  const alice = hangarTab(t, "alice", { bus });
  const bob = hangarTab(t, "bob", { bus });
  const a = alice.openTable({ scope: build });
  const b = bob.openTable({ scope: build });
  for (const page of [a, b]) {
    assert.equal(page.byId("first").hidden, false, "each frame opens on its first screen");
    await waitFor(() => !["", "Not signed in"].includes(page.byId("firstName").textContent), 5000);
    page.byId("modeOnline").click();
  }

  a.byId("netName").value = "alice";
  a.byId("createTable").click();
  const code = await waitFor(() => (/^[A-HJ-NP-Z2-9]{6}$/.test(a.byId("tableCode").textContent) ? a.byId("tableCode").textContent : null));
  assert.equal(a.byId("hostPanel").hidden, false, "alice reads her code in the lobby");
  assert.equal(alice.host.signRequests, 1, "her host signed her table login");

  b.byId("netName").value = "bob";
  b.byId("joinCode").value = code.toLowerCase();
  b.byId("joinTable").click();
  await waitFor(() => a.byId("setup").hidden === true && b.byId("setup").hidden === true);
  assert.deepEqual([a.byId("table").hidden, b.byId("table").hidden], [false, false], "the lobby made way for the board in both frames");
  assert.deepEqual([a.game.mode, a.game.seat, b.game.mode, b.game.seat], ["seat", 0, "seat", 1]);
  assert.deepEqual([a.byId("foeName").textContent, b.byId("foeName").textContent], ["bob", "alice"], "each board names the other member");
  assert.ok(a.game.state.zones["0:wallet"].length > 0 && b.game.state.zones["1:wallet"].length > 0, "and each holds its own hand");
  const join = JSON.parse(bob.host.sent.find((data) => JSON.parse(data).t === "JOIN"));
  assert.deepEqual([join.code, join.stake], [code, 0], "joined by the code, for no stake");
  assert.deepEqual([...a.sockets, ...b.sockets], [], "no socket or fetch of their own");
});

test("a host who reloads the table page is back at their own open table, offered to them as Rejoin and never as Join", async (t) => {
  const table = await referee(t, "reload-host.db");
  const build = { E1_TABLE_URL: table.wsUrl };
  const alice = hangarTab(t, "alice");
  const a = alice.openTable({ scope: build });
  await waitFor(() => !["", "Not signed in"].includes(a.byId("firstName").textContent));
  a.byId("modeOnline").click();
  a.byId("netName").value = "alice";
  a.byId("createTable").click();
  const code = await waitFor(() => (/^[A-HJ-NP-Z2-9]{6}$/.test(a.byId("tableCode").textContent) ? a.byId("tableCode").textContent : null));
  const matchId = a.net.lastState.matchId;
  await waitFor(() => alice.mirror()[`${matchId}:0`]);

  a.frame.kill(); // the Hangar closes the frame, or the member reloads it
  const again = alice.openTable({ scope: build });
  assert.equal(again.byId("lobby").hidden, true, "the reloaded frame opens on its first screen");
  await waitFor(() => again.byId("tableCode").textContent === code);
  assert.deepEqual([again.byId("lobby").hidden, again.byId("hostPanel").hidden], [false, false], "and shows the table it took back");
  assert.equal(again.byId("modeOnline").getAttribute("aria-pressed"), "true");

  const row = await waitFor(() => again.byId("tableList").children.find((item) => item.children && item.children[0] && item.children[0].textContent.startsWith(code)));
  assert.equal(row.children[0].textContent, `${code} · alice · Power · your table`);
  assert.deepEqual(row.children.slice(1).map((button) => button.textContent), ["Rejoin"], "its own row offers the seat back, not a Join");
  row.children[1].click();
  await waitFor(() => sentOf(alice.host, "RESUME") === 2);
  assert.equal(sentOf(alice.host, "JOIN"), 0, "nothing ever asked to join it");
  assert.deepEqual([...a.sockets, ...again.sockets], []);
});

test("two Hangar tabs find each other in the quick match", async (t) => {
  const table = await referee(t, "quick.db");
  const build = { E1_TABLE_URL: table.wsUrl };
  const carol = hangarTab(t, "carol");
  const dave = hangarTab(t, "dave");
  const c = carol.open({ scope: build });
  const d = dave.open({ scope: build });
  c.net.queue({ name: "carol", affinity: "Power", pubkey: carol.pubkey });
  await waitFor(() => c.log.queued.find((q) => q.queued && q.position === 1));
  d.net.queue({ name: "dave", affinity: "Keys", pubkey: dave.pubkey });
  const [dealtC, dealtD] = await Promise.all([
    waitFor(() => c.log.states.find((s) => s.status === "playing")),
    waitFor(() => d.log.states.find((s) => s.status === "playing")),
  ]);
  assert.equal(dealtC.matchId, dealtD.matchId);
  assert.deepEqual([dealtC.seat, dealtD.seat].sort(), [0, 1]);
  assert.deepEqual([dealtC.stake, dealtD.stake], [0, 0]);
  assert.equal(c.net.queued, null, "the line is left once a seat is dealt");
  assert.deepEqual(await d.net.tables(), [], "a dealt match is no open table");
  assert.deepEqual([...c.sockets, ...d.sockets], []);
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
