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
  cards/node-runner-web/ 296 card faces + back in the Node Runner frame, shipped
  cards/node-runner-print/ ignored 300 dpi print masters, rebuilt on demand
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
  render_card_pngs.py
  build_blob_manifest.py
  build_blob_map.py
  build_play_data.py
  build_precons.py
  build_shop_data.py
  rasterize-icons.cjs
  build-rulebook.cjs
site/
  600b.css      the shared design system: tokens, nav, card-frame components
  index.html    landing page
  quickstart.html  five-minute onboarding for a first game
  play.html     playable table: two-player hotseat offline, refereed online
  play.js       the board and the lobby
  engine.js     the headless rules engine — the same file the referee runs
  net.js        the wire: socket, reconnect loop, and the signed nostr moments
  play-data.js  generated playable card data
  precons.js    generated preconstructed Stacks (5 Starters, 6 Classics)
  deck.html     Stack Builder
  shop.html     booster shop
  wallet.html   NutFT proof wallet
  nutft-wallet.js Cashu-TS wallet and CardBinding verifier
  shop.js       pack opening and NutFT store integration
  shop-data.js  generated committed booster box
  faces.js      card art from Blossom by hash, with a local cache
  blob-map.js   generated card face -> SHA-256 map
  cards.html    searchable image-and-text catalog
  e1-card-set.html  Node Runner frame proof sheet, print-ready
  rules.html    designed rulebook, generated from rules/
  leaderboard.html  the ladder, computed in your browser from nostr events
  ladder.js     result verification and Elo — no ladder server, no editable row
  schnorr.js    BIP-340 verification and NIP-01 event ids, in the browser
  arena.html    retired mockup, redirects to the live table
server/
  table.js      the referee: authoritative engine, WebSocket, SQLite, static host
  nutft-mint.js NutFT-aware demo mint and Cashu DLEQ signer
  nutft-draw.js manifest-compatible booster draw
tests/js/       the JavaScript suite — engine, client, transport, cards
docs/
  net-protocol.md            normative wire contract for the table
  multiplayer-architecture.md  the topology decision record
```

## Playing locally

`site/play.html` is a two-player hotseat table for the full 295-card set. It opens straight
from the filesystem — no server, no build step of its own beyond `play-data.js` — and with no
match in the URL or in storage it never opens a socket at all. Offline is an invariant here,
not a fallback.

To serve it instead, use any static server on a port that is **not** 8777, which belongs to the
table referee below:

```bash
python -m http.server 8600
```

Then open <http://localhost:8600/site/play.html>.

The engine enforces the rules framework from `rules/600B-Timelock-TCG-Rulebook-E1.md`:
the eight-step turn structure, the once-per-turn Resource play, Buffer generation and
classic resource burn, printed costs, clash with First Strike and Overflow, and the
state checks. `scripts/build_play_data.py` compiles the locked catalog into engine operations:
all 295 Edition One cards are scripted, and released local and remote tables deny free-form
resolution. Casual and future Ranked play therefore share one complete rules surface.

```bash
uv run python scripts/build_play_data.py
```

Three more generated files back the site, all deterministic — same catalog in,
byte-identical file out:

```bash
uv run python scripts/build_precons.py    # site/precons.js — the ready-made Stacks
uv run python scripts/build_blob_map.py   # site/blob-map.js — face -> SHA-256
uv run python scripts/build_shop_data.py  # site/shop-data.js — the committed box
```

`build_shop_data.py` prints the box commitment. **Publish that hash before selling
a single pack** and reveal the ordered box when it is exhausted: that pair is what
turns "trust our odds" into "replay it yourself".

## Playing online — the table referee

```bash
npm install
npm run table          # node server/table.js
```

One process, one port. It serves `site/`, `art/`, `cards/` and `rules/` **and** the match
socket on 8777, so this is the only thing that needs starting. Open
<http://localhost:8777/play.html>.

The server holds the only unredacted state and the only shuffle seeds; clients receive a
redacted view per seat, so fog of war is enforced by the referee rather than by the UI. It
contains zero rules code — every action is one `engine.js` call and one SQLite transaction,
committed *before* it is acknowledged. Nostr carries the invite, the accept, the dual-signed
match start and the dual-signed result, and never a move; **the server never opens a relay
connection at all**, so a bad day at a relay cannot touch a game in progress.

Online play requires a NIP-07 signer (Alby, nos2x). Sign in, then either create a table and
read the six-character code aloud, join one, or search for an opponent — the matchmaking queue
pairs two identities into a match that is dealt the instant it is minted. Signing in also
returns every unfinished match your npub is seated at, so a cleared profile or a different
machine can sit back down.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8777` | HTTP and WebSocket port |
| `DB` | `server/matches.db` | SQLite file; `:memory:` for a throwaway table |
| `PUBLIC_URL` | — | The fully explicit advertised URL, e.g. `wss://tcg.example/ws`. Validated at boot. **The one-variable answer behind TLS.** |
| `PUBLIC_HOST` | `localhost` | Hostname only — the LAN / Tailscale answer |
| `PUBLIC_SCHEME` | `ws` | `wss` to force a TLS scheme while keeping the port |
| `TABLE_ORIGINS` | — | Comma-separated page origins allowed to open a socket. Only needed when the page and the table live on different origins. |
| `PIN_SEED` | — | Force a rehearsed opening deal |
| `RATE_MAX` | `150` | Accepted actions per 10 s per seat. Raise it only for headless soak runs. |
| `CONTROL_RATE_MAX` | `30` | Control and malformed messages per 10 s per address |
| `MAX_PAYLOAD` | `65536` | Maximum decompressed WebSocket payload in bytes |

```bash
PUBLIC_URL=wss://tcg.example/ws npm run table            # behind a TLS reverse proxy
PUBLIC_HOST=bitbeam.tail1a2b.ts.net npm run table        # over Tailscale
```

Set one of them. Left unset behind a proxy, every published invite advertises `ws://` on the
bound port — mixed-content-blocked *and* aimed at a port the internet cannot reach, silently.

The wire is specified normatively in **`docs/net-protocol.md`**; where that document and
`server/table.js` disagree, one of them is a bug and the document says which.

### Stakes are never held by this software

Two players can agree a stake in sats. A table carries its wager, the matchmaking queue **pairs
on it** so nobody is dealt into a number they did not ask to play for, joining a table with a
different figure than the one you were shown is refused outright, and both seats sign the agreed
amount into the match-start event before a card is drawn. Whole sats only, capped at 1 000 000 —
the referee is recording a promise it can neither enforce nor refund, so it has no business
recording life savings.

Settlement resolves the winner's own lightning address to an invoice and hands it to the loser,
who pays it from their own wallet with their wallet's own confirmation. There is no escrow, no
custody and no float: a refused payment costs the match nothing, because the result is already
signed by both seats.

## Booster shop

`site/shop.html` opens one box. Rarity is copies in that box — commons 24,
uncommons 8, rares 3 — exactly how a printed booster box expresses it, so the
published odds are a property of the box rather than a promise about a dice roll.
The box is shuffled once from a seed and committed by SHA-256 before the first
pack; pulls come off the top.

During alpha packs are free and the collection lives in the browser. The
NutFT demo is available at `shop.html?shop=mint` when served by `npm run table`.
It uses the census and draw vector from the 600b mint package, creates one
P2BK-locked Cashu output per card, and asks the NutFT-aware demo mint to sign
them with DLEQ. The browser wallet verifies the CardBinding, catalog, Blossom
face hash, proof state, amount and unit before showing cards at `wallet.html`.

The demo mint intentionally exposes no generic swap or melt endpoint. It keeps
the booster census in memory and does not move real money; persistent state,
Lightning payment and the atomic NutFT trade path belong before production use.

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

### Rendering the whole set

`scripts/render_card_pngs.py` draws the same frame straight to a bitmap with Pillow,
reusing the geometry functions from `build_card_set.py` so a render and the HTML proof
sheet agree. Artwork comes from the raw ImageGen exports and is contain-fitted into the
art window exactly as the canvas specifies.

Two masters are produced from the same render. Print is lossless PNG tagged at its real
resolution so prepress reads the physical size; web is WebP, visually identical at a
fraction of the bytes.

```bash
uv run python scripts/render_card_pngs.py --format png --out art/cards/node-runner-print
uv run python scripts/render_card_pngs.py --format webp --quality 88 \
  --out art/cards/node-runner-web
```

### Reading a card at a glance

Affinity owns the spine, type chip, circuit border and cost pips. Card type owns
the one channel affinity leaves free — the base dark — so two cards of the same
affinity still sort by what they do:

| Group | Types | Base |
| --- | --- | --- |
| Resource | Basic Resource, Resource | warm amber-black `#0d0803` |
| Avatar | Avatar, Hardware Avatar | neutral `#050403` (the handoff default) |
| Spell | Zap, Operation | cool blue-black `#03060f` |
| Device | Hardware, Protocol | violet-black `#080412` |

`TYPE_GROUP` and `TYPE_BASE` live in `scripts/build_card_set.py`, so the HTML proof
sheet and the rendered PNGs stay in step.

| Set | Format | Size | Per card | Use |
| --- | --- | --- | --- | --- |
| `node-runner-print/` | PNG, 300 dpi | 814 × 1109 | ~670 KB | 63 × 88 mm trim, 3 mm bleed |
| `node-runner-web/` | WebP q90 | 814 × 1109 | ~140 KB | site, game table, Blossom |

The web set ships and is what the site and game table load. The print masters are
ignored and rebuilt on demand. Add `--guides` for a trim proof, `--scale` for a
smaller web set.

## Content-addressed publishing

Blossom addresses every blob by the SHA-256 of its bytes, so the digest is the
identifier: a server answers `GET /<sha256>` and any mirror holding the same bytes
answers identically. That digest is also what a NIP-94 file event carries, so one
manifest covers storage and the event that points at it.

```bash
uv run python scripts/build_blob_manifest.py --dir art/cards/node-runner-web \
  --blossom-base https://blossom.example
```

Each entry records the card id and name, mime type, byte length, SHA-256 and the
resolved Blossom URL.

## Build

```bash
npm install
npm run build
```

The generated website has no runtime dependency and uses only local assets. The referee
(`npm run table`) is the one part that has any: `ws` for the socket and `@noble/curves` for
BIP-340 signature verification.

## Tests

```bash
npm run test:js     # 314 tests: engine, client, transport, NutFT, ladder, and every card wave
uv run pytest       # the Python generators
```

`npm run test:js` is `node --test tests/js/*.test.mjs` — use the file/glob form, because the
directory form fails on Windows. `tests/js/net.test.mjs` boots a real referee in-process and
plays real matches against it; `tests/js/schnorr.test.mjs` checks the browser verifier against
all 19 official BIP-340 vectors and differentially against `@noble/curves`. Run the suite
before every commit.

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
`site/index.html` links to it from the landing-page hero. The shared release card back is
`art/cards/node-runner-web/600B-Timelock-card-back.webp`.

The official circular 600B mark is rebuilt from the unmodified source artwork as a
small, low-opacity lower-right watermark. Card frames use print-safe resource stripes
in the locked E1 "Plate" palette: Power yellow, Bitcoin orange, Keys white, Signal
violet, Timelock teal and Neutral slate. Multi-affinity cards divide the stripe into
equal color segments.

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
