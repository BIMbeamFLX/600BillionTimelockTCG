# Edition One: the draw cycle

> **Superseded in one number, 2026-08-21.** `MAX_COPIES` moved from **3 to 4**
> (owner's call: a fourth copy should be worth owning in a game whose cards are
> bearer assets). Everything below was measured and tuned under a three-card
> playset, and the numbers are left as they were measured rather than edited to
> match — a rewritten analysis is not a re-run one.
>
> What that means for this document: the rates in §3 were set for a deck running
> three of each, so a fourth copy raises the density of every card analysed here
> by about a third, and **the degenerate-deck check in §5 should be re-run at
> four** before the format is called settled. The cap still sits an order of
> magnitude below the measured breaking point — 26 copies of Zap won 97.7% — so
> this is a tuning question, not a format-safety one.

Sixteen existing cards were retuned to give Edition One a card-advantage game.
No new cards were invented — every one of the 297 illustrations still depicts a
card that exists, and every changed card keeps its name, cost, stats, rarity,
character, flavour and Protocol Note.

This document explains the **shape** of the cycle so the next person can extend
or cut it without re-deriving the reasoning.

---

## 1. The problem

A review of ~4,800 headless matches found that the word "draw" appeared on 9 of
295 cards, and only one of those was a repeatable one-sided engine
(E1-224 *Arbadacarba, Protocol Gardener*). You drew one card per turn, forever.
Consequences:

- no attrition archetype — trading 1-for-1 forever is the only game
- no recovery from a bad opening hand
- removal and clash both cost a card, so the correct play was usually to hoard
- every deck had the same card flow, so affinities differed only in what the
  cards did, never in how many you saw

Two rules changed on the same day and the cycle is built for both:
**copy limit 3** (`MAX_COPIES` in `site/engine.js`, rulebook §7) and
**E1-004 Zap at 2 damage**.

### The set was not quite as dry as the grep suggested

Two Timelock cards already are draw spells; they just never say "draw":

- **E1-052 First Memory** (T) — *Target player moves the top three cards of their
  Stack into their Wallet.* Point it at yourself and it is a one-Resource draw-3.
- **E1-055 Query Burst** (XTT) — the same effect for X.

That matters for the spread below. Timelock is the one affinity that already had
card-advantage tools, so it receives fewer new ones: read its row as "2 new, on
top of the 2 it already had", not as an oversight.

---

## 2. Design rules the cycle follows

1. **Retune the weak, the redundant and the never-played.** Every card in the
   cycle was one of: a vanilla body ("No special ability."), one of three or
   more copies of the same effect in different affinities, or an ability whose
   rate made it unplayable (E1-255 *Genesis Archive* cost eight Resources for
   one card).
2. **The fiction has to already be there.** Drawing is reading a relay, restoring
   a backup, scanning a topology, saying the recovery phrase. Every card in the
   cycle had that meaning before it had the mechanic — E1-015 *Local Citadel*'s
   own Protocol Note describes a NIP-01 relay serving stored events to
   subscribers.
3. **Three copies must be worth running, and three copies must not be
   oppressive.** Under `MAX_COPIES = 3` a card is either a real deck slot or it
   is filler, so every rate is set for a deck that runs the full playset.
4. **One shape per card.** The cheap cantrips share the "effect, then draw one"
   template because that is what a cantrip *is*; everything else — a modal mode,
   a flat draw-two, a commit sink, four different trigger conditions — is a
   distinct decision point.
5. **Nothing unconditional and free.** Every repeatable engine is gated: by a
   Resource payment, by committing a body, or by an event the opponent
   influences. The only unconditional recurring draw in the cycle is on a
   six-Resource Avatar that archives itself if you stop holding Timelock.

---

## 3. The cycle

### Cheap cantrips — the floor (3 + 1 modal)

| Card | Aff | Cost | What it does now |
|---|---|---|---|
| E1-023 Emergency Reboot | Signal | S | Reboot target Avatar. **Draw a card.** |
| E1-214 Topology Scan | Bitcoin | B | Scan and reorder three, **draw a card.** |
| E1-089 Toggle State | Timelock | T | Commit or unlock a permanent, **draw a card.** |
| E1-028 Repair Packet | Signal | S | modal: gain 3 Uptime **or draw a card** |

These are the format's floor: cheap interaction that no longer costs you a card
to hold up. All four were previously "correct card, never worth the slot".

### Two-for-ones — the middle (3)

| Card | Aff | Cost | What it does now |
|---|---|---|---|
| E1-125 Restore Backup | Keys | K | Avatar out of the Archive, **draw a card.** |
| E1-216 Recovery Phrase | Bitcoin | 1B | **Draw two cards.** |
| E1-179 Resource Cut | Power | 2P | Decommission a Resource, **draw a card.** |

*Recovery Phrase* is the deliberate plain one: the set had no unconditional
"draw N" spell at all, so there was no way to dig out of a bad opening. Two
Resources for two cards is a conservative rate next to *First Memory*.

### Commit sinks — bodies that turn spare Resources into cards (3)

| Card | Aff | Cost | Body | Ability |
|---|---|---|---|---|
| E1-112 Proton, Cold Signer | Keys | 2K | 0/1 | `KK, Commit: draw a card.` |
| E1-147 Leon, Grid Stabilizer | Power | 3PP | 4/5 | `PP, Commit: draw a card.` |
| E1-255 Genesis Archive | Neutral | 4 | Hardware | `Commit: draw a card.` |

`Commit` is a once-per-turn gate by construction — the permanent unlocks in your
unlock step — so none of these can be chained. They sit at opposite ends of the
curve on purpose: a fragile two-drop, a durable five-drop, and the colourless
four-Resource engine that any Stack can run.

*Genesis Archive* is the flagship: it was `4, Commit: Draw a card.` — eight
Resources for one card, a card nobody has ever correctly played. It is now the
set's clearest "the long game is a real plan" statement.

### Trigger engines — pay a little, repeatedly (5)

| Card | Aff | Cost | Trigger |
|---|---|---|---|
| E1-015 Local Citadel | Signal | 3S | your Maintenance — pay 1, draw |
| E1-081 Benarc, Deep Channel | Timelock | 5T | your Maintenance — draw (no payment) |
| E1-100 Leaking Key Vault | Keys | 2KK | attached Resource's controller's Maintenance — pay 1, draw |
| E1-201 BK, Bear Market Builder | Bitcoin | 1B | you play a Resource — pay 2, draw |
| E1-168 Miner Rally | Power | 3P | you declare attackers — pay 1, draw |
| E1-271 Archive Listener | Neutral | 1 | any Avatar is decommissioned — pay 2, draw |

Each affinity's engine keys off the thing that affinity already does: Signal
runs a relay, Bitcoin plays Resources, Power attacks, Keys attaches a leak to
someone's vault, Neutral watches the Archive fill.

*Benarc, Deep Channel* is the only unconditional recurring draw, and it is
paid for elsewhere: six Resources, cannot attack unless the defender runs
Timelock, and archives itself the moment you control no Timelock Resource.

---

## 4. Spread

| Affinity | New draw cards | Notes |
|---|---|---|
| Signal | 3 | the relay colour — cheapest and most flexible |
| Bitcoin | 3 | ledger and Resources — the flat refill lives here |
| Keys | 3 | backups, archives and leaks |
| Power | 3 | all three are conditional on being the aggressor |
| Timelock | 2 | already owns *First Memory* and *Query Burst* |
| Neutral | 2 | deliberately the smallest share — see below |

**Neutral is kept small on purpose.** Colourless cards go in every Stack, so
Neutral card draw homogenises the format faster than anything else. The two
Neutral entries are both slow and both cost Resources per card (a four-Resource
permanent that draws one a turn; a one-Resource permanent that charges 2 a card
and only when an Avatar dies).

---

## 5. Why this is not a new degenerate deck

The format just came out of one, so the check matters. Three copies each of the
best draw cards, plus the remaining Zaps:

- **No free repeatable draw exists.** Every engine wants Resources per card
  (1, 2 or a Commit). The cheapest sustained rate in the cycle is 1 Resource per
  card, on a permanent that costs 3–4 to deploy and does nothing the turn it
  lands.
- **The cantrips do not add cards, they stop subtracting them.** *Emergency
  Reboot*, *Topology Scan* and *Toggle State* are net-zero: you replace the card
  you spent. That raises the floor on interaction without raising the ceiling on
  card flow.
- **Nothing here helps a burn deck.** A Power Zap deck wants damage, not cards;
  Power's three entries all require you to already have a board (declare
  attackers), spend three Resources on removal, or commit a five-drop.
- **The one flat refill is sorcery-speed and rate-honest.** *Recovery Phrase*
  is an Operation, two Resources for two cards, and does nothing to the board.
- **Removal answers all of it.** Five of the six engines are Protocols,
  Hardware or Avatars. The set is dense with answers: E1-024 *Protocol Cleanup*,
  E1-222 *Protocol Reset*, E1-175 *Hardware Shatter*, E1-267 *Network Reset
  Disk*, plus every Avatar removal card.
- **The strongest deck is now an attrition deck, and that is the point.** It
  wins by out-carding an opponent over many turns, which is the archetype the
  review said the format was missing.

The single card most likely to need a second look is **E1-081 Benarc, Deep
Channel** — free recurring draw is the strongest template in the cycle. It is
priced at six Resources with two live drawbacks, but if Timelock ramp turns out
to deploy it on turn four, gate it with `you may pay 1. If you do,` like
*Local Citadel*, which is a one-line change that still compiles.

---

## 6. Shapes the compiler accepts

`scripts/build_play_data.py` is a parser, not an interpreter, and the build must
stay at **295 auto-resolving, 0 assisted**. If you extend this cycle, these are
the phrasings that compile to a real `draw` op — match them exactly:

```
Draw a card.                     -> a play op; put it on its own line
Draw two cards.                  -> draw 2
COST: draw a card.               -> an activated ability ("Commit", "KK, Commit", "2, Commit")
<trigger head>, draw a card.
<trigger head>, you may pay N. If you do, draw a card.
• Draw a card.                   -> one mode of a "Choose one —" modal
```

Multi-effect cards work by putting each clause on its **own line**: the parser
matches one template per line and the engine concatenates the resulting play
ops. `Reboot target Avatar.\nDraw a card.` is two abilities and one card.

Trigger heads used by this cycle, all already in `TRIGGER_HEADS`:

```
At the beginning of your Maintenance,
At the beginning of the Maintenance of attached Resource's controller,
Whenever you play a Resource,
Whenever one or more Avatars you control attack,
Whenever an Avatar is decommissioned,
```

---

## 7. Two things deliberately NOT done

### Death triggers and combat triggers were withdrawn

The first pass gave draw to `When this Avatar is decommissioned,` and
`Whenever this Avatar deals damage to an opponent,`. Both were withdrawn because
of a **latent bug in `site/engine.js`**, not because of the design:

`play.js` renders the clash forecast with `E.previewClash(viewNow())` — a
*redacted view*, in which `pendingTriggers` is `{0: n, 1: n}`, two **numbers**.
`previewClash` clones that view and runs the real `applyCombatDamage` and
`stateChecks` on it, and any trigger raised there reaches
`state.pendingTriggers[String(seat)].push(...)` at `engine.js:4718` and throws
`push is not a function`, killing the render mid-clash.

This is reachable with the set as it already ships — E1-037 *AJ, Uptime Anchor*
(decommissioned), E1-197 *BK, Feedback Grower* (dealt damage) and E1-115
*Gadaj, Wallet Whisperer* (deals player damage) all raise triggers inside combat
damage. It is not currently reachable from any preconstructed Stack, which is
why no test catches it. **The fix belongs in `engine.js`**: `previewClash`
should normalise `pendingTriggers` to arrays on its clone (or refuse a view
outright). Once it lands, death-trigger draw is the most natural home for
Signal and Bitcoin attrition bodies — E1-036 *Morgs, Friendly Fork* (2S 2/2
vanilla, flavour "Disagreed, forked cleanly, still came to dinner") and E1-227
*Tobo, Wooden Firewall* (B 0/3 vanilla wall) are the two cards it was written
for.

### Art fields were not touched

`art_direction` and `art_prompt` quote the rules text that was current when the
illustration was commissioned. The art is finished and final; those fields are
the commission record, not a description of the current card. Rewriting them
would falsify the record without changing a pixel, so they were left alone. Card
faces re-render from `rules_text` at build time and are unaffected.

---

## 8. Cards considered and rejected

| Card | Why it was left alone |
|---|---|
| E1-032 Consequence Ledger | `tests/js/wave3.test.mjs` pins its current damage formula |
| E1-066 Resource Tap | `tests/js/triggers.test.mjs` pins its current Uptime payout |
| E1-246 Public Wallet Viewer | `tests/js/wave9.test.mjs` activates it and asserts the reveal |
| E1-190 Human Hashrate | the only card producing the `grantUptimeResourceAbility` op — retuning it would orphan live engine code |
| E1-248 Open Feed | the set's one *symmetric* draw card; the format needs it as a contrast |
| the five Receivers (E1-240, 251, 252, 274, 277) | a five-card cycle; converting it would be five copies of one effect, which is exactly what this cycle avoids |
| the five Shield Protocols, the four Protection Circuits, the five Rewrite Zaps | genuinely redundant, but each is a complete cycle whose symmetry is worth more than one more draw card |
