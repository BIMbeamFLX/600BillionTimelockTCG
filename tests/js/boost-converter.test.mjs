/* Boost Converter (E1-260) and Timelock Vault (E1-275): statics printed before a
 * Commit ability used to compile into its cost, so Commit was never charged and
 * the ability could be activated without limit (3907 times in one NPC turn).
 * The Vault also skips a turn to unlock. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CARDS = require(path.resolve(here, "..", "..", "site", "play-data.js"));
const E = require(path.resolve(here, "..", "..", "site", "engine.js"));
E.setCatalog(CARDS);

const byName = Object.fromEntries(CARDS.map((card) => [card.name, card]));
const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });
const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seedValue = 880000) {
  let attempt = seedValue;
  for (let index = 0; index < 40; index++) {
    try {
      return E.createGame({
        seats: [
          { name: "A", affinity: "Power" },
          { name: "B", affinity: "Signal" },
        ],
        seeds: { public: attempt, hidden: [attempt + 1, attempt + 2] },
        firstPlayer: 0,
      });
    } catch (error) {
      attempt = (attempt * 1103515245 + 12345) & 0x7fffffff;
    }
  }
  throw new Error("could not mint a game");
}

function seed(state, seat, cardId, tweaks, zone = "network") {
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid, cardId, owner: seat, controller: seat, zone: `${seat}:${zone}`,
      committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
      rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
      token: false, entersSeq: state.seq, prevUid: null,
    },
    tweaks || {}
  );
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

function passUntil(state, stop, limit = 1200) {
  for (let index = 0; index < limit; index++) {
    if (stop(state) || state.result) return state;
    if (state.priority.seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
      continue;
    }
    const waiting = state.awaiting;
    if (!waiting) throw new Error("stuck without priority or awaited action");
    if (waiting.kind === "attackers") {
      state = ok(act(state, "DECLARE_ATTACKERS", waiting.seat, { attackers: [] }));
    } else if (waiting.kind === "blockers") {
      state = ok(act(state, "DECLARE_BLOCKERS", waiting.seat, { blocks: {} }));
    } else if (waiting.kind === "order") {
      const order = {};
      for (const uid of Object.keys(state.clash.blocks)) order[uid] = state.clash.blocks[uid].slice();
      state = ok(act(state, "ORDER_BLOCKERS", waiting.seat, { order }));
    } else if (waiting.kind === "damage") {
      state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", waiting.seat, { assignment: null }));
    } else if (waiting.kind === "discard") {
      const wallet = state.zones[`${waiting.seat}:wallet`];
      state = ok(act(state, "DISCARD_TO_LIMIT", waiting.seat, {
        uids: wallet.slice(0, wallet.length - state.handLimit),
      }));
    } else if (waiting.kind === "triggers") {
      state = ok(act(state, "ORDER_TRIGGERS", waiting.seat, {
        qids: state.pendingTriggers[String(waiting.seat)].map((entry) => entry.pendingId),
      }));
    } else {
      throw new Error(`unhandled awaited action ${waiting.kind}`);
    }
  }
  throw new Error("passUntil exhausted");
}

const indexOf = (name, predicate) => byName[name].abilities.findIndex(predicate);
const COMMIT = indexOf("Boost Converter", (a) => a.kind === "activated" && a.cost === "Commit");
const PAY_UNLOCK = indexOf("Boost Converter", (a) => a.timing === "maintenance");

const buildOne = (current) =>
  current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0;

test("Boost Converter commits when activated and cannot be activated twice in one turn", () => {
  let state = game(882600);
  const converter = seed(state, 0, byName["Boost Converter"].id);
  state = passUntil(state, buildOne);
  const before = state.seats[0].buffer.N || 0;

  const first = act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: converter, abilityIndex: COMMIT });
  state = ok(first);
  assert.equal(state.objects[converter].committed, true, "Commit was not charged");
  assert.equal(state.seats[0].buffer.N, before + 3);

  const second = act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: converter, abilityIndex: COMMIT });
  assert.equal(second.error && second.error.code, "CANNOT_AFFORD");
  const prose = act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: converter, abilityIndex: 0 });
  assert.notEqual(prose.error, null, "the static clause is activatable");
});

test("Boost Converter stays committed through its unlock step and deals 1 at draw", () => {
  let state = game(882610);
  const converter = seed(state, 0, byName["Boost Converter"].id, { committed: true });
  state = passUntil(state, (current) =>
    current.turn.active === 1 && current.turn.phase === "build1"
  );
  const uptime = state.seats[0].uptime;
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1"
  );

  assert.equal(state.objects[converter].committed, true, "it unlocked normally");
  assert.equal(state.seats[0].uptime, uptime - 1, "no damage for being committed at draw");
});

test("Boost Converter deals no draw damage while unlocked", () => {
  let state = game(882620);
  seed(state, 0, byName["Boost Converter"].id);
  state = passUntil(state, (current) =>
    current.turn.active === 1 && current.turn.phase === "build1"
  );
  const uptime = state.seats[0].uptime;
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1"
  );

  assert.equal(state.seats[0].uptime, uptime);
});

test("Boost Converter unlocks by paying 4 at Maintenance, and only then", () => {
  let state = game(882630);
  const converter = seed(state, 0, byName["Boost Converter"].id, { committed: true });
  state = passUntil(state, buildOne);
  const early = act(state, "ACTIVATE_ABILITY", 0, { uid: converter, abilityIndex: PAY_UNLOCK });
  assert.equal(early.error && early.error.code, "WRONG_PHASE");

  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.step === "maintenance" && current.priority.seat === 0
  );
  for (const symbol of Object.keys(state.seats[0].buffer)) state.seats[0].buffer[symbol] = 0;
  state.seats[0].buffer.N = 4;
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: converter, abilityIndex: PAY_UNLOCK }));
  assert.equal(state.seats[0].buffer.N, 0, "the unlock was free");
  state = passUntil(state, (current) => current.queue.length === 0);

  assert.equal(state.objects[converter].committed, false, "paying 4 did not unlock it");
});

test("Timelock Vault enters committed, never unlocks normally and cannot Commit while committed", () => {
  const vault = byName["Timelock Vault"];
  const rules = vault.abilities.map((ability) => ability.rule && ability.rule.name);
  assert.ok(rules.includes("entersCommitted"));
  assert.ok(rules.includes("skipSelfUnlock"));

  let state = game(882750);
  const uid = seed(state, 0, vault.id, { committed: true });
  state = passUntil(state, buildOne);
  const extra = vault.abilities.findIndex((a) => a.kind === "activated" && a.cost === "Commit");
  const result = act(state, "ACTIVATE_ABILITY", 0, { uid, abilityIndex: extra });
  assert.equal(result.error && result.error.code, "CANNOT_AFFORD");
});

test("no activated ability's cost contains a sentence", () => {
  const offenders = [];
  for (const card of CARDS) {
    for (const ability of card.abilities) {
      if (ability.kind !== "activated") continue;
      if (/\.|\b(if|when|whenever|at|may|you|it|doesn't|does|not|enters)\b/i.test(ability.cost)) {
        offenders.push(`${card.id} ${card.name}: ${ability.cost}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

const vaultIndex = (predicate) => byName["Timelock Vault"].abilities.findIndex(predicate);
const VAULT_SKIP = vaultIndex((a) => a.kind === "activated" && a.cost === "");
const VAULT_COMMIT = vaultIndex((a) => a.kind === "activated" && a.cost === "Commit");

/* Pass until `seat` starts a Build phase, recording whose turns began meanwhile. */
function turnsUntilBuild(state, seat) {
  const seen = [];
  let last = `${state.turn.number}:${state.turn.active}`;
  state = passUntil(state, (current) => {
    const key = `${current.turn.number}:${current.turn.active}`;
    if (key !== last) {
      seen.push(current.turn.active);
      last = key;
    }
    return seen.length > 0 && current.turn.active === seat &&
      current.turn.phase === "build1" && current.priority.seat === seat;
  });
  return { state, seen };
}

test("Timelock Vault cannot skip a turn while it is unlocked", () => {
  let state = game(882760);
  const vault = seed(state, 0, byName["Timelock Vault"].id);
  state = passUntil(state, buildOne);
  const result = act(state, "ACTIVATE_ABILITY", 0, { uid: vault, abilityIndex: VAULT_SKIP });

  assert.equal(result.error && result.error.code, "CANNOT_AFFORD");
  assert.equal(state.skipTurns, undefined);
});

test("Timelock Vault unlocks by skipping its controller's next turn", () => {
  let state = game(882770);
  const vault = seed(state, 0, byName["Timelock Vault"].id, { committed: true });
  state = passUntil(state, buildOne);
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: vault, abilityIndex: VAULT_SKIP }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);

  assert.equal(state.objects[vault].committed, false, "the skip did not unlock it");
  assert.deepEqual(state.skipTurns, [1, 0]);
  const run = turnsUntilBuild(state, 0);
  assert.deepEqual(run.seen, [1, 1, 0], "seat 0's next turn was not skipped");
  assert.deepEqual(run.state.skipTurns, [0, 0]);
  assert.equal(run.state.objects[vault].committed, false, "it stayed unlocked across the skip");
});

test("a second skip queued before the first resolves costs no extra turn", () => {
  let state = game(882780);
  const vault = seed(state, 0, byName["Timelock Vault"].id, { committed: true });
  state = passUntil(state, buildOne);
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: vault, abilityIndex: VAULT_SKIP }));
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: vault, abilityIndex: VAULT_SKIP }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);

  assert.deepEqual(state.skipTurns, [1, 0]);
});

test("Timelock Vault's extra turn is the turn the skip consumes", () => {
  let state = game(882790);
  const vault = seed(state, 0, byName["Timelock Vault"].id, { committed: true });
  state = passUntil(state, buildOne);
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: vault, abilityIndex: VAULT_SKIP }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: vault, abilityIndex: VAULT_COMMIT }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);
  assert.deepEqual(state.extraTurns, [1, 0]);

  const run = turnsUntilBuild(state, 0);
  assert.deepEqual(run.seen, [1, 0], "the Vault gained or lost a turn overall");
  assert.deepEqual(run.state.extraTurns, [0, 0]);
  assert.deepEqual(run.state.skipTurns, [0, 0]);
  assert.equal(run.state.objects[vault].committed, true, "it unlocked without another skip");
});
