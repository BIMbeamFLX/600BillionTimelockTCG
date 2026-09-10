# NutFT supply ledger

How many of each card the mint has issued, signed by the mint, in a form a
holder can keep and check.

## Why

A NutFT proof is blind-signed. That hides who holds which card, which is the
point. It does not need to hide how many exist: scarcity is the property a
collection is valued on, and a number the mint alone can see is not a property,
it is a promise.

`/nutft/state` already reports `remaining` per card, `sold` packs and the
mint's commitment. Three things are missing from that answer. It is unsigned,
so a copy of it binds nobody. It is only ever the current figure, so nobody can
show what the mint said last week. And two holders cannot tell whether they were
told the same thing.

The supply ledger fixes all three with one mechanism: the same figures, signed
with the catalog key every wallet already trusts, each snapshot naming the one
before it. The mint keeps the chain, serves it whole, and pushes it to relays.

## The event

Kind `7610`, a regular Nostr event. The number is unregistered and sits beside
the NORD family at 7600, which publishes per-asset chains; this is one chain per
edition.

| Field | Value |
| --- | --- |
| `pubkey` | the catalog issuer, the same x-only key that signs the catalog |
| `kind` | `7610` |
| `created_at` | when the snapshot was taken, never earlier than the previous one |
| `tags` | `["x", <census_sha256>]`, and for every snapshot after the first `["e", <previous event id>, "", "prev"]` |
| `content` | canonical JSON, keys sorted, no whitespace |
| `sig` | BIP-340 over the id with zero auxiliary randomness, deterministic like the catalog signature |

The content:

| Key | Meaning |
| --- | --- |
| `schema` | `600b-nutft-supply-v1` |
| `collection_id` | the unit, for example `600B-G` |
| `catalog_uri` | the catalog this ledger counts |
| `census_sha256` | the census the catalog was built from; also the `x` tag |
| `seq` | 1 for the first snapshot, then +1 each |
| `prev` | the previous snapshot's event id, `null` for the first; also the `e` tag |
| `packs` | how many packs the edition has, from the census |
| `issued_per_pack` | how many counted cards each pack issues, `paid_cards_per_pack` from the census |
| `sold` | packs **issued** so far; see "Issued, not reserved" below |
| `remaining` | copies not issued, one entry per printed card |

Only printed cards are counted. A card with no `copies` in the census, such as
the free Basic that tops up every Edition One pack, has no entry.

The mint's draw commitment is deliberately absent. It follows allocation
rather than issuance, so it moves when a pack is merely reserved, and a signed
field a verifier cannot check against the rest of the snapshot is worse than
one that is not there. It stays on `/nutft/state` and the quote, where it
belongs.

## Issued, not reserved

A committed purchase (`docs/nutft-purchase-and-possession.md`) takes a pack out
of the mint's counts before anybody has claimed it, and `releaseExpiredPurchases`
puts it back when the buyer never returns. The mint's own `state.counts` and
pack counter therefore describe what is **allocated**, and that figure goes
down as well as up.

What a holder wants to know is how many cards are in somebody's hands. So the
ledger reads allocation and gives the open reservations back before it signs.
All four transitions then move the way a count of issued cards should:

| Event | Allocated | Reserved | **Issued** |
| --- | ---: | ---: | ---: |
| a purchase opens | +1 | +1 | unchanged |
| it is claimed | 0 | −1 | **+1** |
| it expires unclaimed | −1 | −1 | unchanged |
| a claim with no purchase | +1 | 0 | **+1** |

That is what makes the monotonicity checks below sound. Attesting allocation
instead would make an ordinary expiry look like stock reappearing, and the
ledger would refuse to sign a mint that had done nothing wrong.

## What a verifier checks

Every check is local. Nothing has to be asked of the mint to verify a chain.

1. Every event hashes to its own id and is signed by the issuer named in the
   catalog.
2. Every event names this collection, this catalog and this census, in the
   content and in the `x` tag.
3. Sequence numbers run 1, 2, 3 with no gap or repeat, each `prev` is the id of
   the one before, and `created_at` never goes backwards.
4. `packs` and `issued_per_pack` never change.
5. `remaining` covers exactly the printed cards, every count lies within
   0 and the printed copies, and no count ever grows from one snapshot to the
   next.
6. `sold` never shrinks and never exceeds `packs`.
7. The books balance in every snapshot:
   `printed − Σ remaining = sold × issued_per_pack`. Every issued card was one
   decrement of one count, and every pack issues exactly `issued_per_pack` of
   them, so this identity holds from the first sale on and does not depend on
   when the ledger was switched on.

A verifier that keeps the last `seq` and id it has seen adds a ninth: the chain
it is shown next time must still contain that event at that number. A mint that
signs two different histories is caught by the first holder who saw both.

## What the mint does

- At boot it audits its books against the last snapshot and, if the figures
  moved, signs a new one. A mint that has sold nothing since has nothing new to
  say.
- On a timer, `NUTFT_SUPPLY_INTERVAL_SECONDS`, one day unless set, it does the
  same. A snapshot per sale would timestamp every purchase; a snapshot per
  interval says only how many cards left the mint in that interval. The interval
  is the operator's dial between fresh figures and coarse timing. `0` turns the
  timer off, which is for tests.
- It refuses to attest books that do not balance or that moved backwards,
  logs why, and keeps selling. `/nutft/supply` reports the fault for as long as
  it lasts, and the last true snapshot stays on offer. A new attestation must
  not be able to take the shop down; a mint whose books are wrong is a finding
  to act on, and it is visible.
- With `NUTFT_SUPPLY_RELAYS` set, a comma-separated list of `wss://` URLs, it
  offers every snapshot no relay has accepted yet to every relay after each
  tick. A snapshot counts as published once one relay has taken it. A relay
  that refuses or does not answer leaves the snapshot pending for next time.

The chain lives in the mint's own database, table `nutft_supply`, beside the
state it attests.

## Where to read it

| Route | What |
| --- | --- |
| `GET /nutft/supply` | the whole chain: `issuer`, `kind`, `collection_id`, `census_sha256`, `relays`, `fault`, `events` |
| `GET /nutft/state` | as before, plus `supply`, the latest event. `remaining` beside it stays the live **allocation** figure, which is why the two can differ while a purchase is open |
| `GET /v1/info` | `nuts.31.supply_kind` and `nuts.31.supply_relays` |

Relays carry the same events under `kinds: [7610]`, `authors: [<issuer>]`,
`#x: [<census_sha256>]`.

## What it does not do

It does not prove the mint issued nothing outside its books. Blind signatures
mean a dishonest mint could sign a proof and not count it; what the ledger
gives is that such a mint has then signed a false statement in public, and
that any holder can show which one.

It does not carry prices. A NutFT transfer moves a card and nothing else, and
the ledger counts cards, not sats.

## How large the chain gets

A snapshot carries one count per printed card, so its size follows the
edition, and the chain grows by one snapshot every interval in which
something was actually sold. An interval that sold nothing adds nothing.

| Edition | One snapshot | Snapshots before the chain reaches 2 MiB |
| --- | ---: | ---: |
| `600B-E1`, 295 cards | 5,143 bytes | 407 |
| `600B-G`, 153 cards | 2,893 bytes | 724 |

2 MiB is the cap a Bearlett napplet puts on a single mint response
(`MAX_RESPONSE_BYTES` in its NutFT service). **Past that, `/nutft/supply`
stops being readable by a napplet**, and supply verification fails closed
rather than degrading quietly. At one snapshot per selling day that is a
little over a year of active sales for Edition One.

The fix, when it is needed, is paging: serve a bounded window and let a
client ask for the range that covers its own witness. That is a change to
this route and to the client, **not to the event format** -- the events
already published stay valid and verifiable, so it can wait until the
figures above say it should not.

## Operator notes

The box's relay accepts writes from an allowlist. For the mint to publish, the
catalog issuer key of each edition has to be on it; each edition has its own.
The issuer is `catalog_issuer` in `/v1/info`.

The snapshot does not need the key material of anything but the catalog key
the mint already holds. No new secret is introduced.
