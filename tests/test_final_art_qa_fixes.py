"""Tests for the deterministic final artwork QA fix inventory."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from apply_final_art_qa_fixes import (  # noqa: E402
    BRAND_OVERLAYS,
    CLEANUP_CARDS,
    FIX_CARD_IDS,
    GENERATIVE_FIXES,
)


def test_final_art_qa_fix_inventory_is_complete() -> None:
    """The reviewed 19-card QA finding set must stay fully represented."""
    assert len(FIX_CARD_IDS) == 19
    assert len(BRAND_OVERLAYS) == 13
    assert CLEANUP_CARDS == {"E1-120", "E1-125", "E1-128", "E1-184"}
    assert GENERATIVE_FIXES == {"E1-093", "E1-094", "E1-174"}


def test_every_brand_overlay_uses_an_exact_supported_kind() -> None:
    """Only deterministic official-logo, four-line-grid, and 600B badges are allowed."""
    supported = {"circle", "grid", "600b"}
    assert all(
        overlay.kind in supported for overlays in BRAND_OVERLAYS.values() for overlay in overlays
    )
    assert all(
        overlay.size[0] > 0 and overlay.size[1] > 0
        for overlays in BRAND_OVERLAYS.values()
        for overlay in overlays
    )
