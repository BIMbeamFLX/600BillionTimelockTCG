"""Build a Cockatrice v4 custom set XML for 600B Timelock TCG from cards/cards.csv.

Cards are authored in E1 terms (Resources P/B/K/S/T, Avatars with Action/Resilience).
For the Cockatrice client the five affinities are mapped onto its five color slots as a
render adapter, following the E1 affinity-wheel adjacency: Signal=W, Timelock=U, Keys=B,
Power=R, Bitcoin=G. Card names and rules text stay pure 600B.

Usage:
    python scripts/build_set.py              # writes dist/01.600b-e1.xml
    python scripts/build_set.py --install    # also copies XML + card art into Cockatrice
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import shutil
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

SET_CODE = "600B"
SET_LONGNAME = "600B Timelock TCG — Edition One"
SET_TYPE = "Custom"
RELEASE_DATE = "2026-07-28"

# E1 affinity letter -> Cockatrice color slot (render adapter only).
RESOURCE_TO_CLIENT = {"S": "W", "T": "U", "K": "B", "P": "R", "B": "G"}
CLIENT_COLOR_ORDER = "WUBRG"

# E1 card type -> Cockatrice table row (0 resources, 1 permanents, 2 avatars, 3 one-shots).
TABLEROW_BY_TYPE = {
    "Resource": 0,
    "Basic Resource": 0,
    "Avatar": 2,
    "Hardware Avatar": 2,
    "Zap": 3,
    "Operation": 3,
}

ART_EXTENSIONS = {".png", ".jpg", ".jpeg"}

log = logging.getLogger("build_set")


@dataclass
class Card:
    """One card row from cards.csv, authored in 600B E1 terms."""

    name: str
    cardtype: str
    subtype: str
    cost: str
    ar: str
    rarity: str
    text: str

    @property
    def type_line(self) -> str:
        """Full type line, e.g. 'Avatar — Firewall'."""
        if self.subtype:
            return f"{self.cardtype} — {self.subtype}"
        return self.cardtype

    @property
    def total_cost(self) -> int:
        """Total cost: digits summed, each affinity letter counts 1, X counts 0."""
        total = 0
        digits = ""
        for ch in self.cost:
            if ch.isdigit():
                digits += ch
            else:
                if digits:
                    total += int(digits)
                    digits = ""
                if ch.upper() in RESOURCE_TO_CLIENT:
                    total += 1
        if digits:
            total += int(digits)
        return total

    @property
    def client_manacost(self) -> str:
        """Cost string with affinity letters mapped to Cockatrice color letters."""
        return "".join(RESOURCE_TO_CLIENT.get(ch.upper(), ch) for ch in self.cost)

    @property
    def client_colors(self) -> str:
        """Mapped color letters present in the cost, in Cockatrice WUBRG order."""
        found = {
            RESOURCE_TO_CLIENT[ch.upper()]
            for ch in self.cost
            if ch.upper() in RESOURCE_TO_CLIENT
        }
        return "".join(c for c in CLIENT_COLOR_ORDER if c in found)

    @property
    def tablerow(self) -> int:
        """Cockatrice table row for this card type."""
        return TABLEROW_BY_TYPE.get(self.cardtype, 1)


def load_cards(csv_path: Path) -> list[Card]:
    """Read card definitions from a CSV file."""
    cards: list[Card] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cards.append(
                Card(
                    name=row["name"].strip(),
                    cardtype=row["type"].strip(),
                    subtype=row["subtype"].strip(),
                    cost=row["cost"].strip(),
                    ar=row["ar"].strip(),
                    rarity=row["rarity"].strip() or "common",
                    text=row["text"].strip().replace("\\n", "\n"),
                )
            )
    return cards


def build_xml(cards: list[Card]) -> ET.ElementTree:
    """Build the cockatrice_carddatabase v4 element tree."""
    root = ET.Element("cockatrice_carddatabase", version="4")

    sets = ET.SubElement(root, "sets")
    set_el = ET.SubElement(sets, "set")
    ET.SubElement(set_el, "name").text = SET_CODE
    ET.SubElement(set_el, "longname").text = SET_LONGNAME
    ET.SubElement(set_el, "settype").text = SET_TYPE
    ET.SubElement(set_el, "releasedate").text = RELEASE_DATE

    cards_el = ET.SubElement(root, "cards")
    for card in cards:
        card_el = ET.SubElement(cards_el, "card")
        ET.SubElement(card_el, "name").text = card.name
        ET.SubElement(card_el, "text").text = card.text

        prop = ET.SubElement(card_el, "prop")
        ET.SubElement(prop, "layout").text = "normal"
        ET.SubElement(prop, "side").text = "front"
        ET.SubElement(prop, "type").text = card.type_line
        ET.SubElement(prop, "maintype").text = card.cardtype
        if card.cost:
            ET.SubElement(prop, "manacost").text = card.client_manacost
        ET.SubElement(prop, "cmc").text = str(card.total_cost)
        if card.client_colors:
            ET.SubElement(prop, "colors").text = card.client_colors
            ET.SubElement(prop, "coloridentity").text = card.client_colors
        if card.ar:
            ET.SubElement(prop, "pt").text = card.ar

        ET.SubElement(card_el, "set", rarity=card.rarity).text = SET_CODE
        ET.SubElement(card_el, "tablerow").text = str(card.tablerow)

    tree = ET.ElementTree(root)
    ET.indent(tree)
    return tree


def write_xml(tree: ET.ElementTree, out_path: Path) -> None:
    """Write the XML file with declaration."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tree.write(out_path, encoding="UTF-8", xml_declaration=True)
    log.info("wrote %s", out_path)


def cockatrice_data_dir() -> Path:
    """Default Cockatrice data directory on Windows."""
    return Path(os.environ["LOCALAPPDATA"]) / "Cockatrice" / "Cockatrice"


def install(xml_path: Path, art_dir: Path) -> None:
    """Copy the set XML and card art into the local Cockatrice data directory."""
    data_dir = cockatrice_data_dir()
    if not data_dir.is_dir():
        log.warning(
            "Cockatrice data dir not found at %s — is Cockatrice installed?", data_dir
        )
        return

    customsets = data_dir / "customsets"
    customsets.mkdir(parents=True, exist_ok=True)
    shutil.copy2(xml_path, customsets / xml_path.name)
    log.info("installed %s", customsets / xml_path.name)

    pics_custom = data_dir / "pics" / "CUSTOM"
    pics_custom.mkdir(parents=True, exist_ok=True)
    count = 0
    # Placeholders first; finished card faces overwrite them.
    for source in (art_dir / "placeholders", art_dir / "final", art_dir):
        for img in sorted(source.iterdir()) if source.is_dir() else []:
            if img.suffix.lower() in ART_EXTENSIONS:
                shutil.copy2(img, pics_custom / img.name)
                count += 1
    log.info("installed %d card images to %s", count, pics_custom)


def main() -> None:
    """CLI entry point."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=repo_root / "cards" / "cards.csv")
    parser.add_argument(
        "--out", type=Path, default=repo_root / "dist" / "01.600b-e1.xml"
    )
    parser.add_argument(
        "--install", action="store_true", help="copy into Cockatrice data dir"
    )
    args = parser.parse_args()

    cards = load_cards(args.csv)
    log.info("loaded %d cards from %s", len(cards), args.csv)
    write_xml(build_xml(cards), args.out)

    if args.install:
        install(args.out, repo_root / "art" / "cards")


if __name__ == "__main__":
    main()
