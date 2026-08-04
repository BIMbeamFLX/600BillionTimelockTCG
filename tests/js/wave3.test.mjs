/* Wave 3: paid X, zone moves, filtered sweeps and live counts — every family
 * driven through the real queue with real cards. */
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

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seed = 555000) {
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

// -------------------------------------------------------------------- X

test("Uptime Stream: X is announced, paid, and delivered", () => {
  let state = game();
  const uid = seed(state, 0, byName["Uptime Stream"].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  state.seats[0].buffer.B = 1; // the colored part
  state.seats[0].buffer.N = 2; // X = 2
  const before = state.seats[1].uptime;
  state = ok(act(state, "PLAY_CARD", 0, { uid, targets: [{ kind: "seat", seat: 1 }], x: 2 }));
  state = passUntil(state, (s) => s.seats[1].uptime > before);
  assert.equal(state.seats[1].uptime, before + 2, "the target gained exactly X");
  const spent = Object.values(state.seats[0].buffer).reduce((a, n) => a + n, 0);
  assert.equal(spent, 0, "X was actually paid, not announced for free");
});

test("an X the Buffer cannot cover is refused", () => {
  let state = game();
  const uid = seed(state, 0, byName["Uptime Stream"].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  state.seats[0].buffer.B = 1; // colored part only — no X funds
  const result = act(state, "PLAY_CARD", 0, { uid, targets: [{ kind: "seat", seat: 1 }], x: 3 });
  assert.equal(result.error && result.error.code, "CANNOT_AFFORD");
});

// -------------------------------------------------------------- filters

test("Network Storm hits Broadcast Avatars and players, spares the rest", () => {
  let state = game();
  const broadcaster = seed(state, 1, byName["FLX, Culture Curator"].id); // Broadcast printed
  const quiet = seed(state, 1, byName["BK, Feedback Grower"].id); // no Broadcast
  const uid = seed(state, 0, byName["Network Storm"].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  state.seats[0].buffer.B = 1;
  state.seats[0].buffer.N = 2; // X = 2
  const uptimes = [state.seats[0].uptime, state.seats[1].uptime];
  state = ok(act(state, "PLAY_CARD", 0, { uid, x: 2, targets: [] }));
  state = passUntil(state, (s) => s.objects[broadcaster].damage > 0);
  assert.equal(state.objects[broadcaster].damage, 2, "the Broadcast Avatar took X");
  assert.equal(state.objects[quiet].damage, 0, "the quiet Avatar was spared");
  assert.equal(state.seats[0].uptime, uptimes[0] - 2, "each player took X");
  assert.equal(state.seats[1].uptime, uptimes[1] - 2);
});

// ------------------------------------------------------------ zone moves

test("First Memory: three cards move from the Stack to the Wallet", () => {
  let state = game();
  const uid = seed(state, 0, byName["First Memory"].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  state.seats[0].buffer.T = 1;
  const wallet = state.zones["0:wallet"].length;
  const stack = state.zones["0:stack"].length;
  state = ok(act(state, "PLAY_CARD", 0, { uid, targets: [{ kind: "seat", seat: 0 }] }));
  state = passUntil(state, (s) => s.zones["0:wallet"].length > wallet);
  // -1 for First Memory leaving the wallet, +3 from the top of the Stack.
  assert.equal(state.zones["0:wallet"].length, wallet - 1 + 3);
  assert.equal(state.zones["0:stack"].length, stack - 3);
});

test("Peaceful Exit: the Avatar cools off and its controller banks its Action", () => {
  let state = game();
  const avatar = seed(state, 1, byName["FLX, Culture Curator"].id); // 4/4
  const uid = seed(state, 0, byName["Peaceful Exit"].id, {}, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  state.seats[0].buffer.S = 1;
  const before = state.seats[1].uptime;
  state = ok(act(state, "PLAY_CARD", 0, { uid, targets: [{ kind: "object", uid: avatar }] }));
  state = passUntil(state, (s) => s.seats[1].uptime > before);
  assert.equal(state.seats[1].uptime, before + 4, "controller gained the Action");
  const inCold = state.zones["1:cold"].some((u) => state.objects[u].prevUid === avatar || u === avatar);
  assert.ok(inCold || !state.objects[avatar], "the Avatar left for Cold Storage");
});

// --------------------------------------------------------- live counts

test("Consequence Ledger charges by the Keys Resources you hold", () => {
  let state = game();
  seed(state, 0, byName["Consequence Ledger"].id);
  seed(state, 1, byName["Multisig Quorum"].id); // a Keys card, not a Resource
  const orchardId = byName["Satoshi Orchard"].id;
  const junctionId = byName["Timelock–Keys Junction"].id; // Keys Resource
  seed(state, 1, junctionId);
  seed(state, 1, junctionId);
  seed(state, 1, orchardId); // Bitcoin — must not count
  const before = state.seats[1].uptime;
  state = passUntil(state, (s) => s.seats[1].uptime < before, 900);
  assert.equal(state.seats[1].uptime, before - 2, "2 Keys Resources = 2 damage, the rest ignored");
});
