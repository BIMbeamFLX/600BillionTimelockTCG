/* An activated ability whose cost the compiler cannot parse used to be free:
 * strictCost was set but nothing read it, which is how E1-260 Boost Converter
 * generated unlimited mana before 1cb62da. Both activation paths now refuse it,
 * and the two printed non-symbol costs (a marker, a module gate) are charged. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CARDS = require(path.resolve(here, "..", "..", "site", "play-data.js"));
const FAST = require(path.resolve(here, "..", "..", "site", "play-data-fast.js"));
const E = require(path.resolve(here, "..", "..", "site", "engine.js"));

const byName = Object.fromEntries(CARDS.map((card) => [card.name, card]));
const PROSE = "Tap an Avatar you control";

/* Prose-cost twins of a Resource ability and a Queue ability. */
const proseTwin = (name, id, predicate) => {
  const card = structuredClone(byName[name]);
  card.id = id;
  card.name = `${name} (prose)`;
  for (const ability of card.abilities) if (predicate(ability)) ability.cost = PROSE;
  return card;
};
const PROSE_CONVERTER = proseTwin("Boost Converter", "T-901", (a) => a.cost === "Commit");
const PROSE_NIND = proseTwin("Nind, Archive Collector", "T-902", (a) => a.kind === "activated");
E.setCatalog(CARDS.concat([PROSE_CONVERTER, PROSE_NIND]));

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });
const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};
const code = (result) => result.error && result.error.code;

function game(modules) {
  const state = E.createGame({
    seats: [
      { name: "A", affinity: "Power" },
      { name: "B", affinity: "Signal" },
    ],
    seeds: { public: 883100, hidden: [883101, 883102] },
    firstPlayer: 0,
    ...(modules ? { modules } : {}),
  });
  // Give seat 0 priority in its own main phase without replaying a turn.
  state.turn.active = 0;
  state.turn.phase = "build1";
  state.turn.step = "main";
  state.awaiting = null;
  state.priority.seat = 0;
  return state;
}

function seed(state, seat, cardId, tweaks) {
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid, cardId, owner: seat, controller: seat, zone: `${seat}:network`,
      committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
      rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
      token: false, entersSeq: state.seq, prevUid: null,
    },
    tweaks || {}
  );
  state.zones[`${seat}:network`].push(uid);
  return uid;
}

const activatedIndex = (card, predicate = () => true) =>
  card.abilities.findIndex((a) => a.kind === "activated" && predicate(a));
const offered = (state, uid, abilityIndex) =>
  E.legalActions(state, 0).some(
    (a) => a.payload.uid === uid && a.payload.abilityIndex === abilityIndex
  );

test("every non-manual activated ability in both catalogs has a strict cost", () => {
  for (const cards of [CARDS, FAST]) {
    const loose = [];
    for (const raw of cards) {
      E.compileCard(raw).abilities.forEach((ability) => {
        if (ability.kind === "activated" && !ability.manual && ability.strictCost === false) {
          loose.push(`${raw.id} ${raw.name}: ${ability.cost}`);
        }
      });
    }
    assert.deepEqual(loose, []);
  }
});

test("ACTIVATE_RESOURCE_ABILITY refuses a Resource ability whose cost is prose", () => {
  const state = game();
  const uid = seed(state, 0, PROSE_CONVERTER.id);
  const index = activatedIndex(PROSE_CONVERTER, (a) => a.cost === PROSE);
  assert.equal(E.compileCard(PROSE_CONVERTER).abilities[index].resourceAbility, true);
  const before = state.seats[0].buffer.N || 0;

  const result = act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid, abilityIndex: index });
  assert.equal(code(result), "SCHEMA");
  assert.equal(state.seats[0].buffer.N || 0, before, "the refused ability generated anyway");
  assert.equal(offered(state, uid, index), false, "legalActions offers the refused ability");
});

test("ACTIVATE_ABILITY refuses a Queue ability whose cost is prose", () => {
  const state = game();
  const uid = seed(state, 0, PROSE_NIND.id, { counters: { corpse: 3 } });
  const index = activatedIndex(PROSE_NIND);

  assert.equal(code(act(state, "ACTIVATE_ABILITY", 0, { uid, abilityIndex: index })), "SCHEMA");
  assert.equal(offered(state, uid, index), false, "legalActions offers the refused ability");
});

test("Nind, Archive Collector spends one corpse marker per Reboot", () => {
  let state = game();
  const nind = byName["Nind, Archive Collector"];
  const index = activatedIndex(nind);
  const bare = seed(state, 0, nind.id);
  assert.equal(code(act(state, "ACTIVATE_ABILITY", 0, { uid: bare, abilityIndex: index })), "CANNOT_AFFORD");
  assert.equal(offered(state, bare, index), false);

  const uid = seed(state, 0, nind.id, { counters: { corpse: 1 } });
  assert.equal(offered(state, uid, index), true);
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid, abilityIndex: index }));
  assert.equal(state.objects[uid].counters.corpse, 0, "the marker was not removed");
  assert.equal(code(act(state, "ACTIVATE_ABILITY", 0, { uid, abilityIndex: index })), "CANNOT_AFFORD");
});

test("Chaos Kernel needs the Toss module and charges its Commit", () => {
  const kernel = byName["Chaos Kernel"];
  const index = activatedIndex(kernel);

  const off = game();
  const idle = seed(off, 0, kernel.id);
  assert.equal(code(act(off, "ACTIVATE_ABILITY", 0, { uid: idle, abilityIndex: index })), "MODULE_REQUIRED");
  assert.equal(offered(off, idle, index), false);

  let state = game({ toss: true });
  const uid = seed(state, 0, kernel.id);
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid, abilityIndex: index }));
  assert.equal(state.objects[uid].committed, true, "Commit was not charged");
  assert.equal(code(act(state, "ACTIVATE_ABILITY", 0, { uid, abilityIndex: index })), "CANNOT_AFFORD");
});
