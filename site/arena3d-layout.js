/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — arena3d-layout: the table's geometry, in world units.
 *
 * Pure math, no THREE, no DOM: the same file runs under node:test and in the
 * browser as `globalThis.E1ArenaLayout`. arena3d.js asks here for every world
 * position; play.js never needs to. World frame: centre of the slab's top face
 * is (0,0,0), +x right, +y up, +z toward the camera (the own seat's side).
 *
 * The one law: cards sit on arcs, never on a rank. Every zone owns a circle of
 * fixed radius R ≤ 40 and its slots are points ON that circle, so for any n the
 * chord²/(8·sagitta) of the row equals R − s/2 — a straight line is impossible
 * by construction, not by parameter discipline.
 * ------------------------------------------------------------------------ */
(function (root) {
  "use strict";

  const BOARD = Object.freeze({ width: 16, depth: 10, thickness: 0.4 });
  const CARD = Object.freeze({ width: 1.0, height: 1.397, radius: 0.06 });
  const TOKEN = Object.freeze({ width: 1.42, height: 1.62, lift: 0.05 });
  const RAD = Math.PI / 180;

  /* ---- zones ------------------------------------------------------------
   * centre  : world position of the row's middle slot
   * axis    : which coordinate the bow lives on ("z" for rings on the slab,
   *           "y" for held fans)
   * bow     : +1 the middle slot is pushed toward +axis, −1 toward −axis
   * radius  : the circle every slot lies on (≤ 40, the arc law)
   * step    : centre-to-centre distance while the row still fits
   * maxChord: the row compresses past this width
   * depthBow: fans only — how much nearer the camera (+z) the middle slot sits
   *           than the widest fan's edges, so the high card is also the near one
   * pitch   : Euler X of the card plane; 0 upright facing +z, −90° flat face up
   * yawSpread: how far the outer slots turn to follow the arc (fraction of the
   *           arc angle); fanRoll: fans roll about their own normal instead
   * kind    : what the arena builds by default for this zone
   * portrait: what a tall viewport changes for this zone ({ chordScale, scale,
   *           fanRoll }); zones without it only narrow by the default 0.72
   */
  const zone = (id, seat, def) => Object.freeze(Object.assign({ id, seat }, def));
  const ZONES = Object.freeze({
    youHand: zone("youHand", "you", {
      centre: [0, 0.46, 5.7], axis: "y", bow: 1, radius: 8.5, step: 1.42, maxChord: 10.6, depthBow: 0.35,
      pitch: -42 * RAD, fanRoll: -1, yawSpread: 0, scale: 1.5, kind: "card",
      /* A phone (docs/arena3d.md, "Portrait"): the camera is width-bound, so the
         hand is the one row that grows. Measured at 375x812 and 390x844 (board
         355 and 370 px wide): 1..10 cards, every card >= 64 px wide and >= 8 px
         inside the board. The roll mostly goes, because a rolled card's bounding
         box is what ran off the edges; the chord still keeps any card from
         hiding more than half of its neighbour. */
      portrait: Object.freeze({ chordScale: 0.74, scale: 2.1, fanRoll: -0.3 }),
    }),
    foeHand: zone("foeHand", "foe", {
      centre: [0, 0.5, -4.95], axis: "y", bow: -1, radius: 6.5, step: 0.62, maxChord: 5.8,
      pitch: -34 * RAD, fanRoll: 1, yawSpread: 0, scale: 0.55, kind: "back",
    }),
    youNetwork: zone("youNetwork", "you", {
      centre: [0, TOKEN.lift, 1.95], axis: "z", bow: 1, radius: 11, step: 1.78, maxChord: 12.6,
      pitch: -30 * RAD, fanRoll: 0, yawSpread: 0.6, scale: 1.0, kind: "token",
    }),
    youResources: zone("youResources", "you", {
      centre: [0, 0.012, 3.5], axis: "z", bow: 1, radius: 11, step: 0.8, maxChord: 12.6,
      pitch: -90 * RAD, fanRoll: 0, yawSpread: 0.5, scale: 0.62, kind: "card",
    }),
    foeNetwork: zone("foeNetwork", "foe", {
      centre: [0, TOKEN.lift, -1.95], axis: "z", bow: -1, radius: 11, step: 1.78, maxChord: 12.6,
      pitch: -30 * RAD, fanRoll: 0, yawSpread: -0.6, scale: 1.0, kind: "token",
    }),
    foeResources: zone("foeResources", "foe", {
      centre: [0, 0.012, -3.5], axis: "z", bow: -1, radius: 11, step: 0.8, maxChord: 12.6,
      pitch: -90 * RAD, fanRoll: 0, yawSpread: -0.5, scale: 0.62, yaw: Math.PI, kind: "card",
    }),
    queue: zone("queue", null, {
      centre: [0, 0.86, 0.1], axis: "z", bow: 1, radius: 11, step: 1.6, maxChord: 6.4,
      pitch: -32 * RAD, fanRoll: 0, yawSpread: 0, scale: 1.4, kind: "queue",
    }),
    /* Stacks are single slots; the arc law has nothing to say about one card. */
    youDeck: zone("youDeck", "you", { centre: [6.7, 0.012, 3.2], pitch: -90 * RAD, scale: 0.8, stack: true }),
    foeDeck: zone("foeDeck", "foe", { centre: [-6.7, 0.012, -3.2], pitch: -90 * RAD, scale: 0.8, yaw: Math.PI, stack: true }),
    youArchive: zone("youArchive", "you", { centre: [-6.7, 0.012, 3.2], pitch: -90 * RAD, scale: 0.8, stack: true }),
    foeArchive: zone("foeArchive", "foe", { centre: [6.7, 0.012, -3.2], pitch: -90 * RAD, scale: 0.8, yaw: Math.PI, stack: true }),
  });

  const zoneOf = (z) => (typeof z === "string" ? ZONES[z] : z) || null;

  /* ---- arcSlots ---------------------------------------------------------
   * n slots of `zone`, world space. mode: "landscape" (default) | "portrait"
   * (a narrower row for a tall viewport, plus the zone's own `portrait`
   * overrides) | { chordScale }. Slot i carries
   * x,y,z, yaw/pitch/roll (radians, applied as Euler XYZ order Y·X·Z in the
   * arena), scale, and t ∈ [−1,1] across the row.
   */
  function arcSlots(n, zoneRef, mode) {
    const Z = zoneOf(zoneRef);
    const count = Math.max(0, Math.floor(Number(n) || 0));
    if (!Z || !count) return [];
    const P = mode === "portrait" && Z.portrait ? Z.portrait : {};
    const chordScale = mode && typeof mode === "object" ? Number(mode.chordScale) || 1 : mode === "portrait" ? P.chordScale || 0.72 : 1;
    const scale = P.scale || Z.scale;
    const fanRoll = P.fanRoll !== undefined ? P.fanRoll : Z.fanRoll || 0;
    const [cx, cy, cz] = Z.centre;
    if (Z.stack || count === 1) {
      return [{
        x: cx, y: cy, z: cz, yaw: Z.yaw || 0, pitch: Z.pitch, roll: 0, scale, t: 0, index: 0, angle: 0,
      }];
    }
    const R = Z.radius;
    const maxChord = Z.maxChord * chordScale;
    const step = Math.min(Z.step * chordScale, maxChord / (count - 1));
    const half = (step * (count - 1)) / 2;
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? (i / (count - 1)) * 2 - 1 : 0;
      const x = t * half;
      const inside = Math.max(0, R * R - x * x);
      const sag = R - Math.sqrt(inside); // the drop from the tangent at the middle slot
      const angle = Math.asin(Math.max(-1, Math.min(1, x / R)));
      let y = cy;
      let z = cz;
      if (Z.axis === "y") {
        y = cy + Z.bow * -sag; // fan: the middle card is the high one when bow=+1
        // depthBow: the same sagitta, scaled so the widest fan's edges sit on the
        // centre and the middle slot comes `depthBow` nearer the camera. The y-bow
        // alone pushed the middle cards away from the camera, which made the
        // biggest cards of the fan read as the smallest.
        if (Z.depthBow) {
          const halfMax = maxChord / 2;
          const sagMax = R - Math.sqrt(Math.max(0, R * R - halfMax * halfMax));
          z = cz + Z.depthBow * (1 - (sagMax > 0 ? sag / sagMax : 0));
        }
      } else z = cz + Z.bow * sag;
      out.push({
        x, y, z,
        yaw: (Z.yaw || 0) + angle * Z.yawSpread,
        pitch: Z.pitch,
        roll: angle * fanRoll,
        scale,
        t, index: i, angle,
      });
    }
    return out;
  }

  /* ---- planSync ---------------------------------------------------------
   * Walk the engine view the way play.js's render() does and diff it against
   * the previous plan. Returns { enter, move, leave, stay, next, placements }.
   *   prev : the `next` of the previous call (Map uid → placement) or null
   *   view : E.view(state, seat) — a redacted view
   *   seat : 0|1, the seat the table speaks to
   *   opts : { foeHandCount, isAvatar(cardId), cards }
   * kinds: card (own hand, flat Hardware/Resources), token (an Avatar on a
   * Network), back (a face-down shell in the foe hand), queue (resolving).
   * Uids: the engine's for objects, `foe-hand-N` for shells (the DOM's shells
   * carry no uid), `queue:<qid>` for Queue items.
   */
  let avatarCache = null;
  function defaultIsAvatar(cardId, cards) {
    const list = cards || root.E1_CARDS;
    if (!Array.isArray(list)) return false;
    if (!avatarCache || avatarCache.list !== list) {
      const byId = new Map();
      for (const card of list) byId.set(card.id, String(card.type || "").indexOf("Avatar") >= 0);
      avatarCache = { list, byId };
    }
    return Boolean(avatarCache.byId.get(cardId));
  }

  function planSync(prev, view, seat, opts) {
    const o = opts || {};
    const own = seat === 1 ? 1 : 0;
    const foe = 1 - own;
    const zones = (view && view.zones) || {};
    const objects = (view && view.objects) || {};
    const isAvatar = typeof o.isAvatar === "function" ? o.isAvatar : (id) => defaultIsAvatar(id, o.cards);
    const placements = [];
    const push = (uid, zoneId, list, kind, extra) => {
      placements.push(Object.assign({ uid, zone: zoneId, index: list.length, count: 0, kind }, extra || {}));
      list.push(uid);
    };
    const rows = {};
    const row = (id) => rows[id] || (rows[id] = []);

    // Own hand: uids, or a bare count for a spectator.
    const wallet = zones[`${own}:wallet`];
    if (Array.isArray(wallet)) {
      for (const uid of wallet) {
        const obj = objects[uid];
        if (obj && obj.cardId) push(uid, "youHand", row("youHand"), "card", { cardId: obj.cardId, owner: own });
        else push(uid, "youHand", row("youHand"), "back", { owner: own });
      }
    } else if (wallet && wallet.n) {
      for (let i = 0; i < wallet.n; i++) push(`you-hand-${i}`, "youHand", row("youHand"), "back", { owner: own });
    }

    // Foe hand: shells. The count may be forced by the caller (the DOM's shells).
    const foeWallet = zones[`${foe}:wallet`];
    let foeCount = Number.isFinite(o.foeHandCount) ? o.foeHandCount
      : Array.isArray(foeWallet) ? foeWallet.length : foeWallet && foeWallet.n ? foeWallet.n : 0;
    for (let i = 0; i < foeCount; i++) push(`foe-hand-${i}`, "foeHand", row("foeHand"), "back", { owner: foe });

    // Networks: the Avatar rail is tokens, the back rail lies flat.
    for (const [side, who] of [["you", own], ["foe", foe]]) {
      const list = zones[`${who}:network`];
      if (!Array.isArray(list)) continue;
      for (const uid of list) {
        const obj = objects[uid] || {};
        const avatar = Boolean(obj.token || obj.facedown || (obj.cardId && isAvatar(obj.cardId)));
        const zoneId = avatar ? `${side}Network` : `${side}Resources`;
        push(uid, zoneId, row(zoneId), avatar ? "token" : "card", {
          cardId: obj.cardId || null, owner: who,
          committed: Boolean(obj.committed), facedown: Boolean(obj.facedown),
          damage: obj.damage || 0, token: Boolean(obj.token),
        });
      }
    }

    // The Queue: the resolving card stands at the centre.
    const queue = (view && Array.isArray(view.queue)) ? view.queue : [];
    queue.forEach((item, i) => {
      if (!item || !item.cardId) return;
      const uid = `queue:${item.qid != null ? item.qid : i}`;
      push(uid, "queue", row("queue"), "queue", { cardId: item.cardId, owner: item.controller, qid: item.qid });
    });

    for (const p of placements) p.count = rows[p.zone].length;

    const next = new Map();
    const enter = [], move = [], stay = [], leave = [];
    const before = prev instanceof Map ? prev : prev && typeof prev === "object" ? new Map(Object.entries(prev)) : new Map();
    for (const p of placements) {
      next.set(p.uid, p);
      const was = before.get(p.uid);
      if (!was) enter.push(p);
      else if (was.zone !== p.zone || was.index !== p.index || was.count !== p.count || was.kind !== p.kind) move.push(p);
      else stay.push(p);
    }
    for (const uid of before.keys()) if (!next.has(uid)) leave.push(uid);
    return { enter, move, leave, stay, next, placements };
  }

  /* ---- quality ----------------------------------------------------------
   * sample = { frameMs: number[], dpr, isMobile, coarse, width, reduced, tier }.
   *
   * Where a table STARTS: a desktop at high; a phone (isMobile, or a coarse
   * primary pointer) at mid; a small, dense screen (dpr ≥ 2.5 and a short
   * side ≤ 480 CSS px — `width`) at low, because it pays 6–9 device pixels
   * per CSS pixel before a single shadow. After the sample the tier is the
   * 75th percentile frame (≤ 9 ms high, ≤ 17 ms mid, else low), and a sample
   * only ever LOWERS the start: a frame measured at a cheap tier says nothing
   * about the dear one. `tier` forces one (arena.quality("low")).
   *
   *   high  DPR ≤ 2    shadows  particles 360  embers 240  fog
   *   mid   DPR ≤ 1.5  shadows  particles 180  embers 120  fog
   *   low   DPR 1      —        particles 48   embers 40   —
   *
   * Reduced motion lowers the particle cap — the cut-to-end-state is the fx
   * layer's rule. arena3d-env.js owns the ember and fog counts; the numbers
   * here are the same ones, pinned against it by tests/js/arena3d-env.test.mjs.
   */
  const TIERS = ["low", "mid", "high"];
  const CAPS = {
    high: { dpr: 2, particleCap: 360, embers: 240, fog: true },
    mid: { dpr: 1.5, particleCap: 180, embers: 120, fog: true },
    low: { dpr: 1, particleCap: 48, embers: 40, fog: false },
  };
  function startTier(s) {
    const dpr = Number(s.dpr) || 1;
    const width = Number(s.width) || 0;
    if (dpr >= 2.5 && width > 0 && width <= 480) return "low";
    return s.isMobile || s.coarse ? "mid" : "high";
  }
  function quality(sample) {
    const s = sample || {};
    const frames = (Array.isArray(s.frameMs) ? s.frameMs : []).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
    let tier = startTier(s);
    if (CAPS[s.tier]) tier = s.tier;
    else if (frames.length) {
      const p75 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.75))];
      const measured = p75 <= 9 ? "high" : p75 <= 17 ? "mid" : "low";
      if (TIERS.indexOf(measured) < TIERS.indexOf(tier)) tier = measured;
    }
    const cap = CAPS[tier];
    const dpr = Math.max(1, Math.min(Number(s.dpr) || 1, cap.dpr));
    return {
      tier, dpr, shadows: tier !== "low",
      particleCap: s.reduced ? Math.min(cap.particleCap, 24) : cap.particleCap,
      embers: cap.embers, fog: cap.fog,
    };
  }

  /* ---- projectRect ------------------------------------------------------
   * Corners in NDC ([x,y] or {x,y}, any count ≥ 1) → the bounding rectangle in
   * viewport pixels ({ width, height }, optional left/top offset).
   */
  function projectRect(cornersNdc, viewport) {
    const vp = viewport || {};
    const w = Number(vp.width) || 0;
    const h = Number(vp.height) || 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cornersNdc || []) {
      const nx = Array.isArray(c) ? c[0] : c.x;
      const ny = Array.isArray(c) ? c[1] : c.y;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      const px = ((nx + 1) / 2) * w;
      const py = ((1 - ny) / 2) * h;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    if (!Number.isFinite(x0)) return { left: 0, top: 0, width: 0, height: 0 };
    const r = (v) => Math.round(v * 100) / 100;
    return {
      left: r(x0 + (Number(vp.left) || 0)), top: r(y0 + (Number(vp.top) || 0)),
      width: r(x1 - x0), height: r(y1 - y0),
    };
  }

  /* ---- cameraFor --------------------------------------------------------
   * The camera that frames the table for a viewport aspect: fov 42, tilt ~36°
   * (~48° in portrait, where the fan also narrows), target (0,0,0.8). The
   * distance is solved so the box the ROWS live in fits NDC ±0.98. The box
   * deliberately leaves the deck and archive stacks and the slab margins out:
   * framing the whole slab made every card small (FLX, 2026-09-14), and a table
   * is read by its cards, not by its edges.
   */
  const FRAME = { x: 6.6, y0: -0.4, y1: 1.5, z0: -4.5, z1: 6.1 };
  function cameraFor(aspect, opts) {
    const a = Number(aspect) > 0 ? Number(aspect) : 16 / 9;
    const portrait = a < 0.9;
    const fov = 42;
    const tilt = (portrait ? 48 : 36) * RAD;
    const target = [0, 0, 0.8];
    const dir = [0, Math.sin(tilt), Math.cos(tilt)];
    // A tall viewport is width-bound: it frames the rows (±6) and lets the slab's margins crop.
    const box = (opts && opts.frame) || (portrait ? Object.assign({}, FRAME, { x: 5.2 }) : FRAME);
    const corners = [];
    for (const x of [-box.x, box.x]) for (const y of [box.y0, box.y1]) for (const z of [box.z0, box.z1]) corners.push([x, y, z]);
    const fits = (d) => {
      const pos = [target[0] + dir[0] * d, target[1] + dir[1] * d, target[2] + dir[2] * d];
      const P = projector(pos, target, fov, a);
      return corners.every((c) => {
        const n = P(c);
        return n && Math.abs(n[0]) <= 0.98 && Math.abs(n[1]) <= 0.98;
      });
    };
    let lo = 4, hi = 80;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    const distance = hi;
    return {
      fov, aspect: a, portrait, tilt, distance, target,
      position: [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance],
      mode: portrait ? "portrait" : "landscape",
    };
  }

  /* A minimal look-at + perspective projector: world [x,y,z] → NDC [x,y] or
   * null behind the eye. Enough to solve the framing without THREE. */
  function projector(eye, target, fovDeg, aspect, near, far) {
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const f = norm(sub(target, eye));          // forward
    const r = norm(cross(f, [0, 1, 0]));       // right
    const u = cross(r, f);                     // up
    const t = 1 / Math.tan((fovDeg * RAD) / 2);
    const n = near || 0.1, fa = far || 200;
    return (p) => {
      const d = sub(p, eye);
      const zc = dot(d, f);                    // depth along the view direction
      if (zc <= 0) return null;
      const xc = dot(d, r), yc = dot(d, u);
      const ndcZ = ((fa + n) / (fa - n)) - (2 * fa * n) / ((fa - n) * zc);
      return [(xc * t) / aspect / zc, (yc * t) / zc, ndcZ];
    };
  }

  const api = { BOARD, CARD, TOKEN, ZONES, arcSlots, planSync, quality, projectRect, cameraFor, projector, zoneOf };
  root.E1ArenaLayout = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
