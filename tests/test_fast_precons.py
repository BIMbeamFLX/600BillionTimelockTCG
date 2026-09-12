"""Tests for the Fast (F1.0) preconstructed Stacks."""

import json
from pathlib import Path

from build_precons import FAST_HEADER, build_fast_precons, copy_limit, cost_total

REPO_ROOT = Path(__file__).resolve().parents[1]
TEXT = (REPO_ROOT / "site" / "play-data-fast.js").read_text(encoding="utf-8")
CARDS = json.loads(TEXT[TEXT.index("[") : TEXT.rindex("]") + 1])
BY_ID = {card["id"]: card for card in CARDS}
PRECONS = build_fast_precons(CARDS)


def test_the_committed_fast_precons_match_the_builder():
    body = json.dumps(PRECONS, indent=1, ensure_ascii=False)
    exports = 'if (typeof module === "object" && module.exports) module.exports = globalThis.E1_PRECONS_FAST;'
    expected = f"{FAST_HEADER}globalThis.E1_PRECONS_FAST = {body};\n{exports}\n"
    assert (REPO_ROOT / "site" / "precons-fast.js").read_text(encoding="utf-8") == expected


def test_one_starter_per_class_and_three_archetypes():
    starters = [p["affinity"] for p in PRECONS.values() if p["group"] == "Starter"]
    assert sorted(starters) == ["Bitcoin", "Keys", "Power", "Signal", "Timelock"]
    assert len([p for p in PRECONS.values() if p["group"] == "Archetype"]) == 3


def test_every_fast_stack_is_legal_and_resource_free():
    for name, precon in PRECONS.items():
        cards = precon["cards"]
        assert len(cards) == 40, name
        for card_id in set(cards):
            card = BY_ID[card_id]
            assert cards.count(card_id) <= copy_limit(card), (name, card_id)
            assert "Resource" not in card["type"], (name, card_id)
            assert not card["manual"], (name, card_id)
            assert precon["affinity"] in card["affinity"] or "Neutral" in card["affinity"], (name, card_id)


def test_every_fast_stack_has_a_curve():
    for name, precon in PRECONS.items():
        costs = [cost_total(BY_ID[card_id]) for card_id in precon["cards"]]
        avatars = sum(1 for card_id in precon["cards"] if "Avatar" in BY_ID[card_id]["type"])
        assert sum(1 for c in costs if c <= 2) >= 8, name
        assert avatars >= 14, name
