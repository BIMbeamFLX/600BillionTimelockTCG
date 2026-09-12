/* "Decommission target Firewall" must be able to target a Firewall.
 * Firewall is a keyword (printed as a subtype on several cards), never a card
 * type, so a "type:Firewall" target matched nothing and every such card could
 * never be played. Run with `npm run test:js`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CARDS = require("../../site/play-data.js");
const E = require("../../site/engine.js");
E.setCatalog(CARDS);

function buildWindow() {
  let state = E.createGame({
    seats: [{ name: "a", affinity: "Power" }, { name: "b", affinity: "Keys" }],
    seeds: { public: 3, hidden: [4, 5] },
    firstPlayer: 0,
  });
  for (let i = 0; i < 20 && !(state.priority.seat === 0 && state.priority.window === "build1:main"); i++) {
    const seat = state.priority.seat === null ? 0 : state.priority.seat;
    const result = E.apply(state, { type: "PASS_PRIORITY", seat, seq: state.seq, at: "", payload: {} });
    assert.equal(result.error, null);
    state = result.state;
  }
  return state;
}

function place(state, cardId, seat, zone) {
  const uid = "o" + state.nextUid++;
  state.objects[uid] = {
    uid, cardId, owner: seat, controller: seat, zone: `${seat}:${zone}`, committed: false, bootDelay: false,
    damage: 0, counters: {}, attachedTo: null, rebootShields: 0, facedown: false, revealedTo: [0, 1],
    revealedUntil: null, token: false, entersSeq: 0, prevUid: null,
  };
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

const act = (state, type, seat, payload) => E.apply(state, { type, seat, seq: state.seq, at: "", payload });

test("Firewall Tunnel decommissions a Firewall and refuses anything else", () => {
  let state = buildWindow();
  const firewall = CARDS.find((card) => /Firewall/.test(card.subtype || "") && card.type === "Avatar");
  const plain = CARDS.find((card) => card.type === "Avatar" && !/Firewall/.test(card.subtype || "") &&
    !(card.keywords || []).some((keyword) => keyword.name === "Firewall") && !(card.abilities || []).length);
  const wall = place(state, firewall.id, 1, "network");
  const other = place(state, plain.id, 1, "network");
  const tunnel = place(state, CARDS.find((card) => card.name === "Firewall Tunnel").id, 0, "wallet");
  state.seats[0].buffer = { P: 1, B: 0, K: 0, S: 0, T: 0, N: 0 };

  assert.equal(act(state, "PLAY_CARD", 0, { uid: tunnel, targets: [{ kind: "object", uid: other }] }).error.code,
    "ILLEGAL_TARGET", "a non-Firewall Avatar is not a Firewall");
  let result = act(state, "PLAY_CARD", 0, { uid: tunnel, targets: [{ kind: "object", uid: wall }] });
  assert.equal(result.error, null, JSON.stringify(result.error));
  state = result.state;
  for (let i = 0; i < 6 && state.queue.length; i++) {
    result = act(state, "PASS_PRIORITY", state.priority.seat, {});
    assert.equal(result.error, null, JSON.stringify(result.error));
    state = result.state;
  }
  assert.equal(state.zones["1:network"].includes(wall), false, "the Firewall was decommissioned");
  assert.equal(state.zones["1:network"].includes(other), true);
});
