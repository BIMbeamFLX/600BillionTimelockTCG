# Confirmed remaining issues — 2026-08-15

> **Postscript, later on 2026-08-15.** This document is the state as of one
> point in time and is not rewritten retroactively. Done since then:
>
> - **B-01 partially** — the underlying cause is fixed: `publicTableUrl()`
>   hard-coded `ws://` and the bound port, which meant that behind TLS every
>   published invite was both blocked as mixed content and aimed at
>   an unreachable port — silently. `PUBLIC_URL` now names both
>   explicitly. Deployment and an external test are still pending (`docs/deploy.md`).
> - **B-02 done** — invite, accept and result events are checked before they are
>   stored: event ID recomputed from its own bytes, BIP-340 signature
>   verified, rejection instead of a row. `sig_checked` is `1`. The reasoning at
>   the time was outdated: `@noble/curves` had long been a dependency for the
>   NIP-42 login.
> - **B-05 unchanged and still rightly so** — the shop now says openly
>   that paid packs are not live, instead of offering a button that does nothing.
>
> B-03 (Mesh routing without free player choice) and B-04 (blocker order and
> undo) remain open, unchanged.

This document contains only remaining issues confirmed locally. Earlier findings that have
been fixed — assisted cards, duplicated clash math, ineffective Mesh, bare pubkey claims,
reconnect/rate-limit bypasses and the undefined attack-glow color value — are no longer
listed here as open bugs.

## Overview

| ID | Severity | Finding | Affected target |
| --- | --- | --- | --- |
| B-01 | P1 high | Public TLS/proxy deployment is not configured or externally tested | Public Unranked |
| B-02 | P1 high | Invite, accept and result signatures are not yet checked on the server | Ranked |
| B-03 | P2 medium | Mesh damage routing uses a legal automatic default, but no free allocation by the player yet | Combat UX |
| B-04 | P2 medium | Multiple-blocker order and undo cannot yet be operated through visible controls | Combat UX |
| B-05 | P2 medium | The paid mint has no configured LNURL | Shop |

## B-01 — Public Unranked needs the real target topology

**Files:** `server/table.js`, `site/net.js`

Locally, the referee serves the website, API and socket together. Behind HTTPS, however,
`PUBLIC_HOST` alone does not yet produce a complete external `wss://` advertised URL. A static
nsite does not provide `/ws` or `/api/*`. The reverse proxy, origin firewall, proxy hop trust
and two real devices were deliberately not deployed or checked in this pass.

## B-02 — Login is verified, stored Nostr results are not yet

**Files:** `server/table.js`, `docs/net-protocol.md`

The NIP-42 login is fully verified cryptographically. Invite, accept and kind 31600
result events, by contrast, are still stored with `sig_checked = 0`. Seat binding prevents
attribution to someone else within the connection, but is not sufficient as a Ranked authority.

## B-03 — Mesh routing is legal, but still automatic

**Files:** `site/engine.js`, `site/play.js`

Mesh groups can be formed in the UI; a block hits the whole group. The engine routes
opposing damage deterministically to a legal victim and thereby prevents a standstill.
The rulebook, however, allows the Mesh controller a free distribution. This strategic choice
still needs a visible, atomic routing interface.

## B-04 — Combat declarations need the final controls slice

**Files:** `site/play.js`, `site/play.html`

Attacking and blocking work via click/drag; legal targets and the engine preview are
visible. With multiple blockers, the current order is adopted automatically; visible
reordering and undo before submitting are still missing.

## B-05 — Paid Mint is intentionally off

**File:** `site/shop.js`

`MINT_URL` is not set. Demo packs work; a real LNURL/Lightning payment run
was not carried out.

## Not verified

- no public deployment, no TLS/reverse proxy test and no cross-origin test;
- no two-device LAN test and no real NIP-07 run with two browser extensions;
- no server-side check of stored invite/accept/result signatures;
- no physical mobile/touch device; desktop and reduced motion were checked in a real browser;
- no complete visual acceptance check of all 295 cards and every possible game phase;
- no systematic accessibility or performance measurement;
- no Ranked matchmaking, no ladder and no LNURL payment run.

The untracked user folder `art/video-intro/` was not changed. Its current Python WIP
merely prevents a blanket Ruff root scan from being green; the version-controlled
Python files fully pass lint and formatting.
