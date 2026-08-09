/* The trigger system — the produce side of §10.4, which simply did not exist
 * before: pendingTriggers was initialised, ordered and consumed, and nothing
 * ever filled it. These tests drive REAL Edition One cards through the real
 * queue, so a passing test here is a card that actually plays itself. */
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

const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const byName = Object.fromEntries(CARDS.map((c) => [c.name, c]));

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seed = 90210) {
  let attempt = seed;
  for (let i = 0; i < 40; i++) {
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

/* Fixture: place a card directly, the way engine.test.mjs seeds rules cases. */
function seed(state, seat, cardId, tweaks, zone) {
  const where = zone || "network";
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid,
      cardId,
      owner: seat,
      controller: seat,
      zone: `${seat}:${where}`,
      committed: false,
      bootDelay: false,
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
  state.zones[`${seat}:${where}`].push(uid);
  return uid;
}

/* Pass priority (answering declarations with defaults) until `stop`. */
function passUntil(state, stop, limit = 500) {
  for (let i = 0; i < limit; i++) {
    if (stop(state) || state.result) return state;
    const seat = state.priority.seat;
    if (seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", seat));
      continue;
    }
    const aw = state.awaiting;
    if (!aw) throw new Error("stuck with neither priority nor a declaration");
    if (aw.kind === "attackers") state = ok(act(state, "DECLARE_ATTACKERS", aw.seat, { attackers: [] }));
    else if (aw.kind === "blockers") state = ok(act(state, "DECLARE_BLOCKERS", aw.seat, { blocks: {} }));
    else if (aw.kind === "damage") state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", aw.seat, { assignment: null }));
    else if (aw.kind === "discard") {
      const wallet = state.zones[`${aw.seat}:wallet`];
      const over = wallet.length - state.handLimit;
      state = ok(act(state, "DISCARD_TO_LIMIT", aw.seat, { uids: wallet.slice(0, Math.max(0, over)) }));
    } else if (aw.kind === "triggers") {
      const waiting = state.pendingTriggers[String(aw.seat)];
      state = ok(act(state, "ORDER_TRIGGERS", aw.seat, { qids: waiting.map((t) => t.pendingId) }));
    } else if (aw.kind === "order") {
      const order = {};
      for (const key of Object.keys(state.clash.blocks)) order[key] = state.clash.blocks[key].slice();
      state = ok(act(state, "ORDER_BLOCKERS", aw.seat, { order }));
    } else throw new Error(`unhandled awaiting ${aw.kind}`);
  }
  throw new Error("limit reached before the stop condition");
}

// --------------------------------------------------------------- compile

test("the trigger families compile as scripted, not assisted", () => {
  for (const name of [
    "Uptime Clock",
    "Entry Fee Device",
    "Resource Exit Sensor",
    "Resource Tap",
    "BK, Feedback Grower",
    "Hot Grid",
    "Gadaj, Wallet Whisperer",
  ]) {
    const card = byName[name];
    assert.ok(card, `${name} exists`);
    const triggered = card.abilities.find((a) => a.kind === "triggered");
    assert.ok(triggered, `${name} has a triggered ability`);
    assert.equal(triggered.manual, false, `${name} is scripted`);
    assert.ok(triggered.trigger, `${name} carries a compiled condition`);
  }
});

// --------------------------------------------------------------- runtime

test("Uptime Clock ticks at the beginning of each player's Maintenance", () => {
  let state = game();
  seed(state, 0, byName["Uptime Clock"].id);
  const before = [state.seats[0].uptime, state.seats[1].uptime];
  // The clock was seeded after turn 1's maintenance; end the turn and let it
  // tick on seat 1's maintenance, then again on seat 0's next one.
  state = passUntil(state, (s) => s.turn.number === 2 && s.seats[1].uptime < before[1]);
  assert.equal(state.seats[1].uptime, before[1] - 1, "seat 1 was damaged on their maintenance");
  state = passUntil(state, (s) => s.turn.number === 3 && s.seats[0].uptime < before[0]);
  assert.equal(state.seats[0].uptime, before[0] - 1, "seat 0 was damaged on theirs");
});

test("Entry Fee Device charges a Resource's controller when it enters", () => {
  let state = game();
  seed(state, 0, byName["Entry Fee Device"].id);
  const orchard = seed(state, 1, byName["Satoshi Orchard"].id, {}, "wallet");
  const before = state.seats[1].uptime;
  // Advance to seat 1's build phase and play the resource.
  state = passUntil(state, (s) => s.turn.active === 1 && s.turn.phase === "build1" && s.priority.seat === 1);
  state = ok(act(state, "PLAY_RESOURCE", 1, { uid: orchard }));
  state = passUntil(state, (s) => s.seats[1].uptime < before);
  assert.equal(state.seats[1].uptime, before - 2);
});

test("Resource Tap pays out when an opponent commits a Bitcoin Resource", () => {
  let state = game();
  seed(state, 0, byName["Resource Tap"].id);
  const orchard = seed(state, 1, byName["Satoshi Orchard"].id);
  const before = state.seats[0].uptime;
  state = passUntil(state, (s) => s.priority.seat === 1);
  state = ok(act(state, "ACTIVATE_RESOURCE_ABILITY", 1, { uid: orchard, abilityIndex: 0 }));
  state = passUntil(state, (s) => s.seats[0].uptime > before);
  assert.equal(state.seats[0].uptime, before + 1);
});

test("BK, Feedback Grower grows a +1/+1 marker when damaged", () => {
  let state = game();
  const bk = seed(state, 0, byName["BK, Feedback Grower"].id);
  const injector = seed(state, 1, byName["Fault Injector"].id);
  const base = E.statsOf(state, E.resolveCtx({}), bk);
  state = passUntil(state, (s) => s.priority.seat === 1);
  state.seats[1].buffer.N = 3; // after passUntil — phase boundaries burn Buffers
  state = ok(
    act(state, "ACTIVATE_ABILITY", 1, {
      uid: injector,
      abilityIndex: 0,
      targets: [{ kind: "object", uid: bk }],
    })
  );
  state = passUntil(state, (s) => (s.objects[bk].counters["+1/+1"] || 0) > 0);
  const grown = E.statsOf(state, E.resolveCtx({}), bk);
  assert.equal(grown.action, base.action + 1, "the marker feeds Action");
  assert.equal(state.objects[bk].damage, 1, "the damage that caused it is marked");
});

test("a trigger whose source died raising it fizzles - it must not wedge the pass", () => {
  /* The full-game soak found this as an unbreakable stall: lethal damage
   * decommissions Feedback Grower AND stages its "grow a marker" trigger.
   * The zone change mints a new uid, so at resolution the bound op points
   * at nothing - and rejecting that PASS_PRIORITY froze the whole match. */
  let state = game();
  const bk = seed(state, 0, byName["BK, Feedback Grower"].id);
  const injector = seed(state, 1, byName["Fault Injector"].id);
  const res = E.statsOf(state, E.resolveCtx({}), bk).resilience;
  state = passUntil(state, (s) => s.priority.seat === 1);
  state.seats[1].buffer.N = 3;
  state.objects[bk].damage = res - 1; // the injector's point is lethal
  state = ok(
    act(state, "ACTIVATE_ABILITY", 1, {
      uid: injector,
      abilityIndex: 0,
      targets: [{ kind: "object", uid: bk }],
    })
  );
  // Passing here used to die of UNKNOWN_OBJECT once the orphan trigger hit
  // the top of the Queue. passUntil passes for both seats, so reaching the
  // empty Queue IS the regression assertion.
  state = passUntil(state, (s) => !s.queue.length && !s.objects[bk]);
  assert.ok(!state.objects[bk], "the Grower was decommissioned");
  assert.equal(state.queue.length, 0, "the orphan trigger resolved off the Queue");
  assert.equal(state.result, null, "the match is still alive");
});

test("compound damage: Bam, Power Artillery hits the target and its own player", () => {
  let state = game();
  const bam = seed(state, 0, byName["Bam, Power Artillery"].id);
  const you = state.seats[0].uptime;
  const them = state.seats[1].uptime;
  state = passUntil(state, (s) => s.priority.seat === 0);
  state = ok(
    act(state, "ACTIVATE_ABILITY", 0, {
      uid: bam,
      abilityIndex: 0,
      targets: [{ kind: "seat", seat: 1 }],
    })
  );
  state = passUntil(state, (s) => s.seats[1].uptime < them);
  assert.equal(state.seats[1].uptime, them - 2, "2 to the chosen target");
  assert.equal(state.seats[0].uptime, you - 3, "3 to Bam's own player");
});

test("a junction's scripted choice is restricted to the affinities it names", () => {
  let state = game();
  const junction = seed(state, 0, byName["Power–Bitcoin Junction"].id);
  state = passUntil(state, (s) => s.priority.seat === 0);
  const cheat = act(state, "ACTIVATE_RESOURCE_ABILITY", 0, {
    uid: junction,
    abilityIndex: 0,
    choice: "K",
  });
  assert.equal(cheat.error && cheat.error.code, "BAD_CHOICE", "Keys is not offered");
  state = ok(act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid: junction, abilityIndex: 0, choice: "P" }));
  assert.equal(state.seats[0].buffer.P, 1);
  assert.equal(state.objects[junction].committed, true, "commit was the cost");
});

test("self keyword grant expires with the turn", () => {
  let state = game();
  const toni = seed(state, 0, byName["Toni China, Hot-Air Relay"].id);
  state = passUntil(state, (s) => s.priority.seat === 0);
  state.seats[0].buffer.P = 1; // after passUntil — phase boundaries burn Buffers
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: toni, abilityIndex: 0, targets: [] }));
  state = passUntil(state, (s) => E.keywordsOf(s, E.resolveCtx({}), toni).indexOf("Broadcast") >= 0);
  assert.ok(E.keywordsOf(state, E.resolveCtx({}), toni).indexOf("Broadcast") >= 0);
  const thisTurn = state.turn.number;
  state = passUntil(state, (s) => s.turn.number > thisTurn);
  assert.equal(
    E.keywordsOf(state, E.resolveCtx({}), toni).indexOf("Broadcast"),
    -1,
    "the grant died at end of turn"
  );
});
