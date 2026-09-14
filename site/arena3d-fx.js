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
 * Motion book (1.1): strike = anticipation 70 ms → lunge to 85 % with
 * acceleration → contact at strikeMs (squash, white flash, shockwave, 40-sprite
 * burst, shake by damage, target recoil) → hit-stop → return with a 6 %
 * overshoot; play = arc + flip through a lifted midpoint, slam 1.1 → 1, dust,
 * a token materialises; draw = rise, flip, slide; death = burn-out 90 ms, then
 * 24 shards + 16 sparks, done by 800 ms. Losses cued with a strike wait for
 * its contact.
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

  const VERSION = '1.1.0';

  /* Durations (ms). Card tweens 160–320; chrome faster; only the shatter and
     the win push are allowed to be long, because they end something. */
  const MS = Object.freeze({
    draw: 300, play: 340, slam: 90, antic: 70, hitStop: 150, squash: 60, recoil: 90,
    recoilBack: 180, ret: 260, flash: 120, white: 40, shock: 260, crack: 600,
    burnout: 90, shatter: 710, sweep: 400, pulse: 280, softPulse: 360, win: 900,
    dust: 420, burst: 420, spark: 700, light: 180, edge: 220, lethalShake: 320,
    lethalPush: 600, materialise: 220
  });

  const COLOR = Object.freeze({
    brass: 0xf3c244, ember: 0xff6a00, cream: 0xfff7ec, dust: 0xc7bbcc, red: 0xff4d3d
  });
  /* brass → ember, as components: a burst sprite cools per frame without a Color. */
  const BRASS_RGB = Object.freeze([0.953, 0.761, 0.267]);
  const EMBER_RGB = Object.freeze([1.0, 0.416, 0.0]);

  /* Sprites per spawn, and pool sizes: two overlapping strikes (2 × 40 burst)
     plus two shatters (2 × 24 shards, 2 × 16 sparks from the burst pool) fit;
     anything beyond that is cut by the shared particle cap, never by an
     allocation. */
  const COUNT = Object.freeze({ dust: 18, burst: 40, shards: 24, sparks: 16 });
  const POOL = Object.freeze({ dust: 36, burst: 112, shards: 48, ring: 8, shock: 2, white: 2, flash: 4, decal: 4, light: 2, tracks: 96 });

  const ANTIC_UNITS = 0.25;    /* the pull-back before the lunge            */
  const LUNGE_FRACTION = 0.85; /* how far the attacker travels to contact   */
  const RECOIL_UNITS = 0.45;
  const SHAKE = Object.freeze({ base: 0.35, perPoint: 0.08, cap: 0.9 });
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
    back: bezier(0.3, 1.45, 0.55, 1),  /* the return: snap with 6 % overshoot */
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
    /* The fan's pitch (a played card starts leaning like the hand it left) and
       the lifted midpoint of the flip: the card faces the camera at the apex. */
    const handPitch = (name, fallback) => {
      const z = global.E1ArenaLayout && global.E1ArenaLayout.ZONES && global.E1ArenaLayout.ZONES[name];
      return z && typeof z.pitch === 'number' ? z.pitch : fallback;
    };
    const Q_HAND = { you: new THREE.Quaternion().setFromAxisAngle(AXIS.x, handPitch('youHand', -42 * Math.PI / 180)),
      foe: new THREE.Quaternion().setFromAxisAngle(AXIS.x, handPitch('foeHand', -34 * Math.PI / 180)) };
    const Q_LIFT = new THREE.Quaternion().setFromAxisAngle(AXIS.x, 0.4);

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
      shard: geometry('plane', 0.42, 0.5), /* readable from the camera's ~14 units */
      ring: geometry('ring', 0.62, 0.74, 40),
      shock: geometry('ring', 0.86, 1.0, 48), /* scale 1 = a one-unit radius */
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
      return { obj: mount(obj), kind, base: kind, active: false, born: 0, life: 1, g: 0, spin: 0, s0: 1, s1: 1,
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
      p.active = false; liveParticles--; p.kind = p.base;
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
          const mat = o.material;
          if (mat) {
            mat.opacity = p.kind === 'burst' ? (1 - k) * (1 - k) : p.kind === 'spark' ? (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8) : 1 - k;
            /* burst sprites cool from brass to ember as they fly */
            if (p.kind === 'burst' && mat.color && isFn(mat.color.setRGB)) {
              mat.color.setRGB(BRASS_RGB[0] + (EMBER_RGB[0] - BRASS_RGB[0]) * k,
                BRASS_RGB[1] + (EMBER_RGB[1] - BRASS_RGB[1]) * k,
                BRASS_RGB[2] + (EMBER_RGB[2] - BRASS_RGB[2]) * k);
            }
          }
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
    const quads = { ring: [], shock: [], white: [], flash: [], decal: [] };
    for (let i = 0; i < POOL.ring; i++) quads.ring.push({ obj: flatMesh(GEO.ring, COLOR.brass, true), busy: false });
    for (let i = 0; i < POOL.shock; i++) quads.shock.push({ obj: flatMesh(GEO.shock, COLOR.brass, true), busy: false });
    /* The white contact flash is a sprite: it faces the camera from any seat. */
    for (let i = 0; i < POOL.white; i++) quads.white.push({ obj: mount(new THREE.Sprite(spriteMat(COLOR.cream, true))), busy: false });
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

    /* Pose tween a → b for a mesh. `lift` bends the path into an arc; `shape`
       (k, track, mesh) replaces the plain lerp for a cue with its own law. */
    function tweenPose(uid, e, dur, ease, lift, fill, done, shape) {
      const mesh = e.mesh;
      const tr = startTrack(dur, ease, null, done, uid, mesh);
      if (!tr) { settle(uid, e); return null; }
      if (e.tween) e.tween = null; /* the arena's own move tween yields to the cue */
      fill(tr.a, tr.b);
      tr.lift = lift || 0;
      tr.step = shape ? (k, t) => shape(k, t, mesh) : (k, t) => {
        mesh.position.lerpVectors(t.a.p, t.b.p, k);
        if (t.lift) mesh.position.y += t.lift * 4 * k * (1 - k);
        mesh.quaternion.slerpQuaternions(t.a.q, t.b.q, k);
        mesh.scale.lerpVectors(t.a.s, t.b.s, k);
      };
      tr.step(0, tr);
      return tr;
    }
    /* A flip that passes through a lifted midpoint: a → (mid · lift) → b. */
    function flipThrough(q, a, b, k) {
      Q.b.slerpQuaternions(a, b, 0.5).multiply(Q_LIFT);
      if (k < 0.5) q.slerpQuaternions(a, Q.b, k * 2);
      else q.slerpQuaternions(Q.b, b, k * 2 - 1);
      return q;
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
    /* Slam: scale 1.1 → 1 over 90 ms, then the card is at rest. */
    function slam(uid, e) {
      tweenPose(uid, e, MS.slam, EASE.snap, 0, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        a.s.multiplyScalar(1.1);
      });
      return e.mesh;
    }
    /* A token materialises: its brass frame grows 0.7 → 1 while a brass ring
       flashes 0.6 → 1.3 around it, 220 ms. The token was not there; now it is. */
    function materialise(uid, e) {
      const m = e.mesh;
      pulseQuad(takeQuad(quads.ring), m.position.x, Math.max(0.02, m.position.y) + 0.03, m.position.z, 0.6, 1.3, 0.9, MS.materialise, EASE.snap, uid);
      const frame = e.parts && e.parts.frame;
      if (!frame || !frame.scale) return;
      frame.scale.set(0.7, 0.7, 1);
      startTrack(MS.materialise, EASE.back, (k) => { const s = 0.7 + 0.3 * k; frame.scale.set(s, s, 1); },
        () => { frame.scale.set(1, 1, 1); }, uid);
    }

    /* ------------------------------------------------------------------ *
     * 2d · the cue table                                                 *
     * ------------------------------------------------------------------ */

    const CUES = {};

    /* card:draw — deck stack → hand slot, 300 ms: the card rises off the
       stack (the arc peaks early), flips face-up on the way for the own seat
       (the flip lives in k 0.15–0.75), and slides into the fan on the snap.
       Meaning: a new option arrived. Brass-free: nothing to celebrate yet. */
    CUES['card:draw'] = (d) => {
      const e = entryOf(d.uid);
      if (!e) return;
      if (reduced()) return settle(d.uid, e);
      cutUid(d.uid);
      const own = isOwn(e, d.seat);
      tweenPose(d.uid, e, MS.draw, EASE.line, 0.8, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        zoneAnchor(own ? 'youDeck' : 'foeDeck', a.p, V.a.set(board.width / 2 - 1.2, 0.3, own ? halfDepth - 1.4 : -halfDepth + 1.4));
        a.q.copy(Q_FLAT);
        if (own) a.q.multiply(Q_FLIP);
        a.s.multiplyScalar(0.9);
      }, null, (k, t, mesh) => {
        /* k is time: the path snaps, the flip keeps its own window */
        const kp = EASE.snap(k);
        mesh.position.lerpVectors(t.a.p, t.b.p, kp);
        const rise = Math.sqrt(kp); /* off the stack first, then across */
        mesh.position.y += t.lift * 4 * rise * (1 - rise);
        mesh.quaternion.slerpQuaternions(t.a.q, t.b.q, clamp01((k - 0.2) / 0.5));
        mesh.scale.lerpVectors(t.a.s, t.b.s, kp);
      });
    };

    /* card:play — hand → queue/network: arc flight 340 ms from the fan's pose
       (the hand's pitch) flipping through a lifted midpoint to the slot's
       pose, 1.06 bigger at the apex, then the slam (1.1 → 1), a dust ring
       (18) and the brass light on the slab. A token materialises on landing.
       resource:play is the same flight, flat, no light. */
    function flight(d, opts) {
      const uid = d.uid != null ? d.uid : d.qid;
      const e = entryOf(uid);
      if (!e) return;
      if (reduced()) return settle(uid, e);
      cutUid(uid);
      const own = isOwn(e, d.seat);
      tweenPose(uid, e, MS.play, EASE.line, 1.2, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        zoneAnchor(own ? 'youHand' : 'foeHand', a.p, V.a.set(b.p.x * 0.4, 0.9, own ? halfDepth - 0.6 : -halfDepth + 0.6));
        a.p.x = b.p.x * 0.5;
        a.q.copy(own ? Q_HAND.you : Q_HAND.foe);
        if (!own) a.q.multiply(Q_FLIP);
        b.s.multiplyScalar(1.1);
      }, () => {
        const landed = entryOf(uid);
        if (!landed) return;
        const m = slam(uid, landed);
        dustRing(m.position.x, m.position.z, COUNT.dust);
        if (opts.flash) flashLight(m.position.x, 0, m.position.z, 2.6, MS.light);
        if (landed.kind === 'token') materialise(uid, landed);
      }, (k, t, mesh) => {
        /* k is time: the path snaps; the arc, the flip and the apex growth
           are symmetric in time, so the apex sits at the middle of the flight */
        const kp = EASE.snap(k), arc = 4 * k * (1 - k);
        mesh.position.lerpVectors(t.a.p, t.b.p, kp);
        mesh.position.y += t.lift * arc;
        flipThrough(mesh.quaternion, t.a.q, t.b.q, k);
        mesh.scale.lerpVectors(t.a.s, t.b.s, kp).multiplyScalar(1 + 0.06 * arc);
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

    /* Impact burst: 40 additive sprites, brass cooling to ember, thrown wide
       along the strike direction. Contact, not damage: the number is fx.js's chip. */
    function burst(x, y, z, dir, want) {
      const n = budget(pools.burst, want);
      for (let i = 0; i < n; i++) {
        const p = spawn(pools.burst);
        if (!p) break;
        /* fast and wide: the sprites clear the contact point within 60 ms, so
           forty additive sprites read as a spray, not as one white ball */
        const a = (i / n) * Math.PI * 2 + (i % 2) * 0.17, r = 4.5 + (i % 3) * 2.5;
        p.life = MS.burst - (i % 4) * 40; p.g = -14; p.s0 = 0.42 + (i % 3) * 0.1; p.s1 = 0.06;
        p.p0.set(x + Math.cos(a) * 0.35, y + 0.3 + (i % 2) * 0.15, z + Math.sin(a) * 0.35);
        p.v.set(Math.cos(a) * r + dir.x * 2.5, 2.5 + (i % 4) * 0.9, Math.sin(a) * r + dir.z * 2.5);
        if (p.obj.material) tint(p.obj.material, COLOR.brass);
      }
    }
    /* Ember sparks: rising, from the burst pool, for a card that burns out. */
    function sparks(x, y, z, want) {
      const n = budget(pools.burst, want);
      for (let i = 0; i < n; i++) {
        const p = spawn(pools.burst);
        if (!p) break;
        p.kind = 'spark';
        const a = (i / n) * Math.PI * 2 + 0.5, r = 0.15 + (i % 3) * 0.25;
        p.life = MS.spark - (i % 3) * 120; p.g = 0.6; p.s0 = 0.22; p.s1 = 0.05;
        p.p0.set(x + Math.cos(a) * 0.45, y + 0.05 + (i % 2) * 0.2, z + Math.sin(a) * 0.45);
        p.v.set(Math.cos(a) * r, 1.4 + (i % 4) * 0.45, Math.sin(a) * r);
        if (p.obj.material) tint(p.obj.material, COLOR.ember);
      }
    }

    /* attack:strike — anticipation: 0.25 units back over 70 ms; lunge with
       acceleration to 85 % of the way, contact at strikeMs (150); squash
       (x 1.12 / y 0.9), white flash, shockwave ring, 40-sprite burst, shake
       scaled by damage, target recoil + flash, hit-stop; return with a 6 %
       overshoot over 260 ms. The hit-stop is the beat the brain uses to
       register the blow; the sound already sits there. */
    const anticK = clamp01(MS.antic / strikeMs); /* the pull-back's share of the run-up */
    function strikeShape(k, t, mesh) {
      /* t.a = home, t.b = contact pose. V.c is the strike axis; the cue's own
         scratch is V.a, live while step(0) runs inside tweenPose. */
      V.c.subVectors(t.b.p, t.a.p).normalize();
      if (k < anticK) {
        const j = EASE.snap(k / anticK);
        mesh.position.copy(t.a.p).addScaledVector(V.c, -ANTIC_UNITS * j);
        mesh.position.y += 0.05 * j;
        mesh.quaternion.copy(t.a.q);
        mesh.scale.copy(t.a.s).multiplyScalar(1 - 0.04 * j);
        return;
      }
      const j = EASE.accel((k - anticK) / (1 - anticK));
      mesh.position.copy(t.a.p).addScaledVector(V.c, -ANTIC_UNITS * (1 - j));
      mesh.position.lerp(t.b.p, j);
      mesh.position.y += 0.12 * 4 * j * (1 - j);
      mesh.quaternion.copy(t.a.q);
      mesh.scale.copy(t.a.s).multiplyScalar(0.96 + 0.12 * j);
    }
    CUES['attack:strike'] = (d) => {
      const e = entryOf(d.uid);
      if (!e) return;
      if (reduced()) return settle(d.uid, e);
      cutUid(d.uid);
      const target = d.targetUid != null ? entryOf(d.targetUid) : null;
      const own = isOwn(e, d.seat);
      /* contact point: the target token, or the near edge of the defending side */
      const from = homeOf(e, SCRATCH.a).p;
      const to = target ? homeOf(target, SCRATCH.b).p
        : SCRATCH.b.p.set(from.x * 0.5, from.y, own ? -halfDepth + 1.0 : halfDepth - 1.0);
      const dir = V.a.copy(to).sub(from);
      const dist = dir.length() || 1;
      dir.multiplyScalar(1 / dist);
      /* damage: the cue's amount, else the attacker's Action (the card's power) */
      const power = e.card && e.card.action != null ? Number(e.card.action) : 0;
      const amount = Math.max(0, Number(d.amount) || power || 0);
      const strength = Math.min(SHAKE.cap, SHAKE.base + SHAKE.perPoint * amount);
      lastStrikeAt = T;

      /* home → 85 % of the way over strikeMs: pull back, then accelerate in */
      tweenPose(d.uid, e, strikeMs, EASE.line, 0, (a, b) => {
        homeOf(e, a); homeOf(e, b);
        b.p.copy(a.p).addScaledVector(dir, dist * LUNGE_FRACTION);
        b.s.multiplyScalar(1.08);
      }, null, strikeShape);
      /* The contact timer keeps its own copy of the geometry: `a.p` = contact
         point, `b.p` = direction, `lift` = shake strength. Scratch is shared. */
      const tm = after(strikeMs, (tr) => {
        if (disposed || !tr) return;
        /* the timer's slot is free again: copy out before anything takes it */
        const c = V.c.copy(tr.a.p), dirAt = V.b.copy(tr.b.p), strength = tr.lift;
        squash(d.uid);
        burst(c.x, c.y, c.z, dirAt, COUNT.burst);
        pulseQuad(takeQuad(quads.white), c.x, c.y + 0.4, c.z, 0.9, 1.5, 0.9, MS.white, EASE.drop);
        pulseQuad(takeQuad(quads.shock), c.x, 0.05, c.z, 0.4, 2.2, 0.9, MS.shock, EASE.snap);
        flashLight(c.x, 0, c.z, 4, MS.light);
        shake(strength, 180);
        if (d.targetUid != null) recoil(d.targetUid, dirAt);
        hitStop(MS.hitStop);
      }, d.uid);
      if (tm) {
        tm.a.p.copy(from).addScaledVector(dir, dist * LUNGE_FRACTION);
        tm.b.p.copy(dir);
        tm.lift = strength;
      }
    };

    /* fx.js cues the loss (damage:player / damage:avatar) together with the
       strike, and shows its chip at strikeMs. Here the loss waits for the
       contact too: a red edge before the blow lands would answer a question
       the table has not asked yet. The timer freezes with the hit-stop, so
       the loss shows the moment the clock resumes. */
    let lastStrikeAt = -Infinity;
    function afterContact(fn) {
      const wait = strikeMs - (T - lastStrikeAt);
      if (wait > 0 && wait <= strikeMs) after(wait, () => fn());
      else fn();
    }

    /* Contact squash: x 1.12 / y 0.9 of the lunge scale, relaxing over 60 ms
       (after the hit-stop, which holds the squashed frame), then the return
       with the overshoot. */
    function squash(uid) {
      const e = entryOf(uid);
      if (!e) return;
      tweenPose(uid, e, MS.squash, EASE.snap, 0, (a, b) => {
        a.p.copy(e.mesh.position); a.q.copy(e.mesh.quaternion); a.s.copy(e.mesh.scale);
        b.p.copy(a.p); b.q.copy(a.q); b.s.copy(a.s);
        a.s.x *= 1.12; a.s.y *= 0.9;
      }, () => homeward(uid, MS.ret, EASE.back));
    }

    /* The target gives 0.45 units along the blow and flashes, then returns. */
    function recoil(uid, dir) {
      const t = entryOf(uid);
      if (!t) return;
      cutUid(uid);
      const m = t.mesh;
      pulseQuad(takeQuad(quads.flash), m.position.x, Math.max(0.02, m.position.y) + 0.05, m.position.z, 1.3, 1.6, 0.7, MS.flash, EASE.drop, uid);
      tweenPose(uid, t, MS.recoil, EASE.snap, 0, (a, b) => {
        homeOf(t, a); homeOf(t, b);
        b.p.addScaledVector(dir, RECOIL_UNITS);
        b.p.y += 0.06;
      }, () => homeward(uid, MS.recoilBack, EASE.back));
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
    CUES['damage:avatar'] = (d) => afterContact(() => {
      const list = Array.isArray(d) ? d : [d];
      for (let i = 0; i < list.length && i < POOL.flash; i++) damageAvatar(list[i] || {});
    });

    /* damage:player — the seat's edge flashes red; lethal adds a heavier
       shake and a slow push. Strength grows with the hit, capped. */
    CUES['damage:player'] = (d) => afterContact(() => damagePlayer(d));
    function damagePlayer(d) {
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
    }

    /* card:archive / avatar:decommission — burn-out first: the face flashes
       to ember over 90 ms (emissive on the card's own material; the mesh pops
       4 %); then the mesh hides and 24 shard quads fly with gravity and spin
       while 16 ember sparks rise; everything is freed by 800 ms. It comes
       apart, it does not float away. Reduced: it is simply gone. */
    function burnMaterial(e) {
      const part = e.parts && (e.parts.art || e.parts.front);
      const m = part && part.material;
      if (!m || m === world.backMat || !m.emissive || !isFn(m.emissive.setHex)) return null;
      return m;
    }
    function shatter(d) {
      const e = entryOf(d.uid, true);
      if (!e) return;
      cutUid(d.uid);
      const m = e.mesh;
      if (reduced()) { m.visible = false; return; }
      m.visible = true;
      const mat = burnMaterial(e);
      if (mat) { mat.emissive.setHex(COLOR.ember); mat.emissiveIntensity = 0; }
      homeOf(e, SCRATCH.a);
      const s0 = SCRATCH.a.s.x;
      startTrack(MS.burnout, EASE.line, (k) => {
        if (mat) mat.emissiveIntensity = 2.4 * k;
        m.scale.set(s0 * (1 + 0.04 * k), s0 * (1 + 0.04 * k), s0 * (1 + 0.04 * k));
      }, () => {
        m.visible = false;
        if (mat) mat.emissiveIntensity = 0;
        shards(m);
      }, d.uid);
    }
    function shards(m) {
      const n = budget(pools.shards, COUNT.shards);
      const x = m.position.x, y = Math.max(0.05, m.position.y), z = m.position.z;
      for (let i = 0; i < n; i++) {
        const p = spawn(pools.shards);
        if (!p) break;
        const a = (i / n) * Math.PI * 2 + 0.3, r = 0.9 + (i % 3) * 0.6;
        p.life = MS.shatter - (i % 3) * 60; p.g = GRAVITY; p.s0 = 1; p.s1 = 0.7; p.spin = (i % 2 ? 1 : -1) * (4 + (i % 3));
        p.p0.set(x + Math.cos(a) * 0.32, y + 0.1 + (i % 4) * 0.1, z + Math.sin(a) * 0.32);
        p.v.set(Math.cos(a) * r, 2.4 + (i % 3) * 0.6, Math.sin(a) * r);
        p.axis.set(Math.cos(a + 1.2), 0.4, Math.sin(a + 1.2)).normalize();
        p.q0.copy(m.quaternion);
        p.obj.material.opacity = 1;
      }
      sparks(x, y, z, COUNT.sparks);
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
      /* The arena's idle loop ticks the fx at half rate, so T may lag the
         clock by a frame or two: a cue starts from the clock's now, or the
         contact would land early against the sound fx.js plays at strikeMs. */
      if (!isFrozen()) T = Math.max(T, clockMs() - offset);
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
      const singles = [sweep, edge, slabGlow].concat(quads.ring, quads.shock, quads.white, quads.flash, quads.decal);
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
