/* Custom decklist tests — the contract the Stack Builder relies on.
 * The builder writes plain cardId lists; the engine is the validator. */
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

const config = (deckA, deckB) => ({
  seats: [
    { name: "A", ...(Array.isArray(deckA) ? { deck: deckA } : { affinity: deckA }) },
    { name: "B", ...(Array.isArray(deckB) ? { deck: deckB } : { affinity: deckB }) },
  ],
  seeds: { public: 4242, hidden: [4243, 4244] },
  firstPlayer: 0,
});

// A legal 40: 20 Satoshi Orchards and 20 of the first affordable Bitcoin card.
const orchard = CARDS.find((c) => c.name === "Satoshi Orchard");
const filler = CARDS.find((c) => !/\bStake\b/.test(c.text || "") && c.id !== orchard.id);
const forty = [...Array(20).fill(orchard.id), ...Array(20).fill(filler.id)];

test("a saved 40-card Stack constructs a game and commits the decklist", () => {
  const state = E.createGame(config(forty, "Signal"));
  assert.equal(state.zones["0:stack"].length + state.zones["0:wallet"].length, 40);
  assert.match(state.seats[0].deckCommit, /^sha256:/);
});

test("39 cards is not a Stack (§7 minimum)", () => {
  assert.throws(() => E.createGame(config(forty.slice(1), "Signal")), /minimum 40/);
});

test("a Stake-module card never constructs in the base ruleset", () => {
  const stake = CARDS.find((c) => /\bStake\b/.test(c.text || ""));
  assert.ok(stake, "the catalog carries Stake cards to refuse");
  const cheat = [...forty.slice(1), stake.id];
  assert.throws(() => E.createGame(config(cheat, "Signal")), /Stake module/);
});

test("copies are unrestricted: forty of one card is legal", () => {
  const mono = Array(40).fill(orchard.id);
  const state = E.createGame(config(mono, "Power"));
  assert.equal(state.zones["0:stack"].length + state.zones["0:wallet"].length, 40);
});
