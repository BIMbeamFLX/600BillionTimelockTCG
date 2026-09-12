/* The Fast card values: their own catalog, chosen by the game's ruleset.
 * Run with `npm run test:js`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "..", "site");
const require = createRequire(import.meta.url);

const CLASSIC = require(path.join(siteDir, "play-data.js"));
const FAST = require(path.join(siteDir, "play-data-fast.js"));
const E = require(path.join(siteDir, "engine.js"));
E.setCatalog(CLASSIC);
E.setCatalog(FAST, "F1.0");

const config = (ruleset) => Object.assign({
  seats: [{ name: "P1", affinity: "Power" }, { name: "P2", affinity: "Keys" }],
  seeds: { public: 12345, hidden: [777, 888] },
  firstPlayer: 0,
}, ruleset ? { ruleset } : {});
const act = (state, type, seat, payload) => E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

test("a Fast game is dealt from the Fast catalog, a Classic game from Classic", () => {
  const fast = E.createGame(config("F1.0"));
  const classic = E.createGame(config());
  assert.equal(fast.catalogDigest, E.buildCatalog(FAST).digest);
  assert.equal(classic.catalogDigest, E.buildCatalog(CLASSIC).digest);
  assert.notEqual(fast.catalogDigest, classic.catalogDigest);
  const cardIds = (state) => Object.values(state.objects).map((object) => object.cardId).filter(Boolean);
  const fastById = Object.fromEntries(FAST.map((card) => [card.id, card]));
  assert.equal(cardIds(fast).some((id) => /Resource/.test(fastById[id].type)), false, "no Resource card in a Fast Stack");
  // And play goes on under the ruleset's own catalog: apply checks the digest.
  assert.equal(act(fast, "PASS_PRIORITY", 0).error, null);
  assert.equal(act(classic, "PASS_PRIORITY", 0).error, null);
});

test("the classic pinned hash is untouched by registering a Fast catalog", () => {
  // profile.test.mjs pins this game's bytes without a Fast catalog; the same
  // Classic deal must not notice that one is registered in this process.
  const script = `
    const E = require(${JSON.stringify(path.join(siteDir, "engine.js"))});
    E.setCatalog(require(${JSON.stringify(path.join(siteDir, "play-data.js"))}));
    process.stdout.write(E.hashState(E.createGame(${JSON.stringify(config())})));`;
  const alone = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(E.hashState(E.createGame(config())), alone);
});

test("only a known ruleset can register a catalog", () => {
  assert.throws(() => E.setCatalog(FAST, "F9.9"), (error) => error.code === "SCHEMA");
  assert.throws(() => E.setCatalog(FAST, "constructor"), (error) => error.code === "SCHEMA");
});

test("a Resource card redesigned as Hardware ramps under Fast", () => {
  const state = E.createGame(config("F1.0"));
  const plant = FAST.find((card) => card.name === "Power Plant — Solar" || card.id === "E1-293");
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = {
    uid, cardId: plant.id, owner: 0, controller: 0, zone: "0:wallet", committed: false,
    bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [0], revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
  };
  state.zones["0:wallet"].push(uid);
  state.seats[0].buffer.N = 2;
  let result = act(state, "PLAY_CARD", 0, { uid });
  assert.equal(result.error, null, JSON.stringify(result.error));
  const entered = result.events.find((e) => e.t === "ENTERS");
  assert.ok(entered, "the Hardware entered the Network");
  const placed = entered.pub.uid;
  // Boot Delay does not stop Hardware committing; generate one Power.
  result = act(result.state, "ACTIVATE_ABILITY", 0, { uid: placed, abilityIndex: 0 });
  assert.equal(result.error, null, JSON.stringify(result.error));
  const total = Object.values(result.state.seats[0].buffer).reduce((a, b) => a + b, 0);
  assert.equal(total, 1, "one Resource generated for this turn");
});

test("the Fast values keep every Classic card identity", () => {
  assert.equal(FAST.length, CLASSIC.length);
  FAST.forEach((card, i) => {
    assert.equal(card.id, CLASSIC[i].id);
    assert.equal(card.name, CLASSIC[i].name);
    assert.equal(card.face, CLASSIC[i].face);
  });
});

test("no Fast card prints a mechanic a Fast turn can never reach", () => {
  /* Fast has no Clash declarations, no opponent's-turn windows, no Resource
   * cards and no Queue to wait on. A card whose play window, trigger, timing or
   * mode list depends on one of those is dead in every Fast Stack. */
  const deadWindows = new Set(["blockers", "clash-before-blockers", "opponent-before-attackers", "before-clash-damage"]);
  const dead = [];
  for (const raw of FAST) {
    const card = E.compileCard(raw);
    const why = [];
    for (const restriction of card.playRestrictions || []) {
      if (deadWindows.has(restriction.window)) why.push(`plays only in ${restriction.window}`);
    }
    if (card.playModes && card.playModes.length < 2) why.push("a choice of one");
    for (const ability of card.abilities) {
      if (ability.timing && /clash|attackers|blockers/.test(ability.timing)) why.push(`timing ${ability.timing}`);
      if (ability.trigger && /resource-played|"what":"Resource"|blocks-non-firewall/.test(JSON.stringify(ability.trigger))) {
        why.push(`trigger ${JSON.stringify(ability.trigger)}`);
      }
    }
    for (const spec of card.playTargetSpec || []) {
      if (/Resource|^queue$/.test(spec.kind)) why.push(`targets ${spec.kind}`);
    }
    if (why.length) dead.push(`${card.id} ${card.name}: ${why.join("; ")}`);
  }
  assert.deepEqual(dead, []);
});
