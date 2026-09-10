/* Golden bytes for the Classic profile.
 *
 * Every other hash assertion in this repo compares two live runs against each
 * other (engine.test.mjs:206, :825, :1157, net.test.mjs:587). Two runs that
 * drifted identically are still equal, so those tests cannot see drift at all —
 * they prove determinism, not stability. This file pins the actual bytes as
 * string literals, so a change in Classic behaviour has to be typed in here on
 * purpose before it can ship.
 *
 * These literals were taken on the unmodified engine at commit 2cfcd21, before
 * the Fast profile existed. If one fails, Classic moved. Do not update the
 * literal to make the test pass — find out what moved, and whether it was
 * meant to. */
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
E.setCatalog(CARDS);

const FIXED_CONFIG = () => ({
  seats: [{ name: "P1", affinity: "Power" }, { name: "P2", affinity: "Signal" }],
  seeds: { public: 12345, hidden: [777, 888] },
  firstPlayer: 0,
});

/* The script: at priority, take the first action the engine accepts in this
 * fixed preference order; otherwise answer the pending declaration with its
 * do-nothing default. No randomness, no wall clock and no card names — so the
 * script survives a reshuffle of the catalog, and only a rules change moves it. */
const PREFER = ["PLAY_RESOURCE", "ACTIVATE_RESOURCE_ABILITY", "PLAY_CARD", "PASS_PRIORITY"];

function scriptedStep(state) {
  if (state.result) return null;
  const seat = state.priority.seat;
  if (seat !== null) {
    const legal = E.legalActions(E.view(state, seat), seat);
    const ranked = legal
      .filter((m) => PREFER.indexOf(m.type) >= 0)
      .sort((a, b) => PREFER.indexOf(a.type) - PREFER.indexOf(b.type));
    for (const move of ranked) {
      const r = E.apply(state, { type: move.type, seat, seq: state.seq, at: "", payload: move.payload || {} });
      if (!r.error) return r.state;
    }
    const r = E.apply(state, { type: "PASS_PRIORITY", seat, seq: state.seq, at: "", payload: {} });
    assert.equal(r.error, null, "the scripted pass must always be legal");
    return r.state;
  }
  const aw = state.awaiting;
  assert.ok(aw, "a state with no priority must be awaiting something");
  const push = (type, payload) => {
    const r = E.apply(state, { type, seat: aw.seat, seq: state.seq, at: "", payload });
    assert.equal(r.error, null, `${type}: ${JSON.stringify(r.error)}`);
    return r.state;
  };
  if (aw.kind === "attackers") return push("DECLARE_ATTACKERS", { attackers: [] });
  if (aw.kind === "blockers") return push("DECLARE_BLOCKERS", { blocks: {} });
  if (aw.kind === "order") {
    const order = {};
    for (const key of Object.keys(state.clash.blocks)) order[key] = state.clash.blocks[key].slice();
    return push("ORDER_BLOCKERS", { order });
  }
  if (aw.kind === "damage") return push("ASSIGN_COMBAT_DAMAGE", { assignment: null });
  if (aw.kind === "discard") {
    const wallet = state.zones[`${aw.seat}:wallet`];
    return push("DISCARD_TO_LIMIT", { uids: wallet.slice(0, wallet.length - state.handLimit) });
  }
  if (aw.kind === "triggers") {
    return push("ORDER_TRIGGERS", { qids: state.pendingTriggers[String(aw.seat)].map((t) => t.pendingId) });
  }
  throw new Error(`unhandled awaiting kind ${aw.kind}`);
}

function runScript(state, actions) {
  let taken = 0;
  while (taken < actions) {
    const next = scriptedStep(state);
    if (!next) break;
    state = next;
    taken += 1;
  }
  return { state, actions: taken };
}

const PINNED = {
  openHash: "6d9d2f0130efa7734e64e0e417271695cb22b280c283f6c31b41de38cc6b87d2",
  openPublicHash: "c3a99d6377b5d576489e4e703df366e2fb1153e1ee1e1088dfbe057fb8739370",
  afterHash: "a5058d522e9d5f140299415576bffb29f9fee0919e285551c20a616626cb31a8",
  afterPublicHash: "5efdcd973a938c5a6d7d0c836d64cc6e2c7a2f18964d8a67036716df5d355be1",
  afterSeq: 40,
  afterTurn: 3,
  afterPhase: "open",
  afterStep: "maintenance",
};

const KEYS = {
  /* extraTurns is absent at deal and appears once the turn machine has run.
   * That is existing behaviour, pinned here so it stays deliberate. */
  openState: ["archivedTombstones", "awaiting", "catalogDigest", "clash", "delayed", "effects", "gameId", "handLimit", "manualBudgetUsed", "manualOpen", "modules", "nextChoiceId", "nextEid", "nextMid", "nextQid", "nextUid", "objects", "pendingChoice", "pendingManual", "pendingTriggers", "policy", "prevHash", "priority", "queue", "result", "rng", "ruleset", "seats", "seq", "sovereignDamage", "status", "turn", "v", "zones"],
  afterState: ["archivedTombstones", "awaiting", "catalogDigest", "clash", "delayed", "effects", "extraTurns", "gameId", "handLimit", "manualBudgetUsed", "manualOpen", "modules", "nextChoiceId", "nextEid", "nextMid", "nextQid", "nextUid", "objects", "pendingChoice", "pendingManual", "pendingTriggers", "policy", "prevHash", "priority", "queue", "result", "rng", "ruleset", "seats", "seq", "sovereignDamage", "status", "turn", "v", "zones"],
  turn: ["active", "attacked", "avatarsDied", "damageTaken", "firstPlayer", "number", "phase", "repeatCleanup", "resourcePlays", "startUnlockedResources", "startedSeq", "step"],
  seat: ["autoPass", "buffer", "conceded", "counters", "deckCommit", "deckedOut", "name", "pubkey", "stats", "uptime"],
  clash: ["assignment", "attackers", "blockedOnce", "blocks", "damageDone", "meshGroups", "order", "routeRestriction", "step"],
  view: ["awaiting", "catalogDigest", "clash", "effects", "forSeat", "gameId", "handLimit", "manualOpen", "modules", "myTriggers", "objects", "pendingChoice", "pendingManual", "pendingTriggers", "policy", "prevHash", "priority", "queue", "redacted", "result", "rng", "ruleset", "seats", "seq", "status", "turn", "v", "zoneCounts", "zones"],
};

test("the opening state of a fixed Classic game hashes to its pinned bytes", () => {
  const state = E.createGame(FIXED_CONFIG());
  assert.equal(state.ruleset, "E1.0");
  assert.equal(E.hashState(state), PINNED.openHash);
  assert.equal(E.publicHash(state), PINNED.openPublicHash);
});

test("a fixed forty-action Classic script hashes to its pinned bytes", () => {
  const { state, actions } = runScript(E.createGame(FIXED_CONFIG()), 40);
  assert.equal(actions, PINNED.afterSeq, "the script must not end early");
  assert.equal(state.seq, PINNED.afterSeq);
  assert.equal(state.turn.number, PINNED.afterTurn);
  assert.equal(state.turn.phase, PINNED.afterPhase);
  assert.equal(state.turn.step, PINNED.afterStep);
  assert.equal(E.hashState(state), PINNED.afterHash);
  assert.equal(E.publicHash(state), PINNED.afterPublicHash);
});

test("the shape of Classic state and view is pinned", () => {
  const open = E.createGame(FIXED_CONFIG());
  assert.deepEqual(Object.keys(open).sort(), KEYS.openState);

  const { state } = runScript(E.createGame(FIXED_CONFIG()), 40);
  assert.deepEqual(Object.keys(state).sort(), KEYS.afterState);
  assert.deepEqual(Object.keys(state.turn).sort(), KEYS.turn);
  assert.deepEqual(Object.keys(state.seats[0]).sort(), KEYS.seat);
  assert.deepEqual(Object.keys(state.seats[1]).sort(), KEYS.seat);
  assert.deepEqual(Object.keys(state.clash).sort(), KEYS.clash);
  /* publicHash is taken over view(state, null); a new key there moves it for
   * every spectator, and the referee stores that hash. */
  assert.deepEqual(Object.keys(E.view(state, 0)).sort(), KEYS.view);
  assert.deepEqual(Object.keys(E.view(state, 1)).sort(), KEYS.view);
  assert.deepEqual(Object.keys(E.view(state, null)).sort(), KEYS.view);
});

test("a config that names no ruleset deals a Classic game", () => {
  const bare = FIXED_CONFIG();
  delete bare.ruleset;
  const state = E.createGame(bare);
  assert.equal(state.ruleset, "E1.0");
  assert.equal(E.hashState(state), PINNED.openHash, "the default must be Classic, byte for byte");
});

test("TURN_RIBBON stays an array", () => {
  /* play.js reads it as data in three places (:2764, :3049, :3423). Turning it
   * into a function to make it profile-aware would throw at render time and take
   * the live table down. A second profile gets its own accessor beside it. */
  assert.ok(Array.isArray(E.TURN_RIBBON));
  assert.equal(E.TURN_RIBBON.length, 8);
});

test("playing a game does not mutate the shared card catalog", () => {
  /* The compiled catalog is process-global and shared by every concurrent match
   * on a referee. Anything that rewrites a card in place — a cost flattened for
   * another profile, say — would silently corrupt matches it never touched. */
  const before = JSON.stringify(CARDS);
  runScript(E.createGame(FIXED_CONFIG()), 40);
  assert.equal(JSON.stringify(CARDS), before);
});
