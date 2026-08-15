/* Wave 9: affinities, auras, taxes, activations, and turn-step triggers. */
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
const act = (state, type, seat, payload) =>
  E.apply(state, { type, seat, seq: state.seq, at: "", payload: payload || {} });
const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

function game(seedValue = 990000) {
  let attempt = seedValue;
  for (let index = 0; index < 40; index++) {
    try {
      return E.createGame({
        seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
        seeds: { public: attempt, hidden: [attempt + 1, attempt + 2] },
        firstPlayer: 0,
      });
    } catch {
      attempt = (attempt * 1103515245 + 12345) & 0x7fffffff;
    }
  }
  throw new Error("could not mint a game");
}

function seed(state, seat, cardId, tweaks, zone = "network") {
  const uid = "o" + state.nextUid++;
  state.objects[uid] = Object.assign({
    uid, cardId, owner: seat, controller: seat, zone: `${seat}:${zone}`,
    committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
    rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
    token: false, entersSeq: state.seq, prevUid: null,
  }, tweaks || {});
  state.zones[`${seat}:${zone}`].push(uid);
  return uid;
}

function passUntil(state, stop, limit = 1200) {
  for (let index = 0; index < limit; index++) {
    if (stop(state) || state.result) return state;
    if (state.priority.seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
      continue;
    }
    const waiting = state.awaiting;
    if (!waiting) throw new Error("stuck without priority or awaited action");
    if (waiting.kind === "attackers") {
      state = ok(act(state, "DECLARE_ATTACKERS", waiting.seat, { attackers: [] }));
    } else if (waiting.kind === "blockers") {
      state = ok(act(state, "DECLARE_BLOCKERS", waiting.seat, { blocks: {} }));
    } else if (waiting.kind === "order") {
      const order = {};
      for (const uid of Object.keys(state.clash.blocks)) order[uid] = state.clash.blocks[uid].slice();
      state = ok(act(state, "ORDER_BLOCKERS", waiting.seat, { order }));
    } else if (waiting.kind === "damage") {
      state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", waiting.seat, { assignment: null }));
    } else if (waiting.kind === "discard") {
      const wallet = state.zones[`${waiting.seat}:wallet`];
      state = ok(act(state, "DISCARD_TO_LIMIT", waiting.seat, {
        uids: wallet.slice(0, wallet.length - state.handLimit),
      }));
    } else if (waiting.kind === "triggers") {
      state = ok(act(state, "ORDER_TRIGGERS", waiting.seat, {
        qids: state.pendingTriggers[String(waiting.seat)].map((entry) => entry.pendingId),
      }));
    } else if (waiting.kind === "unlock") {
      const picks = (waiting.required || []).slice();
      for (const [kind, cap] of Object.entries(waiting.caps || {})) {
        const candidates = waiting.selectable.filter((uid) => {
          const card = CARDS.find((entry) => entry.id === state.objects[uid].cardId);
          return kind === "Avatar" ? card.type.includes("Avatar") : card.type.includes("Resource");
        });
        picks.push(...candidates.slice(0, cap));
      }
      state = ok(act(state, "CHOOSE_UNLOCK", waiting.seat, { uids: picks }));
    } else {
      throw new Error(`unhandled awaited action ${waiting.kind}`);
    }
  }
  throw new Error("passUntil exhausted");
}

const fund = (state, seat, amount = 20) => {
  for (const symbol of ["P", "B", "K", "S", "T", "N"]) state.seats[seat].buffer[symbol] = amount;
};

test("global and attached affinity rules change the authoritative card identity", () => {
  const state = game();
  const power = seed(state, 0, byName["Power Plant — Solar"].id);
  seed(state, 0, byName["Grid Conversion"].id);
  const other = seed(state, 0, byName["Satoshi Orchard — Commons"].id);
  seed(state, 0, byName["Resource Corruption"].id, { attachedTo: other });
  const ctx = E.resolveCtx({});

  assert.deepEqual(E.affinitiesOf(state, ctx, power), ["Signal"]);
  assert.deepEqual(E.affinitiesOf(state, ctx, other), ["Keys"]);
});

test("control, fear, and indestructible attachment rules are enforced", () => {
  let state = game(990010);
  const stolen = seed(state, 1, byName["FLX, Culture Curator"].id);
  seed(state, 0, byName["Remote Control"].id, { attachedTo: stolen });
  const protectedResource = seed(state, 0, byName["Power Plant — Solar"].id);
  seed(state, 0, byName["Hardened Resource"].id, { attachedTo: protectedResource });
  const feared = seed(state, 0, byName["FLX, Culture Curator"].id);
  seed(state, 0, byName["Onion Route"].id, { attachedTo: feared });
  const ordinaryBlocker = seed(state, 1, byName["FLX, Culture Curator"].id);
  const ctx = E.resolveCtx({});

  state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  assert.equal(state.objects[stolen].controller, 0);
  assert.equal(E.canBlock({ state, ctx }, ordinaryBlocker, feared), false);

  state.turn.phase = "build1";
  state.turn.step = "main";
  state.priority.seat = 0;
  const destroy = seed(state, 0, byName["Resource Sink"].id, {}, "wallet");
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: destroy, targets: [{ kind: "object", uid: protectedResource }],
  }));
  state = passUntil(state, (current) => current.queue.length === 0);
  assert.ok(state.objects[protectedResource], "indestructible Resource was decommissioned");
});

test("Signal Tax and Resource Converter alter real payments", () => {
  let state = game(990020);
  seed(state, 1, byName["Signal Tax"].id);
  seed(state, 0, byName["Resource Converter"].id);
  const signalCard = seed(state, 0, byName["Emergency Reboot"].id, {}, "wallet");
  const signalTarget = seed(state, 1, byName["FLX, Culture Curator"].id);
  state.turn.phase = "build1";
  state.turn.step = "main";
  state.priority.seat = 0;
  state.seats[0].buffer = { P: 0, B: 0, K: 0, S: 5, T: 0, N: 0 };

  const paidTax = act(state, "PLAY_CARD", 0, {
    uid: signalCard,
    targets: [{ kind: "object", uid: signalTarget }],
    payment: { P: 0, B: 0, K: 0, S: 4, T: 0, N: 0 },
  });
  state = ok(paidTax);
  assert.equal(state.seats[0].buffer.S, 1);

  const powerCard = seed(state, 0, byName["Tunneling Patch"].id, {}, "wallet");
  const host = seed(state, 0, byName["FLX, Culture Curator"].id);
  state = passUntil(state, (current) => current.priority.seat === 0 && current.queue.length === 0);
  state.seats[0].buffer = { P: 0, B: 0, K: 0, S: 1, T: 0, N: 0 };
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: powerCard,
    targets: [{ kind: "object", uid: host }],
    payment: { P: 0, B: 0, K: 0, S: 1, T: 0, N: 0 },
  }));
  assert.equal(state.seats[0].buffer.S, 0);
});

test("conditional stats, Resource Avatars, and unlock caps are live rules", () => {
  let state = game(990030);
  const essex = seed(state, 0, byName["Essex, Grid Rebooter"].id);
  seed(state, 0, byName["Key Vault — Workshop"].id);
  seed(state, 0, byName["Resource Awakening"].id);
  const bitcoin = seed(state, 0, byName["Satoshi Orchard — Commons"].id);
  seed(state, 0, byName["Thermal Throttle"].id);
  const first = seed(state, 0, byName["FLX, Culture Curator"].id, { committed: true });
  const second = seed(state, 0, byName["FLX, Culture Curator"].id, { committed: true });
  const ctx = E.resolveCtx({});

  assert.deepEqual(E.statsOf(state, ctx, essex), { action: 3, resilience: 3 });
  assert.deepEqual(E.statsOf(state, ctx, bitcoin), { action: 1, resilience: 1 });
  assert.equal(E.canAttack({ state, ctx }, bitcoin), true);

  state.turn.active = 1;
  state.turn.phase = "close";
  state.turn.step = "endStep";
  state.priority.seat = 1;
  state.priority.passed = [false, false];
  state = passUntil(state, (current) => current.turn.active === 0 && current.turn.step !== "unlock");
  assert.equal(Number(state.objects[first].committed) + Number(state.objects[second].committed), 1);
});

test("simple Hardware activations resolve without assisted edits", () => {
  let state = game(990040);
  const basalt = seed(state, 0, byName["Basalt Battery"].id, { committed: true });
  const scrubber = seed(state, 0, byName["Wallet Scrubber"].id);
  const viewer = seed(state, 0, byName["Public Wallet Viewer"].id);
  const targetWalletBefore = state.zones["1:wallet"].length;
  state.turn.phase = "build1";
  state.turn.step = "main";
  state.priority.seat = 0;
  fund(state, 0);

  const basaltIndex = byName["Basalt Battery"].abilities.findIndex(
    (ability) => ability.text === "3: unlock this Hardware."
  );
  state = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: basalt, abilityIndex: basaltIndex, targets: [] }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);
  assert.equal(state.objects[basalt].committed, false);

  const scrubIndex = byName["Wallet Scrubber"].abilities.findIndex((ability) => ability.kind === "activated");
  state = ok(act(state, "ACTIVATE_ABILITY", 0, {
    uid: scrubber, abilityIndex: scrubIndex, targets: [{ kind: "seat", seat: 1 }],
  }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);
  assert.equal(state.zones["1:wallet"].length, targetWalletBefore - 1);

  const viewerIndex = byName["Public Wallet Viewer"].abilities.findIndex((ability) => ability.kind === "activated");
  state = ok(act(state, "ACTIVATE_ABILITY", 0, {
    uid: viewer, abilityIndex: viewerIndex, targets: [{ kind: "seat", seat: 1 }],
  }));
  state = passUntil(state, (current) => current.queue.length === 0);
  assert.ok(state.zones["1:wallet"].every((uid) => state.objects[uid].revealedTo.includes(0)));
});

test("Open Feed, Fast Channel, and Yield Router fire from engine events", () => {
  let state = game(990050);
  seed(state, 0, byName["Open Feed"].id);
  seed(state, 0, byName["Fast Channel"].id);
  const resource = seed(state, 0, byName["Satoshi Orchard — Commons"].id);
  seed(state, 0, byName["Yield Router"].id, { attachedTo: resource });
  const extraResource = seed(state, 0, byName["Power Plant — Solar"].id, {}, "wallet");
  state.turn.phase = "build1";
  state.turn.step = "main";
  state.priority.seat = 0;
  state.turn.resourcePlays.used = 1;
  const uptimeBefore = state.seats[0].uptime;

  state = ok(act(state, "PLAY_RESOURCE", 0, { uid: extraResource }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);
  assert.equal(state.seats[0].uptime, uptimeBefore - 1);

  const resourceAbility = byName["Satoshi Orchard — Commons"].abilities.findIndex(
    (ability) => ability.resourceAbility || ability.kind === "activated"
  );
  state = ok(act(state, "ACTIVATE_RESOURCE_ABILITY", 0, {
    uid: resource, abilityIndex: resourceAbility,
  }));
  state = passUntil(state, (current) => current.queue.length === 0);
  assert.equal(state.seats[0].buffer.B, 2, "Yield Router did not add Bitcoin");

  const walletBefore = state.zones["0:wallet"].length;
  state.turn.active = 1;
  state.turn.phase = "close";
  state.turn.step = "endStep";
  state.priority.seat = 1;
  state.priority.passed = [false, false];
  state.awaiting = null;
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.queue.length === 0
  );
  assert.equal(state.zones["0:wallet"].length, walletBefore + 2);
});
