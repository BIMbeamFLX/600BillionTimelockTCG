"""The story's single source of truth: shots, lines, voices, pacing.

Everything downstream reads this file: make_voices.py renders the takes,
build_cut.py builds the picture and writes timeline.json, place_takes.py lays
the takes out SEQUENTIALLY from their measured lengths (an overlap is
impossible by construction, not by hope), make_score.py writes the orchestral
score around the speech, mix_vo.py mixes.

The first mix overlapped ten of seventeen takes because the cue sheet stored
wished-for windows and nobody measured the audio. Numbers now flow one way:
measured take -> placement -> captions -> score pockets.
"""

from __future__ import annotations

# Per-avatar edge-tts voice and delivery. Faster across the board than the
# first pass (the owner's verdict: schneller, mit Pausen, nicht robotisch) --
# the character spread stays: BlackCoffee slowest, FLX quickest.
VOICES: dict[str, dict[str, str]] = {
    "MICHAEL1011": {"voice": "en-GB-RyanNeural", "rate": "+18%", "pitch": "-2Hz"},
    "ROOTZOLL": {"voice": "en-US-GuyNeural", "rate": "+20%", "pitch": "-3Hz"},
    "SAT": {"voice": "en-US-RogerNeural", "rate": "+22%", "pitch": "+0Hz"},
    "FLX": {"voice": "en-US-ChristopherNeural", "rate": "+24%", "pitch": "+3Hz"},
    "BLACKCOFFEE": {"voice": "en-US-EricNeural", "rate": "+14%", "pitch": "-4Hz"},
}

# Shots, in cut order, with the source clip and how the cut treats it.
# head: seconds trimmed off the AI clip's wobbly start. xfade_in: crossfade
# from the previous shot (0 = hard cut -- tension beats cut hard).
# The tension arc lives in the speeds: the ally scenes run brisk so the
# picture keeps pace with the fast dialogue, A5 holds still (the wait IS the
# tension), B1/C2 accelerate again, the clash lands near real time. "discs"
# marks the blank glowing chest circles that get the 600 billion digit stack
# tracked onto them (seeds in 1280x720 segment pixels).
SHOTS: list[dict] = [
    {"id": "A0", "clip": "A0-network-alive.mp4", "head": 0.12, "xfade_in": 0.0, "speed": 1.12},
    {"id": "A1", "clip": "A1-power-rootzoll.mp4", "head": 0.12, "xfade_in": 0.3, "speed": 1.12},
    # Sat's plaques: the chest display and the blank arm patch. The logo sits
    # deliberately small inside each surface.
    {"id": "A2", "clip": "A2-bitcoin-sat.mp4", "head": 0.12, "xfade_in": 0.3, "speed": 1.1,
     "discs": [{"seed": (630, 272), "r": 24, "scale": 0.55},
               {"seed": (750, 270), "r": 19, "scale": 0.7}]},
    {"id": "A3", "clip": "A3-keys-blackcoffee.mp4", "head": 0.12, "xfade_in": 0.3, "speed": 1.1,
     "discs": [{"seed": (638, 220), "r": 24}]},
    # FLX's canon medallion, blank in this generated take -- restoring it IS
    # the brand.
    {"id": "A4", "clip": "A4-signal-flx.mp4", "head": 0.12, "xfade_in": 0.3, "speed": 1.1,
     "discs": [{"seed": (632, 302), "r": 32}]},
    # Michael carries two: chest and belly disc, both circle-verified.
    {"id": "A5", "clip": "A5-timelock-michael.mp4", "head": 0.12, "xfade_in": 0.45,
     "discs": [{"seed": (656, 344), "r": 24}, {"seed": (656, 472), "r": 18}]},
    {"id": "B1", "clip": "B1-network-fails.mp4", "head": 0.12, "xfade_in": 0.0, "speed": 1.06},
    {"id": "C2", "clip": "C2-charge.mp4", "head": 0.12, "xfade_in": 0.0, "speed": 1.08,
     "discs": [{"seed": (456, 304), "r": 34}, {"seed": (924, 300), "r": 38}]},
    # The circle tracker holds through the lightning (streaks have no radial
    # ring), so the clash carries the brand again -- gated like everything.
    {"id": "C3", "clip": "C3-clash.mp4", "head": 0.12, "xfade_in": 0.0, "speed": 0.98,
     "discs": [{"seed": (456, 288), "r": 28}, {"seed": (910, 286), "r": 50}]},
    {"id": "TITLE", "clip": "09-title.png", "still": 3.1, "xfade_in": 0.5},
]

# The dialogue, tightened against the first pass -- the DIALOGUE.txt rule is
# "if it does not fit in one breath, cut it". Dropped: Michael's A1 reply (his
# philosophy lands at A4 and A5 anyway). Anchors are SHOT ids: a line never
# starts before its shot, and never before the previous line has finished
# plus its pause.
LINES: list[dict] = [
    {"shot": "A0", "who": "MICHAEL1011", "text": "Uptime is twenty. Don't spend it like weather."},
    {"shot": "A1", "who": "ROOTZOLL", "text": "Grid's hot. I can dump Power now."},
    {"shot": "A2", "who": "SAT", "text": "Path is clean. I have the tools."},
    {"shot": "A2", "who": "FLX", "text": "Don't drop them. We have a Network."},
    {"shot": "A3", "who": "BLACKCOFFEE", "text": "Keys are seated. I can close this."},
    {"shot": "A3", "who": "MICHAEL1011", "text": "After the lock. Not before."},
    {"shot": "A4", "who": "FLX", "text": "Say the word and I Broadcast."},
    {"shot": "A4", "who": "MICHAEL1011", "text": "Loud is not Uptime."},
    {"shot": "A5", "who": "MICHAEL1011", "text": "Timelock keeps the stronger hit. Next block."},
    {"shot": "B1", "who": "FLX", "text": "Uptime's falling."},
    {"shot": "B1", "who": "BLACKCOFFEE", "text": "Then we Clash. Now."},
    {"shot": "B1", "who": "MICHAEL1011", "text": "Lock first."},
    {"shot": "C2", "who": "FLX", "text": "Time's up."},
    {"shot": "C2", "who": "MICHAEL1011", "text": "Clash clean."},
    # C3 opens with one beat of nothing: the Zap is the line.
    # "into" holds the line off the shot's first beats: the Zap talks first.
    {"shot": "C3", "who": "MICHAEL1011", "text": "Sequenced. Not a panic.", "hold": 1.0, "into": 1.5},
    {"shot": "C3", "who": "MICHAEL1011", "text": "Protect the Uptime.", "pause": 0.4},
]

# Air between consecutive lines (seconds). "hold" on a line overrides the gap
# before it; shots without dialogue stay silent on their own.
PAUSE = 0.24
