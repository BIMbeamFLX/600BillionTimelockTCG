/*!
 * 600B TIMELOCK TCG — ARENA 3D · the WebGL table
 * MIT. Renders the table with three.js (site/vendor/three.js, r186); play.js keeps
 * rendering the DOM exactly as before and hands this module the `.gcard` nodes,
 * which become invisible hitboxes that follow the projected meshes every frame.
 *
 * This module never reads play.js state. It knows the engine's redacted view
 * only through E1ArenaLayout.planSync, and it never plays audio.
 *
 * Exposed as globalThis.E1Arena3D: { supported(), create(opts), VERSION }.
 * `opts.backdrop` is the cyclorama image arena3d-env.js hangs behind the table.
 * Every public method of an arena tolerates being called before a texture has
 * resolved and after dispose().
 */
(function (root) {
  "use strict";

  /* ==================================================================== *
   * 0 · TOKENS                                                           *
   * ==================================================================== */

  const VERSION = "1.0.0";

  const PALETTE = {
    orange: 0xf7931a, ember: 0xff6a00, gold: 0xf3c244, brass: 0xc9962e, brassDim: 0x6b5220,
    purple: 0x7447b8, violet: 0xb991e4, cream: 0xfff7ec, black: 0x09080b, soot: 0x111014,
    iron: 0x2a2730, steel: 0x3a3742, danger: 0xff4d3d, good: 0x6ee7a8, ground: 0x0d0b10,
  };

  /* Durations (ms). Cards tween, chrome cuts. */
  // restore: how long a lost context may take to come back before the classic table takes over;
  // touchQuiet: how long after a finger lifts the compatibility mouseenter/focus may not hover.
  const D = { hover: 140, move: 240, enter: 200, sample: 1500, grace: 1000, restore: 2500, touchQuiet: 700, statsEvery: 500 };
  const STATS_FRAMES = 120;
  const HOVER = { lift: 0.5, spread: 0.12 }; // world units: toward the camera; the fan's neighbours step aside
  const TEXTURE_LRU = 96;
  const PARALLAX_DEG = 1.2;

  /* ==================================================================== *
   * 1 · SMALL UTILITIES                                                  *
   * ==================================================================== */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const RAD = Math.PI / 180;

  function guard(fn, fallback) {
    try { return fn(); } catch (error) { return fallback; }
  }

  /* cubic-bezier(.2,.8,.25,1) — the card "snap". Solved on x by bisection. */
  function bezier(x1, y1, x2, y2) {
    const cx = (t) => 3 * x1 * (1 - t) * (1 - t) * t + 3 * x2 * (1 - t) * t * t + t * t * t;
    const cy = (t) => 3 * y1 * (1 - t) * (1 - t) * t + 3 * y2 * (1 - t) * t * t + t * t * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 18; i++) {
        t = (lo + hi) / 2;
        if (cx(t) < x) lo = t; else hi = t;
      }
      return cy(t);
    };
  }
  const EASE = { snap: bezier(0.2, 0.8, 0.25, 1), out: (t) => 1 - Math.pow(1 - t, 3) };

  const supportedCache = { value: null };
  function supported() {
    if (supportedCache.value !== null) return supportedCache.value;
    supportedCache.value = guard(() => {
      if (!root.document || !root.document.createElement) return false;
      const canvas = root.document.createElement("canvas");
      const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
      if (!gl) return false;
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
      return true;
    }, false);
    return supportedCache.value;
  }

  const isMobile = () => guard(() => {
    const touch = root.navigator && root.navigator.maxTouchPoints > 1;
    const coarse = root.matchMedia && root.matchMedia("(pointer: coarse)").matches;
    const small = Math.min(root.screen.width, root.screen.height) < 900;
    return Boolean((touch || coarse) && small);
  }, false);
  const coarsePointer = () => guard(() => Boolean(root.matchMedia && root.matchMedia("(pointer: coarse)").matches), false);
  // The screen's short side in CSS px: the same device in either orientation.
  const screenShort = () => guard(() => Math.min(root.screen.width, root.screen.height) || 0, 0);

  /* A rounded rectangle Shape, centred, with UVs remapped to [u0,v0]-[u1,v1]. */
  function roundedRectShape(THREE, w, h, r) {
    const shape = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    return shape;
  }
  function roundedRectGeometry(THREE, w, h, r, crop) {
    const geometry = new THREE.ShapeGeometry(roundedRectShape(THREE, w, h, r), 6);
    const uv = geometry.attributes.uv;
    const pos = geometry.attributes.position;
    const [u0, v0, u1, v1] = crop || [0, 0, 1, 1];
    for (let i = 0; i < uv.count; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      uv.setXY(i, u0 + ((px + w / 2) / w) * (u1 - u0), v0 + ((py + h / 2) / h) * (v1 - v0));
    }
    uv.needsUpdate = true;
    return geometry;
  }

  /* A soft radial dot on a canvas: the contact shadow and the fx dust sprite. */
  function radialTexture(THREE, size, inner, outer) {
    const canvas = root.document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /* Red ember cracks for `willdie`: a few jagged polylines from the centre. */
  function crackTexture(THREE) {
    const size = 256;
    const canvas = root.document.createElement("canvas");
    canvas.width = size; canvas.height = Math.round(size * 1.4);
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#ff4d3d";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ff6a00";
    ctx.shadowBlur = 6;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 6; k++) {
      let x = size / 2 + (rnd() - 0.5) * 30, y = canvas.height / 2 + (rnd() - 0.5) * 30;
      const angle = (k / 6) * Math.PI * 2 + rnd() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += Math.cos(angle + (rnd() - 0.5) * 1.2) * (12 + rnd() * 22);
        y += Math.sin(angle + (rnd() - 0.5) * 1.2) * (12 + rnd() * 22);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /* ==================================================================== *
   * 2 · THE PLAYFIELD — drawn once, in the card frame's language           *
   * ==================================================================== */

  /* Canvas px per world unit: 2048 / 16 = 1280 / 10 = 128. Canvas top is the
   * far edge (the foe), canvas bottom the near edge (you) — BoxGeometry's +y
   * face has v=1 at −z, and a CanvasTexture's row 0 is v=1. */
  function drawPlayfield(THREE, L) {
    const W = 2048, H = 1280, S = 128;
    const canvas = root.document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const X = (x) => (x + L.BOARD.width / 2) * S;
    const Y = (z) => (z + L.BOARD.depth / 2) * S;
    const BRASS = "rgba(201,150,46,", VIOLET = "rgba(185,145,228,";

    // Ground: near-black with a faint light well over the clash lane.
    ctx.fillStyle = "#0b0a0e";
    ctx.fillRect(0, 0, W, H);
    const well = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 720);
    well.addColorStop(0, "rgba(247,147,26,.10)");
    well.addColorStop(1, "rgba(9,8,11,0)");
    ctx.fillStyle = well;
    ctx.fillRect(0, 0, W, H);
    // A hairline grid, the terminal's raster.
    ctx.strokeStyle = VIOLET + ".045)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += S / 2) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += S / 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // PCB traces with rounded 45° bends, brass, from the corner pads inward.
    const trace = (points, width, alpha) => {
      ctx.strokeStyle = BRASS + alpha + ")";
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    };
    const via = (x, y, r, alpha) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = BRASS + alpha + ")"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = "#0b0a0e"; ctx.fill();
    };
    const runs = [
      [[60, 60], [60, 300], [180, 420], [180, 560]],
      [[W - 60, 60], [W - 60, 300], [W - 180, 420], [W - 180, 560]],
      [[60, H - 60], [60, H - 300], [180, H - 420], [180, H - 560]],
      [[W - 60, H - 60], [W - 60, H - 300], [W - 180, H - 420], [W - 180, H - 560]],
      [[60, 60], [300, 60], [420, 180], [700, 180]],
      [[W - 60, 60], [W - 300, 60], [W - 420, 180], [W - 700, 180]],
      [[60, H - 60], [300, H - 60], [420, H - 180], [700, H - 180]],
      [[W - 60, H - 60], [W - 300, H - 60], [W - 420, H - 180], [W - 700, H - 180]],
      [[240, 60], [240, 130], [310, 200], [310, 330]],
      [[W - 240, H - 60], [W - 240, H - 130], [W - 310, H - 200], [W - 310, H - 330]],
    ];
    for (const run of runs) {
      trace(run, 6, ".34");
      via(run[run.length - 1][0], run[run.length - 1][1], 11, ".5");
    }
    // Corner pads, like the frame corners of every card face.
    for (const [x, y] of [[60, 60], [W - 60, 60], [60, H - 60], [W - 60, H - 60]]) {
      ctx.fillStyle = VIOLET + ".9)";
      ctx.fillRect(x - 22, y - 22, 44, 44);
      ctx.fillStyle = "#0b0a0e";
      ctx.fillRect(x - 18, y - 18, 36, 36);
      ctx.fillStyle = "rgba(255,106,0,.85)";
      ctx.fillRect(x - 11, y - 11, 22, 22);
    }
    // Chip squares along the outer margins: iron bodies, brass legs.
    const chip = (x, y, w, h) => {
      ctx.fillStyle = "#1c1a22";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = VIOLET + ".35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = BRASS + ".55)";
      for (let i = 8; i < w - 6; i += 14) { ctx.fillRect(x + i, y - 8, 6, 8); ctx.fillRect(x + i, y + h, 6, 8); }
    };
    chip(X(-7.6), Y(-0.9), 90, 60); chip(X(-7.6), Y(0.3), 90, 60);
    chip(X(6.9), Y(-0.9), 90, 60); chip(X(6.9), Y(0.3), 90, 60);

    // The two network arcs, engraved: faint brass through the slot centres.
    const engrave = (zoneId) => {
      const slots = L.arcSlots(9, zoneId);
      ctx.strokeStyle = BRASS + ".22)";
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 14]);
      ctx.beginPath();
      slots.forEach((s, i) => (i ? ctx.lineTo(X(s.x), Y(s.z)) : ctx.moveTo(X(s.x), Y(s.z))));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const s of slots) via(X(s.x), Y(s.z), 7, ".28");
    };
    engrave("youNetwork");
    engrave("foeNetwork");
    // Resource rails and the deck / archive pads, quieter.
    for (const zoneId of ["youResources", "foeResources"]) {
      const slots = L.arcSlots(9, zoneId);
      ctx.strokeStyle = VIOLET + ".16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      slots.forEach((s, i) => (i ? ctx.lineTo(X(s.x), Y(s.z)) : ctx.moveTo(X(s.x), Y(s.z))));
      ctx.stroke();
    }
    for (const zoneId of ["youDeck", "foeDeck", "youArchive", "foeArchive"]) {
      const [cx, , cz] = L.ZONES[zoneId].centre;
      const w = L.CARD.width * 0.8 * S + 18, h = L.CARD.height * 0.8 * S + 18;
      ctx.strokeStyle = /Deck/.test(zoneId) ? BRASS + ".38)" : VIOLET + ".3)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(X(cx) - w / 2, Y(cz) - h / 2, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = VIOLET + ".55)";
      ctx.font = "900 20px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText(/Deck/.test(zoneId) ? "STACK" : "ARCHIVE", X(cx), Y(cz) + h / 2 + 26);
    }
    // The Queue slot at the centre: a dashed gold square, the clash lane.
    const q = L.ZONES.queue.centre;
    ctx.strokeStyle = "rgba(243,194,68,.55)";
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 12]);
    ctx.strokeRect(X(q[0]) - 110, Y(q[2]) - 100, 220, 200);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(243,194,68,.07)";
    ctx.fillRect(X(q[0]) - 110, Y(q[2]) - 100, 220, 200);
    // Footer: the terminal line, near the player.
    ctx.fillStyle = BRASS + ".75)";
    ctx.font = "900 30px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("TIMELOCK_TCG :: 600B", W / 2, H - 34);
    ctx.textAlign = "left";
    ctx.fillStyle = VIOLET + ".5)";
    ctx.font = "900 18px ui-monospace, Consolas, monospace";
    ctx.fillText("E1 // NODE RUNNER", 140, H - 34);
    ctx.textAlign = "right";
    ctx.fillText("ARENA v" + VERSION, W - 140, H - 34);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    // The trace polylines in world units (slab top, y = 0): arena3d-env.js runs packets along them.
    texture.userData.traces = runs.map((run) => run.map(([px, py]) => ({ x: px / S - L.BOARD.width / 2, z: py / S - L.BOARD.depth / 2 })));
    return texture;
  }

  /* ==================================================================== *
   * 3 · TEXTURE CACHE (LRU by url, dispose on eviction)                    *
   * ==================================================================== */

  function textureCache(THREE, renderer) {
    const map = new Map(); // url -> { texture, promise, inUse }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const maxAniso = guard(() => renderer.capabilities.getMaxAnisotropy(), 1);
    const evict = () => {
      if (map.size <= TEXTURE_LRU) return;
      for (const [url, entry] of map) {
        if (entry.inUse > 0) continue;
        map.delete(url);
        if (entry.texture) entry.texture.dispose();
        if (map.size <= TEXTURE_LRU) return;
      }
    };
    return {
      size: () => map.size,
      /* Promise<Texture>; the same texture object for the same url. */
      get(url) {
        if (!url) return Promise.reject(new Error("no url"));
        const hit = map.get(url);
        if (hit) {
          map.delete(url); map.set(url, hit); // touch: most recently used last
          return hit.promise;
        }
        const entry = { texture: null, inUse: 0, promise: null };
        entry.promise = new Promise((resolve, reject) => {
          loader.load(url, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(4, maxAniso);
            texture.generateMipmaps = true;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            entry.texture = texture;
            resolve(texture);
          }, undefined, (error) => { map.delete(url); reject(error); });
        });
        map.set(url, entry);
        evict();
        return entry.promise;
      },
      forEach(fn) { for (const e of map.values()) if (e.texture) fn(e.texture); },
      retain(url) { const e = map.get(url); if (e) e.inUse += 1; },
      release(url) { const e = map.get(url); if (e) e.inUse = Math.max(0, e.inUse - 1); },
      dispose() { for (const e of map.values()) if (e.texture) e.texture.dispose(); map.clear(); },
    };
  }

  /* ==================================================================== *
   * 4 · create()                                                         *
   * ==================================================================== */

  function create(opts) {
    const o = opts || {};
    const THREE = o.THREE || root.THREE;
    const L = root.E1ArenaLayout;
    if (!THREE) throw new Error("arena3d: THREE is missing");
    if (!L) throw new Error("arena3d: E1ArenaLayout is missing");
    const host = o.host;
    if (!host || !host.appendChild) throw new Error("arena3d: host element is missing");
    const doc = root.document;
    const reduced = () => Boolean(typeof o.reduced === "function" ? o.reduced() : o.reduced);

    /* ---- card lookup + faces ------------------------------------------ */
    const cardsList = Array.isArray(o.cards) ? o.cards : root.E1_CARDS || [];
    const cardById = new Map(cardsList.map((card) => [card.id, card]));
    const faceUrl = (card) => {
      if (!card) return null;
      if (o.faces && typeof o.faces.urlFor === "function") return guard(() => o.faces.urlFor(card), null);
      return card.face ? "../art/cards/node-runner-web/" + encodeURIComponent(card.face) : null;
    };
    const artCrop = (card) => {
      const geo = o.geometry;
      if (!geo || !geo.faces || !card || !card.face || !Array.isArray(geo.size)) return null;
      const rect = geo.faces[card.face];
      if (!Array.isArray(rect) || rect.length !== 4 || rect[2] <= 0 || rect[3] <= 0) return null;
      const [W, H] = geo.size;
      const [x, y, w, h] = rect;
      return [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
    };

    /* ---- renderer ----------------------------------------------------- */
    const canvas = doc.createElement("canvas");
    canvas.className = "arena3d";
    canvas.setAttribute("aria-hidden", "true");
    host.insertBefore(canvas, host.firstChild);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (error) {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      throw error;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    // r186 dropped PCFSoftShadowMap (it warns and falls back); PCF is the soft map that is left.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 120);
    const groups = { board: new THREE.Group(), cards: new THREE.Group(), fx: new THREE.Group() };
    groups.board.name = "board"; groups.cards.name = "cards"; groups.fx.name = "fx";
    scene.add(groups.board, groups.cards, groups.fx);

    /* ---- clock: freezable for hit-stop --------------------------------- */
    const clock = {
      time: 0, delta: 0, frozenUntil: 0, _last: null,
      freeze(ms) { this.frozenUntil = Math.max(this.frozenUntil, (this._last || 0) + (Number(ms) || 0)); },
      advance(now) {
        const last = this._last == null ? now : this._last;
        this._last = now;
        if (now < this.frozenUntil) { this.delta = 0; return 0; }
        this.delta = clamp(now - last, 0, 100) / 1000;
        this.time += this.delta;
        return this.delta;
      },
      getDelta() { return this.delta; },
      getElapsedTime() { return this.time; },
    };

    /* ---- lights -------------------------------------------------------- */
    const hemi = new THREE.HemisphereLight(0xece3d0, 0x0f0c08, 0.9);
    scene.add(hemi);
    const key = new THREE.SpotLight(0xfff1dc, 420, 60, 0.62, 0.55, 1.4);
    key.position.set(3.5, 13, 11);
    key.target.position.set(0, 0, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 4; key.shadow.camera.far = 40;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(PALETTE.brass, 1.6);
    rim.position.set(-4, 5, -12);
    rim.target.position.set(0, 0, 0);
    scene.add(rim, rim.target);
    const glowLight = new THREE.PointLight(PALETTE.orange, 9, 8, 1.6);
    glowLight.position.set(0, 1.1, 0.1);
    scene.add(glowLight);

    /* ---- the slab, the plate, the stacks -------------------------------- */
    const playfield = drawPlayfield(THREE, L);
    const ironMat = new THREE.MeshStandardMaterial({ color: PALETTE.iron, roughness: 0.62, metalness: 0.55 });
    const topMat = new THREE.MeshStandardMaterial({ map: playfield, roughness: 0.78, metalness: 0.22 });
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(L.BOARD.width, L.BOARD.thickness, L.BOARD.depth),
      [ironMat, ironMat, topMat, ironMat, ironMat, ironMat]
    );
    slab.position.y = -L.BOARD.thickness / 2;
    slab.receiveShadow = true;
    groups.board.add(slab);
    // A brass bevel line around the top edge: the frame of the frame.
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(L.BOARD.width + 0.24, 0.06, L.BOARD.depth + 0.24),
      new THREE.MeshStandardMaterial({ color: PALETTE.brassDim, roughness: 0.4, metalness: 0.9 })
    );
    edge.position.y = -0.07; // its top sits under the slab's, never coplanar with the playfield
    groups.board.add(edge);
    // The centre glow: an emissive disc under the queue slot.
    const glowDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 3.2),
      new THREE.MeshBasicMaterial({ map: radialTexture(THREE, 256, "rgba(247,147,26,.35)", "rgba(247,147,26,0)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.set(0, 0.006, 0.1);
    groups.board.add(glowDisc);

    // The affinity world plate: a dim panel beyond the far edge.
    const plateMat = new THREE.MeshBasicMaterial({ color: 0x8c8fa0, transparent: true, opacity: 0.0, depthWrite: false });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.6), plateMat);
    plate.position.set(0, 1.55, -7.8);
    plate.rotation.x = -0.28;
    groups.board.add(plate);

    const textures = textureCache(THREE, renderer);
    const shadowTex = radialTexture(THREE, 128, "rgba(0,0,0,.55)", "rgba(0,0,0,0)");
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 1 });
    const cardGeo = roundedRectGeometry(THREE, L.CARD.width, L.CARD.height, L.CARD.radius);
    // The back texture is bright; a grey tint and a rougher surface keep the foe's fan from glowing white.
    const backMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.7, metalness: 0.08 });
    const blankMat = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.6, metalness: 0.2, emissive: PALETTE.brassDim, emissiveIntensity: 0.15 });
    if (o.back) textures.get(o.back).then((t) => { backMat.map = t; backMat.needsUpdate = true; markDirty(); }).catch(() => {});

    const stackNodes = [];
    function buildStacks() {
      for (const zoneId of ["youDeck", "foeDeck", "youArchive", "foeArchive"]) {
        const zone = L.ZONES[zoneId];
        const [slot] = L.arcSlots(1, zoneId);
        const archive = /Archive/.test(zoneId);
        const count = archive ? 3 : 7;
        const pile = new THREE.Group();
        pile.name = zoneId;
        for (let i = 0; i < count; i++) {
          const card = new THREE.Mesh(cardGeo, archive ? blankMat : backMat);
          card.rotation.set(slot.pitch, (zone.yaw || 0) + (i % 2 ? 0.012 : -0.012) * i, 0, "YXZ");
          card.position.set(slot.x + (i % 3) * 0.006, slot.y + i * 0.014, slot.z + ((i * 7) % 3) * 0.006);
          card.scale.setScalar(slot.scale);
          card.castShadow = i === count - 1;
          card.receiveShadow = true;
          pile.add(card);
        }
        groups.board.add(pile);
        stackNodes.push(pile);
      }
    }
    buildStacks();

    /* ---- shared materials for the fx layer ------------------------------ */
    const materials = {
      glow: new THREE.MeshBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      shard: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.5, metalness: 0.6, emissive: PALETTE.ember, emissiveIntensity: 0.25, side: THREE.DoubleSide }),
      dust: new THREE.SpriteMaterial({ map: radialTexture(THREE, 64, "rgba(255,247,236,.9)", "rgba(255,247,236,0)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: PALETTE.gold }),
      ringTarget: new THREE.MeshBasicMaterial({ color: PALETTE.brass, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
      ringSelected: new THREE.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
      glowGreen: new THREE.MeshBasicMaterial({ color: PALETTE.good, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
      glowEmber: new THREE.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
      cracks: new THREE.MeshBasicMaterial({ map: crackTexture(THREE), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    const ringGeo = new THREE.RingGeometry(0.62, 0.72, 48);
    const tokenGeos = (() => {
      const frameShape = roundedRectShape(THREE, L.TOKEN.width, L.TOKEN.height, 0.34);
      const hole = roundedRectShape(THREE, L.TOKEN.width - 0.2, L.TOKEN.height - 0.2, 0.26);
      frameShape.holes.push(hole);
      const insetShape = roundedRectShape(THREE, L.TOKEN.width - 0.16, L.TOKEN.height - 0.16, 0.28);
      insetShape.holes.push(roundedRectShape(THREE, L.TOKEN.width - 0.26, L.TOKEN.height - 0.26, 0.22));
      return {
        frame: new THREE.ExtrudeGeometry(frameShape, { depth: 0.05, bevelEnabled: false, curveSegments: 8 }),
        inset: new THREE.ExtrudeGeometry(insetShape, { depth: 0.062, bevelEnabled: false, curveSegments: 8 }),
        plate: roundedRectGeometry(THREE, L.TOKEN.width - 0.1, L.TOKEN.height - 0.1, 0.3),
        glow: roundedRectGeometry(THREE, L.TOKEN.width + 0.16, L.TOKEN.height + 0.16, 0.4),
      };
    })();
    const cardGlowGeo = roundedRectGeometry(THREE, L.CARD.width + 0.14, L.CARD.height + 0.14, 0.12);
    const brassMat = new THREE.MeshStandardMaterial({ color: PALETTE.brass, roughness: 0.32, metalness: 0.85 });
    const insetMat = new THREE.MeshStandardMaterial({ color: PALETTE.iron, roughness: 0.5, metalness: 0.7 });
    const artGeoCache = new Map(); // crop key -> geometry

    /* ==================================================================== *
     * 5 · REGISTRY, BUILDERS, PLACEMENT                                    *
     * ==================================================================== */

    const registry = new Map(); // uid -> entry
    let plan = null;            // planSync's `next`
    let mode = "landscape";
    let hovered = null;
    let disposed = false;
    let lost = false;

    function newEntry(p) {
      return {
        uid: p.uid, zone: p.zone, kind: p.kind, index: p.index, count: p.count, cardId: p.cardId || null,
        card: p.cardId ? cardById.get(p.cardId) || null : null,
        owner: p.owner, committed: Boolean(p.committed), facedown: Boolean(p.facedown),
        mesh: null, shadow: null, node: null, rect: null, lastRect: null,
        home: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 },
        state: {}, tween: null, url: null, parts: {}, gone: false, goneAt: 0,
      };
    }

    function faceMaterial(entry) {
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.06, map: null });
      material.color.setHex(PALETTE.steel);
      const url = faceUrl(entry.card);
      if (!url) return material;
      Promise.resolve(url).then((resolved) => {
        if (!resolved || disposed || entry.gone) return;
        entry.url = resolved;
        textures.retain(resolved);
        return textures.get(resolved).then((texture) => {
          if (disposed || entry.gone) return;
          material.map = texture;
          material.color.setHex(0xffffff);
          material.needsUpdate = true;
          markDirty();
        });
      }).catch(() => {});
      return material;
    }

    function artGeometry(crop) {
      const key = crop ? crop.map((v) => v.toFixed(4)).join(",") : "full";
      if (!artGeoCache.has(key)) {
        artGeoCache.set(key, roundedRectGeometry(THREE, L.TOKEN.width - 0.24, L.TOKEN.height - 0.24, 0.22, crop));
      }
      return artGeoCache.get(key);
    }

    /* A card: front face + back, rounded, both cast a shadow. */
    function buildCard(entry) {
      const rig = new THREE.Group();
      rig.name = entry.uid;
      const faceUp = entry.kind !== "back" && !entry.facedown && entry.card;
      const front = new THREE.Mesh(cardGeo, faceUp ? faceMaterial(entry) : backMat);
      front.castShadow = true;
      front.receiveShadow = true;
      const back = new THREE.Mesh(cardGeo, backMat);
      back.rotation.y = Math.PI;
      back.position.z = -0.004;
      rig.add(front, back);
      entry.parts = { front, back, body: front };
      return rig;
    }

    /* A token: brass frame, iron inset, the art crop standing in the window. */
    function buildToken(entry) {
      const rig = new THREE.Group();
      rig.name = entry.uid;
      const frame = new THREE.Mesh(tokenGeos.frame, brassMat);
      frame.castShadow = true;
      const inset = new THREE.Mesh(tokenGeos.inset, insetMat);
      inset.position.z = -0.006;
      const plateBack = new THREE.Mesh(tokenGeos.plate, insetMat);
      plateBack.position.z = 0.012;
      const art = new THREE.Mesh(artGeometry(entry.facedown || !entry.card ? null : artCrop(entry.card)), entry.facedown || !entry.card ? backMat : faceMaterial(entry));
      art.position.z = 0.03;
      rig.add(frame, inset, plateBack, art);
      entry.parts = { frame, inset, art, body: frame };
      return rig;
    }

    function buildShadow(entry) {
      const size = entry.kind === "token" ? 1.9 : 1.7;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.1), shadowMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = -1;
      return mesh;
    }

    function slotFor(entry) {
      const slots = L.arcSlots(entry.count, entry.zone, mode);
      return slots[Math.min(entry.index, slots.length - 1)] || null;
    }

    const eulerTmp = new THREE.Euler();
    const normalTmp = new THREE.Vector3();
    const FAN_LAYER = 0.01; // world units along the card normal between neighbours of a held fan
    function homeFromSlot(entry, slot) {
      const yaw = slot.yaw + (entry.committed && entry.kind === "card" && /Resources/.test(entry.zone) ? Math.PI / 2 : 0);
      entry.home.position.set(slot.x, slot.y, slot.z);
      entry.home.quaternion.setFromEuler(eulerTmp.set(slot.pitch, yaw, slot.roll, "YXZ"));
      entry.home.scale = slot.scale;
      /* The two middle cards of an even fan sit on the same plane (the arc is
         symmetric), and z-fought where they overlap. A hair along the normal,
         right over left, gives every neighbour its own depth. */
      if (/Hand$/.test(entry.zone) && entry.count > 1) {
        normalTmp.set(0, 0, 1).applyQuaternion(entry.home.quaternion);
        entry.home.position.addScaledVector(normalTmp, (entry.index - (entry.count - 1) / 2) * FAN_LAYER);
      }
    }

    /* Put a mesh at a pose: instantly, or as a tween the tick advances. */
    function moveTo(entry, pose, ms) {
      const mesh = entry.mesh;
      if (!mesh) return;
      if (!ms || reduced()) {
        mesh.position.copy(pose.position);
        mesh.quaternion.copy(pose.quaternion);
        mesh.scale.setScalar(pose.scale);
        entry.tween = null;
        markDirty();
        return;
      }
      entry.tween = {
        from: { position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.x },
        to: { position: pose.position.clone(), quaternion: pose.quaternion.clone(), scale: pose.scale },
        t0: clock.time, ms,
      };
      requestFrame();
    }

    function place(entry, animate) {
      const slot = slotFor(entry);
      if (!slot) return;
      homeFromSlot(entry, slot);
      moveTo(entry, entry.home, animate ? D.move : 0);
      applyState(entry);
    }

    function addEntry(p) {
      const entry = newEntry(p);
      entry.mesh = p.kind === "token" ? buildToken(entry) : buildCard(entry);
      entry.shadow = buildShadow(entry);
      groups.cards.add(entry.mesh, entry.shadow);
      registry.set(p.uid, entry);
      place(entry, false);
      return entry;
    }

    function removeEntry(entry) {
      if (!entry.gone) {
        entry.gone = true;
        entry.goneAt = clock.time;
        entry.mesh.visible = false;
        entry.shadow.visible = false;
        if (entry.node) entry.node = null;
        if (hovered === entry) hovered = null;
      }
    }

    function destroyEntry(entry) {
      registry.delete(entry.uid);
      groups.cards.remove(entry.mesh, entry.shadow);
      entry.shadow.geometry.dispose();
      for (const part of Object.values(entry.parts)) {
        if (part && part.material && part.material !== backMat && part.material !== brassMat
          && part.material !== insetMat && part.material !== blankMat) part.material.dispose();
      }
      for (const glow of ["ring", "glow", "cracks"]) if (entry[glow]) entry[glow].parent && entry[glow].parent.remove(entry[glow]);
      if (entry.url) textures.release(entry.url);
    }

    /* ==================================================================== *
     * 6 · STATES + HOVER                                                    *
     * ==================================================================== */

    const STATE_KEYS = ["selected", "targetable", "canplay", "canattack", "committed", "attacking", "willdie"];
    const MARK_ALIAS = { canact: "canplay", needsblock: "targetable", canblock: "targetable", blockpick: "selected", meshed: "attacking" };

    function ringFor(entry, material) {
      if (!entry.ring) {
        entry.ring = new THREE.Mesh(ringGeo, material);
        entry.ring.rotation.x = -Math.PI / 2;
        entry.ring.renderOrder = 1;
        groups.cards.add(entry.ring);
      }
      entry.ring.material = material;
      entry.ring.visible = true;
      entry.ring.scale.setScalar(entry.kind === "token" ? 1.05 : entry.home.scale);
      entry.ring.position.set(entry.mesh.position.x, 0.008, entry.mesh.position.z + (entry.kind === "token" ? 0.12 : 0));
    }

    function applyState(entry) {
      if (!entry.mesh) return;
      const s = entry.state;
      // Rings under the token: selected (ember) beats targetable (brass).
      if (s.selected) ringFor(entry, materials.ringSelected);
      else if (s.targetable) ringFor(entry, materials.ringTarget);
      else if (entry.ring) entry.ring.visible = false;
      // Edge glow behind the body: one green per screen — the glow, not a fill.
      const glowMat = s.attacking ? materials.glowEmber : (s.canplay || s.canattack) ? materials.glowGreen : null;
      if (glowMat) {
        if (!entry.glow) {
          entry.glow = new THREE.Mesh(entry.kind === "token" ? tokenGeos.glow : cardGlowGeo, glowMat);
          entry.glow.position.z = -0.012;
          entry.mesh.add(entry.glow);
        }
        entry.glow.material = glowMat;
        entry.glow.visible = true;
      } else if (entry.glow) entry.glow.visible = false;
      // Red ember cracks over the art.
      if (s.willdie) {
        if (!entry.cracks) {
          entry.cracks = new THREE.Mesh(entry.kind === "token" ? artGeometry(null) : cardGeo, materials.cracks);
          entry.cracks.position.z = entry.kind === "token" ? 0.036 : 0.004;
          entry.mesh.add(entry.cracks);
        }
        entry.cracks.visible = true;
      } else if (entry.cracks) entry.cracks.visible = false;
      // Committed: dim — emissive down, colour down. Tokens never turn 90°.
      const dim = Boolean(s.committed || entry.committed);
      const body = entry.parts.art || entry.parts.front;
      if (body && body.material && body.material !== backMat) {
        body.material.color.setHex(body.material.map ? (dim ? 0x8a8a90 : 0xffffff) : PALETTE.steel);
      }
      if (entry.parts.frame) entry.parts.frame.material = dim ? insetMat : brassMat;
      markDirty();
    }

    function hoverPose(entry) {
      const pose = { position: entry.home.position.clone(), quaternion: entry.home.quaternion.clone(), scale: entry.home.scale };
      const toCamera = camera.position.clone().sub(entry.home.position).normalize();
      const hand = entry.zone === "youHand";
      pose.position.addScaledVector(toCamera, hand ? HOVER.lift : 0.28).add(new THREE.Vector3(0, hand ? 0.22 : 0.16, 0));
      // Straighten: drop the roll and, for flat cards, lift the near edge.
      const e = new THREE.Euler().setFromQuaternion(entry.home.quaternion, "YXZ");
      e.z = 0;
      if (Math.abs(e.x + Math.PI / 2) < 0.01) e.x = -Math.PI / 2 + 0.35;
      pose.quaternion.setFromEuler(e);
      pose.scale = entry.home.scale * (hand ? 1.18 : entry.kind === "token" ? 1.08 : 1.35);
      return pose;
    }
    /* The hover spread: every other card of the own fan steps 0.12 units away
       from the hovered one (to its side), so the lifted card never hides under
       a neighbour. `apply` false moves them home again. */
    function spreadFan(around, apply) {
      if (!around || around.zone !== "youHand") return;
      for (const entry of registry.values()) {
        if (entry === around || entry.gone || entry.zone !== "youHand" || !entry.mesh) continue;
        if (!apply) { moveTo(entry, entry.home, D.hover); continue; }
        const side = entry.index < around.index ? -1 : entry.index > around.index ? 1 : 0;
        if (!side) continue;
        const pose = { position: entry.home.position.clone(), quaternion: entry.home.quaternion, scale: entry.home.scale };
        pose.position.x += side * HOVER.spread;
        moveTo(entry, pose, D.hover);
      }
    }

    /* ==================================================================== *
     * 7 · CAMERA: base, parallax, modifiers                                *
     * ==================================================================== */

    const cam = {
      three: camera,
      base: { position: new THREE.Vector3(0, 10, 15), target: new THREE.Vector3(0, 0, 0.8), fov: 42 },
      modifiers: [],
      shake(strength, ms) {
        if (disposed) return;
        cam.modifiers.push({ kind: "shake", strength: clamp(Number(strength) || 0.3, 0, 3), ms: Number(ms) || 180, t0: clock.time, seed: Math.random() * 1000 });
        requestFrame();
      },
      push(zoom, ms, extra) {
        if (disposed) return;
        cam.modifiers.push({ kind: "push", zoom: Number(zoom) || 0.06, ms: Number(ms) || 900, t0: clock.time, hold: Boolean(extra && extra.hold), toward: extra && extra.toward || null });
        requestFrame();
      },
      reset() { cam.modifiers.length = 0; markDirty(); },
    };
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    const camTmp = { pos: new THREE.Vector3(), target: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3() };

    function frameCamera() {
      const vp = viewport();
      const solved = L.cameraFor(vp.width / Math.max(1, vp.height));
      cam.base.position.fromArray(solved.position);
      cam.base.target.fromArray(solved.target);
      cam.base.fov = solved.fov;
      camera.fov = solved.fov;
      camera.aspect = vp.width / Math.max(1, vp.height);
      camera.updateProjectionMatrix();
      return solved.mode;
    }

    function applyCamera() {
      const now = clock.time;
      camTmp.pos.copy(cam.base.position);
      camTmp.target.copy(cam.base.target);
      // Parallax: a small orbit around the target, easing toward the pointer.
      parallax.x = lerp(parallax.x, parallax.tx, 0.12);
      parallax.y = lerp(parallax.y, parallax.ty, 0.12);
      if (Math.abs(parallax.x) > 1e-4 || Math.abs(parallax.y) > 1e-4) {
        camTmp.dir.subVectors(camTmp.pos, camTmp.target);
        camTmp.dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), parallax.x * PARALLAX_DEG * RAD);
        camTmp.right.set(1, 0, 0);
        camTmp.dir.applyAxisAngle(camTmp.right, parallax.y * PARALLAX_DEG * RAD);
        camTmp.pos.addVectors(camTmp.target, camTmp.dir);
      }
      let fovScale = 1;
      for (let i = cam.modifiers.length - 1; i >= 0; i--) {
        const m = cam.modifiers[i];
        const t = (now - m.t0) * 1000 / m.ms;
        if (t >= 1 && !m.hold) { cam.modifiers.splice(i, 1); continue; }
        if (m.kind === "shake") {
          const amp = m.strength * 0.18 * (1 - clamp(t, 0, 1));
          const phase = now * 47 + m.seed;
          camTmp.pos.x += Math.sin(phase) * amp;
          camTmp.pos.y += Math.cos(phase * 1.31) * amp * 0.6;
        } else if (m.kind === "push") {
          const k = m.hold ? clamp(t, 0, 1) : Math.sin(clamp(t, 0, 1) * Math.PI);
          fovScale *= 1 - m.zoom * k;
          if (m.toward) {
            camTmp.target.x += (Number(m.toward.x) || 0) * k;
            camTmp.target.z += (Number(m.toward.z) || 0) * k;
          }
        }
      }
      camera.position.copy(camTmp.pos);
      camera.lookAt(camTmp.target);
      const fov = cam.base.fov * fovScale;
      if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    }

    function onPointerMove(event) {
      if (reduced() || disposed) return;
      if (event.pointerType === "touch") return; // a finger dragging a card is not looking around
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      parallax.tx = clamp(((event.clientX - rect.left) / rect.width - 0.5) * -2, -1, 1);
      parallax.ty = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
      requestFrame();
    }
    function onPointerLeave() { parallax.tx = 0; parallax.ty = 0; requestFrame(); }
    /* A FINGER HAS NO HOVER. A tap fires pointerup and THEN the compatibility
       mouseenter and focus on the hitbox, and nothing ever sends the matching
       leave: the tapped card stayed lifted and its neighbours spread until the
       next tap somewhere else. So a lifting finger clears the hover, and for a
       moment after it hover(uid) is ignored. */
    const touch = { down: false, quietUntil: 0 };
    const nowMs = () => (root.performance ? root.performance.now() : Date.now());
    function onPointerDown(event) { if (event.pointerType === "touch") touch.down = true; }
    function onPointerUp(event) {
      if (event.pointerType !== "touch" || disposed) return;
      touch.down = false;
      touch.quietUntil = nowMs() + D.touchQuiet;
      arena.hover(null);
    }
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave, { passive: true });
    host.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
    host.addEventListener("pointerup", onPointerUp, { passive: true, capture: true });
    host.addEventListener("pointercancel", onPointerUp, { passive: true, capture: true });

    /* ==================================================================== *
     * 8 · PROJECTION → HITBOXES                                             *
     * ==================================================================== */

    const cornerTmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const ndcTmp = [[0, 0], [0, 0], [0, 0], [0, 0]];
    function viewport() {
      const w = host.clientWidth || (root.innerWidth || 800);
      const h = host.clientHeight || (root.innerHeight || 600);
      return { width: w, height: h };
    }

    function projectEntry(entry, vp) {
      const body = entry.parts.body;
      if (!body || !entry.mesh) return null;
      const w = entry.kind === "token" ? L.TOKEN.width : L.CARD.width;
      const h = entry.kind === "token" ? L.TOKEN.height : L.CARD.height;
      entry.mesh.updateMatrixWorld(true);
      const m = entry.mesh.matrixWorld;
      cornerTmp[0].set(-w / 2, -h / 2, 0).applyMatrix4(m).project(camera);
      cornerTmp[1].set(w / 2, -h / 2, 0).applyMatrix4(m).project(camera);
      cornerTmp[2].set(w / 2, h / 2, 0).applyMatrix4(m).project(camera);
      cornerTmp[3].set(-w / 2, h / 2, 0).applyMatrix4(m).project(camera);
      for (let i = 0; i < 4; i++) { ndcTmp[i][0] = cornerTmp[i].x; ndcTmp[i][1] = cornerTmp[i].y; }
      return L.projectRect(ndcTmp, vp);
    }

    /* THE HITBOX ON TOP IS THE CARD ON TOP. Every hitbox had the same z-index,
       so where two fan cards overlap the later DOM node won -- the right-hand
       one -- while the fan draws the card nearer the middle in front. On the
       right half of the fan a tap on the visible card played its neighbour.
       The own hand's hitboxes are stacked by distance to the camera instead,
       from HAND_Z: above play.html's board chrome (20), below its buttons and a
       playerbar that is a target (50). */
    const HAND_Z = 21;
    const handOrder = [];
    function stackHand() {
      handOrder.length = 0;
      for (const entry of registry.values()) if (!entry.gone && entry.zone === "youHand" && entry.node && entry.node.style) handOrder.push(entry);
      for (const entry of handOrder) entry.depth = entry.mesh.position.distanceToSquared(camera.position);
      handOrder.sort((a, b) => b.depth - a.depth || a.index - b.index);
      for (let i = 0; i < handOrder.length; i++) {
        const z = String(HAND_Z + i);
        if (handOrder[i].node.style.zIndex !== z) handOrder[i].node.style.zIndex = z;
      }
    }

    function projectAll() {
      const vp = viewport();
      let handMoved = false;
      for (const entry of registry.values()) {
        if (entry.gone) continue;
        const rect = projectEntry(entry, vp);
        if (!rect) continue;
        entry.rect = rect;
        const node = entry.node;
        if (!node || !node.style) continue;
        const last = entry.lastRect;
        if (last && last.left === rect.left && last.top === rect.top && last.width === rect.width && last.height === rect.height) continue;
        entry.lastRect = rect;
        node.style.left = rect.left + "px";
        node.style.top = rect.top + "px";
        node.style.width = rect.width + "px";
        node.style.height = rect.height + "px";
        if (entry.zone === "youHand") handMoved = true;
      }
      if (handMoved) stackHand();
    }

    /* ==================================================================== *
     * 9 · TICK, QUALITY, RESIZE, LOSS                                       *
     * ==================================================================== */

    const stats = { frameMs: 0, lastFrameMs: 0, frames: 0, syncMs: 0, drawCalls: 0 };
    // gapMs: rAF time between rendered frames. A phone's GPU work lands after render()
    // returns, so its sample is the larger of the two; a desktop keeps the CPU time.
    const sample = { frameMs: [], gapMs: [], until: 0, active: o.quality === "auto" || !o.quality };
    let dirty = true;
    let rafId = 0;
    let envSkip = false;
    let lastRenderAt = 0;
    let hidden = Boolean(doc && doc.visibilityState === "hidden");
    const phoneLike = () => isMobile() || coarsePointer();
    const device = (extra) => Object.assign({
      isMobile: isMobile(), coarse: coarsePointer(), width: screenShort(), dpr: root.devicePixelRatio || 1, reduced: reduced(),
    }, extra);
    const forcedTier = o.quality && o.quality !== "auto" ? String(o.quality) : null;
    let qualityNow = L.quality(device(forcedTier ? { tier: forcedTier } : null));

    function markDirty() { dirty = true; requestFrame(); }
    function requestFrame() {
      if (rafId || disposed || lost || hidden) return;
      rafId = root.requestAnimationFrame ? root.requestAnimationFrame(tick) : setTimeout(() => tick(Date.now()), 16);
    }

    /* ---- ?arenastats=1: the diagnostics chip --------------------------- *
     * Off by default and then free: no chip, no buffers, no timer. On, the
     * last STATS_FRAMES rendered frames go into two ring buffers and a fixed
     * chip reads them twice a second. */
    const statsChip = o.stats && doc && doc.body ? (() => {
      const chip = doc.createElement("div");
      chip.className = "arena3d-stats";
      chip.setAttribute("aria-hidden", "true");
      chip.style.cssText = "position:fixed;left:calc(8px + env(safe-area-inset-left, 0px));bottom:calc(8px + env(safe-area-inset-bottom, 0px));"
        + "z-index:1000;pointer-events:none;white-space:pre;padding:4px 7px;border:1px solid rgba(201,150,46,.55);"
        + "background:rgba(9,8,11,.82);color:#fff7ec;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;";
      doc.body.appendChild(chip);
      return { chip, cpu: new Float32Array(STATS_FRAMES), gap: new Float32Array(STATS_FRAMES), n: 0, at: 0, timer: 0 };
    })() : null;
    function percentiles(buffer, count) {
      const list = Array.from(buffer.subarray(0, Math.min(count, STATS_FRAMES))).sort((a, b) => a - b);
      if (!list.length) return [0, 0];
      const at = (p) => list[Math.min(list.length - 1, Math.floor(list.length * p))];
      return [at(0.5), at(0.9)];
    }
    function readStats() {
      const cpu = statsChip ? percentiles(statsChip.cpu, statsChip.n) : [0, 0];
      const gap = statsChip ? percentiles(statsChip.gap, statsChip.n) : [0, 0];
      const fxStats = arena.fx && typeof arena.fx.stats === "function" ? guard(() => arena.fx.stats(), null) : null;
      return {
        tier: qualityNow.tier, dpr: renderer.getPixelRatio(), shadows: qualityNow.shadows,
        cpuP50: cpu[0], cpuP90: cpu[1], gapP50: gap[0], gapP90: gap[1], samples: statsChip ? Math.min(statsChip.n, STATS_FRAMES) : 0,
        drawCalls: stats.drawCalls, particles: fxStats ? fxStats.particles : 0, lost, hidden,
      };
    }
    function paintStats() {
      if (!statsChip || disposed) return;
      const s = readStats();
      const f = (v) => v.toFixed(1);
      const state = s.lost ? "  CONTEXT LOST" : s.hidden ? "  paused" : "";
      statsChip.chip.textContent = `${s.tier} · dpr ${s.dpr} · ${s.shadows ? "shadows" : "no shadows"}${state}\n`
        + `frame p50 ${f(s.cpuP50)} p90 ${f(s.cpuP90)} ms\n`
        + `gap   p50 ${f(s.gapP50)} p90 ${f(s.gapP90)} ms\n`
        + `calls ${s.drawCalls} · particles ${s.particles}`;
    }
    if (statsChip) statsChip.timer = setInterval(paintStats, D.statsEvery);

    function advanceTweens() {
      let animating = false;
      for (const entry of registry.values()) {
        const tw = entry.tween;
        if (!tw) continue;
        const k = EASE.snap(clamp((clock.time - tw.t0) * 1000 / tw.ms, 0, 1));
        entry.mesh.position.lerpVectors(tw.from.position, tw.to.position, k);
        entry.mesh.quaternion.slerpQuaternions(tw.from.quaternion, tw.to.quaternion, k);
        entry.mesh.scale.setScalar(lerp(tw.from.scale, tw.to.scale, k));
        if (k >= 1) entry.tween = null; else animating = true;
      }
      return animating;
    }

    function followShadows() {
      for (const entry of registry.values()) {
        if (entry.gone || !entry.shadow) continue;
        const p = entry.mesh.position;
        entry.shadow.position.set(p.x, 0.004, p.z + (entry.kind === "token" ? 0.1 : 0));
        entry.shadow.scale.setScalar(entry.mesh.scale.x * (1 + Math.min(1.2, p.y) * 0.25));
        entry.shadow.visible = entry.mesh.visible;
        if (entry.ring && entry.ring.visible) entry.ring.position.set(p.x, 0.008, p.z + (entry.kind === "token" ? 0.12 : 0));
      }
    }

    function pulseRings() {
      let any = false;
      for (const entry of registry.values()) if (!entry.gone && entry.state.targetable && !entry.state.selected) { any = true; break; }
      if (any) materials.ringTarget.opacity = 0.55 + 0.4 * Math.sin(clock.time * 5.2);
      return any;
    }

    function reapGone() {
      for (const entry of Array.from(registry.values())) {
        if (entry.gone && clock.time - entry.goneAt > D.grace / 1000) destroyEntry(entry);
      }
    }

    function tick(now) {
      rafId = 0;
      if (disposed || lost) return;
      const t = typeof now === "number" ? now : (root.performance ? root.performance.now() : Date.now());
      clock.advance(t);
      const t0 = root.performance ? root.performance.now() : Date.now();
      let animating = advanceTweens();
      animating = pulseRings() || animating;
      animating = cam.modifiers.length > 0 || animating;
      animating = Math.abs(parallax.x - parallax.tx) > 1e-3 || Math.abs(parallax.y - parallax.ty) > 1e-3 || animating;
      animating = clock.frozenUntil > t || animating;
      if (sample.active && t < sample.until) animating = true;
      const fxAnimating = Boolean(arena.fx && typeof arena.fx.animating === "function" && arena.fx.animating());
      animating = fxAnimating || animating;
      const envAnimating = Boolean(arena.env && typeof arena.env.animating === "function" && arena.env.animating());
      // The environment alone runs at ~30 fps: every other rAF is skipped when nothing else moves.
      if (envAnimating && !animating && !dirty) {
        envSkip = !envSkip;
        if (envSkip) { reapGone(); requestFrame(); return; }
      }
      animating = envAnimating || animating;
      if (dirty || animating) {
        dirty = false;
        applyCamera();
        followShadows();
        if (arena.env && typeof arena.env.tick === "function") guard(() => arena.env.tick(clock.delta, clock.time));
        if (arena.fx && typeof arena.fx.tick === "function") guard(() => arena.fx.tick(clock.delta, clock.time));
        renderer.render(scene, camera);
        projectAll();
        const ms = (root.performance ? root.performance.now() : Date.now()) - t0;
        const gap = lastRenderAt && t > lastRenderAt ? Math.min(t - lastRenderAt, 250) : ms;
        lastRenderAt = t;
        stats.lastFrameMs = ms;
        stats.frameMs = stats.frames ? stats.frameMs * 0.8 + ms * 0.2 : ms;
        stats.frames += 1;
        stats.drawCalls = renderer.info.render.calls;
        if (statsChip) {
          statsChip.cpu[statsChip.at] = ms;
          statsChip.gap[statsChip.at] = gap;
          statsChip.at = (statsChip.at + 1) % STATS_FRAMES;
          statsChip.n += 1;
        }
        if (sample.active) {
          sample.frameMs.push(ms);
          sample.gapMs.push(gap);
          if (t >= sample.until) settleQuality();
        }
      }
      reapGone();
      if (animating || dirty) requestFrame();
    }

    const eachMaterial = (fn) => scene.traverse((obj) => {
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(fn);
    });
    /* A tier change at runtime, no remount: pixel ratio, shadow map, the env's
       embers and fog, and the fx particle cap (arena3d-fx.js reads world.quality). */
    function applyQuality(q) {
      const shadowsChanged = !qualityNow || qualityNow.shadows !== q.shadows || renderer.shadowMap.enabled !== q.shadows;
      qualityNow = q;
      if (renderer.getPixelRatio() !== q.dpr) renderer.setPixelRatio(q.dpr);
      renderer.shadowMap.enabled = q.shadows;
      key.castShadow = q.shadows;
      // Materials compiled with shadows need a recompile when the map toggles.
      if (shadowsChanged) eachMaterial((m) => { m.needsUpdate = true; });
      world.quality = q;
      if (arena.env && typeof arena.env.quality === "function") guard(() => arena.env.quality(q.tier));
      for (const entry of registry.values()) entry.lastRect = null;
      markDirty();
    }
    function settleQuality() {
      sample.active = false;
      // The first frames compile shaders; a sample too short to see past them says nothing.
      const phone = phoneLike();
      const frames = sample.frameMs.map((ms, i) => (phone ? Math.max(ms, sample.gapMs[i] || 0) : ms)).slice(3);
      sample.frameMs = [];
      sample.gapMs = [];
      if (frames.length < 8) return;
      const q = L.quality(device({ frameMs: frames }));
      if (q.tier !== qualityNow.tier || q.dpr !== qualityNow.dpr) applyQuality(q);
    }

    function resize() {
      if (disposed) return;
      const vp = viewport();
      // The window moved to a screen of another density: same tier, new cap.
      const again = L.quality(device({ tier: qualityNow.tier }));
      if (again.dpr !== renderer.getPixelRatio()) applyQuality(again);
      renderer.setSize(vp.width, vp.height, false);
      const nextMode = frameCamera();
      if (nextMode !== mode) {
        mode = nextMode;
        for (const entry of registry.values()) if (!entry.gone) place(entry, false);
      }
      world.viewport = vp;
      for (const entry of registry.values()) entry.lastRect = null;
      markDirty();
    }
    let observer = null;
    if (root.ResizeObserver) {
      observer = new root.ResizeObserver(() => resize());
      observer.observe(host);
    } else root.addEventListener("resize", resize);

    function cancelFrame() {
      if (rafId && root.cancelAnimationFrame) root.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    /* A LOST CONTEXT IS USUALLY A PAUSE, NOT A DEATH. A phone drops the GPU
       context when the tab goes to the background under memory pressure and
       hands it back on return. preventDefault() is what allows the restore; the
       arena then waits D.restore for it. Restored: three.js has re-created its
       GL state, so every texture and material is flagged for upload and compile
       again and the table repaints. Not restored in time, or the rebuild
       throws: onLost, and play.js falls back to the classic table. */
    let lostTimer = 0;
    function giveUp() {
      if (lostTimer) { clearTimeout(lostTimer); lostTimer = 0; }
      if (disposed) return;
      lost = true;
      cancelFrame();
      if (typeof o.onLost === "function") guard(() => o.onLost());
    }
    function onContextLost(event) {
      if (event && event.preventDefault) event.preventDefault();
      lost = true;
      cancelFrame();
      if (lostTimer) clearTimeout(lostTimer);
      lostTimer = setTimeout(giveUp, D.restore);
      paintStats();
    }
    function rebuildAfterRestore() {
      const gl = renderer.getContext();
      if (!gl || (typeof gl.isContextLost === "function" && gl.isContextLost())) throw new Error("arena3d: context still lost");
      const flag = (texture) => { if (texture && texture.isTexture) texture.needsUpdate = true; };
      eachMaterial((m) => {
        m.needsUpdate = true;
        for (const slot of ["map", "alphaMap", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) flag(m[slot]);
      });
      textures.forEach(flag);
      renderer.shadowMap.needsUpdate = true;
      renderer.setPixelRatio(qualityNow.dpr);
      const vp = viewport();
      renderer.setSize(vp.width, vp.height, false);
      for (const entry of registry.values()) entry.lastRect = null;
    }
    function onContextRestored() {
      if (disposed || !lost) return;
      if (lostTimer) { clearTimeout(lostTimer); lostTimer = 0; }
      let ok = false;
      try {
        rebuildAfterRestore();
        ok = true;
      } catch (error) {
        ok = false;
      }
      if (!ok) return void giveUp();
      lost = false;
      lastRenderAt = 0;
      stats.restores = (stats.restores || 0) + 1;
      markDirty();
    }
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    /* A hidden tab draws nothing: the loop stops and markDirty() only notes it.
       Back in view, the clock skips the gap, a running quality sample starts
       over (its frames measured a throttled tab), and one frame repaints. */
    function onVisibility() {
      const nowHidden = doc.visibilityState === "hidden";
      if (nowHidden === hidden) return;
      hidden = nowHidden;
      if (hidden) { cancelFrame(); paintStats(); return; }
      clock._last = null;
      lastRenderAt = 0;
      if (sample.active) {
        sample.frameMs = [];
        sample.gapMs = [];
        sample.until = (root.performance ? root.performance.now() : Date.now()) + D.sample;
      }
      markDirty();
    }
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVisibility);

    /* ==================================================================== *
     * 10 · THE ARENA                                                        *
     * ==================================================================== */

    const world = {
      scene, renderer, THREE, clock, camera, group: groups, materials, layout: L,
      quality: qualityNow, stats, viewport: viewport(), textures,
      dirty: markDirty, requestFrame, cardById, faceUrl, artCrop, cardGeo, tokenGeos, backMat,
      // For arena3d-env.js: the panel and glow it breathes, the light it flickers, the traces and the parallax it follows.
      plate, glow: glowDisc, lights: { key, rim, glow: glowLight }, parallax, traces: playfield.userData.traces || [],
    };

    const arena = {
      VERSION,
      registry, world, camera: cam, fx: null, env: null,
      /* Diff the scene against the view; bind hitboxes; idempotent. */
      sync(view, seat, extra) {
        if (disposed || lost) return;
        const t0 = root.performance ? root.performance.now() : Date.now();
        const x = extra || {};
        const result = L.planSync(plan, view, seat, { foeHandCount: x.foeHandCount, cards: cardsList });
        plan = result.next;
        for (const uid of result.leave) { const entry = registry.get(uid); if (entry) removeEntry(entry); }
        for (const p of result.enter) {
          const stale = registry.get(p.uid);
          if (stale) destroyEntry(stale);
          addEntry(p);
        }
        for (const p of result.move.concat(result.stay)) {
          const entry = registry.get(p.uid);
          if (!entry) continue;
          const changed = entry.committed !== Boolean(p.committed) || entry.facedown !== Boolean(p.facedown);
          entry.index = p.index; entry.count = p.count; entry.zone = p.zone;
          entry.committed = Boolean(p.committed);
          entry.facedown = Boolean(p.facedown);
          if (result.move.indexOf(p) >= 0 || changed) place(entry, true);
        }
        // Bind hitboxes and read the marks off the DOM: one source of truth.
        const nodes = x.nodes && typeof x.nodes.get === "function" ? x.nodes : null;
        const queueNodes = Array.isArray(x.queue) ? x.queue : null;
        let qi = 0;
        for (const p of result.placements) {
          const entry = registry.get(p.uid);
          if (!entry) continue;
          let node = nodes ? nodes.get(p.uid) : null;
          if (!node && p.kind === "queue" && queueNodes) {
            const item = queueNodes[qi++];
            node = item && item.nodeType ? item : item && item.node ? item.node : null;
          }
          entry.node = node && node.style ? node : null;
          entry.lastRect = null;
          if (typeof x.marks === "function") {
            const got = x.marks(p.uid);
            const list = Array.isArray(got) ? got : String(got || "").split(/\s+/);
            const states = {};
            for (const raw of list) {
              const name = MARK_ALIAS[raw] || raw;
              if (STATE_KEYS.indexOf(name) >= 0) states[name] = true;
            }
            entry.state = states;
            applyState(entry);
          }
        }
        if (hovered && (hovered.gone || !registry.has(hovered.uid))) hovered = null;
        else if (hovered && hovered.zone === "youHand") { moveTo(hovered, hoverPose(hovered), D.hover); spreadFan(hovered, true); }
        stats.syncMs = (root.performance ? root.performance.now() : Date.now()) - t0;
        markDirty();
        // The first sync renders synchronously so the hitboxes exist before play.js measures them.
        if (!stats.frames) tick(root.performance ? root.performance.now() : Date.now());
        else { applyCamera(); projectAll(); }
      },
      tick,
      rectOf(uid) {
        const entry = registry.get(uid);
        if (!entry || entry.gone) return null;
        if (!entry.rect) { applyCamera(); entry.rect = projectEntry(entry, viewport()); }
        const r = entry.rect;
        if (!r) return null;
        return root.DOMRect ? new root.DOMRect(r.left, r.top, r.width, r.height)
          : { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
      },
      hover(uid) {
        if (disposed) return;
        // The compatibility mouseenter/focus of a tap: a finger is down or just lifted.
        if (uid != null && (touch.down || nowMs() < touch.quietUntil)) return;
        const next = uid == null ? null : registry.get(uid) || null;
        if (next && next.gone) return;
        if (hovered === next) return;
        if (hovered && !hovered.gone) { moveTo(hovered, hovered.home, D.hover); spreadFan(hovered, false); }
        hovered = next;
        if (hovered) { moveTo(hovered, hoverPose(hovered), D.hover); spreadFan(hovered, true); }
      },
      setState(uid, states) {
        if (disposed) return;
        const entry = registry.get(uid);
        if (!entry || entry.gone) return;
        const s = states || {};
        for (const k of STATE_KEYS) if (k in s) entry.state[k] = Boolean(s[k]);
        applyState(entry);
      },
      setPlate(affinity) {
        if (disposed) return;
        if (arena.env && typeof arena.env.setAffinity === "function") guard(() => arena.env.setAffinity(affinity));
        const url = o.plates && affinity ? o.plates[affinity] || o.plates[String(affinity).toLowerCase()] : null;
        if (!url) { plateMat.opacity = 0; markDirty(); return; }
        textures.get(url).then((t) => {
          if (disposed) return;
          plateMat.map = t; plateMat.opacity = 0.26; plateMat.needsUpdate = true; markDirty();
        }).catch(() => {});
      },
      resize,
      quality(tier) {
        if (disposed) return qualityNow;
        if (!tier) return qualityNow;
        sample.active = false;
        const forced = L.quality(device({ tier: String(tier) }));
        applyQuality(forced);
        return forced;
      },
      /* The numbers the ?arenastats=1 chip shows, for the console and the proof. */
      stats: readStats,
      snapshot() {
        if (disposed || lost) return "";
        return guard(() => { applyCamera(); renderer.render(scene, camera); return canvas.toDataURL("image/png"); }, "");
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        cancelFrame();
        if (lostTimer) { clearTimeout(lostTimer); lostTimer = 0; }
        if (statsChip) {
          clearInterval(statsChip.timer);
          if (statsChip.chip.parentNode) statsChip.chip.parentNode.removeChild(statsChip.chip);
        }
        if (observer) observer.disconnect(); else root.removeEventListener("resize", resize);
        host.removeEventListener("pointermove", onPointerMove);
        host.removeEventListener("pointerleave", onPointerLeave);
        host.removeEventListener("pointerdown", onPointerDown, true);
        host.removeEventListener("pointerup", onPointerUp, true);
        host.removeEventListener("pointercancel", onPointerUp, true);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        if (doc && doc.removeEventListener) doc.removeEventListener("visibilitychange", onVisibility);
        if (arena.fx && typeof arena.fx.dispose === "function") guard(() => arena.fx.dispose());
        if (arena.env && typeof arena.env.dispose === "function") guard(() => arena.env.dispose());
        for (const entry of Array.from(registry.values())) destroyEntry(entry);
        for (const geo of artGeoCache.values()) geo.dispose();
        cardGeo.dispose(); cardGlowGeo.dispose(); ringGeo.dispose();
        Object.values(tokenGeos).forEach((g) => g.dispose());
        Object.values(materials).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        [ironMat, topMat, backMat, blankMat, brassMat, insetMat, shadowMat, plateMat].forEach((m) => m.dispose());
        playfield.dispose(); shadowTex.dispose();
        slab.geometry.dispose(); edge.geometry.dispose(); edge.material.dispose(); glowDisc.geometry.dispose(); glowDisc.material.map.dispose(); glowDisc.material.dispose(); plate.geometry.dispose();
        textures.dispose();
        renderer.dispose();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      },
    };

    /* The fx layer: R2's module when it is loaded, else a shim with the same names. */
    const shim = { cue() {}, hitStop() {}, dispose() {} };
    arena.fx = root.E1Arena3DFx && typeof root.E1Arena3DFx.attach === "function"
      ? guard(() => root.E1Arena3DFx.attach(arena), null) || shim
      : shim;
    /* The environment: the room around the table, or a shim that stands still. */
    const envShim = { tick() {}, animating: () => false, setAffinity() {}, quality() {}, dispose() {} };
    arena.env = root.E1Arena3DEnv && typeof root.E1Arena3DEnv.attach === "function"
      ? guard(() => root.E1Arena3DEnv.attach(arena, { backdrop: o.backdrop, affinity: o.affinity, reduced }), null) || envShim
      : envShim;

    mode = "landscape";
    applyQuality(qualityNow); // the starting tier's pixel ratio and shadow map, before the first frame
    resize();
    if (sample.active) {
      sample.until = (root.performance ? root.performance.now() : Date.now()) + D.sample;
      requestFrame();
    }
    if (o.affinity) arena.setPlate(o.affinity);
    if (typeof o.onReady === "function") guard(() => o.onReady(arena));
    return arena;
  }

  root.E1Arena3D = { supported, create, VERSION };
})(typeof globalThis !== "undefined" ? globalThis : this);
