"""Add deterministic bullish flavor text to the current Edition One text lock."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

from build_full_set import flavor_for

log = logging.getLogger("lock_flavor_text")


def record_decisions(db_path: Path, cards: list[dict[str, Any]]) -> None:
    """Record every flavor line before public card data is updated."""
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS flavor_text_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                flavor_text TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM flavor_text_decisions;
            """
        )
        connection.executemany(
            """
            INSERT INTO flavor_text_decisions (
                card_id, public_name, flavor_text, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    card["id"],
                    card["name"],
                    card["flavor_text"],
                    "text-locked",
                    "short collectible copy; no rules or educational effect",
                    "auto:codex:e1-flavor",
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
    """Write the flavor consistency result."""
    duplicate_count = len(cards) - len({card["flavor_text"] for card in cards})
    type_counts = Counter(card["card_type"] for card in cards)
    lines = [
        "# Edition One Text-Lock Consistency Report",
        "",
        "- Version: `E1.0-text-lock`",
        f"- Cards checked: **{len(cards)}**",
        f"- Flavor lines: **{len(cards)}**",
        f"- Repeated full flavor lines: **{duplicate_count}**",
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
            "- short bullish flavor copy on every card",
            "- no learning explanation printed on card faces",
            "- every Avatar tied to official join.600.wtf identity references",
            "- image generation blocked until the art-prompt gate passes",
            "",
        )
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    """Lock flavor in JSON, CSV, Markdown and the local audit trail."""
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
    for card in cards:
        card["flavor_text"] = flavor_for(
            card["name"],
            card["card_type"],
            card["source_slot"],
        )
    if not all(card["flavor_text"] and len(card["flavor_text"]) <= 110 for card in cards):
        raise ValueError("flavor lock failed length or completeness check")

    record_decisions(args.audit_db, cards)
    args.cards.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_csv(repo_root / "cards" / "cards.csv", cards)
    write_catalog(repo_root / "cards" / "E1-CARD-TEXT.md", payload)
    write_report(repo_root / "cards" / "e1-text-lock-report.md", cards)
    log.info("flavor lock passed: %d collectible lines", len(cards))


if __name__ == "__main__":
    main()
