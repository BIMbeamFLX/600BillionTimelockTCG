"""Tests for immutable join.600.wtf character references."""

import json
from pathlib import Path

from sync_join_references import load_registry

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_registry_contains_all_detailed_front_references():
    registry_path = REPO_ROOT / "art" / "references" / "join-characters.json"
    characters = load_registry(registry_path)

    assert len(characters) == 31
    assert all(item["detailed_front_url"].startswith("https://") for item in characters)
    assert all(item["card_aliases"] for item in characters)


def test_download_manifest_verifies_source_hashes():
    manifest = json.loads(
        (REPO_ROOT / "art" / "references" / "join-detailed-front" / "manifest.json").read_text(
            encoding="utf-8"
        )
    )

    assert manifest["source_policy"] == "read-only"
    assert manifest["visual_reference"] == "Detailed ·front"
    assert manifest["character_count"] == 31
    assert all(item["status"] == "verified-read-only-copy" for item in manifest["files"])
