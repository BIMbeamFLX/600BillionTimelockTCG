/* Wave 5: live stat bases and the last cheap patterns. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "..", "site");
const require = createRequire(import.meta.url);

const CARDS = require(path.join(siteDir, "play-data.js"));
const E = require(path.join(siteDir, "engine.js"));
E.setCatalog(CARDS);

const byName = Object.fromEntries(CARDS.map((c) => [c.name, c]));
const ctx = () => E.resolveCtx({});

function game(seedValue = 606606) {
  let attempt = seedValue;
  for (let i = 0; i < 40; i++) {
    try {
      return E.createGame({
        seats: [
          { name: "A", affinity: "Keys" },
          { name: "B", affinity: "Signal" },
        ],
        seeds: { public: attempt, hidden: [attempt + 1, attempt + 2] },
        firstPlayer: 0,
      });
    } catch (error) {
      attempt = (attempt * 1103515245 + 12345) & 0x7fffffff;
    }
  }
  throw new Error("could not mint a game");
}

function seed(state, seat, cardId, tweaks, zone) {
  const where = zone || "network";
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid, cardId, owner: seat, controller: seat, zone: `${seat}:${where}`,
      committed: false, bootDelay: false, damage: 0, counters: {},
      attachedTo: null, rebootShields: 0, facedown: false,
      revealedTo: [], revealedUntil: null, token: false,
      entersSeq: state.seq, prevUid: null,
    },
    tweaks || {}
  );
  state.zones[`${seat}:${where}`].push(uid);
  return uid;
}

test("Proton's stats live-track the Keys Resources you control", () => {
  const state = game();
  const proton = seed(state, 0, byName["Proton, Keyed Nightmare"].id);
  assert.deepEqual(E.statsOf(state, ctx(), proton), { action: 0, resilience: 0 });
  seed(state, 0, byName["Timelock–Keys Junction"].id);
  seed(state, 0, byName["Timelock–Keys Junction"].id);
  seed(state, 1, byName["Timelock–Keys Junction"].id); // theirs — must not count
  assert.deepEqual(E.statsOf(state, ctx(), proton), { action: 2, resilience: 2 });
});

test("BlackCoffee counts every copy of itself on the whole Network", () => {
  const state = game();
  const id = byName["BlackCoffee, Shared Secret Swarm"].id;
  const first = seed(state, 0, id);
  seed(state, 0, id);
  seed(state, 1, id); // the swarm does not care whose it is
  assert.equal(E.statsOf(state, ctx(), first).action, 3);
});

test("Rootzoll counts your non-Firewall Avatars only", () => {
  const state = game();
  const rootzoll = seed(state, 0, byName["Rootzoll, Crew Multiplier"].id);
  seed(state, 0, byName["FLX, Culture Curator"].id);
  seed(state, 1, byName["FLX, Culture Curator"].id); // theirs
  // Rootzoll itself is a non-Firewall Avatar you control: 1 (self) + 1 (FLX).
  assert.equal(E.statsOf(state, ctx(), rootzoll).action, 2);
});

test("the wave-5 families compile as scripted", () => {
  for (const name of [
    "Proton, Keyed Nightmare",
    "BlackCoffee, Shared Secret Swarm",
    "Rootzoll, Crew Multiplier",
    "Arbadacarba, Protocol Gardener",
  ]) {
    const card = byName[name];
    assert.equal(card.manual, false, `${name} is fully scripted`);
  }
  const reboot = byName["Reboot Protocol"];
  const ability = reboot.abilities.find((a) => a.kind === "activated");
  assert.ok(ability && !ability.manual, "Reboot attached Avatar is scripted");
});
