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

**`TRUST_PROXY` behind the Docker Caddy.** The referee ignores `X-Forwarded-For`
unless the TCP peer is listed in `TRUST_PROXY`, and even then it takes only the
rightmost hop, the address that proxy itself saw. `gw-caddy` reaches the referee
from one container address, so until that address is listed every player shares
each per-client budget (the pre-auth socket budget and the mint budgets, §5) and
a launch rush locks people out. Find it on the box with the site open in a
browser: `sudo ss -tnp '( sport = :8777 )'` lists the connections to the referee,
and the peer address without its port is Caddy. List it in both spellings,
`TRUST_PROXY=<peer>,::ffff:<peer>`: Node reports an IPv4 peer as `::ffff:<peer>`
on a dual-stack socket, and although the referee now matches either form, older
builds compared the strings exactly. Then verify from outside with
`curl https://<host>/api/health`: `client` must be your own public address, and
the container address means the list does not match yet. Recreating the
container (a new `gw-caddy`, not a restart) can give it a different address and
pool everyone again, so repeat the check after every recreate. While the list is
wrong, the `rate limited:` lines in `journalctl -u tcg-table` name the container
address instead of players' addresses. **Do not let the rate limits reach paying
buyers until `/api/health` shows `client` as the caller's own address.**

---

## 5 · Environment variables

Read at startup in `server/table.js` (bottom of file). The referee binds
`0.0.0.0`.

| Variable | Default | What it does |
|---|---|---|
| **`PUBLIC_URL`** | *(none)* | **The one that matters.** Full `wss://host/ws` used in invite links. Must be `ws://` or `wss://` or startup throws. Its host is added to the trusted-host set. |
| `PORT` | `8777` | Listen port. The referee always binds `0.0.0.0`, so nothing in the process keeps this port private: the host firewall (ufw on the box) or the proxy's network must stop the internet reaching it. |
| `DB` | `server/matches.db` | SQLite match state. Put it on a **persistent volume**; it holds live match state and seat tokens. |
| `TABLE_ORIGINS` | *(empty)* | Comma-separated origins allowed to open a WebSocket. Same-host is always allowed; anything cross-origin must be listed here. |
| `PUBLIC_HOST` | `localhost` | Host for invite links when `PUBLIC_URL` is unset. LAN/Tailscale only — it cannot express scheme or port. |
| `PUBLIC_SCHEME` | `ws` | `wss` to force TLS in derived links. Superseded by `PUBLIC_URL`. |
| `PIN_SEED` | *(none)* | Seeds every match's shuffles from this one number, so each table deals the same rehearsed opening, and anyone who knows it can rebuild both decks. **Testing only — never set in production.** |
| `RATE_MAX` | built-in | Message rate cap. Exists for headless soak runs; leave unset so the default protects the table. |
| `CONTROL_RATE_MAX` | built-in | Control-message rate cap. Same advice. |
| `MAX_PAYLOAD` | built-in | Max WebSocket frame size. Same advice. |
| `TRUST_PROXY` | *(none)* | Proxies whose `X-Forwarded-For` is believed: `loopback`, or a comma-separated list of peer IPs (any spelling; an IPv4 entry also matches its `::ffff:` form). Behind Docker Caddy it must name the Caddy container (§4); unset, everyone behind the proxy shares every per-client budget. Every per-client budget counts an IPv6 client by its `/64`. |
| `MINT_WRITE_RATE_MAX` | `20` | Spending writes per client per minute, shared by the E1 and G mints: every mint `POST` except restore and checkstate (purchase, booster, trade, possession). A positive integer, or startup throws. |
| `MINT_RECOVERY_RATE_MAX` | `240` | The same for restore and checkstate, which a wallet uses to read its own cards back: a phrase recovery and every wallet view. Kept apart so recovery can neither starve purchases nor be starved by them. |
| `MINT_QUOTE_RATE_MAX` | `60` | The same for the mint `GET`s that do work: quote, reveal, eligibility and the LNURL callback. Info, keys, catalog, blob, state and supply are never limited. |

### The mint budgets

Both mints share one policy, checked before either mint does any work. A client,
as `/api/health` reports it in `client`, spends from a bucket of
`MINT_WRITE_RATE_MAX` writes that refills continuously over a minute (at the
default, one write back every 3 s), and likewise for `MINT_RECOVERY_RATE_MAX`
and `MINT_QUOTE_RATE_MAX`. A refusal is `429` with
`{"error":"rate limited","retry_after":<seconds>}` and a matching `Retry-After`
header. The first refusal a client earns on any limit, socket or mint, writes one
line such as `[table] rate limited: mint-recovery for 203.0.113.9 (240 per 60s)`;
further refusals from that client stay quiet for a minute.

The wallet treats a `429`, any `5xx` (whatever its body) or a dropped connection as
"not now", never as "no": a pending booster claim, purchase or transfer is kept and
sent again, and a phrase recovery waits for `Retry-After` (never more than 30 s per
wait, at most eight tries per request) and carries on. Only a `4xx` other than
`429` ends an operation, and the mint answers a storage failure with `500`, never a
`4xx`. A recovery stopped part-way keeps the cards it found and resumes from its
last batch, and it keeps scanning until 2N + 100 slots in a row are unsigned (N is
the catalog size), so cards beyond a slot an older wallet abandoned still come back.

`MINT_RECOVERY_RATE_MAX` comes from measuring the real wallet's NUT-13 seed scan,
which walks counters a hundred at a time: one restore per hundred, plus a
checkstate wherever it finds cards. Each measurement recovered E1 and then G from
one client against the referee at its default budget, so both scans drew on one
bucket, and the request timeline was replayed through that bucket to find the
smallest budget that refuses nothing:

| Wallet | Recovery requests (restore + checkstate) | Took | Busiest minute | `429`s seen | Smallest budget with no `429`, at that pace / twice as fast |
|---|---|---|---|---|---|
| One 15-card pack | 46 (34 + 12) | about 25 s | 46 | 0 | — |
| 5 E1 boosters and a G starter set, 157 cards | 273 (E1 131 + 54, G 53 + 35) | 2.1 min | 137 | 0 | 89 / 134 |
| Full-collection size: 20 E1 boosters and 2 G sets, 464 cards | 890 (E1 500 + 219, G 99 + 72) | 6.5 min | 160 | 0 | 120 / 210 |

At 240 neither recovery meets a single `429`, at the measured pace or twice it; a
faster client meets short waits and still finishes. The same ceiling holds one
scripted client to four requests a second, which at the mint's largest requests
(500-output restores) cost about a quarter of a core on the measuring machine.

**Restore support: a recovery that finds fewer cards than the holder expects.** A
wallet from before 2026-09-15 that lost a purchase or a move to an error kept that
operation's counter slots unsigned, and a normal recovery stops at such a run, so
every card bought after it is missing. Ask the holder to tick "Search further" on
wallet.html and press "Recover cards" again with the same phrase (in code:
`restoreSeed(mint, phrase, { gapSlots: NutFTWallet.DEEP_SCAN_SLOTS })`). It continues
from where the earlier recovery stopped, keeps every card already held, and stops
only after 25,000 unsigned slots in a row: about 250 extra restore requests, a few
minutes, inside the recovery budget. A resumed deep scan stays deep. Received cards
the phrase cannot find yet are a separate case: the wallet page shows them as "not
yet under your phrase" and retries moving them on every refresh.

**Many wallets on one address share every budget.** A venue wifi or a carrier NAT
is one client, and so is everyone behind the proxy while `TRUST_PROXY` is wrong.
Nothing is lost, since the wallet waits, but a room recovering or buying at once
slows itself down; raise the budgets before an in-person launch.

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
