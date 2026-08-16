"""Brand the empty orange chest discs with the 600 billion digit stack.

Some generated characters carry a blank glowing disc where FLX's canon
medallion shows 600 000 000 000. This module tracks each disc through its
shot -- an orange-blob search in a window around the last known center, EMA
smoothing for position and size -- and composites the logo's white digit
rows onto it, scaled to the disc, frame by frame. A static paste would slide
off the first time a character breathes; tracking is what makes it look lit
into the prop instead of stuck onto the film.

Runs on a rendered segment (already 1280x720, trimmed, retimed) so the
tracked coordinates live in final segment space.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
LOGO = ROOT / "art" / "brand" / "600B-logo-primary.png"


def digit_stack() -> Image.Image:
    """The logo's white digit rows as an RGBA stamp, background removed."""
    with Image.open(LOGO) as logo:
        rgba = logo.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    left, top, right, bottom = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 60 and r > 215 and g > 215 and b > 215:
                px[x, y] = (255, 255, 255, a)
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x), max(bottom, y)
            else:
                px[x, y] = (255, 255, 255, 0)
    if right <= left:
        raise ValueError("no white digits found in the logo")
    return rgba.crop((left, top, right + 1, bottom + 1))


def core_mask_integral(small, x0: int, y0: int, x1: int, y1: int):
    """Integral image of the hard orange-core mask over a search box."""
    px = small.load()
    w, h = x1 - x0, y1 - y0
    integral = [[0] * (w + 1) for _ in range(h + 1)]
    for j in range(h):
        row = integral[j + 1]
        prev = integral[j]
        acc = 0
        for i in range(w):
            r, g, b = px[x0 + i, y0 + j][:3]
            if r > 195 and g > 70 and b < 140 and r > b + 80:
                acc += 1
            row[i + 1] = prev[i + 1] + acc
    return integral


def box_sum(integral, x0: int, y0: int, x1: int, y1: int) -> int:
    return integral[y1][x1] - integral[y0][x1] - integral[y1][x0] + integral[y0][x0]


def match_disc(small, cx: float, cy: float, radius: float):
    """Find the disc as the best isolated round core near (cx, cy).

    A matched filter instead of a centroid chase: a candidate scores the
    orange core INSIDE the disc square and pays for orange in the ring around
    it. A chain, a gold coat or a lightning bolt next door lowers that
    candidate instead of dragging the estimate toward itself -- which is what
    every centroid variant did.
    """
    inner = max(4, int(radius * 0.85))
    ring = int(inner * 1.7)
    reach = int(radius * 1.6)
    x_lo = max(0, int(cx) - reach - ring)
    y_lo = max(0, int(cy) - reach - ring)
    x_hi = min(small.size[0], int(cx) + reach + ring)
    y_hi = min(small.size[1], int(cy) + reach + ring)
    if x_hi - x_lo < 2 * ring + 2 or y_hi - y_lo < 2 * ring + 2:
        return None
    integral = core_mask_integral(small, x_lo, y_lo, x_hi, y_hi)
    w, h = x_hi - x_lo, y_hi - y_lo
    best = None
    for gy in range(ring, h - ring):
        for gx in range(ring, w - ring):
            if abs(gx + x_lo - cx) > reach or abs(gy + y_lo - cy) > reach:
                continue
            core = box_sum(integral, gx - inner, gy - inner, gx + inner, gy + inner)
            around = box_sum(integral, gx - ring, gy - ring, gx + ring, gy + ring) - core
            score = core - 0.35 * around
            if best is None or score > best[0]:
                best = (score, gx, gy)
    if best is None or best[0] < (inner * 2) ** 2 * 0.20:
        return None
    _score, gx, gy = best
    # Sub-cell refinement: soft-gated centroid strictly INSIDE the winning
    # square, where nothing foreign can reach.
    px = small.load()
    sx = sy = weight = 0.0
    for j in range(gy - inner, gy + inner):
        for i in range(gx - inner, gx + inner):
            r, g, b = px[x_lo + i, y_lo + j][:3]
            if r > 150 and g > 45 and b < 160 and r > b + 50:
                # Radial falloff: a gold chain grazing the square's edge must
                # not out-vote the disc body at its center.
                d2 = ((i - gx) ** 2 + (j - gy) ** 2) / float(inner * inner)
                wgt = (r - 140) * max(0.0, 1.0 - d2)
                sx += (x_lo + i) * wgt
                sy += (y_lo + j) * wgt
                weight += wgt
    if weight <= 0:
        return float(x_lo + gx), float(y_lo + gy)
    return sx / weight, sy / weight


def smooth(series: list, window: int = 9) -> list:
    """Centered moving average; the ends shrink their window."""
    half = window // 2
    out = []
    for i in range(len(series)):
        lo, hi = max(0, i - half), min(len(series), i + half + 1)
        out.append(sum(series[lo:hi]) / (hi - lo))
    return out


def track(frames: list, seed: tuple, r0: float) -> list:
    """Matched-filter hits per frame, then interpolate the rejects and smooth."""
    raw = []
    cx, cy = float(seed[0]) / 2, float(seed[1]) / 2
    for frame_path in frames:
        with Image.open(frame_path) as full:
            small = full.convert("RGB").resize((full.width // 2, full.height // 2))
        hit = match_disc(small, cx, cy, r0 / 2)
        if hit is not None:
            cx, cy = hit
            raw.append((cx * 2, cy * 2))
        else:
            raw.append(None)
    xs = [r[0] if r else None for r in raw]
    ys = [r[1] if r else None for r in raw]
    for series, fallback in ((xs, float(seed[0])), (ys, float(seed[1]))):
        last = None
        for i, v in enumerate(series):
            if v is not None:
                if last is None and i > 0:
                    for j in range(i):
                        series[j] = v
                elif last is not None and i - last > 1:
                    for j in range(last + 1, i):
                        t = (j - last) / (i - last)
                        series[j] = series[last] * (1 - t) + v * t
                last = i
        if last is None:
            for i in range(len(series)):
                series[i] = fallback
        else:
            for j in range(last + 1, len(series)):
                series[j] = series[last]
    accepted = sum(1 for r in raw if r is not None) / max(1, len(raw))
    return list(zip(smooth(xs, 5), smooth(ys, 5))), accepted


def brand_segment(segment: Path, discs: list[dict], fps: int) -> None:
    """Track every configured disc and re-encode the segment with digits on."""
    stamp = digit_stack()
    stamp_ratio = stamp.height / stamp.width
    with tempfile.TemporaryDirectory() as raw_dir:
        frames_dir = Path(raw_dir)
        subprocess.check_call(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(segment), str(frames_dir / "f%05d.png")]
        )
        frames = sorted(frames_dir.glob("f*.png"))
        tracks = []
        for d in discs:
            path, accepted = track(frames, d["seed"], float(d.get("r", 45)))
            if accepted < 0.5:
                # No stable lock -> no brand. A digit stack parked on thin
                # air is worse than a disc left blank.
                print(f"  disc at {d['seed']}: lock {accepted:.0%}, skipped")
                continue
            print(f"  disc at {d['seed']}: lock {accepted:.0%}")
            tracks.append((path, float(d.get("r", 45))))
        for index, frame_path in enumerate(frames):
            with Image.open(frame_path) as full:
                frame = full.convert("RGB")
            for path, r0 in tracks:
                x, y = path[index]
                width = max(18, int(r0 * 1.15))
                scaled = stamp.resize((width, int(width * stamp_ratio)), Image.LANCZOS)
                faded = scaled.copy()
                faded.putalpha(scaled.split()[3].point(lambda a: int(a * 0.88)))
                frame.paste(
                    faded, (int(x - width / 2), int(y - faded.height / 2)), faded
                )
            frame.save(frame_path)
        branded = segment.with_name(segment.stem + "-branded.mp4")
        subprocess.check_call(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-framerate", str(fps), "-i", str(frames_dir / "f%05d.png"),
             "-vf", "format=yuv420p",
             "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an", str(branded)]
        )
        shutil.move(str(branded), str(segment))
