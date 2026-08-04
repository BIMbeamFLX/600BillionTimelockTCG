"""Tests for the content-addressed publishing manifest."""

import hashlib
import json
from pathlib import Path

from build_blob_manifest import (
    blob_records,
    nip94_events,
    render_manifest,
    sha256_file,
)
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
CARDS = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]


def make_set(tmp_path: Path, names: list[str]) -> Path:
    """Write a tiny stand-in card set."""
    for name in names:
        Image.new("RGB", (40, 55), (20, 10, 5)).save(tmp_path / f"{name}.png")
    return tmp_path


def test_sha256_matches_hashlib(tmp_path):
    target = tmp_path / "blob.bin"
    target.write_bytes(b"600 000 000 000")

    assert sha256_file(target) == hashlib.sha256(b"600 000 000 000").hexdigest()


def test_records_join_files_back_to_their_card(tmp_path):
    make_set(tmp_path, ["Genesis Lotus", "Network Storm"])
    records = blob_records(tmp_path, CARDS, None)

    assert [record["name"] for record in records] == ["Genesis Lotus", "Network Storm"]
    assert records[0]["id"] == "E1-001"
    assert records[1]["id"] == "E1-202"
    assert records[1]["card_type"] == "Operation"
    assert all(len(record["sha256"]) == 64 for record in records)
    assert all(record["mime"] == "image/png" for record in records)


def test_unmatched_files_are_reported_not_dropped(tmp_path):
    make_set(tmp_path, ["Not A Real Card"])
    records = blob_records(tmp_path, CARDS, None)
    manifest = render_manifest(records, tmp_path)

    assert len(records) == 1
    assert records[0]["id"] is None
    assert manifest["unmatched"] == ["Not A Real Card"]


def test_blossom_url_is_the_content_hash(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    record = blob_records(tmp_path, CARDS, "https://blossom.example/")[0]

    # Blossom addresses a blob purely by its digest, so the URL must carry the hash.
    assert record["blossom"] == f"https://blossom.example/{record['sha256']}.png"


def test_identical_bytes_hash_identically(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    (tmp_path / "copy.png").write_bytes((tmp_path / "Genesis Lotus.png").read_bytes())
    records = {record["name"]: record for record in blob_records(tmp_path, CARDS, None)}

    # This is the property Blossom mirroring relies on.
    assert records["Genesis Lotus"]["sha256"] == records["copy"]["sha256"]


def test_non_image_files_are_ignored(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("x", encoding="utf-8")

    assert len(blob_records(tmp_path, CARDS, None)) == 1


def test_manifest_totals(tmp_path):
    make_set(tmp_path, ["Genesis Lotus", "Network Storm"])
    records = blob_records(tmp_path, CARDS, None)
    manifest = render_manifest(records, tmp_path)

    assert manifest["count"] == 2
    assert manifest["total_bytes"] == sum(record["bytes"] for record in records)
    assert manifest["unmatched"] == []


def test_nip94_events_carry_the_hash_and_url(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    records = blob_records(tmp_path, CARDS, "https://blossom.example")
    events = nip94_events(records)

    assert len(events) == 1
    event = events[0]
    assert event["kind"] == 1063
    tags = dict((tag[0], tag[1]) for tag in event["tags"])
    assert tags["x"] == records[0]["sha256"]
    assert tags["url"] == records[0]["blossom"]
    assert tags["m"] == "image/png"
    assert tags["size"] == str(records[0]["bytes"])
    assert tags["d"] == "E1-001"
    # Nothing here signs anything, so no key material may appear.
    assert "sig" not in event and "pubkey" not in event


def test_nip94_needs_a_resolved_url(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])

    assert nip94_events(blob_records(tmp_path, CARDS, None)) == []
