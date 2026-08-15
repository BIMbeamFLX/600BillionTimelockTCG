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

  const shelled = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { identity: { get: async () => ({ pubkey: KEY }), request: async () => ({ pubkey: KEY }) } },
  });
  assert.equal(shelled.identity.source(), "shell");
  assert.equal(await shelled.identity.current(), KEY);

  const bare = load({ localStorage: memoryStorage().api, document: stubRoot() });
  assert.equal(await bare.identity.current(), null);
  await assert.rejects(() => bare.identity.login(), /NIP-07|napplet shell/);
});

test("a junk identity from either source is refused rather than seated", async () => {
  const bad = load({
    localStorage: memoryStorage().api,
    document: stubRoot(),
    napplet: { identity: { get: async () => ({ pubkey: "not-a-key" }), request: async () => ({}) } },
  });
  assert.equal(await bad.identity.current(), null);
  await assert.rejects(() => bad.identity.login(), /usable identity/);
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
