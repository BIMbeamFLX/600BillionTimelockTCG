"""Tests for the content-addressed publishing manifest."""

import hashlib
import json
from pathlib import Path

from build_blob_manifest import (
    INSCRIPTION_LIMIT,
    blob_records,
    render_manifest,
    render_ord_batch,
    sha256_file,
)
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
CARDS = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]


def make_set(tmp_path: Path, names: list[str], size: tuple[int, int] = (40, 55)) -> Path:
    """Write a tiny stand-in card set."""
    for name in names:
        Image.new("RGB", size, (20, 10, 5)).save(tmp_path / f"{name}.png")
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
    assert all(len(record["sha256"]) == 64 for record in records)
    assert all(record["mime"] == "image/png" for record in records)


def test_unmatched_files_are_reported_not_dropped(tmp_path):
    make_set(tmp_path, ["Not A Real Card"])
    records = blob_records(tmp_path, CARDS, None)

    assert len(records) == 1
    assert records[0]["id"] is None


def test_blossom_url_is_the_content_hash(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    record = blob_records(tmp_path, CARDS, "https://blossom.example/")[0]

    # Blossom addresses a blob purely by its digest, so the URL must carry the hash.
    assert record["blossom"] == f"https://blossom.example/{record['sha256']}.png"


def test_non_image_files_are_ignored(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    (tmp_path / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("x", encoding="utf-8")

    assert len(blob_records(tmp_path, CARDS, None)) == 1


def test_manifest_totals_and_inscription_ceiling(tmp_path):
    make_set(tmp_path, ["Genesis Lotus", "Network Storm"])
    records = blob_records(tmp_path, CARDS, None)
    manifest = render_manifest(records, tmp_path)

    assert manifest["count"] == 2
    assert manifest["total_bytes"] == sum(record["bytes"] for record in records)
    assert manifest["inscription_limit_bytes"] == INSCRIPTION_LIMIT
    # These stand-ins are tiny, so both fit.
    assert manifest["inscribable_count"] == 2
    assert manifest["oversize_for_inscription"] == []


def test_oversize_files_are_flagged_and_left_out_of_the_batch(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    big = tmp_path / "Network Storm.png"
    big.write_bytes(b"\x89PNG" + b"0" * (INSCRIPTION_LIMIT + 10))
    records = blob_records(tmp_path, CARDS, None)
    manifest = render_manifest(records, tmp_path)

    assert manifest["oversize_for_inscription"] == ["Network Storm"]
    assert manifest["inscribable_count"] == 1
    batch = render_ord_batch(records, tmp_path, 546)
    assert "Genesis Lotus" in batch
    assert "Network Storm" not in batch


def test_ord_batch_is_well_formed(tmp_path):
    make_set(tmp_path, ["Genesis Lotus"])
    records = blob_records(tmp_path, CARDS, None)
    batch = render_ord_batch(records, tmp_path, 546)

    assert "mode: separate-outputs" in batch
    assert "postage: 546" in batch
    assert "inscriptions:" in batch
    assert "- file:" in batch
    assert 'id: "E1-001"' in batch
    assert batch.endswith("\n")
