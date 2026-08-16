# Website Art-Director Prompt Lock

- Version: `600B-WEB-art-director-v1-positive-cypherpunk`
- Assets: **10**
- Tone: **positive cypherpunk — the future already works** (same lock as `600B-E1-art-director-v3`)
- Visible artwork: **no text, letters, numbers, logos, card frames or interfaces** — every word on the website is set in HTML on top of the image
- Character identity: **join.600.wtf Detailed ·front** references only; never invent people

## Why these exist

The audit of 2026-08-16 found the site's five hero sections stretch 576-px portrait
world-plates to full desktop width, two rulebook banners are flat vector diagrams,
and the social preview is the bare logo on black. Card faces on the site resolve
live from `art/cards/node-runner-web/` and are already current; the world-plates
stay in service as the arena stage backdrops and as palette references. This
document replaces only the stretched heroes, the two flat banners and the social
card.

## Delivery standard

- Generate at or above the target size, downscale to it, save WebP quality 90
  (the og card saves PNG — link previews still mistrust WebP).
- Every hero carries HTML type over its left third: keep that third calm, dark
  and free of focal detail. The site adds its own black gradient on top.
- File names below are final; the wiring table at the end lists the one line per
  page that flips when a file lands. Do not wire a slot before its file exists —
  `publish_site.py` refuses missing assets.

---

## WEB-01 · Homepage hero

- **File:** `art/site/hero-index.webp` · **2880 × 1280**
- **Slot:** `site/index.html` `.hero::before` (replaces stretched `timelock.png`)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the homepage of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works: self-owned identity, sound money and open peer-to-peer infrastructure built by capable friends. Show agency, hospitality, competence, humor and shared abundance with confident playful YOLO-but-verify energy. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the whole world in one establishing shot — a rooftop commons at first sunrise light, mesh antennas and hand-built radios in the near ground, a flourishing orchard commons and blackened-steel workshop below, a warm city skyline waking up behind, one thin timelock beacon pulsing violet on the horizon. Composition: wide 9:4 panorama; all focal detail and the brightest light in the right two thirds; the left third falls to calm matte black for the headline. Late golden-hour warmth against deep ultraviolet shadows, believable open-source hardware, no people. Reference (world-and-palette): art/world-plates/timelock.png — treat as palette and material guidance, not layout. No card frame, title, text, letters, numbers, logos, watermark or interface. No generic hooded hacker, corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, weapons-first mood, grimdark lighting, helplessness or despair. Cypherpunk means freedom technology in daylight, not cyberpunk doom. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-02 · Rules hero

- **File:** `art/site/hero-rules.webp` · **2880 × 1280**
- **Slot:** `site/rules.html` `.hero` background (replaces `banner-01` stretched to 600 px tall)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the rulebook page of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the long shared table of the Palace of Culture community workshop set for a teaching session — blackened steel and timber, warm work lamps, neat rows of glowing orange resource markers and violet shield tokens laid out like a lesson, an open field manual with blank pages, coffee, plants, tools on shadow boards behind. The order of the table tells the story: everything has a place, every rule is learnable. Composition: wide 9:4 panorama, table receding to the right, focal lamp-pool on the right half, left third calm matte black for the headline. Warm practical lighting, no people. No card frame, title, text, letters, numbers, logos, watermark or interface; the manual's pages are blank. No generic hooded hacker, corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, weapons-first mood, grimdark lighting, helplessness or despair. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-03 · Quickstart hero

- **File:** `art/site/hero-quickstart.webp` · **2880 × 1280**
- **Slot:** `site/quickstart.html` hero background (replaces stretched `power.png`)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the quickstart page of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works: self-owned identity, sound money and open peer-to-peer infrastructure built by capable friends. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Identity locks: reproduce FLX from art/references/join-detailed-front/flx.png and MadMunky from art/references/join-detailed-front/madmunky.png exactly — same species, faces, proportions, silhouettes, wardrobe, materials, colors and signature accessories. Do not invent any other people or characters. Scene: FLX and MadMunky at a small workshop table mid-game, leaning in, one grinning mid-move — the game state told entirely through glowing orange resource markers, violet shield domes and small hand-built devices between them, never through cards. Hospitality details: coffee, a rubber duck referee, warm lamps, sunrise through the window. Composition: wide 9:4 panorama, the two players and the table in the right two thirds, left third calm matte black for the headline. Warm practical lighting, believable hardware. No card frame, no playing cards, no title, text, letters, numbers, logos, watermark or interface. No generic hooded hacker, corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, weapons-first mood, grimdark lighting, helplessness or despair. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-04 · Lore hero

- **File:** `art/site/hero-lore.webp` · **2880 × 1280**
- **Slot:** `site/lore.html` hero background (replaces stretched `signal.png`)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the lore page of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the city of the Node Runners at violet dusk seen from a high rooftop — strings of warm lights between hand-raised antenna masts, laundry lines beside dish arrays, an orchard glowing on a far roof, relay light hopping visibly from mast to mast into the distance, the last sun on the horizon. The infrastructure carries the story: a city that talks to itself because its people built the wires. Composition: wide 9:4 panorama, depth running to the right, left third calm deep dusk for the headline. No people. No card frame, title, text, letters, numbers, logos, watermark or interface. No generic hooded hacker, corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, weapons-first mood, grimdark lighting, helplessness or despair. Cypherpunk means freedom technology in daylight, not cyberpunk doom. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-05 · Play-lobby hero

- **File:** `art/site/hero-play.webp` · **2880 × 1280**
- **Slot:** `site/play.html` lobby background (replaces stretched `power.png`; the per-affinity arena stage keeps the world-plates)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the play lobby of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the arena the moment before a match — a two-seat table of blackened steel under one warm cone of light, two empty chairs facing, two hand-built player rigs docked and idling with soft status glows, one orange, one violet, a neat queue lane of small lights leading to the table, the workshop dark and expectant around it. Anticipation without menace: this is a friendly duel in a room built by friends. Composition: wide 9:4 panorama, table and light-cone in the right two thirds, left third calm matte black for the headline. No people. No card frame, title, text, letters, numbers, logos, watermark or interface. No generic hooded hacker, corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, weapons-first mood, grimdark lighting, helplessness or despair. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-06 · Shop hero

- **File:** `art/site/hero-shop.webp` · **2880 × 1280**
- **Slot:** `site/shop.html` (new hero — the page currently opens with bare text)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the booster shop of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the print commons where boosters are born — a beautiful hand-cranked press of blackened steel and brass mid-run, crisp blank foil packs in warm orange metallic wrap sliding down a timber chute into an open wooden crate, one pack catching the lamp light mid-fall, drifts of violet ink mist, the fairness of the run told physically by a sealed glass counting jar of finished packs. Abundance through patient work, not luxury spectacle. Composition: wide 9:4 panorama, press and falling pack in the right two thirds, left third calm matte black for the headline. Warm practical lighting, no people. The foil packs are blank — no card frame, title, text, letters, numbers, logos, watermark or interface anywhere. No corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, grimdark lighting. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-07 · Leaderboard hero

- **File:** `art/site/hero-leaderboard.webp` · **2880 × 1280**
- **Slot:** `site/leaderboard.html` (new hero — the page currently opens with bare text)

**Prompt**

Create one finished 2880x1280 panoramic illustration for the leaderboard page of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the hall of uptime — a long workshop wall where hundreds of small hand-made plaques of blackened steel each hold one steady orange signal lamp, a few burning brighter near the top, violet service light along the floor, a wheeled library ladder leaning against the wall, one plaque being polished by lamplight on a bench below. Reputation as maintained infrastructure: every lamp is lit because someone keeps it lit. Composition: wide 9:4 panorama, the wall raking away to the right, left third calm matte black for the headline. No people. The plaques are blank — no card frame, title, text, letters, numbers, logos, watermark or interface. No corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity panic, grimdark lighting. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-08 · Rulebook banner — Five Resources

- **File:** `art/rulebook/banner-02-five-resources.webp` · **1600 × 480** (replaces the flat SVG; `site/rules.html` img src changes `.svg` → `.webp`)

**Prompt**

Create one finished 1600x480 wide illustration for the rulebook of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: one long workbench holding the five tools of the network as five distinct working stations, left to right in exactly this order — a humming amber power cell on a coil charger; a small orchard-tree in a steel planter heavy with warm-glowing fruit; a rack of ornate physical keys above a vault drawer; a hand-built antenna mast with a visible relay pulse; and a violet-lit timelock vault whose door stands ajar on a clockwork interior. Each station distinct in silhouette, all one bench, one warm light. Composition: strict left-to-right rhythm of five focal points, camera straight on, shallow table depth. No people. No card frame, title, text, letters, numbers, logos, watermark or interface — no currency symbols on the fruit or anywhere. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. No corporate Web3 advertising, grimdark lighting. Coherent single scene, polished key art.

## WEB-09 · Rulebook banner — Clash

- **File:** `art/rulebook/banner-05-clash.webp` · **1600 × 480** (replaces the flat vector diagram)

**Prompt**

Create one finished 1600x480 wide illustration for the rulebook of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: the clash — two hand-built rigs facing each other across a short steel table, the attacker on the left releasing one clean arc of orange energy, the defender on the right holding it on a violet resilience dome, the arc bending where they meet, sparks falling as harmless warm embers, both machines sturdy and unafraid. A contest of engineering, not a war: no damage, no smoke, just force meeting design. Composition: symmetric duel across the wide frame, the meeting point of orange and violet exactly at center, dark calm edges. No people. No card frame, title, text, letters, numbers, logos, watermark or interface. No weapons, no destruction, no grimdark lighting, no collapse porn. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

## WEB-10 · Social preview card

- **File:** `art/site/og-card.png` · **1200 × 630** (replaces the bare logo in `og:image` / `twitter:image`; after generation, composite `art/brand/600B-logo-primary.png` at ~180 px into the calm left band)

**Prompt**

Create one finished 1200x630 illustration to serve as the link-preview card of 600 BILLION Timelock TCG, an unmistakably positive cypherpunk world where the future already works. Use cinematic editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and ultraviolet-purple accents. Scene: one iconic image — the Genesis Lotus device blooming open on a workshop bench at sunrise, raw energy condensing into glowing countable units above its petals, the warm city soft in the bokeh beyond, a tiny rubber duck in a hard hat supervising from beside a coffee cup. Composition: the lotus at two-thirds right, crisp and heroic at thumbnail size; the left third calm matte black reserved for a logo that will be composited later. High contrast, one focal subject, readable at 300 px wide. No people. No card frame, title, text, letters, numbers, logos, watermark or interface in the generated image. No corporate Web3 advertising, grimdark lighting, lens-flare spam, glossy 3d-render plastic look. No floating circles, wireframe polygons, ornamental geometry, meaningless crypto glyphs or repeated procedural patterns. Coherent single scene, polished key art.

---

## Wiring table — flip each line only when its file exists

| Asset | File to land | Line to change |
|---|---|---|
| WEB-01 | `art/site/hero-index.webp` | `site/index.html:73` `.hero::before` background url |
| WEB-02 | `art/site/hero-rules.webp` | `site/rules.html:338` `.hero` background |
| WEB-03 | `art/site/hero-quickstart.webp` | `site/quickstart.html:28` hero background url |
| WEB-04 | `art/site/hero-lore.webp` | `site/lore.html:35` hero background url |
| WEB-05 | `art/site/hero-play.webp` | `site/play.html:36` lobby background url |
| WEB-06 | `art/site/hero-shop.webp` | `site/shop.html` — add hero section |
| WEB-07 | `art/site/hero-leaderboard.webp` | `site/leaderboard.html` — add hero section |
| WEB-08 | `art/rulebook/banner-02-five-resources.webp` | `site/rules.html` img src `.svg` → `.webp` |
| WEB-09 | `art/rulebook/banner-05-clash.webp` | (same filename — no wiring) |
| WEB-10 | `art/site/og-card.png` | `site/index.html:16-23` og/twitter image + width/height |

Unchanged on purpose: the four illustrated rulebook banners (01, 03, 04, 06) are
on-style; the five world-plates keep serving the per-affinity arena stage and the
prompt-reference role; `art/cards/600B-E1-iconic-six-contact-sheet.png` is derived
from the live faces by script, never generated.
