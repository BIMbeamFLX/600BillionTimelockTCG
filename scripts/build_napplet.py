"""Build the single-file nappelin napplet from site/play.html.

Run with the repo venv active: `python scripts/build_napplet.py` (or `npm run build:napplet`).
Writes dist/napplet/600b-timelock-tcg/index.html and its .nip5a-manifest.json (kind 35129).
Every `<script src>` is inlined -- vendor/three.js and the arena3d-*.js scripts of the
3D table included (docs/arena3d.md; three.js carries no `</script` and no `<!--`, but
the escaping below covers them anyway) -- the Anton font and the hero image become data
URLs (the hero twice: the stage CSS and window.E1_BACKDROP_URL for the 3D cyclorama), the
wallet/QR/bug-report scripts are left out, card faces keep loading by hash.
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
REQUIRES = ("identity", "outbox", "resource", "storage", "intent")
MANIFEST_KIND = 35129
SIZE_LIMIT = 3 * 1024 * 1024

# Scripts the artifact leaves out: they need the website (esm.sh imports, the
# bug-report endpoint, the QR settlement screen, the NIP-07 identity page).
OMITTED_SCRIPTS = frozenset({"bugreport.js", "nutft-wallet.js", "qr.js", "nostr-id.js"})
# Assets that become data URLs, keyed by the exact url(...) text in play.html.
DATA_URL_ASSETS = {
    "../art/fonts/Anton-Regular.ttf": "font/ttf",
    "../art/site/hero-play.webp": "image/webp",
}
# The hero also reaches the 3D table's cyclorama as window.E1_BACKDROP_URL (site/arena3d-env.js).
BACKDROP = "../art/site/hero-play.webp"

SCRIPT_TAG = re.compile(r'<script src="([^"]+)"[^>]*>\s*</script>\n?')
LOGO_TAG = re.compile(r'[ \t]*<img src="\.\./art/brand/[^"]+"[^>]*>\n?')
PLATE_RULE = re.compile(r"^\.stage\.plate-\w+::before \{[^\n]*\n", re.MULTILINE)
# Text that must not survive the build; the script tag is a regex because
# engine.js mentions `<script src="engine.js">` in a comment.
LEFTOVERS = ("<link rel=stylesheet", '<link rel="stylesheet"', 'url("../', 'src="../')


def sha256_hex(data: bytes) -> str:
    """Hex SHA-256 of the bytes."""
    return hashlib.sha256(data).hexdigest()


def escape_inline_script(code: str) -> str:
    """Make JS safe inside an HTML <script> block."""
    return code.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def inline_scripts(html: str, site: Path) -> str:
    """Replace every <script src> with the file's code, or drop it when omitted."""

    def replace(match: re.Match[str]) -> str:
        name = Path(match.group(1)).name
        if name in OMITTED_SCRIPTS:
            return ""
        code = (site / match.group(1)).read_text(encoding="utf-8")
        return f"<script>\n{escape_inline_script(code)}\n</script>\n"

    return SCRIPT_TAG.sub(replace, html)


def inline_assets(html: str, site: Path) -> str:
    """Turn the font and hero url(...) references into data URLs."""
    for relative, mime in DATA_URL_ASSETS.items():
        data = base64.b64encode((site / relative).read_bytes()).decode("ascii")
        html = html.replace(f'url("{relative}")', f'url("data:{mime};base64,{data}")')
    return html


def strip_site_only(html: str) -> str:
    """Drop the masthead logo and the affinity plate backgrounds (site files, not bundled)."""
    return PLATE_RULE.sub("", LOGO_TAG.sub("", html))


def backdrop_data_url(site: Path) -> str:
    """The hero image as a data URL, the same bytes the stage CSS inlines."""
    data = base64.b64encode((site / BACKDROP).read_bytes()).decode("ascii")
    return f"data:{DATA_URL_ASSETS[BACKDROP]};base64,{data}"


def add_head(html: str, source_sha: str, backdrop: str = "") -> str:
    """Insert the build marker, the backdrop URL and the requires meta at the top of <head>."""
    head = (
        f'<script>window.E1_NAPPLET_BUILD = "{source_sha}";</script>\n'
        + (f'<script>window.E1_BACKDROP_URL = "{backdrop}";</script>\n' if backdrop else "")
        + f'<meta name="napplet-requires" content="{",".join(REQUIRES)}">\n'
    )
    if "<head>\n" not in html:
        raise SystemExit("play.html has no <head> line to extend")
    return html.replace("<head>\n", "<head>\n" + head, 1)


def build_html(site: Path) -> str:
    """The self-contained page built from site/play.html."""
    source = (site / "play.html").read_bytes()
    # Git hands this file over with CRLF on Windows; the build must not care.
    html = source.decode("utf-8").replace("\r\n", "\n")
    html = add_head(html, sha256_hex(source), backdrop_data_url(site))
    html = strip_site_only(html)
    html = inline_assets(html, site)
    html = inline_scripts(html, site)
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


def build(site: Path, out_dir: Path) -> tuple[Path, dict]:
    """Write index.html and .nip5a-manifest.json into out_dir; return the page path and manifest."""
    out_dir.mkdir(parents=True, exist_ok=True)
    index = build_html(site).encode("utf-8")
    page = out_dir / "index.html"
    page.write_bytes(index)
    manifest = build_manifest(index)
    (out_dir / ".nip5a-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return page, manifest


def main(argv: list[str] | None = None) -> int:
    """CLI: build, print the size, fail over the size limit."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="output directory")
    args = parser.parse_args(argv)
    page, manifest = build(SITE, args.out)
    size = page.stat().st_size
    print(f"{page} — {size:,} bytes ({size / (1024 * 1024):.2f} MB)")
    print(f"sha256 {manifest['tags'][3][2]}  aggregate {manifest['aggregateHash']}")
    if size > SIZE_LIMIT:
        print(f"build_napplet: artifact exceeds {SIZE_LIMIT:,} bytes", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
