# 600B Timelock TCG

Website-first Edition One rulebook and art system for a positive cypherpunk trading card
game about Bitcoin, Nostr and open systems.

Open `index.html` to read the designed rulebook.

## Structure

```text
art/
  brand/       official 600B identity assets
  cards/       card-system previews
  fonts/       local open-source display fonts
  resources/   Power, Bitcoin, Keys, Signal and Timelock icons
  rulebook/    wide chapter banners
rules/
  600B-Timelock-TCG-Rulebook-E1.md
  research-sources.md
scripts/
  build-rulebook.cjs
index.html
```

## Build

```bash
npm install
npm run build
```

The generated website has no runtime dependency and uses only local assets.

## Current rules profile

`E1.0-draft` supports the complete first-generation card-design envelope with original
600B language: 20 Uptime, 40+ cards, five Resources, six card types, classic resource
burn, combat, a deterministic Queue, and opt-in Stake and Toss adapters.

The mechanics are a prototype research reference. Public lore, art, text, symbols,
layout and terminology are original 600B work.

## Cockatrice playtesting

Cards are authored as data in `cards/cards.csv` and compiled into a
[Cockatrice](https://cockatrice.github.io/) custom set for online playtests.

```bash
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install pytest ruff
.venv/Scripts/python scripts/build_set.py --install
```

`--install` copies the set XML into the local Cockatrice data folder and card images
from `art/cards/` (named exactly like the card, e.g. `Power Surge.png`) into
`pics/CUSTOM/`. Restart Cockatrice and the set `600B Timelock TCG — Edition One (600B)`
appears in the deck editor.

CSV columns: `name, type, subtype, cost, ar, rarity, text`. Costs use affinity letters
`P` Power, `B` Bitcoin, `K` Keys, `S` Signal, `T` Timelock plus digits for neutral, e.g.
`4BB`. Inside the Cockatrice client the five affinities are mapped onto its five color
slots (Signal=W, Timelock=U, Keys=B, Power=R, Bitcoin=G) as a render adapter only — all
names and rules text stay 600B.

Run the generator tests with `.venv/Scripts/python -m pytest`.
