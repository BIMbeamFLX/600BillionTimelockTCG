/* Guardian Signal (E1-027) froze every match it resolved in.
 *
 * Its op wrote a prevention shield carrying both `seat: target.seat` and
 * `uid: target.uid`, and exactly one of those is always undefined — a seat
 * target has no uid, an object target has no seat. canonicalJSON refuses
 * undefined, and apply() hashes its input before it does anything else, so the
 * very next action failed, and so did every action after it. CONCEDE included:
 * a player could not even leave. No test played the card, and no precon holds
 * it, so it shipped. */
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
const GUARDIAN = byName["Guardian Signal"];

const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game() {
  return E.createGame({
    seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
    seeds: { public: 555000, hidden: [555001, 555002] },
    firstPlayer: 0,
  });
}

function seed(state, seat, cardId, zone) {
  const where = zone || "network";
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = {
    uid, cardId, owner: seat, controller: seat, zone: `${seat}:${where}`,
    committed: false, bootDelay: false, damage: 0, counters: {},
    attachedTo: null, rebootShields: 0, facedown: false,
    revealedTo: [], revealedUntil: null, token: false,
    entersSeq: state.seq, prevUid: null,
  };
  state.zones[`${seat}:${where}`].push(uid);
  return uid;
}

/* Pass priority and answer declarations with their do-nothing default. */
function passUntil(state, stop, limit = 400) {
  for (let i = 0; i < limit; i++) {
    if (stop(state) || state.result) return state;
    if (state.priority.seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
      continue;
    }
    const aw = state.awaiting;
    if (aw.kind === "attackers") state = ok(act(state, "DECLARE_ATTACKERS", aw.seat, { attackers: [] }));
    else if (aw.kind === "blockers") state = ok(act(state, "DECLARE_BLOCKERS", aw.seat, { blocks: {} }));
    else if (aw.kind === "discard") {
      const wallet = state.zones[`${aw.seat}:wallet`];
      state = ok(act(state, "DISCARD_TO_LIMIT", aw.seat, { uids: wallet.slice(0, wallet.length - state.handLimit) }));
    } else throw new Error(`unhandled ${aw.kind}`);
  }
  throw new Error("passUntil limit reached");
}

/* Seat 0, in its own Build I, holding priority with Guardian Signal and a Zap
 * in hand and enough in the Buffer for both. */
function ready() {
  let state = game();
  const guardian = seed(state, 0, GUARDIAN.id, "wallet");
  const zap = seed(state, 0, byName["Zap"].id, "wallet");
  state = passUntil(state, (s) => s.turn.active === 0 && s.turn.phase === "build1" && s.priority.seat === 0);
  state.seats[0].buffer.S = 1; // Guardian Signal's colored part
  state.seats[0].buffer.N = 2; // X = 2
  state.seats[0].buffer.P = 1; // Zap
  return { state, guardian, zap };
}

test("Guardian Signal's card is the one this file is about", () => {
  assert.equal(GUARDIAN.id, "E1-027");
  assert.equal(GUARDIAN.abilities[0].ops[0].op, "guardianSignal");
});

for (const shape of ["seat", "object"]) {
  test(`a game goes on after Guardian Signal resolves on ${shape === "seat" ? "a player" : "an Avatar"}`, () => {
    let { state, guardian } = ready();
    const avatar = seed(state, 0, byName["BK, Feedback Grower"].id);
    const target = shape === "seat" ? { kind: "seat", seat: 0 } : { kind: "object", uid: avatar };
    state = ok(act(state, "PLAY_CARD", 0, { uid: guardian, x: 2, targets: [target] }));
    state = passUntil(state, (s) => !s.queue.length);

    const shield = state.prevention.find((entry) => entry.amount === 2);
    assert.ok(shield, "the shield was written");
    assert.equal(shield.kind, shape);
    assert.doesNotThrow(() => E.hashState(state), "the state must still be hashable");

    // The next action, a whole turn after it, and a concession all still apply.
    state = passUntil(state, (s) => s.turn.active === 1);
    assert.equal(state.turn.active, 1, "play reached the opponent's turn");
    const conceded = act(state, "CONCEDE", 1);
    assert.equal(conceded.error, null, JSON.stringify(conceded.error));
  });
}

test("Guardian Signal's shield actually prevents the damage it names", () => {
  let { state, guardian, zap } = ready();
  const avatar = seed(state, 0, byName["BK, Feedback Grower"].id);
  state = ok(act(state, "PLAY_CARD", 0, { uid: guardian, x: 2, targets: [{ kind: "object", uid: avatar }] }));
  state = passUntil(state, (s) => !s.queue.length);
  state = ok(act(state, "PLAY_CARD", 0, { uid: zap, targets: [{ kind: "object", uid: avatar }] }));
  state = passUntil(state, (s) => !s.queue.length);
  assert.equal(state.objects[avatar].damage, 0, "two damage from Zap, two prevented");

  // And a shield on a player shields that player, not every player.
  ({ state, guardian, zap } = ready());
  const uptime = [state.seats[0].uptime, state.seats[1].uptime];
  state = ok(act(state, "PLAY_CARD", 0, { uid: guardian, x: 2, targets: [{ kind: "seat", seat: 0 }] }));
  state = passUntil(state, (s) => !s.queue.length);
  state = ok(act(state, "PLAY_CARD", 0, { uid: zap, targets: [{ kind: "seat", seat: 1 }] }));
  state = passUntil(state, (s) => !s.queue.length);
  assert.equal(state.seats[1].uptime, uptime[1] - 2, "the unshielded player takes the Zap");
  assert.equal(state.seats[0].uptime, uptime[0]);
});
