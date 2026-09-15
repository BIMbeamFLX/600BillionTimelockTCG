"""The napplet build: one self-contained page and the manifest that pins it."""

import base64
import hashlib
import json
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
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node is not on PATH")


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
    assert "url('../" not in html
    assert "url(../" not in html
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
    # The marker hashes the LF text, as the build does: a Windows checkout hands over CRLF.
    source_sha = hashlib.sha256((SITE / "play.html").read_bytes().replace(CRLF, LF)).hexdigest()

    assert f'window.E1_NAPPLET_BUILD = "{source_sha}";' in html
    requires = "identity,outbox,resource,storage,intent,link"
    assert f'<meta name="napplet-requires" content="{requires}">' in html


def test_page_names_the_referee_before_net_js_runs(artifact: tuple[bytes, dict]) -> None:
    """A srcdoc frame has no origin to derive a referee from: the build names nappelin's."""
    html = artifact[0].decode("utf-8")
    marker = '<script>window.E1_TABLE_URL = "wss://tcg.nappelin.com/ws";</script>'

    assert build_napplet.TABLE_URL == "wss://tcg.nappelin.com/ws"
    assert html.count(marker) == 1
    assert html.index(marker) < html.index("</head>")
    assert html.index(marker) < html.index("globalThis.E1Net = {"), "set before net.js runs"
    assert "globalThis.E1_TABLE_URL" in html, "and net.js still reads it"


def test_page_leaves_the_website_only_scripts_out(artifact: tuple[bytes, dict]) -> None:
    """The wallet, QR, bug-report and NIP-07 pages stay on the website."""
    html = artifact[0].decode("utf-8")

    assert "esm.sh" not in html  # nutft-wallet.js imports it at runtime
    for name in ("nutft-wallet.js", "qr.js", "bugreport.js", "nostr-id.js", "fast-faces.js"):
        assert f'src="{name}"' not in html
    assert 'src="rail.js"' not in html
    assert "E1Engine" in html
    assert "600B-logo-primary.png" not in html


def test_the_side_bar_stays_out_of_the_napplet(tmp_path: Path) -> None:
    """Inside the Hangar the shell draws the bar; rail.js is dropped, not inlined or fetched."""
    page = '<script src="napplet.js"></script>\n<script src="rail.js"></script>\n'
    (tmp_path / "napplet.js").write_text("window.N = 1;\n", encoding="utf-8")

    assert "rail.js" in build_napplet.OMITTED_SCRIPTS
    assert build_napplet.inline_scripts(page, tmp_path) == "<script>\nwindow.N = 1;\n\n</script>\n"
    assert build_napplet.inlined_script_names(page) == ["napplet.js"]


HYPERSHELL_FACES = {
    "../art/fonts/josefin-sans-var.woff2": "font/woff2",
    "../art/fonts/plex-mono-400.woff2": "font/woff2",
    "../art/fonts/plex-mono-500.woff2": "font/woff2",
    "../art/fonts/plex-mono-600.woff2": "font/woff2",
    "../art/fonts/Anton-Regular.ttf": "font/ttf",
}


def test_play_names_the_hypershell_faces() -> None:
    """The table's own @font-face rules name both Hypershell families and Anton."""
    play = (SITE / "play.html").read_text(encoding="utf-8")
    missing = HYPERSHELL_FACES.items() - build_napplet.data_url_assets(play).items()

    assert not missing, f"play.html names no url() for {sorted(missing)}"


def test_every_font_play_names_ships_as_a_data_url(artifact: tuple[bytes, dict]) -> None:
    """Each font travels inside the page, byte for byte its file, under its MIME type."""
    html = artifact[0].decode("utf-8")
    play = (SITE / "play.html").read_text(encoding="utf-8")
    fonts = build_napplet.data_url_assets(play)

    assert fonts
    for relative, mime in fonts.items():
        data = base64.b64encode((SITE / relative).read_bytes()).decode("ascii")
        assert f'url("data:{mime};base64,{data}")' in html, relative


def test_font_urls_are_found_however_they_are_quoted(tmp_path: Path) -> None:
    """Double, single or no quotes: the font is inlined; an unknown kind stops the build."""
    site = tmp_path / "site"
    fonts = tmp_path / "art" / "fonts"
    site.mkdir()
    fonts.mkdir(parents=True)
    (fonts / "a.woff2").write_bytes(b"woff2 bytes")
    (fonts / "b.ttf").write_bytes(b"ttf bytes")
    page = (
        '@font-face { src: url("../art/fonts/a.woff2") format("woff2"); }\n'
        "@font-face { src: url('../art/fonts/b.ttf'); }\n"
        "@font-face { src: url(../art/fonts/a.woff2); }\n"
    )

    assert build_napplet.data_url_assets(page) == {
        "../art/fonts/a.woff2": "font/woff2",
        "../art/fonts/b.ttf": "font/ttf",
    }
    inlined = build_napplet.inline_assets(page, site)
    woff2 = base64.b64encode(b"woff2 bytes").decode("ascii")
    assert inlined.count(f'url("data:font/woff2;base64,{woff2}")') == 2
    assert 'url("data:font/ttf;base64,' in inlined
    assert "../art/fonts/" not in inlined
    with pytest.raises(SystemExit, match="no font MIME type"):
        build_napplet.data_url_assets('src: url("../art/fonts/c.eot")')


def test_style_comments_go_and_strings_stay(tmp_path: Path) -> None:
    """A comment quoting url("../art/fonts/…") is prose, not a font; a quoted /* is content."""
    page = (
        "<head>\n<style>\n"
        '/* build_napplet.py inlines every url("../art/fonts/…") */\n'
        '.a { content: "/* kept */"; } /* gone */\n'
        "\n"
        "  /* a whole line\n     across two */\n"
        ".b { background: url('data:image/svg+xml;utf8,<svg a=\"//x\"/>'); }\n"
        "</style>\n</head>\n<script>/* script comments are not CSS */</script>\n"
    )

    stripped = build_napplet.strip_style_comments(page)
    assert stripped == (
        "<head>\n<style>\n"
        '.a { content: "/* kept */"; }\n'
        ".b { background: url('data:image/svg+xml;utf8,<svg a=\"//x\"/>'); }\n"
        "</style>\n</head>\n<script>/* script comments are not CSS */</script>\n"
    )
    assert build_napplet.data_url_assets(page) == {}
    assert build_napplet.inline_assets(page, tmp_path) == stripped


def test_html_comments_go_and_scripts_stay() -> None:
    """Markup comments go, and whole lines with them; `<!--` inside a script or a style stays."""
    page = (
        "<head>\n"
        "  <!-- a note\n       on two lines -->\n"
        '<script>var s = "<!-- kept -->";</script>\n'
        "<style>.a { content: '<!-- kept -->'; }</style>\n"
        "</head>\n<body>\n"
        "<p>one <!-- inline --> two</p>\n"
        "<!-- a --> <b>kept</b> <!-- c -->\n"
        "  <!-- b -->\n"
        "</body>\n"
    )

    assert build_napplet.strip_html_comments(page) == (
        "<head>\n"
        '<script>var s = "<!-- kept -->";</script>\n'
        "<style>.a { content: '<!-- kept -->'; }</style>\n"
        "</head>\n<body>\n"
        "<p>one  two</p>\n"
        " <b>kept</b> \n"
        "</body>\n"
    )


def test_the_page_ships_without_html_comments(artifact: tuple[bytes, dict]) -> None:
    """Every `<!--` left in the artifact would be inside a script, and those are escaped."""
    html = artifact[0].decode("utf-8")

    assert "<!--" not in html
    assert "<!--" in (SITE / "play.html").read_text(encoding="utf-8"), "the source keeps them"


@needs_node
def test_stripped_style_is_the_same_stylesheet() -> None:
    """esbuild minifies play.html's <style> before and after stripping to identical CSS."""
    if not (REPO_ROOT / "node_modules" / "esbuild").is_dir():
        pytest.skip("esbuild is not installed (npm install)")
    play = (SITE / "play.html").read_text(encoding="utf-8").replace("\r\n", "\n")
    style = re.compile(r"<style[^>]*>(.*?)</style>", re.S)
    before = "".join(style.findall(play))
    after = "".join(style.findall(build_napplet.strip_style_comments(play)))
    check = """
const { transformSync } = require("esbuild");
const [a, b] = JSON.parse(require("fs").readFileSync(0, "utf8"));
const min = (css) => transformSync(css, { loader: "css", minify: true }).code;
console.log(min(a) === min(b) ? "same" : "different");
"""
    result = subprocess.run(
        [NODE, "-e", check],
        input=json.dumps([before, after]),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=REPO_ROOT,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "same"
    assert len(after) < len(before) - 10_000, "the comments are most of what the CSS sheds"


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
    """The host pins one file; three MiB is the ceiling, 2.6 MiB the working headroom."""
    assert build_napplet.SIZE_LIMIT == 3 * 1024 * 1024
    assert len(artifact[0]) < build_napplet.SIZE_LIMIT
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
        "link",
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


def _copy_site(root: Path, play_html: bytes, newline: bytes) -> Path:
    """A copy of the site and the assets the build reads: play.html as given, and every
    script it inlines rewritten with `newline` line endings."""
    site = root / "site"
    site.mkdir(parents=True)
    for name in SITE.iterdir():
        if name.is_file():
            (site / name.name).write_bytes(name.read_bytes())
    # vendor/three.js is the one script that lives in a subdirectory.
    (site / "vendor").mkdir()
    for name in (SITE / "vendor").iterdir():
        if name.is_file():
            (site / "vendor" / name.name).write_bytes(name.read_bytes())
    (site / "play.html").write_bytes(play_html)
    for name in build_napplet.inlined_script_names(play_html.decode("utf-8")):
        code = (SITE / name).read_bytes().replace(CRLF, LF)
        (site / name).write_bytes(code.replace(LF, newline))
    for relative in ("art/fonts", "art/site"):
        (site.parent / relative).mkdir(parents=True, exist_ok=True)
        for asset in (REPO_ROOT / relative).iterdir():
            if asset.is_file():
                (site.parent / relative / asset.name).write_bytes(asset.read_bytes())
    return site


def test_build_ignores_the_line_endings_git_chose(tmp_path: Path) -> None:
    """A CRLF and an LF checkout of one commit build byte-identical artifacts.

    The Hangar pins the artifact's sha256, and its owner builds from a Linux clone while
    this repo is often checked out on Windows: a build marker hashed from the raw bytes
    made the two differ.
    """
    lf = (SITE / "play.html").read_bytes().replace(CRLF, LF)
    crlf_site = _copy_site(tmp_path / "crlf", lf.replace(LF, CRLF), CRLF)
    scripts = build_napplet.inlined_script_names(lf.decode("utf-8"))
    assert len(scripts) >= 15
    assert all(CRLF in (crlf_site / name).read_bytes() for name in scripts), "scripts are CRLF"
    crlf_page, crlf_manifest = build_napplet.build(crlf_site, tmp_path / "crlf-out")
    lf_site = _copy_site(tmp_path / "lf", lf, LF)
    assert not any(CRLF in (lf_site / name).read_bytes() for name in scripts), "scripts are LF"
    lf_page, lf_manifest = build_napplet.build(lf_site, tmp_path / "lf-out")
    html = crlf_page.read_bytes().decode("utf-8")
    assert '<meta name="napplet-requires"' in html
    assert CRLF.decode() not in html
    assert crlf_page.read_bytes() == lf_page.read_bytes()
    assert crlf_manifest == lf_manifest


# --- the comment stripper -------------------------------------------------------------

BS = "\\"  # one backslash, to keep the JS cases below readable


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("a = 1; // trailing goes too\n", "a = 1;\n"),
        ("a = 1; /* c */ // and this\nb();\n", "a = 1;  \nb();\n"),
        ("return x // ASI keeps its line break\n+ y;\n", "return x\n+ y;\n"),
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
        (f"r = /[/*]{BS}/{BS}//g.test(s); // gone\n", f"r = /[/*]{BS}/{BS}//g.test(s);\n"),
        ("q = x / 2 / y; /* gone */\n", "q = x / 2 / y;  \n"),
        ("if (ok) return /'\"`/.test(s);\n", "if (ok) return /'\"`/.test(s);\n"),
        ("n = i++ / 2; m = (a) / 'b'.length;\n", "n = i++ / 2; m = (a) / 'b'.length;\n"),
        ("o = { a: 1 }.a / 2; // x\n", "o = { a: 1 }.a / 2;\n"),
        ('u = "https://x"; // a URL in a string is not a comment\n', 'u = "https://x";\n'),
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
        # Bytes, as the artifact carries them: write_text would add CRLF on Windows.
        target.write_bytes(build_napplet.script_source(SITE, name).encode("utf-8"))
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
        # Against the LF source, so neither checkout's line endings decide it.
        source = (SITE / script.name).read_bytes().replace(CRLF, LF)
        assert script.stat().st_size < len(source), script.name


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
