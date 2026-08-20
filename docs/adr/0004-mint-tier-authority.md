# ADR 0004: Use the scored census as the mint rarity authority

- Status: Accepted
- Date: 2026-08-20

## Context

`cards/e1-cards.json` and older generated artifacts carry the historical three-level `rarity` field. The scored NutFT census assigns Genesis, Vault, Rare, Uncommon, Common and Basic tiers. Those sources disagree for 161 of 295 cards.

The production NutFT catalog is generated from `cards/nutft-census.json`, not from the legacy NORD asset set. Its signed assets already carry the scored `tier`; CardBinding commits to collection id, asset id and catalog URI, so changing descriptive metadata does not alter a card's binding or the census commitment.

## Decision

`cards/nutft-census.json` is the authority for mint tiers, caps, pools and face hashes. Mint and wallet surfaces use `tier`, never the legacy `rarity`, for scarcity.

Do not import `cards/e1-asset-set.json` into a production NutFT deployment. It belongs to the superseded NORD/flat-box path.

## Consequences

- Runtime catalog tests compare all 295 signed assets with the scored census and reject a leaked legacy `rarity` field.
- The old game/editorial rarity remains a visible cleanup task, especially on rendered card faces, but cannot change production supply.
- A future full visual re-tier must regenerate faces and blob hashes before publication; it does not require reminting CardBindings.

