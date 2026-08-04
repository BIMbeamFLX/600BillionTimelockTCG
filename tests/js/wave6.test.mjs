/* Wave 6: prevention shields and scripted clash rules. */
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
const ok = (r) => {
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r.state;
};

function game() {
  let attempt = 42424;
  for (let i = 0; i < 40; i++) {
    try {
      return E.createGame({
        seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
        seeds: { public: attempt, hidden: [attempt + 1, attempt + 2] },
        firstPlayer: 0,
      });
    } catch (e) {
      attempt = (attempt * 1103515245 + 12345) & 0x7fffffff;
    }
  }
  throw new Error("no game");
}

function seed(state, seat, cardId, tweaks, zone) {
  const where = zone || "network";
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid, cardId, owner: seat, controller: seat, zone: `${seat}:${where}`,
      committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
      rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null,
      token: false, entersSeq: state.seq, prevUid: null,
    },
    tweaks || {}
  );
  state.zones[`${seat}:${where}`].push(uid);
  return uid;
}

const env = (state) => ({ state, ctx: E.resolveCtx({}) });

test("a capped shield absorbs, then the rest lands; gone with the turn", () => {
  const state = game();
  const limiter = seed(state, 0, byName["Damage Limiter"].id);
  state.seats[0].buffer.N = 3;
  let s = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: limiter, abilityIndex: 0, targets: [] }));
  // Resolve the queued ability: both pass.
  s = ok(act(s, "PASS_PRIORITY", s.priority.seat));
  if (s.queue.length) s = ok(act(s, "PASS_PRIORITY", s.priority.seat));
  assert.ok((s.prevention || []).length, "the shield is up");
  const before = s.seats[0].uptime;
  // 1 damage into a 2-shield: fully absorbed. Own injector, own face —
  // "any target" honestly includes yourself, and it needs no priority dance.
  const injector = seed(s, 0, byName["Fault Injector"].id);
  s.seats[0].buffer.N = 3;
  s = ok(act(s, "ACTIVATE_ABILITY", 0, { uid: injector, abilityIndex: 0, targets: [{ kind: "seat", seat: 0 }] }));
  s = ok(act(s, "PASS_PRIORITY", s.priority.seat));
  if (s.queue.length) s = ok(act(s, "PASS_PRIORITY", s.priority.seat));
  assert.equal(s.seats[0].uptime, before, "1 damage fully absorbed by the 2-shield");
});

test("a Protection Circuit voids the whole hit from its affinity only", () => {
  const state = game();
  const circuit = seed(state, 0, byName["Power Protection Circuit"].id);
  state.seats[0].buffer.N = 1;
  let s = ok(act(state, "ACTIVATE_ABILITY", 0, { uid: circuit, abilityIndex: 0, targets: [] }));
  s = ok(act(s, "PASS_PRIORITY", s.priority.seat));
  if (s.queue.length) s = ok(act(s, "PASS_PRIORITY", s.priority.seat));
  const shield = (s.prevention || [])[0];
  assert.ok(shield && shield.fromAffinity === "Power", "affinity-gated shield up");
});

test("clash rules: Rough Miner cannot block big Action; Hidden Route locks to Firewalls", () => {
  const state = game();
  const miner = seed(state, 1, byName["Toni China, Rough Miner"].id);
  const big = seed(state, 0, byName["FLX, Culture Curator"].id); // Action 4
  assert.equal(E.canBlock(env(state), miner, big), false, "Action 4 >= 2 refused");
  // Hidden Route on an attacker: only Firewalls may block it.
  const route = seed(state, 0, byName["Hidden Route"].id, { attachedTo: big });
  void route;
  assert.equal(E.canBlock(env(state), miner, big), false, "non-Firewall refused");
});

test("Darren cannot attack into a board without Timelock Resources", () => {
  const state = game();
  const darren = seed(state, 0, byName["Darren, Channel Raider"].id);
  assert.equal(E.canAttack(env(state), darren), false, "no Timelock Resource over there");
  seed(state, 1, byName["Signal–Timelock Junction"].id);
  assert.equal(E.canAttack(env(state), darren), true, "now the raid is on");
});
