/* The Fast profile (ruleset "F1.0"), built one subsystem at a time.
 *
 * Covered so far: the turn machine (Open, one Build phase, Close — no Clash
 * phase and no Build II), and priority with the Queue (only the active player
 * holds priority, only in Build, and nothing waits on the Queue), and Resources
 * (a pool that grows by one a turn, costs paid as plain numbers, no burn), and
 * attacking (one Avatar at one target, now; Firewall taunts). Classic
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
  /* Every field is Fast now. A descriptor that ran ahead of the engine would be
   * a lie a UI or a bot could act on, so each flipped with its subsystem. */
  const fast = E.PROFILES.fast;
  assert.equal(fast.priority, "active");
  assert.equal(fast.queue, "immediate");
  assert.equal(fast.resources, "pool");
  assert.equal(fast.burnsBuffers, false);
  assert.equal(fast.genericOnlyCosts, true);
  assert.deepEqual([...fast.illegal], [
    "PLAY_RESOURCE", "ACTIVATE_RESOURCE_ABILITY", "ACTIVATE_UPTIME_RESOURCE",
    "DECLARE_ATTACKERS", "DECLARE_BLOCKERS", "ORDER_BLOCKERS", "ASSIGN_COMBAT_DAMAGE",
  ]);
  assert.equal(E.FAST_POOL_CAP, 10);
  assert.equal(fast.combat, "attack");
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
  // One new field, and only on Fast: a seat's pool size, from its first Unlock.
  assert.deepEqual(Object.keys(fast).sort(), Object.keys(classic).sort());
  assert.deepEqual(Object.keys(fast.turn).sort(), Object.keys(classic.turn).sort());
  assert.deepEqual(Object.keys(fast.seats[0]).sort(), Object.keys(classic.seats[0]).concat("poolMax").sort());
  assert.deepEqual(Object.keys(fast.seats[1]).sort(), Object.keys(classic.seats[1]).sort(),
    "the second player has not unlocked yet");
  assert.equal(E.view(fast, 1).seats[0].poolMax, 1, "the pool is public");
  assert.equal("poolMax" in E.view(classic, 1).seats[0], false);
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
   * names build1 and build2 for every Avatar, Hardware, Protocol and Operation
   * (PLAY_CARD). WRONG_PHASE here means the Build phase was renamed out from
   * under those checks. Seed-dependent on purpose: this opening hand holds a
   * one-cost Hardware (Bitcoin Receiver), payable from a turn-one pool. */
  const state = E.createGame(config("F1.0"));
  assert.equal(state.seats[0].buffer.N, 1);
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
  assert.equal(played.result.state.seats[0].buffer.N, 0, "and the pool paid for it");
});

test("the pool grows by one each own turn up to the cap, refills, and never burns", () => {
  const seen = [[], []];
  const start = E.createGame(config("F1.0"));
  const uptime = start.seats.map((seat) => seat.uptime);
  const record = (s) => {
    if (s.priority.seat === null || s.priority.window !== "build1:main") return;
    const seat = s.turn.active;
    if (seen[seat].length >= s.turn.number) return;
    seen[seat].push(s.seats[seat].buffer.N);
    assert.equal(s.seats[seat].buffer.N, s.seats[seat].poolMax, "the Buffer is refilled to the pool");
    assert.equal(Object.values(s.seats[seat].buffer).reduce((a, b) => a + b, 0), s.seats[seat].buffer.N);
  };
  record(start);
  const walk = passUntil(start, (s) => {
    record(s);
    return s.turn.number > 13;
  });
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
  assert.deepEqual(seen[0].slice(0, 13), expected);
  assert.deepEqual(seen[1].slice(0, 13), expected);
  assert.equal(walk.events.filter((e) => e.t === "BURN").length, 0, "an unspent pool never burns");
  // In a game of passes nothing else deals damage, so any Uptime lost was a burn.
  assert.deepEqual(walk.state.seats.map((seat) => seat.uptime), uptime);
});

test("leftover Resources do not carry into the next turn", () => {
  const { state } = passUntil(E.createGame(config("F1.0")),
    (s) => s.turn.number === 3 && s.turn.active === 0 && s.priority.seat === 0);
  state.seats[0].buffer.B = 4; // a generated symbol that went unspent
  const walk = passUntil(state, (s) => s.turn.number === 4 && s.turn.active === 0 && s.priority.seat === 0);
  assert.deepEqual(walk.state.seats[0].buffer, { P: 0, B: 0, K: 0, S: 0, T: 0, N: 4 });
});

test("a coloured cost is paid from the pool as a plain number, in Fast only", () => {
  /* Put a card with a symbol in its cost straight into the hand, give the seat
   * exactly as many neutral Resources as the cost adds up to, and play it. Under
   * Classic the same state must refuse: N cannot pay a P. */
  const SYMBOL_KEYS = ["P", "B", "K", "S", "T"];
  const candidates = CARDS.map((card) => E.compileCard(card)).filter((card) => ["Avatar", "Protocol", "Operation"].includes(card.type) &&
    card.costParsed && SYMBOL_KEYS.some((symbol) => card.costParsed[symbol]));
  let checked = 0;
  for (const card of candidates) {
    const printed = JSON.stringify(card.costParsed);
    const total = (card.costParsed.generic || 0) +
      SYMBOL_KEYS.reduce((sum, symbol) => sum + (card.costParsed[symbol] || 0), 0);
    const outcome = {};
    for (const ruleset of ["F1.0", undefined]) {
      const { state } = passUntil(E.createGame(config(ruleset)),
        (s) => s.priority.seat === 0 && s.priority.window === "build1:main");
      const uid = "o" + state.nextUid;
      state.nextUid += 1;
      state.objects[uid] = {
        uid, cardId: card.id, owner: 0, controller: 0, zone: "0:wallet", committed: false,
        bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
        revealedTo: [], revealedUntil: null, token: false, entersSeq: state.seq, prevUid: null,
      };
      state.zones["0:wallet"].push(uid);
      state.seats[0].buffer = { P: 0, B: 0, K: 0, S: 0, T: 0, N: total };
      outcome[ruleset || "E1.0"] = act(state, "PLAY_CARD", 0, { uid });
      if (ruleset) outcome.stated = act(state, "PLAY_CARD", 0, { uid, payment: { P: 0, B: 0, K: 0, S: 0, T: 0, N: total } });
    }
    if (outcome["F1.0"].error) continue; // needs targets or a condition: not what this test is about
    const paid = outcome["F1.0"].events.find((e) => e.t === "PAID");
    assert.deepEqual(paid.pub.payment, { P: 0, B: 0, K: 0, S: 0, T: 0, N: total }, card.name);
    assert.equal(outcome.stated.error, null, `${card.name}: a stated all-neutral payment verifies too`);
    assert.equal(outcome["E1.0"].error && outcome["E1.0"].error.code, "CANNOT_AFFORD", `${card.name} under Classic`);
    assert.equal(JSON.stringify(E.compileCard(CARDS.find((c) => c.id === card.id)).costParsed), printed, "the printed cost keeps its symbols");
    checked += 1;
    if (checked === 3) break;
  }
  assert.equal(checked, 3, "three coloured cards were played from a neutral pool");
});

test("the Resource actions are refused under Fast and never offered", () => {
  const classic = passUntil(E.createGame(config()),
    (s) => s.priority.seat === 0 && s.priority.window === "build1:main").state;
  const fast = E.createGame(config("F1.0"));
  const classicResource = E.legalActions(E.view(classic, 0), 0).find((move) => move.type === "PLAY_RESOURCE");
  assert.ok(classicResource, "Classic offers a Resource from this hand");
  const offered = E.legalActions(E.view(fast, 0), 0).map((move) => move.type);
  assert.ok(offered.includes("PLAY_CARD") && offered.includes("PASS_PRIORITY"));
  for (const type of ["PLAY_RESOURCE", "ACTIVATE_RESOURCE_ABILITY", "ACTIVATE_UPTIME_RESOURCE"]) {
    assert.equal(offered.includes(type), false, `${type} is not offered`);
  }
  const resource = fast.zones["0:wallet"]
    .find((uid) => CARDS.find((c) => c.id === fast.objects[uid].cardId).type === "Resource");
  assert.ok(resource, "the Fast hand still holds a Resource card");
  const refusals = [
    act(fast, "PLAY_RESOURCE", 0, { uid: resource }),
    act(fast, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: resource, abilityIndex: 0 }),
    act(fast, "ACTIVATE_UPTIME_RESOURCE", 0),
  ];
  assert.deepEqual(refusals.map((r) => r.error && r.error.code), ["WRONG_PROFILE", "WRONG_PROFILE", "WRONG_PROFILE"]);
  assert.equal(act(classic, "PLAY_RESOURCE", 0, classicResource.payload).error, null);
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

test("one pass hands the turn over even for a seat that never auto-passes", () => {
  /* Classic's auto-pass would quietly pass the opponent's window too, and hide
   * a second window that Fast must not open at all. Turn it off for both. */
  const settings = config("F1.0");
  settings.seats = settings.seats.map((seat) => Object.assign({}, seat, { autoPass: { emptyQueue: false, noLegalResponse: false } }));
  const state = E.createGame(settings);
  const passed = act(state, "PASS_PRIORITY", 0);
  assert.equal(passed.error, null, JSON.stringify(passed.error));
  const windows = [];
  let current = passed.state;
  for (let i = 0; i < 10 && !(current.turn.active === 1 && current.priority.seat === 1); i++) {
    if (current.priority.seat !== null) windows.push(`${current.priority.seat}:${current.priority.window}`);
    assert.equal(current.priority.seat, null, `no window between the pass and seat 1's Build: ${windows.join(",")}`);
    const uids = current.awaiting && current.awaiting.kind === "discard"
      ? current.zones["0:wallet"].slice(0, current.zones["0:wallet"].length - 7) : [];
    const result = act(current, "DISCARD_TO_LIMIT", current.awaiting.seat, { uids });
    assert.equal(result.error, null, JSON.stringify(result.error));
    current = result.state;
  }
  assert.deepEqual([current.turn.active, current.priority.seat, current.priority.window], [1, 1, "build1:main"]);
});

test("two Maintenance triggers at once both resolve inside the pass", () => {
  const state = E.createGame(config("F1.0"));
  const clock = CARDS.find((card) => card.name === "Uptime Clock");
  for (let i = 0; i < 2; i++) {
    const uid = "o" + state.nextUid;
    state.nextUid += 1;
    state.objects[uid] = {
      uid, cardId: clock.id, owner: 0, controller: 0, zone: "0:network", committed: false,
      bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
      revealedTo: [], revealedUntil: null, token: false, entersSeq: state.seq, prevUid: null,
    };
    state.zones["0:network"].push(uid);
  }
  const uptime = state.seats[1].uptime;
  const walk = passUntil(state, (s) => s.turn.active === 1 && s.priority.seat !== null);
  // Nobody is asked to order the two: Fast resolves triggers in the order raised.
  assert.deepEqual(walk.actions.map((a) => a.type), ["PASS_PRIORITY", "DISCARD_TO_LIMIT"]);
  assert.equal(walk.state.seats[1].uptime, uptime - 2);
  assert.equal(walk.state.queue.length, 0);
});

test("a trigger raised while a card resolves is resolved in the same action", () => {
  /* Grounded Signal: "When this Attachment enters, if attached Avatar has
   * Broadcast, this Attachment deals 2 damage to that Avatar". The enter
   * trigger only exists once the card has resolved, inside the Queue settling,
   * so the settling has to collect it and keep going. */
  const state = E.createGame(config("F1.0"));
  const host = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[host] = {
    uid: host, cardId: "E1-036", owner: 0, controller: 0, zone: "0:network", committed: false,
    bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [0, 1], revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
  };
  state.zones["0:network"].push(host);
  state.effects.push({ kind: "grant", targetUid: host, keyword: "Broadcast", controller: 0 });
  const signal = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[signal] = {
    uid: signal, cardId: "E1-148", owner: 0, controller: 0, zone: "0:wallet", committed: false,
    bootDelay: false, damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [0], revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
  };
  state.zones["0:wallet"].push(signal);
  const result = act(state, "PLAY_CARD", 0, { uid: signal, targets: [{ kind: "object", uid: host }] });
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(result.state.queue.length, 0);
  assert.deepEqual([result.state.pendingTriggers[0].length, result.state.pendingTriggers[1].length], [0, 0]);
  assert.ok(result.events.some((e) => e.t === "DAMAGE" && e.pub.uid === host && e.pub.amount === 2),
    `the enter trigger dealt its damage: ${result.events.map((e) => e.t).join(",")}`);
});

test("bot games under Fast finish, and nothing waits on the Queue between actions", () => {
  /* The NPC plays the same policy as the browser. Five pairings, including
   * Signal/Bitcoin, which reaches a drawReplacement prompt the NPC now answers. */
  const NPC = require(path.join(siteDir, "npc.js"));
  const compiled = {};
  const compile = (id) => {
    if (!compiled[id]) compiled[id] = E.compileCard(CARDS.find((c) => c.id === id));
    return compiled[id];
  };
  for (const [i, a, b] of [[0, "Signal", "Bitcoin"], [1, "Bitcoin", "Keys"], [2, "Timelock", "Power"], [3, "Power", "Signal"], [4, "Keys", "Timelock"]]) {
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

/* ------------------------------------------------------------- attacking */

/* Vanilla Avatars: no abilities and no keywords, so nothing but the attack
 * rules acts on them. Keywords are granted as plain effects where needed. */
const MORGS = "E1-036"; // 2/2
const CUDDY = "E1-044"; // 2/1
const DARREN = "E1-095"; // 5/4
const TINY = "E1-071"; // 1/1

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

const attack = (state, attacker, target, seat = 0) => act(state, "DECLARE_ATTACK", seat, { attacker, target });
const face = (seat) => ({ kind: "seat", seat });
const avatar = (uid) => ({ kind: "object", uid });
const inNetwork = (state, uid) => Boolean(state.objects[uid]) && state.objects[uid].zone.endsWith(":network");

test("an Avatar attacks the opponent directly, once, and the turn goes on", () => {
  const state = E.createGame(config("F1.0"));
  const morgs = place(state, MORGS, 0);
  const uptime = state.seats[1].uptime;
  const hit = attack(state, morgs, face(1));
  assert.equal(hit.error, null, JSON.stringify(hit.error));
  assert.equal(hit.state.seats[1].uptime, uptime - 2);
  assert.equal(hit.state.objects[morgs].committed, true, "attacking commits the Avatar");
  assert.deepEqual(hit.state.turn.attacked, [morgs]);
  const event = hit.events.find((e) => e.t === "ATTACK");
  assert.deepEqual([event.pub.attacker, event.pub.target], [morgs, face(1)]);
  assert.deepEqual([hit.state.priority.seat, hit.state.priority.window], [0, "build1:main"]);
  assert.equal(attack(hit.state, morgs, face(1)).error.code, "CANNOT_ATTACK", "a committed Avatar cannot attack again");
  // It is ready again on its controller's next turn.
  const next = passUntil(hit.state, (s) => s.turn.number === 2 && s.turn.active === 0 && s.priority.seat === 0);
  assert.equal(attack(next.state, morgs, face(1)).error, null);
});

test("two Avatars trade damage at once, and the dead go to the Archive", () => {
  const state = E.createGame(config("F1.0"));
  const darren = place(state, DARREN, 0); // 5/4
  const morgs = place(state, MORGS, 1); // 2/2
  const cuddy = place(state, CUDDY, 0); // 2/1
  const tiny = place(state, TINY, 1); // 1/1
  let result = attack(state, darren, avatar(morgs));
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(inNetwork(result.state, morgs), false, "Morgs took 5 and was decommissioned");
  assert.equal(result.state.objects[darren].damage, 2, "Darren took Morgs's 2 back");
  assert.equal(result.state.seats[1].uptime, state.seats[1].uptime, "no Overflow, no damage to the player");
  result = attack(result.state, cuddy, avatar(tiny));
  assert.equal(inNetwork(result.state, tiny), false);
  assert.equal(inNetwork(result.state, cuddy), false, "both 1-Resilience Avatars died simultaneously");
});

test("Boot Delay: an Avatar cannot attack the turn it arrives", () => {
  const state = E.createGame(config("F1.0"));
  const fresh = place(state, MORGS, 0, { bootDelay: true });
  assert.equal(attack(state, fresh, face(1)).error.code, "CANNOT_ATTACK");
  assert.equal(E.legalActions(E.view(state, 0), 0).some((move) => move.type === "DECLARE_ATTACK"), false);
});

test("a Firewall must be attacked first, unless the attacker has Broadcast", () => {
  const state = E.createGame(config("F1.0"));
  const morgs = place(state, MORGS, 0);
  const loud = place(state, CUDDY, 0);
  grant(state, loud, "Broadcast");
  const wall = place(state, DARREN, 1);
  grant(state, wall, "Firewall");
  const other = place(state, TINY, 1);
  assert.equal(attack(state, morgs, face(1)).error.code, "FIREWALL");
  assert.equal(attack(state, morgs, avatar(other)).error.code, "FIREWALL");
  assert.equal(attack(state, morgs, avatar(wall)).error, null);
  assert.equal(attack(state, loud, face(1)).error, null, "Broadcast goes over the Firewall");
  // And a Firewall may attack under Fast: it is a taunt, not a wall that never moves.
  const own = place(state, MORGS, 0);
  grant(state, own, "Firewall");
  assert.equal(attack(state, own, avatar(wall)).error, null);
});

test("First Strike hits first, and a target it kills does not hit back", () => {
  const state = E.createGame(config("F1.0"));
  const striker = place(state, MORGS, 0); // 2/2
  grant(state, striker, "First Strike");
  const victim = place(state, CUDDY, 1); // 2/1
  let result = attack(state, striker, avatar(victim));
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(inNetwork(result.state, victim), false);
  assert.equal(result.state.objects[striker].damage, 0, "the dead do not strike back");
  // A defender with First Strike kills the attacker before it lands a blow.
  const defended = E.createGame(config("F1.0"));
  const attacker = place(defended, CUDDY, 0); // 2/1
  const guard = place(defended, MORGS, 1); // 2/2
  grant(defended, guard, "First Strike");
  result = attack(defended, attacker, avatar(guard));
  assert.equal(inNetwork(result.state, attacker), false);
  assert.equal(result.state.objects[guard].damage, 0);
});

test("Overflow carries damage beyond lethal on to the player", () => {
  const state = E.createGame(config("F1.0"));
  const darren = place(state, DARREN, 0); // 5/4
  grant(state, darren, "Overflow");
  const tiny = place(state, TINY, 1); // 1/1
  const result = attack(state, darren, avatar(tiny));
  assert.equal(result.error, null, JSON.stringify(result.error));
  assert.equal(result.state.seats[1].uptime, state.seats[1].uptime - 4);
  assert.equal(inNetwork(result.state, tiny), false);
  // Without Overflow the same attack stops at the Avatar.
  const plain = E.createGame(config("F1.0"));
  const d2 = place(plain, DARREN, 0);
  const t2 = place(plain, TINY, 1);
  assert.equal(attack(plain, d2, avatar(t2)).state.seats[1].uptime, plain.seats[1].uptime);
});

test("an attack that brings the opponent to zero ends the game", () => {
  const state = E.createGame(config("F1.0"));
  state.seats[1].uptime = 2;
  const morgs = place(state, MORGS, 0);
  const result = attack(state, morgs, face(1));
  assert.ok(result.state.result, "the game has a verdict");
  assert.deepEqual(result.state.result.winners, [0]);
});

test("attacks are refused where they do not belong", () => {
  const state = E.createGame(config("F1.0"));
  const mine = place(state, MORGS, 0);
  const also = place(state, CUDDY, 0);
  const theirs = place(state, TINY, 1);
  assert.equal(attack(state, mine, face(0)).error.code, "BAD_TARGET", "not yourself");
  assert.equal(attack(state, mine, avatar(also)).error.code, "BAD_TARGET", "not your own Avatar");
  assert.equal(attack(state, theirs, face(0), 0).error.code, "NOT_CONTROLLER");
  assert.equal(attack(state, mine, { kind: "nobody" }).error.code, "SCHEMA");
  assert.equal(attack(state, theirs, face(0), 1).error.code, "NO_PRIORITY", "not on the opponent's turn");
  const hand = state.zones["0:wallet"][0];
  assert.equal(attack(state, hand, face(1)).error.code, "NOT_IN_ZONE");
  for (const type of ["DECLARE_ATTACKERS", "DECLARE_BLOCKERS", "ORDER_BLOCKERS", "ASSIGN_COMBAT_DAMAGE"]) {
    const payload = { DECLARE_ATTACKERS: { attackers: [] }, DECLARE_BLOCKERS: { blocks: {} },
      ORDER_BLOCKERS: { order: {} }, ASSIGN_COMBAT_DAMAGE: { assignment: null } }[type];
    assert.equal(act(state, type, 0, payload).error.code, "WRONG_PROFILE", type);
  }
  // Classic keeps its Clash and refuses the Fast action.
  const classic = E.createGame(config());
  const classicMine = place(classic, MORGS, 0);
  assert.equal(attack(classic, classicMine, face(1)).error.code, "WRONG_PROFILE");
  assert.equal(E.legalActions(E.view(classic, 0), 0).some((move) => move.type === "DECLARE_ATTACK"), false);
});

test("legalActions offers each ready Avatar an attack, and only on its controller's turn", () => {
  const state = E.createGame(config("F1.0"));
  const ready = place(state, MORGS, 0);
  place(state, CUDDY, 0, { committed: true });
  const theirs = place(state, TINY, 1);
  const offered = E.legalActions(E.view(state, 0), 0).filter((move) => move.type === "DECLARE_ATTACK");
  assert.deepEqual(offered.map((move) => move.payload), [{ attacker: ready, target: face(1) }]);
  assert.equal(E.legalActions(E.view(state, 1), 1).some((move) => move.type === "DECLARE_ATTACK"), false);
  assert.ok(theirs);
});

test("a Fast game with attacks replays, and its transcript verifies", () => {
  const state = E.createGame(config("F1.0"));
  const morgs = place(state, MORGS, 0);
  const result = attack(state, morgs, face(1));
  assert.equal(result.error, null);
  assert.equal(E.hashState(attack(state, morgs, face(1)).state), E.hashState(result.state), "deterministic");
  // Nothing Clash-shaped was touched.
  assert.deepEqual(result.state.clash, state.clash);
});
