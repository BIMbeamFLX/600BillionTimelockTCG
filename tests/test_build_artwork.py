"""Unit tests for deterministic standalone-art planning."""

from build_artwork import build_decisions, stable_seed, world_categories


def test_stable_seed_uses_public_identity():
    assert stable_seed("E1-001", "Genesis Lotus") == stable_seed("E1-001", "Genesis Lotus")
    assert stable_seed("E1-001", "Genesis Lotus") != stable_seed("E1-002", "Genesis Lotus")


def test_world_categories_support_neutral_and_multi_affinity():
    assert world_categories([]) == ["Neutral"]
    assert world_categories(["Power"]) == ["Power"]
    assert world_categories(["Power", "Keys"]) == ["Power", "Keys"]


def test_art_decisions_keep_character_assets():
    cards = [
        {
            "id": "E1-003",
            "name": "FLX, Culture Curator",
            "affinity": ["Signal"],
            "character": {"assets": ["flx_concept.png"]},
        }
    ]
    decision = build_decisions(cards)[0]

    assert decision.world_plates == ["signal.png"]
    assert decision.character_assets == ["flx_concept.png"]
    assert decision.output_file == "E1-003.jpg"
