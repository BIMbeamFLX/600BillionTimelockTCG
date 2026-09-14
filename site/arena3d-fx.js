/*!
 * 600B TIMELOCK TCG — ARENA 3D FX · motion & VFX for the WebGL table.
 * MIT. No audio (fx.js owns every sound and the strike timing), no fetch, no
 * build step. Exposed as globalThis.E1Arena3DFx; attached by arena3d.js as
 * `arena.fx = E1Arena3DFx.attach(arena)`.
 *
 * Every effect here answers the same eight questions: trigger (a cue name from
 * fx.js's EVENTS list), owner (the card mesh or the slab), duration, gameplay
 * meaning, colour (brass = the table speaking, ember = contact, red = loss,
 * cream/dust = matter; never green — the one green per screen is R1's
 * can-play glow), spawn cap (`arena.world.quality.particleCap`, shared by every
 * pool), cleanup (pools; `dispose()` is idempotent) and the reduced-motion
 * equivalent (a cut to the end state, no particles, no shake).
 *
 * Time: a tween scheduler reads `arena.world.clock` (`elapsed` seconds, number
 * or function) and freezes for `hitStop(ms)` — the beat where the brain
 * registers the blow. Cards tween (snap curve, 160–320 ms); chrome cuts.
 * Everything is a pure function of the scheduler's time, so a frame stepped
 * twice looks the same as a frame stepped once.
 */
(function (global) {
  'use strict';

  /* ==================================================================== *
   * 0 · TOKENS                                                           *
   * ==================================================================== */

  const VERSION = '1.0.0';

  /* Durations (ms). Card tweens 160–320; chrome faster; only the shatter and
     the win push are allowed to be long, because they end something. */
  const MS = Object.freeze({
    draw: 260, play: 320, slam: 90, lungeOut: 110, hitStop: 150, recoil: 90,
    recoilBack: 160, ret: 220, flash: 120, crack: 600, shatter: 700, sweep: 400,
    pulse: 280, softPulse: 360, win: 900, dust: 420, burst: 380, light: 180,
    edge: 220, lethalShake: 320, lethalPush: 600
  });

  const COLOR = Object.freeze({
    brass: 0xf3c244, ember: 0xff6a00, cream: 0xfff7ec, dust: 0xc7bbcc, red: 0xff4d3d
  });

  /* Sprites per spawn, and pool sizes (two overlapping bursts fit; anything
     beyond that is cut by the shared particle cap, never by an allocation). */
  const COUNT = Object.freeze({ dust: 12, burst: 24, shards: 18 });
  const POOL = Object.freeze({ dust: 24, burst: 48, shards: 36, ring: 6, flash: 4, decal: 4, light: 2, tracks: 64 });

  const LUNGE_FRACTION = 0.4;
  const RECOIL_UNITS = 0.3;
  const GRAVITY = -9.0; /* world units / s² — cards are light, the table is close */

  /* Cues with no 3D motion: fx.js overlays and sounds cover them. */
  const NOOP = Object.freeze([
    'clash:begin', 'clash:declareAttackers', 'clash:declareBlockers', 'priority:pass',
    'phase:enter', 'buffer:burn', 'buffer:set', 'resource:generate', 'uptime:gain',
    'manual:resolve', 'game:start'
  ]);

  /* ==================================================================== *
   * 1 · SMALL UTILITIES                                                  *
   * ==================================================================== */

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const isFn = (f) => typeof f === 'function';
  function guard(fn) { try { return fn(); } catch (e) { return undefined; } }

  /* CSS cubic-bezier as a number → number function (Newton on the x curve). */
  function bezier(x1, y1, x2, y2) {
    const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
    const B = (a1, a2) => 3 * a2 - 6 * a1;
    const C = (a1) => 3 * a1;
    const at = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
    const slope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 6; i++) {
        const s = slope(t, x1, x2);
        if (s < 1e-6) break;
        t -= (at(t, x1, x2) - x) / s;
      }
      return at(t, y1, y2);
    };
  }

  const EASE = Object.freeze({
    snap: bezier(0.2, 0.8, 0.25, 1),   /* arrivals: fast out, hard stop      */
    accel: bezier(0.5, 0, 0.9, 0.4),   /* the lunge out: gathering speed     */
    drop: bezier(0.4, 0, 1, 1),        /* losses: no landing                 */
    line: (k) => k,                    /* sweeps and lights: machines do not ease */
    cut: (k) => (k >= 1 ? 1 : 0)       /* chrome                             */
  });

  /* `home.position` may be a Vector3 or a plain {x,y,z}; scale a number or a vector. */
  function setXYZ(v, src, fallback) {
    const s = src || fallback;
    if (!s) return v;
    if (typeof s === 'number') return v.set(s, s, s);
    return v.set(s.x || 0, s.y || 0, s.z || 0);
  }
  function setQuat(q, src) {
    if (!src) return q.set(0, 0, 0, 1);
    return q.set(src.x || 0, src.y || 0, src.z || 0, src.w == null ? 1 : src.w);
  }

  /* ==================================================================== *
   * 2 · ATTACH                                                           *
   * ==================================================================== */

  function attach(arena) {
    const world = (arena && arena.world) || {};
    const THREE = world.THREE || global.THREE;
    if (!arena || !THREE || !THREE.Vector3) return shim();

    const board = (global.E1ArenaLayout && global.E1ArenaLayout.BOARD) || { width: 16, depth: 10 };
    const halfDepth = board.depth / 2;
    const strikeMs = (global.E1FX && global.E1FX.strikeMs) || 150;

    let disposed = false;
    let ownSeat = typeof arena.seat === 'number' ? arena.seat : 0;

    function reduced() {
      if (isFn(arena.reduced)) return !!guard(arena.reduced);
      if (typeof arena.reduced === 'boolean') return arena.reduced;
      if (arena.opts && isFn(arena.opts.reduced)) return !!guard(arena.opts.reduced);
      const mm = global.matchMedia;
      return !!(isFn(mm) && guard(() => mm('(prefers-reduced-motion: reduce)').matches));
    }
    function particleCap() {
      const q = world.quality;
      const cap = q && typeof q.particleCap === 'number' ? q.particleCap : 96;
      return cap > 0 ? cap : 0;
    }
    /* Contract: arena.requestRender(). R1's arena3d.js exposes world.requestFrame /
       world.dirty instead; any of them wakes the render loop. */
    function requestRender() {
      if (isFn(arena.requestRender)) return guard(() => arena.requestRender());
      if (isFn(world.requestFrame)) return guard(() => world.requestFrame());
      if (isFn(world.dirty)) return guard(() => world.dirty());
      return undefined;
    }

    /* Scratch objects — the only vectors allocated after attach are none. */
    const V = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
    const Q = { a: new THREE.Quaternion(), b: new THREE.Quaternion() };
    const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0) };
    const Q_FLAT = new THREE.Quaternion().setFromAxisAngle(AXIS.x, -Math.PI / 2);
    const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(AXIS.y, Math.PI);

    /* ------------------------------------------------------------------ *
     * 2a · scheduler: tracks, timers, hit-stop                           *
     * ------------------------------------------------------------------ */

    const clock = world.clock || null;
    let lastWall = null;   /* last wall-clock timestamp handed to update()   */
    let T = 0;             /* scheduler time (ms); does not advance in a freeze */
    let offset = 0;        /* clock ms discarded by freezes on a clock that cannot pause */
    let frozen = false, freezeEndWall = 0, freezeStartClock = 0;
    let rafPending = false;
    let driven = false;    /* true once the arena's own loop has called tick(delta, time) */

    /* Three clock dialects: the contract's {elapsed, pause, resume}; R1's
       {time, freeze(ms), advance(now)} (seconds, holds still while frozen);
       a raw THREE.Clock (elapsedTime, cannot pause: freezes use `offset`). */
    function clockMs() {
      if (clock) {
        if (typeof clock.elapsed === 'number') return clock.elapsed * 1000;
        if (isFn(clock.elapsed)) return clock.elapsed() * 1000;
        if (typeof clock.time === 'number') return clock.time * 1000;
        if (typeof clock.elapsedTime === 'number' && clock.running !== false) return clock.elapsedTime * 1000;
      }
      return lastWall || 0;
    }
    const clockCanFreeze = () => !!(clock && isFn(clock.freeze) && typeof clock.frozenUntil === 'number');
    function clockFrozen() {
      return clockCanFreeze() && typeof clock._last === 'number' && clock.frozenUntil > clock._last;
    }
    function wallNow() {
      if (lastWall != null) return lastWall;
      return global.performance && isFn(global.performance.now) ? global.performance.now() : Date.now();
    }

    function makePose() { return { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }; }
    function makeTrack(i) {
      return { id: i, active: false, timer: false, uid: null, mesh: null, t0: 0, dur: 1, ease: EASE.line, lift: 0,
        a: makePose(), b: makePose(), step: null, done: null };
    }
    const tracks = [];
    for (let i = 0; i < POOL.tracks; i++) tracks.push(makeTrack(i));
    const SCRATCH = { a: makePose(), b: makePose() }; /* never a live track's pose */
    let activeTracks = 0;

    function takeTrack() {
      for (let i = 0; i < tracks.length; i++) if (!tracks[i].active) return tracks[i];
      return null;
    }
    function startTrack(dur, ease, step, done, uid, mesh) {
      const tr = takeTrack();
      if (!tr) { if (step) step(1, null); if (done) done(null); return null; }
      tr.active = true; tr.timer = false; tr.uid = uid == null ? null : uid; tr.mesh = mesh || null;
      tr.t0 = T; tr.dur = Math.max(1, dur | 0); tr.ease = ease || EASE.line; tr.lift = 0;
      tr.step = step || null; tr.done = done || null;
      activeTracks++;
      schedule();
      return tr;
    }
    function dropTrack(tr) {
      if (!tr.active) return;
      tr.active = false; activeTracks--;
      tr.step = null; tr.done = null; tr.mesh = null; tr.uid = null;
    }
    function finishTrack(tr) {
      if (!tr.active) return;
      const done = tr.done;
      dropTrack(tr);
      if (done) guard(() => done(tr));
    }
    /* Timers live in scheduler time, so they hold still through a hit-stop.
       A cut drops a timer (the beat never comes); a cut finishes a tween. */
    function after(ms, fn, uid) {
      const tr = startTrack(ms, EASE.line, null, fn, uid);
      if (tr) tr.timer = true;
      return tr;
    }

    function cutUid(uid) {
      if (uid == null) return;
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (!tr.active || tr.uid !== uid) continue;
        if (tr.timer) { dropTrack(tr); continue; }
        if (tr.step) tr.step(1, tr);
        finishTrack(tr);
      }
    }
    function isAnimating(uid) {
      for (let i = 0; i < tracks.length; i++) if (tracks[i].active && tracks[i].uid === uid) return true;
      return false;
    }

    function hitStop(ms) {
      if (disposed || reduced()) return;
      const dur = Math.max(0, ms | 0);
      /* R1's clock freezes itself (and the arena's own tweens) for `ms` of
         wall time; the scheduler simply sees `time` stand still. */
      if (clockCanFreeze()) { guard(() => clock.freeze(dur)); schedule(); return; }
      const end = wallNow() + dur;
      if (frozen) { if (end > freezeEndWall) freezeEndWall = end; return; }
      frozen = true; freezeEndWall = end; freezeStartClock = clockMs();
      if (clock && isFn(clock.pause)) guard(() => clock.pause());
      schedule();
    }
    function thaw() {
      frozen = false;
      if (clock && isFn(clock.resume)) guard(() => clock.resume());
      else offset += clockMs() - freezeStartClock;
    }
    const isFrozen = () => frozen || clockFrozen();
    const animating = () => !disposed && (activeTracks > 0 || liveParticles > 0 || isFrozen());

    function update(wall) {
      if (disposed) return;
      lastWall = typeof wall === 'number' ? wall : wallNow();
      if (frozen) {
        if (lastWall >= freezeEndWall) thaw();
        else { requestRender(); schedule(); return; }
      }
      T = clockMs() - offset;
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (!tr.active) continue;
        const k = clamp01((T - tr.t0) / tr.dur);
        if (tr.step) tr.step(tr.ease(k), tr);
        if (k >= 1) finishTrack(tr);
      }
      stepParticles();
      requestRender();
      if (animating()) schedule();
    }
    /* R1's loop calls tick(delta, time) once per rendered frame; once it has,
       the fx stop scheduling frames of their own and only wake that loop. */
    function tick(a, b) {
      if (typeof b === 'number') { driven = true; update(undefined); return; }
      update(a);
    }
    function schedule() {
      if (disposed) return;
      if (driven) { requestRender(); return; }
      const raf = global.requestAnimationFrame;
      if (rafPending || !isFn(raf)) return;
      rafPending = true;
      raf((ts) => { rafPending = false; update(ts); });
    }

    /* ------------------------------------------------------------------ *
     * 2b · materials, geometry, pools                                    *
     * ------------------------------------------------------------------ */

    const mats = world.materials || {};
    const parent = (world.group && world.group.fx && isFn(world.group.fx.add)) ? world.group.fx
      : (world.scene && isFn(world.scene.add) ? world.scene : null);
    const created = { materials: [], geometries: [] };

    function tint(m, hex) {
      if (!m) return;
      if (m.color && isFn(m.color.setHex)) m.color.setHex(hex);
      else if (THREE.Color) m.color = new THREE.Color(hex);
    }
    function finishMat(m, hex, additive) {
      m.transparent = true; m.depthWrite = false; m.opacity = 0;
      if (additive && THREE.AdditiveBlending != null) m.blending = THREE.AdditiveBlending;
      if (THREE.DoubleSide != null && !m.isSpriteMaterial) m.side = THREE.DoubleSide;
      tint(m, hex);
      created.materials.push(m);
      return m;
    }
    function spriteMat(hex, additive) {
      const base = mats.dust && mats.dust.isSpriteMaterial ? mats.dust : (mats.glow && mats.glow.isSpriteMaterial ? mats.glow : null);
      const m = base && isFn(base.clone) ? base.clone() : new THREE.SpriteMaterial({});
      return finishMat(m, hex, additive);
    }
    function meshMat(base, hex, additive) {
      const ok = base && !base.isSpriteMaterial && isFn(base.clone);
      const m = ok ? base.clone() : new THREE.MeshBasicMaterial({});
      return finishMat(m, hex, additive);
    }
    function geometry(kind, a, b, c) {
      let g = null;
      if (kind === 'ring' && THREE.RingGeometry) g = new THREE.RingGeometry(a, b, c || 32);
      else if (THREE.PlaneGeometry) g = new THREE.PlaneGeometry(a, b);
      if (g) created.geometries.push(g);
      return g;
    }

    const GEO = {
      shard: geometry('plane', 0.32, 0.38), /* readable from the camera's ~14 units */
      ring: geometry('ring', 0.62, 0.74, 40),
      unit: geometry('plane', 1, 1),
      sweep: geometry('plane', board.width + 2, 0.5),
      edge: geometry('plane', board.width, 0.6)
    };

    function mount(obj) {
      obj.visible = false;
      if (parent) guard(() => parent.add(obj));
      return obj;
    }
    function unmount(obj) {
      obj.visible = false;
      if (obj.parent && isFn(obj.parent.remove)) guard(() => obj.parent.remove(obj));
      else if (parent && isFn(parent.remove)) guard(() => parent.remove(obj));
    }

    /* Particles: sprites (dust, burst) and shard quads share one record shape;
       position, spin, size and opacity are closed forms of the age. */
    function makeParticle(obj, kind) {
      return { obj: mount(obj), kind, active: false, born: 0, life: 1, g: 0, spin: 0, s0: 1, s1: 1,
        p0: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), q0: new THREE.Quaternion() };
    }
    const pools = { dust: [], burst: [], shards: [] };
    for (let i = 0; i < POOL.dust; i++) pools.dust.push(makeParticle(new THREE.Sprite(spriteMat(COLOR.dust, false)), 'dust'));
    for (let i = 0; i < POOL.burst; i++) pools.burst.push(makeParticle(new THREE.Sprite(spriteMat(i % 3 ? COLOR.brass : COLOR.ember, true)), 'burst'));
    for (let i = 0; i < POOL.shards; i++) pools.shards.push(makeParticle(new THREE.Mesh(GEO.shard, meshMat(mats.shard, COLOR.cream, false)), 'shard'));
    const ALL_POOLS = [pools.dust, pools.burst, pools.shards];
    let liveParticles = 0;

    function budget(pool, want) {
      let free = 0;
      for (let i = 0; i < pool.length; i++) if (!pool[i].active) free++;
      return Math.max(0, Math.min(want, free, particleCap() - liveParticles));
    }
    function spawn(pool) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (p.active) continue;
        p.active = true; p.born = T; liveParticles++;
        p.obj.visible = true;
        schedule(); /* a shatter has no track of its own: arm the frame loop here */
        return p;
      }
      return null;
    }
    function release(p) {
      if (!p.active) return;
      p.active = false; liveParticles--;
      p.obj.visible = false;
      if (p.obj.material) p.obj.material.opacity = 0;
    }
    function stepParticles() {
      for (let j = 0; j < ALL_POOLS.length; j++) {
        const pool = ALL_POOLS[j];
        for (let i = 0; i < pool.length; i++) {
          const p = pool[i];
          if (!p.active) continue;
          const age = T - p.born, k = clamp01(age / p.life), s = age / 1000;
          const o = p.obj;
          o.position.set(p.p0.x + p.v.x * s, Math.max(0.02, p.p0.y + p.v.y * s + 0.5 * p.g * s * s), p.p0.z + p.v.z * s);
          const sc = p.s0 + (p.s1 - p.s0) * k;
          o.scale.set(sc, sc, sc);
          if (p.kind === 'shard') {
            Q.a.setFromAxisAngle(p.axis, p.spin * s);
            o.quaternion.multiplyQuaternions(p.q0, Q.a);
          }
          if (o.material) o.material.opacity = p.kind === 'burst' ? (1 - k) * (1 - k) : 1 - k;
          if (k >= 1) release(p);
        }
      }
    }

    /* Flat glow quads: rings (pulses), flashes (contact / damage), decals
       (cracks), sweep and edge bars. Each is a track-driven mesh. */
    function flatMesh(geo, hex, additive) {
      const m = new THREE.Mesh(geo, meshMat(mats.glow, hex, additive));
      m.quaternion.copy(Q_FLAT);
      return mount(m);
    }
    const quads = { ring: [], flash: [], decal: [] };
    for (let i = 0; i < POOL.ring; i++) quads.ring.push({ obj: flatMesh(GEO.ring, COLOR.brass, true), busy: false });
    for (let i = 0; i < POOL.flash; i++) quads.flash.push({ obj: flatMesh(GEO.unit, COLOR.red, true), busy: false });
    for (let i = 0; i < POOL.decal; i++) {
      /* R1 ships a crack texture (materials.cracks); else paint one here. */
      const m = mats.cracks && isFn(mats.cracks.clone) ? mount(new THREE.Mesh(GEO.unit, finishMat(mats.cracks.clone(), COLOR.red, true)))
        : flatMesh(GEO.unit, COLOR.red, false);
      m.quaternion.copy(Q_FLAT);
      quads.decal.push({ obj: m, busy: false });
    }
    const sweep = { obj: flatMesh(GEO.sweep, COLOR.brass, true), busy: false };
    const edge = { obj: flatMesh(GEO.edge, COLOR.red, true), busy: false };
    const slabGlow = { obj: flatMesh(GEO.unit, COLOR.brass, true), busy: false };
    if (!mats.cracks && GEO.unit && THREE.CanvasTexture && global.document && isFn(global.document.createElement)) {
      guard(() => paintCracks(quads.decal));
    }
    function paintCracks(list) {
      const c = global.document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 256, 256);
      ctx.strokeStyle = '#ff4d3d'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4, r = 70 + (i % 3) * 28;
        ctx.beginPath(); ctx.moveTo(128, 128);
        ctx.lineTo(128 + Math.cos(a) * r * 0.5, 128 + Math.sin(a + 0.3) * r * 0.5);
        ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
        ctx.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      for (let i = 0; i < list.length; i++) { list[i].obj.material.map = tex; list[i].obj.material.needsUpdate = true; }
    }

    function takeQuad(list) {
      for (let i = 0; i < list.length; i++) if (!list[i].busy) { list[i].busy = true; list[i].obj.visible = true; return list[i]; }
      return null;
    }
    function giveQuad(q) {
      q.busy = false; q.obj.visible = false;
      if (q.obj.material) q.obj.material.opacity = 0;
    }
    /* A quad that grows from s0 to s1 and fades over `dur` at a world point. */
    function pulseQuad(q, x, y, z, s0, s1, peak, dur, ease, uid) {
      if (!q) return;
      const o = q.obj;
      o.position.set(x, y, z);
      startTrack(dur, ease || EASE.snap, (k) => {
        const sc = s0 + (s1 - s0) * k;
        o.scale.set(sc, sc, 1);
        if (o.material) o.material.opacity = peak * (1 - k);
      }, () => giveQuad(q), uid);
    }

    /* Slab flash: two point lights that live in the scene at intensity 0, so a
       flash never recompiles a material. */
    const lights = [];
    if (THREE.PointLight) {
      for (let i = 0; i < POOL.light; i++) {
        const l = new THREE.PointLight(COLOR.brass, 0, 6);
        l.visible = true; l.intensity = 0;
        if (parent) guard(() => parent.add(l));
        lights.push({ obj: l, busy: false });
      }
    }
    function flashLight(x, y, z, peak, dur) {
      const slot = lights.find((l) => !l.busy);
      if (!slot) return;
      slot.busy = true;
      slot.obj.position.set(x, y + 1.2, z);
      startTrack(dur, EASE.drop, (k) => { slot.obj.intensity = peak * (1 - k); }, () => { slot.busy = false; slot.obj.intensity = 0; });
    }

    /* ------------------------------------------------------------------ *
     * 2c · card motion                                                   *
     * ------------------------------------------------------------------ */

    /* R1 keeps a departed entry (`gone`, mesh hidden) for a grace period, which
       is exactly what a shatter needs and what every other cue must ignore. */
    function entryOf(uid, allowGone) {
      if (uid == null || disposed) return null;
      const e = guard(() => arena.registry && isFn(arena.registry.get) ? arena.registry.get(uid) : null);
      if (!e || !e.mesh || !e.mesh.position) return null;
      return e.gone && !allowGone ? null : e;
    }
    function homeOf(e, pose) {
      const h = e.home || {};
      setXYZ(pose.p, h.position, e.mesh.position);
      setQuat(pose.q, h.quaternion || e.mesh.quaternion);
      setXYZ(pose.s, h.scale, 1);
      return pose;
    }
    /* The end state, now. Every cue in reduced mode is exactly this. */
    function settle(uid, e) {
      cutUid(uid);
      const p = homeOf(e, SCRATCH.b);
      e.mesh.position.copy(p.p); e.mesh.quaternion.copy(p.q); e.mesh.scale.copy(p.s);
    }
    /* Which half of the table a card belongs to: its zone name when the zone
       is seat-specific, else the cue's seat against the seat at this screen
       (learned from `turn:begin {seat, mine}`). */
    function isOwn(e, seat) {
      if (typeof e.zone === 'string') {
        if (e.zone.indexOf('you') === 0) return true;
        if (e.zone.indexOf('foe') === 0) return false;
      }
      if (typeof e.owner === 'number') return e.owner === ownSeat; /* R1: queue cards carry their controller */
      return seat == null ? true : seat === ownSeat;
    }
    /* E1ArenaLayout.ZONES[name].centre is [x, y, z] (R1); tolerate {x,y,z} too. */
    function zoneAnchor(name, out, fallback) {
      const z = global.E1ArenaLayout && global.E1ArenaLayout.ZONES && global.E1ArenaLayout.ZONES[name];
      const a = z && (z.centre || z.center || z.anchor || (typeof z.x === 'number' ? z : null));
      if (Array.isArray(a) && a.length >= 3) return out.set(a[0], a[1], a[2]);
      if (a && typeof a.x === 'number') return out.set(a.x, a.y || 0, a.z || 0);
      return out.copy(fallback);
    }

    /* Pose tween a → b for a mesh. `lift` bends the path into an arc. */
    function tweenPose(uid, e, dur, ease, lift, fill, done) {
      const mesh = e.mesh;
      const tr = startTrack(dur, ease, null, done, uid, mesh);
      if (!tr) { settle(uid, e); return null; }
      if (e.tween) e.tween = null; /* the arena's own move tween yields to the cue */
      fill(tr.a, tr.b);
      tr.lift = lift || 0;
      tr.step = (k, t) => {
        mesh.position.lerpVectors(t.a.p, t.b.p, k);
        if (t.lift) mesh.position.y += t.lift * 4 * k * (1 - k);
        mesh.quaternion.slerpQuaternions(t.a.q, t.b.q, k);
        mesh.scale.lerpVectors(t.a.s, t.b.s, k);
      };
      tr.step(0, tr);
      return tr;
    }
    /* Return to home from wherever the mesh is right now. */
    function homeward(uid, dur, ease) {
      const e = entryOf(uid);
      if (!e) return;
      tweenPose(uid, e, dur, ease, 0, (a, b) => {
        a.p.copy(e.mesh.position); a.q.copy(e.mesh.quaternion); a.s.copy(e.mesh.scale);
        homeOf(e, b);
      });
    }
    /* Slam: scale 1.08 → 1 over 90 ms, then the card is at rest. */
    function slam(uid, e) {
      tweenPose(uid, e, MS.slam, EASE.snap, 0, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        a.s.multiplyScalar(1.08);
      });
      return e.mesh;
    }

    /* ------------------------------------------------------------------ *
     * 2d · the cue table                                                 *
     * ------------------------------------------------------------------ */

    const CUES = {};

    /* card:draw — deck stack → hand slot, 260 ms; own cards flip to face.
       Meaning: a new option arrived. Brass-free: nothing to celebrate yet. */
    CUES['card:draw'] = (d) => {
      const e = entryOf(d.uid);
      if (!e) return;
      if (reduced()) return settle(d.uid, e);
      cutUid(d.uid);
      const own = isOwn(e, d.seat);
      tweenPose(d.uid, e, MS.draw, EASE.snap, 0.5, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        zoneAnchor(own ? 'youDeck' : 'foeDeck', a.p, V.a.set(board.width / 2 - 1.2, 0.3, own ? halfDepth - 1.4 : -halfDepth + 1.4));
        if (own) a.q.multiply(Q_FLIP);
        a.s.multiplyScalar(0.9);
      });
    };

    /* card:play — hand → queue/network: arc flight 320 ms, slam, dust ring
       (12), brass light on the slab. resource:play is the same flight, flat. */
    function flight(d, opts) {
      const uid = d.uid != null ? d.uid : d.qid;
      const e = entryOf(uid);
      if (!e) return;
      if (reduced()) return settle(uid, e);
      cutUid(uid);
      const own = isOwn(e, d.seat);
      tweenPose(uid, e, MS.play, EASE.snap, 1.1, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        zoneAnchor(own ? 'youHand' : 'foeHand', a.p, V.a.set(b.p.x * 0.4, 0.9, own ? halfDepth - 0.6 : -halfDepth + 0.6));
        a.s.multiplyScalar(1.08);
      }, () => {
        const landed = entryOf(uid);
        if (!landed) return;
        const m = slam(uid, landed);
        dustRing(m.position.x, m.position.z, COUNT.dust);
        if (opts.flash) flashLight(m.position.x, 0, m.position.z, 2.2, MS.light);
      });
    }
    CUES['card:play'] = (d) => flight(d, { flash: true });
    CUES['resource:play'] = (d) => flight(d, { flash: false });

    /* Dust: cream-grey matter kicked up by a landing — fixed angles, so two
       landings in a frame do not read as one. */
    function dustRing(x, z, want) {
      const n = budget(pools.dust, want);
      for (let i = 0; i < n; i++) {
        const p = spawn(pools.dust);
        if (!p) break;
        const a = (i / n) * Math.PI * 2 + 0.2;
        p.life = MS.dust; p.g = -1.5; p.s0 = 0.18; p.s1 = 0.65;
        p.p0.set(x + Math.cos(a) * 0.35, 0.08, z + Math.sin(a) * 0.35);
        p.v.set(Math.cos(a) * 1.4, 0.6 + (i % 2) * 0.3, Math.sin(a) * 1.4);
      }
    }

    /* Impact burst: 24 additive sprites, brass → ember, thrown along the
       strike direction. Contact, not damage: the number is fx.js's chip. */
    function burst(x, y, z, dir, want) {
      const n = budget(pools.burst, want);
      for (let i = 0; i < n; i++) {
        const p = spawn(pools.burst);
        if (!p) break;
        const a = (i / n) * Math.PI * 2, r = 0.9 + (i % 3) * 0.6;
        p.life = MS.burst; p.g = -3; p.s0 = 0.5; p.s1 = 0.1;
        p.p0.set(x, y + 0.25, z);
        p.v.set(Math.cos(a) * r + dir.x * 1.2, 1.2 + (i % 4) * 0.35, Math.sin(a) * r + dir.z * 1.2);
      }
    }

    /* attack:strike — lunge 40 % of the way in 110 ms, contact at strikeMs,
       hit-stop, burst, shake, recoil, return 220 ms. The hit-stop is the beat
       the brain uses to register the blow; the sound already sits there. */
    CUES['attack:strike'] = (d) => {
      const e = entryOf(d.uid);
      if (!e) return;
      if (reduced()) return settle(d.uid, e);
      cutUid(d.uid);
      const target = d.targetUid != null ? entryOf(d.targetUid) : null;
      const own = isOwn(e, d.seat);
      /* contact point: the target token, or the defending seat's edge */
      const from = homeOf(e, SCRATCH.a).p;
      const to = target ? homeOf(target, SCRATCH.b).p
        : SCRATCH.b.p.set(from.x * 0.5, from.y, own ? -halfDepth + 0.8 : halfDepth - 0.8);
      const dir = V.a.copy(to).sub(from);
      const dist = dir.length() || 1;
      dir.multiplyScalar(1 / dist);

      /* out: home → 40 % of the way, scale 1.08, arriving at lungeOut and
         holding until contact */
      tweenPose(d.uid, e, MS.lungeOut, EASE.accel, 0.15, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        b.p.copy(a.p).addScaledVector(dir, dist * LUNGE_FRACTION);
        b.p.y += 0.12;
        b.s.multiplyScalar(1.08);
      });
      /* The contact timer keeps its own copy of the geometry: `a.p` = contact
         point, `b.p` = direction, `lift` = strength. Scratch is shared. */
      const tm = after(strikeMs, (tr) => {
        if (disposed || !tr) return;
        /* the timer's slot is free again: copy out before anything takes it */
        const c = V.c.copy(tr.a.p), dirAt = V.b.copy(tr.b.p);
        burst(c.x, c.y, c.z, dirAt, COUNT.burst);
        flashLight(c.x, 0, c.z, 3, MS.light);
        shake(tr.lift, 180);
        if (d.targetUid != null) recoil(d.targetUid, dirAt);
        hitStop(MS.hitStop);
        after(0, () => homeward(d.uid, MS.ret, EASE.snap), d.uid);
      }, d.uid);
      if (tm) {
        tm.a.p.copy(from).addScaledVector(dir, dist * LUNGE_FRACTION);
        tm.b.p.copy(dir);
        tm.lift = target ? 0.35 : 0.55;
      }
    };

    /* The target gives 0.3 units along the blow, then returns. */
    function recoil(uid, dir) {
      const t = entryOf(uid);
      if (!t) return;
      cutUid(uid);
      tweenPose(uid, t, MS.recoil, EASE.snap, 0, (a, b) => {
        homeOf(t, a); homeOf(t, b);
        b.p.addScaledVector(dir, RECOIL_UNITS);
      }, () => homeward(uid, MS.recoilBack, EASE.snap));
    }

    function shake(strength, ms) {
      if (reduced()) return;
      const cam = arena.camera;
      if (cam && isFn(cam.shake)) guard(() => cam.shake(strength, ms));
    }
    /* `extra.toward` = {x, z} world offset for the camera target (R1 reads it;
       the contract's push(zoom, ms) simply ignores a third argument). */
    function push(zoom, ms, toward) {
      if (reduced()) return;
      const cam = arena.camera;
      if (cam && isFn(cam.push)) guard(() => (toward ? cam.push(zoom, ms, { toward }) : cam.push(zoom, ms)));
    }

    /* damage:avatar — red flash on the token, crack decal 600 ms. Loss is
       red; it never shares the brass of contact. */
    function damageAvatar(d) {
      const e = entryOf(d.uid);
      if (!e || reduced()) return;
      const m = e.mesh;
      pulseQuad(takeQuad(quads.flash), m.position.x, Math.max(0.02, m.position.y) + 0.05, m.position.z, 1.2, 1.5, 0.85, MS.flash, EASE.drop);
      pulseQuad(takeQuad(quads.decal), m.position.x, Math.max(0.02, m.position.y) + 0.04, m.position.z, 1.3, 1.3, 0.9, MS.crack, EASE.line);
    }
    CUES['damage:avatar'] = (d) => {
      const list = Array.isArray(d) ? d : [d];
      for (let i = 0; i < list.length && i < POOL.flash; i++) damageAvatar(list[i] || {});
    };

    /* damage:player — the seat's edge flashes red; lethal adds a heavier
       shake and a slow push. Strength grows with the hit, capped. */
    CUES['damage:player'] = (d) => {
      if (reduced()) return;
      const amount = Math.max(0, d.amount | 0);
      const own = d.seat == null ? true : d.seat === ownSeat;
      if (!edge.busy) {
        edge.busy = true;
        const o = edge.obj;
        o.position.set(0, 0.24, own ? halfDepth - 0.3 : -halfDepth + 0.3);
        o.scale.set(1, 1, 1);
        startTrack(MS.edge, EASE.drop, (k) => { if (o.material) o.material.opacity = 0.8 * (1 - k); }, () => { edge.busy = false; o.visible = false; });
        o.visible = true;
      }
      if (d.lethal) { shake(1, MS.lethalShake); push(0.03, MS.lethalPush); }
      else if (amount > 0) shake(Math.min(0.8, 0.15 + amount * 0.1), 160);
    };

    /* card:archive / avatar:decommission — the mesh hides at 0 ms; 18 shard
       quads with gravity and spin fade over 700 ms. It comes apart, it does
       not float away. Reduced: it is simply gone. */
    function shatter(d) {
      const e = entryOf(d.uid, true);
      if (!e) return;
      cutUid(d.uid);
      const m = e.mesh;
      m.visible = false;
      if (reduced()) return;
      const n = budget(pools.shards, COUNT.shards);
      const x = m.position.x, y = Math.max(0.05, m.position.y), z = m.position.z;
      for (let i = 0; i < n; i++) {
        const p = spawn(pools.shards);
        if (!p) break;
        const a = (i / n) * Math.PI * 2 + 0.3, r = 0.8 + (i % 3) * 0.5;
        p.life = MS.shatter; p.g = GRAVITY; p.s0 = 1; p.s1 = 0.7; p.spin = (i % 2 ? 1 : -1) * (4 + (i % 3));
        p.p0.set(x + Math.cos(a) * 0.3, y + 0.1 + (i % 4) * 0.08, z + Math.sin(a) * 0.3);
        p.v.set(Math.cos(a) * r, 2.2 + (i % 3) * 0.5, Math.sin(a) * r);
        p.axis.set(Math.cos(a + 1.2), 0.4, Math.sin(a + 1.2)).normalize();
        p.q0.copy(m.quaternion);
        p.obj.material.opacity = 1;
      }
    }
    CUES['card:archive'] = shatter;
    CUES['avatar:decommission'] = shatter;

    /* turn:begin — a brass light sweeps the slab toward the active seat,
       400 ms, linear. The handover is the biggest state change in the game. */
    CUES['turn:begin'] = (d) => {
      if (typeof d.mine === 'boolean' && typeof d.seat === 'number') ownSeat = d.mine ? d.seat : 1 - d.seat;
      if (reduced() || sweep.busy) return;
      const toOwn = typeof d.mine === 'boolean' ? d.mine : d.seat === ownSeat;
      const o = sweep.obj;
      sweep.busy = true;
      o.visible = true;
      o.scale.set(1, 1, 1);
      startTrack(MS.sweep, EASE.line, (k) => {
        const z = (toOwn ? -1 : 1) * halfDepth + (toOwn ? 1 : -1) * k * board.depth;
        o.position.set(0, 0.26, z);
        if (o.material) o.material.opacity = k < 0.7 ? 0.55 : 0.55 * (1 - (k - 0.7) / 0.3);
      }, () => { sweep.busy = false; o.visible = false; });
    };

    /* target:request / target:choose — R1's setState draws the candidate
       rings; this adds one soft brass pulse so the request reads as a beat. */
    function pulseOn(uid, s1, peak, dur) {
      const e = entryOf(uid);
      if (!e || reduced()) return;
      const m = e.mesh;
      pulseQuad(takeQuad(quads.ring), m.position.x, Math.max(0.02, m.position.y) + 0.03, m.position.z, 1, s1, peak, dur, EASE.snap, uid);
    }
    function uidsOf(d) {
      if (!d) return [];
      if (Array.isArray(d.uids)) return d.uids;
      if (Array.isArray(d.candidates)) return d.candidates.map((c) => (c && typeof c === 'object' ? c.uid : c));
      return d.uid != null ? [d.uid] : [];
    }
    CUES['target:request'] = (d) => { const u = uidsOf(d); for (let i = 0; i < u.length && i < POOL.ring; i++) pulseOn(u[i], 1.35, 0.45, MS.softPulse); };
    CUES['target:choose'] = (d) => pulseOn(d && d.uid, 1.5, 0.7, MS.pulse);

    /* ability:activate — one brass ring pulse on the token: this card acted. */
    CUES['ability:activate'] = (d) => pulseOn(d && d.uid, 1.7, 0.9, MS.pulse);

    /* game:win — the camera pushes 6 % toward the winner over 900 ms, the
       winner's half of the slab glows brass. No confetti; the table is a
       machine, and a machine reports a result. */
    CUES['game:win'] = (d) => {
      if (d.seat == null || reduced()) return;
      const own = typeof d.mine === 'boolean' ? d.mine : d.seat === ownSeat;
      push(0.06, MS.win, { x: 0, z: own ? 1.5 : -1.5 });
      if (slabGlow.busy) return;
      slabGlow.busy = true;
      const o = slabGlow.obj;
      o.position.set(0, 0.22, own ? halfDepth / 2 : -halfDepth / 2);
      o.scale.set(board.width * 0.8, halfDepth * 0.9, 1);
      o.visible = true;
      startTrack(MS.win, EASE.line, (k) => { if (o.material) o.material.opacity = 0.45 * Math.sin(k * Math.PI); }, () => { slabGlow.busy = false; o.visible = false; });
    };

    for (let i = 0; i < NOOP.length; i++) CUES[NOOP[i]] = null;

    /* ------------------------------------------------------------------ *
     * 2e · public surface                                                *
     * ------------------------------------------------------------------ */

    function cue(name, detail) {
      if (disposed) return false;
      const fn = CUES[name];
      if (!fn) return false;
      guard(() => fn(detail || {}));
      return true;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (frozen) thaw();
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (!tr.active) continue;
        tr.active = false; tr.step = null; tr.done = null; tr.mesh = null; tr.uid = null;
      }
      activeTracks = 0;
      for (let j = 0; j < ALL_POOLS.length; j++) {
        for (let i = 0; i < ALL_POOLS[j].length; i++) { release(ALL_POOLS[j][i]); unmount(ALL_POOLS[j][i].obj); }
      }
      liveParticles = 0;
      const singles = [sweep, edge, slabGlow].concat(quads.ring, quads.flash, quads.decal);
      for (let i = 0; i < singles.length; i++) { giveQuad(singles[i]); unmount(singles[i].obj); }
      for (let i = 0; i < lights.length; i++) { lights[i].busy = false; lights[i].obj.intensity = 0; unmount(lights[i].obj); }
      for (let i = 0; i < created.materials.length; i++) guard(() => created.materials[i].dispose && created.materials[i].dispose());
      for (let i = 0; i < created.geometries.length; i++) guard(() => created.geometries[i].dispose && created.geometries[i].dispose());
      created.materials.length = 0; created.geometries.length = 0;
    }

    function stats() {
      let free = 0, total = 0;
      for (let j = 0; j < ALL_POOLS.length; j++) for (let i = 0; i < ALL_POOLS[j].length; i++) { total++; if (!ALL_POOLS[j][i].active) free++; }
      return { tracks: activeTracks, particles: liveParticles, poolFree: free, poolTotal: total, frozen, time: T, disposed };
    }

    return {
      cue, hitStop, dispose, update, tick, animating, isAnimating, stats,
      get frozen() { return isFrozen(); },
      get time() { return T; },
      version: VERSION, cues: Object.keys(CUES)
    };
  }

  /* The no-op twin arena3d.js falls back to when THREE is missing. */
  function shim() {
    const no = () => false;
    return { cue: no, hitStop: no, dispose: no, update: no, tick: no, animating: no, isAnimating: no,
      stats: () => ({ tracks: 0, particles: 0, poolFree: 0, poolTotal: 0, frozen: false, time: 0, disposed: true }),
      frozen: false, time: 0, version: VERSION, cues: [] };
  }

  global.E1Arena3DFx = Object.freeze({ attach, shim, VERSION, MS, COUNT, POOL, NOOP });
})(typeof globalThis !== 'undefined' ? globalThis : this);
