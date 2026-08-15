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

/* A legal 40 under the §7 copy limit: three of everything until it fills.
 * It used to be 20 Orchards and 20 of one filler, which stopped being a legal
 * Stack the moment MAX_COPIES landed. */
const orchard = CARDS.find((c) => c.name === "Satoshi Orchard");
const playable = CARDS.filter((c) => !(c.text || "").includes("Stake"));
const forty = (() => {
  const out = [orchard.id, orchard.id, orchard.id];
  for (const card of playable) {
    if (card.id === orchard.id) continue;
    for (let i = 0; i < E.MAX_COPIES && out.length < 40; i++) out.push(card.id);
    if (out.length >= 40) break;
  }
  return out.slice(0, 40);
})();


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

test("§7: no more than three copies of one card", () => {
  /* This asserted the OPPOSITE until today. Unlimited copies was not a liberal
   * format, it was the format: E1 has almost no card selection, so density is
   * the only way to make a Stack reliable, and a measured 26-copy Zap build won
   * 97.7% of games against all eleven precons on a mean kill turn of 3.8. */
  /* A NON-BASIC card, deliberately: Basic Resources are exempt, for the same
   * reason every card game exempts its basic lands — there are ten in the set
   * and a Stack needs sixteen-plus, so a cap on them makes a legal Stack
   * arithmetically impossible. The rule exists to stop one SPELL being the
   * whole deck. */
  const spell = CARDS.find((c) => c.type === "Zap" && !(c.text || "").includes("Stake"));
  const mono = [...Array(4).fill(spell.id), ...forty.slice(4)];
  assert.throws(() => E.createGame(config(mono, "Power")), /limit 3/);

  const basics = Array(40).fill(orchard.id);
  const allBasic = E.createGame(config(basics, "Power"));
  assert.equal(allBasic.zones["0:stack"].length + allBasic.zones["0:wallet"].length, 40,
    "forty Basic Resources is legal, if unwise");
  const state = E.createGame(config(forty, "Power"));
  assert.equal(state.zones["0:stack"].length + state.zones["0:wallet"].length, 40);
});
