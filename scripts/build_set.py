"""Build a Cockatrice v4 custom set XML from cards/cards.csv.

Usage:
    python scripts/build_set.py              # writes dist/01.tcg600nap.xml
    python scripts/build_set.py --install    # also copies XML + art into Cockatrice
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

SET_CODE = "T6N"
SET_LONGNAME = "TCG600nap"
SET_TYPE = "Custom"
RELEASE_DATE = "2026-07-28"

COLOR_LETTERS = "WUBRG"
ART_EXTENSIONS = {".png", ".jpg", ".jpeg"}

log = logging.getLogger("build_set")


@dataclass
class Card:
    """One card row from cards.csv."""

    name: str
    maintype: str
    subtype: str
    manacost: str
    pt: str
    rarity: str
    text: str

    @property
    def type_line(self) -> str:
        """Full type line, e.g. 'Creature — Guardian'."""
        if self.subtype:
            return f"{self.maintype} — {self.subtype}"
        return self.maintype

    @property
    def cmc(self) -> int:
        """Converted mana cost: digits summed, each color letter counts 1, X counts 0."""
        total = 0
        digits = ""
        for ch in self.manacost:
            if ch.isdigit():
                digits += ch
            else:
                if digits:
                    total += int(digits)
                    digits = ""
                if ch.upper() in COLOR_LETTERS:
                    total += 1
        if digits:
            total += int(digits)
        return total

    @property
    def colors(self) -> str:
        """Color letters present in the mana cost, in WUBRG order."""
        found = {ch.upper() for ch in self.manacost if ch.upper() in COLOR_LETTERS}
        return "".join(c for c in COLOR_LETTERS if c in found)

    @property
    def tablerow(self) -> int:
        """Cockatrice table row: 0 lands, 1 other permanents, 2 creatures, 3 spells."""
        if "Land" in self.maintype:
            return 0
        if self.maintype == "Creature":
            return 2
        if self.maintype in ("Instant", "Sorcery"):
            return 3
        return 1


def load_cards(csv_path: Path) -> list[Card]:
    """Read card definitions from a CSV file."""
    cards: list[Card] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cards.append(
                Card(
                    name=row["name"].strip(),
                    maintype=row["maintype"].strip(),
                    subtype=row["subtype"].strip(),
                    manacost=row["manacost"].strip(),
                    pt=row["pt"].strip(),
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
        ET.SubElement(prop, "maintype").text = card.maintype
        if card.manacost:
            ET.SubElement(prop, "manacost").text = card.manacost
        ET.SubElement(prop, "cmc").text = str(card.cmc)
        if card.colors:
            ET.SubElement(prop, "colors").text = card.colors
            ET.SubElement(prop, "coloridentity").text = card.colors
        if card.pt:
            ET.SubElement(prop, "pt").text = card.pt

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
    for img in sorted(art_dir.iterdir()) if art_dir.is_dir() else []:
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
        "--out", type=Path, default=repo_root / "dist" / "01.tcg600nap.xml"
    )
    parser.add_argument(
        "--install", action="store_true", help="copy into Cockatrice data dir"
    )
    args = parser.parse_args()

    cards = load_cards(args.csv)
    log.info("loaded %d cards from %s", len(cards), args.csv)
    write_xml(build_xml(cards), args.out)

    if args.install:
        install(args.out, repo_root / "art")


if __name__ == "__main__":
    main()
