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
| 2 | 0.21 MB | `art/fonts/` | Anton + Alfa Slab One, used by `600b.css` and five pages |
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

**Known limitation, unfixed:** the public table browser will still not work
cross-origin. `site/net.js` fetches `/api/tables` from the referee origin, and
`server/table.js` sends **no CORS headers at all** — no
`Access-Control-Allow-Origin` anywhere in the file. The browser blocks that
cross-origin read. Direct invite links work (they are a WebSocket, gated by
`TABLE_ORIGINS`, not by CORS); browsing the public lobby from the nsite does not.
Fixing it means adding CORS headers to the `/api/*` responses in
`server/table.js`.

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
- Topology B's cross-origin table browser is known broken (no CORS in
  `server/table.js`). Invite links should work; that is reasoning from the origin
  gate, not an observation.
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
```

`/home/deploy/tcg-env-before.txt` holds six public values (URLs and paths), no secrets.

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
curl -s -o /dev/null -w "%{http_code} play.html\n" https://tcg.nappelin.com/play.html
curl -s -o /dev/null -w "%{http_code} arena3d.js\n" https://tcg.nappelin.com/arena3d.js
curl -s -o /dev/null -w "%{http_code} three.js\n" https://tcg.nappelin.com/vendor/three.js
sudo journalctl -u tcg-table -n 20 --no-pager
```

Stop and roll back if `diff` prints anything, if either `catalog_uri` differs from 9.2, or if
the service is not active. `arena3d.js` and `vendor/three.js` answering 200 prove the new
site is served. Then open `https://tcg.nappelin.com/play.html` in a browser: a hotseat game
reaches turn 2 on the 3D table and on `?arena=dom`.

If §5a (the Hangar origin) is applied in the same window, do it after 9.7 with its own
before and after check, so each change is proven on its own.

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
