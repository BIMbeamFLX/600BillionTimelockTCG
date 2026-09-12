"""Tests for the rendered sound moments in site/fx/ and their wiring into fx.js."""

import io
import re
import struct
import wave
from pathlib import Path

import build_fx_samples

REPO_ROOT = Path(__file__).resolve().parents[1]
FX_DIR = REPO_ROOT / "site" / "fx"
RENDERED = build_fx_samples.render_all()


def samples_of(data: bytes) -> tuple[wave._wave_params, list[float]]:
    """Decode 16-bit mono PCM into floats."""
    with wave.open(io.BytesIO(data)) as handle:
        params = handle.getparams()
        frames = handle.readframes(params.nframes)
    values = struct.unpack(f"<{len(frames) // 2}h", frames)
    return params, [v / 32767 for v in values]


def test_the_committed_samples_are_what_the_script_renders():
    committed = sorted(path.stem for path in FX_DIR.glob("*.wav"))
    assert committed == sorted(RENDERED)
    for name, data in RENDERED.items():
        assert (FX_DIR / f"{name}.wav").read_bytes() == data, f"{name}.wav is stale"


def test_every_sample_is_mono_pcm_normalised_and_ends_in_silence():
    for name, data in RENDERED.items():
        params, values = samples_of(data)
        assert (params.nchannels, params.sampwidth, params.framerate) == (1, 2, build_fx_samples.RATE), name
        peak = max(abs(v) for v in values)
        assert 0.6 <= peak <= 0.9, (name, peak)  # headroom for fx.js's own mix
        assert abs(sum(values) / len(values)) < 0.01, f"{name} carries DC"
        assert max(abs(v) for v in values[-40:]) < 0.01, f"{name} is cut off instead of fading"


def test_durations_fit_the_moment_they_score():
    seconds = {name: len(samples_of(data)[1]) / build_fx_samples.RATE for name, data in RENDERED.items()}
    for name in ("slam", "whoosh", "hit"):
        assert seconds[name] < 0.6, (name, seconds[name])  # a card play or a blow must not smear
    assert seconds["lethal"] > seconds["impact"] > seconds["hit"]


def test_the_samples_stay_light():
    """The page was asset-free; the sound upgrade may cost a little, measured."""
    total = sum(len(data) for data in RENDERED.values())
    assert total <= 600 * 1024, f"{total // 1024} KB of samples"


def test_fx_js_loads_exactly_these_samples_and_every_event_has_an_audition():
    fx = (REPO_ROOT / "site" / "fx.js").read_text(encoding="utf-8")
    names = re.search(r"var SAMPLE_NAMES = \[([^\]]*)\]", fx).group(1)
    assert sorted(re.findall(r"'([a-z]+)'", names)) == sorted(RENDERED)
    events = re.findall(r"'([a-z]+:[A-Za-z]+)'", re.search(r"var EVENTS = Object\.freeze\(\[(.*?)\]\)", fx, re.S).group(1))
    assert "attack:strike" in events
    demo = (REPO_ROOT / "site" / "fx-demo.html").read_text(encoding="utf-8")
    auditioned = set(re.findall(r"\['([a-z]+:[A-Za-z]+)[ ']", demo))
    assert set(events) <= auditioned, sorted(set(events) - auditioned)


def test_the_referee_serves_wav_as_audio():
    table = (REPO_ROOT / "server" / "table.js").read_text(encoding="utf-8")
    assert '".wav": "audio/wav"' in table
