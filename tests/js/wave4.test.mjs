/* Wave 4: Attachments really attach, and the Queue can be answered.
 * Real cards, real queue, every claim asserted on engine state. */
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

const byName = Object.fromEntries(CARDS.map((c) => [c.name, c]));
const ctx = () => E.resolveCtx({});

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seed = 808808) {
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
      uid, cardId, owner: seat, controller: seat, zone: `${seat}:${where}`,
      committed: false, bootDelay: false, damage: 0, counters: {},
      attachedTo: null, rebootShields: 0, facedown: false,
      revealedTo: [], revealedUntil: null, token: false,
      entersSeq: state.seq, prevUid: null,
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
    if (!aw) throw new Error("stuck");
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
    } else throw new Error(`unhandled ${aw.kind}`);
  }
  throw new Error("limit reached");
}

/* EXACTLY the card's cost — a flooded Buffer burns at every phase boundary
 * (§12.1) and kills the seat mid-test. */
const payFor = (state, seat, cardName, extraGeneric = 0) => {
  const cost = byName[cardName].costParsed || {};
  const buffer = state.seats[seat].buffer;
  for (const key of ["P", "B", "K", "S", "T"]) buffer[key] = cost[key] || 0;
  buffer.N = (cost.generic || 0) + extraGeneric;
};

/* Move an object via the manual door — Tier A applies instantly, Tier B needs
 * the opponent's accept. */
function forceMove(state, seat, uid, toZone) {
  state = ok(
    act(state, "MANUAL_PROPOSE", seat, {
      warrant: { kind: "freeform", note: "test" },
      ops: [{ op: "moveObject", uid, toZone }],
      reason: "test",
    })
  );
  if (state.pendingManual) {
    state = ok(act(state, "MANUAL_ACCEPT", 1 - seat, { mid: state.pendingManual.mid }));
  }
  return state;
}

/* Play an attachment from the wallet onto a host and return {state, attach}. */
function attachTo(state, seat, cardName, hostUid) {
  const uid = seed(state, seat, byName[cardName].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === seat && s.turn.phase === "build1" && s.priority.seat === seat);
  payFor(state, seat, cardName);
  state = ok(act(state, "PLAY_CARD", seat, { uid, targets: [{ kind: "object", uid: hostUid }] }));
  state = passUntil(state, (s) =>
    Object.values(s.objects).some((o) => o.cardId === byName[cardName].id && o.attachedTo === hostUid)
  );
  const attach = Object.values(state.objects).find(
    (o) => o.cardId === byName[cardName].id && o.attachedTo === hostUid
  );
  return { state, attach };
}

// ---------------------------------------------------------------- compile

test("the shield no longer shields itself, and attachments target a host", () => {
  const shield = byName["Keys Shield"];
  assert.ok(!shield.keywords.some((k) => k.name === "Shielded"), "no self-shield");
  assert.ok(shield.abilities.some((a) => a.kind === "attach-static"), "grant compiled");
  assert.equal(E.compileCard(shield).playTargetSpec.length, 1, "host is the play target");
});

// ---------------------------------------------------------------- grants

test("Keys Shield: the HOST becomes Shielded from Keys, and loses it on detach", () => {
  let state = game();
  const host = seed(state, 0, byName["FLX, Culture Curator"].id);
  const played = attachTo(state, 0, "Keys Shield", host);
  state = played.state;
  assert.equal(E.shieldedFrom(state, ctx(), host), "Keys");
  // The attachment leaves — the shield leaves with it.
  const after = forceMove(state, 0, played.attach.uid, "archive");
  assert.equal(E.shieldedFrom(after, ctx(), host), null, "shield gone with the attachment");
});

test("Fast Path grants First Strike; Reduced Permissions bends the stats", () => {
  let state = game();
  const host = seed(state, 0, byName["FLX, Culture Curator"].id); // 4/4
  state = attachTo(state, 0, "Fast Path", host).state;
  assert.ok(E.keywordsOf(state, ctx(), host).includes("First Strike"));
  state = attachTo(state, 1, "Reduced Permissions", host).state;
  const stats = E.statsOf(state, ctx(), host);
  assert.equal(stats.action, 2, "4 - 2 Action");
  assert.equal(stats.resilience, 3, "4 - 1 Resilience");
});

test("an orphaned attachment archives itself when the host leaves", () => {
  let state = game();
  const host = seed(state, 0, byName["FLX, Culture Curator"].id);
  const played = attachTo(state, 0, "Fast Path", host);
  state = played.state;
  const after = forceMove(state, 0, host, "archive");
  const attach = Object.values(after.objects).find((o) => o.cardId === byName["Fast Path"].id);
  assert.ok(!attach || after.zones["0:archive"].includes(attach.uid), "orphan archived");
});

// ------------------------------------------------------------ host trigger

test("Relay Feedback bills the attached Protocol's controller each Maintenance", () => {
  let state = game();
  const protocol = seed(state, 1, byName["Consensus Pause"].id); // any Protocol
  const played = attachTo(state, 0, "Relay Feedback", protocol);
  state = played.state;
  const before = state.seats[1].uptime;
  state = passUntil(state, (s) => s.seats[1].uptime < before, 900);
  assert.equal(state.seats[1].uptime, before - 1, "1 damage at the host controller's Maintenance");
});

// --------------------------------------------------------------- invalidate

test("Invalid Signature answers a card on the Queue — it fizzles, unresolved", () => {
  let state = game();
  const answer = seed(state, 1, byName["Invalid Signature"].id, {}, "wallet");
  const threatId = byName["Cognitive Surge"].id; // a no-target... it targets; use a simple zap
  const threat = seed(state, 0, byName["Uptime Stream"].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  payFor(state, 0, "Uptime Stream", 2); // colored part + X = 2
  payFor(state, 1, "Invalid Signature");
  state = ok(act(state, "PLAY_CARD", 0, { uid: threat, targets: [{ kind: "seat", seat: 0 }], x: 2 }));
  const qid = state.queue[state.queue.length - 1].qid;
  const before = state.seats[0].uptime;
  // Seat 1 answers at instant speed while the card sits on the Queue.
  state = passUntil(state, (s) => s.priority.seat === 1);
  state = ok(act(state, "PLAY_CARD", 1, { uid: answer, targets: [{ kind: "queue", qid }] }));
  state = passUntil(state, (s) => !s.queue.length);
  assert.equal(state.seats[0].uptime, before, "the invalidated card never resolved");
  void threatId;
});

test("a marker with an affinity filter refuses the wrong card", () => {
  let state = game();
  const gate = seed(state, 1, byName["Bitcoin Gatekeeper"].id);
  const threat = seed(state, 0, byName["Uptime Stream"].id, {}, "wallet"); // Bitcoin zap
  const wrong = seed(state, 0, byName["Quick Uplink"].id, {}, "wallet"); // Signal zap
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  payFor(state, 0, "Quick Uplink");
  payFor(state, 1, "Bitcoin Gatekeeper");
  state.seats[1].buffer.K = 2; // the Gatekeeper's KK activation cost
  const flx = seed(state, 0, byName["FLX, Culture Curator"].id);
  state = ok(act(state, "PLAY_CARD", 0, { uid: wrong, targets: [{ kind: "object", uid: flx }] }));
  const qid = state.queue[state.queue.length - 1].qid;
  state = passUntil(state, (s) => s.priority.seat === 1);
  const refused = act(state, "ACTIVATE_ABILITY", 1, {
    uid: gate,
    abilityIndex: 0,
    targets: [{ kind: "queue", qid }],
  });
  assert.equal(refused.error && refused.error.code, "ILLEGAL_TARGET", "a Signal card is not a Bitcoin card");
  void threat;
});
