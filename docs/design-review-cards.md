# E1 Card-Face Design Review (2026-07-28)

Based on the current renders in `art/cards/final/` (sampled across Zap, Avatar with
stats, `*/*` Avatar, Basic Resource) plus the layout code path. The frame language
itself — orange outer frame, black art core, purple structure, pale text field — is
strong and unmistakably 600B. These are refinements, ordered by impact.

## D1 — Affinity cost icons should carry their affinity color (HIGH)

The neutral cost circle is purple and every affinity icon sits in an **orange** ring —
Keys shows in orange although the canonical Keys color is `#7447B8` (see
`art/resources/keys.svg`). Give each cost/affinity icon its official ring color
(P `#FF6A00`, B `#F3C244`, K `#7447B8`, S `#FFF7EC`, T `#5E5ACB`). Players learn to
read costs at a glance by color; today all costs read "orange".

## D2 — The "PLAY" text-field label is wrong for most card types (HIGH)

"PLAY" sits above the rules text even on static Protocols, triggered abilities and
Resource abilities (e.g. Satoshi Orchard's "Commit: generate 1 Bitcoin."). Either
derive the label from content — PLAY (Zap/Operation), ABILITY (activated), TRIGGER
(when/whenever/at), STATIC (everything else) — or drop the label entirely. A wrong
rules-taxonomy label on 295 cards teaches players wrong categories.

## D3 — Geometric mechanic glyphs flatten the art (HIGH)

The neon polygon overlays (heptagon/zigzag, pentagon/rings) repeat across cards, cover
the illustration's focal area, and don't encode anything a player can read. The
illustrations underneath (solarpunk machinery, characters) are the asset — let them
breathe. Suggestion: remove the center glyphs; if a mechanic marker is wanted, move a
small affinity sigil to a fixed corner position at low opacity.

## D4 — Text-field vertical rhythm (MEDIUM)

Short rules text leaves a large empty pale field with the flavor floating mid-space
(most visible on Resources: one line + huge gap). Anchor flavor text to the bottom of
the field above the rarity row and let the rules block start at top — the gap then
collapses naturally. Alternatively shrink the field for low-text cards (two field
heights: standard / compact).

## D5 — Full-art treatment for the 19 Resources (MEDIUM, high visual payoff)

Basic Resources carry one line of rules text but pay for a full text field. A full-art
variant (art extends to ~80% of card height, single compact text band with
"Commit: generate 1 X.") would make the most-played cards in every deck the prettiest —
and the six world plates already prove the environments carry it.

## D6 — Rarity is nearly invisible (LOW)

"COMMON/UNCOMMON/RARE" as small bottom-left text is hard to scan in a stack. Color-code
the word (common cream, uncommon `#B991E4`, rare `#FF6A00`) or add a small gem glyph
next to the set number.

## D7 — Bottom-right affinity word is redundant (LOW)

The affinity is already the top-right icon; the bottom-right word repeats it. That slot
could carry the illustration credit or set total ("E1-121 · 295") instead.

## D8 — Flavor quote marks + name-first formula (LOW, editorial)

203/295 flavor texts start with the card/character name in quotes; at binder scale it
reads templated (see text-consistency C9). Free-form one-liners land better.

## What is already excellent (keep)

- `*/*` stat plate with ACTION | RESILIENCE micro-labels — clearest solution possible.
- Neutral-vs-affinity cost split (number circle + icon) — correct model, just needs D1.
- Type-line icon + all-caps Anton type line — instantly scannable.
- Card ID in orange, set branding row — clean.
- The pale text field on black/orange body gives the set its own face; black rules
  text on it hits AA contrast comfortably.
