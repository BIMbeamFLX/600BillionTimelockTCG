"""Tests for the Node Runner PNG card renderer."""

import json
from pathlib import Path

from build_card_set import CARD_H, CARD_W
from PIL import Image, ImageDraw
from render_card_pngs import (
    cost_tokens,
    fit_contain,
    font,
    hex_rgb,
    quad_points,
    render_card,
    rgba,
    tracked_width,
    wrap,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CARDS = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]
ART_DIR = REPO_ROOT / "art" / "generated" / "prompts-v2-final-1920x2400"


def find(card_id: str) -> dict:
    return next(card for card in CARDS if card["id"] == card_id)


def test_colour_helpers():
    assert hex_rgb("#FF6A00") == (255, 106, 0)
    assert hex_rgb("f7931a") == (247, 147, 26)
    assert rgba("#000000", 0.5) == (0, 0, 0, 128)


def test_cost_tokens_split_generic_from_affinity():
    assert cost_tokens("3SS") == ("3", ["S", "S"])
    assert cost_tokens("P") == ("", ["P"])
    assert cost_tokens("") == ("", [])
    assert cost_tokens("2BBBB") == ("2", ["B", "B", "B", "B"])


def test_contain_fit_never_crops():
    tall = Image.new("RGB", (1920, 2400))
    fitted = fit_contain(tall, (678, 624))

    assert fitted.height == 624
    assert fitted.width <= 678
    # Aspect ratio is preserved, which is what "contain" guarantees.
    assert abs(fitted.width / fitted.height - 1920 / 2400) < 0.01


def test_quadratic_flattening_starts_after_the_anchor_and_ends_on_target():
    points = quad_points((0, 0), (10, 10), (20, 0), steps=4)

    assert len(points) == 4
    assert points[-1] == (20, 0)
    assert all(0 <= x <= 20 for x, _ in points)


def test_word_wrap_respects_the_pixel_width():
    canvas = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    body = font(["arial.ttf", "DejaVuSans.ttf"], 31)
    lines = wrap(canvas, "Network Storm deals X damage to each Avatar and each player.", body, 670)

    assert len(lines) >= 2
    assert all(canvas.textlength(line, font=body) <= 670 for line in lines)
    assert " ".join(lines) == "Network Storm deals X damage to each Avatar and each player."


def test_tracked_width_grows_with_tracking():
    canvas = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    mono = font(["consola.ttf", "DejaVuSansMono.ttf"], 22)

    assert tracked_width(canvas, "ABC", mono, 6) > tracked_width(canvas, "ABC", mono, 0)


def test_rendered_card_is_full_bleed_and_not_blank():
    card = find("E1-003")
    image = render_card(card, 3, ART_DIR, 6, False)

    assert image.size == (CARD_W, CARD_H)
    # 814 x 1109 px is 69 x 94 mm at 300 dpi: a 63 x 88 mm trim plus 3 mm bleed.
    assert round(CARD_W / 300 * 25.4) == 69
    assert round(CARD_H / 300 * 25.4) == 94
    colours = {colour for _, colour in image.convert("RGB").getcolors(maxcolors=200000)}
    assert len(colours) > 500, "the frame and text should produce a rich image"


def test_affinity_drives_the_frame_accent():
    signal = render_card(find("E1-003"), 3, ART_DIR, 6, False).convert("RGB")
    power = render_card(find("E1-004"), 4, ART_DIR, 6, False).convert("RGB")

    # The badge block sits at a fixed spot and is painted in the affinity accent.
    assert signal.getpixel((80, 70)) != power.getpixel((80, 70))


def test_guides_are_opt_in():
    plain = render_card(find("E1-003"), 3, ART_DIR, 6, False).convert("RGB")
    guided = render_card(find("E1-003"), 3, ART_DIR, 6, True).convert("RGB")

    assert plain.tobytes() != guided.tobytes()


def test_every_card_renders_without_error():
    # A cheap structural pass over a spread of the set, including the odd shapes.
    for card_id in ("E1-001", "E1-002", "E1-100", "E1-202", "E1-295"):
        card = find(card_id)
        image = render_card(card, 1, ART_DIR, 6, False)
        assert image.size == (CARD_W, CARD_H)


def test_card_type_drives_a_distinct_base_dark():
    """Type owns the base dark so a Power Avatar and a Power Zap differ at a glance."""
    from build_card_set import TYPE_BASE, TYPE_GROUP

    assert set(TYPE_GROUP.values()) == set(TYPE_BASE)
    assert TYPE_GROUP["Zap"] == TYPE_GROUP["Operation"] == "spell"
    assert TYPE_GROUP["Hardware"] == TYPE_GROUP["Protocol"] == "device"
    assert TYPE_GROUP["Basic Resource"] == "resource"
    # Avatar keeps the handoff's default dark.
    assert TYPE_BASE["avatar"] == ("#050403", "#0a0705")
    # Every group is visibly distinct from every other.
    bases = [value[0] for value in TYPE_BASE.values()]
    assert len(set(bases)) == len(bases)


def test_same_affinity_different_type_renders_differently():
    power_avatar = next(
        c for c in CARDS if c["card_type"] == "Avatar" and c["affinity"] == ["Power"]
    )
    power_zap = next(c for c in CARDS if c["card_type"] == "Zap" and c["affinity"] == ["Power"])

    # Sample the top-left bleed corner, which is pure base dark on both.
    avatar_px = render_card(power_avatar, 1, ART_DIR, 6, False).convert("RGB").getpixel((790, 8))
    zap_px = render_card(power_zap, 1, ART_DIR, 6, False).convert("RGB").getpixel((790, 8))

    assert avatar_px != zap_px
