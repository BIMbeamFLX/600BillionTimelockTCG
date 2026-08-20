# ADR 0005: Keep v1 payouts single-destination and zaps wallet-to-wallet

- Status: Accepted
- Date: 2026-08-20

## Context

“Split payment” means automatically dividing mint sale revenue among multiple recipients. No technical invariant requires it; it is useful only after the recipients, percentages, rounding and failure policy are contractually defined.

Match stakes are different. The game already creates a NIP-57 invoice for the winner's Lightning address and lets the loser pay through WebLN or a `lightning:` link. The platform never holds the stake.

## Decision

Version 1 sends mint revenue to one operator-controlled Lightning backend and performs no automatic revenue split.

Match zaps remain wallet-to-wallet through NIP-57. Nostr Wallet Connect may be added later as another way for the payer to approve and pay the same invoice; it does not replace the winner's Lightning address, NIP-57 or the mint funding backend.

## Consequences

- No payout destination or split rule is needed for launch beyond the operator's own settlement backend.
- Revenue sharing, if agreed later, is accounting or a separate sweep job with explicit recipients and percentages.
- NWC is justified when WebLN and wallet deep-links measurably fail users, or when a persistent permission/budget flow is desired.

