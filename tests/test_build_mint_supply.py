"""The census the mint sells from: derived, internally consistent, and committed."""

import copy
import json

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


def test_the_genesis_cap_survives_the_pack_shape():
    # 21 copies is the promise a resize must not quietly spend: it is the number
    # of complete sets that can ever exist, and a bigger pack must not mint one.
    assert PRIME_CAPS["Genesis"] == 21
    assert all(c["copies"] == 21 for c in SHIPPED["cards"] if c["tier"] == "Genesis")


def test_the_ladder_is_monotone():
    # A Rare that is easier to find than an Uncommon shipped in the first draft
    # of the plan. Scarcer tier, scarcer card - checked, not remembered.
    ladder = ["Common", "Uncommon", "Rare", "Vault", "Genesis"]
    odds = [next(c["p_per_pack"] for c in SHIPPED["cards"] if c["tier"] == tier) for tier in ladder]
    assert odds == sorted(odds, reverse=True), dict(zip(ladder, odds, strict=True))
