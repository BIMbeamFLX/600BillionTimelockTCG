# Mint deploy runbook — Path A (free demo on tcg.nappelin.com)

`written: 2026-08-20` `verified against: origin/main @ 7372206 (PR #4 merged)` `tests: 316 green`

Companion to [`mint-security-and-deploy.md`](mint-security-and-deploy.md), which has the
full audit and the Path B checklist for a paid mint. This file is only the steps for
tomorrow.

**Everything below was verified by running the merged code, not read.** I bought a pack,
opened the wallet, restarted the server, and re-verified — results in §4.

---

## 0. What changed since the audit

The audit was written against my branch. Breno then pushed two more commits and the PR
merged, and he reimplemented all three of my fixes his own way — **verified working, and
in two places better than mine**:

| Concern | How it landed on main |
|---|---|
| Forgeable signing keys | `crypto.randomBytes(32)` generated once and persisted in the DB (`getOrCreate`). Random per deployment, no env vars to manage. |
| Mint forgot sales on restart | Durable in SQLite; `sold` and keys both survive. Verified across a real restart. |
| Wallet page dead | Fixed; plus he added transfer, import, and wallet backup. |
| **Odds panel contradicted the mint** | **Fixed** — `/nutft/state` now serves real `tier_odds` and the shop shows all five tiers: Genesis 0.15 / Vault 1.05 / Rare 15.48 / Uncommon 16.66 / Common 66.65. Those are the r2 census's shares; the fifteen-card box moved them — see §6. |

One tradeoff to know: because the mint key now lives **in the database**, `matches.db`
backups contain forging material. Treat DB backups as secrets — same care as a wallet file.

---

## 1. The one setting that decides whether the demo works

**`NUTFT_CATALOG_URI` is not optional.** It defaults to `http://localhost:8777/nutft/catalog`,
and it is hashed into every card's CardBinding. The wallet then fetches that literal URL to
verify.

Deploy without setting it and **every buyer's wallet tries to fetch `localhost:8777` from
their own machine, fails, and shows every card as invalid.**

This is not theoretical — I reproduced it exactly:

- Wrong URI → wallet showed `0 UNSPENT / 7 INVALID`, "7 proof(s) were isolated because
  validation failed", seven `ERR_CONNECTION_REFUSED` to `localhost:8777`.
- Correct URI → `7 UNSPENT`, every card `DLEQ ✓ · P2BK ✓ · Blossom ✓`.

Same code, same cards. One environment variable.

It is also **permanent**: the mint refuses to restart if a sold-into database was created
under a different `catalog_uri`, precisely so the binding can never silently split. Set it
right the first time.

---

## 2. Steps

### 2.1 Local, before touching the box

```bash
git checkout main && git pull
```

```bash
npm run build && npm run test:js
```

Expect **365 passing**. Red means stop.

Smoke it locally — this is also your demo rehearsal:

```bash
node server/table.js
```

Open `http://localhost:8777/shop.html?shop=mint`, buy a pack, then
`http://localhost:8777/wallet.html`. You should see fifteen tiles, each
`DLEQ ✓ · P2BK ✓ · Blossom ✓`. (Locally the default 8777 URI is correct, which is why this
works without extra config — on the box it will not be.) Ctrl-C.

### 2.2 Set the catalog URI on the box

Edit `/etc/systemd/system/tcg-table.service` and add one line beside the existing
`Environment=` entries:

```
Environment=NUTFT_CATALOG_URI=https://tcg.nappelin.com/nutft/catalog
```

Do this **before** the first pack is ever sold from the box.

### 2.3 Ship

```bash
powershell -File G:\projekte\HetzerDeploy\deploy-tcg.ps1 -SshTarget deploy@178.105.93.78
```

The deploy script was fixed today: it previously copied only `server\table.js`, which would
have crashed the box with `MODULE_NOT_FOUND` on start — and since the referee and the site
are one process, that takes the live game down too. It now ships `server\*.js` and the
preflight fails loudly if `nutft-mint.js` or `nutft-draw.js` is missing.

### 2.4 Restart and verify (your YubiKey)

```bash
sudo systemctl daemon-reload && sudo systemctl restart tcg-table
```

Then, from anywhere:

```bash
curl.exe https://tcg.nappelin.com/api/health
```

```bash
curl.exe https://tcg.nappelin.com/nutft/catalog
```

Check `catalog_uri` in that response reads `https://tcg.nappelin.com/nutft/catalog` — **not**
localhost. If it says localhost, stop and fix §2.2 before anyone buys.

### 2.5 The real test — do this yourself in a browser

1. `https://tcg.nappelin.com/shop.html?shop=mint` → buy a pack.
2. `https://tcg.nappelin.com/wallet.html` → fifteen tiles, each `DLEQ ✓ · P2BK ✓ · Blossom ✓`.
3. Restart the service once more, reload the wallet: still fifteen, still valid, and
   `/nutft/state` still shows your `sold` count.

If step 2 shows "INVALID", it is §2.2. Nothing else produces that symptom.

### 2.6 Rollback

There is no `systemctl rollback`. To revert: `git checkout` the previous commit, rerun
§2.3 and §2.4. The matches DB lives outside the webroot, so a redeploy never touches games
in flight — and the mint DB now persists sales, so a rollback does **not** reset the box.

---

## 3. What this demo is, and is not

Say this plainly wherever the demo is shown:

- **Packs are free.** The 21-sat price is the intended model; Lightning settlement is not
  built yet, so nothing takes payment.
- **The beacon is static**, so pack order is precomputable by anyone with the census. The
  "resolve against an unmined Bitcoin block" design is the fix and is not built. Do not
  present this as a fair random draw yet.
- The cards are **real Cashu bearer proofs** with DLEQ, P2BK and CardBinding, verified
  client-side against a signed catalog and the Blossom face hash. That part is genuine.

Free + labelled keeps it clear of the loot-box and MiCA questions in the audit. Those start
the moment money does.

---

## 4. Verification log (merged main, 2026-08-20)

| Check | Result |
|---|---|
| `npm run test:js` on merged main | 316 / 316 |
| `/api/health`, `/v1/info`, `/v1/keys`, `/nutft/catalog`, `/nutft/state` | all 200 |
| Shop odds vs mint | match — all five tiers |
| Buy a pack | `sold: 0 → 1`, `pack-0001 → pack-0002` |
| Wallet, wrong `catalog_uri` | `0 UNSPENT / 7 INVALID` ← the trap |
| Wallet, correct `catalog_uri` | `7 UNSPENT`, 7× `DLEQ ✓ · P2BK ✓ · Blossom ✓` |
| After a real restart | `sold: 1` retained, wallet still 7 valid |

---

## 5. Next, in order

1. **Onboarding grant** — FIPS-P01 + a promo Lotus + a Starter Stack on registration.
   Promos are uncapped and outside the census, so this costs the mint nothing.
   *Blocked on:* `build_play_data.py` excludes promos, so promo cards are not in the
   playable catalog yet; and the promo Lotus does not exist as art. FIPS art does exist.
   **Do not grant the real Genesis Lotus** — it is 21 copies lifetime, so that caps you at
   21 users, ever.
2. **Lightning settlement** for the 21-sat pack (from `lnurl-mint`).
3. **Block-commitment beacon** — the fairness core.
4. Mint-endpoint rate limiting (`/v1/*` and `/nutft/*` dispatch before the table's limiter).
5. Legal review before any money changes hands.

---

## 6. Re-minting Edition One — the fifteen-card box

`written: 2026-08-20` `census: tier-census-r3` `tests: 365 green`

Two changes landed together. A booster is **fifteen cards** now — 10 Common + 3 Uncommon +
1 Prime + 1 free Basic — and the mint is **three times the size**, 62,775 packs against
20,925, with every print run tripled to match.

The second is the one to say out loud, because it spends a promise: **there are 63 of each
Genesis card now, not 21.** Anyone repeating the old number is repeating something that
stopped being true. Everything else about the curve is untouched — a named Genesis is still
one pack in 998, the tier shares do not move at all, and the copy spread is the same 111:1 —
because tripling every tier at once changes the scale and none of the ratios.

| | r2 (until now) | r3 (this deploy) |
|---|---|---|
| cards per pack | 7 | **15** |
| numbered cards per pack | 6 | **14** |
| packs | 20,925 | **62,775** |
| Genesis / Vault / Rare copies each | 21 / 63 / 216 | **63 / 189 / 648** |
| Common / Uncommon copies each | 930 / 279 | **6,975 / 2,511** |
| capped copies | 125,577 | **878,931** |
| cards in the box | 146,475 | **941,625** |
| unreachable prime tail | 27 | **81** |
| `census_sha256` | `651e12f3…` | **`7a1212fb…`** |
| `tier_odds` | 0.15 / 1.05 / 15.48 / 16.66 / 66.65 | **0.06 / 0.45 / 6.64 / 21.43 / 71.42** |
| a named Genesis, per pack | 1 in 998 | **1 in 998** |

**A new census is a new mint, and the code enforces that.** `createNutftMint` hashes
`census_sha256` + `collection_id` + `catalog_uri` into `nutft_meta.configuration` and
refuses to open a database written under a different one:

```
[table] failed to start: Error: mint database belongs to a different NutFT census,
collection, or catalog URI
```

That is the guard working, not a bug — it is the same guard §1 relies on for the catalog
URI. But deploying the new census on top of the old mint state takes the **whole service**
down, referee and site included: they are one process.

### 6.1 First, is the box really unsold?

```bash
curl.exe https://tcg.nappelin.com/nutft/state
```

`sold` must read `0`. **If it does not, stop here.** Every proof already issued is bound to
the r2 census, and clearing `nutft_spent` underneath it would let those cards be spent a
second time. A sold box is a migration, not a reset, and that path is not written down yet.

### 6.2 Ship code and census together

The census is data, not code — but `deploy-tcg.ps1` copies the whole `cards/` tree, so
`cards/nutft-census.json` travels with the deploy and there is nothing extra to do. Worth
knowing anyway: if you ever ship by hand, **that file is the deploy**. Shipping the code
without it leaves the box selling r2.

```bash
powershell -File G:\projekte\HetzerDeploy\deploy-tcg.ps1 -SshTarget deploy@178.105.93.78
```

### 6.3 Clear the old mint state, keep the mint's identity (your YubiKey)

The DB lives outside the webroot at `/home/deploy/tcg-data/matches.db` and holds the game's
matches as well, so empty the four `nutft_*` tables — never the file.

```bash
sudo systemctl stop tcg-table
```

```bash
cp /home/deploy/tcg-data/matches.db /home/deploy/tcg-data/matches.db.r2-backup
```

```bash
sqlite3 /home/deploy/tcg-data/matches.db "DELETE FROM nutft_meta WHERE key IN ('configuration','state'); DELETE FROM nutft_invoices; DELETE FROM nutft_operations; DELETE FROM nutft_spent;"
```

No `sqlite3` on the box? The node that runs the server has one built in:

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/home/deploy/tcg-data/matches.db');d.exec(\"DELETE FROM nutft_meta WHERE key IN ('configuration','state');DELETE FROM nutft_invoices;DELETE FROM nutft_operations;DELETE FROM nutft_spent;\");console.log('nutft state cleared')"
```

`mint_seed` and `catalog_private_key` stay behind on purpose: they are the mint's identity,
and keeping them means `catalog_issuer` does not change under anyone who already trusts it.
On the next boot the mint writes a fresh `configuration` and a fresh `state` from r3.

### 6.4 Start it, then check which box it is actually selling

```bash
sudo systemctl start tcg-table
```

```bash
curl.exe https://tcg.nappelin.com/nutft/state
```

Four things have to read right: `census_sha256` is `7a1212fb…`, `packs` is `62775`, `sold`
is `0`, and `tier_odds` is `0.06 / 0.45 / 6.64 / 21.43 / 71.42`. Then buy one pack at
`/shop.html?shop=mint` — **fifteen tiles**, each `DLEQ ✓ · P2BK ✓ · Blossom ✓` — and press
the shop's verify button, which re-hashes the mint's own signed catalog: it must answer
MATCH against `7a1212fb…`, not DIFFERENT CENSUS.

Faces did not change in this resize, so there is no blob re-upload and no Blossom recheck.

### 6.5 If it will not start

The configuration guard is the only new way this deploy fails; `journalctl -u tcg-table -n
50` says so in as many words. The fix is §6.3, not a rollback — rolling the code back
without also restoring the DB backup leaves an r3 database under an r2 census and fails the
same way from the other side.
