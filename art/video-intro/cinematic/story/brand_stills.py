"""Pre-brand the source stills so the video model does the tracking.

The lesson of this production, paid for in four tracker rewrites: compositing
a mark onto MOVING AI footage is fighting the medium. The winning move is to
put the mark into the SOURCE STILL -- perfectly, statically, once -- and let
Imagine animate a design that already carries it. The motion model preserves
baked-in props far better than any post overlay.

This writes branded copies of every story still into stills-branded/, logo
placed exactly like the film's verified positions (full logo, circle and
digits, deliberately smaller than the surface). Regenerate the clips from
these and the whole brand-tracking problem disappears.

Positions are in each STILL's own pixels (1280x720 keyframes scaled to the
still size at composite time would drift; these were re-read per still).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from brand_discs import full_logo

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "stills-branded"

# still file -> list of (cx, cy, width) in that still's pixel space.
# The stills are 1280x720 exports matching the clip framing at t=0.
PLACEMENTS: dict[str, list[tuple[int, int, int]]] = {
    "A2-bitcoin-sat.jpg": [(630, 272, 26), (750, 270, 27)],
    "A3-keys-blackcoffee.jpg": [(638, 220, 35)],
    "A4-signal-flx.jpg": [(632, 302, 46)],
    "A5-timelock-michael.jpg": [(656, 344, 35), (656, 472, 26)],
    "C2-charge.jpg": [(278, 263, 46), (615, 140, 44)],
    "C3-clash.jpg": [(456, 274, 46), (896, 307, 60)],
}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    stamp = full_logo()
    ratio = stamp.height / stamp.width
    done = 0
    for name, marks in PLACEMENTS.items():
        src = ROOT / name
        if not src.exists():
            print(f"  missing still: {name} (skipped)")
            continue
        with Image.open(src) as opened:
            image = opened.convert("RGB")
        for cx, cy, width in marks:
            scaled = stamp.resize((width, int(width * ratio)), Image.LANCZOS)
            faded = scaled.copy()
            faded.putalpha(scaled.split()[3].point(lambda a: int(a * 0.92)))
            image.paste(faded, (int(cx - width / 2), int(cy - faded.height / 2)), faded)
        target = OUT / name
        image.save(target, quality=95)
        done += 1
        print(f"  branded {name} ({len(marks)} marks)")
    print(f"{done} stills branded into {OUT}")


if __name__ == "__main__":
    main()
