/* Wave 8: turn, zone-reset, and continuous-rule families. */
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

function game(seedValue = 880000) {
  let attempt = seedValue;
  for (let index = 0; index < 40; index++) {
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

function seed(state, seat, cardId, tweaks, zone = "network") {
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid, cardId, owner: seat, controller: seat, zone: `${seat}:${zone}`,
      committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
      rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
      token: false, entersSeq: state.seq, prevUid: null,
    },
    tweaks || {}
  );
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
    } else {
      throw new Error(`unhandled awaited action ${waiting.kind}`);
    }
  }
  throw new Error("passUntil exhausted");
}

const fund = (state, seat) => {
  for (const symbol of ["P", "B", "K", "S", "T", "N"]) state.seats[seat].buffer[symbol] = 20;
};

test("Next Block gives its controller the immediately following turn", () => {
  let state = game();
  const cardUid = seed(state, 0, byName["Next Block"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, { uid: cardUid, targets: [] }));
  state = passUntil(state, (current) =>
    current.turn.phase === "open" && current.turn.step !== "unlock"
  );

  assert.equal(state.turn.active, 0, "the opponent received the promised extra turn");
});

test("Archive Restore targets your Archive and returns the Avatar to the Network", () => {
  let state = game(880010);
  const archived = seed(state, 0, byName["FLX, Culture Curator"].id, {}, "archive");
  const spell = seed(state, 0, byName["Archive Restore"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: spell,
    targets: [{ kind: "object", uid: archived }],
  }));
  state = passUntil(state, (current) =>
    current.zones["0:network"].some((uid) => current.objects[uid].prevUid === archived)
  );

  assert.ok(state.zones["0:network"].some((uid) => state.objects[uid].prevUid === archived));
});

test("State Reset shuffles both Wallets and Archives into each Stack before drawing seven", () => {
  let state = game(880020);
  const reset = seed(state, 0, byName["State Reset"].id, {}, "wallet");
  seed(state, 0, byName["FLX, Culture Curator"].id, {}, "archive");
  seed(state, 1, byName["FLX, Culture Curator"].id, {}, "archive");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, { uid: reset, targets: [] }));
  state = passUntil(state, (current) =>
    current.zones["0:wallet"].length === 7 && current.zones["1:wallet"].length === 7
  );

  assert.equal(state.zones["0:archive"].length, 1, "only the resolved Reset remains archived");
  assert.equal(state.zones["1:archive"].length, 0);
});

test("continuous rules change attacking and entry state without manual actions", () => {
  let state = game(880030);
  const flx = seed(state, 0, byName["FLX, Culture Curator"].id);
  const nind = seed(
    state,
    0,
    byName["Nind, Archive Returner"].id,
    { bootDelay: true }
  );
  const disk = seed(state, 0, byName["Network Reset Disk"].id, {}, "wallet");
  const ctx = E.resolveCtx({});

  assert.equal(E.canAttack({ state, ctx }, nind), true, "Nind still had Boot Delay");
  state.turn.phase = "clash";
  state.turn.step = "attackers";
  state.clash.step = "attackers";
  state.awaiting = { kind: "attackers", seat: 0 };
  state.priority.seat = null;
  state = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [flx] }));
  assert.equal(state.objects[flx].committed, false, "FLX committed despite its printed rule");

  state.turn.phase = "build1";
  state.turn.step = "main";
  state.awaiting = null;
  state.priority.seat = 0;
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, { uid: disk, targets: [] }));
  state = passUntil(state, (current) =>
    current.zones["0:network"].some((uid) => current.objects[uid].cardId === byName["Network Reset Disk"].id)
  );
  const deployed = state.zones["0:network"].find(
    (uid) => state.objects[uid].cardId === byName["Network Reset Disk"].id
  );
  assert.equal(state.objects[deployed].committed, true, "the Disk entered unlocked");
});

test("Affinity Rewrite does not rewrite basic Resource-type keywords", () => {
  const state = game(880035);
  const shield = seed(state, 0, byName["Morgs, Signal Knight"].id);
  state.effects.push({
    id: "e-affinity-word",
    kind: "wordRewrite",
    targetUid: shield,
    vocabulary: "affinity",
    from: "Keys",
    to: "Power",
  });

  assert.equal(E.shieldedFrom(state, E.resolveCtx({}), shield), "Keys");
});

test("Resource Rewrite changes Resource-type keywords, not a card's affinity", () => {
  const state = game(880037);
  const shield = seed(state, 0, byName["Morgs, Signal Knight"].id);
  const gadaj = seed(state, 0, byName["Gadaj, Archive Maintainer"].id);
  for (const uid of [shield, gadaj]) {
    state.effects.push({
      id: `e-basic-word-${uid}`,
      kind: "wordRewrite",
      targetUid: uid,
      vocabulary: "basic",
      from: "Keys",
      to: "Power",
    });
  }
  const ctx = E.resolveCtx({});

  assert.equal(E.shieldedFrom(state, ctx, shield), "Power");
  assert.deepEqual(E.affinitiesOf(state, ctx, gadaj), ["Keys"]);
});

test("Affinity Rewrite changes an affinity-gated target filter", () => {
  let state = game(880039);
  const target = seed(state, 1, byName["Key Vault — Workshop"].id);
  const invalidation = seed(state, 0, byName["Power Invalidation"].id, {}, "wallet");
  state.effects.push({
    id: "e-affinity-filter",
    kind: "wordRewrite",
    targetUid: invalidation,
    vocabulary: "affinity",
    from: "Power",
    to: "Keys",
  });
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);

  const result = act(state, "PLAY_CARD", 0, {
    uid: invalidation,
    modes: [1],
    targets: [{ kind: "object", uid: target }],
  });

  assert.equal(result.error, null, JSON.stringify(result.error));
});

test("damage prevention reads a source's current affinity", () => {
  let state = game(880041);
  const zap = seed(
    state,
    0,
    byName.Zap.id,
    {},
    "wallet"
  );
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state.prevention = state.prevention || [];
  state.prevention.push({
    kind: "seat",
    seat: 1,
    uid: null,
    amount: 0,
    fromAffinity: "Signal",
    turn: state.turn.number,
  });
  const before = state.seats[1].uptime;
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: zap,
    targets: [{ kind: "seat", seat: 1 }],
  }));
  state.objects[state.queue.at(-1).objectUid].affinityOverride = ["Signal"];
  state = passUntil(state, (current) => !current.queue.length);

  assert.equal(state.seats[1].uptime, before);
});

test("Shielded checks a source's current affinity", () => {
  let state = game(880043);
  const target = seed(state, 1, byName["Morgs, Signal Knight"].id);
  const zap = seed(
    state,
    0,
    byName.Zap.id,
    {},
    "wallet"
  );
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: zap,
    targets: [{ kind: "object", uid: target }],
  }));
  state.objects[state.queue.at(-1).objectUid].affinityOverride = ["Keys"];
  state = passUntil(state, (current) => !current.queue.length);

  assert.ok(state.objects[target], "Shielded target was decommissioned by a prohibited source");
  assert.equal(state.objects[target].damage, 0);
});

test("Power Burst cannot choose a variable target Shielded from Power", () => {
  let state = game(880045);
  const target = seed(state, 1, byName["FLX, Culture Curator"].id);
  seed(state, 1, byName["Power Shield"].id, { attachedTo: target });
  const burst = seed(state, 0, byName["Power Burst"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);

  const result = act(state, "PLAY_CARD", 0, {
    uid: burst,
    x: 1,
    targets: [{ kind: "object", uid: target }],
  });

  assert.equal(result.error?.code, "ILLEGAL_TARGET");
});

test("Power Burst drops a variable target that becomes Shielded on the Queue", () => {
  let state = game(880047);
  const target = seed(state, 1, byName["FLX, Culture Curator"].id);
  const burst = seed(state, 0, byName["Power Burst"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  const uptimeBefore = state.seats[1].uptime;
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: burst,
    x: 4,
    targets: [{ kind: "seat", seat: 1 }, { kind: "object", uid: target }],
  }));
  seed(state, 1, byName["Power Shield"].id, { attachedTo: target });
  state = passUntil(state, (current) => !current.queue.length);

  assert.equal(state.seats[1].uptime, uptimeBefore - 4);
  assert.equal(state.objects[target].damage, 0);
});

test("attachment attack exceptions are read from the attached cards", () => {
  const state = game(880040);
  const delayed = seed(
    state,
    0,
    byName["FLX, Culture Curator"].id,
    { bootDelay: true }
  );
  seed(state, 0, byName["Instant Boot"].id, { attachedTo: delayed });

  const firewallCard = CARDS.find(
    (card) => card.type.includes("Avatar") && String(card.subtype).includes("Firewall")
  );
  assert.ok(firewallCard, "the catalog needs a Firewall Avatar fixture");
  const firewall = seed(state, 0, firewallCard.id);
  seed(state, 0, byName["Firmware for Firewalls"].id, { attachedTo: firewall });
  const ctx = E.resolveCtx({});

  assert.equal(E.canAttack({ state, ctx }, delayed), true, "Instant Boot did not lift Boot Delay");
  assert.equal(E.canAttack({ state, ctx }, firewall), true, "Firmware did not lift Firewall");
});

test("Toggle State flips a permanent's committed state", () => {
  let state = game(880050);
  const target = seed(state, 0, byName["Network Reset Disk"].id);
  const spell = seed(state, 0, byName["Toggle State"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, {
    uid: spell,
    targets: [{ kind: "object", uid: target }],
  }));
  state = passUntil(state, (current) => current.objects[target].committed);

  assert.equal(state.objects[target].committed, true);
});

test("Basalt Battery skips its own unlock while Memory Palace removes cleanup discard", () => {
  let state = game(880060);
  const basalt = seed(state, 0, byName["Basalt Battery"].id, { committed: true });
  seed(state, 0, byName["Memory Palace"].id);
  while (state.zones["0:wallet"].length < 10) {
    seed(state, 0, byName["Network Reset Disk"].id, {}, "wallet");
  }

  state.turn.active = 1;
  state.turn.phase = "close";
  state.turn.step = "endStep";
  state.priority.seat = 1;
  state.priority.passed = [false, false];
  state.awaiting = null;
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "open" && current.turn.step !== "unlock"
  );

  assert.equal(state.objects[basalt].committed, true, "Basalt unlocked normally");
  assert.equal(state.zones["0:wallet"].length, 10, "Memory Palace did not preserve the Wallet");
});

test("Fast Channel permits more than one Resource play in the same turn", () => {
  let state = game(880070);
  seed(state, 0, byName["Fast Channel"].id);
  const first = seed(state, 0, byName["Satoshi Orchard"].id, {}, "wallet");
  const second = seed(state, 0, byName["Satoshi Orchard"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );

  state = ok(act(state, "PLAY_RESOURCE", 0, { uid: first }));
  state = passUntil(state, (current) => current.queue.length === 0 && current.priority.seat === 0);
  state = ok(act(state, "PLAY_RESOURCE", 0, { uid: second }));
  assert.equal(state.turn.resourcePlays.used, 2);
});

test("Freedom Market discards both Wallets and gives both players seven new cards", () => {
  let state = game(880080);
  const market = seed(state, 0, byName["Freedom Market"].id, {}, "wallet");
  seed(state, 0, byName["Network Reset Disk"].id, {}, "wallet");
  seed(state, 1, byName["Network Reset Disk"].id, {}, "wallet");
  state = passUntil(state, (current) =>
    current.turn.active === 0 && current.turn.phase === "build1" && current.priority.seat === 0
  );
  fund(state, 0);
  state = ok(act(state, "PLAY_CARD", 0, { uid: market, targets: [] }));
  state = passUntil(state, (current) =>
    current.zones["0:wallet"].length === 7 && current.zones["1:wallet"].length === 7
  );

  assert.equal(state.zones["0:wallet"].length, 7);
  assert.equal(state.zones["1:wallet"].length, 7);
});
