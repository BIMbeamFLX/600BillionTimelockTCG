"""The napplet build: one self-contained page and the manifest that pins it."""

import base64
import hashlib
import re
import shutil
import subprocess
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
    # The hero is not a CSS data URL any more: the stage reads it from --hero.
    assert 'url("data:image/webp;base64,' not in html
    assert "background-image: var(--hero, none);" in html


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

    scripts = ("vendor/three.js", "arena3d-layout.js", "arena3d.js")
    scripts += ("arena3d-fx.js", "arena3d-env.js")
    for name in scripts:
        assert f'src="{name}"' not in html
    assert f"three.js r{version}" in html
    assert "var THREE=" in html
    assert "REVISION" in html
    for name in ("E1ArenaLayout", "E1Arena3D", "E1Arena3DFx", "E1Arena3DEnv"):
        assert name in html
    # The hero ships once: window.E1_BACKDROP_URL feeds the cyclorama and, through the
    # inline script after napplet.js, the stage's --hero property.
    hero = (REPO_ROOT / "art" / "site" / "hero-play.webp").read_bytes()
    data_url = "data:image/webp;base64," + base64.b64encode(hero).decode("ascii")
    assert f'<script>window.E1_BACKDROP_URL = "{data_url}";</script>' in html
    assert html.count(data_url) == 1
    assert 'style.setProperty("--hero", "url(\\"" + window.E1_BACKDROP_URL' in html
    assert html.index("E1_BACKDROP_URL = ") < html.index('setProperty("--hero"')
    assert ".board.arena3d > canvas.arena3d { display: block; }" in html
    assert 'id="arenaTable"' in html


def test_page_stays_under_the_size_limit(artifact: tuple[bytes, dict]) -> None:
    """The host pins one file; three megabytes is the ceiling, 2.6 MB the working headroom."""
    assert len(artifact[0]) < 3 * 1024 * 1024
    assert len(artifact[0]) <= 2.6 * 1024 * 1024


def test_site_keeps_the_hero_file() -> None:
    """The website has no E1_BACKDROP_URL: its stage falls back to the file."""
    play = (SITE / "play.html").read_text(encoding="utf-8")

    assert 'background-image: var(--hero, url("../art/site/hero-play.webp"));' in play


def test_stripped_scripts_ship_in_the_artifact(artifact: tuple[bytes, dict]) -> None:
    """Inlined site scripts lose their comments; three.js ships as built."""
    html = artifact[0].decode("utf-8")

    assert "Golden bytes" not in html  # sanity: tests are never inlined
    assert "Loads in a browser via" not in html  # engine.js header comment
    assert "E1Engine" in html


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


# --- the comment stripper -------------------------------------------------------------

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node is not on PATH")
BS = "\\"  # one backslash, to keep the JS cases below readable


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("a = 1; // trailing stays\n", "a = 1; // trailing stays\n"),
        ("  // whole line\nb();\n", "b();\n"),
        ("/* block\n   on lines */\nc();\n", "c();\n"),
        ("x = a/**/b;\n", "x = a b;\n"),
        # A block comment holding a line break still ends the `return` line for ASI.
        ("return /* line\nbreak */ x;\n", "return \n x;\n"),
        ('s = "// not a comment /* nor this */";\n', 's = "// not a comment /* nor this */";\n'),
        # The escaped quote keeps the string open: that "comment" is string content.
        (f"s = '{BS}' /* c */' + 1;\n", f"s = '{BS}' /* c */' + 1;\n"),
        (f"s = '{BS}{BS}' /* c */ + 1;\n", f"s = '{BS}{BS}'   + 1;\n"),
        ("t = `// ${a /* c */ + `/* ${b} */`} //`;\n", "t = `// ${a   + `/* ${b} */`} //`;\n"),
        (f"r = /[/*]{BS}/{BS}//g.test(s); // keep\n", f"r = /[/*]{BS}/{BS}//g.test(s); // keep\n"),
        ("q = x / 2 / y; /* gone */\n", "q = x / 2 / y;  \n"),
        ("if (ok) return /'\"`/.test(s);\n", "if (ok) return /'\"`/.test(s);\n"),
        ("n = i++ / 2; m = (a) / 'b'.length;\n", "n = i++ / 2; m = (a) / 'b'.length;\n"),
        ("o = { a: 1 }.a / 2; // x\n", "o = { a: 1 }.a / 2; // x\n"),
        ("/*! licence */\nkeep();\n", "/*! licence */\nkeep();\n"),
    ],
)
def test_strip_js_comments_cases(source: str, expected: str) -> None:
    """Comments go; strings, templates, regex literals, division and line breaks stay."""
    assert build_napplet.strip_js_comments(source) == expected


def test_strip_js_comments_refuses_what_it_cannot_follow() -> None:
    """An unterminated literal or comment raises instead of guessing."""
    for broken in ("a = 'open\n", "t = `${", "/* never closed", "r = /abc\n"):
        with pytest.raises(build_napplet.StripError):
            build_napplet.strip_js_comments(broken)


@pytest.fixture(scope="module")
def stripped_site(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Every script the artifact strips, written under site/ as the artifact carries it."""
    root = tmp_path_factory.mktemp("stripped")
    html = (SITE / "play.html").read_text(encoding="utf-8")
    for name in build_napplet.inlined_script_names(html):
        if name in build_napplet.UNSTRIPPED_SCRIPTS:
            continue
        target = root / "site" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build_napplet.script_source(SITE, name), encoding="utf-8")
    return root


@needs_node
def test_stripped_scripts_still_parse(stripped_site: Path) -> None:
    """node --check accepts every stripped script, and every one of them got smaller."""
    scripts = sorted((stripped_site / "site").glob("*.js"))
    assert len(scripts) >= 15
    for script in scripts:
        result = subprocess.run([NODE, "--check", str(script)], capture_output=True, text=True)
        assert result.returncode == 0, f"{script.name}: {result.stderr}"
    for script in scripts:
        assert script.stat().st_size < (SITE / script.name).stat().st_size, script.name


@needs_node
def test_stripped_scripts_parse_to_the_same_program(stripped_site: Path) -> None:
    """esbuild re-prints the original and the stripped source to identical code."""
    if not (REPO_ROOT / "node_modules" / "esbuild").is_dir():
        pytest.skip("esbuild is not installed (npm install)")
    check = """
const { transformSync } = require("esbuild");
const fs = require("fs"), path = require("path");
const [site, stripped] = process.argv.slice(1);
const opts = { loader: "js", legalComments: "none", minifyWhitespace: true };
const bad = [];
for (const f of fs.readdirSync(stripped).filter((f) => f.endsWith(".js"))) {
  const a = transformSync(fs.readFileSync(path.join(site, f), "utf8"), opts).code;
  const b = transformSync(fs.readFileSync(path.join(stripped, f), "utf8"), opts).code;
  if (a !== b) bad.push(f);
}
console.log(JSON.stringify(bad));
"""
    result = subprocess.run(
        [NODE, "-e", check, str(SITE), str(stripped_site / "site")],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[]"


@needs_node
def test_stripped_engine_keeps_the_pinned_classic_hashes(stripped_site: Path) -> None:
    """tests/js/profile.test.mjs, run against the stripped engine and catalog, still passes."""
    js = stripped_site / "tests" / "js"
    js.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO_ROOT / "tests" / "js" / "profile.test.mjs", js / "profile.test.mjs")
    engine = (stripped_site / "site" / "engine.js").read_text(encoding="utf-8")
    assert "Loads in a browser via" not in engine  # the engine under test is the stripped one
    result = subprocess.run(
        [NODE, "--test", str(js / "profile.test.mjs")],
        capture_output=True,
        text=True,
        cwd=stripped_site,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert re.search(r"^\S* ?fail 0$", result.stdout, re.MULTILINE), result.stdout
    assert "hashes to its pinned bytes" in result.stdout
