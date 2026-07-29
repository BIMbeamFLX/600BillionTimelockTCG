"""Tests for deterministic sacred-number art normalization."""

from pathlib import Path

from normalize_sacred_number_art import (
    CANONICAL_LINES,
    CANONICAL_VALUE,
    OVERLAYS,
    render_grid_badge,
    select_source,
)
from PIL import Image


def test_canonical_number_has_one_six_and_eleven_zeros() -> None:
    assert CANONICAL_VALUE == "600 000 000 000"
    assert CANONICAL_LINES == ("600", "000", "000", "000")
    assert "".join(CANONICAL_LINES).count("6") == 1
    assert "".join(CANONICAL_LINES).count("0") == 11


def test_all_reviewed_number_variants_have_overlays() -> None:
    expected = {
        "E1-003",
        "E1-034",
        "E1-051",
        "E1-071",
        "E1-081",
        "E1-091",
        "E1-095",
        "E1-106",
        "E1-120",
        "E1-124",
        "E1-128",
        "E1-151",
        "E1-161",
        "E1-192",
        "E1-198",
        "E1-225",
        "E1-256",
        "E1-268",
    }
    assert set(OVERLAYS) == expected


def test_render_grid_badge_has_requested_dimensions(tmp_path: Path) -> None:
    font = Path("art/fonts/Anton-Regular.ttf")
    badge = render_grid_badge((80, 120), font, filled=True)
    assert badge.mode == "RGBA"
    assert badge.size == (80, 120)
    output = tmp_path / "badge.png"
    badge.save(output)
    with Image.open(output) as saved:
        assert saved.getbbox() is not None


def test_select_source_prefers_cleaned_then_reframed(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    reframed = tmp_path / "reframed"
    cleaned = tmp_path / "cleaned"
    for directory in (raw, reframed, cleaned):
        directory.mkdir()
    (raw / "E1-001.png").write_bytes(b"raw")
    assert select_source("E1-001", raw, reframed, cleaned) == raw / "E1-001.png"
    (reframed / "E1-001.png").write_bytes(b"reframed")
    assert select_source("E1-001", raw, reframed, cleaned) == reframed / "E1-001.png"
    (cleaned / "E1-001.png").write_bytes(b"cleaned")
    assert select_source("E1-001", raw, reframed, cleaned) == cleaned / "E1-001.png"
