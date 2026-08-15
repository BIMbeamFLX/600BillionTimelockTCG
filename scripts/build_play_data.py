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
ATTACH_RE = re.compile(r"^Attach to (?:an? )?(\w+)")
# Line-anchored: "Attached Avatar has Shielded from Keys" is a GRANT for the
# host, not a shield on the attachment itself — matching anywhere gave every
# Shield card its own shield.
SHIELDED_RE = re.compile(r"^Shielded from (\w+)$")
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
    for line in text.split("\n"):
        shielded = SHIELDED_RE.match(_strip_reminder(line))
        if shielded:
            found.append({"name": "Shielded", "from": shielded.group(1)})
            break
    backchannel = BACKCHANNEL_RE.search(text)
    if backchannel:
        found.append({"name": "Backchannel", "resource": backchannel.group(1)})
    return found


def _strip_reminder(line: str) -> str:
    """Drop parenthetical reminder text, which never changes gameplay."""
    return re.sub(r"\s*\([^)]*\)", "", line).strip()


def _keyword_only_line(line: str) -> bool:
    """Return true when every clause is already represented in `keywords`."""
    fragments = [part.strip().rstrip(".") for part in re.split(r"[;,]", _strip_reminder(line))]
    if not fragments or any(not fragment for fragment in fragments):
        return False
    for fragment in fragments:
        printed = any(
            fragment == keyword or fragment.startswith(f"{keyword} —") for keyword in KEYWORDS
        )
        if printed or SHIELDED_RE.fullmatch(fragment) or BACKCHANNEL_RE.fullmatch(fragment):
            continue
        return False
    return True


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
    (
        re.compile(
            r"^At the beginning of the Maintenance of attached"
            r" (?:Protocol|Resource|Hardware|Avatar)'s controller,\s*",
            re.I,
        ),
        lambda m: {"on": "maintenance", "whose": "host"},
    ),
    (
        re.compile(r"^Whenever attached Resource becomes committed,\s*", re.I),
        lambda m: {"on": "committed", "whose": "host"},
    ),
    (
        re.compile(r"^When attached Resource becomes committed,\s*", re.I),
        lambda m: {"on": "committed", "whose": "host"},
    ),
    (
        re.compile(r"^Whenever attached Resource is committed for Resource,\s*", re.I),
        lambda m: {"on": "committed", "whose": "host"},
    ),
    (
        re.compile(r"^Whenever you play a Protocol card on the Queue,\s*", re.I),
        lambda m: {"on": "card-queued", "what": "Protocol", "whose": "you"},
    ),
    (
        re.compile(r"^Whenever you play a Resource,\s*", re.I),
        lambda m: {"on": "resource-played", "whose": "you"},
    ),
    (
        re.compile(r"^At the beginning of each player's draw step,\s*", re.I),
        lambda m: {"on": "draw-step", "whose": "each"},
    ),
    (
        re.compile(r"^At the beginning of the chosen player's Maintenance,\s*", re.I),
        lambda m: {"on": "maintenance", "whose": "chosen"},
    ),
    (
        re.compile(r"^At its controller's Maintenance,\s*", re.I),
        lambda m: {"on": "maintenance", "whose": "you"},
    ),
    (
        re.compile(r"^When attached Avatar is decommissioned,\s*", re.I),
        lambda m: {"on": "decommissioned", "whose": "host"},
    ),
    (
        re.compile(r"^When this Avatar is decommissioned,\s*", re.I),
        lambda m: {"on": "decommissioned", "whose": "self"},
    ),
    (
        re.compile(r"^At the beginning of each end step,\s*", re.I),
        lambda m: {"on": "end-step", "whose": "each"},
    ),
    (
        re.compile(r"^At the beginning of the end step,\s*", re.I),
        lambda m: {"on": "end-step"},
    ),
    (
        re.compile(
            r"^Whenever an Avatar dealt damage by this Avatar this turn is decommissioned,\s*", re.I
        ),
        lambda m: {"on": "decommissioned-damaged-by-self"},
    ),
    (
        re.compile(r"^Whenever one or more Avatars you control attack,\s*", re.I),
        lambda m: {"on": "attackers-declared", "whose": "you"},
    ),
    (
        re.compile(
            r"^Whenever this Avatar blocks or becomes blocked by a non-Firewall Avatar,\s*", re.I
        ),
        lambda m: {"on": "blocks-non-firewall"},
    ),
    (
        re.compile(r"^When this Attachment enters,\s*", re.I),
        lambda m: {"on": "self-enters"},
    ),
]

# "Attached Avatar has First Strike." — statics that flow to the host. The
# engine reads these live from the attachment, so they arrive when it attaches
# and leave when it leaves.
GRANTABLE = r"(Broadcast Guard|Broadcast|First Strike|Mesh|Overflow|Firewall)"
ATTACH_STATIC_RES = [
    re.compile(rf"^Attached (?:Avatar|Resource|Hardware|Firewall) has {GRANTABLE}$", re.I),
    re.compile(
        r"^Attached Avatar has Shielded from (\w+)(?:\. This effect doesn't remove"
        r" this Attachment)?$",
        re.I,
    ),
    re.compile(
        rf"^Attached Avatar gets ([+-]\d+) Action and ([+-]\d+) Resilience"
        rf"(?: and has {GRANTABLE})?$",
        re.I,
    ),
]


def parse_attach_static(line: str) -> dict[str, Any] | None:
    """Compile one attachment static into the grants the engine applies live."""
    text = line.strip().rstrip(".")
    keyword = ATTACH_STATIC_RES[0].match(text)
    if keyword:
        return {"keywords": [keyword.group(1)]}
    shielded = ATTACH_STATIC_RES[1].match(text)
    if shielded:
        return {"shieldedFrom": shielded.group(1).capitalize()}
    only_blocked = re.match(r"^Attached Avatar can't be blocked except by Firewalls$", text, re.I)
    if only_blocked:
        return {"onlyBlockedBy": "Firewall"}
    stats = ATTACH_STATIC_RES[2].match(text)
    if stats:
        grants: dict[str, Any] = {
            "action": int(stats.group(1)),
            "resilience": int(stats.group(2)),
        }
        if stats.group(3):
            grants["keywords"] = [stats.group(3)]
        return grants
    if re.fullmatch(
        r"Attached Resource has indestructible and can't be attached by other Attachments",
        text,
        re.I,
    ):
        return {"indestructible": True, "exclusiveAttachment": True}
    controlled = re.fullmatch(r"You control attached (Avatar|Hardware)", text, re.I)
    if controlled:
        return {"controller": "attachment"}
    affinity = re.fullmatch(
        r"Attached Resource is (?:a |the chosen )?"
        r"(Power|Bitcoin|Keys|Signal|Timelock)(?: Resource| type)?",
        text,
        re.I,
    )
    if affinity:
        return {"affinity": affinity.group(1).capitalize()}
    if re.fullmatch(r"Attached Resource is the chosen type", text, re.I):
        return {"affinity": "chosen"}
    backchannel = re.fullmatch(
        r"Attached Avatar has Backchannel\s*[—-]\s*(Power|Bitcoin|Keys|Signal|Timelock)",
        text,
        re.I,
    )
    if backchannel:
        return {"backchannel": backchannel.group(1).capitalize()}
    if re.fullmatch(r"Attached Avatar has fear", text, re.I):
        return {"fear": True}
    if re.fullmatch(r"All Avatars able to block attached Avatar do so", text, re.I):
        return {"mustBeBlocked": True}
    if re.fullmatch(
        r"As long as attached Hardware isn't an Avatar, it's an Hardware Avatar with Action"
        r" and Resilience each equal to its total resource cost",
        text,
        re.I,
    ):
        return {"animateByCost": True}
    if re.fullmatch(
        r'Attached Resource has "At the beginning of your Maintenance, you may pay SS\.'
        r' If you do, you gain 1 Uptime\."',
        text,
        re.I,
    ):
        return {"maintenanceAbility": {"cost": {"generic": 0, "S": 2}, "uptime": 1}}
    return None


def parse_clash_static(line: str) -> dict[str, Any] | None:
    """Clash rules the engine's canAttack/canBlock enforce directly."""
    text = _strip_reminder(line).rstrip(".")
    if re.match(r"^This Avatar can't be blocked by Firewalls$", text, re.I):
        return {"cantBeBlockedBy": "Firewall"}
    ge = re.match(r"^This Avatar can't block Avatars with Action (\d+) or greater$", text, re.I)
    if ge:
        return {"cantBlockActionGE": int(ge.group(1))}
    needs = re.match(
        r"^This Avatar can't attack unless defending player controls an?"
        r" (Power|Bitcoin|Keys|Signal|Timelock) Resource$",
        text,
        re.I,
    )
    if needs:
        return {"attackNeedsDefender": {"affinity": needs.group(1).capitalize()}}
    return None


def parse_stat_static(line: str, card_name: str) -> dict[str, Any] | None:
    """ "Action and Resilience are each equal to the number of …" — live stats."""
    text = _strip_reminder(line).rstrip(".")
    subject = re.escape(card_name)
    head = rf"^(?:{subject}|This Avatar)'s Action and Resilience are each equal to the number of "
    resource = re.match(
        head + r"(Power|Bitcoin|Keys|Signal|Timelock) Resources you control$", text, re.I
    )
    if resource:
        return {"type": "Resource", "affinity": resource.group(1).capitalize(), "whose": "you"}
    named = re.match(head + rf"Avatars named {subject} on the Network$", text, re.I)
    if named:
        return {"namedSelf": True}
    non_firewall = re.match(head + r"non-Firewall Avatars you control$", text, re.I)
    if non_firewall:
        return {"avatars": True, "notKeyword": "Firewall", "whose": "you"}
    conditional = re.match(
        r"^This Avatar gets \+1 Action and \+1 Resilience as long as you control a"
        r" (Power|Bitcoin|Keys|Signal|Timelock) Resource$",
        text,
        re.I,
    )
    if conditional:
        return {
            "base": True,
            "bonus": {"action": 1, "resilience": 1},
            "ifResourceAffinity": conditional.group(1).capitalize(),
        }
    half_bitcoin = re.match(
        r"^Attached Avatar gets \+X/\+Y, where X is half the number of Bitcoin Resources"
        r" you control, rounded down, and Y is half the number of Bitcoin Resources you"
        r" control, rounded up$",
        text,
        re.I,
    )
    if half_bitcoin:
        return {"attachedHalfResource": "Bitcoin"}
    return None


def parse_rule_static(line: str, card_name: str) -> dict[str, Any] | None:
    """Compile continuous rules that are read directly by the engine."""
    text = _strip_reminder(line).rstrip(".")
    if re.fullmatch(r"[^,]+ stays unlocked after attacking", text, re.I):
        return {"name": "attackDoesNotCommit"}
    if re.fullmatch(r"Attached Firewall can attack as though it didn't have Firewall", text, re.I):
        return {"name": "attachedCanAttackWithFirewall", "grants": "canAttackWithFirewall"}
    if re.fullmatch(r"This Avatar may attack as though it did not have Boot Delay", text, re.I):
        return {"name": "ignoreBootDelay"}
    if re.fullmatch(r"Attached Avatar may attack as though it did not have Boot Delay", text, re.I):
        return {"name": "attachedIgnoreBootDelay", "grants": "ignoreBootDelay"}
    if re.fullmatch(r"This Hardware doesn't unlock during your unlock step", text, re.I):
        return {"name": "skipSelfUnlock"}
    if re.fullmatch(r"You have no maximum Wallet size", text, re.I):
        return {"name": "noMaximumWallet"}
    if re.fullmatch(r"You may play any number of Resources on each of your turns", text, re.I):
        return {"name": "unlimitedResourcePlays"}
    if re.fullmatch(r"This Hardware enters committed", text, re.I):
        return {"name": "entersCommitted"}
    convert_all = re.fullmatch(
        r"All (Power|Bitcoin|Keys|Signal|Timelock) Resources are"
        r" (Power|Bitcoin|Keys|Signal|Timelock) Resource",
        text,
        re.I,
    )
    if convert_all:
        return {
            "name": "globalResourceAffinity",
            "from": convert_all.group(1).capitalize(),
            "to": convert_all.group(2).capitalize(),
        }
    if re.fullmatch(r"Players skip their unlock steps", text, re.I):
        return {"name": "skipUnlockSteps"}
    tax = re.fullmatch(
        r"(Power|Bitcoin|Keys|Signal|Timelock) cards on the Queue cost (\d+) more to play",
        text,
        re.I,
    )
    if tax:
        return {
            "name": "cardTax",
            "affinity": tax.group(1).capitalize(),
            "generic": int(tax.group(2)),
        }
    ability_tax = re.fullmatch(
        r"Activated abilities of (Power|Bitcoin|Keys|Signal|Timelock) Protocols cost"
        r" (\d+) more to activate",
        text,
        re.I,
    )
    if ability_tax:
        return {
            "name": "abilityTax",
            "affinity": ability_tax.group(1).capitalize(),
            "type": "Protocol",
            "generic": int(ability_tax.group(2)),
        }
    awaken = re.fullmatch(
        r"All (Power|Bitcoin|Keys|Signal|Timelock) Resources are 1/1"
        r"(?: (Power|Bitcoin|Keys|Signal|Timelock))? Avatars that are still Resources",
        text,
        re.I,
    )
    if awaken:
        return {
            "name": "resourceAvatars",
            "affinity": awaken.group(1).capitalize(),
            "action": 1,
            "resilience": 1,
        }
    if re.fullmatch(r"This Avatar attacks each clash if able", text, re.I):
        return {"name": "mustAttack"}
    if re.fullmatch(r"This Avatar can block an additional Avatar each clash", text, re.I):
        return {"name": "additionalBlock", "count": 1}
    unlock_cap = re.fullmatch(
        r"Players can't unlock more than one (Avatar|Resource) during their unlock steps",
        text,
        re.I,
    )
    if unlock_cap:
        return {"name": "unlockCap", "kind": unlock_cap.group(1), "count": 1}
    unlocked_cap = re.fullmatch(
        r"As long as this Hardware is unlocked, players can't unlock more than one Resource"
        r" during their unlock steps",
        text,
        re.I,
    )
    if unlocked_cap:
        return {"name": "unlockCap", "kind": "Resource", "count": 1, "whileUnlocked": True}
    low_power = re.fullmatch(
        r"Avatars with Action (\d+) or greater don't unlock during their controllers'"
        r" unlock steps",
        text,
        re.I,
    )
    if low_power:
        return {"name": "skipAvatarUnlockAtAction", "minimum": int(low_power.group(1))}
    converter = re.fullmatch(
        r"You may spend (Power|Bitcoin|Keys|Signal|Timelock) Resource as though it were"
        r" (Power|Bitcoin|Keys|Signal|Timelock) Resource",
        text,
        re.I,
    )
    if converter:
        return {
            "name": "resourceConverter",
            "from": AFFINITY_SYMBOL[converter.group(1).capitalize()],
            "to": AFFINITY_SYMBOL[converter.group(2).capitalize()],
        }
    tribal = re.fullmatch(
        r"Other (Merfolk|Goblins|Zombie Avatars) get \+1 Action and \+1 Resilience and have"
        r" Backchannel\s*[—-]\s*(\w+)",
        text,
        re.I,
    )
    if tribal:
        tribe = tribal.group(1).split()[0].rstrip("s")
        return {
            "name": "tribalAura",
            "tribe": tribe,
            "action": 1,
            "resilience": 1,
            "backchannel": tribal.group(2).capitalize(),
        }
    backchannel_aura = re.fullmatch(
        r"Other Zombie Avatars have Backchannel\s*[—-]\s*(Power|Bitcoin|Keys|Signal|Timelock)",
        text,
        re.I,
    )
    if backchannel_aura:
        return {
            "name": "tribalAura",
            "tribe": "Zombie",
            "action": 0,
            "resilience": 0,
            "backchannel": backchannel_aura.group(1).capitalize(),
        }
    if re.fullmatch(r"As this Hardware enters, choose an opponent", text, re.I):
        return {"name": "chooseOpponentOnEnter"}
    if re.fullmatch(
        r"As long as this Avatar is unlocked, all damage that would be dealt to you by"
        r" unblocked Avatars is dealt to this Avatar instead",
        text,
        re.I,
    ):
        return {"name": "redirectUnblockedDamage", "whileUnlocked": True}
    if re.fullmatch(
        r"If you would draw a card during your draw step, instead you may skip that draw\."
        r" If you do, until your next turn, you can't be attacked except by Avatars with"
        r" Broadcast and/or Backchannel[—-]Timelock",
        text,
        re.I,
    ):
        return {"name": "optionalDrawShield"}
    if re.fullmatch(
        r"If an effect causes you to discard a card, discard it, but you may put it on top"
        r" of your Stack instead of into your Archive",
        text,
        re.I,
    ):
        return {"name": "discardToStackOption"}
    if re.fullmatch(r"When you control no Timelock Resources, archive this Avatar", text, re.I):
        return {"name": "archiveWithoutResource", "affinity": "Timelock"}
    if re.fullmatch(r"As this Attachment enters, choose a basic Resource type", text, re.I):
        return {"name": "chooseAffinityOnEnter"}
    if re.fullmatch(
        r"You may have this Avatar enter as a copy of any Avatar on the Network", text, re.I
    ):
        return {"name": "copyOnEnter", "kind": "Avatar"}
    if re.fullmatch(
        r"You may have this Protocol enter as a copy of any Hardware on the Network, except"
        r" it's a Protocol in addition to its other types",
        text,
        re.I,
    ):
        return {"name": "copyOnEnter", "kind": "Hardware", "keepType": "Protocol"}
    if re.fullmatch(
        r"Enters with seven \+1/\+0 markers; remove one after it attacks or blocks", text, re.I
    ):
        return {"name": "entersCounter", "counter": "+1/+0", "amount": 7, "removeAfterCombat": 1}
    if re.fullmatch(r"Enters with X \+1/\+1 markers\. Remove one to prevent 1 damage", text, re.I):
        return {"name": "entersXCounter", "counter": "+1/+1", "preventDamage": 1}
    if re.fullmatch(r'Other Zombies have "K: Reboot this Network card\."', text, re.I):
        return {
            "name": "tribalActivatedAbility",
            "tribe": "Zombie",
            "cost": {"generic": 0, "K": 1},
            "ops": [{"op": "reboot", "scope": "self"}],
        }
    return None


def parse_play_restriction(line: str) -> dict[str, Any] | None:
    """Compile the set's printed timing restrictions before any cost is paid."""
    text = _strip_reminder(line).rstrip(".")
    if re.fullmatch(
        r"Play this card on the Queue only during clash before blockers are declared", text, re.I
    ):
        return {"window": "clash-before-blockers"}
    if re.fullmatch(r"Play only during an opponent's turn before attackers", text, re.I):
        return {"window": "opponent-before-attackers"}
    if re.fullmatch(r"Play only during blockers", text, re.I):
        return {"window": "blockers"}
    if re.fullmatch(r"Play this card on the Queue only before the clash damage step", text, re.I):
        return {"window": "before-clash-damage"}
    if re.fullmatch(r"Play only before blockers are declared", text, re.I):
        return {"window": "clash-before-blockers"}
    return None


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
    if re.match(r"^you may draw a card$", text, re.I):
        # A free optional — mayPay with a zero cost keeps the one choice door.
        return [
            {
                "op": "mayPay",
                "cost": {"generic": 0},
                "then": [{"op": "draw", "amount": 1}],
                "prompt": "Draw a card?",
                "payLabel": "Draw",
            }
        ]
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
    if re.fullmatch(
        r"if it wasn't the first Resource you played this turn, this Protocol deals 1"
        r" damage to you",
        text,
        re.I,
    ):
        return [
            {
                "op": "damage",
                "amount": 1,
                "target": "controller",
                "condition": {"resourcePlayBeyondFirst": True},
            }
        ]
    if re.fullmatch(
        r"if this Hardware is unlocked, that player draws an additional card", text, re.I
    ):
        return [
            {
                "op": "draw",
                "amount": 1,
                "target": "event-player",
                "condition": {"sourceUnlocked": True},
            }
        ]
    wallet_damage = re.fullmatch(
        r"this Hardware deals X damage to that player, where X is the number of cards in"
        r" their Wallet minus 4",
        text,
        re.I,
    )
    if wallet_damage:
        return [
            {
                "op": "damage",
                "amount": {"walletCount": "event-player", "minus": 4, "minimum": 0},
                "target": "event-player",
            }
        ]
    if re.fullmatch(r"its owner loses half their Uptime, rounded up", text, re.I):
        return [{"op": "loseHalfUptime", "target": "event-owner"}]
    exit_fee = re.fullmatch(
        r"this Attachment deals damage equal to that Avatar's Resilience"
        r" to the Avatar's controller",
        text,
        re.I,
    )
    if exit_fee:
        return [{"op": "damage", "amount": "event-resilience", "target": "event-player"}]
    if re.fullmatch(r"if no Avatars are on the Network, archive this Protocol", text, re.I):
        return [{"op": "archiveSelfIfNoAvatars"}]
    corpse = re.fullmatch(
        r"put a corpse marker on this Avatar for each Avatar that died this turn", text, re.I
    )
    if corpse:
        return [
            {
                "op": "addCounter",
                "name": "corpse",
                "amount": "avatarsDiedThisTurn",
                "target": "self-object",
            }
        ]
    if re.fullmatch(r"put a \+1/\+1 marker on this Avatar", text, re.I):
        return [{"op": "addCounter", "name": "+1/+1", "amount": 1, "target": "self-object"}]
    grid_amp = re.fullmatch(
        r"that player generates 1 additional Resource of an affinity that Resource produced",
        text,
        re.I,
    )
    if grid_amp:
        return [{"op": "generateEventAffinity", "amount": 1, "target": "event-player"}]
    idle = re.fullmatch(
        r"this Protocol deals X damage to that player, where X is the number of unlocked"
        r" Resources they controlled at the beginning of this turn",
        text,
        re.I,
    )
    if idle:
        return [{"op": "damage", "amount": "startUnlockedResources", "target": "event-player"}]
    lethal = re.fullmatch(r"decommission that Avatar at end of clash", text, re.I)
    if lethal:
        return [{"op": "delayDecommissionEventAvatar", "at": "end-clash"}]
    grounded = re.fullmatch(
        r"if attached Avatar has Broadcast, this Attachment deals 2 damage to that Avatar and"
        r' this Attachment gains "attached Avatar loses Broadcast\."',
        text,
        re.I,
    )
    if grounded:
        return [{"op": "groundAttachedBroadcast", "damage": 2}]
    if re.fullmatch(
        r"this deals 2 damage to them\. They may pay X Resources to prevent X of it", text, re.I
    ):
        return [{"op": "maintenanceLeak", "damage": 2, "target": "event-player"}]
    if re.fullmatch(
        r"unless you pay KKK, commit this Avatar and archive a Resource of an opponent's choice",
        text,
        re.I,
    ):
        return [{"op": "resourceReclaimer", "cost": {"generic": 0, "K": 3}}]
    if re.fullmatch(
        r"archive an Avatar other than this Avatar\. If you can't,"
        r" this Avatar deals 7 damage to you",
        text,
        re.I,
    ):
        return [{"op": "selfCustodyMaintenance", "damage": 7}]
    if re.fullmatch(
        r"if this card is in your Archive with three or more Avatar cards above it, you may put"
        r" this card onto the Network",
        text,
        re.I,
    ):
        return [{"op": "archiveReturn"}]
    if re.fullmatch(
        r"each defender splits their non-Broadcast Avatars into left"
        r" and right piles\. Each attacker chooses a pile and can be"
        r" blocked only by it or Broadcast",
        text,
        re.I,
    ):
        return [{"op": "splitRoute"}]
    if re.fullmatch(
        r"decommission it\. That Resource's controller may attach this Attachment to a Resource"
        r" of their choice",
        text,
        re.I,
    ):
        return [{"op": "migrateAttachment"}]
    return parse_ops(text, card_name)


def parse_special_ops(text: str, original: str) -> list[dict[str, Any]] | None:
    """Compile the remaining unique E1 effects into named deterministic operations."""
    patterns: list[tuple[str, list[dict[str, Any]]]] = [
        (
            r"Each player chooses a number of Resources they control equal to the number of"
            r" Resources controlled by the player who controls the fewest, then archives the rest\."
            r" Players discard cards and archive Avatars the same way",
            [{"op": "fairState"}],
        ),
        (
            r"Prevent the next X damage that would be dealt to any target this turn\. Until end of"
            r" turn, you may pay 1 any time you could play an Zap\. If you do, prevent the next 1"
            r" damage that would be dealt to that Network card or player this turn",
            [{"op": "guardianSignal", "amount": "x"}],
        ),
        (
            r"Invalidate target card on the Queue unless its controller pays X\. If that player"
            r" doesn't, they commit all Resources with Resource abilities they control and lose all"
            r" unspent Resource",
            [{"op": "feeSpike"}],
        ),
        (
            r"Their Avatars attack if able\. At end step, decommission non-Firewalls that didn't"
            r" attack unless they entered or changed control this turn",
            [{"op": "callToRelay"}],
        ),
        (
            r"Decommission X target Power Resources\. Grid Eruption deals damage to each Avatar and"
            r" each player equal to the number of Power Resources put into an Archive this way",
            [{"op": "gridEruption", "count": "x"}],
        ),
        (
            r"Return it under your control and attach Archive Boot\."
            r" It gets -1 Action\. When Archive Boot leaves, archive that Avatar",
            [{"op": "archiveBoot"}],
        ),
        (
            r"Stake module [—-] Each player may add the top card of their Stack to the Stake\. If"
            r" your opponent declines, you may play this again without paying its cost",
            [{"op": "stakeArbitration"}],
        ),
        (
            r"Spend only Keys Resources to pay X\. Uptime Channel deals X damage"
            r" to any target\. You gain Uptime equal to the damage dealt, up to"
            r" that target's Uptime or Resilience before the damage",
            [{"op": "uptimeChannel", "amount": "x", "xPayment": "K"}],
        ),
        (
            r"On deploy, set your Uptime to 0\. You survive at 0; Uptime gains draw cards instead\."
            r" Damage archives that many non-proxy cards or you lose\. If this leaves, you lose",
            [{"op": "sovereignMode"}],
        ),
        (
            r"As an additional cost to play this card on the Queue, archive an Avatar",
            [{"op": "additionalArchiveAvatar"}],
        ),
        (
            r"Generate that many Keys Resources, equal to the archived"
            r" Avatar's total resource cost",
            [{"op": "generateArchivedCost", "affinity": "Keys"}],
        ),
        (
            r"Look at an opponent's Wallet and choose a card they can play\."
            r" You control that player while they play the chosen card\. Resources"
            r" from their Buffer may be spent only for that card",
            [{"op": "remoteCommand"}],
        ),
        (
            r"Final Settlement deals X damage to any target\. If it's an Avatar,"
            r" it can't be Rebooted this turn, and if it would be decommissioned"
            r" this turn, Cold Storage it instead",
            [{"op": "finalSettlement", "amount": "x"}],
        ),
        (
            r"Remove one defending Avatar from clash; anything it alone blocked becomes unblocked\."
            r" It may block another attacker",
            [{"op": "routeMisdirection"}],
        ),
        (
            r"Copy target Zap or Operation card on the Queue, except that the copy"
            r" is Power\. You may choose new targets for the copy",
            [{"op": "copyQueue", "affinity": "Power"}],
        ),
        (
            r"Target Avatar gains Overflow and gets \+X/\+0 until end of turn,"
            r" where X is its Action\. At the beginning of the next end step,"
            r" decommission that Avatar if it attacked this turn",
            [{"op": "committedGrowth"}],
        ),
        (
            r"Look at the top three cards of target player's Stack, then put them"
            r" back in any order\. You may have that player shuffle",
            [{"op": "topologyScan"}],
        ),
        (
            r"deploy an Avatar from your Wallet face down as a 2/2 neutral Avatar\."
            r" Turn it face up when it would deal or receive damage, or become"
            r" committed\. X must cover its deploy cost",
            [{"op": "identityMask", "amount": "x"}],
        ),
        (
            r"mark target non-Keys Resource; it becomes Keys\. If this is archived, at each future"
            r" Maintenance remove all its marks from one marked Resource",
            [{"op": "resourceTombstone"}],
        ),
    ]
    for pattern, ops in patterns:
        if re.fullmatch(pattern, text, re.I):
            return ops

    rewrite = re.fullmatch(
        r"Change the text of target card on the Queue or Network card by replacing all instances"
        r" of one (basic Resource type|affinity word) with another",
        text,
        re.I,
    )
    if rewrite:
        return [
            {
                "op": "rewriteWords",
                "vocabulary": "basic"
                if rewrite.group(1).lower().startswith("basic")
                else "affinity",
            }
        ]
    if re.fullmatch(
        r"Target Avatar you control with Resilience less than this Avatar's Action gains Broadcast"
        r" until end of turn\. decommission that Avatar at the beginning of the next end step",
        text,
        re.I,
    ):
        return [{"op": "launchAvatar"}]
    if re.fullmatch(
        r"toss Chaos Kernel from at least one card-height above the Network\."
        r" Archive each non-proxy card it touches, then archive Chaos Kernel",
        text,
        re.I,
    ):
        return [{"op": "digitalToss"}]
    return None


def parse_ops(effect: str, card_name: str) -> list[dict[str, Any]] | None:
    """Match one effect clause against the recurring templates in the set."""
    text = effect.strip().rstrip(".")
    text = re.sub(
        r"\. Activate only during your turn(?: and only once each turn)?$", "", text, flags=re.I
    )
    special = parse_special_ops(text, effect)
    if special is not None:
        return special
    subject = re.escape(card_name)
    ops: list[dict[str, Any]] = []

    if re.fullmatch(r"After this turn, take one additional turn", text, re.I):
        return [{"op": "extraTurn"}]

    move_target = re.fullmatch(
        r"Return target (Avatar )?card from your Archive to (?:the |your )?(Network|Wallet)",
        text,
        re.I,
    )
    if move_target:
        return [
            {
                "op": "moveTarget",
                "kind": "Avatar" if move_target.group(1) else "Card",
                "fromZone": "archive",
                "whose": "you",
                "toZone": move_target.group(2).lower(),
            }
        ]

    if re.fullmatch(
        r"Each player shuffles their Wallet and Archive into their Stack, then draws seven cards",
        text,
        re.I,
    ):
        return [
            {
                "op": "resetZones",
                "seats": "each",
                "fromZones": ["wallet", "archive"],
                "toZone": "stack",
                "draw": 7,
            }
        ]

    if re.fullmatch(r"You may commit or unlock target Hardware, Avatar, or Resource", text, re.I):
        return [{"op": "toggleCommitted", "kind": "permanent"}]

    if re.fullmatch(r"Each player discards their Wallet, then draws seven cards", text, re.I):
        return [{"op": "discardWalletDraw", "seats": "each", "draw": 7}]

    if re.fullmatch(
        r"Target Avatar defending player controls can block any number of Avatars this turn\."
        r" It blocks each attacking Avatar this turn if able",
        text,
        re.I,
    ):
        return [{"op": "forceBlockAll", "target": "defending-avatar", "duration": "eot"}]

    if re.fullmatch(r"Prevent all clash damage that would be dealt this turn", text, re.I):
        return [{"op": "preventClashDamage", "duration": "eot"}]

    if re.fullmatch(r"Target Avatar with Action 2 or less can't be blocked this turn", text, re.I):
        return [{"op": "cantBeBlocked", "target": "avatar", "maximumAction": 2, "duration": "eot"}]

    if re.fullmatch(
        r"This Hardware becomes a 3/6 Golem Hardware Avatar until end of clash\."
        r" Activate only during clash",
        text,
        re.I,
    ):
        return [
            {
                "op": "becomesAvatar",
                "action": 3,
                "resilience": 6,
                "subtype": "Golem",
                "duration": "clash",
            }
        ]

    if re.fullmatch(
        r"The next time an unblocked Avatar of your choice would deal clash damage to you"
        r" this turn, prevent all but 1 of that damage",
        text,
        re.I,
    ):
        return [{"op": "limitClashDamage", "target": "source-avatar", "maximum": 1}]

    if re.fullmatch(
        r"The next time a source of your choice would deal damage to target Avatar this turn,"
        r" that source deals that damage to you instead",
        text,
        re.I,
    ):
        return [{"op": "redirectDamage", "sourceTarget": True, "objectTarget": True}]

    if re.fullmatch(
        r"The next 1 damage that would be dealt to this Avatar this turn is dealt to its owner"
        r" instead\. Only this Avatar's owner may activate this ability",
        text,
        re.I,
    ):
        return [{"op": "redirectSelfDamage", "amount": 1, "ownerOnly": True}]

    if re.fullmatch(
        r"The next time a source of your choice would deal damage to you this turn, prevent"
        r" that damage\. You gain Uptime equal to the damage prevented this way",
        text,
        re.I,
    ):
        return [{"op": "preventAndRefund", "target": "source"}]

    if re.fullmatch(
        r"Commit all Resources target player controls and that player loses all unspent Resource",
        text,
        re.I,
    ):
        return [{"op": "drainBuffer", "target": "player", "commitResources": True}]

    if re.fullmatch(
        r"Target player activates a Resource ability of each Resource they control\. Then that"
        r" player loses all unspent Resource and you put the lost Resources into your Buffer",
        text,
        re.I,
    ):
        return [{"op": "stealGeneratedBuffer", "target": "player"}]

    if re.fullmatch(
        r"Search your Stack for a card, put that card into your Wallet, then shuffle", text, re.I
    ):
        return [{"op": "searchStack", "toZone": "wallet"}]

    if re.fullmatch(r"Invalidate target card on the Queue with total resource cost X", text, re.I):
        return [{"op": "invalidateByCostX"}]

    if re.fullmatch(
        r"Stake module [—-] Add the top card of your Stack to the Stake\. Discard your Wallet,"
        r" then draw seven cards",
        text,
        re.I,
    ):
        return [{"op": "stakeContract"}]

    if re.fullmatch(
        r"Stake module [—-] Exchange ownership of the top card of your Stake with one random"
        r" card from your opponent's Stake",
        text,
        re.I,
    ):
        return [{"op": "stakeSwap"}]

    if re.fullmatch(
        r"State Mirror deals damage to target Avatar you control equal to the damage dealt to"
        r" you this turn",
        text,
        re.I,
    ) or re.fullmatch(
        r"You gain Uptime equal to the damage dealt to you this turn\. State Mirror deals"
        r" damage to target Avatar you control equal to the damage dealt to you this turn",
        text,
        re.I,
    ):
        return [{"op": "stateMirror"}]

    if re.fullmatch(
        r"This card on the Queue costs 1 more to play for each target beyond the first", text, re.I
    ):
        return [{"op": "variableTargetTax", "genericEachBeyondFirst": 1}]

    if re.fullmatch(
        r"Power Burst deals X damage divided evenly, rounded down, among any number of targets",
        text,
        re.I,
    ):
        return [{"op": "divideDamage", "amount": "x", "target": "any-number"}]

    if re.fullmatch(
        r"Until end of turn, any time you could activate a Resource ability, you may pay 1"
        r" Uptime\. If you do, generate 1 neutral Resource",
        text,
        re.I,
    ):
        return [{"op": "grantUptimeResourceAbility", "duration": "eot"}]

    if re.fullmatch(
        r"This Avatar gets \+1 Action and \+0 Resilience until end of turn\. If this ability"
        r" has been activated four or more times this turn, archive this Avatar at the beginning"
        r" of the next end step",
        text,
        re.I,
    ):
        return [{"op": "overclock", "action": 1, "threshold": 4}]

    if re.fullmatch(
        r"Enters with seven \+1/\+0 markers; remove one after it attacks or blocks", text, re.I
    ):
        return [{"op": "clockworkMarkers", "count": 7}]

    if re.fullmatch(r"refill up to X markers, to a maximum of seven", text, re.I):
        return [{"op": "refillCounter", "name": "+1/+0", "maximum": 7, "amount": "x"}]

    if re.fullmatch(r"unlock this Hardware", text, re.I):
        return [{"op": "unlockSelf"}]

    if re.fullmatch(r"unlock attached Avatar", text, re.I):
        return [{"op": "unlockAttached"}]

    reveal_wallet = re.fullmatch(r"Look at target player's Wallet", text, re.I)
    if reveal_wallet:
        return [{"op": "revealWallet", "target": "player"}]

    create_swarm = re.fullmatch(
        r"create a 1/1 neutral Insect Hardware Avatar proxy with Broadcast\. Name it Swarm Drone",
        text,
        re.I,
    )
    if create_swarm:
        return [
            {
                "op": "createProxy",
                "name": "Swarm Drone",
                "type": "Hardware Avatar",
                "subtype": "Insect",
                "affinity": ["Neutral"],
                "action": 1,
                "resilience": 1,
                "keywords": ["Broadcast"],
                "count": 1,
            }
        ]

    become_affinity = re.fullmatch(
        r"Target card on the Queue or Network card becomes"
        r" (Power|Bitcoin|Keys|Signal|Timelock)",
        text,
        re.I,
    )
    if become_affinity:
        return [{"op": "setAffinity", "affinity": become_affinity.group(1).capitalize()}]

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
        r"^(target (?:blocking )?Avatar|this Avatar|attached Avatar|"
        r"(?:Unlocked )?Avatars you control"
        r"|\w+ Avatars(?: you control)?) "
        r"gets? \+(\d+) Action and \+(\d+) Resilience(?: until end of turn)?$",
        text,
        re.I,
    )
    if pump:
        scope = (
            pump.group(1)
            .lower()
            .replace(" ", "-")
            .replace("target-blocking-avatar", "target-avatar")
        )
        ops.append(
            {
                "op": "pump",
                "target": scope,
                "action": int(pump.group(2)),
                "resilience": int(pump.group(3)),
                "duration": "eot" if "until end of turn" in text.lower() else "static",
                **({"require": "blocking"} if "target blocking avatar" in text.lower() else {}),
            }
        )
        return ops

    filtered_decommission = re.fullmatch(
        r"decommission target (Power|Bitcoin|Keys|Signal|Timelock) Network card", text, re.I
    )
    if filtered_decommission:
        return [
            {
                "op": "decommission",
                "scope": "target",
                "kind": "Permanent",
                "affinity": filtered_decommission.group(1).capitalize(),
            }
        ]

    committed_decommission = re.fullmatch(r"decommission target committed Avatar", text, re.I)
    if committed_decommission:
        return [
            {
                "op": "decommission",
                "scope": "target",
                "kind": "Avatar",
                "requireCommitted": True,
            }
        ]

    excluded_decommission = re.fullmatch(
        r"Decommission target non-Hardware, non-Keys Avatar\. It can't be Rebooted", text, re.I
    )
    if excluded_decommission:
        return [
            {
                "op": "decommission",
                "scope": "target",
                "kind": "Avatar",
                "notType": "Hardware",
                "notAffinity": "Keys",
                "preventReboot": True,
            }
        ]

    multi_decommission = re.fullmatch(
        r"decommission all Hardware, Avatars, and Protocols", text, re.I
    )
    if multi_decommission:
        return [
            {
                "op": "decommission",
                "scope": "all",
                "kind": "Hardware",
                "kinds": ["Hardware", "Avatar", "Protocol"],
            }
        ]

    affinity_sweep = re.fullmatch(
        r"decommission all (Power|Bitcoin|Keys|Signal|Timelock) Resources?", text, re.I
    )
    if affinity_sweep:
        return [
            {
                "op": "decommission",
                "scope": "all",
                "kind": "Resource",
                "affinity": affinity_sweep.group(1).capitalize(),
            }
        ]

    decommission = re.match(r"^decommission (target|all) (\w+)(?: or (\w+))?", text, re.I)
    if decommission:
        kinds = [decommission.group(2).rstrip("s").capitalize()]
        if decommission.group(3):
            kinds.append(decommission.group(3).rstrip("s").capitalize())
        return [
            {
                "op": "decommission",
                "scope": decommission.group(1).lower(),
                "kind": kinds[0],
                **({"kinds": kinds} if len(kinds) > 1 else {}),
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

    reboot = re.match(r"^Reboot (this|target|attached) Avatar$", text, re.I)
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

    prevent = re.match(
        r"^Prevent the next (\d+|X) damage that would be dealt to (you|any target) this turn$",
        text,
        re.I,
    )
    if prevent:
        return [
            {
                "op": "prevent",
                "amount": _amt(prevent.group(1)),
                "target": "you" if prevent.group(2).lower() == "you" else "any",
            }
        ]

    circuit = re.match(
        r"^The next time a (Power|Bitcoin|Keys|Signal|Timelock) source of your choice"
        r" would deal damage to you this turn, prevent that damage$",
        text,
        re.I,
    )
    if circuit:
        return [
            {
                "op": "prevent",
                "amount": 0,
                "target": "you",
                "fromAffinity": circuit.group(1).capitalize(),
            }
        ]

    invalidate = re.match(r"^Invalidate target card on the Queue$", text, re.I)
    if invalidate:
        return [{"op": "invalidate"}]

    # "marker target Power card on the Queue" — the set's word for countering.
    marker = re.match(
        r"^marker target (Power|Bitcoin|Keys|Signal|Timelock) card on the Queue$", text, re.I
    )
    if marker:
        return [{"op": "invalidate", "filter": {"affinity": marker.group(1).capitalize()}}]

    return None


def parse_abilities(card: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """Split rules text into abilities, auto-scripting the ones we recognise."""
    abilities: list[dict[str, Any]] = []
    manual = False
    lines = [_strip_reminder(raw) for raw in card["rules_text"].split("\n")]
    # "Choose one —" followed by bullet modes compiles to ONE modal ability;
    # it is scripted only when every mode's effect parses.
    if any(ln.startswith("Choose one") for ln in lines):
        modes = []
        ok = True
        for ln in lines:
            if not ln.startswith("•"):
                continue
            effect = ln.lstrip("• ").strip()
            ops = parse_ops(effect, card["name"])
            ok = ok and ops is not None
            modes.append({"text": effect, "ops": ops})
        abilities.append(
            {
                "kind": "modal",
                "cost": "",
                "text": card["rules_text"],
                "modes": modes,
                "ops": None,
                "manual": not (ok and modes),
            }
        )
        return abilities, abilities[-1]["manual"]
    for line in lines:
        if not line or line == "No special ability.":
            continue
        if _keyword_only_line(line):
            continue
        if ATTACH_RE.match(line):
            continue

        if card["name"] == "Toni China, Multihead Miner" and line.startswith("P: prevent 1 damage"):
            abilities.extend(
                [
                    {
                        "kind": "activated",
                        "cost": "P",
                        "text": "P: prevent the next 1 damage to this Avatar this turn.",
                        "ops": [{"op": "preventSelf", "amount": 1}],
                        "manual": False,
                    },
                    {
                        "kind": "activated",
                        "cost": "PPP",
                        "text": "PPP — Maintenance: add a +1/+1 marker.",
                        "ops": [
                            {
                                "op": "addCounter",
                                "name": "+1/+1",
                                "amount": 1,
                                "target": "self-object",
                            }
                        ],
                        "timing": "maintenance",
                        "manual": False,
                    },
                ]
            )
            continue

        if card["name"] == "Longy, Resource Sovereign" and "While idle" in line:
            abilities.extend(
                [
                    {
                        "kind": "stat-static",
                        "cost": "",
                        "text": (
                            "While idle, stats equal your Bitcoin Resources;"
                            " while attacking, the defender's."
                        ),
                        "statCount": {"dynamicBitcoinController": True},
                        "ops": None,
                        "manual": False,
                    },
                    {
                        "kind": "activated",
                        "cost": "Commit",
                        "text": "Commit: target Resource is Bitcoin while Longy remains.",
                        "ops": [
                            {
                                "op": "setAffinityWhileSource",
                                "affinity": "Bitcoin",
                                "kind": "Resource",
                            }
                        ],
                        "manual": False,
                    },
                ]
            )
            continue

        if card["name"] == "Gadaj, Archive Maintainer" and line.startswith("Other Zombies have"):
            abilities.append(
                {
                    "kind": "rule-static",
                    "cost": "",
                    "text": line,
                    "rule": {
                        "name": "tribalActivatedAbility",
                        "tribe": "Zombie",
                        "cost": {"generic": 0, "K": 1},
                        "ops": [{"op": "reboot", "scope": "self"}],
                    },
                    "ops": None,
                    "manual": False,
                }
            )
            continue

        if card["name"] == "NC, Forced Signal":
            abilities.append(
                {
                    "kind": "activated",
                    "cost": "Commit",
                    "text": line,
                    "timing": "opponent-before-attackers",
                    "ops": [{"op": "forceAttackTarget"}],
                    "manual": False,
                }
            )
            continue

        if card["name"] == "Jedai, Adaptive Client":
            abilities.append(
                {
                    "kind": "rule-static",
                    "cost": "",
                    "text": line,
                    "rule": {"name": "adaptiveCopy"},
                    "ops": None,
                    "manual": False,
                }
            )
            continue

        if card["name"] == "Route Misdirection":
            abilities.extend(
                [
                    {
                        "kind": "play-restriction",
                        "cost": "",
                        "text": "Play only during blockers.",
                        "restriction": {"window": "blockers"},
                        "ops": None,
                        "manual": False,
                    },
                    {
                        "kind": "play",
                        "cost": "",
                        "text": line,
                        "ops": [{"op": "routeMisdirection"}],
                        "manual": False,
                    },
                ]
            )
            continue

        if card["name"] == "Obfuscated Formation":
            abilities.extend(
                [
                    {
                        "kind": "play-restriction",
                        "cost": "",
                        "text": "Play only before blockers are declared.",
                        "restriction": {"window": "clash-before-blockers"},
                        "ops": None,
                        "manual": False,
                    },
                    {
                        "kind": "play",
                        "cost": "",
                        "text": line,
                        "ops": [{"op": "obfuscatedFormation"}],
                        "manual": False,
                    },
                ]
            )
            continue

        cost, _, effect = line.partition(":")
        if effect:
            ops = parse_ops(effect, card["name"])
            ability = {
                "kind": "activated",
                "cost": cost.strip(),
                "text": line,
                "ops": ops,
                "manual": ops is None,
            }
            if re.search(r"Activate only during your turn", line, re.I):
                ability["timing"] = "your-turn"
            if re.search(r"Activate only during clash", line, re.I):
                ability["timing"] = "clash"
            if re.search(r"only once each turn", line, re.I):
                ability["oncePerTurn"] = True
            if "— Maintenance" in cost or "- Maintenance" in cost:
                ability["timing"] = "maintenance"
            abilities.append(ability)
        else:
            clash_rule = parse_clash_static(line)
            if clash_rule:
                abilities.append(
                    {
                        "kind": "clash-static",
                        "cost": "",
                        "text": line,
                        "rule": clash_rule,
                        "ops": None,
                        "manual": False,
                    }
                )
                continue
            play_restriction = parse_play_restriction(line)
            if play_restriction:
                abilities.append(
                    {
                        "kind": "play-restriction",
                        "cost": "",
                        "text": line,
                        "restriction": play_restriction,
                        "ops": None,
                        "manual": False,
                    }
                )
                continue
            rule_static = parse_rule_static(line, card["name"])
            if rule_static:
                abilities.append(
                    {
                        "kind": "rule-static",
                        "cost": "",
                        "text": line,
                        "rule": rule_static,
                        "ops": None,
                        "manual": False,
                    }
                )
                continue
            stat_static = parse_stat_static(line, card["name"])
            if stat_static:
                abilities.append(
                    {
                        "kind": "stat-static",
                        "cost": "",
                        "text": line,
                        "statCount": stat_static,
                        "ops": None,
                        "manual": False,
                    }
                )
                continue
            grants = parse_attach_static(line)
            if grants:
                abilities.append(
                    {
                        "kind": "attach-static",
                        "cost": "",
                        "text": line,
                        "grants": grants,
                        "ops": None,
                        "manual": False,
                    }
                )
                continue
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
        default=repo_root / "art" / "cards" / "node-runner-web" / "manifest.json",
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
