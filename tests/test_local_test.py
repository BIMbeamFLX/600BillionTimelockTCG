"""Tests for the local play-test build: Fast card faces and the launcher."""

import json
import subprocess
from pathlib import Path

import build_fast_faces

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_fast_faces_overlay_the_fast_values_and_keep_identity():
    cards = build_fast_faces.fast_cards()["cards"]
    fast = {
        entry["id"]: entry
        for entry in json.loads((REPO_ROOT / "cards" / "e1-fast.json").read_text(encoding="utf-8"))[
            "cards"
        ]
    }
    classic = json.loads((REPO_ROOT / "cards" / "e1-cards.json").read_text(encoding="utf-8"))[
        "cards"
    ]
    assert [c["id"] for c in cards] == [c["id"] for c in classic]
    for card, original in zip(cards, classic, strict=True):
        assert card["name"] == original["name"]
        assert card["art_direction"] == original["art_direction"]  # same illustration
        assert (card["cost"], card["rules_text"]) == (
            fast[card["id"]]["cost"],
            fast[card["id"]]["rules_text"],
        )


def test_the_manifest_names_each_face_and_where_its_art_sits(tmp_path):
    sidecar = tmp_path / "face-geometry.json"
    sidecar.write_text(
        json.dumps({"size": [744, 1039], "faces": {"Zap": {"id": "E1-004", "art": [1, 2, 3, 4]}}})
    )
    out = tmp_path / "fast-faces.js"
    assert build_fast_faces.write_manifest(sidecar, out) == 1
    text = out.read_text(encoding="utf-8")
    payload = json.loads(text[text.index("{") : text.rindex("}") + 1])
    assert payload == {
        "dir": "../art/cards/fast-web/",
        "size": [744, 1039],
        "faces": {"Zap.webp": [1, 2, 3, 4]},
    }


def test_the_local_build_is_never_committed_or_published():
    ignored = subprocess.run(
        ["git", "check-ignore", "art/cards/fast-web/Zap.webp", "site/fast-faces.js"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
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


def _launcher(expression: str) -> str:
    """Evaluate one expression against scripts/local-test.mjs in node; its printed JSON."""
    code = (
        f'import("./scripts/local-test.mjs").then((m) => console.log(JSON.stringify({expression})))'
    )
    return subprocess.run(
        ["node", "-e", code], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def test_lan_lists_non_internal_ipv4_best_first():
    interfaces = {
        "Loopback": [{"family": "IPv4", "address": "127.0.0.1", "internal": True}],
        "Tailscale": [{"family": "IPv4", "address": "100.65.85.26", "internal": False}],
        "FIPS": [{"family": "IPv4", "address": "169.254.222.29", "internal": False}],
        "WLAN": [
            {"family": "IPv6", "address": "fe80::1", "internal": False},
            {"family": "IPv4", "address": "192.168.37.118", "internal": False},
        ],
        "Docker": [{"family": 4, "address": "172.17.0.1", "internal": False}],
    }
    found = json.loads(_launcher(f"m.lanAddresses({json.dumps(interfaces)})"))
    assert [entry["address"] for entry in found] == ["192.168.37.118", "172.17.0.1", "100.65.85.26"]
    assert found[0]["name"] == "WLAN"


def test_lan_url_carries_the_3d_table_the_stats_chip_and_local_assets():
    url = json.loads(_launcher('m.phoneUrl("192.168.1.20", 8777)'))
    assert url == "http://192.168.1.20:8777/play.html?rules=fast&arena=3d&arenastats=1&assets=local"


def test_only_lan_mode_trusts_another_host():
    parsed = ", ".join(
        f"m.parseArgs({json.dumps(argv)})"
        for argv in (["--port", "8790"], ["--lan", "10.0.0.7"], ["--lan", "--port", "9000"])
    )
    args = json.loads(_launcher(f"[{parsed}]"))
    assert args == [
        {"port": 8790, "lan": False, "lanIp": None},
        {"port": 8777, "lan": True, "lanIp": "10.0.0.7"},
        {"port": 9000, "lan": True, "lanIp": None},
    ]
    local = 'm.tableEnv({ A: "1" }, { port: 8777, db: "x.db", publicHost: null })'
    lan = 'm.tableEnv({}, { port: 8777, db: "x.db", publicHost: "10.0.0.7" })'
    envs = json.loads(_launcher(f"[{local}, {lan}]"))
    assert envs[0] == {"A": "1", "PORT": "8777", "DB": "x.db"}
    assert envs[1] == {"PORT": "8777", "DB": "x.db", "PUBLIC_HOST": "10.0.0.7"}
    # The table binds every interface and trusts PUBLIC_HOST: that is what --lan relies on.
    table = (REPO_ROOT / "server" / "table.js").read_text(encoding="utf-8")
    assert 'const host = options.host || "0.0.0.0";' in table
    assert "if (options.publicHost) addTrustedHost(options.publicHost);" in table
    assert "publicHost: process.env.PUBLIC_HOST," in table
