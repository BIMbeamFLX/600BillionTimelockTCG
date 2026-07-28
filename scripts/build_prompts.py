"""Generate one distinct, educational-and-funny art prompt per E1 card.

Replaces the single-template art_prompt (93% identical across the set) with prompts
built from per-affinity worlds, per-type composition, a mechanic-derived motif, the
official character binding for Avatars, and a deterministic textless humor prop.
Deterministic: same card id always yields the same prompt and seed.

Usage:
    python scripts/build_prompts.py            # writes cards/e1-art-prompts.json
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "cards" / "e1-art-prompts.json"

STYLE = (
    "600B house style: optimistic cypherpunk editorial realism, tactile screenprint "
    "grain, orange and black dominant with violet protocol accents, warm practical "
    "lighting, believable open-source hardware"
)

ANTI_SLOP = (
    "avoid generic neon cyberpunk city, glossy 3d-render plastic look, floating HUD "
    "hexagons, lens-flare spam, random circuit-board wallpaper"
)

NEGATIVE = "no text, no letters, no numbers, no logos, no watermarks, no borders, no card frame"

WORLDS = {
    "Power": "hydro and solar power yards, humming mining rigs, turbines, ember light trails",
    "Bitcoin": "orchard greenhouses and seed vaults, compounding growth, honey-gold hour",
    "Keys": "cold vaults and deliberate lockwork, ultraviolet shadows, warm keyholes",
    "Signal": "relay towers, mesh antennas and community murals, cream beacon glow",
    "Timelock": "clockwork block towers, pendulums and layered timestamps, indigo dusk",
    "Neutral": "shared workshop commons, gray steel warmed by orange work lamps",
}

COMPOSITION = {
    "Avatar": "full-body hero portrait, dynamic pose that matches the mechanic, no other people",
    "Hardware": "hero still-life of one device on a workbench, macro detail, no people",
    "Protocol": "an invisible rule made visible: the environment reshaped by a system, no people",
    "Zap": "one frozen instant of energy, high motion, impact frame, no people",
    "Operation": "a staged plan mid-execution, tools laid out, wide shot, no people",
    "Resource": "wide establishing landscape plate with generous negative space, no people",
}

# mechanic verb -> visual motif, checked in order (first match wins)
MOTIFS = [
    (r"\binvalidate\b", "a signal snuffed mid-air, its envelope dissolving into sparks"),
    (r"\bdecommission", "a machine gracefully powering down into drifting embers"),
    (r"\bReboot\b", "a rig reassembling itself mid-fall, seams re-knitting"),
    (r"\bBroadcast\b", "airborne above rooftop antennas, signal wake trailing"),
    (r"\bOverflow\b", "energy surging past a barricade that could not hold it"),
    (r"\bBackchannel\b", "a hidden side tunnel glowing behind an unsuspecting wall"),
    (r"\bShielded from\b", "a translucent shell shrugging off colored sparks"),
    (r"\bFirst Strike\b", "the strike landing before the dust has moved"),
    (r"\bMesh\b", "many small units linking into one load-bearing lattice"),
    (r"\bdiscard", "loose packets scattering out of an opened courier wallet"),
    (r"\bdraws? ", "fresh data cards sliding out of a warm slot"),
    (r"\bgenerate\b", "raw energy condensing into glowing, countable units"),
    (r"\+\d+/\+\d+|gets? \+", "an overcharge glow hardening into extra armor plating"),
    (r"\bheal|restore\b", "solder seams closing, fresh plating over old scars"),
    (r"\btoken", "small helper drones assembling themselves on the spot"),
    (r"\bUptime\b", "a public uptime dial glowing steady through the noise"),
]

# textless background gags (educational-and-funny mandate; must survive "no text")
GAGS = [
    "a rubber duck wearing a tiny hard hat supervises",
    "a cat sleeps on the warmest rig",
    "a pizza box rests near the money machine",
    "a houseplant thrives in a server rack slot",
    "a garden gnome wears a mining headlamp",
    "one coffee mug army occupies a shelf",
    "a disco ball hangs over serious infrastructure",
    "a banana is taped nearby for scale",
    "sunglasses rest on a security camera",
    "a honey badger figurine guards a vault door",
    "an umbrella stands open indoors, defying fate",
    "a tiny traffic cone crowns a antenna mast",
    "socks with sandals stand at a workstation",
    "a snail with a painted shell races a cable run",
    "a pigeon judges the setup from a beam",
    "an orange balloon is tethered to a heavy machine",
]


def seed_for(card_id: str) -> int:
    """Deterministic 31-bit seed from the card id."""
    return int.from_bytes(hashlib.sha256(card_id.encode()).digest()[:4], "big") % (2**31)


def motif_for(card: dict[str, Any]) -> str:
    """First matching mechanic motif, falling back to the Simple Guide."""
    for pattern, motif in MOTIFS:
        if re.search(pattern, card["rules_text"]):
            return motif
    guide = card["help_text"].split(".")[0].strip().lower()
    return f"a scene that makes this visible without words: {guide}"


def world_for(card: dict[str, Any]) -> str:
    affinities = card["affinity"] or ["Neutral"]
    return " meets ".join(WORLDS[a] for a in affinities)


def composition_for(card: dict[str, Any]) -> str:
    for base in ("Avatar", "Zap", "Operation", "Protocol", "Hardware", "Resource"):
        if base in card["card_type"]:
            comp = COMPOSITION[base]
            break
    else:
        comp = COMPOSITION["Hardware"]
    character = card.get("character")
    if "Avatar" in card["card_type"] and character and character.get("names"):
        names = " and ".join(character["names"])
        comp = (
            f"full-body hero portrait of the official 600Billion character {names}, "
            "faithful to the canonical reference sheet, dynamic pose that matches the "
            "mechanic, no other people"
        )
    return comp


def build_prompt(card: dict[str, Any]) -> dict[str, Any]:
    """Assemble the prompt record for one card."""
    gag = GAGS[seed_for(card["id"]) % len(GAGS)]
    prompt = (
        f"Portrait trading-card illustration, vertical 5:4 crop. {STYLE}. "
        f"Setting: {world_for(card)}. Composition: {composition_for(card)}. "
        f"Named concept to interpret visually, never as written words: '{card['name']}'. "
        f"Focus: {motif_for(card)}. Subtle background gag: {gag}. "
        f"Tone: educational and funny, warm, confident. {ANTI_SLOP}."
    )
    return {
        "id": card["id"],
        "name": card["name"],
        "card_type": card["card_type"],
        "affinity": card["affinity"] or ["Neutral"],
        "seed": seed_for(card["id"]),
        "prompt": prompt,
        "negative_prompt": NEGATIVE,
    }


def main() -> None:
    """Generate prompts for all cards and report variety stats."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    data = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))
    records = [build_prompt(c) for c in data["cards"]]
    OUT_PATH.write_text(
        json.dumps({"version": "prompts-v2", "prompts": records}, indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    unique = len({r["prompt"] for r in records})
    logging.getLogger("build_prompts").info(
        "wrote %d prompts (%d unique) to %s", len(records), unique, OUT_PATH
    )


if __name__ == "__main__":
    main()
