"""Assemble the full film: logo opener -> master cut -> logo outro.

Cinema framing, per the owner: a short brand animation opens, the endcard
closes the story, and the full matrix-background logo sting plays out. All
three parts are normalized and concatenated; the parts carry their own audio.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VIDEO_INTRO = ROOT.parents[1]
PARTS = [
    VIDEO_INTRO / "logo-opener.mp4",
    ROOT / "600b-intro-story-v2.mp4",
    VIDEO_INTRO / "logo-sting.mp4",
]
OUT = ROOT / "600b-intro-full.mp4"


def main() -> None:
    args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for part in PARTS:
        args += ["-i", str(part)]
    n = len(PARTS)
    chain = "".join(
        f"[{i}:v]scale=1280:720,fps=24,format=yuv420p,setsar=1[v{i}];"
        f"[{i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a{i}];"
        for i in range(n)
    ) + "".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
    args += [
        "-filter_complex", chain, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(OUT),
    ]
    subprocess.check_call(args)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
