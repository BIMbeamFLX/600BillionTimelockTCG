/* Wave 10: timing windows, combat obligations, transformations, and prevention. */
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
const act = (state, type, seat, payload = {}) => E.apply(
  state, { type, seat, seq: state.seq, at: "", payload }
);
const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seedValue = 1010000) {
  for (let offset = 0; offset < 50; offset++) {
    try {
      return E.createGame({
        seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
        seeds: { public: seedValue + offset, hidden: [seedValue + 100 + offset, seedValue + 200 + offset] },
        firstPlayer: 0,
      });
    } catch { /* avoid a random Stake card */ }
  }
  throw new Error("could not mint game");
}

function seed(state, seat, name, tweaks = {}, zone = "network") {
  const uid = "o" + state.nextUid++;
  state.objects[uid] = Object.assign({
    uid, cardId: byName[name].id, owner: seat, controller: seat, zone: `${seat}:${zone}`,
    committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
    rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
    token: false, tokenProfile: null, chosenAffinity: null, chosenSeat: null,
    controlSource: null, activations: {}, entersSeq: state.seq, prevUid: null,
  }, tweaks);
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

function priority(state, seat = 0, phase = "build1", step = "main") {
  state.turn.active = seat;
  state.turn.phase = phase;
  state.turn.step = step;
  state.clash.step = phase === "clash" ? step : null;
  state.awaiting = null;
  state.priority = { seat, passed: [false, false], window: `${phase}:${step}` };
  for (const symbol of ["P", "B", "K", "S", "T", "N"]) state.seats[seat].buffer[symbol] = 30;
  return state;
}

function resolve(state, limit = 80) {
  for (let index = 0; index < limit; index++) {
    if (!state.queue.length && state.priority.seat !== null) return state;
    if (state.priority.seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
      continue;
    }
    throw new Error(`unexpected await ${JSON.stringify(state.awaiting)}`);
  }
  throw new Error("resolution exhausted");
}

test("printed play windows reject payment outside their legal clash window", () => {
  let state = priority(game(), 0);
  const spell = seed(state, 0, "Last Broadcast", {}, "wallet");
  const blocker = seed(state, 1, "FLX, Culture Curator");
  const rejected = act(state, "PLAY_CARD", 0, {
    uid: spell, targets: [{ kind: "object", uid: blocker }],
  });
  assert.equal(rejected.error.code, "WRONG_PHASE");

  state = priority(state, 0, "clash", "start");
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: spell, targets: [{ kind: "object", uid: blocker }],
  }));
  state = resolve(state);
  assert.ok(state.effects.some((effect) => effect.forceBlockAll && effect.targetUid === blocker));
});

test("Last Broadcast forces one defender to block every attacker and lifts its block cap", () => {
  let state = game(1010010);
  const first = seed(state, 0, "FLX, Culture Curator");
  const second = seed(state, 0, "FLX, Culture Curator");
  const blocker = seed(state, 1, "FLX, Culture Curator");
  state.effects.push({
    id: "test", sourceUid: null, kind: "clashRule", targetUid: blocker,
    forceBlockAll: true, expires: { kind: "eot", turn: state.turn.number }, startedSeq: state.seq,
  });
  state.turn.phase = "clash";
  state.turn.step = "blockers";
  state.clash.step = "blockers";
  state.clash.attackers = [first, second];
  state.awaiting = { kind: "blockers", seat: 1 };
  state.priority.seat = null;

  const missing = act(state, "DECLARE_BLOCKERS", 1, { blocks: { [first]: [blocker] } });
  assert.equal(missing.error.code, "MUST_BLOCK");
  state = ok(act(state, "DECLARE_BLOCKERS", 1, {
    blocks: { [first]: [blocker], [second]: [blocker] },
  }));
  assert.deepEqual(state.clash.blocks[first], [blocker]);
  assert.deepEqual(state.clash.blocks[second], [blocker]);
});

test("Quiet Block prevents both sides of clash damage", () => {
  let state = priority(game(1010020), 0, "clash", "start");
  const attacker = seed(state, 0, "FLX, Culture Curator");
  const spell = seed(state, 0, "Quiet Block", {}, "wallet");
  const uptime = state.seats[1].uptime;
  state = ok(act(state, "PLAY_CARD", 0, { uid: spell, targets: [] }));
  state = resolve(state);
  state.clash.attackers = [attacker];
  state.clash.order[attacker] = [];
  state.clash.blocks[attacker] = [];
  state.clash.blockedOnce = [];
  state.turn.phase = "clash";
  state.turn.step = "damage";
  state.awaiting = { kind: "damage", seat: 0, firstStrike: false };
  state.priority.seat = null;
  state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", 0, { assignment: null }));
  assert.equal(state.seats[1].uptime, uptime);
});

test("an unlocked Community Shield takes unblocked damage for its controller", () => {
  let state = game(1010030);
  const attacker = seed(state, 0, "FLX, Culture Curator");
  const shield = seed(state, 1, "MHB, Community Shield");
  const uptime = state.seats[1].uptime;
  state.clash.attackers = [attacker];
  state.clash.order[attacker] = [];
  state.clash.blocks[attacker] = [];
  state.clash.blockedOnce = [];
  state.turn.phase = "clash";
  state.turn.step = "damage";
  state.awaiting = { kind: "damage", seat: 0, firstStrike: false };
  state.priority.seat = null;
  state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", 0, { assignment: null }));
  assert.equal(state.seats[1].uptime, uptime);
  assert.equal(state.objects[shield].damage, 4);
});

test("Hot Wallet Statue transforms only in clash and Bam checks Action before targeting", () => {
  let state = priority(game(1010040), 0);
  const statue = seed(state, 0, "Hot Wallet Statue");
  const statueAbility = byName["Hot Wallet Statue"].abilities.findIndex((ability) => ability.kind === "activated");
  let result = act(state, "ACTIVATE_ABILITY", 0, { uid: statue, abilityIndex: statueAbility, targets: [] });
  assert.equal(result.error.code, "WRONG_PHASE");

  state = priority(state, 0, "clash", "start");
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: statue, abilityIndex: statueAbility, targets: [] }));
  state = resolve(state);
  assert.deepEqual(E.statsOf(state, E.resolveCtx({}), statue), { action: 3, resilience: 6 });

  const bam = seed(state, 0, "Bam, Tunnel Builder");
  const big = seed(state, 0, "FLX, Culture Curator");
  const bamAbility = byName["Bam, Tunnel Builder"].abilities.findIndex((ability) => ability.kind === "activated");
  result = act(state, "ACTIVATE_ABILITY", 0, {
    uid: bam, abilityIndex: bamAbility, targets: [{ kind: "object", uid: big }],
  });
  assert.equal(result.error.code, "ILLEGAL_TARGET");
});

test("Offline Sanctuary offers a draw replacement and blocks ordinary attackers", () => {
  let state = game(1010050);
  seed(state, 0, "Offline Sanctuary");
  const ordinary = seed(state, 1, "Cuddy, Signal Organizer");
  const broadcast = seed(state, 1, "FLX, Culture Curator");
  state.turn.active = 1;
  state.turn.phase = "close";
  state.turn.step = "endStep";
  state.priority = { seat: 1, passed: [false, false], window: "close:endStep" };
  for (let index = 0; index < 100 && state.awaiting?.kind !== "drawReplacement"; index++) {
    if (state.priority.seat !== null) state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  }
  assert.equal(state.awaiting.kind, "drawReplacement");
  state = ok(act(state, "CHOOSE_DRAW", 0, { skip: true }));
  const ctx = E.resolveCtx({});
  assert.equal(E.canAttack({ state, ctx }, ordinary), false);
  assert.equal(E.canAttack({ state, ctx }, broadcast), true);
});
