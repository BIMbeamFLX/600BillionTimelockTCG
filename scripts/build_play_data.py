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
    """Split a printed cost such as `3SS` or `XB` into its parts.

    Each printed X charges X generic at the value the player announces; the
    engine's costWithX() does the multiplication. Dropping the X silently — as
    this function used to — made every X card play for its colored part alone.
    """
    if cost == "":
        return None
    generic = "".join(ch for ch in cost if ch.isdigit())
    parsed: dict[str, int] = {"generic": int(generic) if generic else 0}
    for symbol in cost:
        if symbol in SYMBOL_AFFINITY:
            parsed[symbol] = parsed.get(symbol, 0) + 1
    x_count = cost.count("X")
    if x_count:
        parsed["x"] = x_count
    return parsed


def _amt(token: str) -> Any:
    """An op amount: a number, a number word, or the X the player paid for."""
    token = token.strip()
    if token.upper() == "X":
        return "x"
    return _count(token)


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
    """Collect the static keywords the engine can enforce without scripting.

    A keyword is printed on the card only when it stands alone on a keyword
    line ("Broadcast; Mesh.", "First Strike — reminder…"). Matching it anywhere
    in the rules text used to hand a PERMANENT keyword to every card that
    merely talks about one — "gains Broadcast until end of turn" made the
    Avatar broadcast forever.
    """
    found: list[dict[str, Any]] = []
    fragments: list[str] = []
    for line in text.split("\n"):
        for fragment in re.split(r"[;,]", _strip_reminder(line)):
            fragments.append(fragment.strip().rstrip("."))
    for keyword in KEYWORDS:
        printed = any(f == keyword or f.startswith(f"{keyword} —") for f in fragments)
        if printed:
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


# Triggered-ability heads the engine can raise (engine.js raiseTriggers). Each
# entry is (pattern, factory); the factory turns the match into the compiled
# trigger condition and the rest of the line is the effect.
TRIGGER_HEADS: list[tuple[re.Pattern[str], Any]] = [
    (
        re.compile(r"^At the beginning of your Maintenance,\s*", re.I),
        lambda m: {"on": "maintenance", "whose": "you"},
    ),
    (
        re.compile(r"^At the beginning of each player's Maintenance,\s*", re.I),
        lambda m: {"on": "maintenance", "whose": "each"},
    ),
    (
        re.compile(r"^Whenever this Avatar is dealt damage,\s*", re.I),
        lambda m: {"on": "self-damaged"},
    ),
    (
        re.compile(r"^Whenever this Avatar deals damage to an opponent,\s*", re.I),
        lambda m: {"on": "self-deals-player-damage"},
    ),
    (
        re.compile(
            r"^Whenever a (Power|Bitcoin|Keys|Signal|Timelock) Resource an opponent"
            r" controls becomes committed,\s*",
            re.I,
        ),
        lambda m: {
            "on": "committed",
            "what": "Resource",
            "whose": "opponent",
            "affinity": m.group(1).capitalize(),
        },
    ),
    (
        re.compile(r"^Whenever a player commits a Resource for Resource,\s*", re.I),
        lambda m: {"on": "committed", "what": "Resource"},
    ),
    (
        re.compile(
            r"^Whenever a (Power|Bitcoin|Keys|Signal|Timelock) Resource is committed"
            r" for Resource,\s*",
            re.I,
        ),
        lambda m: {"on": "committed", "what": "Resource", "affinity": m.group(1).capitalize()},
    ),
    (
        re.compile(r"^Whenever a Resource enters,\s*", re.I),
        lambda m: {"on": "enters", "what": "Resource"},
    ),
    (
        re.compile(r"^Whenever a Resource is put into an Archive from the Network,\s*", re.I),
        lambda m: {"on": "network-archived", "what": "Resource"},
    ),
    (
        re.compile(r"^Whenever an Avatar is decommissioned,\s*", re.I),
        lambda m: {"on": "network-archived", "what": "Avatar"},
    ),
    (
        # The printed text says "a player play a … card" — matched as printed.
        re.compile(
            r"^Whenever a players? plays? a (Power|Bitcoin|Keys|Signal|Timelock) card"
            r" on the Queue,\s*",
            re.I,
        ),
        lambda m: {"on": "card-queued", "affinity": m.group(1).capitalize()},
    ),
]


def parse_trigger_ops(effect: str, card_name: str) -> list[dict[str, Any]] | None:
    """Effects inside a trigger, where "that player" is bound at raise time."""
    text = effect.strip().rstrip(".")

    # Optional costs. "You may pay X. If you do, …" runs the effect on payment;
    # "… unless you pay X" runs it on refusal. Both compile to one mayPay op
    # whose branches hold plain, choice-free ops.
    may_pay = re.match(r"^you may pay ([0-9PBKST]+)\. If you do, (.+)$", text, re.I)
    if may_pay:
        cost = parse_cost(may_pay.group(1))
        then_ops = parse_trigger_ops(may_pay.group(2), card_name)
        if cost and then_ops:
            return [
                {
                    "op": "mayPay",
                    "cost": cost,
                    "then": then_ops,
                    "prompt": f"Pay {may_pay.group(1)}? If you do: {may_pay.group(2)}",
                    "payLabel": f"Pay {may_pay.group(1)}",
                }
            ]
        return None

    unless_archive = re.match(
        r"^archive this (?:Protocol|Avatar|Hardware) unless you pay ([0-9PBKST]+)$",
        text,
        re.I,
    )
    if unless_archive:
        cost = parse_cost(unless_archive.group(1))
        if cost:
            return [
                {
                    "op": "mayPay",
                    "cost": cost,
                    "then": [],
                    "else": [{"op": "moveObject", "target": "self-object", "toZone": "archive"}],
                    "prompt": f"Pay {unless_archive.group(1)}, or this card is archived",
                    "payLabel": f"Pay {unless_archive.group(1)}",
                }
            ]
        return None

    unless_damage = re.match(
        r"^this Avatar deals (\d+) damage to you unless you pay ([0-9PBKST]+)$", text, re.I
    )
    if unless_damage:
        cost = parse_cost(unless_damage.group(2))
        if cost:
            return [
                {
                    "op": "mayPay",
                    "cost": cost,
                    "then": [],
                    "else": [
                        {
                            "op": "damage",
                            "amount": int(unless_damage.group(1)),
                            "target": "controller",
                        }
                    ],
                    "prompt": (
                        f"Pay {unless_damage.group(2)}, or take {unless_damage.group(1)} damage"
                    ),
                    "payLabel": f"Pay {unless_damage.group(2)}",
                }
            ]
        return None
    damage = re.match(
        r"^this (?:Protocol|Hardware|Attachment|Avatar) deals (\d+) damage to"
        r" that (?:player|Resource's controller)$",
        text,
        re.I,
    )
    if damage:
        return [{"op": "damage", "amount": int(damage.group(1)), "target": "event-player"}]
    if re.match(r"^that player discards a card at random$", text, re.I):
        return [{"op": "discard", "amount": 1, "target": "event-player"}]
    ledger = re.match(
        r"^this (?:Protocol|Hardware) deals damage to that player equal to the number of"
        r" (Power|Bitcoin|Keys|Signal|Timelock) Resources they control$",
        text,
        re.I,
    )
    if ledger:
        return [
            {
                "op": "damage",
                "amount": {"count": {"type": "Resource", "affinity": ledger.group(1).capitalize()}},
                "target": "event-player",
            }
        ]

    payout = re.match(
        r"^its controller generates (\d+) additional"
        r" (Power|Bitcoin|Keys|Signal|Timelock) Resources?$",
        text,
        re.I,
    )
    if payout:
        return [
            {
                "op": "generate",
                "amount": int(payout.group(1)),
                "affinity": payout.group(2).capitalize(),
                "target": "event-player",
            }
        ]
    if re.match(r"^put a \+1/\+1 marker on (?:it|this Avatar)$", text, re.I):
        return [{"op": "addCounter", "name": "+1/+1", "amount": 1, "target": "self-object"}]
    return parse_ops(text, card_name)


def parse_ops(effect: str, card_name: str) -> list[dict[str, Any]] | None:
    """Match one effect clause against the recurring templates in the set."""
    text = effect.strip().rstrip(".")
    subject = re.escape(card_name)
    ops: list[dict[str, Any]] = []

    # "generate 1 Keys or 1 Power" — the junction shape. The engine restricts
    # the affinity choice to exactly the named pair.
    generate_or = re.match(r"^generate (\d+) (\w+) or (\d+) (\w+)$", text, re.I)
    if generate_or:
        first, second = generate_or.group(2).capitalize(), generate_or.group(4).capitalize()
        if (
            first in AFFINITY_SYMBOL
            and second in AFFINITY_SYMBOL
            and generate_or.group(1) == generate_or.group(3)
        ):
            return [
                {
                    "op": "generate",
                    "amount": int(generate_or.group(1)),
                    "affinity": "choice",
                    "options": [first, second],
                }
            ]

    generate = re.match(
        r"^generate (\d+) (neutral Resources?|Resources? of (?:one|any) affinity"
        r"|Resources? of any type|\w+)(?: Resources?)?$",
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

    subject_any = rf"(?:{subject}|This (?:Avatar|Hardware|Protocol|Attachment)|It)"

    # "deals N damage to any target and M damage to you" — the self-cost shape.
    compound = re.match(
        rf"^{subject_any} deals (\d+) damage to (any target|target Avatar|target player)"
        r" and (\d+) damage to you$",
        text,
        re.I,
    )
    if compound:
        first = {
            "any target": "any",
            "target avatar": "avatar",
            "target player": "player",
        }[compound.group(2).lower()]
        return [
            {"op": "damage", "amount": int(compound.group(1)), "target": first},
            {"op": "damage", "amount": int(compound.group(3)), "target": "controller"},
        ]

    sweep = re.match(
        rf"^{subject_any} deals (\d+|X) damage to each Avatar and each player$", text, re.I
    )
    if sweep:
        return [
            {"op": "damage", "amount": _amt(sweep.group(1)), "target": "each-avatar"},
            {"op": "damage", "amount": _amt(sweep.group(1)), "target": "each-player"},
        ]

    # "X damage to each Avatar with/without Broadcast and each player".
    filtered = re.match(
        rf"^{subject_any} deals (\d+|X) damage to each Avatar (with|without) Broadcast"
        r" and each player$",
        text,
        re.I,
    )
    if filtered:
        return [
            {
                "op": "damage",
                "amount": _amt(filtered.group(1)),
                "target": "each-avatar",
                "filter": {"keyword": "Broadcast", "has": filtered.group(2).lower() == "with"},
            },
            {"op": "damage", "amount": _amt(filtered.group(1)), "target": "each-player"},
        ]

    damage = re.match(
        rf"^{subject_any} deals (\d+|X) damage to "
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
                "amount": _amt(damage.group(1)),
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

    uptime = re.match(r"^(?:(?:you|target player) )?gains? (\d+|X) Uptime$", text, re.I)
    if uptime:
        who = "player" if text.lower().startswith("target player") else "you"
        return [{"op": "uptime", "amount": _amt(uptime.group(1)), "target": who}]

    # "+X/+0" slash pumps, including negatives: "Target Avatar gets +X/+0 …".
    slash_pump = re.match(
        r"^(target Avatar|this Avatar) gets ([+-](?:\d+|X))/([+-](?:\d+|X))"
        r"(?: until end of turn)?$",
        text,
        re.I,
    )
    if slash_pump:

        def signed(token: str) -> Any:
            sign = -1 if token[0] == "-" else 1
            value = _amt(token[1:])
            return value if value == "x" and sign == 1 else sign * value if value != "x" else "x"

        return [
            {
                "op": "pump",
                "target": slash_pump.group(1).lower().replace(" ", "-"),
                "action": signed(slash_pump.group(2)),
                "resilience": signed(slash_pump.group(3)),
                "duration": "eot" if "until end of turn" in text.lower() else "static",
            }
        ]

    move_top = re.match(
        r"^Target player moves the top (\w+|X) cards? of their Stack into their Wallet$",
        text,
        re.I,
    )
    if move_top:
        return [{"op": "moveTop", "amount": _amt(move_top.group(1)), "toZone": "wallet"}]

    scramble = re.match(
        r"^Randomly choose (X|\d+) cards from target player's Wallet;"
        r" that player discards them$",
        text,
        re.I,
    )
    if scramble:
        return [{"op": "discard", "amount": _amt(scramble.group(1)), "target": "player"}]

    cold = re.match(
        r"^Cold Storage target Avatar\. Its controller gains Uptime equal to its Action$",
        text,
        re.I,
    )
    if cold:
        return [{"op": "coldStorage", "gainAction": True}]

    reboot = re.match(r"^Reboot (this|target) Avatar$", text, re.I)
    if reboot:
        return [{"op": "reboot", "scope": reboot.group(1).lower()}]

    discard = re.match(r"^target player discards (\w+) cards?$", text, re.I)
    if discard:
        return [{"op": "discard", "amount": _count(discard.group(1)), "target": "player"}]

    unlock = re.match(r"^unlock target (Resource|Avatar|Hardware|Protocol)$", text, re.I)
    if unlock:
        return [{"op": "unlock", "kind": unlock.group(1).capitalize()}]

    commit_target = re.match(r"^commit target Hardware, Avatar, or Resource$", text, re.I)
    if commit_target:
        return [{"op": "commit", "kind": "permanent"}]

    grantable = r"(Broadcast Guard|Broadcast|Mesh|First Strike|Overflow|Firewall)"
    grant = re.match(
        rf"^target Avatar gains {grantable} (?:until end of turn|this turn)$", text, re.I
    )
    if grant:
        return [{"op": "grant", "scope": "target", "keyword": grant.group(1), "duration": "eot"}]

    grant_self = re.match(rf"^This Avatar gains {grantable} until end of turn$", text, re.I)
    if grant_self:
        return [{"op": "grant", "scope": "self", "keyword": grant_self.group(1), "duration": "eot"}]

    bounce = re.match(r"^Return target Avatar to its owner's Wallet$", text, re.I)
    if bounce:
        return [{"op": "bounce"}]

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
            trigger_cond = None
            effect_text = line
            for pattern, make in TRIGGER_HEADS:
                head = pattern.match(line)
                if head:
                    trigger_cond = make(head)
                    effect_text = line[head.end() :]
                    break
            if trigger_cond:
                ops = parse_trigger_ops(effect_text, card["name"])
                abilities.append(
                    {
                        "kind": "triggered",
                        "cost": "",
                        "text": line,
                        "trigger": trigger_cond,
                        "ops": ops,
                        "manual": ops is None,
                    }
                )
            else:
                ops = parse_ops(line, card["name"])
                kind = "triggered" if re.match(r"^(When|Whenever|At)\b", line) else "static"
                if kind == "triggered":
                    # A trigger whose condition the engine cannot raise must
                    # stay assisted, even if its effect text would parse.
                    ops = None
                abilities.append(
                    {
                        "kind": "play" if ops and kind == "static" else kind,
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
    """Emit a plain script so the game also runs straight off the filesystem.

    The trailing CommonJS export lets `node --test` require the catalog without
    a DOM shim, so the referee core can be tested against the real 295 cards.
    """
    data = json.dumps(records, ensure_ascii=False).replace("</", "<\\/")
    scripted = sum(1 for record in records if not record["manual"])
    return (
        "/* Generated by scripts/build_play_data.py — do not edit by hand. */\n"
        f"/* {len(records)} cards, {scripted} fully auto-resolving. */\n"
        # globalThis, not window: in a browser they are the same object, so
        # existing `window.E1_CARDS` readers are unaffected, and under node
        # there is no DOM to shim.
        f"globalThis.E1_CARDS = {data};\n"
        'if (typeof module === "object" && module.exports) module.exports = globalThis.E1_CARDS;\n'
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
