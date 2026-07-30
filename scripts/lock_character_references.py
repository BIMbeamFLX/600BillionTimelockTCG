"""Lock every Avatar to its canonical join.600.wtf Detailed-front reference."""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

log = logging.getLogger("lock_character_references")
CHARACTER_SOURCE = "join.600.wtf / canonical Detailed ·front"


def build_reference_index(manifest: dict[str, Any]) -> dict[str, str]:
    """Index canonical local reference paths by every public character alias."""
    index: dict[str, str] = {}
    for item in manifest["files"]:
        for alias in item["card_aliases"]:
            index[alias.casefold()] = item["local_file"]
    return index


def record_decisions(
    db_path: Path,
    rows: list[tuple[str, str, str]],
) -> None:
    """Record character-reference decisions before rewriting public card data."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            DROP TABLE IF EXISTS character_reference_decisions;
            CREATE TABLE character_reference_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                reference_files TEXT NOT NULL,
                source_label TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        connection.executemany(
            """
            INSERT INTO character_reference_decisions (
                card_id, public_name, reference_files, source_label, status, reason,
                updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card_id,
                    name,
                    files,
                    CHARACTER_SOURCE,
                    "locked",
                    "canonical Detailed-front identity reference selected before image generation",
                    "auto:codex:e1-character-reference-lock",
                )
                for card_id, name, files in rows
            ],
        )
        connection.commit()


def lock_references(
    card_payload: dict[str, Any],
    reference_index: dict[str, str],
) -> list[tuple[str, str, str]]:
    """Update Avatar metadata and return its audit rows."""
    rows: list[tuple[str, str, str]] = []
    for card in card_payload["cards"]:
        character = card.get("character")
        if character is None:
            continue
        assets = []
        for name in character["names"]:
            reference = reference_index.get(name.casefold())
            if reference is None:
                raise ValueError(f"{card['id']}: no Detailed-front reference for {name}")
            assets.append(reference)
        character["source"] = CHARACTER_SOURCE
        character["assets"] = assets
        rows.append((card["id"], card["name"], json.dumps(assets, ensure_ascii=False)))
    if len(rows) != 92:
        raise ValueError(f"expected 92 Avatar reference locks, found {len(rows)}")
    return rows


def main() -> None:
    """Apply and audit the canonical character-reference lock."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root / "art" / "references" / "join-detailed-front" / "manifest.json",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    card_payload = json.loads(args.cards.read_text(encoding="utf-8"))
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rows = lock_references(card_payload, build_reference_index(manifest))
    record_decisions(args.audit_db, rows)
    args.cards.write_text(
        json.dumps(card_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    log.info("character reference lock passed: %d Avatar cards", len(rows))


if __name__ == "__main__":
    main()
