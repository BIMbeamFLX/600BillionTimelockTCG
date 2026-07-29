"""Apply the audit-first Edition One editorial and terminology lock."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

from e1_editorial import (
    apply_editorial_copy,
    validate_catalog_shape,
    validate_editorial_copy,
)

log = logging.getLogger("lock_flavor_text")


def record_decisions(db_path: Path, cards: list[dict[str, Any]]) -> None:
    """Record the complete editorial revision before public data is updated."""
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS e1_editorial_card_decisions (
                card_id TEXT NOT NULL,
                revision TEXT NOT NULL,
                public_name TEXT NOT NULL,
                rules_text TEXT NOT NULL,
                flavor_text TEXT NOT NULL,
                protocol_note TEXT NOT NULL,
                protocol_source TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (card_id, revision)
            );
            """
        )
        connection.executemany(
            """
            INSERT OR REPLACE INTO e1_editorial_card_decisions (
                card_id, revision, public_name, rules_text, flavor_text,
                protocol_note, protocol_source, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card["id"],
                    "e1-fix-pass-2026-07-29",
                    card["name"],
                    card["rules_text"],
                    card["flavor_text"],
                    card["protocol_note"],
                    card["protocol_source"],
                    "text-locked",
                    "approved E1 terminology, flavor and educational-note fix pass",
                    "auto:codex:e1-editorial",
                )
                for card in cards
            ],
        )
        connection.commit()


def write_csv(path: Path, cards: list[dict[str, Any]]) -> None:
    """Update the adapter table while keeping flavor as optional metadata."""
    fields = (
        "id",
        "name",
        "type",
        "subtype",
        "cost",
        "ar",
        "rarity",
        "affinity",
        "text",
        "flavor_text",
        "protocol_note",
        "help_text",
    )
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for card in cards:
            writer.writerow(
                {
                    "id": card["id"],
                    "name": card["name"],
                    "type": card["card_type"],
                    "subtype": card["subtype"],
                    "cost": card["cost"],
                    "ar": card["action_resilience"],
                    "rarity": card["rarity"],
                    "affinity": " / ".join(card["affinity"]),
                    "text": card["rules_text"].replace("\n", "\\n"),
                    "flavor_text": card["flavor_text"],
                    "protocol_note": card["protocol_note"],
                    "help_text": card["help_text"],
                }
            )


def write_catalog(path: Path, payload: dict[str, Any]) -> None:
    """Write the complete human-readable text and metadata catalog."""
    cards = payload["cards"]
    lines = [
        "# 600B Timelock TCG — Edition One Complete Card Text",
        "",
        f"Text version: `{payload['set']['text_version']}`",
        f"Cards: **{len(cards)}**",
        "Status: **TEXT + FLAVOR LOCKED**",
        "",
        "Only rules and short italic flavor appear on the card face. Simple Guides,",
        "Protocol Notes, sources and art prompts remain digital game metadata.",
        "",
    ]
    current_group = ""
    for card in cards:
        group = card["affinity"][0] if len(card["affinity"]) == 1 else "Neutral / Multi-affinity"
        if group != current_group:
            current_group = group
            lines.extend((f"## {group}", ""))
        stats = f" · **{card['action_resilience']}**" if card["action_resilience"] else ""
        character = card.get("character")
        character_line = ""
        if character:
            character_line = f"\n**Character:** {', '.join(character['names'])}"
        lines.extend(
            (
                f"### {card['id']} · {card['name']}",
                "",
                f"**{card['type_line']}** · Cost **{card['cost'] or '—'}** · "
                f"{card['rarity'].title()}{stats}",
                character_line,
                "",
                card["rules_text"].replace("\n", "<br>\n"),
                "",
                f"**Flavor:** *{card['flavor_text']}*",
                "",
                f"**Simple Guide · metadata:** {card['help_text']}",
                "",
                f"**Protocol Note · metadata:** {card['protocol_note']}",
                f"**Primary source:** {card['protocol_source']}",
                "",
                f"**Art direction:** {card['art_direction']}",
                "",
                "---",
                "",
            )
        )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_report(path: Path, cards: list[dict[str, Any]]) -> None:
    """Write the complete editorial consistency result."""
    duplicate_count = len(cards) - len({card["flavor_text"] for card in cards})
    note_counts = Counter(card["protocol_note"] for card in cards)
    type_counts = Counter(card["card_type"] for card in cards)
    lines = [
        "# Edition One Text-Lock Consistency Report",
        "",
        "- Version: `E1.0-text-lock-r1`",
        f"- Cards checked: **{len(cards)}**",
        f"- Flavor lines: **{len(cards)}**",
        f"- Repeated full flavor lines: **{duplicate_count}**",
        f"- Unique Protocol Notes: **{len(note_counts)}**",
        f"- Maximum exact Protocol Note reuse: **{max(note_counts.values())}**",
        "- Visible face text: **rules + collectible flavor only**",
        "- Hidden metadata: **Simple Guide + Protocol Note + sources + prompts**",
        "- Rule layout: **maximum 3 lines**",
        "- Gate: **PASS — READY FOR IMAGE PHASE**",
        "",
        "## Card-type counts",
        "",
    ]
    lines.extend(f"- {name}: {count}" for name, count in sorted(type_counts.items()))
    lines.extend(
        (
            "",
            "## Checks",
            "",
            "- 295 complete records and unique public IDs",
            "- original free-form flavor copy on every card",
            "- no repeated flavor tail above two uses",
            "- no exact Protocol Note above two uses",
            "- canonical E1 reminder and terminology vocabulary",
            "- no learning explanation printed on card faces",
            "- every Avatar tied to official join.600.wtf identity references",
            "- image generation blocked until the art-prompt gate passes",
            "",
        )
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    """Lock editorial copy in JSON, CSV, Markdown and the local audit trail."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    payload = json.loads(args.cards.read_text(encoding="utf-8"))
    cards = payload["cards"]
    apply_editorial_copy(cards)
    findings = validate_catalog_shape() + validate_editorial_copy(cards)
    if findings:
        raise ValueError("editorial lock failed:\n" + "\n".join(findings))
    payload["set"]["text_version"] = "E1.0-text-lock-r1"
    payload["set"]["creative_direction"] = (
        "Educational and funny positive-cypherpunk stories about Bitcoin, Nostr and open systems."
    )

    record_decisions(args.audit_db, cards)
    args.cards.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(repo_root / "cards" / "cards.csv", cards)
    write_catalog(repo_root / "cards" / "E1-CARD-TEXT.md", payload)
    write_report(repo_root / "cards" / "e1-text-lock-report.md", cards)
    log.info("editorial lock passed: %d cards, audit recorded before public writes", len(cards))


if __name__ == "__main__":
    main()
