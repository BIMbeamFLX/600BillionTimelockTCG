/* The NPC under the Fast profile, and the simulator that measures both profiles.
 * Run with `npm run test:js`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, playGame, simulate, AFFINITIES } from "../../scripts/sim.mjs";

const env = loadEngine();
const { E, NPC, compiled } = env;

const fastGame = () => E.createGame({
  ruleset: "F1.0",
  seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
  seeds: { public: 12345, hidden: [777, 888] },
  firstPlayer: 0,
});

function place(state, cardId, seat, extra) {
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign({
    uid, cardId, owner: seat, controller: seat, zone: `${seat}:network`, committed: false,
    bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [0, 1], revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
  }, extra || {});
  state.zones[`${seat}:network`].push(uid);
  return uid;
}
const grant = (state, uid, keyword) =>
  state.effects.push({ kind: "grant", targetUid: uid, keyword, controller: state.objects[uid].controller });

const MORGS = "E1-036"; // 2/2
const CUDDY = "E1-044"; // 2/1
const DARREN = "E1-095"; // 5/4
const TINY = "E1-071"; // 1/1

test("every Fast pairing plays to a verdict: no stall, no turn limit", () => {
  const report = simulate(env, { profile: "fast", games: 2, seed: 777 });
  assert.equal(report.games, 20);
  assert.deepEqual(Object.keys(report.outcomes).sort(), ["win"], JSON.stringify(report.outcomes));
  assert.ok(report.turns.median >= 4 && report.turns.median <= 20, `median ${report.turns.median}`);
});

test("the simulator is deterministic and Fast takes far fewer actions per turn", () => {
  const args = { profile: "fast", affinities: ["Keys", "Timelock"], seed: 99, firstPlayer: 1 };
  assert.deepEqual(playGame(env, args), playGame(env, args));
  const fast = simulate(env, { profile: "fast", games: 1, seed: 4242 });
  const classic = simulate(env, { profile: "classic", games: 1, seed: 4242 });
  assert.ok(fast.actionsPerTurn * 3 < classic.actionsPerTurn,
    `Fast ${fast.actionsPerTurn.toFixed(1)} vs Classic ${classic.actionsPerTurn.toFixed(1)} actions per turn`);
  assert.deepEqual(Object.keys(fast.affinity), AFFINITIES);
});

test("the Fast bot never reaches for a Resource action", () => {
  let state = fastGame();
  for (let i = 0; i < 400 && !state.result; i++) {
    const seat = NPC.waitingSeat(state);
    const moves = NPC.candidates(E, state, seat, compiled, { affinity: "Power" });
    for (const move of moves) {
      assert.ok(!["PLAY_RESOURCE", "ACTIVATE_RESOURCE_ABILITY", "DECLARE_ATTACKERS", "DECLARE_BLOCKERS"].includes(move.type), move.type);
    }
    const next = moves.map((move) => E.apply(state, { type: move.type, seat, seq: state.seq, at: "", payload: move.payload }))
      .find((result) => !result.error);
    assert.ok(next, `stalled at ${state.priority.window}`);
    state = next.state;
  }
});

test("attack planning: lethal goes face, a winning trade beats the face, Firewall comes first", () => {
  let state = fastGame();
  const darren = place(state, DARREN, 0);
  const tiny = place(state, TINY, 1);
  let moves = NPC.planAttacks(E, state, 0, compiled);
  assert.deepEqual(moves[0], { attacker: darren, target: { kind: "object", uid: tiny } }, "kills the 1/1 and survives");

  state.seats[1].uptime = 5;
  moves = NPC.planAttacks(E, state, 0, compiled);
  assert.deepEqual(moves[0], { attacker: darren, target: { kind: "seat", seat: 1 } }, "5 power into 5 Uptime is lethal");

  state = fastGame();
  const morgs = place(state, MORGS, 0);
  const wall = place(state, CUDDY, 1);
  grant(state, wall, "Firewall");
  place(state, TINY, 1);
  moves = NPC.planAttacks(E, state, 0, compiled);
  assert.ok(moves.length && moves.every((move) => move.target.uid === wall), JSON.stringify(moves));

  // An even trade into something worth less than the attacker is not taken: face instead.
  state = fastGame();
  const big = place(state, DARREN, 0); // 5/4
  place(state, DARREN, 1); // 5/4 — would kill Darren and die
  moves = NPC.planAttacks(E, state, 0, compiled);
  assert.deepEqual(moves[moves.length - 1], { attacker: big, target: { kind: "seat", seat: 1 } });
});

test("a capped unlock is answered with the cap, in either profile", () => {
  for (const ruleset of ["E1.0", "F1.0"]) {
    const state = E.createGame({
      ruleset,
      seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
      seeds: { public: 12345, hidden: [777, 888] },
      firstPlayer: 0,
    });
    const a = place(state, MORGS, 0, { committed: true });
    const b = place(state, CUDDY, 0, { committed: true });
    state.awaiting = { kind: "unlock", seat: 0, required: [], selectable: [a, b], caps: { Avatar: 1 } };
    const move = NPC.candidates(E, state, 0, compiled, {})[0];
    assert.deepEqual(move, { type: "CHOOSE_UNLOCK", payload: { uids: [a] } }, ruleset);
  }
});

test("the drawReplacement prompt is answered", () => {
  const state = fastGame();
  state.awaiting = { kind: "drawReplacement", seat: 0 };
  assert.deepEqual(NPC.candidates(E, state, 0, compiled, {})[0], { type: "CHOOSE_DRAW", payload: { skip: false } });
});
