# ADR 0007: Deliver E1 packs as LNURLcash cards the mint vouches for

- Status: Proposed
- Date: 2026-09-28

## Context

Felix wants the 600B Timelock TCG on nappelin.com with its cards held in
Bearlett, the LNURLcash wallet (LUD-25), rather than as NutFT proofs, and
chose on 28 September 2026:

- the card mint vouches for every card;
- it runs here, in this server, next to the census, the catalog and the sale;
- a card is 1 sat and cannot be paid out.

dni's seals (lnurl-wallet `src/addons/seals/seals.ts`) give the card format:
one note whose leaf commits to a state (card, owner, a hash of the state
before). A seal alone is forgeable, though. The spend never commits to its
outputs and any note can be minted onto any key, so whoever knows a state
can make a look-alike next one; an owner can fork a card with a merge and a
split; and a genesis carries no issuer signature. seals.ts itself lists the
missing per-transition certification as a gap.

The census is the scarcity authority (ADR 0004), packs are drawn strictly in
sequence, and the supply ledger's audit requires the cards that left the
mint to equal packs sold times cards per pack.

## Decision

**LNURLcash cards are a second delivery of the same paid E1 pack.**

- The quote, the draw, the state chain, the invoice and the supply are the
  booster's (`server/nutft-mint.js`, `claimCards`). Only the delivery differs:
  seal notes instead of blind signatures, issued inside the claim's own
  transaction.
- The buyer's wallet names its key before paying (LNURL-pay comment
  `cp1<key>`), written with the invoice, so the cards go to that key.
  Unlike a booster, holding the settled invoice collects nothing: every
  NutFT route refuses a card pack's invoice.
- The catalog key is the issuer: it signs every genesis and every move, and
  it is the key the signed catalog already names. A holder checks a card's
  whole history offline; the mint answers whether it is still live.
- A card is a 1000 msat note. The card mint refuses every burn of a card
  but a move to its next state (no split, merge or melt), and writes every
  change to the database before it answers.
- The rules come from Bearlett (`src/cards`, with its tests), vendored as a
  pinned bundle (`server/vendor/lnurlcash-cards.js`,
  `scripts/vendor-lnurlcash.mjs`), so they exist once.
- `server/card-mint.js` serves them at `/.well-known/lnurlcash-cards` and
  `/cards/...` with the LNURL wire format, and is off unless `NUTFT_CARDS`
  is on. The boot refuses it on a free mint, with committed purchases, and
  without an https public origin (docs/deploy.md §10.2).
- A paid card pack is never released to another buyer. A sweep issues it
  within 30 s whether its buyer asks or not, and closes a pack that expired
  unpaid.

The format is Bearlett's draft `docs/CARDS-LNURLCASH.md`.

## Consequences

- NutFT and LNURLcash deliveries draw from one supply and one pack sequence;
  the supply ledger keeps balancing.
- The mint sees each owner key and state on every move (NutFT kept owner
  keys blind); a new key once cards arrived keeps a holder's packs apart.
- The catalog key signs online, on every move.
- Card serials count LNURLcash copies per card (`card_serials`), not NutFT
  copies.
- Sealed packs (the beacon) are issued once their block is mined, on the
  holder's next lookup.
- Committed purchases (`NUTFT_PURCHASE_MODE`) are not offered as cards yet.
- A paid pack holds the shop until its cards are issued, at most one sweep
  while the card mint runs. An unpaid pack holds its pack for 600 s past
  its invoice's expiry, so a payment in flight at the expiry lands on a
  pack nobody else was sold. Should a payment still settle after its pack
  was sold again, it is closed (`card_closed = 'stale'`) and logged as
  `REFUND DUE`. A Lightning payment has no return address, so the buyer
  has to come forward with its payment hash.
- Every card names the public origin for good: the card mint keeps the
  first one and stays off under another, as under another issuer key. The
  referee goes on without it. So does the NutFT sale, unless a paid card
  pack is waiting: that pack holds the shop, and a quote says the card mint
  is off, until it is on again.
- A card moves at most 999 times here (`CARD_STATES`, where the rules
  allow 9,999): a history is rewritten on every move and checked in full at
  every start. A card that no longer checks out is quarantined at the
  start, not fatal. A pack whose issue fails is held not at all and tried
  again later, waiting longer each time, up to an hour.
- One process owns the card tables; a write never replaces a card's history
  with one that is not longer.
