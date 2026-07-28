"""Unit tests for the final Edition One card renderer."""

from pathlib import Path

from build_cards import parse_cost, safe_filename


def test_parse_cost_centers_each_resource_token():
    assert parse_cost("3SSS") == ["3", "S", "S", "S"]
    assert parse_cost("X1K") == ["X", "1", "K"]
    assert parse_cost("") == []


def test_safe_filename_preserves_readable_names():
    assert safe_filename("FLX, Culture Curator") == "FLX, Culture Curator.jpg"
    assert safe_filename("Signal / Keys") == "Signal _ Keys.jpg"
    assert Path(safe_filename("Genesis Lotus")).suffix == ".jpg"
