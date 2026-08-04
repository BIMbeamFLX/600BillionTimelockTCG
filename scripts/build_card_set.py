"""Build the Node Runner frame sheet for the Edition One playtest set.

Ports the generative card frame from the claude.ai design canvas
(`E1 Card Set.dc.html`) into a dependency-free, print-ready page. The border
geometry is emitted as static SVG paths so the artifact is deterministic and
reviewable, and every build is recorded in the audit database first.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import sqlite3
from pathlib import Path
from typing import Any

# 814 x 1109 px = 69 x 94 mm at 300 dpi: a 63 x 88 mm trim plus 3 mm bleed.
CARD_W = 814
CARD_H = 1109
TRIM_INSET = 35
TRIM_W = 744
TRIM_H = 1039

# The locked E1 "Plate" palette (art handoff 2026-08-02). Remapped by RESOURCE,
# never by find-and-replace: old Bitcoin's hex is new Power's, and Keys/Signal
# swapped hexes, so a blind substitution corrupts three of the five.
AFFINITY_ACCENT = {
    "Power": "#F3C244",
    "Bitcoin": "#F7931A",
    "Keys": "#FFF7EC",
    "Signal": "#7447B8",
    # Timelock was #5E5ACB, a blue-violet only deltaE 12 from violet #7447B8 — the
    # two were indistinguishable on a board while every other pair sat above 64.
    # Teal is the palette's one open hue and reads as clock rather than key.
    "Timelock": "#17BEBB",
    # Grey is the project's own neutral, from the world plates in site/arena.html.
    # It must stay clear of Bitcoin's #F7931A: 47 Hardware cards were once
    # mistaken for an affinity when Neutral sat too close to an orange.
    "Neutral": "#8a8f98",
}
AFFINITY_BADGE_FG = {
    "Power": "#050403",
    "Bitcoin": "#050403",
    # Signal's violet chip is the one dark accent, so it takes the light ink;
    # Keys is now white and needs dark ink to survive on its own chip.
    "Signal": "#FFF7EC",
    "Neutral": "#050403",
    "Keys": "#050403",
    "Timelock": "#050403",
}
# Per the Node Runner handoff: common bone, uncommon orange, rare gold.
RARITY_DOT = {
    "common": ("#e8dfcf", "rgba(232,223,207,.25)"),
    "uncommon": ("#f7931a", "rgba(247,147,26,.3)"),
    "rare": ("#F3C244", "rgba(243,194,68,.3)"),
}
# Affinity already owns the spine, chip, circuit and pips, so card type gets the
# one channel affinity does not use: the base dark. Four groups a player sorts by,
# all held at roughly the same luminance so the terminal look survives.
TYPE_GROUP = {
    # A Basic Resource makes one thing; a Junction offers a choice of two. They
    # are played every single turn, so telling them apart has to be instant.
    "Basic Resource": "basic",
    "Resource": "junction",
    "Avatar": "avatar",
    "Hardware Avatar": "avatar",
    "Zap": "spell",
    "Operation": "spell",
    "Hardware": "device",
    "Protocol": "device",
}
TYPE_BASE = {
    "basic": ("#0d0803", "#1a0f06"),  # warm amber-black — the mana
    "junction": ("#04100a", "#08200f"),  # green-black — the crossing
    "avatar": ("#050403", "#0a0705"),  # the spec default, neutral
    "spell": ("#03060f", "#060c1c"),  # cool blue-black — one-shot
    "device": ("#080412", "#110925"),  # violet-black — persistent
}


COST_AFFINITY = {"P": "Power", "B": "Bitcoin", "K": "Keys", "S": "Signal", "T": "Timelock"}
ART_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
CORNER_MARKS = (
    "M60,232L60,196L96,196M718,196L754,196L754,232M754,800L754,836L718,836M96,836L60,836L60,800"
)


# --------------------------------------------------------------------------
# Deterministic geometry, ported 1:1 from the design canvas' JavaScript.
# JavaScript integer and rounding semantics are reproduced exactly so the
# generated paths match the design doc byte for byte.
# --------------------------------------------------------------------------


def _int32(value: int) -> int:
    """Coerce to a signed 32-bit integer the way JavaScript bitwise ops do."""
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value >= 0x80000000 else value


def _uint32(value: int) -> int:
    """Coerce to an unsigned 32-bit integer (JavaScript `>>> 0`)."""
    return value & 0xFFFFFFFF


def _imul(left: int, right: int) -> int:
    """Reproduce `Math.imul`."""
    return _int32(_uint32(left) * _uint32(right))


def _xor32(left: int, right: int) -> int:
    """Reproduce JavaScript's `^`, which coerces both sides to int32."""
    return _int32(_uint32(left) ^ _uint32(right))


def _js_round(value: float) -> int:
    """Reproduce `Math.round`, which rounds halves toward positive infinity."""
    return math.floor(value + 0.5)


def _round1(value: float) -> float:
    """Reproduce the canvas' `F` helper: round to one decimal place."""
    return _js_round(value * 10) / 10


def _num(value: float) -> str:
    """Stringify a number the way JavaScript does (no trailing `.0`)."""
    return str(int(value)) if value == int(value) else repr(value)


def _f(value: float) -> str:
    """Round to one decimal and stringify, as the canvas does inline."""
    return _num(_round1(value))


def _rng(seed: int):
    """Return a mulberry32 generator seeded exactly as the canvas seeds it."""
    state = _uint32(seed)

    def next_float() -> float:
        nonlocal state
        state = _int32(state + 0x6D2B79F5)
        t = _imul(_xor32(state, _uint32(state) >> 15), _int32(1 | state))
        t = _xor32(t + _imul(_xor32(t, _uint32(t) >> 7), _int32(61 | t)), t)
        return _uint32(_xor32(t, _uint32(t) >> 14)) / 4294967296

    return next_float


def _dot(x: float, y: float, radius: float) -> str:
    """Draw a filled circle as two arc segments."""
    r = _num(radius)
    return (
        f"M{_f(x + radius)},{_f(y)}A{r},{r} 0 1 1 {_f(x - radius)},{_f(y)}"
        f"A{r},{r} 0 1 1 {_f(x + radius)},{_f(y)}"
    )


def circuit_geometry(
    x: int, y: int, w: int, h: int, seg: int, seed: int, k: float
) -> dict[str, list]:
    """Trace the jittered circuit ring around the art window as raw geometry."""
    rand = _rng(seed)
    n1 = max(2, _js_round(w / seg))
    n2 = max(2, _js_round(h / seg))
    raw: list[tuple[float, float, int, int, bool]] = []
    for i in range(n1):
        raw.append((x + w * i / n1, y, 0, -1, i == 0))
    for i in range(n2):
        raw.append((x + w, y + h * i / n2, 1, 0, i == 0))
    for i in range(n1):
        raw.append((x + w - w * i / n1, y + h, 0, 1, i == 0))
    for i in range(n2):
        raw.append((x, y + h - h * i / n2, -1, 0, i == 0))

    points = []
    for px, py, nx, ny, corner in raw:
        jitter_x = _round1(px + (rand() * 2 - 1) * 4 * k)
        jitter_y = _round1(py + (rand() * 2 - 1) * 4 * k)
        points.append((jitter_x, jitter_y, nx, ny, corner))

    nodes = []
    for index, (px, py, _nx, _ny, corner) in enumerate(points):
        if corner:
            nodes.append((px, py, 7))
        elif index % 4 == 2:
            nodes.append((px, py, 4.5))

    ticks = []
    for _ in range(10):
        px, py, nx, ny, _corner = points[math.floor(rand() * len(points))]
        length = 14 + rand() * 8
        ticks.append((px, py, _round1(px + nx * length), _round1(py + ny * length)))
    return {"points": points, "nodes": nodes, "ticks": ticks}


def _circuit(x: int, y: int, w: int, h: int, seg: int, seed: int, k: float) -> dict[str, str]:
    """Build the jittered circuit ring that traces the art window."""
    shape = circuit_geometry(x, y, w, h, seg, seed, k)
    points = shape["points"]

    line = f"M{_num(points[0][0])},{_num(points[0][1])}"
    for px, py, _nx, _ny, _corner in points[1:]:
        line += f"L{_num(px)},{_num(py)}"
    line += "Z"

    nodes = "".join(_dot(px, py, radius) for px, py, radius in shape["nodes"])
    ticks = "".join(
        f"M{_num(px)},{_num(py)}L{_num(tx)},{_num(ty)}" for px, py, tx, ty in shape["ticks"]
    )
    return {"line": line, "nodes": nodes, "ticks": ticks}


def net_geometry(x: int, y: int, w: int, h: int, count: int, seed: int) -> dict[str, list]:
    """Scatter nodes and route each to its two nearest neighbours, as raw geometry."""
    rand = _rng(seed)
    points = []
    for _ in range(count):
        px = _round1(x + 6 + rand() * (w - 12))
        py = _round1(y + 6 + rand() * (h - 12))
        points.append((px, py))

    seen: set[str] = set()
    links: list[list[tuple[float, float]]] = []
    for i, (ax, ay) in enumerate(points):
        near = sorted(
            ((math.hypot(qx - ax, qy - ay), j) for j, (qx, qy) in enumerate(points)),
            key=lambda item: item[0],
        )
        for m in range(1, min(3, len(near))):
            j = near[m][1]
            key = f"{min(i, j)}-{max(i, j)}"
            if key in seen:
                continue
            seen.add(key)
            bx, by = points[j]
            elbow = (ax, by) if (i + j) % 2 else (bx, ay)
            links.append([(ax, ay), elbow, (bx, by)])
    return {"points": points, "links": links}


def _net(x: int, y: int, w: int, h: int, count: int, seed: int) -> dict[str, str]:
    """Build a small orthogonally routed node mesh."""
    shape = net_geometry(x, y, w, h, count, seed)
    links = "".join(
        f"M{_num(a[0])},{_num(a[1])}L{_num(b[0])},{_num(b[1])}L{_num(c[0])},{_num(c[1])}"
        for a, b, c in shape["links"]
    )
    nodes = "".join(_dot(px, py, 4) for px, py in shape["points"])
    return {"links": links, "nodes": nodes}


def blob_geometry(
    cx: int, cy: int, r0: int, count: int, amp: int, seed: int, k: float
) -> list[tuple[float, float]]:
    """Return the control points of the wobbly ring behind the sacred number."""
    rand = _rng(seed)
    points = []
    for i in range(count):
        angle = math.pi * 2 * i / count
        radius = r0 + (rand() * 2 - 1) * amp * k
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def _mid(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    """Midpoint of two points, rounded the way the canvas rounds it."""
    return _round1((a[0] + b[0]) / 2), _round1((a[1] + b[1]) / 2)


def _blob(cx: int, cy: int, r0: int, count: int, amp: int, seed: int, k: float) -> str:
    """Build the wobbly ring behind the card back's sacred number."""
    points = blob_geometry(cx, cy, r0, count, amp, seed, k)
    start = _mid(points[-1], points[0])
    path = f"M{_num(start[0])},{_num(start[1])}"
    for i, point in enumerate(points):
        m = _mid(point, points[(i + 1) % len(points)])
        path += f"Q{_f(point[0])},{_f(point[1])} {_num(m[0])},{_num(m[1])}"
    return path + "Z"


def open_geometry(
    x1: int, y1: int, x2: int, y2: int, seg: int, amp: int, seed: int, k: float
) -> list[tuple[float, float]]:
    """Return the joints of the hand-drawn rule under the art window."""
    rand = _rng(seed)
    dx, dy = x2 - x1, y2 - y1
    count = max(3, _js_round(math.hypot(dx, dy) / seg))
    joints: list[tuple[float, float]] = []
    for i in range(count + 1):
        px, py = x1 + dx * i / count, y1 + dy * i / count
        if i in (0, count):
            joints.append((px, py))
        else:
            joints.append((px + (rand() * 2 - 1) * amp * k, py + (rand() * 2 - 1) * amp * k))
    return joints


def _open(x1: int, y1: int, x2: int, y2: int, seg: int, amp: int, seed: int, k: float) -> str:
    """Build the hand-drawn rule that separates art from rules text."""
    joints = open_geometry(x1, y1, x2, y2, seg, amp, seed, k)
    count = len(joints) - 1
    path = f"M{_f(joints[0][0])},{_f(joints[0][1])}"
    for i in range(1, count):
        mx, my = _mid(joints[i], joints[i + 1])
        path += f"Q{_f(joints[i][0])},{_f(joints[i][1])} {_num(mx)},{_num(my)}"
    return path + f"L{_f(joints[count][0])},{_f(joints[count][1])}"


def _rain(count: int, seed: int) -> str:
    """Build the vertical digit rain that runs down both card edges."""
    rand = _rng(seed)
    return "".join(("6" if rand() < 0.3 else "0") + "\n" for _ in range(count))


def spine_geometry(seed: int) -> dict[str, list]:
    """Return the bar and its notches as rectangles: (x0, y0, x1, y1)."""
    rand = _rng(seed)
    main: list[tuple[float, float, float, float]] = [(0, 0, 6, CARD_H)]
    dim: list[tuple[float, float, float, float]] = []
    y = 8.0
    while y < 1090:
        h = 18 + rand() * 70
        w = 12 + rand() * 30
        if rand() < 0.3:
            dim.append((0, _round1(y), _round1(w * 1.9), _round1(y + h)))
        else:
            main.append((0, _round1(y), _round1(w), _round1(y + h)))
        y += h + rand() * 30
    return {"main": main, "dim": dim}


def _spine(seed: int) -> dict[str, str]:
    """Build the ragged bar that runs the full height of the left edge."""
    shape = spine_geometry(seed)

    def rects(items: list[tuple[float, float, float, float]], skip_first: bool) -> str:
        out = "M0,0L6,0L6,1109L0,1109Z" if skip_first else ""
        for x0, y0, x1, y1 in items[1:] if skip_first else items:
            out += f"M{_num(x0)},{_num(y0)}L{_num(x1)},{_num(y0)}"
            out += f"L{_num(x1)},{_num(y1)}L{_num(x0)},{_num(y1)}Z"
        return out

    main = rects(shape["main"], True)
    dim = rects(shape["dim"], False)
    return {"main": main, "dim": dim}


def frame_paths(index: int, k: float) -> dict[str, Any]:
    """Generate every path for card `index` (1-based, matching the canvas seeds)."""
    spine = _spine(781 + index)
    return {
        "spine": spine["main"],
        "spineDim": spine["dim"],
        "circ": _circuit(56, 192, 702, 648, 44, 601 + index, k),
        "netL": _net(68, 214, 74, 520, 12, 631 + index),
        "netR": _net(672, 214, 74, 520, 12, 661 + index),
        "rule": _open(72, 852, 742, 852, 30, 3, 691 + index, k),
        "rainL": _rain(36, 721 + index),
        "rainR": _rain(36, 751 + index),
    }


def back_paths(k: float) -> dict[str, Any]:
    """Generate every path for the shared card back."""
    spine = _spine(999)
    return {
        "spine": spine["main"],
        "spineDim": spine["dim"],
        "net": _net(120, 180, 574, 600, 26, 552),
        "ring": _blob(407, 554, 170, 44, 8, 551, k),
        "rainL": _rain(36, 553),
        "rainR": _rain(36, 554),
    }


def build_geometry(border_amp: int) -> dict[str, Any]:
    """Generate the full path set for one border amplitude."""
    k = border_amp / 6
    geometry: dict[str, Any] = {"back": back_paths(k)}
    for index in range(1, 19):
        geometry[f"c{index}"] = frame_paths(index, k)
    return geometry


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------


def _rgba(hex_color: str, alpha: str) -> str:
    """Convert `#rrggbb` to an `rgba()` string."""
    value = hex_color.lstrip("#")
    r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r},{g},{b},{alpha})"


def find_art(card: dict[str, Any], art_dir: Path) -> str | None:
    """Return a page-relative path to this card's artwork, when it exists."""
    for suffix in ART_SUFFIXES:
        candidate = art_dir / f"{card['art']}{suffix}"
        if candidate.exists():
            return f"../art/cards/{art_dir.name}/{candidate.name}"
    return None


def cost_pips(cost: str) -> str:
    """Render a cost string such as `4BB` as a generic box plus affinity pips."""
    if not cost:
        return ""
    generic = "".join(ch for ch in cost if ch.isdigit())
    letters = [ch for ch in cost if ch in COST_AFFINITY]
    pips = ""
    if generic:
        pips += f'<span class="generic">{generic}</span>'
    for letter in letters:
        affinity = COST_AFFINITY[letter]
        icon = affinity.lower()
        pips += f'<img src="../art/resources/{icon}.svg" alt="{affinity}">'
    modifier = " pips-only" if not generic else ""
    return f'<div class="cost{modifier}">{pips}</div>'


def render_card(card: dict[str, Any], paths: dict[str, Any], art_dir: Path) -> str:
    """Render one card face at full bleed size."""
    affinity = card["affinity"]
    accent = AFFINITY_ACCENT[affinity]
    badge_fg = AFFINITY_BADGE_FG[affinity]
    dot_fill, dot_glow = RARITY_DOT[card["rarity"]]
    badge = f"{card['card_type']} // {card['subtype']}".upper()

    art_src = find_art(card, art_dir)
    if art_src:
        alt = html.escape(card["art"])
        art = f'<img src="{html.escape(art_src)}" alt="{alt}">'
    else:
        art = f'<div class="art-empty">{html.escape(card["art"])}</div>'

    base_bg, base_plate = TYPE_BASE[TYPE_GROUP.get(card["card_type"], "avatar")]
    parts = [
        f'<article class="card" id="{html.escape(card["id"])}" style="background:{base_bg}">',
        f'<div class="rain rain-l">{paths["rainL"]}</div>',
        f'<div class="rain rain-r">{paths["rainR"]}</div>',
        f'<div class="art-well" style="background:{base_plate}"></div>',
        f'<div class="art">{art}</div>',
        f'<svg class="frame" viewBox="0 0 {CARD_W} {CARD_H}" aria-hidden="true">',
        f'<path d="{paths["spineDim"]}" fill="{accent}" opacity="0.25"/>',
        f'<path d="{paths["spine"]}" fill="{accent}"/>',
        f'<path d="{paths["circ"]["line"]}" fill="none"'
        f' stroke="{_rgba(accent, "0.55")}" stroke-width="2"/>',
        f'<path d="{paths["circ"]["ticks"]}" fill="none" stroke="{accent}" stroke-width="4"/>',
        f'<path d="{paths["circ"]["nodes"]}" fill="{accent}"/>',
    ]
    for side in ("netL", "netR"):
        parts.append(
            f'<path d="{paths[side]["links"]}" fill="none"'
            ' stroke="rgba(247,147,26,0.3)" stroke-width="1.5"/>'
        )
        parts.append(f'<path d="{paths[side]["nodes"]}" fill="rgba(247,147,26,0.55)"/>')
    parts += [
        f'<path d="{paths["rule"]}" fill="none" stroke="rgba(247,147,26,0.45)" stroke-width="2"/>',
        f'<path d="{CORNER_MARKS}" fill="none" stroke="#FFF7EC" stroke-width="3"/>',
        "</svg>",
        f'<div class="badge" style="background:{accent};color:{badge_fg}">{badge}</div>',
        f'<h3 class="title" style="font-size:{card["title_size"]}px">'
        f"{html.escape(card['name'])}</h3>",
        cost_pips(card["cost"]),
    ]

    if card["action"] is not None:
        parts.append(
            f'<div class="stat stat-act" style="border-color:{accent}">'
            f"<span>{card['action']}</span><span>ACT</span></div>"
        )
        parts.append(
            f'<div class="stat stat-res" style="border-color:{accent}">'
            f"<span>{card['resilience']}</span><span>RES</span></div>"
        )
    if card["card_type"] == "Resource":
        icon = affinity.lower()
        parts.append(
            f'<img class="resource-icon" src="../art/resources/{icon}.svg" alt="{affinity}">'
        )

    body = ""
    if card["keyword"]:
        body += f"<strong>{html.escape(card['keyword'])}</strong>"
        if card["rules_text"]:
            body += " "
    body += html.escape(card["rules_text"])
    parts.append('<div class="text">')
    if body:
        parts.append(f'<div class="rules">{body}</div>')
    if card["flavor_text"]:
        parts.append(f'<div class="fable">// {html.escape(card["flavor_text"])}</div>')
    parts.append("</div>")

    parts += [
        '<div class="footer"><span>TIMELOCK_TCG :: 600B</span>',
        f'<span class="set-id">{html.escape(card["id"].replace("-", " · "))}'
        f'<i style="background:{dot_fill};box-shadow:0 0 0 3px {dot_glow}"></i></span></div>',
        '<div class="guides"><span>TRIM 63×88</span></div>',
        "</article>",
    ]
    return "".join(parts)


def render_back(paths: dict[str, Any]) -> str:
    """Render the shared card back."""
    return "".join(
        [
            '<article class="card card-back" id="card-back">',
            f'<div class="rain rain-l">{paths["rainL"]}</div>',
            f'<div class="rain rain-r">{paths["rainR"]}</div>',
            f'<svg class="frame back" viewBox="0 0 {CARD_W} {CARD_H}" aria-hidden="true">',
            f'<path d="{paths["spineDim"]}" fill="#f7931a" opacity="0.25"/>',
            f'<path d="{paths["spine"]}" fill="#f7931a"/>',
            f'<path d="{paths["net"]["links"]}" fill="none"'
            ' stroke="rgba(247,147,26,0.35)" stroke-width="1.5"/>',
            f'<path d="{paths["net"]["nodes"]}" fill="rgba(247,147,26,0.6)"/>',
            f'<path d="{paths["ring"]}" fill="#0a0705" stroke="#f7931a" stroke-width="6"/>',
            "</svg>",
            '<div class="sacred"><span>600</span><span>000</span>'
            "<span>000</span><span>000</span></div>",
            '<div class="back-footer">TIMELOCK_TCG :: EDITION ONE</div>',
            '<div class="guides"></div>',
            "</article>",
        ]
    )


def render_html(
    payload: dict[str, Any],
    geometry: dict[str, Any],
    art_dir: Path,
    show_guides: bool,
    show_fable: bool,
) -> str:
    """Render the full sheet: every card grouped by section, plus the card back."""
    meta = payload["set"]
    cards = payload["cards"]
    groups: dict[str, list[dict[str, Any]]] = {}
    for card in cards:
        groups.setdefault(card["group"], []).append(card)

    sections = []
    for name, members in groups.items():
        faces = "".join(render_card(card, geometry[card["slot"]], art_dir) for card in members)
        sections.append(
            f'<section class="group"><h2>{html.escape(name)}</h2>'
            f'<div class="sheet">{faces}</div></section>'
        )
    sections.append(
        '<section class="group"><h2>Card back</h2>'
        f'<div class="sheet">{render_back(geometry["back"])}</div></section>'
    )

    body_class = " ".join(
        filter(None, ["" if show_guides else "no-guides", "" if show_fable else "no-fable"])
    )
    trim = f"{meta['trim_mm'][0]} × {meta['trim_mm'][1]} mm"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7931a">
  <meta name="description"
    content="The {meta["card_count"]}-card Edition One playtest set in the Node Runner frame.">
  <title>600B Timelock TCG — {meta["frame"]} Frame</title>
  <style>
    @font-face {{
      font-family: Anton600;
      src: url("../art/fonts/Anton-Regular.ttf") format("truetype");
      font-display: swap;
    }}
    :root {{
      --orange: #f7931a;
      --ink: #111111;
      --card-bg: #050403;
      --cream: #FFF7EC;
      --bone: #e8dfcf;
      --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
      --body: "Trebuchet MS", "Helvetica Neue", Arial, sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    html {{ background: var(--orange); }}
    body {{ margin: 0; color: var(--ink); background: var(--orange); font-family: var(--body); }}
    a, a:visited {{ color: var(--ink); font-weight: 700; }}
    a:hover {{ text-decoration-style: wavy; }}
    .page {{
      display: flex;
      flex-direction: column;
      gap: 56px;
      padding: clamp(24px, 6vw, 96px);
    }}
    .lede {{ display: flex; flex-direction: column; gap: 18px; max-width: 1200px; }}
    .eyebrow {{ font: 400 20px var(--mono); letter-spacing: .3em; }}
    h1 {{
      margin: 0;
      font: 400 clamp(48px, 9vw, 84px)/.95 Anton600, Impact, sans-serif;
      letter-spacing: .02em;
      text-transform: uppercase;
    }}
    .intro {{ max-width: 760px; font-size: 19px; line-height: 1.55; }}
    .group {{ display: flex; flex-direction: column; gap: 16px; }}
    .group h2 {{
      margin: 0;
      font: 400 30px Anton600, Impact, sans-serif;
      text-transform: uppercase;
    }}
    .sheet {{ display: flex; flex-wrap: wrap; gap: 36px; align-items: flex-start; }}

    /* One card = 69 x 94 mm at 300 dpi, previewed at half scale. */
    .card {{
      position: relative;
      flex: none;
      width: {CARD_W}px;
      height: {CARD_H}px;
      background: var(--card-bg);
      box-shadow: 0 8px 24px rgba(0, 0, 0, .25);
      transform: scale(.5);
      transform-origin: 0 0;
      margin: 0 {-CARD_W // 2}px {-CARD_H // 2}px 0;
    }}
    .rain {{
      position: absolute;
      font: 400 20px/1.4 var(--mono);
      white-space: pre;
      text-align: center;
    }}
    .rain-l {{ left: 8px; top: 40px; z-index: 2; color: rgba(5, 4, 3, .75); }}
    .rain-r {{ right: 12px; top: 44px; z-index: 1; color: rgba(247, 147, 26, .25); }}
    .art-well {{
      position: absolute;
      left: 60px;
      top: 196px;
      z-index: 1;
      width: 694px;
      height: 640px;
      background: #0a0705;
      border: 1px solid rgba(247, 147, 26, .25);
    }}
    .art {{ position: absolute; left: 68px; top: 204px; z-index: 2; width: 678px; height: 624px; }}
    .art img {{ display: block; width: 100%; height: 100%; object-fit: contain; }}
    .art-empty {{
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 0 40px;
      color: rgba(232, 223, 207, .3);
      border: 2px dashed rgba(232, 223, 207, .18);
      font: 400 26px var(--mono);
      letter-spacing: .1em;
      text-align: center;
      text-transform: uppercase;
    }}
    .frame {{
      position: absolute;
      inset: 0;
      z-index: 3;
      width: {CARD_W}px;
      height: {CARD_H}px;
      pointer-events: none;
    }}
    .frame.back {{ z-index: 2; }}
    .badge {{
      position: absolute;
      left: 72px;
      top: 58px;
      z-index: 4;
      padding: 7px 16px;
      font: 400 22px var(--mono);
      letter-spacing: .28em;
    }}
    .title {{
      position: absolute;
      left: 72px;
      top: 98px;
      z-index: 4;
      margin: 0;
      color: var(--cream);
      font-family: "Chakra Petch", Anton600, Impact, sans-serif;
      font-weight: 700;
      line-height: 1;
      letter-spacing: .01em;
      white-space: nowrap;
      text-shadow: 3px 0 0 rgba(255, 106, 0, .7), -3px 0 0 rgba(116, 71, 184, .55);
    }}
    .cost {{
      position: absolute;
      right: 64px;
      top: 92px;
      z-index: 4;
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .cost .generic {{
      display: flex;
      align-items: center;
      justify-content: center;
      width: 78px;
      height: 78px;
      background: var(--ink);
      border: 3px solid rgba(255, 247, 236, .7);
      color: var(--cream);
      font: 400 44px var(--mono);
    }}
    .cost img {{ width: 54px; height: 54px; }}
    .cost.pips-only img {{ width: 64px; height: 64px; }}
    .stat {{
      position: absolute;
      top: 724px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      width: 60px;
      height: 88px;
      background: rgba(17, 17, 17, .85);
      border: 2px solid var(--cream);
    }}
    .stat-act {{ left: 78px; }}
    .stat-res {{ left: 676px; }}
    .stat span:first-child {{ color: var(--cream); font: 400 40px/1 var(--mono); }}
    .stat span:last-child {{
      color: var(--orange);
      font: 400 14px var(--mono);
      letter-spacing: .1em;
    }}
    .resource-icon {{
      position: absolute;
      right: 76px;
      top: 736px;
      z-index: 4;
      width: 64px;
      height: 64px;
    }}
    .text {{
      position: absolute;
      left: 72px;
      right: 72px;
      top: 864px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }}
    .rules {{ color: var(--bone); font-size: 31px; line-height: 1.3; }}
    .rules strong {{ color: var(--cream); }}
    .fable {{ color: rgba(232, 223, 207, .5); font: italic 400 21px/1.3 var(--mono); }}
    .footer {{
      position: absolute;
      left: 72px;
      right: 72px;
      top: 1022px;
      z-index: 4;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: rgba(232, 223, 207, .6);
      font: 400 22px var(--mono);
      letter-spacing: .2em;
    }}
    .set-id {{ display: flex; align-items: center; gap: 12px; }}
    .set-id i {{ display: inline-block; width: 14px; height: 14px; border-radius: 50%; }}
    .sacred {{
      position: absolute;
      left: 257px;
      top: 404px;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 300px;
      height: 300px;
      color: var(--orange);
      font: 400 60px/.98 Anton600, Impact, sans-serif;
    }}
    .back-footer {{
      position: absolute;
      left: 0;
      right: 0;
      top: 1010px;
      z-index: 3;
      color: rgba(232, 223, 207, .6);
      font: 400 22px var(--mono);
      letter-spacing: .34em;
      text-align: center;
    }}
    .guides {{
      position: absolute;
      left: {TRIM_INSET}px;
      top: {TRIM_INSET}px;
      z-index: 9;
      width: {TRIM_W}px;
      height: {TRIM_H}px;
      border: 2px dashed rgba(0, 210, 255, .7);
      pointer-events: none;
    }}
    .guides span {{
      position: absolute;
      right: 10px;
      top: 8px;
      color: rgba(0, 210, 255, .9);
      font: 400 20px var(--mono);
      letter-spacing: .16em;
    }}
    .no-guides .guides {{ display: none; }}
    .no-fable .fable {{ display: none; }}

    /* Print one card per page at true size: 63 x 88 mm trim inside 3 mm bleed. */
    @media print {{
      html, body {{ background: #fff; }}
      .page {{ padding: 0; gap: 0; }}
      .lede, .group h2 {{ display: none; }}
      .sheet {{ display: block; gap: 0; }}
      .card {{
        width: 69mm;
        height: 94mm;
        margin: 0;
        box-shadow: none;
        transform: scale(calc(69 / 814 * 96 / 25.4));
        break-after: page;
      }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      * {{ transition: none !important; }}
    }}
  </style>
</head>
<body class="{body_class}">
  <main class="page">
    <div class="lede">
      <div class="eyebrow">600B TIMELOCK TCG · EDITION ONE · {meta["frame"].upper()} FRAME</div>
      <h1>The playtest set</h1>
      <p class="intro">All {meta["card_count"]} cards in the {meta["frame"]} frame, numbered
      E1 · 007–024 after the iconic six. {trim}, {meta["bleed_mm"]} mm bleed,
      {meta["dpi"]} dpi, contain-fit art windows. Drop artwork into
      <code>art/cards/{art_dir.name}/</code> named after each card to fill a window.
      <a href="cards.html">All {295} catalog cards →</a></p>
    </div>
    {"".join(sections)}
  </main>
</body>
</html>
"""


# --------------------------------------------------------------------------
# Audit trail
# --------------------------------------------------------------------------


def record_site_decision(db_path: Path, payload: dict[str, Any], output_path: Path) -> None:
    """Record the sheet build before writing HTML."""
    fingerprint = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS site_builds (
                artifact TEXT PRIMARY KEY,
                input_fingerprint TEXT NOT NULL,
                record_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO site_builds (
                artifact, input_fingerprint, record_count, status, updated_by
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                str(output_path),
                hashlib.sha256(fingerprint).hexdigest(),
                len(payload["cards"]),
                "planned",
                "auto:claude:e1-node-runner-frame",
            ),
        )
        connection.commit()


def complete_site_decision(db_path: Path, output_path: Path) -> None:
    """Mark the HTML artifact generated after a successful write."""
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE site_builds SET status='generated' WHERE artifact=?",
            (str(output_path),),
        )
        connection.commit()


def main() -> None:
    """Build site/e1-card-set.html from the locked Node Runner set data."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cards", type=Path, default=repo_root / "cards" / "e1-node-runner-set.json"
    )
    parser.add_argument("--out", type=Path, default=repo_root / "site" / "e1-card-set.html")
    parser.add_argument("--art-dir", type=Path, default=repo_root / "art" / "cards" / "node-runner")
    parser.add_argument(
        "--border-amp",
        type=int,
        default=6,
        choices=range(1, 15),
        metavar="{1..14}",
        help="generative border amplitude (default: 6)",
    )
    parser.add_argument("--no-guides", action="store_true", help="hide the trim guides")
    parser.add_argument("--no-fable", action="store_true", help="hide flavor text")
    parser.add_argument("--audit-db", type=Path, default=repo_root / ".audit" / "e1-design.sqlite")
    args = parser.parse_args()

    payload = json.loads(args.cards.read_text(encoding="utf-8"))
    cards = payload["cards"]
    if len(cards) != payload["set"]["card_count"]:
        raise ValueError("card count does not match the locked set header")
    missing = [card["id"] for card in cards if card["affinity"] not in AFFINITY_ACCENT]
    if missing:
        raise ValueError(f"unknown affinity on {', '.join(missing)}")

    record_site_decision(args.audit_db, payload, args.out)
    geometry = build_geometry(args.border_amp)
    markup = render_html(
        payload,
        geometry,
        args.art_dir,
        show_guides=not args.no_guides,
        show_fable=not args.no_fable,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(markup, encoding="utf-8")
    complete_site_decision(args.audit_db, args.out)
    filled = sum(1 for card in cards if find_art(card, args.art_dir))
    print(f"wrote {args.out} with {len(cards)} cards ({filled} with artwork) + card back")


if __name__ == "__main__":
    main()
