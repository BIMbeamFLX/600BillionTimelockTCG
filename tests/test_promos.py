"""Tests for the separate promotional-card pipeline."""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_fips_promo_stays_outside_the_e1_text_lock() -> None:
    """The requested FIPS card must not silently change the 295-card set."""
    e1 = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))
    promos = json.loads((REPO_ROOT / "cards" / "promos.json").read_text(encoding="utf-8"))

    assert e1["set"]["card_count"] == 295
    assert len(e1["cards"]) == 295
    assert promos["set"]["card_count"] == 1
    assert [card["id"] for card in promos["cards"]] == ["FIPS-P01"]
    assert promos["cards"][0]["name"] == "Global FIPS Balloon Network"


def test_built_fips_promo_manifest_is_locked() -> None:
    """The generated promo face must be readable and represented in its manifest."""
    manifest = json.loads(
        (REPO_ROOT / "art" / "cards" / "promos" / "manifest.json").read_text(encoding="utf-8")
    )

    assert manifest["card_count"] == 1
    assert manifest["files"][0]["id"] == "FIPS-P01"
    assert manifest["files"][0]["art_watermark"]["asset"] == "art/brand/600B-logo-primary.png"
    assert manifest["files"][0]["status"] == "promo-locked"
