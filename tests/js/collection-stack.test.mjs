/* site/collection-stack.js — the player's own cards as a legal Stack.
 *
 * The engine is the judge here, as it is for every other Stack: a collection
 * Stack is only as good as createGame's willingness to deal it, under the
 * rules it was built for. The fixtures are picked from the card data by what
 * they are (a mono-Power Avatar, a Neutral Genesis), never by a pinned id, so
 * a retuned card changes which card is used and not whether the test holds.
 *
 * Run: node --test tests/js/collection-stack.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "site");
const CLASSIC = require(path.join(SITE, "play-data.js"));
const FAST = require(path.join(SITE, "play-data-fast.js"));
const PRECONS = require(path.join(SITE, "precons.js"));
const PRECONS_FAST = require(path.join(SITE, "precons-fast.js"));
const E = require(path.join(SITE, "engine.js"));
const CS = require(path.join(SITE, "collection-stack.js"));
E.setCatalog(CLASSIC);
E.setCatalog(FAST, "F1.0");

const RULESETS = ["F1.0", "E1.0"];
const CARDS = { "F1.0": FAST, "E1.0": CLASSIC };
const STARTERS = { "F1.0": PRECONS_FAST, "E1.0": PRECONS };
const BY_ID = {
  "F1.0": Object.fromEntries(FAST.map((card) => [card.id, card])),
  "E1.0": Object.fromEntries(CLASSIC.map((card) => [card.id, card])),
};

const build = (ruleset, owned, extra) =>
  CS.buildCollectionStack(CARDS[ruleset], owned, Object.assign({ profile: ruleset, precons: STARTERS[ruleset] }, extra));

const tally = (ids) => {
  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
};
const multiset = (ids) => [...tally(ids)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const starterOf = (ruleset, affinity) =>
  Object.values(STARTERS[ruleset]).find((precon) => precon.group === "Starter" && precon.affinity === affinity);

/* The Stack's curve, named by the quota each card falls under. */
function shape(ruleset, ids) {
  const out = {};
  for (const id of ids) {
    const quota = CS.QUOTAS[ruleset].find((entry) => entry.test(BY_ID[ruleset][id]));
    const name = quota ? quota.name : "other";
    out[name] = (out[name] || 0) + 1;
  }
  return out;
}
const quotaShape = (ruleset) => Object.fromEntries(CS.QUOTAS[ruleset].map((quota) => [quota.name, quota.count]));

function deal(ruleset, seats) {
  const config = { seats, seeds: { public: 11, hidden: [12, 13] }, firstPlayer: 0 };
  if (ruleset === "F1.0") config.ruleset = ruleset;
  return E.createGame(config);
}

function assertLegal(ruleset, ids, what) {
  assert.equal(ids.length, E.MIN_STACK, `${what}: a full Stack`);
  for (const [id, copies] of tally(ids)) {
    assert.ok(copies <= E.copyLimit(BY_ID[ruleset][id]), `${what}: ${copies} copies of ${id}`);
  }
  assert.doesNotThrow(() => deal(ruleset, [{ name: "Mine", deck: ids.slice() }, { name: "Foe", affinity: "Signal" }]), what);
}

const stakeFree = (card) => !/stake/i.test(card.type || "") && !/\bStake\b/.test(card.text || "");
const isAvatar = (card) => card.type.indexOf("Avatar") >= 0;
const isSpell = (card) => !isAvatar(card) && (card.type === "Zap" || card.type === "Operation");
const isPermanent = (card) => !isAvatar(card) && (card.type === "Hardware" || card.type === "Protocol");
const mono = (ruleset, affinity, kind) => CARDS[ruleset].filter((card) =>
  card.affinity.length === 1 && card.affinity[0] === affinity && stakeFree(card) && kind(card));
const capped4 = (card) => E.copyLimit(card) === 4;

// ------------------------------------------------------------------ quotas

test("the quotas are the curve the engine itself deals", () => {
  /* buildDeckList does not export its quotas, so collection-stack.js names
     them; this is what keeps the copy honest. Every affinity's auto-built
     Stack has exactly the quota shape under both rules. */
  for (const ruleset of RULESETS) {
    for (const affinity of CS.AFFINITIES) {
      const state = deal(ruleset, [{ name: "A", affinity }, { name: "B", affinity: "Keys" }]);
      const ids = Object.values(state.objects).filter((object) => object.owner === 0).map((object) => object.cardId);
      assert.deepEqual(shape(ruleset, ids), quotaShape(ruleset), `${ruleset} ${affinity}`);
    }
  }
  assert.deepEqual(quotaShape("F1.0"), { avatars: 20, spells: 12, permanents: 8 });
  assert.deepEqual(quotaShape("E1.0"), { resources: 17, avatars: 14, spells: 5, permanents: 4 });
});

test("the quotas bind the owned cards too", () => {
  const avatars = mono("F1.0", "Power", (card) => isAvatar(card) && capped4(card));
  assert.ok(avatars.length > 20, "the fixture needs more Power Avatars than the quota");
  const owned = new Map(avatars.map((card) => [card.id, 1]));
  const fast = build("F1.0", owned);
  assert.equal(fast.affinity, "Power");
  assert.equal(fast.fromCollection, 20, "twenty owned Avatars and no more");
  assert.deepEqual(shape("F1.0", fast.ids), quotaShape("F1.0"));
  assertLegal("F1.0", fast.ids, "Fast, over quota");

  const classicAvatars = mono("E1.0", "Power", (card) => isAvatar(card) && capped4(card));
  const classic = build("E1.0", new Map(classicAvatars.map((card) => [card.id, 4])));
  assert.equal(classic.fromCollection, 14, "Classic takes fourteen");
  assert.deepEqual(shape("E1.0", classic.ids), quotaShape("E1.0"));
  assertLegal("E1.0", classic.ids, "Classic, over quota");
});

// ------------------------------------------------------- owned cards first

test("owned cards go in first, never past a card's copy limit or what is owned", () => {
  const [avatar] = mono("F1.0", "Power", (card) => isAvatar(card) && capped4(card));
  const genesis = FAST.find((card) => card.rarity === "genesis" && card.affinity[0] === "Neutral" && stakeFree(card));
  const [spell] = mono("F1.0", "Power", (card) => isSpell(card) && capped4(card));
  const stack = build("F1.0", new Map([[avatar.id, 7], [genesis.id, 3], [spell.id, 2]]));
  assert.equal(E.copyLimit(genesis), 1, "the fixture is a one-per-Stack card");
  assert.equal(stack.fromCollection, 7, "4 of the Avatar, 1 Genesis, both spells");
  assert.equal(stack.filled, 33);
  assert.deepEqual(multiset(stack.ids.slice(0, stack.fromCollection)),
    multiset([avatar.id, avatar.id, avatar.id, avatar.id, genesis.id, spell.id, spell.id]));
  assert.equal(tally(stack.ids).get(avatar.id), 4, "the Starter adds no fifth copy");
  assert.equal(tally(stack.ids).get(genesis.id), 1);
  assertLegal("F1.0", stack.ids, "limits");

  /* Classic: a Basic Resource is uncapped, so the quota is what stops it. */
  const basic = CLASSIC.find((card) => card.type === "Basic Resource" && card.affinity.indexOf("Power") >= 0);
  const classic = build("E1.0", new Map([[basic.id, 25]]));
  assert.equal(classic.fromCollection, 17);
  assert.equal(tally(classic.ids).get(basic.id), 17);
  assertLegal("E1.0", classic.ids, "an uncapped Resource");
});

test("a Stake card never joins a Stack, owned or not", () => {
  const stake = FAST.find((card) => !stakeFree(card));
  const stack = build("F1.0", new Map([[stake.id, 3]]), { affinity: stake.affinity[0] });
  assert.equal(stack.fromCollection, 0);
  assert.equal(stack.ids.indexOf(stake.id), -1);
  assertLegal("F1.0", stack.ids, "Stake");
});

// -------------------------------------------------------------- affinity

test("the affinity keeps the most owned cards, ties by its own cards, then menu order", () => {
  const avatarsOf = (affinity) => mono("F1.0", affinity, (card) => isAvatar(card) && capped4(card));
  const pick = (owned) => CS.pickAffinity(FAST, owned, { profile: "F1.0" });
  const ones = (cards) => cards.map((card) => [card.id, 1]);

  assert.equal(pick(new Map([...ones(avatarsOf("Keys").slice(0, 3)), ...ones(avatarsOf("Power").slice(0, 2))])), "Keys");
  assert.equal(pick(new Map([...ones(avatarsOf("Bitcoin").slice(0, 1)), ...ones(avatarsOf("Power").slice(0, 1))])), "Power",
    "an even split plays the affinity listed first");
  const neutral = FAST.filter((card) => card.affinity[0] === "Neutral" && stakeFree(card) && capped4(card)).slice(0, 6);
  assert.equal(pick(new Map(ones(neutral))), "Power", "Neutral alone fits every Stack; the first one listed plays");
  assert.equal(pick(new Map()), "Power");

  /* Twenty Bitcoin and twenty-eight Signal Avatars both fill the quota of
     twenty. The quota ties, so the affinity with more of its own cards wins —
     although Bitcoin is listed before Signal. */
  const bitcoin = avatarsOf("Bitcoin").slice(0, 5).map((card) => [card.id, 4]);
  const signal = avatarsOf("Signal").slice(0, 7).map((card) => [card.id, 4]);
  assert.equal(signal.length, 7, "fixture: seven Signal Avatars");
  assert.equal(pick(new Map([...bitcoin, ...signal])), "Signal");

  /* More cards that PLAY beats more cards: 25 Power Avatars fill 20 slots,
     while 22 Bitcoin cards across the curve all fit. */
  const power = avatarsOf("Power").slice(0, 7).map((card, index) => [card.id, index < 6 ? 4 : 1]);
  const spread = [
    ...avatarsOf("Bitcoin").slice(0, 2).map((card) => [card.id, 4]),
    ...mono("F1.0", "Bitcoin", (card) => isSpell(card) && capped4(card)).slice(0, 2).map((card) => [card.id, 4]),
    ...mono("F1.0", "Bitcoin", (card) => isPermanent(card) && capped4(card)).slice(0, 2).map((card) => [card.id, 3]),
  ];
  const spreadOwned = new Map([...power, ...spread]);
  assert.equal(pick(spreadOwned), "Bitcoin");
  assert.equal(build("F1.0", spreadOwned).fromCollection, 22);
});

test("a two-affinity card counts for both, and a chosen affinity leaves the rest out", () => {
  const dual = FAST.find((card) => card.affinity.length === 2 && card.affinity.indexOf("Signal") >= 0
    && card.affinity.indexOf("Timelock") >= 0);
  const [timelock] = mono("F1.0", "Timelock", (card) => isAvatar(card) && capped4(card));
  const stack = build("F1.0", new Map([[dual.id, 1], [timelock.id, 1]]));
  assert.equal(stack.affinity, "Timelock", "Timelock keeps both cards, Signal only one");
  assert.deepEqual(multiset(stack.ids.slice(0, stack.fromCollection)), multiset([dual.id, timelock.id]));

  const [power] = mono("F1.0", "Power", (card) => isAvatar(card) && capped4(card));
  const neutral = FAST.find((card) => card.affinity[0] === "Neutral" && isPermanent(card) && capped4(card) && stakeFree(card));
  const chosen = build("F1.0", new Map([[power.id, 2], [neutral.id, 1]]), { affinity: "Timelock" });
  assert.equal(chosen.affinity, "Timelock");
  assert.equal(chosen.fromCollection, 1, "only the Neutral card fits a Timelock Stack");
  assert.equal(chosen.ids.indexOf(power.id), -1);
  assertLegal("F1.0", chosen.ids, "a chosen affinity");
  assert.equal(build("F1.0", new Map([[power.id, 2]]), { affinity: "Plasma" }).affinity, "Power",
    "an affinity the set does not have is not a choice");
});

// ------------------------------------------------------------------ fills

test("an empty collection plays that affinity's Starter, every card filled", () => {
  for (const ruleset of RULESETS) {
    const stack = build(ruleset, new Map());
    assert.equal(stack.affinity, "Power");
    assert.equal(stack.fromCollection, 0);
    assert.equal(stack.filled, 40);
    assert.deepEqual(multiset(stack.ids), multiset(starterOf(ruleset, "Power").cards), `${ruleset} Power Starter`);
    const keys = build(ruleset, {}, { affinity: "Keys" });
    assert.deepEqual(multiset(keys.ids), multiset(starterOf(ruleset, "Keys").cards), `${ruleset} Keys Starter`);
    assertLegal(ruleset, stack.ids, `${ruleset} empty`);
  }
});

test("owned Starter cards are swapped in; other owned cards push Starter copies out", () => {
  for (const ruleset of RULESETS) {
    const starter = starterOf(ruleset, "Power");
    const counts = tally(starter.cards);

    const whole = build(ruleset, counts);
    assert.equal(whole.fromCollection, 40, `${ruleset}: the whole Starter, all of it yours`);
    assert.equal(whole.filled, 0);
    assert.deepEqual(multiset(whole.ids), multiset(starter.cards));

    const part = new Map([...counts].slice(0, 6));
    const swapped = build(ruleset, part);
    const partCopies = [...part.values()].reduce((sum, n) => sum + n, 0);
    assert.equal(swapped.fromCollection, partCopies);
    assert.equal(swapped.filled, 40 - partCopies);
    assert.deepEqual(multiset(swapped.ids), multiset(starter.cards), `${ruleset}: the Starter, with your copies in it`);

    /* Three Power Avatars the Starter does not list: three Starter copies go. */
    const outsiders = mono(ruleset, "Power", (card) => isAvatar(card) && capped4(card) && !counts.has(card.id)).slice(0, 3);
    assert.equal(outsiders.length, 3, `${ruleset}: fixture`);
    const pushed = build(ruleset, new Map(outsiders.map((card) => [card.id, 1])));
    assert.equal(pushed.fromCollection, 3);
    const rest = tally(pushed.ids.slice(3));
    assert.equal(pushed.ids.length - 3, 37);
    for (const [id, copies] of rest) {
      assert.ok(copies <= (counts.get(id) || 0), `${ruleset}: ${id} is a Starter card, at most the Starter's copies`);
    }
    assert.deepEqual(shape(ruleset, pushed.ids), quotaShape(ruleset));
    assertLegal(ruleset, pushed.ids, `${ruleset} pushed`);
  }
});

test("with no Starter the pool fills the Stack the way buildDeckList does", () => {
  const stack = build("F1.0", new Map(), { affinity: "Neutral" });
  assert.equal(stack.affinity, "Neutral");
  assert.ok(stack.ids.every((id) => BY_ID["F1.0"][id].affinity.indexOf("Neutral") >= 0), "Neutral cards only");
  const state = deal("F1.0", [{ name: "A", affinity: "Neutral" }, { name: "B", affinity: "Keys" }]);
  const engine = Object.values(state.objects).filter((object) => object.owner === 0).map((object) => object.cardId);
  assert.deepEqual(shape("F1.0", stack.ids), shape("F1.0", engine), "the same curve when the categories run dry");
  assertLegal("F1.0", stack.ids, "Neutral");

  /* The top-ups take leftover owned cards before the pool's. */
  const permanents = FAST.filter((card) => card.affinity[0] === "Neutral" && isPermanent(card) && capped4(card) && stakeFree(card));
  const owned = new Map(permanents.slice(0, 5).map((card) => [card.id, 4]));
  const topped = build("F1.0", owned, { affinity: "Neutral" });
  assert.equal(topped.fromCollection, 20, "8 in the quota, 12 more where the Avatars ran out");
  assertLegal("F1.0", topped.ids, "Neutral top-up");
});

// ------------------------------------------------------------ determinism

test("one collection deals one Stack, whatever shape it arrives in, and no dice are rolled", (t) => {
  const random = Math.random;
  Math.random = () => { throw new Error("Math.random in a pure builder"); };
  t.after(() => { Math.random = random; });
  const avatars = mono("F1.0", "Keys", (card) => isAvatar(card) && capped4(card)).slice(0, 9);
  const entries = avatars.map((card, index) => [card.id, 1 + (index % 4)]);
  for (const ruleset of RULESETS) {
    const first = build(ruleset, new Map(entries));
    assert.deepEqual(build(ruleset, new Map(entries)), first, `${ruleset}: the same input, the same Stack`);
    assert.deepEqual(build(ruleset, Object.fromEntries(entries)), first, `${ruleset}: an object`);
    assert.deepEqual(build(ruleset, entries.slice().reverse()), first, `${ruleset}: pairs, reversed`);
    assert.deepEqual(build(ruleset, new Map([...entries, ["E1-999", 3], ["E1-001", 0]])), first,
      `${ruleset}: ids off the catalog and zero counts change nothing`);
    const other = build(ruleset, new Map(entries.slice(1)));
    assert.notDeepEqual(other.ids, first.ids, `${ruleset}: another collection, another Stack`);
  }
});

// ---------------------------------------------------------- the inventory

test("asset ids are card ids; anything else is ignored and counted", () => {
  const counts = new Map([
    ["E1-001", 2], ["E1-157", 1],
    ["600B-E1-001", 1], // the shape Bearlett's test mint names its assets
    ["e1-157", 2], ["E1-999", 3],
    ["E1-042", 0], ["E1-043", 1.5],
  ]);
  const read = CS.ownedFromInventory(counts, FAST);
  assert.deepEqual([...read.owned], [["E1-001", 2], ["E1-157", 1]]);
  assert.equal(read.cards, 3, "copies of cards this edition knows");
  assert.equal(read.unknown, 6, "copies of ids it does not");
  assert.deepEqual(read.unknownIds, ["600B-E1-001", "E1-999", "e1-157"]);
  const engineCatalog = E.buildCatalog(FAST);
  assert.deepEqual(CS.ownedFromInventory(counts, engineCatalog), read, "an engine catalog reads the same");
  assert.deepEqual(CS.ownedFromInventory(null, FAST), { owned: new Map(), cards: 0, unknown: 0, unknownIds: [] });
});

test("every collection Stack is legal under the rules it was built for", () => {
  /* Collections drawn from the engine's own stream, so the sample is fixed:
     any card (Genesis, Basics, Stake cards, two-affinity Hardware), any count. */
  const stream = E.newStream(600);
  const ids = FAST.map((card) => card.id);
  for (let round = 0; round < 40; round += 1) {
    const owned = new Map();
    const draws = E.nextInt(stream, 70);
    for (let i = 0; i < draws; i += 1) {
      const id = ids[E.nextInt(stream, ids.length)];
      owned.set(id, (owned.get(id) || 0) + 1 + E.nextInt(stream, 3));
    }
    for (const ruleset of RULESETS) {
      const stack = build(ruleset, owned);
      assert.equal(stack.fromCollection + stack.filled, 40);
      for (const [id, copies] of tally(stack.ids.slice(0, stack.fromCollection))) {
        assert.ok(copies <= owned.get(id), `round ${round} ${ruleset}: ${id} is owned ${owned.get(id)} times`);
      }
      assertLegal(ruleset, stack.ids, `round ${round} ${ruleset}`);
    }
  }
});

test("a collection holding every genesis card four times plays each of them once, under both rules", () => {
  /* The referee refuses a second genesis copy at the message boundary (cleanDeck asks
     E.copyLimit), so a collection Stack must never carry one. */
  for (const ruleset of RULESETS) {
    const genesis = CARDS[ruleset].filter((card) => card.rarity === "genesis" && stakeFree(card));
    assert.ok(genesis.length > 1, `${ruleset}: the fixture holds several genesis cards`);
    for (const affinity of CS.AFFINITIES) {
      const stack = build(ruleset, new Map(genesis.map((card) => [card.id, 4])), { affinity });
      for (const card of genesis) assert.ok((tally(stack.ids).get(card.id) || 0) <= 1, `${ruleset} ${affinity}: ${card.id}`);
      assertLegal(ruleset, stack.ids, `${ruleset} ${affinity}`);
    }
  }
});

test("the builder refuses rules it does not know and works without the engine global only when handed one", () => {
  assert.throws(() => CS.buildCollectionStack(FAST, new Map(), { profile: "F2.0" }), /unknown rules profile/);
  assert.throws(() => CS.buildCollectionStack(FAST, new Map(), { engine: {} }), /needs site\/engine\.js/);
  assert.throws(() => CS.buildCollectionStack("cards", new Map(), { profile: "F1.0" }), /needs a card list/);
  const viaDefault = CS.buildCollectionStack(FAST, new Map(), { precons: PRECONS_FAST });
  assert.equal(viaDefault.ids.length, 40, "F1.0 is the default profile");
});

// ------------------------------------------------------ reading the wallet

const INVENTORY = {
  v: 1, kind: "nutft/inventory", edition: "600b-e1", collection_id: "600B-E1",
  catalog_uri: "https://tcg.nappelin.com/nutft/catalog", mint: "https://tcg.nappelin.com", at: 1757800000,
  cards: [{ asset_id: "E1-001", count: 2 }, { asset_id: "E1-157", count: 3 }],
};

function shell(extra) {
  return Object.assign({
    present: true,
    has: (domain) => domain === "intent" || domain === "identity",
    identity: { current: async () => "b".repeat(64) },
    collection: {
      asked: [],
      async inventory(edition) { this.asked.push(edition); return INVENTORY; },
      counts: (inventory) => new Map(inventory.cards.map((card) => [card.asset_id, card.count])),
    },
  }, extra);
}

function walletStub(state, view) {
  const calls = { read: 0, snapshot: [] };
  return {
    calls,
    read: async () => { calls.read += 1; return state; },
    snapshotReadOnly: async (origin) => {
      calls.snapshot.push(origin);
      if (view instanceof Error) throw view;
      return view;
    },
  };
}

const proof = (assetId) => ({ tag: ["1", "600B-E1", assetId, "https://tcg.nappelin.com/nutft/catalog", "b".repeat(64)] });

test("readOwned reads the way the Stack Builder always has: Bearlett first, then the wallet", async () => {
  const wallet = walletStub({ tokens: ["cashuB1"] }, { owned: [], spent: [], invalid: [], unreadable: [] });
  const napplet = shell();
  const fromShell = await CS.readOwned({ napplet, wallet, origin: "https://tcg.nappelin.com" });
  assert.deepEqual(fromShell, { source: "bearlett", counts: new Map([["E1-001", 2], ["E1-157", 3]]), opened: 5, unreadable: 0 });
  assert.deepEqual(napplet.collection.asked, ["600b-e1"]);
  assert.equal(wallet.calls.read, 0, "an inventory answers before the wallet is asked");

  const noInventory = shell({ collection: { inventory: async () => null } });
  await assert.rejects(() => CS.readOwned({ napplet: noInventory, wallet: null }), /no wallet script on this page/);
  await assert.rejects(() => CS.readOwned({}), /no wallet script on this page/);

  const empty = walletStub({ tokens: [] }, new Error("never asked"));
  assert.deepEqual(await CS.readOwned({ wallet: empty, origin: "https://x" }), { source: "wallet", counts: new Map(), opened: 0, unreadable: 0 });
  assert.equal(empty.calls.snapshot.length, 0, "an empty wallet is answered without the mint");

  const held = walletStub({ tokens: ["cashuB1", "cashuB2"] }, {
    owned: [proof("E1-157"), proof("E1-157"), proof("E1-001")],
    spent: [proof("E1-002")],
    invalid: [{ proof: {}, error: "bad" }],
    unreadable: [{ token: "cashuBdead", error: "keyset" }, { token: "cashuBgone", error: "keyset" }],
  });
  const read = await CS.readOwned({ napplet: { has: () => false }, wallet: held, origin: "https://tcg.nappelin.com" });
  assert.deepEqual(read, { source: "wallet", counts: new Map([["E1-157", 2], ["E1-001", 1]]), opened: 5, unreadable: 2 });
  assert.deepEqual(held.calls.snapshot, ["https://tcg.nappelin.com"]);
  await assert.rejects(() => CS.readWallet(walletStub({ tokens: ["x"] }, new Error("mint unreachable")), "https://x"), /mint unreachable/);
});

/* A document that records every element it is asked for. */
function recordingDocument() {
  const made = [];
  const head = { children: [], appendChild(node) { this.children.push(node); return node; } };
  return {
    made,
    head,
    createElement(tag) {
      const node = { tag, listeners: {}, addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); } };
      made.push(node);
      return node;
    },
  };
}
const fireAll = (node, type) => { for (const fn of node.listeners[type] || []) fn(); };

function withStorage(t, storage) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", Object.assign({ configurable: true }, storage));
  t.after(() => {
    if (had) Object.defineProperty(globalThis, "localStorage", had);
    else delete globalThis.localStorage;
    delete globalThis.NutFTWallet;
  });
}

const memory = (entries) => {
  const map = new Map(Object.entries(entries || {}));
  return { value: { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) } };
};

test("inside a shell only the collection intent is asked: no storage, no scripts", async (t) => {
  withStorage(t, { get() { throw new Error("localStorage in an opaque origin"); } });
  const doc = recordingDocument();

  const cards = await CS.loadCollection({ napplet: shell(), document: doc });
  assert.equal(cards.status, "cards");
  assert.equal(cards.source, "shell");
  assert.equal(cards.identity, "b".repeat(64));
  assert.deepEqual([...cards.counts], [["E1-001", 2], ["E1-157", 3]]);

  const guest = await CS.loadCollection({
    napplet: shell({ identity: { current: async () => null }, collection: { inventory: async () => null } }),
    net: { nostr: { savedPubkey: () => "c".repeat(64) } },
    document: doc,
  });
  assert.deepEqual({ status: guest.status, identity: guest.identity }, { status: "empty", identity: null },
    "the shell's empty answer is final; a site login does not stand in for it");

  const emptyInventory = await CS.loadCollection({
    napplet: shell({ collection: { inventory: async () => Object.assign({}, INVENTORY, { cards: [] }) } }),
    document: doc,
  });
  assert.equal(emptyInventory.status, "empty");

  const refused = await CS.loadCollection({
    napplet: shell({ collection: { inventory: async () => { throw new Error("host gone"); } } }),
    document: doc,
  });
  assert.equal(refused.status, "empty");

  const noIntent = await CS.loadCollection({ napplet: shell({ has: (domain) => domain === "identity" }), document: doc });
  assert.equal(noIntent.status, "unavailable");
  assert.equal(noIntent.source, "shell");

  assert.equal(doc.made.length, 0, "not one element was created");
  assert.equal(await CS.loadWallet({ napplet: shell(), document: doc }), null, "no wallet door in a shell");
  globalThis.E1Napplet = shell();
  t.after(() => { delete globalThis.E1Napplet; });
  assert.equal(await CS.loadWallet({ document: doc }), null, "nor through the page's own adapter");
  assert.equal(doc.made.length, 0);
});

test("on the website the wallet script loads only for a wallet that holds tokens", async (t) => {
  const store = memory({});
  withStorage(t, store);
  const doc = recordingDocument();
  const net = { nostr: { savedPubkey: () => "d".repeat(64) } };

  const cold = await CS.loadCollection({ net, document: doc, origin: "https://tcg.nappelin.com" });
  assert.deepEqual({ status: cold.status, source: cold.source, identity: cold.identity }, { status: "empty", source: "wallet", identity: "d".repeat(64) });
  store.value.setItem(CS.WALLET_KEY, JSON.stringify({ privateKey: "", pubkey: "", tokens: [] }));
  assert.equal((await CS.loadCollection({ document: doc })).status, "empty", "a wallet with no tokens holds no cards");
  store.value.setItem(CS.WALLET_KEY, "{not json");
  assert.equal((await CS.loadCollection({ document: doc })).status, "empty");
  assert.equal(CS.walletExists({ getItem() { throw new Error("denied"); } }), false);
  assert.equal(doc.made.length, 0, "a cold page loads nothing");

  store.value.setItem(CS.WALLET_KEY, JSON.stringify({ privateKey: "k", pubkey: "p", tokens: ["cashuB1"] }));
  assert.equal(CS.walletExists(), true);
  const pending = CS.loadCollection({ net, document: doc, origin: "https://tcg.nappelin.com" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(doc.made.length, 1, "one script tag");
  assert.equal(doc.made[0].src, "nutft-wallet.js");
  assert.equal(doc.head.children[0], doc.made[0]);
  globalThis.NutFTWallet = walletStub({ tokens: ["cashuB1"] }, { owned: [proof("E1-157")], spent: [], invalid: [], unreadable: [] });
  fireAll(doc.made[0], "load");
  const loaded = await pending;
  assert.equal(loaded.status, "cards");
  assert.deepEqual([...loaded.counts], [["E1-157", 1]]);
  assert.deepEqual(globalThis.NutFTWallet.calls.snapshot, ["https://tcg.nappelin.com"]);

  const again = await CS.loadCollection({ document: doc, origin: "https://tcg.nappelin.com" });
  assert.equal(again.status, "cards");
  assert.equal(doc.made.length, 1, "a loaded wallet is not loaded twice");

  globalThis.NutFTWallet = walletStub({ tokens: ["cashuB1"] }, new Error("mint capabilities unavailable (502)"));
  const broken = await CS.loadCollection({ document: doc, origin: "https://tcg.nappelin.com" });
  assert.deepEqual({ status: broken.status, reason: broken.reason }, { status: "unavailable", reason: "mint capabilities unavailable (502)" });
});

test("a wallet script that fails to load is said once and tried again later", async (t) => {
  withStorage(t, memory({ "600b:nutft-wallet": JSON.stringify({ tokens: ["cashuB1"] }) }));
  const doc = recordingDocument();
  const first = CS.loadCollection({ document: doc });
  await new Promise((resolve) => setImmediate(resolve));
  fireAll(doc.made[0], "error");
  const failed = await first;
  assert.deepEqual({ status: failed.status, source: failed.source }, { status: "unavailable", source: "wallet" });
  const retry = CS.loadWallet({ document: doc });
  assert.equal(doc.made.length, 2, "the next ask adds a fresh tag");
  fireAll(doc.made[1], "error");
  assert.equal(await retry, null);
});

// ------------------------------------------------------------------ words

test("the setup words: a count, or exactly why there is none", () => {
  assert.equal(CS.optionLabel(9), "My collection (9 of 40 cards yours)");
  assert.equal(CS.collectionLine({ status: "cards", cards: 12, unknown: 0 }), "Your collection: 12 cards. “My collection” is in both Stack menus.");
  assert.equal(CS.collectionLine({ status: "cards", cards: 1, unknown: 2 }),
    "Your collection: 1 card. “My collection” is in both Stack menus. 2 more cards are not part of this edition.");
  assert.equal(CS.collectionLine({ status: "empty", cards: 0, identity: null }), "Sign in to use your cards. You can play with a starter stack now.");
  assert.equal(CS.collectionLine({ status: "empty", cards: 0, identity: "a".repeat(64) }),
    "No cards in your collection yet. A card bought on tcg.nappelin.com is locked to that site's wallet: send it to your collection's address in the wallet there first, then paste the token into the collection.");
  assert.equal(CS.collectionLine({ status: "empty", source: "shell", cards: 0, identity: "a".repeat(64) }),
    "No cards in your collection yet. A card bought on tcg.nappelin.com is locked to that site's wallet: send it to your collection's address in the wallet there first, then paste the token into the collection.");
  assert.equal(CS.collectionLine({ status: "empty", source: "wallet", cards: 0, identity: "a".repeat(64) }),
    "No cards in this browser's wallet yet. Cards you buy or claim in the shop land here. You can play with a starter stack now.");
  assert.equal(CS.collectionLine({ status: "unavailable", source: "shell", cards: 0, identity: "a".repeat(64) }),
    "No card collection is reachable in this shell. You can play with a starter stack now.");
  assert.equal(CS.collectionLine({ status: "unavailable", source: "wallet", reason: "mint down", cards: 0 }),
    "Your wallet could not be read here (mint down). You can play with a starter stack now.");
  assert.equal(CS.collectionLine({ status: "cards", cards: 0, unknown: 3, identity: "a".repeat(64) }),
    "Your collection holds 3 cards this edition does not know. You can play with a starter stack now.");
});
