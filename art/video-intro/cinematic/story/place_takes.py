"""Place the rendered takes on the cut. Overlap is impossible by construction.

Every take's REAL length is measured with ffprobe. A line starts at the later
of: its shot's start (from timeline.json), or the previous line's measured end
plus the pause. The first mix trusted a hand-written cue sheet instead and ten
of seventeen takes collided; this file exists so that class of bug cannot
come back.

Writes placed.json (consumed by make_score.py and mix_vo.py) and regenerates
captions.ass from the SAME placements, so the burned subtitles always agree
with the audio to the frame.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import importlib
import os

_cue_set = os.environ.get("CUE_SET", "story")
_cues = importlib.import_module("cues" if _cue_set == "story" else f"cues_{_cue_set}")
SUFFIX = "" if _cue_set == "story" else f"-{_cue_set}"
from cues import LINES, PAUSE
LINES = _cues.LINES
PAUSE = _cues.PAUSE
from make_voices import take_path

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "_work2"
TIMELINE = WORK / "timeline.json"
PLACED = WORK / f"placed{SUFFIX}.json"
CAPTIONS = WORK / f"captions{SUFFIX}.ass"

ASS_HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: line,Anton,34,&H00ECF7FF,&H00000000,&H7F000000,0,0,1.6,0,2,60,60,44,1

[Events]
Format: Layer, Start, End, Style, Text
"""


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return float(out)


def stamp(seconds: float) -> str:
    """ASS timestamp: h:mm:ss.cc"""
    cs = round(seconds * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def main() -> None:
    timeline = json.loads(TIMELINE.read_text(encoding="utf-8"))
    shots: dict[str, float] = timeline["shots"]
    total: float = timeline["total"]
    title_start = shots.get("TITLE", total)

    placed: list[dict] = []
    cursor = 0.0
    for index, line in enumerate(LINES, start=1):
        take = take_path(index, line)
        length = probe_duration(take)
        gap = float(line.get("hold", line.get("pause", PAUSE)))
        into = float(line.get("into", 0.2 if cursor == 0.0 else 0.0))
        anchor = shots.get(line["shot"], title_start)
        start = max(anchor + into, cursor + gap)
        end = start + length
        placed.append(
            {
                "index": index,
                "who": line["who"],
                "text": line["text"],
                "file": take.name,
                "start": round(start, 3),
                "end": round(end, 3),
            }
        )
        cursor = end

    tail = title_start - cursor
    for item in placed:
        drift = item["start"] - shots[LINES[item["index"] - 1]["shot"]]
        print(
            f"take {item['index']:02d} {item['who']:<12} {item['start']:6.2f}..{item['end']:6.2f}"
            f"  (+{drift:5.2f} into shot)  {item['text']}"
        )
    print(f"speech ends {cursor:.2f}s; title at {title_start:.2f}s; clean tail {tail:.2f}s")
    # Lines marked over_title may ride the cards (voice and type carry one
    # message there); everything else must clear the first card, and nothing
    # may touch the end of the film.
    for item, line in zip(placed, LINES):
        if line.get("over_title"):
            continue
        if item["end"] > title_start - 0.4:
            raise SystemExit(
                f"take {item['index']} ends {item['end']:.2f}, needs to clear "
                f"the title at {title_start:.2f} -- tighten cues.py"
            )
    if cursor > total - 0.8:
        raise SystemExit(
            f"the closing line runs to {cursor:.2f} of {total:.2f} -- tighten cues.py"
        )

    PLACED.write_text(json.dumps({"lines": placed, "total": total}, indent=1) + "\n", "utf-8")

    events = [
        f"Dialogue: 0,{stamp(item['start'])},{stamp(item['end'] + 0.25)},line,"
        f"{item['who'].title().replace('1011', '')}: {item['text']}"
        for item in placed
    ]
    CAPTIONS.write_text(ASS_HEAD + "\n".join(events) + "\n", encoding="utf-8-sig")
    print(f"wrote {PLACED.name} and {CAPTIONS.name} ({len(events)} captions)")


if __name__ == "__main__":
    main()
