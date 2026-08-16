"""Render every line in cues.LINES as speech. One engine, one voice per avatar.

Faster reads than the first pass, per the owner's note. Takes land in vo2/ so
the old set stays comparable; the file name carries the line index, speaker
and a hash of text+delivery, so editing a line in cues.py regenerates exactly
that take and nothing else.
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

import edge_tts

import importlib
import os

_cue_set = os.environ.get("CUE_SET", "story")
_cues = importlib.import_module("cues" if _cue_set == "story" else f"cues_{_cue_set}")
SUFFIX = "" if _cue_set == "story" else f"-{_cue_set}"
from cues import LINES, VOICES
LINES = _cues.LINES
VOICES = _cues.VOICES

OUT = Path(__file__).resolve().parent / f"vo2{SUFFIX}"


def take_path(index: int, line: dict) -> Path:
    """Deterministic per-take file name; changes when the take would."""
    spec = VOICES[line["who"]]
    stamp = hashlib.sha256(
        f"{line['text']}|{spec['voice']}|{spec['rate']}|{spec['pitch']}".encode()
    ).hexdigest()[:10]
    return OUT / f"{index:02d}-{line['who'].lower()}-{stamp}.mp3"


async def render(index: int, line: dict) -> Path:
    path = take_path(index, line)
    if path.exists() and path.stat().st_size > 500:
        return path
    spec = VOICES[line["who"]]
    last: Exception | None = None
    for attempt in range(4):
        try:
            comm = edge_tts.Communicate(
                line["text"], spec["voice"], rate=spec["rate"], pitch=spec["pitch"]
            )
            await comm.save(str(path))
            return path
        except Exception as err:  # noqa: BLE001 - network service, retry then surface
            last = err
            await asyncio.sleep(0.8 * (attempt + 1))
    raise last  # type: ignore[misc]


async def main() -> None:
    OUT.mkdir(exist_ok=True)
    for index, line in enumerate(LINES, start=1):
        path = await render(index, line)
        print(f"take {index:02d} {line['who']:<12} {path.name} {path.stat().st_size}B")
        await asyncio.sleep(0.2)


if __name__ == "__main__":
    asyncio.run(main())
