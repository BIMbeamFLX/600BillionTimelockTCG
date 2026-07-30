"""Tests for the scene-integrated final artwork QA fix inventory."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from apply_final_art_qa_fixes import (  # noqa: E402
    FIX_CARD_IDS,
    GENERATIVE_FIXES,
)
from sacred_number import CANONICAL_LINES, CANONICAL_VALUE  # noqa: E402


def test_final_art_qa_fix_inventory_is_complete() -> None:
    """The reviewed QA finding set plus E1-202 revision must stay represented."""
    assert len(FIX_CARD_IDS) == 35
    assert FIX_CARD_IDS == GENERATIVE_FIXES
    assert {"E1-093", "E1-094", "E1-174", "E1-202", "E1-286"} <= GENERATIVE_FIXES


def test_no_post_generation_overlay_or_cleanup_inventory_remains() -> None:
    """Every reviewed fix must now be a scene-integrated ImageGen source."""
    module_text = (REPO_ROOT / "scripts" / "apply_final_art_qa_fixes.py").read_text(
        encoding="utf-8"
    )

    assert "BRAND_OVERLAYS" not in module_text
    assert "CLEANUP_CARDS" not in module_text
    assert "deterministic-brand-overlay" not in module_text
    assert "deterministic-cleanup" not in module_text


def test_canonical_number_is_exactly_four_rows() -> None:
    """One 600 plus three 000 rows is the immutable six-hundred-billion mark."""
    assert CANONICAL_VALUE == "600 000 000 000"
    assert CANONICAL_LINES == ("600", "000", "000", "000")
    assert "".join(CANONICAL_LINES).count("6") == 1
    assert "".join(CANONICAL_LINES).count("0") == 11


def test_final_manifest_uses_no_legacy_overlay_sources() -> None:
    """No released artwork may resolve to the historical deterministic overlay batch."""
    import json

    manifest = json.loads(
        (
            REPO_ROOT / "art" / "generated" / "prompts-v2-final-1920x2400" / "manifest.json"
        ).read_text(encoding="utf-8")
    )

    assert all(
        "prompts-v2-sacred-number-v3" not in item["source_file"] for item in manifest["files"]
    )
    assert all("prompts-v2-qa-fixed" not in item["source_file"] for item in manifest["files"])
