"""Consistency tests for the artist-generated Edition One prompt lock."""

import json
from pathlib import Path

from build_art_prompts import (
    ART_HEIGHT,
    ART_WIDTH,
    build_records,
    load_reference_index,
    validate_records,
)
from pending_art_prompts import pending_cards

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_cards() -> list[dict]:
    """Load canonical Edition One cards."""
    return json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]


def test_prompt_lock_has_one_unique_full_hd_brief_per_card():
    payload = json.loads(
        (REPO_ROOT / "art" / "prompts" / "e1-art-prompts.json").read_text(encoding="utf-8")
    )

    assert payload["artwork_size"] == [ART_WIDTH, ART_HEIGHT]
    assert payload["card_count"] == 295
    assert len({item["prompt_sha256"] for item in payload["cards"]}) == 295
    assert all(item["references"] for item in payload["cards"])
    assert all("procedural patterns" in item["prompt"] for item in payload["cards"])


def test_every_avatar_prompt_uses_detailed_front_identity_reference():
    cards = load_cards()
    reference_index = load_reference_index(
        REPO_ROOT / "art" / "references" / "join-detailed-front" / "manifest.json"
    )
    records = build_records(cards, reference_index)

    assert validate_records(records, cards) == []
    avatar_records = [
        record for record, card in zip(records, cards, strict=True) if "Avatar" in card["card_type"]
    ]
    assert len(avatar_records) == 92
    assert all(
        any(ref["role"].startswith("identity-lock:") for ref in record.references)
        for record in avatar_records
    )


def test_pending_batch_skips_existing_raw_art(tmp_path):
    payload = {
        "cards": [
            {"id": "E1-001", "name": "One", "prompt": "a", "references": []},
            {"id": "E1-002", "name": "Two", "prompt": "b", "references": []},
        ]
    }
    (tmp_path / "E1-001.png").write_bytes(b"generated")

    batch = pending_cards(payload, tmp_path, limit=8)

    assert [item["id"] for item in batch] == ["E1-002"]
