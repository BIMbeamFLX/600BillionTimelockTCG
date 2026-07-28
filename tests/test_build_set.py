"""Tests for the Cockatrice set XML generator."""

from pathlib import Path

import build_set
from build_set import Card, build_xml, load_cards

REPO_ROOT = Path(__file__).resolve().parents[1]
CARDS_CSV = REPO_ROOT / "cards" / "cards.csv"


def make_card(**overrides) -> Card:
    defaults = {
        "name": "Test Card",
        "maintype": "Creature",
        "subtype": "Goblin",
        "manacost": "1R",
        "pt": "2/1",
        "rarity": "common",
        "text": "Haste",
    }
    defaults.update(overrides)
    return Card(**defaults)


def test_cmc_sums_digits_and_color_letters():
    assert make_card(manacost="2RR").cmc == 4
    assert make_card(manacost="10G").cmc == 11
    assert make_card(manacost="XG").cmc == 1
    assert make_card(manacost="").cmc == 0


def test_colors_in_wubrg_order():
    assert make_card(manacost="1UW").colors == "WU"
    assert make_card(manacost="3").colors == ""
    assert make_card(manacost="BGW").colors == "WBG"


def test_tablerow_mapping():
    assert make_card(maintype="Basic Land").tablerow == 0
    assert make_card(maintype="Creature").tablerow == 2
    assert make_card(maintype="Instant").tablerow == 3
    assert make_card(maintype="Sorcery").tablerow == 3
    assert make_card(maintype="Artifact").tablerow == 1


def test_type_line_with_and_without_subtype():
    assert make_card().type_line == "Creature — Goblin"
    assert make_card(subtype="").type_line == "Creature"


def test_load_cards_reads_sample_csv():
    cards = load_cards(CARDS_CSV)
    assert len(cards) == 16
    names = {c.name for c in cards}
    assert "Spark Bolt" in names
    assert "Sunfield" in names


def test_build_xml_structure():
    cards = load_cards(CARDS_CSV)
    root = build_xml(cards).getroot()

    assert root.tag == "cockatrice_carddatabase"
    assert root.get("version") == "4"
    assert root.find("sets/set/name").text == build_set.SET_CODE
    assert len(root.findall("cards/card")) == len(cards)

    bolt = next(
        c for c in root.findall("cards/card") if c.find("name").text == "Spark Bolt"
    )
    assert bolt.find("prop/manacost").text == "R"
    assert bolt.find("prop/cmc").text == "1"
    assert bolt.find("prop/colors").text == "R"
    assert bolt.find("tablerow").text == "3"
    assert bolt.find("set").get("rarity") == "common"

    land = next(
        c for c in root.findall("cards/card") if c.find("name").text == "Sunfield"
    )
    assert land.find("prop/manacost") is None
    assert land.find("prop/colors") is None
    assert land.find("tablerow").text == "0"
