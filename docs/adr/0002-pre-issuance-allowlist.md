# ADR 0002: Gate issuance, then preserve Cashu anonymity

- Status: Accepted
- Date: 2026-08-20

## Context

An early-access list is useful before a sale opens, but a public npub is not authentication. The buyer must prove control of the key. Once a paid invoice exists, asking for identity again can confiscate a pack after payment and breaks the anonymity expected from bearer ecash.

## Decision

Configure sale access only through environment variables:

```text
NUTFT_SALES=closed|allowlist|open
NUTFT_ALLOWLIST=npub1...,<32-byte-hex>,...
```

In `allowlist` mode, require a fresh NIP-98 proof when a paid quote creates the invoice. A paid claim treats its settled invoice as the entitlement and performs no identity check. Trades are anonymous. A free mint has no invoice receipt, so its claim remains gated.

Allowlist entries must never be hardcoded in source, generated assets or deployment documentation.

## Consequences

- Changing or closing the list cannot invalidate an already-paid pack.
- Open sales do not prompt a Nostr extension or disclose identity.
- The direct LNURL wallet path is unavailable while allowlisting because an ordinary Lightning wallet cannot provide the NIP-98 proof; buyers use the browser flow.

