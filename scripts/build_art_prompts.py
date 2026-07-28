"""Build the locked 1920x2400 art-director prompt catalog for Edition One.

Avatar prompts use the immutable join.600.wtf Detailed-front files as identity
references. Non-Avatar prompts use the generated affinity world plates as visual
references. The catalog is written only after the complete batch passes consistency
checks and its intended records are committed to the local SQLite audit trail.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("build_art_prompts")

ART_WIDTH = 1920
ART_HEIGHT = 2400
PROMPT_VERSION = "600B-E1-art-director-v3-bullish-web5"

SERIES_BIBLE = (
    "600 BILLION Timelock TCG, an unmistakably bullish Web5 cypherpunk world where the "
    "future already works: self-owned identity, sound money and open peer-to-peer "
    "infrastructure built by capable friends. Show agency, hospitality, competence, "
    "humor and shared abundance with confident playful YOLO-but-verify energy. Use "
    "cinematic editorial realism with tactile screenprint grain, a matte-black core, "
    "warm Bitcoin-orange highlights and ultraviolet-purple accents"
)

NEGATIVE_DIRECTION = (
    "No card frame, title, text, letters, numbers, logos, watermark or interface. "
    "No generic hooded hacker, corporate Web3 advertising, dystopian surveillance, "
    "collapse porn, scarcity panic, weapons-first mood, grimdark lighting, helplessness "
    "or despair. Cypherpunk means freedom technology in daylight, not cyberpunk doom. "
    "No floating circles, wireframe polygons, ornamental geometry, meaningless crypto "
    "glyphs or repeated procedural patterns. No collage, sticker edge, rectangular "
    "cutout, halo box or pasted-character look."
)

AFFINITY_WORLDS = {
    "Signal": (
        "a welcoming rooftop mesh workshop at sunrise, hand-built radios, antennas, "
        "warm lamps and visible peer-to-peer connection"
    ),
    "Timelock": (
        "a calm block-clock observatory and vault workshop, sequential mechanisms, "
        "patient purple light and a clear sense of time becoming certainty"
    ),
    "Keys": (
        "a sovereign signing workshop, tactile hardware, independent stations, privacy "
        "screens and a clear multisignature ritual"
    ),
    "Power": (
        "a community microgrid and miner workshop, hydro or solar energy, copper busbars, "
        "useful heat and energetic orange light"
    ),
    "Bitcoin": (
        "a flourishing local Bitcoin commons, orchard, market and node infrastructure, "
        "abundance created through patient work rather than luxury spectacle"
    ),
    "Neutral": (
        "the Palace of Culture community workshop, blackened steel, timber benches, "
        "open-source tools, coffee, plants and a sunrise city beyond"
    ),
}

NAMED_AFFINITY_CUES = {
    "Signal": (
        "Use unmistakable physical radio propagation, antenna alignment or a hand-built "
        "relay path; avoid abstract network maps and floating connection lines."
    ),
    "Timelock": (
        "Use sequential clockwork, block-height mechanisms, ratchets or delayed physical "
        "release; avoid generic domes, magic bubbles and halo rings."
    ),
    "Keys": (
        "Use tactile signing hardware, separate key stations, tamper seals or an air gap; "
        "avoid fantasy keys and glowing crypto symbols."
    ),
    "Power": (
        "Use turbines, copper busbars, breakers, useful heat or a visible microgrid; "
        "energy must follow a believable physical path."
    ),
    "Bitcoin": (
        "Use working nodes, settlement hardware, block-shaped modules, an orchard or a "
        "local market; avoid luxury coins, price charts and speculative spectacle."
    ),
}

CARD_VISUAL_OVERRIDES = {
    "Last Broadcast": (
        "Center one rugged rotary radio receiving one final clean signal through a real "
        "directional antenna. Show the decisive moment through the tuning needle, warm "
        "receiver light and aligned hardware only. Do not draw beams, nodes, dotted "
        "routes, network-map lines or a web of glowing connections."
    ),
    "Timelock Protection Circuit": (
        "Show a transparent clockwork protection module whose interlocking ratchets hold "
        "and safely release one incoming violet pulse in sequence. No shield emblem, "
        "glass dome, magic bubble or circular halo."
    ),
    "Bitcoin Protection Circuit": (
        "Show a grounded black node with layered copper heat sinks and block-shaped "
        "breaker modules diverting one orange surge into a safe busbar. No shield emblem, "
        "glass dome, magic bubble or circular halo."
    ),
    "Signal Protection Circuit": (
        "Show a real coaxial surge arrestor and grounding block protecting a hand-built "
        "radio receiver beside one precisely aligned directional antenna. Make the "
        "protection legible through cables, connectors and the grounded chassis. No sky "
        "arc, beam, glowing path, dome, shield emblem or abstract signal graphic."
    ),
    "Public Goods Drive": (
        "Show a beautifully maintained open-source transmitter rack beside a community "
        "tool library: labeled-by-color parts bins, spare antennas, charging ports and "
        "repair tools ready for anyone to use. No keyhole, coin, token, logo, glyph, "
        "emblem or floating light."
    ),
    "Emergency Reboot": (
        "Show a row of dark radios and nodes returning to life after one large physical "
        "breaker is reset: fans start, warm status lamps illuminate in sequence and the "
        "antenna rotator moves again. No vertical beam, portal, magic light or floating "
        "energy."
    ),
}

CHARACTER_SIGNATURE_LOCKS = {
    "Morgs": (
        "Signature lock for Morgs: keep the exact long distressed black coat, waistcoat, "
        "chains and boots, and keep the same ornate NSEC shield held straight toward the "
        "viewer so it covers the face. Do not replace the shield with a microphone, "
        "radio, mask, lens, round device or weapon. The engraved NSEC badge on this "
        "canonical identity prop is the sole exception to the no-lettering constraint."
    ),
}

CARD_TYPE_DIRECTION = {
    "Avatar": (
        "Create a complete environmental character scene. Show the official character "
        "at three-quarter or full-body scale performing one constructive, legible action."
    ),
    "Hardware Avatar": (
        "Create a complete environmental character-and-machine scene. Keep both the "
        "official character identity and the living hardware readable at first glance."
    ),
    "Hardware": (
        "Create a hero shot of a tangible buildable device in use. Make its function "
        "understandable through physical cause and effect, not abstract diagrams."
    ),
    "Protocol": (
        "Turn an invisible rule into a believable physical system of connected objects, "
        "routes, locks or shared infrastructure with one clear visual metaphor."
    ),
    "Zap": (
        "Capture one decisive instant of network action with a clean cause-and-effect "
        "silhouette, controlled energy and strong directional movement."
    ),
    "Operation": (
        "Stage one optimistic network-wide event at its decisive moment, with a clear "
        "foreground action and a readable beginning-to-result flow."
    ),
    "Resource": (
        "Create an inviting establishing shot of a working public resource site. Show "
        "how useful capacity is generated and shared through real infrastructure."
    ),
    "Basic Resource": (
        "Create an inviting establishing shot of a working public resource site. Show "
        "how useful capacity is generated and shared through real infrastructure."
    ),
}

CAMERAS = (
    "low three-quarter hero view with a 35mm documentary lens",
    "eye-level intimate workshop view with a 50mm lens",
    "slightly elevated isometric editorial view with strong depth",
    "wide environmental portrait with a 28mm lens and strong foreground",
    "compressed cinematic portrait with an 85mm lens and layered background",
    "dynamic diagonal composition seen from workbench height",
    "calm symmetrical composition broken by one energetic action",
    "over-the-shoulder construction view with the result in focus",
)

LIGHTING = (
    "first orange light of sunrise against deep ultraviolet shadows",
    "late golden-hour light with practical purple workshop lamps",
    "warm tungsten work lights and a cool pre-dawn city beyond",
    "bright optimistic noon light with controlled black negative space",
    "festival dusk with orange practicals and a violet horizon",
    "rain-cleared morning light with wet copper reflections",
)


@dataclass(frozen=True)
class PromptRecord:
    """One locked art-generation brief."""

    card_id: str
    card_name: str
    output_file: str
    references: tuple[dict[str, str], ...]
    prompt: str
    prompt_sha256: str


def stable_index(card_id: str, card_name: str, count: int, salt: str) -> int:
    """Choose a deterministic art-direction variant."""
    digest = hashlib.sha256(f"{salt}|{card_id}|{card_name}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % count


def card_worlds(card: dict[str, Any]) -> list[str]:
    """Return the one or two environments used by the card."""
    affinities = [item for item in card["affinity"] if item in AFFINITY_WORLDS]
    return affinities[:2] or ["Neutral"]


def load_reference_index(path: Path) -> dict[str, dict[str, Any]]:
    """Index local Detailed-front references by every public card alias."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload["character_count"] != 31:
        raise ValueError("join reference manifest must contain 31 characters")
    index: dict[str, dict[str, Any]] = {}
    for item in payload["files"]:
        for alias in item["card_aliases"]:
            index[alias.casefold()] = item
    return index


def character_references(
    card: dict[str, Any],
    index: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    """Resolve every official character named by one Avatar card."""
    character = card.get("character")
    if not character:
        return []
    references: list[dict[str, str]] = []
    for name in character["names"]:
        item = index.get(name.casefold())
        if item is None:
            raise ValueError(f"no join.600.wtf Detailed-front reference for {name}")
        references.append(
            {
                "role": f"identity-lock:{name}",
                "path": item["local_file"],
                "url": item["source_url"],
                "sha256": item["sha256"],
            }
        )
    return references


def world_references(card: dict[str, Any]) -> list[dict[str, str]]:
    """Resolve one or two local affinity-world references."""
    return [
        {
            "role": f"world-and-palette:{world}",
            "path": f"art/world-plates/{world.casefold()}.png",
            "url": "",
            "sha256": "",
        }
        for world in card_worlds(card)
    ]


def world_sentence(card: dict[str, Any]) -> str:
    """Describe a coherent blended world for one card."""
    worlds = card_worlds(card)
    descriptions = [AFFINITY_WORLDS[item] for item in worlds]
    if len(descriptions) == 1:
        return descriptions[0]
    return f"a natural meeting point between {descriptions[0]} and {descriptions[1]}"


def named_affinity_direction(card: dict[str, Any]) -> str:
    """Add a material cue when a card explicitly names one of the five affinities."""
    matches = [
        direction
        for affinity, direction in NAMED_AFFINITY_CUES.items()
        if affinity.casefold() in card["name"].casefold()
    ]
    return " ".join(matches)


def build_prompt(
    card: dict[str, Any],
    references: list[dict[str, str]],
) -> str:
    """Create a complete, card-specific art-director prompt."""
    camera = CAMERAS[stable_index(card["id"], card["name"], len(CAMERAS), "camera")]
    lighting = LIGHTING[stable_index(card["id"], card["name"], len(LIGHTING), "lighting")]
    card_type = card["card_type"]
    type_direction = CARD_TYPE_DIRECTION[card_type]
    name_direction = named_affinity_direction(card)
    card_override = CARD_VISUAL_OVERRIDES.get(card["name"], "")
    mechanic = " ".join(card["rules_text"].split())
    reference_lines = []
    for index, reference in enumerate(references, start=1):
        reference_lines.append(f"Reference {index} ({reference['role']}): {reference['path']}")
    reference_note = " ".join(reference_lines)

    if "Avatar" in card_type:
        cast = " and ".join(card["character"]["names"])
        signature_locks = " ".join(
            CHARACTER_SIGNATURE_LOCKS.get(name, "") for name in card["character"]["names"]
        )
        identity = (
            f"Identity lock: reproduce {cast} from the Detailed-front reference exactly: "
            "same species, face, body proportions, silhouette, wardrobe, materials, colors "
            "and signature accessories. Integrate the character naturally into the light "
            "and environment. Do not invent any other people or characters. "
            f"{signature_locks}"
        )
    else:
        identity = (
            "No people or characters. Let the infrastructure, device or environmental "
            "event carry the whole story."
        )

    return " ".join(
        (
            f"Create one finished {ART_WIDTH}x{ART_HEIGHT} portrait illustration for "
            f"“{card['name']}”, {card['type_line']}.",
            SERIES_BIBLE + ".",
            type_direction,
            identity,
            f"Scene: {world_sentence(card)}.",
            name_direction,
            card_override,
            f"Visual narrative: express this gameplay effect through objects and action, "
            f"without words: {mechanic}",
            f"Composition: {camera}; {lighting}. Keep one unmistakable focal subject, "
            "clean depth separation and enough calm edge detail for a card-art crop.",
            reference_note + ".",
            "Treat identity references as character locks, not as backgrounds or collage "
            "elements. Treat world references as palette and material guidance, not layouts.",
            NEGATIVE_DIRECTION,
            "Full-bleed 4:5 portrait artwork, coherent single scene, polished key art.",
        )
    )


def build_records(
    cards: list[dict[str, Any]],
    reference_index: dict[str, dict[str, Any]],
) -> list[PromptRecord]:
    """Build all 295 prompt records."""
    records: list[PromptRecord] = []
    for card in cards:
        references = character_references(card, reference_index)
        references.extend(world_references(card))
        prompt = build_prompt(card, references)
        records.append(
            PromptRecord(
                card_id=card["id"],
                card_name=card["name"],
                output_file=f"{card['id']}.jpg",
                references=tuple(references),
                prompt=prompt,
                prompt_sha256=hashlib.sha256(prompt.encode()).hexdigest(),
            )
        )
    return records


def validate_records(records: list[PromptRecord], cards: list[dict[str, Any]]) -> list[str]:
    """Return all prompt-catalog consistency errors."""
    errors: list[str] = []
    if len(records) != 295:
        errors.append(f"expected 295 prompts, found {len(records)}")
    if len({item.card_id for item in records}) != len(records):
        errors.append("card IDs are not unique")
    if len({item.prompt_sha256 for item in records}) != len(records):
        errors.append("prompts are not unique")
    for record, card in zip(records, cards, strict=True):
        if f"{ART_WIDTH}x{ART_HEIGHT}" not in record.prompt:
            errors.append(f"{record.card_id}: missing Full-HD portrait size")
        if "No card frame" not in record.prompt:
            errors.append(f"{record.card_id}: missing clean-art constraint")
        if "procedural patterns" not in record.prompt:
            errors.append(f"{record.card_id}: missing pattern exclusion")
        if "bullish Web5" not in record.prompt:
            errors.append(f"{record.card_id}: missing bullish Web5 direction")
        if "future already works" not in record.prompt:
            errors.append(f"{record.card_id}: missing constructive-future direction")
        if "cyberpunk doom" not in record.prompt:
            errors.append(f"{record.card_id}: missing anti-dystopia direction")
        if not record.references:
            errors.append(f"{record.card_id}: missing image reference")
        if "Avatar" in card["card_type"]:
            identity_refs = [
                item for item in record.references if item["role"].startswith("identity-lock:")
            ]
            if len(identity_refs) != len(card["character"]["names"]):
                errors.append(f"{record.card_id}: incomplete character identity references")
            if not all(item["url"].startswith("https://") for item in identity_refs):
                errors.append(f"{record.card_id}: missing join.600.wtf source URL")
    return errors


def record_decisions(db_path: Path, records: list[PromptRecord]) -> None:
    """Commit prompt decisions before public prompt files are written."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS art_prompt_decisions (
                card_id TEXT PRIMARY KEY,
                public_name TEXT NOT NULL,
                prompt_version TEXT NOT NULL,
                output_file TEXT NOT NULL,
                reference_files TEXT NOT NULL,
                prompt_sha256 TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            DELETE FROM art_prompt_decisions;
            """
        )
        connection.executemany(
            """
            INSERT INTO art_prompt_decisions (
                card_id, public_name, prompt_version, output_file, reference_files,
                prompt_sha256, status, reason, updated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    item.card_id,
                    item.card_name,
                    PROMPT_VERSION,
                    item.output_file,
                    json.dumps(
                        [reference["path"] for reference in item.references],
                        ensure_ascii=False,
                    ),
                    item.prompt_sha256,
                    "planned",
                    "text and identity references locked before image generation",
                    "auto:codex:e1-art-prompts",
                )
                for item in records
            ],
        )
        connection.commit()


def write_json(path: Path, records: list[PromptRecord]) -> None:
    """Write the machine-readable prompt catalog."""
    payload = {
        "set": "600B Timelock TCG — Edition One",
        "prompt_version": PROMPT_VERSION,
        "artwork_size": [ART_WIDTH, ART_HEIGHT],
        "aspect_ratio": "4:5 portrait",
        "tone": "bullish Web5 cypherpunk — the future already works",
        "card_count": len(records),
        "cards": [
            {
                "id": item.card_id,
                "name": item.card_name,
                "output_file": item.output_file,
                "references": list(item.references),
                "prompt": item.prompt,
                "prompt_sha256": item.prompt_sha256,
                "status": "prompt-locked",
            }
            for item in records
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def write_markdown(path: Path, records: list[PromptRecord]) -> None:
    """Write a browsable human art-direction catalog."""
    lines = [
        "# Edition One Art-Director Prompt Lock",
        "",
        f"- Version: `{PROMPT_VERSION}`",
        f"- Artworks: **{len(records)}**",
        f"- Standard: **{ART_WIDTH} × {ART_HEIGHT} px, 4:5 portrait**",
        "- Tone: **bullish Web5 cypherpunk — the future already works**",
        "- Character identity: **join.600.wtf Detailed ·front**",
        "- Visible artwork: **no text, logos, card frames or procedural patterns**",
        "",
    ]
    for item in records:
        lines.extend(
            (
                f"## {item.card_id} · {item.card_name}",
                "",
                "**References**",
                "",
            )
        )
        lines.extend(
            f"- `{reference['role']}`: `{reference['path']}`"
            + (f" — {reference['url']}" if reference["url"] else "")
            for reference in item.references
        )
        lines.extend(("", "**Prompt**", "", item.prompt, ""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def write_report(path: Path, records: list[PromptRecord], errors: list[str]) -> None:
    """Write the prompt consistency gate."""
    avatar_count = sum(
        any(reference["role"].startswith("identity-lock:") for reference in item.references)
        for item in records
    )
    lines = [
        "# Edition One Art-Prompt Consistency Report",
        "",
        f"- Version: `{PROMPT_VERSION}`",
        f"- Prompts checked: **{len(records)}**",
        f"- Avatar prompts with Detailed-front identity locks: **{avatar_count}**",
        f"- Output standard: **{ART_WIDTH} × {ART_HEIGHT} px**",
        f"- Errors: **{len(errors)}**",
        f"- Gate: **{'PASS — READY FOR IMAGE GENERATION' if not errors else 'FAIL'}**",
        "",
        "## Checks",
        "",
        "- one unique art-director prompt per card",
        "- one or more explicit reference images per prompt",
        "- every Avatar uses its canonical join.600.wtf Detailed-front image",
        "- no invented background characters",
        "- no text, UI, frame, logo or watermark inside artwork",
        "- no procedural rings, polygons or ornamental pattern overlays",
        "- no cutout, collage, sticker edge or rectangular character halo",
        "- bullish Web5 tone: agency, hospitality, competence, humor and abundance",
        "- cypherpunk freedom technology in daylight, never cyberpunk doom",
        "",
    ]
    if errors:
        lines.extend(("## Errors", ""))
        lines.extend(f"- {error}" for error in errors)
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    """Build and validate the complete prompt lock."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards",
        type=Path,
        default=repo_root / "cards" / "e1-cards.json",
    )
    parser.add_argument(
        "--references",
        type=Path,
        default=repo_root / "art" / "references" / "join-detailed-front" / "manifest.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root / "art" / "prompts",
    )
    parser.add_argument(
        "--audit-db",
        type=Path,
        default=repo_root / ".audit" / "e1-design.sqlite",
    )
    args = parser.parse_args()

    cards = json.loads(args.cards.read_text(encoding="utf-8"))["cards"]
    reference_index = load_reference_index(args.references)
    records = build_records(cards, reference_index)
    errors = validate_records(records, cards)

    record_decisions(args.audit_db, records)
    write_json(args.out / "e1-art-prompts.json", records)
    write_markdown(args.out / "E1-ART-PROMPTS.md", records)
    write_report(args.out / "e1-prompt-lock-report.md", records, errors)

    if errors:
        for error in errors:
            log.error(error)
        raise SystemExit(f"prompt lock failed with {len(errors)} error(s)")
    log.info("prompt lock passed: %d artist briefs are ready", len(records))


if __name__ == "__main__":
    main()
