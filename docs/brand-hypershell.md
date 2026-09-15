# Brand: Hypershell chrome, 600 Billion world

**Chrome is Hypershell. The game world is 600 Billion.** The TCG sits inside nappelin's shell, so
everything that frames the game looks like nappelin ("Brass Terminal"). The game itself keeps the
600 Billion brand.

| Chrome: Hypershell | Game world: 600 Billion |
| --- | --- |
| page frame, nav, footer, panels, buttons, fields, chips, labels, tables, dialogs, notices, the setup form, the HUD, focus rings | card faces and frames, the 600B mark and the TIMELOCK TCG wordmark, the affinity Plates, board and arena art, card-world effects (impacts, shards, embers), world plates, hero art |
| iron, brass, parchment; IBM Plex Mono body, Josefin Sans headings | Anton (`--display`) for the wordmark, 600B hero titles and card names; `--ember` inside the game world only; `--aff-*` on anything that names an affinity |

## Tokens

Declared once in `site/600b.css` and copied into `site/play.html`'s `:root`, which does not load
the stylesheet. These are the only names to use.

- **Core palette, no additions:** `--iron #0f0c08`, `--brass #e7bf76`, `--brass-2 #c9973f`,
  `--brass-3 #8f6a2a`, `--parchment #ece3d0`, `--signal #6de8a6`.
- **Surfaces:** `--panel`, `--well`, `--hairline`, `--emphasis`, `--divider` (brass at 3, 5, 14, 25
  and 12%), `--body-ink` and `--ink-quiet` (parchment at 82 and 62%), `--rust #d06b45` for danger.
  Solid colours for things that cannot be see-through (sticky bars, dialogs, the 3D clear colour):
  `--iron-850 #14100b`, `--iron-800`, `--iron-750`.
- **Type, motion, shape:** `--headline`, `--mono`, `--t-fast/--t/--t-slow` (160/200/240ms),
  `--ease`, `--r: 0`.
- **Brand layer, never themed:** `--display`, `--ember #ff6a00`, `--aff-power`, `--aff-bitcoin`,
  `--aff-keys`, `--aff-signal #7447b8`, `--aff-timelock`, `--aff-neutral`.

The old names (`--black`, `--cream`, `--muted`, `--line`, `--purple`, `--power`…) stay one release
as `var()` aliases so nothing breaks while pages move over. **`--signal` is not an alias:** it used
to be the Signal affinity's purple and is now the green signal colour. An old `var(--signal)` becomes
`var(--aff-signal)`.

## The green law

`--signal` means verified, live or on, and appears on at most one thing per view. In this game it
is used for one thing only: the account dot on the side bar, after the table accepted the player's
NIP-42 login. Ready or playable highlights, "online" labels, result seals, music and success notices
are brass. Critical is `--rust`.

## The non-negotiables

Border radius 0 everywhere, card faces included (the artwork draws its own frame). No
`box-shadow`, `text-shadow`, bevel or glow on chrome. Never Arial, Inter, Roboto, system-ui or Segoe
UI. Chrome moves in cuts and 160–240ms eases, nothing floats or bounces, `prefers-reduced-motion`
is honoured, and nothing works on hover only. The WebGL table keeps its lights and glows, and card
motion keeps its timing, but their colours follow the split above.

## Components: the `tcg-` prefix

nappelin has no napplet CSS base yet, so the Hypershell components live under a local prefix and
can be swapped for the real base later: `.tcg-btn` (`--primary`, `[aria-disabled="true"]`),
`.tcg-chip`, `.tcg-panel` (`--emph`), `.tcg-field`, `.tcg-label`,
`hr.tcg-steps` (the stepped divider). The site's older classes use the same rules: `.btn` is the
primary button, `.btn--ghost` the outline one, `.chip`, `.panel` and `.panel--act`, `.eyebrow` is a
label. A chip that names an affinity shows its Plate colour in its square dot.

## Inside a shell

`site/napplet.js` repaints the chrome from the shell's theme. It uses the first of these that sets
anything: `napplet.theme.get()`, then `window.nappletContext.theme`, then the defaults above. It
accepts only `{ tokens }` with exactly `--iron --brass --brass-2 --brass-3 --parchment --signal
--panel --well --divider --hairline --emphasis --body-ink --headline --mono --r`, and checks
each value for its kind before it is written: a colour is hex, `rgb()`/`rgba()`/`hsl()`/`hsla()`
with numbers only, or `black`/`white`/`transparent`; `--headline` and `--mono` are font family
lists; `--r` is `0` or a `px`/`rem`/`em` length. A value holding `url(`, `image-set(`, `var(`,
`env(`, `expression(`, `@`, `;`, `{`, `}`, `<`, a backslash or a line break, or one of the wrong
kind, keeps the default: a `url()` in a token would be fetched by every viewer. NAP-THEME's
`{ colors }` is not read: until the Hypershell theme service ships, the Hangar answers every
napplet with `{ colors: { background, text, primary } }`, and mapping that turned the brass
controls blue, so a colours-only payload keeps the palette above. Every change pushed through
`theme.onChanged` (`theme.changed`, which is how guild skins arrive) repaints from the defaults.
The brand layer is written again after each theme, so no payload can reach it.

## Fonts

| File | Face | Used at | Licence |
| --- | --- | --- | --- |
| `art/fonts/josefin-sans-var.woff2` | Josefin Sans, variable 400–700 | headings, 600 and 700 only | SIL OFL 1.1, `art/fonts/JOSEFIN-OFL.txt` |
| `art/fonts/plex-mono-{400,500,600}.woff2` | IBM Plex Mono | body 400, labels 500, controls 600 | SIL OFL 1.1, `art/fonts/PLEX-OFL.txt` |
| `art/fonts/Anton-Regular.ttf` | Anton600 | the brand layer only | SIL OFL 1.1, licence text not yet in the repo |

The woff2 files are byte-for-byte copies of the Hangar's own fonts. The site serves them itself, with
no font CDN. `scripts/build_napplet.py` puts every `url("../art/fonts/…")` in play.html into the
single-file napplet as a data URL. Anton stays a TTF there, because the repo venv has no
`fontTools`/`brotli` to subset it.

## Guards

`tests/test_hypershell_brand.py` checks `site/600b.css` strictly: tokens and values, aliases,
fonts, the components, no forbidden face, radius or shadow, no green (the one green dot is drawn by
`site/rail.js`) and no ember.
It checks each page's own CSS too, as an advisory check. `tests/js/napplet.test.mjs` compares the
adapter's defaults with the stylesheet and pins the theme reader and its value checks.

## Sources

- Decision: `design/HYPERSHELL.md` in `G:/Github/nappelin.com` (`origin/main`).
- Handoff (non-negotiables, components, prototype): branch `docs/hypershell-handoff`,
  `design/hypershell/design_handoff_nappelin_hypershell/README.md`.
- Shipped CSS the components match: `apps/hangar/src/design-system.css` in the same repo.
