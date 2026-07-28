# 600B Timelock TCG

Website-first Edition One rulebook and art system for a positive cypherpunk trading card
game about Bitcoin, Nostr and open systems. Its fixed tone is **bullish Web5**: the
future already works, capable friends build it together, and cypherpunk means freedom
technology in daylight.

Open `index.html` to read the designed rulebook.

## Structure

```text
art/
  E1-ART-AND-VOICE-DIRECTION.md  bullish Web5 visual and writing lock
  brand/       official 600B identity assets
  cards/final/ 295 rendered card faces, shared back and readability manifest
  fonts/       local open-source display fonts
  illustrations/ 295 text-free E1 artwork plates plus verified manifest
  qa/          labeled contact sheets for visual review
  resources/   Power, Bitcoin, Keys, Signal and Timelock icons
  rulebook/    wide chapter banners
  world-plates/ six generated affinity environments
cards/
  e1-cards.json          canonical 295-card text lock
  E1-CARD-TEXT.md        human-readable editorial catalog
  e1-text-lock-report.md consistency gate
  cards.csv              Cockatrice adapter input
rules/
  600B-Timelock-TCG-Rulebook-E1.md
  research-sources.md
scripts/
  build_full_set.py
  sync_join_references.py
  lock_character_references.py
  build_art_prompts.py
  normalize_generated_art.py
  build_cards.py
  build_gallery.py
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

## Bullish Web5 direction

Edition One is optimistic by design: self-owned identity, sound money, open
peer-to-peer infrastructure, working local energy and friends shipping useful things.
Black and ultraviolet supply the cypherpunk edge; Bitcoin orange, human warmth and
daylight keep the world positive. The complete lock is in
`art/E1-ART-AND-VOICE-DIRECTION.md`.

## Edition One text lock

Edition One contains **295 complete cards**. Every card has:

- original 600B name and rules wording;
- a short, non-rules **Simple Guide** for new players;
- a concise educational **Protocol Note** with a primary source;
- a standalone art direction and generation prompt;
- a mechanic fingerprint for the ignored local SQLite audit trail.

All 92 Avatar cards use only official characters from `join.600.wtf`. Historical
reference data remains read-only and is never copied into this repository.

```bash
uv run python scripts/build_full_set.py --reference PATH/TO/reference.json
uv run python scripts/sync_join_references.py
uv run python scripts/lock_character_references.py
uv run python scripts/build_art_prompts.py
```

The builder records its decisions in `.audit/e1-design.sqlite` before it writes public
artifacts. That local audit database is ignored by Git.

## Standalone artwork lock

Card art is built and reviewed before card faces. Every standalone illustration is a
full 1920 × 2400 scene with no printed card UI. The six world plates set the affinity
palette. All 92 Avatar prompts use canonical `join.600.wtf` Detailed ·front references
as identity locks; every other illustration explicitly remains character-free.

The locked prompt catalog is `art/prompts/e1-art-prompts.json`. Generated source images
remain in the ignored working area `art/generated/raw/` until the full batch passes
review. Accepted images are normalized without effects or procedural overlays:

```bash
uv run python scripts/normalize_generated_art.py
```

The accepted output is `art/illustrations/E1-001.jpg` through `E1-295.jpg`, each exactly
1920 × 2400. The JSON manifest contains dimensions and SHA-256 checksums.

## Final cards and website gallery

The final layout uses an orange outer frame, black art core, purple structure, centered
Resource icons and a lightweight pale text field with black rules text. The card face
contains only gameplay information and one short collectible flavor line. Simple
Guides, Protocol Notes and sources remain website/game metadata. Dynamic typography
keeps all 295 cards readable with zero overflows.

```bash
uv run python scripts/build_cards.py
uv run python scripts/build_gallery.py
```

Open `cards.html` for the searchable, filterable complete-set gallery. `index.html`
links to it from the rulebook hero. The shared card back is
`art/cards/final/600B-Timelock-card-back.jpg`.

## Cockatrice playtesting

Cards are authored as data in `cards/cards.csv` and compiled into a
[Cockatrice](https://cockatrice.github.io/) custom set for online playtests.

```bash
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install pytest ruff pillow
.venv/Scripts/python scripts/build_placeholders.py
.venv/Scripts/python scripts/build_set.py --install
```

`build_placeholders.py` renders a branded placeholder face for every card into
`art/cards/placeholders/`. `--install` copies the set XML plus card images into the
local Cockatrice data folder: placeholders first, then finished art from `art/cards/`
(named exactly like the card, e.g. `Power Surge.png`), so real art always wins.
Restart Cockatrice and the set `600B Timelock TCG — Edition One (600B)` appears in the
deck editor.

CSV columns: `name, type, subtype, cost, ar, rarity, text`. Costs use affinity letters
`P` Power, `B` Bitcoin, `K` Keys, `S` Signal, `T` Timelock plus digits for neutral, e.g.
`4BB`. Inside the Cockatrice client the five affinities are mapped onto its five color
slots (Signal=W, Timelock=U, Keys=B, Power=R, Bitcoin=G) as a render adapter only — all
names and rules text stay 600B.

`scripts/build_gallery.py` generates `cards.html` — a gallery of every card's full-card
image (the same graphics used in game) with its complete text, search and affinity
filters. Serve the repo root with any static server, e.g.
`.venv/Scripts/python -m http.server 8600`, then open `/cards.html`.

Run the generator tests with `uv run pytest`.
