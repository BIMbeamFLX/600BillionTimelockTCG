# ADR 0001: Keep NutFT issuance first-party

- Status: Accepted
- Date: 2026-08-20

## Context

The word “mint” names two different roles here. `server/nutft-mint.js` issues NutFT card proofs and enforces CardBinding, edition, supply and trade invariants. A Lightning or Cashu funding backend only creates invoices and confirms settlement.

A generic public Cashu mint cannot replace the NutFT issuer because it does not implement those card rules. Using one as a funding backend also leaves sale proceeds in that operator's custody until they are swept.

## Decision

The first-party 600B NutFT mint is the only production card issuer. Production settlement uses infrastructure we control: the existing LND backend, or a self-hosted Cashu mint if we later choose that operational model.

`NUTFT_FUNDING=cashu` with a third-party mint is staging or experimental infrastructure, not the production custody model.

## Consequences

- We own the signing keys, database, backups and supply ledger.
- Funding remains replaceable without changing NutFT proofs.
- There is no search for a “NutFT-compatible public mint”; that is our mint's job.

