"""Compile the locked Edition One catalog into playable data for the local game.

The engine enforces the rules framework — turn structure, costs, zones, clash and
state checks — and auto-resolves the ability templates that recur across the set.
Anything outside those templates is marked `manual`, so the card stays playable and
its controller resolves it with the table's own state controls. That mirrors how a
physical playtest runs and is why no card is locked out of the game.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

AFFINITY_SYMBOL = {"Power": "P", "Bitcoin": "B", "Keys": "K", "Signal": "S", "Timelock": "T"}
SYMBOL_AFFINITY = {symbol: name for name, symbol in AFFINITY_SYMBOL.items()}

# Static keywords the engine enforces on its own.
KEYWORDS = (
    "Broadcast Guard",
    "Broadcast",
    "First Strike",
    "Overflow",
    "Firewall",
    "Boot Delay",
    "Mesh",
    "Reboot",
)
ATTACH_RE = re.compile(r"^Attach to (\w+)")
SHIELDED_RE = re.compile(r"Shielded from (\w+)")
BACKCHANNEL_RE = re.compile(r"Backchannel\s*[—-]\s*(\w+)")

NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5}


def _count(token: str) -> int:
    """Read a rules-text quantity, which may be a digit or a spelled-out word."""
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    return NUMBER_WORDS.get(token, 1)


def parse_cost(cost: str) -> dict[str, int] | None:
    """Split a printed cost such as `3SS` into generic and per-affinity amounts."""
    if cost == "":
        return None
    generic = "".join(ch for ch in cost if ch.isdigit())
    parsed: dict[str, int] = {"generic": int(generic) if generic else 0}
    for symbol in cost:
        if symbol in SYMBOL_AFFINITY:
            parsed[symbol] = parsed.get(symbol, 0) + 1
    return parsed


def parse_stats(action_resilience: str) -> tuple[int | None, int | None]:
    """Split `4/4` into Action and Resilience, tolerating `*` and blanks."""
    if not action_resilience or "/" not in action_resilience:
        return None, None
    action, _, resilience = action_resilience.partition("/")

    def value(raw: str) -> int | None:
        raw = raw.strip()
        return int(raw) if raw.lstrip("-").isdigit() else None

    return value(action), value(resilience)


def parse_keywords(text: str) -> list[dict[str, Any]]:
    """Collect the static keywords the engine can enforce without scripting."""
    found: list[dict[str, Any]] = []
    for keyword in KEYWORDS:
        if re.search(rf"\b{re.escape(keyword)}\b", text):
            if keyword == "Broadcast" and any(k["name"] == "Broadcast Guard" for k in found):
                continue
            found.append({"name": keyword})
    for line in text.split("\n"):
        attach = ATTACH_RE.match(line.strip())
        if attach:
            found.append({"name": "Attach", "to": attach.group(1)})
    shielded = SHIELDED_RE.search(text)
    if shielded:
        found.append({"name": "Shielded", "from": shielded.group(1)})
    backchannel = BACKCHANNEL_RE.search(text)
    if backchannel:
        found.append({"name": "Backchannel", "resource": backchannel.group(1)})
    return found


def _strip_reminder(line: str) -> str:
    """Drop parenthetical reminder text, which never changes gameplay."""
    return re.sub(r"\s*\([^)]*\)", "", line).strip()


def parse_ops(effect: str, card_name: str) -> list[dict[str, Any]] | None:
    """Match one effect clause against the recurring templates in the set."""
    text = effect.strip().rstrip(".")
    subject = re.escape(card_name)
    ops: list[dict[str, Any]] = []

    generate = re.match(
        r"^generate (\d+) (neutral Resources?|Resources? of one affinity|\w+)(?: Resources?)?$",
        text,
        re.I,
    )
    if generate:
        amount, kind = int(generate.group(1)), generate.group(2)
        if kind.lower().startswith("neutral"):
            affinity = "neutral"
        elif kind.lower().startswith("resource"):
            affinity = "choice"
        elif kind.capitalize() in AFFINITY_SYMBOL:
            affinity = kind.capitalize()
        else:
            return None
        return [{"op": "generate", "amount": amount, "affinity": affinity}]

    damage = re.match(
        rf"^(?:{subject}|This Avatar|It) deals (\d+) damage to "
        r"(any target|target Avatar|target player|each Avatar|each player)$",
        text,
        re.I,
    )
    if damage:
        targets = {
            "any target": "any",
            "target avatar": "avatar",
            "target player": "player",
            "each avatar": "each-avatar",
            "each player": "each-player",
        }
        return [
            {
                "op": "damage",
                "amount": int(damage.group(1)),
                "target": targets[damage.group(2).lower()],
            }
        ]

    draw = re.match(r"^draw (a card|an additional card|\w+ cards?)$", text, re.I)
    if draw:
        token = draw.group(1).split()[0]
        return [{"op": "draw", "amount": _count(token)}]

    pump = re.match(
        r"^(target Avatar|this Avatar|attached Avatar|(?:Unlocked )?Avatars you control"
        r"|\w+ Avatars(?: you control)?) "
        r"gets? \+(\d+) Action and \+(\d+) Resilience(?: until end of turn)?$",
        text,
        re.I,
    )
    if pump:
        scope = pump.group(1).lower().replace(" ", "-")
        ops.append(
            {
                "op": "pump",
                "target": scope,
                "action": int(pump.group(2)),
                "resilience": int(pump.group(3)),
                "duration": "eot" if "until end of turn" in text.lower() else "static",
            }
        )
        return ops

    decommission = re.match(r"^decommission (target|all) (\w+)", text, re.I)
    if decommission:
        return [
            {
                "op": "decommission",
                "scope": decommission.group(1).lower(),
                "kind": decommission.group(2).rstrip("s").capitalize(),
            }
        ]

    uptime = re.match(r"^(?:(?:you|target player) )?gains? (\d+) Uptime$", text, re.I)
    if uptime:
        who = "player" if text.lower().startswith("target player") else "you"
        return [{"op": "uptime", "amount": int(uptime.group(1)), "target": who}]

    reboot = re.match(r"^Reboot (this|target) Avatar$", text, re.I)
    if reboot:
        return [{"op": "reboot", "scope": reboot.group(1).lower()}]

    discard = re.match(r"^target player discards (\w+) cards?$", text, re.I)
    if discard:
        return [{"op": "discard", "amount": _count(discard.group(1)), "target": "player"}]

    return None


def parse_abilities(card: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """Split rules text into abilities, auto-scripting the ones we recognise."""
    abilities: list[dict[str, Any]] = []
    manual = False
    for raw_line in card["rules_text"].split("\n"):
        line = _strip_reminder(raw_line)
        if not line or line == "No special ability.":
            continue
        if any(re.fullmatch(rf"{re.escape(k)}[.;,]?", line) for k in KEYWORDS):
            continue
        if ATTACH_RE.match(line):
            continue

        cost, _, effect = line.partition(":")
        if effect:
            ops = parse_ops(effect, card["name"])
            abilities.append(
                {
                    "kind": "activated",
                    "cost": cost.strip(),
                    "text": line,
                    "ops": ops,
                    "manual": ops is None,
                }
            )
        else:
            ops = parse_ops(line, card["name"])
            trigger = "triggered" if re.match(r"^(When|Whenever|At)\b", line) else "static"
            abilities.append(
                {
                    "kind": "play" if ops and trigger == "static" else trigger,
                    "cost": "",
                    "text": line,
                    "ops": ops,
                    "manual": ops is None,
                }
            )
        manual = manual or abilities[-1]["manual"]
    return abilities, manual


def playable_records(
    cards: list[dict[str, Any]], face_files: dict[str, str]
) -> list[dict[str, Any]]:
    """Turn locked card text into the shape the local engine consumes."""
    records = []
    for card in cards:
        action, resilience = parse_stats(card["action_resilience"])
        abilities, manual = parse_abilities(card)
        records.append(
            {
                "id": card["id"],
                "name": card["name"],
                "type": card["card_type"],
                "subtype": card["subtype"],
                "affinity": card["affinity"] or ["Neutral"],
                "cost": card["cost"],
                "costParsed": parse_cost(card["cost"]),
                "action": action,
                "resilience": resilience,
                "rarity": card["rarity"],
                "text": card["rules_text"],
                "flavor": card["flavor_text"],
                "help": card["help_text"],
                "face": f"{card['name']}.webp",
                "keywords": parse_keywords(card["rules_text"]),
                "abilities": abilities,
                "manual": manual,
            }
        )
    return records


def render_module(records: list[dict[str, Any]]) -> str:
    """Emit a plain script so the game also runs straight off the filesystem."""
    data = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    scripted = sum(1 for record in records if not record["manual"])
    return (
        "/* Generated by scripts/build_play_data.py — do not edit by hand. */\n"
        f"/* {len(records)} cards, {scripted} fully auto-resolving. */\n"
        f"window.E1_CARDS = {data};\n"
    )


def record_site_decision(db_path: Path, records: list[dict[str, Any]], output: Path) -> None:
    """Record the compile before writing the module."""
    payload = json.dumps(records, sort_keys=True, ensure_ascii=False).encode()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS site_builds (
                artifact TEXT PRIMARY KEY,
                input_fingerprint TEXT NOT NULL,
                record_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "INSERT OR REPLACE INTO site_builds (artifact, input_fingerprint, record_count,"
            " status, updated_by) VALUES (?, ?, ?, ?, ?)",
            (
                str(output),
                hashlib.sha256(payload).hexdigest(),
                len(records),
                "planned",
                "auto:claude:e1-local-game",
            ),
        )
        connection.commit()


def complete_site_decision(db_path: Path, output: Path) -> None:
    """Mark the module generated after a successful write."""
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE site_builds SET status='generated' WHERE artifact=?", (str(output),)
        )
        connection.commit()


def main() -> None:
    """Build site/play-data.js from the locked Edition One catalog."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=repo_root / "cards" / "e1-cards.json")
    parser.add_argument(
        "--face-manifest",
        type=Path,
        default=repo_root / "art" / "cards" / "final" / "manifest.json",
    )
    parser.add_argument("--out", type=Path, default=repo_root / "site" / "play-data.js")
    parser.add_argument("--audit-db", type=Path, default=repo_root / ".audit" / "e1-design.sqlite")
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    manifest = json.loads(args.face_manifest.read_text(encoding="utf-8"))
    face_files = {item["id"]: item["file"] for item in manifest["files"]}
    if len(cards) != 295:
        raise ValueError("the complete 295-card text lock is required")

    records = playable_records(cards, face_files)
    record_site_decision(args.audit_db, records, args.out)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_module(records), encoding="utf-8")
    complete_site_decision(args.audit_db, args.out)
    scripted = sum(1 for record in records if not record["manual"])
    print(
        f"wrote {args.out} with {len(records)} cards "
        f"({scripted} auto-resolving, {len(records) - scripted} assisted)"
    )


if __name__ == "__main__":
    main()
