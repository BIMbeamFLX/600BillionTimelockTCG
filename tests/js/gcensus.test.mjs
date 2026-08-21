import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const draw = require("../../server/nutft-draw.js");

const G = JSON.parse(readFileSync(path.join(REPO, "cards", "g-census.json"), "utf8"));
const E1 = JSON.parse(readFileSync(path.join(REPO, "cards", "nutft-census.json"), "utf8"));

const GENESIS = new Set(G.cards.filter((c) => c.tier === "Genesis").map((c) => c.id));
const PROMO = "FIPS-P01";

test("a manifest census issues the set the census names, not a draw", () => {
  /* The whole point of the G edition: a starter set is a precon, so what has to
     be checkable is the CONTENT, not the odds. Set N is entry N — verifiable
     against the published file by counting, with no beacon and no hashing. */
  const catalog = draw.loadCensus(G);
  assert.equal(catalog.issuance, "manifest");
  assert.equal(catalog.manifest.size, G.mint.packs, "every set is in the manifest");

  const counts = { ...catalog.counts };
  const first = draw.openManifestPack(counts, catalog.manifest, "set-0001");
  assert.deepEqual(first, G.manifest[0].cards, "the set is what the census says it is");
  assert.equal(first.length, G.mint.cards_per_pack);
});

test("the first twenty-one sets carry a Genesis card and the promo, and no others do", () => {
  /* This is the announced rule, so it is asserted against the ISSUED contents
     rather than the manifest field that claims it. A `strong: true` flag that
     nothing checks is a label, not a guarantee. */
  const catalog = draw.loadCensus(G);
  const counts = { ...catalog.counts };
  const strongCount = G.mint.strong_sets;

  const genesisPerTitle = {};
  for (let n = 1; n <= G.mint.packs; n += 1) {
    const cards = draw.openManifestPack(counts, catalog.manifest, `set-${String(n).padStart(4, "0")}`);
    const genesis = cards.filter((id) => GENESIS.has(id));
    const promos = cards.filter((id) => id === PROMO);
    if (n <= strongCount) {
      assert.equal(genesis.length, 1, `set ${n} is strong and must hold exactly one Genesis`);
      assert.equal(promos.length, 1, `set ${n} is strong and must hold the promo`);
      genesisPerTitle[genesis[0]] = (genesisPerTitle[genesis[0]] || 0) + 1;
    } else {
      assert.equal(genesis.length, 0, `set ${n} is plain and must hold no Genesis`);
      assert.equal(promos.length, 0, `set ${n} is plain and must hold no promo`);
    }
  }

  const worst = Math.max(...Object.values(genesisPerTitle));
  assert.ok(worst <= G.mint.per_genesis_card,
    `no Genesis title may appear in more than ${G.mint.per_genesis_card} strong sets; worst is ${worst}`);
});

test("the whole run empties the census exactly, with nothing left over and nothing short", () => {
  /* Issuing every set must consume every declared copy. A leftover means the
     census promises cards no set contains; a shortfall means a set asks for a
     card the edition never printed, which openManifestPack refuses outright. */
  const catalog = draw.loadCensus(G);
  const counts = { ...catalog.counts };
  for (let n = 1; n <= G.mint.packs; n += 1) {
    draw.openManifestPack(counts, catalog.manifest, `set-${String(n).padStart(4, "0")}`);
  }
  const leftover = Object.entries(counts).filter(([, left]) => left !== 0);
  assert.deepEqual(leftover, [], "every declared copy was issued exactly once");
});

test("a manifest asking for a card the census has none of is refused", () => {
  const catalog = draw.loadCensus(G);

  /* Exhaust ONE card the set needs, rather than issuing the set twice. Issuing
     twice proves nothing: most cards appear in many decks, so the second pass
     still finds copies and the guard never fires. The condition under test is
     "this set wants a card with none left", so that is the state to build. */
  const counts = { ...catalog.counts };
  const wanted = catalog.manifest.get("set-0001")[0];
  counts[wanted] = 0;
  assert.throws(() => draw.openManifestPack(counts, catalog.manifest, "set-0001"),
    /which the census has none of left/);
  assert.throws(() => draw.openManifestPack(counts, catalog.manifest, "set-9999"),
    /no manifest entry/);
});

test("E1 is untouched: no manifest, and it still draws", () => {
  /* The edition that is already sold must not change behaviour because a second
     edition arrived. */
  const catalog = draw.loadCensus(E1);
  assert.equal(catalog.issuance, "draw");
  assert.equal(catalog.manifest.size, 0);

  const counts = { ...catalog.counts };
  const cards = draw.openPack(counts, catalog.pools, catalog.slots, "11".repeat(32), "pack-0001", catalog.sequential);
  assert.equal(cards.length, E1.mint.cards_per_pack - 1,
    "openPack returns the paid cards; the basic is added by the mint");
});
