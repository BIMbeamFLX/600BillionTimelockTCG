# NutFT: committed purchases and possession certificates

Status: specification, 10 September 2026, not implemented. Adopted from the
NutFT Pokémon proof of concept (its server is unpublished; the client contract
was read from `nutft-wallet.js` there). Line numbers below refer to
`server/nutft-mint.js` and `site/nutft-wallet.js` on `feature/nutft-catalog-blob`.

## 1. Why

Today `GET /nutft/quote` draws the pack on a copy of the mint state and returns
the card list before anything is committed (`quote()` at 571-587 via
`drawPaidCards` 559-562; nothing persists but the invoice row, 775-785). A free
mint therefore shows the pack before the buyer decides; a paid mint without a
beacon shows it before the invoice is paid (786-792). Only beacon-sealed sales
hide the draw until the block (793-802). Two consequences:

- A buyer can quote until a pack they like appears, then claim that one. With a
  beacon the draw is unknowable, but most editions run without one.
- Nothing binds a draw to a buyer before the claim. If the claim response is
  lost, the wallet's pending record is the only thing that can recover the
  cards; if the state advanced meanwhile, the claim fails with "stale booster
  quote" (968) and the buyer gets nothing.

A **committed purchase** fixes both: the quote no longer reveals cards, a
separate step commits the draw to a buyer-chosen `purchase_id`, and the mint
remembers that draw until it is claimed.

A **possession certificate** lets a holder prove to a third party (a match
table, a tournament, another player) that they hold specific cards, without
spending them. Today possession is checked client-side only
(`site/play.js` `verifyNutftSetup`, 4626-4651); the table never sees proofs.

## 2. Committed purchase

### 2.1 Quote

`GET /nutft/quote` keeps its gates (`requireMayBuy` 602-648, one-per-key,
invoice sweep 712-734, beacon commit 741-749, invoice creation 764-766) and its
fields, with one change: when the mint runs in purchase mode it returns
`purchase_required: true` and `cards: null` on every path, free, paid and sealed.
`pack_id`, `state`, `unit`, `amount`, `catalog_uri` stay, and for paid mints
`payment_request` and `payment_hash` stay. `next_state` and `beacon` are no
longer disclosed at quote time.

Purchase mode is opt-in: `NUTFT_PURCHASE_MODE=1` (`G_NUTFT_PURCHASE_MODE=1` for
the G instance) turns it on; without the flag the quote keeps revealing cards
exactly as today. `/v1/info` advertises `purchase_mode: true|false` so a wallet
knows which flow to run. The flag becomes the default only after the shop and
the wallet have passed the new path against the regtest mint (decision of
10 September 2026).

### 2.2 Purchase

`POST /nutft/purchase`, JSON body:

| Field | Required | Meaning |
| --- | --- | --- |
| `purchase_id` | yes | 32 random bytes as hex, chosen by the wallet, also used as the booster `idempotency_key` |
| `pack_id` | yes | from the quote |
| `state` | yes | from the quote |
| `payment_hash` | paid mints | from the quote |

NIP-98 gates the purchase exactly as it gates the quote today (free mints:
`requireMayBuy`; paid mints: the settled invoice is the entitlement, 938-954).

The mint:

1. Rejects an unknown `pack_id`/`state` pair with `stale booster quote`, as the
   claim does today (968).
2. On paid mints requires the invoice to be settled (`requireSettled` 847-865)
   and bound to this pack. On sealed sales requires the beacon block
   (`beaconFor` 122-137); before the block it answers
   `{status: "sealed", target_height, cards: null}` with HTTP 200, the same
   shape the reveal uses today (816-832).
3. Draws the pack deterministically as the claim does (`quote(saleBeacon)`,
   967) and **persists** the draw: table `nutft_purchases(purchase_id PRIMARY
   KEY, pack_id, state, next_state, cards_json, buyer, payment_hash, created_at,
   claimed_at)`.
4. Reserves the pack: `state.nextPack` and `state.state` advance and the counts
   decrement inside the same transaction, as the claim does today (995-997,
   1024). From this moment no other quote can obtain this `pack_id`.
5. Returns `{purchase_id, status: "purchased", pack_id, state, next_state,
   cards, unit, amount, catalog_uri}`.

Idempotency reuses `nutft_operations` with type `"purchase"` (224-230): the same
`purchase_id` with the same body returns the stored response; a different body
is refused with `purchase_id was already used for a different purchase`.

### 2.3 Claim

`POST /nutft/booster` accepts a `purchase_id` in place of a fresh draw. With a
`purchase_id` the mint loads the persisted draw, validates the outputs against
those cards (890-904), signs, and marks `claimed_at`; it does not re-advance the
state (already advanced at purchase). Without a `purchase_id` the claim behaves
as today, so shops that still quote-and-claim keep working. The booster
`idempotency_key` equals the `purchase_id` in purchase mode.

### 2.4 Reservation lifetime

Decision pending (see section 5). The options, with their supply effect:

| Option | Behaviour | Supply effect |
| --- | --- | --- |
| A. Reserve until claimed, release after the claim grace | Unclaimed purchases are swept after `NUTFT_CLAIM_GRACE_SECONDS` (today 3600 s, 259-262): counts restored, `pack_id` reusable, the buyer's `purchase_id` answers `expired` | Bounded; matches today's invoice sweep |
| B. Reserve for ever | A committed purchase always owns its cards; nothing is swept | Unbounded; lost wallets strand supply |
| C. No reservation | Purchase only hides the cards; the claim still races and can fail with `stale booster quote` | None; weakest guarantee |

Decision of 10 September 2026: **option A.** It keeps the buyer's guarantee for
as long as a paid invoice is honoured today, and it never strands capped cards.
Release means: the row keeps `status: "expired"`, the counts and `state.state`
are restored to the values recorded at purchase, and the `pack_id` is issued
again by the next quote. A claim arriving after the release is refused with
`purchase expired`; a paid invoice behind an expired purchase follows today's
sweep rules (712-734).

### 2.5 Wallet

`buyBoosterUnlocked` (446-479) already carries `state.pending` through the
claim. In purchase mode it: quotes; stores `pending.body.purchase_id` (32 random
bytes); on `purchase_required` calls `/nutft/purchase`, then `outputsFor` with
the returned cards, writes the pending record with outputs, and claims with
`idempotency_key = purchase_id`. On a refused delivery it keeps the pending
record instead of dropping it (the PoC's "a committed purchase still owns its
cards"). `recoverPending` (269-274) re-sends the purchase first if the pending
record has a `purchase_id` but no outputs yet.

## 3. Possession certificate

### 3.1 Request

`POST /nutft/possession` (the PoC used `POST /nutft/reveal`; that name collides
with today's `GET /nutft/reveal?payment_hash`, so the certificate gets its own
path; an alias can be added if the PoC game runtime needs it). JSON body:

| Field | Meaning |
| --- | --- |
| `player` | the player's Nostr pubkey, hex |
| `room` | the match or event id, up to 128 characters |
| `inputs` | proofs as serialized by cashu-ts, at most 64 |
| `authorizations` | one BIP-340 signature per proof, hex, over `sha256(canonical({domain: "NutFT-play-v1", player, room, secret}))`, signed with the P2BK key that the proof is locked to |

### 3.2 Verification, in order

1. Shape and size; `room` and `player` well formed.
2. Each proof: keyset id, amount 1, well-formed `nutft` tag, binding recomputed
   (`parseNutftSecret` 867-888 and the claim's checks), DLEQ.
3. Each proof unspent in `nutft_spent` (the same source as `/v1/checkstate`,
   1135-1144).
4. Each authorization verifies against the P2BK public key carried in the
   proof's secret.
5. No duplicate secrets.

Nothing is spent, marked, or stored except a counter for rate limiting.

### 3.3 Response

```json
{
  "kind": "nutft/possession",
  "version": 1,
  "mint": "https://tcg.nappelin.com",
  "unit": "600B-E1",
  "room": "…",
  "player": "…",
  "checked_at": 1757500000,
  "assets": [{ "asset_id": "E1-037", "Y": "02…" }],
  "signature": "…"
}
```

`signature` is BIP-340 by the catalog key over `sha256(canonical(payload without
signature))`, so anyone holding the catalog issuer key from `/v1/info` can verify
the certificate offline. `Y` is the proof's hash-to-curve point, which lets a
verifier re-check liveness later via `/v1/checkstate` without seeing the secret.

### 3.4 What it is not

- Not a transfer, not a lock: the holder can trade the card the next second. A
  table that needs cards to stay put for a match must re-check `/v1/checkstate`
  at the end or hold the certificate only for the duration it trusts.
- Not private: the mint learns which cards a player holds for which room.

## 4. Tests to add

- Purchase mode: quote hides cards; purchase persists and advances state once;
  replay returns the stored purchase; a second purchase for the same pack fails
  with `stale booster quote`; claim with `purchase_id` signs exactly the
  purchased cards; claim without outputs after a lost response recovers via the
  wallet's pending record; paid mint refuses purchase before settlement; sealed
  sale answers `sealed` before the block and purchases after it; the sweep
  behaviour of the chosen reservation option.
- Legacy mode (`NUTFT_QUOTE_REVEALS=1`): all existing tests pinned in
  `tests/js/nutft.test.mjs` stay green unchanged.
- Possession: valid certificate verifies with the catalog key; a spent proof, a
  wrong signature, a foreign keyset, a duplicate secret and an oversized batch
  are refused; the certificate does not change `/v1/checkstate`.

## 5. Decisions

Taken on 10 September 2026:

1. Reservation lifetime: option A in 2.4.
2. Purchase mode ships behind `NUTFT_PURCHASE_MODE`; today's quote-and-claim
   stays the default until the live test.
3. The certificate lives at `/nutft/possession`; an alias on the PoC's
   `/nutft/reveal` is not planned unless the PoC game runtime needs it.
