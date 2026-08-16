"""Build the picture cut from cues.SHOTS and write timeline.json.

Ally scenes crossfade into each other; the tension beats (B1, C2, C3) cut
hard; the clash runs slightly slowed so its beat of silence is real screen
time; the title card fades in and holds. The emitted timeline.json maps every
shot id to its start second in the finished cut -- place_takes.py anchors the
dialogue to those numbers instead of to a hand-maintained grid.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from cues import SHOTS

ROOT = Path(__file__).resolve().parent
CLIPS = ROOT / "clips"
TITLE_PNG = ROOT.parent / "09-title.png"
WORK = ROOT / "_work2"
OUT = WORK / "cut.mp4"
FPS = 24


def probe_duration(path: Path) -> float:
    """One clip's container duration in seconds."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return float(out)


def main() -> None:
    WORK.mkdir(exist_ok=True)

    # Pass 1: normalize every shot to its trimmed, speed-adjusted segment.
    segments: list[tuple[str, Path, float]] = []  # (id, file, duration)
    for index, shot in enumerate(SHOTS):
        seg = WORK / f"seg-{index:02d}-{shot['id']}.mp4"
        if shot.get("still"):
            duration = float(shot["still"])
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-loop", "1", "-t", f"{duration}", "-i", str(TITLE_PNG),
                "-vf", f"scale=1280:720,fps={FPS},format=yuv420p",
                "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an", str(seg),
            ]
        else:
            src = CLIPS / shot["clip"]
            head = float(shot.get("head", 0.0))
            speed = float(shot.get("speed", 1.0))
            source_len = probe_duration(src) - head
            duration = source_len / speed
            setpts = f"setpts={1 / speed:.6f}*PTS," if speed != 1.0 else ""
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", f"{head}", "-i", str(src),
                "-vf", f"{setpts}scale=1280:720,fps={FPS},format=yuv420p",
                "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an", str(seg),
            ]
        subprocess.check_call(cmd)
        segments.append((shot["id"], seg, probe_duration(seg)))

    # Pass 2: chain with per-boundary xfade (0 = concat hard). Each xfade
    # overlaps the join, so it subtracts from the running length.
    timeline: dict[str, float] = {}
    cursor = 0.0
    chain = segments[0][1]
    timeline[segments[0][0]] = 0.0
    cursor = segments[0][2]
    for index in range(1, len(segments)):
        shot_id, seg, seg_dur = segments[index]
        fade = float(SHOTS[index].get("xfade_in", 0.0))
        merged = WORK / f"chain-{index:02d}.mp4"
        if fade > 0:
            offset = cursor - fade
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(chain), "-i", str(seg),
                "-filter_complex",
                f"[0:v][1:v]xfade=transition=fade:duration={fade}:offset={offset:.4f},format=yuv420p[v]",
                "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an",
                str(merged),
            ]
            subprocess.check_call(cmd)
            timeline[shot_id] = offset
            cursor = offset + seg_dur
        else:
            concat = WORK / f"concat-{index:02d}.txt"
            concat.write_text(f"file '{chain.name}'\nfile '{seg.name}'\n", encoding="ascii")
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "concat", "-safe", "0", "-i", str(concat),
                "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-an", str(merged),
            ]
            subprocess.check_call(cmd)
            timeline[shot_id] = cursor
            cursor += seg_dur
        chain = merged

    chain.replace(OUT)
    total = probe_duration(OUT)
    (WORK / "timeline.json").write_text(
        json.dumps({"total": total, "shots": timeline}, indent=1) + "\n", encoding="utf-8"
    )
    print(f"cut: {total:.2f}s")
    for shot_id, start in timeline.items():
        print(f"  {shot_id:6} starts {start:6.2f}")


if __name__ == "__main__":
    main()
