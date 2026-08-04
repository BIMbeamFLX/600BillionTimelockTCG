"""Build the five resource icons from the locked E1 "Plate" set.

Direction 1b "Plate" with the 2a "Forged" bitcoin, delivered in the 2026-08-02
art handoff (`art/Futuristic icon designs for crypto.zip`). Solid faceted
silhouettes with 45-degree chamfers, one flat fill per icon, no filters — built
to hold from the 128 px art use down to 16 px inline rules text, where the
earlier line-and-node drawing thinned into noise.

The geometry is the handoff's, verbatim. Do not redraw it here; a change to a
silhouette goes through the design side and comes back as a new locked set.

Timelock is a clock, not a padlock. A key and a padlock are the same idea to a
player, and Keys already owns that idea; duration is what Timelock actually means.
"""

from __future__ import annotations

import os

from build_card_set import AFFINITY_ACCENT

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO_ROOT, "art", "resources")

# The affinity hue has ONE definition, in build_card_set.AFFINITY_ACCENT, which
# is what paints the spine, type chip, circuit border and cost pips. The icons
# read it rather than restating it: a symbol drawn in a colour its own card no
# longer uses is a silent desync, and the palette was already duplicated across
# four scripts.
ACCENT = {
    name.lower(): AFFINITY_ACCENT[name]
    for name in ("Power", "Bitcoin", "Keys", "Signal", "Timelock")
}

# Locked silhouettes from the handoff. `{c}` is the affinity fill — the one
# colour each icon is allowed.
BODY = {
    # A faceted bolt: one solid strike, chamfered like the frame's corners.
    "power": '<path fill="{c}" d="M37 4 10 36h20l-3 24L54 26H33Z"/>',
    # The "Forged" mark: slab B with chamfered bowls, the four ticks kept.
    "bitcoin": (
        '<path fill="{c}" fill-rule="evenodd" d="M22 10H38L46 17V25L42 30L48 36V47'
        'L40 54H22ZM29 17H36L39 20V23L36 26H29ZM29 33H38L41 36V44L38 47H29Z"/>'
        '<path fill="{c}" d="M27 4h4v6h-4ZM35 4h4v6h-4ZM27 54h4v6h-4ZM35 54h4v6h-4Z"/>'
    ),
    # Hex-cut bow with a punched core, slab shaft, two square teeth, at 45 deg.
    "keys": (
        '<g transform="rotate(45 32 32)">'
        '<path fill="{c}" fill-rule="evenodd" d="M4 32 9.5 22.5h11L26 32l-5.5 9.5'
        'h-11ZM19 32a4 4 0 1 0-8 0 4 4 0 1 0 8 0Z"/>'
        '<path fill="{c}" d="M24 29h33v6H24ZM43 35h6v10h-6ZM52 35h5v10h-5Z"/>'
        "</g>"
    ),
    # Two chevron waves over a solid diamond emitter.
    "signal": (
        '<path fill="{c}" d="M32 5 57 25l-6 7-19-15-19 15-6-7ZM32 21l17 13-6 7'
        '-11-9-11 9-6-7ZM32 39l9 9-9 9-9-9Z"/>'
    ),
    # A clock in a hex plate: duration, which is what Timelock means.
    "timelock": (
        '<path fill="{c}" fill-rule="evenodd" d="M32 8 52.8 20v24L32 56 11.2 44V20'
        'ZM47 32a15 15 0 1 0-30 0 15 15 0 1 0 30 0Z"/>'
        '<path d="M32 33V21M32 33l8 5" fill="none" stroke="{c}" stroke-width="5"'
        ' stroke-linecap="square"/>'
        '<rect x="29.5" y="30.5" width="5" height="5" fill="{c}"/>'
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
  {body}
</svg>
"""


def build() -> None:
    """Write the five icons."""
    os.makedirs(OUT, exist_ok=True)
    for name, body in BODY.items():
        accent = ACCENT[name]
        svg = TEMPLATE.format(title=TITLE[name], body=body.format(c=accent))
        open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8").write(svg)
        print(f"  {name}.svg  plate fill {accent}")
    print("5 icons rebuilt from the locked Plate set")


if __name__ == "__main__":
    build()
