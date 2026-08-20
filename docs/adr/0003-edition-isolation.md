# ADR 0003: Launch Edition One only

- Status: Accepted
- Date: 2026-08-20

## Context

The proposed `600B-G` starter or premine edition is not part of the launch. Creating it would add another catalog, census, database and supply story before Edition One has been tested publicly.

## Decision

Launch one edition: `600B-E1`. There is no G edition or separate premine mint. Edition One includes exactly 21 copies of each Genesis card.

If a later edition is approved, it must use its own census file, `NUTFT_COLLECTION_ID`, `NUTFT_CATALOG_URI` and database. `NUTFT_CENSUS_PATH` selects that census at deployment.

## Consequences

- The launch has one catalog and one supply story.
- Staging and production E1 cards remain distinct because they use separate catalog URIs and databases.
- Edition One supply statements remain literal.
- Any future edition requires an explicit decision instead of being implied by launch configuration.
