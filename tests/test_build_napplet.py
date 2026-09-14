"""The napplet build: one self-contained page and the manifest that pins it."""

import hashlib
import re
from pathlib import Path

import build_napplet
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE = REPO_ROOT / "site"
CRLF = bytes([13, 10])
LF = bytes([10])


@pytest.fixture(scope="module")
def artifact(tmp_path_factory: pytest.TempPathFactory) -> tuple[bytes, dict]:
    """The page bytes and manifest, built once from the real site."""
    page, manifest = build_napplet.build(SITE, tmp_path_factory.mktemp("napplet"))
    return page.read_bytes(), manifest


def test_page_is_self_contained(artifact: tuple[bytes, dict]) -> None:
    """No script, stylesheet or relative asset is fetched at runtime."""
    html = artifact[0].decode("utf-8")

    # A tag, not the substring: engine.js mentions `<script src="engine.js">` in a comment.
    assert not re.search(r'<script src="[^"]*"[^>]*>\s*</script>', html)
    assert "<link rel=stylesheet" not in html
    assert '<link rel="stylesheet"' not in html
    assert 'url("../' not in html
    assert 'src="../' not in html
    # Every inlined block opens on its own line; schnorr.js says `<script>` mid-comment.
    assert len(re.findall(r"^<script>", html, re.MULTILINE)) == html.count("</script>")
    assert 'url("data:font/ttf;base64,' in html
    assert 'url("data:image/webp;base64,' in html


def test_page_carries_the_napplet_head(artifact: tuple[bytes, dict]) -> None:
    """The build marker and the requires meta sit in <head>."""
    html = artifact[0].decode("utf-8")
    source_sha = hashlib.sha256((SITE / "play.html").read_bytes()).hexdigest()

    assert f'window.E1_NAPPLET_BUILD = "{source_sha}";' in html
    assert (
        '<meta name="napplet-requires" content="identity,outbox,resource,storage,intent">' in html
    )


def test_page_leaves_the_website_only_scripts_out(artifact: tuple[bytes, dict]) -> None:
    """The wallet, QR, bug-report and NIP-07 pages stay on the website."""
    html = artifact[0].decode("utf-8")

    assert "esm.sh" not in html  # nutft-wallet.js imports it at runtime
    for name in ("nutft-wallet.js", "qr.js", "bugreport.js", "nostr-id.js", "fast-faces.js"):
        assert f'src="{name}"' not in html
    assert "E1Engine" in html
    assert "600B-logo-primary.png" not in html


def test_page_carries_the_3d_table(artifact: tuple[bytes, dict]) -> None:
    """three.js and the three arena scripts are inlined like every other script."""
    html = artifact[0].decode("utf-8")
    version = (SITE / "vendor" / "three.version").read_text(encoding="utf-8").strip()

    for name in ("vendor/three.js", "arena3d-layout.js", "arena3d.js", "arena3d-fx.js"):
        assert f'src="{name}"' not in html
    assert f"three.js r{version}" in html
    assert "var THREE=" in html
    assert "REVISION" in html
    for name in ("E1ArenaLayout", "E1Arena3D", "E1Arena3DFx"):
        assert name in html
    assert ".board.arena3d > canvas.arena3d { display: block; }" in html
    assert 'id="arenaTable"' in html


def test_page_stays_under_the_size_limit(artifact: tuple[bytes, dict]) -> None:
    """The host pins one file; three megabytes is the ceiling."""
    assert len(artifact[0]) < 3 * 1024 * 1024


def test_manifest_pins_the_page(artifact: tuple[bytes, dict]) -> None:
    """kind 35129, the d tag, one path tag with the file hash, the aggregate rule."""
    page, manifest = artifact
    tags = manifest["tags"]
    file_sha = hashlib.sha256(page).hexdigest()

    assert manifest["kind"] == 35129
    assert manifest["content"] == ""
    assert manifest["created_at"] == 0
    assert not {"pubkey", "id", "sig"} & manifest.keys()
    assert ["d", "600b-timelock-tcg"] in tags
    assert ["title", "TIMELOCK TCG"] in tags
    assert [tag for tag in tags if tag[0] == "path"] == [["path", "/index.html", file_sha]]
    aggregate = hashlib.sha256(f"{file_sha} /index.html\n".encode()).hexdigest()
    assert ["x", aggregate, "aggregate"] in tags
    assert manifest["aggregateHash"] == aggregate
    assert [tag[1] for tag in tags if tag[0] == "requires"] == [
        "identity",
        "outbox",
        "resource",
        "storage",
        "intent",
    ]
    assert not [tag for tag in tags if tag[0] == "archetype"]


def test_aggregate_sorts_the_path_lines() -> None:
    """The vite plugin sorts `<sha> <path>` lines before hashing; so do we."""
    pairs = [("b" * 64, "/z.js"), ("a" * 64, "/index.html")]
    expected = hashlib.sha256(f"{'a' * 64} /index.html\n{'b' * 64} /z.js\n".encode()).hexdigest()

    assert build_napplet.aggregate_hash(pairs) == expected


def test_inline_scripts_escape_the_closing_tag() -> None:
    """A `</script>` inside bundled code must not end the inline block early."""
    assert build_napplet.escape_inline_script('x = "</script>"') == 'x = "<\\/script>"'


def test_play_page_carries_the_embed_rules() -> None:
    """Under html.embedded the site chrome hides and no background layer is fixed."""
    play = (SITE / "play.html").read_text(encoding="utf-8")

    assert "html.embedded .navlinks { display: none; }" in play
    assert "html.embedded .stage::before { position: absolute; }" in play
    assert "html.embedded .stage::after { position: absolute; }" in play
    assert "html.embedded * { border-radius: 0; }" in play
    assert 'classList.add("embedded")' in play


def test_build_ignores_the_line_endings_git_chose(tmp_path: Path) -> None:
    """A CRLF checkout of play.html still gets the head marker and the meta tag."""
    site = tmp_path / "site"
    site.mkdir()
    for name in SITE.iterdir():
        if name.is_file():
            (site / name.name).write_bytes(name.read_bytes())
    # vendor/three.js is the one script that lives in a subdirectory.
    (site / "vendor").mkdir()
    for name in (SITE / "vendor").iterdir():
        if name.is_file():
            (site / "vendor" / name.name).write_bytes(name.read_bytes())
    lf = (SITE / "play.html").read_bytes().replace(CRLF, LF)
    (site / "play.html").write_bytes(lf.replace(LF, CRLF))
    for relative in ("art/fonts", "art/site"):
        (site.parent / relative).mkdir(parents=True, exist_ok=True)
        for asset in (REPO_ROOT / relative).iterdir():
            if asset.is_file():
                (site.parent / relative / asset.name).write_bytes(asset.read_bytes())
    page, _ = build_napplet.build(site, tmp_path / "out")
    html = page.read_bytes().decode("utf-8")
    assert '<meta name="napplet-requires"' in html
    assert CRLF.decode() not in html
