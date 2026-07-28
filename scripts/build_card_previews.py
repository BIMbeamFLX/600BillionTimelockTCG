"""Render selected full-card previews from normalized generated artwork."""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

from build_cards import BLACK, CREAM, ORANGE, draw_card, safe_filename
from PIL import Image, ImageDraw, ImageFont, ImageOps

log = logging.getLogger("build_card_previews")


def record_decisions(
    db_path: Path,
    cards: list[dict[str, Any]],
    art_dir: Path,
    output_dir: Path,
) -> None:
    """Record the preview batch before writing images."""
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS card_preview_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                art_directory TEXT NOT NULL,
                output_directory TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM card_preview_decisions;
            """
        )
        connection.executemany(
            """
            INSERT INTO card_preview_decisions (
                card_id, public_name, art_directory, output_directory,
                status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card["id"],
                    card["name"],
                    str(art_dir),
                    str(output_dir),
                    "planned",
                    "visual QA before promotion into the final 295-card set",
                    "auto:codex:e1-card-preview",
                )
                for card in cards
            ],
        )
        connection.commit()


def build_sheet(
    cards: list[dict[str, Any]],
    output_dir: Path,
    path: Path,
    display_font: Path,
) -> None:
    """Create a two-row contact sheet for visual review."""
    columns = 3
    cell_width = 420
    cell_height = 650
    rows = (len(cards) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), BLACK)
    draw = ImageDraw.Draw(sheet)
    label_font = ImageFont.truetype(str(display_font), 20)
    for index, card in enumerate(cards):
        column = index % columns
        row = index // columns
        x = column * cell_width
        y = row * cell_height
        with Image.open(output_dir / safe_filename(card["name"])) as image:
            thumbnail = ImageOps.contain(
                image.convert("RGB"),
                (390, 546),
                Image.Resampling.LANCZOS,
            )
        sheet.paste(thumbnail, (x + 15, y + 8))
        draw.text((x + 18, y + 566), card["id"], font=label_font, fill=ORANGE)
        draw.text((x + 18, y + 594), card["name"], font=label_font, fill=CREAM)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=94, optimize=True)


def main() -> None:
    """Render selected cards and a visual-QA sheet."""
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
        default=repo_root / "art" / "generated" / "preview",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "art" / "generated" / "card-previews",
    )
    parser.add_argument(
        "--ids",
        nargs="+",
        default=[f"E1-{index:03d}" for index in range(1, 7)],
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    all_cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    by_id = {card["id"]: card for card in all_cards}
    cards = [by_id[card_id] for card_id in args.ids]
    missing = [card["id"] for card in cards if not (args.art / f"{card['id']}.jpg").exists()]
    if missing:
        raise ValueError(f"missing normalized preview art: {missing}")

    record_decisions(args.audit_db, cards, args.art, args.out)
    args.out.mkdir(parents=True, exist_ok=True)
    logo_path = repo_root / "art" / "brand" / "600B-logo-primary.png"
    display_font = repo_root / "art" / "fonts" / "Anton-Regular.ttf"
    with Image.open(logo_path) as logo_source:
        logo = ImageOps.exif_transpose(logo_source).convert("RGBA")
    for card in cards:
        with Image.open(args.art / f"{card['id']}.jpg") as art_source:
            face, metrics = draw_card(
                card,
                ImageOps.exif_transpose(art_source).convert("RGB"),
                logo,
                display_font,
            )
        if metrics.overflow:
            raise ValueError(f"preview text overflow: {card['id']}")
        face.save(
            args.out / safe_filename(card["name"]),
            "JPEG",
            quality=95,
            optimize=True,
        )
        log.info("rendered %s", card["id"])
    build_sheet(
        cards,
        args.out,
        args.out / "E1-iconic-six-preview.jpg",
        display_font,
    )


if __name__ == "__main__":
    main()
