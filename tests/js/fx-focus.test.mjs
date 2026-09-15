/* site/fx.js — the bed's focus duck (NAP-CUE), against a fake Web Audio graph.
 *
 * While the Hangar's music plays, the bed is held down at the focus level, and
 * every other duck (a burn, a game-over fanfare) releases back to that level
 * rather than to full volume. Only `idle` brings the room tone back to 1.
 *
 * Run: node --test tests/js/fx-focus.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "fx.js"), "utf8");

/* Every AudioParam records its automation; every node answers any method. */
function fakeAudio() {
  const params = [];
  const param = (value) => {
    const p = { value, ops: [] };
    for (const op of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues", "setValueCurveAtTime"]) {
      p[op] = (...args) => { p.ops.push([op, ...args]); return p; };
    }
    params.push(p);
    return p;
  };
  const node = () => new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== "string") return undefined;
      if (["gain", "frequency", "Q", "detune", "playbackRate", "delayTime", "pan", "threshold", "knee", "ratio", "attack", "release"].includes(key)) {
        target[key] = param(key === "gain" ? 1 : 0);
        return target[key];
      }
      if (key === "then") return undefined;
      return () => node();
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const withNodes = (target) => new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : typeof key === "string" && key.startsWith("create") ? () => node() : undefined),
  });
  function AudioContext() {
    return withNodes({
      currentTime: 10, state: "running", sampleRate: 48000, destination: node(),
      createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length), length, numberOfChannels: channels }),
      decodeAudioData: () => Promise.reject(new Error("no samples in a test")),
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    });
  }
  return { AudioContext, params };
}

function loadFx() {
  const audio = fakeAudio();
  const scope = {
    AudioContext: audio.AudioContext,
    setTimeout: () => 0, clearTimeout() {}, Date, Math, console,
    fetch: () => Promise.reject(new Error("offline")),
  };
  scope.globalThis = scope;
  new Function("globalThis", `${FX_JS.replace(/\}\)\(typeof globalThis !== 'undefined' \? globalThis : this\);\s*$/, "})(globalThis);")}`)(scope);
  const FX = scope.E1FX;
  assert.equal(FX.arm(), true, "the fake graph arms");
  return { FX, params: audio.params };
}

const lastRamp = (p) => p.ops.filter((op) => op[0] === "linearRampToValueAtTime").at(-1);

test("while focus is playing a game-over duck releases to the focus level, and idle returns the bed to 1", () => {
  const { FX, params } = loadFx();
  FX.duckBed(0.35);
  // The bed duck's gain is the one param a held duck ramps to exactly 0.35.
  const bed = params.find((p) => (lastRamp(p) || [])[1] === 0.35);
  assert.ok(bed, "a held duck ramps the bed to 0.35");

  FX.sfx("game:win", {});
  const ramps = bed.ops.filter((op) => op[0] === "linearRampToValueAtTime").slice(-2);
  assert.equal(ramps[0][1], 0.35, "the fanfare's 0.45 never lifts the bed above the music's duck");
  assert.equal(ramps[1][1], 0.35, "and it releases to 0.35, not 1");

  FX.duckBed(0.2, 100, 300);
  assert.deepEqual(bed.ops.filter((op) => op[0] === "linearRampToValueAtTime").slice(-2).map((op) => op[1]), [0.2, 0.35], "a deeper hit dips and comes back to the focus level");

  FX.unduckBed();
  assert.equal(lastRamp(bed)[1], 1, "idle gives the room tone back");
  FX.sfx("game:win", {});
  assert.equal(lastRamp(bed)[1], 1, "with nothing held a duck releases to full, as before");
});
