"""Tests for the dependency-free Edition One gallery."""

import json
from pathlib import Path

from build_gallery import gallery_records, promo_gallery_records

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_gallery_joins_all_final_card_files():
    cards = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]
    face_manifest = json.loads(
        (REPO_ROOT / "art" / "cards" / "node-runner-web" / "manifest.json").read_text(
            encoding="utf-8"
        )
    )
    records = gallery_records(cards, face_manifest)

    assert len(records) == 295
    assert records[0]["id"] == "E1-001"
    assert records[0]["faceFile"] == "Genesis Lotus.webp"
    assert records[201]["id"] == "E1-202"
    assert "fips.network" in records[201]["searchTags"]
    assert all(
        record["rules"] and record["flavor"] and record["help"] and record["note"]
        for record in records
    )


def test_gallery_adds_the_separate_fips_promo():
    promo_payload = json.loads((REPO_ROOT / "cards" / "promos.json").read_text(encoding="utf-8"))
    promo_manifest = json.loads(
        (REPO_ROOT / "art" / "cards" / "promos" / "manifest.json").read_text(encoding="utf-8")
    )

    records = promo_gallery_records(promo_payload["cards"], promo_manifest)

    assert len(records) == 1
    assert records[0]["id"] == "FIPS-P01"
    assert records[0]["promo"] is True
    assert "global balloon mesh" in records[0]["searchTags"]


def test_built_gallery_contains_complete_set_and_rulebook_link():
    gallery = (REPO_ROOT / "site" / "cards.html").read_text(encoding="utf-8")

    assert "All Cards." in gallery
    assert "Genesis Lotus.webp" in gallery
    assert "../art/cards/node-runner-web/" in gallery
    assert "Global FIPS Balloon Network" in gallery
    assert 'href="rules.html"' in gallery
    assert 'href="leaderboard.html"' in gallery
    assert "Artwork + Text" in gallery
    assert "Rules Text" in gallery
    assert '<html lang="en">' in gallery
    assert "Alle Karten" not in gallery
    assert "../art/generated/" not in gallery
