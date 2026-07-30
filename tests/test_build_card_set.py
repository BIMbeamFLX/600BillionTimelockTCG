"""Tests for the Node Runner frame sheet."""

import json
from pathlib import Path

from build_card_set import (
    AFFINITY_ACCENT,
    build_geometry,
    cost_pips,
    render_html,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SET_DATA = json.loads((REPO_ROOT / "cards" / "e1-node-runner-set.json").read_text(encoding="utf-8"))
ART_DIR = REPO_ROOT / "art" / "cards" / "node-runner"

# Golden path prefixes captured from the design canvas' own generator at the
# default border amplitude. They pin the Python port to the published design.
GOLDEN_SPINE_C1 = "M0,0L6,0L6,1109L0,1109ZM0,8L39.7,8L39.7,39.6L0,39.6Z"
GOLDEN_CIRCUIT_C1 = "M53.4,194.8L98.2,188.6L145.7,192.9L189.5,190.4"
GOLDEN_RING_BACK = "M575.3,542.3Q580.5,554 576.7,565.9"


def test_set_data_locks_eighteen_playtest_cards():
    cards = SET_DATA["cards"]

    assert SET_DATA["set"]["card_count"] == len(cards) == 18
    assert [card["id"] for card in cards] == [f"E1-{n:03d}" for n in range(7, 25)]
    assert {card["affinity"] for card in cards} <= set(AFFINITY_ACCENT)
    assert all(card["name"] and card["flavor_text"] for card in cards)
    assert SET_DATA["set"]["trim_mm"] == [63, 88]
    assert SET_DATA["set"]["bleed_mm"] == 3


def test_generator_matches_the_design_canvas():
    geometry = build_geometry(6)

    assert sorted(geometry) == sorted(["back"] + [f"c{i}" for i in range(1, 19)])
    assert geometry["c1"]["spine"].startswith(GOLDEN_SPINE_C1)
    assert geometry["c1"]["circ"]["line"].startswith(GOLDEN_CIRCUIT_C1)
    assert geometry["c1"]["circ"]["line"].endswith("Z")
    assert geometry["back"]["ring"].startswith(GOLDEN_RING_BACK)
    assert set(geometry["c1"]["rainL"]) == {"0", "6", "\n"}
    assert all(paths["spine"] for paths in geometry.values())


def test_generator_is_deterministic_and_amplitude_sensitive():
    assert build_geometry(6) == build_geometry(6)
    assert build_geometry(6)["c1"]["circ"]["line"] != build_geometry(11)["c1"]["circ"]["line"]
    # The straight spine bar is amplitude-independent; the jittered ring is not.
    assert build_geometry(6)["c1"]["spine"] == build_geometry(11)["c1"]["spine"]


def test_cost_pips_render_generic_boxes_and_affinity_symbols():
    assert cost_pips("") == ""
    assert 'class="generic">4<' in cost_pips("4BB")
    assert cost_pips("4BB").count("bitcoin.svg") == 2
    assert "pips-only" in cost_pips("TT")
    assert "pips-only" not in cost_pips("1S")
    assert cost_pips("1") == '<div class="cost"><span class="generic">1</span></div>'


def test_rendered_sheet_covers_every_card_and_the_back():
    markup = render_html(SET_DATA, build_geometry(6), ART_DIR, True, True)

    assert markup.count('<article class="card') == 19
    assert 'id="card-back"' in markup
    for card in SET_DATA["cards"]:
        assert card["name"] in markup
        assert card["id"] in markup
    assert "{{" not in markup and "image-slot" not in markup and "<x-dc>" not in markup
    assert '<html lang="en">' in markup
    assert 'href="cards.html"' in markup
    assert "TRIM 63×88" in markup
    # Six avatars carry Action/Resilience boxes; five resources carry an affinity mark.
    assert markup.count("stat-act") == 6 + 1
    assert markup.count('class="resource-icon"') == 5


def test_guide_and_flavor_toggles_reach_the_page():
    assert 'class="no-guides' in render_html(SET_DATA, build_geometry(6), ART_DIR, False, True)
    assert "no-fable" in render_html(SET_DATA, build_geometry(6), ART_DIR, True, False)
    assert 'class=""' in render_html(SET_DATA, build_geometry(6), ART_DIR, True, True)


def test_built_sheet_is_committed_and_print_ready():
    sheet = (REPO_ROOT / "site" / "e1-card-set.html").read_text(encoding="utf-8")

    assert "Node Runner" in sheet
    assert "@media print" in sheet
    assert "69mm" in sheet and "94mm" in sheet
    assert "Power Plant".upper() in sheet
    assert "Proof of Work".upper() in sheet
    assert "../art/resources/power.svg" in sheet
    assert "https://fonts.googleapis.com" not in sheet
