"""Consistency tests for the canonical Edition One text lock."""

import json
import re
from collections import Counter
from pathlib import Path

from build_full_set import (
    CardRecord,
    CharacterRef,
    apply_editorial_lock,
    card_to_dict,
)

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


def test_every_card_has_help_note_source_art_brief_and_flavor():
    cards = load_payload()["cards"]

    assert all(card["rules_text"] for card in cards)
    assert all(card["help_text"] for card in cards)
    assert all(card["protocol_note"] for card in cards)
    assert all(card["protocol_source"].startswith("https://") for card in cards)
    assert all(card["art_direction"] and card["art_prompt"] for card in cards)
    assert all(card["flavor_text"] for card in cards)
    assert len({card["flavor_text"] for card in cards}) == 295


def test_editorial_copy_is_varied_sourced_and_free_of_legacy_terms():
    cards = load_payload()["cards"]
    note_counts = Counter(card["protocol_note"] for card in cards)
    tails = Counter(re.split(r"[;.!?]\s+", card["flavor_text"])[-1].casefold() for card in cards)
    public_text = "\n".join(
        "\n".join(
            (
                card["name"],
                card["rules_text"],
                card["flavor_text"],
                card["protocol_note"],
                card["art_direction"],
                card["art_prompt"],
            )
        )
        for card in cards
    )

    # A floor, not a pin. This used to assert == 148, which locked in the
    # generator's habit of printing each note on exactly two cards.
    assert len(note_counts) >= 250
    assert max(note_counts.values()) <= 2
    assert max(tails.values()) <= 2
    assert all(len(card["flavor_text"]) <= 110 for card in cards)
    assert all(len(card["protocol_note"]) <= 120 for card in cards)
    assert not re.search(
        r"regenerat\w*|\bhaste\b|nonblack|nonartifact|Deathtouch|Bullish|Web5",
        public_text,
        flags=re.IGNORECASE,
    )
    # "Wall" is a legacy creature type and is capitalised. A lowercase "wall" is
    # an ordinary noun that flavour text may use — this check was case-insensitive
    # and rejected lines like "Turns out the wall had opinions."
    assert not re.search(r"\bWalls?\b", public_text)

    sources = {card["protocol_source"] for card in cards}
    assert any("bitcoin/bips" in source for source in sources)
    assert any("nostr-protocol/nips" in source for source in sources)
    assert any("lightning/bolts" in source for source in sources)
    assert any("bitcoin/bitcoin" in source for source in sources)
    assert any(
        domain in source
        for source in sources
        for domain in ("activism.net", "chaum.com", "nakamotoinstitute.org")
    )


def test_audited_e1_fixes_and_keyword_reminders_are_locked():
    cards = {card["id"]: card for card in load_payload()["cards"]}
    broadcast = (
        "Broadcast (This Avatar can be blocked only by Avatars with Broadcast or Broadcast Guard.)"
    )
    shielded_keys = (
        "Shielded from Keys "
        "(It can't be targeted, attached, blocked or dealt damage by Keys sources.)"
    )

    assert cards["E1-001"]["rules_text"].endswith("generate 3 Resources of one affinity.")
    assert cards["E1-069"]["rules_text"] == broadcast
    assert cards["E1-093"]["rules_text"].splitlines() == [
        "Firewall (This Avatar can't attack.)",
        broadcast,
    ]
    assert shielded_keys in cards["E1-048"]["rules_text"]
    assert "Backchannel — Keys (This Avatar can't be blocked while" in cards["E1-098"]["rules_text"]
    assert cards["E1-170"]["rules_text"].startswith(
        "Whenever one or more Avatars you control attack,"
    )
    assert cards["E1-191"]["name"] == "Mtoshi, Lethal Courier"
    assert "non-Firewall Avatar" in cards["E1-191"]["rules_text"]
    assert "did not have Boot Delay" in cards["E1-204"]["rules_text"]


def test_raw_builder_editorial_lock_reproduces_canonical_copy():
    cards = load_payload()["cards"]
    record_fields = set(CardRecord.__dataclass_fields__)
    records: list[CardRecord] = []
    for card in cards:
        values = {key: value for key, value in card.items() if key in record_fields}
        if values["character"] is not None:
            values["character"] = CharacterRef(**values["character"])
        records.append(CardRecord(**values))

    locked, findings = apply_editorial_lock(records)

    assert findings == []
    assert [card_to_dict(card) for card in locked] == cards


def test_every_avatar_uses_official_600b_character_source():
    cards = load_payload()["cards"]
    avatars = [card for card in cards if "Avatar" in card["card_type"]]
    non_avatars = [card for card in cards if "Avatar" not in card["card_type"]]

    assert len(avatars) == 92
    assert all(
        card["character"]["source"] == "join.600.wtf / canonical Detailed ·front"
        for card in avatars
    )
    assert all(
        all(
            asset.startswith("art/references/join-detailed-front/")
            for asset in card["character"]["assets"]
        )
        for card in avatars
    )
    assert all(card["character"] is None for card in non_avatars)
