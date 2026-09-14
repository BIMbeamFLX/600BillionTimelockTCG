# Technical handover — 2026-08-15

## Result of this state of work

The starting point is `main` at `5fb20f4` (PR #10). Work is done on
`feature/remote-reliability`; the commits `9f9e790` and `d966dc2`, already made locally,
carry the referee hardening and the first version of the handover. This pass was neither
deployed nor pushed.

As of today, this state can:

- play hotseat, NPC and complete two-client matches via the same deterministic
  engine core;
- resolve all 295 Edition One cards automatically: 295 scripted, 0 assisted;
- use all 11 precons and the complete card pool in Casual and future Ranked;
- form Mesh groups, block together and route opposing damage via a
  deterministic legal default;
- generate clash previews directly from an engine simulation — the UI no longer contains
  a second damage calculation;
- show every structured game action as a short, semantically colored pulse;
- show Uptime as circular and bar meters with percentage fill, color level, status and a
  static reduced-motion fallback;
- assign online seats only after a fresh NIP-07/NIP-42 signature and bind the
  identity to the seat on Create, Join and Resume;
- enforce fog of war on the server, persist actions in SQLite and reproduce the complete
  hash chain from the transcript;
- load 297 content-addressed release WebPs locally and via the existing Blossom mirrors.

Released Local and Remote use `policy.freeform = "deny"`. The old manual APIs remain in the
engine code only as a tested backward-compatibility and security boundary; no
published card needs them.

## Verification

| Gate | Result |
| --- | --- |
| `npm run test:js` | 182/182 green |
| `uv run pytest -q` | 108/108 green |
| `npm run build` | green |
| Ruff on all version-controlled Python files | green; 49 files formatted |
| Card compiler | 295 cards, 295 auto-resolving, 0 assisted |
| Gallery compiler | 296 image/text cards |
| HTTP smoke test | all 12 HTML pages as well as `/api/health` and `/api/tables` successful |
| Out-of-process match | 380 actions, 210 transcript entries, regular end on turn 7 |
| Browser acceptance check | Zap 20 → 17, meter 100 % → 85 %, hit visible, reduced motion static, no console errors |

The two-client run confirmed distinct seat views, server-side fog of war,
engine rejections, SQLite persistence, replay, public/state/entry hashes, an unbroken
hash chain, tamper detection and identical result bytes for both signatures.

The NIP-42 tests check the canonical event hash, BIP-340 Schnorr signature, kind `22242`,
empty content, exact relay/challenge tags, time window and one-time use of the challenge.
Bare pubkey claims, replays and identity switches are rejected. Open tables from the time
before the mandatory NIP-07 login are neither listed nor made joinable.

The normal root invocation `uv run ruff check .` also sees the untracked folder
`art/video-intro/`, which does not belong to this state of work, and reports six
lint findings and one formatting deviation there. The folder was deliberately neither
changed nor committed; all version-controlled Python files pass Ruff.

## Architecture

`site/engine.js` is the source of truth for the rules. `site/play.js` renders hotseat and
remote play, translates engine events into readable action pulses and collects only player
intents that have not yet been submitted. `site/net.js` performs the NIP-42 handshake and
then transports actions. `server/table.js` owns the complete state, sends a redacted view
per seat and writes accepted actions to SQLite before the broadcast. `site/fx.js` provides
the pooled, limited audio/VFX cues; in fast chains of events, important hits and Uptime
changes displace ordinary pass/phase messages, not the other way around.

An nsite can still only publish the static files. Public Unranked and
Ranked need the Node referee behind TLS. Same-origin for the website, `/ws` and `/api/*`
remains the smallest robust public topology.

## Card images and cleanup

`art/cards/final/` was the superseded JPEG generation and has been deleted in the current
state of work. Only `art/cards/node-runner-web/` remains active: 297 tracked WebPs plus a
manifest, 41.8 MB, all 297 local SHA-256 checks green. The release set is already backed up
in GitHub by commit `3c50d45` on `origin/main` and `public/main`; the Blossom addresses
remain the serving mirrors.

## Ranked rule

There is no longer an artificially smaller "Certified" pool: Casual and Ranked may use all 295
cards because the entire catalog is scripted. Ranked will later add identity,
matchmaking, time, result and ladder rules, but no second card rules engine.

## Next vertical slices

### Slice 1 — Ship Public Unranked

- Put the same-origin TLS proxy and the complete external `wss://` URL under version control.
- Block the origin port and configure proxy hop trust precisely.
- Two real devices: NIP-07 login, Create, Join, Resume and a complete match.
- Acceptance: no guests, no mixed content, health/API/socket under one HTTPS origin.

### Slice 2 — Make combat decisions fully visible

- Make the multiple-blocker order visible and changeable.
- Offer Mesh damage routing as a deliberate player decision; today's automatic
  default remains the safe fallback.
- Undo for attacker/blocker/routing declarations that have not yet been submitted.
- Acceptance: mouse and touch, one atomic network action per declaration, the engine
  validates everything.

### Slice 3 — Verified results

- Check invite, accept and result event IDs/signatures on the server.
- Link both verified results to the seat identity.
- The authority key republishes only confirmed matches for Ranked.

### Slice 4 — Make Ranked playable

- Matchmaking, round time, disconnect/forfeit rules and deck commitment.
- Update rating/ladder only after a verified result.
- Replay/dispute view for tournament play.

### Slice 5 — Paid mint

- Configure the LNURL target, test payment end to end and demonstrate the error/refund paths.
