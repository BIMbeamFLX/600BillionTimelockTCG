# ADR 0003: Give every edition independent identity and supply

- Status: Accepted
- Date: 2026-08-20

## Context

A starter or premine allocation taken from Edition One would consume most of its scarce supply and force every E1 supply claim to carry a footnote.

NutFT identity already includes the census commitment, collection id and catalog URI. Those values can isolate editions without another protocol feature.

## Decision

Mint each edition independently:

- `600B-G`: starter and premine cards with their own census and catalog.
- `600B-E1`: Edition One, including exactly 21 copies of each Genesis card.
- `600B-E2`: a later independent edition.

Each deployed edition uses its own census file, `NUTFT_COLLECTION_ID`, `NUTFT_CATALOG_URI` and database. `NUTFT_CENSUS_PATH` selects the census at deployment. A G card never consumes E1 supply.

## Consequences

- Staging, G and E1 cards cannot be confused or written into one another's databases.
- Edition One supply statements remain literal.
- Cross-edition products require an explicit higher-level bundle; the mint will not silently mix them.

