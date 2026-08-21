/* site/portraits.js — the one rule that turns a name into a character's face.
 *
 * The property worth a test file is a count: every one of the 92 Avatar cards
 * must find a portrait. A rule that maps 91 is not 99% right, it is one player
 * sitting down with no face, and the two ways to get there are both quiet —
 * a missing alias (every card for "P" is titled "Proton, …") and a slug rule
 * that drops the hyphen out of "Toni China".
 *
 * Run: node --test tests/js/portraits.test.mjs   (the DIRECTORY form fails on Windows) */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const PORTRAITS_JS = fs.readFileSync(path.join(REPO, "site", "portraits.js"), "utf8");
const INDEX_FILE = path.join(REPO, "art", "site", "portraits", "portraits.json");
const CARDS = require(path.join(REPO, "site", "play-data.js"));

/* The picker filters on a substring, so "Hardware Avatar" counts too — four
 * cards that any test hard-coding 88 would silently stop covering. */
const AVATARS = CARDS.filter((card) => card.type && card.type.indexOf("Avatar") >= 0);

/* portraits.js is a browser IIFE that assigns globalThis.E1Portraits. Loading
 * it with a chosen `fetch` is the whole harness: `null` models the file:// page
 * that cannot read the index at all, which is the case the derived slug exists
 * for. */
async function loadPortraits(index) {
  if (index === null) delete globalThis.fetch;
  else globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(index) });
  delete globalThis.E1Portraits;
  new Function(PORTRAITS_JS)();
  const P = globalThis.E1Portraits;
  await P.ready;
  return P;
}

const realIndex = () => JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));

/* The seat picker lives in play.js and only exists once it has written options
 * into a <select>, so reading it means running play.js against a stub DOM —
 * the same trick tests/js/client.test.mjs uses, trimmed to the setup screen.
 * Without it the picker's contract is untested and the only proof of what a
 * player sees is somebody re-deriving the rule in a scratch file. */
const PLAY_JS = fs.readFileSync(path.join(REPO, "site", "play.js"), "utf8");

function stubElement(id) {
  const style = { setProperty(n, v) { this[n] = String(v); }, getPropertyValue(n) { return this[n] || ""; } };
  return {
    id, hidden: false, textContent: "", value: "", className: "", innerHTML: "",
    disabled: false, dataset: {}, children: [], style, listeners: {}, attributes: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {},
    setAttribute(n, v) { this.attributes[n] = String(v); },
    getAttribute(n) { return this.attributes[n]; },
    append(...k) { for (const x of k) { if (x && typeof x === "object") x._parent = this; this.children.push(x); } },
    appendChild(k) { if (k && typeof k === "object") k._parent = this; this.children.push(k); return k; },
    prepend(...k) { for (const x of k) { if (x && typeof x === "object") x._parent = this; this.children.unshift(x); } },
    closest: () => null, querySelectorAll: () => [], focus() {},
    remove() { if (!this._parent) return; this._parent.children = this._parent.children.filter((c) => c !== this); this._parent = null; },
    click() { for (const f of this.listeners.click || []) f({ preventDefault() {} }); },
  };
}

/* Loads play.js with the setup screen built. `portraits` mirrors loadPortraits:
 * null is the page that has no portraits.js at all, which is the ONLY path on
 * which a card face is ever shown — and therefore the path this harness has to
 * be able to reach. */
function loadPicker(portraits) {
  const nodes = new Map();
  const byId = (id) => { if (!nodes.has(id)) nodes.set(id, stubElement(id)); return nodes.get(id); };
  const fired = {};
  globalThis.document = {
    body: byId("body"), getElementById: byId, createElement: (t) => stubElement(t),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
  globalThis.window = { addEventListener(t, f) { (fired[t] = fired[t] || []).push(f); } };
  if (portraits) globalThis.E1Portraits = portraits; else delete globalThis.E1Portraits;
  globalThis.E1Engine = require(path.join(REPO, "site", "engine.js"));
  globalThis.E1_CARDS = CARDS;
  globalThis.E1_PRECONS = require(path.join(REPO, "site", "precons.js"));
  globalThis.E1Engine.setCatalog(CARDS);
  /* play.js calls into the transport at boot; a stub that answers nothing keeps
   * the lobby out of the way of the setup screen this test is about. */
  globalThis.E1Net = { connect() {}, on() {}, publish() {}, act: () => false, handlers: {} };
  delete globalThis.E1FX;
  new Function(PLAY_JS)();
  for (const f of fired.DOMContentLoaded || []) f();
  return byId;
}

/* setFace() assigns img.src as a property, paintFace() a src attribute — the
 * test does not care which, only what the browser would fetch. */
const srcOf = (node) => node.src || node.getAttribute("src") || null;

test("every Avatar card finds a character — 92 of 92, index or no index", async () => {
  assert.equal(AVATARS.length, 92, "the set has 92 Avatar cards, four of them Hardware Avatars");
  const bare = await loadPortraits(null);
  const slugs = AVATARS.map((card) => bare.slugFor(card.name));
  assert.equal(slugs.filter(Boolean).length, 92, "a card with no character is a player with no face");
  assert.equal(new Set(slugs).size, 30, "92 cards, 30 characters — five Rootzoll cards are one face");

  const full = await loadPortraits(realIndex());
  const urls = AVATARS.map((card) => full.urlFor(card.name));
  assert.equal(urls.filter(Boolean).length, 92, "every character the cards name must have a portrait");
  assert.deepEqual(slugs, AVATARS.map((card) => full.slugFor(card.name)),
    "the index must confirm the derived rule, never contradict it");
});

test("the two names that break the obvious rule", async () => {
  const P = await loadPortraits(null);
  /* 600.wtf publishes this character as "p"; every one of their three cards is
   * titled "Proton, …", so a name-based lookup would find none of them. */
  assert.equal(P.slugFor("Proton, Packet Saint"), "p");
  /* The space becomes a hyphen, because that is what named the file. Collapsing
   * it away gives "tonichina" and loses four cards. */
  assert.equal(P.slugFor("Toni China, Street Envoy"), "toni-china");
  /* A duo card wears the first name's face; there is one portrait slot. */
  assert.equal(P.slugFor("Rootzoll & Leon, Dual Operator"), "rootzoll");
  /* A seat name arrives whole, with no comma to cut at — this is the key both
   * clients hold in a networked match, and it must land on the same face. */
  assert.equal(P.slugFor("FLX"), P.slugFor("FLX, Signal Runner"));
  assert.equal(P.slugFor("Player 1"), "player-1", "a name nobody has still resolves, and then misses");
  assert.equal(P.slugFor(""), null);
  assert.equal(P.slugFor(null), null);
});

test("a name nobody in the roster carries answers with nothing", async () => {
  const P = await loadPortraits(realIndex());
  assert.equal(P.verified(), true);
  assert.equal(P.urlFor("Player 1"), null);
  assert.equal(P.urlFor("Zap"), null);
  /* The catastrophe this rule is shaped to avoid: matching a character name
   * anywhere inside a card name puts Proton on "Power Cell" and Sat on
   * "Satoshi Orchard". Exact head, exact miss. */
  const others = CARDS.filter((card) => !card.type || card.type.indexOf("Avatar") < 0);
  const wrong = others.filter((card) => P.urlFor(card.name)).map((card) => card.name);
  assert.deepEqual(wrong, [], "no card that is not an Avatar may claim a character's face");
});

test("without the index the file name is assumed; with it, it is read", async () => {
  const bare = await loadPortraits(null);
  assert.equal(bare.verified(), false, "nothing was read, so nothing is vouched for");
  assert.equal(bare.urlFor("Rootzoll, First Node"), "../art/site/portraits/rootzoll.webp");
  /* Unverified means optimistic: it cannot yet know this character is absent,
   * and the caller's img onerror is what turns that into a fallback. */
  assert.ok(bare.urlFor("Nobody At All"), "an unread index must not blank every face");

  const full = await loadPortraits({
    portraits: [{ slug: "rootzoll", name: "Rootzoll", card_aliases: ["Rootzoll"], file: "rootzoll.png" }],
  });
  assert.equal(full.urlFor("Rootzoll, First Node"), "../art/site/portraits/rootzoll.png");
  assert.equal(full.urlFor("Nobody At All"), null, "a read index is allowed to say no");
});

test("an alias in the index joins the map; a file name in it cannot leave the directory", async () => {
  const P = await loadPortraits({
    portraits: [
      { slug: "gadaj", name: "Gadaj", card_aliases: ["Gadaj", "GDJ"], file: "gadaj.webp" },
      { slug: "evil", name: "Evil", card_aliases: ["Evil"], file: "../../../etc/passwd" },
    ],
  });
  assert.equal(P.urlFor("GDJ, Night Shift"), "../art/site/portraits/gadaj.webp");
  const escaped = P.urlFor("Evil, Path Walker");
  assert.ok(escaped.indexOf("../art/site/portraits/") === 0 && escaped.indexOf("/", 22) < 0,
    `a file name out of a JSON document must stay a file name: ${escaped}`);
});

test("a second roster cannot take a name the cards already use", async () => {
  /* The index carries two rosters and the sec1 half is a live third-party file,
   * so a member there named after a character on a card is a change nobody in
   * this repo makes or reviews. Sorted by source, every sec1 entry lands after
   * every join entry — last-write-wins on the alias map would hand all of that
   * character's cards, and any seat using their name, a stranger's face. */
  const P = await loadPortraits({
    portraits: [
      { slug: "sat", source: "join", name: "Sat", card_aliases: ["Sat"], file: "sat.webp" },
      { slug: "sat-2", source: "sec1", name: "Sat", card_aliases: [], file: "sat-2.webp" },
    ],
  });
  assert.equal(P.urlFor("Sat, Blade Firewall"), "../art/site/portraits/sat.webp");
  assert.equal(P.urlFor("Sat"), "../art/site/portraits/sat.webp");
  /* The stranger keeps their own portrait; they just cannot answer to a name
   * that is already somebody's. */
  assert.equal(P.urlFor("sat-2"), "../art/site/portraits/sat-2.webp");
});

test("a character's own slug outranks every alias, including the built-in two", async () => {
  /* "proton" is hard-coded to mean the character the cards call P, for the
   * file:// page that can never read the index. The moment the roster carries
   * somebody whose own slug IS proton, that hard-coded pair is a wrong answer
   * about a real person — and the right answer must not depend on where in the
   * index that person happens to sit, which is why both orders are checked. */
  const roster = [
    { slug: "p", name: "P", card_aliases: ["P", "Proton"], file: "p.webp" },
    { slug: "proton", name: "Proton", card_aliases: [], file: "proton.webp" },
  ];
  for (const portraits of [roster, roster.slice().reverse()]) {
    const P = await loadPortraits({ portraits });
    assert.equal(P.urlFor("Proton, Packet Saint"), "../art/site/portraits/proton.webp");
    assert.equal(P.urlFor("P, Cold Relay"), "../art/site/portraits/p.webp");
  }
});

test("the seat picker lists people, and no character is represented by a duo card", async () => {
  const byId = loadPicker(null);
  const select = byId("avatarA");
  assert.equal(select.children.length, 31, "30 characters plus 'No Avatar'");
  const labels = select.children.map((option) => option.textContent);
  assert.equal(labels[0], "No Avatar - just my name");
  assert.deepEqual(labels.filter((label) => label.indexOf(",") >= 0), [],
    "a comma means a CARD name leaked into a menu that lists people");

  /* With no portraits.js the card face is the only face there is, so this is
   * the picture a player actually gets. "Rootzoll & Leon, Dual Operator" sorts
   * ahead of every solo Rootzoll card, and picking one character must not hand
   * back a portrait of two. */
  const preview = byId("avatarPreviewA");
  for (const option of select.children.slice(1)) {
    select.value = option.value;
    for (const fn of select.listeners.change || []) fn({});
    const src = decodeURIComponent(srcOf(preview) || "");
    assert.ok(src, `${option.textContent} previews nothing at all`);
    assert.ok(src.indexOf("&") < 0, `${option.textContent} is represented by a duo card: ${src}`);
  }
});

test("the picker preview stops overriding the card crop the stylesheet owns", async () => {
  /* play.html's .avatar-preview already carries aspect-ratio 744/1039 and
   * object-position 50% 22%. Repeating those numbers here made two copies of
   * one crop with nothing linking them; the square portrait is the only case
   * that has to override, and the card case clears it. */
  const byId = loadPicker(null);
  const select = byId("avatarA");
  const preview = byId("avatarPreviewA");
  select.value = select.children[1].value;
  for (const fn of select.listeners.change || []) fn({});
  assert.equal(preview.style.aspectRatio, "", "the card crop belongs to play.html, not to play.js");
  assert.equal(preview.style.objectPosition, "");

  /* A portrait is square and must override, or it renders as a strip of a face. */
  const withPortraits = loadPicker({
    slugFor: (text) => String(text).split(",")[0].split("&")[0].trim().toLowerCase(),
    urlFor: (text) => "../art/site/portraits/"
      + String(text).split(",")[0].split("&")[0].trim().toLowerCase() + ".webp",
    ready: Promise.resolve(true), verified: () => true, characters: () => [],
  });
  const select2 = withPortraits("avatarA");
  const preview2 = withPortraits("avatarPreviewA");
  select2.value = select2.children[1].value;
  for (const fn of select2.listeners.change || []) fn({});
  assert.equal(preview2.style.aspectRatio, "1 / 1");
  assert.ok(srcOf(preview2).indexOf("../art/site/portraits/") === 0);
});

test("the built portraits on disk cover every character the cards name", async (t) => {
  if (!fs.existsSync(INDEX_FILE)) {
    /* art/site/portraits/ is a build output of scripts/build_portraits.py. A
     * checkout that has not run it still gets every test above. */
    return t.skip("art/site/portraits/portraits.json is not built here");
  }
  const index = realIndex();
  const P = await loadPortraits(index);
  const dir = path.dirname(INDEX_FILE);
  for (const card of AVATARS) {
    const slug = P.slugFor(card.name);
    const entry = index.portraits.find((p) => p.slug === slug);
    assert.ok(entry, `${card.name} resolves to "${slug}", which the index does not carry`);
    assert.ok(fs.existsSync(path.join(dir, entry.file)), `${entry.file} is indexed but not on disk`);
  }
});
