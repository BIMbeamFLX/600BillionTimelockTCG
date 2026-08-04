/* Wave 2: optional costs. "You may pay X. If you do, …" and "… unless you
 * pay X." — every branch is driven through the real queue with real cards,
 * and a bot-vs-bot soak proves the new choices never deadlock a game. */
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
const byName = Object.fromEntries(CARDS.map((c) => [c.name, c]));
const COMPILED = {};
const compiled = (id) => COMPILED[id] || (COMPILED[id] = E.compileCard(byId[id]));

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seed = 313370) {
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

function passUntil(state, stop, limit = 600) {
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

const chooseIndex = (state, seat, index) => {
  const choice = state.pendingChoice;
  return ok(act(state, "CHOOSE", seat, { choiceId: choice.id, selection: [index] }));
};

// --------------------------------------------------------------- compile

test("the optional-cost families compile as scripted", () => {
  for (const name of [
    "Timelock Receiver",
    "Power Receiver",
    "Signal Receiver",
    "Keys Receiver",
    "Bitcoin Receiver",
    "Archive Listener",
    "Snick, Phantom Process",
    "Consensus Pause",
    "Arbadacarba, Natural Hashrate",
  ]) {
    const card = byName[name];
    assert.ok(card, `${name} exists`);
    const triggered = card.abilities.find((a) => a.kind === "triggered");
    assert.ok(triggered && !triggered.manual, `${name} trigger is scripted`);
    assert.equal(triggered.ops[0].op, "mayPay", `${name} compiles to mayPay`);
  }
});

// --------------------------------------------------------------- runtime

/* Drive a Timelock Receiver moment: seat 0 owns the Receiver, seat 1 plays a
 * Timelock Zap. Returns {state, before} at the pay/decline choice. */
function receiverMoment() {
  let state = game();
  seed(state, 0, byName["Timelock Receiver"].id);
  const zap = CARDS.find(
    (c) =>
      c.type === "Zap" &&
      (c.affinity || []).includes("Timelock") &&
      c.costParsed &&
      !c.costParsed.x &&
      compiled(c.id).playTargetSpec.length === 0
  );
  assert.ok(zap, "a Timelock Zap exists");
  const uid = seed(state, 1, zap.id, {}, "wallet");
  state = passUntil(state, (s) => s.priority.seat === 1);
  state.seats[1].buffer.T = 9;
  state.seats[1].buffer.N = 9;
  state.seats[0].buffer.N = 1; // enough for the Receiver's optional 1
  const before = state.seats[0].uptime;
  state = ok(act(state, "PLAY_CARD", 1, { uid }));
  state = passUntil(state, (s) => s.pendingChoice && s.pendingChoice.kind === "mayPay");
  assert.equal(state.pendingChoice.seat, 0, "the Receiver's controller chooses");
  return { state, before };
}

test("Receiver, paid: 1 from the Buffer becomes 1 Uptime", () => {
  const { state: at, before } = receiverMoment();
  let state = chooseIndex(at, 0, 0); // options are [pay, decline]
  state = passUntil(state, (s) => s.seats[0].uptime > before);
  assert.equal(state.seats[0].uptime, before + 1);
  assert.equal(state.seats[0].buffer.N, 0, "the 1 was actually paid");
});

test("Receiver, declined: nothing happens and nothing is paid", () => {
  const { state: at, before } = receiverMoment();
  let state = chooseIndex(at, 0, 1);
  state = passUntil(state, (s) => !s.pendingChoice && !s.queue.length);
  assert.equal(state.seats[0].uptime, before, "no Uptime without payment");
  assert.equal(state.seats[0].buffer.N, 1, "the Buffer is untouched");
});

test("Receiver, broke: no choice is even raised", () => {
  let state = game();
  seed(state, 0, byName["Timelock Receiver"].id);
  const zap = CARDS.find(
    (c) =>
      c.type === "Zap" &&
      (c.affinity || []).includes("Timelock") &&
      c.costParsed &&
      !c.costParsed.x &&
      compiled(c.id).playTargetSpec.length === 0
  );
  const uid = seed(state, 1, zap.id, {}, "wallet");
  state = passUntil(state, (s) => s.priority.seat === 1);
  state.seats[1].buffer.T = 9;
  state.seats[1].buffer.N = 9;
  // seat 0 has nothing — the mayPay must resolve silently to its else branch
  const before = state.seats[0].uptime;
  state = ok(act(state, "PLAY_CARD", 1, { uid }));
  state = passUntil(state, (s) => !s.queue.length && !s.pendingChoice);
  assert.equal(state.seats[0].uptime, before);
});

test("Snick, Phantom Process: pay T and stay, or be archived", () => {
  // Paid branch.
  let state = game();
  const snick = seed(state, 0, byName["Snick, Phantom Process"].id);
  state = passUntil(
    state,
    (s) => s.turn.active === 0 && s.turn.step === "maintenance" && s.pendingTriggers["0"].length + s.queue.length > 0,
    900
  );
  state.seats[0].buffer.T = 1;
  state = passUntil(state, (s) => s.pendingChoice && s.pendingChoice.kind === "mayPay", 900);
  state = chooseIndex(state, 0, 0);
  assert.ok(state.objects[snick], "Snick survives when the T is paid");
  assert.equal(state.seats[0].buffer.T, 0);

  // Broke branch: a fresh game, no T — Snick archives itself without a choice.
  let state2 = game(424243);
  const snick2 = seed(state2, 0, byName["Snick, Phantom Process"].id);
  state2 = passUntil(
    state2,
    (s) => !s.objects[snick2] || (s.objects[snick2].zone || "").endsWith(":archive"),
    900
  );
  const gone = !state2.objects[snick2] || state2.objects[snick2].zone.endsWith(":archive");
  assert.ok(gone, "Snick archives when the cost cannot be paid");
});

// --------------------------------------------------------------- soak

test("soak: bot-vs-bot completes across seeds with the new choices in play", () => {
  for (const start of [11, 2026, 40004, 777001]) {
    let state = null;
    let attempt = start;
    for (let i = 0; i < 40 && !state; i++) {
      try {
        state = E.createGame({
          seats: [
            { name: "A", affinity: "Timelock" },
            { name: "B", affinity: "Keys" },
          ],
          seeds: { public: attempt, hidden: [attempt + 1, attempt + 2] },
          firstPlayer: 0,
        });
      } catch (error) {
        attempt = (attempt * 1103515245 + 12345) & 0x7fffffff;
      }
    }
    assert.ok(state, `seed ${start} minted`);
    let steps = 0;
    while (!state.result && steps < 4000) {
      const seat = NPC.waitingSeat(state);
      let applied = false;
      for (const move of NPC.candidates(E, state, seat, compiled, {
        affinity: seat === 0 ? "Timelock" : "Keys",
      })) {
        const result = E.apply(state, { type: move.type, seat, seq: state.seq, at: "", payload: move.payload });
        if (!result.error) {
          state = result.state;
          applied = true;
          break;
        }
      }
      assert.ok(applied, `seed ${start}: policy stalled at seq ${state.seq}, turn ${state.turn.number}`);
      steps += 1;
    }
    assert.ok(state.result, `seed ${start}: game reached a verdict (turn ${state.turn.number})`);
  }
});
