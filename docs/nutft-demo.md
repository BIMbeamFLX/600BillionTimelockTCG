# NutFT demo

This demo implements the profile in the NutFT draft and its consolidated
`docs/demo-spec.md`.
It is deliberately a demo mint, not a production Lightning mint.

## Flow

1. `/nutft/quote` resolves the next booster from `cards/nutft-census.json`
   using the package's reference draw algorithm.
2. The browser wallet creates one `cashu-ts` `OutputData` per card, with
   `amount=1`, `unit=600B-E1`, a NUT-31 `nutft` tag, and a P2BK destination.
3. `/nutft/booster` validates the cleartext CardBinding declaration, checks the
   quote state, atomically consumes the booster state, and returns Cashu blind
   signatures with DLEQ proofs.
4. The wallet unblinds and verifies every proof, the CardBinding, P2BK field,
   DLEQ, catalog signature, proof state, and Blossom face hash.
5. `/nutft/trade` is the NutFT-aware one-card replacement path. It validates the
   owner witness and input binding before spending the input, requires the
   output declaration to preserve the same binding, and is idempotent.

The mint exposes `GET /v1/keys`, `GET /v1/info`, and `POST /v1/checkstate` for
the Cashu-facing checks. It intentionally does not expose generic `/v1/swap`
or melt endpoints: a metadata-dropping operation must not be available through
the demo.

Run it with:

```bash
npm install
npm run table
```

Then open `/shop.html?shop=mint` and `/wallet.html`.

The demo keeps mint state in memory, uses a fixed configured beacon by default,
and does not process real money. Add durable state, real payment settlement,
catalog issuer key management, and an independent security review before use
with real assets or sats.
