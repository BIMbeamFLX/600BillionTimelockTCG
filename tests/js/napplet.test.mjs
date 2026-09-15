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

test("a tokens payload sets exactly the nineteen core names and nothing of the brand", async () => {
  const doc = stubRoot();
  const tokens = {
    "--iron": "#101010", "--brass": "#b0b0ff", "--brass-2": "#9090ff", "--brass-3": "#7070ff",
    "--parchment": "#fafafa", "--signal": "#00ff00", "--panel": "rgba(1,1,1,.03)", "--well": "rgba(2,2,2,.05)",
    "--divider": "rgba(3,3,3,.12)", "--hairline": "rgba(4,4,4,.14)", "--emphasis": "rgba(5,5,5,.25)",
    "--body-ink": "rgba(6,6,6,.82)", "--headline": "Georgia, serif", "--mono": "monospace", "--r": "0",
    "--iron-850": "#151515", "--iron-800": "#1a1a1a", "--iron-750": "#202020", "--rust": "#cc4444",
    // Everything below is outside the core set and must be ignored.
    "--ember": "#0000ff", "--aff-signal": "#00ff00", "--display": "Comic Sans MS", "--ink-quiet": "#123456",
    "--soot": "#654321", "--black": "#ffffff",
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
  for (const name of ["--ink-quiet", "--soot", "--black"]) assert.equal(doc.__set.has(name), false, name);
  assertBrand(doc, "a tokens payload cannot name its way into the brand layer");
  assert.equal(N.theme.tokens()["--brass"], "#b0b0ff", "tokens() reports what was painted");
  assert.equal(N.report().theme, "shell");
});

test("a colour the browser would not paint keeps the default where the page can ask", async () => {
  const doc = stubRoot();
  const asked = [];
  const N = load({
    CSS: { supports: (property, value) => { asked.push([property, value]); return value !== "rgb(1 2 3 4)"; } },
    localStorage: memoryStorage().api,
    document: doc,
    napplet: { theme: { get: async () => ({ tokens: { "--brass": "rgb(1 2 3 4)", "--brass-2": "#9090ff", "--r": "2px" } }) } },
  });
  await N.theme.start();
  assert.equal(doc.__set.get("--brass"), N.NAPPELIN_THEME.tokens["--brass"], "a shape-valid colour the browser refuses keeps the default");
  assert.equal(doc.__set.get("--brass-2"), "#9090ff", "a colour the browser paints applies");
  assert.equal(doc.__set.get("--r"), "2px", "lengths are not asked as colours");
  assert.deepEqual(asked.map(([property]) => property).filter((p) => p !== "color"), [], "only colours are asked");
});

/* The three doors a theme comes through. Each paints `payload` into a fresh page and
 * hands back the adapter and the properties it wrote. */
const THEME_DOORS = {
  "theme.get": async (payload) => {
    const doc = stubRoot();
    const N = load({ localStorage: memoryStorage().api, document: doc, napplet: { theme: { get: async () => payload } } });
    await N.theme.start();
    return { N, doc };
  },
  "nappletContext.theme": async (payload) => {
    const doc = stubRoot();
    const N = load({ localStorage: memoryStorage().api, document: doc, nappletContext: { theme: payload } });
    N.theme.start();
    return { N, doc };
  },
  "theme.changed": async (payload) => {
    const doc = stubRoot();
    let handler = null;
    const N = load({ localStorage: memoryStorage().api, document: doc, napplet: { theme: { onChanged: (fn) => { handler = fn; } } } });
    N.theme.start();
    handler(payload);
    return { N, doc };
  },
};

const BS = String.fromCharCode(92);
/* A value in a custom property can make every viewer's browser fetch, and whoever
 * set it sees who asked. None of these may be written, whatever else is around it. */
const REFUSED_THEME_VALUES = [
  "url(http://theme.example/pixel.png)",
  "URL(http://theme.example/pixel.png)",
  "image-set(url(http://theme.example/a.png) 1x)",
  "-webkit-image-set(url(http://theme.example/a.png) 1x)",
  "var(--brass)",
  "env(safe-area-inset-top)",
  "expression(alert(1))",
  "@import url(http://theme.example/x.css)",
  "#0f0c08; background: url(http://theme.example/x)",
  "#0f0c08 }",
  "{ color: #0f0c08",
  "<style>",
  BS + "75rl(http://theme.example/x)",
  "#0f0c08" + BS,
  "#0f0c08\nbody { background: #fff }",
  "#0f0c08\r",
  "rgb(var(--x), 0, 0)",
];
const THEMED = ["--iron", "--brass", "--brass-3", "--panel", "--well", "--headline", "--mono", "--r"];

test("a theme value that could fetch anything keeps the default, through every door", async () => {
  for (const [door, paint] of Object.entries(THEME_DOORS)) {
    for (const bad of REFUSED_THEME_VALUES) {
      const tokens = Object.fromEntries(THEMED.map((name) => [name, bad]));
      tokens["--divider"] = "#123456"; // one good value, so the payload is known to be read
      const { N, doc } = await paint({ tokens });
      const why = `${door} ${JSON.stringify(bad)}`;
      assert.equal(doc.__set.get("--divider"), "#123456", `${why}: the good value beside it applies`);
      for (const name of THEMED) {
        assert.equal(doc.__set.get(name), N.NAPPELIN_THEME.tokens[name], `${why}: ${name} keeps its default`);
        assert.equal(N.theme.tokens()[name], N.NAPPELIN_THEME.tokens[name], `${why}: tokens() says so too`);
      }
      assertBrand(doc, why);
    }
  }
});

test("a theme value of the wrong kind keeps the default", async () => {
  const wrong = [
    ["--iron", "\"Josefin Sans\""], ["--brass", "red"], ["--brass-2", "#12345"], ["--well", "rgb(1, 2)"],
    ["--panel", "calc(1px + 2px)"], ["--mono", "#0f0c08"], ["--headline", "\"Josefin\" Sans"],
    ["--r", "#fff"], ["--r", "calc(1px)"], ["--r", "10%"], ["--signal", 42],
  ];
  for (const [door, paint] of Object.entries(THEME_DOORS)) {
    for (const [name, value] of wrong) {
      const { N, doc } = await paint({ tokens: { [name]: value, "--divider": "#123456" } });
      assert.equal(doc.__set.get(name), N.NAPPELIN_THEME.tokens[name], `${door}: ${name} ${JSON.stringify(value)}`);
      assert.equal(doc.__set.get("--divider"), "#123456", door);
    }
  }
});

test("every allowed colour, font list and length still applies, through every door", async () => {
  const allowed = [
    ["--iron", "#fff"], ["--iron", "#ffff"], ["--iron", "#0a0b0c"], ["--iron", "#0A0B0C80"],
    ["--brass", "rgb(1, 2, 3)"], ["--brass", "rgba(231,191,118,.03)"], ["--brass", "rgb(10 20 30 / 50%)"],
    ["--brass-2", "hsl(120deg, 50%, 50%)"], ["--brass-2", "hsla(120, 50%, 50%, 0.5)"],
    ["--panel", "transparent"], ["--parchment", "white"], ["--signal", "Black"],
    ["--headline", "\"Josefin Sans\", Georgia, sans-serif"], ["--mono", "'IBM Plex Mono', ui-monospace, monospace"],
    ["--mono", "monospace"], ["--headline", "Times New Roman, serif"],
    ["--r", "0"], ["--r", "2px"], ["--r", ".25rem"], ["--r", "1.5em"],
  ];
  for (const [door, paint] of Object.entries(THEME_DOORS)) {
    for (const [name, value] of allowed) {
      const { N, doc } = await paint({ tokens: { [name]: `  ${value} ` } });
      assert.equal(doc.__set.get(name), value, `${door}: ${name} ${value}`);
      assert.equal(N.theme.tokens()[name], value);
      assertBrand(doc, door);
    }
  }
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

/* NAP-OUTBOX as the Kehto prelude hands it over: every call's options recorded, results
 * as `{ event, sidecar }`, and subscription handles that say whether they were closed. */
function recordingOutbox() {
  const seen = { publish: [], query: [], subscribe: [] };
  const handles = [];
  return {
    seen,
    handles,
    publish: async (template, options) => { seen.publish.push(options); return { type: "outbox.publish.result", ok: true, event: Object.assign({ id: "e", sig: "s" }, template) }; },
    query: async (filters, options) => {
      seen.query.push(options);
      return { type: "outbox.query.result", events: [{ event: { id: "q", kind: 0 }, sidecar: { relayHints: ["wss://relay.nappelin.com"] } }] };
    },
    subscribe(filters, options) {
      seen.subscribe.push(options);
      const handle = { closed: 0, listeners: { event: [], closed: [] } };
      handle.on = (name, fn) => handle.listeners[name].push(fn);
      handle.close = () => { handle.closed += 1; };
      handle.emit = (event) => { for (const fn of handle.listeners.event) fn({ event, sidecar: { relayHints: [] } }); };
      handles.push(handle);
      return handle;
    },
  };
}
const RELAYS = ["wss://relay.nappelin.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

test("a query and a subscription through the shell's outbox name the relays its publish names", async () => {
  const outbox = recordingOutbox();
  const N = load(Object.assign(base(), { napplet: { outbox } }));
  await N.outbox.publish({ kind: 4600, content: "" });
  assert.deepEqual(await N.outbox.query([{ kinds: [0], authors: ["c".repeat(64)] }]), [{ id: "q", kind: 0 }], "handed on bare");
  const got = [];
  N.outbox.subscribe([{ kinds: [4600] }], (event) => got.push(event));
  outbox.handles[0].emit({ id: "live" });
  assert.deepEqual(got, [{ id: "live" }]);
  assert.deepEqual(outbox.seen.publish[0].relays, RELAYS);
  assert.deepEqual(outbox.seen.query, [{ relays: RELAYS }], "a member's kind 0 never rests on a relay list the router has to find");
  assert.deepEqual(outbox.seen.subscribe, [{ relays: RELAYS }]);
});

test("at most eight subscriptions are open at once: a ninth closes the oldest, quietly", () => {
  const outbox = recordingOutbox();
  const N = load(Object.assign(base(), { napplet: { outbox } }));
  const heard = [];
  const ended = [];
  const offs = Array.from({ length: 9 }, (_, i) => N.outbox.subscribe([{ kinds: [4600] }], (event) => heard.push([i, event.id]), (reason) => ended.push([i, reason])));
  assert.deepEqual(outbox.handles.map((handle) => handle.closed), [1, 0, 0, 0, 0, 0, 0, 0, 0], "the oldest made room");
  outbox.handles[0].emit({ id: "late" });
  outbox.handles[8].emit({ id: "new" });
  assert.deepEqual(heard, [[8, "new"]], "the oldest hears nothing more; the newest does");
  assert.deepEqual(ended, [], "and nobody is told: closing it was the napplet's own decision");
  offs[0]();
  assert.equal(outbox.handles[0].closed, 1, "its own unsubscribe afterwards closes nothing twice");

  offs[3]();
  N.outbox.subscribe([{ kinds: [4600] }], () => {});
  assert.deepEqual(outbox.handles.map((handle) => handle.closed), [1, 0, 0, 1, 0, 0, 0, 0, 0, 0], "a place freed is a place: nothing else closes");

  // A subscription the shell ended frees its place too, and its owner is told why.
  outbox.handles[1].listeners.closed[0]("relay list unavailable");
  assert.deepEqual(ended, [[1, "relay list unavailable"]]);
  N.outbox.subscribe([{ kinds: [4600] }], () => {});
  assert.equal(outbox.handles.filter((handle) => handle.closed).length, 2, "eight open, none closed for the ninth");
});

test("closeAll() and the frame unloading end every open subscription", () => {
  const outbox = recordingOutbox();
  const listeners = {};
  const window = { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); } };
  const N = load(Object.assign(base(), { napplet: { outbox }, window }));
  const ended = [];
  const offs = [0, 1, 2].map((i) => N.outbox.subscribe([{ kinds: [4600] }], () => {}, (reason) => ended.push([i, reason])));
  N.outbox.closeAll();
  assert.deepEqual(outbox.handles.map((handle) => handle.closed), [1, 1, 1]);
  for (const off of offs) off();
  assert.deepEqual(outbox.handles.map((handle) => handle.closed), [1, 1, 1], "closed once each");

  N.outbox.subscribe([{ kinds: [4600] }], () => {});
  N.outbox.subscribe([{ kinds: [4600] }], () => {});
  assert.equal(listeners.pagehide.length, 1, "the adapter listens for the frame unloading");
  listeners.pagehide[0]({});
  assert.deepEqual(outbox.handles.map((handle) => handle.closed), [1, 1, 1, 1, 1]);
  assert.deepEqual(ended, [], "quietly");
  N.outbox.closeAll(); // nothing open: nothing to do
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

// -------------------------------------------------------------------- link

const SHOP = "https://tcg.nappelin.com/shop.html";
/* A shell whose link domain answers with `answer(url)`; `timers` collects the adapter's deadlines. */
const withLink = (answer, extra) => {
  const asked = [];
  const timers = [];
  const N = load(Object.assign(base(), {
    URL,
    napplet: { link: { open: (url, options) => { asked.push([url, options]); return answer(url); } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
  }, extra || {}));
  return { N, asked, timers };
};

test("link.open asks the host for exactly the https URL and says whether it opened", async () => {
  const opened = withLink(async () => ({ status: "opened" }));
  assert.equal(opened.N.link.available(), true);
  assert.deepEqual(await opened.N.link.open(SHOP), { ok: true });
  assert.deepEqual(opened.asked, [[SHOP, undefined]], "the constant, handed over as it is");
  assert.equal(opened.timers[0].ms, 30000, "the same 30 s the prelude waits");
  assert.equal(opened.timers[0].cleared, true, "an answer ends the wait");

  const denied = withLink(async () => ({ status: "denied" }));
  assert.deepEqual(await denied.N.link.open(SHOP), { ok: false, error: "denied" }, "the member said no");
  const failed = withLink(async () => { throw new Error("link.open timed out"); });
  assert.deepEqual(await failed.N.link.open(SHOP), { ok: false, error: "link.open timed out" }, "a rejection is an answer too");
  const thrown = withLink(() => { throw new Error("no service"); });
  assert.deepEqual(await thrown.N.link.open(SHOP), { ok: false, error: "no service" });
});

test("a host that never answers link.open is a refusal after 30 s, and nothing is asked without a link domain", async () => {
  const silent = withLink(() => new Promise(() => {}));
  const pending = silent.N.link.open(SHOP);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(silent.asked.length, 1);
  silent.timers[0].fn();
  assert.deepEqual(await pending, { ok: false, error: "timeout" });

  for (const url of ["http://tcg.nappelin.com/shop.html", "javascript:alert(1)", "shop.html", null]) {
    const refused = withLink(async () => ({ status: "opened" }));
    assert.deepEqual(await refused.N.link.open(url), { ok: false, error: "https only" }, String(url));
    assert.deepEqual(refused.asked, [], "the host is never asked for anything but an https URL");
  }
  const none = load(Object.assign(base(), { URL, napplet: {} }));
  assert.equal(none.link.available(), false);
  assert.deepEqual(await none.link.open(SHOP), { ok: false, error: "unavailable" }, "no link domain resolves, never throws");
  assert.deepEqual(await load(Object.assign(base(), { URL })).link.open(SHOP), { ok: false, error: "unavailable" }, "and neither does the website");
});

// --------------------------------------------------------------------- cue

/* NAP-CUE (nappelin #107), interim domain x-nappelin-cue. A shell that routes
 * cues answers every send; the clock and the timers are the test's, so the 8 s
 * mood window and the 4-per-second moment cap are checked without waiting. */
function cueShell({ supports = true, answer = (msg) => ({ accepted: true }), extra = {} } = {}) {
  const clock = { t: 1000000, timers: [] };
  const host = fakeHost((msg, h) => {
    if (msg.type !== "x-nappelin-cue.send") return;
    const reply = answer(msg);
    if (reply) h.deliver(Object.assign({ type: "x-nappelin-cue.send.result", id: msg.id }, reply));
  });
  const asked = [];
  const napplet = { shell: { supports: (domain) => { asked.push(domain); return domain === "x-nappelin-cue" ? supports : false; } } };
  Object.assign(napplet, extra);
  const N = load(Object.assign(base(), {
    napplet, window: host.window, parent: host.parent,
    Date: { now: () => clock.t },
    setTimeout: (fn, ms) => { const timer = { fn, at: clock.t + ms, unref() {} }; clock.timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.fn = null; },
  }));
  const advance = async (ms) => {
    clock.t += ms;
    for (const timer of clock.timers.filter((entry) => entry.at <= clock.t)) {
      clock.timers.splice(clock.timers.indexOf(timer), 1);
      if (timer.fn) timer.fn();
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  const sent = () => host.posted.filter((msg) => msg.type === "x-nappelin-cue.send").map(({ mood, moment }) => (mood ? { mood } : { moment }));
  return { N, host, clock, advance, sent, asked };
}

test("cue: nothing is sent on the website, or in a shell that does not route cues", async () => {
  const site = load(base());
  assert.equal(site.cue.available(), false);
  assert.deepEqual(await site.cue.send({ mood: "battle" }), { ok: false, error: "unavailable" });
  assert.equal(typeof site.cue.onFocus(() => {}), "function");
  assert.equal(site.report().cue, "off");

  const off = cueShell({ supports: false });
  assert.equal(off.N.cue.available(), false);
  assert.deepEqual(await off.N.cue.send({ moment: "attack" }), { ok: false, error: "unavailable" });
  const heard = [];
  off.N.cue.onFocus((music) => heard.push(music));
  off.host.deliver({ type: "x-nappelin-cue.focus", music: "playing" });
  assert.deepEqual(heard, [], "a focus push without the feature reaches nobody");
  assert.deepEqual(off.host.posted, [], "and nothing was posted");
});

test("cue: the feature check asks shell.supports, and the result is accepted or an error", async () => {
  const { N, host, asked } = cueShell();
  assert.equal(N.cue.available(), true);
  assert.ok(asked.includes("x-nappelin-cue"));
  assert.equal(N.report().cue, "host channel");
  assert.deepEqual(await N.cue.send({ moment: "turn" }), { ok: true, accepted: true });
  const msg = host.posted[0];
  assert.equal(msg.type, "x-nappelin-cue.send");
  assert.equal(typeof msg.id, "string");
  assert.deepEqual(Object.keys(msg).sort(), ["id", "moment", "type"], "only the wire fields, nothing about the table");

  const refused = cueShell({ answer: () => ({ error: "not permitted" }) });
  assert.deepEqual(await refused.N.cue.send({ mood: "calm" }), { ok: false, error: "not permitted" });
  assert.equal(refused.host.posted.length, 1, "an error is final: no retry");
  const odd = cueShell({ answer: () => ({ accepted: false }) });
  assert.equal((await odd.N.cue.send({ moment: "attack" })).ok, false, "only accepted: true is an acceptance");
});

test("cue: the vocabulary is closed", async () => {
  const { N, host } = cueShell();
  for (const bad of [{ mood: "happy" }, { moment: "draw" }, {}, null, "battle", { mood: "Battle" }, { mood: "calm", moment: "boom" }]) {
    assert.deepEqual(await N.cue.send(bad), { ok: false, error: "invalid request" }, JSON.stringify(bad));
  }
  assert.deepEqual(host.posted, [], "nothing outside the enums leaves the frame");
  assert.deepEqual(N.cue.MOODS, ["calm", "tension", "battle", "victory", "defeat"]);
  assert.deepEqual(N.cue.MOMENTS, ["turn", "attack", "lethal", "match-end", "booster-open"]);
});

test("cue: a mood goes at most once per 8 s, and the latest one waiting is the one sent", async () => {
  const { N, advance, sent } = cueShell();
  assert.deepEqual(await N.cue.send({ mood: "tension" }), { ok: true, accepted: true });
  await advance(1000);
  const battle = N.cue.send({ mood: "battle" });
  await advance(1000);
  const victory = N.cue.send({ mood: "victory" });
  assert.deepEqual(await battle, { ok: false, error: "superseded" });
  assert.deepEqual(sent(), [{ mood: "tension" }], "nothing more inside the window");
  await advance(5999);
  assert.deepEqual(sent(), [{ mood: "tension" }], "not a millisecond early");
  await advance(1);
  assert.deepEqual(await victory, { ok: true, accepted: true });
  assert.deepEqual(sent(), [{ mood: "tension" }, { mood: "victory" }], "trailing: the latest wins");

  // A wait that ends where it started sends nothing: the shell already holds that mood.
  await advance(2000);
  const away = N.cue.send({ mood: "calm" });
  const back = N.cue.send({ mood: "victory" });
  await advance(6000);
  assert.deepEqual(await away, { ok: false, error: "superseded" });
  assert.deepEqual(await back, { ok: true });
  assert.equal(sent().length, 2);
  await advance(9000);
  await N.cue.send({ mood: "calm" });
  assert.deepEqual(sent().at(-1), { mood: "calm" }, "an open window sends at once");
});

test("cue: at most four moments a second, the extras dropped", async () => {
  const { N, advance, sent } = cueShell();
  const answers = [];
  for (let i = 0; i < 6; i += 1) answers.push(await N.cue.send({ moment: "attack" }));
  assert.equal(answers.filter((a) => a.ok).length, 4);
  assert.deepEqual(answers.slice(4), [{ ok: false, error: "rate limited" }, { ok: false, error: "rate limited" }]);
  assert.equal(sent().length, 4);
  await advance(999);
  assert.equal((await N.cue.send({ moment: "turn" })).ok, false, "still the same second");
  await advance(1);
  assert.deepEqual(await N.cue.send({ moment: "turn" }), { ok: true, accepted: true });
  assert.equal(sent().length, 5);
});

test("cue: onFocus hears playing and idle from the parent, and unsubscribes", () => {
  const { N, host } = cueShell();
  const heard = [];
  const stop = N.cue.onFocus((music) => heard.push(music));
  host.deliver({ type: "x-nappelin-cue.focus", music: "playing" });
  host.deliver({ type: "x-nappelin-cue.focus", music: "loud" });
  host.deliver({ type: "x-nappelin-cue.focus", music: "idle" }, { not: "the parent" });
  host.deliver({ type: "x-nappelin-cue.focus", music: "idle" });
  assert.deepEqual(heard, ["playing", "idle"]);
  stop();
  host.deliver({ type: "x-nappelin-cue.focus", music: "playing" });
  assert.deepEqual(heard, ["playing", "idle"], "unsubscribed");
});

test("cue: napplet.shell.supports(\"x-nappelin-cue\") === true is the only probe", async () => {
  for (const loose of ["true", 1, {}, "yes"]) {
    const shell = cueShell({ supports: loose });
    assert.equal(shell.N.cue.available(), false, `supports() answering ${JSON.stringify(loose)} is not a yes`);
    assert.deepEqual(await shell.N.cue.send({ moment: "turn" }), { ok: false, error: "unavailable" });
    assert.deepEqual(shell.host.posted, []);
  }
  const prelude = cueShell({ supports: false, extra: { "x-nappelin-cue": { send() {} }, supports: () => true } });
  assert.equal(prelude.N.cue.available(), false, "neither a prelude object nor a top-level supports() stands in for the probe");
  const throwing = cueShell({ extra: { shell: { supports() { throw new Error("not ready"); } } } });
  assert.equal(throwing.N.cue.available(), false, "a supports() that throws supports nothing");
});
