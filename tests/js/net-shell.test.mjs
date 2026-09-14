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
 * sign rules. `sk === null` models nobody signed in at the Hangar. */
function fakeHangar({ sk = HOST_SK, allow = () => true } = {}) {
  const listeners = [];
  const channels = new Map();
  const host = { signRequests: 0, channels, frame: null, parent: null, deliver: null };
  let n = 0;
  host.frame = { addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); } };
  host.deliver = (data, source = host.parent) => { for (const fn of listeners) fn({ source, data }); };
  const answer = (msg) => host.deliver(msg);
  function handle(msg) {
    if (msg.type === "table.open") {
      if (!allow(msg.url)) return answer({ type: "table.open.result", id: msg.id, ok: false, error: "table origin not allowed" });
      const channel = `c${++n}`;
      const ws = new WebSocket(msg.url);
      channels.set(channel, ws);
      ws.on("open", () => answer({ type: "table.opened", channel }));
      ws.on("message", (raw) => answer({ type: "table.message", channel, data: String(raw) }));
      ws.on("close", (code, reason) => { channels.delete(channel); answer({ type: "table.closed", channel, code, reason: String(reason) }); });
      ws.on("error", () => {});
      return answer({ type: "table.open.result", id: msg.id, ok: true, channel });
    }
    if (msg.type === "table.send") { const ws = channels.get(msg.channel); if (ws && ws.readyState === 1) ws.send(msg.data); return; }
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
  host.parent = { postMessage: (msg) => queueMicrotask(() => handle(msg)) };
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
  t.after(() => table.close());
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
