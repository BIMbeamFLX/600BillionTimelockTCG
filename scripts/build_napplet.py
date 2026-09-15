"""Build the single-file nappelin napplet from site/play.html.

Run with the repo venv active: `python scripts/build_napplet.py` (or `npm run build:napplet`).
Writes dist/napplet/600b-timelock-tcg/index.html and its .nip5a-manifest.json (kind 35129).
Every `<script src>` is inlined -- vendor/three.js and the arena3d-*.js scripts of the
3D table included (docs/arena3d.md; three.js carries no `</script` and no `<!--`, but
the escaping below covers them anyway) -- with its comments stripped (not three.js,
which ships minified), as the page's CSS and markup ship without theirs. Every font
play.html's @font-face names under ../art/fonts/ (the
Hypershell faces and Anton, docs/brand-hypershell.md) becomes a data URL; the hero image
ships once, as window.E1_BACKDROP_URL, which play.html copies into the stage's `--hero`
property and the 3D cyclorama reads directly. The wallet/QR/bug-report scripts and the
side bar are left out, card faces keep loading by hash. `--report` prints the bytes each
inlined piece costs.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE = REPO_ROOT / "site"
OUT_DIR = REPO_ROOT / "dist" / "napplet" / "600b-timelock-tcg"

NAPPLET_ID = "600b-timelock-tcg"
TITLE = "TIMELOCK TCG"
DESCRIPTION = "Two-player card game on one screen, or against the built-in opponent. All 295 cards."
# `link` is the NAP-LINK door: the one fixed shop URL the empty collection opens (site/play.js).
REQUIRES = ("identity", "outbox", "resource", "storage", "intent", "link")
# The referee the napplet dials. A srcdoc frame has no origin to derive one from, so
# site/net.js tableUrl() reads window.E1_TABLE_URL, set in <head> before net.js runs.
TABLE_URL = "wss://tcg.nappelin.com/ws"
MANIFEST_KIND = 35129
SIZE_LIMIT = 3 * 1024 * 1024

# Scripts the artifact leaves out: they need the website (esm.sh imports, the
# bug-report endpoint, the QR settlement screen, the NIP-07 identity page) -- or, for
# rail.js, the Hangar already draws the side bar and the napplet must not draw a second.
OMITTED_SCRIPTS = frozenset({"bugreport.js", "nutft-wallet.js", "qr.js", "nostr-id.js", "rail.js"})
# Inlined verbatim: already minified, and its licence header must survive.
UNSTRIPPED_SCRIPTS = frozenset({"vendor/three.js"})
# Fonts become data URLs: whatever play.html names under ../art/fonts/, quoted or not.
# The MIME type follows the extension; one not listed here stops the build.
FONT_URL = re.compile(r"""url\((["']?)(\.\./art/fonts/[^"')\s]+)\1\)""")
FONT_MIME = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf"}
# The page's CSS ships without its comments, as the scripts do: they are a fifth of
# play.html's <style>, and a comment that quotes a url("../…") is not a reference.
# A quoted string is matched first and kept, so a `/*` inside one survives.
STYLE_BLOCK = re.compile(r"(<style[^>]*>)(.*?)(</style>)", re.S)
CSS_STRING_OR_COMMENT = re.compile(r"""("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|/\*.*?\*/""", re.S)
TRAILING_SPACE = re.compile(r"[ \t]+$", re.M)
BLANK_LINE = re.compile(r"(?<=\n)\n")
# The markup's comments go the same way: prose for the people reading play.html. A script
# or style block is left to its own stripper, and a comment alone on its lines takes them.
RAW_TEXT = re.compile(r"(<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>)", re.S)
HTML_COMMENT_LINE = re.compile(r"^[ \t]*<!--(?:(?!-->).)*-->[ \t]*\n", re.S | re.M)
HTML_COMMENT = re.compile(r"<!--(?:(?!-->).)*-->", re.S)
# The hero reaches the stage (`--hero`) and the 3D cyclorama (site/arena3d-env.js) as
# window.E1_BACKDROP_URL; the website's CSS fallback to the file becomes `none` here.
BACKDROP = "../art/site/hero-play.webp"
BACKDROP_MIME = "image/webp"
HERO_FALLBACK = f'var(--hero, url("{BACKDROP}"))'

SCRIPT_TAG = re.compile(r'<script src="([^"]+)"[^>]*>\s*</script>\n?')
LOGO_TAG = re.compile(r'[ \t]*<img src="\.\./art/brand/[^"]+"[^>]*>\n?')
PLATE_RULE = re.compile(r"^\.stage\.plate-\w+::before \{[^\n]*\n", re.MULTILINE)
# Text that must not survive the build; the script tag is a regex because
# engine.js mentions `<script src="engine.js">` in a comment.
LEFTOVERS = (
    "<link rel=stylesheet",
    '<link rel="stylesheet"',
    'url("../',
    "url('../",
    "url(../",
    'src="../',
)

# --- the comment stripper -----------------------------------------------------------
# A tokenizer, not a regex replace: it walks strings, template literals (with `${}`
# nesting) and regex literals, so a `//` or `/*` inside one is never touched. It removes
# block comments and `//` comments, whole-line or trailing; `/*!` and `@license` blocks
# stay. Anything it cannot follow raises StripError rather than guessing.
WORD = re.compile(r"[A-Za-z0-9_$\u0080-\uffff]+")
SPACE = re.compile(r"[ \t\r\n\f\v]+")
# After one of these words a `/` opens a regex literal; after any other word it divides.
REGEX_AFTER_WORDS = frozenset(
    {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case"}
    | {"do", "else", "yield", "await"}
)


class StripError(ValueError):
    """The tokenizer met input it cannot follow."""


def _scan_quoted(code: str, i: int) -> int:
    """Index just past the '...' or "..." string that opens at i."""
    quote, j, n = code[i], i + 1, len(code)
    while j < n:
        ch = code[j]
        if ch == "\\":
            j += 2
        elif ch == quote:
            return j + 1
        elif ch == "\n":
            break
        else:
            j += 1
    raise StripError(f"unterminated string at offset {i}")


def _scan_template(code: str, j: int) -> tuple[int, bool]:
    """From inside a template at j: (index past the closing backtick or `${`, opened_expr)."""
    n = len(code)
    while j < n:
        ch = code[j]
        if ch == "\\":
            j += 2
        elif ch == "`":
            return j + 1, False
        elif ch == "$" and code.startswith("{", j + 1):
            return j + 2, True
        else:
            j += 1
    raise StripError("unterminated template literal")


def _scan_regex(code: str, i: int) -> int:
    """Index just past the closing `/` of the regex literal that opens at i."""
    j, n, in_class = i + 1, len(code), False
    while j < n:
        ch = code[j]
        if ch == "\\":
            j += 2
            continue
        if ch == "\n":
            break
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            return j + 1
        j += 1
    raise StripError(f"unterminated regex literal at offset {i}")


def _regex_allowed(code: str, prev: str, prev_at: int) -> bool:
    """Whether a `/` after the previous significant token opens a regex literal."""
    if not prev:
        return True
    if prev == "word":
        word = WORD.match(code, prev_at)
        after_dot = code[:prev_at].rstrip().endswith(".")
        return bool(word) and word.group() in REGEX_AFTER_WORDS and not after_dot
    if prev == "value" or prev in ")]}":
        return False
    if prev in "+-" and prev_at > 0 and code[prev_at - 1] == prev:
        return False  # x++ / y
    return True


def strip_js_comments(code: str) -> str:
    """The code without its block and `//` comments; literals and line breaks untouched."""
    cuts: list[tuple[int, int, str]] = []  # (start, end, replacement) on the original
    braces: list[bool] = []  # True where the matching `}` closes a template `${`
    prev, prev_at = "", 0  # last significant token: "", "word", "value" or a punctuator
    i, n = 0, len(code)
    while i < n:
        ch = code[i]
        space = SPACE.match(code, i)
        if space:
            i = space.end()
            continue
        word = WORD.match(code, i)
        if word:
            prev, prev_at, i = "word", i, word.end()
            continue
        if ch in "'\"":
            prev, prev_at, i = "value", i, _scan_quoted(code, i)
            continue
        if ch == "`" or (ch == "}" and braces and braces[-1]):
            if ch == "}":
                braces.pop()
            i, opened = _scan_template(code, i + 1)
            if opened:
                braces.append(True)
                prev, prev_at = "{", i - 1
            else:
                prev, prev_at = "value", i - 1
            continue
        if ch == "/" and code.startswith("*", i + 1):
            end = code.find("*/", i + 2)
            if end < 0:
                raise StripError(f"unterminated block comment at offset {i}")
            end += 2
            body = code[i:end]
            if not (body.startswith("/*!") or "@license" in body):
                line_start = code.rfind("\n", 0, i) + 1
                line_end = code.find("\n", end)
                line_end = n if line_end < 0 else line_end
                if not code[line_start:i].strip() and not code[end:line_end].strip():
                    cuts.append((line_start, min(line_end + 1, n), ""))
                else:
                    # A comment holding a line break is a line break to ASI.
                    cuts.append((i, end, "\n" if "\n" in body else " "))
            i = end
            continue
        if ch == "/" and code.startswith("/", i + 1):
            line_start = code.rfind("\n", 0, i) + 1
            line_end = code.find("\n", i)
            line_end = n if line_end < 0 else line_end
            if not code[line_start:i].strip():
                cuts.append((line_start, min(line_end + 1, n), ""))
            else:
                # One that trails code goes with the spaces before it; the line break stays.
                start = i
                while start > line_start and code[start - 1] in " \t":
                    start -= 1
                cuts.append((start, line_end, ""))
            i = line_end
            continue
        if ch == "/" and _regex_allowed(code, prev, prev_at):
            prev, prev_at, i = "value", i, _scan_regex(code, i)
            continue
        if ch == "{":
            braces.append(False)
        elif ch == "}" and braces:
            braces.pop()
        prev, prev_at, i = ch, i, i + 1
    if any(braces):
        raise StripError("template expression left open")
    parts, at = [], 0
    for start, end, replacement in cuts:
        if start < at:  # already inside a removed line
            continue
        parts.append(code[at:start])
        parts.append(replacement)
        at = end
    parts.append(code[at:])
    return "".join(parts)


# --- the page ------------------------------------------------------------------------


def sha256_hex(data: bytes) -> str:
    """Hex SHA-256 of the bytes."""
    return hashlib.sha256(data).hexdigest()


def escape_inline_script(code: str) -> str:
    """Make JS safe inside an HTML <script> block."""
    return code.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def inlined_script_names(html: str) -> list[str]:
    """The site-relative `src` of every script the artifact inlines, in page order."""
    names = [match.group(1) for match in SCRIPT_TAG.finditer(html)]
    return [name for name in names if Path(name).name not in OMITTED_SCRIPTS]


def script_source(site: Path, name: str) -> str:
    """One inlined script as the artifact carries it: comments stripped unless exempt."""
    code = (site / name).read_text(encoding="utf-8")
    return code if name in UNSTRIPPED_SCRIPTS else strip_js_comments(code)


def inline_scripts(html: str, site: Path, sizes: dict[str, tuple[int, int]] | None = None) -> str:
    """Replace every <script src> with the file's code, or drop it when omitted."""

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if Path(name).name in OMITTED_SCRIPTS:
            return ""
        code = script_source(site, name)
        if sizes is not None:
            sizes[name] = ((site / name).stat().st_size, len(code.encode("utf-8")))
        return f"<script>\n{escape_inline_script(code)}\n</script>\n"

    return SCRIPT_TAG.sub(replace, html)


def strip_style_comments(html: str) -> str:
    """Every <style> block without its comments or the blank lines they leave; strings kept."""

    def strip(match: re.Match[str]) -> str:
        css = CSS_STRING_OR_COMMENT.sub(lambda m: m.group(1) or " ", match.group(2))
        css = BLANK_LINE.sub("", TRAILING_SPACE.sub("", css))
        return match.group(1) + css + match.group(3)

    return STYLE_BLOCK.sub(strip, html)


def data_url_assets(html: str) -> dict[str, str]:
    """Every ../art/fonts/ file the page's CSS names in a url(), in page order, with its MIME."""
    assets: dict[str, str] = {}
    for match in FONT_URL.finditer(strip_style_comments(html)):
        relative = match.group(2)
        mime = FONT_MIME.get(Path(relative).suffix.lower())
        if mime is None:
            raise SystemExit(f"build_napplet: no font MIME type for {relative}")
        assets[relative] = mime
    return assets


def inline_assets(html: str, site: Path) -> str:
    """Drop CSS comments, turn every font url(...) into a data URL, drop the hero's file."""
    html = strip_style_comments(html)
    assets = data_url_assets(html)
    encoded = {
        relative: base64.b64encode((site / relative).read_bytes()).decode("ascii")
        for relative in assets
    }

    def replace(match: re.Match[str]) -> str:
        relative = match.group(2)
        return f'url("data:{assets[relative]};base64,{encoded[relative]}")'

    return FONT_URL.sub(replace, html).replace(HERO_FALLBACK, "var(--hero, none)")


def strip_html_comments(html: str) -> str:
    """The page without its HTML comments; script and style blocks untouched."""
    parts = RAW_TEXT.split(html)
    for index in range(0, len(parts), 2):
        parts[index] = HTML_COMMENT.sub("", HTML_COMMENT_LINE.sub("", parts[index]))
    return "".join(parts)


def strip_site_only(html: str) -> str:
    """Drop the masthead logo and the affinity plate backgrounds (site files, not bundled)."""
    return PLATE_RULE.sub("", LOGO_TAG.sub("", html))


def backdrop_data_url(site: Path) -> str:
    """The hero image as a data URL: the only copy the artifact carries."""
    data = base64.b64encode((site / BACKDROP).read_bytes()).decode("ascii")
    return f"data:{BACKDROP_MIME};base64,{data}"


def add_head(html: str, source_sha: str, backdrop: str = "") -> str:
    """Insert the build marker, the referee, the backdrop URL and the requires meta into <head>."""
    head = (
        f'<script>window.E1_NAPPLET_BUILD = "{source_sha}";</script>\n'
        + f'<script>window.E1_TABLE_URL = "{TABLE_URL}";</script>\n'
        + (f'<script>window.E1_BACKDROP_URL = "{backdrop}";</script>\n' if backdrop else "")
        + f'<meta name="napplet-requires" content="{",".join(REQUIRES)}">\n'
    )
    if "<head>\n" not in html:
        raise SystemExit("play.html has no <head> line to extend")
    return html.replace("<head>\n", "<head>\n" + head, 1)


def build_html(site: Path, sizes: dict[str, tuple[int, int]] | None = None) -> str:
    """The self-contained page built from site/play.html."""
    source = (site / "play.html").read_bytes()
    # Git hands this file over with CRLF on Windows; the build must not care.
    html = source.decode("utf-8").replace("\r\n", "\n")
    if HERO_FALLBACK not in html:
        raise SystemExit(f"build_napplet: play.html lost its hero rule {HERO_FALLBACK}")
    # Hash the LF text, not the checkout's bytes: Git hands Windows a CRLF copy, and a
    # marker taken before normalising made one commit build two different artifacts.
    html = add_head(html, sha256_hex(html.encode("utf-8")), backdrop_data_url(site))
    html = strip_html_comments(strip_site_only(html))
    html = inline_assets(html, site)
    html = inline_scripts(html, site, sizes)
    leftover = next((marker for marker in LEFTOVERS if marker in html), None)
    if SCRIPT_TAG.search(html):
        leftover = "<script src="
    if leftover:
        raise SystemExit(f"build_napplet: external reference left in artifact: {leftover}")
    return html


def aggregate_hash(pairs: list[tuple[str, str]]) -> str:
    """The manifest `x` aggregate: sha256 over the sorted `<sha> <path>\\n` lines."""
    lines = sorted(f"{digest} {path}\n" for digest, path in pairs)
    return sha256_hex("".join(lines).encode("utf-8"))


def build_manifest(index: bytes) -> dict:
    """The unsigned kind-35129 manifest template for one index.html."""
    pairs = [(sha256_hex(index), "/index.html")]
    aggregate = aggregate_hash(pairs)
    tags = [
        ["d", NAPPLET_ID],
        ["title", TITLE],
        ["description", DESCRIPTION],
        *[["path", path, digest] for digest, path in pairs],
        ["x", aggregate, "aggregate"],
        *[["requires", domain] for domain in REQUIRES],
    ]
    return {
        "kind": MANIFEST_KIND,
        "created_at": 0,
        "tags": tags,
        "content": "",
        "aggregateHash": aggregate,
    }


def build(
    site: Path, out_dir: Path, sizes: dict[str, tuple[int, int]] | None = None
) -> tuple[Path, dict]:
    """Write index.html and .nip5a-manifest.json into out_dir; return the page and manifest."""
    out_dir.mkdir(parents=True, exist_ok=True)
    index = build_html(site, sizes).encode("utf-8")
    page = out_dir / "index.html"
    page.write_bytes(index)
    manifest = build_manifest(index)
    (out_dir / ".nip5a-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return page, manifest


def report_lines(site: Path, sizes: dict[str, tuple[int, int]], total: int) -> list[str]:
    """The per-piece byte table: every inlined script (source, shipped) and the data URLs."""
    rows = [(name, source, shipped) for name, (source, shipped) in sizes.items()]
    fonts = data_url_assets((site / "play.html").read_text(encoding="utf-8"))
    for relative in (*fonts, BACKDROP):
        raw = (site / relative).stat().st_size
        rows.append((Path(relative).name + " (base64)", raw, 4 * ((raw + 2) // 3)))
    rows.sort(key=lambda row: -row[2])
    lines = [f"{'piece':<28}{'source':>12}{'shipped':>12}{'saved':>10}"]
    for name, source, shipped in rows:
        lines.append(f"{name:<28}{source:>12,}{shipped:>12,}{source - shipped:>10,}")
    rest = total - sum(row[2] for row in rows)
    lines.append(f"{'html, css, wrappers':<28}{'':>12}{rest:>12,}")
    lines.append(f"{'total':<28}{'':>12}{total:>12,}")
    return lines


def main(argv: list[str] | None = None) -> int:
    """CLI: build, print the size, fail over the size limit."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="output directory")
    parser.add_argument("--report", action="store_true", help="print the per-script byte table")
    args = parser.parse_args(argv)
    sizes: dict[str, tuple[int, int]] = {}
    page, manifest = build(SITE, args.out, sizes)
    size = page.stat().st_size
    if args.report:
        print("\n".join(report_lines(SITE, sizes, size)))
    print(f"{page} -- {size:,} bytes ({size / (1024 * 1024):.2f} MB)")
    print(f"sha256 {manifest['tags'][3][2]}  aggregate {manifest['aggregateHash']}")
    if size > SIZE_LIMIT:
        print(f"build_napplet: artifact exceeds {SIZE_LIMIT:,} bytes", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
