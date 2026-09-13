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

## Checklist

Play against the NPC at `play.html?rules=fast`. Note the seed from the setup form with anything that looks wrong; the same seed deals the same game.

**Setup**
- [ ] Rules says Fast, and the Stack menus list the Fast Starters and the three archetypes.
- [ ] With the Fast faces built, a card in hand shows Fast cost and text, e.g. Satoshi Orchard is Hardware.

**A turn**
- [ ] The game opens straight into your Build phase. The chip reads `Pool 1/1` and the button reads `End turn`.
- [ ] Only cards you can pay for **and** have a target for glow.
- [ ] A played card resolves at once. Nobody passes and the opponent does not respond.
- [ ] End turn: the NPC plays its whole turn in a few seconds, and you are back in your Build with a pool one bigger.
- [ ] The player going second gets +1 Resource on each of their first two turns (see the log line).

**Attacking**
- [ ] An Avatar that has been on the table since your last turn glows ready to attack.
- [ ] Click it, then click an enemy Avatar or their name bar. Dragging it onto the target works too.
- [ ] With an enemy Firewall on the table, only the Firewall is highlighted, unless the attacker has Broadcast.
- [ ] The attacker lunges, the hit lands on contact, and damage numbers rise. A destroyed card breaks into shards.
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
