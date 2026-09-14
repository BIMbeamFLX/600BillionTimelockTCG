# Local play-test

```bash
npm ci
npm run local
```

`npm run local` checks that the Fast card values, the Fast precons and the sound samples are built. It starts the table on a throwaway database and prints the links. If something is missing, it prints the command that builds it.

For card faces that print the Fast values, run this once (about 5 minutes):

```bash
./.venv/Scripts/python.exe scripts/build_fast_faces.py
```

The faces go to `art/cards/fast-web/` and `site/fast-faces.js`. Both are gitignored and only used on `localhost`. Without them a Fast game shows the Classic faces, which print Classic numbers. The chips on the table always show the real values.

## On your phone

The 3D table picks its quality tier from the device, so a desktop emulator only gets you so far. To check it on a real phone:

1. Put the phone on the same Wi-Fi as this machine.
2. Run `npm run local -- --lan`. It prints one phone link, for example `http://192.168.1.20:8777/play.html?rules=fast&arena=3d&arenastats=1&assets=local`. If that address is the wrong interface (VPN, Docker, Tailscale), use one of the other addresses it lists: `npm run local -- --lan 10.0.0.7`.
3. Open the link on the phone. If it does not load, allow Node through the Windows firewall for private networks.
4. Start a hotseat game. Card art comes from the repo files (`&assets=local`), because plain `http` from a LAN address is not a secure context and the Blossom hash check needs one.

`--lan` only changes one thing: the table trusts the printed address as `PUBLIC_HOST`. It already listens on every interface.

The chip in the bottom-left corner (`&arenastats=1`) updates twice a second:

```
mid · dpr 1.5 · shadows
frame p50 3.1 p90 6.2 ms
gap   p50 16.7 p90 17.4 ms
calls 96 · particles 0
```

- Line 1 is the tier, the pixel ratio and shadows. A phone starts at `mid` (DPR 1.5). A small, dense screen (DPR 2.5 or more, short side 480 px or less, which is most current phones) starts at `low` (DPR 1, no shadows). After about 1.5 s, a phone that misses frames (p75 over 17 ms) drops to `low`. `CONTEXT LOST` or `paused` is shown when either applies.
- `frame` is the CPU time of one rendered frame. `gap` is the time between rendered frames, so 16.7 is a smooth 60 Hz and 33 is a dropped frame. An idle table renders only when something moves.
- `calls` is draw calls per frame. `particles` is the effect sprites alive right now.

Report back:

- The phone model and browser.
- A screenshot of the chip while idle and one right after an attack.
- Whether tapping a card plays it, and whether press-and-hold opens the card window without playing it.
- Whether a tapped card stays lifted afterwards (it should not).
- Whether all hand cards are fully on screen in portrait and in landscape.
- What happens after switching to another app and back. The table should repaint. If it falls back to the classic table, report that too.

## Checklist

Play against the NPC at `play.html?rules=fast`. Note the seed from the setup form with anything that looks wrong; the same seed deals the same game.

**Setup**
- [ ] Rules says Fast, and the Stack menus list the Fast Starters and the three archetypes.
- [ ] With the Fast faces built, a card in hand shows Fast cost and text, e.g. Satoshi Orchard is Hardware.
- [ ] Every cost is one number, on the face and on the chip. No class symbol in the cost.

**A turn**
- [ ] The game opens straight into your Build phase. The chip reads `Pool 1/1` and the button reads `End turn`.
- [ ] Turn one is not dead: most opening hands hold a one-cost Avatar that glows.
- [ ] Only cards you can pay for **and** have a target for glow.
- [ ] A played card resolves at once. Nobody passes and the opponent does not respond.
- [ ] End turn on turn one: you hold eight cards and the table asks which one to discard. Click it, press Discard. Nothing is thrown away unasked.
- [ ] End turn: the NPC plays its whole turn in a few seconds, and you are back in your Build with a pool one bigger.
- [ ] The player going second gets +1 Resource on each of their first two turns (see the log line).

**Attacking**
- [ ] An Avatar that has been on the table since your last turn glows ready to attack.
- [ ] Click it, then click an enemy Avatar or their name bar. Dragging it onto the target works too.
- [ ] With an enemy Firewall on the table, only the Firewall is highlighted, unless the attacker has Broadcast.
- [ ] The attacker lunges, the hit lands on contact, and damage numbers rise. A destroyed card breaks into shards.
- [ ] An Avatar that has attacked is dimmed in place, not turned sideways. It glows again on your next turn.
- [ ] First Strike hits first. Overflow carries extra damage to the player.

**Sound** (click the page once to arm audio)
- [ ] Card slam, whoosh and hit, the death shatter, a bell at the start of your turn, the killing blow, and victory or defeat at the end.
- [ ] The sound controls mute everything. Reduced motion (OS setting) keeps the game readable without the lunges.

**End**
- [ ] Reaching 0 Uptime ends the game with the result screen.

## Measuring instead of feeling

```bash
node scripts/sim.mjs --games 30 --profile both   # turns, actions per turn, win rates
node scripts/sim.mjs --precons fast --games 10   # precon round robin
```

Balance offsets live in `BALANCE` in `scripts/design_fast_cards.py`. After changing them, rebuild the values, play data and precons, then simulate again. At 200 games, a win rate moves about ±7% on noise alone.
