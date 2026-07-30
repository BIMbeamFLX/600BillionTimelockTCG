# E1 Rules Audit — card text vs. rulebook (2026-07-28)

Read-only audit of `cards/e1-cards.json` (E1.0-text-lock, 295 cards) against
`rules/600B-Timelock-TCG-Rulebook-E1.md`. Renders in `art/cards/final/` show the same
text, so every fix below needs a re-render of that card after the JSON is corrected
through the regular build pipeline (fingerprints + audit DB).

## What is clean (no action)

- Affinity always equals the specific Resource symbols in the cost (§3.1): **0 errors in 295 cards.**
- All keywords used are §14 glossary keywords (Broadcast 32, Firewall 11, Reboot 11,
  Backchannel 8, Shielded from 7, Overflow 5, Mesh 4, First Strike 4).
- Types, type lines, cost format, Firewall-only-on-Avatars, A/R presence, no duplicate
  names/IDs, help_text + protocol_note + source complete. 92 Avatars as documented.
- "end step" is legal E1 wording (§9.5). No hits for sacrifice/graveyard/untap/upkeep/
  library/battlefield/exile/mana.

## Fix 1 — "Wall" → "Firewall" (§14/§23; 9 cards)

| Card | Replace |
| --- | --- |
| E1-007 Firmware for Firewalls | "Attach to Wall. Attached Wall …" → "Attach to Firewall. Attached Firewall …" |
| E1-064 Hidden Route | "except by Walls" → "except by Firewalls" |
| E1-082 Call to Relay | "non-Walls" → "non-Firewalls" |
| E1-120 NC, Forced Signal | "non-Wall Avatar" → "non-Firewall Avatar" |
| E1-145 Rootzoll, Hardware Breaker | "decommission target Wall" → "decommission target Firewall" |
| E1-163 Rootzoll, Crew Multiplier | "non-Wall Avatars" → "non-Firewall Avatars" |
| E1-180 Firewall Tunnel | "Decommission target Wall" → "Decommission target Firewall" |
| E1-191 Mtoshi, Deathtouch Courier | "non-Wall Avatar" → "non-Firewall Avatar" |
| E1-220 Mtoshi, Finality Keeper | "non-Wall Avatar" → "non-Firewall Avatar" |

## Fix 2 — "regenerated" → "Rebooted" (§14/§23; 4 cards)

E1-050 Clean Slate, E1-133 Hard Shutdown, E1-143 Final Settlement, E1-180 Firewall
Tunnel: "It can't be regenerated." → "It can't be Rebooted."

## Fix 3 — MTG color/type words (§23; 1 card)

E1-133 Hard Shutdown: "target nonartifact, nonblack Avatar" →
"target non-Hardware, non-Keys Avatar".

## Fix 4 — "haste" does not exist in E1 (§14; 2 cards)

- E1-119 Nind, Archive Returner: "… haste" → "… may attack as though it did not have Boot Delay"
- E1-204 Instant Boot: "attack as though it had haste" → "attack as though it did not have Boot Delay"

## Fix 5 — card name uses a third-party keyword coinage (§25; 1 card)

E1-191 **"Mtoshi, Deathtouch Courier"** — "Deathtouch" is WotC-coined keyword
vocabulary; §25 requires original public terminology. The mechanic text is already
original. Suggested renames: "Mtoshi, Lethal Courier", "Mtoshi, One-Ping Courier",
"Mtoshi, Poison Packet Courier". Rename also changes the art filename.

## Rulebook gap — `*/*` stats are used but never defined (4 cards)

E1-121 Proton, Keyed Nightmare · E1-124 BlackCoffee, Shared Secret Swarm ·
E1-163 Rootzoll, Crew Multiplier · E1-198 Longy, Resource Sovereign print `*/*`
with a defining ability. §3.2 does not define `*`. Add to the rulebook (suggested,
as a §3.2 addition): "An Avatar may print `*` for Action or Resilience. Its value is
defined by the card's ability and is 0 while that definition does not apply. The
definition applies in every zone." Apply in layer 7 of §17.

## Suggested order

1. Apply fixes 1–4 in the card-text source, re-run `build_full_set.py` gate.
2. Decide the E1-191 rename (fix 5).
3. Re-render only the affected faces, re-run gallery + Cockatrice adapter.
4. Add the `*/*` paragraph to the rulebook and rebuild `site/index.html`.
