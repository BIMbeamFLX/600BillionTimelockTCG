/* Guards the Stake landmine (D-12).
 *
 * E.createGame THROWS when an auto-built deck contains a Stake card and the
 * Stake module is off. Measured failure rates make this a real hazard, not a
 * theoretical one — a Keys table fails on most random seeds. The server works
 * around it with a seed re-roll; these tests prove the workaround holds for every
 * affinity, so nobody discovers it on stage.
 *
 * Run: node --test tests/js/seeds.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const E = require("../../site/engine.js");
const CARDS = require("../../site/play-data.js");
E.setCatalog(CARDS);

const AFFINITIES = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock"];

/* A local copy of the server's minting loop. Deliberately duplicated rather than
 * imported: this test asserts the STRATEGY (re-roll until the deck constructs)
 * survives, so it must not silently follow a refactor of the server. */
function mintGame(affA, affB, seedFrom) {
  let seed = seedFrom;
  for (let attempt = 0; attempt < 40; attempt++) {
    const config = {
      seats: [
        { name: "a", affinity: affA },
        { name: "b", affinity: affB },
      ],
      seeds: { public: seed, hidden: [seed + 1, seed + 2] },
    };
    try {
      return { config, state: E.createGame(config), attempts: attempt + 1 };
    } catch (err) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    }
  }
  return null;
}

test("P-12 REPAID: an auto-built deck never contains a card the ruleset cannot resolve", () => {
  /* This test used to assert the OPPOSITE — that createGame throws on some
   * seeds — and said so: "if this ever hits zero the engine bug was fixed
   * (P-12) and the re-roll can go." It has. buildDeckList now refuses to deal
   * Stake cards while the Stake module is off, instead of the referee rolling
   * dice up to forty times until they happened not to come up. Keys was the
   * worst case at roughly a 9-in-10 failure rate per seed. */
  let failures = 0;
  for (let i = 0; i < 25; i++) {
    try {
      E.createGame({
        seats: [{ name: "a", affinity: "Keys" }, { name: "b", affinity: "Power" }],
        seeds: { public: 4000 + i, hidden: [5000 + i, 6000 + i] },
      });
    } catch (err) {
      failures++;
    }
  }
  assert.equal(failures, 0, "every seed must build a legal deck without a re-roll");
});

test("an auto-built deck is a deck, not a pile of dice rolls", () => {
  /* Sampling WITH replacement gave a 40-card deck 23-25 unique cards, averaging
   * 5.6 copies of one and reaching ten — and since the referee builds every
   * online deck this way, that was the online game. */
  for (let i = 0; i < 20; i++) {
    const state = E.createGame({
      seats: [{ name: "a", affinity: "All" }, { name: "b", affinity: "Power" }],
      seeds: { public: 7000 + i, hidden: [7100 + i, 7200 + i] },
    });
    for (const seat of [0, 1]) {
      const counts = {};
      for (const object of Object.values(state.objects)) {
        if (object.owner !== seat) continue;
        counts[object.cardId] = (counts[object.cardId] || 0) + 1;
      }
      const worst = Math.max(...Object.values(counts));
      assert.ok(worst <= 4, `seat ${seat} holds ${worst} copies of one card on seed ${7000 + i}`);
    }
  }
});

test("mintGame's re-roll succeeds for every affinity pairing, 50 starting seeds", () => {
  for (const affA of AFFINITIES) {
    for (let i = 0; i < 50; i++) {
      const minted = mintGame(affA, "Power", 100000 + i * 7919);
      assert.ok(minted, `mintGame gave up for ${affA} at start seed ${100000 + i * 7919}`);
      assert.equal(minted.state.seq, 0);
      assert.equal(minted.state.status, "playing");
    }
  }
});

test("every affinity can face every other affinity", () => {
  for (const a of AFFINITIES) {
    for (const b of AFFINITIES) {
      assert.ok(mintGame(a, b, 777001), `${a} vs ${b} could not be minted`);
    }
  }
});

test("a minted config replays to the same state it created", () => {
  const minted = mintGame("Keys", "Timelock", 424242);
  assert.ok(minted);
  const again = E.createGame(minted.config);
  assert.equal(E.hashState(again), E.hashState(minted.state));
});
