# 600B Timelock TCG

Website-first Edition One rulebook and art system for a positive cypherpunk trading card
game about Bitcoin, Nostr and open systems. Its fixed tone is **positive cypherpunk**: the
future already works, capable friends build it together, and cypherpunk means freedom
technology in daylight.

Open `site/index.html` for the landing page and `site/rules.html` for the designed
rulebook.

## Structure

```text
art/
  E1-ART-AND-VOICE-DIRECTION.md  positive-cypherpunk visual and writing lock
  brand/       official 600B identity assets
  cards/final/ 295 rendered card faces, shared back and readability manifest
  cards/promos/ separately locked promotional card faces
  fonts/       local open-source display fonts
  generated/   ignored local raw ImageGen sources and high-resolution exports
  resources/   Power, Bitcoin, Keys, Signal and Timelock icons
  rulebook/    wide chapter banners
  world-plates/ six generated affinity environments
cards/
  e1-cards.json          canonical 295-card text lock
  promos.json            separate promotional cards outside the E1 lock
  E1-CARD-TEXT.md        human-readable editorial catalog
  e1-text-lock-report.md consistency gate
  cards.csv              Cockatrice adapter input
rules/
  600B-Timelock-TCG-Rulebook-E1.md
  research-sources.md
scripts/
  build_full_set.py
  e1_editorial.py
  lock_flavor_text.py
  build_prompts.py
  sync_join_references.py
  lock_character_references.py
  build_art_prompts.py
  normalize_generated_art.py
  build_cards.py
  build_promos.py
  build_gallery.py
  build_card_set.py
  build_play_data.py
  build-rulebook.cjs
site/
  arena.html    static play-area mockup
  cards.html    searchable image-and-text catalog
  e1-card-set.html  Node Runner frame proof sheet, print-ready
  index.html    landing page
  play.html     playable two-player hotseat table
  play.js       local rules engine
  play-data.js  generated playable card data
  rules.html    designed rulebook
```

## Playing locally

`site/play.html` is a two-player hotseat table for the full 295-card set. Serve the
repository and open it — the page needs no build step of its own beyond `play-data.js`.

```bash
python -m http.server 8777
```

Then open <http://localhost:8777/site/play.html>.

The engine enforces the rules framework from `rules/600B-Timelock-TCG-Rulebook-E1.md`:
the eight-step turn structure, the once-per-turn Resource play, Buffer generation and
classic resource burn, printed costs, clash with First Strike and Overflow, and the
state checks. `scripts/build_play_data.py` compiles the locked catalog and auto-scripts
the ability templates that recur across the set; the remaining cards are marked `!` and
resolved at the table with the manual controls, so no card is locked out of play.

```bash
uv run python scripts/build_play_data.py
```

## Node Runner frame proof sheet

`cards/e1-node-runner-set.json` locks the 18-card playtest set (E1 · 007–024) in the
Node Runner frame ported from the claude.ai design canvas. The generative border is
emitted as static SVG paths, so a build is deterministic and reviewable in the diff.

```bash
uv run python scripts/build_card_set.py
uv run python scripts/build_card_set.py --border-amp 11 --no-guides --no-fable
```

Cards print at 63 × 88 mm trim inside a 3 mm bleed at 300 dpi. Drop artwork into
`art/cards/node-runner/` named after each card to fill its art window.

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

## Positive-cypherpunk direction

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
uv run python scripts/lock_flavor_text.py
uv run python scripts/build_prompts.py
uv run python scripts/sync_join_references.py
uv run python scripts/lock_character_references.py
uv run python scripts/build_art_prompts.py
```

The builder records its decisions in `.audit/e1-design.sqlite` before it writes public
artifacts. That local audit database is ignored by Git. Future art generation starts
from the versioned `cards/e1-art-prompts.json` prompts-v2 catalog; an editorial text
pass never regenerates accepted illustrations.

## Standalone artwork lock

Card art is built and reviewed before card faces. Every standalone illustration is a
full 1920 × 2400 scene with no printed card UI. The six world plates set the affinity
palette. All 92 Avatar prompts use canonical `join.600.wtf` Detailed ·front references
as identity locks; every other illustration explicitly remains character-free.

The locked prompt catalog is `art/prompts/e1-art-prompts.json`. Approved original
ImageGen sources remain read-only in the ignored `art/generated/prompts-v2/` directory;
reviewed raw regenerations live in `art/generated/prompts-v2-qa-edits/`. Rejected
batches, patched copies and QA staging are not retained.

```bash
uv run python scripts/apply_final_art_qa_fixes.py --refresh
uv run python scripts/apply_final_art_qa_fixes.py --install
uv run python scripts/apply_art_watermarks.py
```

The local high-resolution export is
`art/generated/prompts-v2-final-1920x2400/E1-001.jpg` through `E1-295.jpg`, each exactly
1920 × 2400. Its manifest contains dimensions, raw-source provenance and SHA-256
checksums. Git publishes only the finished card faces; reproducible contact sheets and
other QA exports remain local build products.

## Final cards and website gallery

The final layout uses an orange outer frame, black art core, purple structure, centered
Resource icons and a lightweight pale text field with black rules text. The card face
contains only gameplay information and one short collectible flavor line. Simple
Guides, Protocol Notes and sources remain website/game metadata. Dynamic typography
keeps all 295 cards readable with zero overflows.

```bash
uv run python scripts/apply_final_art_qa_fixes.py --refresh
uv run python scripts/apply_final_art_qa_fixes.py --install
uv run python scripts/apply_art_watermarks.py
uv run python scripts/build_cards.py
uv run python scripts/build_promos.py
uv run python scripts/build_gallery.py
```

Open `site/cards.html` for the searchable, filterable 295-card E1 set plus promos.
`site/index.html` links to it from the landing-page hero. The shared card back is
`art/cards/final/600B-Timelock-card-back.jpg`.

The official circular 600B mark is rebuilt from the unmodified source artwork as a
small, low-opacity lower-right watermark. Card frames use print-safe resource stripes:
Bitcoin orange, Signal/Nostr purple, Power cyan, Keys green, Timelock cobalt and
Neutral slate. Multi-affinity cards divide the stripe into equal color segments.

## Cockatrice playtesting

Cards are authored as data in `cards/cards.csv` and compiled into a
[Cockatrice](https://cockatrice.github.io/) custom set for online playtests.

```bash
uv sync
uv run python scripts/build_placeholders.py
uv run python scripts/build_set.py --install
```

`build_placeholders.py` renders temporary branded playtest faces into the ignored
`art/cards/placeholders/` directory. `--install` copies the set XML plus card images into the
local Cockatrice data folder: placeholders first, then finished art from `art/cards/`
(named exactly like the card, e.g. `Power Surge.png`), so real art always wins.
Restart Cockatrice and the set `600B Timelock TCG — Edition One (600B)` appears in the
deck editor.

CSV columns: `name, type, subtype, cost, ar, rarity, text`. Costs use affinity letters
`P` Power, `B` Bitcoin, `K` Keys, `S` Signal, `T` Timelock plus digits for neutral, e.g.
`4BB`. Inside the Cockatrice client the five affinities are mapped onto its five color
slots (Signal=W, Timelock=U, Keys=B, Power=R, Bitcoin=G) as a render adapter only — all
names and rules text stay 600B.

`scripts/build_gallery.py` generates `site/cards.html` — a gallery of every card's full-card
image (the same graphics used in game) with its complete text, search and affinity
filters. Serve the repo root with any static server, e.g.
`uv run python -m http.server 8600`, then open `/site/cards.html`.

Run the generator tests with `uv run pytest`.
