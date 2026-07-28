"""Unit tests for the final Edition One card renderer."""

import json
from pathlib import Path

from build_cards import fit_text, parse_cost, safe_filename
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_parse_cost_centers_each_resource_token():
    assert parse_cost("3SSS") == ["3", "S", "S", "S"]
    assert parse_cost("X1K") == ["X", "1", "K"]
    assert parse_cost("") == []


def test_safe_filename_preserves_readable_names():
    assert safe_filename("FLX, Culture Curator") == "FLX, Culture Curator.jpg"
    assert safe_filename("Signal / Keys") == "Signal _ Keys.jpg"
    assert Path(safe_filename("Genesis Lotus")).suffix == ".jpg"


def test_three_line_rule_fit_reports_long_copy_as_overflow():
    draw = ImageDraw.Draw(Image.new("RGB", (750, 1050)))

    _, short_lines, _, short_overflow = fit_text(
        draw,
        "Commit: generate 1 Bitcoin.",
        638,
        150,
        maximum=28,
        minimum=14,
        line_gap=6,
        max_lines=3,
    )
    _, long_lines, _, long_overflow = fit_text(
        draw,
        "word " * 300,
        638,
        150,
        maximum=28,
        minimum=14,
        line_gap=6,
        max_lines=3,
    )

    assert len(short_lines) <= 3
    assert short_overflow is False
    assert len(long_lines) > 3
    assert long_overflow is True


def test_final_card_manifest_contains_only_visible_text_metrics():
    manifest = json.loads(
        (REPO_ROOT / "art" / "cards" / "final" / "manifest.json").read_text(encoding="utf-8")
    )

    assert manifest["layout_version"] == "600B-E1-card-v2"
    assert manifest["overflow_count"] == 0
    assert all(item["metrics"]["rules_lines"] <= 3 for item in manifest["files"])
    assert all("guide_size" not in item["metrics"] for item in manifest["files"])
    assert all("note_size" not in item["metrics"] for item in manifest["files"])
