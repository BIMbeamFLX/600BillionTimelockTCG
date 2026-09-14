"""Mix the story cut: placed takes over the score, captions burned, one master.

Reads placed.json -- the same numbers that placed the takes and wrote the
captions -- so audio, subtitles and score pockets agree by construction. The
voice chain stays wide (90 Hz - 12 kHz with a little presence) instead of the
first mix's walkie-talkie band, which is most of what read as "robotic". The
score already ducks itself under the words; the sidechain here is a gentle
safety, not the mechanism.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import os

_cue_set = os.environ.get("CUE_SET", "story")
SUFFIX = "" if _cue_set == "story" else f"-{_cue_set}"

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "_work2"
VO = ROOT / f"vo2{SUFFIX}"
OUT = ROOT / ("600b-intro-story-v2.mp4" if not SUFFIX else f"600b-intro{SUFFIX}.mp4")


def main() -> None:
    placed = json.loads((WORK / f"placed{SUFFIX}.json").read_text("utf-8"))["lines"]
    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(WORK / "cut.mp4"),
        "-i", str(WORK / f"score{SUFFIX}.wav"),
    ]
    filters = ["[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=pad_dur=1[score]"]
    labels = []
    for i, item in enumerate(placed):
        args += ["-i", str(VO / item["file"])]
        delay = round(item["start"] * 1000)
        filters.append(
            f"[{i + 2}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
            f"highpass=f=90,lowpass=f=12000,equalizer=f=3000:t=q:w=1.1:g=2,"
            f"adelay={delay}|{delay},volume=1.9[v{i}]"
        )
        labels.append(f"[v{i}]")
    filters += [
        f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:dropout_transition=30[vox]",
        # Padded past the video's end: sidechaincompress stops at its SHORTER
        # input, and an unpadded vox track cut the score off mid-title.
        "[vox]apad=pad_dur=8,asplit=2[voxk][voxm]",
        "[score][voxk]sidechaincompress=threshold=0.09:ratio=3:attack=25:release=320:makeup=1[bed]",
        "[bed][voxm]amix=inputs=2:normalize=0:dropout_transition=0,"
        "loudnorm=I=-14:TP=-1.3:LRA=13,alimiter=limit=0.93[a]",
    ]
    # No burned subtitles -- the owner cut them. The video stream passes
    # through untouched, so the mix step cannot cost picture quality.
    args += [
        "-filter_complex", ";".join(filters),
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-shortest", "-movflags", "+faststart",
        str(OUT),
    ]
    print(f"mixing {len(placed)} takes")
    subprocess.check_call(args)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
