# Handoff — 2026-08-02

Demo is **Friday 2026-08-07**. Branch `feature/e1-node-runner-frame`, 24 commits
ahead of `main`, remote `origin` = github.com/BIMbeamFLX/TCG600nap.

**Working tree is clean. Nothing uncommitted, nothing stashed.**

---

## Where the demo stands

The multiplayer table works end to end and was verified in two live browser tabs
against the real referee, not just headless: create → share link → guest takes the
free seat → both reload → a move made after both reloads crosses the wire.

Run it:

```bash
cd G:/Github/TCG600nap && node server/table.js
```

Serves `site/` as web root on :8777, so the page is `/play.html` — **not**
`/site/play.html`. The referee never opens a relay connection.

Nothing is listening on 8777 right now; the session's server was stopped.

## What changed this session (4 commits)

| Commit | What |
| --- | --- |
| `e2fc561` | Resource icons redrawn in the frame's line-and-node language |
| `e777cd6` | All 297 web faces re-rendered on those icons |
| `ff10cfd` | Per-tab seat credentials — both sides playable on one machine |
| `7d6f510` | Stopped tracking SQLite's WAL/SHM sidecars |

### Icons

Thin single-weight line (`W = 4.0`), a small filled node wherever a line begins
or meets another, and a *shine* rather than a glow — one lighter-toned pass at
0.5 alpha, 0.7 blur, so it reads as sheen on the line instead of fog around it.
Same vocabulary as the frame's own letterbox rails and circuit ring.

**Timelock is now a clock, not a padlock.** A padlock and a key are the same idea
to a player and Keys already owns it; duration is what Timelock means. This kills
the Keys/Timelock confusion at the metaphor level rather than by colour alone.

Source is `scripts/build_icons.py` — five plain SVG path strings, so changing one
is a one-line edit plus a re-render.

> The user has rejected several icon iterations. They have seen these as isolated
> glyphs and on three sample cards, but have **not** given explicit approval of
> the full render. If the direction is wrong, re-rendering is ~10 minutes.

### Rendering — read before you render

Two output sets, and they are **not** the same format:

```bash
uv run python scripts/render_card_pngs.py --format png --out art/cards/node-runner-print
uv run python scripts/render_card_pngs.py --format webp --quality 88 --out art/cards/node-runner-web
```

`--format` defaults to **png**, but the site and game table load
`art/cards/node-runner-web/*.webp` (see the `face` field in `site/play-data.js`).
Rendering with defaults writes PNGs the site never reads and leaves the real
faces stale — that happened this session. Print masters are gitignored.

After a render, both of these need rebuilding because the face bytes changed:

```bash
uv run python scripts/build_blob_manifest.py --dir art/cards/node-runner-web
uv run python scripts/build_asset_set.py --blossom-base https://blossom.example
```

Box commitment is currently `8de668f7…` (was `f47ea050…`). Box shape unchanged:
4,536 cards, 3.0% rare, 21,000 msat/card, 95,256 sats/box.

### The two-tab bug (the one that would have killed the demo)

Playing both sides on one machine — the obvious way to demo without a second
laptop — was broken in two compounding ways. `localStorage` belongs to the
*origin*, not the tab, and held one record:

1. The second tab read the host's credential and RESUMEd on **seat 0's token**,
   superseding the host.
2. Whichever tab saved last **overwrote** the other's credential. Observed live:
   the host reloaded mid-match and came back as seat 1.

`sessionStorage` is now the store — per tab, survives reload, which is exactly a
seat's lifetime. `localStorage` keeps a per-seat map (`600b:seats`, keyed
`<matchId>:<seat>`) only so a *closed* browser can reclaim its seat; entries are
stamped with the holding tab and a heartbeat, and a tab may adopt one only once
it has stopped beating.

A third bug surfaced during verification: both tabs read-modify-write the whole
map, so one clobbers the other. The beat now **rewrites a missing entry** rather
than skipping it, so the map converges regardless of write order. Without that,
whoever lost the race vanished from storage permanently.

Legacy `600b:match` records are still honoured, so upgrading mid-match does not
cost anyone their table.

### Gotcha that cost time

`.claude/launch.json` used to run `python -m http.server`. A stale instance was
still bound to `127.0.0.1:8777`, which **beats the table server's `0.0.0.0` bind**
for connections to localhost, so every request got that server's 404 while the
referee sat there looking healthy in its log. If the page 404s, check what is
actually listening:

```bash
netstat -ano | grep ":8777"
```

---

## Known open items

Ordered by what is most likely to bite.

1. **Icon approval.** See the note above.
2. **`art/world-plates/timelock.png` is still violet artwork behind teal chrome.**
   Timelock moved to teal; that plate never followed.
3. **Attach (42 cards) and Mesh (4) keyword enforcement** is unverified in the
   engine. Broadcast was found unenforced earlier and fixed; these two were never
   confirmed either way.
4. **Assist tiers A/B/C exist as a design doc but are not consumed by
   `build_play_data.py`**, which still emits 91 scripted / 204 assisted. Current
   measured state: 295 cards, 302 abilities, 234 abilities flagged manual.
5. **`_strip_reminder()` in `scripts/build_play_data.py`** was suspected of
   costing ~52 abilities their scripted implementation. **Not confirmed** — the
   "MISSED-A" label came from an ad-hoc audit earlier in the session and does not
   exist anywhere in the repo. Re-measure before acting on it.
6. **The HTML proof sheet lacks the giant-symbol resource layout** that the PNG
   renderer produces, so the two disagree for Basic Resource / Resource.
7. **De-slop reconciler's 20 collision groups** are flagged but unfixed.
8. **Lightning node + Blossom host details** are still needed from the user;
   boosters are on a placeholder `https://blossom.example` base until then.

## Architecture constraint — binding

User's words, verbatim:

> only game handshakes and wins loses on nostr the plays are live events and
> sored as db not a nostr event per play thats stupid

So: invite / accept / signed result touch a relay. Every play travels the socket
and lands in SQLite. Do not propose a Nostr event per move.

Decision record is `docs/multiplayer-architecture.md` (D1–D8); the wire protocol
is normative in `docs/net-protocol.md`.

## Tests

```bash
uv run pytest -q          # 89 passing
npm run test:js           # 66 passing
```

`node --test tests/` (directory form) **fails on Windows** — use the npm script
or the file/glob form.
