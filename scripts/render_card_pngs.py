"""Render every Edition One card as a PNG in the Node Runner frame.

Draws the same frame the design canvas specifies — the generative spine, circuit
ring, node meshes and hand-drawn rule — straight to a bitmap with Pillow, reusing
the byte-exact geometry from `build_card_set` so a rendered PNG and the HTML proof
sheet agree. Output is full bleed: 814 x 1109 px, which is 69 x 94 mm at 300 dpi
(a 63 x 88 mm trim plus 3 mm bleed).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from build_card_set import (
    AFFINITY_ACCENT,
    AFFINITY_BADGE_FG,
    CARD_H,
    CARD_W,
    COST_AFFINITY,
    RARITY_DOT,
    TRIM_H,
    TRIM_INSET,
    TRIM_W,
    _rain,
    circuit_geometry,
    net_geometry,
    open_geometry,
    spine_geometry,
)
from build_cards import draw_resource_icon
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
CARD_BG = (5, 4, 3)
WELL_BG = (10, 7, 5)
CREAM = (255, 247, 236)
BONE = (232, 223, 207)
ORANGE = (247, 147, 26)
INK = (17, 17, 17)

ART_BOX = (68, 204, 678, 624)
WELL_BOX = (60, 196, 694, 640)
CORNER_MARKS = [
    [(60, 232), (60, 196), (96, 196)],
    [(718, 196), (754, 196), (754, 232)],
    [(754, 800), (754, 836), (718, 836)],
    [(96, 836), (60, 836), (60, 800)],
]

MONO = ["consola.ttf", "DejaVuSansMono.ttf", "cour.ttf"]
MONO_ITALIC = ["consolai.ttf", "DejaVuSansMono-Oblique.ttf", "couri.ttf"]
BODY = ["trebuc.ttf", "arial.ttf", "DejaVuSans.ttf"]
BODY_BOLD = ["trebucbd.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
DISPLAY = [str(REPO_ROOT / "art" / "fonts" / "Anton-Regular.ttf"), "impact.ttf", "arialbd.ttf"]


def font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    """Load the first available font from a fallback chain."""
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def hex_rgb(value: str) -> tuple[int, int, int]:
    """Convert `#rrggbb` to an RGB triple."""
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rgba(value: str, alpha: float) -> tuple[int, int, int, int]:
    """Convert `#rrggbb` plus an alpha fraction to an RGBA tuple."""
    return (*hex_rgb(value), round(alpha * 255))


def tracked_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    text_font: ImageFont.FreeTypeFont,
    fill: tuple,
    tracking: float = 0.0,
) -> float:
    """Draw text with letter spacing, which Pillow does not support natively."""
    x, y = xy
    for character in text:
        draw.text((x, y), character, font=text_font, fill=fill)
        x += draw.textlength(character, font=text_font) + tracking
    return x - xy[0]


def tracked_width(
    draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont, tracking: float
) -> float:
    """Measure what `tracked_text` will occupy."""
    return sum(draw.textlength(c, font=text_font) + tracking for c in text)


def wrap(
    draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont, width: int
) -> list[str]:
    """Greedy word wrap to a pixel width."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split():
            trial = f"{current} {word}".strip()
            if draw.textlength(trial, font=text_font) <= width or not current:
                current = trial
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return [line for line in lines if line]


def quad_points(
    start: tuple[float, float],
    control: tuple[float, float],
    end: tuple[float, float],
    steps: int = 8,
) -> list[tuple[float, float]]:
    """Flatten one quadratic Bézier segment into a polyline."""
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        inv = 1 - t
        out.append(
            (
                inv * inv * start[0] + 2 * inv * t * control[0] + t * t * end[0],
                inv * inv * start[1] + 2 * inv * t * control[1] + t * t * end[1],
            )
        )
    return out


def fit_contain(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    """Scale to fit inside the box without cropping, as the canvas' contain fit does."""
    width, height = box
    scale = min(width / image.width, height / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


# ------------------------------------------------------------------ frame paint


def paint_frame(
    canvas: Image.Image, index: int, accent: str, border_amp: int, guides: bool
) -> None:
    """Draw the generative frame for one card onto the canvas."""
    k = border_amp / 6
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    accent_rgb = hex_rgb(accent)

    spine = spine_geometry(781 + index)
    for x0, y0, x1, y1 in spine["dim"]:
        draw.rectangle((x0, y0, x1, y1), fill=(*accent_rgb, 64))
    for x0, y0, x1, y1 in spine["main"]:
        draw.rectangle((x0, y0, x1, y1), fill=(*accent_rgb, 255))

    for side, seed in (("L", 631 + index), ("R", 661 + index)):
        box = (68, 214) if side == "L" else (672, 214)
        mesh = net_geometry(box[0], box[1], 74, 520, 12, seed)
        for link in mesh["links"]:
            draw.line(link, fill=rgba("#f7931a", 0.3), width=2)
        for px, py in mesh["points"]:
            draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=rgba("#f7931a", 0.55))

    circuit = circuit_geometry(56, 192, 702, 648, 44, 601 + index, k)
    ring = [(p[0], p[1]) for p in circuit["points"]]
    draw.line(ring + ring[:1], fill=(*accent_rgb, 140), width=2)
    for x0, y0, x1, y1 in circuit["ticks"]:
        draw.line(((x0, y0), (x1, y1)), fill=(*accent_rgb, 255), width=4)
    for px, py, radius in circuit["nodes"]:
        draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=(*accent_rgb, 255))

    joints = open_geometry(72, 852, 742, 852, 30, 3, 691 + index, k)
    rule = [joints[0]]
    for i in range(1, len(joints) - 1):
        end = ((joints[i][0] + joints[i + 1][0]) / 2, (joints[i][1] + joints[i + 1][1]) / 2)
        rule += quad_points(rule[-1], joints[i], end)
    rule.append(joints[-1])
    draw.line(rule, fill=rgba("#f7931a", 0.45), width=2)

    for mark in CORNER_MARKS:
        draw.line(mark, fill=(*CREAM, 255), width=3)

    if guides:
        draw.rectangle(
            (TRIM_INSET, TRIM_INSET, TRIM_INSET + TRIM_W, TRIM_INSET + TRIM_H),
            outline=(0, 210, 255, 180),
            width=2,
        )
    canvas.alpha_composite(overlay)


def paint_rain(canvas: Image.Image, index: int) -> None:
    """Draw the digit rain down both edges."""
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    mono = font(MONO, 20)
    for column, seed, x, fill in (
        ("L", 721 + index, 8, (5, 4, 3, 191)),
        ("R", 751 + index, CARD_W - 24, (247, 147, 26, 64)),
    ):
        y = 40 if column == "L" else 44
        for digit in _rain(36, seed).split("\n"):
            if not digit:
                continue
            draw.text((x, y), digit, font=mono, fill=fill)
            y += 28
    canvas.alpha_composite(overlay)


# ------------------------------------------------------------------- card paint


def cost_tokens(cost: str) -> tuple[str, list[str]]:
    """Split a printed cost into its generic amount and affinity symbols."""
    generic = "".join(ch for ch in cost if ch.isdigit())
    symbols = [ch for ch in cost if ch in COST_AFFINITY]
    return generic, symbols


def render_card(
    card: dict[str, Any],
    index: int,
    art_dir: Path,
    border_amp: int,
    guides: bool,
) -> Image.Image:
    """Render one card face at full bleed."""
    affinity = (card["affinity"] or ["Neutral"])[0]
    accent = AFFINITY_ACCENT.get(affinity, AFFINITY_ACCENT["Neutral"])
    badge_fg = AFFINITY_BADGE_FG.get(affinity, "#050403")

    canvas = Image.new("RGBA", (CARD_W, CARD_H), (*CARD_BG, 255))
    draw = ImageDraw.Draw(canvas)

    paint_rain(canvas, index)

    wx, wy, ww, wh = WELL_BOX
    draw.rectangle((wx, wy, wx + ww, wy + wh), fill=(*WELL_BG, 255), outline=rgba("#f7931a", 0.25))
    art_path = art_dir / f"{card['id']}.jpg"
    if art_path.exists():
        with Image.open(art_path) as source:
            art = fit_contain(source.convert("RGB"), (ART_BOX[2], ART_BOX[3]))
        canvas.paste(
            art,
            (
                ART_BOX[0] + (ART_BOX[2] - art.width) // 2,
                ART_BOX[1] + (ART_BOX[3] - art.height) // 2,
            ),
        )

    paint_frame(canvas, index, accent, border_amp, guides)
    draw = ImageDraw.Draw(canvas)

    # Type badge
    mono22 = font(MONO, 22)
    badge = f"{card['card_type']} // {card['subtype'] or affinity}".upper()
    badge_w = tracked_width(draw, badge, mono22, 6)
    draw.rectangle((72, 58, 72 + badge_w + 32, 58 + 39), fill=hex_rgb(accent))
    tracked_text(draw, (88, 65), badge, mono22, hex_rgb(badge_fg), 6)

    # Cost row is measured first so the title can be fitted to what is left.
    generic, symbols = cost_tokens(card["cost"] or "")
    cost_width = 0
    if generic or symbols:
        icon_size = 54 if generic else 64
        cost_width = (
            (78 if generic else 0)
            + len(symbols) * icon_size
            + 10 * (bool(generic) + len(symbols) - 1)
        )

    # Title, with the canvas' ember/violet offset shadows
    title_size = 60
    title_font = font(DISPLAY, title_size)
    name = card["name"].upper()
    available = CARD_W - 64 - cost_width - 72 - 20 if cost_width else 600
    while draw.textlength(name, font=title_font) > available and title_size > 24:
        title_size -= 2
        title_font = font(DISPLAY, title_size)
    for offset, colour in ((3, (255, 106, 0)), (-3, (116, 71, 184))):
        draw.text((72 + offset, 98), name, font=title_font, fill=colour)
    draw.text((72, 98), name, font=title_font, fill=CREAM)

    # Cost row, right aligned
    if generic or symbols:
        x = CARD_W - 64 - cost_width
        if generic:
            draw.rectangle((x, 92, x + 78, 170), fill=INK, outline=rgba("#fff7ec", 0.7), width=3)
            big = font(MONO, 44)
            tw = draw.textlength(generic, font=big)
            draw.text((x + (78 - tw) / 2, 108), generic, font=big, fill=CREAM)
            x += 88
        for symbol in symbols:
            radius = icon_size // 2
            draw_resource_icon(draw, (x + radius, 92 + radius + 6), radius, COST_AFFINITY[symbol])
            x += icon_size + 10

    # Action / Resilience
    stats = card["action_resilience"]
    if stats and "/" in stats:
        action, _, resilience = stats.partition("/")
        mono40, mono14 = font(MONO, 40), font(MONO, 14)
        for left, value, label in ((78, action, "ACT"), (676, resilience, "RES")):
            draw.rectangle(
                (left, 724, left + 60, 812),
                fill=(17, 17, 17, 217),
                outline=hex_rgb(accent),
                width=2,
            )
            tw = draw.textlength(value, font=mono40)
            draw.text((left + (60 - tw) / 2, 736), value, font=mono40, fill=CREAM)
            lw = tracked_width(draw, label, mono14, 1.4)
            tracked_text(draw, (left + (60 - lw) / 2, 786), label, mono14, ORANGE, 1.4)
    elif "Resource" in card["card_type"] and affinity in COST_AFFINITY.values():
        draw_resource_icon(draw, (CARD_W - 76 - 32, 736 + 32), 32, affinity)

    # Rules and flavour
    body = font(BODY, 31)
    y = 864
    if card["rules_text"]:
        for line in wrap(draw, card["rules_text"], body, 670)[:4]:
            draw.text((72, y), line, font=body, fill=BONE)
            y += 40
    if card["flavor_text"]:
        italic = font(MONO_ITALIC, 21)
        y += 8
        for line in wrap(draw, f"// {card['flavor_text']}", italic, 670)[:2]:
            draw.text((72, y), line, font=italic, fill=(*BONE, 128))
            y += 26

    # Footer
    mono22 = font(MONO, 22)
    tracked_text(draw, (72, 1022), "TIMELOCK_TCG :: 600B", mono22, (*BONE, 153), 4.4)
    set_id = card["id"].replace("-", " · ")
    id_w = tracked_width(draw, set_id, mono22, 4.4)
    tracked_text(draw, (CARD_W - 72 - id_w - 26, 1022), set_id, mono22, (*BONE, 153), 4.4)
    dot_fill, _ = RARITY_DOT.get(card["rarity"], RARITY_DOT["common"])
    cx, cy = CARD_W - 72 - 7, 1033
    draw.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=hex_rgb(dot_fill))

    return canvas


def main() -> None:
    """Render the whole set into PNG card faces."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=REPO_ROOT / "cards" / "e1-cards.json")
    parser.add_argument(
        "--art-dir",
        type=Path,
        default=REPO_ROOT / "art" / "generated" / "prompts-v2-final-1920x2400",
    )
    parser.add_argument(
        "--out", type=Path, default=REPO_ROOT / "art" / "cards" / "node-runner-faces"
    )
    parser.add_argument(
        "--border-amp", type=int, default=6, choices=range(1, 15), metavar="{1..14}"
    )
    parser.add_argument("--guides", action="store_true", help="draw the trim guide")
    parser.add_argument("--limit", type=int, default=0, help="render only the first N cards")
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    if args.limit:
        cards = cards[: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)

    missing_art = 0
    for index, card in enumerate(cards, start=1):
        image = render_card(card, index, args.art_dir, args.border_amp, args.guides)
        if not (args.art_dir / f"{card['id']}.jpg").exists():
            missing_art += 1
        image.convert("RGB").save(args.out / f"{card['name']}.png", "PNG", optimize=True)
        if index % 25 == 0:
            print(f"  … {index}/{len(cards)}")

    print(f"wrote {len(cards)} PNG card faces to {args.out}")
    if missing_art:
        print(f"note: {missing_art} rendered without artwork (no source in {args.art_dir.name})")


if __name__ == "__main__":
    main()
