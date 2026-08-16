"""Brand the characters\' circular plaques with the 600 billion logo.

The mark is the FULL logo -- orange circle and digit rows -- composited
deliberately smaller than the surface it sits on, per the owner\'s direction.
Tracking is geometric, not chromatic: a circle is found where the image
gradient aligns radially around a ring, which works equally on a glowing
disc, a dark display and a low-contrast suit patch, and ignores lightning
(streaks have no radial ring). Positions are tracked per frame in a window
around a velocity prediction, gated on lock quality, interpolated where
rejected, and smoothed.

Runs on rendered segments (1280x720, trimmed, retimed), coordinates in
segment space.
"""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
LOGO = ROOT / "art" / "brand" / "600B-logo-primary.png"


def full_logo() -> Image.Image:
    """The complete logo as an RGBA stamp, cropped to its own ink."""
    with Image.open(LOGO) as logo:
        rgba = logo.convert("RGBA")
    bbox = rgba.split()[3].getbbox()
    return rgba.crop(bbox)


def gray_field(small):
    """Luma as a flat list plus dimensions."""
    g = small.convert("L")
    return list(g.getdata()), g.size[0], g.size[1]


def circle_score(data, w, h, cx: float, cy: float, radius: float, samples: int = 32) -> float:
    """Mean |radial gradient| on the ring around (cx, cy).

    A true circle edge has its gradient pointing along the radius at every
    angle, whatever its polarity. Streaks, corners and texture average out.
    """
    total = 0.0
    for k in range(samples):
        ang = 2 * math.pi * k / samples
        dx, dy = math.cos(ang), math.sin(ang)
        x, y = cx + radius * dx, cy + radius * dy
        ix, iy = int(x), int(y)
        if ix < 1 or iy < 1 or ix >= w - 1 or iy >= h - 1:
            return 0.0
        gx = data[iy * w + ix + 1] - data[iy * w + ix - 1]
        gy = data[(iy + 1) * w + ix] - data[(iy - 1) * w + ix]
        total += abs(gx * dx + gy * dy)
    return total / samples


def sweep(small, radii, step: int = 4, top: int = 8):
    """Best non-overlapping circle candidates over a whole frame."""
    data, w, h = gray_field(small)
    hits = []
    for r in radii:
        r_i = int(r)
        for cy in range(r_i + 2, h - r_i - 2, step):
            for cx in range(r_i + 2, w - r_i - 2, step):
                s = circle_score(data, w, h, cx, cy, r, samples=20)
                if s > 26:
                    hits.append((s, cx, cy, r))
    hits.sort(reverse=True)
    picked = []
    for s, cx, cy, r in hits:
        if all((cx - px) ** 2 + (cy - py) ** 2 > (max(r, pr) * 1.6) ** 2 for _, px, py, pr in picked):
            picked.append((s, cx, cy, r))
        if len(picked) >= top:
            break
    return picked


def refine(data, w, h, cx: float, cy: float, radius: float):
    """Best (score, x, y, r) in a small neighbourhood, sub-stepped."""
    best = (0.0, cx, cy, radius)
    for r in (radius * 0.88, radius, radius * 1.12):
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                s = circle_score(data, w, h, cx + dx, cy + dy, r)
                if s > best[0]:
                    best = (s, cx + dx, cy + dy, r)
    return best


def track_circle(frames: list, seed: tuple, r0: float):
    """Per-frame circle lock with velocity prediction; returns path + quality."""
    raw = []
    cx, cy = float(seed[0]) / 2, float(seed[1]) / 2
    vx = vy = 0.0
    r = r0 / 2
    for frame_path in frames:
        with Image.open(frame_path) as full:
            small = full.convert("RGB").resize((full.width // 2, full.height // 2))
        data, w, h = gray_field(small)
        px, py = cx + vx, cy + vy
        best = (0.0, px, py, r)
        for wy in range(-9, 10, 3):
            for wx in range(-9, 10, 3):
                s = circle_score(data, w, h, px + wx, py + wy, r)
                if s > best[0]:
                    best = (s, px + wx, py + wy, r)
        best = refine(data, w, h, best[1], best[2], best[3])
        if best[0] > 22:
            nx, ny = best[1], best[2]
            vx, vy = 0.6 * (nx - cx), 0.6 * (ny - cy)
            cx, cy, r = nx, ny, best[3] * 0.3 + r * 0.7
            raw.append((cx * 2, cy * 2, r * 2))
        else:
            vx *= 0.5
            vy *= 0.5
            raw.append(None)
    xs = [p[0] if p else None for p in raw]
    ys = [p[1] if p else None for p in raw]
    rs = [p[2] if p else None for p in raw]
    for series, fallback in ((xs, float(seed[0])), (ys, float(seed[1])), (rs, r0)):
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
    accepted = sum(1 for p in raw if p is not None) / max(1, len(raw))
    return list(zip(smooth(xs, 7), smooth(ys, 7), smooth(rs, 13))), accepted


def smooth(series: list, window: int = 7) -> list:
    """Centered moving average; the ends shrink their window."""
    half = window // 2
    out = []
    for i in range(len(series)):
        lo, hi = max(0, i - half), min(len(series), i + half + 1)
        out.append(sum(series[lo:hi]) / (hi - lo))
    return out


def brand_segment(segment: Path, discs: list[dict], fps: int) -> None:
    """Track every configured plaque and composite the logo, smaller than it."""
    stamp = full_logo()
    ratio = stamp.height / stamp.width
    with tempfile.TemporaryDirectory() as raw_dir:
        frames_dir = Path(raw_dir)
        subprocess.check_call(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(segment), str(frames_dir / "f%05d.png")]
        )
        frames = sorted(frames_dir.glob("f*.png"))
        tracks = []
        for d in discs:
            path, accepted = track_circle(frames, d["seed"], float(d.get("r", 45)))
            label = f"  plaque at {d["seed"]}"
            if accepted < 0.5:
                print(f"{label}: lock {accepted:.0%}, skipped")
                continue
            print(f"{label}: lock {accepted:.0%}")
            tracks.append((path, float(d.get("scale", 0.72))))
        for index, frame_path in enumerate(frames):
            with Image.open(frame_path) as full:
                frame = full.convert("RGB")
            for path, rel in tracks:
                x, y, r = path[index]
                width = max(16, int(2 * r * rel))
                scaled = stamp.resize((width, int(width * ratio)), Image.LANCZOS)
                faded = scaled.copy()
                faded.putalpha(scaled.split()[3].point(lambda a: int(a * 0.92)))
                frame.paste(faded, (int(x - width / 2), int(y - faded.height / 2)), faded)
            frame.save(frame_path)
        branded = segment.with_name(segment.stem + "-branded.mp4")
        subprocess.check_call(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-framerate", str(fps), "-i", str(frames_dir / "f%05d.png"),
             "-vf", "format=yuv420p",
             "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an", str(branded)]
        )
        shutil.move(str(branded), str(segment))
