/* site/arena3d-env.js — the room around the WebGL table, headless.
 *
 * A fake THREE (vectors, a scene graph that only counts children, buffer
 * attributes over real Float32Arrays, materials with a colour and an opacity)
 * is enough to prove the particle counts per tier, that embers respawn inside
 * the buffer, that packets never leave their trace, that reduced motion is a
 * still frame, that dispose is idempotent and that the affinity tints.
 *
 * Run: node --test tests/js/arena3d-env.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const SRC = fs.readFileSync(path.join(REPO, "site", "arena3d-env.js"), "utf8");

/* ---------------------------------------------------------------------- *
 * fake THREE                                                             *
 * ---------------------------------------------------------------------- */

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
class Color {
  constructor(hex = 0xffffff) { this.hex = hex; }
  setHex(h) { this.hex = h; return this; }
  getHex() { return this.hex; }
}
class Object3D {
  constructor() {
    this.position = new Vector3(); this.rotation = { x: 0, y: 0, z: 0 }; this.scale = new Vector3(1, 1, 1);
    this.visible = true; this.children = []; this.parent = null; this.renderOrder = 0; this.name = "";
  }
  add(...list) { for (const o of list) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
}
class Group extends Object3D {}
class Scene extends Object3D {}
class Material {
  constructor(p = {}) { Object.assign(this, { opacity: 1, transparent: false, map: null }, p); this.color = new Color(typeof p.color === "number" ? p.color : 0xffffff); this.disposed = false; }
  dispose() { this.disposed = true; }
}
class SpriteMaterial extends Material {}
class MeshBasicMaterial extends Material {}
class PointsMaterial extends Material {}
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; }
  setUsage() { return this; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
}
class Float32BufferAttribute extends BufferAttribute { constructor(a, n) { super(a instanceof Float32Array ? a : new Float32Array(a), n); } }
class BufferGeometry {
  constructor() { this.attributes = {}; this.drawRange = { start: 0, count: Infinity }; this.disposed = false; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  setDrawRange(start, count) { this.drawRange = { start, count }; }
  dispose() { this.disposed = true; }
}
class CylinderGeometry extends BufferGeometry {
  constructor(rt, rb, height, radial, rows) {
    super();
    const pos = [];
    for (let r = 0; r <= rows; r++) for (let s = 0; s <= radial; s++) pos.push(0, height / 2 - (r / rows) * height, 0);
    this.setAttribute("position", new Float32BufferAttribute(pos, 3));
  }
}
class Sprite extends Object3D { constructor(material) { super(); this.material = material; } }
class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class Points extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }

const THREE = {
  Vector3, Color, Object3D, Group, Scene, Sprite, Mesh, Points, SpriteMaterial, MeshBasicMaterial, PointsMaterial,
  BufferGeometry, BufferAttribute, Float32BufferAttribute, CylinderGeometry,
  AdditiveBlending: 2, BackSide: 1, DynamicDrawUsage: 35048,
};

/* ---------------------------------------------------------------------- *
 * fake arena                                                             *
 * ---------------------------------------------------------------------- */

function load() {
  delete globalThis.E1Arena3DEnv;
  new Function(SRC)();
  return globalThis.E1Arena3DEnv;
}

/* The slab's traces as arena3d.js exports them: three bent runs on the top face. */
const TRACES = [
  [{ x: -7.5, z: -4.5 }, { x: -7.5, z: -2.6 }, { x: -6.6, z: -1.7 }, { x: -6.6, z: -0.6 }],
  [{ x: 7.5, z: -4.5 }, { x: 7.5, z: -2.6 }, { x: 6.6, z: -1.7 }, { x: 6.6, z: -0.6 }],
  [{ x: -7.5, z: 4.5 }, { x: -5.6, z: 4.5 }, { x: -4.7, z: 3.6 }, { x: -2.5, z: 3.6 }],
  [{ x: 7.5, z: 4.5 }, { x: 5.6, z: 4.5 }, { x: 4.7, z: 3.6 }, { x: 2.5, z: 3.6 }],
  [{ x: -6.1, z: -4.5 }, { x: -6.1, z: -3.9 }, { x: -5.6, z: -3.4 }, { x: -5.6, z: -2.4 }],
];

function harness({ tier = "high", reduced = false, hidden = false, affinity = "Power", traces = TRACES } = {}) {
  const scene = new Scene();
  const calls = { render: 0 };
  const plate = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0x8c8fa0 }));
  const glow = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0xffffff }));
  const key = { intensity: 420 };
  const parallax = { x: 0, y: 0 };
  const arena = {
    world: {
      THREE, scene, quality: { tier }, plate, glow, lights: { key }, parallax, traces,
      layout: { BOARD: { width: 16, depth: 10, thickness: 0.4 } },
      requestFrame: () => { calls.render++; },
    },
  };
  const ENV = load();
  const state = { reduced, hidden };
  globalThis.document = { get hidden() { return state.hidden; }, addEventListener() {}, removeEventListener() {} };
  const env = ENV.attach(arena, { affinity, reduced: () => state.reduced });
  let time = 0;
  const step = (s) => { time += s; env.tick(s, time); };
  return { ENV, env, arena, scene, plate, glow, key, parallax, calls, state, step, time: () => time };
}

/* Distance from (x,z) to the nearest segment of a polyline. */
function distanceToPolyline(x, z, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
    const k = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + dx * k), z - (a.z + dz * k)));
  }
  return best;
}

/* ---------------------------------------------------------------------- *
 * tests                                                                  *
 * ---------------------------------------------------------------------- */

test("exposes attach and a shim; attach without a scene answers the shim", () => {
  const h = harness();
  assert.equal(typeof h.ENV.attach, "function");
  const shim = h.ENV.attach(null);
  assert.equal(shim.animating(), false);
  assert.doesNotThrow(() => { shim.tick(0.016, 1); shim.setAffinity("Keys"); shim.quality("high"); shim.dispose(); });
  assert.equal(shim.stats().embers, 0);
  assert.ok(h.scene.children.some((c) => c.name === "env"), "the env group joined the scene");
});

test("particle counts per tier: 240/120/40 embers, fog 3/3/0, packets 8/6/4 capped by the traces", () => {
  const h = harness({ tier: "high" });
  assert.deepEqual([h.env.stats().embers, h.env.stats().fog, h.env.stats().packets], [240, 3, 5]);
  h.env.quality("mid");
  assert.deepEqual([h.env.stats().embers, h.env.stats().fog, h.env.stats().packets], [120, 3, 5]);
  h.env.quality("low");
  assert.deepEqual([h.env.stats().embers, h.env.stats().fog, h.env.stats().packets], [40, 0, 4]);
  assert.equal(h.env.inspect().fog.every((f) => f.visible === false), true, "no haze in tier low");
  h.env.quality({ tier: "high" });
  assert.equal(h.env.stats().embers, 240);
  const ten = harness({ traces: TRACES.concat(TRACES) });
  assert.equal(ten.env.stats().packets, 8, "eight packets when the traces allow");
});

test("embers rise, respawn at the bottom and never leave the buffer", () => {
  const h = harness();
  const { emberPositions, emberCount } = h.env.inspect();
  assert.equal(emberPositions.length, h.ENV.EMBER.max * 3);
  assert.equal(emberCount, 240);
  const before = Array.from(emberPositions);
  let respawns = 0;
  for (let i = 0; i < 600; i++) {
    const prev = Float32Array.from(emberPositions);
    h.step(0.1);
    for (let p = 0; p < emberCount; p++) {
      const y = emberPositions[p * 3 + 1];
      assert.ok(Number.isFinite(y) && y >= -9 - 1e-6 && y <= 3.5 + 0.05, "ember " + p + " stays inside the void: " + y);
      if (y < prev[p * 3 + 1]) { respawns++; assert.ok(Math.abs(y - -9) < 1e-6, "a respawn starts at the bottom"); }
      assert.ok(Math.abs(emberPositions[p * 3]) <= 15.5, "x stays beside or behind the slab");
    }
  }
  assert.ok(respawns > 0, "sixty seconds is long enough for a respawn");
  assert.notDeepEqual(Array.from(emberPositions), before, "the field moved");
  assert.equal(h.env.inspect().emberPositions, emberPositions, "the same buffer, updated in place");
  assert.ok(h.env.inspect().emberColors.some((v) => v > 0), "the embers glow");
});

test("packets stay on their polyline, one per trace, and fade at the ends", () => {
  const h = harness();
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    h.step(0.033);
    const live = h.env.inspect().packets.filter((p) => p.active);
    const used = new Set();
    for (const p of live) {
      assert.ok(!used.has(p.trace), "one packet per trace");
      used.add(p.trace);
      assert.ok(distanceToPolyline(p.x, p.z, TRACES[p.trace]) < 1e-6, "packet lies on trace " + p.trace);
      assert.equal(p.y, h.ENV.PACKET.lift, "packet floats just above the slab top");
      assert.ok(p.opacity >= 0 && p.opacity <= 0.95);
      if (p.s < 0.05) assert.ok(p.opacity < 0.2, "faded in at the start");
      seen++;
    }
  }
  assert.ok(seen > 0);
  assert.ok(h.env.stats().packetsLive <= 5);
});

test("reduced motion: animating() is false, tick is a no-op, no packets", () => {
  const h = harness({ reduced: true });
  assert.equal(h.env.animating(), false);
  const before = Float32Array.from(h.env.inspect().emberPositions);
  const fogX = h.env.inspect().fog.map((f) => f.x);
  h.step(0.5); h.step(0.5);
  assert.deepEqual(Array.from(h.env.inspect().emberPositions), Array.from(before), "nothing moved");
  assert.deepEqual(h.env.inspect().fog.map((f) => f.x), fogX);
  assert.equal(h.env.inspect().packets.every((p) => !p.active && !p.visible), true);
  assert.equal(h.key.intensity, 420, "the key light holds");
  h.state.reduced = false;
  assert.equal(h.env.animating(), true, "the toggle wakes it");
  h.state.hidden = true;
  assert.equal(h.env.animating(), false, "a hidden tab pauses it");
});

test("breathing: the plate, the glow and the key light move a little and are restored on dispose", () => {
  const h = harness();
  let minKey = Infinity, maxKey = -Infinity, plates = new Set(), glows = new Set();
  for (let i = 0; i < 300; i++) {
    h.step(0.05);
    minKey = Math.min(minKey, h.key.intensity); maxKey = Math.max(maxKey, h.key.intensity);
    plates.add(h.plate.material.color.getHex());
    glows.add(h.glow.material.color.getHex());
  }
  assert.ok(minKey >= 420 * 0.96 && maxKey <= 420 * 1.04, "flicker within ±3 %: " + minKey + " " + maxKey);
  assert.ok(maxKey - minKey > 1, "the key light does flicker");
  assert.ok(plates.size > 4, "the plate breathes");
  assert.ok(glows.size > 4 && glows.has(0xffffff), "the queue glow breathes down from full");
  assert.ok([...glows].every((hex) => (hex & 255) >= Math.round(255 * 0.76)), "and never below 76 %");
  h.env.dispose();
  assert.equal(h.key.intensity, 420);
  assert.equal(h.plate.material.color.getHex(), 0x8c8fa0);
  assert.equal(h.glow.material.color.getHex(), 0xffffff);
});

test("dispose is idempotent, removes the group and disposes every material and geometry", () => {
  const h = harness();
  const group = h.env.group;
  const mats = [], geos = [];
  const walk = (o) => { if (o.material) mats.push(o.material); if (o.geometry) geos.push(o.geometry); o.children.forEach(walk); };
  walk(group);
  assert.ok(mats.length >= 12 && geos.length >= 2);
  h.env.dispose();
  h.env.dispose();
  assert.equal(h.scene.children.includes(group), false);
  assert.ok(mats.every((m) => m.disposed) && geos.every((g) => g.disposed));
  assert.equal(h.env.animating(), false);
  assert.doesNotThrow(() => { h.env.tick(0.016, 1); h.env.setAffinity("Keys"); h.env.quality("low"); });
  assert.equal(h.env.stats().disposed, true);
});

test("setAffinity tints the cyclorama with the Plate palette; unknown names fall back to brass", () => {
  const h = harness({ affinity: "Power" });
  const power = h.env.inspect().cyclorama.tint;
  h.env.setAffinity("Signal");
  const signal = h.env.inspect().cyclorama.tint;
  assert.notEqual(power, signal);
  h.env.setAffinity("Timelock");
  assert.notEqual(h.env.inspect().cyclorama.tint, signal);
  h.env.setAffinity("Power");
  assert.equal(h.env.inspect().cyclorama.tint, power, "deterministic per affinity");
  h.env.setAffinity("nonsense");
  assert.equal(h.env.stats().affinity, "neutral");
  h.env.setAffinity("s");
  assert.equal(h.env.stats().affinity, "signal");
  assert.equal(h.env.inspect().cyclorama.tint, signal);
  const b = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  for (const hex of [power, signal]) assert.ok(Math.max(...b(hex)) <= 130, "dimmed to ~45 %: " + hex.toString(16));
});

test("the cyclorama follows the pointer parallax at 30 % and the fog drifts sideways", () => {
  const h = harness();
  h.parallax.x = 1; h.parallax.y = 0.5;
  h.step(0.016);
  assert.ok(Math.abs(h.env.inspect().cyclorama.rotationY - 1.2 * Math.PI / 180 * 0.3) < 1e-9);
  const x0 = h.env.inspect().fog.map((f) => f.x);
  for (let i = 0; i < 20; i++) h.step(0.05); // one second of frames (a frame is clamped to 100 ms)
  const x1 = h.env.inspect().fog.map((f) => f.x);
  const moved = x1.map((x, i) => Math.abs(x - x0[i]));
  assert.ok(moved.every((d) => d >= 0.02 - 1e-9 && d <= 0.05 + 1e-9), "0.02–0.05 units per second: " + moved.join(","));
  assert.ok(h.env.inspect().fog.every((f) => f.opacity >= 0.08 && f.opacity <= 0.18));
});
