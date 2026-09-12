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
 * meant to.
 *
 * Re-pinned once on purpose: the Boost Converter / Timelock Vault compile fix
 * changed the catalog, so catalogDigest (and the prevHash chain built on it)
 * moved. Every state of the script, with those two fields stripped, was proved
 * byte-identical across processes before and after. */
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
  openHash: "ee3466397d21e42ef6b18b10cd99dd8dc76cfbc28d71896dfde0a29942f5427d",
  openPublicHash: "c02abe184e68f07324adb00a27cb491313b155635147320370cfb09c6dd2c88f",
  afterHash: "ff10d03370a1f87a5e81c880c3c9bade09b906a739e6f15b544a809a6496c07f",
  afterPublicHash: "3daa0cfddaeffa4efa859735f0d266ded439a3a4187350cf827ec03b1b17994a",
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
  /* Two shapes of "no ruleset": the key absent, and the key present as
   * undefined. The second cannot be hashed into a gameId (canonicalJSON refuses
   * undefined, as it always has), so it is dealt with the id pinned — and must
   * then come out as the same Classic bytes. */
  const absent = E.createGame(FIXED_CONFIG());
  assert.equal("ruleset" in FIXED_CONFIG(), false, "the fixture really omits the key");
  assert.equal(absent.ruleset, "E1.0");
  assert.equal(E.hashState(absent), PINNED.openHash, "the default must be Classic, byte for byte");

  const undefinedKey = E.createGame(Object.assign(FIXED_CONFIG(), { ruleset: undefined, gameId: absent.gameId }));
  assert.equal(undefinedKey.ruleset, "E1.0");
  assert.equal(E.hashState(undefinedKey), PINNED.openHash);
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

test("the profile is resolved from state.ruleset, and defaults to Classic", () => {
  const state = E.createGame(FIXED_CONFIG());
  assert.equal(E.profileOf(state).id, "classic");
  /* The three ways a ruleset can fail to name a profile. All of them are old
   * logs, old configs or corrupted input, and all of them are Classic — that is
   * what those matches were played under. */
  assert.equal(E.profileOf({ ruleset: undefined }).id, "classic");
  assert.equal(E.profileOf({ ruleset: "garbage" }).id, "classic");
  /* Names Object.prototype answers for, and values a key lookup would coerce.
   * These once resolved to undefined, and a state carrying one could not take
   * another step. */
  for (const odd of ["constructor", "toString", "__proto__", "hasOwnProperty", ["F1.0"], ["E1.0"], 1, null]) {
    assert.equal(E.profileOf({ ruleset: odd }).id, "classic", `profileOf(${JSON.stringify(odd)})`);
  }
  assert.equal(E.profileOf({}).id, "classic");
  assert.equal(E.profileOf(null).id, "classic");
  /* A view carries ruleset too, so legalActions can resolve the profile from a
   * redacted view without needing the full state. */
  assert.equal(E.profileOf(E.view(state, 0)).id, "classic");
  assert.equal(E.profileOf(E.view(state, null)).id, "classic");
});

test("a ruleset nobody implements is refused rather than played as Classic", () => {
  const refused = ["F9.9", "", "e1.0", " E1.0", "constructor", "toString", "__proto__", "hasOwnProperty",
    ["E1.0"], ["F1.0"], 1, null, {}];
  for (const odd of refused) {
    assert.throws(() => E.createGame(Object.assign(FIXED_CONFIG(), { ruleset: odd })),
      (error) => error.code === "SCHEMA" && /ruleset/.test(error.message),
      `createGame must refuse ruleset ${JSON.stringify(odd)} as a rules error, not a TypeError`);
  }
  /* Explicitly naming the profile you are already getting is not an error, and
   * it changes nothing but the derived gameId — which is sha256 over the whole
   * config, so any new config key moves it. A referee that starts naming the
   * ruleset therefore mints different ids than one that omits it; pin the id
   * and the rest of the state has to come out byte for byte the same. */
  const bare = E.createGame(FIXED_CONFIG());
  const named = E.createGame(Object.assign(FIXED_CONFIG(), { ruleset: "E1.0", gameId: bare.gameId }));
  assert.equal(E.profileOf(named).id, "classic");
  assert.equal(E.hashState(named), PINNED.openHash);
});

test("the Classic descriptor reproduces the constants it replaces", () => {
  const classic = E.PROFILES.classic;
  assert.equal(classic.ruleset, "E1.0");
  /* Literals, not E.PHASE_ORDER: the descriptor holds those very objects, so
   * comparing it with them could never fail. */
  assert.deepEqual(classic.phaseOrder, ["open", "build1", "clash", "build2", "close"]);
  assert.deepEqual(classic.phaseSteps, {
    open: ["unlock", "maintenance", "draw"],
    build1: ["main"],
    clash: ["start", "attackers", "blockers", "order", "firstStrike", "damage", "end"],
    build2: ["main"],
    close: ["endStep", "cleanup"],
  });
  assert.deepEqual(classic.ribbon, [
    { phase: "open", step: "unlock", label: "Unlock" },
    { phase: "open", step: "maintenance", label: "Maintenance" },
    { phase: "open", step: "draw", label: "Draw" },
    { phase: "build1", step: "main", label: "Build I" },
    { phase: "clash", step: null, label: "Clash" },
    { phase: "build2", step: "main", label: "Build II" },
    { phase: "close", step: "endStep", label: "End" },
    { phase: "close", step: "cleanup", label: "Cleanup" },
  ]);
  // And the exports are still the descriptor's own objects, not copies that could drift.
  assert.equal(classic.phaseOrder, E.PHASE_ORDER);
  assert.equal(classic.phaseSteps, E.PHASE_STEPS);
  assert.equal(classic.ribbon, E.TURN_RIBBON);
  assert.equal(classic.priority, "full");
  assert.equal(classic.queue, "lifo");
  assert.equal(classic.resources, "cards");
  assert.equal(classic.combat, "clash");
  assert.equal(classic.burnsBuffers, true);
  assert.equal(classic.genericOnlyCosts, false);
  assert.deepEqual(classic.illegal, []);
  /* A descriptor that can be edited at runtime is a descriptor that can be
   * edited by one match and read by the next. */
  assert.throws(() => { E.PROFILES.classic = null; }, TypeError);
  assert.throws(() => { classic.burnsBuffers = false; }, TypeError);
});

test("ribbonFor answers with the same array TURN_RIBBON exports", () => {
  const state = E.createGame(FIXED_CONFIG());
  assert.deepEqual(E.ribbonFor(state), E.TURN_RIBBON);
  assert.deepEqual(E.ribbonFor(E.view(state, 0)), E.TURN_RIBBON);
  assert.deepEqual(E.ribbonFor(null), E.TURN_RIBBON);
});
