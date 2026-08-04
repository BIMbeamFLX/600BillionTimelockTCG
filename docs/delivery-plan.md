# 600B Timelock TCG — Delivery Plan for the 2026-08-07 Demo

`status: working plan` `written: Sat 2026-08-01` `demo: Fri 2026-08-07` `owner priority: multiplayer over nostr events; boosters as bonus; centralized shortcuts acceptable`

Everything below was verified against the working tree on 2026-08-01, not taken from
memory. Where the situation is better or worse than previously believed, that is said
plainly.

---

## 1. Honest read of the situation

**The good news, and it is major: the engine integration is already done.** The brief
for this plan assumed `site/engine.js` was "written, not integrated." That is stale.
As of today:

- `site/play.html` loads `engine.js` (line 266) and `site/play.js` is a pure
  view/controller — its own header says "This file holds NO rules... Every state change
  goes through E1Engine.apply()." The hotseat table already renders `view(full, seat)`
  per frame, so the fog-of-war/redaction path is exercised on every local game.
- `tests/js/engine.test.mjs` (712 lines, 32 tests) passes 32/32 under
  `node --test`, including: view redaction of Stacks/Wallets/hidden seeds, idempotent
  views, `legalActions` on redacted views, full-log replay reproducing the head hash,
  and tamper detection at the exact diverging action.
- Keyword enforcement is further along than believed. `engine.js` enforces
  Broadcast, Broadcast Guard, Shielded, Backchannel, Reboot, Firewall, First Strike,
  Boot Delay and Overflow (`canBlock` at ~line 2223 handles Broadcast/Shielded/
  Backchannel explicitly). The previously demonstrated ineligible-blocker defect is
  closed in this engine. Still **zero enforcement**: **Attach (42 cards)** — an
  `attachedTo` field exists but nothing ever sets it — and **Mesh (4 cards)**. So 46
  cards with dead printed text, not 68.

**The bad news:** every bit of that — `engine.js`, the rewired `play.js`/`play.html`,
`fx.js`, `fx-demo.html`, `tests/js/` — is **uncommitted**. `git status` shows the
engine untracked, the old `engine-part1/2/3.js` deleted, and the last commit is from
before the integration. Two days of the most important work in the repo currently
exists only as files on one disk. (Also stale in the brief: `site/fx-demo.html` is not
missing — it exists, 588 lines, the FX audition harness.)

**The gap:** there is no multiplayer networking code at all. The only WebSocket usage
in `site/` is the kind-0 profile fetch in `index.html`. Multiplayer over nostr events
is greenfield starting today. What makes it feasible in six days is that the engine
API is already transport-shaped: `apply(state, {type, seat, seq, at, payload})` is a
deterministic reducer over a hash-chained action log, with `view()` redaction,
`replay()`, `publicHash()` and `verifyMatch()` all written and tested. The week is
transport and productization, not engine work. If the integration had not already
landed, the honest answer would be "not achievable"; because it has, it is.

**Scripted-ability reality check:** `play-data.js` currently has 68 abilities scripted
via ops and 234 manual — not the 173/38/23 A/B/C split quoted elsewhere. The
`_strip_reminder()` parser bug in `scripts/build_play_data.py` (line 95: it drops ALL
parenthetical text, including reminders that ARE the rule) is part of why. The demo
mitigation is deck curation, not a parser rewrite (see S6).

**Booster track status:** `G:\Github\lnurl-mint` passes 71/71 tests in under a second
with a FakeNode harness. NORD kinds 7600/7601/7603 are implemented; settling invoices
claim queued assets by exact msat value (`_assign_queued_asset` in `router.py`) — one
card per payment. `cards/e1-asset-set.json` (3125 assets) imports cleanly and
`scripts/build_asset_set.py` already emits a seeded Fisher-Yates box order with a
SHA-256 commitment. `G:\Github\lnurl-wallet` already renders hash-verified declared
artwork on bearer cards (`src/components/BearerCard.tsx`, `declaredArtwork`). The
missing piece for DEMO-600B's booster beat is exactly one thing: one 210-sat invoice
yielding three cards plus a change note, instead of three separate exact-value
payments.

### The single biggest risk to Friday

**Every headline demo beat stacks on greenfield transport code that must exist by
Tuesday night.** The relay protocol, ordering, seat locking and remote-mode UI are
all net-new, and until S3 completes a full cross-machine match, nothing about the
"multiplayer" demo is real. Everything else — identity, resume, boosters, FX — is
either independent or degradable. The plan therefore front-loads S2/S3 into
Sat–Mon and sets a hard go/no-go checkpoint Tuesday night.

Second-order risks, each with a mitigation baked into a slice: work-loss (nothing
committed — S1, first hour of today), NIP-07 per-event signing popups wrecking match
flow (S5 session key; extension auto-sign as plan B), and public-relay flakiness on
custom kinds (local relay in the runbook; transport is relay-URL-agnostic).

---

## 2. The slices

Each slice is independently demonstrable end to end. Estimates are focused hours for
one person who also has to eat.

---

### S1 — Freeze the safe demo

- **Demo script:** "`git checkout demo-safe`, serve the repo, open
  `site/play.html`, play a full hotseat turn — this works no matter what happens
  this week."
- **Definition of done:** all current working-tree changes committed in logical
  conventional commits (engine, play rewiring, fx layer, js tests, play-data,
  deleted engine-parts); `node --test tests/js/` 32/32 green; `uv run pytest` green;
  tag `demo-safe-v1` pushed.
- **Files:** repo-wide commit; no code changes beyond what fixing a red test needs.
- **Dependencies:** none.
- **Estimate:** 2 h.
- **Fallback:** none needed — this IS the fallback for everything else.

### S2 — Two machines, one relay, same opening hand

- **Demo script:** "Machine A clicks *Create match* and reads out a short match
  code. Machine B clicks *Join* and pastes it. Both screens draw opening hands —
  each player sees their own cards, the opponent's are face-down, and both screens
  show the same green `publicHash` badge."
- **Definition of done:** new `site/net.js` — minimal relay pool (subset of the
  WebSocket handling already proven in `index.html`), one custom regular event kind
  for match traffic (proposed: kind `4600`, tags `["m", matchId]`, `["seq", n]`,
  `protocolVersion` + engine version in the payload — decide and document in
  `docs/napplet-spec.md` per its own flagged gap #2); create/join handshake; a match
  config event carrying seeds and both 40-card decklists; both clients call
  `createGame` with identical config; `play.js` gains a remote mode: fixed local
  seat, renders `view(full, mySeat)` only, dispatch restricted to own-seat actions.
  Works between two browsers on two machines against a real relay.
- **Files:** `site/net.js` (new), `site/play.js`, `site/play.html`,
  `docs/napplet-spec.md` (kind decision recorded).
- **Dependencies:** S1.
- **Estimate:** 8 h.
- **Fallback:** same-machine, two browser windows via a `BroadcastChannel` shim
  behind the same `net.js` interface — still demonstrates seat-locked hidden hands.
  Worst case: hotseat (S1).

### S3 — A full match across machines

- **Demo script:** "We play real turns against each other on two machines —
  resources, a Broadcast attack that the opponent's ineligible Avatar is *refused*
  from blocking, damage, and a win when Uptime hits zero. Every action travels as a
  nostr event and both engines stay in lockstep."
- **Definition of done:** every action published to the relay and applied through
  the identical engine on both sides; out-of-order events buffered by `seq`,
  duplicates dropped, own-echoes ignored; after each applied action both clients
  compare `publicHash` and a mismatch shows a desync banner and voids the match
  (napplet-spec semantics); one complete match played across two physical machines
  including combat and a win, with zero console errors.
- **Files:** `site/net.js`, `site/play.js`.
- **Dependencies:** S2.
- **Estimate:** 10 h.
- **Fallback:** if combat-across-the-net is flaky, demo S2 plus the first two turns
  scripted, then switch to hotseat for the gameplay beat and say so honestly.

### S4 — Kill the tab, resume the match; verify the transcript

- **Demo script:** "Mid-match, machine B's browser is closed — on stage. Reopen the
  page, rejoin with the match code: the client refetches the event log from the
  relay, `replay()`s it, and the match continues where it stopped. When the match
  ends, a panel shows *transcript replays clean* with the head hash."
- **Definition of done:** rejoin path fetches all `["m", matchId]` events, orders by
  seq, rebuilds state via `E.replay`, resumes play; end-of-match panel runs
  `E.verifyMatch` over the received log and displays result + head hash. Rehearsed
  at least twice.
- **Files:** `site/net.js`, `site/play.js`, `site/play.html`.
- **Dependencies:** S3.
- **Estimate:** 5 h.
- **Fallback:** cut the live kill-the-tab beat; keep the end-of-match verify panel
  (it is the cheap half and uses tested engine functions).

### S5 — Real identities at the table

- **Demo script:** "Both players log in with their NIP-07 extension. The table
  shows each player's nostr name and avatar. Moves flow without a single signing
  popup."
- **Definition of done:** the login + profile-fetch flow from `site/index.html`
  (~lines 230–300, already working) reused on the play page; match events signed by
  a per-match session key whose pubkey is authorized by one NIP-07-signed join
  event; opponent identity displayed from kind-0.
- **Files:** `site/play.html`, `site/play.js`, `site/net.js` (shared login helper
  extracted, or duplicated — do not gold-plate).
- **Dependencies:** S2 (runs parallel to S3/S4).
- **Estimate:** 5 h.
- **Fallback:** anonymous "Player 1 / Player 2" labels — explicitly sanctioned by
  `docs/napplet-spec.md`'s identity fallback. Plan B for popups: extension
  auto-sign whitelisting for the demo origin.

### S6 — Demo decks that are actually legal

- **Demo script:** "The two starter decks — SIGNAL and STONE, per DEMO-600B — play
  a full scripted game with no dead cards and no awkward manual stalls."
- **Definition of done:** two 40-card decklists as JSON, derived from the E1 pool,
  containing **zero Attach or Mesh cards** (their keywords are unenforced) and
  biased toward the 68 scripted abilities; an automated bot playthrough (the
  harness behind the existing "5/5 automated full games" claim / `legalActions`
  autopilot) completes a full game with both decks without errors; the rehearsed
  demo seed produces a known, tellable opening.
- **Files:** `cards/` (deck JSON), small script or test in `tests/js/`.
- **Dependencies:** S1 only — fully parallel.
- **Estimate:** 4 h.
- **Fallback:** hand-picked 30-card decks; shrink until clean.

### S7 — One invoice, three cards, change

- **Demo script:** "Scan one 210-sat booster invoice. On settlement the mint
  publishes three kind-7600 geneses; the wallet fans out three cards with real
  artwork plus a 30-sat banknote as change."
- **Definition of done:** booster path in `lnurl-mint` — a configured product price
  (210 000 msat) whose settlement claims the next **three** queued assets in
  committed box order and issues a change note, instead of the current
  one-asset-by-exact-msat claim (`router._assign_queued_asset`); covered by
  FakeNode tests in the existing suite style; suite stays green (currently 71/71);
  end-to-end run: import `cards/e1-asset-set.json` (3125 assets, already verified
  to import), pay, three geneses on the relay, wallet displays all three.
  Centralized on purpose — the owner has sanctioned it (debt D-4).
- **Files:** `G:\Github\lnurl-mint\lnurl_mint\router.py`, `assets.py`, `config.py`,
  `tests/`.
- **Dependencies:** none on the multiplayer track — fully parallel. Real Lightning
  node optional (FakeNode is fine on stage, and saying "this is the test harness,
  the real node path is identical" is honest).
- **Estimate:** 8 h.
- **Fallback:** "three singles" — three exact-value payments each claiming one
  card. That flow exists **today** and demos the same NORD properties, just less
  slickly.

### S8 — Card faces on Blossom

- **Demo script:** "The card art in the wallet and on the table is fetched by
  SHA-256 from a Blossom server — the hash in the genesis event *is* the address."
- **Definition of done:** the 297 rendered faces in `art/cards/node-runner-web/`
  uploaded via `scripts/build_blob_manifest.py` to the owner's Blossom host;
  `GET /<sha256>` round-trip spot-checked; `e1-asset-set.json` rebuilt with that
  base URL (`scripts/build_asset_set.py` already writes `artwork_url` +
  `artwork_sha256`); wallet renders from it (it already hash-verifies declared
  artwork).
- **Files:** `scripts/build_blob_manifest.py` invocation, regenerated
  `cards/e1-asset-set.json`.
- **Dependencies:** owner's Blossom host existing (their claim; verify Wednesday).
- **Estimate:** 3 h if the host works; do not debug someone's server for a day.
- **Fallback:** serve the faces from any static host (or the site itself). The
  wallet checks the sha256 regardless of who serves the bytes — that is the whole
  point of content addressing, and saying so on stage turns the fallback into a
  feature.

### S9 — FX layer on the live table *(flex)*

- **Demo script:** "Plays, combat and the win land with sound and motion — the
  match feels like a game, not a database."
- **Definition of done:** `fx.js` (`globalThis.E1FX`, already event-driven) loaded
  by `play.html` and fed from the engine event stream; reduced-motion respected; no
  console errors; hotseat and remote both covered.
- **Files:** `site/play.html`, `site/play.js`.
- **Dependencies:** S1 (works for hotseat even if multiplayer slips).
- **Estimate:** 4 h.
- **Fallback:** show `site/fx-demo.html` (exists, 588 lines) as a standalone
  30-second beat: "this is the FX layer auditioning; it wires in next week."

### S10 — Published results *(flex)*

- **Demo script:** "When the match ends, both clients publish a result event for
  the same matchId; the lobby shows the match as *confirmed* because both events
  agree."
- **Definition of done:** each client publishes one addressable result event
  (proposed kind `31600`, `d=matchId`, payload `{matchId, players, winner, turns,
  engineVersion, transcriptHash}` — napplet-spec's results flow, minus the 600B
  authority key); a small recent-matches list on the play page or
  `site/leaderboard.html`; agreement/mismatch rendered as confirmed/disputed.
- **Files:** `site/net.js`, `site/play.js`, `site/leaderboard.html`,
  `docs/napplet-spec.md` (kind recorded).
- **Dependencies:** S3 (S5 optional).
- **Estimate:** 4 h.
- **Fallback:** cut; say the sentence instead of showing it.

### S11 — Reminder-text parser fix *(flex)*

- **Demo script:** "Rebuild `play-data.js`: the scripted-ability count rises from
  68 and the bot game still completes — fewer manual stops at the table."
- **Definition of done:** `_strip_reminder()` in `scripts/build_play_data.py` only
  strips a parenthetical when the remaining clause still parses; otherwise the
  full line is offered to `parse_ops`. Regression test in
  `tests/test_build_play_data.py` for a card whose reminder is the rule; scripted
  count strictly increases; `node --test` and the S6 bot game stay green.
- **Files:** `scripts/build_play_data.py`, `tests/test_build_play_data.py`,
  regenerated `site/play-data.js`.
- **Dependencies:** S1; interacts with S6 (rerun the bot game after).
- **Estimate:** 3 h.
- **Fallback:** cut — S6's curation already routes the demo around manual-heavy
  cards.

**Budget honesty:** S1–S8 sum to 45 h; with the flex slices S9–S11 the total is
56 h. Six build days at ~8 focused hours is ~48 h. The flex slices only happen if
the critical path runs ahead — that is what the cut list is for.

---

## 3. Critical path and parallelism

```
CRITICAL PATH  (must land by Tue night):
  S1 (2h) ─→ S2 (8h) ─→ S3 (10h) ─→ S4 (5h)          = 25 h
                     └─→ S5 (5h)  (joins after S2, parallel to S3/S4)

PARALLEL TRACK A (any time after S1):
  S6 demo decks (4h) · S9 FX (4h) · S11 parser (3h)

PARALLEL TRACK B (independent of site code entirely):
  S7 booster (8h) ─→ S8 Blossom (3h)

AFTER S3:
  S10 results (4h)
```

The multiplayer spine S1→S2→S3→S4 is strictly sequential. Track B (mint work) shares
no files with the site and can absorb any day the multiplayer work is blocked or the
author needs a context switch. S6 is deliberately early-startable: the demo decks
determine what the rehearsed match looks like, so they should exist before Thursday's
dress rehearsal, not after.

---

## 4. Day by day (Sat 1 Aug → Fri 7 Aug)

One person, realistic output, checkpoint commits throughout (per house workflow
rules: commit working checkpoints incrementally).

| Day | Plan | End-of-day proof |
| --- | --- | --- |
| **Sat 1** | S1 first (commit + tag `demo-safe-v1` — first hour, non-negotiable). Then S2: `net.js` relay pool, event kind decision, create/join handshake. | Two browser windows exchange a match handshake over a real public relay. |
| **Sun 2** | Finish S2: config event with seeds + decks, seat-locked remote mode in `play.js`, opening hands on two machines, `publicHash` badge. Start S3 action pipeline. | The S2 demo script works between the Linux workstation and the Windows laptop. |
| **Mon 3** | S3: all actions over the relay, seq buffering, per-action hash cross-check, desync banner. | One full match played across two machines, zero console errors. Tag `demo-mp-v1`. |
| **Tue 4** | S3 hardening (reconnect blips, double-join, spectator-ignore). S4 resume + verify panel. S5 if hours remain. **Go/no-go, Tuesday night:** if S3 is not demonstrably done, Wednesday goes to multiplayer and the booster becomes the "three singles" fallback — decided now, not Thursday. | Kill-the-tab resume works; end-of-match verify panel shows a clean replay. |
| **Wed 5** | S5 identity + popup-free signing. S6 demo decks + rehearsed seed. Start S7 booster endpoint (tests first — FakeNode makes this fast). Verify the owner's Blossom host and Lightning node actually exist today; if not, lock in fallbacks now. | Logged-in match with names/avatars; SIGNAL and STONE decklists bot-verified; booster tests red-green in progress. |
| **Thu 6** | Finish S7; S8 Blossom upload; flex slices (S9 FX, S10 results, S11 parser) **only if everything above is green**. 15:00: full dress rehearsal of the entire runbook on the real demo hardware and network, twice. Fix only what the rehearsal breaks. Tag `demo-final`. **Feature freeze at EOD.** | The runbook below executed twice end to end, timings noted, fallbacks tested. |
| **Fri 7** | No code except showstoppers found in the morning smoke run. 30-minute smoke run of the runbook. Charge machines, phone hotspot tested, all assets served locally. Demo. | — |

---

## 5. Demo-debt register

Every deliberate shortcut, why it is acceptable on Friday, and the named post-demo
slice that repays it. These are debts, not lies: any of them can be stated openly on
stage without weakening the demo.

| ID | Shortcut taken for the demo | Why acceptable | Repaid by |
| --- | --- | --- | --- |
| D-1 | Hidden information is UI-side only: the match config event carries both hidden seeds, so each client *holds* the full state and merely renders `view(full, mySeat)`. A player could read their opponent's hand in devtools. | The demo is cooperative; the redaction/view machinery being exercised is the real one; the architecture doc's D5 design exists precisely because this shortcut is known to be insufficient for ranked play. | **P-1: DeckOracle v2** — per-card commitments + opponent-held secret permutation (`docs/multiplayer-architecture.md` D5). |
| D-2 | Moves signed by an ad-hoc per-match session key authorized by one NIP-07 event, not a standardized delegation. | Per-event extension popups make live play impossible; the authorization event still binds the session to a real identity. | **P-2:** proper delegation (NIP-46 remote signing or a documented delegation event), plus the napplet shell identity NAP. |
| D-3 | Attach (42 cards) and Mesh (4 cards) are excluded from the demo decks because the engine does not enforce them. | Excluding beats misplaying; 249 cards remain; no shown card behaves differently from its printed text. | **P-3:** implement Attach (targeting, grant application, detach-on-archive — `attachedTo` scaffolding exists at engine.js ~612/1079) and Mesh, with keyword tests, which `tests/js/engine.test.mjs` currently barely covers (only Reboot). |
| D-4 | The booster is minted centrally: the mint claims three pre-committed assets and issues change. Owner-sanctioned verbatim ("we could also do that centralized for dem[o]"). | The mint is *already* the trusted issuer in NORD; `build_asset_set.py` already emits a seeded box order + SHA-256 commitment, so the fairness story is publishable even now. | **P-4:** publish the box commitment before sale, reveal after exhaustion, and add the mint-side Blossom upload client (MINT.md §4). |
| D-5 | Result events (if S10 lands) are two independently published events with agreement shown; no 600B authority countersign. | Sybil rating-farming is irrelevant to a stage demo; the agreement/dispute rendering already demonstrates the trust model. | **P-5:** authority-key republish per architecture doc D6. |
| D-6 | `lnurl-mint` diverges from NORD-01: no kind 7602 confirm, no registered mode, `lnurl` genesis tag not LUD-17 form, one artwork hint only. | None of the shown flows (mint, transfer, melt, booster) touch those paths. | **P-6:** NORD-01 conformance pass in `lnurl-mint`. |
| D-7 | If the Blossom host slips, faces are served from a plain static host with the same sha256s. | The wallet verifies bytes against the hash regardless of the server — content addressing makes the host interchangeable, which is a talking point, not an apology. | **P-7:** Blossom upload + at least one mirror. |
| D-8 | Card flavour/help text ships as-is (measured slop: 290/295 flavour lines share an opening, 54 distinct help_texts). The running rewrite (~295 lines) is **not** merged this week — unreviewed text does not go on demo faces. | Nobody reads 295 flavour lines during a demo; a botched unreviewed swap, however, would be visible. Faces are frozen with the rest at Thursday EOD. | **P-8:** editorial review of the rewrite batch, then re-render faces. |
| D-9 | Match transport uses whatever relay is configured — public relays for development, a local relay on demo day. No dedicated 600B relay policy. | The transport is relay-URL-agnostic by construction; the demo needs reliability, not infrastructure. | **P-9:** dedicated relay with retention/policy suited to match logs; then the napplet WebRTC NAP per the architecture end-state. |
| D-10 | 68 of 302 abilities are engine-scripted; the rest resolve via the manual/tier flow at the table. Demo decks are curated around this. | The manual flow is a designed, logged, attributed part of the game (tier system), not a hack — but density matters on stage. | **P-10:** S11 parser fix if cut this week, then the C→B→A promotion grind per architecture doc D2. |

---

## 6. Cut list — pre-made decisions, in drop order

If behind, drop from the top. Each line states what is lost so Thursday-night
decisions are mechanical.

1. **S11 parser fix** — lose: higher scripted density. Keep: S6 curation covers it.
2. **S10 result events** — lose: the published-result beat. Say the sentence instead.
3. **S9 FX wiring** — lose: audiovisual punch in the match. Keep: `fx-demo.html`
   standalone beat (already works).
4. **S8 Blossom** — lose: the "fetched by hash from Blossom" line. Keep: same art
   from a static host, same sha256s (D-7 talking point).
5. **S7 3-card booster** — lose: single-invoice pack. Keep: "three singles" via the
   existing exact-msat queue — the NORD story survives intact.
6. **S5 identity** — lose: names/avatars. Keep: anonymous seats (napplet-spec
   sanctioned fallback).
7. **S4 resume beat** — lose: kill-the-tab theatre. Keep the end-of-match verify
   panel if at all possible; it is cheap and it is the trust story.
8. **S3 full remote match** — lose: live cross-machine gameplay. Keep: S2 (remote
   opening hands, a few scripted actions) + hotseat for the gameplay beat, stated
   honestly as "transport landed this week; the full loop is days away."
9. **Absolute floor (never cut):** hotseat `play.html` + `cards.html` gallery +
   `fx-demo.html` + single-card mint into the wallet. Every one of these works
   **today** and that floor is already a coherent demo: a finished 296-card game
   with a real rules engine, plus real bearer-asset cards on nostr.

Multiplayer S2/S3 is cut *last* among features because it is the stated priority;
the floor exists so that even the worst week ends with a good demo instead of a
broken ambitious one.

---

## 7. Demo-day runbook

Pre-flight (Thursday night + Friday morning, 30 min):

- Both machines (alflx Linux workstation, bitbeam Windows laptop) charged, on the
  phone hotspot **and** Tailscale — do not depend on venue wifi.
- Local relay running on the laptop (dockerized strfry or nostr-rs-relay);
  `net.js` relay list = `[local relay, two public relays]` so either works.
- Repo served locally on both machines (`python -m http.server 8777`); all card
  art local; no CDN anywhere in the demo path.
- NIP-07 extensions installed on both, auto-sign enabled for the demo origin.
- `lnurl-mint` running with FakeNode (or the real node if it verifiably works
  Thursday), asset set imported, wallet open on the phone with a pre-minted
  banknote as backup.
- One rehearsed match seed whose opening you can narrate.
- Terminal with `git checkout demo-safe-v1` one command away.

| # | Beat | Click-by-click | If it fails live |
| --- | --- | --- | --- |
| 1 | **Landing + identity** | Open `site/index.html` on the projector machine → *Login* → extension approves → name/avatar appear. | Skip login; proceed anonymous (D-2/S5 fallback). Nothing downstream requires it. |
| 2 | **Create/join** | Machine A: *Play* → *Create match* → read the code aloud. Machine B: *Join* → paste → both screens draw opening hands; point at the face-down opponent hand and the matching `publicHash` badges. | Fallback 1: two browser windows on machine A (BroadcastChannel shim). Fallback 2: hotseat `play.html` — "same engine, same rules, transport demo after the break." |
| 3 | **Play the match** | 3–4 rehearsed turns: resource plays, a Broadcast attack — click the opponent's ineligible Avatar to show the engine *refuse* the block — damage, a scripted ability resolving. Narrate: "both machines run the identical engine; every click is a signed nostr event." | Desync banner appears → that IS the feature ("both sides detected divergence at the exact action — match void, transcripts kept"); then restart the match once, else switch to hotseat. |
| 4 | **Kill the tab** | Close the browser on machine B mid-turn. Reopen → rejoin with code → state rebuilt from the relay via `replay()` → play continues. | Skip silently — nothing else depends on it. |
| 5 | **Win + verify** | Finish the match; the verify panel shows "transcript replays clean" + head hash. One sentence on ranked-play trust (dual-signed results, authority key — post-demo). | Skip the panel; the win itself already landed. |
| 6 | **Booster** | Wallet on the phone → scan the 210-sat booster invoice from the mint page → settle (FakeNode script or real payment) → three cards fan out with artwork + a 30-sat change banknote. | Fallback 1: three singles (exists today). Fallback 2: show the pre-minted wallet state — "minted earlier, here are the chains" — and walk one genesis event. |
| 7 | **Melt (optional flourish)** | Melt one card in the wallet → 7603 closes the chain, artwork greys, sats land as a banknote. "Scarcity you can watch." | Skip; it is a flourish. |
| 8 | **Close** | `cards.html` gallery scroll (296 cards, search, filters) → `rules.html` → one line on the napplet/Blossom end-state. | This is all static and cannot fail; it is the closer precisely because of that. |

Rule for the presenter: every fallback above was rehearsed on Thursday. No beat gets
more than one retry on stage; the fallback is always taken on the second failure.

---

## 8. Post-demo backlog (named repayment slices)

In priority order, so Monday-after has a plan: P-1 DeckOracle v2 · P-3 Attach/Mesh
enforcement + keyword test coverage · P-2 delegation/signing hygiene · P-10 parser
fix + tier promotion (if S11 was cut) · P-4 booster commitment publishing + mint
Blossom client · P-6 NORD-01 conformance · P-5 authority-key results · P-8 flavour
rewrite review · P-9 dedicated relay, then the napplet WebRTC build
(`docs/multiplayer-architecture.md` P3).
