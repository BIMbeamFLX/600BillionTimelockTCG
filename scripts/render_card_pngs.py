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
    TYPE_BASE,
    TYPE_GROUP,
    _rain,
    blob_geometry,
    circuit_geometry,
    net_geometry,
    open_geometry,
    spine_geometry,
)
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


ICON_DIR = REPO_ROOT / "art" / "resources" / "png"
PIP_SIZE = 54
RESOURCE_ICON = 64
BASIC_ICON = 200  # one giant symbol: this card makes exactly this
JUNCTION_ICON = 150  # two symbols and a slash: choose one


def resource_symbols(card: dict[str, Any]) -> list[str]:
    """The affinities a Resource card produces, or [] if it is not a Resource."""
    if "Resource" not in card["card_type"]:
        return []
    return [a for a in (card["affinity"] or []) if a in COST_AFFINITY.values()]


# Titles never wrap; they step down this ladder until they clear the cost cluster.
TITLE_LADDER = (68, 66, 62, 60, 58, 52, 46, 40, 34)
_ICONS: dict[tuple[str, int], Image.Image] = {}


def resource_icon(affinity: str, size: int) -> Image.Image:
    """Load a canonical resource icon, rasterized from art/resources/*.svg."""
    key = (affinity, size)
    if key not in _ICONS:
        with Image.open(ICON_DIR / f"{affinity.lower()}.png") as source:
            _ICONS[key] = source.convert("RGBA").resize((size, size), Image.LANCZOS)
    return _ICONS[key]


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


def fit_block(
    draw: ImageDraw.ImageDraw,
    text: str,
    family: list[str],
    steps: tuple[tuple[int, int], ...],
    width: int = 670,
    max_lines: int = 2,
) -> tuple[ImageFont.FreeTypeFont, int, list[str]]:
    """Pick the largest type size whose wrap still fits the handoff's line budget."""
    block_font, height, lines = font(family, steps[0][0]), steps[0][1], []
    for size, step_height in steps:
        block_font, height = font(family, size), step_height
        lines = wrap(draw, text, block_font, width)
        if len(lines) <= max_lines:
            break
    return block_font, height, lines[:max_lines]


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

    base_bg, base_plate = TYPE_BASE[TYPE_GROUP.get(card["card_type"], "avatar")]
    canvas = Image.new("RGBA", (CARD_W, CARD_H), (*hex_rgb(base_bg), 255))
    draw = ImageDraw.Draw(canvas)

    paint_rain(canvas, index)

    wx, wy, ww, wh = WELL_BOX
    draw.rectangle(
        (wx, wy, wx + ww, wy + wh), fill=(*hex_rgb(base_plate), 255), outline=rgba("#f7931a", 0.25)
    )
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
        cost_width = (
            (78 if generic else 0)
            + len(symbols) * PIP_SIZE
            + 10 * (bool(generic) + len(symbols) - 1)
        )

    # Title steps down a fixed ladder rather than shrinking freely, and must never
    # wrap or reach the cost cluster.
    name = card["name"].upper()
    available = CARD_W - 64 - cost_width - 72 - 20 if cost_width else 600
    for title_size in TITLE_LADDER:
        title_font = font(DISPLAY, title_size)
        if draw.textlength(name, font=title_font) <= available:
            break
    for offset, colour in ((3, (255, 106, 0)), (-3, (116, 71, 184))):
        draw.text((72 + offset, 98), name, font=title_font, fill=colour)
    draw.text((72, 98), name, font=title_font, fill=CREAM)

    # Cost row, right aligned, using the canonical resource icons as-is
    if generic or symbols:
        x = CARD_W - 64 - cost_width
        if generic:
            draw.rectangle((x, 92, x + 78, 170), fill=INK, outline=rgba("#fff7ec", 0.7), width=3)
            big = font(MONO, 44)
            tw = draw.textlength(generic, font=big)
            draw.text((x + (78 - tw) / 2, 108), generic, font=big, fill=CREAM)
            x += 88
        for symbol in symbols:
            icon = resource_icon(COST_AFFINITY[symbol], PIP_SIZE)
            canvas.alpha_composite(icon, (int(x), 92 + (78 - PIP_SIZE) // 2))
            x += PIP_SIZE + 10

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
    # A Resource is played every turn, so it gets a simplified face: the symbols
    # ARE the rules text. One symbol means it makes that Resource; two side by
    # side mean choose. A player reads the count before they read a word, which
    # is why the printed line is dropped rather than shrunk.
    symbols = resource_symbols(card)
    if symbols:
        size = BASIC_ICON if len(symbols) == 1 else JUNCTION_ICON
        gap = 40
        total = len(symbols) * size + (len(symbols) - 1) * gap
        x = (CARD_W - total) // 2
        # Centred in the band between the art plate (ends 828) and the footer (1022).
        top = (836 + 1010) // 2 - size // 2
        for index, name in enumerate(symbols):
            canvas.alpha_composite(resource_icon(name, size), (int(x), top))
            if index + 1 < len(symbols):
                # An "or" between them, so the choice is explicit rather than implied.
                slash = font(DISPLAY, 46)
                sw = draw.textlength("/", font=slash)
                draw.text(
                    (x + size + (gap - sw) / 2, top + size / 2 - 30),
                    "/",
                    font=slash,
                    fill=(*BONE, 150),
                )
            x += size + gap

    # Rules and flavour. The handoff budgets 146px here: two lines of effect, a
    # 12px gap, then two lines of fable. Shrink a step rather than overrun it.
    y = 864
    if card["rules_text"] and not symbols:
        body, height, lines = fit_block(draw, card["rules_text"], BODY, ((31, 40), (29, 38)))
        for line in lines:
            draw.text((72, y), line, font=body, fill=BONE)
            y += height
    if card["flavor_text"] and not symbols:
        y += 12
        fable_text = f"// {card['flavor_text']}"
        italic, height, lines = fit_block(draw, fable_text, MONO_ITALIC, ((21, 27), (20, 26)))
        for line in lines:
            draw.text((72, y), line, font=italic, fill=(*BONE, 128))
            y += height

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


def render_back(border_amp: int, guides: bool) -> Image.Image:
    """Render the shared card back: orange spine, node field, ring and sacred stack."""
    k = border_amp / 6
    canvas = Image.new("RGBA", (CARD_W, CARD_H), (*CARD_BG, 255))
    paint_rain(canvas, 232)  # seeds 553/554 in the canvas = index offset 232

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    spine = spine_geometry(999)
    for x0, y0, x1, y1 in spine["dim"]:
        draw.rectangle((x0, y0, x1, y1), fill=rgba("#f7931a", 0.25))
    for x0, y0, x1, y1 in spine["main"]:
        draw.rectangle((x0, y0, x1, y1), fill=rgba("#f7931a", 1.0))

    mesh = net_geometry(120, 180, 574, 600, 26, 552)
    for link in mesh["links"]:
        draw.line(link, fill=rgba("#f7931a", 0.35), width=2)
    for px, py in mesh["points"]:
        draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=rgba("#f7931a", 0.6))

    points = blob_geometry(407, 554, 170, 44, 8, 551, k)
    ring = [((points[-1][0] + points[0][0]) / 2, (points[-1][1] + points[0][1]) / 2)]
    for i, point in enumerate(points):
        nxt = points[(i + 1) % len(points)]
        ring += quad_points(ring[-1], point, ((point[0] + nxt[0]) / 2, (point[1] + nxt[1]) / 2))
    draw.polygon(ring, fill=(*hex_rgb("#0a0705"), 255))
    draw.line(ring + ring[:1], fill=rgba("#f7931a", 1.0), width=6)

    if guides:
        draw.rectangle(
            (TRIM_INSET, TRIM_INSET, TRIM_INSET + TRIM_W, TRIM_INSET + TRIM_H),
            outline=(0, 210, 255, 180),
            width=2,
        )
    canvas.alpha_composite(overlay)

    draw = ImageDraw.Draw(canvas)
    stack_font = font(DISPLAY, 60)
    y = 404 + (300 - 4 * 59) / 2
    for line in ("600", "000", "000", "000"):
        width = draw.textlength(line, font=stack_font)
        draw.text((257 + (300 - width) / 2, y), line, font=stack_font, fill=hex_rgb("#f7931a"))
        y += 59
    mono22 = font(MONO, 22)
    footer = "TIMELOCK_TCG :: EDITION ONE"
    footer_w = tracked_width(draw, footer, mono22, 7.5)
    tracked_text(draw, ((CARD_W - footer_w) / 2, 1010), footer, mono22, (*BONE, 153), 7.5)
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
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "art" / "cards" / "node-runner-web")
    parser.add_argument("--promos", type=Path, default=REPO_ROOT / "cards" / "promos.json")
    parser.add_argument(
        "--promo-art-dir",
        type=Path,
        default=REPO_ROOT / "art" / "generated" / "promos" / "final",
    )
    parser.add_argument(
        "--border-amp", type=int, default=6, choices=range(1, 15), metavar="{1..14}"
    )
    parser.add_argument("--guides", action="store_true", help="draw the trim guide")
    parser.add_argument("--limit", type=int, default=0, help="render only the first N cards")
    parser.add_argument(
        "--format",
        default="png",
        choices=("png", "webp", "jpeg"),
        help="png is the archival master; webp is small enough to inscribe (default: png)",
    )
    parser.add_argument("--quality", type=int, default=82, help="webp/jpeg quality (default: 82)")
    parser.add_argument(
        "--dpi", type=int, default=300, help="resolution tagged on print output (default: 300)"
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="scale the finished card, e.g. 0.5 for a half-size inscription set",
    )
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    entries = [(card, args.art_dir) for card in cards]
    # The promo lives in its own lock but must carry the same frame as the set.
    if args.promos and args.promos.exists() and not args.limit:
        promos = json.loads(args.promos.read_text(encoding="utf-8"))["cards"]
        entries += [(card, args.promo_art_dir) for card in promos]
    if args.limit:
        entries = entries[: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)

    suffix = {"png": ".png", "webp": ".webp", "jpeg": ".jpg"}[args.format]
    options: dict[str, Any]
    if args.format == "png":
        # Tag the real print resolution so a prepress tool reads the physical size.
        options = {"optimize": True, "dpi": (args.dpi, args.dpi)}
    elif args.format == "webp":
        options = {"quality": args.quality, "method": 6}
    else:
        options = {"quality": args.quality, "optimize": True, "dpi": (args.dpi, args.dpi)}

    missing_art = []
    written = 0
    for index, (card, art_dir) in enumerate(entries, start=1):
        image = render_card(card, index, art_dir, args.border_amp, args.guides)
        if not (art_dir / f"{card['id']}.jpg").exists():
            missing_art.append(card["id"])
        # Web faces are trimmed to the cut line: the 35px bleed exists for the
        # printer's blade, and shipping it to the browser reads as a fat dead
        # margin under the footer. Print masters keep the full bleed.
        if args.format == "webp":
            image = image.crop((TRIM_INSET, TRIM_INSET, TRIM_INSET + TRIM_W, TRIM_INSET + TRIM_H))
        if args.scale != 1.0:
            image = image.resize(
                (round(image.width * args.scale), round(image.height * args.scale)), Image.LANCZOS
            )
        target = args.out / f"{card['name']}{suffix}"
        image.convert("RGB").save(target, args.format.upper(), **options)
        written += target.stat().st_size
        if index % 25 == 0:
            print(f"  … {index}/{len(entries)}")

    back = render_back(args.border_amp, args.guides)
    if args.format == "webp":
        back = back.crop((TRIM_INSET, TRIM_INSET, TRIM_INSET + TRIM_W, TRIM_INSET + TRIM_H))
    if args.scale != 1.0:
        back = back.resize(
            (round(back.width * args.scale), round(back.height * args.scale)), Image.LANCZOS
        )
    back_target = args.out / f"600B-Timelock-card-back{suffix}"
    back.convert("RGB").save(back_target, args.format.upper(), **options)
    written += back_target.stat().st_size

    average = written / max(1, len(entries))
    print(f"wrote {len(entries)} {args.format} card faces to {args.out}")
    print(f"  {written / 1024 / 1024:.1f} MB total, {average / 1024:.0f} KB average")
    if missing_art:
        print(f"note: {len(missing_art)} rendered without artwork, first: {missing_art[0]}")


if __name__ == "__main__":
    main()
