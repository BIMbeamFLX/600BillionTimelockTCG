"""Tests for the Fast (F1.0) card values and the Fast catalog built from them."""

import json
import re
from pathlib import Path

import design_fast_cards
from build_play_data import apply_fast_values, playable_records, render_module

REPO_ROOT = Path(__file__).resolve().parents[1]
CLASSIC = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]
FAST_FILE = REPO_ROOT / "cards" / "e1-fast.json"
FAST = json.loads(FAST_FILE.read_text(encoding="utf-8"))
FACE_FILES = {
    item["id"]: item["file"]
    for item in json.loads(
        (REPO_ROOT / "art" / "cards" / "node-runner-web" / "manifest.json").read_text(encoding="utf-8")
    )["files"]
}


def fast_records() -> list[dict]:
    """The Fast catalog exactly as the builder compiles it."""
    return playable_records(apply_fast_values(CLASSIC, FAST), FACE_FILES)


def test_the_committed_fast_values_are_what_the_design_script_writes():
    expected = json.dumps(design_fast_cards.build(), ensure_ascii=False, indent=2) + "\n"
    assert FAST_FILE.read_text(encoding="utf-8") == expected


def test_the_committed_fast_catalog_is_what_the_builder_writes():
    built = render_module(fast_records(), "E1_CARDS_FAST")
    assert (REPO_ROOT / "site" / "play-data-fast.js").read_text(encoding="utf-8") == built


def test_every_card_keeps_its_id_name_and_affinity():
    records = fast_records()
    assert [r["id"] for r in records] == [c["id"] for c in CLASSIC]
    assert [r["name"] for r in records] == [c["name"] for c in CLASSIC]
    assert [r["affinity"] for r in records] == [c["affinity"] or ["Neutral"] for c in CLASSIC]


def test_no_fast_card_is_a_resource_card_or_needs_a_manual_ruling():
    records = fast_records()
    assert not [r["id"] for r in records if "Resource" in r["type"]]
    assert not [r["id"] for r in records if r["manual"]]


def test_no_fast_card_prints_a_rule_the_fast_profile_does_not_have():
    dead = re.compile(r"\bQueue\b|\bblock|\bMesh\b|\bBackchannel\b|Broadcast Guard|Shielded from|\bclash\b", re.IGNORECASE)
    offenders = [c["id"] for c in FAST["cards"] if dead.search(c["rules_text"])]
    assert offenders == []
    resource_cards = [
        c["id"] for c in FAST["cards"]
        for line in c["rules_text"].split("\n")
        if re.search(r"\bResources?\b", line) and "generate" not in line
    ]
    assert resource_cards == []


def test_avatar_stats_stay_near_the_fast_budget():
    for card in FAST["cards"]:
        if "Avatar" not in card["card_type"]:
            continue
        action, resilience = (int(n) for n in card["action_resilience"].split("/"))
        cost = design_fast_cards.total_cost(card["cost"])
        assert resilience >= 1, card["id"]
        assert action + resilience <= 2 * cost + 5, (card["id"], card["cost"], card["action_resilience"])


def test_resource_cards_become_ramp_hardware():
    by_id = {c["id"]: c for c in FAST["cards"]}
    basic = by_id["E1-293"]  # Power Plant — Solar
    assert (basic["card_type"], design_fast_cards.total_cost(basic["cost"])) == ("Hardware", 2)
    assert basic["rules_text"] == "Commit: generate 1 Power Resource."
    junction = by_id["E1-278"]
    assert (junction["card_type"], design_fast_cards.total_cost(junction["cost"])) == ("Hardware", 4)


def test_keyword_lines_are_spelled_for_fast():
    assert design_fast_cards.keyword_line("Broadcast Guard (This Avatar can block Avatars with Broadcast.)") == (
        "Firewall (Attacks must target this Avatar first.)"
    )
    assert design_fast_cards.keyword_line("Broadcast; Mesh.") == "Broadcast (Ignores Firewall.)"
    assert design_fast_cards.keyword_line("Mesh.") == ""
    assert design_fast_cards.keyword_line("Commit: draw a card.") is None


def test_the_design_is_deterministic_and_leaves_classic_untouched():
    before = (REPO_ROOT / "cards" / "e1-cards.json").read_bytes()
    assert design_fast_cards.build() == design_fast_cards.build()
    assert (REPO_ROOT / "cards" / "e1-cards.json").read_bytes() == before
