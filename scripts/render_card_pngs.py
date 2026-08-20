"""Render every Edition One card as a PNG in the Node Runner frame.

Draws the same frame the design canvas specifies — the generative spine, circuit
ring, node meshes and hand-drawn rule — straight to a bitmap with Pillow.
`build_card_set` still supplies the palette and the generative geometry helpers,
and the HTML proof sheet now displays these rendered faces themselves, so this
renderer is the single authority on card geometry. Output is full bleed:
814 x 1109 px, which is 69 x 94 mm at 300 dpi (a 63 x 88 mm trim plus 3 mm bleed).
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
    GENESIS_CORE,
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

# The illustration is never covered and never cropped: it is contain-fit into
# the space between the header (badge, cost, title own y < 170) and the text,
# which sits BELOW the art on the well plate, bottom-anchored at y=1006 above
# the footer. Short rules leave room for a tall picture; the five-line cards
# give some of it back. ART_MAX_H is the 4:5 ceiling at the well's width.
#
# The first full-art frame instead ran the text over the picture on a scrim.
# The owner's verdict was blunt and right: leave the pictures whole. The board
# shows the pure art region in-game (face-geometry sidecar); the printed face
# is the reference document, so it carries the full text -- smaller, and below.
# Header and footer both hug the cut line -- 3px of trimmed margin above the
# badge, 12px under the footer ink -- and everything freed in between belongs
# to the picture. The title sits right under the badge, and the art starts
# under the title's own em box, so a card with a short name starts its picture
# higher. ART_TOP_MIN keeps the picture out of the well's ring and corner
# brackets, which begin at y=138; the well runs to y=1032 so the text always
# sits on its plate.
BADGE_TOP = 38
# The title is anchored by its INK, not its em box: Anton carries 16-21px of
# dead ascender air, and anchoring the box let glyphs reach the frame. Ink
# starts at 84 (badge ends 77) and must end above TITLE_INK_FLOOR -- the ring
# begins at 138 -- which caps the ladder at 48. The owner's law: no collision.
TITLE_INK_TOP = 84
TITLE_INK_FLOOR = 134
ART_TOP_MIN = 150
ART_MAX_H = 845
TEXT_BOTTOM = 1024
ART_TEXT_GAP = 14
WELL_BOX = (61, 142, 692, 890)


def corner_marks(box: tuple[int, int, int, int], arm: int = 36) -> list[list[tuple[int, int]]]:
    """Bracket the four corners of the well, so the marks follow it when it moves."""
    x, y, width, height = box
    right, bottom = x + width, y + height
    return [
        [(x, y + arm), (x, y), (x + arm, y)],
        [(right - arm, y), (right, y), (right, y + arm)],
        [(right, bottom - arm), (right, bottom), (right - arm, bottom)],
        [(x + arm, bottom), (x, bottom), (x, bottom - arm)],
    ]


CORNER_MARKS = corner_marks(WELL_BOX)

# Every card prints its rules in full. The old budget was two lines at one of two
# sizes, which silently truncated 149 of 295 -- several of them printing an
# ability the engine grants but the card never mentions. Five lines over this
# ladder fits every card, worst total block 254px (E1-009), swept set-wide.
RULES_STEPS = ((29, 38), (27, 35), (25, 33), (23, 30))
RULES_MAX_LINES = 5
FABLE_STEPS = ((20, 26), (19, 25))

# Per-card art placement, in full-bleed pixels, collected during a render so
# main() can emit the face-geometry sidecar the game board crops tiles from.
FACE_GEOMETRY: dict[str, tuple[int, int, int, int]] = {}

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
TITLE_LADDER = (48, 46, 42, 38, 34, 30, 27, 24)
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
    roots = (Path("/System/Library/Fonts/Supplemental"), Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"))
    for name in candidates:
        for candidate in (Path(name), *(root / name for root in roots)):
            try:
                return ImageFont.truetype(str(candidate), size)
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
    if len(lines) > max_lines:
        # Truncating here is how 149 cards silently lost their printed abilities.
        # A card that no longer fits its budget fails the render, like a missing
        # blob fails the deploy.
        raise ValueError(f"text needs {len(lines)} lines, budget is {max_lines}: {text[:60]!r}")
    return block_font, height, lines


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
    canvas: Image.Image,
    index: int,
    accent: str,
    border_amp: int,
    guides: bool,
    rule_y: int = 852,
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

    # The node meshes used to fill the two dead gutters either side of the
    # pillarboxed art. There are no gutters any more, so they run down the card's
    # outer margin instead of over the picture.
    for side, seed in (("L", 631 + index), ("R", 661 + index)):
        box = (14, 300) if side == "L" else (760, 300)
        mesh = net_geometry(box[0], box[1], 40, 520, 12, seed)
        for link in mesh["links"]:
            draw.line(link, fill=rgba("#f7931a", 0.3), width=2)
        for px, py in mesh["points"]:
            draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=rgba("#f7931a", 0.55))

    circuit = circuit_geometry(57, 138, 700, 898, 44, 601 + index, k)
    ring = [(p[0], p[1]) for p in circuit["points"]]
    draw.line(ring + ring[:1], fill=(*accent_rgb, 140), width=2)
    for x0, y0, x1, y1 in circuit["ticks"]:
        draw.line(((x0, y0), (x1, y1)), fill=(*accent_rgb, 255), width=4)
    for px, py, radius in circuit["nodes"]:
        draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=(*accent_rgb, 255))

    joints = open_geometry(72, rule_y, 742, rule_y, 30, 3, 691 + index, k)
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
    # The text is measured BEFORE the art is placed: the block sits on the well
    # plate below the picture, so its height decides how tall the picture gets.
    symbols = resource_symbols(card)
    blocks = []
    icon_top = 0
    if not symbols:
        if card["rules_text"]:
            body, height, lines = fit_block(
                draw, card["rules_text"], BODY, RULES_STEPS, max_lines=RULES_MAX_LINES
            )
            blocks.append((body, height, lines, BONE, 0))
        if card["flavor_text"]:
            italic, height, lines = fit_block(
                draw, f"// {card['flavor_text']}", MONO_ITALIC, FABLE_STEPS
            )
            blocks.append((italic, height, lines, (*BONE, 128), 12))
    text_height = sum(gap + height * len(lines) for _, height, lines, _, gap in blocks)
    text_top = TEXT_BOTTOM - text_height

    if symbols:
        # One giant symbol IS the rules text; it takes the text zone instead.
        icon_size = BASIC_ICON if len(symbols) == 1 else JUNCTION_ICON
        icon_top = TEXT_BOTTOM - 16 - icon_size
        zone_top = icon_top - 24
    elif blocks:
        zone_top = text_top - ART_TEXT_GAP
    else:
        zone_top = TEXT_BOTTOM

    # Cost first, then title, then art: the cost cluster caps the title's
    # width (a title must never run under the pips), and the title's size sets
    # the art's top edge -- short name, higher picture.
    generic, cost_symbols = cost_tokens(card["cost"] or "")
    cost_width = 0
    if generic or cost_symbols:
        cost_width = (
            (78 if generic else 0)
            + len(cost_symbols) * PIP_SIZE
            + 10 * (bool(generic) + len(cost_symbols) - 1)
        )
    cost_x = CARD_W - 64 - cost_width
    name = card["name"].upper()
    available = min(CARD_W - 72 - 72, cost_x - 72 - 12) if cost_width else CARD_W - 72 - 72
    for title_size in TITLE_LADDER:
        title_font = font(DISPLAY, title_size)
        if draw.textlength(name, font=title_font) <= available:
            break
    ink = draw.textbbox((0, 0), name, font=title_font)
    title_y = TITLE_INK_TOP - ink[1]
    title_ink_bottom = title_y + ink[3]
    if title_ink_bottom > TITLE_INK_FLOOR:
        # The frame starts at y=138. A title that reaches it fails the render.
        raise ValueError(f"title ink reaches {title_ink_bottom}: {name!r}")
    art_top = max(ART_TOP_MIN, title_ink_bottom + 10)

    art_h = min(ART_MAX_H, zone_top - art_top)
    art_w = round(art_h * 4 / 5)
    art_x = (CARD_W - art_w) // 2
    art_path = art_dir / f"{card['id']}.jpg"
    if art_path.exists():
        with Image.open(art_path) as source:
            art = fit_contain(source.convert("RGB"), (art_w, art_h))
        canvas.paste(art, (art_x + (art_w - art.width) // 2, art_top))
    art_bottom = art_top + art_h
    FACE_GEOMETRY[card["id"]] = (art_x, art_top, art_w, art_h)
    rule_y = art_bottom + 10

    paint_frame(canvas, index, accent, border_amp, guides, rule_y)
    draw = ImageDraw.Draw(canvas)

    # Type badge. It steps down a size when a long type line would run into the
    # cost cluster -- one promo does this; every E1 badge fits at 22.
    badge = f"{card['card_type']} // {card['subtype'] or affinity}".upper()
    for badge_size in (22, 20, 18, 16):
        badge_font = font(MONO, badge_size)
        badge_w = tracked_width(draw, badge, badge_font, 6)
        if not cost_width or 72 + badge_w + 32 <= cost_x - 12:
            break
    draw.rectangle((72, BADGE_TOP, 72 + badge_w + 32, BADGE_TOP + 39), fill=hex_rgb(accent))
    tracked_text(
        draw, (88, BADGE_TOP + 7 + (22 - badge_size) // 2), badge, badge_font, hex_rgb(badge_fg), 6
    )

    # The title's size, font and ink anchor were chosen before the art was placed.
    for offset, colour in ((3, (255, 106, 0)), (-3, (116, 71, 184))):
        draw.text((72 + offset, title_y), name, font=title_font, fill=colour)
    draw.text((72, title_y), name, font=title_font, fill=CREAM)

    # Cost row, right aligned, using the canonical resource icons as-is
    if generic or cost_symbols:
        x = cost_x
        if generic:
            box = (x, BADGE_TOP, x + 78, BADGE_TOP + 78)
            draw.rectangle(box, fill=INK, outline=rgba("#fff7ec", 0.7), width=3)
            big = font(MONO, 44)
            tw = draw.textlength(generic, font=big)
            draw.text((x + (78 - tw) / 2, BADGE_TOP + 16), generic, font=big, fill=CREAM)
            x += 88
        for symbol in cost_symbols:
            icon = resource_icon(COST_AFFINITY[symbol], PIP_SIZE)
            canvas.alpha_composite(icon, (int(x), BADGE_TOP + (78 - PIP_SIZE) // 2))
            x += PIP_SIZE + 10

    # Action / Resilience
    stats = card["action_resilience"]
    if stats and "/" in stats:
        action, _, resilience = stats.partition("/")
        mono40, mono14 = font(MONO, 40), font(MONO, 14)
        # Bottom-aligned to the art's lower edge, at the card's fixed margins.
        # The art is narrower than the frame on most cards now, so the plates
        # usually sit on the well BESIDE the picture's lower corners, not on it.
        stat_top = art_bottom - 88
        for left, value, label in ((78, action, "ACT"), (676, resilience, "RES")):
            draw.rectangle(
                (left, stat_top, left + 60, stat_top + 88),
                fill=(17, 17, 17, 217),
                outline=hex_rgb(accent),
                width=2,
            )
            tw = draw.textlength(value, font=mono40)
            draw.text((left + (60 - tw) / 2, stat_top + 12), value, font=mono40, fill=CREAM)
            lw = tracked_width(draw, label, mono14, 1.4)
            tracked_text(draw, (left + (60 - lw) / 2, stat_top + 62), label, mono14, ORANGE, 1.4)
    # A Resource is played every turn, so it gets a simplified face: the symbols
    # ARE the rules text. One symbol means it makes that Resource; two side by
    # side mean choose. A player reads the count before they read a word, which
    # is why the printed line is dropped rather than shrunk.
    if symbols:
        size = BASIC_ICON if len(symbols) == 1 else JUNCTION_ICON
        gap = 40
        total = len(symbols) * size + (len(symbols) - 1) * gap
        x = (CARD_W - total) // 2
        top = icon_top
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

    # Rules and flavour, on the plate below the art, bottom-anchored above the footer.
    y = text_top
    for block_font, height, lines, fill, gap in blocks:
        y += gap
        for line in lines:
            draw.text((72, y), line, font=block_font, fill=fill)
            y += height

    # Footer
    mono22 = font(MONO, 22)
    tracked_text(draw, (72, 1040), "TIMELOCK_TCG :: 600000000000", mono22, (*BONE, 153), 4.4)
    set_id = card["id"].replace("-", " · ")
    id_w = tracked_width(draw, set_id, mono22, 4.4)
    tracked_text(draw, (CARD_W - 72 - id_w - 26, 1040), set_id, mono22, (*BONE, 153), 4.4)
    # The rarity dot, and the one place on a card where its tier is stated at all.
    #
    # A DIRECT INDEX, not .get(rarity, common). The fallback used to be silent, so
    # when the set moved onto the six-tier ladder every Genesis, Vault and Basic
    # card printed the bone-white of a common and nothing said so. 143 shipped
    # faces carry that mistake. An unknown tier must stop the render.
    dot_fill, _ = RARITY_DOT[card["rarity"]]
    cx, cy = CARD_W - 72 - 7, 1051
    draw.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=hex_rgb(dot_fill))

    # Genesis, and only Genesis, gets a bright core.
    #
    # Nine cards in the set are Genesis and twenty-one copies of each will ever
    # exist, so they have to be findable across a table rather than by squinting
    # at a swatch. A second hue would not do that: roughly one man in twelve has
    # a red-green deficiency, and any hue ladder collapses in greyscale or under
    # a phone photo. A core is STRUCTURAL - it survives both, and it survives the
    # card being printed by somebody else's printer.
    if card["rarity"] == "genesis":
        draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=hex_rgb(GENESIS_CORE))

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
    geometry = {}
    for index, (card, art_dir) in enumerate(entries, start=1):
        image = render_card(card, index, art_dir, args.border_amp, args.guides)
        x, y, w, h = FACE_GEOMETRY[card["id"]]
        if args.format == "webp":
            x, y = x - TRIM_INSET, y - TRIM_INSET
        if args.scale != 1.0:
            x, y, w, h = (round(v * args.scale) for v in (x, y, w, h))
        geometry[card["name"]] = {"id": card["id"], "art": [x, y, w, h]}
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

    # The sidecar the game board crops art tiles from: per card, where the
    # illustration sits inside the emitted face image, in that image's pixels.
    face_w = TRIM_W if args.format == "webp" else CARD_W
    face_h = TRIM_H if args.format == "webp" else CARD_H
    if args.scale != 1.0:
        face_w, face_h = round(face_w * args.scale), round(face_h * args.scale)
    (args.out / "face-geometry.json").write_text(
        json.dumps({"size": [face_w, face_h], "faces": geometry}, indent=1, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )

    average = written / max(1, len(entries))
    print(f"wrote {len(entries)} {args.format} card faces to {args.out}")
    print(f"  {written / 1024 / 1024:.1f} MB total, {average / 1024:.0f} KB average")
    if missing_art:
        print(f"note: {len(missing_art)} rendered without artwork, first: {missing_art[0]}")


if __name__ == "__main__":
    main()
