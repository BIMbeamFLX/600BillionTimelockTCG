# ADR 0006: Sell a card for sats through the mint, with a receipt at every step

- Status: Proposed
- Date: 2026-08-20

## Context

Players want to sell single cards for sats. The obvious shape is an atomic swap:
two Cashu legs locked to one hash, coordinated over Nostr, no third party. That
is what `brenorb/granola` does, and it is the right end state.

It does not work against this mint today. Granola needs NUT-14 (HTLC) and a
standard `/v1/swap`, and this mint announces neither — `/v1/info` lists NUT-7 and
NUT-31 only, and `/v1/swap`, `/v1/keysets`, `/v1/restore` and the melt endpoints
all return 404. Adding NUT-14 is the correct long-term move and would also make
these proofs readable by cashu.me, Minibits and Nutstash. It is not a
prerequisite for selling a card this week.

So: the mint escrows. It already is the trusted party for issuance, so this adds
no new custodian — but it does move sats between two people, which issuance
never did.

The failure that matters is not fraud. It is a dropped connection at the wrong
moment leaving one side without card and without money.

## Decision

Four steps, in this order, because the order is what makes it safe:

1. **Prove.** Ownership is verified, not asserted: `snapshot()` already checks
   P2BK, DLEQ and proof state against the mint. A card that is not held cannot be
   listed, and the same card cannot be listed twice.
2. **Pay.** The buyer settles an invoice through the existing funding source. No
   Lightning node: `funding-cashu.js` receives ecash into `nutft_treasury`.
3. **Swap.** The held proof is spent and a replacement is issued to the buyer.
4. **Pay out.** The seller receives ecash from the treasury, minus the fee.

Payment before swap, never the reverse: a buyer who receives the card first has
no reason to pay.

Steps 3 and 4 execute in ONE transaction. A swap that succeeds while the payout
fails would leave the seller without card and without sats, and no retry can
undo an issued card. This is the same guarantee ADR 0005 establishes for the
invoice claim, applied to a second pair of writes.

### Every step hands back a receipt

Recovery is not a repair path bolted on afterwards; it is the primitive. Each
step is an entry in `nutft_operations`, which is already keyed and idempotent:
present the same key and the same answer comes back, forever, without repeating
the effect.

| receipt | held by | redeems for |
|---|---|---|
| `listing_id` | seller | cancel and take the card back, or collect the payout |
| `claim_key` | buyer | the card, retried as often as needed |
| `payout_token` | seller | the ecash, issued exactly once |

A lost receipt is not a lost card. Both parties can re-derive their side by
signing a NIP-98 proof of the key the card is locked to, so recovery never
depends on a string somebody had to keep.

Payout is immediate on settlement. A holding period protects against chargebacks
and Lightning has none, so a delay would cost trust and buy nothing.

## Consequences

- **The mint holds both sides between step 2 and step 4.** This must be stated on
  the trading page in the same plain register the shop uses. The site's whole
  argument is that it hands you the receipt rather than asking for trust; an
  escrow that does not say it is an escrow is the one contradiction this project
  cannot afford.
- A listed card is out of play until the listing is cancelled or sold. The seller
  keeps the right to cancel while the state is `open`.
- The seller is paid in ecash, not sats over Lightning. Anyone wanting sats melts
  the token in their own wallet. This is what keeps the marketplace node-free.
- The fee is a share of the same treasury payout, so the split to the operators
  needs no separate mechanism.
- This is a stepping stone. When the mint speaks NUT-14, the same listings can be
  settled without the escrow, and Granola becomes usable rather than something to
  reimplement.
