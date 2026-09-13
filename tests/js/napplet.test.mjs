/* The napplet adapter's whole job is that a MISSING capability is a fallback,
 * never a failure — so these tests are mostly about absence. The website is the
 * case where every optional domain is missing, which is why the fallback path
 * has to be the well-tested one.
 *
 * Run: node --test tests/js/napplet.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, "../../site/napplet.js"), "utf8");

/** A fresh adapter over a chosen environment. The module reads its shell once, at
 *  load, so each scenario needs its own evaluation. */
function load(env) {
  const scope = Object.assign({ module: { exports: {} } }, env);
  scope.globalThis = scope;
  const keys = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  new Function(...keys, SOURCE)(...keys.map((k) => scope[k]));
  return scope.module.exports;
}

function memoryStorage() {
  const map = new Map();
  return {
    api: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    },
    map,
  };
}

const stubRoot = () => {
  const set = new Map();
  return {
    documentElement: {
      clientWidth: 1200,
      style: { setProperty: (name, value) => set.set(name, value) },
    },
    __set: set,
  };
};

// --------------------------------------------------------------- no shell

test("with no shell at all, every domain reports its fallback", () => {
  const store = memoryStorage();
  const N = load({ localStorage: store.api, document: stubRoot() });
  assert.equal(N.present, false);
  const report = N.report();
  assert.equal(report.shell, false);
  assert.equal(report.storage, "localStorage");
  assert.equal(report.theme, "fallback palette");
  assert.equal(report.identity, "none");
});

test("storage falls through to localStorage and round-trips JSON", async () => {
  const store = memoryStorage();
  const N = load({ localStorage: store.api, document: stubRoot() });
  await N.storage.setJson("600b:decks", { mine: ["E1-001", "E1-002"] });
  assert.deepEqual(await N.storage.json("600b:decks"), { mine: ["E1-001", "E1-002"] });
  assert.equal(store.map.get("600b:decks"), '{"mine":["E1-001","E1-002"]}');
  await N.storage.remove("600b:decks");
  assert.equal(await N.storage.json("600b:decks", "gone"), "gone");
});

test("a storage backend that throws does not take the page down", async () => {
  /* Private mode makes localStorage throw on write, and a card game that
   * white-screens because it could not save a preference is a worse bug than
   * one that forgets the preference. */
  const hostile = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("denied"); },
  };
  const N = load({ localStorage: hostile, document: stubRoot() });
  assert.equal(await N.storage.get("anything"), null);
  assert.equal(await N.storage.set("anything", "value"), false);
  assert.deepEqual(await N.storage.json("anything", []), []);
});

test("the 512 KB shell budget is refused loudly, not truncated quietly", async () => {
  const store = memoryStorage();
  const N = load({ localStorage: store.api, document: stubRoot() });
  await assert.rejects(() => N.storage.set("big", "x".repeat(N.QUOTA + 1)), /storage budget/);
  assert.equal(store.map.has("big"), false, "nothing half-written is left behind");
});

// ---------------------------------------------------------------- identity

test("identity prefers the shell, then NIP-07, then says so plainly", async () => {
  const KEY = "a".repeat(64);
  const store = memoryStorage();

  const nip07 = load({
    localStorage: store.api,
    document: stubRoot(),
    nostr: { getPublicKey: async () => KEY, signEvent: async (e) => Object.assign({ sig: "ok" }, e) },
  });
  assert.equal(nip07.identity.source(), "nip07");
  assert.equal(await nip07.identity.login(), KEY);
  assert.equal(await nip07.identity.current(), KEY, "and it is remembered");

  /* The shell's identity is ONE call, getPublicKey() — there is no get(), no
   * request(), no signEvent. An adapter that asked for those never activated. */
  const shelled = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { identity: { getPublicKey: async () => KEY.toUpperCase() } },
  });
  assert.equal(shelled.identity.source(), "shell");
  assert.equal(await shelled.identity.current(), KEY, "normalised to lowercase hex");
  assert.equal(await shelled.identity.login(), KEY);

  const signedOut = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { identity: { getPublicKey: async () => "" } },
  });
  assert.equal(await signedOut.identity.current(), null, "an empty string is nobody");
  await assert.rejects(() => signedOut.identity.login(), /sign in to the shell/);

  const bare = load({ localStorage: memoryStorage().api, document: stubRoot() });
  assert.equal(await bare.identity.current(), null);
  await assert.rejects(() => bare.identity.login(), /NIP-07|napplet shell/);
});

test("a junk identity from either source is refused rather than seated", async () => {
  const bad = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { identity: { getPublicKey: async () => "not-a-key" } },
  });
  assert.equal(await bad.identity.current(), null);
  await assert.rejects(() => bad.identity.login(), /usable identity/);
});

test("the shell has no general signer: sign() says where signing actually happens", async () => {
  const shelled = load({ localStorage: memoryStorage().api, document: stubRoot(), napplet: { identity: {} } });
  await assert.rejects(() => shelled.identity.sign({ kind: 1 }), /outbox\.publish and table\.sign/);
  const withExtension = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { identity: {} },
    nostr: { signEvent: async (e) => Object.assign({ sig: "nip07" }, e) },
  });
  assert.equal((await withExtension.identity.sign({ kind: 1 })).sig, "nip07", "a NIP-07 signer is still honoured");
});

test("NIP-44 stays inside the signer and disappears cleanly when unavailable", async () => {
  const KEY = "b".repeat(64);
  const calls = [];
  const withNip44 = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    nostr: {
      getPublicKey: async () => KEY,
      nip44: {
        encrypt: async (pubkey, plaintext) => {
          calls.push(["encrypt", pubkey, plaintext]); return "sealed";
        },
        decrypt: async (pubkey, ciphertext) => {
          calls.push(["decrypt", pubkey, ciphertext]); return "opened";
        },
      },
    },
  });
  assert.equal(withNip44.identity.nip44.available(), true);
  assert.equal(await withNip44.identity.nip44.encrypt(KEY, "wallet"), "sealed");
  assert.equal(await withNip44.identity.nip44.decrypt(KEY, "sealed"), "opened");
  assert.deepEqual(calls, [["encrypt", KEY, "wallet"], ["decrypt", KEY, "sealed"]]);

  const bare = load({ localStorage: memoryStorage().api, document: stubRoot() });
  assert.equal(bare.identity.nip44.available(), false);
  await assert.rejects(() => bare.identity.nip44.encrypt(KEY, "wallet"), /does not offer NIP-44/);
});

// ------------------------------------------------------------------- theme

test("without a theme domain the fallback palette is painted", () => {
  const doc = stubRoot();
  const N = load({ localStorage: memoryStorage().api, document: doc });
  N.theme.start();
  assert.equal(doc.__set.get("--black"), "#09080B");
  assert.equal(doc.__set.get("--ember"), "#FF6A00");
  assert.equal(doc.__set.get("--cream"), "#FFF7EC");
});

test("a shell theme repaints the chrome but can never repaint an affinity", () => {
  /* The five Plate colours are how a player reads the board and they must match
   * the printed cards, so they are brand-fixed by the spec. A shell that themes
   * them would make the game unreadable in a way the player cannot fix. */
  const doc = stubRoot();
  let handler = null;
  const N = load({
    localStorage: memoryStorage().api,
    document: doc,
    napplet: {
      theme: {
        colors: { background: "#ffffff", text: "#000000", primary: "#0000ff", surface: "#eeeeee" },
        onChanged: (fn) => { handler = fn; },
      },
    },
  });
  N.theme.start();
  assert.equal(doc.__set.get("--black"), "#ffffff", "the shell owns the chrome");
  assert.equal(doc.__set.get("--ember"), "#0000ff", "the single ACTION colour, not the legacy alias");
  assert.equal(doc.__set.get("--orange"), "#0000ff", "and the alias is kept in step");
  assert.equal(doc.__set.get("--steel"), "#eeeeee", "surfaces are a family, not one token");
  assert.equal(doc.__set.get("--panel-2"), "#eeeeee");
  assert.equal(doc.__set.get("--plate-B"), "#F7931A", "and never the affinities");
  assert.equal(doc.__set.get("--plate-T"), "#17BEBB");

  assert.equal(typeof handler, "function", "a theme change must be subscribed to");
  handler({ colors: { background: "#111111" } });
  assert.equal(doc.__set.get("--black"), "#111111", "and repainted when it changes");
  assert.equal(doc.__set.get("--plate-B"), "#F7931A", "still never the affinities");
});

test("a shell that offers a broken theme domain still gets a painted page", () => {
  const doc = stubRoot();
  const N = load({
    localStorage: memoryStorage().api,
    document: doc,
    napplet: { theme: { get() { throw new Error("no theme"); } } },
  });
  N.theme.start();
  assert.equal(doc.__set.get("--black"), "#09080B", "a thrown theme falls back, it does not blank");
});

// ------------------------------------------------------------------ outbox

test("with no outbox and no relays, results stay local and say so", async () => {
  const N = load({ localStorage: memoryStorage().api, document: stubRoot() });
  const res = await N.outbox.publish({ kind: 31600 });
  assert.equal(res.ok, false);
  assert.equal(res.via, "none");
  assert.match(res.error, /stay local/);
  assert.equal(N.outbox.available(), false);
});

test("a shell outbox is preferred over relays, and its refusal is reported not thrown", async () => {
  const N = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { outbox: { publish: async () => { throw new Error("declined"); } } },
  });
  const res = await N.outbox.publish({ kind: 31600 });
  assert.equal(res.ok, false, "a match that cannot be announced is still a match that was played");
  assert.equal(res.via, "shell");
});

// ------------------------------------------------------------------- shape

test("the layout contract measures the element, not the window", () => {
  const wide = stubRoot();
  const N = load({ localStorage: memoryStorage().api, document: wide });
  assert.equal(N.shape(), "large");

  /* THE CASE THAT MATTERS: a narrow panel inside a wide window. Measuring only
   * documentElement called this "large" and every layout branch got it wrong. */
  const panel = { getBoundingClientRect: () => ({ width: 320 }) };
  assert.equal(N.shape(panel), "tiny");
  assert.equal(N.shape({ getBoundingClientRect: () => ({ width: 900 }) }), "large");

  const narrow = stubRoot();
  narrow.documentElement.clientWidth = 320;
  assert.equal(load({ localStorage: memoryStorage().api, document: narrow }).shape(), "tiny");
});

test("a sandbox that blocks outbound fetch is detectable before anything is tried", () => {
  /* Sats settlement needs an LNURL round trip, which a sandbox may forbid --
   * the reason stakes are out of scope for napplet v1. The settlement UI asks
   * this so it can offer a lightning address instead of failing at a wall. */
  const open = load({ localStorage: memoryStorage().api, document: stubRoot() });
  assert.equal(open.canReachInternet(), true);
  const closed = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { sandbox: {} },
  });
  assert.equal(closed.canReachInternet(), false);
});

// ---------------------------------------------------------------- resource

test("without a resource domain, art is just a path", async () => {
  const N = load({ localStorage: memoryStorage().api, document: stubRoot() });
  assert.equal(N.resource.available(), false);
  assert.equal(await N.resource.url("../art/cards/x.webp"), "../art/cards/x.webp");
  assert.equal(await N.resource.bytes("../art/cards/x.webp"), null);
});

test("a shell resource domain delivers bytes, cached and bounded", async () => {
  /* The page could previously only ASK whether this domain existed, and had to
   * fall back to text cards in exactly the case it was built for. */
  const asked = [];
  const revoked = [];
  const N = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    URL: {
      createObjectURL: (blob) => `blob:${asked.length}:${blob.size}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    Blob: class { constructor(parts) { this.size = parts[0].length; } },
    napplet: {
      resource: {
        bytes: async (path) => { asked.push(path); return new Uint8Array([1, 2, 3]); },
      },
    },
  });
  assert.equal(N.resource.available(), true);

  const first = await N.resource.url("a.webp");
  assert.match(first, /^blob:/);
  const again = await N.resource.url("a.webp");
  assert.equal(again, first, "a second look is served from cache");
  assert.equal(asked.length, 1, "and does not ask the shell twice");

  /* Each object URL pins its blob for the life of the document, so an unbounded
   * cache of 296 card faces is a leak with a number attached. */
  for (let i = 0; i < 70; i++) await N.resource.url(`fill-${i}.webp`);
  assert.ok(revoked.length > 0, "evicted entries must be revoked, not merely dropped");
});

test("a resource domain that returns nothing falls back to the path", async () => {
  const N = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { resource: { bytes: async () => { throw new Error("gone"); } } },
  });
  assert.equal(await N.resource.url("b.webp"), "b.webp", "a broken domain is a fallback, not a failure");
});

// ------------------------------------------------------------------- embed

/* A host page: the napplet's own `window` (where replies arrive) and `parent`
 * (where requests go). `deliver` plays the host answering. */
function fakeHost(onPost) {
  const listeners = [];
  const host = { posted: [] };
  host.window = { addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); } };
  host.deliver = (data, source = host.parent) => { for (const fn of listeners) fn({ source, data }); };
  host.parent = { postMessage: (msg) => { host.posted.push(msg); if (onPost) onPost(msg, host); } };
  return host;
}
const base = () => ({ localStorage: memoryStorage().api, document: stubRoot() });

test("embedded() is the prelude object, the roster context, or ?embed=1 — and escape() needs a host", () => {
  assert.equal(load(base()).embedded(), false);
  assert.equal(load(Object.assign(base(), { napplet: {} })).embedded(), true, "a shell with no domains is still a shell");
  assert.equal(load(Object.assign(base(), { nappletContext: { roster: true } })).embedded(), true);
  assert.equal(load(Object.assign(base(), { location: { search: "?seed=1&embed=1" } })).embedded(), true);
  assert.equal(load(Object.assign(base(), { location: { search: "?embed=10" } })).embedded(), false);

  const host = fakeHost();
  const N = load(Object.assign(base(), { napplet: {}, window: host.window, parent: host.parent }));
  assert.equal(N.escape(), true);
  assert.deepEqual(host.posted, [{ type: "nappelin.escape" }]);
  assert.equal(load(base()).escape(), false, "no host, no escape — the page keeps its own links");
});

test("under embed with no shell theme, nappelin's tokens are painted, not 600B's", () => {
  const doc = stubRoot();
  const N = load({ localStorage: memoryStorage().api, document: doc, napplet: {} });
  N.theme.start();
  assert.equal(doc.__set.get("--black"), "#0f0c08", "iron");
  assert.equal(doc.__set.get("--cream"), "#ece3d0", "parchment");
  assert.equal(doc.__set.get("--ember"), "#e7bf76", "brass is the action colour");
  assert.equal(doc.__set.get("--panel-2"), "#1f1911", "the exact token beats the surface family");
  assert.equal(doc.__set.get("--good"), "#6de8a6");
  assert.equal(doc.__set.get("--plate-B"), "#F7931A", "affinities are still never themed");
  assert.equal(N.report().theme, "nappelin palette");
  const preview = stubRoot();
  load({ localStorage: memoryStorage().api, document: preview, location: { search: "?embed=1" } }).theme.start();
  assert.equal(preview.__set.get("--black"), "#0f0c08", "the local preview paints the same");
});

// ---------------------------------------------------------- outbox (shell)

test("a shell outbox signs an unsigned template and reports the host's answer, never throws", async () => {
  const seen = [];
  const N = load(Object.assign(base(), {
    napplet: {
      outbox: {
        publish: async (t) => { seen.push(t); return t.kind === 1 ? { type: "outbox.publish.result", error: { message: "relay said no" } } : { type: "outbox.publish.result", event: Object.assign({ id: "e", sig: "s" }, t) }; },
        query: async (f) => ({ type: "outbox.query.result", events: [{ id: "q", kind: f.kinds[0] }] }),
      },
    },
  }));
  const ok = await N.outbox.publish({ kind: 31600, content: "" });
  assert.deepEqual([ok.ok, ok.via, ok.event.id], [true, "shell", "e"]);
  assert.equal(seen[0].sig, undefined, "handed over UNSIGNED — the host signs");
  const refused = await N.outbox.publish({ kind: 1 });
  assert.deepEqual([refused.ok, refused.error], [false, "relay said no"], "`error` on the result message, not a rejection");
  assert.deepEqual(await N.outbox.query({ kinds: [4600] }), [{ id: "q", kind: 4600 }]);
});

test("on the website an unsigned template is signed by NIP-07 before the relay fan-out", async () => {
  const N = load(Object.assign(base(), {
    nostr: { getPublicKey: async () => "c".repeat(64), signEvent: async (e) => Object.assign({ sig: "nip07" }, e) },
    E1Net: { nostr: { publish: async (e) => ({ ok: true, accepted: e.sig === "nip07" ? ["wss://r"] : [], tried: 1 }), query: async () => [] } },
  }));
  const res = await N.outbox.publish({ kind: 31600 });
  assert.deepEqual([res.ok, res.via, res.accepted], [true, "relays", ["wss://r"]]);
  assert.deepEqual(await N.outbox.query({ kinds: [31600] }), []);
});

// ------------------------------------------------------------------- table

const SIGNED = { kind: 22242, pubkey: "d".repeat(64), id: "i", sig: "s" };
/* A host that answers §3b: open → result + opened, sign → result, close → closed. */
const answering = (msg, host) => {
  if (msg.type === "table.open") {
    if (msg.url.startsWith("wss://forbidden")) return host.deliver({ type: "table.open.result", id: msg.id, ok: false, error: "table origin not allowed" });
    host.deliver({ type: "table.open.result", id: msg.id, ok: true, channel: "ch1" });
    host.deliver({ type: "table.opened", channel: "ch1" });
  } else if (msg.type === "table.sign") {
    const relay = msg.event.tags.find((t) => t[0] === "relay")[1];
    host.deliver(relay.includes("evil")
      ? { type: "table.sign.result", id: msg.id, ok: false, error: "the host signs only a table login for the table you opened" }
      : { type: "table.sign.result", id: msg.id, ok: true, event: SIGNED });
  } else if (msg.type === "table.close") {
    host.deliver({ type: "table.closed", channel: msg.channel, code: 1000, reason: "closed by napplet" });
  }
};
const login = (relay) => ({ kind: 22242, content: "", tags: [["relay", relay], ["challenge", "a".repeat(64)]] });

test("table.connect rides the host channel: fresh ids, replies by id, traffic by channel, parent only", async () => {
  const host = fakeHost(answering);
  const N = load(Object.assign(base(), { napplet: {}, window: host.window, parent: host.parent }));
  assert.equal(N.table.available(), true, "the channel needs no prelude domain, only a host window");
  const got = { open: 0, messages: [], closes: [], errors: [] };
  const conn = N.table.connect("wss://tcg.nappelin.com/ws", {
    onOpen: () => { got.open += 1; }, onMessage: (t) => got.messages.push(t),
    onClose: (c) => got.closes.push(c), onError: (e) => got.errors.push(e),
  });
  assert.equal(host.posted[0].type, "table.open");
  assert.match(host.posted[0].id, /^t[0-9a-z]+-[0-9a-z]+$/);
  assert.equal(conn.channel, "ch1");
  assert.equal(got.open, 1);

  assert.equal(conn.send('{"t":"ACT"}'), true);
  assert.deepEqual(host.posted[1], { type: "table.send", channel: "ch1", data: '{"t":"ACT"}' });
  host.deliver({ type: "table.message", channel: "ch1", data: "hello" });
  host.deliver({ type: "table.message", channel: "other", data: "nope" });
  host.deliver({ type: "table.message", channel: "ch1", data: "forged" }, { not: "the parent" });
  assert.deepEqual(got.messages, ["hello"], "unknown channels and foreign sources are dropped");

  assert.equal((await conn.sign(login("wss://tcg.nappelin.com/ws"))).sig, "s");
  const signReq = host.posted.find((m) => m.type === "table.sign");
  assert.equal(signReq.channel, "ch1");
  assert.notEqual(signReq.id, host.posted[0].id, "every request carries a fresh id");
  await assert.rejects(() => conn.sign(login("wss://evil.example/ws")), /only a table login for the table you opened/);

  conn.close();
  assert.deepEqual(host.posted.at(-1), { type: "table.close", channel: "ch1" });
  assert.deepEqual(got.closes, [{ code: 1000, reason: "closed by napplet" }]);
  assert.equal(conn.send("late"), false, "a closed channel drops silently");
  assert.deepEqual(got.errors, []);
  assert.equal(N.report().table, "host channel");
});

test("a host that refuses, or never answers, is an error and a close — not a hang", () => {
  const host = fakeHost(answering);
  const timers = [];
  const N = load(Object.assign(base(), {
    napplet: {}, window: host.window, parent: host.parent,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
  }));
  const got = { closes: [], errors: [] };
  N.table.connect("wss://forbidden.example/ws", { onClose: (c) => got.closes.push(c), onError: (e) => got.errors.push(e) });
  assert.deepEqual(got.errors, ["table origin not allowed"]);
  assert.equal(got.closes[0].code, 1006);

  const silent = { closes: [], errors: [] };
  host.parent.postMessage = () => {}; // a parent that is not nappelin
  N.table.connect("wss://tcg.nappelin.com/ws", { onClose: (c) => silent.closes.push(c), onError: (e) => silent.errors.push(e) });
  for (const fn of timers.splice(0)) fn();
  assert.match(silent.errors[0], /did not answer table\.open/);
  assert.equal(silent.closes.length, 1);
});

test("without a host the same call is a WebSocket and NIP-07 signs the login", async () => {
  const made = [];
  const N = load(Object.assign(base(), {
    WebSocket: class { constructor(url) { made.push(url); this.readyState = 1; this.sent = []; this.send = (t) => this.sent.push(t); this.close = () => { this.closed = true; }; } },
    nostr: { getPublicKey: async () => "d".repeat(64), signEvent: async (e) => Object.assign({ sig: "nip07" }, e) },
  }));
  assert.equal(N.table.available(), false);
  const got = { open: 0, messages: [], closes: [] };
  const conn = N.table.connect("ws://localhost:8777/ws", { onOpen: () => { got.open += 1; }, onMessage: (t) => got.messages.push(t), onClose: (c) => got.closes.push(c) });
  assert.deepEqual(made, ["ws://localhost:8777/ws"]);
  const ws = conn.socket;
  ws.onopen(); ws.onmessage({ data: "frame" }); ws.onclose({ code: 4009, reason: "superseded" });
  assert.deepEqual([got.open, got.messages, got.closes], [1, ["frame"], [{ code: 4009, reason: "superseded" }]]);
  assert.equal(conn.send("x"), true);
  assert.deepEqual(ws.sent, ["x"]);
  assert.equal((await conn.sign(login("ws://localhost:8777/ws"))).sig, "nip07");
  assert.equal(N.report().table, "websocket");
  const bare = load(Object.assign(base(), { WebSocket: class { constructor() { this.readyState = 0; } } }));
  await assert.rejects(() => bare.table.connect("ws://x", {}).sign(login("ws://x")), /no NIP-07 signer/);
});

// -------------------------------------------------------------- collection

const INVENTORY = {
  v: 1, kind: "nutft/inventory", edition: "600b-e1", collection_id: "600B-E1",
  catalog_uri: "https://mint.example/nutft/catalog", mint: "https://mint.example", at: 1757800000,
  cards: [{ asset_id: "E1-001", count: 2 }, { asset_id: "E1-017", count: 1 }],
};
const withInventory = (answer, available) => load(Object.assign(base(), {
  URL,
  napplet: { intent: { invoke: async (req) => { withInventory.last = req; return answer; }, available: async () => available } },
}));

test("collection.inventory asks the intent, validates the answer, and counts it", async () => {
  const N = withInventory({ ok: true, handled: true, archetype: "collection", action: "inventory", handler: "collection-600b-e1", inventory: INVENTORY }, { available: true });
  const inventory = await N.collection.inventory();
  assert.deepEqual(withInventory.last, { archetype: "collection", action: "inventory", convention: "napplet:collection/inventory", payload: { edition: "600b-e1" } });
  assert.deepEqual(inventory, INVENTORY);
  assert.deepEqual([...N.collection.counts(inventory)], [["E1-001", 2], ["E1-017", 1]]);
  assert.equal(await N.collection.available(), true);
  assert.equal(await N.collection.inventory("600b-e2"), null, "another edition's answer is not this edition's");
  assert.equal(N.report().collection, "intent");

  const empty = withInventory({ ok: false, handled: false, archetype: "collection", action: "inventory", inventory: null }, { available: false });
  assert.equal(await empty.collection.inventory(), null, "nothing stored is null, never a throw");
  assert.equal(await empty.collection.available(), false);
  assert.equal(await load(base()).collection.inventory(), null, "and so is no intent domain at all");
  assert.equal(load(base()).report().collection, "wallet");
});

test("the inventory validator refuses anything that is not exactly §4a", () => {
  const parse = load(Object.assign(base(), { URL })).collection.parse;
  const variant = (patch) => parse(Object.assign({}, INVENTORY, patch));
  assert.deepEqual(parse(INVENTORY), INVENTORY);
  assert.deepEqual(variant({ catalog_uri: "" }).catalog_uri, "", "an empty wallet has no catalog yet — allowed");
  assert.equal(variant({ v: 2 }), null);
  assert.equal(variant({ kind: "nutft/proofs" }), null);
  assert.equal(variant({ extra: 1 }), null, "no extra fields");
  assert.equal(parse(Object.fromEntries(Object.entries(INVENTORY).filter(([k]) => k !== "mint"))), null, "no missing fields");
  assert.equal(variant({ mint: "http://mint.example" }), null, "https only");
  assert.equal(variant({ catalog_uri: "https://" + "x".repeat(2049) }), null);
  assert.equal(variant({ at: 1757800000.5 }), null, "unix seconds, floored");
  assert.equal(variant({ cards: [{ asset_id: "E1-017", count: 1 }, { asset_id: "E1-001", count: 2 }] }), null, "sorted by asset_id");
  assert.equal(variant({ cards: [{ asset_id: "E1-001", count: 1 }, { asset_id: "E1-001", count: 2 }] }), null, "no duplicates");
  assert.equal(variant({ cards: [{ asset_id: "E1-001", count: 0 }] }), null, "count ≥ 1");
  assert.equal(variant({ cards: [{ asset_id: "E1-001", count: 1, proof: "secret" }] }), null, "no proofs, no secrets");
  assert.equal(variant({ cards: [{ asset_id: "../E1", count: 1 }] }), null, "bad ids");
  assert.equal(variant({ cards: Array.from({ length: 4097 }, (_, i) => ({ asset_id: `X${String(i).padStart(4, "0")}`, count: 1 })) }), null, "max 4096");
  assert.deepEqual(variant({ cards: [] }).cards, [], "an empty collection is a valid one");
  assert.equal(parse("not an object"), null);
  assert.equal(parse(null), null);
});
