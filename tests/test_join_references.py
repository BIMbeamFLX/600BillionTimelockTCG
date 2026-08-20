"""Tests for immutable join.600.wtf character references."""

import json
from pathlib import Path

import pytest
from sync_join_references import VARIANTS, load_registry

REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY = REPO_ROOT / "art" / "references" / "join-characters.json"


@pytest.mark.parametrize("variant", sorted(VARIANTS))
def test_registry_carries_every_published_variant(variant):
    """Both pictures of every character, or an art run silently loses a face."""
    characters = load_registry(REGISTRY, VARIANTS[variant]["url_field"])

    assert len(characters) == 31
    assert all(item["detailed_front_url"].startswith("https://") for item in characters)
    assert all(item["homepage_url"].startswith("https://") for item in characters)
    assert all(item["card_aliases"] for item in characters)


def test_the_two_variants_are_different_pictures():
    """The site avatar is not a crop of the card study, and nothing may treat it as one."""
    characters = load_registry(REGISTRY, "homepage_url")

    assert all(item["homepage_url"] != item["detailed_front_url"] for item in characters)


@pytest.mark.parametrize("variant", sorted(VARIANTS))
def test_download_manifest_verifies_source_hashes(variant):
    """Mirrors are gitignored and rebuilt on demand, so only check the ones present."""
    spec = VARIANTS[variant]
    path = REPO_ROOT / "art" / "references" / spec["directory"] / "manifest.json"
    if not path.exists():
        pytest.skip(f"no {variant} mirror here: sync_join_references.py --variant {variant}")
    manifest = json.loads(path.read_text(encoding="utf-8"))

    assert manifest["source_policy"] == "read-only"
    assert manifest["visual_reference"] == spec["label"]
    assert manifest["character_count"] == 31
    assert all(item["status"] == "verified-read-only-copy" for item in manifest["files"])
    # Blossom is content-addressed, so the URL carries the hash the bytes must have.
    assert all(item["sha256"] in item["source_url"] for item in manifest["files"])
