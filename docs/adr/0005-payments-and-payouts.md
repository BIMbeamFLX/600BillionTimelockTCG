# ADR 0005: Receive mint sales on our own node, and keep zaps wallet-to-wallet

- Status: Accepted
- Date: 2026-08-20 (revised)

## Context

"Split payment" means automatically dividing mint sale revenue among multiple
recipients. No technical invariant requires it; it is useful only once the
recipients, percentages, rounding and failure policy are contractually defined.

Match stakes are different. The game already creates a NIP-57 invoice for the
winner's Lightning address and lets the loser pay through WebLN or a `lightning:`
link. The platform never holds the stake.

An earlier revision preferred a restricted Nostr Wallet Connect connection to the
operator's own wallet, with an operator-run node as the fallback. That was
written before **phoenixd was set up and funded on the box**, and it turns on an
assumption that no longer holds: that the mint only ever needs to *receive*.

The card marketplace in ADR 0006 has to pay a seller. NWC as specified there
grants no outgoing-payment permission — deliberately, and correctly for a
receive-only mint — so it cannot settle the seller's side at all.

## Decision

**Version 1 has one revenue destination and no automatic split.** The funding
adapter is `phoenixd`, over loopback, on the same box as the mint.

- `POST /createinvoice` creates the buyer's invoice.
- `GET /payments/incoming/{paymentHash}` proves that exact invoice settled, by
  the **amount received**, before any NutFT is issued.
- The mint holds `http-password-limited-access`, which covers those two calls and
  `getbalance` and nothing else. It cannot `payinvoice`, `sendtoaddress` or
  `closechannel`.

NWC is not discarded: it remains a sound way for a *payer* to approve an invoice,
and may be added as an additional adapter. It does not replace the funding
backend, the winner's Lightning address, or NIP-57.

Match zaps remain wallet-to-wallet through NIP-57.

## Consequences

- No forwarding transaction, no sweep, no third-party Cashu custody in
  production. The custody question the Cashu funding source carried simply does
  not arise.
- Paying money **out** becomes possible, which ADR 0006 requires and which a
  receive-only adapter cannot do.
- The limited password is the whole protection: file permissions, loopback only,
  and `server/phoenixd.js` refuses a non-loopback host over plain HTTP.
- Revenue sharing, if agreed later, is accounting or a separate payout job with
  explicit recipients and percentages. The marketplace's fee path is the natural
  place for it, since it already splits a payment.

## What blocks payouts today

**The node has no channel.** As of 2026-08-20: `balanceSat 0`,
`feeCreditSat 25,210`, cap `50,000`. With no channel, an incoming payment is
added to the fee credit rather than the balance — it counts towards opening a
channel later, it cannot be spent or withdrawn, and ACINQ do not refund it.

So the mint can sell and pay nobody. Two consequences follow, and neither is
optional:

- **ADR 0006's payout step cannot run until a channel exists.** Card-for-sats
  has to wait for it; card-for-card does not.
- **There is a wall.** At the fee-credit cap incoming payments are *refused*, with
  nothing on our side to explain it. About 24,790 sat of headroom remains — some
  1,180 boosters at 21 sat, and far fewer once the price ladder turns over at
  pack 2,101. `balance()` reports both numbers so the wall can be watched rather
  than hit.
