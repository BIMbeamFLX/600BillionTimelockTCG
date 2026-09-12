"""Design the Fast (F1.0) values for all 295 Edition One cards.

Every card keeps its id, name, affinity and artwork. Cost, stats, type and rules
text are re-derived here for the Fast profile — pool mana, no Queue, no blocking,
no Resource cards — by rules that can be read in one sitting, and written to
cards/e1-fast.json. Classic's cards/e1-cards.json is read, never written.

    uv run python scripts/design_fast_cards.py            # write cards/e1-fast.json
    uv run python scripts/design_fast_cards.py --check    # fail if the file is stale

The rules, in order:

1. Resource cards stop being Resources. A Basic Resource becomes a two-cost
   Hardware that generates its own affinity; a Junction becomes a four-cost
   Hardware that generates two neutral Resources. In Fast that is ramp.
2. Rules text loses what Fast does not have. Keyword reminders are rewritten
   for Fast. Mesh and Backchannel go. Broadcast Guard becomes Firewall,
   Shielded from becomes Reboot, and "can't be blocked" becomes Broadcast.
   Lines about the Queue, blocking, the Clash or Resource cards are removed.
3. An Avatar that lost a line gets its value back as stats. A spell or
   permanent left with no text gets an effect from its affinity's class kit.
4. Avatar stats follow one budget: Action + Resilience = 2 × cost + 1, minus one
   per ability line, keeping the card's own Action/Resilience ratio. Then each
   affinity's balance offset from the simulator is added.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CLASSIC = ROOT / "cards" / "e1-cards.json"
FAST = ROOT / "cards" / "e1-fast.json"

SYMBOL = {"Power": "P", "Bitcoin": "B", "Keys": "K", "Signal": "S", "Timelock": "T"}
KEYWORDS = ("Broadcast Guard", "Broadcast", "First Strike", "Overflow", "Firewall", "Boot Delay", "Reboot")
REMINDER = {
    "Firewall": "Firewall (Attacks must target this Avatar first.)",
    "Broadcast": "Broadcast (Ignores Firewall.)",
    "First Strike": "First Strike",
    "Overflow": "Overflow",
    "Boot Delay": "Boot Delay",
    "Reboot": "Reboot",
}

# Stat offsets per affinity for Avatars of cost 2 or more, set from simulator runs
# (`node scripts/sim.mjs --profile fast`). Positive makes the class stronger.
BALANCE = {"Power": 0, "Bitcoin": 0, "Keys": 0, "Signal": 0, "Timelock": 0}

# Lines that describe rules Fast does not have. A match removes the line.
DEAD_LINE = [
    re.compile(r"\bQueue\b"),
    re.compile(r"\bblock", re.IGNORECASE),
    re.compile(r"\bclash\b", re.IGNORECASE),
    re.compile(r"\bMesh\b"),
    re.compile(r"\bBuffer\b"),
    re.compile(r"\bunspent\b"),
    re.compile(r"Shielded from"),
    re.compile(r"as though it didn't have Firewall"),
    re.compile(r"\bBackchannel\b"),
]
# A line about Resource cards is dead; a line that generates Resources is ramp.
RESOURCE_CARD = re.compile(r"\bResources?\b")

# Classic effects priced for a slower game get a Fast cost floor.
COST_FLOOR = {
    "take one additional turn": 7,
    "Draw two cards": 2,
    "draws seven cards": 5,
}


def total_cost(cost: str) -> int:
    """The mana a printed cost takes from a Fast pool; X counts as nothing."""
    digits = "".join(ch for ch in cost if ch.isdigit())
    return (int(digits) if digits else 0) + sum(1 for ch in cost if ch in "PBKST")


def printed_cost(amount: int, affinity: list[str]) -> str:
    """Write a Fast cost with one class symbol, so the card still shows its class."""
    if amount <= 0:
        return "0"
    symbol = SYMBOL.get(affinity[0]) if affinity else None
    if not symbol:
        return str(amount)
    return (str(amount - 1) if amount > 1 else "") + symbol


def keyword_line(line: str) -> str | None:
    """A line that is only keywords (with or without reminders) → its Fast spelling."""
    bare = re.sub(r"\([^)]*\)", "", line)
    bare = re.sub(r"\s[—-]\s.*$", "", bare).strip().rstrip(".")
    parts = [part.strip() for part in re.split(r"[;,]", bare) if part.strip()]
    if not parts:
        return None
    names = []
    for part in parts:
        part = re.sub(r"^Backchannel.*$", "", part).strip()
        if not part:
            continue
        if part == "Mesh":
            continue
        if part == "Broadcast Guard" or part.startswith("Shielded from"):
            part = "Firewall" if part == "Broadcast Guard" else "Reboot"
        if part not in KEYWORDS:
            return None
        if part not in names:
            names.append(part)
    return "\n".join(REMINDER[name] for name in names)


def fast_lines(text: str) -> tuple[list[str], int]:
    """Rules text lines for Fast, and how many lines were removed as dead."""
    kept: list[str] = []
    removed = 0
    for raw in [line.strip() for line in text.split("\n") if line.strip()]:
        if raw == "No special ability.":
            continue
        keywords = keyword_line(raw)
        if keywords is not None:
            if keywords:
                kept.extend(keywords.split("\n"))
            else:
                removed += 1
            continue
        if re.search(r"can't be blocked", raw, re.IGNORECASE) and not re.search(r"\bQueue\b", raw):
            kept.append(REMINDER["Broadcast"])
            continue
        line = re.sub(r"generate (\d+) Resources? of (?:one|any) affinity", r"generate \1 neutral Resources", raw)
        dead = any(pattern.search(line) for pattern in DEAD_LINE)
        dead = dead or (RESOURCE_CARD.search(line) is not None and "generate" not in line)
        if dead:
            removed += 1
            continue
        kept.append(line)
    return kept, removed


# Each class kit: (minimum cost, text). Power burns, Bitcoin grows and draws,
# Keys removes, Signal moves, Timelock digs. {name} is the card's own name; {n}
# and {n2} scale with the cost the card ends up priced at.
SPELL_KIT = {
    "Power": [(1, "{name} deals {n} damage to any target."), (1, "Decommission target Firewall."),
              (2, "{name} deals {n} damage to any target.")],
    "Bitcoin": [(1, "Target Avatar gets +3 Action and +3 Resilience until end of turn."), (2, "Draw two cards."),
                (2, "Target player gains {n2} Uptime.")],
    "Keys": [(1, "Decommission target Hardware."),
             (4, "Decommission target non-Hardware, non-Keys Avatar. It can't be Rebooted."),
             (2, "Search your Stack for a card, put that card into your Wallet, then shuffle.")],
    "Signal": [(2, "Return target Avatar to its owner's Wallet."), (1, "Decommission target Hardware or Protocol."),
               (1, "Target Avatar gains Broadcast until end of turn.")],
    "Timelock": [(3, "Target player moves the top three cards of their Stack into their Wallet."),
                 (2, "Return target Avatar to its owner's Wallet."),
                 (1, "Target Avatar gains Broadcast until end of turn.")],
}
PERMANENT_KIT = [(4, "Commit: draw a card."), (4, "3, Commit: This Hardware deals 1 damage to any target.")]


def class_kit(card: dict[str, Any], cost: int) -> tuple[str, int]:
    """An effect from the affinity's class kit for a card left without text.

    The pick rotates by card number, so a class does not print one effect ten
    times. Returns the text and the cost the effect is priced at.
    """
    affinity = (card["affinity"] or ["Neutral"])[0]
    number = int(card["id"].split("-")[1])
    if card["card_type"] == "Protocol" and affinity in SYMBOL:
        return f"{affinity} Avatars get +1 Action and +1 Resilience.", max(cost, 2)
    if card["card_type"] in ("Hardware", "Protocol"):
        floor, text = PERMANENT_KIT[number % len(PERMANENT_KIT)]
        return text, max(cost, floor)
    kit = SPELL_KIT.get(affinity, SPELL_KIT["Bitcoin"])
    floor, text = kit[number % len(kit)]
    cost = max(cost, floor)
    return text.format(name=card["name"], n=min(cost + 1, 6), n2=2 * cost + 1), cost


def stats(card: dict[str, Any], cost: int, lines: list[str], removed: int) -> str:
    """Avatar stats from the Fast budget, keeping the card's own shape."""
    match = re.match(r"^\s*(\d+)\s*/\s*(\d+)", card["action_resilience"] or "")
    action, resilience = (int(match.group(1)), int(match.group(2))) if match else (1, 1)
    abilities = sum(1 for line in lines if keyword_line(line) is None)
    keywords = sum(1 for line in lines if keyword_line(line) is not None)
    budget = 2 * cost + 1 - abilities - keywords // 2 + removed
    if cost >= 2:
        budget += BALANCE.get((card["affinity"] or ["Neutral"])[0], 0)
    budget = max(2, budget)
    ratio = action / (action + resilience) if action + resilience else 0.5
    new_action = max(0, min(budget - 1, round(budget * ratio)))
    if "Firewall" in " ".join(lines):
        new_action = min(new_action, budget // 2)  # a taunt is a wall first
    return f"{new_action}/{budget - new_action}"


def design(card: dict[str, Any]) -> dict[str, Any]:
    """The Fast values for one card."""
    kind = card["card_type"]
    affinity = card["affinity"] or []
    note = []
    if kind == "Basic Resource":
        aff = affinity[0]
        return {
            "id": card["id"], "name": card["name"], "card_type": "Hardware", "cost": printed_cost(2, affinity),
            "action_resilience": "", "rules_text": f"Commit: generate 1 {aff} Resource.",
            "design_note": "Resource card → two-cost ramp Hardware.",
        }
    if kind == "Resource":
        return {
            "id": card["id"], "name": card["name"], "card_type": "Hardware", "cost": printed_cost(4, affinity),
            "action_resilience": "", "rules_text": "Commit: generate 2 neutral Resources.",
            "design_note": "Junction → four-cost ramp Hardware.",
        }
    x = "X" in card["cost"]
    cost = total_cost(card["cost"])
    lines, removed = fast_lines(card["rules_text"])
    if removed:
        note.append(f"removed {removed} line(s) Fast does not play")
    is_avatar = "Avatar" in kind
    if is_avatar:
        cost = max(cost, 1)
        text = "\n".join(lines) if lines else "No special ability."
        result_stats = stats(card, cost, lines, removed)
    else:
        result_stats = card["action_resilience"]
        if lines:
            text = "\n".join(lines)
        else:
            text, cost = class_kit(card, cost)
            x = False
            note.append("class kit effect")
    if not is_avatar and len(lines) == 1 and lines[0].startswith("Attach to"):
        text = "Attach to Avatar\nAttached Avatar gets +2 Action and +2 Resilience."
        cost = max(cost, 2)
        note.append("aura kit effect")
    for phrase, floor in COST_FLOOR.items():
        if phrase in text and cost < floor:
            cost = floor
            note.append(f"cost floor {floor}")
    printed = printed_cost(cost, affinity)
    if x:
        printed = "X" + printed_cost(max(0, cost), affinity).lstrip("0")
    return {
        "id": card["id"], "name": card["name"], "card_type": kind, "cost": printed,
        "action_resilience": result_stats, "rules_text": text,
        "design_note": "; ".join(note) or "re-costed and re-statted for Fast",
    }


def build() -> dict[str, Any]:
    """The whole Fast set, in catalog order."""
    cards = json.loads(CLASSIC.read_text(encoding="utf-8"))["cards"]
    return {
        "ruleset": "F1.0",
        "source": "cards/e1-cards.json",
        "generator": "scripts/design_fast_cards.py",
        "balance": BALANCE,
        "cards": [design(card) for card in cards],
    }


def main() -> None:
    """Write cards/e1-fast.json, or with --check fail when it is out of date."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--balance", type=json.loads, help="try other BALANCE offsets, as JSON")
    args = parser.parse_args()
    if args.balance:
        BALANCE.update(args.balance)
    text = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not FAST.exists() or FAST.read_text(encoding="utf-8") != text:
            sys.exit("cards/e1-fast.json is stale: run scripts/design_fast_cards.py")
        return
    FAST.write_text(text, encoding="utf-8")
    print(f"wrote {FAST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
