"""Tests for the 600B Cockatrice set XML generator."""

from pathlib import Path

import build_set
from build_set import Card, build_xml, load_cards

REPO_ROOT = Path(__file__).resolve().parents[1]
CARDS_CSV = REPO_ROOT / "cards" / "cards.csv"


def make_card(**overrides) -> Card:
    defaults = {
        "name": "Test Card",
        "cardtype": "Avatar",
        "subtype": "Miner",
        "cost": "1P",
        "ar": "2/1",
        "rarity": "common",
        "text": "First Strike",
    }
    defaults.update(overrides)
    return Card(**defaults)


def test_total_cost_sums_digits_and_affinity_letters():
    assert make_card(cost="4BB").total_cost == 6
    assert make_card(cost="10P").total_cost == 11
    assert make_card(cost="XT").total_cost == 1
    assert make_card(cost="").total_cost == 0


def test_affinity_letters_map_to_client_colors():
    assert make_card(cost="1P").client_manacost == "1R"
    assert make_card(cost="4BB").client_manacost == "4GG"
    assert make_card(cost="TT").client_manacost == "UU"
    assert make_card(cost="1SK").client_colors == "WB"
    assert make_card(cost="3").client_colors == ""


def test_tablerow_mapping():
    assert make_card(cardtype="Resource").tablerow == 0
    assert make_card(cardtype="Avatar").tablerow == 2
    assert make_card(cardtype="Zap").tablerow == 3
    assert make_card(cardtype="Operation").tablerow == 3
    assert make_card(cardtype="Hardware").tablerow == 1
    assert make_card(cardtype="Protocol").tablerow == 1


def test_type_line_with_and_without_subtype():
    assert make_card().type_line == "Avatar — Miner"
    assert make_card(cardtype="Zap", subtype="").type_line == "Zap"


def test_load_cards_reads_sample_csv():
    cards = load_cards(CARDS_CSV)
    assert len(cards) == 18
    names = {c.name for c in cards}
    assert "Power Surge" in names
    assert "Power Plant" in names
    assert "Full Archive Node" in names


def test_build_xml_structure():
    cards = load_cards(CARDS_CSV)
    root = build_xml(cards).getroot()

    assert root.tag == "cockatrice_carddatabase"
    assert root.get("version") == "4"
    assert root.find("sets/set/name").text == build_set.SET_CODE
    assert len(root.findall("cards/card")) == len(cards)

    surge = next(
        c for c in root.findall("cards/card") if c.find("name").text == "Power Surge"
    )
    assert surge.find("prop/manacost").text == "R"
    assert surge.find("prop/cmc").text == "1"
    assert surge.find("prop/colors").text == "R"
    assert surge.find("prop/maintype").text == "Zap"
    assert surge.find("tablerow").text == "3"
    assert surge.find("set").get("rarity") == "common"

    resource = next(
        c for c in root.findall("cards/card") if c.find("name").text == "Power Plant"
    )
    assert resource.find("prop/manacost") is None
    assert resource.find("prop/colors") is None
    assert resource.find("prop/type").text == "Resource — Power"
    assert resource.find("tablerow").text == "0"
