# Recover a Plebeian Market Cashu wallet into cashu.me

Plebeian Market's local Cashu wallet stores a random **64-byte seed** under a browser
localStorage key named `cashu_wallet_seed_<your-nostr-pubkey>`. cashu.me starts with a
12-word BIP39 phrase and derives a 64-byte seed from it. That derivation cannot be reversed,
so a Plebeian raw seed cannot be converted into 12 recovery words.

The supported migration is:

1. Use the Plebeian raw seed to restore deterministic proofs from the original mint.
2. Package only proofs that the mint reports as unspent into standard Cashu tokens.
3. Import those bearer tokens into cashu.me.
4. Back up cashu.me's own 12-word phrase.

## Before using the script

- If Plebeian still opens and shows the balance, use its normal **Send ecash** flow and
  receive the token in cashu.me. That is the shortest migration.
- A 64-character hex key or an `nsec1...` value is a Nostr key, not this Cashu seed. Sign
  into Plebeian with the same Nostr identity instead. Never turn that key into fake words.
- If you already have 12 valid BIP39 words, cashu.me's built-in restore is the normal path.
- You need every original mint URL. The seed does not reveal which mints were used.

On the same Plebeian origin and browser profile, open browser developer tools, select
**Application** (or **Storage**) → **Local Storage**, and filter for
`cashu_wallet_seed_`. The value must be exactly 128 hexadecimal characters. Do not paste
that value into a website, chat, issue, or command line.

## Run

Install the locked dependencies once:

```powershell
npm install
```

Choose a private output path that does not already exist, then run:

```powershell
npm run recover:plebeian -- `
  --mint https://the-original-mint.example `
  --output C:\private\cashu-recovery-2026-08-21.json
```

Repeat `--mint` for multiple mints. The prompt hides the seed while it is pasted. A saved
localStorage JSON export can be read instead:

```powershell
npm run recover:plebeian -- `
  --mint https://the-original-mint.example `
  --output C:\private\cashu-recovery-2026-08-21.json `
  --seed-file C:\private\plebeian-localstorage.json
```

The tool follows NUT-13's recommended recovery scan: batches of 100 counters until three
consecutive batches are empty. It uses NUT-09 to request old signatures and NUT-07 to exclude
spent proofs. These restore queries do not spend the proofs, and the seed is never sent to
the mint.

## Import into cashu.me

The output JSON contains one or more `token` values under `recoveries[].tokens[]`. Each is
bearer ecash: anyone who gets a copy can spend it.

1. Open the output file locally.
2. In cashu.me, use **Receive** and paste each complete `cashuB...` token.
3. Confirm every imported amount appears and is spendable.
4. Back up cashu.me's own 12-word phrase.
5. After verifying the migration, remove every extra copy of the recovery JSON and the raw
   Plebeian seed from ordinary synced folders or clipboard history.

If the report lists failures, do not assume recovery is complete. The original mint must be
online and support NUT-09 restore and NUT-07 state checks. A zero result can also mean the
wrong seed, the wrong mint URL, already-spent proofs, or a balance stored only through
Plebeian's NIP-60 Nostr wallet rather than its local deterministic wallet.

## Protocol and implementation references

- [Cashu NUT-13 deterministic secrets and recovery](https://cashubtc.github.io/nuts/13/)
- [Cashu NUT-09 signature restore](https://cashubtc.github.io/nuts/09/)
- [Plebeian Market Cashu seed storage](https://github.com/PlebeianApp/market/blob/master/src/lib/stores/cashu.ts)
- [cashu.me restore implementation](https://github.com/cashubtc/cashu.me/blob/main/src/stores/restore.ts)
