"""Tests for the local play-test build: Fast card faces and the launcher."""

import json
import subprocess
from pathlib import Path

import build_fast_faces

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_fast_faces_overlay_the_fast_values_and_keep_identity():
    cards = build_fast_faces.fast_cards()["cards"]
    fast = {entry["id"]: entry for entry in json.loads((REPO_ROOT / "cards" / "e1-fast.json").read_text(encoding="utf-8"))["cards"]}
    classic = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))["cards"]
    assert [c["id"] for c in cards] == [c["id"] for c in classic]
    for card, original in zip(cards, classic, strict=True):
        assert card["name"] == original["name"]
        assert card["art_direction"] == original["art_direction"]  # same illustration
        assert (card["cost"], card["rules_text"]) == (fast[card["id"]]["cost"], fast[card["id"]]["rules_text"])


def test_the_manifest_names_each_face_and_where_its_art_sits(tmp_path):
    sidecar = tmp_path / "face-geometry.json"
    sidecar.write_text(json.dumps({"size": [744, 1039], "faces": {"Zap": {"id": "E1-004", "art": [1, 2, 3, 4]}}}))
    out = tmp_path / "fast-faces.js"
    assert build_fast_faces.write_manifest(sidecar, out) == 1
    text = out.read_text(encoding="utf-8")
    payload = json.loads(text[text.index("{") : text.rindex("}") + 1])
    assert payload == {"dir": "../art/cards/fast-web/", "size": [744, 1039], "faces": {"Zap.webp": [1, 2, 3, 4]}}


def test_the_local_build_is_never_committed_or_published():
    ignored = subprocess.run(
        ["git", "check-ignore", "art/cards/fast-web/Zap.webp", "site/fast-faces.js"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=False,
    ).stdout.split()
    assert ignored == ["art/cards/fast-web/Zap.webp", "site/fast-faces.js"]
    # The table asks for the manifest only on a local host.
    faces = (REPO_ROOT / "site" / "faces.js").read_text(encoding="utf-8")
    assert '["localhost", "127.0.0.1", "[::1]"]' in faces


def test_npm_run_local_exists_and_uses_a_throwaway_database():
    package = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["local"] == "node scripts/local-test.mjs"
    launcher = (REPO_ROOT / "scripts" / "local-test.mjs").read_text(encoding="utf-8")
    assert "mkdtempSync" in launcher and "DB: db" in launcher
