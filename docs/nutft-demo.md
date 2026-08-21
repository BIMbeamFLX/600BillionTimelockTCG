# NutFT demo

This implementation follows the [NUT-31 draft](https://github.com/brenorb/NutFT/blob/main/31.md)
and its [trading-card demo profile](https://github.com/brenorb/NutFT/blob/main/docs/demo-spec.md).
It is a test mint and does not process Lightning payments or real money.

## Implemented flow

1. `/nutft/quote` resolves the next seven-card booster from
   `cards/nutft-census.json`, generated from the supplied Blossom manifest.
2. The browser wallet uses `cashu-ts` to create one P2BK output per card with
   `amount=1`, `unit=600B-E1`, and the card's exact NutFT binding.
3. The wallet discloses each output secret, blinding factor, and P2BK ephemeral
   key. The mint recomputes `B_`, validates the canonical secret, catalog
   membership, amount, unit, and binding, then returns signatures with DLEQ.
4. The wallet unblinds and verifies each proof, DLEQ, P2BK ownership, unspent
   state, signed catalog, and downloaded Blossom face bytes before display.
5. `/nutft/trade` atomically consumes one owner-authorized proof and signs one
   P2BK replacement carrying the identical NutFT binding. Idempotency records
   let a wallet recover a completed booster or trade after a lost response.
6. The mint stores every blinded message and signature and serves NUT-09
   `/v1/restore`; the capability is advertised through `/v1/info`.
7. New wallets use a 12-word BIP39 phrase, the NUT-13 per-keyset KDF for each
   NutFT secret nonce and blinding factor, and the NUT-13 P2PK derivation path.
   Received cards are immediately reissued to deterministic wallet outputs.

The mint advertises NUT-31 through `/v1/info` and exposes `/v1/keys` and
`/v1/checkstate`, plus NUT-09 through `/v1/restore`. Generic swap and melt routes are deliberately absent because
they could consume a NutFT proof without preserving its card binding.

The store issues boosters, the wallet imports and transfers bearer tokens, the
deck builder limits NutFT stacks to verified unspent proofs, and gameplay
rechecks a NutFT-marked stack before starting. Game rules remain outside the
token and catalog metadata is never executed as code.

## Run locally

```bash
npm install
npm run table
```

Open `/shop.html?shop=mint`, `/wallet.html`, `/deck.html`, and `/play.html`.
Mint keys, catalog issuer keys, booster progress, spent proofs, and idempotent
responses persist in the SQLite database configured by `DB`.

For a hosted same-origin deployment, set an immutable public catalog URL before
the first issuance:

```bash
DB=/var/lib/600b/table.db \
NUTFT_CATALOG_URI=https://tcg.example/nutft/catalog \
PUBLIC_URL=wss://tcg.example/ws \
npm run table
```

The default `http://localhost:8777/nutft/catalog` is only for local use. Changing
the catalog URI changes every card binding, so a deployment must not change it
after issuance. Wallet backups and recovery phrases can reconstruct bearer
assets and must be stored as secrets. Wallets created before NUT-13 support
remain file-backup-only because their historical random outputs cannot be
derived retroactively.

## Demo boundaries

- Output openings intentionally let the mint link an issued output to its
  resulting proof; P2BK still hides the recipient's long-lived public key.
- Booster randomness is deterministic demo logic, not publicly verifiable
  randomness.
- There is no payment settlement, marketplace, escrow, or production security
  claim.
- Real assets require operational key custody, immutable catalog hosting,
  backups, monitoring, and an independent security review.
