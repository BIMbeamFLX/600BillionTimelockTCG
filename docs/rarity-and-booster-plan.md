# E1 rarity and booster plan

Research note and design rationale. Nothing here is implemented —
`scripts/build_shop_data.py` and `scripts/build_asset_set.py` still run the flat curve
described in §3.

The live numbers are generated, not written here: `scripts/build_tier_census.py` emits
[`../cards/e1-tier-census.json`](../cards/e1-tier-census.json) and
[`e1-tier-census.md`](e1-tier-census.md). This document explains *why* those numbers are
what they are. Where the two disagree, the generated census wins.

The historical reference set is named only by slot number. Card names from the reference
stay out of this repository, per `rules/research-sources.md` and README line 325.

## 1. How the 1993 reference booster was actually built

Three print sheets, 11x11 = 121 slots each, striped collation. One sheet per rarity, no
mixing. Each non-land card appeared **exactly once** on its sheet; leftover slots were
filled with basic lands, which is why basic lands showed up at every rarity and hid the
rarity of everything else.

| sheet | unique cards | filler lands | slots |
|---|---|---|---|
| common | 74 | 47 | 121 |
| uncommon | 95 | 26 | 121 |
| rare | 116 | 5 | 121 |

Pack: 11 common + 3 uncommon + 1 rare = 15 cards. Total run 2,609,728 cards. Factory
archives put each rare at **1,008 copies**; the 11:3:1 pack ratio makes each uncommon
about 3,024 and each common about 11,088.

Lands were never a guaranteed slot — they were filler. A pack averaged about five of them
and roughly 0.2% of packs had none at all, and 4.13% of the time the *rare* slot was an
Island. Guaranteed land slots are a modern invention. We take the modern side; see §4.

Two things matter and both are counter-intuitive.

**The pyramid was inverted.** 116 rare slots against 74 common slots. More distinct rare
cards than common ones. Completing the rare set was the hard part, not pulling one rare.

**The rarity curve was flat.** An 11:1 spread between the most and least numerous card in
the set. Our current box runs 8:1 — we are, right now, *flatter than the set we are
modelling*, and that set is the flattest famous set in the hobby.

## 2. Where the value came from, since it was not the curve

Prices across that set follow a power law, not the rarity tiers:

- median rare / median common = **8.9x** — almost exactly the 11:3:1 print ratio
- most expensive card / median common = **1,280x**
- top 10 cards = **46%** of the whole set's market value; top 25 = **64%**
- bottom 100 cards = **11%**

An 11x supply spread produced a 1,280x price spread. The multiplier is not scarcity. It is
scarcity *times* play demand, and play demand is brutally concentrated: roughly 4% of the
legal card pool sees competitive play. Four levers did the work:

1. **Power concentration.** Every game-defining card sat in the rarest slot. All nine
   power cards: rare. All ten dual lands: rare. Zero exceptions.
2. **Hard cap, never reprinted.** 1,008 copies, and a public promise never to reprint.
3. **Inverted pyramid.** Many rare slots means a specific rare stays hard to find even
   though rares as a class are 1-in-15.
4. **Play demand.** The expensive cards are the played cards. Every one of the nine power
   cards was restricted or banned within two years — the format itself certified them.

Levers 3 and 4 are design. Lever 2 is a promise. We can commit lever 2 with a hash instead
of a promise, which nobody in 1993 could do — see
[`distribution-proof.md`](distribution-proof.md).

Lever 1 is the one worth staring at. The 1993 designers did not know which cards would
matter; they guessed, and got lucky often enough. We are not guessing. Thirty years of
price data and play data already exist, and both are machine-readable.

## 3. Where we are

295 cards, matching the reference count. `source_slot` maps 1:1 onto reference slots, so
the crosswalk is exact and mechanical.

| | ours | reference |
|---|---|---|
| common | 150 | 74 |
| uncommon | 100 | 95 |
| rare | 45 | 116 |

We built the exact inverse of the shape we were modelling. `PRINT_RUN` is
`common 24 / uncommon 8 / rare 3`, box 4,535 cards, 907 packs, rare pull 2.98%.

The damage shows up wherever power and rarity disagree. All nine Junctions — our
dual-affinity Resources, mapped to the nine reference dual lands that trade for thousands
each and are on the never-reprint list — are **commons**. `E1-052 First Memory` maps to
the most restricted card in the reference format's history and is an **uncommon**.
Meanwhile `precons.js` says what the market said in 1994: the four most-played cards
across all eleven decks are `E1-262`, `E1-263`, `E1-001` and `E1-264`. The cards nobody
can build without are the ones we priced as filler.

## 4. The design: score first, tier second

Inheriting the reference rarity would fix the Junctions and little else, because the
reference rarity was itself a guess. Instead every card gets a score, and the tiers are
rank cuts on that score. **A card is held back because it is good, not because it was rare
in 1993.**

### 4.1 Three axes

Each normalised to 0..1, weighted 0.40 / 0.40 / 0.20. Weights are constants at the top of
`scripts/build_tier_census.py`; change them and the tiers move.

| axis | weight | what it is |
|---|---|---|
| **value** | 0.40 | log of the reference slot's market price, min-max normalised. Price coverage is 294 of 295 slots. |
| **play** | 0.40 | 0.45 × inverted log EDHREC rank — how many real decks run the card, across millions of lists — plus 0.20 × our own precon usage, plus 0.35 × tournament judgement (restricted / banned / game-changer). |
| **reference rarity** | 0.20 | common 0.0, uncommon 0.5, rare 1.0. An input, not a verdict. |

Value and play are deliberately equal. Price without play is a collector bubble; play
without price is a card everyone owns. The product of the two is what made the 1993 set
expensive, and it is the thing worth reproducing.

### 4.2 It finds the power cards on its own

Nothing about the top of the list was hand-placed. Ranks 1 through 9, straight out of the
score:

`E1-001` Genesis Lotus · `E1-263` Keys Shard · `E1-264` Signal Beacon · `E1-088` State
Reset · `E1-262` Bitcoin Seed · `E1-185` Freedom Market · **`E1-286` Timelock–Keys
Junction** · `E1-052` First Memory · `E1-266` Timelock Crystal

Eight of those are the reference set's own power cards. The seventh is a Junction — a card
we currently ship as a common. Rank 13 is `E1-270` Genesis Ring, whose reference slot is
the single most-played card in the entire game and which the reference set printed at
*uncommon* and regretted for thirty years.

Against our current rarities: 134 cards keep their band, 135 move up, 25 move up two bands
or more, and exactly one moves down two. The score is not shuffling the set — it is
sharpening the top of it.

### 4.3 Tiers

| tier | cards | copies each | total | share of mint | score band |
|---|---|---|---|---|---|
| Genesis | 9 | 21 | 189 | 0.15% | 0.715–0.820 |
| Vault | 21 | 63 | 1,323 | 1.05% | 0.582–0.714 |
| Rare | 90 | 216 | 19,440 | 15.48% | 0.410–0.581 |
| Uncommon | 75 | 279 | 20,925 | 16.66% | 0.263–0.406 |
| Common | 90 | 930 | 83,700 | 66.65% | 0.117–0.261 |
| Basic Resource | 10 | uncapped | — | — | not scored |

285 collectible cards, 125,577 capped copies, **20,925 packs**.

**More Rares than Uncommons, on purpose.** With one slot per pack, the chance of a *named*
card is driven by how many cards share that slot, so a fat Rare tier is what makes any
single Rare hard to find. The reference set had the same inverted shape; here it falls out
of wanting the ladder monotone rather than out of homage. The first draft of this document
got it wrong and shipped a Rare that was easier to find than an Uncommon.

### 4.4 The pack

**7 cards: 4 Common + 1 Uncommon + 1 Prime + 1 Basic Resource.** Six paid, seven in the
wrapper. The Prime slot draws from a single pool of 20,952 holding all Rare, Vault and
Genesis, and is the only slot where the tier is uncertain.

The Basic Resource is guaranteed, uncapped and free. The reference set treated lands as
filler that ate real slots; we treat them as the thing that must never be the reason a
player cannot build a deck. A guaranteed Resource costs nothing in scarcity — it sits
outside the pull entirely — and it is the modern convention for good reason.

Seven cards is also the answer to "give people more". Generosity belongs at the bottom of
the curve. Four commons a pack is a lot of cards; it costs nothing, because commons were
never the product.

### 4.5 Odds for one named card

| tier | copies | P per pack | one in |
|---|---|---|---|
| Common | 930 | 4.4444% | 22 |
| Uncommon | 279 | 1.3333% | 75 |
| Rare | 216 | 1.0309% | 97 |
| Vault | 63 | 0.3007% | 333 |
| **Genesis** | **21** | **0.1002%** | **998** |

Median packs to a first Genesis of any kind: **77**. Median packs to complete all 285:
**2,473**. Full cumulative tables in
[`handover/breno-mint-distribution.md`](handover/breno-mint-distribution.md) §2.

### 4.6 How much sharper this is

| | reference 1993 | 600B E1 |
|---|---|---|
| copy spread, floor to ceiling | 11 : 1 | **44 : 1** |
| top tier, share of the run | 6.7% | **0.15%** |
| copies of the best card, ever | 1,008 | **21** |
| packs per named top card | 121 | **998** |
| complete sets that can exist | unbounded | **21** |

Top tier is 8x rarer per pack, 44x more concentrated in the run, and **48x scarcer in
absolute supply**. The cap goes into the census commitment the mint publishes before the
first sale, so it is checkable rather than promised.

## 5. What this breaks, and the fix

At 21 copies, `E1-001` cannot be in eleven precons. It cannot be in one. Same for the
Junctions, which are Resources and therefore load-bearing for deckbuilding in a way a
spell is not.

The reference format answered this in 1994 with a restricted list, and it is still the
answer: **Genesis is limited to 1 copy per Stack.** Rulebook section 7 sets a flat copy
limit of 3, enforced by `MAX_COPIES` in the referee, so this needs a per-card override
rather than a global change.

Then the collectible and the playable separate cleanly:

- The 21 minted copies are the collectible: tradeable, and provably capped.
- Precons and the Stack Builder ship an untradeable play copy, so a new player builds the
  deck on day one and a Genesis card is worth owning because it is scarce, not because it
  gates the game.

That split is the part the 1993 set could not do, and it is what lets us go this far past
it without making the game pay-to-win.

## 6. Open decisions

1. **Weights.** 0.40 / 0.40 / 0.20 is a starting point, not a finding. Re-run
   `build_tier_census.py` after changing them and diff the census.
2. **Tier sizes.** 9 / 21 / 90 / 75 / 90 is a clean shape, but the cut between Genesis and
   Vault falls in a flat part of the score curve (0.715 against 0.714). Anything from 8 to
   12 Genesis cards is defensible.
3. **Mint size.** 20,925 packs falls out of the caps. The Genesis cap of 21 should stay
   fixed whatever the mint size; everything else scales.
4. **Price and who can buy the lot.** At `PRICE_MSAT = 21000` a pack is 126 sat and the
   whole mint is 0.0264 BTC. One buyer can drain it. See
   [`handover/breno-mint-distribution.md`](handover/breno-mint-distribution.md) §6.1.
5. **Re-tiering changes the published box commitment.** That is a fresh mint, not an edit.

## Sources

Print sheets and collation: The Collation Project. Production figures: Carta Mundi factory
archives, released 2021. Prices, play ranks and format legality: Scryfall, pulled
2026-08-19. Play demand also drawn from our own `site/precons.js`.
