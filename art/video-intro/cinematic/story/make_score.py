"""Render the orchestral score for the story cut. Stdlib only, fully derived.

The brief: epic, in the register of a big MMO opening -- low string ostinato,
horns that enter when the allies do, a held breath at the Timelock, war drums
into the clash, one true impact, and a major-key lift under the title. The
first bed was a static drone; this is a score that knows the cut: it reads
timeline.json for the shot map and placed.json for every spoken word, and
carves its own gain pockets under the speech so the mix never fights.

Tempo 96. C minor, ending on C major. Everything is additive synthesis --
detuned saw stacks for strings, round harmonic stacks for horns, formant-tilted
stacks for choir, pitched noise for drums -- because the repo ships sources,
not samples.
"""

from __future__ import annotations

import json
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "_work2"
OUT = WORK / "score.wav"
SR = 48000

C2 = 65.406
NOTE = {n: C2 * 2 ** (s / 12) for n, s in
        {"C": 0, "D": 2, "Eb": 3, "F": 5, "G": 7, "Ab": 8, "Bb": 10, "B": 11}.items()}


def chord(*names: str, octave: int = 0) -> list[float]:
    return [NOTE[n] * 2**octave for n in names]


def render() -> tuple[list[float], list[float]]:
    timeline = json.loads((WORK / "timeline.json").read_text("utf-8"))
    placed = json.loads((WORK / "placed.json").read_text("utf-8"))["lines"]
    shots: dict[str, float] = timeline["shots"]
    total: float = timeline["total"]
    n = int(SR * total)

    beat = 60 / 96  # tempo 96
    title = shots["TITLE"]

    # Harmony map: (start, chord, strings, horns, choir, drive 0..1)
    a, b, c = shots["A1"], shots["B1"], shots["C2"]
    clash = shots["C3"]
    sections = [
        (0.0, chord("C", "G"), 0.5, 0.0, 0.25, 0.10),
        (a, chord("C", "Eb", "G"), 0.7, 0.0, 0.3, 0.25),
        (shots["A2"], chord("Ab", "C", "Eb"), 0.75, 0.35, 0.3, 0.35),
        (shots["A3"], chord("F", "Ab", "C"), 0.8, 0.45, 0.35, 0.45),
        (shots["A4"], chord("Ab", "C", "Eb"), 0.8, 0.55, 0.4, 0.5),
        # The wait: open fifth, everything pulls back, the clock is loudest.
        (shots["A5"], chord("C", "G"), 0.45, 0.2, 0.5, 0.2),
        (b, chord("C", "Eb", "G"), 0.9, 0.6, 0.45, 0.7),
        (c, chord("C", "Eb", "G", "Bb"), 1.0, 0.85, 0.5, 0.9),
        (clash, chord("C", "G"), 0.55, 0.4, 0.6, 0.4),
        # Picardy: the future already works.
        (title, chord("C", "G", "C", "Eb"), 0.7, 0.5, 0.8, 0.3),
    ]
    # Title chord: raise the Eb a semitone by hand -> C major.
    sections[-1] = (title, [NOTE["C"], NOTE["G"], NOTE["C"] * 2, NOTE["E" "b"] * 2 * 2 ** (1 / 12)],
                    0.7, 0.5, 0.8, 0.3)

    def section_at(t: float):
        current = sections[0]
        for s in sections:
            if t >= s[0]:
                current = s
        return current

    # Percussion events: (time, kind) -- taiko on tension boundaries, doubled
    # pulse through C2, one true impact at the clash, soft close at the title.
    drums: list[tuple[float, str]] = [(b, "taiko"), (c, "taiko"), (clash, "impact"), (title, "soft")]
    t0 = c
    while t0 < clash - 0.2:
        drums.append((t0, "pulse"))
        t0 += beat
    riser_start = clash - 1.4

    # Speech pockets: music gives way where words live.
    pockets = [(item["start"] - 0.15, item["end"] + 0.1) for item in placed]

    def pocket_gain(t: float) -> float:
        for start, end in pockets:
            if start <= t <= end:
                edge = min(t - start, end - t)
                return 0.55 + 0.45 * max(0.0, 1.0 - edge / 0.12) if edge < 0.12 else 0.55
        return 1.0

    left = [0.0] * n
    right = [0.0] * n
    two_pi = 2 * math.pi

    # Sustained layers, rendered per chord tone with per-layer color.
    for start, tones, s_amp, h_amp, ch_amp, drive in sections:
        end = next((s[0] for s in sections if s[0] > start), total)
        i0, i1 = int(start * SR), min(n, int(end * SR))
        length = max(1, i1 - i0)
        for tone_idx, hz in enumerate(tones):
            phases = (0.13 * tone_idx, 0.61 * tone_idx, 1.07 * tone_idx)
            for i in range(i0, i1):
                t = i / SR
                rel = (i - i0) / length
                fade = min(1.0, rel * 24) * min(1.0, (1 - rel) * 24 + 0.25)
                # strings: three detuned saws, dark rolloff
                s_val = 0.0
                if s_amp:
                    for d, ph in zip((0.996, 1.0, 1.004), phases):
                        for h in range(1, 9):
                            s_val += math.sin(two_pi * hz * d * h * t + ph * h) / h**1.35
                    s_val *= s_amp * 0.030
                # horns: rounder stack, slow vibrato, only above the bass
                h_val = 0.0
                if h_amp and tone_idx > 0:
                    vib = 1 + 0.0035 * math.sin(two_pi * 5.1 * t)
                    for h in range(1, 6):
                        h_val += math.sin(two_pi * hz * vib * h * t) / h**0.9
                    h_val *= h_amp * 0.026 * min(1.0, rel * 6)
                # choir: octave up, formant-tilted (3rd/4th harmonics loud)
                c_val = 0.0
                if ch_amp:
                    for h, w in ((1, 0.5), (2, 0.7), (3, 1.0), (4, 0.8), (5, 0.3)):
                        c_val += w * math.sin(two_pi * hz * 2 * h * t + 0.4 * h)
                    c_val *= ch_amp * 0.012 * (0.75 + 0.25 * math.sin(two_pi * 0.11 * t))
                val = (s_val + h_val + c_val) * fade
                bass = 0.05 * drive * math.sin(two_pi * tones[0] / 2 * t) if tone_idx == 0 else 0.0
                left[i] += val + bass
                right[i] += (s_val * 0.94 + h_val * 1.05 + c_val + bass) * fade if fade else 0.0

    # Ostinato: eighth-note pulse on the root, driven by the section's energy.
    for i in range(n):
        t = i / SR
        start, tones, _s, _h, _c, drive = section_at(t)
        if drive < 0.2 or t >= title:
            continue
        step = (t - start) / (beat / 2)
        att = step - int(step)
        env = math.exp(-att * 7) * drive * 0.10
        note = tones[0] * (2 if int(step) % 4 == 2 else 1)
        val = env * math.sin(two_pi * note * t)
        left[i] += val
        right[i] += val * 0.92

    # The clock: quiet ticks on every shot boundary, loud through the wait.
    for shot_id, at in shots.items():
        loud = 0.16 if shot_id in ("A5", "B1") else 0.06
        i0 = int(at * SR)
        for i in range(i0, min(n, i0 + int(0.2 * SR))):
            dt = (i - i0) / SR
            v = math.exp(-dt * 20) * loud * (
                math.sin(two_pi * 523.25 * dt) + 0.6 * math.sin(two_pi * 130.81 * dt)
            )
            left[i] += v
            right[i] += v * 0.9
    wait_start, wait_end = shots["A5"], shots["B1"]
    tick = wait_start
    while tick < wait_end:
        i0 = int(tick * SR)
        for i in range(i0, min(n, i0 + int(0.15 * SR))):
            dt = (i - i0) / SR
            v = math.exp(-dt * 26) * 0.10 * math.sin(two_pi * 987.77 * dt)
            left[i] += v * 0.8
            right[i] += v
        tick += beat

    # Drums and the riser.
    seed = 0x600B
    def noise() -> float:
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed / 0x40000000 - 1.0

    for at, kind in drums:
        i0 = int(at * SR)
        if kind == "pulse":
            dur, amp = 0.22, 0.16
        elif kind == "taiko":
            dur, amp = 0.5, 0.34
        elif kind == "impact":
            dur, amp = 1.6, 0.55
        else:
            dur, amp = 1.2, 0.2
        for i in range(i0, min(n, i0 + int(dur * SR))):
            dt = (i - i0) / SR
            hz = 82 * math.exp(-dt * 5) + 38
            body = math.sin(two_pi * hz * dt) * math.exp(-dt * (3.2 if kind == "impact" else 9))
            snap = noise() * math.exp(-dt * 34) * 0.5
            v = (body + snap) * amp
            left[i] += v
            right[i] += v * 0.97
    i0 = int(riser_start * SR)
    for i in range(i0, min(n, int(shots["C3"] * SR))):
        dt = (i - i0) / SR
        rel = dt / 1.4
        v = (noise() * 0.16 + 0.1 * math.sin(two_pi * (200 + 700 * rel**2) * dt)) * rel**1.6
        left[i] += v
        right[i] += v

    # Pockets under the words, then a safe ceiling.
    peak = 0.0
    for i in range(n):
        g = pocket_gain(i / SR)
        left[i] *= g
        right[i] *= g
        peak = max(peak, abs(left[i]), abs(right[i]))
    norm = 0.86 / peak if peak > 0.86 else 1.0
    return [v * norm for v in left], [v * norm for v in right]


def main() -> None:
    left, right = render()
    with wave.open(str(OUT), "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for lv, rv in zip(left, right):
            frames += struct.pack(
                "<hh",
                int(max(-1.0, min(1.0, lv)) * 32767),
                int(max(-1.0, min(1.0, rv)) * 32767),
            )
        w.writeframes(frames)
    print(f"wrote {OUT} ({len(left) / SR:.1f}s)")


if __name__ == "__main__":
    main()
