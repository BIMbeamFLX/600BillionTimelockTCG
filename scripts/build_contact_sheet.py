"""Rebuild the rules-page contact sheet from the shipped card faces.

rules.html shows six iconic Edition One faces as one image. The sheet is
derived, never designed: it must always show the faces exactly as the
renderer last shipped them. It has drifted twice by being rebuilt by hand at
the wrong moment -- after this, a stale sheet is one command away from
honest, and the deploy checklist can call it.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FACES = ROOT / "art" / "cards" / "node-runner-web"
OUT = ROOT / "art" / "cards" / "600B-E1-iconic-six-contact-sheet.png"

# The six the rulebook has always shown: the first pipeline proofs.
NAMES = (
    "Genesis Lotus",
    "Satoshi Orchard",
    "FLX, Culture Curator",
    "Zap",
    "Next Block",
    "Multisig Quorum",
)
PAD, COLS, WIDTH = 24, 3, 1520


def build(out: Path) -> None:
    """Compose the 3x2 sheet and downscale to the page's delivery width."""
    tiles = [Image.open(FACES / f"{name}.webp").convert("RGB") for name in NAMES]
    w, h = tiles[0].size
    rows = -(-len(tiles) // COLS)
    sheet = Image.new("RGB", (COLS * w + (COLS + 1) * PAD, rows * h + (rows + 1) * PAD), (10, 9, 8))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (PAD + (i % COLS) * (w + PAD), PAD + (i // COLS) * (h + PAD)))
    target = (WIDTH, round(sheet.height * WIDTH / sheet.width))
    sheet = sheet.resize(target, Image.Resampling.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, {len(tiles)} faces)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    build(args.out)


if __name__ == "__main__":
    main()
