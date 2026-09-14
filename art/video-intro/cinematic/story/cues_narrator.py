"""The narrator cut: one voice over the same picture and score arc.

Same SHOTS as the dialogue cut -- the picture is shared; only the words
change. The register is the solemn cinematic narrator the owner pointed at:
measured pace, long air between lines, the wait honoured, the last line
spoken as the title card fades up. The text is ours, written for this world's
style rules: positive, no price talk, one idea per breath.
"""

from __future__ import annotations

from cues import PAUSE, SHOTS  # noqa: F401  (shared picture, shared default air)

VOICES: dict[str, dict[str, str]] = {
    "NARRATOR": {"voice": "en-US-AndrewMultilingualNeural", "rate": "-4%", "pitch": "-4Hz"},
}

LINES: list[dict] = [
    # The frame the owner set: Satoshi vanished and left us the timechain;
    # the tools carry the lore; the enemy is the Algorithm.
    {"shot": "A0", "who": "NARRATOR",
     "text": "Satoshi is gone. He never told us his name. But he left us the timechain."},
    {"shot": "A1", "who": "NARRATOR", "text": "From its heat, we drew Power.", "pause": 0.6},
    {"shot": "A2", "who": "NARRATOR", "text": "On its rails, value runs clean.", "pause": 0.6},
    {"shot": "A3", "who": "NARRATOR", "text": "Keys keep what is ours.", "pause": 0.6},
    {"shot": "A4", "who": "NARRATOR", "text": "Signal carries every voice on the roof.", "pause": 0.6},
    # The wait gets the thesis, spoken into the hollow of the score.
    {"shot": "A5", "who": "NARRATOR",
     "text": "And Timelock is the wait that keeps the stronger hit.", "pause": 0.5},
    # The enemy enters with the storm.
    {"shot": "B1", "who": "NARRATOR", "text": "But the Algorithm never sleeps.", "pause": 0.6},
    {"shot": "C2", "who": "NARRATOR", "text": "It feeds on every impatient move.", "pause": 0.4},
    # One beat of nothing first: the Zap talks, then the narrator.
    {"shot": "C3", "who": "NARRATOR", "text": "So we wait. Locked. Sequenced.", "hold": 1.1, "into": 1.3},
    {"shot": "C3", "who": "NARRATOR", "text": "Build the network. Protect your uptime.", "pause": 0.4},
]
