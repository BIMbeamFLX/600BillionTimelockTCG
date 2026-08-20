# ADR 0003: Give every edition independent identity and supply, and ship them in order

- Status: Accepted
- Date: 2026-08-20 (revised)

## Context

A starter or premine allocation taken from Edition One would consume most of its
scarce supply and force every E1 supply claim to carry a footnote. Genesis cards
exist at 21 copies each; a starter run of any useful size would swallow them.

NutFT identity already carries what is needed to avoid that. The mint's identity
is the triple `{census_sha256, collection_id, catalog_uri}`
(`server/nutft-mint.js:141`), every card carries its edition
(`:307`), and a mint refuses a card belonging to another edition by construction
(`:558`). Editions can be isolated with no new protocol feature.

An earlier revision of this document proposed dropping the `600B-G` edition
altogether. The reasoning behind it was sound and is kept below as sequencing:
standing up a second catalog, census, database and supply story **before Edition
One has ever sold publicly** means running two untested supply chains at once.
That is an argument about order, not about whether the edition should exist.

## Decision

**Editions are isolated, and shipped one at a time.**

Each deployed edition uses its own census file, `NUTFT_COLLECTION_ID`,
`NUTFT_CATALOG_URI` and database. `NUTFT_CENSUS_PATH` selects the census at
deployment, so a second edition is configuration rather than code. A G card never
consumes E1 supply, and Edition One's "21 copies of each Genesis card" stays
literally true with no footnote.

**Order:**

1. `600B-E1` sells publicly first, on production, with real invoices.
2. `600B-G` — the starter edition — follows once E1 has been exercised end to
   end by people who are not us.

The G edition is 210 starter sets of two decks each. Twenty-one of them carry one
Genesis card apiece, spread so no Genesis card appears in more than three of the
twenty-one; the other 189 carry none. Those 21 sets also include one `FIPS-P01`
promo, which lives outside every box and costs nothing in scarcity.

That works out at **21 G-edition Genesis copies against 189 in E1 — a 10%
premine**, published rather than discovered. Two of the nine Genesis cards
(`E1-088 State Reset`, `E1-266 Timelock Crystal`) appear in no starter deck at
all and remain obtainable only from packs.

## Consequences

- Edition One launches with one catalog and one supply story, which is what the
  sequencing argument was protecting.
- Staging and production E1 cards remain distinct: separate catalog URIs and
  databases.
- The G edition needs a census file and three environment variables. No code.
- Any further edition is an explicit decision, never implied by configuration.
- The premine figure has to be published on the same page as the E1 supply claim,
  before the first E1 sale. Discovered later it reads as the thing Ethereum is
  attacked for; stated up front it explains a number rather than hiding one.
