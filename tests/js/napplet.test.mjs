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

/* The 600 Billion brand layer as the contract fixes it. No theme may move these. */
const BRAND = {
  "--display": "Anton600, Impact, sans-serif",
  "--ember": "#ff6a00",
  "--aff-power": "#f3c244",
  "--aff-bitcoin": "#f7931a",
  "--aff-keys": "#fff7ec",
  "--aff-signal": "#7447b8",
  "--aff-timelock": "#17bebb",
  "--aff-neutral": "#8a8f98",
};
const assertBrand = (doc, why) => {
  for (const [name, value] of Object.entries(BRAND)) assert.equal(doc.__set.get(name), value, `${name}: ${why}`);
};

test("without a theme domain the Hypershell defaults are painted, brand layer included", () => {
  const doc = stubRoot();
  const N = load({ localStorage: memoryStorage().api, document: doc });
  N.theme.start();
  assert.equal(doc.__set.get("--iron"), "#0f0c08");
  assert.equal(doc.__set.get("--brass"), "#e7bf76");
  assert.equal(doc.__set.get("--parchment"), "#ece3d0");
  assert.equal(doc.__set.get("--signal"), "#6de8a6", "signal is green now");
  assertBrand(doc, "the website paints the brand layer too");
  assert.deepEqual(Object.keys(N.theme.tokens()).sort(), Object.keys(N.NAPPELIN_THEME.tokens).sort());
  assert.equal(N.theme.affinity().S, "#7447b8", "the Signal Plate stays purple");
});

/* What today's Hangar answers theme.get() with, verbatim: its own default, sent to
 * every napplet before a Hypershell theme service exists. Painting it made every
 * brass control blue. */
const LIVE_HANGAR_THEME = { colors: { background: "#0a0a0a", text: "#e0e0e0", primary: "#7aa2f7" } };
const assertDefaults = (N, doc, why) => {
  for (const [name, value] of Object.entries(N.NAPPELIN_THEME.tokens)) assert.equal(doc.__set.get(name), value, `${name}: ${why}`);
  assertBrand(doc, why);
};

test("a colours-only theme, like today's Hangar sends, keeps every Hypershell token", async () => {
  const sources = [
    ["an async theme.get()", { napplet: { theme: { get: async () => LIVE_HANGAR_THEME } } }],
    ["a sync theme.get()", { napplet: { theme: { get: () => LIVE_HANGAR_THEME } } }],
    ["bare colours", { napplet: { theme: { get: async () => LIVE_HANGAR_THEME.colors } } }],
    ["a static theme object", { napplet: { theme: LIVE_HANGAR_THEME } }],
    ["the launch context", { nappletContext: { theme: LIVE_HANGAR_THEME } }],
  ];
  for (const [why, env] of sources) {
    const doc = stubRoot();
    const N = load(Object.assign({ localStorage: memoryStorage().api, document: doc }, env));
    await N.theme.start();
    assertDefaults(N, doc, why);
    assert.equal(N.theme.tokens()["--brass"], "#e7bf76", `${why}: brass stays brass`);
    for (const legacy of ["--black", "--cream", "--panel-2", "--muted", "--line"]) {
      assert.equal(doc.__set.has(legacy), false, `${legacy} is a CSS alias now, never written`);
    }
  }

  // Pushed through theme.changed it takes a skin off and paints the defaults, nothing blue.
  const doc = stubRoot();
  let handler = null;
  const N = load({ localStorage: memoryStorage().api, document: doc, napplet: { theme: { onChanged: (fn) => { handler = fn; } } } });
  N.theme.start();
  handler({ tokens: { "--brass": "#9fc3ff" } });
  assert.equal(doc.__set.get("--brass"), "#9fc3ff");
  handler(LIVE_HANGAR_THEME);
  assertDefaults(N, doc, "theme.changed with colours only");
});

test("a tokens payload sets exactly the fifteen core names and nothing of the brand", async () => {
  const doc = stubRoot();
  const tokens = {
    "--iron": "#101010", "--brass": "#b0b0ff", "--brass-2": "#9090ff", "--brass-3": "#7070ff",
    "--parchment": "#fafafa", "--signal": "#00ff00", "--panel": "rgba(1,1,1,.03)", "--well": "rgba(2,2,2,.05)",
    "--divider": "rgba(3,3,3,.12)", "--hairline": "rgba(4,4,4,.14)", "--emphasis": "rgba(5,5,5,.25)",
    "--body-ink": "rgba(6,6,6,.82)", "--headline": "Georgia, serif", "--mono": "monospace", "--r": "0",
    // Everything below is outside the core set and must be ignored.
    "--ember": "#0000ff", "--aff-signal": "#00ff00", "--display": "Comic Sans MS", "--ink-quiet": "#123456",
    "--iron-850": "#654321", "--black": "#ffffff",
  };
  const N = load({
    localStorage: memoryStorage().api,
    document: doc,
    // The real service answers with a promise (@napplet/core ThemeApi.get).
    napplet: { theme: { get: async () => ({ colors: { background: "#999999" }, tokens }) } },
  });
  await N.theme.start();
  for (const name of Object.keys(N.NAPPELIN_THEME.tokens)) assert.equal(doc.__set.get(name), tokens[name], name);
  assert.equal(doc.__set.get("--iron"), "#101010", "the colours beside the tokens are not read");
  for (const name of ["--ink-quiet", "--iron-850", "--black"]) assert.equal(doc.__set.has(name), false, name);
  assertBrand(doc, "a tokens payload cannot name its way into the brand layer");
  assert.equal(N.theme.tokens()["--brass"], "#b0b0ff", "tokens() reports what was painted");
  assert.equal(N.report().theme, "shell");
});

test("theme.changed repaints on every change, from the defaults, and a stale get() loses", async () => {
  const doc = stubRoot();
  let handler = null;
  let answer = null;
  const N = load({
    localStorage: memoryStorage().api,
    document: doc,
    napplet: {
      theme: {
        get: () => new Promise((resolve) => { answer = resolve; }),
        onChanged: (fn) => { handler = fn; return { close() {} }; },
      },
    },
  });
  const started = N.theme.start();
  assert.equal(typeof handler, "function", "a theme change must be subscribed to");
  assert.equal(doc.__set.get("--iron"), "#0f0c08", "the defaults hold until the service answers");

  // A guild skin ("SEC") arrives, then another change takes it off again.
  handler({ tokens: { "--iron": "#050a14", "--brass": "#9fc3ff", "--ember": "#00ff00" } });
  assert.equal(doc.__set.get("--iron"), "#050a14");
  assert.equal(doc.__set.get("--brass"), "#9fc3ff");
  assertBrand(doc, "a skin never touches the brand layer");
  handler({ tokens: { "--iron": "#111111" } });
  assert.equal(doc.__set.get("--iron"), "#111111", "and repainted when it changes");
  assert.equal(doc.__set.get("--brass"), "#e7bf76", "the skin's brass is gone: every paint starts from the defaults");

  answer({ tokens: { "--iron": "#222222" } });
  await started;
  assert.equal(doc.__set.get("--iron"), "#111111", "a get() that answers after a pushed change is stale");
  assertBrand(doc, "still never the brand layer");
});

test("a static tokens object and the older themeOnChanged hook still work", () => {
  const doc = stubRoot();
  let handler = null;
  const N = load({
    localStorage: memoryStorage().api,
    document: doc,
    napplet: {
      theme: { tokens: { "--iron": "#ffffff", "--parchment": "#000000", "--brass": "#0000ff", "--well": "#eeeeee" } },
      themeOnChanged: (fn) => { handler = fn; },
    },
  });
  N.theme.start();
  assert.equal(doc.__set.get("--iron"), "#ffffff", "the shell owns the chrome");
  assert.equal(doc.__set.get("--brass"), "#0000ff", "brass is the shell's, never the card world's ember");
  assert.equal(doc.__set.get("--well"), "#eeeeee");
  assertBrand(doc, "and never the affinities");
  handler({ tokens: { "--iron": "#333333" } });
  assert.equal(doc.__set.get("--iron"), "#333333");
});

test("the launch context's theme is read when the service has none", async () => {
  const context = { roster: true, theme: { tokens: { "--iron": "#0a0a0a", "--brass": "#d4a24c" } } };
  const plain = stubRoot();
  const N = load({ localStorage: memoryStorage().api, document: plain, nappletContext: context });
  N.theme.start();
  assert.equal(plain.__set.get("--iron"), "#0a0a0a");
  assert.equal(plain.__set.get("--brass"), "#d4a24c");
  assert.equal(N.report().theme, "launch context");

  // The service comes first when it names something; when it answers empty, the context stays.
  const served = stubRoot();
  await load({
    localStorage: memoryStorage().api, document: served, nappletContext: context,
    napplet: { theme: { get: async () => ({ tokens: { "--iron": "#1b1b1b" } }) } },
  }).theme.start();
  assert.equal(served.__set.get("--iron"), "#1b1b1b");
  assert.equal(served.__set.get("--brass"), "#e7bf76", "the service's theme replaces the context's, not merges");
  const empty = stubRoot();
  await load({
    localStorage: memoryStorage().api, document: empty, nappletContext: context,
    napplet: { theme: { get: async () => ({}) } },
  }).theme.start();
  assert.equal(empty.__set.get("--iron"), "#0a0a0a");
});

test("a shell that offers a broken theme domain still gets a painted page", async () => {
  const doc = stubRoot();
  const N = load({
    localStorage: memoryStorage().api,
    document: doc,
    napplet: { theme: { get() { throw new Error("no theme"); } } },
  });
  N.theme.start();
  assert.equal(doc.__set.get("--iron"), "#0f0c08", "a thrown theme falls back, it does not blank");
  const rejected = stubRoot();
  await load({
    localStorage: memoryStorage().api,
    document: rejected,
    napplet: { theme: { get: async () => { throw new Error("declined"); } } },
  }).theme.start();
  assert.equal(rejected.__set.get("--iron"), "#0f0c08", "a rejected theme falls back too");
});

test("the adapter's defaults are 600b.css's values, and only palette values", () => {
  /* Two files carry the Hypershell defaults. A comment saying "must match" is
   * how they drift, so the stylesheet's :root is read here and compared. */
  const css = fs.readFileSync(path.join(HERE, "../../site/600b.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const N = load({ localStorage: memoryStorage().api, document: stubRoot() });
  const norm = (v) => v.replace(/\s+/g, "").replace(/(^|[,(])0\./g, "$1.").toLowerCase();
  for (const [name, value] of Object.entries(N.NAPPELIN_THEME.tokens)) {
    const declared = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    assert.ok(declared, `600b.css declares ${name}`);
    assert.equal(norm(declared[1]), norm(value), name);
  }
  const all = JSON.stringify(N.NAPPELIN_THEME) + SOURCE;
  for (const stray of ["#1a150e", "#c9b48a", "#1f1911", "#15110c"]) assert.equal(all.includes(stray), false, stray);
  assert.ok(Object.isFrozen(N.NAPPELIN_THEME.tokens), "the defaults cannot be edited from a page");
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

test("under embed with no shell theme, nappelin's tokens are painted and the brand stays 600B's", () => {
  const doc = stubRoot();
  const N = load({ localStorage: memoryStorage().api, document: doc, napplet: {} });
  N.theme.start();
  for (const [name, value] of Object.entries(N.NAPPELIN_THEME.tokens)) assert.equal(doc.__set.get(name), value, name);
  assert.equal(doc.__set.get("--well"), "rgba(231,191,118,.05)", "the surface is the well, a palette value");
  assertBrand(doc, "affinities, ember and the display face are still never themed");
  assert.equal(N.report().theme, "nappelin palette");
  const preview = stubRoot();
  load({ localStorage: memoryStorage().api, document: preview, location: { search: "?embed=1" } }).theme.start();
  assert.equal(preview.__set.get("--iron"), "#0f0c08", "the local preview paints the same");
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
