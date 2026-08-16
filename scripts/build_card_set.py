"""Build the Edition One proof sheet from the shipped card face renders.

site/e1-card-set.html shows the real faces written by `scripts/render_card_pngs.py`
— one image per shipped render, with the card's printed data laid out beside it —
so the page can never drift from the cards again: the renderer is the single
geometry authority. This module keeps the generative frame geometry (spine,
circuit ring, node mesh, blob, digit rain), ported 1:1 from the claude.ai design
canvas (`E1 Card Set.dc.html`), as an importable library for the renderer, the
icon builder and the golden tests. Every build is recorded in the audit database
first.
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
from urllib.parse import quote

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
# Page emission. The page draws no frame of its own: every face is the exact
# bitmap scripts/render_card_pngs.py shipped, and the markup around it is the
# card's printed data, styled as data rather than as a second card.
# --------------------------------------------------------------------------

BACK_STEM = "600B-Timelock-card-back"

# Section per card type, in the order a player sorts a box. Payloads that carry
# an explicit per-card "group" (the archived 18-card playtest lock) keep their
# own section names and their own order instead.
SECTION_NAMES = {
    "Basic Resource": "Basic Resources",
    "Resource": "Junction Resources",
    "Avatar": "Avatars",
    "Hardware Avatar": "Hardware Avatars",
    "Zap": "Zaps",
    "Operation": "Operations",
    "Hardware": "Hardware",
    "Protocol": "Protocols",
}
SECTION_RANK = {name: rank for rank, name in enumerate(SECTION_NAMES.values())}


def card_affinities(card: dict[str, Any]) -> list[str]:
    """Normalize the affinity field: the catalog holds a list, the old lock a string."""
    value = card.get("affinity") or []
    return [value] if isinstance(value, str) else list(value)


def card_stats(card: dict[str, Any]) -> tuple[str, str] | None:
    """Action/Resilience from either lock shape: `action`+`resilience` or `"A/R"`."""
    if card.get("action") is not None:
        return str(card["action"]), str(card["resilience"])
    stats = card.get("action_resilience") or ""
    if "/" in stats:
        action, _, resilience = stats.partition("/")
        return action, resilience
    return None


def find_face(stem: str, art_dir: Path) -> str | None:
    """Return a page-relative URL to a shipped face render, when it exists.

    Face files are named after the card, so the URL is percent-encoded: the set
    has spaces, commas, an ampersand and en-dash names like "Signal–Keys Junction".
    """
    for suffix in ART_SUFFIXES:
        candidate = art_dir / f"{stem}{suffix}"
        if candidate.exists():
            return f"../art/cards/{quote(art_dir.name)}/{quote(candidate.name)}"
    return None


def find_art(card: dict[str, Any], art_dir: Path) -> str | None:
    """Return a page-relative URL to this card's face render, when it exists."""
    return find_face(card.get("art") or card["name"], art_dir)


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


def render_card(card: dict[str, Any], art_dir: Path) -> str:
    """Lay out one shipped face image with the card's printed data beside it."""
    affinities = card_affinities(card)
    affinity = affinities[0] if affinities else "Neutral"
    accent = AFFINITY_ACCENT.get(affinity, AFFINITY_ACCENT["Neutral"])
    badge_fg = AFFINITY_BADGE_FG.get(affinity, "#050403")
    dot_fill, dot_glow = RARITY_DOT.get(card["rarity"], RARITY_DOT["common"])
    badge = f"{card['card_type']} // {card['subtype'] or affinity}".upper()
    name = html.escape(card["name"])

    face_src = find_art(card, art_dir)
    if face_src:
        face = (
            f'<img class="face" src="{html.escape(face_src)}" alt="{name}"'
            f' width="{TRIM_W}" height="{TRIM_H}" loading="lazy" decoding="async">'
        )
    else:
        face = f'<div class="face face-missing">{name}<br>FACE NOT RENDERED</div>'

    parts = [
        f'<article class="card" id="{html.escape(card["id"])}">',
        f'<div class="proof">{face}<div class="guides"><span>TRIM 63×88</span></div></div>',
        '<div class="meta">',
        f'<div class="meta-row"><span class="badge" style="background:{accent};'
        f'color:{badge_fg}">{badge}</span>{cost_pips(card["cost"] or "")}</div>',
        f'<h3 class="title">{html.escape(card["name"].upper())}</h3>',
    ]

    specs = ""
    stats = card_stats(card)
    if stats:
        action, resilience = stats
        specs += (
            f'<span class="stat stat-act" style="border-color:{accent}">{action}<i>ACT</i></span>'
            f'<span class="stat stat-res" style="border-color:{accent}">'
            f"{resilience}<i>RES</i></span>"
        )
    if "Resource" in card["card_type"]:
        # The affinities this Resource produces, mirroring the renderer's rule.
        for symbol in (a for a in affinities if a in COST_AFFINITY.values()):
            specs += (
                f'<img class="resource-icon" src="../art/resources/{symbol.lower()}.svg"'
                f' alt="{symbol}">'
            )
    if specs:
        parts.append(f'<div class="specs">{specs}</div>')

    body = ""
    if card.get("keyword"):
        body += f"<strong>{html.escape(card['keyword'])}</strong>"
        if card["rules_text"]:
            body += " "
    body += html.escape(card["rules_text"])
    if body:
        parts.append(f'<div class="rules">{body}</div>')
    if card.get("flavor_text"):
        parts.append(f'<div class="fable">// {html.escape(card["flavor_text"])}</div>')

    set_id = html.escape(card["id"].replace("-", " · "))
    parts += [
        f'<div class="footer"><span class="set-id">{set_id}</span>'
        f'<span class="rarity"><i style="background:{dot_fill};'
        f'box-shadow:0 0 0 3px {dot_glow}"></i>{html.escape(card["rarity"].upper())}</span></div>',
        "</div></article>",
    ]
    return "".join(parts)


def render_back(art_dir: Path) -> str:
    """Lay out the shared card back's shipped render."""
    face_src = find_face(BACK_STEM, art_dir)
    if face_src:
        face = (
            f'<img class="face" src="{html.escape(face_src)}" alt="Card back"'
            f' width="{TRIM_W}" height="{TRIM_H}" loading="lazy" decoding="async">'
        )
    else:
        face = '<div class="face face-missing">CARD BACK<br>FACE NOT RENDERED</div>'
    return (
        '<article class="card card-back" id="card-back">'
        f'<div class="proof">{face}<div class="guides"><span>TRIM 63×88</span></div></div>'
        '<div class="meta"><h3 class="title">CARD BACK</h3>'
        '<div class="rules">Shared by every deck; one render for the whole set.</div>'
        "</div></article>"
    )


def render_html(
    payload: dict[str, Any],
    geometry: dict[str, Any],
    art_dir: Path,
    show_guides: bool,
    show_fable: bool,
) -> str:
    """Render the proof sheet: every shipped face grouped by section, plus the back.

    `geometry` no longer reaches the page — the faces are pre-rendered by
    scripts/render_card_pngs.py, which owns the frame geometry outright — but the
    parameter stays because the public signature is pinned by the test suite.
    """
    del geometry  # the shipped bitmaps already carry the frame
    meta = payload["set"]
    cards = payload["cards"]
    frame = meta.get("frame", "Node Runner")
    trim_mm = meta.get("trim_mm") or [63, 88]
    bleed_mm = meta.get("bleed_mm", 3)
    dpi = meta.get("dpi", 300)

    groups: dict[str, list[dict[str, Any]]] = {}
    order: dict[str, int] = {}
    for card in cards:
        section = card.get("group") or SECTION_NAMES.get(card["card_type"], card["card_type"])
        if section not in order:
            order[section] = SECTION_RANK.get(section, len(SECTION_RANK) + len(order))
        groups.setdefault(section, []).append(card)

    sections = []
    for name in sorted(groups, key=order.__getitem__):
        faces = "".join(render_card(card, art_dir) for card in groups[name])
        sections.append(
            f'<section class="group"><h2>{html.escape(name)} · {len(groups[name])}</h2>'
            f'<div class="sheet">{faces}</div></section>'
        )
    sections.append(
        '<section class="group"><h2>Card back</h2>'
        f'<div class="sheet">{render_back(art_dir)}</div></section>'
    )

    body_class = " ".join(
        filter(None, ["" if show_guides else "no-guides", "" if show_fable else "no-fable"])
    )
    trim = f"{trim_mm[0]} × {trim_mm[1]} mm"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7931a">
  <meta name="description"
    content="Every shipped Edition One card face in the {frame} frame, laid out for proofing.">
  <title>600B Timelock TCG — {frame} Frame</title>
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
    .intro code {{ font-family: var(--mono); font-size: .85em; }}
    .group {{ display: flex; flex-direction: column; gap: 16px; }}
    .group h2 {{
      margin: 0;
      font: 400 30px Anton600, Impact, sans-serif;
      text-transform: uppercase;
    }}
    .sheet {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 28px;
      align-items: start;
    }}

    /* One shipped face. The render IS the card; the page only lays it out. */
    .card {{
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 10px 10px 16px;
      background: var(--card-bg);
      box-shadow: 0 8px 24px rgba(0, 0, 0, .25);
    }}
    .proof {{ position: relative; }}
    .face {{ display: block; width: 100%; height: auto; }}
    .face-missing {{
      aspect-ratio: {TRIM_W} / {TRIM_H};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 24px;
      color: rgba(232, 223, 207, .35);
      border: 2px dashed rgba(232, 223, 207, .18);
      font: 400 13px/1.8 var(--mono);
      letter-spacing: .1em;
      text-align: center;
      text-transform: uppercase;
    }}
    /* The web face is trimmed to the cut line, so the guide is its exact edge. */
    .guides {{
      position: absolute;
      inset: 0;
      border: 1px dashed rgba(0, 210, 255, .7);
      pointer-events: none;
    }}
    .guides span {{
      position: absolute;
      right: 6px;
      top: 4px;
      color: rgba(0, 210, 255, .9);
      font: 400 10px var(--mono);
      letter-spacing: .16em;
    }}

    /* The card's locked data, set as data — never as a second frame. */
    .meta {{ display: flex; flex-direction: column; gap: 8px; padding: 0 4px; }}
    .meta-row {{ display: flex; align-items: center; justify-content: space-between; gap: 10px; }}
    .badge {{ padding: 3px 9px; font: 400 10px var(--mono); letter-spacing: .22em; }}
    .title {{ margin: 0; color: var(--cream); font: 400 14px var(--mono); letter-spacing: .08em; }}
    .cost {{ display: flex; align-items: center; gap: 5px; }}
    .cost .generic {{
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--ink);
      border: 2px solid rgba(255, 247, 236, .7);
      color: var(--cream);
      font: 400 13px var(--mono);
    }}
    .cost img {{ width: 18px; height: 18px; }}
    .cost.pips-only img {{ width: 20px; height: 20px; }}
    .specs {{ display: flex; align-items: center; gap: 6px; }}
    .stat {{
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      padding: 2px 7px;
      border: 1px solid var(--cream);
      color: var(--cream);
      font: 400 12px var(--mono);
    }}
    .stat i {{ font-style: normal; font-size: 9px; letter-spacing: .12em; color: var(--orange); }}
    /* ACT left, RES pushed right — as the plates sit on the face. */
    .stat-act {{ margin-right: auto; }}
    .resource-icon {{ width: 20px; height: 20px; }}
    .rules {{ color: var(--bone); font-size: 13px; line-height: 1.45; }}
    .rules strong {{ color: var(--cream); }}
    .fable {{ color: rgba(232, 223, 207, .5); font: italic 400 11px/1.4 var(--mono); }}
    .footer {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 2px;
      color: rgba(232, 223, 207, .6);
      font: 400 10px var(--mono);
      letter-spacing: .18em;
    }}
    .rarity {{ display: flex; align-items: center; gap: 7px; }}
    .rarity i {{ display: inline-block; width: 9px; height: 9px; border-radius: 50%; }}
    .no-guides .guides {{ display: none; }}
    .no-fable .fable {{ display: none; }}

    /* Print one face per page at true cut size. The web face carries no bleed;
       the full-bleed 69mm x 94mm print masters live in art/cards/node-runner-print/. */
    @media print {{
      @page {{ size: 69mm 94mm; margin: 3mm; }}
      html, body {{ background: #fff; }}
      .page {{ padding: 0; gap: 0; }}
      .lede, .group h2, .meta {{ display: none; }}
      .sheet {{ display: block; }}
      .card {{ padding: 0; background: none; box-shadow: none; break-after: page; }}
      .face {{ width: 63mm; height: 88mm; }}
    }}
  </style>
</head>
<body class="{body_class}">
  <main class="page">
    <div class="lede">
      <div class="eyebrow">600B TIMELOCK TCG · EDITION ONE · {frame.upper()} FRAME</div>
      <h1>The proof sheet</h1>
      <p class="intro">All {len(cards)} shipped card faces plus the shared back — the
      files themselves, never a re-drawing. Each face below is the exact render written
      by <code>scripts/render_card_pngs.py</code>, the single authority on card
      geometry: the per-card art rectangle, the ink-anchored title ladder and the text
      plate are its decisions, recorded in
      <code>art/cards/{art_dir.name}/face-geometry.json</code> and shipped as these
      bitmaps. This page lays the renders out and prints each card's locked data
      beside its face, so a proof pass checks the render against the text with no
      layer in between that could drift. Web faces are trimmed to the {trim} cut line
      at {dpi} dpi; print masters keep the full {bleed_mm} mm bleed in
      <code>art/cards/node-runner-print/</code>.
      <a href="cards.html">All {meta["card_count"]} catalog cards →</a></p>
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
    """Build site/e1-card-set.html from the shipped Edition One face renders."""
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=Path, default=repo_root / "cards" / "e1-cards.json")
    parser.add_argument("--promos", type=Path, default=repo_root / "cards" / "promos.json")
    parser.add_argument("--out", type=Path, default=repo_root / "site" / "e1-card-set.html")
    parser.add_argument(
        "--art-dir", type=Path, default=repo_root / "art" / "cards" / "node-runner-web"
    )
    parser.add_argument("--no-guides", action="store_true", help="hide the trim guides")
    parser.add_argument("--no-fable", action="store_true", help="hide flavor text")
    parser.add_argument("--audit-db", type=Path, default=repo_root / ".audit" / "e1-design.sqlite")
    args = parser.parse_args()

    payload = json.loads(args.cards.read_text(encoding="utf-8"))
    cards = list(payload["cards"])
    if len(cards) != payload["set"]["card_count"]:
        raise ValueError("card count does not match the locked set header")
    # The promo carries the same frame and ships from the same render run, so the
    # proof sheet shows it too, in its own section.
    if args.promos and args.promos.exists():
        promos = json.loads(args.promos.read_text(encoding="utf-8"))["cards"]
        cards += [{**card, "group": "Promos"} for card in promos]
    payload = {**payload, "cards": cards}
    unknown = [
        card["id"] for card in cards if any(a not in AFFINITY_ACCENT for a in card_affinities(card))
    ]
    if unknown:
        raise ValueError(f"unknown affinity on {', '.join(unknown)}")

    record_site_decision(args.audit_db, payload, args.out)
    # A proof sheet that points at faces which were never rendered is the drift
    # this page exists to rule out, so a missing face fails the build outright.
    missing = [card["id"] for card in cards if not find_art(card, args.art_dir)]
    if not find_face(BACK_STEM, args.art_dir):
        missing.append(BACK_STEM)
    if missing:
        shown = ", ".join(missing[:5]) + (", …" if len(missing) > 5 else "")
        raise SystemExit(
            f"{len(missing)} faces have no render in {args.art_dir} ({shown}); "
            "run scripts/render_card_pngs.py --format webp first"
        )
    markup = render_html(
        payload,
        {},
        args.art_dir,
        show_guides=not args.no_guides,
        show_fable=not args.no_fable,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(markup, encoding="utf-8")
    complete_site_decision(args.audit_db, args.out)
    print(f"wrote {args.out} with {len(cards)} shipped faces + the card back")


if __name__ == "__main__":
    main()
