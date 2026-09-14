/* site/arena3d-layout.js — the WebGL table's geometry, in world units.
 *
 * The property worth testing is the arc law: for every zone and every row
 * length a table can hold, the slots lie on a circle of radius ≤ 40 world
 * units (chord²/8·sagitta), the row is mirror-symmetric, and a hand of up to
 * eight cards never has two cards on the same spot. planSync is tested as a
 * diff: two successive engine views, enter/move/leave/stay must match exactly
 * what play.js's render() would rebuild.
 *
 * Run: node --test tests/js/arena3d-layout.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const L = require(path.join(REPO, "site", "arena3d-layout.js"));

const ARC_ZONES = ["youHand", "foeHand", "youNetwork", "youResources", "foeNetwork", "foeResources", "queue"];

/* chord²/(8·sagitta) of a row, measured on the zone's bow axis, plus the
 * circumradius of (first, middle, last) — three points of one circle name it. */
function arcRadius(slots, axis) {
  const first = slots[0], last = slots[slots.length - 1];
  const mid = slots[Math.floor(slots.length / 2)];
  const dx = last.x - first.x, dy = last[axis] - first[axis];
  const chord = Math.hypot(dx, dy);
  let sagitta = 0;
  for (const s of slots) sagitta = Math.max(sagitta, Math.abs((s.x - first.x) * dy - (s[axis] - first[axis]) * dx) / (chord || 1));
  const a = Math.hypot(mid.x - first.x, mid[axis] - first[axis]);
  const b = Math.hypot(last.x - mid.x, last[axis] - mid[axis]);
  const area = Math.abs((mid.x - first.x) * (last[axis] - first[axis]) - (mid[axis] - first[axis]) * (last.x - first.x)) / 2;
  return { chord, sagitta, radius: (chord * chord) / (8 * sagitta), circumradius: (a * b * chord) / (4 * area) };
}

test("arc law: every zone, n 2..9, radius = chord²/8·sagitta is finite and ≤ 40", () => {
  for (const id of ARC_ZONES) {
    const zone = L.ZONES[id];
    for (let n = 2; n <= 9; n++) {
      const slots = L.arcSlots(n, id);
      assert.equal(slots.length, n, `${id} n=${n}`);
      if (n === 2) continue; // two points make a chord; the circle shows from three
      const { chord, sagitta, radius, circumradius } = arcRadius(slots, zone.axis);
      assert.ok(chord > 0, `${id} n=${n} chord`);
      assert.ok(sagitta > 1e-6, `${id} n=${n} is a straight line (sagitta ${sagitta})`);
      assert.ok(radius <= 40 && radius > 0, `${id} n=${n} radius ${radius}`);
      // The slots lie on the zone's own circle.
      assert.ok(Math.abs(circumradius - zone.radius) < 1e-6, `${id} n=${n} off its circle (${circumradius})`);
    }
  }
});

test("networks bow toward the clash lane with sagitta ≥ 0.9 for seven tokens", () => {
  const you = L.arcSlots(7, "youNetwork");
  const foe = L.arcSlots(7, "foeNetwork");
  assert.ok(you[0].z - you[3].z >= 0.9, "own network: edges drop back toward the player");
  assert.ok(foe[3].z - foe[0].z >= 0.9, "foe network: edges drop back toward the foe");
  assert.ok(you[3].z > 0 && foe[3].z < 0, "the middle slots face each other across the queue");
});

test("hand fan: eight cards overlap by at most half a card, the middle card is the high one, edges roll outward", () => {
  /* A held fan overlaps on purpose (the cards are big and near the camera);
   * what must never happen is a card hiding more than half of its neighbour. */
  for (let n = 2; n <= 8; n++) {
    const slots = L.arcSlots(n, "youHand");
    for (let i = 1; i < n; i++) {
      const gap = Math.hypot(slots[i].x - slots[i - 1].x, slots[i].y - slots[i - 1].y);
      assert.ok(gap >= L.CARD.width * slots[i].scale * 0.5 - 1e-9, `n=${n} cards ${i - 1},${i} hide each other (gap ${gap})`);
    }
  }
  const fan = L.arcSlots(7, "youHand");
  assert.ok(fan[3].y > fan[0].y && fan[3].y > fan[6].y, "edges drop away");
  // depthBow: the middle slot is the nearest to the camera as well as the highest, so
  // the middle cards no longer read smaller than the edges; monotonic toward the middle.
  assert.ok(fan[3].z > fan[0].z && fan[3].z > fan[6].z, "the middle slot is the nearest (+z)");
  assert.ok(Math.abs(fan[3].z - (L.ZONES.youHand.centre[2] + L.ZONES.youHand.depthBow)) < 1e-9, "middle = centre + depthBow");
  for (let i = 1; i <= 3; i++) assert.ok(fan[i].z > fan[i - 1].z && fan[i].y > fan[i - 1].y, `slot ${i} is nearer and higher than ${i - 1}`);
  for (let n = 2; n <= 9; n++) for (const s of L.arcSlots(n, "youHand")) assert.ok(s.z >= L.ZONES.youHand.centre[2] - 1e-9, `n=${n} never behind the centre`);
  assert.equal(L.arcSlots(5, "foeHand")[2].z, L.ZONES.foeHand.centre[2], "a fan without depthBow keeps its z");
  assert.ok(fan[0].roll > 0 && fan[6].roll < 0 && fan[3].roll === 0, "the fan rolls outward");
  assert.ok(L.arcSlots(12, "youHand")[1].x - L.arcSlots(12, "youHand")[0].x < L.CARD.width, "past the chord the fan compresses");
});

test("symmetry: every row mirrors in x, roll and yaw about the middle", () => {
  for (const id of ARC_ZONES) {
    for (const n of [2, 5, 8]) {
      const slots = L.arcSlots(n, id);
      const yaw0 = L.ZONES[id].yaw || 0;
      for (let i = 0; i < n; i++) {
        const a = slots[i], b = slots[n - 1 - i];
        assert.ok(Math.abs(a.x + b.x) < 1e-9, `${id} n=${n} x`);
        assert.ok(Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.z - b.z) < 1e-9, `${id} n=${n} bow`);
        assert.ok(Math.abs(a.roll + b.roll) < 1e-9, `${id} n=${n} roll`);
        assert.ok(Math.abs((a.yaw - yaw0) + (b.yaw - yaw0)) < 1e-9, `${id} n=${n} yaw`);
      }
    }
  }
});

test("portrait narrows the fan; stacks and single cards sit on the zone centre", () => {
  const wide = L.arcSlots(7, "youHand");
  const tall = L.arcSlots(7, "youHand", "portrait");
  assert.ok(tall[6].x - tall[0].x < wide[6].x - wide[0].x);
  for (const id of ["youDeck", "foeDeck", "youArchive", "foeArchive"]) {
    const [slot] = L.arcSlots(3, id);
    assert.deepEqual([slot.x, slot.y, slot.z], L.ZONES[id].centre);
  }
  const [one] = L.arcSlots(1, "queue");
  assert.deepEqual([one.x, one.y, one.z], L.ZONES.queue.centre);
  assert.deepEqual(L.arcSlots(0, "queue"), []);
  assert.deepEqual(L.arcSlots(3, "nope"), []);
});

/* ---- planSync ------------------------------------------------------------
 * A view the way E.view() shapes it: own wallet as uids, the foe wallet as
 * shells, both networks as uids, the queue as items. */
const isAvatar = (id) => id.startsWith("A");
function view(spec) {
  const objects = {};
  const zones = {};
  const add = (key, uids, extra) => {
    zones[key] = uids;
    for (const uid of uids) objects[uid] = Object.assign({ uid, cardId: uid.replace(/\d+$/, "-card"), committed: false, facedown: false, damage: 0, token: false }, extra && extra[uid]);
  };
  add("0:wallet", spec.hand || [], spec.extra);
  zones["1:wallet"] = (spec.foeHand || []).map((uid) => uid); // shells carry no cardId
  for (const uid of spec.foeHand || []) objects[uid] = { uid, owner: 1, zone: "wallet" };
  add("0:network", spec.net || [], spec.extra);
  add("1:network", spec.foeNet || [], spec.extra);
  zones["0:stack"] = { n: 20 };
  zones["1:stack"] = { n: 20 };
  return { zones, objects, queue: spec.queue || [] };
}

test("planSync: kinds and zones follow render() — hand cards, foe backs, tokens vs flat cards, queue", () => {
  const v = view({
    hand: ["o1", "o2"], foeHand: ["o8", "o9", "o10"],
    net: ["A3", "H4", "A5"], foeNet: ["A6", "R7"],
    queue: [{ qid: "q1", cardId: "E1-050", controller: 1 }],
    extra: { A5: { committed: true } },
  });
  const plan = L.planSync(null, v, 0, { isAvatar });
  const by = Object.fromEntries(plan.placements.map((p) => [p.uid, p]));
  assert.deepEqual(plan.leave, []);
  assert.equal(plan.enter.length, plan.placements.length);
  assert.equal(by.o1.zone, "youHand"); assert.equal(by.o1.kind, "card"); assert.equal(by.o1.count, 2);
  assert.equal(by["foe-hand-2"].zone, "foeHand"); assert.equal(by["foe-hand-2"].kind, "back"); assert.equal(by["foe-hand-2"].count, 3);
  assert.equal(by.A3.zone, "youNetwork"); assert.equal(by.A3.kind, "token"); assert.equal(by.A3.count, 2);
  assert.equal(by.A5.index, 1); assert.equal(by.A5.committed, true);
  assert.equal(by.H4.zone, "youResources"); assert.equal(by.H4.kind, "card"); assert.equal(by.H4.count, 1);
  assert.equal(by.A6.zone, "foeNetwork"); assert.equal(by.R7.zone, "foeResources");
  assert.equal(by["queue:q1"].zone, "queue"); assert.equal(by["queue:q1"].kind, "queue"); assert.equal(by["queue:q1"].cardId, "E1-050");
  assert.equal(Object.keys(by).length, 2 + 3 + 3 + 2 + 1);
});

test("planSync: tokens and masked deploys are tokens whatever the card says", () => {
  const v = view({ net: ["H1", "H2"], extra: { H1: { token: true }, H2: { facedown: true, cardId: null } } });
  const plan = L.planSync(null, v, 0, { isAvatar });
  for (const p of plan.placements) assert.equal(p.kind, "token", p.uid);
});

test("planSync: enter / move / leave / stay across two views, and a foe hand that shrinks", () => {
  const a = view({ hand: ["o1", "o2", "o3"], foeHand: ["s1", "s2", "s3", "s4"], net: ["A4"], foeNet: ["A6"] });
  const first = L.planSync(null, a, 0, { isAvatar });
  // o2 was played: it leaves the hand as o2 and enters the network as o12 (the engine mints uids).
  const b = view({ hand: ["o1", "o3"], foeHand: ["s1", "s2", "s3"], net: ["A4", "A12"], foeNet: ["A6"] });
  const second = L.planSync(first.next, b, 0, { isAvatar });
  assert.deepEqual(second.enter.map((p) => p.uid), ["A12"]);
  assert.deepEqual(second.leave.sort(), ["foe-hand-3", "o2"]);
  const moved = second.move.map((p) => p.uid).sort();
  // hand: o1/o3 keep their uids but the row shrank (count 3 → 2) — both move;
  // foe hand: three shells stay in place but their count changed — they move;
  // A4 gained a neighbour (count 1 → 2) — it moves. A6 is exactly where it was.
  assert.deepEqual(moved, ["A4", "foe-hand-0", "foe-hand-1", "foe-hand-2", "o1", "o3"]);
  assert.deepEqual(second.stay.map((p) => p.uid), ["A6"]);
  assert.equal(second.next.size, 2 + 3 + 2 + 1);
  // Idempotent: the same view again is all stay.
  const third = L.planSync(second.next, b, 0, { isAvatar });
  assert.equal(third.enter.length + third.move.length + third.leave.length, 0);
  assert.equal(third.stay.length, second.next.size);
});

test("planSync: the caller's foe hand count wins over the view, seat 1 mirrors, spectators get backs", () => {
  const v = view({ hand: ["o1"], foeHand: ["s1", "s2"] });
  const forced = L.planSync(null, v, 0, { isAvatar, foeHandCount: 5 });
  assert.equal(forced.placements.filter((p) => p.zone === "foeHand").length, 5);
  // Seat 1 sees 1:wallet as its own hand — here that is the shell list, which renders as backs.
  const mirrored = L.planSync(null, v, 1, { isAvatar });
  assert.deepEqual(mirrored.placements.filter((p) => p.zone === "youHand").map((p) => p.kind), ["back", "back"]);
  assert.equal(mirrored.placements.filter((p) => p.zone === "foeHand").length, 1);
  const spectator = L.planSync(null, { zones: { "0:wallet": { n: 3 }, "1:wallet": { n: 2 } }, objects: {}, queue: [] }, 0);
  assert.deepEqual(spectator.placements.map((p) => p.uid), ["you-hand-0", "you-hand-1", "you-hand-2", "foe-hand-0", "foe-hand-1"]);
  // A plain object also serves as prev.
  const again = L.planSync(Object.fromEntries(forced.next), v, 0, { isAvatar, foeHandCount: 5 });
  assert.equal(again.stay.length, 6);
});

test("planSync: the default Avatar test reads E1_CARDS", () => {
  globalThis.E1_CARDS = [{ id: "X-1", type: "Hardware Avatar" }, { id: "X-2", type: "Protocol" }];
  try {
    const v = { zones: { "0:network": ["a", "b"] }, objects: { a: { uid: "a", cardId: "X-1" }, b: { uid: "b", cardId: "X-2" } } };
    const plan = L.planSync(null, v, 0);
    assert.deepEqual(plan.placements.map((p) => p.kind), ["token", "card"]);
  } finally {
    delete globalThis.E1_CARDS;
  }
});

/* ---- quality ------------------------------------------------------------- */
test("quality: tiers by the 75th percentile frame, mobile caps at mid, dpr caps 2/1.5/1, shadows off low", () => {
  const fast = Array.from({ length: 40 }, () => 6);
  const okay = Array.from({ length: 40 }, () => 13);
  const slow = Array.from({ length: 40 }, (_, i) => (i < 8 ? 5 : 30));
  assert.deepEqual(L.quality({ frameMs: fast, dpr: 3 }), { tier: "high", dpr: 2, shadows: true, particleCap: 360 });
  assert.deepEqual(L.quality({ frameMs: okay, dpr: 2 }), { tier: "mid", dpr: 1.5, shadows: true, particleCap: 180 });
  assert.deepEqual(L.quality({ frameMs: slow, dpr: 2 }), { tier: "low", dpr: 1, shadows: false, particleCap: 48 });
  assert.equal(L.quality({ frameMs: fast, dpr: 3, isMobile: true }).tier, "mid");
  assert.equal(L.quality({ frameMs: fast, dpr: 3, isMobile: true }).dpr, 1.5);
  assert.equal(L.quality({ frameMs: fast, dpr: 1, reduced: true }).particleCap, 24);
  assert.equal(L.quality({}).tier, "high");
  assert.equal(L.quality({ isMobile: true }).tier, "mid");
  assert.equal(L.quality({ frameMs: [NaN, -1, 4], dpr: 0.5 }).dpr, 1);
});

/* ---- projectRect --------------------------------------------------------- */
test("projectRect: NDC corners to a viewport rectangle, y down, any corner order, offset honoured", () => {
  const vp = { width: 800, height: 600 };
  assert.deepEqual(L.projectRect([[-1, 1], [1, 1], [1, -1], [-1, -1]], vp), { left: 0, top: 0, width: 800, height: 600 });
  assert.deepEqual(L.projectRect([[0, 0], [0.5, 0.5]], vp), { left: 400, top: 150, width: 200, height: 150 });
  assert.deepEqual(L.projectRect([{ x: 0.5, y: 0.5 }, { x: 0, y: 0 }], vp), { left: 400, top: 150, width: 200, height: 150 });
  assert.deepEqual(L.projectRect([[0, 0]], { width: 800, height: 600, left: 10, top: 20 }), { left: 410, top: 320, width: 0, height: 0 });
  assert.deepEqual(L.projectRect([], vp), { left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual(L.projectRect([[NaN, 0], [0.25, -0.5]], vp), { left: 500, top: 450, width: 0, height: 0 });
});

/* ---- cameraFor ----------------------------------------------------------- */
test("cameraFor: fov 42, tilt 36° landscape / 48° portrait, and every zone lands inside the frame", () => {
  for (const aspect of [16 / 9, 1.3, 0.5]) {
    const cam = L.cameraFor(aspect);
    assert.equal(cam.fov, 42);
    assert.equal(cam.portrait, aspect < 0.9);
    assert.ok(Math.abs(cam.tilt - (cam.portrait ? 48 : 36) * (Math.PI / 180)) < 1e-9);
    const project = L.projector(cam.position, cam.target, cam.fov, aspect);
    for (const id of Object.keys(L.ZONES)) {
      if (cam.portrait && /Deck|Archive/.test(id)) continue; // a phone crops the slab's margins
      for (const slot of L.arcSlots(7, id, cam.mode)) {
        const ndc = project([slot.x, slot.y, slot.z]);
        assert.ok(ndc && Math.abs(ndc[0]) < 1 && Math.abs(ndc[1]) < 1, `${id} at aspect ${aspect.toFixed(2)} is off screen`);
      }
    }
  }
  // Nearer rows sit lower on screen: hand below resources below network below queue.
  const cam = L.cameraFor(1.4);
  const project = L.projector(cam.position, cam.target, cam.fov, 1.4);
  const ys = ["youHand", "youResources", "youNetwork", "queue", "foeNetwork", "foeResources", "foeHand"]
    .map((id) => project(Object.values(L.arcSlots(1, id)[0]).slice(0, 3))[1]);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1] + 0.04, `rows collide at ${i}`);
});
