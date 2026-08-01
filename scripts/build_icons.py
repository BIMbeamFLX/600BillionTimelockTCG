"""Rebuild the resource icons: the original glyphs, no containing circle, accent glow.

The circle was what made the old set indistinguishable — five identical outlines with
the identity hidden inside. The glyphs themselves were always distinct shapes, so
dropping the circle turns the glyph into the silhouette and frees it to fill the box.

The accent colour moves from the circle's stroke to a halo drawn behind the glyph:
the same shape stroked wide in the affinity colour and blurred, with the crisp cream
glyph on top. Two passes rather than a filter alone, so the icon still reads as a hard
edge in print where a pure blur would go muddy.
"""

import os

REPO = "G:/Github/TCG600nap"
OUT = f"{REPO}/art/resources"

ACCENT = {
    "power": "#FF6A00",
    "bitcoin": "#F3C244",
    "keys": "#7447B8",
    "signal": "#FFF7EC",
    "timelock": "#17BEBB",
}

# The halo is a LIGHTER tone of the glyph's own hue, so the edge lifts off the body
# instead of merging into it. Power and Keys already have canonical bright values in
# the design system (--orange-bright and --purple in site/play.html); the other three
# follow the same move toward white.
GLOW_COLOR = {
    "power": "#FFA733",
    "bitcoin": "#FFE08A",
    "keys": "#B991E4",
    "signal": "#FFFFFF",
    "timelock": "#5FF0EC",
}

# The original glyph bodies, lifted verbatim from the pre-redesign icons. `{c}` is the
# accent for the halo pass and `{f}` the fill for the crisp pass, so one body renders
# both. `scale` lets each glyph grow into the space the circle used to occupy.
GLYPH = {
    "power": (
        1.32,
        '<path fill="{f}" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"'
        ' d="M35.3 8 17.8 35.1h11.4L25.9 56 46.2 27.5H34.4L35.3 8Z"/>',
    ),
    "bitcoin": (
        1.24,
        '<g transform="translate(-3.2 -.7)">'
        '<path fill="{f}" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"'
        ' d="M23 15h14.2c8.1 0 12.8 3.8 12.8 10.2 0 4.1-2.2 7.2-6.2 8.8 5 1.4 7.7 4.7 7.7 9.5C51.5 51 46 55 37 55H23V15Zm8 7v9h5.2c4 0 5.8-1.4 5.8-4.6 0-3-1.9-4.4-5.8-4.4H31Zm0 16v10h6c4.4 0 6.4-1.7 6.4-5 0-3.4-2.2-5-6.5-5H31Z"/>'  # noqa: E501
        '<rect x="28" y="10" width="4" height="9" fill="{f}" stroke="{c}" stroke-width="{w}"/>'
        '<rect x="36" y="10" width="4" height="9" fill="{f}" stroke="{c}" stroke-width="{w}"/>'
        '<rect x="28" y="51" width="4" height="5" fill="{f}" stroke="{c}" stroke-width="{w}"/>'
        '<rect x="36" y="51" width="4" height="5" fill="{f}" stroke="{c}" stroke-width="{w}"/>'
        "</g>",
    ),
    "keys": (
        1.30,
        '<g transform="translate(.8 -1.2)">'
        '<path d="M20 37a11 11 0 1 1 10.2-15.2L53 44.6V52h-7v-5h-6v-5h-6.6l-3.2-3.2A11 11 0 0 1 20 37Z"'  # noqa: E501
        ' fill="none" stroke="{s}" stroke-width="{k}" stroke-linejoin="round"/>'
        '<circle cx="20" cy="26" r="3.5" fill="{f}" stroke="{c}" stroke-width="{w}"/>'
        "</g>",
    ),
    "signal": (
        1.28,
        '<g transform="translate(0 5.2)">'
        '<circle cx="32" cy="43" r="4" fill="{f}" stroke="{c}" stroke-width="{w}"/>'
        '<path d="M22 35a14 14 0 0 1 20 0M15 28a24 24 0 0 1 34 0M9 20a33 33 0 0 1 46 0"'
        ' fill="none" stroke="{s}" stroke-width="{k}" stroke-linecap="round"/>'
        "</g>",
    ),
    "timelock": (
        1.26,
        '<g transform="translate(0 .3)">'
        '<path d="M20 29v-6c0-7.2 5.4-13 12-13s12 5.8 12 13v6" fill="none"'
        ' stroke="{s}" stroke-width="{k}" stroke-linecap="round"/>'
        '<rect x="15" y="27" width="34" height="27" fill="none" stroke="{s}" stroke-width="{k}"/>'
        '<circle cx="32" cy="40.5" r="8" fill="none" stroke="{s}" stroke-width="{k2}"/>'
        '<path d="M32 35v6l4 3" fill="none" stroke="{s}" stroke-width="{k2}" stroke-linecap="round"/>'  # noqa: E501
        "</g>",
    ),
}

# One dial for the halo. Signal carries its own alpha because its accent IS cream,
# so a cream glow behind a cream glyph blows out where the others do not.
GLOW = {"blur": 1.5, "w": 4.5, "k": 8.5, "k2": 6.5, "alpha": 0.85, "signal_alpha": 0.5}

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
    <filter id="glow" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="{blur}" result="b"/>
    </filter>
  </defs>
  <g transform="translate(32 32) scale({scale}) translate(-32 -32)">
    <g filter="url(#glow)" opacity="{alpha}">{halo}</g>
    {crisp}
  </g>
</svg>
"""

os.makedirs(OUT, exist_ok=True)
for name, (scale, body) in GLYPH.items():
    accent = ACCENT[name]
    # Halo pass: everything painted in the accent and widened, then blurred.
    bright = GLOW_COLOR[name]
    halo = body.format(f=bright, c=bright, s=bright, w=GLOW["w"], k=GLOW["k"], k2=GLOW["k2"])
    # One colour, end to end: the glyph and its border are both the affinity value
    # the card already uses. The border is the blurred pass showing past the crisp
    # one, so the edge glows in the same hue instead of being outlined in a second.
    crisp = body.format(f=accent, c=accent, s=accent, w=1.2, k=5, k2=3)
    alpha = GLOW["signal_alpha"] if name == "signal" else GLOW["alpha"]
    svg = TEMPLATE.format(
        title=TITLE[name], scale=f"{scale:.2f}", halo=halo, crisp=crisp,
        alpha=alpha, blur=GLOW["blur"]
    )
    open(f"{OUT}/{name}.svg", "w", encoding="utf-8").write(svg)
    print(f"  {name}.svg  glyph {accent}  glow {bright}")
print("5 icons rebuilt: original glyphs, no circle, accent glow")
