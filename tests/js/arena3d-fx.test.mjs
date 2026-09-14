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

test("attack:strike — lunge out, contact at 150 ms, hit-stop freezes the clock, recoil, return", () => {
  const h = fixture();
  const home = h.at(h.attacker), tHome = h.at(h.target);
  assert.equal(h.fx.cue("attack:strike", { seat: 0, uid: "A", targetSeat: null, targetUid: "T" }), true);
  h.step(0);
  assert.ok(h.near(h.at(h.attacker), home), "at 0 ms the attacker has not moved");

  h.step(110);
  /* 40 % of the way toward the target (same x; z from 1.95 toward -1.95 = 3.9 units) */
  assert.ok(Math.abs(h.attacker.position.z - (1.95 - 0.4 * 3.9)) < 1e-6, "lunge reaches 40 % at 110 ms");
  assert.ok(h.attacker.scale.x > 1.07, "the lunge scales up");
  assert.equal(h.fx.stats().particles, 0, "nothing in the air before contact");
  assert.equal(h.clock.pauses, 0);

  h.step(40); /* t = 150: contact */
  assert.equal(h.fx.stats().particles, h.FX.COUNT.burst, "24 burst sprites at contact");
  assert.equal(h.calls.shake.length, 1, "one camera shake");
  assert.equal(h.clock.pauses, 1, "hit-stop pauses the arena clock");
  assert.equal(h.fx.frozen, true);
  const atContact = h.at(h.attacker);

  h.step(50); /* frozen: the clock did not advance, nothing moved */
  assert.equal(h.clock.t, 150);
  assert.ok(h.near(h.at(h.attacker), atContact), "frozen attacker holds its contact pose");
  assert.ok(h.near(h.at(h.target), tHome), "the recoil waits for the thaw");
  assert.equal(h.fx.frozen, true);

  h.step(100); /* wall 300 = contact + hitStop: thaw */
  assert.equal(h.fx.frozen, false);
  assert.equal(h.clock.resumes, 1);

  h.step(16); /* the return and the recoil start */
  h.step(74); /* recoil peak at 90 ms after the thaw */
  assert.ok(Math.abs(h.target.position.z - (-1.95 - 0.3)) < 1e-6, "target recoils 0.3 units along the blow");

  h.step(200);
  assert.ok(h.near(h.at(h.attacker), home), "attacker is home 220 ms after the return began");
  h.step(200);
  assert.ok(h.near(h.at(h.target), tHome), "target is home again");
  assert.equal(h.fx.isAnimating("A"), false);
  assert.equal(h.fx.isAnimating("T"), false);
  h.step(400);
  assert.equal(h.fx.stats().particles, 0, "the burst is gone");
  assert.equal(h.fx.stats().tracks, 0);
});

test("attack:strike on a seat lunges toward the defending edge and shakes harder", () => {
  const h = fixture();
  h.fx.cue("attack:strike", { seat: 0, uid: "A", targetSeat: 1, targetUid: null });
  h.step(110);
  assert.ok(h.attacker.position.z < 1.95, "moved toward the foe edge (-z)");
  h.step(40);
  assert.equal(h.calls.shake.length, 1);
  assert.ok(h.calls.shake[0][0] > 0.4, "a blow on the player shakes more than one on a token");
});

test("particles never exceed the tier's particleCap, across overlapping effects", () => {
  const h = fixture({ cap: 10 });
  h.addCard("B", "youNetwork", -1, 0.05, 1.95, "token");
  h.fx.cue("card:archive", { uid: "B" });          /* wants 18 shards */
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

test("shatter hides the mesh at 0 ms and frees its 18 shards after 700 ms", () => {
  const h = fixture({ materials: { glow: new MeshBasicMaterial(), shard: new MeshBasicMaterial(), dust: new SpriteMaterial() } });
  const before = h.fx.stats().poolFree;
  h.fx.cue("avatar:decommission", { uid: "T" });
  assert.equal(h.target.visible, false, "the mesh is gone before the first frame");
  assert.equal(h.fx.stats().particles, h.FX.COUNT.shards);
  h.step(16);
  const shards = h.fxGroup.children.filter((o) => o.visible && o.geometry);
  assert.equal(shards.length, 18);
  const y0 = shards[0].position.y;
  h.step(300);
  assert.notEqual(shards[0].position.y, y0, "shards fall");
  assert.ok(shards[0].material.opacity < 1 && shards[0].material.opacity > 0, "shards fade");
  assert.ok(shards[0].quaternion.w !== 1, "shards spin");
  h.step(400); /* 716 ms */
  assert.equal(h.fx.stats().particles, 0);
  assert.equal(h.fx.stats().poolFree, before);
  assert.equal(h.fxGroup.children.filter((o) => o.visible && o.geometry && o !== undefined).length, 0);
});

test("card:play flies from the hand in an arc, slams, and kicks up 12 dust sprites", () => {
  const h = fixture();
  h.addCard("Q", "queue", 0, 0.86, 0.1, "queue");
  const home = h.at(h.reg.get("Q").mesh);
  h.fx.cue("card:play", { seat: 0, uid: "Q", cardType: "Avatar" });
  h.step(0);
  const start = h.at(h.reg.get("Q").mesh);
  assert.ok(!h.near(start, home), "starts away from the slot");
  assert.ok(start[2] > home[2], "starts on the own side (+z)");
  h.step(160);
  assert.ok(h.reg.get("Q").mesh.position.y > home[1], "the arc lifts the card mid-flight");
  h.step(160); /* 320 ms: landed, slam begins */
  assert.ok(h.reg.get("Q").mesh.scale.x > 1.05, "slam starts at 1.08");
  assert.equal(h.fx.stats().particles, h.FX.COUNT.dust);
  h.step(90);
  assert.ok(h.near(h.at(h.reg.get("Q").mesh), home));
  assert.ok(Math.abs(h.reg.get("Q").mesh.scale.x - 1) < 1e-6);
  h.step(500);
  assert.equal(h.fx.stats().particles, 0);
});

test("card:draw starts at the deck, flipped for the own seat, and lands home after 260 ms", () => {
  const h = fixture();
  const home = h.at(h.hand);
  h.fx.cue("card:draw", { seat: 0, uid: "H", count: 1 });
  h.step(0);
  assert.ok(h.hand.position.x > 4, "starts at the deck stack on the right");
  assert.ok(Math.abs(h.hand.quaternion.w) < 1e-6, "face down: flipped 180° at the start");
  h.step(260);
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
    assert.equal(queue.length, 1, "a shatter (particles, no track) requests a frame");
    queue.shift()(16);
    assert.equal(queue.length, 1, "live particles keep the loop going");
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
  assert.equal(fx.stats().particles, 24);
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
  assert.equal(fx.stats().particles, 18, "a departed card still shatters from where it stood");
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
