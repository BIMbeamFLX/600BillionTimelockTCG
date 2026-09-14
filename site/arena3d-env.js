/*!
 * 600B TIMELOCK TCG — ARENA 3D ENV · the room around the table.
 * MIT. No audio, no fetch beyond one backdrop image, no build step. Exposed as
 * globalThis.E1Arena3DEnv; attached by arena3d.js as
 * `arena.env = E1Arena3DEnv.attach(arena, { backdrop, affinity })`.
 *
 * Five layers, all in the card frame's language and the five Plate colours:
 *   cyclorama — a cylinder segment behind the far edge wearing the hero art,
 *               dimmed, tinted per affinity, black at the bottom so the slab
 *               edge reads; it follows the pointer parallax at 30 %.
 *   fog       — three additive haze sprites drifting sideways behind the slab.
 *   embers    — one THREE.Points cloud rising through the void, twinkling.
 *   packets   — brass light running the slab's PCB traces (world.traces).
 *   breathing — the world plate and the queue glow breathe ±12 % over 4.5 s;
 *               the key light flickers ±3 % on a slow noise, never a strobe.
 *
 * The arena's loop calls tick(delta, time) once per rendered frame and asks
 * animating() whether to keep going; env answers true only while the tab is
 * visible and motion is not reduced. Reduced motion draws every layer once,
 * static. Every buffer is allocated at attach; no allocation per frame.
 */
(function (root) {
  "use strict";

  /* ==================================================================== *
   * 0 · TOKENS                                                           *
   * ==================================================================== */

  const VERSION = "1.0.0";

  /* The Plate palette: the only saturated colours on the table. */
  const PLATE = Object.freeze({
    power: 0xf3c244, bitcoin: 0xf7931a, keys: 0xfff7ec, signal: 0x7447b8, timelock: 0x17bebb,
    neutral: 0xc9962e, // brass
  });
  const PLATE_ALIAS = Object.freeze({ p: "power", b: "bitcoin", k: "keys", s: "signal", t: "timelock" });

  const CYC = Object.freeze({ radius: 34, height: 24, arc: 170, segments: 64, rows: 12, brightness: 0.45, tint: 0.55, y: -3.5, z: 6, parallax: 0.3 });
  const FOG = Object.freeze({ count: 3, tint: 0xd9a35a, size: 256 });
  const EMBER = Object.freeze({ max: 240, byTier: { high: 240, mid: 120, low: 40 }, size: 0.22, tint: 0xf3c244 });
  const PACKET = Object.freeze({ byTier: { high: 8, mid: 6, low: 4 }, speed: 1.2, fade: 0.5, lift: 0.02, size: 0.26, tint: 0xf3c244 });
  const BREATH = Object.freeze({ period: 4.5, depth: 0.12, flicker: 0.03 });
  const PARALLAX_DEG = 1.2;

  /* The void: behind the far edge (z < -5.5) and beside the slab (|x| > 8.5). */
  const VOID = Object.freeze({ x: 15, zNear: 6, zFar: -22, yLow: -9, yHigh: 3.5 });

  /* ==================================================================== *
   * 1 · SMALL UTILITIES                                                  *
   * ==================================================================== */

  const RAD = Math.PI / 180;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const isFn = (f) => typeof f === "function";
  function guard(fn, fallback) { try { return fn(); } catch (error) { return fallback; } }

  /* A seeded LCG so the fog and the first ember field are the same every load. */
  function rng(seed) {
    let s = seed >>> 0 || 7;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* Mix a hex colour toward another by t and scale its brightness. */
  function mixHex(a, b, t, bright) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const k = bright == null ? 1 : bright;
    const r = clamp(Math.round(lerp(ar, br, t) * k), 0, 255);
    const g = clamp(Math.round(lerp(ag, bg, t) * k), 0, 255);
    const bl = clamp(Math.round(lerp(ab, bb, t) * k), 0, 255);
    return (r << 16) | (g << 8) | bl;
  }
  const scaleHex = (hex, k) => mixHex(hex, hex, 0, k);

  /* Slow value noise on a lattice: smooth, bounded, never a strobe. */
  function noise1(t, seed) {
    const i = Math.floor(t), f = t - i;
    const h = (n) => { const x = Math.sin((n + seed) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const k = f * f * (3 - 2 * f);
    return lerp(h(i), h(i + 1), k) * 2 - 1;
  }

  function affinityKey(affinity) {
    const raw = String(affinity || "").trim().toLowerCase();
    if (!raw) return "neutral";
    if (PLATE[raw]) return raw;
    if (PLATE_ALIAS[raw]) return PLATE_ALIAS[raw];
    return "neutral";
  }

  function makeCanvas(doc, w, h) {
    if (!doc || !isFn(doc.createElement)) return null;
    const canvas = guard(() => doc.createElement("canvas"), null);
    if (!canvas || !isFn(canvas.getContext)) return null;
    canvas.width = w; canvas.height = h;
    const ctx = guard(() => canvas.getContext("2d"), null);
    return ctx ? { canvas, ctx } : null;
  }

  /* A soft radial dot: the ember and the packet sprite. */
  function dotTexture(THREE, doc, size) {
    const c = makeCanvas(doc, size, size);
    if (!c || !THREE.CanvasTexture) return null;
    const g = c.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,247,236,1)");
    g.addColorStop(0.35, "rgba(255,247,236,.55)");
    g.addColorStop(1, "rgba(255,247,236,0)");
    c.ctx.fillStyle = g;
    c.ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(c.canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /* Soft value noise as alpha, feathered to the edges: the haze sheet. Drawn once. */
  function fogTexture(THREE, doc, size) {
    const c = makeCanvas(doc, size, size);
    if (!c || !THREE.CanvasTexture) return null;
    const ctx = c.ctx;
    const rnd = rng(600);
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 90; i++) {
      const r = size * (0.08 + rnd() * 0.22);
      const x = rnd() * size, y = size * (0.2 + rnd() * 0.6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255," + (0.05 + rnd() * 0.07).toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Feather: fade the sheet to nothing at its four edges so no square ever shows.
    ctx.globalCompositeOperation = "destination-in";
    const fx = ctx.createLinearGradient(0, 0, size, 0);
    fx.addColorStop(0, "rgba(0,0,0,0)"); fx.addColorStop(0.25, "rgba(0,0,0,1)"); fx.addColorStop(0.75, "rgba(0,0,0,1)"); fx.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fx; ctx.fillRect(0, 0, size, size);
    const fy = ctx.createLinearGradient(0, 0, 0, size);
    fy.addColorStop(0, "rgba(0,0,0,0)"); fy.addColorStop(0.3, "rgba(0,0,0,1)"); fy.addColorStop(0.7, "rgba(0,0,0,1)"); fy.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fy; ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
    const texture = new THREE.CanvasTexture(c.canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /* ==================================================================== *
   * 2 · ATTACH                                                           *
   * ==================================================================== */

  function attach(arena, opts) {
    const o = opts || {};
    const world = (arena && arena.world) || {};
    const THREE = world.THREE || root.THREE;
    if (!arena || !THREE || !THREE.Vector3 || !world.scene) return shim();
    const doc = root.document;
    const L = world.layout || root.E1ArenaLayout || null;
    const board = (L && L.BOARD) || { width: 16, depth: 10, thickness: 0.4 };

    let disposed = false;
    let lastTime = null;
    let affinity = affinityKey(o.affinity);
    let tier = (world.quality && world.quality.tier) || "high";
    const created = { geometries: [], materials: [], textures: [] };
    const keep = (kind, obj) => { if (obj) created[kind].push(obj); return obj; };

    function reduced() {
      if (isFn(o.reduced)) return Boolean(guard(o.reduced, false));
      if (isFn(arena.reduced)) return Boolean(guard(arena.reduced, false));
      return false;
    }
    const hidden = () => Boolean(doc && doc.hidden);
    function requestRender() {
      if (isFn(world.requestFrame)) return guard(() => world.requestFrame());
      if (isFn(world.dirty)) return guard(() => world.dirty());
    }

    const group = new THREE.Group();
    group.name = "env";
    world.scene.add(group);

    /* ------------------------------------------------------------------ *
     * 2a · CYCLORAMA                                                      *
     * ------------------------------------------------------------------ */

    const cycGeo = keep("geometries", new THREE.CylinderGeometry(CYC.radius, CYC.radius, CYC.height, CYC.segments, CYC.rows, true, Math.PI - (CYC.arc / 2) * RAD, CYC.arc * RAD));
    // A vertical gradient to black at the bottom, as vertex colours (no shader).
    if (cycGeo.attributes && cycGeo.attributes.position && THREE.Float32BufferAttribute) {
      const pos = cycGeo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const v = clamp((pos.getY(i) + CYC.height / 2) / CYC.height, 0, 1);
        const k = v < 0.36 ? (v / 0.36) * (v / 0.36) : 1;
        colors[i * 3] = k; colors[i * 3 + 1] = k; colors[i * 3 + 2] = k;
      }
      cycGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }
    const cycMat = keep("materials", new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    const cyclorama = new THREE.Mesh(cycGeo, cycMat);
    cyclorama.name = "cyclorama";
    cyclorama.position.set(0, CYC.y, CYC.z);
    cyclorama.renderOrder = -10;
    group.add(cyclorama);
    let backdropUrl = null;
    function loadBackdrop(url) {
      if (!url || disposed) return;
      const apply = (texture) => {
        if (disposed || !texture) return;
        // The hero's left 38 % is black (room for the site copy): hang only the room, mirrored
        // for the inside of the cylinder, and show the band from the table up to the lamp.
        if (THREE.ClampToEdgeWrapping) texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        if (texture.repeat && texture.offset) { texture.repeat.set(-0.62, 0.6); texture.offset.set(1, 0.35); }
        cycMat.map = texture; cycMat.needsUpdate = true;
        requestRender();
      };
      if (world.textures && isFn(world.textures.get)) {
        backdropUrl = url;
        if (isFn(world.textures.retain)) world.textures.retain(url);
        guard(() => world.textures.get(url).then(apply).catch(() => {}));
      } else if (THREE.TextureLoader) {
        guard(() => new THREE.TextureLoader().load(url, (t) => { keep("textures", t); apply(t); }, undefined, () => {}));
      }
    }
    loadBackdrop(o.backdrop);

    /* ------------------------------------------------------------------ *
     * 2b · FOG                                                            *
     * ------------------------------------------------------------------ */

    const fogTex = keep("textures", fogTexture(THREE, doc, FOG.size));
    const fog = [];
    {
      const rnd = rng(19);
      const lanes = [
        { z: -9.5, y: -1.2, w: 22, h: 6.5, speed: 0.05, opacity: 0.16 },
        { z: -13.5, y: -2.4, w: 26, h: 7.5, speed: 0.03, opacity: 0.12 },
        { z: -18, y: -3.6, w: 32, h: 9, speed: 0.02, opacity: 0.09 },
      ];
      for (let i = 0; i < FOG.count; i++) {
        const lane = lanes[i];
        const material = keep("materials", new THREE.SpriteMaterial({ map: fogTex, color: FOG.tint, transparent: true, opacity: lane.opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
        const sprite = new THREE.Sprite(material);
        sprite.name = "fog";
        sprite.scale.set(lane.w, lane.h, 1);
        sprite.position.set((rnd() - 0.5) * 8, lane.y, lane.z);
        sprite.renderOrder = -8;
        group.add(sprite);
        fog.push({ sprite, material, lane, dir: i % 2 ? -1 : 1, base: lane.opacity, phase: rnd() * Math.PI * 2 });
      }
    }

    /* ------------------------------------------------------------------ *
     * 2c · EMBERS                                                         *
     * ------------------------------------------------------------------ */

    const dotTex = keep("textures", dotTexture(THREE, doc, 64));
    const emberGeo = keep("geometries", new THREE.BufferGeometry());
    const emberPos = new Float32Array(EMBER.max * 3);
    const emberCol = new Float32Array(EMBER.max * 3);
    const ember = { speed: new Float32Array(EMBER.max), phase: new Float32Array(EMBER.max), sway: new Float32Array(EMBER.max), x0: new Float32Array(EMBER.max), count: 0 };
    const rndE = rng(1337);
    function spawnEmber(i, atBottom) {
      let x, z;
      if (rndE() < 0.62) { x = (rndE() * 2 - 1) * VOID.x; z = lerp(VOID.zFar, -board.depth / 2 - 0.6, rndE()); }
      else { x = (board.width / 2 + 0.6 + rndE() * (VOID.x - board.width / 2 - 0.6)) * (rndE() < 0.5 ? -1 : 1); z = lerp(VOID.zFar * 0.4, VOID.zNear, rndE()); }
      emberPos[i * 3] = x;
      emberPos[i * 3 + 1] = atBottom ? VOID.yLow : lerp(VOID.yLow, VOID.yHigh, rndE());
      emberPos[i * 3 + 2] = z;
      ember.x0[i] = x;
      ember.speed[i] = 0.14 + rndE() * 0.26;
      ember.phase[i] = rndE() * Math.PI * 2;
      ember.sway[i] = 0.12 + rndE() * 0.3;
    }
    for (let i = 0; i < EMBER.max; i++) spawnEmber(i, false);
    const emberPosAttr = new THREE.BufferAttribute(emberPos, 3);
    const emberColAttr = new THREE.BufferAttribute(emberCol, 3);
    if (THREE.DynamicDrawUsage) { emberPosAttr.setUsage(THREE.DynamicDrawUsage); emberColAttr.setUsage(THREE.DynamicDrawUsage); }
    emberGeo.setAttribute("position", emberPosAttr);
    emberGeo.setAttribute("color", emberColAttr);
    const emberMat = keep("materials", new THREE.PointsMaterial({ size: EMBER.size, map: dotTex, color: EMBER.tint, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.name = "embers";
    embers.frustumCulled = false;
    embers.renderOrder = -6;
    group.add(embers);
    const emberTint = { r: 1, g: 1, b: 1 };
    function twinkleEmbers(time) {
      for (let i = 0; i < ember.count; i++) {
        const y = emberPos[i * 3 + 1];
        const rise = clamp((y - VOID.yLow) / 1.5, 0, 1) * clamp((VOID.yHigh - y) / 2.5, 0, 1);
        const k = rise * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2.1 + ember.phase[i] * 3)));
        emberCol[i * 3] = k * emberTint.r; emberCol[i * 3 + 1] = k * emberTint.g; emberCol[i * 3 + 2] = k * emberTint.b;
      }
      emberColAttr.needsUpdate = true;
    }
    function moveEmbers(dt, time) {
      for (let i = 0; i < ember.count; i++) {
        let y = emberPos[i * 3 + 1] + ember.speed[i] * dt;
        if (y > VOID.yHigh) { spawnEmber(i, true); y = VOID.yLow; }
        emberPos[i * 3 + 1] = y;
        emberPos[i * 3] = ember.x0[i] + Math.sin(time * 0.5 + ember.phase[i]) * ember.sway[i];
      }
      emberPosAttr.needsUpdate = true;
    }

    /* ------------------------------------------------------------------ *
     * 2d · PACKETS on the traces                                          *
     * ------------------------------------------------------------------ */

    const traces = [];
    for (const raw of Array.isArray(world.traces) ? world.traces : []) {
      if (!Array.isArray(raw) || raw.length < 2) continue;
      const cum = [0];
      for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
      if (cum[cum.length - 1] > 0) traces.push({ points: raw, cum, length: cum[cum.length - 1], busy: false });
    }
    const packets = [];
    const packetY = PACKET.lift; // slab top is y = 0 in world space
    const rndP = rng(4242);
    for (let i = 0; i < PACKET.byTier.high; i++) {
      const material = keep("materials", new THREE.SpriteMaterial({ map: dotTex, color: PACKET.tint, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      const sprite = new THREE.Sprite(material);
      sprite.name = "packet";
      sprite.scale.set(PACKET.size, PACKET.size, 1);
      sprite.visible = false;
      sprite.renderOrder = 4;
      group.add(sprite);
      packets.push({ sprite, material, trace: -1, s: 0, forward: true, active: false, x: 0, z: 0, opacity: 0 });
    }
    function pointAt(trace, s, out) {
      const cum = trace.cum, pts = trace.points;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1];
      const k = seg > 0 ? clamp((s - cum[i - 1]) / seg, 0, 1) : 0;
      out.x = lerp(pts[i - 1].x, pts[i].x, k);
      out.z = lerp(pts[i - 1].z, pts[i].z, k);
      return out;
    }
    function launchPacket(p) {
      const free = [];
      for (let i = 0; i < traces.length; i++) if (!traces[i].busy) free.push(i);
      if (!free.length) { p.active = false; p.sprite.visible = false; return false; }
      const index = free[Math.floor(rndP() * free.length)];
      traces[index].busy = true;
      p.trace = index; p.s = 0; p.forward = rndP() < 0.5; p.active = true;
      p.sprite.visible = true;
      placePacket(p);
      return true;
    }
    function placePacket(p) {
      const trace = traces[p.trace];
      const s = p.forward ? p.s : trace.length - p.s;
      pointAt(trace, s, p);
      p.sprite.position.set(p.x, packetY, p.z);
      const edge = Math.min(p.s, trace.length - p.s);
      p.opacity = clamp(edge / PACKET.fade, 0, 1) * 0.95;
      p.material.opacity = p.opacity;
    }
    function movePackets(dt) {
      let live = 0;
      for (let i = 0; i < packets.length; i++) {
        const p = packets[i];
        if (i >= packetCount) { if (p.active) { traces[p.trace].busy = false; p.active = false; p.sprite.visible = false; } continue; }
        if (!p.active) { if (!launchPacket(p)) continue; }
        p.s += PACKET.speed * dt;
        const trace = traces[p.trace];
        if (p.s >= trace.length) { trace.busy = false; p.active = false; p.sprite.visible = false; continue; }
        placePacket(p);
        live++;
      }
      return live;
    }
    let packetCount = 0;

    /* ------------------------------------------------------------------ *
     * 2e · BREATHING: plate, queue glow, key light                         *
     * ------------------------------------------------------------------ */

    const plateMat = world.plate && world.plate.material ? world.plate.material : null;
    const glowMat = world.glow && world.glow.material ? world.glow.material : null;
    const key = world.lights && world.lights.key ? world.lights.key : null;
    const base = {
      plate: plateMat && plateMat.color ? guard(() => plateMat.color.getHex(), 0x8c8fa0) : 0x8c8fa0,
      glow: glowMat && glowMat.color ? guard(() => glowMat.color.getHex(), 0xffffff) : 0xffffff,
      key: key && typeof key.intensity === "number" ? key.intensity : 0,
    };
    function breathe(time) {
      const s = Math.sin((time / BREATH.period) * Math.PI * 2);
      if (plateMat && plateMat.color) plateMat.color.setHex(scaleHex(base.plate, 1 + BREATH.depth * s));
      // The glow is white and cannot brighten: it breathes down from full instead.
      if (glowMat && glowMat.color) glowMat.color.setHex(scaleHex(base.glow, 1 - BREATH.depth * (1 - s)));
      if (key) key.intensity = base.key * (1 + BREATH.flicker * noise1(time * 0.9, 3) * 0.6 + BREATH.flicker * noise1(time * 2.3, 11) * 0.4);
    }
    function restoreBreath() {
      if (plateMat && plateMat.color) plateMat.color.setHex(base.plate);
      if (glowMat && glowMat.color) glowMat.color.setHex(base.glow);
      if (key) key.intensity = base.key;
    }

    /* ==================================================================== *
     * 3 · AFFINITY, QUALITY, PARALLAX                                       *
     * ==================================================================== */

    let tintHex = 0;
    function applyAffinity(name) {
      affinity = affinityKey(name);
      const plate = PLATE[affinity];
      tintHex = mixHex(0xffffff, plate, affinity === "neutral" ? 0.5 : CYC.tint, CYC.brightness);
      cycMat.color.setHex(tintHex);
      const emberHex = mixHex(EMBER.tint, plate, 0.5, 1);
      emberTint.r = ((emberHex >> 16) & 255) / 255; emberTint.g = ((emberHex >> 8) & 255) / 255; emberTint.b = (emberHex & 255) / 255;
      const fogHex = mixHex(FOG.tint, plate, 0.3, 1);
      for (const f of fog) f.material.color.setHex(fogHex);
      twinkleEmbers(lastTime || 0);
      requestRender();
    }

    function applyTier(next) {
      tier = next === "low" || next === "mid" || next === "high" ? next : "high";
      ember.count = EMBER.byTier[tier];
      emberGeo.setDrawRange(0, ember.count);
      packetCount = Math.min(PACKET.byTier[tier], traces.length);
      for (const f of fog) f.sprite.visible = tier !== "low";
      requestRender();
    }

    function parallaxFollow() {
      const p = world.parallax;
      if (!p) return;
      cyclorama.rotation.y = (Number(p.x) || 0) * PARALLAX_DEG * RAD * CYC.parallax;
      cyclorama.position.y = CYC.y + (Number(p.y) || 0) * CYC.parallax * 0.6;
    }

    /* ==================================================================== *
     * 4 · TICK, ANIMATING                                                   *
     * ==================================================================== */

    function drawStatic() {
      // Reduced motion: one still frame — haze in place, embers scattered, no packets.
      for (const p of packets) { if (p.active) traces[p.trace].busy = false; p.active = false; p.sprite.visible = false; }
      twinkleEmbers(0);
      emberPosAttr.needsUpdate = true;
      restoreBreath();
      requestRender();
    }

    function tick(delta, time) {
      if (disposed) return;
      if (reduced()) { if (lastTime !== null) { lastTime = null; drawStatic(); } return; }
      const t = typeof time === "number" ? time : (lastTime || 0) + (Number(delta) || 0);
      const dt = lastTime === null ? 0 : clamp(t - lastTime, 0, 0.1);
      lastTime = t;
      parallaxFollow();
      for (let i = 0; i < fog.length; i++) {
        const f = fog[i];
        let x = f.sprite.position.x + f.dir * f.lane.speed * dt;
        const span = 7;
        if (x > span) x = -span; else if (x < -span) x = span;
        f.sprite.position.x = x;
        f.sprite.position.y = f.lane.y + Math.sin(t * 0.11 + f.phase) * 0.25;
        f.material.opacity = f.base * (0.95 + 0.05 * Math.sin(t * 0.17 + f.phase));
      }
      moveEmbers(dt, t);
      twinkleEmbers(t);
      movePackets(dt);
      breathe(t);
    }

    const animating = () => !disposed && !hidden() && !reduced();

    function onVisibility() { if (!disposed && !hidden()) requestRender(); }
    if (doc && isFn(doc.addEventListener)) doc.addEventListener("visibilitychange", onVisibility);

    /* ==================================================================== *
     * 5 · DISPOSE, THE ENV                                                  *
     * ==================================================================== */

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (doc && isFn(doc.removeEventListener)) doc.removeEventListener("visibilitychange", onVisibility);
      restoreBreath();
      if (world.scene && isFn(world.scene.remove)) world.scene.remove(group);
      if (backdropUrl && world.textures && isFn(world.textures.release)) world.textures.release(backdropUrl);
      for (const m of created.materials) guard(() => m.dispose && m.dispose());
      for (const g of created.geometries) guard(() => g.dispose && g.dispose());
      for (const t of created.textures) guard(() => t.dispose && t.dispose());
      created.materials.length = created.geometries.length = created.textures.length = 0;
    }

    function stats() {
      let live = 0;
      for (const p of packets) if (p.active) live++;
      return { tier, embers: ember.count, emberMax: EMBER.max, fog: tier === "low" ? 0 : fog.length, packets: packetCount, packetsLive: live, traces: traces.length, tint: tintHex, affinity, disposed };
    }
    function inspect() {
      return {
        emberPositions: emberPos, emberColors: emberCol, emberCount: ember.count,
        packets: packets.map((p) => ({ trace: p.trace, s: p.s, x: p.x, z: p.z, y: p.sprite.position.y, active: p.active, opacity: p.opacity, visible: p.sprite.visible })),
        traces, fog: fog.map((f) => ({ x: f.sprite.position.x, opacity: f.material.opacity, visible: f.sprite.visible })),
        cyclorama: { rotationY: cyclorama.rotation.y, tint: tintHex, hasMap: Boolean(cycMat.map) },
        plate: plateMat && plateMat.color ? guard(() => plateMat.color.getHex(), null) : null,
        keyIntensity: key ? key.intensity : null,
      };
    }

    applyTier(tier);
    applyAffinity(affinity);
    if (reduced()) drawStatic(); else requestRender();

    return {
      VERSION, group,
      tick, animating, dispose, stats, inspect,
      setAffinity(name) { if (!disposed) applyAffinity(name); },
      quality(next) { if (!disposed) applyTier(typeof next === "string" ? next : next && next.tier); return tier; },
      setBackdrop(url) { loadBackdrop(url); },
    };
  }

  /* The same names, doing nothing: attach() without a scene, or without THREE. */
  function shim() {
    const no = () => {};
    return {
      VERSION, group: null, tick: no, dispose: no, setAffinity: no, setBackdrop: no,
      animating: () => false, quality: () => "low",
      stats: () => ({ tier: "low", embers: 0, emberMax: 0, fog: 0, packets: 0, packetsLive: 0, traces: 0, tint: 0, affinity: "neutral", disposed: true }),
      inspect: () => ({ emberPositions: new Float32Array(0), emberColors: new Float32Array(0), emberCount: 0, packets: [], traces: [], fog: [], cyclorama: null, plate: null, keyIntensity: null }),
    };
  }

  root.E1Arena3DEnv = { attach, shim, VERSION, PLATE, EMBER, PACKET, FOG, CYC };
})(typeof globalThis !== "undefined" ? globalThis : this);
