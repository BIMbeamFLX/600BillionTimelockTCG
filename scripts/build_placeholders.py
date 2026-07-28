"""Render placeholder card faces for every card in cards/cards.csv.

Full 750x1050 card renders in the 600B palette (soot background, official affinity
accent colors, bundled Anton / Alfa Slab One fonts), clearly marked as placeholders.
Output goes to art/cards/placeholders/; finished art in art/cards/ overrides these
at install time (see build_set.install).

Usage:
    python scripts/build_placeholders.py
"""

from __future__ import annotations

import logging
from pathlib import Path

from build_set import Card, load_cards
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = REPO_ROOT / "art" / "fonts"
OUT_DIR = REPO_ROOT / "art" / "cards" / "placeholders"

CARD_W, CARD_H = 750, 1050

# Official ring colors from art/resources/*.svg.
ACCENTS = {
    "P": "#FF6A00",
    "B": "#F3C244",
    "K": "#7447B8",
    "S": "#FFF7EC",
    "T": "#5E5ACB",
}
SUBTYPE_TO_AFFINITY = {
    "Power": "P",
    "Bitcoin": "B",
    "Keys": "K",
    "Signal": "S",
    "Timelock": "T",
}
NEUTRAL = "#8A8F98"
SOOT = "#111111"
CHARCOAL = "#222222"
PANEL = "#1C1C1C"
INK = "#161616"
LINE = "#2A2A2A"
CREAM = "#FFF7EC"
GRAY = "#8A8F98"

log = logging.getLogger("build_placeholders")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    """Load a bundled display font, or Arial for body text."""
    if name == "body":
        try:
            return ImageFont.truetype("arial.ttf", size)
        except OSError:
            name = "Anton-Regular.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size)


def affinity_letters(card: Card) -> str:
    """Affinity letters for a card: cost symbols, or Resource subtype, or empty."""
    letters = "".join(dict.fromkeys(ch for ch in card.cost.upper() if ch in ACCENTS))
    if not letters and card.cardtype == "Resource":
        letter = SUBTYPE_TO_AFFINITY.get(card.subtype, "")
        letters = letter
    return letters


def accent_color(card: Card) -> str:
    """Primary accent color for the card frame."""
    letters = affinity_letters(card)
    return ACCENTS[letters[0]] if letters else NEUTRAL


def cost_tokens(cost: str) -> list[str]:
    """Split a cost like '4BB' into ['4', 'B', 'B']."""
    tokens: list[str] = []
    digits = ""
    for ch in cost:
        if ch.isdigit():
            digits += ch
        else:
            if digits:
                tokens.append(digits)
                digits = ""
            tokens.append(ch.upper())
    if digits:
        tokens.append(digits)
    return tokens


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    """Word-wrap text to a pixel width."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        line = words[0]
        for word in words[1:]:
            candidate = f"{line} {word}"
            if draw.textlength(candidate, font=fnt) <= max_w:
                line = candidate
            else:
                lines.append(line)
                line = word
        lines.append(line)
    return lines


def draw_affinity_circle(
    draw: ImageDraw.ImageDraw, center: tuple[int, int], radius: int, letter: str
) -> None:
    """Dark disc with a colored ring and a letter, like the resource icons."""
    color = ACCENTS.get(letter, NEUTRAL)
    x, y = center
    box = (x - radius, y - radius, x + radius, y + radius)
    draw.ellipse(box, fill=SOOT, outline=color, width=max(3, radius // 12))
    fnt = font("Anton-Regular.ttf", int(radius * 1.15))
    draw.text((x, y), letter or "N", font=fnt, fill=CREAM, anchor="mm")


def render_card(card: Card, out_path: Path) -> None:
    """Render one placeholder card face."""
    accent = accent_color(card)
    img = Image.new("RGB", (CARD_W, CARD_H), "#0B0B0B")
    draw = ImageDraw.Draw(img)

    draw.rounded_rectangle(
        (12, 12, CARD_W - 12, CARD_H - 12),
        radius=28,
        fill=SOOT,
        outline=accent,
        width=6,
    )

    # Name bar with cost circles right-aligned.
    draw.rounded_rectangle((40, 44, 710, 112), radius=14, fill=CHARCOAL)
    tokens = cost_tokens(card.cost)
    cx = 710 - 16 - 26
    for token in reversed(tokens):
        if token.isdigit():
            draw.ellipse(
                (cx - 26, 52, cx + 26, 104), fill=SOOT, outline=NEUTRAL, width=4
            )
            draw.text(
                (cx, 78),
                token,
                font=font("AlfaSlabOne-Regular.ttf", 30),
                fill=CREAM,
                anchor="mm",
            )
        else:
            draw_affinity_circle(draw, (cx, 78), 26, token)
        cx -= 60
    name_max_w = cx + 34 - 56 - 8
    size = 44
    while (
        size > 22
        and draw.textlength(card.name, font=font("Anton-Regular.ttf", size))
        > name_max_w
    ):
        size -= 2
    draw.text(
        (56, 78),
        card.name,
        font=font("Anton-Regular.ttf", size),
        fill=CREAM,
        anchor="lm",
    )

    # Art panel with a large affinity emblem.
    draw.rounded_rectangle(
        (48, 132, 702, 570), radius=12, fill=PANEL, outline=LINE, width=2
    )
    letters = affinity_letters(card)
    if len(letters) <= 1:
        draw_affinity_circle(draw, (375, 330), 95, letters[:1])
    else:
        offset = 110
        start = 375 - offset * (len(letters) - 1) // 2
        for i, letter in enumerate(letters):
            draw_affinity_circle(draw, (start + i * offset, 330), 80, letter)
    draw.text(
        (375, 480),
        "A R T   I N   P R O G R E S S",
        font=font("Anton-Regular.ttf", 30),
        fill=GRAY,
        anchor="mm",
    )

    # Type line.
    draw.rounded_rectangle((48, 592, 702, 650), radius=10, fill=CHARCOAL)
    draw.text(
        (64, 621),
        card.type_line,
        font=font("Anton-Regular.ttf", 30),
        fill=CREAM,
        anchor="lm",
    )

    # Rules text.
    draw.rounded_rectangle(
        (48, 670, 702, 940), radius=10, fill=INK, outline=LINE, width=2
    )
    if card.text:
        body = font("body", 30)
        y = 700
        for line in wrap_text(draw, card.text, body, 606):
            draw.text((72, y), line, font=body, fill=CREAM)
            y += 40

    # Footer: set stamp and Action/Resilience plate.
    draw.text(
        (56, 980),
        "600B · E1 · PLACEHOLDER",
        font=font("body", 24),
        fill=GRAY,
        anchor="lm",
    )
    if card.ar:
        draw.rounded_rectangle(
            (578, 944, 702, 1008), radius=12, fill=CHARCOAL, outline=accent, width=3
        )
        draw.text(
            (640, 976),
            card.ar,
            font=font("AlfaSlabOne-Regular.ttf", 38),
            fill=CREAM,
            anchor="mm",
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def main() -> None:
    """Render placeholders for every card in the set."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cards = load_cards(REPO_ROOT / "cards" / "cards.csv")
    for card in cards:
        render_card(card, OUT_DIR / f"{card.name}.png")
    log.info("rendered %d placeholder cards to %s", len(cards), OUT_DIR)


if __name__ == "__main__":
    main()
