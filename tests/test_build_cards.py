"""Unit tests for the Edition One card renderer and published release set."""

import hashlib
import json
from pathlib import Path

from build_cards import (
    AFFINITY_COLORS,
    AFFINITY_RAIL_BOUNDS,
    ART_CENTERING_OVERRIDES,
    affinity_rail_segments,
    bottom_aligned_text_y,
    draw_affinity_frame_rail,
    fit_text,
    frame_affinities,
    parse_cost,
    safe_filename,
    text_field_label,
)
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


def test_affinity_cost_rings_use_the_locked_resource_palette():
    # The locked E1 "Plate" palette, remapped by resource in the 2026-08-02
    # art handoff: Power yellow, Bitcoin orange, Keys white, Signal violet,
    # Timelock teal.
    assert AFFINITY_COLORS == {
        "Signal": (116, 71, 184),
        "Timelock": (23, 190, 187),
        "Keys": (255, 247, 236),
        "Power": (243, 194, 68),
        "Bitcoin": (247, 147, 26),
        "Neutral": (148, 163, 184),
    }


def test_frame_affinities_fall_back_to_neutral_and_remove_duplicates():
    assert frame_affinities({"affinity": []}) == ["Neutral"]
    assert frame_affinities({"affinity": ["Signal", "Signal"]}) == ["Signal"]


def test_multi_affinity_frame_segments_have_equal_height():
    segments = affinity_rail_segments(["Keys", "Power"], 116, 970)

    assert segments == [
        (116, 543, AFFINITY_COLORS["Keys"]),
        (543, 970, AFFINITY_COLORS["Power"]),
    ]


def test_frame_rail_is_wide_vertical_pattern_with_both_resource_colors():
    image = Image.new("RGB", (750, 1050))
    draw_affinity_frame_rail(ImageDraw.Draw(image), ["Bitcoin", "Signal"])

    left, top, right, bottom = AFFINITY_RAIL_BOUNDS
    assert right - left >= 40
    assert bottom - top > 800
    assert image.getpixel((left + 6, 200)) == AFFINITY_COLORS["Bitcoin"]
    assert image.getpixel((left + 6, 700)) == AFFINITY_COLORS["Signal"]
    rail_colors = {image.getpixel((x, y)) for x in range(left, right) for y in range(180, 260)}
    assert len(rail_colors) >= 3


def test_fips_submarine_crop_keeps_the_launch_bays_visible():
    assert ART_CENTERING_OVERRIDES["E1-202"] == (0.5, 0.65)


def test_rules_field_label_matches_rules_taxonomy():
    assert text_field_label({"card_type": "Zap", "rules_text": "Deal 3 damage."}) == "PLAY"
    assert (
        text_field_label(
            {"card_type": "Basic Resource", "rules_text": "Commit: generate 1 Bitcoin."}
        )
        == "ABILITY"
    )
    assert (
        text_field_label(
            {
                "card_type": "Protocol",
                "rules_text": "Whenever a Resource enters, draw a card.",
            }
        )
        == "TRIGGER"
    )
    assert text_field_label({"card_type": "Avatar", "rules_text": "Firewall."}) == "STATIC"


def test_flavor_block_is_anchored_to_the_bottom():
    assert bottom_aligned_text_y(1, 24, 904) == 880
    assert bottom_aligned_text_y(2, 24, 904) == 856


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


def test_release_card_manifest_matches_every_published_webp():
    release_dir = REPO_ROOT / "art" / "cards" / "node-runner-web"
    manifest = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["source"] == "node-runner-web"
    assert manifest["count"] == 297
    assert sum(item["id"] is not None for item in manifest["files"]) == 295
    assert {path.name for path in release_dir.glob("*.webp")} == {
        item["file"] for item in manifest["files"]
    }
    for item in manifest["files"]:
        payload = (release_dir / item["file"]).read_bytes()
        assert len(payload) == item["bytes"]
        assert hashlib.sha256(payload).hexdigest() == item["sha256"]
