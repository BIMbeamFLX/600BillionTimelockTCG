"""Rebuild locked Edition One artwork with the official subtle 600B watermark."""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from normalize_generated_art import ART_HEIGHT, ART_WIDTH, normalize_one
from PIL import Image

log = logging.getLogger("apply_art_watermarks")
WATERMARK_FORMAT_VERSION = "600B-E1-art-1920x2400-v2-watermarked"


def resolve_source(repo_root: Path, source_file: str) -> Path:
    """Resolve a manifest source path without changing the source file."""
    source = Path(source_file)
    return source if source.is_absolute() else repo_root / source


def record_planned(
    db_path: Path,
    files: list[dict[str, Any]],
    output_dir: Path,
    logo_path: Path,
) -> None:
    """Record the complete watermark batch before any artwork is written."""
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS art_watermark_decisions (
                card_id TEXT PRIMARY KEY,
                source_path TEXT NOT NULL,
                output_path TEXT NOT NULL,
                logo_path TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.executemany(
            """
            INSERT OR REPLACE INTO art_watermark_decisions (
                card_id, source_path, output_path, logo_path, status,
                reason, updated_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    item["id"],
                    item["source_file"],
                    str(output_dir / item["file"]),
                    str(logo_path),
                    "planned",
                    "apply the official circular 600B logo as a subtle watermark",
                    "user:felix+auto:codex:art-watermark",
                    now,
                )
                for item in files
            ],
        )
        connection.commit()


def mark_generated(db_path: Path, card_ids: list[str]) -> None:
    """Mark all completed watermark decisions as generated."""
    now = datetime.now(UTC).isoformat()
    with sqlite3.connect(db_path) as connection:
        connection.executemany(
            """
            UPDATE art_watermark_decisions
            SET status='generated', updated_at=?
            WHERE card_id=?
            """,
            [(now, card_id) for card_id in card_ids],
        )
        connection.commit()


def main() -> None:
    """Rebuild all locked final artwork from its unwatermarked manifest source."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--art",
        type=Path,
        default=repo_root / "art" / "generated" / "prompts-v2-final-1920x2400",
    )
    parser.add_argument(
        "--logo",
        type=Path,
        default=repo_root / "art" / "brand" / "600B-logo-primary.png",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    manifest_path = args.art / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest["files"]
    if len(files) != 295:
        raise ValueError(f"expected 295 locked artworks, found {len(files)}")

    sources = {item["id"]: resolve_source(repo_root, item["source_file"]) for item in files}
    missing = [card_id for card_id, path in sources.items() if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing {len(missing)} watermark sources: {missing}")

    record_planned(args.audit_db, files, args.art, args.logo)
    with Image.open(args.logo) as opened_logo:
        logo = opened_logo.convert("RGBA")

    rebuilt = []
    for index, item in enumerate(files, start=1):
        normalized = normalize_one(
            sources[item["id"]],
            args.art / item["file"],
            watermark_logo=logo,
        )
        normalized.update(
            {
                "id": item["id"],
                "name": item["name"],
                "prompt_sha256": item.get("prompt_sha256"),
            }
        )
        rebuilt.append(normalized)
        if index % 25 == 0 or index == len(files):
            log.info("watermarked %d/%d standalone artworks", index, len(files))

    manifest.update(
        {
            "format_version": WATERMARK_FORMAT_VERSION,
            "required_size": [ART_WIDTH, ART_HEIGHT],
            "watermark_asset": "art/brand/600B-logo-primary.png",
            "watermark_policy": "subtle bottom-right official circular mark",
            "files": rebuilt,
        }
    )
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    mark_generated(args.audit_db, [item["id"] for item in rebuilt])
    log.info("watermark lock passed: %d artworks", len(rebuilt))


if __name__ == "__main__":
    main()
