/* Wave 11: every compiled operation has an engine path, plus unusual zone rules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(here, "..", "..");
const CARDS = require(path.join(root, "site", "play-data.js"));
const E = require(path.join(root, "site", "engine.js"));
E.setCatalog(CARDS);
const byName = Object.fromEntries(CARDS.map((card) => [card.name, card]));
const act = (state, type, seat, payload = {}) => E.apply(
  state, { type, seat, seq: state.seq, at: "", payload }
);
const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seedValue = 1110000) {
  for (let offset = 0; offset < 100; offset++) {
    try {
      return E.createGame({
        seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
        seeds: { public: seedValue + offset, hidden: [seedValue + 100 + offset, seedValue + 200 + offset] },
        firstPlayer: 0,
        modules: { stake: true, toss: true },
      });
    } catch { /* find a deterministic deck that satisfies enabled modules */ }
  }
  throw new Error("could not mint game");
}

function seed(state, seat, name, tweaks = {}, zone = "network") {
  const uid = "o" + state.nextUid++;
  state.objects[uid] = Object.assign({
    uid, cardId: byName[name].id, owner: seat, controller: seat, zone: `${seat}:${zone}`,
    committed: false, bootDelay: false, damage: 0, damageSources: {}, counters: {}, attachedTo: null,
    rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
    token: false, tokenProfile: null, chosenAffinity: null, chosenSeat: null,
    controlSource: null, activations: {}, entersSeq: state.seq, prevUid: null,
  }, tweaks);
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

function priority(state, seat = 0, phase = "build1", step = "main") {
  state.turn.active = seat;
  state.turn.phase = phase;
  state.turn.step = step;
  state.clash.step = phase === "clash" ? step : null;
  state.awaiting = null;
  state.priority = { seat, passed: [false, false], window: `${phase}:${step}` };
  for (const symbol of ["P", "B", "K", "S", "T", "N"]) state.seats[seat].buffer[symbol] = 40;
  return state;
}

function resolve(state, choose = null, limit = 120) {
  for (let index = 0; index < limit; index++) {
    if (state.pendingChoice) {
      const selection = choose ? choose(state.pendingChoice, state) : [0];
      state = ok(act(state, "CHOOSE", state.pendingChoice.seat, {
        choiceId: state.pendingChoice.id, selection,
      }));
      continue;
    }
    if (!state.queue.length && state.priority.seat !== null) return state;
    if (state.priority.seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
      continue;
    }
    throw new Error(`unexpected await ${JSON.stringify(state.awaiting)}`);
  }
  throw new Error("resolution exhausted");
}

test("every operation emitted by the card compiler has a runOp case", () => {
  const ops = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      if (value.op) ops.add(value.op);
      Object.values(value).forEach(walk);
    }
  };
  walk(CARDS);
  const source = fs.readFileSync(path.join(root, "site", "engine.js"), "utf8");
  const runtime = source.slice(source.indexOf("function runOp("), source.indexOf("function runNested("));
  const implemented = new Set(Array.from(runtime.matchAll(/case "([^"]+)"/g), (match) => match[1]));
  assert.deepEqual([...ops].filter((op) => !implemented.has(op)).sort(), []);
});

test("Archive Boot returns its archived host, weakens it, and archives it when the Boot leaves", () => {
  let state = priority(game(1110010));
  const host = seed(state, 1, "FLX, Culture Curator", {}, "archive");
  const boot = seed(state, 0, "Archive Boot", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: boot, targets: [{ kind: "object", uid: host }] }));
  state = resolve(state);
  const returned = state.zones["0:network"].find((uid) => state.objects[uid].cardId === byName["FLX, Culture Curator"].id);
  const attachment = state.zones["0:network"].find((uid) => state.objects[uid].cardId === byName["Archive Boot"].id);
  assert.ok(returned && attachment);
  assert.equal(state.objects[attachment].attachedTo, returned);
  assert.equal(E.statsOf(state, E.resolveCtx({}), returned).action, 3);

  state = priority(state);
  const cleanup = seed(state, 0, "Protocol Cleanup", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: cleanup, targets: [{ kind: "object", uid: attachment }] }));
  state = resolve(state);
  assert.ok(!state.objects[returned]);
  assert.ok(state.zones["1:archive"].some((uid) => state.objects[uid].cardId === byName["FLX, Culture Curator"].id));
});

test("Final Settlement makes lethal damage cold and blocks Reboot for the turn", () => {
  let state = priority(game(1110020));
  const target = seed(state, 1, "Cuddy, Signal Organizer");
  const spell = seed(state, 0, "Final Settlement", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: spell, x: 1, targets: [{ kind: "object", uid: target }],
  }));
  state = resolve(state);
  assert.ok(!state.objects[target]);
  assert.ok(state.zones["1:cold"].some((uid) => state.objects[uid].cardId === byName["Cuddy, Signal Organizer"].id));
});

test("Identity Mask deploys a paid face-down 2/2 and reveals it before damage", () => {
  let state = priority(game(1110030));
  const mask = seed(state, 0, "Identity Mask");
  const avatar = seed(state, 0, "Cuddy, Signal Organizer", {}, "wallet");
  const ability = byName["Identity Mask"].abilities.findIndex((entry) => entry.kind === "activated");
  state = ok(act(state, "ACTIVATE_ABILITY", 0, {
    uid: mask, abilityIndex: ability, x: 1, targets: [{ kind: "object", uid: avatar }],
  }));
  state = resolve(state);
  const deployed = state.zones["0:network"].find((uid) => state.objects[uid].maskedCardId);
  assert.ok(deployed);
  assert.equal(state.objects[deployed].facedown, true);
  assert.deepEqual(E.statsOf(state, E.resolveCtx({}), deployed), { action: 2, resilience: 2 });
});
