"""Render the table's key sound moments into site/fx/*.wav.

fx.js synthesises every cue live, which keeps the page asset-free and instant, but
live synthesis stops at what a browser can build per event: a handful of
oscillators and one noise burst. The moments that carry the rhythm of a game
deserve more. These are rendered offline, from a fixed seed, with the layering
that makes a hit a hit:

- a transient, and a damped body tuned like struck material;
- a sub drop, saturation, and a small room.

The output is deterministic: the same script writes the same bytes, so the WAVs
are reviewed like code. fx.js loads them when it can and falls back to its own
synthesis when it cannot (file://, offline, a failed decode).

    uv run python scripts/build_fx_samples.py            # write site/fx/*.wav
    uv run python scripts/build_fx_samples.py --check    # fail if a file is stale
"""

from __future__ import annotations

import argparse
import io
import math
import struct
import sys
import wave
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "fx"
RATE = 22050
TAU = 2 * math.pi

Signal = list[float]


class Rng:
    """A 32-bit LCG: the same noise on every machine, every run."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next(self) -> float:
        """A value in [-1, 1)."""
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 2147483648.0 - 1.0


def silence(seconds: float) -> Signal:
    """A buffer of zeros long enough for `seconds`."""
    return [0.0] * int(seconds * RATE)


def mix(target: Signal, source: Signal, gain: float = 1.0, at: float = 0.0) -> Signal:
    """Add `source` into `target` starting at `at` seconds, growing target if needed."""
    start = int(at * RATE)
    if len(target) < start + len(source):
        target.extend([0.0] * (start + len(source) - len(target)))
    for i, value in enumerate(source):
        target[start + i] += value * gain
    return target


def taper(signal: Signal, seconds: float = 0.012) -> Signal:
    """Bring the last `seconds` down to zero. A layer cut off mid-ring is a click."""
    n = min(len(signal), max(1, int(seconds * RATE)))
    for i in range(n):
        signal[-1 - i] *= i / n
    return signal


def envelope(n: int, attack: float, decay: float, curve: float = 1.0) -> Signal:
    """A struck envelope: linear rise over `attack` s, exponential fall with time constant `decay` s."""
    a = max(1, int(attack * RATE))
    out = []
    for i in range(n):
        if i < a:
            out.append((i / a) ** curve)
        else:
            out.append(math.exp(-(i - a) / (decay * RATE)))
    return taper(out)


def noise(seconds: float, rng: Rng) -> Signal:
    """White noise."""
    return [rng.next() for _ in range(int(seconds * RATE))]


def biquad(signal: Signal, kind: str, freq: float | Callable[[float], float], q: float = 0.707) -> Signal:
    """An RBJ biquad (lowpass, highpass, bandpass), optionally with a swept frequency."""
    out = []
    x1 = x2 = y1 = y2 = 0.0
    for i, x in enumerate(signal):
        f = freq(i / RATE) if callable(freq) else freq
        f = min(max(f, 20.0), RATE * 0.45)
        w0 = TAU * f / RATE
        alpha = math.sin(w0) / (2 * q)
        cosw = math.cos(w0)
        if kind == "lowpass":
            b0, b1, b2 = (1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2
        elif kind == "highpass":
            b0, b1, b2 = (1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2
        else:  # bandpass, constant peak gain
            b0, b1, b2 = alpha, 0.0, -alpha
        a0, a1, a2 = 1 + alpha, -2 * cosw, 1 - alpha
        y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, x, y1, y
        out.append(y)
    return out


def sweep_sine(seconds: float, f0: float, f1: float, glide: float) -> Signal:
    """A sine whose pitch falls (or rises) exponentially from f0 to f1 over `glide` s."""
    out = []
    phase = 0.0
    for i in range(int(seconds * RATE)):
        t = i / RATE
        f = f1 + (f0 - f1) * math.exp(-t / max(glide, 1e-4))
        phase += TAU * f / RATE
        out.append(math.sin(phase))
    return out


def modes(seconds: float, partials: list[tuple[float, float, float]], rng: Rng) -> Signal:
    """Struck material: damped sine partials (frequency, amplitude, decay s), random phases."""
    out = silence(seconds)
    for freq, amp, decay in partials:
        phase = (rng.next() + 1) * math.pi
        for i in range(len(out)):
            t = i / RATE
            out[i] += amp * math.exp(-t / decay) * math.sin(TAU * freq * t + phase)
    return taper(out)


def fm_bell(seconds: float, freq: float, ratio: float, index: float, decay: float) -> Signal:
    """A two-operator FM bell: bright at the strike, purer as the index decays."""
    out = []
    for i in range(int(seconds * RATE)):
        t = i / RATE
        env = math.exp(-t / decay)
        mod = math.sin(TAU * freq * ratio * t) * index * math.exp(-t / (decay * 0.35))
        out.append(env * math.sin(TAU * freq * t + mod))
    return taper(out)


def shape(signal: Signal, env: Signal) -> Signal:
    """Multiply a signal by an envelope of the same length (or shorter)."""
    return [s * (env[i] if i < len(env) else 0.0) for i, s in enumerate(signal)]


def saturate(signal: Signal, drive: float) -> Signal:
    """tanh saturation, level-compensated."""
    norm = math.tanh(drive)
    return [math.tanh(drive * s) / norm for s in signal]


def room(signal: Signal, size: float, wet: float, tail: float) -> Signal:
    """A small Schroeder room: four feedback combs into two allpasses, mixed under the dry."""
    padded = signal + [0.0] * int(tail * RATE)
    combs = [(int(RATE * d * size), g) for d, g in ((0.0297, 0.80), (0.0371, 0.78), (0.0411, 0.76), (0.0437, 0.74))]
    wet_sig = [0.0] * len(padded)
    for delay, feedback in combs:
        buffer = [0.0] * delay
        lp = 0.0
        for i, x in enumerate(padded):
            y = buffer[i % delay]
            lp = y * 0.6 + lp * 0.4  # damping: the high end dies first
            buffer[i % delay] = x + lp * feedback
            wet_sig[i] += y * 0.25
    for delay, g in ((int(RATE * 0.005), 0.7), (int(RATE * 0.0017), 0.7)):
        buffer = [0.0] * delay
        out = []
        for i, x in enumerate(wet_sig):
            y = buffer[i % delay]
            buffer[i % delay] = x + y * g
            out.append(y - g * x)
        wet_sig = out
    return [padded[i] + wet * wet_sig[i] for i in range(len(padded))]


def finish(signal: Signal, peak: float = 0.89, fade: float = 0.02, warmth: float = 6500) -> Signal:
    """Warm the top end, remove DC, normalise to `peak`, and fade out so nothing clicks.

    The house voice of fx.js is a warm terminal, not a bright one: a gentle
    lowpass keeps the saturation's fizz from sitting on top of every hit.
    """
    signal = biquad(signal, "lowpass", warmth, q=0.6)
    mean = sum(signal) / max(1, len(signal))
    out = [s - mean for s in signal]
    top = max((abs(s) for s in out), default=0.0) or 1.0
    out = [s * peak / top for s in out]
    n = int(fade * RATE)
    for i in range(min(n, len(out))):
        out[-1 - i] *= i / n
    return out


# --------------------------------------------------------------------- sounds


def slam() -> Signal:
    """A card slapped onto the table: a paper crack, a cardboard body, a thump."""
    rng = Rng(101)
    crack = shape(biquad(noise(0.06, rng), "highpass", 1800), envelope(int(0.06 * RATE), 0.0008, 0.009))
    body = modes(0.30, [(182, 0.9, 0.045), (431, 0.5, 0.030), (887, 0.28, 0.018), (1510, 0.14, 0.010)], rng)
    thump = shape(sweep_sine(0.25, 120, 52, 0.05), envelope(int(0.25 * RATE), 0.002, 0.06))
    out = mix(silence(0.3), crack, 0.8)
    mix(out, body, 0.55)
    mix(out, thump, 0.9)
    return finish(room(saturate(out, 1.6), 0.6, 0.18, 0.12))


def whoosh() -> Signal:
    """An Avatar lunging: air parting, rising and gone."""
    rng = Rng(202)
    n = int(0.26 * RATE)
    air = biquad(noise(0.26, rng), "bandpass", lambda t: 350 * (1 + 7 * (t / 0.26) ** 2), q=1.4)
    env = [math.sin(math.pi * min(1.0, i / n)) ** 1.6 for i in range(n)]
    return finish(room(shape(air, env), 0.4, 0.12, 0.08), peak=0.7)


def hit() -> Signal:
    """An Avatar struck: a crunchy transient over a short metal clank."""
    rng = Rng(303)
    crunch = shape(saturate(biquad(noise(0.08, rng), "bandpass", 2400, q=0.9), 3.0),
                   envelope(int(0.08 * RATE), 0.0006, 0.014))
    clank = modes(0.34, [(523, 0.6, 0.06), (1187, 0.45, 0.04), (1873, 0.3, 0.03), (2711, 0.2, 0.02)], rng)
    knock = shape(sweep_sine(0.2, 160, 70, 0.03), envelope(int(0.2 * RATE), 0.001, 0.04))
    out = mix(silence(0.34), crunch, 0.9)
    mix(out, clank, 0.45)
    mix(out, knock, 0.8)
    return finish(room(saturate(out, 1.8), 0.5, 0.2, 0.1))


def impact() -> Signal:
    """A player hit directly: the heaviest ordinary sound, a boom with grit."""
    rng = Rng(404)
    crack = shape(saturate(biquad(noise(0.1, rng), "highpass", 900), 2.5), envelope(int(0.1 * RATE), 0.0005, 0.02))
    sub = shape(sweep_sine(0.6, 140, 38, 0.07), envelope(int(0.6 * RATE), 0.002, 0.16))
    grit = shape(biquad(noise(0.5, rng), "lowpass", lambda t: 3000 * math.exp(-t / 0.08) + 180, q=1.1),
                 envelope(int(0.5 * RATE), 0.001, 0.09))
    out = mix(silence(0.6), crack, 0.8)
    mix(out, sub, 1.1)
    mix(out, grit, 0.55)
    return finish(room(saturate(out, 2.2), 0.9, 0.28, 0.25))


def shatter() -> Signal:
    """An Avatar decommissioned: it breaks into thinning digital shards and powers down."""
    rng = Rng(505)
    out = silence(0.85)
    t = 0.0
    step = 0.012
    while t < 0.62:
        grain = modes(0.05, [(2200 + 2600 * (rng.next() + 1) / 2, 0.8, 0.008)], rng)
        mix(out, grain, 0.5 * math.exp(-t / 0.25), at=t)
        t += step * (1 + 3 * t) * (1.3 + 0.7 * rng.next())
    powerdown = shape(sweep_sine(0.7, 660, 55, 0.18), envelope(int(0.7 * RATE), 0.004, 0.2))
    mix(out, [math.copysign(abs(s) ** 0.6, s) for s in powerdown], 0.45)  # a hard-edged tone
    crack = shape(biquad(noise(0.05, rng), "highpass", 2500), envelope(int(0.05 * RATE), 0.0005, 0.01))
    mix(out, crack, 0.7)
    return finish(room(out, 0.7, 0.3, 0.2))


def lethal() -> Signal:
    """The killing blow: a short swell, then the biggest boom in the game, and a long rumble."""
    rng = Rng(606)
    n = int(0.22 * RATE)
    swell = [rng.next() * (i / n) ** 3 for i in range(n)]
    swell = taper(biquad(swell, "bandpass", lambda t: 400 + 3000 * t / 0.22, q=0.8), 0.03)
    out = mix(silence(1.6), swell, 0.5)
    boom = impact()
    mix(out, boom, 1.0, at=0.22)
    rumble = shape(biquad(noise(1.3, rng), "lowpass", 140, q=0.9), envelope(int(1.3 * RATE), 0.02, 0.45))
    mix(out, rumble, 2.2, at=0.24)
    sub = shape(sweep_sine(1.2, 70, 30, 0.4), envelope(int(1.2 * RATE), 0.004, 0.4))
    mix(out, sub, 0.9, at=0.22)
    return finish(room(saturate(out, 1.4), 1.1, 0.25, 0.4))


def turn() -> Signal:
    """Your turn: two struck bells a fifth apart, C#5 then G#5, in the house key."""
    out = mix(silence(1.0), fm_bell(0.9, 554.37, 3.5, 2.2, 0.28), 0.6)
    mix(out, fm_bell(0.8, 830.61, 3.5, 1.8, 0.24), 0.45, at=0.09)
    return finish(room(out, 0.8, 0.3, 0.3), peak=0.75)


def victory() -> Signal:
    """A win: a rising C# minor-to-major arpeggio of bells over a warm root."""
    notes = [277.18, 329.63, 415.30, 554.37, 659.26, 830.61]
    out = silence(2.2)
    for i, freq in enumerate(notes):
        mix(out, fm_bell(1.2, freq, 2.0, 1.5, 0.35), 0.35, at=i * 0.11)
    mix(out, fm_bell(1.6, 1108.73, 3.0, 1.0, 0.5), 0.25, at=0.66)
    pad = shape(sweep_sine(1.6, 138.59, 138.59, 1.0), envelope(int(1.6 * RATE), 0.08, 0.6))
    mix(out, pad, 0.35, at=0.6)
    return finish(room(out, 1.0, 0.35, 0.5), peak=0.8)


def defeat() -> Signal:
    """A loss: a falling line that settles low, not a sting, and a machine winding down."""
    notes = [415.30, 369.99, 311.13, 277.18]
    out = silence(2.2)
    for i, freq in enumerate(notes):
        mix(out, fm_bell(1.0, freq, 1.41, 1.2, 0.4), 0.35, at=i * 0.2)
    drone = shape(sweep_sine(1.5, 110, 69.3, 0.8), envelope(int(1.5 * RATE), 0.1, 0.55))
    mix(out, drone, 0.5, at=0.5)
    return finish(room(out, 1.0, 0.35, 0.5), peak=0.75)


SOUNDS: dict[str, Callable[[], Signal]] = {
    "slam": slam,
    "whoosh": whoosh,
    "hit": hit,
    "impact": impact,
    "shatter": shatter,
    "lethal": lethal,
    "turn": turn,
    "victory": victory,
    "defeat": defeat,
}


def wav_bytes(signal: Signal) -> bytes:
    """16-bit mono PCM WAV at RATE."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in signal))
    return buffer.getvalue()


def render_all() -> dict[str, bytes]:
    """Every sound, rendered: name -> WAV bytes."""
    return {name: wav_bytes(build()) for name, build in SOUNDS.items()}


def main() -> None:
    """Write site/fx/*.wav, or with --check fail when one is stale."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = render_all()
    if args.check:
        stale = [n for n, data in rendered.items() if not (OUT / f"{n}.wav").exists() or (OUT / f"{n}.wav").read_bytes() != data]
        if stale:
            sys.exit(f"stale fx samples: {', '.join(stale)} — run scripts/build_fx_samples.py")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in rendered.items():
        (OUT / f"{name}.wav").write_bytes(data)
    total = sum(len(data) for data in rendered.values())
    print(f"wrote {len(rendered)} samples to {OUT.relative_to(ROOT)} ({total // 1024} KB)")


if __name__ == "__main__":
    main()
