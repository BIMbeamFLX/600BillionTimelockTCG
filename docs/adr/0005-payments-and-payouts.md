# ADR 0005: Receive mint sales directly and keep zaps wallet-to-wallet

- Status: Accepted
- Date: 2026-08-20

## Context

“Split payment” means automatically dividing mint sale revenue among multiple recipients. No technical invariant requires it; it is useful only after the recipients, percentages, rounding and failure policy are contractually defined.

Match stakes are different. The game already creates a NIP-57 invoice for the winner's Lightning address and lets the loser pay through WebLN or a `lightning:` link. The platform never holds the stake.

## Decision

Version 1 has one revenue destination and no automatic split. The preferred funding adapter uses a dedicated Nostr Wallet Connect connection to the operator's actual wallet:

- `make_invoice` creates the buyer's invoice in that wallet.
- `lookup_invoice` proves that exact invoice settled before NutFT issuance.
- The connection grants no outgoing-payment permission.

The sats therefore arrive directly in the operator's wallet, like a zap recipient receiving payment. An operator-controlled LND or Core Lightning node is the fallback if the chosen wallet does not reliably support both NWC methods.

Match zaps remain wallet-to-wallet through NIP-57.

## Consequences

- There is no forwarding transaction, sweep or third-party Cashu custody in production.
- The operator must provide a restricted NWC connection whose wallet service supports `make_invoice` and `lookup_invoice`.
- Revenue sharing, if agreed later, is accounting or a separate sweep job with explicit recipients and percentages.
- Buyer wallets still pay an ordinary BOLT11 invoice; they do not need NWC.
