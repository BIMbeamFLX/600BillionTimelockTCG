"""Consistency tests for the canonical Edition One text lock."""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CARD_DATA = REPO_ROOT / "cards" / "e1-cards.json"


def load_payload() -> dict:
    """Load the committed canonical card data."""
    return json.loads(CARD_DATA.read_text(encoding="utf-8"))


def test_full_set_has_295_unique_cards():
    payload = load_payload()
    cards = payload["cards"]

    assert payload["set"]["card_count"] == 295
    assert len(cards) == 295
    assert len({card["id"] for card in cards}) == 295
    assert len({card["name"] for card in cards}) == 295
    assert all(card["status"] == "text-locked" for card in cards)


def test_iconic_cards_keep_locked_ids():
    cards = {card["id"]: card for card in load_payload()["cards"]}

    assert cards["E1-001"]["name"] == "Genesis Lotus"
    assert cards["E1-002"]["name"] == "Satoshi Orchard"
    assert cards["E1-003"]["name"] == "FLX, Culture Curator"
    assert cards["E1-004"]["name"] == "Zap"
    assert cards["E1-005"]["name"] == "Next Block"
    assert cards["E1-006"]["name"] == "Multisig Quorum"


def test_every_card_has_help_note_source_and_art_brief():
    cards = load_payload()["cards"]

    assert all(card["rules_text"] for card in cards)
    assert all(card["help_text"] for card in cards)
    assert all(card["protocol_note"] for card in cards)
    assert all(card["protocol_source"].startswith("https://") for card in cards)
    assert all(card["art_direction"] and card["art_prompt"] for card in cards)


def test_every_avatar_uses_official_600b_character_source():
    cards = load_payload()["cards"]
    avatars = [card for card in cards if "Avatar" in card["card_type"]]
    non_avatars = [card for card in cards if "Avatar" not in card["card_type"]]

    assert len(avatars) == 92
    assert all(
        card["character"]["source"] == "join.600.wtf / official 600B fullbody standard"
        for card in avatars
    )
    assert all(card["character"] is None for card in non_avatars)
