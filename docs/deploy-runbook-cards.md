# Card launch runbook: the TCG half

`written: 2026-09-29` `release: main after #83 and #84` `tests: 917 JS green`

This is the TCG half of the LNURLcash card launch:

- **A**, the code deploy of [`deploy.md` §9](deploy.md#9--alpha-code-deploy-new-site-and-referee-never-a-new-unit);
- **B**, a read of phoenixd, on which Felix decides whether sales open;
- **C**, `TRUST_PROXY`: its own change to the box's environment, so every buyer has their own rate
  budget;
- **D**, the switch, one more change: `NUTFT_CARDS=1`, `NUTFT_SALES=open`, and both the first E1
  price tier and the Edition G starter set at 5 sat;
- **E**, the checks, **F**, the rollbacks, and **G**, the handover.

The nappelin half (the #248 merge, the website release, the outside checks) follows it. Every
command below was run before it was written down. `snap`, the environment check and the discovery
document ran against the release code and the live mints (read only). The phoenixd read ran
against a stand-in node. `setkey` ran on a scratch file, and the checks after the switch ran on a
local referee with cards on. Every bash block also ran as written, in order, in one shell per
scenario, with `set -euo pipefail` on before each block and without it, against stubbed box
commands: the launch from A2 to E, both ways of rolling D back, F1 with and without the prices,
and the failures the gates name.

**Rules.** Run everything in Felix's visible window, one SSH session at a time. The referee
stops for a few minutes, from A5 to A7. C and D each restart it once, which takes seconds. Every
check prints names, counts or public values: an environment file is never printed, and the
phoenixd password never leaves the node process that uses it. **Stop at the first output that
differs from what is written here.** Nothing is tried a second time in the same window.

**`restart`.** C, D and the rollbacks restart the referee only through `restart` (defined below).
It restarts while nobody waits in quick match (`"queued":0`), and at once while the unit is down,
where nobody can wait. Otherwise it prints `not restarted` and changes nothing: run the same line
again in a minute. In a rollback, if the queue has not emptied after a few minutes, or the unit
runs but `/api/health` never answers, put `restart now` in that line. A player waiting for a
match then loses the place in the queue; matches and seats survive (§9.4). A written change that
never gets its restart is taken back before you stop, with `sudo mv "$ENVFILE.bak-$STAMP"
"$ENVFILE"`: otherwise the next restart, whenever it comes, applies it.

**`set -e` is off from A5 on.** §9.4 turns on `set -euo pipefail` for its backup and off again
at its end, and A5 repeats that last line. Left on in an interactive shell, it would end the
session at a count of `0`, at a `diff` that finds the very change it looks for, or at a unit that
is not active yet — right after a secret-bearing backup is written, or right after the referee
restarts with cards on, with `STAMP` and `SNAP` lost. Without `set -e`, a failing command no
longer stops a pasted block either. So every step that must not run after a failure is chained to
it with `&&`, and every block that changes something ends where its gate is read. The expected
non-zero exits, and every chain whose last step can fail, carry `|| true` as well, so none of
them ends the session even where `set -e` is still on.

| What | Value |
|---|---|
| Box | `deploy@178.105.93.78`, `tcg.nappelin.com`, unit `tcg-table`, webroot `/home/deploy/bimCVP/infra/site-root/tcg600`, key `$HOME\.ssh\id_ed25519_sk` |
| Release | `$SHA`, TCG `main` after #83 (the notice) and this runbook's PR, nothing else after `d5ce4b6` |
| Card-set digests | `E1.0 sha256:b2a8806c8129ed951322e82ead43bd9a45f81358d8fa6c44b4c154d0deffd964`, `F1.0 sha256:185e084ce5ac22a30c4fc3e7f2fdeb8d50c60cf825ae95051c1b0ef4b97b7d73`. The same for `9f30f37`, the Hangar's napplet, and every main commit since `3b6f6b0`, so the pinned napplet keeps playing. |
| Card library | `server/vendor/lnurlcash-cards.js`, sha256 `0ad1a6be77069e7cecdd2db9258c5120ffa9c3658019b41efb39f9451ed17296`, built from bearlett `66c7a8ec` |
| E1 price ladder now | `6300:21000,31500:420000,59775:2100000,62775:10000000` (50 of 62,775 packs sold on 2026-09-28) |
| E1 price ladder after | `6300:5000,31500:420000,59775:2100000,62775:10000000` |
| G starter set now | `G_NUTFT_PRICE_MSAT=210000`: 210 sat, flat |
| G starter set after | `G_NUTFT_PRICE_MSAT=5000`: 5 sat |

**Why 5 sat.** Felix asked for prices just high enough to cover the transaction fees. Only the
first tier applies until pack 6,300, so only that tier drops. The higher tiers stay as the brake
on buying up the edition. The Edition G starter set, one flat price, drops to 5 sat as well.

5 sat is the lowest whole-sat price that covers one payout, for example a refund. phoenixd charges
4 sat + 0.4 % for every outgoing payment (phoenixd v0.9.1, `conf/Lsp.kt`, trampoline fee).
Receiving costs nothing while the channel has room. Past that, phoenixd buys liquidity: a service
fee plus a mining fee, the mining fee capped by default at 1 % of the 2,000,000 sat auto-liquidity.
A payment too small to pay for that goes into the fee credit, which is not refundable (B).

A buyer paying from Bearlett with notes from `mint.lnurlcash.com` can pay 5 sat. The split
there has no 10-sat floor (lnurl-mint `router.py`: `min_mint_msat` applies to fresh mints only)
and costs the mint's 1 sat base fee, and the mint pays the routing.

---

## Once per SSH session on the box

Paste this block after logging in, and again after any reconnect. It only defines `TCG` and
functions. After a reconnect, name `ENVFILE` again (A2). A step under way keeps its `STAMP` in the
name of its backup: `sudo ls "$(dirname "$ENVFILE")"`.

```bash
TCG=/home/deploy/bimCVP/infra/site-root/tcg600
fetch() {  # fetch <url> <file>: 200 keeps the body, 404 (a mint that is off) an empty file; else fail
  local code
  code=$(curl -s --retry 3 --retry-delay 2 --retry-all-errors --max-time 30 -o "$2" -w '%{http_code}' "$1")
  [ "$code" = 200 ] && return 0
  [ "$code" = 404 ] && { : > "$2"; return 0; }
  echo "snap: $1 answered ${code:-nothing}; take the snapshot again" >&2
  return 1
}
snap() {  # snap <dir>: both mints' public answers, and their stable fields as <dir>.json
  mkdir -p "$1" && rm -f "$1.json"
  for P in "" /g; do
    N=v1; [ -n "$P" ] && N=g-v1
    fetch "https://tcg.nappelin.com$P/v1/info" "$1/$N-info.json" || return 1
    fetch "https://tcg.nappelin.com$P/v1/keys" "$1/$N-keys.json" || return 1
    fetch "https://tcg.nappelin.com$P/nutft/catalog" "$1/$N-catalog.json" || return 1
  done
  node -e '
    const fs = require("fs"), dir = process.argv[1];
    const read = (f) => { try { return JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")); } catch { return null; } };
    const pick = (m) => {
      const info = read(`${m}-info.json`), keys = read(`${m}-keys.json`), cat = read(`${m}-catalog.json`);
      if (!info) return null;
      const n = (info.nuts && info.nuts["31"]) || {};
      const f = ["paid", "price_msat", "price_tiers", "funding", "virtual_sats", "test_mint", "sales",
        "one_per_key", "issuance", "product", "catalog_issuer", "catalog_sha256"];
      return { nut31: Object.fromEntries(f.map((k) => [k, n[k] === undefined ? null : n[k]])),
        catalog: cat && { catalog_uri: cat.catalog_uri, collection_id: cat.collection_id,
          census_sha256: cat.census_sha256, issuer_pubkey: cat.issuer_pubkey },
        keysets: ((keys && keys.keysets) || []).map((k) => ({ id: k.id, unit: k.unit, active: k.active })) };
    };
    console.log(JSON.stringify({ e1: pick("v1"), g: pick("g-v1") }, null, 1));
  ' "$1" > "$1.json"
}
snapc() {  # snapc <dir>: snap, plus the card mint's discovery document (null while the card mint is off)
  snap "$1" || return 1
  fetch "https://tcg.nappelin.com/.well-known/lnurlcash-cards" "$1/cards.json" || return 1
  node -e '
    const fs = require("fs"), dir = process.argv[1];
    const out = JSON.parse(fs.readFileSync(`${dir}.json`, "utf8"));
    let cards = null;
    try { cards = JSON.parse(fs.readFileSync(`${dir}/cards.json`, "utf8")); } catch {}
    out.cards = cards;
    fs.writeFileSync(`${dir}.json`, JSON.stringify(out, null, 1) + "\n");
  ' "$1"
}
setkey() {  # setkey KEY value: the one KEY= line in $ENVFILE gets value, or is added; prints no value
  local n
  [ -n "${ENVFILE:-}" ] || { echo "$1: ENVFILE is not named (A2), stop"; return 1; }
  n=$(sudo grep -c "^$1=" "$ENVFILE" || true)  # grep -c exits 1 at zero: never end the session here
  if [ "$n" = 0 ]; then
    [ -n "$(sudo tail -c1 "$ENVFILE")" ] && echo | sudo tee -a "$ENVFILE" > /dev/null
    printf '%s=%s\n' "$1" "$2" | sudo tee -a "$ENVFILE" > /dev/null
  elif [ "$n" = 1 ]; then
    sudo sed -i "s|^$1=.*|$1=$2|" "$ENVFILE"
  else
    echo "$1: $n lines in $ENVFILE, stop"; return 1
  fi
  [ "$(sudo grep -cxF "$1=$2" "$ENVFILE" || true)" = 1 ] && echo "$1: set" || { echo "$1: NOT set, stop"; return 1; }
}
restart() {  # restart [now]: at "queued":0; at once while the unit is down, or with now; then its state
  local health
  if [ "${1:-}" != now ] && systemctl is-active --quiet tcg-table; then
    health=$(curl -s --max-time 10 https://tcg.nappelin.com/api/health || true)
    case "$health" in
      *'"queued":0,'*) ;;
      *) echo "not restarted: ${health:-/api/health did not answer}; again in a minute"; return 1 ;;
    esac
  fi
  sudo systemctl restart tcg-table && systemctl is-active tcg-table
}
intended() {  # intended <before.json> <after.json> [g5]: after is before with exactly the intended changes
  node -e '
    const fs = require("fs");
    const [before, after] = process.argv.slice(1, 3).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    const want = JSON.parse(JSON.stringify(before));
    want.e1.nut31.sales = "open";
    want.e1.nut31.price_msat = 5000;
    want.e1.nut31.price_tiers[0].price_msat = 5000;
    if (process.argv[3] === "g5") want.g.nut31.price_msat = 5000;
    const base = "https://tcg.nappelin.com";
    want.cards = { v: 0, issuer: before.e1.nut31.catalog_issuer, withdraw: `${base}/cards/w`, lookup: `${base}/cards`,
      packs: [{ lnurlp: `${base}/cards/lnurlp`, edition: "600b-e1", collection_id: before.e1.catalog.collection_id,
        catalog_uri: before.e1.catalog.catalog_uri }] };
    const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    const ok = JSON.stringify(canon(want)) === JSON.stringify(canon(after));
    console.log(ok ? "exactly the intended changes" : "NOT the intended changes: roll back");
    process.exitCode = ok ? 0 : 1;
  ' "$1" "$2" "${3:-}"  # unset without g5, which `set -u` would otherwise call an error
}
waiting() {  # waiting: card packs quoted and not yet issued or closed, read only
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log("card packs waiting:", JSON.stringify(db.prepare(
      "SELECT payment_hash, created_at FROM nutft_invoices WHERE card_owner IS NOT NULL AND claimed = 0 AND card_closed IS NULL").all()));
  ' "$(grep -E '^DB=' /home/deploy/tcg-env-before.txt | cut -d= -f2-)"
}
```

---

## A · Deploy the release

This is `deploy.md` §9, with its 2026-09-29 additions. The staging script copies `server\*.js`
only, and `card-mint.js` needs `server\vendor\lnurlcash-cards.js`: without it the referee does not
start (`Cannot find module './vendor/lnurlcash-cards.js'`), whatever `NUTFT_CARDS` says. A
manifest of every server file is therefore checked on Windows before the upload and on the box
before the start.

### A1 · Windows: the release clone (§9.1)

```powershell
git -C G:\Github\TCG600nap fetch origin
git -C G:\Github\TCG600nap status --porcelain --untracked-files=all --ignored -- `
  site cards rules art/brand art/fonts art/resources art/rulebook art/site art/world-plates `
  art/cards/node-runner-web art/cards/promos server package.json package-lock.json
$SHA = git -C G:\Github\TCG600nap rev-parse origin/main
git -C G:\Github\TCG600nap log --oneline --first-parent d5ce4b6..$SHA
$REL = "G:\projekte\tcg-release-$($SHA.Substring(0,12))"
git clone --no-local G:\Github\TCG600nap $REL
git -C $REL checkout --detach $SHA
cd $REL
npm ci
npm run test:js
uv run --frozen pytest -q
node -e "const E=require('./site/engine.js'); console.log('E1.0', E.setCatalog(require('./site/play-data.js')).digest); console.log('F1.0', E.setCatalog(require('./site/play-data-fast.js'), 'F1.0').digest)"
```

Gate:
- The status shows only the local-only hits §9.1 names.
- The log shows exactly two merges, #83 and this runbook's PR, and `$SHA` is the SHA the
  coordinator pinned.
- The JS suite is green: 917 tests. Python shows no failures.
- The two digests are the ones in the table above.

### A2 · Box, read only: what runs, and where the launch settings live (§9.2)

```bash
systemctl show tcg-table -p EnvironmentFiles -p ExecStart -p WorkingDirectory
systemctl show tcg-table -p Environment | tr ' ' '\n' \
  | grep -E '^(Environment=)?(NUTFT_CATALOG_URI|G_NUTFT_CATALOG_URI|PUBLIC_URL|TABLE_ORIGINS)='
PID=$(systemctl show -p MainPID --value tcg-table)
sudo cat /proc/$PID/environ | tr '\0' '\n' \
  | grep -E '^(NUTFT_CATALOG_URI|G_NUTFT_CATALOG_URI|PUBLIC_URL|TABLE_ORIGINS|DB|G_NUTFT_DB)=' \
  | tee /home/deploy/tcg-env-before.txt
curl -s https://tcg.nappelin.com/api/health
sudo journalctl -u tcg-table --no-pager | grep ' · catalog ' | tail -1
```

The settings this launch changes, from the running process. These are public values, no secret:

```bash
sudo cat /proc/$PID/environ | tr '\0' '\n' \
  | grep -E '^(NUTFT_CARDS|NUTFT_SALES|NUTFT_PRICE_SCHEDULE|NUTFT_PRICE_MSAT|NUTFT_PUBLIC_BASE|NUTFT_PURCHASE_MODE|NUTFT_FUNDING|G_NUTFT_PRICE_MSAT|TRUST_PROXY)='
for F in $(systemctl show -p EnvironmentFiles --value tcg-table | tr ' ' '\n' | grep '^-\?/' | sed 's/^-//'); do
  for K in NUTFT_CARDS NUTFT_SALES NUTFT_PRICE_SCHEDULE G_NUTFT_PRICE_MSAT TRUST_PROXY; do
    echo "$F $K: $(sudo grep -c "^$K=" "$F") line(s)"
  done
done
systemctl show tcg-table -p Environment | tr ' ' '\n' | sed 's/^Environment=//' \
  | grep -oE '^(NUTFT_CARDS|NUTFT_SALES|NUTFT_PRICE_SCHEDULE|G_NUTFT_PRICE_MSAT|TRUST_PROXY)=' || true
```

Gate:
- The process shows `NUTFT_SALES=allowlist`, the E1 price ladder in the table above,
  `NUTFT_FUNDING=phoenixd`, and `G_NUTFT_PRICE_MSAT=210000`. There is no `NUTFT_CARDS`, and no
  `NUTFT_PURCHASE_MODE` that is on.
- One environment file holds `NUTFT_SALES` and `NUTFT_PRICE_SCHEDULE`, one line each, and
  `G_NUTFT_PRICE_MSAT`, one line. `NUTFT_CARDS` and `TRUST_PROXY` have no line in any file, or one
  in that same file.
- The last command prints nothing: the unit's own `Environment=` lines do not set these keys.

Name that file for the rest of the session:

```bash
ENVFILE=<the file that holds NUTFT_SALES>
```

If `NUTFT_SALES`, `NUTFT_PRICE_SCHEDULE`, `NUTFT_CARDS` or `TRUST_PROXY` sits anywhere else, stop:
C and D are written for one file. If only `G_NUTFT_PRICE_MSAT` sits in another file, D runs
without G (the variant at the end of D), and the coordinator hears it (G).

Then the snapshot. `cards` must be `null`:

```bash
snapc /home/deploy/tcg-release-before
cat /home/deploy/tcg-release-before.json
```

### A3 · The release's rules against the running environment, and against D (§9.2a)

On Windows, copy the three files, as §9.2a does:

```powershell
$SHA12 = $SHA.Substring(0,12)
$CHECK = Join-Path $env:TEMP "tcg-envcheck-$SHA12"
New-Item -ItemType Directory -Force "$CHECK\server" | Out-Null
Copy-Item "$REL\server\env-check.js", "$REL\server\mint-env.js", "$REL\server\lnurl.js" "$CHECK\server\"
scp -i $HOME\.ssh\id_ed25519_sk -o IdentitiesOnly=yes -r $CHECK deploy@178.105.93.78:/home/deploy/
```

On the box, run the `NeedDaemonReload` check and the "edited after the running start" loop from
§9.2a unchanged. Then the check twice (put the twelve characters of `$SHA12` in place of
`<sha12>`):

```bash
PID=$(systemctl show -p MainPID --value tcg-table)
sudo cat /proc/$PID/environ | node /home/deploy/tcg-envcheck-<sha12>/server/env-check.js --from -
{ printf 'NUTFT_CARDS=1\0NUTFT_SALES=open\0NUTFT_PRICE_SCHEDULE=6300:5000,31500:420000,59775:2100000,62775:10000000\0G_NUTFT_PRICE_MSAT=5000\0'
  sudo cat /proc/$PID/environ; } | node /home/deploy/tcg-envcheck-<sha12>/server/env-check.js --from - || true
rm -r /home/deploy/tcg-envcheck-<sha12>
```

The first definition of a name wins, so the second run checks D's four values against
everything else the box runs with. It exits 1 on the line it is expected to print, hence
`|| true`.

Gate:
- The first run prints the single line `ok`. Otherwise fix the environment as §9.2a describes
  before anything else.
- The second run prints exactly these two lines:

  ```
  NUTFT_CARDS: set, but the running build ignores it
  1 problem
  ```

  That line only says the build running now has no card mint. Any other line is a refusal D would
  meet: stop here, while nothing has changed. For example, `needs an https public origin without a
  path` means `NUTFT_PUBLIC_BASE`, or `PUBLIC_URL` without it, is not `wss://tcg.nappelin.com` or
  `https://tcg.nappelin.com`.

### A4 · Windows: stage, with the card library and a manifest (§9.3)

```powershell
cd G:\projekte\HetzerDeploy
.\deploy-tcg.ps1 -StageOnly -RepoDir $REL
Remove-Item -Recurse -Force .\site\tcg600\deploy
Copy-Item -Recurse -Force "$REL\server\vendor" .\site\tcg600\server\
$FILES = git -C $REL ls-files server
$LINES = foreach ($F in $FILES) { "$((Get-FileHash -Algorithm SHA256 (Join-Path $REL $F)).Hash.ToLower())  $F" }
[IO.File]::WriteAllText("$PWD\site\tcg600\release-$SHA12.sha256", (($LINES -join "`n") + "`n"))
$MISSING = foreach ($F in $FILES) {
  $STAGED = Join-Path .\site\tcg600 $F
  if (-not (Test-Path $STAGED) -or (Get-FileHash -Algorithm SHA256 $STAGED).Hash -ne (Get-FileHash -Algorithm SHA256 (Join-Path $REL $F)).Hash) { $F }
}
if ($MISSING) { "NOT STAGED: $MISSING" } else { "staged: all $($FILES.Count) server files" }
$PROV = Get-Content "$REL\server\vendor\lnurlcash-cards.provenance.json" -Raw | ConvertFrom-Json
$VENDOR = (Get-FileHash -Algorithm SHA256 .\site\tcg600\server\vendor\lnurlcash-cards.js).Hash.ToLower()
if ($VENDOR -eq $PROV.sha256) { "card library $VENDOR from bearlett $($PROV.commit)" } else { "CARD LIBRARY MISMATCH" }
Get-ChildItem .\site\tcg600 | Select-Object Name
```

Gate:
- `staged: all 19 server files`.
- `card library 0ad1a6be… from bearlett 66c7a8ec…`.
- The listing names `art`, `cards`, `package-lock.json`, `package.json`, `release-<sha12>.sha256`,
  `rules`, `server` and `site`, and no `deploy`.

### A5 · Box: stop, then back up both databases (§9.4)

Exactly §9.4: `"queued":0` first, then stop, `tar` and `VACUUM INTO`. Write `STAMP` down: the
code rollback names it. §9.4's backup block ends by turning `set -e` off again. Run that line once
more here, in the same window; if it already ran, it changes nothing:

```bash
set +euo pipefail
```

From here on, every block is written for a shell without `set -e` (Rules).

### A6 · Windows: upload with the key (§9.5)

Exactly §9.5: one `scp`, one touch. The manifest travels with the payload.

### A7 · Box: prove the files, then start (§9.6)

```bash
cd $TCG
[ -f deploy/install-tcg.sh ] && mv deploy/install-tcg.sh deploy/install-tcg.sh.do-not-run || true
comm -13 <(cut -c67- release-<sha12>.sha256 | sort) <(find server -type f | sort)
sha256sum --quiet --strict -c release-<sha12>.sha256 && echo "server files: all as released" \
  && npm ci --omit=dev \
  && node -e 'require("./server/table.js"); console.log("the referee loads")' \
  && sudo systemctl start tcg-table && systemctl is-active tcg-table || true
```

Gate:
- `comm` lists the files the box has and the release does not, left over from earlier deploys.
  They are harmless, and are written down for the record.
- Then `server files: all as released`, `npm ci`'s summary, `the referee loads` and `active`. The
  start is chained behind the three checks, so it runs only after all of them. A `FAILED` line
  means a file is missing or differs: the referee stays stopped; upload again (A6) and run this
  block again. Any other stop before `active`: roll the code back (§9.8, with A5's `STAMP`).
- Loading `table.js` covers the card mint, the engine, both card catalogs and `ws` in one go, and
  it leaves no handle open, so it returns by itself.

### A8 · Box: prove nothing but the code changed (§9.7)

§9.7 exactly, with `snapc` in place of `snap`:

```bash
snapc /home/deploy/tcg-release-after
diff /home/deploy/tcg-release-before.json /home/deploy/tcg-release-after.json && echo "mints unchanged" || true
curl -s -o /dev/null -w '%{http_code} card discovery (404 while cards are off)\n' \
  https://tcg.nappelin.com/.well-known/lnurlcash-cards
```

The rest of §9.7 is unchanged: the environment diff, NUT-09, the assets, the journal and the two
digests. The digests are the ones in the table above.

### A9 · The Hangar (§9.7a)

The digests have not changed, so the napplet the Hangar pins (`9f30f37`) keeps playing at this
table. Tell the coordinator `$SHA` and the two digest lines.

---

## B · phoenixd: the gate before sales open

This is read only. The node process reads `PHOENIXD_*` from the running referee on stdin, so the
password is neither printed nor put in a command line. It asks phoenixd `getinfo`, `getbalance` and
`estimateliquidityfees`, all allowed with the limited password.

```bash
PID=$(systemctl show -p MainPID --value tcg-table)
sudo cat /proc/$PID/environ | node -e '
  const fs = require("fs");
  for (const entry of fs.readFileSync(0, "utf8").split("\0")) {
    const at = entry.indexOf("=");
    if (at > 0 && entry.startsWith("PHOENIXD_")) process.env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  const { readConfig } = require(process.argv[1] + "/server/phoenixd.js");
  let config;
  try { config = readConfig({}); } catch (error) { console.log("phoenixd config refused:", error.message); process.exit(1); }
  if (!config) { console.log("the running process names no PHOENIXD_URL"); process.exit(1); }
  const get = (path) => new Promise((resolve, reject) => {
    const url = new URL(config.url + path);
    const req = require(url.protocol === "https:" ? "https" : "http").get({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, timeout: 15000,
      headers: { authorization: "Basic " + Buffer.from(":" + config.password).toString("base64") },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { let json = null; try { json = JSON.parse(body); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on("timeout", () => req.destroy(new Error("no answer within 15 s")));
    req.on("error", (error) => reject(new Error(`${path}: ${error.message}`)));
  });
  (async () => {
    const info = await get("/getinfo");
    const balance = await get("/getbalance");
    if (info.status !== 200 || balance.status !== 200 || !info.json || !balance.json) {
      console.log(`phoenixd answered getinfo ${info.status} and getbalance ${balance.status}: nothing read`);
      process.exit(1);
    }
    /* The rates come from the LSP, not from phoenixd itself: a slow answer or a timeout
       here must not throw away getinfo and getbalance, which are the numbers of the gate.
       No apostrophe anywhere in this script: it would end the shell quote around it. */
    const fees = await get("/estimateliquidityfees?amountSat=2000000")
      .catch((error) => ({ status: `not reached (${error.message})`, json: null }));
    const channels = info.json.channels || [];
    console.log(JSON.stringify({
      version: info.json.version,
      chain: info.json.chain,
      channels: channels.map((c) => ({ state: c.state, balanceSat: c.balanceSat,
        inboundLiquiditySat: c.inboundLiquiditySat, capacitySat: c.capacitySat })),
      balanceSat: balance.json.balanceSat,
      feeCreditSat: balance.json.feeCreditSat,
      channelFor2mSat: fees.status === 200 && fees.json
        ? { miningFeeSat: fees.json.miningFeeSat, serviceFeeSat: fees.json.serviceFeeSat }
        : `not answered (${fees.status})`,
    }, null, 1));
  })().catch((error) => { console.log("phoenixd:", error.message); process.exit(1); });
' "$TCG"
```

How to read it:
- **`channels: []`, `balanceSat: 0`: no channel.** This was the state on 2026-08-20 (ADR 0005:
  fee credit 25,210 sat, cap 50,000). Every sale lands in the fee credit, which cannot be spent,
  withdrawn or refunded. No payout and no `REFUND DUE` (§10.2a) can be paid until a channel exists.
  At the cap, phoenixd refuses payments and the shop stops taking money, with nothing in our logs
  to say why. The cap is 50,000 sat by default for 2m auto-liquidity. At 5 sat a pack, the headroom
  is `(50000 - feeCreditSat) / 5` packs.
- **A channel in state `Normal`:** `inboundLiquiditySat` is how much can still come in before
  phoenixd buys liquidity again, paid from the next payment or the fee credit.
- **`channelFor2mSat`:** what a channel with 2,000,000 sat inbound would cost now.
- **`channelFor2mSat: "not answered (…)"`**, with `not reached (…)` inside it: the LSP's rate, not
  phoenixd's own state. The channel and balance numbers above it still stand, and Felix can decide
  on them; only the price of new liquidity is unknown.
- `nothing read` from `getinfo` or `getbalance`, a refusal or a timeout there: stop. The gate has
  no numbers.

**Gate: Felix decides with these numbers whether sales open.** The channel and the fee credit are
decided here, in the sitting. Go on only with his explicit yes.

---

## C · `TRUST_PROXY` (its own change, before D)

On 2026-09-28, `/api/health` answered `"client":"172.18.0.5"` to a request from outside: the Docker
Caddy's address, not the caller's. While that is so, every buyer draws on one budget: per minute,
20 mint writes, 60 quotes and 240 recoveries for the whole world (§4, §5). With sales open, that
is the first thing a rush hits. Felix decided to fix it, as its own step before D.

From Windows, outside:

```powershell
curl.exe -s https://tcg.nappelin.com/api/health
```

If `client` is your own public address, skip C. If it is a `172.x` address, that is the Caddy
peer, and this is an environment fix under §9.2a's rules. On the box, read only:

```bash
sudo ss -tn '( sport = :8777 )'
```

`ss` must list that address as the peer of the connections to `:8777`. Then write the key, with
the backup first:

```bash
PEER=<the client address /api/health printed>
STAMP=$(date -u +%Y%m%dT%H%M%SZ); SNAP=/home/deploy/tcg-trustproxy-$STAMP
snapc "$SNAP/before" && sudo cp -a "$ENVFILE" "$ENVFILE.bak-$STAMP" && setkey TRUST_PROXY "$PEER" || true
```

`TRUST_PROXY: set`. `$PEER` alone is enough: every address is compared as one canonical form, and
an IPv4-mapped address is compared as plain IPv4 (`canonicalAddress`, table.js). Then the restart:

```bash
restart && snapc "$SNAP/after" && diff "$SNAP/before.json" "$SNAP/after.json" && echo "mints unchanged"
```

`active`, then `mints unchanged`. `not restarted` means somebody waits in quick match, and the
referee still runs as before: run the same line again in a minute. If you stop instead, move the
backup back first (`restart`, above). Then from Windows, two checks:

```powershell
curl.exe -s https://tcg.nappelin.com/api/health
curl.exe -s -H "X-Forwarded-For: 203.0.113.9" https://tcg.nappelin.com/api/health
```

The first must show your own public address. The second must show it too: only the rightmost hop
counts (table.js), which is the address Caddy connected from, so a header a client sends ahead of
it cannot take over somebody else's budget. If the second shows `203.0.113.9`, roll C back at
once: anyone could then spend another buyer's budget.

Gate:
- `mints unchanged`, and your own address twice: `sudo shred -u "$ENVFILE.bak-$STAMP"`.
- Anything else: roll C back and leave it for another day. D does not depend on C, but E5 does.

  ```bash
  sudo mv "$ENVFILE.bak-$STAMP" "$ENVFILE"
  restart && snapc "$SNAP/rollback" && diff "$SNAP/before.json" "$SNAP/rollback.json" && echo "as before C"
  ```

  `active`, then `as before C`. On `not restarted`, run the second line again in a minute.

**`172.18.0.5` is assigned by Docker, not pinned.** Recreating `gw-caddy` can give it another
address. `TRUST_PROXY` then names an address that is no longer the proxy: the referee ignores
`X-Forwarded-For` again, and every buyer is silently back on one budget. Whatever gets
`172.18.0.5` next would be trusted as a proxy. Pinning `gw-caddy`'s `ipv4_address` in its compose
file is a nappelin box change, not part of this launch: it goes to the coordinator (G). Until it is
pinned, run C's two `/api/health` checks again after any change to Caddy.

---

## D · Cards on, sales open, 5 sat

Before starting D:
- B's numbers are read, and Felix said yes;
- A3's second run printed exactly its two lines;
- C is done, or skipped because `/api/health` already showed your own address, or rolled back
  (then E5 waits).

Read only first:

```bash
waiting
PID=$(systemctl show -p MainPID --value tcg-table)
{ printf 'NUTFT_CARDS=1\0NUTFT_SALES=open\0NUTFT_PRICE_SCHEDULE=6300:5000,31500:420000,59775:2100000,62775:10000000\0G_NUTFT_PRICE_MSAT=5000\0'
  sudo cat /proc/$PID/environ; } | node "$TCG/server/env-check.js" --from - || true
```

`waiting` must print `card packs waiting: []`, because the card mint has never been on. The check
runs the release's own copy on the box and must print the same two lines as A3.

Then the four keys, with the backup first:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ); SNAP=/home/deploy/tcg-cards-on-$STAMP
snapc "$SNAP/before" && sudo cp -a "$ENVFILE" "$ENVFILE.bak-$STAMP" \
  && setkey NUTFT_CARDS 1 && setkey NUTFT_SALES open \
  && setkey NUTFT_PRICE_SCHEDULE 6300:5000,31500:420000,59775:2100000,62775:10000000 \
  && setkey G_NUTFT_PRICE_MSAT 5000 || true
```

Four lines, `NUTFT_CARDS: set` to `G_NUTFT_PRICE_MSAT: set`. The chain stops at the first key
that is not set, and nothing runs differently yet: put the file back with
`sudo mv "$ENVFILE.bak-$STAMP" "$ENVFILE"` and stop for the day.

Then the switch:

```bash
SINCE=$(date '+%Y-%m-%d %H:%M:%S')
restart && snapc "$SNAP/after" && echo "after-snapshot taken"
```

`active`, then `after-snapshot taken`. `not restarted` means somebody waits in quick match, and
nothing runs differently yet: run the two lines again in a minute. If it keeps refusing and you
stop, move the backup back first, `sudo mv "$ENVFILE.bak-$STAMP" "$ENVFILE"`: nothing ran with
D's values, so that is the whole rollback, and no later restart picks them up. From `active` on,
the card mint is public. `failed`, or an `activating` that stays: the referee does not come up
with D's values; roll D back.

Then the checks:

```bash
diff "$SNAP/before.json" "$SNAP/after.json" || true  # the diff IS the expected result here
intended "$SNAP/before.json" "$SNAP/after.json" g5 || true
sudo cat /proc/$(systemctl show -p MainPID --value tcg-table)/environ | tr '\0' '\n' \
  | grep -E '^(NUTFT_CARDS|NUTFT_SALES|NUTFT_PRICE_SCHEDULE|G_NUTFT_PRICE_MSAT)=' || true
sudo journalctl -u tcg-table --since "$SINCE" --no-pager | grep -c 'THE CARD MINT IS OFF' || true
```

The `diff` must be exactly this: e1's price and first tier at 5 sat, e1's sales open, G's price at
5 sat, and the card mint's discovery document where `null` was.

```
5c5
<    "price_msat": 21000,
---
>    "price_msat": 5000,
9c9
<      "price_msat": 21000
---
>      "price_msat": 5000
27c27
<    "sales": "allowlist",
---
>    "sales": "open",
51c51
<    "price_msat": 210000,
---
>    "price_msat": 5000,
77c77,90
<  "cards": null
---
>  "cards": {
>   "v": 0,
>   "issuer": "48dbe3768f1e2e4e91309ed9f759ea2d71a81ad67121ea01f8ddcd6c1b8fa6a7",
>   "withdraw": "https://tcg.nappelin.com/cards/w",
>   "lookup": "https://tcg.nappelin.com/cards",
>   "packs": [
>    {
>     "lnurlp": "https://tcg.nappelin.com/cards/lnurlp",
>     "edition": "600b-e1",
>     "collection_id": "600B-E1",
>     "catalog_uri": "https://tcg.nappelin.com/nutft/catalog"
>    }
>   ]
>  }
```

The card issuer is the catalog key (`card-mint.js`), so `issuer` equals `catalog_issuer`.
Nothing else may change: not the catalog, its URI or digest, the census, the issuer, the keysets,
and nothing else under `g`. `intended` proves the same thing mechanically; its `g5` is G's price.

Gate:
- The diff is as above, `intended` prints `exactly the intended changes`, the process shows the
  four new values, and the journal count is `0`. Then:

  ```bash
  sudo shred -u "$ENVFILE.bak-$STAMP"
  sudo ls -l "$(dirname "$ENVFILE")"
  ```

- Anything else: roll D back, below. A `THE CARD MINT IS OFF` line names its reason; the card
  mint stays off and the NutFT sale goes on.

**Without G** (if Felix takes that decision back, or A2 found `G_NUTFT_PRICE_MSAT` in another
file): leave out `G_NUTFT_PRICE_MSAT=5000\0`, `&& setkey G_NUTFT_PRICE_MSAT 5000` and the `g5`,
and look for three `set` lines. The diff then has no `51c51`, and the process shows three new
values.

### Rolling D back

The card mint has been public since D's restart. A buyer may hold a quote from any moment up to
the restart that switches it off, and a quote stays payable for about 15 minutes; only the card
mint issues a paid pack, and switched off it would hold the shop (F1). So D always goes back in
two steps, whatever `waiting` shows now. First everything but the card mint:

```bash
sudo cp -a "$ENVFILE.bak-$STAMP" "$ENVFILE" && setkey NUTFT_CARDS 1 && restart || true
```

`NUTFT_CARDS: set`, then `active`. The file is the one from before D plus `NUTFT_CARDS=1`: sales
are closed to wallets again, and both prices are back. `failed`, or an `activating` that stays,
means the referee does not come up with cards on at all: go straight to the last step, and read a
row in `waiting` as a hard off (F1). Then:

```bash
waiting   # again every few minutes, until the list is empty
```

`card packs waiting: []` at once when nobody quoted a pack, else within about 25 minutes (F1). Then
the card mint goes off, with the file exactly as it was before D:

```bash
sudo mv "$ENVFILE.bak-$STAMP" "$ENVFILE" \
  && restart && snapc "$SNAP/rollback" && diff "$SNAP/before.json" "$SNAP/rollback.json" && echo "as before D"
```

`active`, then `as before D`: everything the mints publish is as it was, and `mv` leaves no copy of
the file behind. Stop for the day. On `not restarted`, run the second line again in a minute.

---

## E · After the switch

Each check must hold. One that does not is a rollback through F1.

```bash
curl -s -D - -o /dev/null https://tcg.nappelin.com/.well-known/lnurlcash-cards \
  | grep -i -E '^HTTP|^access-control-allow-origin'
curl -s https://tcg.nappelin.com/cards/lnurlp; echo
curl -s https://tcg.nappelin.com/nutft/lnurlp; echo
curl -s -D - "https://tcg.nappelin.com/cards?owner=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" \
  | grep -i -E '^HTTP|^access-control-allow-origin|^\{'
```

1. **The discovery document** on `tcg.nappelin.com` answers `200` with
   `access-control-allow-origin: *`. D has already proved that every endpoint in it is on the
   document's own origin.
2. **The card pack's pay request** answers:
   - `tag` `payRequest`;
   - `callback` `https://tcg.nappelin.com/cards/lnurlp/callback`;
   - `minSendable` and `maxSendable` both `5000`, and `commentAllowed` `100`;
   - metadata saying `A pack of 600B cards (600b-e1), as LNURLcash notes only your key moves. An experiment: funds here are not safe.`
3. **The booster's pay request** answers `minSendable` and `maxSendable` `5000`, with the same
   notice in its text.
4. **The lookup** for a key that holds nothing answers `200`, `access-control-allow-origin: *`
   and `{"cards":[],"used":false}`.
5. **A 429 carries CORS.** Run this only after C: otherwise the burst uses the one budget every
   buyer shares, and their quotes wait for about a minute.

   ```bash
   URL='https://tcg.nappelin.com/cards/w?p=x'
   curl -s -w '%{stderr}%{http_code}\n' $(for i in $(seq 90); do printf '%s ' "$URL"; done) 2>&1 >/dev/null | sort | uniq -c
   curl -s -D - -o /dev/null "$URL" | grep -i -E '^HTTP|^access-control-allow-origin|^retry-after'
   ```

   `/cards/w?p=x` does nothing but answer an LNURL error, on the quote budget of 60 a minute. The
   counts show about 60 `200` and the rest `429`. The last request answers `429` with
   `access-control-allow-origin: *` and a `retry-after`. The journal gets one `rate limited:` line.
6. **`/cards/*` is the card mint's while cards are on.** It is matched before the static `cards/`
   folder (table.js), so every file there answers the card mint's LNURL 404 instead:
   `https://tcg.nappelin.com/cards/nutft-census.json`, `cards/g-census.json`,
   `cards/e1-cards.json` and the rest. Nothing on the site or in the Hangar fetches one of them over
   HTTP (the referee reads the census from disk, `server/nutft-mint.js`), so this costs nothing
   today. Do not add a page that fetches a file under `/cards/` while cards are on. Routing only the
   card mint's own paths there is a later code change, not part of this launch.
7. **The first real pack**, with the nappelin half: after the website release, Bearlett buys one
   card pack for 5 sat and its cards arrive. `waiting` shows it only until it is issued, which the
   sweep does within 30 s. The starter shop now offers a G set for 5 sats; it reads the price from
   `/g/v1/info`.

---

## F · Rollback

### F1 · Cards off again

First, the packs in flight:

```bash
waiting
```

Each row is a card pack quoted and not yet issued:
- An unpaid one lapses at the invoice lifetime plus 600 s after its `created_at` (25 min at the
  defaults). The card mint's sweep closes it, so this happens only while cards are on.
- A paid one is issued by the sweep within 30 s while cards are on.

**A paid pack waiting holds the shop while cards are off**: every quote answers that the card mint
is off, until cards are on again and the sweep issues it (§10.2a). The list only empties while the
card mint runs, so sales close first and cards go off **last**:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ); SNAP=/home/deploy/tcg-cards-off-$STAMP
snapc "$SNAP/before" && sudo cp -a "$ENVFILE" "$ENVFILE.bak-$STAMP" \
  && setkey NUTFT_SALES allowlist && restart || true   # 1 · no new pack is quoted; cards stay on
```

`NUTFT_SALES: set`, then `active`; on `not restarted`, run `restart` alone again in a minute. Then:

```bash
waiting   # 2 · again every few minutes, until the list is empty
```

This takes up to about 25 minutes. Do not go on while a row stands, unless the shop must stop now:
then step 3 at once, and read "after a hard off" below.

```bash
setkey NUTFT_CARDS 0 && restart && snapc "$SNAP/after" || true   # 3 · only then
diff "$SNAP/before.json" "$SNAP/after.json" || true
```

The diff shows `sales` back at `allowlist` (`27c27`) and `cards` back at `null` (`77,90c77`).
Then `sudo shred -u "$ENVFILE.bak-$STAMP"`. On `not restarted`, run step 3 again in a minute.
Anything else: stop and look at it first. The backup still holds the file as it was before F1.

The prices are a separate decision. To put them back as well, step 3 sets two more keys before its
`restart` (G's only if D set it):

```bash
setkey NUTFT_CARDS 0 && setkey NUTFT_PRICE_SCHEDULE 6300:21000,31500:420000,59775:2100000,62775:10000000 \
  && setkey G_NUTFT_PRICE_MSAT 210000 && restart && snapc "$SNAP/after" || true   # 3 · with the prices
diff "$SNAP/before.json" "$SNAP/after.json" || true
```

The diff then shows `5c5`, `9c9` and `51c51` going back too.

**After a hard off**, with a row still waiting: the list never empties while cards are off, and the
shop stays held. Turning cards on again lets the sweep finish the pack within 30 s, which is the
way out. Refunding instead costs about 9 sat to return 5 (4 sat + 0.4 % per payout, B), so the
refund costs more than the pack.

Issued cards stay in `DB` and are served again when cards are on again. While cards are off,
holders cannot move them, and `/cards` answers 404.

### F2 · The code

§9.8 with the `STAMP` from A5, and only with an empty list. The build before this release has no
`card_owner` guard: under it, any unclaimed card row can be claimed on `/nutft/booster` with its
payment hash, and a card pack someone paid for would be handed out as a booster to whoever knows
that hash. So if cards have been on, F1 comes first. Then:

```bash
waiting
ls -l /home/deploy/tcg-backups/tcg600-<the STAMP from A5>.tgz
```

`card packs waiting: []`, and the code backup from A5 is there. Then §9.8, at `"queued":0`.

Never restore a database copy because of the launch. An older `DB` reopens moved cards (§10.2a), so
treat that as an incident, not a rollback.

---

## G · Hand over to the nappelin half

Tell the coordinator:
- `$SHA` and the two digest lines;
- B's numbers and Felix's answer;
- C: the address `TRUST_PROXY` names, or that C was skipped, and that `gw-caddy`'s address is not
  pinned yet (a nappelin box change);
- D's `intended` line;
- E1 to E5.

Then #248 is merged and the website released, and E7 is the first outside check.
