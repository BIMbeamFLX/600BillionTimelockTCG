# E1 Text Consistency Report (2026-07-28)

Automated pass over all 295 cards in `cards/e1-cards.json`, complementing
[rules-audit-e1.md](rules-audit-e1.md) (legacy vocabulary). This report is about
*consistency*: one canonical wording per concept.

## C1 — "Broadcast Guard" is used but never defined (6 cards, HIGH)

E1-069, E1-121, E1-130, E1-138 carry the reminder "(Only Avatars with Broadcast **or
Broadcast Guard** can block it.)"; E1-200 and E1-230 grant the ability the term implies
(blocking Broadcast without having Broadcast). The rulebook §14 knows neither the term
nor the concept-as-keyword.

**Decision needed — two clean options:**
- **(a) Adopt it:** add "Broadcast Guard — An Avatar with Broadcast Guard may block
  Avatars with Broadcast." to §14, keep all six cards. Recommended: the concept is
  mechanically useful (a "reach" analog) and already load-bearing on 6 cards.
- (b) Drop the term: reminder becomes "(Only Avatars with Broadcast can block it.)"
  everywhere, and E1-093/E1-200/E1-230 keep their spelled-out grant text without a name.

## C2 — Canonical reminder text per keyword (12 cards, HIGH)

One keyword must have exactly one reminder wording (self-referential "this" form; the
"that Avatar" form for granted effects is fine). Canonical templates:

| Keyword | Canonical reminder |
| --- | --- |
| Broadcast | (This Avatar can be blocked only by Avatars with Broadcast.) — plus "or Broadcast Guard" if C1(a) |
| Firewall | (This Avatar can't attack.) |
| Backchannel — X | (This Avatar can't be blocked while the defending player controls an X Resource.) |
| Shielded from X | (It can't be targeted, attached, blocked or dealt damage by X sources.) |
| Reboot | (The next time this Avatar would be decommissioned this turn, instead commit it, remove it from clash, and heal all damage on it.) |

Deviations to fix: E1-067 ("an Timelock Resource" — grammar; "They" for single Avatar),
E1-098/E1-140/E1-141/E1-218 (four different Backchannel phrasings, all missing "the"
before "defending player"), E1-048/E1-097 ("by anything Keys/Signal"), E1-093 (merged
Firewall+Broadcast-block reminder — split into the two canonical parts).

## C3 — can't vs cannot (33 cards, LOW — pick one)

Cards use `can't` 33×, `cannot` 0× — internally consistent. The rulebook's precedence
clause (§2.4) speaks of "cannot". Cheapest fix: add one sentence to §2.4 — "Cards may
print *can't* for *cannot*." No card changes needed.

## C4 — Number style is already a de-facto convention (1 outlier)

Observed convention: **digits** for damage/Uptime/Resource amounts (deals 3, gain 2,
generate 1 — 64 cards), **words** for card counts (draw two, discard a card — 7 cards).
Document it in the style guide. One outlier: E1-001 Genesis Lotus "generate three
Resources" → "generate 3 Resources".

## C5 — Verb/zone capitalization rule (LOW)

De-facto rule that should be written down: zones and stats capitalized (Queue, Wallet,
Stack, Archive-as-zone, Uptime — 100% consistent today); action verbs lowercase
mid-sentence (commit, unlock, archive-as-verb, decommission). 9 cards capitalize
"Commit" mid-sentence — align with cost-label "Commit:" (start of ability) which stays
capitalized.

## C6 — Duration phrasing (50 cards, MEDIUM)

"this turn" (32) and "until end of turn" (18) are mixed for the same meaning. Suggested
rule: stat/ability changes use **"until end of turn"**; permissions/restrictions use
**"this turn"**. Needs an editorial pass over the 50 cards against that rule.

## C7 — Trigger openers (1 card)

E1-031 and E1-258 are replacement effects ("If … would … instead") — correct as
written. E1-170 Split Route "On attack, …" is a trigger and must read
"Whenever … attacks, …" (§10.4 allows only when/whenever/at).

## C8 — Ability-cost format (documented, OK)

Consistent order `<resources>, Commit: effect` (e.g. "1, Commit:", "SS, Commit:").
Special forms "X, Commit — Maintenance:" and "Toss module — Commit:" appear once each —
fine, but the em-dash qualifier syntax should be defined in the style guide.

## C9 — Flavor formula (FYI)

203 cards use the ""Name. Clause. Clause."" formula, 92 free-form. Repetitive at
set scale; free-form reads better. Not a blocker — flag for E2.

## C10 — Measured end-of-set slop + wasted educational surface (HIGH)

Quality by set position (quintiles of 59 cards):

| Quintile | Flavor name-formula | help_text from top-6 templates | unique protocol_notes | unique art_prompt cores |
| --- | --- | --- | --- | --- |
| E1-001..059 | 77% | 74% | 27% | 7% |
| E1-060..118 | 67% | 71% | 20% | 7% |
| E1-119..177 | 49% | 81% | 20% | 7% |
| E1-178..236 | 55% | 69% | 29% | 7% |
| E1-237..295 | **93%** | 67% | 25% | **5%** |

- The last fifth is nearly pure flavor template — a generator fatigue signature.
  Rewrite pass for E1-237..295 flavor first, then the rest of the formula cards (C9).
- **The educational promise is underused:** 295 cards carry only ~60 distinct Protocol
  Notes; "PSBT…" and "compact block filters…" appear 10× each, and 5 sources cover 104
  cards. §21 says one accurate idea per card — the set could teach ~295 distinct
  Bitcoin/Nostr facts. Recommend a Protocol-Note dedup pass: each note appears at most
  2×, sources spread across BIPs, NIPs, bolts, Core docs, and cypherpunk history.
- Tone target (per FLX): **educational AND funny.** The templated formula is neither;
  free-form flavor with one light joke per card reads better (92 cards already do).
- art_prompt is a fixed sentence with the rules text pasted in — see
  `scripts/build_prompts.py` / `cards/e1-art-prompts.json` for the replacement
  prompts (per-affinity worlds, per-type composition, mechanic motifs, humor props).

## Suggested processing order

1. Decide C1 (recommend adopt), then apply C2's canonical reminders (12 cards).
2. Fix C7 (1 card), C4 (1 card).
3. Add C3 sentence + C5 casing rule + C4 number rule + C8 syntax to a one-page
   style guide (new `docs/style-guide-cards.md` or rulebook appendix).
4. C6 editorial pass (50 cards) — can ride along the next full re-render.
