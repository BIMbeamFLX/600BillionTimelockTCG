/* NPC policy tests. Run with `npm run test:js`.
 * The policy is a pure move-picker; the harness applies its first accepted
 * candidate, exactly as play.js does, so a passing game here is the same game
 * the browser plays. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "..", "site");
const require = createRequire(import.meta.url);

const CARDS = require(path.join(siteDir, "play-data.js"));
const E = require(path.join(siteDir, "engine.js"));
const NPC = require(path.join(siteDir, "npc.js"));
E.setCatalog(CARDS);

const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const COMPILED = {};
const compiled = (cardId) => {
  if (!COMPILED[cardId]) COMPILED[cardId] = E.compileCard(byId[cardId]);
  return COMPILED[cardId];
};

const config = (seed, affA, affB) => ({
  seats: [
    { name: "BotA", affinity: affA },
    { name: "BotB", affinity: affB },
  ],
  seeds: { public: seed | 0, hidden: [(seed ^ 0x5f3759df) | 0, (seed + 7717) | 0] },
  firstPlayer: 0,
});

/* Apply the policy's first accepted candidate for whichever seat the table is
 * waiting on. Returns the new state, or null if nothing applied. */
function botMove(state) {
  const seat = NPC.waitingSeat(state);
  if (seat === null) return null;
  const prefs = { affinity: seat === 0 ? "Power" : "Signal" };
  for (const move of NPC.candidates(E, state, seat, compiled, prefs)) {
    const result = E.apply(state, { type: move.type, seat, seq: state.seq, at: "", payload: move.payload });
    if (!result.error) return result.state;
  }
  return null;
}

test("bot-vs-bot: the policy always has an accepted move and never stalls", () => {
  const state0 = mintState("Power", "Signal", 20260802);
  assert.ok(state0, "could not mint a game");
  let state = state0;
  let steps = 0;
  while (!state.result && steps < 3000) {
    const next = botMove(state);
    assert.ok(next, `policy stalled at seq ${state.seq}, turn ${state.turn.number}`);
    state = next;
    steps += 1;
  }
  // A full game to a verdict, or at minimum deep into the match without a stall.
  assert.ok(state.result || state.turn.number >= 8, `only reached turn ${state.turn.number}`);
});

/* The Stake landmine is real (see seeds.test.mjs): some seeds deal a card the
 * base ruleset cannot construct. Re-roll exactly the way the server mints. */
function mintState(affA, affB, seedFrom) {
  let seed = seedFrom;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return E.createGame(config(seed, affA, affB));
    } catch (err) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    }
  }
  return null;
}

test("bot-vs-bot: every affinity pairing survives the opening five turns", () => {
  const affinities = ["Power", "Bitcoin", "Keys", "Signal", "Timelock"];
  for (const affA of affinities) {
    for (const affB of affinities) {
      let state = mintState(affA, affB, 600);
      assert.ok(state, `${affA} vs ${affB}: could not mint a game`);
      let steps = 0;
      while (!state.result && state.turn.number < 5 && steps < 800) {
        const next = botMove(state);
        assert.ok(next, `${affA} vs ${affB}: stalled at seq ${state.seq}`);
        state = next;
        steps += 1;
      }
      assert.ok(
        state.result || state.turn.number >= 5,
        `${affA} vs ${affB}: only reached turn ${state.turn.number} in ${steps} steps`
      );
    }
  }
});

test("the policy accepts an opponent proposal instead of leaving it hanging", () => {
  let state = mintState("Power", "Signal", 31337);
  assert.ok(state, "could not mint a game");
  // Seat 0 proposes a free-form manual edit; the bot in seat 1 must answer.
  const proposed = E.apply(state, {
    type: "MANUAL_PROPOSE",
    seat: 0,
    seq: state.seq,
    at: "",
    payload: {
      warrant: { kind: "freeform", note: "test" },
      ops: [{ op: "addBuffer", seat: 0, symbol: "P", amount: 1 }],
      reason: "test",
    },
  });
  assert.equal(proposed.error, null, JSON.stringify(proposed.error));
  state = proposed.state;
  assert.equal(NPC.waitingSeat(state), 1);
  const moves = NPC.candidates(E, state, 1, compiled, { affinity: "Signal" });
  assert.equal(moves[0].type, "MANUAL_ACCEPT");
  const result = E.apply(state, { type: "MANUAL_ACCEPT", seat: 1, seq: state.seq, at: "", payload: moves[0].payload });
  assert.equal(result.error, null);
  assert.equal(result.state.seats[0].buffer.P, 1);
});

/* Put a card straight onto a seat's Network, for fixtures the deal rarely reaches. */
function seed(state, seat, cardId) {
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = {
    uid, cardId, owner: seat, controller: seat, zone: `${seat}:network`,
    committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
    rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
    token: false, entersSeq: state.seq, prevUid: null,
  };
  state.zones[`${seat}:network`].push(uid);
  return uid;
}

/* Play bot-vs-bot until the table asks `kind`; returns that state or null. */
function playUntilAwaiting(state, kind, maxSteps) {
  for (let steps = 0; !state.result && steps < maxSteps; steps++) {
    if (state.awaiting && state.awaiting.kind === kind) return state;
    const next = botMove(state);
    assert.ok(next, `policy stalled at seq ${state.seq}, awaiting ${state.awaiting && state.awaiting.kind}`);
    state = next;
  }
  return null;
}

test("the reported Signal vs Bitcoin seed no longer stalls, Classic or Fast", () => {
  for (const ruleset of [null, "F1.0"]) {
    let seed0 = 20260802 + 3 * 97;
    let state = null;
    for (let attempt = 0; !state && attempt < 40; attempt++) {
      const cfg = {
        seats: [{ name: "BotA", affinity: "Signal" }, { name: "BotB", affinity: "Bitcoin" }],
        seeds: { public: seed0, hidden: [777, 888] },
        firstPlayer: 0,
      };
      if (ruleset) cfg.ruleset = ruleset;
      try {
        state = E.createGame(cfg);
      } catch (err) {
        seed0 = (seed0 * 1103515245 + 12345) & 0x7fffffff;
      }
    }
    assert.ok(state, "could not mint a game");
    for (let steps = 0; !state.result && state.turn.number < 8 && steps < 3000; steps++) {
      const next = botMove(state);
      assert.ok(next, `${ruleset || "classic"}: stalled at turn ${state.turn.number}, ` +
        `awaiting ${state.awaiting && state.awaiting.kind}`);
      state = next;
    }
  }
});

test("the policy answers a drawReplacement prompt: draw, or shield on an empty Stack", () => {
  let state = mintState("Power", "Signal", 4242);
  assert.ok(state, "could not mint a game");
  seed(state, 0, "E1-031"); // Offline Sanctuary Protocol: optionalDrawShield
  seed(state, 1, "E1-031");
  state = playUntilAwaiting(state, "drawReplacement", 400);
  assert.ok(state, "never reached a drawReplacement prompt");
  const seat = state.awaiting.seat;
  assert.equal(NPC.waitingSeat(state), seat);

  const moves = NPC.candidates(E, state, seat, compiled, { affinity: "Power" });
  assert.deepEqual(moves[0], { type: "CHOOSE_DRAW", payload: { skip: false } });
  const wallet = state.zones[`${seat}:wallet`].length;
  const drawn = E.apply(state, { type: moves[0].type, seat, seq: state.seq, at: "", payload: moves[0].payload });
  assert.equal(drawn.error, null, JSON.stringify(drawn.error));
  assert.ok(drawn.state.zones[`${seat}:wallet`].length >= wallet + 1, "the draw did not happen");

  // With nothing left to draw, drawing decks out; the shield is the answer.
  const empty = structuredClone(state);
  empty.zones[`${seat}:stack`] = [];
  const shielded = NPC.candidates(E, empty, seat, compiled, { affinity: "Power" });
  assert.deepEqual(shielded[0], { type: "CHOOSE_DRAW", payload: { skip: true } });
});

test("the policy answers tombstoneCleanup and sovereignDamage prompts", () => {
  const base = mintState("Power", "Signal", 777);
  assert.ok(base, "could not mint a game");
  const resource = CARDS.find((c) => compiled(c.id) && compiled(c.id).isResource).id;

  const tomb = structuredClone(base);
  const marked = seed(tomb, 0, resource);
  tomb.objects[marked].counters.mark = 1;
  tomb.awaiting = { kind: "tombstoneCleanup", seat: 0, tasks: [{ key: "mark", options: [marked] }] };
  tomb.priority.seat = null;
  const cleanup = botMove(tomb);
  assert.ok(cleanup, "tombstoneCleanup stalled");
  assert.equal(cleanup.awaiting, null);

  const sov = structuredClone(base);
  seed(sov, 0, resource);
  seed(sov, 0, resource);
  sov.sovereignDamage = [2, 0];
  sov.awaiting = { kind: "sovereignDamage", seat: 0, amount: 2 };
  sov.priority.seat = null;
  const archived = botMove(sov);
  assert.ok(archived, "sovereignDamage stalled");
  assert.equal(archived.awaiting, null);
});
