"""Static guards for the brand split: Hypershell chrome, 600 Billion game world.

docs/brand-hypershell.md is the rule. site/600b.css is held to it strictly; every page's
own CSS is checked too, strictly, with one named exemption: a card's ground shadow.
"""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE = REPO_ROOT / "site"

# The contract's token block (2026-09-14), value for value.
CORE_TOKENS = {
    "--iron": "#0f0c08",
    "--brass": "#e7bf76",
    "--brass-2": "#c9973f",
    "--brass-3": "#8f6a2a",
    "--parchment": "#ece3d0",
    "--signal": "#6de8a6",
    "--panel": "rgba(231,191,118,.03)",
    "--well": "rgba(231,191,118,.05)",
    "--hairline": "rgba(231,191,118,.14)",
    "--emphasis": "rgba(231,191,118,.25)",
    "--divider": "rgba(231,191,118,.12)",
    "--body-ink": "rgba(236,227,208,.82)",
    "--ink-quiet": "rgba(236,227,208,.62)",
    "--rust": "#d06b45",
    "--iron-850": "#14100b",
    "--iron-800": "#191410",
    "--iron-750": "#201a13",
    "--headline": '"Josefin Sans", Georgia, sans-serif',
    "--mono": '"IBM Plex Mono", ui-monospace, Consolas, monospace',
    "--t-fast": "160ms",
    "--t": "200ms",
    "--t-slow": "240ms",
    "--ease": "cubic-bezier(.2,.8,.25,1)",
    "--r": "0",
}
BRAND_TOKENS = {
    "--display": "Anton600, Impact, sans-serif",
    "--ember": "#ff6a00",
    "--aff-power": "#f3c244",
    "--aff-bitcoin": "#f7931a",
    "--aff-keys": "#fff7ec",
    "--aff-signal": "#7447b8",
    "--aff-timelock": "#17bebb",
    "--aff-neutral": "#8a8f98",
}
# Kept one release so pages resolve while they migrate. --signal is NOT an alias.
LEGACY_ALIASES = {
    "--black": "--iron",
    "--soot": "--iron-850",
    "--panel-2": "--iron-800",
    "--steel": "--iron-750",
    "--cream": "--parchment",
    "--muted": "--ink-quiet",
    "--ink-dim": "--brass-3",
    "--line": "--hairline",
    "--line-strong": "--emphasis",
    "--good": "--brass",
    "--danger": "--rust",
    "--gold": "--brass",
    "--orange": "--brass",
    "--orange-soft": "--brass-2",
    "--purple": "--brass-2",
    "--purple-deep": "--brass-3",
    "--violet": "--aff-timelock",
    "--power": "--aff-power",
    "--bitcoin": "--aff-bitcoin",
    "--keys": "--aff-keys",
    "--timelock": "--aff-timelock",
    "--neutral": "--aff-neutral",
    "--body": "--mono",
}

COMMENT = re.compile(r"/\*.*?\*/", re.S)
BLOCK = re.compile(r"([^{}]+)\{([^{}]*)\}")
MEDIA = re.compile(r"@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}")
FORBIDDEN_FACE = re.compile(r"\bArial\b|\bInter\b|\bRoboto\b|system-ui|Segoe UI")
RADIUS = re.compile(r"border(?:-[a-z]+)*-radius\s*:\s*([^;}\"]+)")
SHADOW = re.compile(r"(?:box|text)-shadow\s*:\s*([^;}\"]+)")
GREEN = re.compile(r"var\(--signal\)|#6de8a6|#6ee7a8", re.I)
SIGNAL_TOKEN = re.compile(r"--signal\s*:\s*#6de8a6", re.I)  # defining the token is not a use
ADVISORY_SKIP = {"e1-card-set.html", "fx-demo.html"}  # generated gallery, effects bench


def norm(value: str) -> str:
    """A CSS value compared loosely: no whitespace, no leading zero, one case."""
    return re.sub(r"(^|[,(])0\.", r"\1.", re.sub(r"\s+", "", value)).lower()


def stylesheet() -> str:
    """site/600b.css without its comments (comments may name what is forbidden)."""
    return COMMENT.sub("", (SITE / "600b.css").read_text(encoding="utf-8"))


def split_selectors(text: str) -> list[str]:
    """A selector list split on its top-level commas (not the ones inside :is() or :not())."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    return [part.strip() for part in [*parts, text[start:]]]


def rules(css: str) -> list[tuple[list[str], dict[str, str]]]:
    """Every innermost `selectors { declarations }` block, in source order."""
    out = []
    for selector, body in BLOCK.findall(css):
        decls = {}
        for part in body.split(";"):
            name, sep, value = part.partition(":")
            if sep:
                decls[name.strip()] = value.strip()
        out.append((split_selectors(selector), decls))
    return out


def declared(css: str, selector: str) -> dict[str, str]:
    """What every rule naming `selector` declares outside @media, merged in source order."""
    merged: dict[str, str] = {}
    for selectors, decls in rules(MEDIA.sub("", css)):
        if selector in selectors:
            merged.update(decls)
    return merged


def violations(css: str) -> list[str]:
    """Hypershell non-negotiables broken by a piece of comment-free CSS."""
    found = [f"face {m.group()}" for m in FORBIDDEN_FACE.finditer(css)]
    for match in RADIUS.finditer(css):
        if norm(match.group(1).replace("!important", "")) not in {"0", "var(--r)"}:
            found.append(f"radius {match.group(0).strip()}")
    for match in SHADOW.finditer(css):
        if norm(match.group(1).replace("!important", "")) != "none":
            found.append(f"shadow {match.group(0).strip()}")
    return found


# --- site/600b.css, strict ------------------------------------------------------------


def test_stylesheet_keeps_the_non_negotiables() -> None:
    """No Arial/Inter/Roboto/system-ui/Segoe, no radius but 0, no shadow but none."""
    assert violations(stylesheet()) == []


def test_contract_tokens_carry_the_contract_values() -> None:
    """Every Hypershell core and brand-layer token, declared on :root as the contract says."""
    root = declared(stylesheet(), ":root")

    for name, value in {**CORE_TOKENS, **BRAND_TOKENS}.items():
        assert name in root, f"600b.css does not declare {name}"
        assert norm(root[name]) == norm(value), name


def test_signal_is_green_and_the_signal_affinity_is_its_own_token() -> None:
    """--signal changed meaning; the Signal Plate lives on --aff-signal, never on an alias."""
    css = stylesheet()
    root = declared(css, ":root")

    assert root["--signal"] == "#6de8a6"
    assert root["--aff-signal"] == "#7447b8"
    assert declared(css, ".aff-signal") == {"--aff": "var(--aff-signal)"}
    for name, target in LEGACY_ALIASES.items():
        assert norm(root.get(name, "")) == f"var({target})", name
    assert norm(root["--radius"]) == "0"


def test_green_is_only_ever_the_live_dot_and_ember_never_chrome() -> None:
    """The green law in CSS: one component may be green; this sheet is chrome, so no ember."""
    css = stylesheet()
    green = [
        selectors
        for selectors, decls in rules(css)
        if any(GREEN.search(value) for name, value in decls.items() if name != "--signal")
    ]

    assert green, "the live chip lost its signal dot"
    assert all(s.startswith(".tcg-chip--live") for selectors in green for s in selectors), green
    assert "var(--ember)" not in css


def test_the_faces_are_the_vendored_files() -> None:
    """Josefin (variable) and Plex Mono 400/500/600 beside Anton, every url() a real file."""
    css = stylesheet()
    faces = [decls for selectors, decls in rules(css) if selectors == ["@font-face"]]
    by_face = {(d["font-family"].strip('"'), d.get("font-weight", "")): d["src"] for d in faces}

    assert "josefin-sans-var.woff2" in by_face[("Josefin Sans", "400 700")]
    for weight in ("400", "500", "600"):
        assert f"plex-mono-{weight}.woff2" in by_face[("IBM Plex Mono", weight)]
    assert "Anton-Regular.ttf" in by_face[("Anton600", "")]
    for src in by_face.values():
        for url in re.findall(r'url\("([^"]+)"\)', src):
            assert (SITE / url).is_file(), url
    for licence in ("JOSEFIN-OFL.txt", "PLEX-OFL.txt"):
        assert "SIL Open Font License" in (REPO_ROOT / "art" / "fonts" / licence).read_text("utf-8")


def test_josefin_is_only_set_at_600_or_700() -> None:
    """The Hangar sets Josefin at 600 and 700, never 400: every rule using it says which."""
    for selectors, decls in rules(stylesheet()):
        if "var(--headline)" not in ";".join(decls.values()):
            continue
        weight = decls.get("font-weight") or decls.get("font", "").split()[0]
        assert weight in {"600", "700"}, selectors


def test_the_tcg_components_match_the_hypershell_spec() -> None:
    """Button, chip, panel, field, label and focus ring as nappelin's design-system.css."""
    css = stylesheet()

    button = declared(css, ".tcg-btn")
    assert norm(button["font"]) == norm("600 11px/1 var(--mono)")
    assert (button["letter-spacing"], button["padding"]) == (".16em", "12px 22px")
    assert (button["background"], button["color"]) == ("transparent", "var(--brass)")
    assert button["border"] == "1px solid var(--brass-2)"
    primary = declared(css, ".tcg-btn--primary")
    assert (primary["background"], primary["color"]) == ("var(--brass)", "var(--iron)")
    disabled = declared(css, '.tcg-btn[aria-disabled="true"]')
    assert disabled["color"] == "var(--brass-3)"
    assert disabled["border-color"] == "rgba(143,106,42,.5)"

    chip = declared(css, ".tcg-chip")
    assert chip["border"] == "1px solid var(--emphasis)"
    assert norm(chip["font"]).startswith("500") and chip["letter-spacing"] == ".16em"
    dot = declared(css, ".tcg-chip::before")
    assert (dot["width"], dot["height"]) == ("7px", "7px")
    assert "var(--brass-3)" in dot["background"]
    assert "2.4s" in declared(css, ".tcg-chip--live::before")["animation"]
    assert re.search(
        r"prefers-reduced-motion:\s*reduce\)\s*\{\s*\.tcg-chip--live::before\s*\{\s*animation:\s*none",
        css,
    )

    assert declared(css, ".tcg-panel")["background"] == "var(--panel)"
    assert declared(css, ".tcg-panel")["border"] == "1px solid var(--hairline)"
    assert declared(css, ".tcg-panel--emph")["border-color"] == "var(--emphasis)"
    label = declared(css, ".tcg-label")
    # Small labels read in brass-2 (7.42:1 on iron); brass-3 is 3.96:1 at 10px.
    assert (label["letter-spacing"], label["color"]) == (".22em", "var(--brass-2)")
    assert norm(label["font"]).startswith("50010px")
    field = declared(css, ":is(input, select, textarea).tcg-field")
    assert (field["background"], field["caret-color"]) == ("var(--well)", "var(--brass)")
    assert field["border"] == "1px solid rgba(143,106,42,.6)"
    assert declared(css, ":is(input, select, textarea).tcg-field:focus") == {
        "border-color": "var(--brass)"
    }
    assert declared(css, "hr.tcg-steps")["height"] == "9px"
    assert declared(css, ":focus-visible") == {
        "outline": "2px solid var(--brass)",
        "outline-offset": "2px",
    }


def test_the_old_class_names_wear_the_new_rules() -> None:
    """.btn is the primary button, .btn--ghost the outline one, .chip/.panel the tcg- ones."""
    css = stylesheet()
    look = ("background", "color", "border-color")

    def pick(selector: str) -> tuple[str, ...]:
        return tuple(declared(css, selector).get(prop, "") for prop in look)

    assert pick(".btn") == pick(".tcg-btn--primary")
    assert pick(".btn--ghost") == ("transparent", "var(--brass)", "var(--brass-2)")
    assert declared(css, ".chip") == declared(css, ".tcg-chip")
    assert declared(css, ".panel").items() >= declared(css, ".tcg-panel").items()
    assert declared(css, ".panel--act") == declared(css, ".tcg-panel--emph")


def test_body_and_headings_are_the_hypershell_type() -> None:
    """Body is Plex Mono 13px/1.75 in body ink on iron; headings Josefin, uppercase, tracked."""
    css = stylesheet()
    body = declared(css, "body")
    heading = declared(css, "h1")

    assert norm(body["font"]) == norm("400 13px/1.75 var(--mono)")
    assert (body["background"], body["color"]) == ("var(--iron)", "var(--body-ink)")
    assert heading["font-family"] == "var(--headline)"
    assert heading["text-transform"] == "uppercase"
    assert 0.12 <= float(heading["letter-spacing"].removesuffix("em")) <= 0.14
    assert declared(css, "a")["color"] == "var(--brass)"


# --- every page's own CSS, advisory until the page owners land ------------------------


def page_css(page: Path) -> str:
    """A page's <style> blocks and style="" attributes, without comments."""
    html = page.read_text(encoding="utf-8")
    blocks = re.findall(r"<style[^>]*>(.*?)</style>", html, re.S | re.I)
    attributes = re.findall(r'\sstyle="([^"]*)"', html)
    return COMMENT.sub("", "\n".join(blocks + attributes))


PAGES = sorted(p.name for p in SITE.glob("*.html") if p.name not in ADVISORY_SKIP)

# The one shadow the brand split allows: a card's physical ground shadow on the table. It
# belongs to the 600 Billion game world (card art lying on a surface), not to chrome, and
# only rule blocks whose every selector targets card art may carry it.
CARD_ART_RULE = re.compile(
    r"(?:\.gcard(?::hover)?\s+(?:img|\.gart)|\.gcard\.facedown)"
    r"(?:\s*,\s*(?:\.gcard(?::hover)?\s+(?:img|\.gart)|\.gcard\.facedown))*\s*\{[^}]*\}"
)


@pytest.mark.parametrize("name", PAGES)
def test_page_css_keeps_the_non_negotiables(name: str) -> None:
    """No forbidden face, radius, shadow or chrome green in the page's own CSS."""
    css = page_css(SITE / name)
    green = GREEN.finditer(SIGNAL_TOKEN.sub("", css))
    found = violations(CARD_ART_RULE.sub("", css)) + [f"green {m.group()}" for m in green]

    assert found == []


def test_the_card_art_exemption_is_narrow() -> None:
    """A chrome selector sharing the rule, or any other selector, still fails."""
    card = ".gcard img, .gcard .gart { box-shadow: 0 3px 0 #000; }"
    mixed = ".gcard img, .btn { box-shadow: 0 3px 0 #000; }"
    chrome = ".panel { box-shadow: 0 3px 0 #000; }"
    assert violations(CARD_ART_RULE.sub("", card)) == []
    assert violations(CARD_ART_RULE.sub("", mixed)) != []
    assert violations(CARD_ART_RULE.sub("", chrome)) != []
