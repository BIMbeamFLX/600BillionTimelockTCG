"""Normalize, render and audit standalone 600B promotional cards."""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from build_cards import (
    CARD_HEIGHT,
    CARD_WIDTH,
    draw_card,
    file_sha256,
    safe_filename,
    save_jpeg_atomic,
)
from normalize_generated_art import ART_HEIGHT, ART_WIDTH, normalize_one
from PIL import Image

log = logging.getLogger("build_promos")


def record_build(
    db_path: Path,
    card: dict[str, Any],
    source: Path,
    art_output: Path,
    face_output: Path,
    status: str,
) -> None:
    """Record one promo build state in the audit database."""
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS promo_card_decisions (
                card_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                action TEXT NOT NULL,
                source_path TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO promo_card_decisions (
                card_id, name, action, source_path, status, reason,
                updated_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card["id"],
                card["name"],
                "normalize-and-render",
                str(source),
                status,
                f"art={art_output}; face={face_output}",
                "auto:codex:promo-builder",
                now,
            ),
        )
        connection.commit()


def render_promo(
    card: dict[str, Any],
    source: Path,
    art_output: Path,
    face_output: Path,
    logo_path: Path,
    display_font: Path,
) -> dict[str, Any]:
    """Build one normalized artwork and card face."""
    art_output.parent.mkdir(parents=True, exist_ok=True)
    face_output.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(logo_path) as opened_logo:
        logo = opened_logo.convert("RGBA")
    normalized = normalize_one(source, art_output, watermark_logo=logo)

    with Image.open(art_output) as opened_art:
        artwork = opened_art.convert("RGB")
    face, metrics = draw_card(card, artwork, logo, display_font)
    save_jpeg_atomic(face, face_output, quality=94)
    if metrics.overflow:
        raise ValueError(f"text overflow on promo {card['id']}")

    return {
        "id": card["id"],
        "name": card["name"],
        "art_file": art_output.name,
        "art_size": [ART_WIDTH, ART_HEIGHT],
        "art_sha256": normalized["sha256"],
        "art_watermark": normalized["watermark"],
        "face_file": face_output.name,
        "face_size": [CARD_WIDTH, CARD_HEIGHT],
        "face_sha256": file_sha256(face_output),
        "status": "promo-locked",
    }


def main() -> None:
    """Build every declared promotional card."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=repo_root / "cards" / "promos.json")
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=repo_root / "art" / "generated" / "promos",
    )
    parser.add_argument(
        "--art-dir",
        type=Path,
        default=repo_root / "art" / "generated" / "promos" / "final",
    )
    parser.add_argument(
        "--faces",
        type=Path,
        default=repo_root / "art" / "cards" / "promos",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    payload = json.loads(args.cards.read_text(encoding="utf-8"))
    cards = payload["cards"]
    if payload["set"]["card_count"] != len(cards):
        raise ValueError("promo card count does not match the promo catalog")

    files = []
    for card in cards:
        source = args.source_dir / f"{card['id']}.png"
        art_output = args.art_dir / f"{card['id']}.jpg"
        face_output = args.faces / safe_filename(card["name"])
        record_build(
            args.audit_db,
            card,
            source,
            art_output,
            face_output,
            "planned",
        )
        files.append(
            render_promo(
                card,
                source,
                art_output,
                face_output,
                repo_root / "art" / "brand" / "600B-logo-primary.png",
                repo_root / "art" / "fonts" / "Anton-Regular.ttf",
            )
        )
        record_build(
            args.audit_db,
            card,
            source,
            art_output,
            face_output,
            "generated",
        )
        log.info("rendered %s", card["id"])

    manifest = {
        "phase": "promo-card-faces",
        "card_count": len(files),
        "files": files,
    }
    args.faces.mkdir(parents=True, exist_ok=True)
    (args.faces / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    log.info("promo lock passed: %d card(s)", len(files))


if __name__ == "__main__":
    main()
