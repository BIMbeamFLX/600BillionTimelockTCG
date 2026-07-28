"""Tests for the dependency-free Edition One gallery."""

import json
from pathlib import Path

from build_gallery import gallery_records

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_gallery_joins_all_final_card_files():
    cards = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]
    manifest = json.loads(
        (REPO_ROOT / "art" / "cards" / "final" / "manifest.json").read_text(encoding="utf-8")
    )
    records = gallery_records(cards, manifest)

    assert len(records) == 295
    assert records[0]["id"] == "E1-001"
    assert records[0]["file"] == "Genesis Lotus.jpg"
    assert all(record["help"] and record["note"] and record["source"] for record in records)


def test_built_gallery_contains_complete_set_and_rulebook_link():
    gallery = (REPO_ROOT / "cards.html").read_text(encoding="utf-8")

    assert "All 295" in gallery
    assert "Genesis Lotus.jpg" in gallery
    assert 'href="index.html"' in gallery
    assert "Simple Guide" in gallery
