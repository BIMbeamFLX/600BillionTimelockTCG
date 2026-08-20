"""The census the mint sells from: derived, internally consistent, and committed."""

import copy
import json
import re

from build_mint_supply import CENSUS, PACKS, PRIME_CAPS, SLOTS, census_sha256, resize

SHIPPED = json.loads(CENSUS.read_text(encoding="utf-8"))


def test_the_shipped_census_is_what_the_generator_emits():
    """A hand edit to any supply number fails here rather than at the till."""
    assert resize(copy.deepcopy(SHIPPED)) == SHIPPED


def test_every_pool_drains_evenly_across_the_packs():
    mint = SHIPPED["mint"]
    for pool, size in mint["pool_size"].items():
        draws = PACKS * SLOTS[pool]
        assert size - draws == mint["retired_tail"][pool], f"{pool} tail is misreported"
        assert size >= draws, f"{pool} cannot fill {PACKS} packs"
    assert mint["cards_per_pack"] == sum(SLOTS.values())
    assert mint["paid_cards_per_pack"] == mint["cards_per_pack"] - SLOTS["basic"]
    assert mint["capped_cards"] == sum(mint["pool_size"].values())


def test_a_pool_holds_exactly_the_tiers_that_draw_from_it():
    for pool, size in SHIPPED["mint"]["pool_size"].items():
        tiers = [t for t in SHIPPED["tiers"].values() if t["pool"] == pool]
        assert sum(t["total_copies"] for t in tiers) == size
    for tier, meta in SHIPPED["tiers"].items():
        cards = [c for c in SHIPPED["cards"] if c["tier"] == tier]
        assert len(cards) == meta["cards"]
        assert all(c["copies"] == meta["copies_each"] for c in cards)


def test_the_commitment_is_recomputable_from_the_print_runs():
    # The recipe the mint hashes on boot (server/nutft-draw.js) and the shop
    # re-hashes against the served catalog (site/shop.js, recomputeCensus).
    counts = {c["id"]: c["copies"] for c in SHIPPED["cards"] if c["copies"]}
    assert len(counts) == 285, "Basics are uncapped, so they commit to nothing"
    assert census_sha256(counts) == SHIPPED["census_sha256"]


def test_the_prime_caps_are_a_decision_not_a_consequence(monkeypatch):
    """Widening the PACK must not mint a single Genesis copy. Only moving the cap does."""
    import build_mint_supply

    monkeypatch.setattr(build_mint_supply, "SLOTS", {**SLOTS, "common": 20, "uncommon": 6})
    wider = resize(copy.deepcopy(SHIPPED))

    assert wider["mint"]["cards_per_pack"] > SHIPPED["mint"]["cards_per_pack"]
    for tier, cap in PRIME_CAPS.items():
        assert wider["tiers"][tier]["copies_each"] == cap, f"{tier} moved with the pack"


def test_the_shipped_census_prints_the_caps_that_were_declared():
    # "Only N complete sets can ever exist" is exactly the Genesis cap, so the
    # census and the declaration have to be the same number in every place.
    for tier, cap in PRIME_CAPS.items():
        assert SHIPPED["tiers"][tier]["copies_each"] == cap
        assert all(c["copies"] == cap for c in SHIPPED["cards"] if c["tier"] == tier)


def test_the_ladder_is_monotone():
    # A Rare that is easier to find than an Uncommon shipped in the first draft
    # of the plan. Scarcer tier, scarcer card - checked, not remembered.
    ladder = ["Common", "Uncommon", "Rare", "Vault", "Genesis"]
    odds = [next(c["p_per_pack"] for c in SHIPPED["cards"] if c["tier"] == tier) for tier in ladder]
    assert odds == sorted(odds, reverse=True), dict(zip(ladder, odds, strict=True))


def test_the_shop_page_writes_none_of_the_mint_s_figures_down():
    """The page derives the box from the mint it is selling; a copy here only drifts.

    Every figure below used to be a literal in site/shop.js, and a resize made all
    of them wrong at once — the pack count, the print runs and the fingerprint the
    verify button re-hashes. The page reads /nutft/state and /nutft/catalog now,
    and this test is what stops a convenient constant creeping back in.
    """
    shop = (CENSUS.parent.parent / "site" / "shop.js").read_text(encoding="utf-8")
    mint, tiers = SHIPPED["mint"], SHIPPED["tiers"]
    figures = [
        mint["packs"],
        mint["capped_cards"],
        mint["packs"] * mint["cards_per_pack"],
        mint["packs"] * mint["paid_cards_per_pack"],
        *(t["total_copies"] for t in tiers.values() if t["total_copies"]),
    ]
    # Only figures long enough that a collision would be a coincidence, plus the
    # commitment, which could not be anything else.
    forbidden = [str(n) for n in figures if n >= 1000] + [SHIPPED["census_sha256"]]
    found = [n for n in forbidden if re.search(rf"{re.escape(n)}", shop)]
    assert not found, f"site/shop.js hardcodes mint figures that a resize will falsify: {found}"
