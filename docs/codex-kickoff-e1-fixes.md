# Codex Kickoff — E1 Fix Pass (Text, Voice, Design)

Copy-paste this whole file as the opening prompt for a fresh Codex session in
`G:\Github\TCG600nap`. Single-writer rule: do not run this while another agent session
is rendering or editing card data.

---

You are working in `G:\Github\TCG600nap` — **600B Timelock TCG, Edition One**: an
original, positive-cypherpunk trading card game (295-card text lock). Read these first,
in this order:

1. `rules/600B-Timelock-TCG-Rulebook-E1.md` — the rules contract (§14 keywords, §21
   Protocol Notes, §23 terminology map, §25 originality).
2. `docs/rules-audit-e1.md` — 15 cards still using legacy TCG vocabulary; exact fixes.
3. `docs/text-consistency-e1.md` — consistency findings C1–C10 incl. measured
   generator slop and Protocol-Note duplication.
4. `docs/design-review-cards.md` — card-face design improvements D1–D8.
5. `cards/e1-cards.json` — canonical card data (text-locked; change only via tasks
   below). `art/cards/final/` renders must match it.

**Pipeline rules (non-negotiable):** decisions are recorded in the local audit SQLite
before public artifacts change; source/reference data is read-only; typed Python,
ruff + pytest green before every commit; Conventional Commits on branch
`fix/e1-text-consistency`; small incremental commits.

**Voice (from FLX):** educational AND funny. One accurate teaching idea per card, one
light original joke welcome. **Never** investment language ("bullish", price talk —
§21 forbids it). The project vocabulary does not include "Web5" — remove the term
wherever it appears. No WotC/MTG vocabulary anywhere (§23).

**Pre-decided defaults (override only if FLX says so in chat):**
- Adopt **Broadcast Guard** as an official §14 keyword: "An Avatar with Broadcast
  Guard may block Avatars with Broadcast."
- Rename E1-191 to **"Mtoshi, Lethal Courier"** (old name used a third-party keyword
  coinage; rename the art file too).

## Tasks, in order

1. **De-slop the flavor texts.** The last flavor pass rotated five catchphrases
   ("Bullish on builders." ×20, "Culture is a protocol too." ×20, "Consensus looks
   good on us." ×18, "Stay sovereign. Send it." ×17, "Good signal. Strong hands." ×16).
   Rewrite: every flavor text free-form and original, no tail phrase used more than
   twice in the whole set, no investment language, jokes welcome. The 92 pre-existing
   free-form flavors are the quality bar.
2. **Apply `docs/rules-audit-e1.md` fixes 1–4** (Wall→Firewall ×9,
   regenerated→Rebooted ×4, "nonartifact, nonblack"→"non-Hardware, non-Keys",
   haste→"as though it did not have Boot Delay" ×2) plus the E1-191 rename.
3. **Apply `docs/text-consistency-e1.md` C1/C2/C4/C7:** add Broadcast Guard to §14;
   normalize all keyword reminders to the canonical table (12 deviations listed);
   E1-001 "generate three"→"generate 3"; E1-170 trigger opener → "Whenever … attacks".
4. **Protocol-Note dedup (C10):** no note text more than 2× set-wide; spread sources
   across BIPs, NIPs, Lightning bolts, Core docs and cypherpunk history; keep §21
   format (one factual claim + citable source in the database).
5. **Rulebook additions:** `*/*` stats paragraph in §3.2 (value defined by the card's
   ability, 0 where undefined, applies in every zone; §17 layer 7); one sentence in
   §2.4: "Cards may print *can't* for *cannot*."; new `docs/style-guide-cards.md`
   capturing the de-facto conventions (digits for amounts / words for card counts,
   zone-caps/verb-lowercase casing, duration rule: stat changes "until end of turn" vs
   permissions "this turn", ability-cost syntax incl. "— Maintenance" qualifier).
6. **Design pass D1–D4 in the face renderer:** affinity-colored cost rings (P #FF6A00,
   B #F3C244, K #7447B8, S #FFF7EC, T #5E5ACB — today everything renders orange);
   text-field label derived from content (PLAY / ABILITY / TRIGGER / STATIC) or
   removed; drop or corner-shrink the center polygon glyph overlays; anchor flavor to
   the bottom of the text field. D5 (full-art Resources) only if everything else is
   green.
7. **Re-render only affected faces**, then re-run all gates: text-lock report, pytest
   (27+), ruff, gallery rebuild, Cockatrice adapter (`scripts/build_set.py`), and
   update `cards/E1-CARD-TEXT.md`.
8. **Art prompts:** future art regeneration uses `cards/e1-art-prompts.json`
   (prompts-v2, one unique educational-and-funny prompt per card, deterministic seeds)
   — do **not** regenerate artwork in this pass.

## Acceptance criteria

- Zero hits for: Wall(s) as a game term, regenerat*, haste, nonblack/nonartifact,
  Deathtouch, "Bullish", "Web5" across `cards/` and `rules/`.
- Every keyword reminder matches the canonical table; Broadcast Guard defined in §14.
- No Protocol Note more than 2×; no flavor tail phrase more than 2×.
- All tests green, ruff clean, text-lock gate green, gallery and Cockatrice XML
  rebuilt without errors.
- History: small conventional commits on `fix/e1-text-consistency`, PR-ready.
