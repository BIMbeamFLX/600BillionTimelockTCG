# Claude handover — website art — 2026-08-16

## Summary

The locked website art catalog in
`art/prompts/WEBSITE-ART-PROMPTS.md` has been fully executed. Ten final assets
have been generated, upscaled to the required output sizes and integrated into the intended
pages. The build, 305 JavaScript tests, 108 Python tests and the visual
browser acceptance check are green.

This work was deliberately **not committed, pushed or published**. No keys,
`nsec`, Blossom, nsite or other publishing steps were used.

## Git state

- Repository: `G:\Github\TCG600nap`
- Branch: `fix/art-crop-full-heads`
- HEAD before this uncommitted website art slice: `87703c8`
- The branch is already four commits ahead of `origin/main`:
  - `f1f1c0f fix: stop cutting the heads off sixteen cards`
  - `d35c406 feat: the card shows the whole picture`
  - `499e0df docs: the handover's unpublished-blob count moved from 13 to the whole set`
  - `87703c8 feat: audit the site's imagery and lock the website art prompts`
- `art/video-intro/` is untracked, unrelated user WIP. Do not change it and do not stage it.

## Generated assets

| ID | File | Output |
| --- | --- | --- |
| WEB-01 | `art/site/hero-index.webp` | 2880 × 1280, WebP q90 |
| WEB-02 | `art/site/hero-rules.webp` | 2880 × 1280, WebP q90 |
| WEB-03 | `art/site/hero-quickstart.webp` | 2880 × 1280, WebP q90 |
| WEB-04 | `art/site/hero-lore.webp` | 2880 × 1280, WebP q90 |
| WEB-05 | `art/site/hero-play.webp` | 2880 × 1280, WebP q90 |
| WEB-06 | `art/site/hero-shop.webp` | 2880 × 1280, WebP q90 |
| WEB-07 | `art/site/hero-leaderboard.webp` | 2880 × 1280, WebP q90 |
| WEB-08 | `art/rulebook/banner-02-five-resources.webp` | 1600 × 480, WebP q90 |
| WEB-09 | `art/rulebook/banner-05-clash.webp` | 1600 × 480, WebP q90 |
| WEB-10 | `art/site/og-card.png` | 1200 × 630, PNG |

The prompts were taken from the catalog unchanged. Image generation ran at
the highest built-in resolution available without a key; the images were then scaled
deterministically to the output format with Pillow/Lanczos. Because their raw images were
narrower, WEB-08 and WEB-09 got calm dark side areas instead of distortion or aggressive
cropping. The result was signed off in the real page layout.

Identity/world references used:

- WEB-01: `art/world-plates/original/timelock.png`
- WEB-03: `art/references/join-detailed-front/flx.png`
- WEB-03: `art/references/join-detailed-front/madmunky.png`
- WEB-10: `art/brand/600B-logo-primary.png` was composited in after generation as a real logo
  about 180 px in size.

The uncropped world plates under `art/world-plates/original/` were available. There was
no fallback to the softer web proxies. The raw model outputs are located
outside the repository at
`C:\Users\FLX\.codex\generated_images\01a004e0-fa6f-7292-b9ef-d3d570999c7d\`.
The scratch runner used only for this processing,
`art/generated/process_website_art.py`, is gitignored and does not automatically belong in
a commit.

## Integration

- `site/index.html`
  - new hero background image;
  - OG/Twitter image set to `og-card.png`, including 1200 × 630 metadata;
  - resources banner switched from SVG to the new WebP.
- `site/rules.html`
  - new Rules hero;
  - resources banner switched to WebP;
  - clash banner uses the same path and needed no markup change.
- `scripts/build-rulebook.cjs`
  - the same hero and banner references were set in the generator so that a
    rulebook build does not revert this change.
- `site/quickstart.html`, `site/lore.html`, `site/play.html`
  - previous world plate backgrounds replaced with the respective new heroes.
- `site/shop.html`, `site/leaderboard.html`
  - real, responsive hero sections added and the existing introductory text moved
    there.

Important: even before this slice, `npm run build` has an independent drift in the
`card-system-preview` alt text/caption in `site/rules.html`. The build writes the
older generator text there. After the successful build, the newer version that was already
present in `site/rules.html` was restored. If Claude runs the build again,
this one unrelated text change must not be committed along with it by accident; either
restore the existing version or align the generator in a separate fix.

## Verification

| Gate | Result |
| --- | --- |
| `npm run build` | successful |
| `npm run test:js` | 305/305 green |
| `uv run pytest -q` | 108/108 green |
| `git diff --check` | clean; only Windows line-ending warnings |
| Image format check | all ten files have exactly the target dimensions |
| Browser acceptance check | Index, Rules, Quickstart, Lore, Play, Shop and Leaderboard without console errors |
| Banner acceptance check | resources and clash banners visible and correct in the respective rules chapter |

During the acceptance check, the local server responded at
`http://localhost:8777/index.html` with HTTP 200.

## Intended uncommitted scope

Check with `git status --short` before staging. The following belong to the website art slice:

```text
art/rulebook/banner-02-five-resources.webp
art/rulebook/banner-05-clash.webp
art/site/hero-index.webp
art/site/hero-leaderboard.webp
art/site/hero-lore.webp
art/site/hero-play.webp
art/site/hero-quickstart.webp
art/site/hero-rules.webp
art/site/hero-shop.webp
art/site/og-card.png
scripts/build-rulebook.cjs
site/index.html
site/leaderboard.html
site/lore.html
site/play.html
site/quickstart.html
site/rules.html
site/shop.html
docs/handover/2026-08-16/CLAUDE-HANDOVER.md
```

Explicitly not part of this scope:

```text
art/video-intro/
art/generated/process_website_art.py
```

## Recommended next steps for Claude

1. Read `git status --short` and exclude `art/video-intro/`.
2. Keep the build drift described above in mind if `npm run build` runs again.
3. If the owner approves a commit, stage only the explicit scope and use a
   Conventional Commit such as `feat: add locked website artwork`.
4. Because of the four existing branch commits, first confirm the planned PR scope with
   the owner before a push/PR.
5. Do not upload any images to Blossom/nsite and do not read or use any keys until
   the owner explicitly commissions this as a separate publishing slice.

