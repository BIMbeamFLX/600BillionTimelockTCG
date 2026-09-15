# Deploy

How the 600B Timelock TCG goes public, what the referee needs in production, and
what has actually been tested.

> **Status: none of this has been executed end to end.** The publish script has
> been run and verified locally (it builds `dist/` and resolves every referenced
> asset). Everything downstream of that — the `nsyte deploy`, the reverse proxy,
> the production referee, the cross-origin table — has **never been deployed or
> externally tested**. Steps below marked **UNTESTED** are written from the code
> and from recorded notes, not from a live run. Treat the first deploy as the
> test.

---

## 1 · What actually has to be served

Two different things, and they are easy to conflate:

| Thing | Serves | Needed for |
|---|---|---|
| **The static site** | HTML, CSS, JS, art | Hotseat play, NPC play, cards, rules, shop, deckbuilder |
| **The referee** (`server/table.js`) | `/ws`, `/api/*` | Online play against another human |

A purely static deploy has **no `/ws` and no `/api/*`**. See §6 — this is the
single most important thing to understand before publishing.

### The publish set

The pages live in `site/` but reference art as `../art/...`. The referee serves
`site/` at `/` and mounts `art/`, `cards/` and `rules/` at the origin root, so a
browser clamps the leading `..` and `../art/brand/x.png` resolves to
`/art/brand/x.png`. A static deploy has to reproduce that layout: **pages at the
root, `art/` beside them.**

`scripts/publish_site.py` builds exactly that:

```bash
python scripts/publish_site.py
```

It copies **only git-tracked files**. That is the whole safety mechanism: the
working-tree `art/` is roughly 2.8 GB of renders, references, video intros and
world-plate originals, while the git-tracked `art/` is about 62 MB and the
referenced subset is about 20 MB. Anything not committed cannot be published by
accident.

The set as last built was **58 files, 7.76 MB**. The script prints the current
manifest on every run; treat that as authoritative, since sizes move as art is
re-optimised (the world plates alone went from 14.27 MB to 1.13 MB during the
session this document was written).

| Files | Size | Path | Why |
|---|---|---|---|
| 26 | 1.64 MB | `/` | every tracked file in `site/` |
| 1 | 0.06 MB | `art/brand/` | the logo in every page's nav and favicon |
| 5 | 0.19 MB | `art/fonts/` | Anton for the 600 Billion headlines, plus (from PR #70) Josefin Sans and IBM Plex Mono in four `.woff2` files for the Hypershell chrome, byte-identical with nappelin's. Alfa Slab One is no longer referenced by a page and stays out of the set. |
| 5 | 0.00 MB | `art/resources/` | the five affinity pips, built by concatenation |
| 6 | 0.69 MB | `art/rulebook/` | the six rulebook banners |
| 5 | 1.13 MB | `art/world-plates/` | board and page backgrounds (`neutral.png` is unreferenced and excluded) |
| 1 | 2.47 MB | `art/cards/` | the iconic-six contact sheet |
| 12 | 1.55 MB | `art/cards/node-runner-web/` | the card faces hardcoded as plain `<img src>` |

Those last 12 matter. Most card art is resolved from Blossom by `site/faces.js`
and needs no local copy, but `site/index.html` hardcodes eleven faces as
percent-encoded relative paths (the hero fan at lines 250–254, the teaser row at
348–353) plus the card back at line 476. Those bypass Blossom entirely and would
404 on a publish set of `site/` alone. The script finds them by scanning, so
they cannot be forgotten again.

To also ship the other 285 faces as an offline fallback for all three Blossom
mirrors being unreachable:

```bash
python scripts/publish_site.py --with-card-faces   # 343 files, 46.12 MB
```

Not the default. The mirrors are verified working with
`access-control-allow-origin: *`, and the extra 39 MB buys only a
triple-mirror-failure fallback.

### The script refuses rather than shipping a broken site

If a referenced asset is untracked or missing, it lists every failure and writes
nothing. It also refuses when a page builds an asset path at runtime — string
concatenation or a `${}` template literal — unless that directory prefix is
declared in `DYNAMIC_ASSETS` with the glob it can produce. **A new concatenation
site is a hard error, not a silent 404.** There are two declared today:
`../art/resources/` (affinity pips) and `../art/cards/node-runner-web/` (faces).

`--check` resolves and reports without writing. `--verbose` logs resolution.
Reruns rebuild from scratch, so the result is identical every time.

`dist/` is already in `.gitignore` (line 4).

---

## 2 · Topology A — the referee serves everything (recommended)

One origin, no CORS, no cross-origin anything, and online play works out of the
box. The referee already serves the site: `site/` at `/`, plus `art/`, `cards/`
and `rules/` from the repo root, with a traversal guard.

Deploy the **repo checkout** (a plain `git clone` is exactly the tracked 62 MB —
you do not need `dist/` for this topology), then:

```bash
npm ci --omit=dev
PORT=8777 PUBLIC_URL=wss://play.example.com/ws node server/table.js
```

Put a TLS reverse proxy in front (§4). This is the only topology in which the
public table browser and invite links work with no extra steps.

---

## 3 · Topology B — static nsite + a separate referee (UNTESTED)

Publish `dist/` to nsite and run the referee somewhere else. Read §6 first: this
does **not** give you working online play by default.

### Deploy with nsyte

`~/.deno/bin` is not on PATH on the Windows box:

```bash
export PATH="$PATH:/c/Users/FLX/.deno/bin"
nsyte --version || deno install -A -f -g -n nsyte jsr:@nsyte/cli
```

```bash
python scripts/publish_site.py
MSYS_NO_PATHCONV=1 timeout 180 nsyte deploy ./dist --sec "$(cat /c/Users/FLX/.nsite-identity/master.key)" -i --sync
```

**Key handling is yours, not the agent's.** Run the deploy yourself; nothing in
this repo reads, stores or prints an nsec.

Notes, all from recorded live runs on this machine:

- `-i` means **non-interactive**, not interactive.
- `--sync` uploads only missing blobs and forces the manifest through. Without
  it, a zero-change redeploy **exits as an error without republishing**.
- `MSYS_NO_PATHCONV=1` matters if you pass `--fallback` on the command line —
  Git Bash rewrites `/index.html` into a Windows path and nsyte only *warns*.
  This repo sets `"fallback": "/index.html"` in `.nsite/config.json` instead, so
  the flag is unnecessary and the trap is avoided.
- The process can hang after a successful deploy on a slow relay. That is why
  `timeout`. Verify with curl rather than trusting the exit code.
- The gateway caches an existing path for a while after redeploy. Verify with a
  content marker, not just HTTP 200.
- `nsite.run` 404s packed named-site labels; **nsite.lol** is the gateway that
  resolves them.

### Config

`.nsite/config.json` pins relays, Blossom servers, the fallback and the site
identity. **The publish directory cannot be pinned there** — the nsyte config
schema has no such key (verified against `https://nsyte.run/schemas/config.schema.json`,
which has no `publishDir`/`directory`/`outputDir`, and no scan-level setting
either). The directory is a CLI argument, so the pinning is: the script builds
`dist/`, this document says deploy `dist/`, and `.nsyte-ignore` blunts the damage
if someone deploys the repo root instead.

`"id": "600b"` makes this a **named site**. Two consequences:

1. It determines the public URL. Change it before the first deploy if you want a
   different name; changing it afterwards changes the URL. Site names must be
   **≤ 12 characters** — the gateway packs pubkey+name into one DNS label.
2. Without it, a deploy under the master key would publish a **root site** and
   overwrite the hub at `npub1tmse…nsite.lol`. Keep it set.

### The manifest.json secrets-scan false positive

`art/cards/node-runner-web/manifest.json` holds 297 SHA-256 fields. The nsyte
secrets scanner reads them as "297 potential private keys" and aborts a
non-interactive deploy. **A root `.nsyte-ignore` did not suppress it** (observed
live, 2026-08-09; the workaround at the time was moving the file aside and
restoring it after).

Publishing from `dist/` removes the problem instead of working around it: the
script excludes `manifest.json` by name wherever it appears, so the file is never
in the deploy directory and the finding cannot occur. Exclusion by construction,
not by rule. `.nsyte-ignore` still lists it as a belt-and-braces measure, but it
is not what makes this work — and **never** reach for `--skip-secrets-scan`.

---

## 4 · Reverse proxy requirements

The referee is plain `http.createServer` with a `ws` server mounted at `/ws`. It
speaks **no TLS** and sets **no CORS headers**, so a proxy has to.

- **`/ws` must be upgraded**, not proxied as ordinary HTTP. Without
  `Upgrade`/`Connection` passthrough the handshake fails and online play is dead.
- **`/api/*` must be proxied** to the same origin the page came from
  (`/api/health`, `/api/tables`, `/api/match/:id`).
- Disable proxy buffering and set a **long read timeout** on `/ws`. A 60 s
  default will cut idle tables.
- Terminate TLS at the proxy and set `PUBLIC_URL=wss://…` (§5).

nginx sketch — **UNTESTED**, no deployment has run it:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8777;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}

location /api/ {
    proxy_pass http://127.0.0.1:8777;
    proxy_set_header Host $host;
}
```

`X-Forwarded-For` is deliberately **not** trusted by the referee — it treats the
TCP peer as authoritative. Do not assume forwarded headers reach rate limiting.

---

## 5 · Environment variables

Read at startup in `server/table.js` (bottom of file). The referee binds
`0.0.0.0`.

| Variable | Default | What it does |
|---|---|---|
| **`PUBLIC_URL`** | *(none)* | **The one that matters.** Full `wss://host/ws` used in invite links. Must be `ws://` or `wss://` or startup throws. Its host is added to the trusted-host set. |
| `PORT` | `8777` | Listen port. Behind a proxy, keep it on loopback. |
| `DB` | `server/matches.db` | SQLite match state. Put it on a **persistent volume**; it holds live match state and seat tokens. |
| `TABLE_ORIGINS` | *(empty)* | Comma-separated origins allowed to open a WebSocket. Same-host is always allowed; anything cross-origin must be listed here. |
| `PUBLIC_HOST` | `localhost` | Host for invite links when `PUBLIC_URL` is unset. LAN/Tailscale only — it cannot express scheme or port. |
| `PUBLIC_SCHEME` | `ws` | `wss` to force TLS in derived links. Superseded by `PUBLIC_URL`. |
| `PIN_SEED` | *(none)* | Deterministic table PINs. **Testing only — never set in production.** |
| `RATE_MAX` | built-in | Message rate cap. Exists for headless soak runs; leave unset so the default protects the table. |
| `CONTROL_RATE_MAX` | built-in | Control-message rate cap. Same advice. |
| `MAX_PAYLOAD` | built-in | Max WebSocket frame size. Same advice. |

### Why `PUBLIC_URL` is the one that matters

If it is unset, invite links are built as
`${PUBLIC_SCHEME}://${PUBLIC_HOST}:${boundPort}/ws`. Behind TLS that produces
`ws://host:8777/ws` — mixed-content-blocked by the browser *and* aimed at a port
the internet cannot reach. Nothing errors; invites simply never connect. **Scheme
and port are deployment facts, so a deployment must state them.** Set
`PUBLIC_URL=wss://your.host/ws` and both stop being guesses.

Every variable, and what changing it later does to cards already issued: [§10](#10--appendix-every-environment-variable).

---

## 6 · How the static site and the referee fit together

**Be blunt about this: a static-only deploy is hotseat and NPC only.**

`site/net.js` picks the referee in this order (`tableUrl()`, ~line 261):

1. an explicit `?table=` parameter,
2. the table the player was last seated at,
3. **the origin that served the page** — `wss://<that origin>/ws`.

On an nsite gateway, step 3 resolves to `wss://<label>.nsite.lol/ws`, which does
not exist. A player landing on the static site with no `?table=` and no saved
match gets no socket. Hotseat and NPC play work fine — they never open one.

To make online play work from a static deploy you need **all** of:

1. A referee reachable over `wss://` (Topology A machine, or any host with §4's
   proxy).
2. `TABLE_ORIGINS=https://<label>.nsite.lol` on the referee — the WebSocket
   origin gate allows same-host or an explicitly listed origin, nothing else.
3. Players arriving via a link carrying `?table=wss://your.referee/ws`. Invite
   links already carry it, which is why `PUBLIC_URL` has to be right.

**The public table browser works cross-origin only from a listed origin.**
`site/net.js` fetches `/api/tables` from the referee origin, and `server/table.js`
answers every JSON response with `Access-Control-Allow-Origin` for exactly the
origins in `TABLE_ORIGINS` (`corsHeaders()`, `GET, OPTIONS`). An nsite gateway
origin that is not listed gets no CORS header and the browser blocks the read;
direct invite links still work there, because they are a WebSocket gated by the
same list. So add the nsite's origin to `TABLE_ORIGINS` as well, not only for the
socket.

Given that, **Topology A is the recommended launch path.** Use nsite as a
censorship-resistant mirror for the single-player and reference surfaces, and
point online play at the referee origin.

### A second, unresolved risk for the nsite path

nsite stores every file as its own Blossom blob and gateways inherit the
content-type from whichever server answers. Recorded live: `blossom.primal.net`
served `.css` and `.js` as `text/plain`, the browser refused both, and the page
rendered as unstyled text. The standing workaround is to deploy a **single
inlined `index.html`**.

**This site cannot do that** — it is 26 HTML/JS/CSS files plus art, including
multi-hundred-KB `engine.js` and `play-data.js`, and inlining would collapse
distinct pages into one. So the multi-file MIME risk is **live and unmitigated**
for Topology B. The 297 card-face `.webp` uploads on 2026-08-09 worked, but
images are sniffed by browsers where stylesheets in standards mode are not.
**Verify CSS actually applies on the gateway before announcing an nsite URL.**
Topology A does not have this problem: the referee sets correct MIME types
itself.

---

## 7 · Pre-flight checklist

Build:

- [ ] `python scripts/publish_site.py` exits 0 and reports "Every referenced asset resolved"
- [ ] File count and total size look sane (58 files / ~8 MB, or 343 / ~46 MB with faces)
- [ ] `dist/index.html` exists at the root of `dist/`, and `dist/art/` sits beside it
- [ ] `dist/` contains **no** `manifest.json`: `find dist -name manifest.json` is empty
- [ ] `ruff check scripts/publish_site.py && ruff format --check scripts/publish_site.py`
- [ ] **`uv run python scripts/check_blobs.py` exits 0.** Every card face the site
      asks for by SHA-256 is actually retrievable from a Blossom mirror. This
      cannot be eyeballed locally: `site/faces.js` falls back to the repo file,
      so an unpublished face looks perfect on your machine and renders as a card
      back on the deployed origin — and the default publish set does not ship the
      297 local faces, so there is nothing to fall back to there. Re-render a
      card and you change its hash; that new blob must be uploaded before deploy.

Referee:

- [ ] `PUBLIC_URL=wss://<public host>/ws` is set — **not** `PUBLIC_HOST` alone
- [ ] **`DB` points at a FRESH, EMPTY file.** Not the development database, and not
      a copy of it. `server/matches.db-wal` was committed in `2fec8f1`, which is on
      the public remote, and that blob contains `config_json` for matches still
      marked `playing` — the hidden seeds, which generate both decklists, both
      shuffles and every future draw. Anyone with a clone can reconstruct those
      opponents' hands. The seeds are worthless the moment production starts on a
      database that does not contain those matches, and worth real money if it
      does. (The leaked seat tokens are separately contained: `handleResume`
      refuses a token whose NIP-07 identity does not own the seat.)
- [ ] `DB` points at a persistent volume, and it is backed up
- [ ] `PIN_SEED` is **unset**
- [ ] `RATE_MAX`, `CONTROL_RATE_MAX`, `MAX_PAYLOAD` are unset (defaults protect the table)
- [ ] `TABLE_ORIGINS` lists every origin that will serve the pages, if not same-host
- [ ] `npm ci --omit=dev` has run and `server/matches.db*` are not in the image

Proxy:

- [ ] `/ws` upgrades: `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://host/ws` returns 101, not 200/400
- [ ] `/api/health` answers through the proxy
- [ ] TLS certificate valid; page loads over `https://` with no mixed-content warnings
- [ ] Read timeout on `/ws` is minutes, not seconds

Smoke test:

- [ ] Landing page: logo, hero card fan, and teaser row all render (these are the hardcoded faces)
- [ ] Fonts applied — headings are Anton, not a fallback serif
- [ ] `play.html` board background renders (world plate) and resource pips show
- [ ] `rules.html` banners load
- [ ] Hotseat game reaches turn 2
- [ ] Two browsers join one table via an invite link and both see the same state
- [ ] Browser console is free of 404s — the whole point of the publish set

---

## 8 · What is known-unknown

- **Nothing here has been deployed.** Only the publish script has been run.
- The nginx config is a sketch; no proxy has been stood up.
- Topology B's cross-origin table browser needs the nsite origin in `TABLE_ORIGINS`
  (§6); with it, `/api/tables` carries the CORS header. Neither that nor the invite
  links have been observed on a real nsite gateway; both are reasoning from the code.
- The multi-file MIME risk on nsite gateways is unmitigated and untested for this
  site (§6).
- No load testing. No estimate of concurrent tables one referee sustains.
- `server/matches.db` and its WAL/SHM sidecars were committed once before. They
  are gitignored now and untracked, but confirm they are absent from any
  production image.

---

## 9 · Alpha code deploy: new site and referee, never a new unit

Production on the box (`tcg.nappelin.com`, systemd `tcg-table`, webroot
`/home/deploy/bimCVP/infra/site-root/tcg600`) ran the build from 2026-08-20 when this was
written. Deploying TCG `main` for the alpha replaces **code and site files only**. The unit
and its environment stay exactly as they are on the box.

Why so strict:

- The workshop copy of the unit (`G:\projekte\HetzerDeploy\deploy\tcg-table.service`) is
  not the box's unit (nappelin.com `deploy/EDGE-PROTECTION.md` A7/K5). Copying it can change
  `PUBLIC_URL`, `TABLE_ORIGINS` or the mint settings the box runs with.
- `NUTFT_CATALOG_URI` (and `G_NUTFT_CATALOG_URI`) is hashed into every card's
  `asset_binding` for good. A different value after a restart damages card provenance, and
  no backup repairs cards already handed out.
- `deploy-tcg.ps1 -Install` runs `deploy/install-tcg.sh` on the box, and that script
  **installs the uploaded unit file over `/etc/systemd/system/tcg-table.service`**. This deploy
  never passes `-Install`, never runs `install-tcg.sh`, and does not upload either file. Both
  live in the HetzerDeploy workshop, not in this repository.
- `deploy-tcg.ps1` copies from a **working tree** (`robocopy /MIR`), so untracked, ignored or
  modified files ship with it. The release is therefore staged from a clean clone at the
  exact commit.
- `deploy-tcg.ps1` uploads with a password login (`PubkeyAuthentication=no`). The box uses the
  YubiKey key (`id_ed25519_sk`), so the upload here is a single `scp` with that key.
- **`tcg.nappelin.com` must stay the only public hostname for the production shop.** The shop
  and wallet take the page's origin as the mint's identity (`site/shop.js`, `site/wallet.html`),
  so a second hostname serving the same referee (an alias, a mirror, the bare IP) would give the
  same cards a second mint identity in every wallet that opened it there.

Run everything in a visible window, one SSH session at a time. The referee is stopped for
a few minutes (9.4 to 9.6).

### 9.1 · On Windows: one clean release at one commit

Find any asset the site may need that git does not carry, in exactly the paths the payload
takes from the repository:

```powershell
git -C G:\Github\TCG600nap status --porcelain --untracked-files=all --ignored -- `
  site cards rules art/brand art/fonts art/resources art/rulebook art/site art/world-plates `
  art/cards/node-runner-web art/cards/promos server package.json package-lock.json
```

Expected hits, all local-only: `site/fast-faces.js`, `art/world-plates/original/`,
`server/matches.db*`. Any other `??` or `!!` line is an asset outside git: commit it, or stop.

Then clone the commit into a release directory and test it there:

```powershell
$SHA = git -C G:\Github\TCG600nap rev-parse origin/main
$REL = "G:\projekte\tcg-release-$($SHA.Substring(0,12))"
git clone --no-local G:\Github\TCG600nap $REL
git -C $REL checkout --detach $SHA
cd $REL
npm ci
npm run test:js
uv run --frozen pytest -q
```

Write `$SHA` down; it names this release. The JS suite must be green. In a clean clone the
Python tests that read gitignored `art/**/manifest.json` files cannot pass; every other
Python test must.

Then write down the two card-set digests of this commit, still in `$REL`:

```powershell
node -e "const E=require('./site/engine.js'); console.log('E1.0', E.setCatalog(require('./site/play-data.js')).digest); console.log('F1.0', E.setCatalog(require('./site/play-data-fast.js'), 'F1.0').digest)"
```

A browser compares its own digest with the table's before it plays: a page or a napplet from
another commit is refused with "Card set mismatch". The referee on the box, the website it
serves and the napplet the Hangar pins must therefore all come from `$SHA`, and 9.7 checks the
box against these two lines.

### 9.2 · On the box, read only: what runs now

Print only the keys that must not change. `systemctl show -p Environment` lists the unit's
`Environment=` lines (the grep keeps it to four keys); it does not show `EnvironmentFile`
contents, which is why the running process is read as well.

```bash
systemctl show tcg-table -p EnvironmentFiles -p ExecStart -p WorkingDirectory
systemctl show tcg-table -p Environment | tr ' ' '\n' \
  | grep -E '^(Environment=)?(NUTFT_CATALOG_URI|G_NUTFT_CATALOG_URI|PUBLIC_URL|TABLE_ORIGINS)='
sudo cat /proc/$(systemctl show -p MainPID --value tcg-table)/environ | tr '\0' '\n' \
  | grep -E '^(NUTFT_CATALOG_URI|G_NUTFT_CATALOG_URI|PUBLIC_URL|TABLE_ORIGINS|DB|G_NUTFT_DB)=' \
  | tee /home/deploy/tcg-env-before.txt
curl -s https://tcg.nappelin.com/api/health
curl -s https://tcg.nappelin.com/v1/info | grep -o '"catalog_uri":"[^"]*"'
curl -s https://tcg.nappelin.com/g/v1/info | grep -o '"catalog_uri":"[^"]*"'
sudo journalctl -u tcg-table --no-pager | grep ' · catalog ' | tail -1
```

`/home/deploy/tcg-env-before.txt` holds six public values (URLs and paths), no secrets. The
journal line shows the card-set digest the running build loaded; 9.7 compares the new one.

### 9.3 · On Windows: stage the payload without the unit

```powershell
cd G:\projekte\HetzerDeploy
.\deploy-tcg.ps1 -StageOnly -RepoDir $REL
Remove-Item -Recurse -Force .\site\tcg600\deploy
Get-ChildItem .\site\tcg600 | Select-Object Name
```

The staged payload is site, cards, rules, the shipped `art/` folders, `server/*.js`,
`package.json` and `package-lock.json`, taken from the clean clone. Removing `deploy\` keeps the
unit and the installer on this machine.

### 9.4 · On the box: stop, then back up both databases

Stop only when nobody is waiting in quick match (`"queued":0`). Matches, seats and decks
survive: they reload from `DB` on start, and open pages reconnect and resume with their seat
tokens.

```bash
curl -s https://tcg.nappelin.com/api/health
sudo systemctl stop tcg-table
```

The E1 mint keeps its state in `DB`; the Edition G mint in `G_NUTFT_DB`. The paths come from
9.2, a missing file stops the step, and every copy is checked before anything continues.

```bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUPS=/home/deploy/tcg-backups
mkdir -p "$BACKUPS"
tar -C /home/deploy/bimCVP/infra/site-root --exclude='tcg600/node_modules' \
  -czf "$BACKUPS/tcg600-$STAMP.tgz" tcg600
for KEY in DB G_NUTFT_DB; do
  DBFILE=$(grep -E "^$KEY=" /home/deploy/tcg-env-before.txt | cut -d= -f2-)
  [ -n "$DBFILE" ] || { echo "no $KEY in tcg-env-before.txt"; exit 1; }
  [ -f "$DBFILE" ] || { echo "missing database $DBFILE"; exit 1; }
  OUT="$BACKUPS/$(basename "$DBFILE" .db)-$STAMP.db"
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    new DatabaseSync(process.argv[1]).prepare("VACUUM INTO ?").run(process.argv[2]);
    const check = new DatabaseSync(process.argv[2]).prepare("PRAGMA integrity_check").get();
    const verdict = Object.values(check)[0];
    if (verdict !== "ok") { console.error("integrity_check:", verdict); process.exit(1); }
    console.log("ok", process.argv[2]);
  ' "$DBFILE" "$OUT"
done
ls -la "$BACKUPS" | tail -5
echo "STAMP=$STAMP"
```

Write `STAMP` down; the rollback names it. The node form needs no `sqlite3` CLI; the box
already runs Node 22.5 or newer for `node:sqlite`.

### 9.5 · On Windows: upload with the key

```powershell
scp -i $HOME\.ssh\id_ed25519_sk -o IdentitiesOnly=yes -r `
  G:\projekte\HetzerDeploy\site\tcg600\* `
  deploy@178.105.93.78:/home/deploy/bimCVP/infra/site-root/tcg600/
```

One touch. The upload overwrites and adds files; it deletes nothing.

### 9.6 · On the box: dependencies and start

```bash
cd /home/deploy/bimCVP/infra/site-root/tcg600
[ -f deploy/install-tcg.sh ] && mv deploy/install-tcg.sh deploy/install-tcg.sh.do-not-run
npm ci --omit=dev
sudo systemctl start tcg-table
systemctl is-active tcg-table
```

The rename fences an installer left from an earlier deploy. No `daemon-reload`: the unit did
not change.

### 9.7 · On the box: prove nothing but the code changed

```bash
sudo cat /proc/$(systemctl show -p MainPID --value tcg-table)/environ | tr '\0' '\n' \
  | grep -E '^(NUTFT_CATALOG_URI|G_NUTFT_CATALOG_URI|PUBLIC_URL|TABLE_ORIGINS|DB|G_NUTFT_DB)=' \
  > /home/deploy/tcg-env-after.txt
diff /home/deploy/tcg-env-before.txt /home/deploy/tcg-env-after.txt && echo "environment unchanged"
curl -s https://tcg.nappelin.com/api/health
curl -s https://tcg.nappelin.com/v1/info | grep -o '"catalog_uri":"[^"]*"'
curl -s https://tcg.nappelin.com/g/v1/info | grep -o '"catalog_uri":"[^"]*"'
curl -s https://tcg.nappelin.com/v1/info | grep -o '"9":{"supported":true}'
curl -s https://tcg.nappelin.com/g/v1/info | grep -o '"9":{"supported":true}'
curl -s -o /dev/null -w "%{http_code} play.html\n" https://tcg.nappelin.com/play.html
curl -s -o /dev/null -w "%{http_code} arena3d.js\n" https://tcg.nappelin.com/arena3d.js
curl -s -o /dev/null -w "%{http_code} three.js\n" https://tcg.nappelin.com/vendor/three.js
curl -s -o /dev/null -w "%{http_code} %{content_type} rail.js\n" https://tcg.nappelin.com/rail.js
for FONT in josefin-sans-var plex-mono-400 plex-mono-500 plex-mono-600; do
  curl -s -o /dev/null -w "%{http_code} %{content_type} $FONT.woff2\n" \
    "https://tcg.nappelin.com/art/fonts/$FONT.woff2"
done
sudo journalctl -u tcg-table -n 20 --no-pager
cd /home/deploy/bimCVP/infra/site-root/tcg600
node -e "const E=require('./site/engine.js'); console.log('E1.0', E.setCatalog(require('./site/play-data.js')).digest); console.log('F1.0', E.setCatalog(require('./site/play-data-fast.js'), 'F1.0').digest)"
```

Stop and roll back if `diff` prints anything, if either `catalog_uri` differs from 9.2, or if
the service is not active. Both mints must print `"9":{"supported":true}`: the card wallet (on
the website and in the Hangar's collection) refuses every snapshot, receive, trade and restore
at a mint that does not advertise NUT-09, and the 2026-08-20 build did not. A G mint that is
switched off prints nothing for its two lines; that is expected only when `G_NUTFT_ENABLED` is
unset in 9.2's before-file. `arena3d.js` and `vendor/three.js` answering 200 prove the new
site is served. `rail.js` must answer `200 text/javascript` and each font `200 font/woff2`: a
404 there leaves every page without its side bar or in fallback type, and nothing else would
show it.

The last command must print the same two digests as 9.1: the files on the box are the
release. The journal's start line, `[table] db … · catalog 295 cards sha256:…`, must show the
same `E1.0` digest: the running process loaded them. A different digest means the upload did
not replace every file or the service did not restart; stop and roll back.

Then open `https://tcg.nappelin.com/play.html` in a browser: a hotseat game reaches turn 2 on
the 3D table and on `?arena=dom`.

If §5a (the Hangar origin) is applied in the same window, do it after 9.7 with its own
before and after check, so each change is proven on its own.

### 9.7a · Hand the same commit to the Hangar

Send `$SHA` and the two digest lines from 9.1 to the Hangar's owner (nappelin-com-3e). They
build the napplet from a clean clone of exactly that commit and pin it; a napplet from any
other commit meets this referee with "Card set mismatch" and cannot play online. Until the new
pin is live, the Hangar keeps the previous napplet, which still plays hotseat and against the
computer but not at this table.

### 9.8 · Rollback

```bash
sudo systemctl stop tcg-table
STAMP=<the value from 9.4>
cd /home/deploy/bimCVP/infra/site-root
mv tcg600 "tcg600-failed-$(date -u +%Y%m%dT%H%M%SZ)"
tar -xzf "/home/deploy/tcg-backups/tcg600-$STAMP.tgz"
cd tcg600 && npm ci --omit=dev
sudo systemctl start tcg-table
systemctl is-active tcg-table
```

A code-only rollback is safe on the database the new code has already opened. Between the
2026-08-20 build (`bc589b0`) and `main`, `server/nutft-mint.js` only adds tables
(`nutft_buyers`, `nutft_wallet_backup_buyers`, `nutft_signatures`, `nutft_purchases`,
`nutft_supply`) and one nullable column (`nutft_invoices.buyer`); the old code writes
`nutft_invoices` with an explicit column list, and the `matches` table is unchanged. After a
rollback the old mint simply does not serve purchases, signatures and supply records the new
code wrote in between; they stay in the database for the next deploy.

**Do not restore a database copy because of the schema.** Restore one only if the new code
damaged data: a copy from 9.4 loses every match and every mint operation since then, and a
mint rolled back behind cards it already issued can issue them twice. If it is needed, stop
the service first, copy the backup over the path from 9.2 (`DB` or `G_NUTFT_DB`), remove its
`-wal` and `-shm` sidecars in the same step, and decide it with the mint's state in view.

`tcg-table-staging` (`:8778`, `tcg600-staging`, `deploy-tcg.ps1 -Staging -StageOnly`) takes the
same steps with its own paths.

---

## 10 · Appendix: every environment variable

Every name the referee, its two mints and the scripts read from the environment, checked against
the code at `253130e`. The base list is
`grep -ohE "process\.env\.[A-Z0-9_]+" server/*.js scripts/*.mjs scripts/*.cjs | sort -u` (65
names); `BLOSSOM_SECRET_KEY` comes from a PowerShell script. The referee and both mints are one
process, so 10.1 to 10.5 all live in the `tcg-table` environment and 10.6 never does. Files are in
`server/` unless a row says otherwise; `main` is the start block at the bottom of
`server/table.js`. A variable that is not set is absent from the process environment and its
default applies. A flag accepts only the values its row lists.

**Before you change any of these on the box.**

- **Eight rows are permanent.** `NUTFT_CATALOG_URI`, `G_NUTFT_CATALOG_URI`, `NUTFT_COLLECTION_ID`
  and `G_NUTFT_COLLECTION_ID` are hashed into every issued card. `NUTFT_CENSUS_PATH` and
  `G_NUTFT_CENSUS_PATH` choose the census whose `census_sha256` is signed into the catalog. Once a
  mint has booted on its database, a new value for any of these six stops the whole service at
  startup: `mint database belongs to a different NutFT census, collection, or catalog URI`. `DB`
  and `G_NUTFT_DB` name the files that hold each mint's signing keys; a new file boots without
  any error, as a new mint. While `G_NUTFT_CATALOG_URI` is unset, G uses `NUTFT_CATALOG_URI`,
  which then binds both editions.
- Read the running values with the `/proc/<pid>/environ` grep from
  [§9.2](#92--on-the-box-read-only-what-runs-now) and name only the keys you need. Never print the
  whole `EnvironmentFile`: it can hold `PHOENIXD_PASSWORD` or `LND_MACAROON`. For the permanent
  rows:

  ```bash
  sudo cat /proc/$(systemctl show -p MainPID --value tcg-table)/environ | tr '\0' '\n' \
    | grep -E '^(NUTFT_CATALOG_URI|G_NUTFT_CATALOG_URI|NUTFT_COLLECTION_ID|G_NUTFT_COLLECTION_ID|NUTFT_CENSUS_PATH|G_NUTFT_CENSUS_PATH|DB|G_NUTFT_DB)='
  ```

  A key missing from the output is unset, and its default applies.
- Change a value in the unit's `EnvironmentFile` or drop-in and apply it with a restart, as
  [§5a](#5a--alpha-let-the-nappelin-hangar-reach-the-table-and-the-mint) describes. Read §5a first.
- After the restart, check what the mints run without printing any environment. `/v1/info` and
  `/g/v1/info` report `paid`, `funding`, `sales`, `one_per_key`, `purchase_mode`, `test_mint`,
  `virtual_sats`, `catalog_uri` and `catalog_issuer` (a new issuer means a different database).
  `/nutft/state` and `/g/nutft/state` report `unit`, the collection id, and `census_sha256`.

### 10.1 · Table and network

| Name | Read by | Default | What it does | Secret? | Changing it later | Production note |
|---|---|---|---|---|---|---|
| `PORT` | `main` → `createTable`; also `scripts/local-test.mjs` `parseArgs`, after `--port` | `8777`. `0` takes a free port; a non-number stops startup (`ERR_SOCKET_BAD_PORT`). | Port of the site, `/ws`, `/api/*` and both mints. The referee always binds `0.0.0.0`; no variable changes that. | no | Restart only. The proxy upstream (§4) has to follow, and without `PUBLIC_URL` invites carry the port. | Not recorded; staging uses `8778` (§9.8). |
| `DB` | `main` → `createTable`, which also opens the E1 mint on it | `server/matches.db` inside the code directory, the one a §9.8 rollback moves aside | SQLite file for matches, seat tokens and the whole E1 mint: signing keys (`nutft_meta`), invoices, spent proofs, supply ledger and, with Cashu funding, the collected ecash. | path-to-secret: the file holds the E1 signing keys (deploy-runbook-mint.md §0) | **Permanent in effect: the file holds the E1 mint keys.** Nothing is hashed and nothing checks it: a new file boots a new E1 mint (new keyset, new `catalog_issuer`, full supply) with no matches, issued cards no longer verify there, and sold packs can be issued again. An older copy boots the mint behind its own sales (§9.8). Moving the same file is restart only. | `/home/deploy/tcg-data/matches.db`, outside the webroot (deploy-runbook-mint.md §6.3); fresh, persistent and backed up (§7, §9.4). |
| `PUBLIC_URL` | `main` → `createTable` (`publicTableUrl`, trusted hosts); `createNutftMint` while `NUTFT_PUBLIC_BASE` is unset | none. Not `ws://` or `wss://`: startup stops. | The table URL in invites, `STATE.table` and the login challenge. Its host becomes a trusted `Host`, and the mints derive their public base from it (`wss://h/ws` → `https://h`). | no | Breaks open links or clients: invites and saved tables keep the old URL, a host that leaves the trusted set gets `403 host not allowed`, the Hangar signs logins only for the table's host (§5a), and without `NUTFT_PUBLIC_BASE` the mints' NIP-98 host and LNURL links follow it. | `wss://tcg.nappelin.com/ws` (§5a); §9.2 and §9.7 check that it stays. |
| `PUBLIC_HOST` | `main` → `createTable`; set for the child by `scripts/local-test.mjs --lan` | none: invites say `localhost`. Not a plain host name: startup stops (`invalid trusted host`). | Adds a trusted `Host`; without `PUBLIC_URL` it is the host in invites. | no | Breaks open links or clients: a host that leaves the trusted set gets `403 host not allowed`. | LAN and Tailscale only; `PUBLIC_URL` supersedes it (§5). |
| `PUBLIC_SCHEME` | `main` → `createTable` (`publicTableUrl`) | `ws`; only `wss` changes anything | Scheme of the invite URL while `PUBLIC_URL` is unset. | no | Breaks open links or clients, and only without `PUBLIC_URL`. | `PUBLIC_URL` supersedes it (§5). |
| `TABLE_ORIGINS` | `main` → `createTable` (`verifyClient`, `corsHeaders`) | empty. An entry that is not an `http(s)` URL stops startup. | Comma-separated page origins, besides the table's own host, that may open `/ws` and read `/api/*` cross-origin (§5a adds the mint routes). | no | Breaks open links or clients: pages on a removed origin can no longer connect. Adding one is restart only. | Keep the box's entries and append `https://nappelin.com` (§5a). |
| `TRUST_PROXY` | `main` → `createTable` (`clientAddress`) | none: `X-Forwarded-For` is ignored | `loopback`, `1`, `true` or `yes` trust the rightmost `X-Forwarded-For` hop when the peer is 127.0.0.1 or ::1; any other value is a comma list of trusted proxy IPs. The pre-login rate budgets count by the result. | no | Restart only. | `loopback` behind the loopback proxy that `createTable` calls "the nappelin case". §4's note that forwarded headers are not trusted describes the unset default. |
| `TABLE_RULESETS` | `createTable` | `E1.0,F1.0`; unknown names are dropped | Rulesets a new table or queue entry may choose. Anything not listed opens as Classic `E1.0`, so Classic cannot be switched off. | no | Restart only; dealt matches keep their ruleset. | Not recorded. |
| `TCG_WALLET_BACKUP_ALLOWLIST` | `main` → `createTable` → `createRelayWalletAllowlist` (`relay-wallet-allowlist.js`) | none: no file is written. A relative path, a malformed line or a file that cannot be written stops startup. | File of buyer pubkeys that strfry lets publish encrypted wallet backups (kind 37378). The table adds each identified paid buyer after issuance, and at startup every buyer recorded in both mint databases. | no; it lists paying buyers' pubkeys | Restart only if the relay reads the new file: its policy reads `/etc/relay-allow/tcg-wallet-buyers` (`relay-policy-patch.js`). Unset, new buyers get no backup transport. | `/home/deploy/bimCVP/infra/relay-allow/tcg-wallet-buyers` (deploy-runbook-mint.md production note). |
| `PIN_SEED` | `main` → `createTable` (`mintGame`) | none; a non-integer is ignored | Seeds tried first for every new match, so a rehearsed opening repeats. The value is printed to the journal at startup. | no | Testing only: never in production. Every match whose decks build on the first try gets the same seeds, so the same Stack is shuffled the same way. | Unset (§7). |
| `RATE_MAX` | `main` → `createTable` (`rateOk`) | `150` accepted actions per seat per 10 s; the reject budget becomes `max(400, RATE_MAX)`. A non-integer keeps the default. | Per-seat action budget. | no | Testing only: never in production. It exists for headless soak runs (comment in `main`). | Unset (§7). |
| `CONTROL_RATE_MAX` | `main` → `createTable` (`controlOk`, `authOk`) | `30` per 10 s per address, or per key after login; the first `AUTH` gets `max(5, CONTROL_RATE_MAX)`. A non-integer keeps the default. | Budget for control and malformed messages. | no | Restart only. | Unset (§7). |
| `MAX_PAYLOAD` | `main` → `createTable` (`WebSocketServer`) | `65536` bytes; a value that is not a positive integer keeps the default | Largest WebSocket message; a larger one closes the socket with code 1009 (net-protocol.md §2.7). | no | Restart only. | Unset (§7). |

### 10.2 · E1 mint (`NUTFT_*`)

The Edition One mint is `createNutftMint` in `nutft-mint.js`, opened by `createTable` on `DB`. Its
funding is in §10.4 and its beacon in §10.5. *Also G* marks a value the G mint reads as well
(§10.3).

| Name | Read by | Default | What it does | Secret? | Changing it later | Production note |
|---|---|---|---|---|---|---|
| `NUTFT_CATALOG_URI` | `main` → `createNutftMint` | `http://localhost:8777/nutft/catalog`. Not an absolute `http(s)` URL: startup stops. | The catalog URL that names Edition One; every card carries it. | no | **Permanent: hashed into every issued card.** It is in each card's `asset_binding` (`reference()` → `assetBinding()`), the signed catalog (`catalogPayload()` → `signedCatalog()`), every supply snapshot and the stored `configuration`, so a new value stops the boot. Issued cards keep the old URI, and wallets fetch the catalog from it (deploy-runbook-mint.md §1). *Also G* while `G_NUTFT_CATALOG_URI` is unset. | `https://tcg.nappelin.com/nutft/catalog` (deploy-runbook-mint.md §2.2; §9.2). The code takes only `http(s)`, so the `naddr` in mint-security-and-deploy.md §1 cannot be set. |
| `NUTFT_COLLECTION_ID` | `createNutftMint`, E1 only | `600B-E1` | Edition id: the keyset unit and every card's `collection_id`. | no | **Permanent: hashed into every issued card.** It is in `asset_binding` (`reference()`), the keyset (`createNewMintKeys` unit, so the keyset id moves), the signed catalog, supply snapshots and the stored `configuration`; a new value stops the boot. | Not recorded as a setting; the napplet inventory example uses `600B-E1` (napplet-spec.md). `/nutft/state` shows it as `unit`. |
| `NUTFT_CENSUS_PATH` | `createNutftMint`, E1 only | `cards/nutft-census.json` in the deployed code. Unreadable: startup stops. | The census: cards, print runs, pools and pack shape. | no | **Permanent through the census file.** The path is not hashed, but the file's `census_sha256` is in the signed catalog (`catalogPayload()`), supply snapshots and the stored `configuration`; another census stops the boot. A byte-identical copy elsewhere is restart only. | Not recorded; the runbook ships the census with the code (deploy-runbook-mint.md §6.2). |
| `NUTFT_CATALOG_MIRRORS` | `main` → `createNutftMint` | empty. An entry that is not an absolute `http(s)` URL stops startup. | Comma-separated Blossom servers holding the signed catalog blob; `/v1/info` lists `<mirror>/<sha256>` for each. | no | Restart only; not part of the signed catalog. List only mirrors that serve the blob; `scripts/upload-catalog.mjs` prints the value. *Also G* while `G_NUTFT_CATALOG_MIRRORS` is unset. | Not recorded; the README shows `https://blossom.bimcvp.com,https://blossom.primal.net`. |
| `NUTFT_PUBLIC_BASE` | `createNutftMint` | derived from `PUBLIC_URL` (`wss://h/ws` → `https://h`), else empty. Not checked at startup. | The site's public origin: the host a NIP-98 proof must name, the LNURL-pay callback and claim link, the `mint` of possession certificates. Empty: LNURL is refused and the host is not checked. | no | Breaks open links or clients: in `allowlist` and `signed` mode a request signed for another host is refused. A value without a scheme passes startup, then quotes and eligibility checks answer `400 Invalid URL`. *Also G* while `G_NUTFT_PUBLIC_BASE` is unset. | Not recorded; unset follows `PUBLIC_URL`. |
| `NUTFT_SALES` | `createNutftMint` (`requireMayBuy`) | `open`, also for a paid mint. Another value, or `allowlist` with an empty list: startup stops. | Who may buy: `closed` nobody, `allowlist` the listed keys, `signed` any key with a NIP-98 proof, `open` anyone without a signature. LNURL-pay works only when `open`. | no | Affects sales or issuance: applies to the next quote, and on a free mint to the next claim. A paid invoice already issued stays claimable, because a paid claim is never re-checked (`signBoosterOnce`). | `allowlist` for early access; `open` only after the alpha bugs are fixed (CLAUDE.md, ADR 0002). |
| `NUTFT_ALLOWLIST` | `createNutftMint` | empty. An entry that is neither an npub nor 64 hex is skipped and printed in full to the journal. | Comma-separated early-access keys for `allowlist`. | no, but private: the mint never publishes it | Affects sales or issuance: the next quote (paid mint) or claim (free mint) uses the new list; a removed key keeps an invoice it already holds. | npubs or hex keys in the environment only, never in source, generated files or docs (CLAUDE.md, ADR 0002). |
| `NUTFT_ONE_PER_KEY` | `createNutftMint` | off; only `1` or `true`. On without `allowlist` or `signed`: startup stops. | One pack per signing key, recorded with a paid issuance. A free mint records nothing, so there the limit does not hold. | no | Affects sales or issuance: packs bought while it was off are not counted. | Unset: E1 sells repeat boosters (comment on `nutft_wallet_backup_buyers`). |
| `NUTFT_PRICE_MSAT` | `createNutftMint` | `21000` (21 sat), used while `NUTFT_PRICE_SCHEDULE` is empty. A paid mint whose price is not above 0 stops startup. | Flat booster price in millisatoshi. | no | Affects sales or issuance: from the next quote; quoted invoices keep their price. phoenixd and Cashu invoice whole sats, so a value not divisible by 1000 passes startup and every paid quote then fails. *Also G* when `G_NUTFT_PRICE_MSAT` is `0` or not a number. | Not recorded. |
| `NUTFT_PRICE_SCHEDULE` | `createNutftMint` (`parseSchedule`) | empty. A malformed entry or thresholds that do not rise stop startup. | Price ladder `packs:msat,…`: each price holds until that many packs are sold, the last one after that. | no | Affects sales or issuance: the next quote is priced by packs sold so far; quoted invoices keep their price. | Not recorded. G never inherits it. |
| `NUTFT_PURCHASE_MODE` | `main` (`enabled()`) → `createNutftMint` | off; `1`, `true`, `yes` or `on` | Committed purchases: the quote hides the cards, `POST /nutft/purchase` reserves the draw, the claim signs exactly that draw. | no | Affects sales or issuance: switched off, open purchases are stranded (their claim is refused and they are never released); switched on, invoices quoted before need a purchase before they can be claimed. | Off until the shop and the wallet pass the new path against the regtest mint (nutft-purchase-and-possession.md §2.1). |
| `NUTFT_INVOICE_TTL_SECONDS` | `createNutftMint` | `900`. Below 60 or not a number: startup stops. | How long an unpaid quote holds its pack; also the invoice expiry sent to lnd and phoenixd. | no | Affects sales or issuance: open quotes are measured against the new value from their creation. *Also G* while `G_NUTFT_INVOICE_TTL_SECONDS` is unset. | Not recorded. |
| `NUTFT_CLAIM_GRACE_SECONDS` | `createNutftMint` | `3600`. Below `NUTFT_INVOICE_TTL_SECONDS` or not a number: startup stops. | How long a paid, unclaimed booster or an open purchase stays reserved for its buyer. | no | Affects sales or issuance: applies at once, from each invoice's or purchase's creation; a shorter grace can pass a paid, unclaimed pack to the next buyer. *Also G* while `G_NUTFT_CLAIM_GRACE_SECONDS` is unset. | Not recorded. |
| `NUTFT_SUPPLY_RELAYS` | `createNutftMint` → `createSupplyLedger` (`nutft-supply.js`) | empty: nothing is published. An entry that is not `ws://` or `wss://` stops startup. | Relays that receive the signed supply snapshots. | no | Restart only. A relay added later gets only snapshots no relay has accepted yet. *Also G*: there is no G twin. | Not recorded. |
| `NUTFT_SUPPLY_INTERVAL_SECONDS` | `createNutftMint` → `createSupplyLedger` | `86400`; `0` stops the timer. A non-integer, or any other value below 60: startup stops. | How often the mint signs a snapshot when the figures moved. | no | Restart only. *Also G*: there is no G twin. | Not recorded; `0` is for tests (nutft-supply-ledger.md). |

### 10.3 · Edition G mint (`G_NUTFT_*`)

With `G_NUTFT_ENABLED` on, `createTable` opens a second `createNutftMint` from these names, under
`/g` and on its own database. All of them are read in `main`. Most of G's startup errors still name
the E1 variable (`NUTFT_…`). ADR 0003 says no G setting may fall through to E1 defaults; the Default
column marks where the code still does. `NUTFT_SUPPLY_RELAYS`, `NUTFT_SUPPLY_INTERVAL_SECONDS`,
`NUTFT_RECONCILE_MS`, `NUTFT_CASHU_MINT`, `NUTFT_TEST_MINT`, `NUTFT_MOCK_SETTLE_MS` and every
`LND_*` and `PHOENIXD_*` row apply to G as well. The starter shop sells only when G reports the
production values below (`readStarterMint` in `site/shop.js`).

| Name | Read by | Default | What it does | Secret? | Changing it later | Production note |
|---|---|---|---|---|---|---|
| `G_NUTFT_ENABLED` | `main` (`enabled()`) → `createTable` | off; `1`, `true`, `yes` or `on` | Opens the Edition G mint under `/g`. | no | Affects sales or issuance: off, every `/g/` mint route answers 404, so G wallets can neither buy nor check or trade cards there; the database is kept. | On (deploy-runbook-mint.md production note). |
| `G_NUTFT_DB` | `main` → `createTable` | none. Missing, or the same file as `DB`: startup stops. | SQLite file of the G mint: signing keys, invoices, spent proofs, one-per-key rows, supply ledger. | path-to-secret: the file holds the G signing keys | **Permanent in effect: the file holds the G mint keys.** A new file boots a new G mint with new keys and a full supply; issued G cards no longer verify there, and one-per-key starts over. An older copy boots G behind its own sales. Moving the same file is restart only. | `/home/deploy/tcg-data/g-mint.db` (deploy-runbook-mint.md production note). |
| `G_NUTFT_FUNDING` | `main` → `createTable` → `createFunding` | none: startup stops. No auto-detection. | G funding backend: `lnd`, `phoenixd`, `cashu`, `mock` or `none`. | no | Affects sales or issuance, as `NUTFT_FUNDING`. With `none` G is free and one-per-key records nothing. Any value but `phoenixd` makes the starter shop refuse to sell. | `phoenixd` (deploy-runbook-mint.md production note; `readStarterMint`). |
| `G_NUTFT_CATALOG_URI` | `main` → `createNutftMint` (G) | **unset or empty takes `NUTFT_CATALOG_URI`**, then `http://localhost:8777/nutft/catalog`, which has no `/g` | The catalog URL that names Edition G; every G card carries it. | no | **Permanent: hashed into every issued G card**, through the same `assetBinding()`, `signedCatalog()` and `configuration` as `NUTFT_CATALOG_URI`. Setting it where it was unset also changes G's identity and stops the boot. | `https://tcg.nappelin.com/g/nutft/catalog` (deploy-runbook-mint.md production note; §9.2). The starter shop requires `<site>/g/nutft/catalog`. |
| `G_NUTFT_COLLECTION_ID` | `main` → `createNutftMint` (G) | `600B-G`; never `NUTFT_COLLECTION_ID` | G edition id: keyset unit and every G card's `collection_id`. | no | **Permanent: hashed into every issued G card**, as `NUTFT_COLLECTION_ID`. | `600B-G` (deploy-runbook-mint.md production note); the starter shop requires `collectionId` from `site/g-data.js`. |
| `G_NUTFT_CENSUS_PATH` | `main` → `createNutftMint` (G) | `cards/g-census.json` in the deployed code; never `NUTFT_CENSUS_PATH` | The G census, which lists every starter set. | no | **Permanent through the census file**, as `NUTFT_CENSUS_PATH`. | Not recorded; the starter shop requires its `census_sha256` to equal `commitment` in `site/g-data.js`. |
| `G_NUTFT_CATALOG_MIRRORS` | `main` → `createNutftMint` (G) | unset takes `NUTFT_CATALOG_MIRRORS` | Blossom servers holding the G catalog blob. | no | Restart only; list only mirrors that hold the G blob (`scripts/upload-catalog.mjs <mint>/g`). | Not recorded. |
| `G_NUTFT_PUBLIC_BASE` | `main` → `createNutftMint` (G) | unset or empty takes `NUTFT_PUBLIC_BASE`, then `PUBLIC_URL` | The site origin, without `/g`, for G's NIP-98 host, LNURL links and certificates. | no | Breaks open links or clients, as `NUTFT_PUBLIC_BASE`. | Not recorded. |
| `G_NUTFT_SALES` | `main` → `createNutftMint` (G) | `closed`; never `NUTFT_SALES`. Another value: startup stops. | Who may buy a starter set; values as `NUTFT_SALES`. | no | Affects sales or issuance, as `NUTFT_SALES`. | `signed` (deploy-runbook-mint.md production note, ADR 0003). |
| `G_NUTFT_ALLOWLIST` | `main` → `createNutftMint` (G) | empty; never `NUTFT_ALLOWLIST` | Early-access keys for G in `allowlist` mode. | no, but private | Affects sales or issuance, as `NUTFT_ALLOWLIST`. | Unused while G sells `signed`; never in source or docs (ADR 0002). |
| `G_NUTFT_ONE_PER_KEY` | `main` → `createNutftMint` (G) | **on when absent.** `1`, `true`, `yes` or `on`: on; any other value, an empty `G_NUTFT_ONE_PER_KEY=` too: off. On while `G_NUTFT_SALES` is unset, `closed` or `open`: startup stops. | One starter set per signing key, recorded with a paid issuance; a free G records nothing. | no | Affects sales or issuance: off, a key can buy again, and the starter shop refuses to sell. | `1` (deploy-runbook-mint.md production note; `readStarterMint`). |
| `G_NUTFT_PRICE_MSAT` | `main` → `createNutftMint` (G) | `210000` (210 sat). **`0` or not a number takes `NUTFT_PRICE_MSAT`, then `21000`.** | Flat starter-set price in millisatoshi. | no | Affects sales or issuance: from the next quote; phoenixd needs whole sats. | `210000`, flat (deploy-runbook-mint.md production note). |
| `G_NUTFT_PRICE_SCHEDULE` | `main` → `createNutftMint` (G) | empty, meaning the flat price; never `NUTFT_PRICE_SCHEDULE` | Price ladder for G, as `NUTFT_PRICE_SCHEDULE`. | no | Affects sales or issuance, as `NUTFT_PRICE_SCHEDULE`. | Unset: a flat price and no E1 schedule (deploy-runbook-mint.md production note). |
| `G_NUTFT_PURCHASE_MODE` | `main` (`enabled()`) → `createNutftMint` (G) | off; `1`, `true`, `yes` or `on` | Committed purchases for G. | no | Affects sales or issuance, as `NUTFT_PURCHASE_MODE`. | Off until the regtest pass (nutft-purchase-and-possession.md §2.1). |
| `G_NUTFT_ALLOW_VIRTUAL` | `main` → `createNutftMint` (G) | unset; only `1`; never `NUTFT_ALLOW_VIRTUAL` | Lets G start on `G_NUTFT_FUNDING=mock`. | no | Testing only: never in production. The starter shop refuses virtual sats. | Unset. |
| `G_NUTFT_INVOICE_TTL_SECONDS` | `main` → `createNutftMint` (G) | unset, empty or `0` takes `NUTFT_INVOICE_TTL_SECONDS`, then `900` | How long an unpaid G quote holds its set. | no | Affects sales or issuance, as `NUTFT_INVOICE_TTL_SECONDS`. | Not recorded. |
| `G_NUTFT_CLAIM_GRACE_SECONDS` | `main` → `createNutftMint` (G) | unset, empty or `0` takes `NUTFT_CLAIM_GRACE_SECONDS`, then `3600` | How long a paid, unclaimed G set or an open G purchase stays reserved. | no | Affects sales or issuance, as `NUTFT_CLAIM_GRACE_SECONDS`. | Not recorded. |

### 10.4 · Lightning funding (`NUTFT_FUNDING`, `LND_*`, `PHOENIXD_*`)

`createFunding` in `funding.js` builds each mint's funding source. `NUTFT_FUNDING` and
`NUTFT_ALLOW_VIRTUAL` are E1 only; every other row here applies to both mints. Card issuance stays
on this first-party mint whatever funds it (CLAUDE.md), and production invoices belong to an
operator-controlled wallet or node, not a third-party Cashu mint (ADR 0001).

| Name | Read by | Default | What it does | Secret? | Changing it later | Production note |
|---|---|---|---|---|---|---|
| `NUTFT_FUNDING` | `createFunding`, E1 only | unset **auto-detects**: `phoenixd` if `PHOENIXD_URL` is set, else `lnd` if `LND_REST_URL` is set, else free. An unknown value stops startup. | E1 funding backend: `lnd`, `phoenixd`, `cashu`, `mock` or `none`. | no | Affects sales or issuance: `none` makes every booster free at once. A new backend cannot confirm the old one's invoices, so those buyers cannot claim, and their pack can be sold again after the quote window. While unset, adding `PHOENIXD_URL` or `LND_REST_URL` for G or the beacon turns E1 into a paid mint that sells `open` unless `NUTFT_SALES` says otherwise. | An operator-controlled node (ADR 0001); which one E1 uses is not recorded. |
| `NUTFT_ALLOW_VIRTUAL` | `createNutftMint`, E1 only | unset; only `1` | Lets E1 start on `NUTFT_FUNDING=mock`, whose invoices are fake and settle themselves. | no | Testing only: never in production. | Unset. |
| `NUTFT_MOCK_SETTLE_MS` | `createMockFunding` (`funding.js`), both mints on `mock` | `0`: a mock invoice counts as paid at once | Delay before a mock invoice counts as paid. | no | Testing only: never in production. | Unset. |
| `NUTFT_CASHU_MINT` | `createCashuFunding` (`funding-cashu.js`), both mints on `cashu` | none; required for `cashu` and must be `https://` | The Cashu mint that issues the invoices and holds the sats until they are collected into `nutft_treasury`. | no; the collected ecash in the database is | Affects sales or issuance: quotes from the old mint are no longer confirmed or collected, so their buyers cannot claim and the sats stay at the old mint. | Staging only (ADR 0001). |
| `NUTFT_TEST_MINT` | `createCashuFunding` | off; only `1` | Declares the Cashu mint a test mint: quotes and `/v1/info` carry `test_mint`, the shop labels the invoice "not real money", and the starter shop refuses a G mint that reports it. | no | Testing only: never in production. | Unset. |
| `NUTFT_RECONCILE_MS` | `createNutftMint` (sweep timer; only `cashu` funding has one) | `120000`, at least `30000`. **Not a number: the sweep runs every millisecond** (Node turns a NaN interval into 1 ms). | How often paid, unclaimed Cashu quotes are collected. | no | Restart only. | Not recorded. |
| `LND_REST_URL` | `lnd.js` `readConfig`, from `createFunding` and, in both mints, from `createNutftMint` for the beacon's chain source | none. While set, every startup reads the macaroon (and for `https` the certificate) and stops if it is missing, even when nothing uses LND. | LND REST endpoint for `lnd` funding and for the block beacon. | no | Affects sales or issuance: with `NUTFT_FUNDING` and `PHOENIXD_URL` unset, setting it makes E1 a paid `lnd` mint; removing it stops startup while `NUTFT_BEACON_SOURCE=lnd`. A different node cannot confirm the old node's invoices. | Not recorded. |
| `LND_MACAROON` | `lnd.js` `readConfig` | none; wins over `LND_MACAROON_PATH`. Not hex: startup stops. | The macaroon as hex, sent with every LND call. | **yes** | Restart only. | Prefer `LND_MACAROON_PATH`. An inline secret belongs in a `0600` file, not in the world-readable unit (mint-security-and-deploy.md §4, Path B step 3). |
| `LND_MACAROON_PATH` | `lnd.js` `readConfig` | none. `LND_REST_URL` set with neither macaroon form: startup stops. | File with the binary macaroon, read at startup. | path-to-secret | Restart only. | An invoice-only macaroon, `lncli bakemacaroon invoices:read invoices:write` (`lnd.js:16`). The beacon calls `/v1/getinfo` with the same macaroon (`beacon.js:41`); whether that scope allows it is unclear from this code. |
| `LND_TLS_CERT_PATH` | `lnd.js` `readConfig` | none. An `https` `LND_REST_URL` without it or `LND_INSECURE=1`: startup stops. | LND's `tls.cert`, pinned as the only trusted CA. | no | Restart only. | Required for a real node (`lnd.js` `readConfig` comment). |
| `LND_INSECURE` | `lnd.js` `readConfig` | off; only `1` | Accepts any certificate from LND. | no | Testing only: never in production. It exists for a local throwaway regtest node (`lnd.js`). | Unset. |
| `PHOENIXD_URL` | `phoenixd.js` `readConfig`, from `createFunding` in both mints; also `scripts/phoenixd_smoke.mjs` | none. Not an absolute `http(s)` URL: startup stops. Plain `http` to a host that is not loopback needs `PHOENIXD_ALLOW_REMOTE`. | phoenixd HTTP API for `phoenixd` funding. | no | Affects sales or issuance: with `NUTFT_FUNDING` unset, setting it makes E1 a paid `phoenixd` mint and removing it can make E1 free; a G on `phoenixd` then stops startup. A different node cannot confirm the old node's invoices. | Loopback: `scripts/phoenixd_smoke.mjs`, run on the box, uses `http://127.0.0.1:9740`. G funds through phoenixd (deploy-runbook-mint.md production note). |
| `PHOENIXD_PASSWORD` | `phoenixd.js` `readConfig` | none; wins over `PHOENIXD_PASSWORD_PATH`. `PHOENIXD_URL` set with neither: startup stops. | phoenixd HTTP password; never logged. | **yes** | Restart only. | The `http-password-limited-access` value, never `http-password` (`phoenixd.js` header). Prefer the path form, as for `LND_MACAROON`. |
| `PHOENIXD_PASSWORD_PATH` | `phoenixd.js` `readConfig` | none | File with the password, read and trimmed at startup. | path-to-secret | Restart only. | The same limited-access password. |
| `PHOENIXD_ALLOW_REMOTE` | `phoenixd.js` `readConfig` | off; `1` or `true` | Allows plain `http` to a phoenixd that is not on loopback, which sends the password in clear. | no | Restart only. | Unset; a remote phoenixd goes behind TLS or a tunnel (`phoenixd.js` header). |

### 10.5 · Beacon

Edition One only: `createTable` gives G a fixed beacon and no chain source, and G's census lists
its sets instead of drawing them.

| Name | Read by | Default | What it does | Secret? | Changing it later | Production note |
|---|---|---|---|---|---|---|
| `NUTFT_BEACON` | `createNutftMint` (`quote`, `signBoosterOnce`) | 64 zeros. Not 64 hex: startup stops. | The fixed beacon for draws while the block beacon is off; it is folded into each pack's draw state. | no; quote and purchase answers carry it | Affects sales or issuance: later packs draw different cards; issued cards are untouched. A claim built from a quote shown before the change can be refused (`CardBinding mismatch`), and its invoice stays claimable. | The fixed beacon is "fine for a free demo and disqualifying for a paid one": every pack is precomputable (`createNutftMint` comment; mint-security-and-deploy.md §1). |
| `NUTFT_BEACON_SOURCE` | `createNutftMint` | unset: the fixed beacon. Only `lnd` turns the block beacon on, and then `LND_REST_URL` is required or startup stops. | Seals each sale to a Bitcoin block above the tip; the cards resolve once that block exists. | no | Affects sales or issuance: switched off, open sealed sales resolve against the fixed beacon instead of their block; switched on, paid but unclaimed unsealed invoices cannot be claimed while it stays on (`unknown payment_hash: quote the booster first`). | Not recorded; see `NUTFT_BEACON`. |
| `NUTFT_BEACON_CONFIRMATIONS` | `beacon.js` `createBeacon` | `1`, at least 1. **Not validated:** a non-number stores no target height, and a sealed sale paid under it cannot be claimed. | How many blocks above the tip a sale commits to; used only while `NUTFT_BEACON_SOURCE=lnd`. | no | Restart only; sealed sales keep their stored height. | Not recorded. |

### 10.6 · Scripts and tools

Run by hand in a shell. None of these is ever set in the `tcg-table` environment.

| Name | Read by | Default | What it does | Secret? | Changing it later | Production note |
|---|---|---|---|---|---|---|
| `PALACE_NSEC` | `scripts/blossom-auth.mjs` `loadKey`, for `scripts/upload-catalog.mjs --go`; `scripts/upload-blobs.mjs` `loadKey`, on every run including dry runs | none: the script exits | The nostr key (nsec or hex) that signs Blossom uploads and deletes. | **yes** | Never set on the box. | Set only in the shell that runs the upload (script headers). |
| `TABLE` | `scripts/demo-two-clients.mjs` | `ws://127.0.0.1:8777/ws` | Referee socket for the two headless demo clients. | no | Never set on the box. | The referee it drives needs `RATE_MAX=100000` (net-protocol.md §7), so never the production table. |
| `BLOSSOM_SECRET_KEY` | `scripts/upload_faces.ps1`, which checks it is set; `blossom-cli` signs with it | none: the script stops | The nostr key for card-face uploads with `blossom-cli`. | **yes** | Never set on the box. | Set only in the uploading shell (script header). |

`scripts/local-test.mjs` also reads `PORT`, and `scripts/phoenixd_smoke.mjs` reads the
`PHOENIXD_*` rows through `readConfig`. `scripts/build_set.py` reads Windows' `LOCALAPPDATA` to
find Cockatrice. No other script reads the environment.

**Names in older documents that no code reads.** `NUTFT_MINT_SEED`, `NUTFT_CATALOG_KEY` and
`NUTFT_REQUIRE_PRODUCTION_KEYS` (mint-security-and-deploy.md) and `NUTFT_QUOTE_REVEALS`
(nutft-purchase-and-possession.md) do nothing when set. Each mint generates its keys once and keeps
them in its own database (`nutft_meta`: `mint_seed`, `catalog_private_key`; deploy-runbook-mint.md
§0).
