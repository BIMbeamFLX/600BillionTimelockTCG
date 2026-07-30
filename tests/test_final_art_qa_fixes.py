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


def test_final_art_qa_fix_inventory_is_complete() -> None:
    """The reviewed QA finding set plus E1-202 revision must stay represented."""
    assert len(FIX_CARD_IDS) == 34
    assert FIX_CARD_IDS == GENERATIVE_FIXES
    assert {"E1-093", "E1-094", "E1-174", "E1-202"} <= GENERATIVE_FIXES


def test_no_post_generation_overlay_or_cleanup_inventory_remains() -> None:
    """Every reviewed fix must now be a scene-integrated ImageGen source."""
    module_text = (REPO_ROOT / "scripts" / "apply_final_art_qa_fixes.py").read_text(
        encoding="utf-8"
    )

    assert "BRAND_OVERLAYS" not in module_text
    assert "CLEANUP_CARDS" not in module_text
    assert "deterministic-brand-overlay" not in module_text
    assert "deterministic-cleanup" not in module_text
