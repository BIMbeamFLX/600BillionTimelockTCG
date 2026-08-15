"""The booster box: auditable, deterministic, and honest about its odds."""

import hashlib

from build_shop_data import PRINT_RUN, build_box, build_shop_data, commitment, load_cards

CARDS = load_cards()
DATA = build_shop_data(CARDS, 600)


def test_the_box_holds_every_card_at_its_print_run():
    counts: dict[str, int] = {}
    for card_id in DATA["box"]:
        counts[card_id] = counts.get(card_id, 0) + 1
    for card in CARDS:
        want = PRINT_RUN.get(card.get("rarity", "common"), 1)
        assert counts.get(card["id"]) == want, (
            f"{card['id']} is in the box {counts.get(card['id'])}x, want {want}"
        )
    assert DATA["boxSize"] == sum(counts.values())


def test_the_shuffle_is_deterministic_and_the_commitment_matches():
    again = build_shop_data(CARDS, 600)
    assert again["box"] == DATA["box"], "same seed must give the same box"
    assert again["commitment"] == DATA["commitment"]
    # The commitment is recomputable by anyone holding the revealed order.
    digest = hashlib.sha256()
    for card_id in DATA["box"]:
        digest.update(card_id.encode())
        digest.update(b"\x00")
    assert digest.hexdigest() == DATA["commitment"], "the published hash must be checkable"


def test_a_different_seed_is_a_different_box():
    other = build_shop_data(CARDS, 601)
    assert other["box"] != DATA["box"]
    assert other["commitment"] != DATA["commitment"]
    assert sorted(other["box"]) == sorted(DATA["box"]), (
        "a reshuffle is a permutation, not a reprint"
    )


def test_the_shuffle_actually_shuffles():
    ordered = []
    for card in CARDS:
        ordered.extend([card["id"]] * PRINT_RUN.get(card.get("rarity", "common"), 1))
    assert build_box(CARDS, 600) != ordered, "an unshuffled box would leak the order"


def test_published_odds_match_the_box_contents():
    for rarity, percent in DATA["odds"].items():
        by_id = {c["id"]: c for c in CARDS}
        actual = sum(1 for cid in DATA["box"] if by_id[cid].get("rarity", "common") == rarity)
        assert round(100 * actual / DATA["boxSize"], 2) == percent, (
            f"{rarity} odds are misadvertised"
        )


def test_commitment_is_order_sensitive():
    assert commitment(["E1-001", "E1-002"]) != commitment(["E1-002", "E1-001"])
