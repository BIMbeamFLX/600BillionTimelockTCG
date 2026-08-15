/* Wave 12: static-rule execution and multi-step scripted card choices. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CARDS = require(path.resolve(here, "..", "..", "site", "play-data.js"));
const E = require(path.resolve(here, "..", "..", "site", "engine.js"));
E.setCatalog(CARDS);
const byName = Object.fromEntries(CARDS.map((card) => [card.name, card]));
const act = (state, type, seat, payload = {}) => E.apply(
  state, { type, seat, seq: state.seq, at: "", payload }
);
const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seedValue = 1120000) {
  for (let offset = 0; offset < 100; offset++) {
    try {
      return E.createGame({
        seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
        seeds: { public: seedValue + offset, hidden: [seedValue + 100 + offset, seedValue + 200 + offset] },
        firstPlayer: 0,
        modules: { stake: true, toss: true },
      });
    } catch { /* deterministic module-safe deck */ }
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
    controlSource: null, activations: {}, maskedCardId: null, sovereign: false,
    copyBaseCardId: null, affinityOverride: null, typeAdditions: [], adaptive: false,
    entersSeq: state.seq, prevUid: null,
  }, tweaks);
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

function priority(state, seat = 0) {
  state.turn.active = seat;
  state.turn.phase = "build1";
  state.turn.step = "main";
  state.awaiting = null;
  state.priority = { seat, passed: [false, false], window: "build1:main" };
  for (const player of [0, 1]) {
    for (const symbol of ["P", "B", "K", "S", "T", "N"]) state.seats[player].buffer[symbol] = 40;
  }
  return state;
}

function resolve(state, chooser = null, limit = 150) {
  for (let index = 0; index < limit; index++) {
    if (state.pendingChoice) {
      const selection = chooser ? chooser(state.pendingChoice, state) : [0];
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

test("resource-dependent Avatars archive themselves as a state-based rule", () => {
  let state = priority(game());
  const darren = seed(state, 0, "Darren, Channel Raider");
  state = ok(act(state, "PASS_PRIORITY", 0));
  assert.equal(state.objects[darren], undefined);
  assert.ok(state.zones["0:archive"].some((uid) => state.objects[uid].cardId === byName["Darren, Channel Raider"].id));
});

test("Resource Reclassification asks for and applies a basic Resource type", () => {
  let state = priority(game(1120010));
  const host = seed(state, 0, "Satoshi Orchard — Commons");
  const attachment = seed(state, 0, "Resource Reclassification", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: attachment, targets: [{ kind: "object", uid: host }],
  }));
  state = resolve(state, (choice) => [choice.options.findIndex((option) => option.value === "Power")]);
  assert.deepEqual(E.affinitiesOf(state, E.resolveCtx({}), host), ["Power"]);
});

test("Benarc enters as a real copy while preserving its underlying card in hidden zones", () => {
  let state = priority(game(1120020));
  const flx = seed(state, 0, "FLX, Culture Curator");
  const benarc = seed(state, 0, "Benarc, Mirror Client", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: benarc, targets: [] }));
  state = resolve(state, (choice) => [choice.options.findIndex((option) => option.uid === flx)]);
  const copy = state.zones["0:network"].find((uid) => state.objects[uid].copyBaseCardId === byName["Benarc, Mirror Client"].id);
  assert.ok(copy);
  assert.equal(state.objects[copy].cardId, byName["FLX, Culture Curator"].id);
  assert.deepEqual(E.statsOf(state, E.resolveCtx({}), copy), { action: 4, resilience: 4 });
});

test("Memory Palace can replace an effect discard with the top of Stack", () => {
  let state = priority(game(1120030));
  seed(state, 1, "Memory Palace");
  const scrubber = seed(state, 0, "Wallet Scrubber");
  const ability = byName["Wallet Scrubber"].abilities.findIndex((entry) => entry.kind === "activated");
  const stackBefore = state.zones["1:stack"].length;
  state = ok(act(state, "ACTIVATE_ABILITY", 0, {
    uid: scrubber, abilityIndex: ability, targets: [{ kind: "seat", seat: 1 }],
  }));
  state = resolve(state, (choice) => [choice.options.findIndex((option) => option.value === "stack")]);
  assert.equal(state.zones["1:stack"].length, stackBefore + 1);
});

test("Sovereign Mode survives zero and converts damage into chosen archives", () => {
  let state = priority(game(1120040));
  const spare = seed(state, 0, "Power Plant — Solar");
  seed(state, 0, "Power Plant — Hydro");
  seed(state, 0, "Satoshi Orchard — Commons");
  const sovereign = seed(state, 0, "Sovereign Mode", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: sovereign, targets: [] }));
  state = resolve(state);
  assert.equal(state.seats[0].uptime, 0);
  assert.equal(state.result, null);

  state = priority(state, 1);
  const zap = seed(state, 1, "Zap", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 1, { uid: zap, targets: [{ kind: "seat", seat: 0 }] }));
  for (let index = 0; index < 20 && state.awaiting?.kind !== "sovereignDamage"; index++) {
    state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  }
  assert.equal(state.awaiting.kind, "sovereignDamage");
  const amount = state.awaiting.amount;
  const choices = state.zones["0:network"].filter((uid) => uid !== state.zones["0:network"].find(
    (candidate) => state.objects[candidate].sovereign
  )).slice(0, amount);
  while (choices.length < amount) choices.push(seed(state, 0, "Power Plant — Hydro"));
  state = ok(act(state, "CHOOSE_SOVEREIGN_ARCHIVE", 0, { uids: choices.slice(0, amount) }));
  assert.equal(state.result, null);
  assert.equal(state.objects[spare], undefined);
});

test("Human Hashrate cannot spend Uptime the player does not have", () => {
  const state = priority(game(1120045));
  state.seats[0].uptime = 0;
  state.effects.push({
    id: "e-test-uptime-resource",
    kind: "uptimeResourceAbility",
    controller: 0,
    expires: { kind: "eot", turn: state.turn.number },
  });

  const result = act(state, "ACTIVATE_UPTIME_RESOURCE", 0);

  assert.equal(result.error?.code, "CANNOT_AFFORD");
  assert.equal(result.state, state, "a rejected payment must not mutate the state");
  assert.equal(state.seats[0].uptime, 0);
  assert.equal(state.seats[0].buffer.N, 40);
});

test("Gadaj grants the printed Reboot ability to an opponent's Zombie", () => {
  const flx = E.resolveCtx({}).catalog.byId[byName["FLX, Culture Curator"].id];
  const originalSubtype = flx.subtype;
  flx.subtype = "Zombie";
  try {
    let state = priority(game(1120047));
    const zombie = seed(state, 0, "FLX, Culture Curator");
    const gadaj = seed(state, 1, "Gadaj, Archive Maintainer");

    state = ok(act(state, "ACTIVATE_GRANTED_ABILITY", 0, {
      uid: zombie,
      grantorUid: gadaj,
    }));
    state = resolve(state);

    assert.equal(state.objects[zombie].rebootShields, 1);
    assert.equal(state.seats[0].buffer.K, 39);
  } finally {
    flx.subtype = originalSubtype;
  }
});

test("Remote Command exposes a chosen legal card and plays it from the opponent's Buffer", () => {
  let state = priority(game(1120050));
  const chosen = seed(state, 1, "Next Block", {}, "wallet");
  const command = seed(state, 0, "Remote Command", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: command, targets: [] }));
  for (let index = 0; index < 20 && !state.pendingChoice; index++) {
    state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  }
  const option = state.pendingChoice.options.findIndex((entry) => entry.uid === chosen);
  assert.ok(option >= 0);
  state = ok(act(state, "CHOOSE", 0, { choiceId: state.pendingChoice.id, selection: [option] }));
  assert.equal(state.awaiting.kind, "remotePlay");
  state = ok(act(state, "REMOTE_PLAY_CARD", 0, { targets: [] }));
  assert.ok(state.queue.some((entry) => entry.cardId === byName["Next Block"].id && entry.controller === 1));
});

test("Remote Command excludes a card with no legal target", () => {
  let state = priority(game(1120060));
  for (const uid of state.zones["1:wallet"]) delete state.objects[uid];
  state.zones["1:wallet"] = [];
  seed(state, 1, "Return to Wallet", {}, "wallet");
  const command = seed(state, 0, "Remote Command", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: command, targets: [] }));
  for (let index = 0; index < 20 && state.queue.length && !state.pendingChoice; index++) {
    state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  }

  assert.equal(state.pendingChoice, null);
  assert.notEqual(state.awaiting?.kind, "remotePlay");
});

test("Remote Command excludes Convert Uptime without an Avatar to archive", () => {
  let state = priority(game(1120070));
  for (const uid of state.zones["1:wallet"]) delete state.objects[uid];
  state.zones["1:wallet"] = [];
  seed(state, 1, "Convert Uptime", {}, "wallet");
  const command = seed(state, 0, "Remote Command", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: command, targets: [] }));
  for (let index = 0; index < 20 && state.queue.length && !state.pendingChoice; index++) {
    state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  }

  assert.equal(state.pendingChoice, null);
  assert.notEqual(state.awaiting?.kind, "remotePlay");
});

test("Remote Command enforces and records Convert Uptime's additional cost", () => {
  let state = priority(game(1120080));
  for (const uid of state.zones["1:wallet"]) delete state.objects[uid];
  state.zones["1:wallet"] = [];
  const chosen = seed(state, 1, "Convert Uptime", {}, "wallet");
  const sacrifice = seed(state, 1, "FLX, Culture Curator");
  const command = seed(state, 0, "Remote Command", {}, "wallet");
  state = ok(act(state, "PLAY_CARD", 0, { uid: command, targets: [] }));
  for (let index = 0; index < 20 && !state.pendingChoice; index++) {
    state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  }
  const option = state.pendingChoice.options.findIndex((entry) => entry.uid === chosen);
  state = ok(act(state, "CHOOSE", 0, {
    choiceId: state.pendingChoice.id,
    selection: [option],
  }));

  const missing = act(state, "REMOTE_PLAY_CARD", 0, { targets: [] });
  assert.equal(missing.error?.code, "SCHEMA");
  state = ok(act(state, "REMOTE_PLAY_CARD", 0, {
    targets: [],
    additionalCosts: [sacrifice],
  }));

  assert.equal(state.objects[sacrifice], undefined);
  assert.equal(state.queue.at(-1).additionalCostTotal, 5);
});
