# Homepage "A turn, in three moves" — art prompt lock

- Version: `600B-WEB-turnstrip-v1-positive-cypherpunk`
- Assets: **3** portrait images, one per move
- Shape: **1600 × 2000 (4:5 portrait)**, WebP quality 90
- Tone: **positive cypherpunk — the future already works** (same lock as `600B-E1-art-director-v3`)
- Visible artwork: **no text, letters, numbers, logos, card frames or interface** — the move's
  caption is set in HTML *below* the image, so the whole frame is art. No reserved dark band.

## Why these exist

The section reused the rulebook banners, which are 1600×480 landscape with their own
captions baked in (`RESPOND · RESOLVE · REPEAT`, `OPEN · BUILD · CLASH · CLOSE`). Shown in a
tall card the browser cropped each to a centre slice — so the baked text was cut mid-word and
fought the HTML caption. These three replace them with purpose-made portrait images that fit
the card and carry no words of their own. The crop bug is already fixed; wiring these in is
the finish.

## Delivery

- Generate at 1600×2000, downscale to it, save WebP quality 90.
- The card shows the whole image (`object-fit: cover` at exactly 4:5 → no crop). Keep the
  subject centred with a little air on all sides so nothing important rides the edge.
- File names below are final; the wiring table flips three `<img>` lines and one CSS block
  when the files land. Do not wire before the files exist — `publish_site.py` refuses missing
  assets.

---

## TURN-1 · Take a Resource

- **File:** `art/site/turn-1-resource.webp` · **1600 × 2000**

**Prompt**

Create one finished 1600x2000 portrait illustration for 600 BILLION Timelock TCG, an
unmistakably positive cypherpunk world where the future already works: self-owned identity,
sound money and open peer-to-peer infrastructure built by capable friends. Use cinematic
editorial realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange
highlights and ultraviolet-purple accents. Scene: one open hand lifting a single glowing,
countable unit of energy — a warm orange cube of light — up from a small neat stack of
identical units resting on a blackened-steel workbench; the lifted unit is the brightest thing
in the frame, the stack below it calm and ordered. The gesture is deliberate and unhurried:
one free resource, taken with intent. Workshop hospitality around it — timber bench, warm
practical lamps, a plant, a coffee cup, hand-built tools on a shadow board. Composition:
vertical, the taking hand and the lifted unit as the clear focal point in the upper-middle
third, the stack and bench receding below, calm dark edges. Only one hand and forearm; no other
people. No card frame, title, text, letters, numbers, logos, watermark or interface. No generic
hooded hacker, corporate Web3 advertising, dystopian surveillance, collapse porn, scarcity
panic, grimdark lighting. No floating circles, wireframe polygons, ornamental geometry or
meaningless glyphs. Coherent single scene, polished key art.

## TURN-2 · Put it in the Queue

- **File:** `art/site/turn-2-queue.webp` · **1600 × 2000**

**Prompt**

Create one finished 1600x2000 portrait illustration for 600 BILLION Timelock TCG, an
unmistakably positive cypherpunk world where the future already works. Use cinematic editorial
realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and
ultraviolet-purple accents. Scene: a lane of light running up a blackened-steel workbench, and
along it several small hand-built devices stacked in a clearly visible ORDER, each seated on a
glowing violet-and-orange rail like carriages waiting on a track; the one placed LAST sits on
top, brightest, poised to move first, a faint orange charge gathering on it. The order is
legible at a glance — a tidy pipeline of pending actions, each waiting its turn. Warm practical
workshop light, believable open-source hardware, no clutter. Composition: vertical, the queued
stack climbing the frame from lower foreground to upper background, the topmost (last-placed)
device the focal glow, calm dark margins. No people. No card frame, title, text, letters,
numbers, logos, watermark or interface. No generic hooded hacker, corporate Web3 advertising,
dystopian surveillance, collapse porn, grimdark lighting. No floating circles, wireframe
polygons, ornamental geometry or meaningless glyphs. Coherent single scene, polished key art.

## TURN-3 · Clash

- **File:** `art/site/turn-3-clash.webp` · **1600 × 2000**

**Prompt**

Create one finished 1600x2000 portrait illustration for 600 BILLION Timelock TCG, an
unmistakably positive cypherpunk world where the future already works. Use cinematic editorial
realism with tactile screenprint grain, a matte-black core, warm Bitcoin-orange highlights and
ultraviolet-purple accents. Scene: two hand-built rigs facing each other down a single route,
one above and one below — the upper rig releases one clean arc of orange energy, the lower rig
holds it on a violet resilience dome, the arc bending where they meet at the centre of the
frame, sparks falling as harmless warm embers. A contest of engineering, not a war: sturdy
machines, no damage, no smoke, just force meeting design. Composition: vertical, the two rigs
top and bottom with the orange-meets-violet flash burning at the centre as the focal point,
dark calm edges. No people. No weapons, no destruction, no grimdark lighting, no collapse porn.
No card frame, title, text, letters, numbers, logos, watermark or interface. No floating
circles, wireframe polygons, ornamental geometry or meaningless glyphs. Coherent single scene,
polished key art.

---

## Wiring — flip each line only when its file exists

| Move | File to land | Lines to change in `site/index.html` |
|---|---|---|
| 1 | `art/site/turn-1-resource.webp` | move-1 `<img src>` + `alt` + `width="1600" height="2000"` |
| 2 | `art/site/turn-2-queue.webp` | move-2 `<img src>` (replaces `banner-04-queue.webp`) + `alt` |
| 3 | `art/site/turn-3-clash.webp` | move-3 `<img src>` + `alt` |
| — | CSS | `.turnstrip img` → `aspect-ratio: 4 / 5; object-fit: cover;` (currently 10/3 contain, the uncropped stopgap over the reused banners) |

Until the files land, the section shows the existing text-free banners as full uncropped 10:3
strips — presentable, just smaller than the portrait target.
