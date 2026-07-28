"""Smoke tests for the placeholder card renderer."""

from pathlib import Path

from build_placeholders import (
    CARD_H,
    CARD_W,
    affinity_letters,
    cost_tokens,
    render_card,
)
from build_set import load_cards
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
CARDS_CSV = REPO_ROOT / "cards" / "cards.csv"


def test_cost_tokens():
    assert cost_tokens("4BB") == ["4", "B", "B"]
    assert cost_tokens("TT") == ["T", "T"]
    assert cost_tokens("1") == ["1"]
    assert cost_tokens("") == []


def test_affinity_from_cost_and_resource_subtype():
    cards = {c.name: c for c in load_cards(CARDS_CSV)}
    assert affinity_letters(cards["Power Surge"]) == "P"
    assert affinity_letters(cards["Power Plant"]) == "P"
    assert affinity_letters(cards["Backup Generator"]) == ""


def test_render_card_writes_png(tmp_path):
    card = load_cards(CARDS_CSV)[0]
    out = tmp_path / f"{card.name}.png"
    render_card(card, out)
    with Image.open(out) as img:
        assert img.size == (CARD_W, CARD_H)
