/* The Fast profile (ruleset "F1.0"), built one subsystem at a time.
 *
 * Covered so far: the turn machine (Open, one Build phase, Close — no Clash
 * phase and no Build II), and priority with the Queue (only the active player
 * holds priority, only in Build, and nothing waits on the Queue). Resources and
 * attacking still follow Classic here and get their own tests when they change. Classic
 * itself is guarded byte for byte in profile.test.mjs; nothing in this file may
 * be relaxed to make a Classic test pass, or the other way round. */
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

const config = (ruleset) => {
  const base = {
    seats: [{ name: "P1", affinity: "Power" }, { name: "P2", affinity: "Signal" }],
    seeds: { public: 12345, hidden: [777, 888] },
    firstPlayer: 0,
  };
  return ruleset ? Object.assign(base, { ruleset }) : base;
};

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

/* Pass every priority window and answer every declaration with its do-nothing
 * default, until `stop` holds. Returns the final state, every accepted action
 * and every event, so a test can read what the turn machine actually did. */
function passUntil(state, stop, limit = 2000) {
  const actions = [];
  const events = [];
  const windows = [];
  const clashSteps = new Set([state.clash.step]);
  for (let i = 0; i < limit && !stop(state) && !state.result; i++) {
    let type;
    let seat;
    let payload = {};
    if (state.priority.seat !== null) {
      seat = state.priority.seat;
      type = "PASS_PRIORITY";
      windows.push({ turn: state.turn.number, active: state.turn.active, seat, window: state.priority.window });
    } else {
      const aw = state.awaiting;
      assert.ok(aw, "a state with no priority must be awaiting something");
      seat = aw.seat;
      if (aw.kind === "attackers") { type = "DECLARE_ATTACKERS"; payload = { attackers: [] }; }
      else if (aw.kind === "blockers") { type = "DECLARE_BLOCKERS"; payload = { blocks: {} }; }
      else if (aw.kind === "discard") {
        const wallet = state.zones[`${seat}:wallet`];
        type = "DISCARD_TO_LIMIT";
        payload = { uids: wallet.slice(0, wallet.length - state.handLimit) };
      } else throw new Error(`unhandled awaiting kind ${aw.kind}`);
    }
    const action = { type, seat, seq: state.seq, at: "", payload };
    const result = E.apply(state, action);
    assert.equal(result.error, null, `${type}: ${JSON.stringify(result.error)}`);
    actions.push(action);
    events.push(...result.events);
    state = result.state;
    clashSteps.add(state.clash.step);
  }
  // A walk that ran out of actions, or into a finished game, has not tested
  // the thing its stop condition names.
  assert.ok(stop(state) || state.result, "passUntil stopped before reaching its condition");
  return { state, actions, events, windows, clashSteps };
}

const phaseOf = (event) => (event.pub ? event.pub.phase : event.phase);

/* Every step name enterStep() has a case for. A profile that names any other
 * step would enter it and do nothing, which reads like a working turn. */
const KNOWN_STEPS = ["unlock", "maintenance", "draw", "main", "start", "attackers", "blockers",
  "order", "firstStrike", "damage", "end", "endStep", "cleanup"];

// --------------------------------------------------------------- descriptor

test("F1.0 names the Fast profile and deals a Fast game", () => {
  assert.equal(E.RULESET_PROFILE["F1.0"], "fast");
  assert.equal(E.profileOf({ ruleset: "F1.0" }).id, "fast");
  const state = E.createGame(config("F1.0"));
  assert.equal(state.ruleset, "F1.0");
  assert.equal(E.profileOf(state).id, "fast");
  assert.equal(E.profileOf(E.view(state, 0)).id, "fast", "a redacted view resolves the same profile");
  assert.equal(E.profileOf(E.view(state, null)).id, "fast");
});

test("the Fast descriptor is frozen all the way down", () => {
  const fast = E.PROFILES.fast;
  assert.ok(Object.isFrozen(fast));
  assert.ok(Object.isFrozen(fast.phaseOrder));
  assert.ok(Object.isFrozen(fast.phaseSteps));
  for (const steps of Object.values(fast.phaseSteps)) assert.ok(Object.isFrozen(steps));
  assert.ok(Object.isFrozen(fast.ribbon));
  for (const slot of fast.ribbon) assert.ok(Object.isFrozen(slot));
  // Empty today; the Queue, Resource and attack commits fill it, and a mutable
  // list here would be shared by every Fast match on a referee.
  for (const profile of Object.values(E.PROFILES)) {
    assert.ok(Object.isFrozen(profile.illegal), `${profile.id}: illegal is frozen`);
  }
  assert.throws(() => { fast.phaseOrder.push("clash"); }, TypeError);
});

test("every profile's ruleset leads back to that profile", () => {
  /* A surface that builds a config from profile.ruleset must get the game it
   * asked for. One ruleset per profile, and the round trip closes both ways. */
  for (const [id, profile] of Object.entries(E.PROFILES)) {
    assert.equal(profile.id, id, `PROFILES.${id} is filed under its own id`);
    assert.equal(E.RULESET_PROFILE[profile.ruleset], id, `${profile.ruleset} names ${id}`);
    assert.equal(E.profileOf({ ruleset: profile.ruleset }), profile);
  }
  assert.deepEqual(Object.values(E.RULESET_PROFILE).sort(), Object.keys(E.PROFILES).sort(),
    "no profile without a ruleset, no ruleset without a profile");
  assert.equal(E.PROFILES.fast.ruleset, "F1.0");
  assert.equal(E.PROFILES.classic.ruleset, "E1.0");
});

test("the Fast turn is Open, Build, Close", () => {
  const fast = E.PROFILES.fast;
  assert.deepEqual([...fast.phaseOrder], ["open", "build1", "close"]);
  assert.deepEqual(JSON.parse(JSON.stringify(fast.phaseSteps)), {
    open: ["unlock", "maintenance", "draw"],
    build1: ["main"],
    close: ["endStep", "cleanup"],
  });
  assert.deepEqual(fast.ribbon.map((slot) => slot.label),
    ["Unlock", "Maintenance", "Draw", "Build", "End", "Cleanup"]);
});

test("the Fast descriptor claims no rule the engine does not play yet", () => {
  /* The turn machine, priority and the Queue are Fast so far. Each remaining
   * field flips in the commit that implements it; a descriptor that ran ahead
   * of the engine would be a lie a UI or a bot could act on. */
  const fast = E.PROFILES.fast;
  assert.equal(fast.priority, "active");
  assert.equal(fast.queue, "immediate");
  assert.equal(fast.resources, "cards");
  assert.equal(fast.burnsBuffers, true);
  assert.equal(fast.genericOnlyCosts, false);
  assert.deepEqual([...fast.illegal], []);
  assert.equal(fast.combat, "none", "with no Clash phase there is no way to attack yet");
});

test("every profile keeps the shape the turn machine relies on", () => {
  for (const profile of Object.values(E.PROFILES)) {
    const name = profile.id;
    const order = profile.phaseOrder;
    const steps = profile.phaseSteps;
    // createGame and endTurn start a turn at the first step of the first phase,
    // and the unlock case clears Boot Delay: a turn that started anywhere else
    // would leave every Avatar summoning-sick for good.
    assert.equal(order[0], "open", `${name}: a turn opens`);
    assert.equal(steps.open[0], "unlock", `${name}: and unlocks first`);
    // advanceOneStep ends the turn after the last step of the phase literally
    // named "close", and handles repeatCleanup there.
    assert.equal(order[order.length - 1], "close", `${name}: a turn closes`);
    assert.equal(steps.close[steps.close.length - 1], "cleanup", `${name}: cleanup is last`);
    assert.ok(steps.close.includes("endStep"), `${name}: end-of-turn triggers need their step`);
    // PLAY_CARD and PLAY_RESOURCE allow sorcery speed only in a phase named
    // build1 or build2. A profile without one could never play a permanent.
    assert.ok(order.some((phase) => phase === "build1" || phase === "build2"),
      `${name}: some phase must be a Build phase or nothing can be played`);
    assert.deepEqual(Object.keys(steps).sort(), [...order].sort(), `${name}: phases and steps agree`);
    for (const phase of order) {
      assert.ok(steps[phase].length > 0, `${name}: ${phase} has steps`);
      for (const step of steps[phase]) {
        assert.ok(KNOWN_STEPS.includes(step), `${name}: enterStep has no case for "${step}"`);
      }
    }
    // play.js lights the ribbon slot for the current (phase, step); a step with
    // no slot would leave the ribbon dark mid-turn. Classic folds its Clash
    // steps into one slot with step null.
    for (const slot of profile.ribbon) {
      assert.ok(order.includes(slot.phase), `${name}: ribbon slot ${slot.label} names a real phase`);
      assert.ok(slot.step === null || steps[slot.phase].includes(slot.step),
        `${name}: ribbon slot ${slot.label} names a real step`);
    }
    for (const phase of order) {
      for (const step of steps[phase]) {
        assert.ok(profile.ribbon.some((slot) => slot.phase === phase && (slot.step === step || slot.step === null)),
          `${name}: ${phase}:${step} has a ribbon slot`);
      }
    }
  }
});

// ------------------------------------------------------------ turn machine

test("a Fast game starts where every game starts, with no new state", () => {
  const fast = E.createGame(config("F1.0"));
  const classic = E.createGame(config());
  // Unlock, Maintenance and Draw already ran: nothing in them asks for a pass,
  // so a Fast game is dealt straight into its first player's Build window.
  assert.deepEqual([fast.turn.number, fast.turn.active, fast.priority.seat, fast.priority.window],
    [1, 0, 0, "build1:main"]);
  assert.equal(classic.priority.window, "open:maintenance");
  // The turn machine adds no field. poolMax and the like arrive with the
  // subsystem that needs them, and only on Fast.
  assert.deepEqual(Object.keys(fast).sort(), Object.keys(classic).sort());
  assert.deepEqual(Object.keys(fast.turn).sort(), Object.keys(classic.turn).sort());
  assert.deepEqual(Object.keys(fast.seats[0]).sort(), Object.keys(classic.seats[0]).sort());
});

test("a Fast turn opens one priority window, the active player's own Build phase", () => {
  const { state, events, windows, clashSteps } = passUntil(E.createGame(config("F1.0")), (s) => s.turn.number >= 4);
  assert.equal(state.turn.number, 4);
  assert.deepEqual(windows.slice(0, 6).map((w) => `${w.turn}:${w.seat}:${w.window}`), [
    "1:0:build1:main", "1:1:build1:main", "2:0:build1:main", "2:1:build1:main", "3:0:build1:main", "3:1:build1:main",
  ]);
  for (const w of windows) {
    assert.equal(w.seat, w.active, "only the active player ever holds priority");
    assert.equal(w.window, "build1:main", `no window outside Build: opened ${w.window}`);
  }
  const phases = new Set(events.filter((e) => e.t === "PHASE").map(phaseOf));
  assert.deepEqual([...phases].sort(), ["build1", "close"]);
  /* Observed after every action: endTurn resets the Clash record, so checking
   * it once at the end would hold for Classic too. */
  assert.deepEqual([...clashSteps], [null], "the Clash record is never entered");
  const classic = passUntil(E.createGame(config()), (s) => s.turn.number >= 2);
  assert.ok(classic.clashSteps.has("start"), "the same observation does see Classic enter its Clash");
});

test("Fast reaches turn four in fewer actions than Classic, with the same draws", () => {
  /* Measured on this seed with every window passed: Classic opens seven
   * windows a turn (Build I, Clash start and end, Build II among them) and
   * Fast opens one. Pinned as numbers, so a later change that quietly adds a
   * window back shows up here as a count, not as a feeling. */
  const stop = (s) => s.turn.number >= 4;
  const classic = passUntil(E.createGame(config()), stop);
  const fast = passUntil(E.createGame(config("F1.0")), stop);
  assert.equal(classic.actions.length, 48);
  assert.equal(fast.actions.length, 12);
  const draws = (run) => run.events.filter((e) => e.t === "DRAW").length;
  assert.equal(draws(fast), draws(classic), "shortening the turn must not cost a draw");
  assert.equal(draws(fast), 6);
});

test("permanents can still be played during the Fast Build phase", () => {
  /* The trap this phase name avoids: sorcery speed is checked against the
   * names build1 and build2, for Resources (PLAY_RESOURCE) and for every
   * Avatar, Hardware, Protocol and Operation (PLAY_CARD). Walk to the first
   * Build window and play both the way a player would; WRONG_PHASE here means
   * the Build phase was renamed out from under those checks. */
  let { state } = passUntil(E.createGame(config("F1.0")),
    (s) => s.priority.seat === 0 && s.priority.window === "build1:main");
  const resource = E.legalActions(E.view(state, 0), 0).find((move) => move.type === "PLAY_RESOURCE");
  assert.ok(resource, "the opening hand on this seed holds a Resource");
  let result = act(state, "PLAY_RESOURCE", 0, resource.payload);
  assert.equal(result.error, null, JSON.stringify(result.error));
  const entered = result.events.find((e) => e.t === "ENTERS");
  assert.ok(entered, "the Resource entered the Network");
  state = result.state;

  // Generate with it, then spend it on a permanent. Seed-dependent on purpose:
  // this opening hand holds a one-cost Hardware (Bitcoin Receiver).
  result = act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: entered.pub.uid, abilityIndex: 0 });
  assert.equal(result.error, null, JSON.stringify(result.error));
  state = result.state;
  const played = E.legalActions(E.view(state, 0), 0)
    .filter((move) => move.type === "PLAY_CARD")
    .map((move) => ({ move, card: CARDS.find((c) => c.id === state.objects[move.payload.uid].cardId) }))
    .filter(({ card }) => card.type !== "Zap")
    .map(({ move, card }) => ({ card, result: act(state, "PLAY_CARD", 0, move.payload) }))
    .find(({ result: attempt }) => !attempt.error);
  assert.ok(played, "some permanent in hand could be paid for and played");
  assert.notEqual(played.card.type, "Zap", "a Zap would prove nothing: it is instant speed");
  // And under Fast it is already in play when the action returns: no pass,
  // no second seat, no Queue left behind.
  const kinds = played.result.events.map((e) => e.t);
  assert.ok(kinds.indexOf("QUEUED") >= 0 && kinds.indexOf("ENTERS") > kinds.indexOf("QUEUED"),
    `${played.card.name} was queued and resolved in one action: ${kinds.join(",")}`);
  assert.equal(played.result.state.queue.length, 0);
  assert.equal(played.result.state.priority.seat, 0, "the active player keeps priority to play on");
  assert.equal(played.result.state.priority.window, "build1:main");
});

test("an unspent Buffer still burns when the Fast Build phase ends", () => {
  /* The descriptor says burnsBuffers: true, and until the Resource commit it
   * has to be true in play, not only on paper. Generate one Resource in Build,
   * spend nothing, and pass into Close. */
  let { state } = passUntil(E.createGame(config("F1.0")),
    (s) => s.priority.seat === 0 && s.priority.window === "build1:main");
  const resource = E.legalActions(E.view(state, 0), 0).find((move) => move.type === "PLAY_RESOURCE");
  let result = act(state, "PLAY_RESOURCE", 0, resource.payload);
  const entered = result.events.find((e) => e.t === "ENTERS");
  result = act(result.state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: entered.pub.uid, abilityIndex: 0 });
  assert.equal(result.error, null, JSON.stringify(result.error));
  state = result.state;
  const uptime = state.seats[0].uptime;
  assert.equal(Object.values(state.seats[0].buffer).reduce((a, b) => a + b, 0), 1, "one Resource generated");

  const walk = passUntil(state, (s) => s.turn.active === 1);
  const burn = walk.events.find((e) => e.t === "BURN");
  assert.ok(burn, "leaving Build burned the Buffer");
  assert.deepEqual({ seat: burn.pub.seat, amount: burn.pub.amount, reason: burn.pub.reason },
    { seat: 0, amount: 1, reason: "end of phase" });
  assert.equal(walk.state.seats[0].uptime, uptime - 1);
  assert.equal(Object.values(walk.state.seats[0].buffer).reduce((a, b) => a + b, 0), 0);
});

test("end-of-turn effects still happen in a Fast turn", () => {
  /* Fast keeps endStep because delayed "at end of turn" effects are processed
   * there. Schedule one by hand and walk through the step, under both profiles,
   * so the Fast result is compared with a known-good Classic one. */
  for (const ruleset of [undefined, "F1.0"]) {
    let state = E.createGame(config(ruleset));
    ({ state } = passUntil(state, (s) => s.priority.seat === 0 && s.priority.window === "build1:main"));
    const avatar = CARDS.find((card) => card.type === "Avatar" && !card.keywords.length);
    const uid = "o" + state.nextUid;
    state.nextUid += 1;
    state.objects[uid] = {
      uid, cardId: avatar.id, owner: 0, controller: 0, zone: "0:network", committed: false,
      bootDelay: true, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
      revealedTo: [], revealedUntil: null, token: false, entersSeq: state.seq, prevUid: null,
    };
    state.zones["0:network"].push(uid);
    state.delayed = (state.delayed || []).concat([{ at: "end-step", op: "decommission", uid }]);
    let events;
    ({ state, events } = passUntil(state, (s) => s.turn.active === 1));
    const label = ruleset || "E1.0";
    assert.equal(state.zones["0:network"].includes(uid), false, `${label}: the delayed decommission ran`);
    /* Followed by its handle, not by the Archive's size: the first player draws
     * to eight on turn one and discards into the same Archive, and this Avatar's
     * card is also dealt into a Stack on this seed. A zone change mints a new
     * uid and records the old one as prevUid. */
    const archived = state.zones["0:archive"].map((id) => state.objects[id]).filter((o) => o.prevUid === uid);
    assert.equal(archived.length, 1, `${label}: the Avatar went to the Archive`);
    assert.equal(archived[0].cardId, avatar.id, `${label}: as itself`);
    assert.equal((state.delayed || []).length, 0, `${label}: and the delayed entry was consumed`);
    const endStepIndex = events.findIndex((e) => e.t === "PHASE" && phaseOf(e) === "close");
    assert.ok(endStepIndex >= 0, `${label}: the turn passed through Close`);
  }
});

test("Boot Delay still ends at the start of the owner's next Fast turn", () => {
  let state = E.createGame(config("F1.0"));
  const avatar = CARDS.find((card) => card.type === "Avatar" && !card.keywords.length);
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = {
    uid, cardId: avatar.id, owner: 0, controller: 0, zone: "0:network", committed: false,
    bootDelay: true, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [], revealedUntil: null, token: false, entersSeq: state.seq, prevUid: null,
  };
  state.zones["0:network"].push(uid);
  ({ state } = passUntil(state, (s) => s.turn.active === 1));
  assert.equal(state.objects[uid].bootDelay, true, "still booting through the opponent's turn");
  ({ state } = passUntil(state, (s) => s.turn.active === 0));
  assert.equal(state.objects[uid].bootDelay, false, "unlocked on its controller's next turn");
});

// ------------------------------------------------------ determinism, surfaces

test("a Fast game is deterministic, replays, and its transcript verifies", () => {
  const cfg = config("F1.0");
  const stop = (s) => s.turn.number >= 3;
  const first = passUntil(E.createGame(cfg), stop);
  const second = passUntil(E.createGame(cfg), stop);
  assert.equal(E.hashState(first.state), E.hashState(second.state));

  const again = E.replay(cfg, first.actions);
  assert.equal(again.error, null, JSON.stringify(again.error));
  assert.equal(E.hashState(again.state), E.hashState(first.state), "REPLAY DIVERGED");

  let folded = E.createGame(cfg);
  let prev = folded.gameId;
  const entries = [];
  for (const action of first.actions) {
    folded = E.apply(folded, action).state;
    const entry = { seq: action.seq, seat: action.seat, at: "", action, prev, stateHash: E.hashState(folded) };
    entries.push(entry);
    prev = E.entryHash(entry);
  }
  const verdict = E.verifyMatch({ config: cfg, log: entries });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.error));
  assert.equal(verdict.headHash, E.hashState(first.state));
});

test("one pass hands the turn to the opponent's Build phase", () => {
  /* Classic, from the same deal, first asks for a pass at Maintenance and keeps
   * the turn with seat 0 through six more windows. */
  const classic = E.createGame(config());
  assert.equal(classic.priority.window, "open:maintenance");

  const fast = E.createGame(config("F1.0"));
  assert.deepEqual([fast.priority.seat, fast.priority.window], [0, "build1:main"]);
  // The one decision between the two windows is the hand limit: the first
  // player drew to eight on turn one, and Cleanup asks which card goes.
  const walk = passUntil(fast, (s) => s.turn.active === 1 && s.priority.seat !== null);
  assert.deepEqual(walk.actions.map((a) => a.type), ["PASS_PRIORITY", "DISCARD_TO_LIMIT"]);
  const next = walk.state;
  assert.deepEqual([next.turn.number, next.turn.active, next.priority.seat, next.priority.window],
    [1, 1, 1, "build1:main"]);
  const kinds = walk.events.map((e) => e.t);
  for (const expected of ["PHASE", "CLEANUP", "TURN", "DRAW"]) {
    assert.ok(kinds.includes(expected), `the rest of the turn and the next opening ran: ${kinds.join(",")}`);
  }
  // The non-active seat holds no priority: it cannot pass, play or activate.
  const refused = act(next, "PASS_PRIORITY", 0);
  assert.ok(refused.error, "seat 0 passing on seat 1's turn must be refused");
});

test("a Maintenance trigger resolves without asking anyone to pass", () => {
  /* Uptime Clock: at the beginning of each player's Maintenance, 1 damage to
   * that player. Maintenance opens no window under Fast, so the trigger must
   * resolve inside the pass that reaches it. */
  const state = E.createGame(config("F1.0"));
  const clock = CARDS.find((card) => card.name === "Uptime Clock");
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = {
    uid, cardId: clock.id, owner: 0, controller: 0, zone: "0:network", committed: false,
    bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [], revealedUntil: null, token: false, entersSeq: state.seq, prevUid: null,
  };
  state.zones["0:network"].push(uid);
  const uptime = state.seats[1].uptime;
  const walk = passUntil(state, (s) => s.turn.active === 1 && s.priority.seat !== null);
  // A pass and the hand-limit discard; no window for Maintenance in between.
  assert.deepEqual(walk.actions.map((a) => a.type), ["PASS_PRIORITY", "DISCARD_TO_LIMIT"]);
  assert.equal(walk.state.seats[1].uptime, uptime - 1, "seat 1 took the Maintenance damage");
  assert.equal(walk.state.queue.length, 0, "and nothing was left waiting");
  assert.deepEqual([walk.state.priority.seat, walk.state.priority.window], [1, "build1:main"]);
});

test("bot games under Fast finish, and nothing waits on the Queue between actions", () => {
  /* The NPC plays the same policy as the browser. Three pairings measured to
   * finish on these seeds. Two others are left out on purpose, for reasons that
   * are not Fast's: Signal/Bitcoin reaches a drawReplacement prompt the NPC
   * cannot answer (it stalls in Classic too), and Power/Signal meets Boost
   * Converter, whose miscompiled cost lets the bot generate forever (also in
   * Classic). */
  const NPC = require(path.join(siteDir, "npc.js"));
  const compiled = {};
  const compile = (id) => {
    if (!compiled[id]) compiled[id] = E.compileCard(CARDS.find((c) => c.id === id));
    return compiled[id];
  };
  for (const [i, a, b] of [[1, "Bitcoin", "Keys"], [2, "Timelock", "Power"], [4, "Keys", "Timelock"]]) {
    let seed = 20260802 + i * 97;
    let state = null;
    for (let k = 0; k < 40 && !state; k++) {
      try {
        state = E.createGame({ ruleset: "F1.0", seats: [{ name: "A", affinity: a }, { name: "B", affinity: b }],
          seeds: { public: seed, hidden: [777, 888] }, firstPlayer: 0 });
      } catch (error) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      }
    }
    let steps = 0;
    while (!state.result && steps < 1500) {
      const seat = NPC.waitingSeat(state);
      assert.notEqual(seat, null, `${a}/${b}: nobody to act at seq ${state.seq}`);
      let next = null;
      for (const move of NPC.candidates(E, state, seat, compile, { affinity: seat === 0 ? a : b })) {
        const result = E.apply(state, { type: move.type, seat, seq: state.seq, at: "", payload: move.payload });
        if (!result.error) {
          next = result.state;
          break;
        }
      }
      assert.ok(next, `${a}/${b}: no accepted move at seq ${state.seq}, ${state.priority.window}`);
      if (next.queue.length) {
        assert.ok(next.pendingChoice || next.pendingManual || next.awaiting,
          `${a}/${b}: the Queue held ${next.queue.length} with nothing to answer`);
      }
      if (next.priority.seat !== null) assert.equal(next.priority.seat, next.turn.active);
      state = next;
      steps += 1;
    }
    assert.ok(state.result, `${a}/${b}: no verdict after ${steps} actions (turn ${state.turn.number})`);
  }
});

test("ribbonFor gives a Fast game its own ribbon and leaves TURN_RIBBON alone", () => {
  const state = E.createGame(config("F1.0"));
  assert.equal(E.ribbonFor(state), E.PROFILES.fast.ribbon);
  assert.equal(E.ribbonFor(E.view(state, 1)).length, 6);
  assert.equal(E.TURN_RIBBON.length, 8, "play.js still reads the Classic array directly");
});

test("previewClash on a Fast state forecasts nothing and does not throw", () => {
  /* play.js calls previewClash on every render. A throw here would take the
   * board down the moment a Fast game reached a table. */
  const { state } = passUntil(E.createGame(config("F1.0")), (s) => s.priority.window === "build1:main");
  let plan;
  assert.doesNotThrow(() => { plan = E.previewClash(E.view(state, 0), {}); });
  assert.deepEqual(plan.rows, []);
});

test("playing a Fast game does not mutate the shared card catalog", () => {
  const before = JSON.stringify(CARDS);
  passUntil(E.createGame(config("F1.0")), (s) => s.turn.number >= 3);
  assert.equal(JSON.stringify(CARDS), before);
});
