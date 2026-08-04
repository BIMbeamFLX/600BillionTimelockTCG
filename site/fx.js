/*!
 * 600B TIMELOCK TCG — FX LAYER v1.0.0 · "WARM TERMINAL"
 * MIT. Zero binary assets: every sound is synthesised at runtime with the Web Audio API.
 * No fetch, no CDN, no blob URL, no AudioWorklet, no npm, no build step.
 *
 * This module never reads, imports or modifies play.js / play.html.
 * Integration is one line in the host:
 *   const fx = (name, d = {}) => document.dispatchEvent(new CustomEvent('fx', { detail: { name, ...d } }));
 *
 * Exposed as globalThis.FX600, globalThis.E1FX and globalThis.FX (if unclaimed).
 */
(function (global) {
  'use strict';

  var doc = global.document;

  /* ==================================================================== *
   * 0 · TOKENS                                                           *
   * ==================================================================== */

  var VERSION = '1.0.0';

  /* Duration ladder — use only these. */
  var D = { xs: 70, sm: 120, md: 180, lg: 280, xl: 420, xxl: 900 };

  var EASE = {
    snap: 'cubic-bezier(0.2, 0, 0, 1)',   /* arrivals, gains  — fast out, hard stop */
    mech: 'cubic-bezier(0.85, 0, 0.15, 1)', /* symmetric, heavy both ends           */
    drop: 'cubic-bezier(0.4, 0, 1, 1)',   /* losses, failures — no landing          */
    line: 'linear',                        /* sweeps — machines don't ease          */
    step: 'steps(4, end)'                  /* quantized counters, pips              */
  };

  /* Shared stagger constants. Audio and motion read the SAME numbers. */
  var STAG = { draw: 55, generate: 42, clash: 46, burn: 80, uptime: 70, win: 95 };

  var PALETTE = {
    orange: '#f7931a', ember: '#ff6a00', gold: '#f3c244',
    purple: '#7447b8', violet: '#5e5acb', cream: '#fff7ec',
    black: '#09080b', muted: '#c7bbcc',
    danger: '#ff4d3d', good: '#6ee7a8'
  };

  /* Locked E1 "Plate" palette, remapped by RESOURCE (build_card_set.AFFINITY_ACCENT):
   * old-Bitcoin's hex is new-Power's, and Keys/Signal swapped hexes. */
  var AFF_COLOR = { P: '#f3c244', B: '#f7931a', K: '#fff7ec', S: '#7447b8', T: '#17bebb', N: '#c7bbcc' };
  var AFF_NAME = { P: 'Power', B: 'Bitcoin', K: 'Keys', S: 'Signal', T: 'Timelock', N: 'Neutral' };

  /* C# Dorian grid. A4 = 440, equal temperament. Every sustained pitch lives here. */
  var HZ = {
    Cs1: 34.65, Cs2: 69.30, Fs2: 92.50, Gs2: 103.83, As2: 116.54,
    Cs3: 138.59, Ds3: 155.56, E3: 164.81, Fs3: 184.99, Gs3: 207.65, As3: 233.08, B3: 246.94,
    Cs4: 277.18, Ds4: 311.13, E4: 329.63, Fs4: 369.99, Gs4: 415.30, As4: 466.16, B4: 493.88,
    Cs5: 554.37, Ds5: 622.25, E5: 659.26, Fs5: 739.99, Gs5: 830.61, As5: 932.33, Cs6: 1108.73,
    /* Off-grid utility pitches — percussive / sub only, never sustained. */
    B1: 61.74, D2: 73.42, E2: 82.41, A2: 110.00
  };

  /* Dorian step ratios: semitones 0,2,3,5,7,9,10,12 */
  var DORIAN_STEP = [1.00000, 1.12246, 1.18921, 1.33484, 1.49831, 1.68179, 1.78180, 2.00000];
  function dorian(i) { return DORIAN_STEP[i % 8] * Math.pow(2, Math.floor(i / 8)); }

  /* Seat 1 is transposed down a perfect fourth. C# Dorian -> G# Dorian: identical note set. */
  var SEAT_T = 0.749154;

  var EVENTS = Object.freeze([
    'game:start', 'turn:begin', 'phase:enter', 'priority:pass',
    'card:draw', 'card:play', 'card:archive',
    'resource:play', 'resource:generate', 'buffer:burn', 'buffer:set',
    'ability:activate', 'target:request', 'target:choose',
    'clash:begin', 'clash:declareAttackers', 'clash:declareBlockers',
    'damage:player', 'damage:avatar', 'avatar:decommission',
    'uptime:gain', 'manual:resolve', 'game:win'
  ]);

  var PHASE_PITCH = {
    unlock: HZ.Cs4, maintenance: HZ.Ds4, draw: HZ.E4, build1: HZ.Fs4,
    clash: HZ.Gs4, build2: HZ.As4, end: HZ.B4, cleanup: HZ.Cs5
  };
  var AUTO_PHASES = { unlock: 1, draw: 1, cleanup: 1 };

  /* ==================================================================== *
   * 1 · SMALL UTILITIES                                                  *
   * ==================================================================== */

  var DEBUG = false;
  function warn(msg, e) { if (DEBUG && global.console) global.console.warn('[fx600] ' + msg, e || ''); }
  function guard(fn) { try { return fn(); } catch (e) { warn('guarded', e); return undefined; } }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function cents(f, c) { return f * Math.pow(2, c / 1200); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Humanisation — applied independently to every voice. */
  function hPitch(f) { return cents(f, rnd(-4, 4)); }
  function hOnset() { return rnd(0, 0.012); }
  function hGain(g) { return g * rnd(0.94, 1.06); }

  var AFF_ALIAS = {
    P: 'P', B: 'B', K: 'K', S: 'S', T: 'T', N: 'N',
    Power: 'P', Bitcoin: 'B', Keys: 'K', Signal: 'S', Timelock: 'T', Neutral: 'N'
  };
  function affOf(a) {
    if (a == null) return 'N';
    if (Array.isArray(a)) return a.length ? affOf(a[0]) : 'N';
    var s = String(a).trim();
    if (AFF_ALIAS[s]) return AFF_ALIAS[s];
    s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return AFF_ALIAS[s] || 'N';
  }
  function affList(a) {
    if (Array.isArray(a)) return a.slice(0, 2).map(affOf);
    return [affOf(a)];
  }

  var TYPE_RE = /Avatar|Hardware|Protocol|Operation|Zap|Resource/;
  function typeOf(t) {
    if (t == null) return '';
    var m = TYPE_RE.exec(String(t));
    return m ? m[0] : '';
  }

  /* ==================================================================== *
   * 2 · PERSISTED SETTINGS                                               *
   * ==================================================================== */

  var STORE_KEY = '600b.fx.v1';
  var cfg = { muted: false, volume: 0.78, bed: false, pressure: true, motion: 'auto' };
  var saveTimer = 0;

  function loadCfg() {
    guard(function () {
      var raw = global.localStorage && global.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (typeof o.muted === 'boolean') cfg.muted = o.muted;
      if (typeof o.volume === 'number') cfg.volume = clamp(o.volume, 0, 1);
      if (typeof o.bed === 'boolean') cfg.bed = o.bed;
      if (typeof o.pressure === 'boolean') cfg.pressure = o.pressure;
      if (o.motion === 'auto' || o.motion === 'full' || o.motion === 'reduced') cfg.motion = o.motion;
    });
  }
  function saveCfg() {
    if (saveTimer) return;
    saveTimer = global.setTimeout(function () {
      saveTimer = 0;
      guard(function () { global.localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); });
    }, 300);
  }

  /* ==================================================================== *
   * 3 · AUDIO GRAPH                                                      *
   * ==================================================================== */

  var ctx = null, ready = false, armTried = 0;
  var masterGain, comp, duckGain, warmShelf, softClip;
  var bus = {}, convolver, verbGain, slapDelay, slapFb, slapLp, slapGain, sendJoin;
  var bedDuck;
  var NOISE = {}, WAVE = {}, CRUSH = {};
  var crushCache = new Map();
  var CRUSH_CAP = 48;
  var BUCKETS = [30, 60, 90, 130, 180, 220, 300, 420, 500, 700, 1000, 1400];
  var PRESET = { soft: [6, 2], std: [6, 3], deep: [5, 4], dead: [4, 7] };
  var BUS_GAIN = { ui: 0.50, game: 0.75, impact: 1.00, bed: 0.28 };
  var BUS_PRIO = { impact: 3, game: 2, ui: 1, bed: 0 };
  var hasPanner = false;

  var voices = [];
  var voiceId = 0;
  var VOICE_CAP = 24;

  function T0() { return ctx.currentTime + 0.012; }

  function buildImpulse() {
    var sr = ctx.sampleRate;
    var pre = Math.round(0.012 * sr);
    var N = Math.round(1.1 * sr);
    var buf = ctx.createBuffer(2, pre + N, sr);
    var a = 1 - Math.exp(-2 * Math.PI * 3500 / sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var y = 0, peak = 0, i;
      for (i = 0; i < pre; i++) d[i] = 0;
      for (i = 0; i < N; i++) {
        var s = (Math.random() * 2 - 1) * Math.pow(1 - i / N, 3.2);
        y = y + a * (s - y);
        d[pre + i] = y;
        var m = y < 0 ? -y : y;
        if (m > peak) peak = m;
      }
      if (peak > 0) { var k = 0.70 / peak; for (i = 0; i < d.length; i++) d[i] *= k; }
    }
    return buf;
  }

  function buildWhite(sec) {
    var b = ctx.createBuffer(1, Math.round(sec * ctx.sampleRate), ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function buildPink(sec) {
    var b = ctx.createBuffer(1, Math.round(sec * ctx.sampleRate), ctx.sampleRate);
    var d = b.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < d.length; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return b;
  }

  function buildMetal(sec) {
    var src = buildWhite(sec).getChannelData(0);
    var b = ctx.createBuffer(1, src.length, ctx.sampleRate);
    var d = b.getChannelData(0);
    var taps = [149, 211, 293, 367, 439, 521], fb = 0.6;
    var i, t, peak = 0;
    for (i = 0; i < d.length; i++) d[i] = src[i];
    for (t = 0; t < taps.length; t++) {
      var dl = taps[t];
      for (i = dl; i < d.length; i++) d[i] += fb * d[i - dl];
    }
    for (i = 0; i < d.length; i++) { var m = d[i] < 0 ? -d[i] : d[i]; if (m > peak) peak = m; }
    if (peak > 0) { var k = 0.9 / peak; for (i = 0; i < d.length; i++) d[i] *= k; }
    return b;
  }

  /* Bitcrusher — sample & hold + bit reduction, in place. */
  function crush(arr, bits, hold) {
    var steps = Math.pow(2, bits) - 1, held = 0;
    for (var i = 0; i < arr.length; i++) {
      if (i % hold === 0) held = Math.round((arr[i] + 1) / 2 * steps) / steps * 2 - 1;
      arr[i] = held;
    }
  }

  function bucketOf(ms) {
    for (var i = 0; i < BUCKETS.length; i++) if (ms <= BUCKETS[i]) return BUCKETS[i];
    return 1400;
  }

  /* Crushed noise variants are baked on demand and LRU-cached. */
  function noiseBuf(src, durSec, preset) {
    var base = NOISE[src] || NOISE.white;
    if (!preset || !PRESET[preset]) return base;
    var bucket = bucketOf(durSec * 1000);
    var key = src + '|' + bucket + '|' + preset;
    if (crushCache.has(key)) {
      var hit = crushCache.get(key);
      crushCache.delete(key); crushCache.set(key, hit);   /* LRU touch */
      return hit;
    }
    var len = Math.min(base.length, Math.max(256, Math.round(bucket / 1000 * 1.6 * ctx.sampleRate)));
    var off = Math.floor(Math.random() * Math.max(1, base.length - len));
    var out = ctx.createBuffer(1, len, ctx.sampleRate);
    var od = out.getChannelData(0), bd = base.getChannelData(0);
    for (var i = 0; i < len; i++) od[i] = bd[off + i];
    crush(od, PRESET[preset][0], PRESET[preset][1]);
    crushCache.set(key, out);
    if (crushCache.size > CRUSH_CAP) crushCache.delete(crushCache.keys().next().value);
    return out;
  }

  /* Live crush for sustained oscillators. */
  function buildCrushCurve(bits) {
    var steps = Math.pow(2, bits) - 1;
    var c = new Float32Array(4096);
    for (var i = 0; i < 4096; i++) {
      var x = (i / 4095) * 2 - 1;
      c[i] = Math.round((x + 1) / 2 * steps) / steps * 2 - 1;
    }
    return c;
  }

  function pulseWave(duty, harmonics) {
    var n = (harmonics || 32) + 1;
    var real = new Float32Array(n), imag = new Float32Array(n);
    for (var k = 1; k < n; k++) {
      imag[k] = (2 / (k * Math.PI)) * (1 - Math.cos(2 * Math.PI * k * duty));
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }
  function sawWave(harmonics) {
    var n = harmonics + 1;
    var real = new Float32Array(n), imag = new Float32Array(n);
    for (var k = 1; k < n; k++) imag[k] = 1 / k;
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function buildGraph() {
    masterGain = ctx.createGain();
    masterGain.gain.value = cfg.muted ? 0 : 0.9 * cfg.volume * cfg.volume;
    masterGain.connect(ctx.destination);

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    comp.connect(masterGain);

    duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(comp);

    warmShelf = ctx.createBiquadFilter();
    warmShelf.type = 'highshelf'; warmShelf.frequency.value = 4200; warmShelf.gain.value = -3.5;
    warmShelf.connect(duckGain);

    softClip = ctx.createWaveShaper();
    var sc = new Float32Array(2048);
    for (var i = 0; i < 2048; i++) {
      var x = (i / 2047) * 2 - 1;
      sc[i] = Math.tanh(1.2 * x) / 0.83365;
    }
    softClip.curve = sc; softClip.oversample = '2x';
    softClip.connect(warmShelf);

    ['ui', 'game', 'impact', 'bed'].forEach(function (k) {
      bus[k] = ctx.createGain(); bus[k].gain.value = BUS_GAIN[k]; bus[k].connect(softClip);
    });

    bedDuck = ctx.createGain(); bedDuck.gain.value = 1; bedDuck.connect(bus.bed);

    convolver = ctx.createConvolver();
    convolver.buffer = buildImpulse();
    verbGain = ctx.createGain(); verbGain.gain.value = 0.55;
    convolver.connect(verbGain); verbGain.connect(softClip);
    sendJoin = convolver;

    slapDelay = ctx.createDelay(1.0); slapDelay.delayTime.value = 0.135;
    slapFb = ctx.createGain(); slapFb.gain.value = 0.32;
    slapLp = ctx.createBiquadFilter(); slapLp.type = 'lowpass'; slapLp.frequency.value = 2200;
    slapGain = ctx.createGain(); slapGain.gain.value = 0.5;
    slapDelay.connect(slapFb); slapFb.connect(slapDelay);
    slapDelay.connect(slapLp); slapLp.connect(slapGain); slapGain.connect(softClip);

    /* The click impulse is built ONCE — priority:pass alone can fire dozens of
       times a turn and must not allocate a buffer per hit. */
    NOISE.tick = ctx.createBuffer(1, 2, ctx.sampleRate);
    var td = NOISE.tick.getChannelData(0); td[0] = 1.0; td[1] = -0.6;

    NOISE.white = buildWhite(2.0);
    NOISE.pink = buildPink(2.0);
    NOISE.metal = buildMetal(1.0);

    WAVE.pulse25 = pulseWave(0.25, 32);
    WAVE.pulse12 = pulseWave(0.125, 32);
    WAVE.saw8 = sawWave(8);

    CRUSH[4] = buildCrushCurve(4);
    CRUSH[5] = buildCrushCurve(5);

    hasPanner = typeof ctx.createStereoPanner === 'function';
  }

  /* --- master / duck -------------------------------------------------- */

  function applyMaster() {
    if (!ready) return;
    var v = cfg.muted ? 0.0001 : 0.9 * cfg.volume * cfg.volume;
    var t = ctx.currentTime;
    guard(function () {
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
      masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + 0.06);
    });
  }

  function duck(depth, holdMs, relMs) {
    if (!ready) return;
    var t = ctx.currentTime, g = duckGain.gain;
    guard(function () {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(depth, t + 0.040);
      g.setValueAtTime(depth, t + 0.040 + holdMs / 1000);
      g.linearRampToValueAtTime(1, t + 0.040 + holdMs / 1000 + relMs / 1000);
    });
  }

  var bedDuckLevel = 1;
  function duckBed(depth, holdMs, relMs) {
    if (!ready) return;
    var t = ctx.currentTime, g = bedDuck.gain;
    bedDuckLevel = depth;
    guard(function () {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(depth, t + 0.060);
      if (holdMs != null) {
        g.setValueAtTime(depth, t + 0.060 + holdMs / 1000);
        g.linearRampToValueAtTime(1, t + 0.060 + holdMs / 1000 + (relMs || 500) / 1000);
        bedDuckLevel = 1;
      }
    });
  }
  function unduckBed(relMs) {
    if (!ready) return;
    var t = ctx.currentTime, g = bedDuck.gain;
    bedDuckLevel = 1;
    guard(function () {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(1, t + (relMs || 500) / 1000);
    });
  }

  /* --- voice registry ------------------------------------------------- */

  function register(gainNode, endTime, busName) {
    var prio = BUS_PRIO[busName] != null ? BUS_PRIO[busName] : 2;
    var now = ctx.currentTime;
    for (var i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
    voices.push({ g: gainNode, end: endTime, p: prio, id: ++voiceId });
    if (voices.length > VOICE_CAP) {
      var idx = 0, best = voices[0];
      for (var j = 1; j < voices.length - 1; j++) {
        var c = voices[j];
        if (c.p < best.p || (c.p === best.p && c.id < best.id)) { best = c; idx = j; }
      }
      guard(function () {
        var t = ctx.currentTime;
        best.g.gain.cancelScheduledValues(t);
        best.g.gain.setValueAtTime(Math.max(0.0001, best.g.gain.value), t);
        best.g.gain.linearRampToValueAtTime(0.0001, t + 0.030);
      });
      voices.splice(idx, 1);
    }
  }

  /* --- routing helper ------------------------------------------------- */

  function makeFilters(spec, t0) {
    /* spec: {type,f,f2,fTime,q} or an array of those. Returns [head, tail]. */
    if (!spec) return null;
    var list = Array.isArray(spec) ? spec : [spec];
    var head = null, tail = null;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var f = ctx.createBiquadFilter();
      f.type = s.type || 'lowpass';
      f.frequency.setValueAtTime(Math.max(20, s.f), t0);
      if (s.f2 != null) {
        f.frequency.exponentialRampToValueAtTime(Math.max(20, s.f2), t0 + (s.fTime != null ? s.fTime : 0.15));
      }
      if (s.q != null) f.Q.value = s.q;
      if (!head) head = f; else tail.connect(f);
      tail = f;
    }
    return [head, tail];
  }

  function attachOut(tail, o, t0, tEnd) {
    var busName = o.bus || 'game';
    var out = tail;
    if (o.seat != null && hasPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = o.seat === 1 ? 0.16 : -0.16;
      out.connect(p); out = p;
    }
    out.connect(bus[busName] || bus.game);
    if (o.send) {
      var s = ctx.createGain(); s.gain.value = o.send; out.connect(s); s.connect(sendJoin);
    }
    if (o.slap) {
      var d = ctx.createGain(); d.gain.value = o.slap; out.connect(d); d.connect(slapDelay);
    }
    return busName;
  }

  function envelope(g, t0, atk, dec, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.0005, atk));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.0005, atk) + Math.max(0.005, dec));
  }

  function setWave(node, wave) {
    if (wave === 'pulse25' || wave === 'pulse12' || wave === 'saw8') node.setPeriodicWave(WAVE[wave]);
    else node.type = wave || 'sine';
  }

  /**
   * Oscillator voice.
   * o: { wave, f, f2, fTime, fExp, detune, detuneTo, detuneTime, dur, attack, gain,
   *      filt, crushBits, bus, send, slap, seat, t, human }
   */
  function osc(o) {
    if (!ready) return null;
    return guard(function () {
      var base = (o.t0 != null ? o.t0 : T0()) + (o.t || 0) + (o.human === false ? 0 : hOnset());
      var dur = o.dur != null ? o.dur : 0.15;
      var atk = o.attack != null ? o.attack : 0.002;
      var dec = Math.max(0.01, dur - atk);
      var tEnd = base + atk + dec;

      var n = ctx.createOscillator();
      setWave(n, o.wave);
      var f = o.human === false ? o.f : hPitch(o.f);
      n.frequency.setValueAtTime(Math.max(8, f), base);
      if (o.f2 != null) {
        var f2 = o.human === false ? o.f2 : hPitch(o.f2);
        var ft = base + (o.fTime != null ? o.fTime : dur);
        if (o.fExp === false) n.frequency.linearRampToValueAtTime(Math.max(8, f2), ft);
        else n.frequency.exponentialRampToValueAtTime(Math.max(8, f2), ft);
      }
      if (o.detune != null) n.detune.setValueAtTime(o.detune, base);
      if (o.detuneTo != null) {
        n.detune.linearRampToValueAtTime(o.detuneTo, base + (o.detuneTime != null ? o.detuneTime : dur));
      }

      var head = n, tail = n;
      if (o.crushBits && CRUSH[o.crushBits]) {
        var ws = ctx.createWaveShaper();
        ws.curve = CRUSH[o.crushBits];
        tail.connect(ws); tail = ws;
      }
      var fl = makeFilters(o.filt, base);
      if (fl) { tail.connect(fl[0]); tail = fl[1]; }

      var g = ctx.createGain();
      envelope(g, base, atk, dec, o.human === false ? (o.gain || 0.1) : hGain(o.gain != null ? o.gain : 0.1));
      tail.connect(g);

      var busName = attachOut(g, o, base, tEnd);
      n.start(base);
      n.stop(tEnd + 0.02);
      n.onended = function () { guard(function () { n.disconnect(); g.disconnect(); }); };
      register(g, tEnd, busName);
      return { node: n, gain: g, end: tEnd };
    });
  }

  /**
   * Noise voice.
   * o: { src:'white'|'pink'|'metal', crush:'soft'|'std'|'deep'|'dead', dur, attack, gain,
   *      filt, bus, send, slap, seat, t }
   */
  function nz(o) {
    if (!ready) return null;
    return guard(function () {
      var base = (o.t0 != null ? o.t0 : T0()) + (o.t || 0) + hOnset();
      var dur = o.dur != null ? o.dur : 0.15;
      var atk = o.attack != null ? o.attack : 0.006;
      var dec = Math.max(0.01, dur - atk);
      var tEnd = base + atk + dec;

      var n = ctx.createBufferSource();
      n.buffer = noiseBuf(o.src || 'white', dur, o.crush);
      n.playbackRate.value = rnd(0.94, 1.06);
      var maxOff = Math.max(0, n.buffer.duration - dur * 1.1);
      var off = maxOff > 0 ? Math.random() * maxOff : 0;
      n.loop = n.buffer.duration < dur * 1.2;

      var tail = n;
      var fl = makeFilters(o.filt, base);
      if (fl) { tail.connect(fl[0]); tail = fl[1]; }

      var g = ctx.createGain();
      envelope(g, base, atk, dec, hGain(o.gain != null ? o.gain : 0.1));
      tail.connect(g);

      var busName = attachOut(g, o, base, tEnd);
      n.start(base, off);
      n.stop(tEnd + 0.02);
      n.onended = function () { guard(function () { n.disconnect(); g.disconnect(); }); };
      register(g, tEnd, busName);
      return { node: n, gain: g, end: tEnd };
    });
  }

  /** Dry click: a 2-sample impulse through a resonant band. */
  function clik(o) {
    if (!ready) return null;
    return guard(function () {
      var base = (o.t0 != null ? o.t0 : T0()) + (o.t || 0) + hOnset();
      var n = ctx.createBufferSource(); n.buffer = NOISE.tick;

      var tail = n;
      if (o.hp) {
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o.hp;
        tail.connect(hp); tail = hp;
      }
      var bp = ctx.createBiquadFilter();
      bp.type = o.type || 'bandpass';
      bp.frequency.value = o.f || 2400;
      bp.Q.value = o.q != null ? o.q : 10;
      tail.connect(bp);

      var g = ctx.createGain();
      var tEnd = base + 0.05;
      g.gain.setValueAtTime(hGain(o.gain != null ? o.gain : 0.08), base);
      g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
      bp.connect(g);

      var busName = attachOut(g, o, base, tEnd);
      n.start(base);
      n.stop(tEnd + 0.02);
      n.onended = function () { guard(function () { n.disconnect(); g.disconnect(); }); };
      register(g, tEnd, busName);
      return { node: n, gain: g, end: tEnd };
    });
  }

  /* ==================================================================== *
   * 4 · AFFINITY FINGERPRINTS                                            *
   * ==================================================================== */

  /* Home tones spell C#m11 — consonant in any combination.
     Identity lives in wave + filter topology + envelope, not pitch alone. */
  function fingerprint(aff, mul, tOff, seat, send) {
    var k = mul != null ? mul : 1;
    var t = tOff || 0;
    var s = seat === 1 ? SEAT_T : 1;
    var sd = send != null ? send : 0.20;
    var opt = { bus: 'game', seat: seat, send: sd, t: t };

    switch (aff) {
      case 'P': /* orange current, useful heat */
        osc({ wave: 'square', f: HZ.Cs3 * s, dur: 0.161, attack: 0.001, gain: 0.20 * k,
              filt: { type: 'lowpass', f: 1400, f2: 400, fTime: 0.14, q: 8 }, bus: opt.bus, seat: seat, send: sd, t: t });
        osc({ wave: 'square', f: HZ.Cs4 * s, dur: 0.161, attack: 0.001, gain: 0.20 * 0.45 * k,
              filt: { type: 'lowpass', f: 1400, f2: 400, fTime: 0.14, q: 8 }, seat: seat, send: sd, t: t });
        nz({ src: 'white', dur: 0.022, attack: 0.001, gain: 0.08 * k,
             filt: { type: 'highpass', f: 2200 }, seat: seat, send: sd * 0.4, t: t });
        break;
      case 'B': /* growth, settlement */
        osc({ wave: 'pulse25', f: HZ.Gs4 * s, dur: 0.262, attack: 0.002, gain: 0.18 * k,
              detune: 0, detuneTo: 6, detuneTime: 0.06,
              filt: { type: 'bandpass', f: 900, q: 3 }, seat: seat, send: sd, t: t });
        osc({ wave: 'pulse25', f: HZ.Gs5 * s, dur: 0.262, attack: 0.002, gain: 0.18 * 0.40 * k,
              detune: 0, detuneTo: 6, detuneTime: 0.06,
              filt: { type: 'bandpass', f: 900, q: 3 }, seat: seat, send: sd, t: t });
        nz({ src: 'metal', dur: 0.020, attack: 0.001, gain: 0.07 * k,
             filt: { type: 'bandpass', f: 3100, q: 6 }, seat: seat, send: sd * 0.5, t: t });
        break;
      case 'K': /* a tumbler falling */
        osc({ wave: 'pulse12', f: HZ.Ds5 * s, dur: 0.0908, attack: 0.0008, gain: 0.18 * k,
              filt: [{ type: 'highpass', f: 700 }, { type: 'bandpass', f: 2600, q: 9 }],
              seat: seat, send: sd, t: t });
        break;
      case 'S': /* rooftop, sunrise */
        osc({ wave: 'triangle', f: HZ.B4 * s, f2: HZ.Fs5 * s, fTime: 0.09, dur: 0.304, attack: 0.004,
              gain: 0.19 * k, filt: { type: 'lowpass', f: 5200 }, seat: seat, send: sd, t: t });
        nz({ src: 'pink', dur: 0.040, attack: 0.004, gain: 0.03 * k,
             filt: { type: 'bandpass', f: 3000, q: 1 }, seat: seat, send: sd, t: t });
        break;
      case 'T': /* teal calm — the only affinity with a two-beat rhythm */
        for (var beat = 0; beat < 2; beat++) {
          var bt = t + beat * 0.180;
          var bg = beat === 0 ? 1 : 0.55;
          osc({ wave: 'sine', f: HZ.Fs2 * s, dur: 0.57, attack: 0.02, gain: 0.20 * k * bg,
                filt: { type: 'lowpass', f: 800 }, seat: seat, send: sd, t: bt });
          osc({ wave: 'square', f: HZ.Fs4 * s, dur: 0.57, attack: 0.02, gain: 0.20 * 0.25 * k * bg,
                filt: { type: 'lowpass', f: 800 }, seat: seat, send: sd, t: bt });
          nz({ src: 'white', dur: 0.006, attack: 0.001, gain: 0.11 * k * bg,
               filt: { type: 'bandpass', f: beat === 0 ? 2600 : 2200, q: 12 }, seat: seat, send: sd * 0.4, t: bt });
        }
        break;
      default: /* neutral */
        osc({ wave: 'saw8', f: HZ.E3 * s, dur: 0.142, attack: 0.002, gain: 0.17 * k,
              filt: { type: 'lowpass', f: 2400 }, seat: seat, send: sd, t: t });
    }
  }

  function fingerprintRoot(aff, seat) {
    var s = seat === 1 ? SEAT_T : 1;
    var r = { P: HZ.Cs3, B: HZ.Gs4, K: HZ.Ds5, S: HZ.B4, T: HZ.Fs2, N: HZ.E3 }[aff] || HZ.E3;
    return r * s;
  }
  var AFF_COLOUR_HZ = { P: 700, B: 2200, K: 1300, S: 3000, T: 1700, N: 1500 };

  function playFingerprints(affs, seat, send, gainMul) {
    var g = gainMul != null ? gainMul : 1;
    fingerprint(affs[0], g, 0, seat, send);
    if (affs.length > 1) fingerprint(affs[1], 0.45 * g, 0.035, seat, send);
  }

  /* ==================================================================== *
   * 5 · SUSTAINED LAYERS — pressure drone, ambient bed, clash bus, hold   *
   * ==================================================================== */

  var drone = null, bedNodes = null, clashBus = null, holdTone = null, holdTimer = 0;
  var bufferTotal = 0;
  var activeSeat = 0;

  function makeDrone() {
    if (drone || !ready) return;
    drone = guard(function () {
      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = HZ.Cs1;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = HZ.Cs2;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
      var trem = ctx.createGain(); trem.gain.value = 0.0001;
      var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2.0;
      var lfoG = ctx.createGain(); lfoG.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(trem); trem.connect(bedDuck);
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      o1.start(); o2.start(); lfo.start();
      return { o1: o1, o2: o2, lp: lp, trem: trem, lfo: lfo, lfoG: lfoG };
    }) || null;
    updateDrone();
  }

  function updateDrone() {
    if (!drone || !ready) return;
    guard(function () {
      var t = ctx.currentTime, k = 0.25;
      var on = cfg.pressure ? 1 : 0;
      var g = Math.min(0.055, 0.011 * bufferTotal) * on;
      drone.trem.gain.cancelScheduledValues(t);
      drone.trem.gain.setValueAtTime(Math.max(0.0001, drone.trem.gain.value), t);
      drone.trem.gain.linearRampToValueAtTime(Math.max(0.0001, g), t + k);
      drone.lp.frequency.linearRampToValueAtTime(520 + 160 * bufferTotal, t + k);
      drone.lfo.frequency.linearRampToValueAtTime(2.0 + 0.45 * bufferTotal, t + k);
      drone.lfoG.gain.linearRampToValueAtTime(0.30 * g, t + k);
    });
  }

  function setBuffer(total) {
    bufferTotal = Math.max(0, total | 0);
    updateDrone();
  }

  function startBed() {
    if (bedNodes || !ready) return;
    bedNodes = guard(function () {
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
      var g1 = ctx.createGain(); g1.gain.value = 0.030;
      var g2 = ctx.createGain(); g2.gain.value = 0.018;
      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = HZ.Cs1;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = HZ.Cs2;
      o1.connect(g1); g1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(bedDuck);

      var room = ctx.createBufferSource(); room.buffer = NOISE.pink; room.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.5;
      var rg = ctx.createGain(); rg.gain.value = 0.008;
      var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.06;
      var lfoG = ctx.createGain(); lfoG.gain.value = 120;
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      room.connect(bp); bp.connect(rg); rg.connect(bedDuck);

      o1.start(); o2.start(); room.start(); lfo.start();
      return { o1: o1, o2: o2, lp: lp, room: room, bp: bp, rg: rg, lfo: lfo, lfoG: lfoG, g1: g1, g2: g2 };
    }) || null;
  }

  function stopBed() {
    if (!bedNodes) return;
    var b = bedNodes; bedNodes = null;
    guard(function () {
      var t = ctx.currentTime;
      [b.g1, b.g2, b.rg].forEach(function (g) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      });
      [b.o1, b.o2, b.room, b.lfo].forEach(function (n) { try { n.stop(t + 0.45); } catch (e) {} });
    });
  }

  function stopClashBus(fadeSec) {
    if (!clashBus) return;
    var c = clashBus; clashBus = null;
    guard(function () {
      var t = ctx.currentTime, f = fadeSec || 0.5;
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setValueAtTime(Math.max(0.0001, c.g.gain.value), t);
      c.g.gain.linearRampToValueAtTime(0.0001, t + f);
      try { c.o.stop(t + f + 0.05); } catch (e) {}
    });
    unduckBed(600);
  }

  function stopHoldTone() {
    if (holdTimer) { global.clearTimeout(holdTimer); holdTimer = 0; }
    if (!holdTone) return;
    var h = holdTone; holdTone = null;
    guard(function () {
      var t = ctx.currentTime;
      h.g.gain.cancelScheduledValues(t);
      h.g.gain.setValueAtTime(Math.max(0.0001, h.g.gain.value), t);
      h.g.gain.linearRampToValueAtTime(0.0001, t + 0.040);
      try { h.o.stop(t + 0.08); } catch (e) {}
      try { h.lfo.stop(t + 0.08); } catch (e) {}
    });
  }

  /* ==================================================================== *
   * 6 · ARM / SUSPEND                                                    *
   * ==================================================================== */

  var armListeners = [];
  var lastResumeAttempt = 0;

  function arm() {
    if (ready) return true;
    var now = Date.now();
    if (now - lastResumeAttempt < 1000 && armTried > 0) return false;
    lastResumeAttempt = now;
    armTried++;
    var ok = guard(function () {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) {
        var p = ctx.resume();
        if (p && p.catch) p.catch(function () {});
      }
      if (!masterGain) buildGraph();
      ready = true;
      applyMaster();
      if (cfg.bed) startBed();
      return true;
    });
    if (ok) removeArmListeners();
    return !!ok;
  }

  function removeArmListeners() {
    armListeners.forEach(function (l) {
      guard(function () { doc.removeEventListener(l[0], l[1], l[2]); });
    });
    armListeners.length = 0;
  }

  function wireArmListeners() {
    if (!doc || armListeners.length) return;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
      var opts = { once: true, capture: true, passive: true };
      var fn = function () { arm(); };
      doc.addEventListener(type, fn, opts);
      armListeners.push([type, fn, opts]);
    });
  }

  function suspendAudio() {
    if (!ready) return;
    guard(function () {
      var t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
      masterGain.gain.linearRampToValueAtTime(0.0001, t + 0.120);
    });
    global.setTimeout(function () {
      guard(function () { if (ctx && ctx.suspend) { var p = ctx.suspend(); if (p && p.catch) p.catch(function () {}); } });
    }, 200);
  }
  function resumeAudio() {
    if (!ready) return;
    guard(function () { if (ctx.resume) { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } });
    applyMaster();
  }

  /* ==================================================================== *
   * 7 · SFX BOOK                                                         *
   * ==================================================================== */

  function seatMul(seat) { return seat === 1 ? SEAT_T : 1; }

  var SFX = {};

  SFX['game:start'] = function () {
    /* power-on thunk */
    osc({ wave: 'sine', f: 55, f2: HZ.Cs1, fTime: 0.35, dur: 0.506, attack: 0.006, gain: 0.50,
          filt: { type: 'lowpass', f: 200 }, bus: 'impact', send: 0.20 });
    /* degauss */
    nz({ src: 'pink', dur: 0.60, attack: 0.030, gain: 0.22, crush: 'std', bus: 'game', send: 0.25,
         filt: { type: 'bandpass', f: 180, f2: 2400, fTime: 0.25, q: 1.2 } });
    nz({ src: 'pink', dur: 0.35, attack: 0.010, gain: 0.10, crush: 'std', bus: 'game', send: 0.25, t: 0.25,
         filt: { type: 'bandpass', f: 2400, f2: 300, fTime: 0.35, q: 1.2 } });
    /* boot arpeggio */
    var notes = [HZ.Cs4, HZ.Gs4, HZ.Cs5, HZ.Gs5], off = [0, 0.090, 0.180, 0.300];
    for (var i = 0; i < 4; i++) {
      osc({ wave: 'pulse25', f: notes[i], dur: 0.18, attack: 0.003, gain: i === 3 ? 0.26 : 0.20,
            filt: { type: 'lowpass', f: 4000 }, bus: 'game', send: i === 3 ? 0.45 : 0.25, t: off[i] });
    }
    makeDrone();
  };

  SFX['turn:begin'] = function (d) {
    var s = seatMul(d.seat);
    osc({ wave: 'pulse25', f: HZ.Gs3 * s, dur: 0.16, attack: 0.002, gain: 0.16,
          filt: { type: 'lowpass', f: 3200 }, send: 0.18 });
    osc({ wave: 'pulse25', f: HZ.Cs4 * s, dur: 0.16, attack: 0.002, gain: 0.16,
          filt: { type: 'lowpass', f: 3200 }, send: 0.18, t: 0.070 });
    clik({ f: 2200, q: 9, gain: 0.05, bus: 'ui' });
  };

  SFX['phase:enter'] = function (d) {
    var f = PHASE_PITCH[d.phase] || HZ.Fs4;
    var g = AUTO_PHASES[d.phase] ? 0.11 * 0.70 : 0.11;
    osc({ wave: 'pulse12', f: f, dur: 0.09, attack: 0.001, gain: g,
          filt: { type: 'bandpass', f: f * 2, q: 4 }, bus: 'ui', send: 0.10 });
  };

  var passTimes = [];
  var passQuiet = 0;
  SFX['priority:pass'] = function () {
    var now = Date.now();
    passTimes.push(now);
    while (passTimes.length && now - passTimes[0] > 400) passTimes.shift();
    if (passTimes.length >= 4) passQuiet = now + 2000;
    var g = now < passQuiet ? 0.03 : 0.07;
    clik({ f: 3100, q: 12, gain: g, hp: 900, bus: 'ui' });
  };

  SFX['card:draw'] = function (d) {
    var n = Math.min(5, Math.max(1, d.count || 1));
    var s = seatMul(d.seat);
    for (var i = 0; i < n; i++) {
      var t = i * STAG.draw / 1000;
      var det = i * 14;
      nz({ src: 'white', dur: 0.13, attack: 0.004, gain: 0.16, crush: 'soft', seat: d.seat, t: t,
           filt: { type: 'bandpass', f: cents(1200, det), f2: cents(4200, det), fTime: 0.10, q: 2.5 }, send: 0.16 });
      osc({ wave: 'pulse25', f: cents(HZ.Gs5 * s, det), dur: 0.05, attack: 0.001, gain: 0.06,
            seat: d.seat, t: t + 0.040, send: 0.16 });
    }
  };

  SFX['card:play'] = function (d) {
    var s = seatMul(d.seat);
    var affs = affList(d.affinity);
    var type = typeOf(d.cardType);
    var send = (type === 'Zap' || type === 'Operation') ? 0.34 : 0.20;

    if (type === 'Zap') {
      osc({ wave: 'square', f: 1800 * s, f2: 300 * s, fTime: 0.05, dur: 0.14, attack: 0.001, gain: 0.24,
            crushBits: 5, seat: d.seat, send: send, slap: 0.40, bus: 'impact' });
    } else {
      osc({ wave: 'square', f: 110 * s, f2: HZ.E2 * s, fTime: 0.09, dur: 0.142, attack: 0.002, gain: 0.20,
            filt: { type: 'lowpass', f: 620, q: 1 }, seat: d.seat, send: send, bus: 'game' });
    }
    playFingerprints(affs, d.seat, send, 0.70);

    var root = fingerprintRoot(affs[0], d.seat);
    if (type === 'Avatar') {
      osc({ wave: 'pulse25', f: root * 3, dur: 0.20, attack: 0.003, gain: 0.09,
            seat: d.seat, send: send, t: 0.045 });
    } else if (type === 'Hardware') {
      clik({ f: 1800, q: 10, gain: 0.09, seat: d.seat, bus: 'ui' });
      clik({ f: 2600, q: 10, gain: 0.09, seat: d.seat, bus: 'ui', t: 0.038 });
    } else if (type === 'Protocol') {
      osc({ wave: 'triangle', f: HZ.Fs4 * s, f2: HZ.Cs5 * s, fTime: 0.28, dur: 0.28, attack: 0.004,
            gain: 0.08, filt: { type: 'lowpass', f: 3000 }, seat: d.seat, send: send });
    } else if (type === 'Operation') {
      [1, 1.49831, 2].forEach(function (r, i) {
        osc({ wave: 'pulse25', f: root * r, dur: 0.14, attack: 0.002, gain: 0.10,
              seat: d.seat, send: send, t: i * 0.055 });
      });
    }
  };

  SFX['card:archive'] = function (d) {
    var s = seatMul(d.seat);
    nz({ src: 'pink', dur: 0.16, attack: 0.006, gain: 0.13, seat: d.seat, send: 0.24,
         filt: { type: 'bandpass', f: 4200, f2: 700, fTime: 0.14, q: 2.5 } });
    osc({ wave: 'square', f: HZ.Cs3 * s, dur: 0.12, attack: 0.003, gain: 0.10,
          filt: { type: 'lowpass', f: 500 }, seat: d.seat, send: 0.24 });
    clik({ f: 1400, q: 10, gain: 0.05, seat: d.seat, bus: 'ui', t: 0.180 });
  };

  SFX['resource:play'] = function (d) {
    var s = seatMul(d.seat);
    var affs = affList(d.affinity);
    playFingerprints(affs, d.seat, 0.22, 1.0);
    osc({ wave: 'square', f: HZ.Fs2 * s, dur: 0.10, attack: 0.003, gain: 0.14,
          filt: { type: 'lowpass', f: 400 }, seat: d.seat, send: 0.22 });
    osc({ wave: 'triangle', f: HZ.Cs6 * s, dur: 0.04, attack: 0.001, gain: 0.03,
          seat: d.seat, send: 0.22, t: 0.060 });
  };

  SFX['resource:generate'] = function (d) {
    var aff = affOf(d.affinity);
    var amount = Math.max(1, d.amount | 0 || 1);
    var s = seatMul(d.seat);
    var root = fingerprintRoot(aff, d.seat);
    var start = (d.index != null ? d.index : bufferTotal) | 0;
    var n = Math.min(6, amount);
    for (var i = 0; i < n; i++) {
      osc({ wave: 'triangle', f: root * dorian(start + i), dur: 0.13, attack: 0.004,
            gain: 0.085 * (1 - 0.06 * i), seat: d.seat, send: 0.16, t: i * STAG.generate / 1000,
            filt: { type: 'bandpass', f: AFF_COLOUR_HZ[aff] || 1500, q: 1.8 } });
    }
    if (amount > 6) {
      osc({ wave: 'triangle', f: root * 2, dur: 0.13, attack: 0.004, gain: 0.10,
            seat: d.seat, send: 0.16, t: 6 * STAG.generate / 1000,
            filt: { type: 'bandpass', f: AFF_COLOUR_HZ[aff] || 1500, q: 1.8 } });
    }
  };

  var burnTimes = [];
  var BURN_DESC = [HZ.Ds5, HZ.Cs5, HZ.B4, HZ.As4, HZ.Gs4, HZ.Fs4, HZ.E4, HZ.Ds4];

  SFX['buffer:burn'] = function (d) {
    var amount = Math.max(1, d.amount | 0 || 1);
    var s = seatMul(d.seat);
    var now = Date.now();
    burnTimes.push(now);
    while (burnTimes.length && now - burnTimes[0] > 10000) burnTimes.shift();
    var k = Math.min(1, 0.55 + 0.15 * amount) * (burnTimes.length > 2 ? 0.60 : 1);

    /* 1 · drone gulp */
    if (drone && ready) guard(function () {
      var t = ctx.currentTime;
      drone.trem.gain.cancelScheduledValues(t);
      drone.trem.gain.setValueAtTime(Math.max(0.0001, drone.trem.gain.value), t);
      drone.trem.gain.linearRampToValueAtTime(0.0001, t + 0.035);
    });

    /* 2 · voltage sag — ramping DETUNE is what makes it read as a machine losing power */
    osc({ wave: 'square', f: 220 * s, dur: 0.508, attack: 0.008, gain: 0.26 * k,
          detune: 0, detuneTo: -700, detuneTime: 0.42, crushBits: 4,
          filt: { type: 'lowpass', f: 2400, f2: 300, fTime: 0.42, q: 4 },
          seat: d.seat, send: 0.30, bus: 'impact' });

    /* 3 · dumped charge */
    nz({ src: 'pink', dur: 0.50, attack: 0.020, gain: 0.18 * k, crush: 'deep',
         filt: { type: 'lowpass', f: 1600, f2: 180, fTime: 0.45, q: 0.7 },
         seat: d.seat, send: 0.30, bus: 'impact' });

    /* 4 · the count — you literally hear how much Uptime you wasted */
    var n = Math.min(amount, 8);
    for (var i = 0; i < n; i++) {
      osc({ wave: 'pulse12', f: BURN_DESC[i] * s, dur: 0.06, attack: 0.001, gain: 0.13 * k,
            seat: d.seat, send: 0.20, t: i * STAG.burn / 1000 });
    }
    /* 5 · the shrug — the friendly terminal moving on */
    clik({ f: 2400, q: 8, gain: 0.05, bus: 'ui', t: (STAG.burn * n + 60) / 1000 });

    duck(0.82, 40, 420);
    duckBed(0.45, 60, 500);
  };

  /* Level bookkeeping lives in trackBuffer() on the always-run path, not here:
     the drone must follow the Buffer even while audio is unarmed or throttled. */
  SFX['buffer:set'] = function () {};

  SFX['ability:activate'] = function (d) {
    var name = String(d.cardName == null ? '' : d.cardName);
    var h = 7;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    var base = [HZ.Gs4, HZ.As4, HZ.B4, HZ.Cs5, HZ.Ds5][Math.abs(h) % 5];
    var det = ((Math.abs(h >> 5) % 5) - 2) * 7;
    var s = seatMul(d.seat);
    clik({ f: 1500, q: 10, gain: 0.10, seat: d.seat, bus: 'ui' });
    clik({ f: 2900, q: 10, gain: 0.10, seat: d.seat, bus: 'ui', t: 0.026 });
    osc({ wave: 'pulse25', f: base * s, detune: det, dur: 0.13, attack: 0.002, gain: 0.15,
          filt: { type: 'lowpass', f: 3600 }, seat: d.seat, send: 0.20 });
  };

  SFX['target:request'] = function () {
    osc({ wave: 'triangle', f: HZ.Fs4, f2: HZ.B4, fTime: 0.14, dur: 0.14, attack: 0.004, gain: 0.11,
          filt: { type: 'lowpass', f: 4000 }, bus: 'ui', send: 0.14 });
    stopHoldTone();
    if (!ready) return;
    holdTone = guard(function () {
      var t = ctx.currentTime;
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = HZ.B4;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.15);
      var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.9;
      var lg = ctx.createGain(); lg.gain.value = 0.016;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(bus.ui);
      o.start(); lfo.start();
      return { o: o, g: g, lfo: lfo, lg: lg };
    }) || null;
    duckBed(0.55);
    /* never nags forever */
    holdTimer = global.setTimeout(function () { stopHoldTone(); unduckBed(1000); }, 20000);
  };

  SFX['target:choose'] = function () {
    osc({ wave: 'triangle', f: HZ.B4, f2: HZ.Fs4, fTime: 0.08, dur: 0.08, attack: 0.003, gain: 0.13,
          bus: 'ui', send: 0.14 });
    clik({ f: 2600, q: 9, gain: 0.08, bus: 'ui' });
    stopHoldTone();
    unduckBed(400);
  };

  SFX['clash:begin'] = function () {
    /* bus voltage rise — the only sustained tension bed in the game */
    if (ready && !clashBus) clashBus = guard(function () {
      var t = ctx.currentTime;
      var o = ctx.createOscillator(); o.setPeriodicWave(WAVE.saw8);
      o.frequency.setValueAtTime(HZ.Cs2, t);
      o.frequency.exponentialRampToValueAtTime(HZ.Cs3, t + 0.45);
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(1800, t + 0.45);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.30);
      g.gain.linearRampToValueAtTime(0.08, t + 0.60);
      o.connect(f); f.connect(g); g.connect(bus.game);
      o.start();
      return { o: o, f: f, g: g };
    }) || null;

    [HZ.Cs4, HZ.Gs4, HZ.Cs5].forEach(function (f, i) {
      osc({ wave: 'pulse25', f: f, dur: 0.12, attack: 0.002, gain: 0.18, bus: 'impact',
            send: 0.20, slap: 0.35, t: i * 0.110 });
    });
    nz({ src: 'white', dur: 0.18, attack: 0.006, gain: 0.20, bus: 'impact', slap: 0.50, send: 0.18,
         filt: { type: 'bandpass', f: 220, q: 1.4 } });
    duck(0.85, 60, 400);
    duckBed(0.40);
    if (drone) guard(function () {
      var t = ctx.currentTime;
      drone.lp.frequency.linearRampToValueAtTime(110, t + 0.4);
    });
  };

  function endClash() {
    stopClashBus(0.5);
    if (drone) guard(function () {
      drone.lp.frequency.linearRampToValueAtTime(520 + 160 * bufferTotal, ctx.currentTime + 0.5);
    });
  }

  SFX['clash:declareAttackers'] = function (d) {
    var count = Math.max(0, d.count | 0);
    var n = Math.min(count, 8);
    nz({ src: 'white', dur: 0.10, attack: 0.003, gain: 0.10, bus: 'game', send: 0.14,
         filt: { type: 'highpass', f: 2000 } });
    for (var i = 0; i < n; i++) {
      osc({ wave: 'square', f: HZ.Cs3, detune: i * 10, dur: 0.07, attack: 0.002,
            gain: 0.17 * (1 - 0.05 * i), filt: { type: 'lowpass', f: 900 },
            bus: 'game', send: 0.14, t: i * STAG.clash / 1000 });
    }
    if (count > 8) {
      osc({ wave: 'square', f: HZ.Cs4, dur: 0.07, attack: 0.002, gain: 0.14,
            filt: { type: 'lowpass', f: 900 }, bus: 'game', send: 0.14, t: 8 * STAG.clash / 1000 });
    }
  };

  SFX['clash:declareBlockers'] = function (d) {
    var count = Math.max(0, d.count | 0);
    if (count === 0) {
      /* the sound of an open door */
      osc({ wave: 'sine', f: HZ.Gs2, dur: 0.25, attack: 0.006, gain: 0.10,
            filt: { type: 'lowpass', f: 200 }, bus: 'game', send: 0.20 });
      return;
    }
    var n = Math.min(count, 8);
    for (var i = 0; i < n; i++) {
      osc({ wave: 'pulse12', f: HZ.Gs4, detune: -i * 10, dur: 0.06, attack: 0.002, gain: 0.14,
            filt: { type: 'bandpass', f: 1600, q: 6 }, bus: 'game', send: 0.20,
            t: i * STAG.clash / 1000 });
    }
  };

  SFX['damage:player'] = function (d) {
    var a = Math.max(0, d.amount | 0);
    var c8 = Math.min(a, 8), c6 = Math.min(a, 6);
    var send = Math.min(0.36, 0.18 + 0.03 * c6);
    nz({ src: 'white', dur: 0.22, attack: 0.004, gain: 0.16 + 0.020 * c8, crush: 'deep',
         filt: { type: 'lowpass', f: 900, f2: 220, fTime: 0.20, q: 1.1 },
         bus: 'impact', seat: d.seat, send: send });
    osc({ wave: 'square', f: HZ.E2, f2: HZ.B1, fTime: 0.16, dur: 0.16, attack: 0.003,
          gain: 0.14 + 0.015 * c8, filt: { type: 'lowpass', f: 400 },
          bus: 'impact', seat: d.seat, send: send });
    clik({ f: 3200, q: 10, gain: 0.06, bus: 'ui', seat: d.seat });
    if (a >= 4) {
      osc({ wave: 'sine', f: HZ.Cs3, dur: 0.5, attack: 0.004, gain: 0.06,
            filt: { type: 'bandpass', f: HZ.Cs3, q: 9 }, bus: 'game', seat: d.seat, send: send });
    }
    if (a >= 5) duck(0.88, 120, 200);
  };

  /* Simultaneity rule: all damage:avatar in one frame collapse into ONE composite. */
  SFX['damage:avatar'] = function (list) {
    var arr = Array.isArray(list) ? list : [list];
    var n = Math.min(5, arr.length);
    for (var i = 0; i < n; i++) {
      var d = arr[i] || {};
      var a = Math.max(0, d.amount | 0);
      var k = Math.pow(0.62, i);
      var t = i * 0.012;
      clik({ f: 1900, q: 8, gain: 0.11 * k, bus: 'game', t: t });
      clik({ f: 2700, q: 8, gain: 0.11 * k, bus: 'game', t: t + 0.022 });
      nz({ src: 'metal', dur: 0.09, attack: 0.002, gain: (0.10 + 0.012 * Math.min(a, 6)) * k,
           filt: { type: 'bandpass', f: 1400 + 70 * a, q: 2 }, bus: 'game', send: 0.10, t: t });
      osc({ wave: 'triangle', f: 220, f2: 174.61, fTime: 0.07, dur: 0.07, attack: 0.002,
            gain: 0.09 * k, filt: { type: 'lowpass', f: 1200 }, bus: 'game', send: 0.10, t: t });
    }
  };

  SFX['avatar:decommission'] = function () {
    /* a graceful shutdown, not a death — it did its job */
    osc({ wave: 'square', f: 220, dur: 0.385, attack: 0.005, gain: 0.20,
          detune: 0, detuneTo: -1200, detuneTime: 0.30, crushBits: 4,
          filt: { type: 'lowpass', f: 1800, f2: 260, fTime: 0.30 }, bus: 'impact', send: 0.22 });
    nz({ src: 'pink', dur: 0.30, attack: 0.006, gain: 0.14,
         filt: { type: 'bandpass', f: 900, f2: 200, fTime: 0.28, q: 1.6 }, bus: 'game', send: 0.22 });
    /* the relay opening — the period at the end of the sentence */
    clik({ f: 1200, q: 14, gain: 0.09, bus: 'ui', t: 0.260 });
  };

  SFX['uptime:gain'] = function (d) {
    /* the one clean sound. NO crush anywhere — the absence of crush IS the reward. */
    var a = Math.max(1, d.amount | 0 || 1);
    var s = seatMul(d.seat);
    osc({ wave: 'triangle', f: HZ.Gs4 * s, dur: 0.30, attack: 0.006, gain: 0.09,
          filt: { type: 'lowpass', f: 5000 }, seat: d.seat, send: 0.30 });
    osc({ wave: 'sine', f: HZ.Ds5 * s, dur: 0.30, attack: 0.006, gain: 0.06,
          filt: { type: 'lowpass', f: 5000 }, seat: d.seat, send: 0.30 });
    osc({ wave: 'sine', f: HZ.Cs3 * s, dur: 0.45, attack: 0.18, gain: 0.05,
          filt: { type: 'lowpass', f: 1200 }, seat: d.seat, send: 0.30 });
    var climb = [HZ.Ds5, HZ.Fs5, HZ.Gs5];
    var extra = Math.min(a, 4) - 1;
    for (var i = 0; i < extra; i++) {
      osc({ wave: 'triangle', f: climb[i] * s, dur: 0.22, attack: 0.006,
            gain: 0.09 * Math.pow(0.85, i + 1), filt: { type: 'lowpass', f: 5000 },
            seat: d.seat, send: 0.30, t: (i + 1) * STAG.uptime / 1000 });
    }
  };

  SFX['manual:resolve'] = function (d) {
    /* the most acoustic sound in the set — a human decided, at your table */
    var s = seatMul(d.seat);
    [[HZ.Cs5, 0], [HZ.Gs4, 0.090]].forEach(function (p) {
      osc({ wave: 'pulse25', f: p[0] * s, dur: 0.14, attack: 0.004, gain: 0.12,
            filt: { type: 'lowpass', f: 2600 }, bus: 'game', send: 0.08, t: p[1] });
      nz({ src: 'pink', dur: 0.008, attack: 0.001, gain: 0.035,
           filt: { type: 'lowpass', f: 900 }, bus: 'game', send: 0.08, t: p[1] });
    });
  };

  SFX['game:win'] = function () {
    /* Positive, not triumphalist. The same sound plays for both seats. No loss sting. */
    var arp = [HZ.Cs4, HZ.E4, HZ.Gs4, HZ.B4, HZ.Cs5, HZ.Fs5];
    for (var i = 0; i < arp.length; i++) {
      osc({ wave: 'pulse25', f: arp[i], dur: 0.35, attack: 0.005, gain: 0.18,
            filt: { type: 'lowpass', f: 5200 }, bus: 'game', send: 0.35, slap: 0.25,
            t: i === 5 ? 0.500 : i * STAG.win / 1000 });
    }
    osc({ wave: 'triangle', f: HZ.Cs3, dur: 1.9, attack: 0.08, gain: 0.08,
          filt: { type: 'lowpass', f: 2600 }, bus: 'game', send: 0.30, t: 0.500 });
    osc({ wave: 'triangle', f: HZ.Gs3, dur: 1.9, attack: 0.08, gain: 0.05,
          filt: { type: 'lowpass', f: 2600 }, bus: 'game', send: 0.30, t: 0.500 });
    nz({ src: 'pink', dur: 1.4, attack: 0.50, gain: 0.09, crush: 'soft',
         filt: { type: 'bandpass', f: 900, q: 0.8 }, bus: 'game', send: 0.30, t: 0.560 });
    clik({ f: 2000, q: 6, gain: 0.05, bus: 'ui', t: 1.500 });

    endClash();
    stopHoldTone();
    duckBed(0.45, 600, 2000);
    if (drone) guard(function () {
      var t = ctx.currentTime;
      drone.lp.frequency.linearRampToValueAtTime(900, t + 2.0);
      drone.trem.gain.linearRampToValueAtTime(0.0001, t + 2.6);
    });
    if (bedNodes) global.setTimeout(function () { if (cfg.bed) { /* bed stays, just ducked */ } }, 0);
  };

  /* ==================================================================== *
   * 8 · MOTION — LAYER, POOLS, PRIMITIVES                                *
   * ==================================================================== */

  var mounted = false;
  var layer = null, styleNode = null, srNode = null;
  var root = null;
  var anchors = null;
  var opts = {};
  var ADDITIVE = true;
  var mqMotion = null, mqTransparency = null;
  var animSet = new Set();
  var animNonEssential = 0;
  var ANIM_CAP = 32;
  var warnedAnchors = {};

  var DEFAULT_ANCHORS = {
    wrap: '.wrap', board: '.board', layout: '.layout', stage: '.stage',
    phases: '#phases', prompt: '#prompt', controls: '.controls',
    turnchip: '#turnchip', table: '#table', setup: '#setup',
    uptimeYou: '#youUptime', uptimeFoe: '#foeUptime',
    bufferYou: '#youBuffer', bufferFoe: '#foeBuffer',
    handYou: '#youHand', handFoe: '#foeHand',
    networkYou: '#youNetwork', networkFoe: '#foeNetwork',
    countsYou: '#youCounts', countsFoe: '#foeCounts'
  };

  function detectAdditive() {
    ADDITIVE = true;
    try {
      var probe = doc.createElement('i');
      if (!probe.animate) { ADDITIVE = false; return; }
      var a = probe.animate([{ transform: 'translateY(0px)' }], { duration: 1, composite: 'add' });
      ADDITIVE = a.effect && a.effect.composite === 'add';
      a.cancel();
    } catch (e) { ADDITIVE = false; }
  }

  function motionActive() {
    if (cfg.motion === 'full') return 'full';
    if (cfg.motion === 'reduced') return 'reduced';
    return (mqMotion && mqMotion.matches) ? 'reduced' : 'full';
  }
  function reduced() { return motionActive() === 'reduced'; }
  function lowTransparency() { return !!(mqTransparency && mqTransparency.matches); }

  var CSS = [
    '#fx-layer{position:fixed;inset:0;pointer-events:none;z-index:30;contain:strict;overflow:hidden}',
    '#fx-layer .fx-n{position:absolute;pointer-events:none;contain:layout paint;display:none;',
    'box-sizing:border-box;border-radius:0}',
    '.fx-ring{border:2px solid currentColor}',
    '.fx-chip{font:900 11px/1 ui-monospace,"JetBrains Mono",monospace;letter-spacing:.08em;',
    'text-transform:uppercase;padding:2px 6px;background:#09080b;border:1px solid currentColor;',
    'color:inherit;white-space:nowrap}',
    '.fx-bar{background:currentColor;height:2px;transform-origin:left center}',
    '.fx-wipe{background:currentColor;height:2px;opacity:.55}',
    '.fx-glyph{width:8px;height:8px;background:currentColor}',
    '.fx-ghost{border:2px solid currentColor;background:rgba(9,8,11,.72)}',
    '.fx-clone{overflow:hidden}',
    '.fx-roll{overflow:hidden;background:#09080b;color:inherit;',
    'font:900 inherit/1 inherit;display:none}',
    '.fx-rollin{display:block}',
    '.fx-rollrow{display:block;text-align:center}',
    /* --- controls (own namespace, no host selectors touched) --- */
    '.fxbar{position:fixed;display:flex;align-items:center;gap:8px;padding:6px 8px;',
    'background:rgba(17,16,20,.92);border:1px solid rgba(185,145,228,.28);border-radius:0;',
    'color:#fff7ec;font:11px/1 ui-monospace,"JetBrains Mono",monospace;z-index:60}',
    '.fxbar button{width:34px;height:34px;display:grid;place-items:center;padding:0;cursor:pointer;',
    'background:transparent;border:1px solid rgba(185,145,228,.28);border-radius:0;color:#f7931a}',
    '.fxbar button[aria-pressed="true"]{color:#c7bbcc;border-color:rgba(199,187,204,.4)}',
    '.fxbar input[type=range]{-webkit-appearance:none;appearance:none;width:92px;height:2px;',
    'background:#7447b8;border:0;outline-offset:3px}',
    '.fxbar input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;',
    'background:#f7931a;border-radius:0;border:0;cursor:pointer}',
    '.fxbar input[type=range]::-moz-range-thumb{width:10px;height:10px;background:#f7931a;',
    'border-radius:0;border:0;cursor:pointer}',
    '.fxbar select{background:#111014;color:#fff7ec;border:1px solid rgba(185,145,228,.28);',
    'border-radius:0;padding:4px 6px;font:11px/1 ui-monospace,monospace}',
    '.fxbar .fxlab{font:900 10px/1 Anton600,Impact,sans-serif;letter-spacing:.14em;',
    'text-transform:uppercase;color:#b991e4}',
    '.fx-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;',
    'clip:rect(0 0 0 0);white-space:nowrap;border:0}'
  ].join('');

  /* --- pools ---------------------------------------------------------- */

  var POOL_SPEC = { ghost: 8, chip: 24, ring: 24, glyph: 16, clone: 4, bar: 8, wipe: 6, roll: 4 };
  var pools = {};

  function makePoolNode(kind) {
    var n = doc.createElement('div');
    n.className = 'fx-n fx-' + kind;
    if (kind === 'roll') {
      var inner = doc.createElement('span'); inner.className = 'fx-rollin';
      inner.appendChild(doc.createElement('span')).className = 'fx-rollrow';
      inner.appendChild(doc.createElement('span')).className = 'fx-rollrow';
      n.appendChild(inner);
    }
    layer.appendChild(n);
    return n;
  }

  function buildPools() {
    Object.keys(POOL_SPEC).forEach(function (k) {
      pools[k] = { free: [], live: 0, max: POOL_SPEC[k] * 2 };
      for (var i = 0; i < POOL_SPEC[k]; i++) pools[k].free.push(makePoolNode(k));
    });
  }

  function take(kind) {
    var p = pools[kind];
    if (!p) return null;
    var n = p.free.pop();
    if (!n) {
      if (p.live >= p.max) return null;
      n = makePoolNode(kind);
    }
    p.live++;
    n.style.display = 'block';
    return n;
  }

  function give(kind, n) {
    if (!n) return;
    var p = pools[kind];
    n.style.display = 'none';
    n.style.transform = '';
    n.style.opacity = '';
    n.style.willChange = '';
    if (kind === 'chip') n.textContent = '';
    if (p) { p.live = Math.max(0, p.live - 1); if (p.free.length < p.max) p.free.push(n); }
  }

  function place(n, rect, dx, dy, w, h) {
    n.style.left = (rect.left + (dx || 0)) + 'px';
    n.style.top = (rect.top + (dy || 0)) + 'px';
    if (w != null) n.style.width = w + 'px';
    if (h != null) n.style.height = h + 'px';
  }

  /* --- rect cache (one read pass per frame) --------------------------- */

  var rectCache = new Map();
  function rectOf(el) {
    if (!el) return null;
    if (rectCache.has(el)) return rectCache.get(el);
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
    if (!r) r = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    rectCache.set(el, r);
    return r;
  }

  /* --- animation driver ----------------------------------------------- */

  /* The cap is measured against NON-ESSENTIAL animations only. Past it, rings,
     wipes and the playhead apply their end state instantly (the same code path
     as reduced motion, so it is already tested), while CHIPs, decommission,
     burn and damage numerals — which carry information — still run. */
  function play(el, frames, o, essential) {
    if (!el || typeof el.animate !== 'function') return null;
    if (!essential && animNonEssential >= ANIM_CAP) { applyEnd(el, frames); return null; }
    return guard(function () {
      var conf = {
        duration: o.duration, easing: o.easing || EASE.snap,
        fill: o.fill || 'none', delay: o.delay || 0,
        iterations: o.iterations || 1, direction: o.direction || 'normal'
      };
      if (o.composite) conf.composite = o.composite;
      var a = el.animate(frames, conf);
      var hadWillChange = el.style.willChange;
      if (o.willChange !== false) el.style.willChange = 'transform';
      animSet.add(a);
      if (!essential) animNonEssential++;
      var done = function () {
        if (animSet.delete(a) && !essential) animNonEssential = Math.max(0, animNonEssential - 1);
        guard(function () { el.style.willChange = hadWillChange || ''; });
        if (o.onDone) guard(o.onDone);
      };
      a.addEventListener('finish', done);
      a.addEventListener('cancel', done);
      return a;
    }) || null;
  }

  /* When capped or reduced, land the end state instantly (same code path). */
  function applyEnd(el, frames) {
    guard(function () {
      var last = frames[frames.length - 1] || {};
      if (last.opacity != null) el.style.opacity = '';
      if (typeof el.animate === 'function') {
        el.animate([last], { duration: 1, easing: 'steps(1,end)', fill: 'none' });
      }
    });
  }

  function additiveFor(el) {
    return (ADDITIVE && el && el.classList && el.classList.contains('gcard')) ? 'add' : undefined;
  }

  /* --- P1 · STEP-IN ---------------------------------------------------- */
  function pStepIn(el) {
    if (!el) return;
    if (reduced()) { play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1, easing: 'steps(1,end)' }, true); return; }
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: D.sm, easing: EASE.line });
    play(el, [{ transform: 'translate3d(0,6px,0)' }, { transform: 'none' }],
      { duration: D.md, easing: EASE.snap, composite: additiveFor(el) });
  }

  /* --- P2 · HARD-CUT --------------------------------------------------- */
  function pHardCut(el, out) {
    if (!el) return;
    var f = out ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
    play(el, f, { duration: reduced() ? 1 : D.xs, easing: 'steps(2,end)' }, true);
  }

  /* --- P3 · SCANLINE WIPE ---------------------------------------------- *
   * A 2px bar travelling the height of the target. Transform-only.
   * (Travel is expressed in px because a percentage of a 2px bar cannot
   *  cross a 400px panel — the spec's 1400% is the same idea at bar scale.) */
  function pWipe(el, color, dur, alpha) {
    if (!el || reduced()) return;
    var r = rectOf(el);
    if (!r || !r.height) return;
    var n = take('wipe');
    if (!n) return;
    n.style.color = color || PALETTE.gold;
    n.style.opacity = lowTransparency() ? '1' : String(alpha == null ? 0.55 : alpha);
    if (lowTransparency()) n.style.height = '1px';
    place(n, r, 0, 0, r.width, lowTransparency() ? 1 : 2);
    var travel = r.height + 4;
    var a = play(n, [
      { transform: 'translate3d(0,-2px,0)', opacity: n.style.opacity },
      { transform: 'translate3d(0,' + travel + 'px,0)', opacity: n.style.opacity, offset: 0.88 },
      { transform: 'translate3d(0,' + travel + 'px,0)', opacity: 0 }
    ], { duration: dur || D.lg, easing: EASE.line, onDone: function () { give('wipe', n); } });
    if (!a) give('wipe', n);
  }

  /* --- P4 · JITTER ----------------------------------------------------- *
   * Exactly four quantized offsets. Never rotation, never scale. */
  function pJitter(el, amp) {
    if (!el) return;
    if (reduced()) {
      /* motion translated into colour */
      play(el, [{ borderColor: PALETTE.danger }, { borderColor: PALETTE.danger }],
        { duration: D.sm, easing: 'steps(1,end)' }, true);
      return;
    }
    var k = (amp == null ? 2 : amp) / 2;
    var pts = [[0, 0], [-2 * k, 1 * k], [2 * k, -1 * k], [0, 0]];
    var offs = [0, 0.25, 0.5, 1];
    var frames = pts.map(function (p, i) {
      return {
        transform: 'translate3d(' + p[0].toFixed(2) + 'px,' + p[1].toFixed(2) + 'px,0)',
        offset: offs[i], easing: 'steps(1,end)'
      };
    });
    play(el, frames, { duration: D.sm, easing: 'steps(1,end)', composite: additiveFor(el) });
  }

  /* --- P5 · RACK SLIDE -------------------------------------------------- */
  function pRackSlide(el, dx, out) {
    if (!el) return;
    if (reduced()) { pHardCut(el, !!out); return; }
    var d = dx == null ? -14 : dx;
    if (out) {
      play(el, [{ transform: 'none' }, { transform: 'translate3d(' + d + 'px,0,0)' }],
        { duration: D.md, easing: EASE.drop, fill: 'forwards', composite: additiveFor(el) });
      play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: D.md, easing: EASE.drop, fill: 'forwards' });
    } else {
      play(el, [{ transform: 'translate3d(' + d + 'px,0,0)' }, { transform: 'none' }],
        { duration: D.md, easing: EASE.mech, composite: additiveFor(el) });
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: EASE.line });
    }
  }

  /* --- P6 · COMMIT TURN ------------------------------------------------- *
   * Animates the transition INTO the host's persistent .committed state.
   * If the host class is already applied we play -8deg -> 0 additively,
   * which lands exactly on the host's rotate(8deg) with fill:'none'. */
  function pCommit(el) {
    if (!el || reduced()) return;
    var already = el.classList && el.classList.contains('committed');
    var frames = already
      ? [{ transform: 'rotate(-8deg)' }, { transform: 'rotate(0deg)' }]
      : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(8deg)' }];
    play(el, frames, { duration: D.md, easing: EASE.mech, fill: 'none', composite: additiveFor(el) });
  }

  /* --- P7 · COUNTER ROLL ------------------------------------------------ */
  var lastText = new Map();
  function pRoll(el, key) {
    if (!el) return;
    var now = (el.textContent || '').trim();
    var prev = lastText.has(key) ? lastText.get(key) : now;
    lastText.set(key, now);
    if (reduced()) return;
    var r = rectOf(el);
    if (!r || !r.width) return;
    var n = take('roll');
    if (!n) return;
    var rows = n.firstChild.childNodes;
    rows[0].textContent = prev;
    rows[1].textContent = now;
    n.style.color = getComputedish(el);
    n.style.font = '900 ' + Math.max(11, Math.round(r.height * 0.8)) + 'px/1 ui-monospace, monospace';
    place(n, r, 0, 0, Math.max(r.width, 14), r.height);
    n.firstChild.style.transform = 'translate3d(0,0,0)';
    var a = play(n.firstChild, [
      { transform: 'translate3d(0,0,0)' },
      { transform: 'translate3d(0,-' + r.height + 'px,0)' }
    ], { duration: D.xs, easing: 'steps(1,end)', onDone: function () { give('roll', n); } });
    if (!a) give('roll', n);
  }
  function getComputedish(el) {
    var c = '';
    guard(function () { c = global.getComputedStyle ? global.getComputedStyle(el).color : ''; });
    return c || PALETTE.orange;
  }

  /* --- P8 · BAR DRAIN --------------------------------------------------- */
  function pDrain(el, gain) {
    if (!el || reduced()) return;
    var r = rectOf(el);
    if (!r || !r.width) return;
    var n = take('bar');
    if (!n) return;
    n.style.color = gain ? PALETTE.good : PALETTE.danger;
    place(n, r, 0, r.height, r.width, 2);
    var frames = gain
      ? [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.75 }, { transform: 'scaleX(1)', opacity: 0 }]
      : [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(0)', opacity: 1, offset: 0.75 }, { transform: 'scaleX(0)', opacity: 0 }];
    var a = play(n, frames, {
      duration: D.lg, easing: gain ? EASE.snap : EASE.drop,
      onDone: function () { give('bar', n); }
    });
    if (!a) give('bar', n);
  }

  /* --- P9 · RING -------------------------------------------------------- *
   * Sibling node — never an override of the host's @keyframes pulse. */
  function pRing(el, color, dur, delay) {
    if (!el) return null;
    var r = rectOf(el);
    if (!r || !r.width) return null;
    var n = take('ring');
    if (!n) return null;
    n.style.color = color || PALETTE.orange;
    place(n, r, -2, -2, r.width + 4, r.height + 4);
    if (reduced()) {
      n.style.borderWidth = '1px';
      n.style.opacity = '1';
      global.setTimeout(function () { give('ring', n); }, 600);
      return n;
    }
    n.style.borderWidth = '2px';
    var a = play(n, [
      { transform: 'scale(1)', opacity: 0.8 },
      { transform: 'scale(1.06)', opacity: 0 }
    ], { duration: dur || D.xl, easing: EASE.snap, delay: delay || 0, onDone: function () { give('ring', n); } });
    if (!a) give('ring', n);
    return n;
  }

  var loopRings = [];
  function pRingLoop(el, color, delay) {
    if (!el) return;
    var r = rectOf(el);
    if (!r || !r.width) return;
    var n = take('ring');
    if (!n) return;
    n.style.color = color || PALETTE.good;
    place(n, r, -2, -2, r.width + 4, r.height + 4);
    if (reduced()) {
      n.style.borderWidth = '1px'; n.style.opacity = '1';
      loopRings.push({ n: n, a: null });
      return;
    }
    n.style.borderWidth = '2px';
    var a = play(n, [{ opacity: 0.35 }, { opacity: 0.9 }], {
      duration: D.xxl, easing: 'steps(2,end)', iterations: Infinity,
      direction: 'alternate', delay: delay || 0, willChange: false
    }, true);
    loopRings.push({ n: n, a: a });
  }
  function clearLoopRings() {
    loopRings.forEach(function (o) {
      guard(function () { if (o.a) o.a.cancel(); });
      give('ring', o.n);
    });
    loopRings.length = 0;
  }

  /* --- P10 · GLYPH RAIN -------------------------------------------------- */
  function pGlyphRain(rect, color, count) {
    if (!rect || reduced()) return;
    var n = Math.min(count || 1, 8);
    var made = [];
    for (var i = 0; i < n; i++) {
      var g = take('glyph');
      if (!g) break;
      g.style.color = color || PALETTE.danger;
      var dx = (rect.width > 16 ? Math.random() * (rect.width - 8) : 0);
      place(g, rect, dx, rect.height * 0.2, 8, 8);
      made.push(g);
    }
    made.forEach(function (g, i) {
      var a = play(g, [
        { transform: 'translate3d(0,0,0)', opacity: 1 },
        { transform: 'translate3d(0,34px,0)', opacity: 0 }
      ], { duration: D.lg, easing: EASE.drop, delay: i * STAG.burn, onDone: function () { give('glyph', g); } });
      if (!a) give('glyph', g);
    });
  }

  /* --- CHIP (information, not decoration — survives reduced motion) ------ */
  function pChip(text, color, rect, rise, dur) {
    if (!rect) return;
    var n = take('chip');
    if (!n) return;
    n.textContent = String(text == null ? '' : text);
    n.style.color = color || PALETTE.gold;
    n.style.width = ''; n.style.height = '';
    n.style.left = (rect.left + rect.width / 2) + 'px';
    n.style.top = (rect.top - 4) + 'px';
    var total = dur || D.xl;
    var frames;
    if (reduced()) {
      n.style.transform = 'translate(-50%,0)';
      frames = [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }];
      total = 1200;
    } else {
      frames = [
        { transform: 'translate(-50%,0)', opacity: 0 },
        { transform: 'translate(-50%,-' + ((rise || 20) * 0.25).toFixed(1) + 'px)', opacity: 1, offset: 0.12 },
        { transform: 'translate(-50%,-' + ((rise || 20) * 0.65).toFixed(1) + 'px)', opacity: 1, offset: 0.65 },
        { transform: 'translate(-50%,-' + (rise || 20) + 'px)', opacity: 0 }
      ];
    }
    var a = play(n, frames, {
      duration: total, easing: reduced() ? EASE.line : EASE.snap,
      onDone: function () { give('chip', n); }
    }, true);
    if (!a) give('chip', n);
  }

  /* --- GHOST flight (draw) ---------------------------------------------- */
  function pGhost(fromRect, toRect, color) {
    if (!fromRect || !toRect || reduced()) return;
    var n = take('ghost');
    if (!n) return;
    n.style.color = color || PALETTE.orange;
    var w = Math.max(12, toRect.width || 40), h = Math.max(16, toRect.height || 56);
    n.style.left = '0px'; n.style.top = '0px';
    n.style.width = w + 'px'; n.style.height = h + 'px';
    var x0 = fromRect.left + fromRect.width / 2 - w / 2;
    var y0 = fromRect.top + fromRect.height / 2 - h / 2;
    var a = play(n, [
      { transform: 'translate3d(' + x0 + 'px,' + y0 + 'px,0) scale(.86)', opacity: 0 },
      { transform: 'translate3d(' + ((x0 + toRect.left) / 2) + 'px,' + ((y0 + toRect.top) / 2) + 'px,0) scale(.95)', opacity: 1, offset: 0.5 },
      { transform: 'translate3d(' + toRect.left + 'px,' + toRect.top + 'px,0) scale(1)', opacity: 0 }
    ], { duration: D.lg, easing: EASE.snap, onDone: function () { give('ghost', n); } });
    if (!a) give('ghost', n);
  }

  /* --- CLONE exit (archive / decommission) ------------------------------ *
   * Exit animations MUST run on clones: the host wipes innerHTML on every
   * render, which would kill an animation on the live node. */
  function cloneOf(el) {
    if (!el || reduced()) return null;
    var r = rectOf(el);
    if (!r || !r.width) return null;
    var p = pools.clone;
    if (p.live >= p.max) return null;
    var c = null;
    guard(function () { c = el.cloneNode(true); });
    if (!c) return null;
    c.className = (c.className || '') + ' fx-n fx-clone';
    c.style.position = 'absolute';
    c.style.display = 'block';
    c.style.pointerEvents = 'none';
    c.style.margin = '0';
    c.style.left = r.left + 'px';
    c.style.top = r.top + 'px';
    c.style.width = r.width + 'px';
    c.style.height = r.height + 'px';
    c.style.transform = 'none';
    layer.appendChild(c);
    p.live++;
    return c;
  }
  function dropClone(c) {
    if (!c) return;
    pools.clone.live = Math.max(0, pools.clone.live - 1);
    guard(function () { if (c.parentNode) c.parentNode.removeChild(c); });
  }

  /* ==================================================================== *
   * 9 · ELEMENT RESOLUTION                                               *
   * ==================================================================== */

  function q(key) {
    if (!anchors || !anchors[key]) return null;
    var el = null;
    guard(function () { el = (root || doc).querySelector(anchors[key]); });
    if (!el && DEBUG && !warnedAnchors[key]) { warnedAnchors[key] = 1; warn('anchor not found: ' + key); }
    return el;
  }

  function normSeat(seat) {
    if (seat === 'you') return activeSeat;
    if (seat === 'foe') return 1 - activeSeat;
    if (seat === 1) return 1;
    return 0;
  }
  function sideKey(base, seat) {
    return base + (normSeat(seat) === activeSeat ? 'You' : 'Foe');
  }
  function seatEl(base, seat) {
    if (typeof opts.seatOf === 'function') {
      var e = null; guard(function () { e = opts.seatOf(normSeat(seat)); });
      if (e) return e;
    }
    return q(sideKey(base, seat));
  }
  function cardByUid(uid) {
    if (uid == null) return null;
    if (typeof opts.cardOf === 'function') {
      var e = null; guard(function () { e = opts.cardOf(uid); });
      if (e) return e;
    }
    if (!opts.uidAttr) return null;
    var el = null;
    guard(function () { el = (root || doc).querySelector('[' + opts.uidAttr + '="' + String(uid).replace(/"/g, '') + '"]'); });
    return el;
  }
  /* Resolution order: detail.el > cardOf(uid) > seat container > skip motion. */
  function targetEl(d, seatBase) {
    if (d && d.el && d.el.nodeType === 1) return d.el;
    var byUid = cardByUid(d && d.uid);
    if (byUid) return byUid;
    if (seatBase) return seatEl(seatBase, d && d.seat);
    return null;
  }
  function sideBlockOf(seat) {
    var net = seatEl('network', seat);
    return net && net.closest ? (net.closest('.side') || net) : net;
  }

  /* ==================================================================== *
   * 10 · MOTION BOOK                                                     *
   * ==================================================================== */

  var MOTION = {};

  MOTION['game:start'] = function () {
    pWipe(q('stage'), PALETTE.gold, D.xxl, 0.55);
    var table = q('table'); if (table) pHardCut(table, false);
    var setup = q('setup');
    if (setup) play(setup, [{ opacity: 1 }, { opacity: 0 }], { duration: D.sm, easing: EASE.line });
    var phases = q('phases');
    if (phases) {
      var chips = phases.children || [];
      for (var i = 0; i < chips.length; i++) {
        (function (c, idx) { global.setTimeout(function () { pStepIn(c); }, idx * 40); })(chips[i], i);
      }
    }
  };

  MOTION['turn:begin'] = function (d) {
    var side = sideBlockOf(d.seat);
    if (side) pRing(side, PALETTE.orange, D.xl);
    var tc = q('turnchip');
    if (tc) { pJitter(tc, 2); pRoll(tc, 'turnchip'); }
  };

  MOTION['phase:enter'] = function (d) {
    var phases = q('phases');
    if (!phases) return;
    var active = phases.querySelector ? phases.querySelector('.phase.active') : null;
    if (!active) return;
    var r = rectOf(active);
    /* inner FX bar — the chip's own box never moves, so zero layout */
    var n = take('bar');
    if (n) {
      n.style.color = PALETTE.gold;
      place(n, r, 0, r.height - 2, r.width, 2);
      var a = play(n, [
        { transform: 'scaleX(0)', opacity: 1 },
        { transform: 'scaleX(1)', opacity: 1, offset: 0.8 },
        { transform: 'scaleX(1)', opacity: 0 }
      ], { duration: D.md, easing: EASE.mech, onDone: function () { give('bar', n); } });
      if (!a) give('bar', n);
    }
    /* FLIP playhead */
    movePlayhead(r);
  };

  var playheadRect = null;
  function movePlayhead(r) {
    if (!r || !r.width || reduced()) return;
    var n = take('bar');
    if (!n) return;
    n.style.color = PALETTE.ember;
    place(n, r, 0, r.height, r.width, 2);
    var frames;
    if (playheadRect && playheadRect.width) {
      var dx = playheadRect.left - r.left;
      var sx = playheadRect.width / (r.width || 1);
      frames = [
        { transform: 'translateX(' + dx + 'px) scaleX(' + sx.toFixed(3) + ')', opacity: 1 },
        { transform: 'none', opacity: 1, offset: 0.85 },
        { transform: 'none', opacity: 0 }
      ];
    } else {
      frames = [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'none', opacity: 1, offset: 0.85 }, { transform: 'none', opacity: 0 }];
    }
    playheadRect = r;
    var a = play(n, frames, { duration: D.lg, easing: EASE.mech, onDone: function () { give('bar', n); } });
    if (!a) give('bar', n);
  }

  MOTION['priority:pass'] = function () {
    var c = q('controls');
    if (!c) return;
    play(c, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }],
      { duration: reduced() ? 1 : D.xs, easing: 'steps(2,end)' });
  };

  MOTION['card:draw'] = function (d) {
    var hand = seatEl('hand', d.seat);
    var counts = seatEl('counts', d.seat);
    var n = Math.min(5, Math.max(1, d.count || 1));
    var cards = [];
    if (d.el && d.el.nodeType === 1) cards = [d.el];
    else if (hand && hand.children) {
      var kids = hand.children;
      for (var i = Math.max(0, kids.length - n); i < kids.length; i++) cards.push(kids[i]);
    }
    var fromRect = counts ? rectOf(counts) : (hand ? rectOf(hand) : null);
    cards.forEach(function (card, i) {
      var toRect = rectOf(card);
      global.setTimeout(function () {
        pGhost(fromRect, toRect, PALETTE.orange);
        global.setTimeout(function () { pWipe(card, PALETTE.gold, D.lg, 0.55); pStepIn(card); }, reduced() ? 0 : D.lg);
      }, i * STAG.draw);
    });
    if (!cards.length && hand) pStepIn(hand);
    var side = sideBlockOf(d.seat);
    var zl = side && side.querySelector ? side.querySelector('.zlabel') : null;
    if (zl) pJitter(zl, 2);
  };

  MOTION['card:play'] = function (d) {
    var type = typeOf(d.cardType);
    var aff = affOf(Array.isArray(d.affinity) ? d.affinity[0] : d.affinity);
    var color = AFF_COLOR[aff] || AFF_COLOR.N;
    var el = targetEl(d, 'network');
    if (!el) return;
    var dest = rectOf(el);

    if (type === 'Zap') {
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 1 : D.md, easing: EASE.snap });
      pHardCut(el, false);
      pRing(el, PALETTE.cream, D.md);
      return;
    }

    var origin = d.rect || (d.from && d.from.nodeType === 1 ? rectOf(d.from) : d.from);
    if (origin && origin.width && !reduced()) {
      /* FLIP: invert to the origin, play to identity */
      var dx = origin.left - dest.left, dy = origin.top - dest.top;
      play(el, [
        { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0)' },
        { transform: 'none' }
      ], { duration: D.lg, easing: EASE.snap, composite: additiveFor(el) });
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: D.sm, easing: EASE.line });
    } else {
      /* documented, graceful degradation */
      pStepIn(el);
    }

    if (type === 'Hardware') {
      pRing(el, color, D.xl);
      pRing(el, color, D.xl, STAG.clash);
    } else if (type === 'Protocol') {
      pRing(el, color, D.xxl);
    } else {
      pRing(el, color, D.xl);
    }
    if (type === 'Avatar' && !reduced()) {
      play(el, [{ transform: 'translate3d(0,2px,0)' }, { transform: 'none' }],
        { duration: D.sm, easing: EASE.snap, delay: D.lg, composite: additiveFor(el) });
    }
  };

  MOTION['card:archive'] = function (d) {
    var el = targetEl(d, null);
    if (!el) return;
    var c = cloneOf(el);
    if (!c) return;
    /* filed sideways, not down */
    var a = play(c, [
      { transform: 'none', opacity: 1 },
      { transform: 'translate3d(14px,0,0)', opacity: 0 }
    ], { duration: D.md, easing: EASE.drop, onDone: function () { dropClone(c); } }, true);
    if (!a) dropClone(c);
  };

  MOTION['resource:play'] = function (d) {
    var aff = affOf(d.affinity);
    var color = AFF_COLOR[aff] || AFF_COLOR.N;
    var el = d.el && d.el.nodeType === 1 ? d.el : null;
    if (el) pRing(el, color, D.xl);
    var strip = seatEl('buffer', d.seat);
    if (!strip) return;
    var last = strip.lastElementChild;
    if (last) pStepIn(last);
    var r = rectOf(strip);
    if (!r.width || reduced()) return;
    var n = take('bar');
    if (!n) return;
    n.style.color = color;
    place(n, r, 0, r.height, Math.max(20, r.width), 2);
    var a = play(n, [
      { transform: 'scaleX(0)', opacity: 1 },
      { transform: 'scaleX(1)', opacity: 1, offset: 0.6 },
      { transform: 'scaleX(1)', opacity: 0 }
    ], { duration: D.lg, easing: EASE.snap, onDone: function () { give('bar', n); } });
    if (!a) give('bar', n);
  };

  MOTION['resource:generate'] = function (d) {
    var strip = seatEl('buffer', d.seat);
    if (!strip || !strip.children) return;
    var n = Math.min(6, Math.max(1, d.amount | 0 || 1));
    var kids = strip.children;
    for (var i = Math.max(0, kids.length - n), k = 0; i < kids.length; i++, k++) {
      (function (pip, idx) {
        global.setTimeout(function () { pStepIn(pip); }, idx * STAG.generate);
      })(kids[i], k);
    }
  };

  MOTION['buffer:burn'] = function (d) {
    var amount = Math.max(1, d.amount | 0 || 1);
    var strip = seatEl('buffer', d.seat);
    var upt = seatEl('uptime', d.seat);
    var stripRect = strip ? rectOf(strip) : null;
    var uptRect = upt ? rectOf(upt) : null;

    if (strip) pJitter(strip, 2);
    if (stripRect) pGlyphRain(stripRect, PALETTE.danger, Math.min(amount, 8));

    /* pips disintegrate in steps, in reverse order, each in its OWN affinity
       colour — that keeps it reading as WASTE, not damage. */
    if (strip && strip.children && !reduced()) {
      var kids = [];
      for (var i = 0; i < strip.children.length; i++) kids.push(strip.children[i]);
      kids.reverse().forEach(function (pip, idx) {
        play(pip, [{ opacity: 1 }, { opacity: 0 }],
          { duration: D.lg, easing: 'steps(3,end)', delay: idx * STAG.burn });
      });
    }

    global.setTimeout(function () {
      if (upt) {
        pRoll(upt, sideKey('uptime', d.seat));
        play(upt, [{ borderColor: PALETTE.danger }, { borderColor: PALETTE.danger }],
          { duration: D.xl, easing: 'steps(2,end)' });
      }
      if (uptRect) pChip('BURN −' + amount + ' UPTIME', PALETTE.danger, uptRect, 26, D.xxl);
    }, D.md);

    global.setTimeout(function () { if (upt) pDrain(upt, false); }, 300);
  };

  MOTION['buffer:set'] = function () { /* drone only — no visual */ };

  MOTION['ability:activate'] = function (d) {
    var el = targetEl(d, 'network');
    if (!el) return;
    pRing(el, PALETTE.gold, D.lg);
    pJitter(el, 1.2);
  };

  MOTION['target:request'] = function () {
    clearLoopRings();
    var list = [];
    guard(function () {
      var nl = (root || doc).querySelectorAll('.gcard.targetable');
      for (var i = 0; i < nl.length; i++) list.push(nl[i]);
    });
    list.slice(0, 16).forEach(function (el, i) { pRingLoop(el, PALETTE.good, i * 90); });
    var p = q('prompt');
    if (p && !reduced()) {
      play(p, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: D.md, easing: EASE.snap });
    }
  };

  MOTION['target:choose'] = function (d) {
    clearLoopRings();
    var el = d && d.el && d.el.nodeType === 1 ? d.el : null;
    if (el) pRing(el, PALETTE.good, D.lg);
  };

  MOTION['clash:begin'] = function () {
    pWipe(q('layout'), PALETTE.ember, D.xl, 0.35);
    var you = sideBlockOf(activeSeat), foe = sideBlockOf(1 - activeSeat);
    if (you) pRackSlide(you, -14, false);
    if (foe) pRackSlide(foe, 14, false);
    /* No screen shake — shake is reserved for damage. */
  };

  MOTION['clash:declareAttackers'] = function (d) {
    var count = Math.max(0, d.count | 0);
    var list = [];
    guard(function () {
      var nl = (root || doc).querySelectorAll('.gcard.attacking');
      for (var i = 0; i < nl.length; i++) list.push(nl[i]);
    });
    list.slice(0, 8).forEach(function (el, i) {
      global.setTimeout(function () { pCommit(el); pRing(el, PALETTE.danger, D.xl); }, i * STAG.clash);
    });
    var foe = sideBlockOf(1 - activeSeat);
    if (foe) global.setTimeout(function () { pJitter(foe, 2); }, 300);
    var board = q('board');
    if (board) {
      var r = rectOf(board);
      pChip(count + ' ATTACKING', PALETTE.danger, { left: r.left, top: r.top, width: r.width, height: 0 }, 14, D.xl);
    }
  };

  MOTION['clash:declareBlockers'] = function (d) {
    var count = Math.max(0, d.count | 0);
    var board = q('board');
    if (count === 0) {
      if (board) {
        var r0 = rectOf(board);
        pChip('UNBLOCKED', PALETTE.gold, { left: r0.left, top: r0.top, width: r0.width, height: 0 }, 18, D.xl);
      }
      return;
    }
    var list = [];
    guard(function () {
      var nl = (root || doc).querySelectorAll('.gcard.blocking');
      for (var i = 0; i < nl.length; i++) list.push(nl[i]);
    });
    list.slice(0, 8).forEach(function (el, i) {
      global.setTimeout(function () {
        /* a step forward, no rotation — blocking does not commit */
        if (!reduced()) {
          play(el, [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,-5px,0)' }],
            { duration: D.sm, easing: EASE.snap, composite: additiveFor(el) });
          play(el, [{ transform: 'translate3d(0,-5px,0)' }, { transform: 'translate3d(0,0,0)' }],
            { duration: D.md, easing: EASE.mech, delay: D.sm, composite: additiveFor(el) });
        }
        pRing(el, PALETTE.violet, D.xl);
      }, i * STAG.clash);
    });
  };

  MOTION['damage:player'] = function (d) {
    var a = Math.max(0, d.amount | 0);
    var wrap = q('wrap');
    if (wrap) pJitter(wrap, Math.min(7, 1 + Math.min(a, 6)));
    var upt = seatEl('uptime', d.seat);
    var uptRect = upt ? rectOf(upt) : null;
    global.setTimeout(function () { if (upt) pRoll(upt, sideKey('uptime', d.seat)); }, D.sm);
    global.setTimeout(function () { if (upt) pDrain(upt, false); }, D.md);
    if (uptRect) pChip('−' + a, PALETTE.danger, uptRect, 24, D.xl);
  };

  /* Batched per scheduler frame: max 5 JITTERs, but CHIPs are NEVER batched. */
  MOTION['damage:avatar'] = function (list) {
    var arr = Array.isArray(list) ? list : [list];
    arr.forEach(function (d, i) {
      var el = targetEl(d, null);
      if (!el) return;
      if (i < 5) pJitter(el, 1.2);
      var stats = el.querySelector ? el.querySelector('.gstats') : null;
      if (stats) pHardCut(stats, false);
      pChip('−' + Math.max(0, d.amount | 0), PALETTE.danger, rectOf(el), 20, D.lg);
    });
  };

  MOTION['avatar:decommission'] = function (d) {
    var el = targetEl(d, null);
    if (!el) return;
    var c = cloneOf(el);
    if (!c) return;
    /* five quantized bands — a CRT losing sync, not a smooth fade */
    var a = play(c, [{ opacity: 1 }, { opacity: 0 }],
      { duration: D.xl, easing: 'steps(5,end)', onDone: function () { dropClone(c); } }, true);
    play(c, [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,8px,0)' }],
      { duration: D.xl, easing: EASE.drop });
    if (!a) dropClone(c);
  };

  MOTION['uptime:gain'] = function (d) {
    var a = Math.max(1, d.amount | 0 || 1);
    var upt = seatEl('uptime', d.seat);
    if (!upt) return;
    var r = rectOf(upt);
    pRing(upt, PALETTE.good, D.xl);
    pRoll(upt, sideKey('uptime', d.seat));
    pDrain(upt, true);
    pChip('+' + a, PALETTE.good, r, 26, D.xl);
    if (reduced()) return;
    var n = Math.min(a, 4);
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var g = take('glyph');
        if (!g) return;
        g.style.color = PALETTE.good;
        place(g, r, 6 + idx * 10, r.height * 0.4, 8, 8);
        var an = play(g, [
          { transform: 'translate3d(0,0,0)', opacity: 1 },
          { transform: 'translate3d(0,-22px,0)', opacity: 0 }
        ], { duration: D.xl, easing: EASE.snap, delay: idx * STAG.uptime, onDone: function () { give('glyph', g); } });
        if (!an) give('glyph', g);
      })(i);
    }
  };

  MOTION['manual:resolve'] = function (d) {
    /* a human decided; the Network stayed still. No jitter, no card motion. */
    var p = q('prompt');
    if (p) {
      pRackSlide(p, -14, false);
      pWipe(p, PALETTE.gold, D.lg, 0.55);
      pChip(String(d.note == null ? 'RESOLVED' : d.note).slice(0, 24), PALETTE.gold, rectOf(p), 14, D.xxl);
    }
  };

  MOTION['game:win'] = function (d) {
    var side = sideBlockOf(d.seat);
    if (side) pWipe(side, PALETTE.gold, D.xxl, 0.55);
    var host = q('wrap') || doc.body;
    if (!host) return;
    var r = rectOf(host);
    var n = take('ghost');
    if (!n) return;
    n.style.color = PALETTE.gold;
    n.style.left = '0'; n.style.top = '0';
    n.style.width = '100%'; n.style.height = '100%';
    n.style.background = lowTransparency() ? PALETTE.black : 'rgba(9,8,11,.86)';
    var a = play(n, [
      { opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }
    ], { duration: 2400, easing: EASE.snap, onDone: function () { n.style.background = ''; give('ghost', n); } }, true);
    if (!a) { n.style.background = ''; give('ghost', n); }
    /* the terminal prints the result and holds it — no confetti, no particles */
    pChip('NETWORK HOLDS', PALETTE.gold, { left: r.left, top: r.top + r.height * 0.4, width: r.width, height: 0 }, 0, 1400);
  };

  /* ==================================================================== *
   * 11 · SCHEDULER (one rAF · one read pass · one write pass)            *
   * ==================================================================== */

  var queue = [];
  var rafId = 0;
  var lastFire = {};
  var lastDedupe = { key: '', t: 0 };
  var THROTTLE = { 'priority:pass': 60, 'phase:enter': 90, 'card:draw': 45 };
  var clashPhaseTimer = 0;
  var lastClashBegin = 0;

  var raf = (global.requestAnimationFrame || function (fn) { return global.setTimeout(function () { fn(Date.now()); }, 16); }).bind(global);

  function enqueue(name, detail, audible) {
    queue.push({ name: name, detail: detail || {}, audible: audible });
    if (!rafId) rafId = raf(flush);
  }

  /* Elements each event wants measured — gathered BEFORE any write. */
  function needsOf(ev) {
    var d = ev.detail, out = [];
    function push(e) { if (e) out.push(e); }
    switch (ev.name) {
      case 'game:start': push(q('stage')); push(q('phases')); break;
      case 'turn:begin': push(sideBlockOf(d.seat)); push(q('turnchip')); break;
      case 'phase:enter':
        var ph = q('phases');
        push(ph && ph.querySelector ? ph.querySelector('.phase.active') : null); break;
      case 'card:draw': push(seatEl('hand', d.seat)); push(seatEl('counts', d.seat)); push(d.el); break;
      case 'card:play': push(targetEl(d, 'network')); push(d.from); break;
      case 'card:archive': push(targetEl(d, null)); break;
      case 'resource:play': push(seatEl('buffer', d.seat)); push(d.el); break;
      case 'resource:generate': push(seatEl('buffer', d.seat)); break;
      case 'buffer:burn': push(seatEl('buffer', d.seat)); push(seatEl('uptime', d.seat)); break;
      case 'ability:activate': push(targetEl(d, 'network')); break;
      case 'target:request': push(q('prompt')); break;
      case 'target:choose': push(d.el); break;
      case 'clash:begin': push(q('layout')); push(sideBlockOf(0)); push(sideBlockOf(1)); break;
      case 'clash:declareAttackers': push(q('board')); break;
      case 'clash:declareBlockers': push(q('board')); break;
      case 'damage:player': push(q('wrap')); push(seatEl('uptime', d.seat)); break;
      case 'damage:avatar': push(targetEl(d, null)); break;
      case 'avatar:decommission': push(targetEl(d, null)); break;
      case 'uptime:gain': push(seatEl('uptime', d.seat)); break;
      case 'manual:resolve': push(q('prompt')); break;
      case 'game:win': push(sideBlockOf(d.seat)); push(q('wrap')); break;
    }
    return out;
  }

  function flush() {
    rafId = 0;
    var batch = queue; queue = [];
    if (!batch.length) return;

    /* ---- READ PASS: every getBoundingClientRect, once, up front ------- */
    rectCache = new Map();
    guard(function () {
      var extras = [];
      batch.forEach(function (ev) { needsOf(ev).forEach(function (e) { extras.push(e); }); });
      /* cards touched by class-driven handlers */
      if (batch.some(function (e) { return e.name === 'clash:declareAttackers'; })) {
        collectAll('.gcard.attacking', extras);
      }
      if (batch.some(function (e) { return e.name === 'clash:declareBlockers'; })) {
        collectAll('.gcard.blocking', extras);
      }
      if (batch.some(function (e) { return e.name === 'target:request'; })) {
        collectAll('.gcard.targetable', extras);
      }
      extras.forEach(function (e) { if (e && e.nodeType === 1) rectOf(e); });
    });

    /* ---- WRITE PASS --------------------------------------------------- */
    var avatarHits = [];
    batch.forEach(function (ev) {
      if (ev.name === 'damage:avatar') { avatarHits.push(ev); return; }
      runOne(ev);
    });
    if (avatarHits.length) {
      var details = avatarHits.map(function (e) { return e.detail; });
      if (avatarHits.some(function (e) { return e.audible; })) guard(function () { SFX['damage:avatar'](details); });
      guard(function () { MOTION['damage:avatar'](details); });
    }
  }

  function collectAll(sel, out) {
    guard(function () {
      var nl = (root || doc).querySelectorAll(sel);
      for (var i = 0; i < nl.length; i++) out.push(nl[i]);
    });
  }

  /* The pressure drone needs the absolute Buffer level for activeSeat.
     buffer:set is authoritative; generate/burn deltas are the fallback when the
     host never emits it (it will then over-report after a spend and self-correct
     on the next burn — documented, graceful). */
  function trackBuffer(name, d) {
    if (d.seat != null && normSeat(d.seat) !== activeSeat) return;
    if (name === 'buffer:set') setBuffer(d.total | 0);
    else if (name === 'resource:generate') setBuffer(bufferTotal + Math.max(1, d.amount | 0 || 1));
    else if (name === 'buffer:burn') setBuffer(0);
  }

  function runOne(ev) {
    var name = ev.name, d = ev.detail;

    /* stateful side effects that must happen regardless of audio */
    if (name === 'turn:begin') { activeSeat = normSeat(d.seat); playheadRect = null; }
    trackBuffer(name, d);
    if (name === 'phase:enter' && d.phase === 'build2') endClash();
    if (name === 'clash:begin') lastClashBegin = Date.now();
    if (name === 'game:win') { /* handled in SFX */ }

    if (ev.audible && ready && SFX[name]) guard(function () { SFX[name](d); });
    if (MOTION[name]) guard(function () { MOTION[name](d); });
  }

  function throttled(name, detail) {
    var now = Date.now();
    var min = THROTTLE[name] || 0;
    if (min) {
      var last = lastFire[name] || 0;
      if (now - last < min) return true;
      lastFire[name] = now;
    }
    /* identical (name, detail) deduped at 30 ms */
    var key = '';
    guard(function () { key = name + '|' + JSON.stringify(detail, replacerNoEl); });
    if (key && key === lastDedupe.key && now - lastDedupe.t < 30) return true;
    lastDedupe.key = key; lastDedupe.t = now;
    return false;
  }
  function replacerNoEl(k, v) {
    if (k === 'el' || k === 'from' || k === 'to' || k === 'rect') return undefined;
    return v;
  }

  /* ==================================================================== *
   * 12 · PUBLIC EMIT                                                     *
   * ==================================================================== */

  function emit(name, detail) {
    return guard(function () {
      if (!name || EVENTS.indexOf(name) < 0) return;
      if (!mounted) API.mount({ control: false });
      var d = detail || {};

      /* clash phase cue is suppressed if clash:begin lands within 200 ms */
      if (name === 'phase:enter' && d.phase === 'clash') {
        if (clashPhaseTimer) global.clearTimeout(clashPhaseTimer);
        var dd = d;
        var audibleNow = !throttled(name, dd);
        enqueue(name, dd, false);
        if (audibleNow) {
          clashPhaseTimer = global.setTimeout(function () {
            clashPhaseTimer = 0;
            if (Date.now() - lastClashBegin > 200 && ready) guard(function () { SFX['phase:enter'](dd); });
          }, 200);
        }
        return;
      }

      /* Throttled events still fire their motion — only audio is gated. */
      var audible = !throttled(name, d);
      enqueue(name, d, audible);
    });
  }

  function emitAll(pairs) {
    guard(function () {
      if (!Array.isArray(pairs)) return;
      pairs.forEach(function (p) { emit(p[0], p[1]); });
    });
  }

  /* ==================================================================== *
   * 13 · CONTROLS                                                        *
   * ==================================================================== */

  var controlEl = null, muteBtn = null, volInput = null, motionSel = null;

  function svgMeter(muted) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = doc.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '16'); s.setAttribute('height', '16');
    s.setAttribute('aria-hidden', 'true');
    var bars = muted ? [[7, 4, 2, 8]] : [[2, 9, 2, 5], [7, 5, 2, 9], [12, 2, 2, 12]];
    bars.forEach(function (b) {
      var r = doc.createElementNS(ns, 'rect');
      r.setAttribute('x', b[0]); r.setAttribute('y', b[1]);
      r.setAttribute('width', b[2]); r.setAttribute('height', b[3]);
      r.setAttribute('fill', 'currentColor');
      s.appendChild(r);
    });
    if (muted) {
      var l = doc.createElementNS(ns, 'rect');
      l.setAttribute('x', '1'); l.setAttribute('y', '7'); l.setAttribute('width', '14'); l.setAttribute('height', '2');
      l.setAttribute('fill', 'currentColor');
      s.appendChild(l);
    }
    return s;
  }

  function refreshControls() {
    if (!controlEl) return;
    if (muteBtn) {
      muteBtn.setAttribute('aria-pressed', cfg.muted ? 'true' : 'false');
      muteBtn.setAttribute('aria-label', cfg.muted ? 'Sound off' : 'Sound on');
      muteBtn.textContent = '';
      muteBtn.appendChild(svgMeter(cfg.muted));
    }
    if (volInput) volInput.value = String(Math.round(cfg.volume * 100));
    if (motionSel) motionSel.value = cfg.motion;
  }

  function announce(msg) {
    if (!srNode) return;
    srNode.textContent = '';
    global.setTimeout(function () { srNode.textContent = msg; }, 30);
  }

  function mountControls(parent) {
    if (!doc) return null;
    if (controlEl && controlEl.parentNode && (!parent || controlEl.parentNode === parent)) return controlEl;
    var bar = doc.createElement('div');
    bar.className = 'fxbar';
    if (!parent) { bar.style.right = '16px'; bar.style.bottom = '16px'; }
    else { bar.style.position = 'relative'; bar.style.right = ''; bar.style.bottom = ''; }

    var lab = doc.createElement('span'); lab.className = 'fxlab'; lab.textContent = 'FX';
    bar.appendChild(lab);

    muteBtn = doc.createElement('button');
    muteBtn.type = 'button';
    muteBtn.addEventListener('click', function () { API.mute(!cfg.muted); });
    bar.appendChild(muteBtn);

    volInput = doc.createElement('input');
    volInput.type = 'range'; volInput.min = '0'; volInput.max = '100'; volInput.step = '5';
    volInput.setAttribute('aria-label', 'Effects volume');
    volInput.addEventListener('input', function () { API.volume(Number(volInput.value) / 100); });
    bar.appendChild(volInput);

    motionSel = doc.createElement('select');
    motionSel.setAttribute('aria-label', 'Motion');
    [['auto', 'Auto'], ['full', 'Full'], ['reduced', 'Reduced']].forEach(function (o) {
      var op = doc.createElement('option'); op.value = o[0]; op.textContent = o[1];
      motionSel.appendChild(op);
    });
    motionSel.addEventListener('change', function () { API.motion(motionSel.value); });
    bar.appendChild(motionSel);

    (parent || doc.body).appendChild(bar);
    controlEl = bar;
    refreshControls();
    return bar;
  }

  function onKey(e) {
    if (!e || e.defaultPrevented) return;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || (t && t.isContentEditable)) return;
    if (e.key === 'm' || e.key === 'M') API.mute(!cfg.muted);
  }

  /* ==================================================================== *
   * 14 · MOUNT / DESTROY                                                 *
   * ==================================================================== */

  var mqHandlers = [];

  function mount(o) {
    if (mounted) { if (o && o.control) mountControls(o.parent || null); return API; }
    if (!doc || !doc.body) return API;
    return guard(function () {
      opts = o || {};
      root = opts.root || doc;
      STORE_KEY = opts.storageKey || STORE_KEY;
      anchors = Object.assign({}, DEFAULT_ANCHORS, opts.anchors || {});
      if (!('uidAttr' in opts)) opts.uidAttr = 'data-uid';
      loadCfg();
      if (typeof opts.volume === 'number') cfg.volume = clamp(opts.volume, 0, 1);
      if (opts.motion) cfg.motion = opts.motion;

      styleNode = doc.getElementById('fx600');
      if (!styleNode) {
        styleNode = doc.createElement('style');
        styleNode.id = 'fx600';
        styleNode.textContent = CSS;
        doc.head.appendChild(styleNode);
      }

      layer = doc.getElementById('fx-layer');
      if (!layer) {
        layer = doc.createElement('div');
        layer.id = 'fx-layer';
        layer.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(layer);
      }

      srNode = doc.createElement('div');
      srNode.className = 'fx-sr';
      srNode.setAttribute('role', 'status');
      srNode.setAttribute('aria-live', 'polite');
      doc.body.appendChild(srNode);

      buildPools();
      detectAdditive();

      if (global.matchMedia) {
        mqMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
        mqTransparency = global.matchMedia('(prefers-reduced-transparency: reduce)');
        [mqMotion, mqTransparency].forEach(function (mq) {
          if (!mq || !mq.addEventListener) return;
          var h = function () { refreshControls(); };
          mq.addEventListener('change', h);
          mqHandlers.push([mq, h]);
        });
      }

      doc.addEventListener('keydown', onKey);
      doc.addEventListener('visibilitychange', onVisibility);
      wireArmListeners();

      if (opts.control !== false) mountControls(opts.parent || null);
      mounted = true;
      if (cfg.pressure) { /* drone is created lazily at game:start */ }
      return API;
    }) || API;
  }

  function onVisibility() {
    if (!doc) return;
    if (doc.hidden) suspendAudio(); else resumeAudio();
  }

  function stopAll() {
    guard(function () {
      if (ready) {
        var t = ctx.currentTime;
        voices.forEach(function (v) {
          guard(function () {
            v.g.gain.cancelScheduledValues(t);
            v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), t);
            v.g.gain.linearRampToValueAtTime(0.0001, t + 0.060);
          });
        });
        voices.length = 0;
        stopHoldTone(); stopClashBus(0.06);
      }
      clearLoopRings();
      animSet.forEach(function (a) { guard(function () { a.cancel(); }); });
      animSet.clear();
      animNonEssential = 0;
      queue.length = 0;
    });
  }

  function destroy() {
    guard(function () {
      stopAll();
      stopBed();
      removeArmListeners();
      if (doc) {
        doc.removeEventListener('keydown', onKey);
        doc.removeEventListener('visibilitychange', onVisibility);
      }
      mqHandlers.forEach(function (p) { guard(function () { p[0].removeEventListener('change', p[1]); }); });
      mqHandlers.length = 0;
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
      if (srNode && srNode.parentNode) srNode.parentNode.removeChild(srNode);
      if (controlEl && controlEl.parentNode) controlEl.parentNode.removeChild(controlEl);
      layer = styleNode = srNode = controlEl = null;
      pools = {}; mounted = false;
      if (drone) { guard(function () { drone.o1.stop(); drone.o2.stop(); drone.lfo.stop(); }); drone = null; }
      if (ctx && ctx.close) guard(function () { ctx.close(); });
      ctx = null; ready = false; masterGain = null;
    });
  }

  /* ==================================================================== *
   * 15 · DEBUG HELPERS                                                   *
   * ==================================================================== */

  var PRIMS = {
    stepIn: function (el) { pStepIn(el); },
    hardCut: function (el, o) { pHardCut(el, o && o.out); },
    wipe: function (el, o) { pWipe(el, (o && o.color) || PALETTE.gold, (o && o.duration) || D.lg, o && o.alpha); },
    jitter: function (el, o) { pJitter(el, (o && o.amp) || 2); },
    rackSlide: function (el, o) { pRackSlide(el, o && o.dx, o && o.out); },
    commit: function (el) { pCommit(el); },
    roll: function (el, o) { pRoll(el, (o && o.key) || 'debug'); },
    drain: function (el, o) { pDrain(el, !!(o && o.gain)); },
    ring: function (el, o) { pRing(el, (o && o.color) || PALETTE.orange, (o && o.duration) || D.xl); },
    glyphRain: function (el, o) { pGlyphRain(rectOf(el), (o && o.color) || PALETTE.danger, (o && o.count) || 6); },
    chip: function (el, o) { pChip((o && o.text) || 'CHIP', (o && o.color) || PALETTE.gold, rectOf(el), (o && o.rise) || 20, (o && o.duration) || D.xl); }
  };

  function anim(name, el, o) {
    return guard(function () {
      if (!mounted) API.mount({ control: false });
      /* accept anim(el, name) as well as anim(name, el) */
      if (name && name.nodeType === 1) { var t = name; name = el; el = t; }
      var fn = PRIMS[name];
      if (!fn || !el) return false;
      rectCache = new Map();
      fn(el, o || {});
      return true;
    });
  }

  function sfx(name, o) {
    return guard(function () {
      if (!ready && !arm()) return false;
      var fn = SFX[name];
      if (!fn) return false;
      fn(o || {});
      return true;
    });
  }

  function audition(name, detail) {
    guard(function () {
      if (!mounted) API.mount({ control: false });
      lastDedupe.key = ''; lastFire[name] = 0;
      enqueue(name, detail || {}, true);
    });
  }

  /* ==================================================================== *
   * 16 · API                                                             *
   * ==================================================================== */

  var TOKENS = Object.freeze({
    durations: Object.freeze({ xs: 70, sm: 120, md: 180, lg: 280, xl: 420, xxl: 900 }),
    easings: Object.freeze(Object.assign({}, EASE)),
    pitches: Object.freeze(Object.assign({}, HZ)),
    dorian: Object.freeze(DORIAN_STEP.slice()),
    affinity: Object.freeze(Object.assign({}, AFF_COLOR)),
    affinityNames: Object.freeze(Object.assign({}, AFF_NAME)),
    palette: Object.freeze(Object.assign({}, PALETTE)),
    staggers: Object.freeze(Object.assign({}, STAG)),
    seatTranspose: SEAT_T,
    phasePitch: Object.freeze(Object.assign({}, PHASE_PITCH)),
    busGain: Object.freeze(Object.assign({}, BUS_GAIN)),
    caps: Object.freeze({ voices: VOICE_CAP, animations: ANIM_CAP, crushCache: CRUSH_CAP })
  });

  var API = {
    version: VERSION,
    debug: false,
    get ready() { return ready; },

    arm: arm,
    mount: mount,
    init: function (o) { mount(o); return API; },

    emit: emit,
    emitAll: emitAll,

    set: function (patch) {
      guard(function () {
        if (!patch) return;
        if (typeof patch.muted === 'boolean') cfg.muted = patch.muted;
        if (typeof patch.volume === 'number') cfg.volume = clamp(patch.volume, 0, 1);
        if (typeof patch.pressure === 'boolean') cfg.pressure = patch.pressure;
        if (patch.motion === 'auto' || patch.motion === 'full' || patch.motion === 'reduced') cfg.motion = patch.motion;
        if (typeof patch.bed === 'boolean') {
          cfg.bed = patch.bed;
          if (ready) { if (cfg.bed) startBed(); else stopBed(); }
        }
        applyMaster(); updateDrone(); refreshControls(); saveCfg();
      });
      return API;
    },
    get: function () {
      return {
        muted: cfg.muted, volume: cfg.volume, bed: cfg.bed, pressure: cfg.pressure,
        motion: cfg.motion, motionActive: motionActive(), ready: ready,
        voices: voices.length, animations: animSet.size, animationsCapped: animNonEssential,
        activeSeat: activeSeat, bufferTotal: bufferTotal,
        ctxState: ctx ? ctx.state : 'none', additive: ADDITIVE
      };
    },

    mute: function (on) {
      cfg.muted = !!on; applyMaster(); refreshControls(); saveCfg();
      announce(cfg.muted ? 'Sound off' : 'Sound on');
      return API;
    },
    volume: function (v) { cfg.volume = clamp(Number(v) || 0, 0, 1); applyMaster(); refreshControls(); saveCfg(); return API; },
    bed: function (on) { return API.set({ bed: !!on }); },
    pressure: function (on) { return API.set({ pressure: !!on }); },
    motion: function (m) { return API.set({ motion: m }); },
    mountControls: mountControls,

    /* task-facing aliases */
    setMuted: function (b) { return API.mute(!!b); },
    setVolume: function (v) { return API.volume(v); },
    isMuted: function () { return !!cfg.muted; },
    animate: function (a, b, c) { return anim(a, b, c); },

    sfx: sfx,
    anim: anim,
    audition: audition,
    stopAll: stopAll,
    suspend: suspendAudio,
    resume: resumeAudio,
    destroy: destroy,

    EVENTS: EVENTS,
    TOKENS: TOKENS
  };

  Object.defineProperty(API, 'debug', {
    get: function () { return DEBUG; },
    set: function (v) { DEBUG = !!v; },
    enumerable: true
  });

  /* Zero-coupling integration: exactly one listener, no globals read. */
  if (doc && doc.addEventListener) {
    doc.addEventListener('fx', function (e) {
      var d = (e && e.detail) || {};
      API.emit(d.name || d.type, d);
    });
  }

  loadCfg();

  global.FX600 = API;
  global.E1FX = API;
  if (!global.FX) global.FX = API;

  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
