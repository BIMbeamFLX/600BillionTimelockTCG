"""Tests for the shared official 600B watermark placement."""

import json
from pathlib import Path

from brand_watermark import paste_subtle_watermark
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_watermark_is_subtle_and_placed_inside_lower_right_bounds():
    canvas = Image.new("RGB", (200, 160), (20, 20, 20))
    logo = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    ImageDraw.Draw(logo).ellipse((0, 0, 99, 99), fill=(255, 120, 0, 255))

    box = paste_subtle_watermark(
        canvas,
        logo,
        (20, 10, 180, 150),
        width_ratio=0.25,
        opacity=64,
        margin_ratio=0.05,
        right_inset_ratio=0.1,
    )

    assert box == (116, 102, 156, 142)
    assert canvas.getpixel((136, 122)) == (79, 45, 15)
    assert canvas.getpixel((20, 10)) == (20, 20, 20)


def test_watermark_rejects_invalid_geometry_and_opacity():
    canvas = Image.new("RGB", (100, 100))
    logo = Image.new("RGBA", (10, 10))

    for kwargs in (
        {"width_ratio": 0},
        {"width_ratio": 1},
        {"opacity": -1},
        {"opacity": 256},
        {"right_inset_ratio": -0.1},
        {"right_inset_ratio": 1},
    ):
        try:
            paste_subtle_watermark(canvas, logo, **kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected ValueError for {kwargs}")


def test_locked_art_manifest_records_one_official_watermark_per_card():
    manifest = json.loads(
        (
            REPO_ROOT / "art" / "generated" / "prompts-v2-final-1920x2400" / "manifest.json"
        ).read_text(encoding="utf-8")
    )

    assert manifest["format_version"] == "600B-E1-art-1920x2400-v3-preview-safe-watermark"
    assert len(manifest["files"]) == 295
    assert all(
        item["watermark"]["asset"] == "art/brand/600B-logo-primary.png"
        and item["watermark"]["placement"] == "bottom-right-preview-safe-inset"
        and item["watermark"]["right_inset_ratio"] >= 0.17
        and item["status"] == "art-locked-watermarked"
        for item in manifest["files"]
    )
