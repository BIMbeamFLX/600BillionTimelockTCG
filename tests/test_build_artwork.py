"""Unit tests for deterministic standalone-art planning."""

from build_artwork import (
    ART_HEIGHT,
    ART_WIDTH,
    build_decisions,
    draw_protocol_motif,
    stable_seed,
    world_categories,
)
from PIL import Image


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


def test_protocol_motif_stays_in_quiet_bottom_corner():
    canvas = Image.new("RGBA", (ART_WIDTH, ART_HEIGHT), (0, 0, 0, 0))
    card = {
        "affinity": ["Signal"],
        "rules_text": "Draw a card.",
        "card_type": "Protocol",
        "subtype": "",
    }

    draw_protocol_motif(canvas, card, seed=600_000_000_000)

    alpha_box = canvas.getchannel("A").getbbox()
    assert alpha_box is not None
    assert alpha_box[0] > ART_WIDTH * 0.65
    assert alpha_box[1] > ART_HEIGHT * 0.70
