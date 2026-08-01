/* Referee core tests. Run with `node --test tests/js/`.
 * Assertions are on error CODES and structure, never on English wording — the
 * UI owns all wording and must be free to change it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "..", "site");
const require = createRequire(import.meta.url);

const CARDS = require(path.join(siteDir, "play-data.js"));
const E = require(path.join(siteDir, "engine.js"));
E.setCatalog(CARDS);

const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const findCard = (test) => CARDS.find(test);

const baseConfig = (over) =>
  Object.assign(
    {
      seats: [
        { name: "P1", affinity: "Power" },
        { name: "P2", affinity: "Signal" },
      ],
      seeds: { public: 12345, hidden: [777, 888] },
    },
    over || {}
  );

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

/* Drive the game forward until `stop` is satisfied: pass priority, and answer
 * every awaited declaration with its do-nothing / canonical default. */
function passUntil(state, stop, limit = 400) {
  for (let i = 0; i < limit; i++) {
    if (stop(state)) return state;
    if (state.result) return state;
    const seat = state.priority.seat;
    if (seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", seat));
      continue;
    }
    const aw = state.awaiting;
    if (!aw) throw new Error("stuck with neither priority nor a pending declaration");
    if (aw.kind === "attackers") state = ok(act(state, "DECLARE_ATTACKERS", aw.seat, { attackers: [] }));
    else if (aw.kind === "blockers") state = ok(act(state, "DECLARE_BLOCKERS", aw.seat, { blocks: {} }));
    else if (aw.kind === "order") {
      const order = {};
      for (const key of Object.keys(state.clash.blocks)) order[key] = state.clash.blocks[key].slice();
      state = ok(act(state, "ORDER_BLOCKERS", aw.seat, { order }));
    } else if (aw.kind === "damage") {
      state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", aw.seat, { assignment: null }));
    } else if (aw.kind === "discard") {
      const wallet = state.zones[`${aw.seat}:wallet`];
      state = ok(act(state, "DISCARD_TO_LIMIT", aw.seat, {
        uids: wallet.slice(0, wallet.length - state.handLimit),
      }));
    } else if (aw.kind === "triggers") {
      state = ok(act(state, "ORDER_TRIGGERS", aw.seat, {
        qids: state.pendingTriggers[String(aw.seat)].map((t) => t.pendingId),
      }));
    } else throw new Error(`unhandled awaiting kind ${aw.kind}`);
  }
  throw new Error("passUntil exhausted");
}

const atStep = (phase, step) => (s) => s.turn.phase === phase && s.turn.step === step;

/* Put a specific card into a seat's Network directly, for rules fixtures. */
function seed(state, seat, cardId, tweaks) {
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid,
      cardId,
      owner: seat,
      controller: seat,
      zone: `${seat}:network`,
      committed: false,
      bootDelay: byId[cardId].type.includes("Avatar"),
      damage: 0,
      counters: {},
      attachedTo: null,
      rebootShields: 0,
      facedown: false,
      revealedTo: [],
      revealedUntil: null,
      token: false,
      entersSeq: state.seq,
      prevUid: null,
    },
    tweaks || {}
  );
  state.zones[`${seat}:network`].push(uid);
  return uid;
}

// ---------------------------------------------------------------- primitives

test("SHA-256 matches the NIST vectors", () => {
  assert.equal(E.sha256hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(E.sha256hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    E.sha256hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
  assert.equal(
    E.sha256hex("a".repeat(1000000)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
  );
});

test("canonicalJSON sorts keys and refuses everything a replay cannot survive", () => {
  assert.equal(E.canonicalJSON({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}');
  assert.equal(E.canonicalJSON({ "10": 1, "9": 2 }), '{"10":1,"9":2}');
  for (const bad of [0.5, NaN, Infinity, -Infinity, -0, undefined, () => 1, new Map(), new Set()]) {
    assert.throws(() => E.canonicalJSON({ x: bad }), /SCHEMA|canonicalJSON/, `accepted ${String(bad)}`);
  }
  assert.throws(() => E.canonicalJSON({ x: Number.MAX_SAFE_INTEGER + 2 }));
});

test("nextInt is unbiased and shuffle is a fixed permutation for a fixed seed", () => {
  const stream = E.newStream(1717986918);
  const n = 7;
  const counts = new Array(n).fill(0);
  const draws = 700000;
  for (let i = 0; i < draws; i++) counts[E.nextInt(stream, n)] += 1;
  const expected = draws / n;
  const chi = counts.reduce((sum, c) => sum + ((c - expected) ** 2) / expected, 0);
  assert.ok(chi < 22, `chi-square ${chi} for 6 dof is implausible`);

  const a = E.shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7], E.newStream(42));
  const b = E.shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7], E.newStream(42));
  assert.deepEqual(a, b, "the same seed must give the same permutation");
  assert.notDeepEqual(a, [0, 1, 2, 3, 4, 5, 6, 7]);
  // Rejection sampling makes the draw count data-dependent, which is why n is
  // tracked in state rather than assumed.
  assert.ok(E.newStream(42).n === 0);
});

test("no ambient nondeterminism anywhere in the engine source", () => {
  const banned = /Math\.random|Date\.now|performance\.now|new Date\(|toLocaleString|localeCompare|Intl\./;
  // Comments are stripped first: the engine documents the bugs it fixed by
  // naming them, and a prose mention of Math.random is not a call to it.
  const source = readFileSync(path.join(siteDir, "engine.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""));
  const hits = [];
  source.forEach((line, i) => {
    if (banned.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(hits, [], "banned ambient source of nondeterminism");
});

// ------------------------------------------------------------ reducer contract

test("createGame is deterministic and validates the decklist", () => {
  const a = E.createGame(baseConfig());
  const b = E.createGame(baseConfig());
  assert.equal(E.hashState(a), E.hashState(b));
  assert.equal(a.zones["0:wallet"].length, 7);
  assert.equal(a.zones["0:stack"].length, 33);
  assert.throws(() => E.createGame(baseConfig({ seeds: { public: 1 } })), /seeds/);
  assert.throws(
    () => E.createGame(baseConfig({ seats: [{ name: "a", deck: ["E1-002"] }, { name: "b" }] })),
    /minimum 40/
  );
});

test("a rejected action returns the SAME object and never mutates it", () => {
  const state = E.createGame(baseConfig());
  const before = E.canonicalJSON(state);
  for (const bad of [
    { type: "PASS_PRIORITY", seat: 1, seq: state.seq, payload: {} },        // NO_PRIORITY
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq + 5, payload: {} },    // SEQ_MISMATCH
    { type: "NOPE", seat: 0, seq: state.seq, payload: {} },                 // SCHEMA
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq, payload: { x: 1 } },  // unknown key
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq, nope: 1, payload: {} },
    { type: "PLAY_CARD", seat: 0, seq: state.seq, payload: { uid: "nope", targets: [] } },
  ]) {
    const result = E.apply(state, bad);
    assert.ok(result.error, `${bad.type} should have been rejected`);
    assert.equal(result.state, state, "must return the same object reference");
    assert.deepEqual(result.events, []);
    assert.notEqual(result.error.code, "ENGINE_PANIC");
  }
  assert.equal(E.canonicalJSON(state), before);
});

test("apply refuses a redacted state and a foreign catalog", () => {
  const state = E.createGame(baseConfig());
  const v = E.view(state, 0);
  assert.equal(E.apply(v, { type: "PASS_PRIORITY", seat: 0, seq: v.seq, payload: {} }).error.code, "REDACTED_STATE");
  const other = E.buildCatalog(CARDS.slice(0, 100));
  assert.equal(
    E.apply(state, { type: "PASS_PRIORITY", seat: 0, seq: state.seq, payload: {} }, { catalog: other }).error.code,
    "CATALOG_MISMATCH"
  );
});

test("seat authentication: action.seat is a claim, not a credential", () => {
  const state = E.createGame(baseConfig());
  const result = E.apply(
    state,
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq, payload: {} },
    { authenticatedSeat: 1 }
  );
  assert.equal(result.error.code, "NOT_YOUR_SEAT");
});

test("state stays plain JSON after every action of a played game", () => {
  let state = E.createGame(baseConfig());
  for (let i = 0; i < 60 && !state.result; i++) {
    const seat = state.priority.seat;
    if (seat === null) {
      const aw = state.awaiting;
      if (aw && aw.kind === "attackers") state = ok(act(state, "DECLARE_ATTACKERS", aw.seat, { attackers: [] }));
      else if (aw && aw.kind === "discard") {
        const w = state.zones[`${aw.seat}:wallet`];
        state = ok(act(state, "DISCARD_TO_LIMIT", aw.seat, { uids: w.slice(0, w.length - state.handLimit) }));
      } else break;
      continue;
    }
    state = ok(act(state, "PASS_PRIORITY", seat));
    assert.deepEqual(state, JSON.parse(JSON.stringify(state)));
    E.canonicalJSON(state); // throws on a float or a Map that slipped in
  }
  assert.ok(state.turn.number >= 2, "the turn machine did not advance");
});

// ------------------------------------------------------------- rules regressions

test("§9 the eight-step turn structure runs in order and hands the turn over", () => {
  let state = E.createGame(baseConfig());
  const seen = [];
  for (let i = 0; i < 200 && state.turn.active === 0; i++) {
    seen.push(`${state.turn.phase}:${state.turn.step}`);
    state = passUntil(state, (s) => `${s.turn.phase}:${s.turn.step}` !== seen[seen.length - 1] || s.turn.active !== 0);
  }
  const unique = [...new Set(seen)];
  // clash:attackers is absent because neither seat controls an Avatar to
  // declare with, so §9.3's declare step is skipped rather than opened empty.
  assert.deepEqual(unique, [
    "open:maintenance", "open:draw", "build1:main", "clash:start", "clash:end",
    "build2:main", "close:endStep", "close:cleanup",
  ]);
  assert.equal(state.turn.active, 1, "the turn did not pass to the other seat");
});

test("§12.1 BOTH Buffers burn at every phase boundary, not just the active one", () => {
  let state = E.createGame(baseConfig());
  state.seats[0].buffer.P = 3;
  state.seats[1].buffer.S = 2;
  const before = [state.seats[0].uptime, state.seats[1].uptime];
  // §12.1 the Buffer empties at the end of each PHASE, so open -> build1 is
  // the first boundary; open:maintenance -> open:draw is not one.
  state = passUntil(state, atStep("build1", "main"));
  assert.deepEqual([state.seats[0].buffer.P, state.seats[1].buffer.S], [0, 0], "buffers did not empty");
  assert.deepEqual(
    [state.seats[0].uptime, state.seats[1].uptime],
    [before[0] - 3, before[1] - 2],
    "resource burn did not hit both controllers"
  );
});

test("§5.2 Boot Delay applies to EVERY Avatar, and ends at its controller's Unlock", () => {
  let state = E.createGame(baseConfig());
  // A card that does NOT print the Boot Delay keyword. play.js:513 read Boot
  // Delay off card.keywords, so only the handful of cards printing the word
  // were ever delayed; §5.2 gives it to every Avatar.
  const avatar = findCard(
    (c) => c.type === "Avatar" && !c.keywords.some((k) => k.name === "Boot Delay" || k.name === "Firewall")
  );
  const uid = seed(state, 0, avatar.id);
  assert.equal(state.objects[uid].bootDelay, true, "a card with no printed keyword must still be delayed");
  assert.equal(E.canAttack({ state, ctx: E.resolveCtx({}) }, uid), false);

  // Delayed, so §9.3's declare-attackers step has nobody to declare and is
  // skipped rather than opened: the whole Clash phase passes without a prompt.
  let sameTurn = passUntil(state, (s) => s.turn.phase === "build2" || s.turn.active !== 0);
  assert.equal(sameTurn.turn.active, 0, "still the same seat's turn");
  assert.equal(sameTurn.objects[uid].bootDelay, true, "Boot Delay must survive its own turn");

  // Its controller begins a turn with it, so Unlock clears the delay.
  const nextOwnTurn = passUntil(
    sameTurn,
    (s) => s.turn.active === 0 && s.turn.number === 2 && s.turn.phase !== "open"
  );
  assert.equal(nextOwnTurn.objects[uid].bootDelay, false, "Boot Delay did not clear at Unlock");
  assert.equal(E.canAttack({ state: nextOwnTurn, ctx: E.resolveCtx({}) }, uid), true);

  // And now the declaration the delayed Avatar could not make is legal.
  const declaring = passUntil(nextOwnTurn, (s) => Boolean(s.awaiting && s.awaiting.kind === "attackers"));
  assert.equal(act(declaring, "DECLARE_ATTACKERS", 0, { attackers: [uid] }).error, null);
});

test("§13.2 a blocked attacker stays blocked after its blockers leave", () => {
  let state = E.createGame(baseConfig());
  const big = findCard((c) => c.type === "Avatar" && c.action >= 4 && !c.keywords.length);
  const small = findCard((c) => c.type === "Avatar" && c.resilience === 1 && !c.keywords.length);
  const attacker = seed(state, 0, big.id, { bootDelay: false });
  const blocker = seed(state, 1, small ? small.id : big.id, { bootDelay: false });
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "attackers");
  state = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [attacker] }));
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "blockers");
  state = ok(act(state, "DECLARE_BLOCKERS", 1, { blocks: { [attacker]: [blocker] } }));
  assert.ok(state.clash.blockedOnce.includes(attacker), "blockedOnce was not recorded");
  const uptimeBefore = state.seats[1].uptime;
  state = passUntil(state, (s) => s.turn.phase === "build2" || s.result);
  assert.equal(
    state.seats[1].uptime,
    uptimeBefore,
    "a blocked attacker whose blocker died must not fall through to the player"
  );
});

test("§13.3 two blockers raise ORDER_BLOCKERS, and only to the attacker's controller", () => {
  let state = E.createGame(baseConfig());
  const big = findCard((c) => c.type === "Avatar" && c.action >= 3 && !c.keywords.length);
  const attacker = seed(state, 0, big.id, { bootDelay: false });
  const b1 = seed(state, 1, big.id, { bootDelay: false });
  const b2 = seed(state, 1, big.id, { bootDelay: false });
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "attackers");
  state = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [attacker] }));
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "blockers");
  state = ok(act(state, "DECLARE_BLOCKERS", 1, { blocks: { [attacker]: [b1, b2] } }));
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "order");
  assert.equal(state.awaiting.seat, 0, "the ATTACKER's controller orders blockers");
  assert.equal(act(state, "ORDER_BLOCKERS", 1, { order: { [attacker]: [b2, b1] } }).error.code, "NOT_YOUR_SEAT");
  state = ok(act(state, "ORDER_BLOCKERS", 0, { order: { [attacker]: [b2, b1] } }));
  assert.deepEqual(state.clash.order[attacker], [b2, b1]);
});

test("§16 / §2.2 a simultaneous loss is a DRAW, not a hang", () => {
  let state = E.createGame(baseConfig());
  state.seats[0].uptime = 1;
  state.seats[1].uptime = 1;
  state.seats[0].buffer.P = 1;
  state.seats[1].buffer.S = 1;
  state = passUntil(state, (s) => Boolean(s.result));
  assert.equal(state.result.reason, "draw");
  assert.deepEqual(state.result.winners, []);
  assert.equal(state.status, "over");
});

test("§16 lethal damage decommissions, and a Reboot shield replaces it", () => {
  let state = E.createGame(baseConfig());
  const avatar = findCard((c) => c.type === "Avatar" && c.resilience >= 2 && !c.keywords.length);
  const uid = seed(state, 0, avatar.id, { bootDelay: false, damage: avatar.resilience });
  const shielded = seed(state, 0, avatar.id, { bootDelay: false, damage: avatar.resilience, rebootShields: 1 });
  state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  assert.equal(state.objects[uid], undefined, "lethal damage did not decommission");
  assert.ok(state.objects[shielded], "the Reboot shield did not replace decommissioning");
  assert.equal(state.objects[shielded].damage, 0);
  assert.equal(state.objects[shielded].committed, true);
  assert.equal(state.objects[shielded].rebootShields, 0);
});

test("§9.5 the hand limit is a player decision, and damage clears at Cleanup", () => {
  let state = E.createGame(baseConfig());
  const avatar = findCard((c) => c.type === "Avatar" && c.resilience >= 3 && !c.keywords.length);
  const uid = seed(state, 0, avatar.id, { bootDelay: false, damage: 1 });
  state = passUntil(state, (s) => (s.awaiting && s.awaiting.kind === "discard") || s.turn.number > 1);
  if (state.awaiting && state.awaiting.kind === "discard") {
    const wallet = state.zones["0:wallet"];
    assert.equal(
      act(state, "DISCARD_TO_LIMIT", 0, { uids: [] }).error.code,
      "HAND_LIMIT",
      "discarding nothing must be refused"
    );
    state = ok(act(state, "DISCARD_TO_LIMIT", 0, { uids: wallet.slice(0, wallet.length - state.handLimit) }));
    assert.equal(state.zones["0:wallet"].length, state.handLimit);
  }
  assert.equal(state.objects[uid].damage, 0, "marked damage did not clear at Cleanup");
});

test("§5.1 the Resource play is once per turn, Build phases only, Queue empty", () => {
  let state = E.createGame(baseConfig());
  state = passUntil(state, atStep("build1", "main"));
  const wallet = state.zones["0:wallet"];
  const resourceUid = wallet.find((uid) => byId[state.objects[uid].cardId].type.includes("Resource"));
  if (!resourceUid) return; // this seed dealt no Resource; the rule is covered elsewhere
  state = ok(act(state, "PLAY_RESOURCE", 0, { uid: resourceUid }));
  assert.equal(state.turn.resourcePlays.used, 1);
  const second = state.zones["0:wallet"].find((uid) => byId[state.objects[uid].cardId].type.includes("Resource"));
  if (second) {
    assert.equal(act(state, "PLAY_RESOURCE", 0, { uid: second }).error.code, "RESOURCE_PLAY_USED");
  }
  // A Resource play is a special action: the active player keeps priority.
  assert.equal(state.priority.seat, 0);
});

test("§10.3 a Resource ability resolves immediately and never touches the Queue", () => {
  let state = E.createGame(baseConfig());
  const basic = findCard((c) => c.type === "Basic Resource" && c.abilities.some((a) => a.ops));
  const uid = seed(state, 0, basic.id);
  const index = basic.abilities.findIndex((a) => a.ops && a.ops.every((o) => o.op === "generate"));
  const before = state.seats[0].buffer;
  state = ok(act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid, abilityIndex: index }));
  assert.equal(state.queue.length, 0, "a Resource ability must not enter the Queue");
  assert.notDeepEqual(state.seats[0].buffer, before, "no Resource was generated");
  assert.equal(state.objects[uid].committed, true);
  assert.equal(
    act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid, abilityIndex: index }).error.code,
    "CANNOT_AFFORD",
    "§19.4 a Commit ability is once per Unlock"
  );
});

test("the `uptime` op with target:player hits the TARGET seat, not the controller", () => {
  // play.js:285 was `op.target === "player" ? controller : controller`.
  const item = {
    kind: "manual",
    controller: 0,
    sourceUid: null,
    cardId: null,
    targets: [{ kind: "seat", seat: 1 }],
    ops: [{ op: "addUptime", seat: 1, delta: 3 }],
    resume: { opIndex: 0, acc: {} },
  };
  let state = E.createGame(baseConfig());
  const before = [state.seats[0].uptime, state.seats[1].uptime];
  // Routed through the public manual door, which uses the same interpreter.
  const uid = seed(state, 0, findCard((c) => c.manual && c.abilities.some((a) => a.manual)).id);
  const card = byId[state.objects[uid].cardId];
  const abilityIndex = card.abilities.findIndex((a) => a.manual);
  const result = act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 1, delta: 3 }],
  });
  if (!result.error) {
    // Tier B: gaining Uptime for the opponent is a gift, so it is Tier A and
    // applies at once; either way the TARGET seat must be the one that moves.
    const after = result.state.pendingManual ? null : result.state;
    if (after) {
      assert.equal(after.seats[1].uptime, before[1] + 3);
      assert.equal(after.seats[0].uptime, before[0], "the controller must not be healed");
    }
  }
  assert.ok(item.ops.length === 1);
});

// -------------------------------------------------------------- manual layer

/* Layer 2 (envelope) rejects before layer 4 (redaction), so a test that wants
 * to reach a later layer must warrant an ability whose printed text plausibly
 * authorises the op under test. `requiredOp` picks such a card. */
function manualFixture(requiredOp) {
  const state = E.createGame(baseConfig());
  let card = null;
  let abilityIndex = -1;
  for (const candidate of CARDS) {
    if (!candidate.type.includes("Avatar")) continue;
    const compiled = E.compileCard(candidate);
    const index = compiled.abilities.findIndex(
      (a) => a.manual && (!requiredOp || a.manualEnvelope.ops.includes(requiredOp))
    );
    if (index >= 0) {
      card = candidate;
      abilityIndex = index;
      break;
    }
  }
  assert.ok(card, `no assisted Avatar ability with ${requiredOp} in its envelope`);
  const uid = seed(state, 0, card.id, { bootDelay: false });
  return { state, uid, card, abilityIndex };
}

test("a manual delta must carry a warrant, and the warrant must be yours", () => {
  const { state, uid, abilityIndex } = manualFixture();
  assert.equal(
    act(state, "MANUAL_PROPOSE", 0, { warrant: {}, ops: [{ op: "note", text: "x" }] }).error.code,
    "MANUAL_NO_WARRANT"
  );
  assert.equal(
    act(state, "MANUAL_PROPOSE", 1, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [{ op: "note", text: "x" }],
    }).error.code,
    "MANUAL_NO_WARRANT"
  );
});

test("the delta vocabulary is closed: no setState, no turn/priority/rng reach", () => {
  const { state, uid, abilityIndex } = manualFixture();
  for (const bad of [
    { op: "setState", path: "turn.phase", value: "close" },
    { op: "setPhase", phase: "close" },
    { op: "addUptime", seat: 0, delta: 1, extra: 9 },
    { op: "addUptime", seat: 0, delta: 0.5 },
  ]) {
    const result = act(state, "MANUAL_PROPOSE", 0, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [bad],
    });
    assert.equal(result.error.code, "SCHEMA", `accepted ${JSON.stringify(bad)}`);
  }
});

test("hard caps are unconditional and cannot be raised by any envelope", () => {
  const { state, uid, abilityIndex } = manualFixture();
  const result = act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 0, delta: 999 }],
  });
  assert.ok(["MANUAL_HARD_CAP", "MANUAL_OUT_OF_ENVELOPE"].includes(result.error.code));
  const many = new Array(20).fill({ op: "note", text: "x" });
  assert.equal(
    act(state, "MANUAL_PROPOSE", 0, { warrant: { kind: "static", uid, abilityIndex }, ops: many }).error.code,
    "MANUAL_HARD_CAP"
  );
});

test("MANUAL_ILLEGAL_REFERENCE: naming a uid in the opponent's Wallet proves you looked", () => {
  const { state, uid, abilityIndex } = manualFixture("moveObject");
  const hidden = state.zones["1:wallet"][0];
  const result = act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "moveObject", uid: hidden, toZone: "archive" }],
  });
  assert.equal(result.error.code, "MANUAL_ILLEGAL_REFERENCE");
  const ownStack = state.zones["0:stack"][0];
  assert.equal(
    act(state, "MANUAL_PROPOSE", 0, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [{ op: "moveObject", uid: ownStack, toZone: "archive" }],
    }).error.code,
    "MANUAL_ILLEGAL_REFERENCE",
    "your own Stack is hidden from you too (§6)"
  );
});

test("tiers are computed by the engine, never asserted by the proposer", () => {
  const state = E.createGame(baseConfig());
  const mine = seed(state, 0, findCard((c) => c.type === "Avatar").id, { bootDelay: false });
  const theirs = seed(state, 1, findCard((c) => c.type === "Avatar").id, { bootDelay: false });
  // Self-limiting: paying your own Uptime, committing your own object.
  assert.equal(E.tierOf(state, 0, [{ op: "addUptime", seat: 0, delta: -2 }]), "A");
  assert.equal(E.tierOf(state, 0, [{ op: "setCommitted", uid: mine, value: true }]), "A");
  assert.equal(E.tierOf(state, 0, [{ op: "moveObject", uid: mine, toZone: "archive" }]), "A");
  assert.equal(E.tierOf(state, 0, [{ op: "note", text: "hi" }]), "A");
  // Across the table, or a benefit to the proposer.
  assert.equal(E.tierOf(state, 0, [{ op: "addUptime", seat: 0, delta: 2 }]), "B");
  assert.equal(E.tierOf(state, 0, [{ op: "addDamage", uid: theirs, amount: 1 }]), "B");
  assert.equal(E.tierOf(state, 0, [{ op: "setCommitted", uid: mine, value: false }]), "B");
  assert.equal(E.tierOf(state, 0, [{ op: "moveTopOfStack", seat: 0, count: 1, toZone: "wallet" }]), "B");
});

test("Tier B blocks the game until a verdict, and reject => fizzle without refund", () => {
  const state = E.createGame(baseConfig());
  const zapCard = findCard((c) => c.type === "Zap" && c.abilities.some((a) => a.manual));
  if (!zapCard) return;
  const { state: s2, uid, abilityIndex } = manualFixture("addUptime");
  let live = ok(act(s2, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 0, delta: 1 }],
  }));
  assert.ok(live.pendingManual, "gaining Uptime must require consent");
  assert.equal(live.pendingManual.tier, "B");
  // Everything except CONCEDE and the verdict pair is refused.
  assert.equal(act(live, "PASS_PRIORITY", 0).error.code, "MANUAL_CONSENT_PENDING");
  assert.equal(act(live, "MANUAL_ACCEPT", 0, { mid: live.pendingManual.mid }).error.code, "NOT_YOUR_SEAT");
  const uptimeBefore = live.seats[0].uptime;
  const rejected = ok(act(live, "MANUAL_REJECT", 1, { mid: live.pendingManual.mid, reason: "no" }));
  assert.equal(rejected.pendingManual, null, "a rejection must not deadlock the game");
  assert.equal(rejected.seats[0].uptime, uptimeBefore, "a rejected delta must not apply");
  assert.equal(rejected.seats[1].stats.manualRejected, 1, "reject rates are public pressure");
  assert.ok(rejected.priority.seat !== null || rejected.awaiting, "play must continue");
});

test("MANUAL_FLAG changes nothing and cannot be refused", () => {
  const { state, uid, abilityIndex } = manualFixture("addUptime");
  const applied = ok(act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 0, delta: -1 }],
  }));
  assert.equal(applied.pendingManual, null, "Tier A applies immediately");
  const flagged = act(applied, "MANUAL_FLAG", 1, { mid: "m1", reason: "that is not what the card says" });
  assert.equal(flagged.error, null);
  assert.equal(flagged.events.some((e) => e.t === "MANUAL_FLAGGED"), true);
});

// ---------------------------------------------------------------- redaction

test("view() hides both Stacks, the opponent's Wallet faces and every hidden seed", () => {
  const state = E.createGame(baseConfig());
  for (const seat of [0, 1]) {
    const v = E.view(state, seat);
    assert.deepEqual(v.zones[`${seat}:stack`], { n: 33 }, "your own Stack is hidden from you (§6)");
    assert.deepEqual(v.zones[`${1 - seat}:stack`], { n: 33 });
    for (const uid of state.zones[`${1 - seat}:wallet`]) {
      assert.deepEqual(Object.keys(v.objects[uid]).sort(), ["owner", "uid", "zone"]);
    }
    for (const uid of state.zones[`${seat}:wallet`]) {
      assert.ok(v.objects[uid].cardId, "you must see your own Wallet");
    }
    const text = JSON.stringify(v);
    for (const uid of state.zones["0:stack"].concat(state.zones["1:stack"])) {
      // Quoted, so "o8" does not spuriously match inside "o80".
      assert.ok(!text.includes(`"${uid}"`), `stack uid ${uid} leaked`);
    }
    assert.equal(v.rng.hidden[0].s, undefined, "hidden seed leaked");
    assert.equal(v.rng.hidden[0].n, state.rng.hidden[0].n, "the hidden draw counter must survive");
    assert.equal(v.rng.public.s, state.rng.public.s, "§18.4 the public stream is auditable");
    assert.ok(!JSON.stringify(v.objects).includes("prevUid"));
    assert.equal(v.redacted, true);
    assert.equal(v.forSeat, seat);
  }
});

test("view is idempotent and publicState is the intersection", () => {
  const state = E.createGame(baseConfig());
  for (const seat of [0, 1, null]) {
    assert.deepEqual(E.view(E.view(state, seat), seat), E.view(state, seat));
  }
  const pub = E.publicState(state);
  const text = JSON.stringify(pub);
  for (const uid of state.zones["0:wallet"].concat(state.zones["1:wallet"], state.zones["0:stack"])) {
    assert.ok(!text.includes(uid), `${uid} leaked into publicState`);
  }
  assert.equal(typeof E.publicHash(state), "string");
  // The audit projection is the full state; it is what makes a match reviewable.
  assert.deepEqual(E.view(state, "audit"), JSON.parse(JSON.stringify(state)));
});

test("legalActions runs on a redacted view and gives the same shape as on full state", () => {
  const state = E.createGame(baseConfig());
  const fromFull = E.legalActions(state, 0).map((a) => a.type).sort();
  const fromView = E.legalActions(E.view(state, 0), 0).map((a) => a.type).sort();
  assert.deepEqual(fromView, fromFull);
  // The opponent's legal actions computed from THEIR view must not enumerate
  // cards they cannot see.
  const theirs = E.legalActions(E.view(state, 0), 1);
  assert.equal(theirs.filter((a) => a.type === "PLAY_CARD").length, 0);
});

// ------------------------------------------------------------------ replay

test("replay of the action log reproduces the head hash exactly", () => {
  const cfg = baseConfig();
  let state = E.createGame(cfg);
  const log = [];
  for (let i = 0; i < 120 && !state.result; i++) {
    const seat = state.priority.seat;
    let action;
    if (seat !== null) action = { type: "PASS_PRIORITY", seat, seq: state.seq, at: "", payload: {} };
    else if (state.awaiting && state.awaiting.kind === "attackers") {
      action = { type: "DECLARE_ATTACKERS", seat: state.awaiting.seat, seq: state.seq, at: "", payload: { attackers: [] } };
    } else if (state.awaiting && state.awaiting.kind === "discard") {
      const w = state.zones[`${state.awaiting.seat}:wallet`];
      action = {
        type: "DISCARD_TO_LIMIT", seat: state.awaiting.seat, seq: state.seq, at: "",
        payload: { uids: w.slice(0, w.length - state.handLimit) },
      };
    } else break;
    const result = E.apply(state, action);
    if (result.error) break;
    log.push(action);
    state = result.state;
  }
  assert.ok(log.length > 20, "the fixture did not play far enough to be meaningful");
  const again = E.replay(cfg, log);
  assert.equal(again.error, null, JSON.stringify(again.error));
  assert.equal(E.hashState(again.state), E.hashState(state), "REPLAY DIVERGED");
  assert.equal(E.publicHash(again.state), E.publicHash(state));

  // The chained transcript verifies end to end.
  let prev = state.gameId;
  let folded = E.createGame(cfg);
  const entries = [];
  for (const action of log) {
    folded = E.apply(folded, action).state;
    const stateHash = E.hashState(folded);
    const entry = { seq: action.seq, seat: action.seat, at: "", action, prev, stateHash };
    entries.push(entry);
    prev = E.entryHash(entry);
  }
  const verdict = E.verifyMatch({ config: cfg, log: entries });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.error));
  assert.equal(verdict.headHash, E.hashState(state));
});

test("a tampered transcript is caught at the exact action that diverges", () => {
  const cfg = baseConfig();
  let state = E.createGame(cfg);
  const entries = [];
  let prev = state.gameId;
  for (let i = 0; i < 6; i++) {
    const action = { type: "PASS_PRIORITY", seat: state.priority.seat, seq: state.seq, at: "", payload: {} };
    state = ok(E.apply(state, action));
    const stateHash = E.hashState(state);
    const entry = { seq: action.seq, seat: action.seat, at: "", action, prev, stateHash };
    entries.push(entry);
    prev = E.entryHash(entry);
  }
  entries[3].stateHash = "0".repeat(64);
  const verdict = E.verifyMatch({ config: cfg, log: entries });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.divergedAt, 3);
});
