/* site/arena3d-fx.js — motion & VFX for the WebGL table, headless.
 *
 * The module is a pure function of a clock: every tween, timer and particle
 * is a closed form of the scheduler's time, so a fake THREE (vectors, a
 * scene graph that only counts children, materials with an opacity) and a
 * pausable fake clock are enough to prove the timing of a strike, the
 * particle cap, the shatter's lifetime, and that reduced motion lands on the
 * same final positions with nothing in the air.
 *
 * Run: node --test tests/js/arena3d-fx.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const SRC = fs.readFileSync(path.join(REPO, "site", "arena3d-fx.js"), "utf8");

/* ---------------------------------------------------------------------- *
 * fake THREE                                                             *
 * ---------------------------------------------------------------------- */

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  lerpVectors(a, b, k) { return this.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
  lerp(v, k) { return this.lerpVectors(this, v, k); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { return this.set(q.x, q.y, q.z, q.w); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromAxisAngle(axis, angle) {
    const h = angle / 2, s = Math.sin(h);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }
  multiplyQuaternions(a, b) {
    return this.set(
      a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
      a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
      a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
      a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
  }
  multiply(q) { return this.multiplyQuaternions(this.clone(), q); }
  slerpQuaternions(a, b, k) {
    /* nlerp is enough for a headless test: exact at k = 0 and k = 1 */
    let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, s = d < 0 ? -1 : 1;
    const x = a.x + (b.x * s - a.x) * k, y = a.y + (b.y * s - a.y) * k, z = a.z + (b.z * s - a.z) * k, w = a.w + (b.w * s - a.w) * k;
    const l = Math.hypot(x, y, z, w) || 1;
    return this.set(x / l, y / l, z / l, w / l);
  }
}
class Object3D {
  constructor() {
    this.position = new Vector3(); this.quaternion = new Quaternion(); this.scale = new Vector3(1, 1, 1);
    this.visible = true; this.children = []; this.parent = null;
  }
  add(o) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
}
class Group extends Object3D {}
class Material {
  constructor() { this.opacity = 1; this.transparent = false; this.color = { hex: 0, setHex(h) { this.hex = h; } }; this.disposed = false; }
  clone() { const m = new this.constructor(); m.color.hex = this.color.hex; return m; }
  dispose() { this.disposed = true; }
}
class SpriteMaterial extends Material { constructor() { super(); this.isSpriteMaterial = true; } }
class MeshBasicMaterial extends Material {}
class Geometry { constructor() { this.disposed = false; } dispose() { this.disposed = true; } }
class PlaneGeometry extends Geometry {}
class RingGeometry extends Geometry {}
class Sprite extends Object3D { constructor(material) { super(); this.material = material; } }
class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
class PointLight extends Object3D { constructor(color, intensity, distance) { super(); this.color = color; this.intensity = intensity; this.distance = distance; } }

const THREE = {
  Vector3, Quaternion, Object3D, Group, Sprite, Mesh, SpriteMaterial, MeshBasicMaterial,
  PlaneGeometry, RingGeometry, PointLight, AdditiveBlending: 2, DoubleSide: 2
};

/* ---------------------------------------------------------------------- *
 * fake arena                                                             *
 * ---------------------------------------------------------------------- */

function load() {
  delete globalThis.E1Arena3DFx;
  delete globalThis.requestAnimationFrame;
  new Function(SRC)();
  return globalThis.E1Arena3DFx;
}

function harness({ cap = 96, reduced = false, materials = {} } = {}) {
  const clock = {
    t: 0, paused: false, pauses: 0, resumes: 0,
    get elapsed() { return this.t / 1000; },
    pause() { this.paused = true; this.pauses++; },
    resume() { this.paused = false; this.resumes++; },
    advance(ms) { if (!this.paused) this.t += ms; }
  };
  const reg = new Map();
  const calls = { shake: [], push: [], render: 0, setState: [] };
  const fxGroup = new Group();
  const arena = {
    world: { THREE, clock, scene: new Group(), group: { cards: new Group(), fx: fxGroup }, materials, quality: { particleCap: cap } },
    registry: { get: (uid) => reg.get(uid) },
    camera: { shake: (s, ms) => calls.shake.push([s, ms]), push: (z, ms) => calls.push.push([z, ms]), reset() {} },
    setState: (uid, st) => calls.setState.push([uid, st]),
    requestRender: () => { calls.render++; },
    reduced: () => reduced
  };
  function addCard(uid, zone, x, y, z, kind = "card") {
    const mesh = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
    mesh.position.set(x, y, z);
    arena.world.group.cards.add(mesh);
    const home = { position: new Vector3(x, y, z), quaternion: new Quaternion(), scale: 1 };
    reg.set(uid, { mesh, home, zone, kind });
    return mesh;
  }
  const FX = load();
  const fx = FX.attach(arena);
  let wall = 0;
  /* one frame: the wall clock always moves; the arena clock only when not paused */
  function step(ms) { clock.advance(ms); wall += ms; fx.update(wall); }
  const at = (m) => [m.position.x, m.position.y, m.position.z];
  const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
  return { FX, fx, arena, clock, reg, calls, fxGroup, addCard, step, at, near, wall: () => wall };
}

function fixture(opts) {
  const h = harness(opts);
  h.attacker = h.addCard("A", "youNetwork", 1.0, 0.05, 1.95, "token");
  h.target = h.addCard("T", "foeNetwork", 1.0, 0.05, -1.95, "token");
  h.hand = h.addCard("H", "youHand", -2.0, 0.42, 5.5);
  return h;
}

/* ---------------------------------------------------------------------- *
 * tests                                                                  *
 * ---------------------------------------------------------------------- */

test("exposes attach, a no-op shim, and the cue table; unknown and no-op cues return quickly", () => {
  const h = fixture();
  assert.equal(typeof h.FX.attach, "function");
  for (const name of h.FX.NOOP) assert.equal(h.fx.cue(name, { seat: 0 }), false, name + " is a no-op");
  assert.equal(h.fx.cue("not:a:cue", {}), false);
  assert.equal(h.fx.stats().tracks, 0);
  const shim = h.FX.attach(null);
  assert.equal(shim.cue("card:play", { uid: 1 }), false);
  assert.doesNotThrow(() => shim.hitStop(150));
  assert.doesNotThrow(() => shim.dispose());
});

test("attack:strike — anticipation, lunge to 85 %, contact at 150 ms, squash, hit-stop, recoil, return with overshoot", () => {
  const h = fixture();
  const home = h.at(h.attacker), tHome = h.at(h.target);
  assert.equal(h.fx.cue("attack:strike", { seat: 0, uid: "A", targetSeat: null, targetUid: "T", amount: 2 }), true);
  h.step(0);
  assert.ok(h.near(h.at(h.attacker), home), "at 0 ms the attacker has not moved");

  h.step(70); /* anticipation peak: 0.25 units away from the target (+z) */
  assert.ok(Math.abs(h.attacker.position.z - (1.95 + 0.25)) < 1e-6, "pulled back 0.25 units at 70 ms");
  assert.ok(h.attacker.scale.x < 1, "and gathers itself (scale < 1)");

  h.step(40); /* 110 ms: on the way in, past home already */
  assert.ok(h.attacker.position.z < 1.95, "lunging toward the target");
  assert.ok(h.attacker.position.z > 1.95 - 0.85 * 3.9, "not there yet");
  assert.equal(h.fx.stats().particles, 0, "nothing in the air before contact");
  assert.equal(h.clock.pauses, 0);

  h.step(40); /* t = 150: contact at 85 % of the way (z from 1.95 toward -1.95 = 3.9 units) */
  assert.ok(Math.abs(h.attacker.position.z - (1.95 - 0.85 * 3.9)) < 1e-6, "contact at 85 % of the distance");
  assert.equal(h.fx.stats().particles, h.FX.COUNT.burst, "40 burst sprites at contact");
  assert.equal(h.calls.shake.length, 1, "one camera shake");
  assert.ok(Math.abs(h.calls.shake[0][0] - (0.35 + 0.08 * 2)) < 1e-9, "shake = 0.35 + 0.08 per point of damage");
  assert.equal(h.clock.pauses, 1, "hit-stop pauses the arena clock");
  assert.equal(h.fx.frozen, true);
  assert.ok(Math.abs(h.attacker.scale.x / h.attacker.scale.y - 1.12 / 0.9) < 1e-6, "squashed on contact: x 1.12 / y 0.9");
  const visible = () => h.fxGroup.children.filter((o) => o.visible && o.material && o.geometry).length;
  assert.ok(visible() >= 2, "a shockwave ring and the target's flash are up");
  const atContact = h.at(h.attacker);

  h.step(50); /* frozen: the clock did not advance, nothing moved */
  assert.equal(h.clock.t, 150);
  assert.ok(h.near(h.at(h.attacker), atContact), "frozen attacker holds its contact pose");
  assert.ok(h.near(h.at(h.target), tHome), "the recoil waits for the thaw");
  assert.equal(h.fx.frozen, true);

  h.step(100); /* wall 300 = contact + hitStop: thaw */
  assert.equal(h.fx.frozen, false);
  assert.equal(h.clock.resumes, 1);

  h.step(16); /* the squash relaxes and the recoil starts */
  h.step(74); /* recoil peak at 90 ms after the thaw */
  assert.ok(Math.abs(h.target.position.z - (-1.95 - 0.45)) < 1e-6, "target recoils 0.45 units along the blow");
  assert.ok(Math.abs(h.attacker.scale.x - h.attacker.scale.y) < 1e-6, "the squash has relaxed after 60 ms");

  /* the return: 260 ms with a 6 % overshoot past home, then settled */
  let overshoot = 0;
  for (let t = 0; t < 260; t += 10) { h.step(10); overshoot = Math.max(overshoot, h.attacker.position.z - 1.95); }
  assert.ok(overshoot > 0.05 && overshoot < 0.5, "the return overshoots home a little (" + overshoot.toFixed(3) + ")");
  h.step(20);
  assert.ok(h.near(h.at(h.attacker), home), "attacker is home after the return");
  h.step(200);
  assert.ok(h.near(h.at(h.target), tHome), "target is home again");
  assert.equal(h.fx.isAnimating("A"), false);
  assert.equal(h.fx.isAnimating("T"), false);
  h.step(400);
  assert.equal(h.fx.stats().particles, 0, "the burst is gone");
  assert.equal(h.fx.stats().tracks, 0);
  assert.equal(visible(), 0, "ring, flash and shockwave returned to their pools");
});

test("a cue starts from the clock's now, not from the last frame the fx saw", () => {
  /* the arena's idle loop ticks the fx at half rate: the clock is ahead of T */
  const h = fixture();
  h.step(16);
  h.clock.advance(40); /* two frames the fx never saw */
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
  h.step(134); /* 134 ms after the cue: no contact yet */
  assert.equal(h.fx.stats().particles, 0, "no contact before 150 ms after the cue");
  assert.equal(h.fx.frozen, false);
  h.step(16); /* 150 */
  assert.equal(h.fx.stats().particles, h.FX.COUNT.burst, "contact exactly 150 ms after the cue");
});

test("a loss cued together with a strike waits for the contact (and the hit-stop) before it shows", () => {
  const h = fixture();
  const bars = () => h.fxGroup.children.filter((o) => o.visible && o.material && o.geometry && o.material.color.hex === 0xff4d3d).length;
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetSeat: 1, amount: 3 });
  h.fx.cue("damage:player", { seat: 1, amount: 3 });
  h.step(16);
  assert.equal(bars(), 0, "no red edge before the blow lands");
  assert.equal(h.calls.shake.length, 0);
  h.step(134); /* 150: contact — the deferred loss fires in the same frame, then the clock freezes */
  assert.ok(bars() >= 1, "the edge flashes at contact");
  assert.equal(h.calls.shake.length, 2, "the strike's shake and the loss's shake");
  const late = fixture();
  late.fx.cue("damage:player", { seat: 1, amount: 3 });
  late.step(0);
  assert.equal(late.fxGroup.children.filter((o) => o.visible && o.material && o.geometry).length, 1, "with no strike in flight the loss shows at once");
});

test("burst count 40 respects the particle cap; two strikes fit the pools without a cut", () => {
  const h = fixture({ cap: 360 });
  h.addCard("B", "youNetwork", -1, 0.05, 1.95, "token");
  h.addCard("U", "foeNetwork", -1, 0.05, -1.95, "token");
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
  h.fx.cue("attack:strike", { seat: 0, uid: "B", targetUid: "U" });
  h.step(150);
  assert.equal(h.fx.stats().particles, 2 * h.FX.COUNT.burst, "two full bursts in the air");
  assert.ok(h.FX.POOL.burst >= 2 * h.FX.COUNT.burst + 2 * h.FX.COUNT.sparks, "pool: two strikes plus two shatters' sparks");
  assert.ok(h.FX.POOL.shards >= 2 * h.FX.COUNT.shards, "pool: two shatters");
  const low = fixture({ cap: 30 });
  low.fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
  low.step(150);
  assert.equal(low.fx.stats().particles, 30, "the cap cuts the burst, never an allocation");
});

test("attack:strike on a seat lunges toward the defending edge and shakes harder", () => {
  const h = fixture();
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetSeat: 1, targetUid: null, amount: 9 });
  h.step(110);
  assert.ok(h.attacker.position.z < 1.95, "moved toward the foe edge (-z)");
  h.step(40);
  assert.ok(h.attacker.position.z < -2.5, "lands at the near edge of the foe side");
  assert.equal(h.calls.shake.length, 1);
  assert.equal(h.calls.shake[0][0], 0.9, "the shake caps at 0.9");
  assert.equal(h.fx.stats().particles, h.FX.COUNT.burst, "the same burst as on a token");
});

test("particles never exceed the tier's particleCap, across overlapping effects", () => {
  const h = fixture({ cap: 10 });
  h.addCard("B", "youNetwork", -1, 0.05, 1.95, "token");
  h.fx.cue("card:archive", { uid: "B" });          /* wants 24 shards + 16 sparks after the 90 ms burn-out */
  h.step(90);
  assert.equal(h.fx.stats().particles, 10);
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
  let peak = 0, seen = 0;
  for (let t = 0; t < 1200; t += 16) {
    h.step(16);
    const n = h.fx.stats().particles;
    peak = Math.max(peak, n);
    if (n > 0) seen++;
    assert.ok(n <= 10, "live particles " + n + " over the cap at " + t);
  }
  assert.equal(peak, 10);
  assert.ok(seen > 0);
  assert.equal(h.fx.stats().particles, 0, "everything returned to the pools");
});

test("shatter burns out for 90 ms, then hides the mesh and frees 24 shards + 16 sparks by 800 ms", () => {
  const h = fixture({ materials: { glow: new MeshBasicMaterial(), shard: new MeshBasicMaterial(), dust: new SpriteMaterial() } });
  const before = h.fx.stats().poolFree;
  const mat = h.target.material;
  mat.emissive = { hex: 0, setHex(x) { this.hex = x; } };
  h.reg.get("T").parts = { front: h.target };
  h.fx.cue("avatar:decommission", { uid: "T" });
  assert.equal(h.target.visible, true, "the mesh is still there for the burn-out");
  assert.equal(h.fx.stats().particles, 0);
  h.step(45);
  assert.equal(mat.emissive.hex, 0xff6a00, "the face glows ember");
  assert.ok(mat.emissiveIntensity > 0.5, "and the glow climbs");
  assert.ok(h.target.scale.x > 1, "the mesh pops a little");
  h.step(45); /* 90 ms: the burn-out ends */
  assert.equal(h.target.visible, false, "the mesh is gone");
  assert.equal(h.fx.stats().particles, h.FX.COUNT.shards + h.FX.COUNT.sparks, "24 shards + 16 sparks");
  h.step(16);
  const shards = h.fxGroup.children.filter((o) => o.visible && o.geometry);
  assert.equal(shards.length, 24);
  const sparks = h.fxGroup.children.filter((o) => o.visible && !o.geometry && o.material);
  assert.equal(sparks.length, 16);
  const y0 = shards[0].position.y, sy0 = sparks[0].position.y;
  h.step(300);
  assert.ok(shards[0].position.y !== y0, "shards fall");
  assert.ok(sparks[0].position.y > sy0, "sparks rise");
  assert.ok(shards[0].material.opacity < 1 && shards[0].material.opacity > 0, "shards fade");
  assert.ok(shards[0].quaternion.w !== 1, "shards spin");
  h.step(400); /* 806 ms after the cue */
  assert.equal(h.fx.stats().particles, 0, "everything freed by 800 ms");
  assert.equal(h.fx.stats().poolFree, before);
  assert.equal(h.fxGroup.children.filter((o) => o.visible && o.material).length, 0);
});

test("card:play flies from the hand in an arc, flips from the fan's pitch, grows at the apex, slams, 18 dust sprites", () => {
  const h = fixture();
  h.addCard("Q", "queue", 0, 0.86, 0.1, "queue");
  const home = h.at(h.reg.get("Q").mesh);
  h.fx.cue("card:play", { seat: 0, uid: "Q", cardType: "Avatar" });
  h.step(0);
  const q = h.reg.get("Q").mesh;
  const start = h.at(q);
  assert.ok(!h.near(start, home), "starts away from the slot");
  assert.ok(start[2] > home[2], "starts on the own side (+z)");
  assert.ok(q.quaternion.x < -0.3, "starts leaning like the fan (pitch -42 deg)");
  h.step(170); /* the apex */
  assert.ok(q.position.y > home[1] + 0.8, "the arc lifts the card mid-flight");
  assert.ok(q.scale.x > 1.1 && q.scale.x < 1.2, "grows 1.06 over the flight scale at the apex");
  assert.ok(q.quaternion.x > -0.3, "mid-flip, lifted toward the camera");
  h.step(170); /* 340 ms: landed, slam begins */
  assert.ok(Math.abs(q.scale.x - 1.1) < 1e-6, "slam starts at 1.1");
  assert.ok(Math.abs(q.quaternion.w - 1) < 1e-6, "flat in the slot's pose");
  assert.equal(h.fx.stats().particles, h.FX.COUNT.dust);
  assert.equal(h.FX.COUNT.dust, 18);
  h.step(90);
  assert.ok(h.near(h.at(q), home));
  assert.ok(Math.abs(q.scale.x - 1) < 1e-6);
  h.step(500);
  assert.equal(h.fx.stats().particles, 0);
});

test("card:play of a token materialises it: frame 0.7 to 1 with a brass ring, 220 ms", () => {
  const h = fixture();
  const tok = h.addCard("N", "youNetwork", -1.8, 0.05, 1.95, "token");
  const frame = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
  h.reg.get("N").parts = { frame, body: frame };
  h.fx.cue("card:play", { seat: 0, uid: "N", cardType: "Avatar" });
  h.step(340); /* landed */
  const rings = () => h.fxGroup.children.filter((o) => o.visible && o.geometry instanceof RingGeometry);
  assert.equal(rings().length, 1, "one brass ring flash on landing");
  assert.ok(Math.abs(frame.scale.x - 0.7) < 1e-6, "the frame starts at 0.7");
  const r0 = rings()[0].scale.x;
  assert.ok(Math.abs(r0 - 0.6) < 1e-6, "the ring starts at 0.6");
  h.step(110);
  assert.ok(frame.scale.x > 0.75 && frame.scale.x < 1.08, "the frame grows");
  assert.ok(rings()[0].scale.x > r0, "the ring grows");
  h.step(120); /* 230 ms after landing */
  assert.equal(rings().length, 0, "ring gone after 220 ms");
  assert.ok(Math.abs(frame.scale.x - 1) < 1e-6, "frame settles at 1");
  assert.ok(h.near(h.at(tok), [-1.8, 0.05, 1.95]));
});

test("card:draw rises off the deck face down, flips on the way for the own seat, and slides home after 300 ms", () => {
  const h = fixture();
  const home = h.at(h.hand);
  h.fx.cue("card:draw", { seat: 0, uid: "H", count: 1 });
  h.step(0);
  assert.ok(h.hand.position.x > 4, "starts at the deck stack on the right");
  assert.ok(Math.abs(h.hand.quaternion.w) < 1e-6, "face down on the stack: flat and flipped");
  const y0 = h.hand.position.y;
  h.step(30);
  assert.ok(h.hand.position.y > y0 + 0.15, "rises off the stack first");
  assert.ok(Math.abs(h.hand.quaternion.w) < 1e-3, "still face down while rising");
  h.step(120); /* 150 ms: mid-flip */
  assert.ok(Math.abs(h.hand.quaternion.w) > 0.1 && Math.abs(h.hand.quaternion.w) < 0.99, "flipping on the way");
  h.step(150);
  assert.ok(h.near(h.at(h.hand), home));
  assert.ok(Math.abs(h.hand.quaternion.w - 1) < 1e-6, "face up at home");
});

test("unknown uid is a no-op for every card cue", () => {
  const h = fixture();
  const before = [h.at(h.attacker), h.at(h.target), h.at(h.hand)];
  for (const name of ["card:draw", "card:play", "resource:play", "attack:strike", "damage:avatar", "card:archive", "avatar:decommission", "ability:activate", "target:choose"]) {
    assert.doesNotThrow(() => h.fx.cue(name, { uid: "nope", targetUid: "nope", seat: 0 }), name);
  }
  h.step(16);
  assert.equal(h.fx.stats().tracks, 0);
  assert.equal(h.fx.stats().particles, 0);
  assert.deepEqual([h.at(h.attacker), h.at(h.target), h.at(h.hand)], before);
});

test("reduced motion cuts to the same final positions with zero particles and no shake", () => {
  const full = fixture();
  const cut = fixture({ reduced: true });
  const run = (h) => {
    h.addCard("Q", "queue", 0, 0.86, 0.1, "queue");
    h.fx.cue("card:play", { seat: 0, uid: "Q", cardType: "Avatar" });
    h.fx.cue("card:draw", { seat: 0, uid: "H" });
    h.fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
    h.fx.cue("damage:avatar", { uid: "T", amount: 2 });
    h.fx.cue("damage:player", { seat: 1, amount: 3, lethal: true });
    h.fx.cue("turn:begin", { seat: 0, mine: true });
    h.fx.cue("game:win", { seat: 0, mine: true });
    h.fx.cue("card:archive", { uid: "H" });
  };
  run(full); run(cut);
  /* reduced: already at rest before any frame */
  assert.equal(cut.fx.stats().particles, 0);
  assert.equal(cut.calls.shake.length, 0);
  assert.equal(cut.calls.push.length, 0);
  assert.equal(cut.clock.pauses, 0);
  cut.step(16);
  for (let t = 0; t < 2000; t += 16) full.step(16);
  assert.equal(full.fx.stats().particles, 0);
  for (const uid of ["A", "T", "H", "Q"]) {
    const a = full.reg.get(uid).mesh, b = cut.reg.get(uid).mesh;
    assert.ok(full.near(full.at(a), cut.at(b)), uid + " ends in the same place");
    assert.equal(a.visible, b.visible, uid + " ends equally visible");
  }
  assert.equal(cut.reg.get("H").mesh.visible, false, "the archived card is gone in both modes");
  assert.ok(full.calls.shake.length >= 2, "full motion shook for the strike and the lethal hit");
});

test("hitStop overlaps extend the freeze; timers hold still through it", () => {
  const h = fixture();
  h.fx.cue("ability:activate", { uid: "A" });
  h.step(0);
  h.fx.hitStop(100);
  h.fx.hitStop(300);
  h.step(150);
  assert.equal(h.fx.frozen, true, "the longer freeze wins");
  h.step(150);
  assert.equal(h.fx.frozen, false);
  assert.equal(h.clock.pauses, 1);
  assert.equal(h.clock.resumes, 1);
  assert.equal(h.fx.stats().tracks, 1, "the pulse did not advance during the freeze");
});

test("turn sweep, ability pulse, damage flashes and the win push have owners, durations and cleanup", () => {
  const h = fixture();
  const visibleQuads = () => h.fxGroup.children.filter((o) => o.visible && o.geometry).length;
  h.fx.cue("turn:begin", { seat: 0, mine: true });
  h.step(16);
  assert.equal(visibleQuads(), 1, "the sweep bar is up");
  h.step(400);
  assert.equal(visibleQuads(), 0, "and gone after 400 ms");

  h.fx.cue("ability:activate", { uid: "A" });
  h.fx.cue("target:request", { uids: ["A", "T"] });
  h.step(16);
  assert.equal(visibleQuads(), 3, "one ability ring plus two candidate pulses");
  h.step(400);
  assert.equal(visibleQuads(), 0);

  h.fx.cue("damage:avatar", [{ uid: "T", amount: 2 }, { uid: "A", amount: 1 }]);
  h.step(16);
  assert.equal(visibleQuads(), 4, "flash + crack decal per token");
  h.step(130);
  assert.equal(visibleQuads(), 2, "flashes are gone at 120 ms, cracks stay");
  h.step(500);
  assert.equal(visibleQuads(), 0, "cracks are gone at 600 ms");

  h.fx.cue("damage:player", { seat: 1, amount: 4, lethal: true });
  assert.deepEqual(h.calls.shake.at(-1), [1, 320]);
  assert.deepEqual(h.calls.push.at(-1), [0.03, 600]);
  h.fx.cue("game:win", { seat: 0, mine: true });
  assert.deepEqual(h.calls.push.at(-1), [0.06, 900]);
  h.fx.cue("game:win", { seat: null, mine: null });
  assert.equal(h.calls.push.length, 2, "a draw pushes toward nobody");
  h.step(1000);
  assert.equal(visibleQuads(), 0);
  assert.equal(h.fx.stats().tracks, 0);
  assert.ok(h.calls.render > 0, "every frame asked the arena to render");
});

test("in a browser the fx arm their own frame loop, for tracks and for track-less shatters alike", () => {
  const queue = [];
  const h = fixture(); /* load() clears any rAF; the module reads it per call */
  globalThis.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  try {
    assert.equal(queue.length, 0, "idle: no frame requested");
    h.fx.cue("card:archive", { uid: "H" });
    assert.equal(queue.length, 1, "a shatter requests a frame");
    queue.shift()(16);
    assert.equal(queue.length, 1, "the burn-out keeps the loop going");
    h.clock.advance(100);
    queue.shift()(116);
    assert.equal(h.fx.stats().particles, 40, "shards and sparks in the air after the burn-out");
    assert.equal(queue.length, 1, "live particles (no track) keep the loop going");
    h.fx.cue("ability:activate", { uid: "A" });
    assert.equal(queue.length, 1, "one pending frame at a time, never two");
    h.clock.advance(900);
    queue.shift()(1000);
    assert.equal(h.fx.stats().particles, 0);
    assert.equal(h.fx.stats().tracks, 0);
    assert.equal(queue.length, 0, "nothing left in the air: the loop stops");
    h.fx.dispose();
    h.fx.cue("card:archive", { uid: "A" });
    assert.equal(queue.length, 0, "no frames after dispose");
  } finally {
    delete globalThis.requestAnimationFrame;
  }
});

/* R1's arena3d.js drives the fx from its own loop: `fx.tick(clock.delta,
 * clock.time)` per rendered frame, `fx.animating()` to keep that loop alive,
 * a clock shaped {time, delta, frozenUntil, freeze(ms), advance(now)} and
 * `world.requestFrame()` in place of the contract's `arena.requestRender()`. */
test("driven by R1's loop: tick(delta, time), a freezable clock, animating() and requestFrame", () => {
  const h = harness();
  const clock = {
    time: 0, delta: 0, frozenUntil: 0, _last: null,
    freeze(ms) { this.frozenUntil = Math.max(this.frozenUntil, (this._last || 0) + ms); },
    advance(now) {
      const last = this._last == null ? now : this._last; this._last = now;
      if (now < this.frozenUntil) { this.delta = 0; return 0; }
      this.delta = (now - last) / 1000; this.time += this.delta; return this.delta;
    }
  };
  let frames = 0;
  h.arena.world.clock = clock;
  delete h.arena.requestRender;
  h.arena.world.requestFrame = () => { frames++; };
  const fx = h.FX.attach(h.arena);
  const A = h.addCard("A", "youNetwork", 1, 0.05, 1.95, "token"), T = h.addCard("T", "foeNetwork", 1, 0.05, -1.95, "token");
  const home = h.at(A);
  let now = 0;
  const frame = (ms) => { now += ms; clock.advance(now); fx.tick(clock.delta, clock.time); };
  frame(16);
  assert.equal(fx.animating(), false);
  fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
  assert.ok(frames > 0, "a cue wakes the arena's loop through world.requestFrame");
  assert.equal(fx.animating(), true);
  for (let t = 0; t < 160; t += 16) frame(16);
  assert.ok(clock.frozenUntil > now, "contact froze R1's clock via clock.freeze(150)");
  assert.equal(fx.frozen, true);
  assert.equal(fx.stats().particles, 40);
  const timeAtContact = clock.time, pose = h.at(A);
  frame(50);
  assert.equal(clock.time, timeAtContact, "the arena clock stands still");
  assert.deepEqual(h.at(A), pose, "so does the attacker");
  for (let t = 0; t < 1200; t += 16) frame(16);
  assert.equal(fx.frozen, false);
  assert.ok(h.near(h.at(A), home), "home again once the clock resumed");
  assert.ok(h.near(h.at(T), [1, 0.05, -1.95]));
  assert.equal(fx.animating(), false, "and the loop may sleep");
  assert.equal(fx.stats().particles, 0);
  /* gone entries: R1 hides the mesh for a grace period; only a shatter may use it */
  h.reg.get("T").gone = true;
  fx.cue("card:play", { seat: 1, uid: "T" });
  assert.equal(fx.stats().tracks, 0, "no flight for a departed card");
  fx.cue("avatar:decommission", { uid: "T" });
  for (let t = 0; t < 96; t += 16) frame(16);
  assert.equal(fx.stats().particles, 40, "a departed card still shatters from where it stood");
  fx.dispose();
});

test("dispose returns every pool object to rest and makes further cues no-ops", () => {
  const h = fixture();
  h.fx.cue("card:archive", { uid: "H" });
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetUid: "T" });
  h.step(150); /* contact: burst + hit-stop */
  assert.ok(h.fx.stats().particles > 0);
  assert.equal(h.fx.frozen, true);
  const mounted = h.fxGroup.children.length;
  assert.ok(mounted > 0);
  h.fx.dispose();
  assert.equal(h.fx.stats().particles, 0);
  assert.equal(h.fx.stats().tracks, 0);
  assert.equal(h.fx.frozen, false);
  assert.equal(h.clock.paused, false, "a freeze does not outlive the fx");
  assert.equal(h.fxGroup.children.length, 0, "every pooled object left the fx group");
  const pos = h.at(h.attacker);
  assert.equal(h.fx.cue("card:play", { uid: "A" }), false);
  assert.equal(h.fx.cue("attack:strike", { uid: "A", targetUid: "T" }), false);
  assert.doesNotThrow(() => h.fx.hitStop(150));
  assert.doesNotThrow(() => h.fx.update(9999));
  assert.doesNotThrow(() => h.fx.dispose());
  assert.deepEqual(h.at(h.attacker), pos, "a cue after dispose moves nothing");
});
