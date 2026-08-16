"""The 600 billion logo sting: matrix rain condenses into the mark.

Five seconds, procedural, stdlib + Pillow + ffmpeg -- the same deal as every
other asset in this pipeline: sources, not exports. The vocabulary is the
card frame's own: soot black, Bitcoin orange, ultraviolet accents, digit
rain, a clockwork gear, a circuit ring that draws itself. Phases:

  0.0-1.6  digit rain falls; a gear fades in, turning slowly
  1.2-3.0  the rain inside the mark's radius condenses; the orange disc and
           its digit rows materialize row by row
  2.8-4.2  a circuit ring draws itself around the disc; ticks and nodes pop
  4.0-5.0  600B TIMELOCK TCG settles beneath; hold

Audio: one riser into a low impact when the disc lands, clock ticks while
the ring draws, a soft close. Written to logo-sting.mp4 next to this file.
"""

from __future__ import annotations

import math
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
LOGO = ROOT / "art" / "brand" / "600B-logo-primary.png"
ICONS = ROOT / "art" / "resources" / "png"
RESOURCES = ("power", "bitcoin", "keys", "signal", "timelock")
ANTON = ROOT / "art" / "fonts" / "Anton-Regular.ttf"
OUT = Path(__file__).with_name("logo-opener.mp4" if "--opener" in __import__("sys").argv else "logo-sting.mp4")

import sys

OPENER = "--opener" in sys.argv
W, H, FPS = 1280, 720, 24
DUR = 2.8 if OPENER else 5.0
CX, CY, DISC_R = W // 2, 320, 150
SOOT = (9, 8, 11)
ORANGE = (247, 147, 26)
VIOLET = (116, 71, 184)
CREAM = (255, 247, 236)


def rng(seed: int):
    """Tiny deterministic LCG so every render is byte-stable."""
    state = seed & 0x7FFFFFFF

    def nxt() -> float:
        nonlocal state
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        return state / 0x7FFFFFFF

    return nxt


def ease(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def build_columns():
    """The rain: columns with speed, phase, and a violet minority."""
    r = rng(600)
    columns = []
    for x in range(16, W, 26):
        columns.append({
            "x": x,
            "speed": 130 + 320 * r(),
            "phase": r() * H,
            "violet": r() < 0.12,
            "chars": [("6" if r() < 0.25 else "0") for _ in range(40)],
        })
    return columns


def gear(draw: ImageDraw.ImageDraw, cx: int, cy: int, radius: int, angle: float, alpha: int):
    """A clockwork gear: ring, teeth, spokes, hub."""
    teeth = 14
    for k in range(teeth):
        a = angle + 2 * math.pi * k / teeth
        x0 = cx + (radius - 6) * math.cos(a)
        y0 = cy + (radius - 6) * math.sin(a)
        x1 = cx + (radius + 16) * math.cos(a)
        y1 = cy + (radius + 16) * math.sin(a)
        draw.line((x0, y0, x1, y1), fill=(*VIOLET, alpha), width=12)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
                 outline=(*VIOLET, alpha), width=6)
    for k in range(5):
        a = angle * 0.7 + 2 * math.pi * k / 5
        draw.line((cx, cy, cx + (radius - 14) * math.cos(a), cy + (radius - 14) * math.sin(a)),
                  fill=(*VIOLET, int(alpha * 0.7)), width=4)
    hub = radius // 4
    draw.ellipse((cx - hub, cy - hub, cx + hub, cy + hub), outline=(*VIOLET, alpha), width=5)


def ring_marks():
    """Ticks and nodes around the circuit ring, seeded once."""
    r = rng(600_000_000)
    marks = []
    for _ in range(26):
        marks.append((r() * 2 * math.pi, 0.5 + r() * 0.5, r() < 0.3))
    return marks


def extruded_text(text: str, font: ImageFont.FreeTypeFont, depth: int = 10) -> Image.Image:
    """Pseudo-3D block type: a dark extrusion stack under a lit face."""
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    bbox = probe.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0] + depth + 8, bbox[3] - bbox[1] + depth + 8
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for k in range(depth, 0, -1):
        shade = int(28 + 60 * (k / depth))
        d.text((4 + k - bbox[0], 4 + k - bbox[1]), text, font=font,
               fill=(shade, int(shade * 0.62), 8, 255))
    d.text((3 - bbox[0], 3 - bbox[1]), text, font=font, fill=(255, 200, 120, 255))
    d.text((4 - bbox[0], 4 - bbox[1]), text, font=font, fill=(255, 247, 236, 255))
    return img


def render_frames(frames_dir: Path) -> None:
    with Image.open(LOGO) as logo_src:
        logo = logo_src.convert("RGBA")
    bbox = logo.split()[3].getbbox()
    logo = logo.crop(bbox).resize((DISC_R * 2, DISC_R * 2), Image.LANCZOS)
    icons = []
    for name in RESOURCES:
        with Image.open(ICONS / f"{name}.png") as icon:
            icons.append(icon.convert("RGBA").resize((56, 56), Image.LANCZOS))
    anton_big = ImageFont.truetype(str(ANTON), 64)
    lockup = extruded_text("600B TIMELOCK TCG", anton_big)
    mono = ImageFont.truetype("consola.ttf", 22)
    columns = build_columns()
    marks = ring_marks()
    total = int(DUR * FPS)
    for f in range(total):
        t = f / FPS
        frame = Image.new("RGB", (W, H), SOOT)
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Rain: full field early, then it survives only OUTSIDE the mark.
        condense = ease((t - 0.7) / 0.9) if OPENER else ease((t - 1.2) / 1.2)
        for col in columns:
            base = (col["phase"] + t * col["speed"]) % (H + 400) - 200
            for k, ch in enumerate(col["chars"][:22]):
                y = base - k * 26
                if y < -20 or y > H + 20:
                    continue
                dist = math.hypot(col["x"] - CX, y - CY)
                inside = dist < DISC_R * 1.35
                fade = 1.0 - k / 22
                alpha = int(150 * fade)
                if inside:
                    alpha = int(alpha * (1.0 - condense))
                if alpha <= 4:
                    continue
                color = VIOLET if col["violet"] else ORANGE
                draw.text((col["x"], y), ch, font=mono, fill=(*color, alpha))

        # Gear behind the disc, always turning.
        if OPENER:
            gear_alpha = int(120 * ease((t - 0.2) / 0.6))
        else:
            gear_alpha = int(120 * ease((t - 0.5) / 0.9) * (1.0 - 0.45 * ease((t - 3.8) / 0.9)))
        if gear_alpha > 0:
            gear(draw, CX, CY, DISC_R + 62, t * 0.35, gear_alpha)

        # The disc lands: circular wipe reveal of the actual logo asset.
        reveal = ease((t - 0.9) / 0.9) if OPENER else ease((t - 1.5) / 1.2)
        if reveal > 0:
            mask = Image.new("L", logo.size, 0)
            md = ImageDraw.Draw(mask)
            rr = int(DISC_R * reveal)
            md.ellipse((DISC_R - rr, DISC_R - rr, DISC_R + rr, DISC_R + rr), fill=255)
            piece = logo.copy()
            piece.putalpha(Image.composite(logo.split()[3], mask, mask).point(lambda a: a))
            piece_mask = Image.composite(logo.split()[3], Image.new("L", logo.size, 0), mask)
            overlay.paste(logo, (CX - DISC_R, CY - DISC_R), piece_mask)

        # Circuit ring draws itself; ticks and nodes pop in mark order.
        ring_prog = ease((t - 1.6) / 0.9) if OPENER else ease((t - 2.8) / 1.2)
        if ring_prog > 0:
            radius = DISC_R + 30
            steps = int(140 * ring_prog)
            pts = []
            for k in range(steps + 1):
                a = -math.pi / 2 + 2 * math.pi * k / 140
                pts.append((CX + radius * math.cos(a), CY + radius * math.sin(a)))
            if len(pts) > 1:
                draw.line(pts, fill=(*ORANGE, 200), width=3)
            for angle, size, is_node in marks:
                frac = (angle + math.pi / 2) % (2 * math.pi) / (2 * math.pi)
                if frac > ring_prog:
                    continue
                px = CX + radius * math.cos(angle)
                py = CY + radius * math.sin(angle)
                if is_node:
                    rr = 5 * size + 2
                    draw.ellipse((px - rr, py - rr, px + rr, py + rr), fill=(*ORANGE, 255))
                else:
                    ox = 12 * size * math.cos(angle)
                    oy = 12 * size * math.sin(angle)
                    draw.line((px, py, px + ox, py + oy), fill=(*ORANGE, 255), width=4)

        # The five resources fly in and dock on the ring as it draws.
        ring_r = DISC_R + 30
        for idx, icon in enumerate([] if OPENER else icons):
            angle = -math.pi / 2 + 2 * math.pi * idx / 5
            arrive = ease((t - 2.6 - idx * 0.16) / 0.7)
            if arrive <= 0:
                continue
            flight = 1.0 - arrive
            px = CX + (ring_r + 260 * flight) * math.cos(angle)
            py = CY + (ring_r + 260 * flight) * math.sin(angle)
            node_r = 34
            draw.ellipse((px - node_r, py - node_r, px + node_r, py + node_r),
                         fill=(14, 12, 16, int(235 * arrive)),
                         outline=(*ORANGE, int(255 * arrive)), width=3)
            ic = icon.copy()
            ic.putalpha(icon.split()[3].point(lambda a: int(a * arrive)))
            overlay.paste(ic, (int(px - 28), int(py - 28)), ic)

        # Lockup: extruded 3D type rising into place.
        text_a = 0.0 if OPENER else ease((t - 4.0) / 0.6)
        if text_a > 0:
            piece = lockup.copy()
            piece.putalpha(lockup.split()[3].point(lambda a: int(a * text_a)))
            y = 580 + int(22 * (1 - text_a))
            overlay.paste(piece, (CX - lockup.width // 2, y), piece)

        frame.paste(overlay, (0, 0), overlay)
        # Bloom: the bright layer glows over itself.
        from PIL import ImageChops, ImageFilter
        glow = frame.filter(ImageFilter.GaussianBlur(6))
        frame = ImageChops.screen(frame, glow.point(lambda v: int(v * 0.45)))
        frame.save(frames_dir / f"f{f:05d}.png")


def render_sting_audio(path: Path) -> None:
    """Riser -> impact when the disc lands -> ring ticks -> soft close."""
    sr = 48000
    n = int(sr * DUR)
    seed = rng(0x600B)
    left = [0.0] * n
    right = [0.0] * n
    two_pi = 2 * math.pi
    riser_start, impact_at = (0.1, 0.9) if OPENER else (0.4, 1.6)
    for i in range(int(riser_start * sr), int(impact_at * sr)):
        t = i / sr
        rel = (t - riser_start) / (impact_at - riser_start)
        v = (seed() - 0.5) * 0.22 * rel * rel + 0.08 * rel * math.sin(two_pi * (160 + 500 * rel * rel) * t)
        left[i] += v
        right[i] += v * 0.96
    i0 = int(impact_at * sr)
    for i in range(i0, min(n, i0 + int(1.6 * sr))):
        dt = (i - i0) / sr
        hz = 70 * math.exp(-dt * 4) + 36
        v = (math.sin(two_pi * hz * dt) * math.exp(-dt * 2.6) + (seed() - 0.5) * math.exp(-dt * 28) * 0.7) * 0.5
        left[i] += v
        right[i] += v * 0.97
    for tick_t in ((1.8, 2.2) if OPENER else (2.9, 3.3, 3.7, 4.1)):
        i0 = int(tick_t * sr)
        for i in range(i0, min(n, i0 + int(0.12 * sr))):
            dt = (i - i0) / sr
            v = math.exp(-dt * 30) * 0.16 * math.sin(two_pi * 987.77 * dt)
            left[i] += v * 0.9
            right[i] += v
    i0 = int((2.3 if OPENER else 4.1) * sr)
    for i in range(i0, n):
        dt = (i - i0) / sr
        v = 0.2 * math.exp(-dt * 3) * (math.sin(two_pi * 130.81 * dt) + 0.5 * math.sin(two_pi * 196.0 * dt))
        left[i] += v
        right[i] += v
    with wave.open(str(path), "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        for lv, rv in zip(left, right):
            frames += struct.pack("<hh", int(max(-1, min(1, lv)) * 32767), int(max(-1, min(1, rv)) * 32767))
        w.writeframes(frames)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        frames_dir = Path(tmp)
        render_frames(frames_dir)
        sting = frames_dir / "sting.wav"
        render_sting_audio(sting)
        subprocess.check_call([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", str(FPS), "-i", str(frames_dir / "f%05d.png"),
            "-i", str(sting),
            "-c:v", "libx264", "-preset", "medium", "-crf", "17",
            "-vf", "format=yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
            str(OUT),
        ])
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
