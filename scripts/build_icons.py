"""Build the five resource icons in the card frame's own drawing language.

The frame is thin single-weight line, right angles, and a small filled node at
every junction — see the letterbox rails and the circuit ring in
`render_card_pngs.paint_frame`, which draw 2px links with r4 dots. Earlier icon
passes ignored that and produced heavy filled glyphs inside a container, so a
symbol read as something stuck onto the card rather than something drawn by the
same hand.

These are built from the frame's vocabulary: one stroke weight, round terminals,
a node where a line begins or meets another, and a shine rather than a glow — a
single lighter-toned pass at low alpha, tight enough that it reads as sheen on the
line instead of fog around it.

Timelock is a clock, not a padlock. A key and a padlock are the same idea to a
player, and Keys already owns that idea; duration is what Timelock actually means.
"""

from __future__ import annotations

import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO_ROOT, "art", "resources")

ACCENT = {
    "power": "#FF6A00",
    "bitcoin": "#F3C244",
    "keys": "#7447B8",
    "signal": "#FFF7EC",
    "timelock": "#17BEBB",
}

# The shine is a lighter tone of the glyph's own hue. Power and Keys reuse the
# design system's own bright values (--orange-bright, --purple in site/play.html).
SHINE = {
    "power": "#FFA733",
    "bitcoin": "#FFE08A",
    "keys": "#B991E4",
    "signal": "#FFFFFF",
    "timelock": "#5FF0EC",
}

# One weight for every line in every icon, matching the frame's 2px links once an
# icon is drawn at pip size. NODE is the frame's r4 junction dot, scaled to match.
W = 4.0
NODE = 3.4
SHINE_BLUR = 0.7
SHINE_ALPHA = 0.5

# Each body is drawn twice: once as the shine pass, once crisp. `{c}` is the colour
# and `{w}` the weight, so one description renders both.
BODY = {
    # A bolt as an open zigzag rather than a filled arrow, with a node at each end.
    "power": (
        '<path d="M43 6 17 34h16L21 58" fill="none" stroke="{c}" stroke-width="{w}"'
        ' stroke-linecap="round" stroke-linejoin="round"/>'
        '<circle cx="43" cy="6" r="{n}" fill="{c}"/>'
        '<circle cx="21" cy="58" r="{n}" fill="{c}"/>'
    ),
    # The mark drawn as line: one stem, two open bowls, the four ticks kept.
    "bitcoin": (
        '<path d="M25 13v38M25 17h12a8 8 0 0 1 0 16H25M25 33h14a8 8 0 0 1 0 16H25"'
        ' fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round"'
        ' stroke-linejoin="round"/>'
        '<path d="M31 7v6M39 7v6M31 51v6M39 51v6" fill="none" stroke="{c}"'
        ' stroke-width="{w}" stroke-linecap="round"/>'
        '<circle cx="25" cy="13" r="{n}" fill="{c}"/>'
        '<circle cx="25" cy="51" r="{n}" fill="{c}"/>'
    ),
    # Ring, shaft, two teeth. The bow is a node, the way the frame terminates a run.
    "keys": (
        '<circle cx="21" cy="22" r="10" fill="none" stroke="{c}" stroke-width="{w}"/>'
        '<path d="M28 29 52 53M40 41l-6 6M46 47l-6 6" fill="none" stroke="{c}"'
        ' stroke-width="{w}" stroke-linecap="round"/>'
        '<circle cx="21" cy="22" r="{n}" fill="{c}"/>'
        '<circle cx="52" cy="53" r="{n}" fill="{c}"/>'
    ),
    # Three arcs from one node: the frame's own idea of a link leaving a junction.
    "signal": (
        '<path d="M19 39a18 18 0 0 1 26 0M11 30a30 30 0 0 1 42 0M4 21a41 41 0 0 1 56 0"'
        ' fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round"/>'
        '<circle cx="32" cy="50" r="{n2}" fill="{c}"/>'
    ),
    # A clock: duration, which is what Timelock means. Not a lock — Keys owns that.
    "timelock": (
        '<circle cx="32" cy="32" r="23" fill="none" stroke="{c}" stroke-width="{w}"/>'
        '<path d="M32 32V18M32 32l11 7" fill="none" stroke="{c}" stroke-width="{w}"'
        ' stroke-linecap="round"/>'
        '<path d="M32 9v4M55 32h-4M32 55v-4M9 32h4" fill="none" stroke="{c}"'
        ' stroke-width="{w}" stroke-linecap="round"/>'
        '<circle cx="32" cy="32" r="{n}" fill="{c}"/>'
    ),
}

TITLE = {
    "power": "Power",
    "bitcoin": "Bitcoin",
    "keys": "Keys",
    "signal": "Signal",
    "timelock": "Timelock",
}

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"
     role="img" aria-labelledby="title">
  <title id="title">{title} resource</title>
  <defs>
    <filter id="shine" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="{blur}"/>
    </filter>
  </defs>
  <g filter="url(#shine)" opacity="{alpha}">{shine}</g>
  {crisp}
</svg>
"""


def build() -> None:
    """Write the five icons."""
    os.makedirs(OUT, exist_ok=True)
    for name, body in BODY.items():
        accent, shine_colour = ACCENT[name], SHINE[name]
        shine = body.format(c=shine_colour, w=W + 1.6, n=NODE + 0.8, n2=5.2)
        crisp = body.format(c=accent, w=W, n=NODE, n2=4.4)
        svg = TEMPLATE.format(
            title=TITLE[name],
            blur=SHINE_BLUR,
            alpha=SHINE_ALPHA,
            shine=shine,
            crisp=crisp,
        )
        open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8").write(svg)
        print(f"  {name}.svg  line {W}  node {NODE}  {accent} / shine {shine_colour}")
    print("5 icons rebuilt in the frame's line-and-node language")


if __name__ == "__main__":
    build()
