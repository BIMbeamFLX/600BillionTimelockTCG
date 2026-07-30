"""Render all Edition One card faces after text and standalone art are locked.

The layout is purpose-built for the 600B cypherpunk identity: resource-coded frame
stripes, black art core, purple structure, centered resource symbols and a light
rules field with black body text. Learning notes, canon and prompt data stay in the
game metadata instead of appearing on the collectible card face.

Usage:
    python scripts/build_cards.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
import sqlite3
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from brand_watermark import paste_subtle_watermark
from PIL import Image, ImageDraw, ImageFont, ImageOps

log = logging.getLogger("build_cards")

CARD_WIDTH = 750
CARD_HEIGHT = 1050
LAYOUT_VERSION = "600B-E1-card-v5"

ORANGE = (255, 106, 0)
PURPLE = (116, 71, 184)
ULTRAVIOLET = (94, 90, 203)
BLACK = (13, 12, 16)
SOOT = (20, 18, 24)
CREAM = (255, 247, 236)
PANEL = (241, 236, 247)
INK = (20, 17, 24)
MUTED = (84, 70, 102)

AFFINITY_COLORS = {
    "Signal": (155, 81, 224),
    "Timelock": (61, 90, 254),
    "Keys": (45, 190, 96),
    "Power": (0, 184, 217),
    "Bitcoin": (247, 147, 26),
    "Neutral": (148, 163, 184),
}

AFFINITY_RAIL_BOUNDS = (22, 116, 64, 970)

ART_CENTERING_OVERRIDES = {
    "E1-202": (0.5, 0.65),
}


@dataclass(frozen=True)
class RenderMetrics:
    """Readability metrics for one finished card."""

    title_size: int
    rules_size: int
    rules_lines: int
    flavor_size: int
    flavor_lines: int
    flavor_y: int
    text_label: str
    overflow: bool


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    """Load a bundled or system font."""
    return ImageFont.truetype(str(path), size)


def body_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Load the Windows body font used for highly readable rules text."""
    filename = "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(filename, size)


def flavor_font(size: int) -> ImageFont.FreeTypeFont:
    """Load the italic collectible-copy face."""
    return ImageFont.truetype("ariali.ttf", size)


def parse_cost(cost: str) -> list[str]:
    """Split a compact cost such as 3SSS into centered visual tokens."""
    tokens: list[str] = []
    digits = ""
    for character in cost:
        if character.isdigit():
            digits += character
            continue
        if digits:
            tokens.append(digits)
            digits = ""
        tokens.append(character.upper())
    if digits:
        tokens.append(digits)
    return tokens


def affinity_from_code(code: str) -> str:
    """Resolve a compact resource code to its public affinity name."""
    return {
        "S": "Signal",
        "T": "Timelock",
        "K": "Keys",
        "P": "Power",
        "B": "Bitcoin",
    }[code]


def draw_resource_icon(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    radius: int,
    affinity: str,
) -> None:
    """Draw one optically centered resource icon from the official geometry."""
    cx, cy = center
    accent = AFFINITY_COLORS[affinity]
    line = max(2, radius // 9)
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=BLACK,
        outline=accent,
        width=line,
    )
    cream = CREAM

    if affinity == "Power":
        points = [
            (cx + radius * 0.12, cy - radius * 0.68),
            (cx - radius * 0.40, cy + radius * 0.10),
            (cx - radius * 0.04, cy + radius * 0.10),
            (cx - radius * 0.16, cy + radius * 0.70),
            (cx + radius * 0.46, cy - radius * 0.08),
            (cx + radius * 0.08, cy - radius * 0.08),
        ]
        draw.polygon(points, fill=cream)
        return

    if affinity == "Bitcoin":
        glyph_font = body_font(round(radius * 1.30), bold=True)
        draw.text((cx, cy + 1), "B", font=glyph_font, fill=cream, anchor="mm")
        stem_x = radius * 0.20
        for x_offset in (-stem_x, stem_x):
            draw.line(
                (
                    cx + x_offset,
                    cy - radius * 0.68,
                    cx + x_offset,
                    cy + radius * 0.68,
                ),
                fill=cream,
                width=max(2, radius // 10),
            )
        return

    if affinity == "Keys":
        ring_center = (cx - round(radius * 0.28), cy - round(radius * 0.18))
        ring_radius = round(radius * 0.23)
        draw.ellipse(
            (
                ring_center[0] - ring_radius,
                ring_center[1] - ring_radius,
                ring_center[0] + ring_radius,
                ring_center[1] + ring_radius,
            ),
            outline=cream,
            width=line,
        )
        start = (
            ring_center[0] + round(ring_radius * 0.7),
            ring_center[1] + round(ring_radius * 0.7),
        )
        end = (cx + round(radius * 0.55), cy + round(radius * 0.52))
        draw.line((start, end), fill=cream, width=line)
        draw.line(
            (
                cx + round(radius * 0.26),
                cy + round(radius * 0.23),
                cx + round(radius * 0.26),
                cy + round(radius * 0.50),
            ),
            fill=cream,
            width=line,
        )
        draw.line(
            (
                cx + round(radius * 0.43),
                cy + round(radius * 0.39),
                cx + round(radius * 0.43),
                cy + round(radius * 0.62),
            ),
            fill=cream,
            width=line,
        )
        return

    if affinity == "Signal":
        dot_radius = max(2, radius // 10)
        draw.ellipse(
            (
                cx - dot_radius,
                cy + round(radius * 0.38) - dot_radius,
                cx + dot_radius,
                cy + round(radius * 0.38) + dot_radius,
            ),
            fill=cream,
        )
        for factor in (0.42, 0.68, 0.92):
            arc_radius = round(radius * factor)
            box = (
                cx - arc_radius,
                cy - round(arc_radius * 0.50),
                cx + arc_radius,
                cy + round(arc_radius * 1.50),
            )
            draw.arc(box, start=215, end=325, fill=cream, width=line)
        return

    lock_width = round(radius * 0.95)
    lock_height = round(radius * 0.70)
    left = cx - lock_width // 2
    top = cy - round(radius * 0.02)
    draw.rounded_rectangle(
        (left, top, left + lock_width, top + lock_height),
        radius=max(3, radius // 8),
        outline=cream,
        width=line,
    )
    draw.arc(
        (
            cx - round(radius * 0.34),
            cy - round(radius * 0.62),
            cx + round(radius * 0.34),
            cy + round(radius * 0.12),
        ),
        start=180,
        end=360,
        fill=cream,
        width=line,
    )
    clock_radius = round(radius * 0.22)
    clock_center = (cx, cy + round(radius * 0.32))
    draw.ellipse(
        (
            clock_center[0] - clock_radius,
            clock_center[1] - clock_radius,
            clock_center[0] + clock_radius,
            clock_center[1] + clock_radius,
        ),
        outline=cream,
        width=max(1, line - 1),
    )
    draw.line(
        (
            clock_center,
            (clock_center[0], clock_center[1] - round(clock_radius * 0.60)),
        ),
        fill=cream,
        width=max(1, line - 1),
    )
    draw.line(
        (
            clock_center,
            (
                clock_center[0] + round(clock_radius * 0.50),
                clock_center[1] + round(clock_radius * 0.25),
            ),
        ),
        fill=cream,
        width=max(1, line - 1),
    )


def draw_generic_cost(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    radius: int,
    token: str,
    display_font: Path,
) -> None:
    """Draw an optically centered neutral or X cost."""
    cx, cy = center
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=BLACK,
        outline=PURPLE,
        width=max(2, radius // 8),
    )
    size = round(radius * (1.30 if len(token) == 1 else 1.02))
    draw.text(
        (cx, cy + 1),
        token,
        font=font(display_font, size),
        fill=CREAM,
        anchor="mm",
    )


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    text_font: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    """Wrap paragraphs without changing authored wording."""
    lines: list[str] = []
    for paragraph in text.splitlines():
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if draw.textlength(candidate, font=text_font) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    max_height: int,
    maximum: int,
    minimum: int,
    line_gap: int = 3,
    max_lines: int | None = None,
) -> tuple[ImageFont.FreeTypeFont, list[str], int, bool]:
    """Fit one text block and report whether the minimum size still overflows."""
    for size in range(maximum, minimum - 1, -1):
        text_font = body_font(size)
        lines = wrap_text(draw, text, text_font, max_width)
        line_height = size + line_gap
        line_count_fits = max_lines is None or len(lines) <= max_lines
        if line_count_fits and len(lines) * line_height <= max_height:
            return text_font, lines, line_height, False
    text_font = body_font(minimum)
    lines = wrap_text(draw, text, text_font, max_width)
    height_overflow = len(lines) * (minimum + line_gap) > max_height
    line_overflow = max_lines is not None and len(lines) > max_lines
    return text_font, lines, minimum + line_gap, height_overflow or line_overflow


def fit_flavor_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    maximum: int = 19,
    minimum: int = 13,
) -> tuple[ImageFont.FreeTypeFont, list[str], int, bool]:
    """Fit a short flavor quote into at most two lines."""
    quoted = f"“{text}”"
    for size in range(maximum, minimum - 1, -1):
        text_font = flavor_font(size)
        lines = wrap_text(draw, quoted, text_font, max_width)
        if len(lines) <= 2:
            return text_font, lines, size + 5, False
    text_font = flavor_font(minimum)
    lines = wrap_text(draw, quoted, text_font, max_width)
    return text_font, lines, minimum + 5, len(lines) > 2


def draw_lines(
    draw: ImageDraw.ImageDraw,
    lines: Iterable[str],
    position: tuple[int, int],
    text_font: ImageFont.FreeTypeFont,
    line_height: int,
    fill: tuple[int, int, int],
) -> None:
    """Draw a wrapped block line by line."""
    x, y = position
    for line in lines:
        draw.text((x, y), line, font=text_font, fill=fill)
        y += line_height


def fit_title(
    draw: ImageDraw.ImageDraw,
    title: str,
    display_font: Path,
    max_width: int,
) -> tuple[ImageFont.FreeTypeFont, int]:
    """Fit a one-line title without touching the centered cost symbols."""
    for size in range(38, 19, -1):
        title_font = font(display_font, size)
        if draw.textlength(title, font=title_font) <= max_width:
            return title_font, size
    return font(display_font, 20), 20


def rounded_paste(
    canvas: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    centering: tuple[float, float] = (0.5, 0.5),
) -> None:
    """Paste an image through a clean rounded mask."""
    left, top, right, bottom = box
    fitted = ImageOps.fit(
        source.convert("RGB"),
        (right - left, bottom - top),
        method=Image.Resampling.LANCZOS,
        centering=centering,
    )
    mask = Image.new("L", fitted.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, fitted.width - 1, fitted.height - 1),
        radius=radius,
        fill=255,
    )
    canvas.paste(fitted, (left, top), mask)


def card_affinity(card: dict[str, Any]) -> str:
    """Return the primary visual affinity."""
    affinities = card["affinity"]
    return affinities[0] if len(affinities) == 1 else "Neutral"


def frame_affinities(card: dict[str, Any]) -> list[str]:
    """Return ordered, unique affinities for the card's frame stripe."""
    affinities = list(dict.fromkeys(card["affinity"]))
    return affinities or ["Neutral"]


def affinity_rail_segments(
    affinities: list[str],
    top: int,
    bottom: int,
) -> list[tuple[int, int, tuple[int, int, int]]]:
    """Split the vertical resource rail into equal, gapless affinity segments."""
    if not affinities:
        affinities = ["Neutral"]
    span = bottom - top
    return [
        (
            top + span * index // len(affinities),
            top + span * (index + 1) // len(affinities),
            AFFINITY_COLORS[affinity],
        )
        for index, affinity in enumerate(affinities)
    ]


def draw_affinity_frame_rail(
    draw: ImageDraw.ImageDraw,
    affinities: list[str],
) -> None:
    """Draw one wide, patterned resource rail with a stepped inner edge."""
    left, top, right, bottom = AFFINITY_RAIL_BOUNDS
    draw.polygon(
        (
            (left - 4, top - 12),
            (right - 8, top - 12),
            (right + 5, top + 5),
            (right - 2, bottom - 5),
            (right - 12, bottom + 12),
            (left - 4, bottom + 12),
        ),
        fill=(8, 8, 11),
        outline=PURPLE,
    )
    for segment_top, segment_bottom, color in affinity_rail_segments(
        affinities,
        top,
        bottom,
    ):
        mid = (segment_top + segment_bottom) // 2
        points = (
            (left, segment_top),
            (right - 10, segment_top),
            (right + 2, min(segment_top + 18, segment_bottom)),
            (right - 7, min(segment_top + 44, segment_bottom)),
            (right + 3, mid),
            (right - 7, max(segment_bottom - 44, segment_top)),
            (right + 2, max(segment_bottom - 18, segment_top)),
            (right - 10, segment_bottom),
            (left, segment_bottom),
        )
        draw.polygon(points, fill=color)
        pattern = tuple(max(0, channel - 55) for channel in color)
        highlight = tuple(min(255, channel + 42) for channel in color)
        for y in range(segment_top + 10, segment_bottom - 7, 34):
            draw.line(
                (left + 5, y, right - 7, min(y + 22, segment_bottom - 2)),
                fill=pattern,
                width=6,
            )
        draw.line(
            (left + 2, segment_top, left + 2, segment_bottom),
            fill=highlight,
            width=2,
        )
    draw.polygon(
        ((left, top), (right - 10, top), (right + 5, top + 15), (left, top + 15)),
        fill=CREAM,
    )
    draw.polygon(
        (
            (left, bottom - 15),
            (right + 5, bottom - 15),
            (right - 10, bottom),
            (left, bottom),
        ),
        fill=BLACK,
        outline=CREAM,
    )


def draw_futuristic_corner_brackets(
    draw: ImageDraw.ImageDraw,
    accent: tuple[int, int, int],
) -> None:
    """Add layered chamfered brackets instead of decorative straight cuts."""
    draw.polygon(
        ((20, 78), (20, 28), (82, 28), (68, 40), (36, 40), (36, 64)),
        fill=accent,
    )
    draw.polygon(
        ((730, 78), (730, 28), (668, 28), (682, 40), (714, 40), (714, 64)),
        fill=ULTRAVIOLET,
    )
    draw.polygon(
        ((20, 972), (20, 1022), (82, 1022), (68, 1010), (36, 1010), (36, 986)),
        fill=ULTRAVIOLET,
    )
    draw.polygon(
        ((730, 972), (730, 1022), (668, 1022), (682, 1010), (714, 1010), (714, 986)),
        fill=accent,
    )


def text_field_label(card: dict[str, Any]) -> str:
    """Classify the visible rules block without changing its gameplay meaning."""
    if card["card_type"] in {"Zap", "Operation"}:
        return "PLAY"
    rules = card["rules_text"]
    if re.search(r"(?m)^[^.\n]{1,80}:\s", rules) or re.search(
        r"\bCommit(?:\s+—\s+[^:]+)?:",
        rules,
    ):
        return "ABILITY"
    if re.search(r"(?im)(?:^|\n)(?:when|whenever|at)\b", rules):
        return "TRIGGER"
    return "STATIC"


def bottom_aligned_text_y(line_count: int, line_height: int, bottom: int) -> int:
    """Return the top coordinate for a text block anchored to a fixed bottom."""
    return bottom - line_count * line_height


def draw_cost_row(
    draw: ImageDraw.ImageDraw,
    card: dict[str, Any],
    display_font: Path,
) -> tuple[int, int]:
    """Draw cost or Resource identity symbols, centered within equal cells."""
    tokens = parse_cost(card["cost"])
    if not tokens and card["card_type"].endswith("Resource"):
        tokens = [
            next(code for code in "STKPB" if affinity_from_code(code) == affinity)
            for affinity in card["affinity"]
        ]
    radius = 24
    gap = 7
    width = len(tokens) * (radius * 2) + max(0, len(tokens) - 1) * gap
    start_x = CARD_WIDTH - 44 - width + radius
    for index, token in enumerate(tokens):
        center = (start_x + index * (radius * 2 + gap), 66)
        if token in "STKPB":
            draw_resource_icon(draw, center, radius, affinity_from_code(token))
        else:
            draw_generic_cost(draw, center, radius, token, display_font)
    return width, start_x


def draw_type_badge(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    card_type: str,
    accent: tuple[int, int, int],
) -> None:
    """Draw a small code-native card-type glyph."""
    cx, cy = center
    draw.rounded_rectangle(
        (cx - 18, cy - 18, cx + 18, cy + 18),
        radius=8,
        fill=BLACK,
        outline=accent,
        width=2,
    )
    if "Avatar" in card_type:
        draw.ellipse((cx - 6, cy - 10, cx + 6, cy + 2), outline=CREAM, width=2)
        draw.arc((cx - 12, cy - 1, cx + 12, cy + 18), 180, 360, fill=CREAM, width=2)
    elif "Resource" in card_type:
        draw.polygon(
            [(cx, cy - 11), (cx + 11, cy), (cx, cy + 11), (cx - 11, cy)],
            outline=CREAM,
        )
    elif card_type == "Hardware":
        draw.rectangle((cx - 9, cy - 9, cx + 9, cy + 9), outline=CREAM, width=2)
        draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=CREAM)
    elif card_type == "Protocol":
        for offset in (-7, 0, 7):
            draw.line((cx - 10, cy + offset, cx + 10, cy + offset), fill=CREAM, width=2)
    else:
        draw.line((cx - 9, cy + 9, cx + 9, cy - 9), fill=CREAM, width=3)
        draw.line((cx - 7, cy - 5, cx + 8, cy + 5), fill=CREAM, width=2)


def draw_stats(
    draw: ImageDraw.ImageDraw,
    stats: str,
    display_font: Path,
) -> None:
    """Draw a combined centered Action/Resilience module."""
    action, resilience = stats.split("/", maxsplit=1)
    left, top, right, bottom = 558, 547, 714, 615
    draw.rounded_rectangle(
        (left, top, right, bottom),
        radius=20,
        fill=BLACK,
        outline=ORANGE,
        width=4,
    )
    draw.line(
        ((left + right) // 2, top + 11, (left + right) // 2, bottom - 11),
        fill=PURPLE,
        width=2,
    )
    number_font = font(display_font, 37)
    label_font = font(display_font, 12)
    draw.text((597, 568), action, font=number_font, fill=CREAM, anchor="mm")
    draw.text((675, 568), resilience, font=number_font, fill=CREAM, anchor="mm")
    draw.text((597, 600), "ACTION", font=label_font, fill=ORANGE, anchor="mm")
    draw.text((675, 600), "RESILIENCE", font=label_font, fill=ULTRAVIOLET, anchor="mm")


def draw_card(
    card: dict[str, Any],
    artwork: Image.Image,
    logo: Image.Image,
    display_font: Path,
) -> tuple[Image.Image, RenderMetrics]:
    """Render one final website- and print-ready card face."""
    canvas = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), SOOT)
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle((9, 9, 741, 1041), radius=42, fill=SOOT)
    draw.rounded_rectangle((20, 20, 730, 1030), radius=34, fill=BLACK)
    draw.rounded_rectangle((29, 29, 721, 1021), radius=28, outline=PURPLE, width=3)
    draw.line(
        ((42, 106), (218, 106), (232, 99), (498, 99), (512, 106), (708, 106)),
        fill=ORANGE,
        width=3,
        joint="curve",
    )

    affinity = card_affinity(card)
    accent = AFFINITY_COLORS[affinity]
    cost_width, _ = draw_cost_row(draw, card, display_font)
    max_title_width = CARD_WIDTH - 92 - cost_width - (18 if cost_width else 0)
    title_font, title_size = fit_title(draw, card["name"], display_font, max_title_width)
    draw.text((50, 66), card["name"], font=title_font, fill=CREAM, anchor="lm")

    # The artwork sits inside a deliberate black mat instead of touching the UI.
    # This keeps generated scenes collectible and prevents accidental edge clutter.
    art_mat = (36, 116, 714, 536)
    art_box = (48, 128, 702, 524)
    draw.rounded_rectangle(art_mat, radius=22, fill=BLACK, outline=ORANGE, width=4)
    draw.rounded_rectangle((42, 122, 708, 530), radius=18, outline=PURPLE, width=2)
    art_centering = ART_CENTERING_OVERRIDES.get(
        card["id"],
        (0.5, 0.0) if "Avatar" in card["card_type"] else (0.5, 0.5),
    )
    rounded_paste(canvas, artwork, art_box, radius=14, centering=art_centering)
    paste_subtle_watermark(canvas, logo, art_box)
    draw.rounded_rectangle(art_box, radius=14, outline=accent, width=2)

    draw.rounded_rectangle((36, 544, 714, 621), radius=18, fill=(31, 24, 42))
    draw.rectangle((36, 580, 714, 621), fill=(31, 24, 42))
    draw.line((36, 618, 714, 618), fill=accent, width=3)
    draw_type_badge(draw, (82, 582), card["card_type"], accent)
    type_font = font(display_font, 24)
    type_line = card["type_line"].upper()
    draw.text((112, 582), type_line, font=type_font, fill=CREAM, anchor="lm")
    if card["action_resilience"]:
        draw_stats(draw, card["action_resilience"], display_font)

    draw.rounded_rectangle((36, 630, 714, 966), radius=18, fill=PANEL)
    draw.rectangle((36, 650, 714, 946), fill=PANEL)
    draw.line((48, 642, 702, 642), fill=PURPLE, width=2)
    x = 76
    max_width = 618
    label_font = font(display_font, 13)

    rules_label = text_field_label(card)
    draw.text((x, 655), rules_label, font=label_font, fill=PURPLE)
    rules_font, rules_lines, rules_height, rules_overflow = fit_text(
        draw,
        card["rules_text"],
        max_width,
        150,
        maximum=28,
        minimum=14,
        line_gap=6,
        max_lines=3,
    )
    draw_lines(draw, rules_lines, (x, 681), rules_font, rules_height, INK)

    draw.line((76, 816, 694, 816), fill=(199, 185, 214), width=1)
    flavor_text_font, flavor_lines, flavor_height, flavor_overflow = fit_flavor_text(
        draw,
        card["flavor_text"],
        600,
    )
    flavor_y = bottom_aligned_text_y(len(flavor_lines), flavor_height, 904)
    draw_lines(
        draw,
        flavor_lines,
        (74, flavor_y),
        flavor_text_font,
        flavor_height,
        MUTED,
    )

    # Educational notes, canon and art-generation data remain in the game UI.
    draw.line((76, 918, 694, 918), fill=(199, 185, 214), width=1)
    rarity_font = font(display_font, 13)
    draw.text((76, 938), card["rarity"].upper(), font=rarity_font, fill=MUTED)
    affinity_label = " + ".join(card["affinity"]).upper() or "OPEN"
    draw.text((694, 938), affinity_label, font=rarity_font, fill=PURPLE, anchor="ra")

    draw.rectangle((36, 975, 714, 1014), fill=BLACK)
    mini_logo = ImageOps.contain(logo.convert("RGBA"), (27, 27), Image.Resampling.LANCZOS)
    canvas.paste(mini_logo, (48, 981), mini_logo)
    footer_font = font(display_font, 15)
    draw.text(
        (86, 995),
        "600 BILLION · TIMELOCK TCG",
        font=footer_font,
        fill=CREAM,
        anchor="lm",
    )
    draw.text((698, 995), card["id"], font=footer_font, fill=ORANGE, anchor="rm")

    draw_affinity_frame_rail(draw, frame_affinities(card))
    draw_futuristic_corner_brackets(draw, accent)

    return canvas, RenderMetrics(
        title_size=title_size,
        rules_size=rules_font.size,
        rules_lines=len(rules_lines),
        flavor_size=flavor_text_font.size,
        flavor_lines=len(flavor_lines),
        flavor_y=flavor_y,
        text_label=rules_label,
        overflow=rules_overflow or flavor_overflow,
    )


def draw_card_back(
    logo: Image.Image,
    display_font: Path,
) -> Image.Image:
    """Render the shared symmetrical Edition One card back."""
    canvas = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), ORANGE)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((9, 9, 741, 1041), radius=42, fill=ORANGE)
    draw.rounded_rectangle((22, 22, 728, 1028), radius=34, fill=BLACK)
    draw.rounded_rectangle((34, 34, 716, 1016), radius=28, outline=PURPLE, width=4)

    center = (CARD_WIDTH // 2, CARD_HEIGHT // 2)
    for radius, color, width in (
        (286, PURPLE, 4),
        (236, ORANGE, 3),
        (190, ULTRAVIOLET, 3),
        (145, PURPLE, 2),
    ):
        draw.ellipse(
            (
                center[0] - radius,
                center[1] - radius,
                center[0] + radius,
                center[1] + radius,
            ),
            outline=color,
            width=width,
        )
    for index in range(12):
        angle = math.tau * index / 12
        inner = 302
        outer = 326
        draw.line(
            (
                center[0] + math.cos(angle) * inner,
                center[1] + math.sin(angle) * inner,
                center[0] + math.cos(angle) * outer,
                center[1] + math.sin(angle) * outer,
            ),
            fill=ORANGE if index % 2 == 0 else PURPLE,
            width=4,
        )

    logo_size = 235
    mark = ImageOps.contain(logo.convert("RGBA"), (logo_size, logo_size), Image.Resampling.LANCZOS)
    canvas.paste(mark, (center[0] - mark.width // 2, center[1] - 165), mark)
    title_font = font(display_font, 43)
    small_font = font(display_font, 22)
    draw.text(
        (center[0], center[1] + 115),
        "TIMELOCK TCG",
        font=title_font,
        fill=CREAM,
        anchor="mm",
    )
    draw.text(
        (center[0], center[1] + 160),
        "EDITION ONE",
        font=small_font,
        fill=ORANGE,
        anchor="mm",
    )

    icon_radius = 27
    orbit_radius = 268
    affinities = ("Signal", "Timelock", "Keys", "Power", "Bitcoin")
    for index, affinity in enumerate(affinities):
        angle = -math.pi / 2 + math.tau * index / len(affinities)
        icon_center = (
            round(center[0] + math.cos(angle) * orbit_radius),
            round(center[1] + math.sin(angle) * orbit_radius),
        )
        draw_resource_icon(draw, icon_center, icon_radius, affinity)
    return canvas


def safe_filename(name: str) -> str:
    """Create a Windows-safe image filename while preserving readable card names."""
    return re.sub(r'[<>:"/\\|?*]', "_", name).rstrip(". ") + ".jpg"


def file_sha256(path: Path) -> str:
    """Hash one rendered card."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_jpeg_atomic(
    image: Image.Image,
    output: Path,
    *,
    quality: int,
    progressive: bool = False,
) -> None:
    """Write a JPEG through a sibling temporary file and replace with retries."""
    temporary = output.with_name(f".{output.stem}.tmp.jpg")
    image.save(
        temporary,
        "JPEG",
        quality=quality,
        subsampling=0,
        optimize=True,
        progressive=progressive,
    )
    for attempt in range(6):
        try:
            temporary.replace(output)
            return
        except OSError:
            if attempt == 5:
                raise
            time.sleep(0.05 * (2**attempt))


def record_card_decisions(
    db_path: Path,
    cards: list[dict[str, Any]],
    art_dir: Path,
) -> None:
    """Commit the full card-render batch before writing card images."""
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS card_render_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                layout_version TEXT NOT NULL,
                art_fingerprint TEXT NOT NULL,
                text_fingerprint TEXT NOT NULL,
                output_file TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM card_render_decisions;
            """
        )
        rows = []
        for card in cards:
            art_path = art_dir / f"{card['id']}.jpg"
            text_payload = "|".join(
                (
                    card["name"],
                    card["type_line"],
                    card["cost"],
                    card["action_resilience"],
                    card["rules_text"],
                    card["flavor_text"],
                    card["rarity"],
                )
            )
            rows.append(
                (
                    card["id"],
                    card["name"],
                    LAYOUT_VERSION,
                    file_sha256(art_path),
                    hashlib.sha256(text_payload.encode()).hexdigest(),
                    safe_filename(card["name"]),
                    "planned",
                    "text and standalone art locked before card composition",
                    "auto:codex:e1-cards",
                )
            )
        connection.executemany(
            """
            INSERT INTO card_render_decisions (
                card_id, public_name, layout_version, art_fingerprint,
                text_fingerprint, output_file, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.commit()


def build_contact_sheets(
    cards: list[dict[str, Any]],
    output_dir: Path,
    qa_dir: Path,
    display_font: Path,
) -> None:
    """Create labeled visual-QA pages for the final card faces."""
    qa_dir.mkdir(parents=True, exist_ok=True)
    label_font = font(display_font, 13)
    columns = 5
    rows = 4
    cell_width = 190
    cell_height = 286
    page_size = columns * rows
    for page_index in range(math.ceil(len(cards) / page_size)):
        page_cards = cards[page_index * page_size : (page_index + 1) * page_size]
        sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), BLACK)
        draw = ImageDraw.Draw(sheet)
        for index, card in enumerate(page_cards):
            column = index % columns
            row = index // columns
            x = column * cell_width
            y = row * cell_height
            with Image.open(output_dir / safe_filename(card["name"])) as source:
                thumb = ImageOps.contain(
                    source.convert("RGB"),
                    (172, 241),
                    Image.Resampling.LANCZOS,
                )
            sheet.paste(thumb, (x + 9, y + 5))
            draw.text((x + 10, y + 250), card["id"], font=label_font, fill=ORANGE)
            label = card["name"][:25] + ("…" if len(card["name"]) > 25 else "")
            draw.text((x + 10, y + 267), label, font=label_font, fill=CREAM)
        sheet.save(
            qa_dir / f"e1-card-contact-{page_index + 1:02d}.jpg",
            "JPEG",
            quality=91,
            optimize=True,
        )


def write_manifest(
    path: Path,
    cards: list[dict[str, Any]],
    output_dir: Path,
    metrics: dict[str, RenderMetrics],
) -> None:
    """Write the final card-face manifest and readability gate."""
    files = []
    for card in cards:
        output = output_dir / safe_filename(card["name"])
        card_metrics = metrics[card["id"]]
        files.append(
            {
                "id": card["id"],
                "name": card["name"],
                "file": output.name,
                "size": [CARD_WIDTH, CARD_HEIGHT],
                "sha256": file_sha256(output),
                "metrics": {
                    "title_size": card_metrics.title_size,
                    "rules_size": card_metrics.rules_size,
                    "rules_lines": card_metrics.rules_lines,
                    "flavor_size": card_metrics.flavor_size,
                    "flavor_lines": card_metrics.flavor_lines,
                    "flavor_y": card_metrics.flavor_y,
                    "text_label": card_metrics.text_label,
                    "overflow": card_metrics.overflow,
                },
                "status": "card-locked" if not card_metrics.overflow else "needs-review",
            }
        )
    overflows = [item["id"] for item in files if item["metrics"]["overflow"]]
    payload = {
        "phase": "final-card-faces",
        "layout_version": LAYOUT_VERSION,
        "card_count": len(files),
        "card_size": [CARD_WIDTH, CARD_HEIGHT],
        "overflow_count": len(overflows),
        "overflow_ids": overflows,
        "card_back": "600B-Timelock-card-back.jpg",
        "files": files,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if overflows:
        raise ValueError(f"text overflow on {len(overflows)} card(s): {overflows}")


def main() -> None:
    """Record, render, validate and QA all final card faces."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--art",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-final-1920x2400",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "art" / "cards" / "final",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    payload = json.loads(args.cards.read_text(encoding="utf-8"))
    cards = payload["cards"]
    if len(cards) != 295 or not all(card["status"] == "text-locked" for card in cards):
        raise ValueError("complete text lock is required before card rendering")
    art_manifest = json.loads((args.art / "manifest.json").read_text(encoding="utf-8"))
    if art_manifest["card_count"] != 295 or art_manifest["card_frames_included"]:
        raise ValueError("complete standalone art lock is required before card rendering")

    record_card_decisions(args.audit_db, cards, args.art)
    args.out.mkdir(parents=True, exist_ok=True)
    logo_path = repo_root / "art" / "brand" / "600B-logo-primary.png"
    display_font = repo_root / "art" / "fonts" / "Anton-Regular.ttf"
    with Image.open(logo_path) as source_logo:
        logo = source_logo.convert("RGBA")

    metrics: dict[str, RenderMetrics] = {}
    for index, card in enumerate(cards, start=1):
        with Image.open(args.art / f"{card['id']}.jpg") as artwork:
            image, card_metrics = draw_card(
                card,
                artwork.convert("RGB"),
                logo,
                display_font,
            )
        save_jpeg_atomic(
            image,
            args.out / safe_filename(card["name"]),
            quality=94,
            progressive=True,
        )
        metrics[card["id"]] = card_metrics
        if index % 25 == 0 or index == len(cards):
            log.info("rendered %d/%d final card faces", index, len(cards))

    card_back = draw_card_back(logo, display_font)
    save_jpeg_atomic(
        card_back,
        args.out / "600B-Timelock-card-back.jpg",
        quality=95,
    )
    write_manifest(args.out / "manifest.json", cards, args.out, metrics)
    build_contact_sheets(
        cards,
        args.out,
        repo_root / "art" / "qa" / "cards",
        display_font,
    )
    log.info("card lock passed: 295 faces, one shared back, zero text overflows")


if __name__ == "__main__":
    main()
