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
    "NARRATOR": {"voice": "en-US-AndrewMultilingualNeural", "rate": "-4%", "pitch": "-4Hz"},
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
    # Prologue: the world before the crew -- portrait art-loop clips cropped to
    # a cinema band, the narrator alone over them.
    {"id": "P1", "clip": "P1", "src": "../../_work/01.mp4", "head": 0.1, "xfade_in": 0.0,
     "portrait_band": 300},
    {"id": "P2", "clip": "P2", "src": "../../_work/07.mp4", "head": 0.1, "xfade_in": 0.6,
     "portrait_band": 360},
    {"id": "A0", "clip": "A0-network-alive.mp4", "head": 0.12, "xfade_in": 0.6, "speed": 1.12},
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
    # The fight is keyframed by hand: the tracker cannot tell a chest disc
    # from a glowing visor, and Blizzard quality is an editor's eye, not a
    # classifier's confidence.
    # C2 carries no brand in this generation: the runners bob at step
    # frequency, every automated path slides toward faces, and a wrong logo is
    # worse than a blank prop. The regeneration package bakes the emblem into
    # the source stills instead -- tracked by the video model itself.
    {"id": "C2", "clip": "C2-charge.mp4", "head": 0.12, "xfade_in": 0.0, "speed": 1.08},
    {"id": "C3", "clip": "C3-clash.mp4", "head": 0.12, "xfade_in": 0.0, "speed": 0.98,
     "discs": [
         {"keys": [[0, 456, 274], [1.5, 447, 272], [3, 434, 272], [4.5, 440, 262],
                   [5.9, 438, 272]], "r_keys": [[0, 32]]},
         {"keys": [[0, 896, 307], [1.5, 902, 306], [3, 912, 298], [4.5, 914, 302],
                   [5.9, 905, 298]], "r_keys": [[0, 42]]},
     ]},
    {"id": "TITLE", "clip": "09-title.png", "still": 2.8, "xfade_in": 0.5},
    # The button: the owner's closing law.
    {"id": "TITLE2", "clip": "10-endcard.png", "still": 4.2, "xfade_in": 0.4},
]

# The dialogue, tightened against the first pass -- the DIALOGUE.txt rule is
# "if it does not fit in one breath, cut it". Dropped: Michael's A1 reply (his
# philosophy lands at A4 and A5 anyway). Anchors are SHOT ids: a line never
# starts before its shot, and never before the previous line has finished
# plus its pause.
LINES: list[dict] = [
    # Prologue: the narrator alone. Satoshi vanished; the timechain remains.
    {"shot": "P1", "who": "NARRATOR",
     "text": "Satoshi is gone. He never told us his name.", "into": 0.6},
    {"shot": "P2", "who": "NARRATOR", "text": "But he left us the timechain.", "pause": 0.7},
    {"shot": "A0", "who": "MICHAEL1011", "text": "Uptime is twenty. Don't spend it like weather.",
     "pause": 0.7},
    {"shot": "A1", "who": "ROOTZOLL", "text": "Grid's hot. I can dump Power now."},
    {"shot": "A2", "who": "SAT", "text": "Path is clean. I have the tools."},
    {"shot": "A2", "who": "FLX", "text": "Don't drop them. We have a Network."},
    {"shot": "A3", "who": "BLACKCOFFEE", "text": "Keys are seated. I can close this."},
    {"shot": "A3", "who": "MICHAEL1011", "text": "After the lock. Not before."},
    {"shot": "A4", "who": "FLX", "text": "Say the word and I Broadcast."},
    {"shot": "A4", "who": "MICHAEL1011", "text": "Loud is not Uptime."},
    {"shot": "A5", "who": "MICHAEL1011", "text": "Timelock keeps the stronger hit. Next block."},
    # The enemy enters with the storm; the crew answers.
    {"shot": "B1", "who": "NARRATOR", "text": "But the Algorithm never sleeps."},
    {"shot": "B1", "who": "BLACKCOFFEE", "text": "Then we Clash. Now."},
    {"shot": "B1", "who": "MICHAEL1011", "text": "Lock first."},
    {"shot": "C2", "who": "FLX", "text": "Time's up."},
    {"shot": "C2", "who": "MICHAEL1011", "text": "Clash clean."},
    # C3 opens with one beat of nothing: the Zap is the line.
    # "into" holds the line off the shot's first beats: the Zap talks first.
    {"shot": "C3", "who": "MICHAEL1011", "text": "Sequenced. Not a panic.", "hold": 1.0, "into": 1.5,
     "over_title": True},
    {"shot": "C3", "who": "MICHAEL1011", "text": "Protect the Uptime.", "pause": 0.3,
     "over_title": True},
    # The button, spoken as the endcard lands.
    {"shot": "TITLE2", "who": "NARRATOR", "text": "Kill the Algo. Play culture.",
     "pause": 0.5, "over_title": True},
]

# Air between consecutive lines (seconds). "hold" on a line overrides the gap
# before it; shots without dialogue stay silent on their own.
PAUSE = 0.24
