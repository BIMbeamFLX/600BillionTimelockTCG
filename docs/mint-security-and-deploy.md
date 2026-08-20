# NutFT mint — security audit, business viability, and deployment plan

`written: 2026-08-20` `scope: server/nutft-mint.js, server/nutft-draw.js, site/nutft-wallet.js, the deploy path` `audience: FLX`

This is the deep check you asked for before deploying the mint on Hetzner: what is
safe, what is not, whether it can run as a business, whether it scales, and the exact
steps for tomorrow. It is written against the code on branch `feat/cashu-booster-demo`
at commit `0e2d87f`, not from memory.

I am not a lawyer. The regulatory section is research to brief a professional with, not
legal advice.

---

## 0. Bottom line up front

**You can deploy tomorrow — as a clearly-labelled free demo on the real infra. You
cannot run it as a real paid mint tomorrow.** Three of the five blockers I found were
pure code and are now fixed and tested; the remaining two are genuine engineering plus a
legal review, not config, and they are exactly the two that a mint handling other
people's money cannot skip.

Fixed today (all on the PR branch, all with tests):

- The wallet page worked for nobody — fixed (`a1d013a`).
- The mint forgot every sale on restart — now durable in SQLite (`07608a3`).
- The signing keys were publicly derivable — now loaded from secrets, with a boot guard
  that refuses demo keys in production (`0e2d87f`).
- The deploy script shipped only `table.js` and would have crashed the box on start —
  now ships every server module (`deploy-tcg.ps1`).

Still blocking a **real paid** mint (neither is a config line):

1. **The beacon is static, so every pack is precomputable.** The "resolve against a
   Bitcoin block not yet mined at sale time" design from your own handover is not built.
   Until it is, pack contents are either predictable (public beacon) or operator-riggable
   (secret beacon). This is the core fairness mechanism of the whole product.
2. **There is no payment.** `/nutft/booster` mints for free. The Lightning settlement
   that makes it a "sealed pack you buy" does not exist in this repo (it lives in
   `lnurl-mint`, unintegrated).

And before any sale to the public, one non-code gate:

3. **Regulatory sign-off.** Selling randomised, tradeable, bearer crypto packs from
   Austria touches both loot-box law and MiCA. This needs Austrian crypto counsel first.

The rest of this document is the evidence and the steps.

---

## 1. Security audit

Ranked by what it costs you if ignored. Each finding says whether it is fixed, and how it
was verified.

### CRITICAL — mint signing key was publicly derivable · FIXED (`0e2d87f`)

The demo built both the Cashu mint key and the catalog issuer key as
`SHA-256("600B NutFT demo mint key")` and `SHA-256("600B NutFT catalog issuer")` — two
English strings committed to a public repo.

**Verified:** I recomputed the private key from those strings offline and got keyset id
`01567a7f…78acc5` — byte-identical to what the live mint served at `/v1/keys`. With that
private key anyone can forge signatures that pass DLEQ, mint past the supply cap, and sign
a catalog the wallet accepts. For a free demo it means nothing. For a mint that sells
bearer assets it is a total break.

**Fix:** keys now come from `NUTFT_MINT_SEED` and `NUTFT_CATALOG_KEY` (32-byte hex,
outside the repo). With neither set the mint still boots on the demo keys so the offline
demo and tests are unchanged — but `/v1/info` then reports `demo_keys: true`, and
`NUTFT_REQUIRE_PRODUCTION_KEYS=1` makes the mint refuse to start on demo keys at all. The
production unit sets that flag, so a missing secret fails the boot loudly instead of
silently shipping forgeable keys.

**One-way door:** generating the real seeds is irreversible for a live mint — rotating
them invalidates every proof already issued. Decide them once, before the first sale.

### HIGH — static beacon makes every pack precomputable · NOT FIXED (design work)

Pack contents come only from `(beacon, packId, counts)`, all deterministic. The beacon is
a fixed config value (`NUTFT_BEACON`, default all-zeros).

**Verified:** with the public census, the public draw algorithm and a known beacon, I
precomputed the box offline — 175 packs in 28 ms, first Genesis at `pack-0175`, whole
20,925-pack box computable in seconds. A buyer (or the operator) who knows the beacon
knows exactly which pack number holds each Genesis card before buying.

This is the mechanism your handover already specifies the fix for: the beacon must be a
**Bitcoin block hash that does not exist at sale time**. Sealed pack now, block later,
reveal after. Until that is built you have a dilemma with no acceptable side: a public
beacon lets buyers cherry-pick, a secret beacon lets you rig outcomes. Neither is a
trust-minimised mint.

### HIGH — no payment settlement · NOT FIXED (integration work)

`/nutft/booster` issues a full pack of signed proofs for free. There is no invoice, no
msat check, no LN settlement anywhere in `server/`. The business ("sell sealed packs for
sats") does not exist yet in this codebase. Your notes point at `lnurl-mint` (71/71 tests,
separate repo) as where payment lives; wiring one paid invoice to one `booster` call is
the missing beat.

### MEDIUM — mint endpoints have no rate limit · NOT FIXED (small)

`/v1/*` and `/nutft/*` are dispatched at the top of `serveHttp` **before** the table's
rate limiter, and `RATE_MAX` only covers the WebSocket/table path. So `/nutft/quote` and
`/nutft/booster` are unmetered. Free mint + no limit = trivial spam and unbounded DB
growth; once paid, LN gates `booster` but `quote` enumeration is still free. Add a simple
per-IP token bucket on the mint routes (behind the Caddy loopback proxy, `TRUST_PROXY` is
already wired for real client IPs).

### MEDIUM — catalog_uri defaults to localhost and is permanent · MITIGATED

`catalog_uri` is hashed into every card's `asset_binding` and defaults to
`http://localhost:8777/nutft/catalog`. Ship that once and every card is permanently bound
to localhost. **Mitigated:** the mint now refuses to restart if a sold-into database was
created under a different `catalog_uri`, so you cannot silently split the binding — but
you still must set the right value before the first sale. You chose a nostr `naddr`
(correct: it is content-independent and survives a domain move; a Blossom `sha256` URI is
impossible here because the hash would depend on the URI that is the hash). The `naddr`
must be published before it goes in the unit.

### LOW / INFO

- **Catalog re-signed on every GET** (~2 ms schnorr + serialize of 285 assets per
  `/nutft/catalog`). Fine at demo traffic; cache it once real load arrives.
- **`spent`/`trades` load fully into memory on boot.** At 292,977 max cards this is a
  small map; not a concern at this set size, worth remembering if the set grows.
- **Confirmed already sound:** DLEQ + P2BK + CardBinding verification on both issue and
  reload paths; the trade path checks owner witness, input binding and double-spend, and
  is idempotent; no `/v1/swap` or melt endpoint (metadata-dropping ops are intentionally
  absent); 512 KB POST body cap; NUL-in-path guard upstream.

---

## 2. Can it run as a business? Regulatory research

Austria, EU. Two regimes apply at once; this is the part that needs a professional, not
because it is vague but because it is specific and both regimes are moving in 2026.

### 2a. Loot-box / randomised-content law

Selling a pack whose contents are random, for money, is the textbook loot-box pattern,
and the EU is tightening:

- The European Parliament's Nov 2025 resolution urges banning loot boxes in games
  accessible to minors; a **Digital Fairness Act is projected for Q4 2026** that may ban
  them for minors or mandate parental consent EU-wide.
- Under the DSA, platforms accessible to minors are already prohibited from design that
  drives compulsive spending — read by Parliament to cover paid random loot boxes.
- **PEGI from 2026** gives paid random mechanisms a higher age rating.
- No harmonised standard yet — it is per-member-state, so an Austrian sale is judged under
  Austrian gambling/consumer law.

Practical implication: **age-gating and clear odds disclosure are not optional polish.**
Your shop already commits to published odds with a hash, which is ahead of most — keep
that, and add a hard age gate before any paid random pull.

### 2b. MiCA — the cards are bearer crypto-assets

This is the sharper one. The pack contents are Cashu proofs: bearer tokens, tradeable,
with a secondary-market value you are deliberately engineering (tiers, scarcity, a trade
endpoint).

- MiCA is fully applicable; the **EU-wide transitional period ends 1 July 2026**, after
  which providing crypto-asset services without authorisation cannot rely on transition.
- In Austria the **FMA** is the competent authority (MiCA-VVG), plus **FM-GwG** for AML.
- Issuing a tradeable token and/or operating the venue people trade it on can bring you
  inside "crypto-asset service provider" / issuer territory, which is an authorisation,
  not a form.

Whether a game trading card that happens to be a Cashu proof is a "crypto-asset" under
MiCA, or an exempt unique/non-fungible collectible, is exactly the line a professional
must draw — and it depends on how fungible and how tradeable you make them. Ask counsel
that specific question.

### 2c. AML / KYC

Accepting Bitcoin/Lightning as a business, and running a trade venue, pulls in FM-GwG AML
duties (identification, monitoring) above thresholds. Budget for it; do not discover it.

### 2d. Recommendation

- **Tomorrow's deploy:** free demo, explicitly labelled, no sale. No money changes hands,
  so none of the above triggers. Safe.
- **Before any paid sale:** one meeting with an Austrian crypto/gaming lawyer with three
  questions — (1) are these cards crypto-assets under MiCA or exempt collectibles, (2) does
  selling + the trade endpoint make you a CASP/issuer, (3) loot-box and age-gating duties
  for a paid random pull. That meeting is cheaper than being wrong.

Sources: [Lootbox Regulation 2026](https://blog.promise.legal/lootbox-regulation-2026-game-studios/) ·
[EU/UK/US loot-box strategies](https://esportslegal.news/2025/12/11/us-uk-and-eu-loot-box-strategies/) ·
[Austria and MiCA 2026 (CERHA HEMPEL)](https://www.cerhahempel.com/blog/fintech-ledger/austria-and-mica-clarity-complexity-and-compliance-in-2026) ·
[Chambers — Blockchain & Crypto-Assets 2026, Austria](https://practiceguides.chambers.com/practice-guides/blockchain-crypto-assets-2026/austria/trends-and-developments) ·
[MiCA overview (ESMA)](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)

---

## 3. Does it scale?

For the scale this is likely to see (a card game's booster shop), **yes, with known
ceilings** — none of which bite tomorrow.

- **One process, one SQLite file (`node:sqlite`).** The referee and the mint share it.
  SQLite in WAL is a single writer; each trade takes `BEGIN IMMEDIATE`. Good for
  hundreds of writes/sec, i.e. thousands of packs/minute — far past any realistic
  booster launch. The read-heavy endpoints (`quote`, `state`, `catalog`) do not contend.
- **Vertical first.** The whole design is one node process; there is no horizontal story
  (in-memory matchmaking, one DB handle). That is the right choice at this size. If a
  launch ever needs more, the mint splits from the referee cleanly — it already only
  needs the DB and the census — but do not build that now.
- **Cache the catalog** (§1 LOW) and add the mint rate-limit (§1 MEDIUM) before any
  traffic spike; both are small.
- **The real scaling constraint is not throughput, it is supply**: one mint is 20,925
  packs, fixed. "Scale" here means minting a second set, which is a census + key +
  catalog decision, not an infra one.

Verdict: the architecture is appropriately sized. Do not add Postgres, queues, or
horizontal anything for this.

---

## 4. Deployment plan for tomorrow

Two paths. **Path A (demo) is ready and is what I recommend for tomorrow.** Path B (real
mint) is the gated checklist — do not attempt it tomorrow.

The house rules hold throughout: **you run every box command yourself (YubiKey SSH); I
never SSH the box.** Deploy uses the local working tree via HetzerDeploy rsync, not
GitHub.

### Path A — deploy the mint as a labelled demo (ready today)

**A1. Land the mint into your working tree.** The mint lives on
`feat/cashu-booster-demo`. Merge it to `main` (ask Breno to mark the PR ready first, as
agreed), then bring `main` into the branch you deploy from. Verify the three fix commits
are present:

```bash
git log --oneline | grep -E "wallet page|remembers what it sold|signing keys"
```

**A2. Green build, or no deploy.**

```bash
npm run build && npm run test:js
```

Expect 315 passing. If anything is red, stop.

**A3. Smoke the mint locally one last time.**

```bash
node server/table.js
```

Then open `http://localhost:8777/shop.html?shop=mint`, buy a pack, open
`http://localhost:8777/wallet.html`, confirm seven tiles each show `DLEQ ✓ · P2BK ✓ ·
Blossom ✓`. Ctrl-C.

**A4. Decide the demo's honesty settings.** For a demo you may keep demo keys and the
static beacon **as long as the page says so** (it already labels NutFT mode as a demo).
Do **not** set `NUTFT_REQUIRE_PRODUCTION_KEYS` for Path A. Set `NUTFT_CATALOG_URI` to the
real host now anyway, so nothing is ever bound to localhost:

Add to `/etc/systemd/system/tcg-table.service` under the existing `Environment=` lines
(you edit this on the box as root):

```
Environment=NUTFT_CATALOG_URI=https://tcg.nappelin.com/nutft/catalog
```

(One line. This is a demo; the permanent `naddr` decision belongs to Path B. Because the
mint refuses to restart under a changed `catalog_uri`, whatever you pick here is what the
demo's cards bind to — so if you expect to reset the demo box, that is fine; if you want
demo cards to survive into the real mint, skip to Path B and set the `naddr` now.)

**A5. Ship it.**

```bash
powershell -File G:\projekte\HetzerDeploy\deploy-tcg.ps1 -SshTarget deploy@178.105.93.78
```

The fixed deploy script now ships `server/*.js` (all three modules) and fails the
preflight if `nutft-mint.js` or `nutft-draw.js` is missing.

**A6. Restart and verify (on the box, your YubiKey).**

```bash
sudo systemctl daemon-reload && sudo systemctl restart tcg-table
```

Then from anywhere:

```bash
curl.exe https://tcg.nappelin.com/api/health
curl.exe https://tcg.nappelin.com/v1/info
curl.exe https://tcg.nappelin.com/nutft/state
```

`/api/health` → `{"ok":true,…}`. `/v1/info` → `"demo_keys":true` (expected for the demo).
`/nutft/state` → `sold` and `next_pack` that **persist across a restart** now — run the
restart twice and confirm `sold` does not reset. Then open the shop and wallet in a
browser against `tcg.nappelin.com` and buy one pack.

**A7. Done.** If anything looks wrong, `sudo systemctl rollback` is not a thing — you
redeploy the previous working tree, or `git checkout` the prior commit and rerun A5–A6.
The live matches DB is outside the webroot, so a redeploy never touches games in flight.

### Path B — what turns the demo into a real mint (do NOT do tomorrow)

In rough order:

1. **Build the block-commitment beacon** (§1 HIGH #1). Sealed pack at sale, commit to a
   future BTC block height, resolve and reveal after that block is mined. This is the
   product's fairness core; everything else is scaffolding around it.
2. **Integrate Lightning settlement** (§1 HIGH #2) — one paid invoice per `booster`,
   from `lnurl-mint`.
3. **Generate and install the real signing secrets** (run these yourself; keep them off
   the repo and out of any shared doc):
   ```bash
   openssl rand -hex 32   # NUTFT_MINT_SEED
   openssl rand -hex 32   # NUTFT_CATALOG_KEY
   ```
   Put them in the systemd unit (root-only `0644` is readable by all local users — use a
   `systemd` drop-in with `0600`, or `EnvironmentFile=` pointing at a `0600` file owned by
   `deploy`), then set `Environment=NUTFT_REQUIRE_PRODUCTION_KEYS=1`. The mint now refuses
   to boot without real keys.
4. **Publish the catalog `naddr`** and set `NUTFT_CATALOG_URI` to it — before the first
   sale, permanently.
5. **Set a real beacon** per the scheme from step 1 (not the static value).
6. **Add the mint rate-limit** (§1 MEDIUM) and **cache the catalog** (§1 LOW).
7. **Legal sign-off** (§2) — the meeting, before money.
8. **Age gate + keep the odds disclosure** on the paid pull.

Each of 1, 2 and 7 is real work. Tomorrow's win is Path A: the mint, live, honest, and
now un-forgeable — everyone can play with the real flow while B gets built.

---

## Appendix — what changed in this audit

| Commit | Change |
|---|---|
| `a1d013a` | wallet `snapshot()` `keyset` scope bug — page now renders; regression test added |
| `07608a3` | durable mint state in SQLite — survives restart; two restart tests |
| `0e2d87f` | signing keys from `NUTFT_MINT_SEED`/`NUTFT_CATALOG_KEY` + production guard; key test |
| `deploy-tcg.ps1` | ships `server/*.js`, not just `table.js`; preflight covers mint modules |

Test count 312 → 315. All green, verified stable across repeated runs.
