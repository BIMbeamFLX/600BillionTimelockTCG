# Mint boot checks

The referee refuses to start on mint settings that used to boot and then did the wrong
thing, some of them for good: `NUTFT_CATALOG_URI`, `G_NUTFT_CATALOG_URI` and both collection
ids are hashed into every issued card. This release **changes defaults** the running box may
rely on (§2), **adds refusals** (§3) and **reads some spellings differently** (§3.1). The check
in §1 runs against the running service before anything stops.

The rules live in `server/mint-env.js`. The boot, both mints, the funding backends and the dry
run below all apply that one module, so the dry run cannot pass what the boot refuses.

**The operator's page is [docs/deploy.md §9.2a](deploy.md).** It has every command, in order.
This document explains what the check does, what each line means, and how to fix it.

---

## 1 · Before anything stops: the dry run against the running service

The check applies the new release's rules to the environment of the process that runs now.
It prints one line per problem, never a value, and then `ok` or the count. A problem is either
a refusal, `VARIABLE: reason` (§3), or a value the release would start with but read
differently from the running build, `VARIABLE: meaning changes (old → new)` (§3.1). It needs no
`node_modules`, writes nothing, opens no database, binds no port and contacts no funding
backend. Exit code 0 is `ok`, 1 is problems, 2 is input it could not read.

The check needs three files from the release clone: `server/env-check.js`, `server/mint-env.js`
and `server/lnurl.js`. `--from -` reads a NUL-separated environment from stdin, `--from <file>`
reads one from a file, and without a flag it checks its own environment. On the box only the
read of `/proc/<pid>/environ` runs as root, piped into an unprivileged `node`: the copy sits in
a directory the deploy user can write, so running it with `sudo` would run as root whatever was
swapped in between the copy and the run.

**It reads the running process, not the next start.** If the unit, a drop-in or an
`EnvironmentFile` was edited after the last start, the next start differs from the environment
the check read, and the release would refuse at its first start with the shop already stopped.
So before the check, §9.2a compares `systemctl show -p NeedDaemonReload` and the modification
times of the unit file, every drop-in and every `EnvironmentFile` with the process start time
(`ExecMainStartTimestamp`). If anything is newer, the running build is brought in line first:
restarted once, while nobody waits in quick match (`"queued":0`), between two snapshots of what
both mints publish. Any difference between the snapshots stops the deploy for the day. Only a
clean comparison goes on to the check.

**Any line other than a single `ok` stops the deploy**, a refusal and a `meaning changes` row
alike: after a meaning change the release would start, and the shop would behave differently.
Exit code 2 with `the environment input is empty` means the process id was 0 or stale.

Every problem line is fixed in the environment first, as its own change on the **running**
build, never by starting the release to see whether it refuses:

- Read only the keys a line names; never print a whole `EnvironmentFile`, it can hold
  `PHOENIXD_PASSWORD`.
- Write the value the running build actually uses (§3 and §3.1 say which, §9.2a where to read
  it), restart the running build, and compare the snapshots before and after. They must be
  identical. §3 names the few fixes that change behaviour because the old value was already
  broken; those are sales decisions to settle before the deploy, not during it.
- Run the check again, until the only line is `ok`.

A clean run prints `ok`. An environment with six of the problems this release looks for prints:

```text
NUTFT_FUNDING: unset while PHOENIXD_URL or LND_REST_URL is set: E1 no longer takes its funding from them, so set lnd, phoenixd, cashu, mock or none
NUTFT_ALLOWLIST: an nsec (private key) was pasted into NUTFT_ALLOWLIST at entry 2; remove it
G_NUTFT_COLLECTION_ID: required when G_NUTFT_ENABLED is on: it is hashed into every Edition G card for good
G_NUTFT_CENSUS_PATH: required when G_NUTFT_ENABLED is on: the census it names is signed into the Edition G catalog for good
G_NUTFT_CLAIM_GRACE_SECONDS: unset while NUTFT_CLAIM_GRACE_SECONDS is set: Edition G does not inherit it, so set G's own value
NUTFT_ONE_PER_KEY: meaning changes (off → on)
6 problems
```

`node server/table.js --check-env` runs the same check in a full checkout. A refused boot prints
the refusals, each prefixed `[table] refusing to start: `, before it opens a database; the
boot has no running build to compare with, so it never prints a `meaning changes` row.

---

## 2 · Changed defaults

Where the running box relies on an old default or spelling, §1 reports it: as a refusal
(§3), or, for the rows marked *meaning change*, as a `meaning changes` row (§3.1).

| Variable | Before | Now |
|---|---|---|
| `NUTFT_FUNDING` | Unset picked `phoenixd` when `PHOENIXD_URL` was set, else `lnd` when `LND_REST_URL` was set, so a node configured for G or the beacon made E1 a paid mint. | Never guessed. Unset is free only while neither URL is set; otherwise the boot refuses. |
| `NUTFT_SALES` | `open`, also for a paid mint. | No default for a paid mint. A free E1 still defaults to `open`, so `npm run local` is unchanged. |
| `G_NUTFT_SALES` | `closed`, also for a paid G. | No default for a paid G. A free G still defaults to `closed`. |
| `G_NUTFT_CATALOG_URI` | `NUTFT_CATALOG_URI`, then `http://localhost:8777/nutft/catalog`. | No default. |
| `G_NUTFT_COLLECTION_ID` | `600B-G`. | No default. |
| `G_NUTFT_CENSUS_PATH` | `cards/g-census.json` in the code directory. | No default. |
| `G_NUTFT_PRICE_MSAT` | `0` or a non-number took `NUTFT_PRICE_MSAT`, then 21 sat. | Refused. Unset or empty is still 210 sat. |
| `G_NUTFT_INVOICE_TTL_SECONDS`, `G_NUTFT_CLAIM_GRACE_SECONDS` | Unset, empty, `0` or a non-number took the E1 value. | `0` or a non-number is refused. Unset is G's own 900 and 3600, and refused while the E1 variable is set. |
| `G_NUTFT_CATALOG_MIRRORS` | Unset took `NUTFT_CATALOG_MIRRORS`. | *Meaning change:* unset is no mirrors. E1's mirrors hold E1's catalog blob; a wallet reads G's catalog from the mint's own `/g/blossom/` path. |
| `G_NUTFT_ONE_PER_KEY` | An empty `G_NUTFT_ONE_PER_KEY=` switched the limit off. | *Meaning change:* empty is unset, and unset is on. |
| `NUTFT_ONE_PER_KEY` | Only `1` and `true` were on; anything else was off. | *Meaning change* for `yes`, `on` and capitals, which are now on. The flag grammar is below. |
| `G_NUTFT_PRICE_MSAT`, `NUTFT_RECONCILE_MS`, `NUTFT_SUPPLY_INTERVAL_SECONDS`, `NUTFT_PUBLIC_BASE`, `G_NUTFT_PUBLIC_BASE`, `NUTFT_COLLECTION_ID`, `LND_REST_URL` (reported as `NUTFT_FUNDING`) | A value of only spaces or tabs was a value: a number read it as 0, a string kept it. | *Meaning change:* blank is unset, so the default applies. |
| `NUTFT_ONE_PER_KEY`, `G_NUTFT_ONE_PER_KEY`, `NUTFT_PURCHASE_MODE`, `G_NUTFT_PURCHASE_MODE`, `G_NUTFT_ENABLED` | A mistyped value was off. | On is `1`, `true`, `yes`, `on`; off is `0`, `false`, `no`, `off`, in any case; unset or empty is the default. Anything else, a trailing space included, is refused. |
| `NUTFT_BEACON_SOURCE` | Anything but exactly `lnd` was off. | Unset or empty is off, `lnd` is on, anything else is refused. |
| `LND_*` | Read, and the macaroon demanded, on every boot while `LND_REST_URL` was set. | Read only when a mint funds through `lnd` or E1's beacon is on. |
| `NUTFT_FUNDING=lnd`, `G_NUTFT_FUNDING=lnd` | Without `LND_REST_URL` the mint silently became free. | Refused. |
| `NUTFT_ALLOWLIST`, `G_NUTFT_ALLOWLIST` | An entry that was not a key was printed in full and skipped. | Refused, named by its position only. |
| `PIN_SEED` | Its value was printed after the start. | A warning without the value, printed at boot. |

---

## 3 · Every new refusal and its fix

A reason names variables, never a value. "E1" is the `NUTFT_*` mint, "G" the `G_NUTFT_*` one;
G variables are checked only while `G_NUTFT_ENABLED` is on. Read a value you need one key at a
time, where docs/deploy.md §9.2a says, and find what a mint publishes now with §4.

| Line starts with | Refused when | Fix that keeps what the running build does |
|---|---|---|
| `G_NUTFT_CATALOG_URI: required` | G is enabled and it is unset or empty. | Set it to exactly the `catalog_uri` that `/g/nutft/catalog` reports, even if that is E1's URI or a localhost one: another value stops the boot with `mint database belongs to a different NutFT census, collection, or catalog URI`. |
| `G_NUTFT_COLLECTION_ID: required` | As above. | Set it to the literal the running build's own code falls back to, read from the running copy as §9.2a says; it must equal the active keyset's `unit` in `/g/v1/keys`, byte for byte. |
| `G_NUTFT_CENSUS_PATH: required` | As above. | Set it to the absolute path of `cards/g-census.json` in the code directory the unit runs (`ExecStart`, docs/deploy.md §9.2), on the box `/home/deploy/bimCVP/infra/site-root/tcg600/cards/g-census.json`. The §4 snapshot must not move: `catalog_sha256`, the keyset ids, and `census_sha256` from `/g/nutft/catalog`. |
| `G_NUTFT_DB: required` / `names the same file as DB` | G is enabled without its own database file. | Unchanged from before: the running build refused this too. |
| `G_NUTFT_INVOICE_TTL_SECONDS: unset while NUTFT_INVOICE_TTL_SECONDS is set` | E1 sets its quote window and G does not. | Set G's to the E1 value the grep shows, which is what G uses now. |
| `G_NUTFT_CLAIM_GRACE_SECONDS: unset while NUTFT_CLAIM_GRACE_SECONDS is set` | E1 sets its claim grace and G does not. | As above. A shorter G grace would pass a paid, unclaimed set to the next buyer. |
| `NUTFT_FUNDING: unset while PHOENIXD_URL or LND_REST_URL is set` | E1 has no named backend but a node URL is set. | Set it to the `funding` that `/v1/info` reports: `phoenixd`, `lnd`, or `none` if `paid` is false. |
| `NUTFT_SALES: required for a paid mint`, `G_NUTFT_SALES: required for a paid mint` | A mint with a backend other than `none` has no sales mode. | Set the `sales` that `/v1/info` (or `/g/v1/info`) reports. For the alpha that is `allowlist` with `NUTFT_ALLOWLIST` (CLAUDE.md, ADR 0002); moving to it is a sales decision of its own. |
| `NUTFT_FUNDING: must be`, `G_NUTFT_FUNDING: must be` | Not one of `lnd`, `phoenixd`, `cashu`, `mock`, `none` (any capitalisation, no spaces). | Unchanged: the running build refused this too. |
| `LND_REST_URL: required when NUTFT_FUNDING=lnd`, `… G_NUTFT_FUNDING=lnd` | A mint funds through `lnd` without `LND_REST_URL`. | Changes behaviour: the running build gave every booster away here. `…_FUNDING=none` keeps that; configuring the node is a sales decision. |
| `LND_REST_URL: required when NUTFT_BEACON_SOURCE=lnd` | The beacon is on without `LND_REST_URL`. | Unchanged: the running build refused this too. |
| `LND_MACAROON_PATH: required`, `LND_MACAROON: must be hex`, `LND_TLS_CERT_PATH: required`, `LND_REST_URL: must be` | `lnd` is selected and its settings are incomplete. | Unchanged: the running build refused these whenever `LND_REST_URL` was set. |
| `PHOENIXD_URL: required`, `PHOENIXD_URL: must be`, `PHOENIXD_URL: names a host that is not loopback`, `PHOENIXD_PASSWORD_PATH: required` | `phoenixd` is selected and its settings are incomplete. | Unchanged: the running build refused these too. |
| `NUTFT_CASHU_MINT: required`, `must be https` | `cashu` is selected without an https mint. | Unchanged. |
| `NUTFT_PRICE_MSAT: must be a whole number of millisatoshis`, same for `G_NUTFT_PRICE_MSAT` | Set, and not a whole number above 0. | Set the `price_msat` that `/v1/info` (`/g/v1/info` for G) reports, or remove the variable to take the default (21 sat for E1, 210 sat for G). |
| `…_PRICE_MSAT: must be a whole number of sats`, `…_PRICE_SCHEDULE: entry N must be a whole number of sats` | The mint funds through `phoenixd` or `cashu` and a price is not divisible by 1000. | Changes behaviour: every quote failed with this price. Set a whole-sat price; that is what the shop will sell at. |
| `…_PRICE_SCHEDULE: entry N is not "packs:msat"`, `thresholds must increase` | An entry is not exactly two whole numbers above 0, or a threshold does not rise. | The running build refused most malformed ladders too; fix entry N. |
| `…_ALLOWLIST: an nsec (private key) was pasted into … at entry N; remove it` | Entry N starts with `nsec1`. | Remove entry N, and treat that key as exposed: it has sat in the environment. |
| `…_ALLOWLIST: entry N is not an npub or a 64-character hex public key` | Entry N is neither. | The running build skipped it; remove or correct entry N. |
| `…_ALLOWLIST: holds no key, so …=allowlist would sell to nobody` | `allowlist` mode with no valid entry. | Unchanged, except that invalid entries no longer count. |
| `…_ONE_PER_KEY: needs …=allowlist or signed` | One per key is on and sales is `open` or `closed`. | Unchanged, except that an empty `G_NUTFT_ONE_PER_KEY=`, or `NUTFT_ONE_PER_KEY=yes` or `on`, now counts as on: set `0` to keep a mint that ran without the limit. |
| `…: must be on or off` | A flag from §2 holds another word. | The running build read it as off: set `0`. |
| `NUTFT_BEACON_SOURCE: must be lnd, or unset` | Anything but `lnd` or empty. | The running build had the beacon off: remove the variable. |
| `NUTFT_BEACON_CONFIRMATIONS: must be a whole number of blocks` | Set, and not a whole number of at least 1. | With the beacon off, remove it. With it on, changes behaviour: sealed sales under this value could not be claimed; set `1`. |
| `NUTFT_RECONCILE_MS: must be a number of milliseconds` | Set, and not a number. | Changes behaviour on `cashu`, where the sweep ran every millisecond: set `120000`, or remove it. |
| `NUTFT_PUBLIC_BASE: must be an absolute`, `G_NUTFT_PUBLIC_BASE: must be an absolute` | Set, and not `http(s)://host` without user, password, query or fragment. | Changes behaviour: quotes and eligibility checks answered 400 with a value without a scheme. Set `https://` and the site's host, or remove it to derive the base from `PUBLIC_URL`. |
| `PUBLIC_URL: must be a ws:// or wss:// URL` | No public base is set and `PUBLIC_URL` is not `ws(s)://`. | Unchanged: the running build refused this. |
| `…_CATALOG_URI: must be an absolute http:// or https:// URL` | Not an absolute `http(s)` URL, or surrounded by spaces. | The running build refused the first; the second it hashed into cards as written. A URI in issued cards cannot change, so stop and decide before deploying. |
| `…_COLLECTION_ID: must be 1 to 64 letters, digits, dots, dashes or underscores` | Any other collection id. | Wallets refused a mint with such a unit; no identity-keeping fix exists, and none is expected: production is `600B-E1` and `600B-G`. |
| `…_CATALOG_MIRRORS: entry N is not an absolute http:// or https:// URL` | Entry N is not. | Unchanged: the running build refused this. |
| `NUTFT_SUPPLY_RELAYS: entry N is not a ws:// or wss:// URL`, `NUTFT_SUPPLY_INTERVAL_SECONDS: must be 0 (no timer) or …` | As the line says. | Unchanged, except that decimal notation such as `60.0` is refused. |
| `NUTFT_MOCK_SETTLE_MS: must be a whole number of milliseconds` | A mint funds through `mock` and the delay is not a whole number. | Staging only; the mock never settled with it. |

### 3.1 · Meaning changes and their fix

A `meaning changes` row names a value the release would start with but read differently from
the running build: `origin/main` at `74e933a`, and every build that reads these variables the
same way (`d753505` does). Nothing is refused, so without the row the check would print `ok`
and the shop would change at the deploy. The row stops the deploy exactly like a refusal. Its
fix is to write the value the running build actually uses, spelled so that both builds read it
the same, as its own change on the running build (§1). The rows flag only these spellings:
an environment written with `1` and `0`, and without values made only of spaces, never shows
one.

| Line | The running build read it as | Write |
|---|---|---|
| `NUTFT_ONE_PER_KEY: meaning changes (off → on)` | `yes`, `on`, or a capitalised `true`, `yes` or `on`: off. | `NUTFT_ONE_PER_KEY=0`. Writing `1` switches the limit on in the running build too, which is a sales decision of its own. |
| `G_NUTFT_ONE_PER_KEY: meaning changes (off → on)` | An empty or blank value: off. | `G_NUTFT_ONE_PER_KEY=0`, or `1` if the limit was meant, which changes what G sells. |
| `G_NUTFT_CATALOG_MIRRORS: meaning changes (the NUTFT_CATALOG_MIRRORS list → no mirrors)` | Unset: E1's mirror list. | E1's list, copied into `G_NUTFT_CATALOG_MIRRORS`. An empty `G_NUTFT_CATALOG_MIRRORS=` is no mirrors in both builds, but it changes what the running G advertises. |
| `G_NUTFT_PRICE_MSAT: meaning changes (… → 210000 msat)` | A blank value: the `NUTFT_PRICE_MSAT` price, or 21000 msat while that is unset. | The `price_msat` that `/g/v1/info` reports. |
| `NUTFT_RECONCILE_MS: meaning changes (every 30000 ms → every 120000 ms)` | A blank value, on Cashu: 30000. | `NUTFT_RECONCILE_MS=30000`. |
| `NUTFT_SUPPLY_INTERVAL_SECONDS: meaning changes (no timer → every 86400 seconds)` | A blank value: 0, no snapshot timer. | `NUTFT_SUPPLY_INTERVAL_SECONDS=0`. |
| `NUTFT_PUBLIC_BASE: meaning changes (a blank origin → …)`, `G_NUTFT_PUBLIC_BASE: meaning changes (a blank origin → …)` | A blank value: the origin itself, on which every signed request and LNURL link failed. | No spelling keeps that. Remove the variable: both builds then take the origin the row names, which repairs the shop, so treat it as that change. |
| `NUTFT_COLLECTION_ID: meaning changes (a blank collection id → 600B-E1)` | A blank value: the collection id hashed into every E1 card. | No spelling keeps a blank id. Stop: the E1 identity needs a decision first. |
| `NUTFT_FUNDING: meaning changes (lnd → none)` | An empty `NUTFT_FUNDING` with a blank `LND_REST_URL`, a macaroon, and a certificate path or `LND_INSECURE=1`: paid through lnd. | Stop: the release would give every E1 booster away. Set a working `LND_REST_URL` with `NUTFT_FUNDING=lnd`, or `NUTFT_FUNDING=none` as a decision. |

---

## 4 · What the mints publish, before and after an environment fix

Every environment fix, and the restart that brings the running build in line with its files,
is judged by the same snapshot of what both mints publish: the `snap` function in
[docs/deploy.md §9.2](deploy.md), which §9.2a and §9.7 reuse. It prints no environment and
retries a failed request, so a network hiccup never passes for a changed mint. For each edition
it keeps only fields that both the running build and the release publish:

- from `/v1/info`: `paid`, `price_msat`, `price_tiers`, `funding`, `virtual_sats`, `test_mint`,
  `sales`, `one_per_key`, `issuance`, `product`, `catalog_issuer` and **`catalog_sha256`**, the
  digest of the whole catalog, every card's data included;
- from `/nutft/catalog`: `catalog_uri`, `collection_id`, `census_sha256` and `issuer_pubkey`.
  The running build publishes `catalog_uri` only here, not in `/v1/info`;
- from `/v1/keys`: each keyset's `id`, `unit` and `active`, where `unit` is the collection id
  and the id changes with the mint's keys.

`census_sha256` alone is not enough: it covers the census, not the card data the catalog
signs. The `/g/…` paths give the same fields for Edition G, and a mint that is switched off is
`null`. The snapshots before and after a fix must be identical; any difference rolls the
change back and stops the deploy for the day, as §9.2a says.

---

## 5 · Decisions: what Edition G may take from E1

ADR 0003 gives G its own identity and supply. One row is shared, by design:

- **Shared:** the public base. `G_NUTFT_PUBLIC_BASE` falls back to `NUTFT_PUBLIC_BASE`, then to
  `PUBLIC_URL`. It names the site both mints are served from by one referee, not an edition;
  G's own routes add `/g` separately.
- **Never shared:** catalog URI, collection id, census path and database (permanent), mirrors
  (E1's hold E1's blob), price and schedule, sales mode and allowlist, one per key, purchase
  mode, virtual sats, quote window and claim grace, beacon.
- **Process-wide by nature:** the funding connection settings (`PHOENIXD_*`, `LND_*`,
  `NUTFT_CASHU_MINT`, `NUTFT_TEST_MINT`, `NUTFT_MOCK_SETTLE_MS`), `NUTFT_RECONCILE_MS` and the
  supply ledger rows (`NUTFT_SUPPLY_RELAYS`, `NUTFT_SUPPLY_INTERVAL_SECONDS`). There is one node
  and one ledger timer per process; each mint still names its own backend.

Connection settings are checked only when a mint selects that backend. Every other mint
variable is checked whenever it is set, even when nothing reads it yet.

---

## 6 · Warnings that do not refuse

- **A free mint cannot keep one per key.** The buyer is recorded only with a paid issuance
  (`nutft_buyers` in `signBoosterOnce`), so a free claim is never counted and a key can claim
  again. A free G, whose one per key is on by default, boots with
  `[nutft] warning: G_NUTFT_ONE_PER_KEY: this mint is free, and a free claim records no buyer, so one per key is not enforced`.
  Production G is paid; do not run G free where the limit matters.
- **`PIN_SEED` is set.** New matches try pinned seeds first. Testing only, never in production.

The dry run prints problems only; these warnings appear in the journal of a boot.

---

## 7 · What the check cannot see

- **File contents.** It reads no file named by a variable: a missing census, an empty
  `PHOENIXD_PASSWORD_PATH` or an unreadable macaroon still stops the boot with its own message.
- **The database.** A catalog URI, collection id or census that differs from the one a mint
  database was created with stops the boot (`mint database belongs to a different …`). Only
  the database knows, and the check never opens it.
- **Paths.** It compares `G_NUTFT_DB` with `DB` only when both are set. The default `DB` and
  relative paths are resolved by the boot, against the service's code and working directory,
  and the boot still refuses a shared file.
- **The table's own network variables** (`PORT`, `PUBLIC_HOST`, `TABLE_ORIGINS`, `TRUST_PROXY`,
  `TCG_WALLET_BACKUP_ALLOWLIST`, rate limits) keep their meaning and their own startup checks.
