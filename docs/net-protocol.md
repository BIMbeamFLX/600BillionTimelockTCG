# 600B Timelock TCG — Table Transport v1

**Normative.** This document is the contract between `server/table.js` and any client
(`site/net.js`, the headless test clients, anything else). Where this document and the
code disagree, that is a bug in one of them — say which.

Status: implemented and tested as of 2026-08-01. Wire version `1`.

---

## 0. The split

The owner's binding architecture decision, honoured exactly:

| Channel | Carries | Never carries |
|---|---|---|
| **NOSTR** | match invite/accept handshake; the signed win/loss result | a move, ever |
| **SOCKET** | every play, live, low latency | identity claims the server trusts |
| **SQLITE** | the match transcript, one row per action | anything the engine can re-derive |

No move ever becomes a nostr event: it is slow, spams relays, publishes the whole match
to strangers and invites rate limiting. This restores `docs/napplet-spec.md`'s own
2026-07-28 lock.

**The server never opens a relay connection.** Only browsers do. Relay flakiness therefore
cannot touch the referee, and a bad day at `relay.damus.io` cannot kill the demo.

---

## 1. Topology

```
                    ┌──────────────────────────────────────┐
                    │  node server/table.js   (port 8777)  │
   browser A ─ws──▶ │  ├ site/engine.js  ← THE REFEREE     │ ◀─ws─ browser B
   (seat 0)         │  ├ full authoritative state          │       (seat 1)
                    │  ├ node:sqlite  server/matches.db    │
   relays ◀─────────┤  └ http static: site/ art/ cards/    ├─────────▶ relays
   (invite/accept/  │     THE SERVER NEVER TALKS TO A RELAY│  (invite/accept/
    result only)    └──────────────────────────────────────┘   result only)
```

One process, one port. `node server/table.js` is the only thing started on demo day — it
serves the static site too, so the separate `python -m http.server` leaves the runbook.

### Invariants (non-negotiable)

1. The server holds the only unredacted state and the only seeds. Clients receive
   `E.view(state, seat)` and `E.redactEvents(events, seat)`. Verified: **no** `rng[].s` — public
   or hidden — appears in any view, and the opponent's Wallet is uid shells with no `cardId`.
   The public seed used to ship whole for §18.4 audit; under a referee it is a live oracle for
   testing hidden-seed guesses against `gameId` and `deckCommit`, so audit moved entirely to
   the post-match `OVER` bundle.
2. Clients send **actions**, never state. Validation is `E.apply` and nothing else. The
   server contains **zero rules code** — it never inspects a card, a phase or a cost.
3. A desynced client is *corrected*, never trusted: every `REJECT` carries a fresh view.
4. There is no desync detection and no divergence banner. One referee, nothing to diverge.
5. `site/play.html` with no match in URL or localStorage opens no socket and plays hotseat
   offline from `file://`. The server is additive.

---

## 2. Wire protocol

One WebSocket per client. One connection = one match + one seat, fixed by the first
message. Path `ws(s)://<host>:8777/ws`, `perMessageDeflate: true`.

Every message is one JSON object with `t` and `v:1`. Unknown `t` → `ERROR{BAD_MESSAGE}`;
`v !== 1` → `ERROR{BAD_VERSION}`.

`v` is the **wire** version only. Engine/catalog agreement is separate: `STATE.catalogDigest`
must equal the client's `E.buildCatalog(E1_CARDS).digest`. Mismatch → refuse to play and say
so before the first click (`E.apply` would fail `CATALOG_MISMATCH` anyway, but later).

**No app-level ping.** The server pings every 15 s; browsers auto-pong; a socket that misses
two pongs (30 s) is terminated and the seat marked offline. This is the only reliable way to
notice a slept laptop, whose TCP connection dies silently and would otherwise look alive
forever.

### 2.1 Client → server (5 types)

**`CREATE`** — open a table, take seat 0.
```json
{"t":"CREATE","v":1,"name":"felix","affinity":"Power","pubkey":"<64-hex>|null"}
```
`affinity` ∈ `All|Power|Bitcoin|Keys|Signal|Timelock` (anything else is coerced to `All`).
Replies `STATE` with status `"open"`, `view:null`, `token` present. **No game exists yet** —
the deck is not dealt until seat 1 arrives, so an abandoned table costs nothing.

**`JOIN`** — take seat 1 by code.
```json
{"t":"JOIN","v":1,"code":"K7M2QF","name":"anna","affinity":"Signal","pubkey":"<64-hex>|null"}
```
The server mints seeds (§5.1), calls `E.createGame(config)`, persists, and sends `STATE` to
**both** sockets (status `"playing"`, `view` non-null).
Errors: `NO_SUCH_MATCH`, `MATCH_FULL`, `MATCH_OVER`, `DECK_BUILD_FAILED`.

**`ACT`** — the only in-play message.
```json
{"t":"ACT","v":1,"action":{
  "type":"PLAY_CARD","seat":0,"seq":41,"at":"",
  "payload":{"uid":"o13","targets":[{"kind":"object","uid":"o27"}]}}}
```
`action` is exactly what `play.js dispatch()` already builds — same five keys, same shapes.
The server forces `action.at = ""` defensively (it is hashed by `entryHash`; wall clock lives
in the non-hashed `entries.received_at`). Then, in full:
```js
const r = E.apply(full, action, { authenticatedSeat: conn.seat });
```
The engine raises `NOT_YOUR_SEAT` when `action.seat` disagrees with the socket and
`SEQ_MISMATCH` when the view is stale. **There is no server-side seat check and no
server-side ordering code.** Success → `FRAME` to both seats (different views); failure →
`REJECT` to the sender only.

**`RESUME`** — rejoin a seat.
```json
{"t":"RESUME","v":1,"matchId":"m_7f3a91c2","token":"<32-hex>"}
{"t":"RESUME","v":1,"matchId":"m_7f3a91c2","pubkey":"<64-hex>"}
```
Token wins; pubkey is the fallback for a wiped profile. See §4.

**`NOSTR`** — hand a signed event to the server for the record.
```json
{"t":"NOSTR","v":1,"role":"invite"|"accept"|"result","event":{ …signed nostr event… }}
```
Stored verbatim. **The server does not verify the schnorr signature** (§6.4). On
`role:"result"` the server recomputes agreement and broadcasts `NOSTR` to both.

### 2.2 Server → client (7 types)

**`STATE`** — full resync. Sent on `CREATE`, on `JOIN` (both seats), on `RESUME`. The only
message carrying whole history.
```json
{"t":"STATE","v":1,
 "matchId":"m_7f3a91c2","code":"K7M2QF","seat":0,"token":"<32-hex>",
 "status":"open"|"playing"|"over",
 "role":"seat"|"spectator","downgraded":false,"downgradeReason":null,
 "table":"ws://bitbeam.tail1a2b.ts.net:8777/ws",
 "ruleset":"E1.0","catalogDigest":"sha256:…",
 "players":[
   {"seat":0,"name":"felix","pubkey":"<64-hex>|null","affinity":"Power","online":true},
   {"seat":1,"name":"anna","pubkey":"<64-hex>|null","affinity":"Signal","online":false}],
 "view": null | { …E.view(state, seat)… },
 "events":[ …E.redactEvents(tail, seat), capped at 240… ],
 "full": true,
 "publicHash":"<64-hex>|null",
 "claimable": true,
 "result": null | {"winners":[0],"reason":"uptime","losers":[1]},

 // status = "over" only — the bytes to sign, repeated in EVERY state message:
 "resultContent":"…","resultTags":[…],"resultCreatedAt":1785310322,
 "transcriptHash":"<64-hex>","headHash":"<64-hex>",
 "verify":{"ok":true,"divergedAt":null,"headHash":"<64-hex>","error":null}}
```
`token` appears only in the first `STATE` of a connection and never for a spectator.
`full:true` = replace `session.events` wholesale. `view` is `null` while status is `"open"`.
For a spectator, `seat:null`, no `token`, and `view` = `E.view(state, null)` — **neither**
hand visible, not even as uid shells.

`claimable` is `true` while the table is open and seat 1 is free. A cold browser following the
host's share link carries no token and no pubkey, so it lands in the spectator downgrade — but
it is the person the host invited, and it came to play. `claimable` says the seat is there for
the taking; the client turns that into a prefilled Join, never into a second host panel.

**A finished match repeats its signable payload in every `STATE`.** These bytes used to exist
only in the single live `OVER`, so a seat that was disconnected when the match ended — or that
merely reloaded afterwards — could never rebuild them, its "Publish result" button never
appeared, and `agreement` could never leave `none`. They are persisted on the row, so a referee
restart cannot erase them either.

**`FRAME`** — one applied action. The hot path. ~4.6 KB raw, ~1 KB deflated.
```json
{"t":"FRAME","v":1,
 "seq":42,"by":0,
 "view":{ …E.view(state, seat)… },
 "events":[{"t":"DRAW","seq":42,"seat":0,"count":1,"uid":"o41","cardId":"E1-113"}],
 "entry":{"seq":41,"seat":0,"at":"","prev":"<64-hex>","stateHash":"<64-hex>","hash":"<64-hex>"},
 "publicHash":"<64-hex>"}
```
`seq` is `state.seq` **after** the action; `entry.seq` is the seq the action carried (one less).

`entry` deliberately **omits `action`**: an opponent's payload can name uids the viewing seat
is not entitled to (`DISCARD_TO_LIMIT`, `REVEAL`). The chain fields alone prove continuity;
the full transcript with actions arrives in `OVER`.

`events` are already redacted for the receiving seat — exactly the array `play.js` feeds
`describe()` today, so the log wording code is untouched.

**No deltas.** The whole view, every frame (D-13). Measured 4,639 B; a 300-action match ships
~1.4 MB raw, far less deflated, invisible over Tailscale. A patch format is a second
consistency system to get wrong before Friday.

**`REJECT`** — sender only.
```json
{"t":"REJECT","v":1,"seq":41,
 "code":"NO_PRIORITY","message":"you do not hold priority","detail":null,
 "view":{ …E.view(state, seat)… }}
```
`code`/`message`/`detail` are the engine's `result.error` **verbatim** — codes, never prose
the server invented. `view` is included unconditionally, so a desynced client is corrected in
the same message it is scolded by. `seq` echoes the action's seq.

**`PEER`** — presence. `{"t":"PEER","v":1,"seat":1,"online":false}`

**`OVER`** — sent to both immediately after the `FRAME` that produced the result, and **again
to any seat that `RESUME`s into a finished match**. A returning client receives the identical
bytes its opponent already signed; agreement is a string compare and must not depend on having
been connected at one particular instant.
```json
{"t":"OVER","v":1,
 "matchId":"m_7f3a91c2",
 "result":{"winners":[0],"reason":"uptime","losers":[1]},
 "headHash":"<64-hex>","publicHash":"<64-hex>","transcriptHash":"<64-hex>",
 "verify":{"ok":true,"divergedAt":null,"headHash":"<64-hex>","error":null},
 "config":{ …exact createGame argument, hidden seeds included… },
 "transcript":[{"seq":0,"seat":0,"at":"","action":{…},"prev":"g_…","stateHash":"…","hash":"…"}, …],
 "resultTags":[…], "resultContent":"…", "resultCreatedAt":1785310322}
```
`verify` is `E.verifyMatch({config, log})` run server-side **over what was persisted**, not
over memory — the trust beat computed from the DB.

`resultContent` is a **string** and `resultTags` a fixed array. Both clients sign these bytes
verbatim; that is what makes two independently signed results byte-comparable. Re-stringifying
a parsed object in two browsers is a needless risk. `config` + `transcript` let either client
run `E.verifyMatch` itself.

> `OVER` lands one tick after the winning `FRAME`. A client that wants to act on the end of
> the match must wait for `OVER`, not infer it from `view.result`.

**`NOSTR`** — result agreement broadcast.
```json
{"t":"NOSTR","v":1,"role":"result",
 "agreement":"none"|"pending"|"confirmed"|"disputed",
 "events":[{…signed…},{…signed…}]}
```
Sent to **both** seats, so a client must match on content rather than on "the next NOSTR".

**`ERROR`** — fatal for the attempted operation.
```json
{"t":"ERROR","v":1,"code":"…","message":"…"}
```

### 2.3 Duplicate and out-of-order actions — zero code

Handled entirely by the engine's existing `action.seq !== state.seq` check. A duplicate
delivery of an applied action is automatically `SEQ_MISMATCH`, never a double-play. **No
dedup layer, no message ids for ordering, no at-most-once machinery.** Additionally
`PRIMARY KEY (match_id, seq)` on `entries` means even a server bug cannot double-append the
chain. Both are covered by a test.

Client-side, `session.awaitingSeq` is set on send and refuses a second dispatch until
`FRAME` or `REJECT` clears it, so a double-click never even produces a visible `REJECT` flash.

### 2.4 Error codes

Engine codes pass through **verbatim** in `REJECT`: `SEQ_MISMATCH`, `NO_PRIORITY`,
`NOT_YOUR_SEAT`, `GAME_OVER`, `SCHEMA`, `WRONG_PHASE`, `WRONG_STEP`, `HAND_LIMIT`,
`CANNOT_AFFORD`, `CANNOT_ATTACK`, `TARGET_COUNT`, `UNKNOWN_OBJECT`, `NOT_IN_ZONE`,
`CATALOG_MISMATCH`, `MANUAL_CONSENT_PENDING`, `REDACTED_STATE`, …

Transport codes only ever appear in `ERROR`: `BAD_MESSAGE`, `BAD_VERSION`, `NO_SUCH_MATCH`,
`MATCH_FULL`, `MATCH_OVER`, `BAD_TOKEN`, `SUPERSEDED`, `CATALOG_MISMATCH`,
`DECK_BUILD_FAILED`, `RATE_LIMITED`.

One exception, and it is deliberate: `REJECT{code:"NOT_DURABLE"}` is emitted when the SQLite
transaction fails. It is not an engine code, but it *is* a rules-path refusal — the action was
legal and was still not played — so it belongs in `REJECT` where the client's existing
rejection handling will show it and re-render from the bundled view.

**Rules failures are never `ERROR`; transport failures are never `REJECT`.** On stage this
distinction says instantly whether the *rules* refused you or the *plumbing* did.

### 2.5 Rate limit

Two budgets, both per seat per 10 s. Exceeding either is `ERROR{RATE_LIMITED}` and close 4029.
The opponent is unaffected and the match stays playable.

| Budget | Default | Counts |
|---|---|---|
| `RATE_MAX` | 150 | **accepted** actions only, metered *after* `E.apply` agrees |
| `RATE_MAX_REJECT` | 400 | rejected actions — the runaway-loop guard, nothing more |

**A rejection must never cost a player their socket.** `CANNOT_AFFORD`, `NOT_RESOURCE` and
`WRONG_PHASE` are what browsing your own hand looks like on the wire: clicking each card in a
seven-card opening hand is seven rejections, and charging those to the action budget closed the
socket on a player for playing the game. Rejects are therefore metered separately and far more
loosely, and the check happens after the engine has ruled, never before it.

A successful `RESUME` clears both buckets for that seat. Otherwise the window survived the
disconnect and the first action on the fresh socket was `RATE_LIMITED` again for the rest of
the 10 s — kicked, reconnected, kicked again.

`RATE_MAX` (env) raises the action budget for headless soak runs, which act far faster than any
human. **Leave it unset for the demo** — the default is what protects the table.

### 2.6 HTTP (same process, same port)

```
GET /                      → site/index.html
GET /<path>                → static from site/ , and /art/ /cards/ /rules/ from the repo root
GET /api/health            → {"ok":true,"matches":3,"uptime":1820}
GET /api/tables            → [{matchId,code,name,pubkey,affinity,createdAt}]   (status='open')
GET /api/match/:matchId    → while status ≠ 'over':
                             {matchId, status, headSeq, headHash, publicHash}
                             once status = 'over':
                             {matchId, status, config, entries, result, verify,
                              transcriptHash, headHash, publicHash,
                              resultContent, resultTags, resultCreatedAt}
```

`/api/tables` is the **relay-free join path**: if every relay dies on stage, players still see
and join tables. Paths resolving outside the allowed roots are `403`, never read.

`/api/match/:id` is out-of-band verification, and **verification is a post-match act**.
While a match is live it returns only the four public chain fields. `config` carries the two
hidden seeds, which generate both decklists, both shuffles and every future draw — anyone
holding them can reconstruct the opponent's hand for the rest of the match — and a `matchId` is
not a secret: it is in every `STATE`, and while a table is open it is in `/api/tables`. The
transcript is gated with the config, because an opponent's actions are not public either.

Once the match is over the whole bundle is served, `resultContent`/`resultTags` included, so
the signed result is recoverable even from a cold page that held no socket when the match
ended.

---

## 3. Database

Node 24 `node:sqlite` (`DatabaseSync`) — no dependency. DDL is executed at boot with
`CREATE TABLE IF NOT EXISTS` and **inlined in `server/table.js`** (one fewer file to drift out
of sync with the code that reads it). Path `server/matches.db`, already covered by `*.db` in
`.gitignore`. Env: `PORT` (8777), `DB`, `PIN_SEED`, `RATE_MAX`, `PUBLIC_HOST`.

```
PRAGMA journal_mode = WAL;     -- survives a hard kill mid-write
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
```

| Table | Row | Notes |
|---|---|---|
| `matches` | one per table | `config_json` is the exact `E.createGame` argument — **it contains the hidden seeds and the per-seat deck-commitment salts**, which is precisely why it never leaves the server while a match is live (§2.6). `result_content` / `result_tags_json` / `result_created_at` hold the exact bytes both seats sign, so the closing beat survives a reload, a reconnect and a referee restart. `state_json` is the current authoritative state, overwritten each action (~25 KB per match, not per action). Seat columns rather than a seats table: there are exactly two seats and a join buys nothing at this size. While status is `'open'` `config_json` is `'{}'` — no game exists yet. |
| `entries` | one per **accepted** action | Exactly the entry object `site/play.js` already builds (`{seq,seat,at,action,prev,stateHash,hash}`), plus `public_hash` and `received_at`. `at` is **always** `''` because it is hashed; wall clock lives in `received_at`, outside the hash. Append-only: no UPDATE, no DELETE. `PRIMARY KEY (match_id, seq)`. |
| `rejects` | one per refused action | Never in the chain, never replayed. Kept because rejection rate is the cheapest cheat signal there is. |
| `nostr_events` | one per (match, role, pubkey) | Signed events verbatim. `role='result'` has one row per player — **enforced**, not assumed: a seat may only submit under its own pubkey, the two seats must hold different keys, and a result is refused before `status='over'` (§6.4). That is what makes confirmed/disputed a query rather than a special case. `sig_checked` is `0` in v1 and says so honestly (D-11). |

**Not created:** an `events` table (engine events are free — `E.replay(config, log)` returns
them deterministically and `E.redactEvents` re-derives any seat's log; storing them would be a
second source of truth for something the transcript already determines) · a `players`/`users`
table (the npub in the seat column is the identity) · a `results` table (`result_json` +
`verify_json` + two `nostr_events` rows *are* the result).

### 3.1 Write policy — one transaction per accepted action, **before** the FRAME

```js
db.exec("BEGIN IMMEDIATE");
try { insertEntry.run(…); updateHead.run(…); db.exec("COMMIT"); }
catch (err) { db.exec("ROLLBACK"); /* → REJECT{NOT_DURABLE}, state NOT advanced */ }
```

`node:sqlite` is synchronous, so durability-before-visibility costs one line of ordering.
**Anything the opponent has seen is already on disk.** If the insert throws, the in-memory
state is discarded and the sender gets a `REJECT` — that is what makes "SQLite is the single
source of truth" true rather than aspirational.

### 3.2 Agreement query

```sql
SELECT COUNT(*) AS n, COUNT(DISTINCT content) AS distinct_content
FROM nostr_events WHERE match_id = ? AND role = 'result';
```
`n=0` → `none` · `n=1` → `pending` · `n=2 AND distinct_content=1` → `confirmed` · else →
`disputed`.

---

## 4. Reconnect

**This is the feature most likely to be exercised live, so it is the simplest path in the
design: there is exactly one recovery mechanism, and it is the same one used for the very
first connection.**

### 4.1 Client state that survives a reload

```js
localStorage["600b:match"] = JSON.stringify({
  matchId:"m_7f3a91c2", seat:1, token:"<32-hex>", table:"ws://…/ws", code:"K7M2QF" });
```
Written on the first `STATE` of a match; cleared on "new match" or "leave table".

### 4.2 Sequence

1. **Page load.** `net.js` reads `600b:match`; if present it **auto-opens the socket, no
   click** — on stage the presenter should reopen the tab and see the board, not a dialog.
2. `onopen` → `RESUME`.
3. **Server resolves the match:** in memory → use it; not in memory (server restarted) →
   `JSON.parse(state_json)`, **one row read, instant**. If `state_json` is missing or
   unparseable, fall back to `E.replay(config, log)` and log a warning. `E.replay` is the
   VERIFICATION path, never the recovery path — recovery must not depend on 300 engine
   applications succeeding while an audience watches.
4. **Seat claim ladder** — strict priority order, evaluated on every `RESUME`:
   1. Valid `token` → seat granted **unconditionally**. Any socket currently holding that seat
      is sent `ERROR{SUPERSEDED}` and closed 4009. **Takeover, not refusal** — this one rule
      handles reload, sleep/wake, second tab and moving machines identically, and can never
      lock a player out of their own match on stage.
   2. No token, seat's `pubkey` matches, no live socket on it → granted, **fresh token
      issued**. Covers cleared localStorage / incognito.
   3. No token, seat never claimed → granted, token issued.
   4. Otherwise → **silently downgraded to spectator**, `downgraded:true`. **Never a hard
      error.** A stranger clicking the link mid-match becomes an audience member, not a crash.
      (An unknown `matchId` *is* `ERROR{NO_SUCH_MATCH}` — there is nothing to spectate.)
5. Server replies `STATE` with `full:true`; broadcasts `PEER{online:true}` to the opponent.
6. Client replaces `session.full` and `session.events`, clears `awaitingSeq`/`picking`/
   `attackers`/`blocks`, renders. Play continues mid-turn.

**No delta protocol, no "give me from seq N", no per-seat event table.** The full view is
idempotent and small enough (4.6 KB) that resending everything is both correct and faster to
write than any resume-from-offset scheme.

### 4.3 Dropped socket, page still open

`net.js` backoff: 250 → 500 → 1000 → 2000 → 4000 ms cap, ±20 % jitter, **forever, no give-up
state and no dialog**. A "reconnecting…" chip appears in the header; the board stays on screen
(stale but readable) rather than blanking. Each attempt is the identical `RESUME`.

**Outbound actions while disconnected are dropped, not queued** — their `seq` has almost
certainly moved and they would be rejected anyway. Dropping is honest and one line; the fresh
`STATE` drives whatever comes next.

### 4.4 Opponent disconnects

`PEER{online:false}` → "anna disconnected — waiting". **Nothing is voided, no timer, no
auto-forfeit.** A sleeping laptop must not be able to lose or void a match. The state sits on
the server; when she returns, `PEER{online:true}` and frames resume. After 90 s the surviving
client *may* offer a **"claim the win" button — never automatic.** An auto-forfeit firing on
stage because a laptop slept is unrecoverable theatre; a button is a decision someone made.

### 4.5 Stale client

`REJECT{SEQ_MISMATCH}` carrying a fresh view; self-corrects in one round trip. **Zero code** —
`E.apply` already enforces `action.seq === state.seq`.

### 4.6 Server restart

Covered by 4.2(3). Both clients' loops are already retrying and land on the rehydrated match.
Nothing is lost because every accepted action was committed before it was acknowledged. A
crash is invisible past a ~1 s blip; the resumed view is byte-identical (tested).

The in-memory redacted-event ring is empty after a restart; it is refilled during boot recovery
from `E.replay(config, log)`. If that is slow or fails, the log is served empty — the *board*
is correct, only the scrollback is short.

### 4.7 Not built

Spectator tokens (spectators are anonymous and read-only) · match resume across different table
URLs · seat handover · two-tabs-of-one-seat playing simultaneously (the second wins, which is
right for a human at one keyboard and wrong for an adversary — fixed later by signature
verification).

---

## 5. Match creation

### 5.1 The Stake landmine (D-12)

`E.createGame` **throws** when the auto-built deck contains a Stake card and the Stake module
is off (`SCHEMA: Stake Swap needs the Stake module (§19.1)`). Measured over 25 random seeds per
affinity on Node v24.15.0:

| Affinity | Succeeds |
|---|---|
| Power, Bitcoin, Signal, Timelock | 25 / 25 |
| All | 21 / 25 |
| **Keys** | **9 / 25** |

A Keys table therefore fails to create on roughly two thirds of random seeds. Mitigation, all
three:

- **(a)** `mintGame` re-rolls the seeds up to 40 times, so the failure can never reach a
  client. Exhausting all 40 is `ERROR{DECK_BUILD_FAILED}`, never a crash.
- **(b)** `PIN_SEED` forces the rehearsed demo seed and is **tried first**, so a narrated
  opening is reproducible. The three streams are **derived by hash** —
  `sha256(pin + ':public' | ':0' | ':1')`, each folded to 31 bits — never by adjacency.
  `hidden = [pin+1, pin+2]` meant that knowing the public seed gave you both hidden ones by
  addition, and the public seed was in every seat's own view. The deal is unchanged for a
  given pin, so the rehearsal still holds.
- **(c)** Keep Keys off the demo decks unless the pinned seed is proven good.

**Deck commitments are salted.** `mintGame` generates a random per-seat salt, passes it as
`seats[].salt`, and it lives in `config_json` — server-side until the match is over. §3.4's
`deckCommit` ships in every view, and unsalted it was a free verification oracle: a 31-bit
hidden seed can be brute-forced offline (measured 2,667 candidates/s single-core through the
full `createGame` path) and *confirmed* against the published commitment, so the seeds carried
only ~31 bits of real secrecy. Salted, the commitment still proves the deck was fixed before
play and reveals nothing during it — and because the salt is part of the config, `gameId`
(a hash over the whole config) stops being an oracle too. The salt is published with the config
in the post-match `OVER` bundle, which is when opening the commitment is the point.

This is a workaround. The underlying bug is that `buildDeckList` does not filter Stake cards
when the Stake module is off — **P-12** is a one-line engine fix. `tests/js/seeds.test.mjs`
guards both the landmine and the workaround, and will start failing the day P-12 lands (which
is the signal to delete the re-roll).

---

## 6. Nostr

Two kinds. Content is always a JSON string with `"v":1` and `"kind"`, so the payload versions
independently of the event kind.

### 6.1 Kind 4600 (regular) — INVITE and ACCEPT

Regular, **not** ephemeral (2xxxx). Ephemeral is semantically nicer for an invite, but relays
do not store it, so a guest who opens the lobby thirty seconds late sees nothing. On demo day
retrievability beats purity; a NIP-40 `expiration` tag recovers most of the hygiene. One kind
for both directions, discriminated by `["t", …]` so `#t` filtering works.

**INVITE** (host, seat 0):
```json
{"kind":4600,"pubkey":"<host hex>","created_at":1785308640,
 "tags":[["t","invite"],["m","m_7f3a91c2"],
         ["p","<guest hex>"],                    // OMIT ENTIRELY for an open table
         ["expiration","1785312240"],            // NIP-40, created_at + 3600
         ["alt","600B Timelock TCG match invite"]],
 "content":"{\"v\":1,\"kind\":\"invite\",\"matchId\":\"…\",\"code\":\"K7M2QF\",\"table\":\"ws://…/ws\",\"host\":{\"name\":\"felix\",\"affinity\":\"Power\"},\"ruleset\":\"E1.0\",\"catalogDigest\":\"sha256:…\",\"wire\":1}"}
```
The load-bearing field is `table` — the invite is what tells the guest which referee to socket
into. That is nostr doing its one job on the way in: discovery and consent.

Content is plaintext. An invite is not secret; a `p` tag makes it *addressed*, not *private*.

**ACCEPT** (guest, seat 1): same kind, `["t","accept"]`, plus `["e","<invite id>"]`.

Guest lobby subscription:
```json
["REQ","inv",{"kinds":[4600],"#t":["invite"],"#p":["<my hex>"],"since":<now-3600>,"limit":20}]
```
Incoming payloads are **untrusted**: validate `v`, the `matchId` shape, and that `table` uses
scheme `ws:`/`wss:` before offering the row.

### 6.2 Kind 31600 (addressable) — RESULT

Addressable with `d = matchId`, so each player has exactly one canonical result per match and
can correct it by republishing. Tags and content are `OVER.resultTags` / `OVER.resultContent`
**verbatim** — identical for both signers, so the only differences between the two events are
`pubkey`, `id`, `sig`.

`["winner","<winner hex>"]` is replaced by `["outcome","draw"]` with **no** `winner` tag when
`result.winners` is empty.

`resultContent` decodes to:
```json
{"v":1,"kind":"result","matchId":"…","gameId":"g_…",
 "ruleset":"E1.0","catalogDigest":"sha256:…","topology":"table","wire":1,
 "players":[{"seat":0,"pubkey":"…|null","name":"felix","affinity":"Power"}, …],
 "winners":[0],"losers":[1],"reason":"uptime","turns":9,"actions":214,
 "publicHash":"…","transcriptHash":"…","headHash":"…",
 "startedAt":"…","endedAt":"…"}
```

> **`winners` is an ARRAY, not a scalar `winnerSeat`.** `state.result` is
> `{winners, reason, losers}` and the engine produces `{"winners":[],"reason":"draw","losers":[0,1]}`
> on a simultaneous loss. A singular field cannot represent a legal outcome.

### 6.3 The three hashes, and which one means "agree"

A correctness rule, not a preference. Under split hidden streams two peers hold legitimately
different full states, so `hashState` **cannot** be compared across seats.

| Field | Definition | Role |
|---|---|---|
| `publicHash` | `E.publicHash(finalState)` — the intersection of `view(s,0)` and `view(s,1)` | **Cross-topology comparable. Agreement field.** |
| `transcriptHash` | `sha256hex(canonicalJSON(log.map(e => ({seq,seat,at,action}))))` | Comparable; makes the transcript tamper-evident on disclosure. **Agreement field.** |
| `headHash` | last `entries.hash` (chain head) | Server-refereed audit only. **Never used for agreement.** |

**Agreement predicate (normative):** two kind-31600 events for the same `matchId` agree iff
`{matchId, gameId, winners, losers, reason, turns, publicHash, transcriptHash}` are deep-equal.
Agree → `confirmed`; differ → `disputed`, both shown; one present → `pending`.

Getting this wrong would produce a leaderboard that marks correct P2P matches as disputed the
day the napplet ships, which is why `publicHash` + `transcriptHash` are implemented now even
though the table topology could get away with `headHash`.

### 6.4 Signature verification — the honest limitation (D-11)

The server does **not** verify schnorr signatures in v1. secp256k1 schnorr is not in
`node:crypto`, and adding a curve dependency days before a demo is unjustified risk. Therefore:

- Seat authentication at the table is the **server-issued token**, full stop.
- The npub shown at the table is a **claim**; `nostr_events.sig_checked = 0` records that
  honestly.
- Cryptographic binding happens where it matters: each player signs their own 31600 with their
  own key, published to relays where anyone can verify.
- Impersonation on reconnect — the property that actually matters live — is blocked by the
  token, not the signature.

**What makes `agreement` trustworthy in v1 is seat binding, not signature verification.**
Since no signature is checked, a `NOSTR` frame is only as good as the connection it arrived on,
so the server binds every event to the sending seat:

1. A seat may submit events **only under its own pubkey**. Without this, one seat could store a
   row attributed to its opponent and drive `agreement` to `confirmed` — or to `disputed` — on
   its own, and the lobby renders that verdict verbatim.
2. A seat that sat down anonymously **claims a key on first use**: the first pubkey it speaks
   under becomes that seat's key, is persisted, and every later event must match it. Signing in
   only when there is finally something to sign is a normal order of events, and the seat is
   already authenticated by its token, so nobody else can do the claiming.
3. The two seats must hold **different** keys. `nostr_events` is keyed on
   `(match_id, role, pubkey)`, so two seats sharing a key would collapse two results into one
   row.
4. `role:"result"` is refused unless `status = 'over'`. There is no result before there is a
   result.

Together these cap `nostr_events` at three rows per match — one invite, one accept, one result
per seat — and make `confirmed` mean what the lobby says it means: *both seats said the same
thing.* That is an enforced constraint, not an assumption.

**P-11:** `@noble/curves`, verify the accept event at join, require its `pubkey` to match the
seat.

### 6.5 Flow and popup budget

| Step | Popups |
|---|---|
| Host: Create → `STATE` → sign invite → publish → `NOSTR{invite}` | 1 |
| Guest: see invite (or type the code) → `JOIN` → `STATE` → sign accept → publish | 1 |
| **Play: ZERO nostr, ZERO popups.** Every action is an `ACT` frame. | 0 |
| End: `OVER` → "Publish result" → sign 31600 → publish → agreement broadcast | 1 |

**Three popups per player per match, none during play.** That is the whole point of the
owner's split and it is worth one sentence on stage. It also makes delivery-plan S5's
per-match session-key delegation unnecessary — that slice existed only to dodge per-move
popups that no longer exist.

### 6.6 Critical design rule — nostr is the announcement, never the gate

The match is created, joined, played and finished entirely over the socket + the 6-character
code. Every nostr step is fire-and-forget and failure-tolerant: no extension, a rejected popup,
or three dead relays degrades the beat to "anonymous seats, no published result" and the game
continues untouched.

Note the ordering: **the table exists on the server before the invite is published.** A relay
failure can never block a match starting.

---

## 6a. The browser client

Three files, no framework and no build step. `site/net.js` is the wire; `site/play.js` is the
board and the lobby; `site/play.html` carries both.

### The seam

`play.js` renders `view(full, uiSeat(full))` and always did, so the fog-of-war path has been
exercised by every frame of the local hotseat since before there was a network. Pointing
`session.full` at a server-sent **view** therefore changes almost nothing:

| Field | Meaning |
|---|---|
| `session.seat` | `null` = hotseat, `0\|1` = a referee has seated us. **Every remote branch keys off exactly this**, which is why the local game is preserved by construction rather than by care. |
| `session.role` | `hotseat` \| `seat` \| `spectator` |
| `session.awaitingSeq` | set when an action goes out, cleared by the `FRAME` or `REJECT` that answers it — a double-click cannot produce two actions |

Two helpers carry the whole difference:

- **`uiSeat(s)`** — for a redacted state it returns `s.forSeat` (a spectator is shown seat 0's
  side). This is a **lock, not a preference**: `E.view(v, otherSeat)` throws `REDACTED_STATE`,
  so a state redacted for seat N can only ever be rendered as seat N.
- **`viewNow()`** — hotseat redacts the full state; a remote seat renders the referee's view
  as-is. `view()` is idempotent for the same seat, so this is one code path, not two.

`dispatch()` gains two early branches: a spectator is refused in plain English (without them it
falls through to `E.apply` and is told "apply() refuses a redacted state" — correct and
useless), and a remote seat sends the action and waits. The local `E.apply` path below is
untouched and still runs the hotseat game.

`advance()`'s triggers branch reads `full.myTriggers || full.pendingTriggers[seat]`, so one
branch serves both modes — see §7 of the build spec for why `view()` had to grow `myTriggers`.

### Offline is an invariant, not a fallback

**`net.js` opens no socket unless the page already holds a match (localStorage `600b:match` or
`?match=`) or the player clicks Create/Join.** From `file://`, `tableUrl()` returns `null`, the
lobby's buttons are disabled and say why, and `play.html` is a hotseat table with no network
code running at all. `tests/js/client.test.mjs` asserts zero `WebSocket` constructions on that
path, because a future "just connect on load" convenience would break it silently.

### Reconnect, from the client side

`localStorage["600b:match"] = {matchId, seat, token, table, code}`, written on the first
`STATE`. On load, a saved match **auto-opens the socket with no click** — on stage the presenter
reopens the tab and sees the board, not a dialog. Backoff 250→4000 ms, ±20 % jitter, forever, no
give-up state: the chip reads "reconnecting…" and the board stays on screen, stale but readable,
rather than blanking. Outbound actions while disconnected are **dropped, not queued** — their
`seq` has moved and the fresh `STATE` drives whatever comes next.

Close code **4009 (`SUPERSEDED`) does not retry.** Without that rule two tabs sharing one
origin's localStorage evict each other forever. `ERROR{NO_SUCH_MATCH|BAD_TOKEN|MATCH_OVER}`
clears the stored credential and stops, so a stale match against a fresh database cannot loop.

`Ctrl+Alt+R` forces a `RESUME` — the panic button the runbook asks for.

### Lobby

A **panel inside `#setup`**, never a separate page: a navigation mid-demo loses the socket and
the seat. Create / join-by-code / `GET /api/tables` / relay invites, plus NIP-07 sign-in reusing
`index.html`'s `getPublicKey()` and its bech32 encoder (copied, not refactored — deduplicating a
working login days before a demo is not a trade worth making; `net.js` adds the *decoder* so
"challenge an npub" accepts what humans actually hold).

**Invites off relays are untrusted input**: `parseInvite` validates `v`, the `matchId` and `code`
shapes and that `table` uses scheme `ws:`/`wss:` before a row is ever offered — that field
decides where our socket goes.

**Invites never advertise a loopback address.** The referee's `STATE.table` defaults to
`ws://localhost:<port>/ws`; published as-is, the guest's client would dial its own machine and
fail silently. `net.publicTable()` prefers a non-loopback advertised URL, then the URL we
ourselves connected through, and the lobby **refuses to publish** a loopback invite with a
message naming `PUBLIC_HOST`.

### What the client verifies for itself

`OVER` carries `config` (hidden seeds included) and the full `transcript`, so the client re-runs
`E.verifyMatch` against the referee's own bytes rather than taking `verify.ok` on trust. Observed
in-browser: client verify `ok`, and tampering with one transcript entry is caught at exactly that
index.

> **Field-name collision, unresolved.** `OVER.headHash` (and `resultContent.headHash`) is the
> last `entries.hash` — the chain head. `OVER.verify.headHash` is `E.verifyMatch`'s return, which
> is `hashState(finalState)` — the head *state* hash. Both are correct; they are different
> quantities wearing one name in one JSON object, and the next reader will call it a bug. Neither
> is an agreement field (§6.3), so nothing is broken today. Rename one before anyone builds on it.

---

## 7. Demo-day runbook delta

- **One command:** `node server/table.js` (or `npm run table`). It serves `site/`, `art/`,
  `cards/`, `rules/` and the socket on port 8777. Remove the separate `python -m http.server`.
- **Check port 8777 is free first.** On Windows a process bound to `127.0.0.1:8777` shadows one
  bound to `0.0.0.0:8777` for loopback connections, and both bind without an error — so a
  leftover `python -m http.server` will silently serve 404s to a locally-opened tab while the
  table looks healthy in its own log. `netstat -ano | findstr :8777` before starting, and use
  `PORT=` if in doubt.
- Bind `0.0.0.0`; reach it over **Tailscale**, never venue wifi. Set `PUBLIC_HOST` so the
  `table` field in `STATE` and invites points at the Tailscale name.
- Keep the table terminal beside the `git checkout demo-safe-v1` terminal.
- **Fallback ladder, in order:** relay invite → read the 6-character code aloud →
  `GET /api/tables` → local hotseat on `play.html` (which never stopped working).
- Pin the rehearsed seed via `PIN_SEED`. **Leave `RATE_MAX` unset for the demo** — the default
  is what protects the table, and no human comes near it.
- `scripts/demo-two-clients.mjs` is the exception: it is a headless client acting at ~100
  actions/second, which is exactly the traffic the budget exists to bound. Start the referee with
  `RATE_MAX=100000` when running it, as `tests/js/net.test.mjs` already does in-process.

---

## 8. Tests

Run with the **file/glob form** — `node --test tests/js/` (directory form) fails on Windows.

| File | Covers |
|---|---|
| `tests/js/engine.test.mjs` | 33 — the original 32 plus `myTriggers` redaction (own seat only; a spectator gets `[]`) |
| `tests/js/client.test.mjs` | 10 — `site/net.js` loaded against a stubbed `file:`/`http:` environment: **zero sockets from `file://`**, `NO_TABLE` instead of a stack trace, auto-resume only with a saved match, `?table=` override, no loopback in a published invite, npub round trip, invites-are-untrusted, and the versioned 4600/31600 payloads. Plus two `site/play.js` lobby tests against a stub DOM: the share link offers a Join rather than the host panel, and a finished match is publishable from a `STATE` alone |
| `tests/js/net.test.mjs` | 16 in-process integration tests: two views of one state; server-enforced fog of war (no seed of any kind in any view); engine error codes in `REJECT`; duplicate `ACT` → `SEQ_MISMATCH` with one chain row; a full match to a result with replay + verify + tamper detection; `RESUME` by token; takeover and spectator downgrade; kill-and-rebuild crash recovery; nostr storage, seat binding and agreement; anonymous claim-on-first-use; a finished match still signable after reload/reconnect/restart; HTTP endpoints, traversal, and the live-match config gate; rejected clicks are free while a runaway loop is still closed; one connection cannot hold both seats; the share link offers the free seat; and no seat can attack from its Wallet over the wire |
| `tests/js/seeds.test.mjs` | the Stake landmine and the `mintGame` re-roll, every affinity |
| `scripts/demo-two-clients.mjs` | the out-of-process proof against a **running** `node server/table.js` |

---

## 9. Demo debt

**Retired:** **D-1** — hidden information was UI-side only because the peer topology had to
ship both seeds to both clients; a referee does not, and **no** `rng[].s`, public or hidden,
is present in any view. **D-2** is moot for this topology: three signing popups per match, none during
play, so the ad-hoc session key is not needed at all.

| ID | Debt | Why acceptable | Repayment |
|---|---|---|---|
| **D-11** | No schnorr verification; the npub at the table is a claim (`sig_checked = 0`). Seat auth is the token. | Events are public on relays where anyone can verify; the property that matters live — reconnect impersonation — is blocked by the token. | **P-11:** `@noble/curves`, verify the accept event at join. |
| **D-12** | `createGame` throws on Stake cards; worked around with a 40-attempt re-roll and a pinned seed. Keys fails ~16/25 seeds. | The re-roll makes it invisible to clients; the pinned seed makes the demo deterministic. | **P-12:** filter Stake cards in `buildDeckList` when the module is off. |
| **D-13** | Full view resent every frame; no deltas. | 4.6 KB measured, ~1 KB deflated, invisible on LAN/Tailscale. Deletes the entire "client applied a delta wrong" bug class. | **P-13:** deltas, purely additive to the message vocabulary. |
| **D-14** | The referee is a single point of failure; the peer/napplet topology is deferred. | Instant `state_json` recovery + a forever-retrying client. The engine is unchanged, so the P2P path remains reachable. | **P-14:** the WebRTC NAP per `multiplayer-architecture.md`. |
| **D-15** | Seat takeover: a valid token always wins and evicts the older socket. A leaked token is a stolen seat. | The realistic stage failure is a stale tab holding your seat hostage, which is strictly worse on a LAN where the token never left the machine. | **P-15:** the same signature verification as P-11. |

**D-9** narrows: the transport is now relay-agnostic *and* relay-optional — the server never
opens a relay connection at all.
