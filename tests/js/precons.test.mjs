/* The precon library must construct real games — the engine is the judge.
 * Run: node --test tests/js/precons.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "..", "site");
const require = createRequire(import.meta.url);

const CARDS = require(path.join(siteDir, "play-data.js"));
const PRECONS = require(path.join(siteDir, "precons.js"));
const E = require(path.join(siteDir, "engine.js"));
E.setCatalog(CARDS);

test("every preconstructed Stack constructs a legal game in either seat", () => {
  const names = Object.keys(PRECONS);
  assert.ok(names.length >= 11, `library too small: ${names.length}`);
  for (const name of names) {
    const deck = PRECONS[name].cards;
    assert.ok(deck.length >= 40, `${name} is under the §7 floor`);
    // Both seats play the same explicit list: no random path, no seed landmine.
    const state = E.createGame({
      seats: [
        { name: "A", deck: deck.slice() },
        { name: "B", deck: deck.slice() },
      ],
      seeds: { public: 600, hidden: [601, 602] },
      firstPlayer: 0,
    });
    for (const seat of [0, 1]) {
      const held = state.zones[`${seat}:stack`].length + state.zones[`${seat}:wallet`].length;
      assert.equal(held, deck.length, `${name}: seat ${seat} lost cards on the way in`);
    }
  }
});

test("the library is fully scripted — no assisted card anywhere", () => {
  const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  for (const [name, precon] of Object.entries(PRECONS)) {
    for (const id of new Set(precon.cards)) {
      assert.ok(!byId[id].manual, `${name}: ${id} would need the manual controls`);
    }
  }
});
