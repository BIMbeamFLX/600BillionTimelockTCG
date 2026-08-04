/* Wave 7: modal "Choose one" — compiled modes with per-mode target specs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CARDS = require(path.resolve(here, "..", "..", "site", "play-data.js"));
const E = require(path.resolve(here, "..", "..", "site", "engine.js"));
E.setCatalog(CARDS);
const byName = Object.fromEntries(CARDS.map((c) => [c.name, c]));

test("all three modal cards compile scripted, each mode with its own spec", () => {
  for (const name of ["Repair Packet", "Power Invalidation", "Timelock Invalidation"]) {
    const compiled = E.compileCard(byName[name]);
    assert.ok(compiled.playModes && compiled.playModes.length === 2, `${name} has 2 modes`);
    assert.equal(byName[name].manual, false, `${name} is scripted`);
  }
  const inval = E.compileCard(byName["Power Invalidation"]);
  assert.equal(inval.playModes[0].targetSpec[0].kind, "queue", "mode 1 targets the Queue");
  assert.equal(inval.playModes[1].targetSpec[0].kind, "type:Power", "mode 2 targets the board");
});

test("playing a modal card without choosing a mode is refused", () => {
  let attempt = 999001, state = null;
  for (let i = 0; i < 40 && !state; i++) {
    try {
      state = E.createGame({
        seats: [{ name: "A", affinity: "Power" }, { name: "B", affinity: "Signal" }],
        seeds: { public: attempt, hidden: [attempt + 1, attempt + 2] },
        firstPlayer: 0,
      });
    } catch (e) { attempt = (attempt * 1103515245 + 12345) & 0x7fffffff; }
  }
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = {
    uid, cardId: byName["Repair Packet"].id, owner: 0, controller: 0, zone: "0:wallet",
    committed: false, bootDelay: false, damage: 0, counters: {}, attachedTo: null,
    rebootShields: 0, facedown: false, revealedTo: [], revealedUntil: null, token: false,
    entersSeq: state.seq, prevUid: null,
  };
  state.zones["0:wallet"].push(uid);
  const r = E.apply(state, { type: "PLAY_CARD", seat: 0, seq: state.seq, at: "", payload: { uid, targets: [] } });
  assert.equal(r.error && r.error.code, "SCHEMA", "a mode must be chosen");
});
