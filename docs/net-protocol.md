# 600B Timelock TCG — Table Transport v1

**Normative.** This document is the contract between `server/table.js` and any client
(`site/net.js`, the headless test clients, anything else). Where this document and the
code disagree, that is a bug in one of them — say which.

Status: implemented and tested as of 2026-08-15 — 228 JS tests, all passing (§8). Wire version `1`.

---

## 0. The split

The owner's binding architecture decision, honoured exactly:

| Channel | Carries | Never carries |
|---|---|---|
| **NOSTR** | invite/accept handshake; the dual-signed match **start**; the signed win/loss result | a move, ever |
| **SOCKET** | every play, live, low latency | identity claims the server trusts |
| **SQLITE** | the match transcript, one row per action | anything the engine can re-derive |

Every match is now announced at **both** ends: a kind 4600 `t=start` event signed by each seat
before a card is played, and the kind 31600 result signed by each seat after. Opening bracket,
closing bracket, four signatures, and nothing in between — which is what makes a stake
meaningful (§6.7) and a ladder computable from relays alone.

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
    start/result)   └──────────────────────────────────────┘   start/result)
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

### 2.1 Client → server (9 types)

**`AUTH`** — answer the connection's one-use NIP-42 challenge with a NIP-07 signature.
The client sends no table intent before `AUTH_OK`.
```json
{"t":"AUTH","v":1,"event":{"kind":22242,"pubkey":"<64-hex>",
 "created_at":1785310322,"tags":[["relay","ws://table.example/ws"],["challenge","<64-hex>"]],
 "content":"","id":"<64-hex>","sig":"<128-hex>"}}
```
The referee verifies the canonical event id, BIP-340 Schnorr signature, exact relay and
challenge tags, kind `22242`, empty content, and a timestamp within ten minutes. The challenge
is bound to one connection and consumed on success. Invalid, stale or replayed proof →
`ERROR{AUTH_FAILED}`. `CREATE`, `JOIN` and `RESUME` before successful authentication →
`ERROR{NIP07_REQUIRED}`.

**`CREATE`** — open a table, take seat 0.
```json
{"t":"CREATE","v":1,"name":"felix","affinity":"Power","pubkey":"<64-hex>","stake":2100}
```
`affinity` ∈ `All|Power|Bitcoin|Keys|Signal|Timelock` (anything else is coerced to `All`).
`stake` is the wager in sats and is optional — see §2.1a. It is stored on the match row.
Replies `STATE` with status `"open"`, `view:null`, `token` present. **No game exists yet** —
the deck is not dealt until seat 1 arrives, so an abandoned table costs nothing.
The authenticated connection pubkey is authoritative. If the compatibility `pubkey` field is
present it must match that identity; it is never trusted as proof by itself.

**`JOIN`** — take seat 1 by code.
```json
{"t":"JOIN","v":1,"code":"K7M2QF","name":"anna","affinity":"Signal","pubkey":"<64-hex>","stake":2100}
```
The server mints seeds (§5.1), calls `E.createGame(config)`, persists, and sends `STATE` to
**both** sockets (status `"playing"`, `view` non-null).
Errors: `NIP07_REQUIRED`, `NO_SUCH_MATCH`, `MATCH_FULL`, `MATCH_OVER`, `STAKE_MISMATCH`,
`DECK_BUILD_FAILED`.

**Nobody is dealt into a wager they did not accept.** A guest that states a `stake` is stating
the one it was *shown*; if the table's figure has changed since, or the link was passed around
with a different number attached, the join is `ERROR{STAKE_MISMATCH}` naming the table's actual
figure — never a quiet binding to the host's number. Omitting `stake` still works and means
"whatever the table says", which is the right default for the relay-free code-reading path.

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
{"t":"RESUME","v":1,"matchId":"m_7f3a91c2","token":"<32-hex>","pubkey":"<64-hex>"}
{"t":"RESUME","v":1,"matchId":"m_7f3a91c2","pubkey":"<64-hex>"}
```
Successful connection authentication is mandatory. A token is accepted only with the same
authenticated pubkey that owns the seat; the signed pubkey alone is the fallback for a wiped
profile. See §4.

**`QUEUE`** — join the matchmaking line. There is no table to name and no code to read aloud.
```json
{"t":"QUEUE","v":1,"name":"felix","affinity":"Power","pubkey":"<64-hex>","stake":2100}
```
`pubkey` is optional and, as everywhere, only ever a cross-check: present, it must equal the
authenticated identity or the message is `ERROR{IDENTITY_MISMATCH}`. Unauthenticated →
`ERROR{NIP07_REQUIRED}`. Sent while **seated at a live match** → `ERROR{MATCH_FULL}` ("leave
your current match before queueing") — a second board would be dealt to a connection that can
only show one. Queueing again while already queued is not an error: it updates `name`,
`affinity` and `stake` in place and keeps the position. Reply is `QUEUED`, or — if a compatible
partner is waiting — `STATE` for a match that is already dealt. **The queue pairs on the wager**
(§5.2). See §2.1a.

**`UNQUEUE`** — leave the line. Always answered with `QUEUED{queued:false}`, even if the sender
was not in it, so the client never has to guess whether its "searching" chip should clear.

**`LEAVE`** — leave the queue *and* detach from the table, in that order, in one message.
```json
{"t":"LEAVE","v":1}
```
Always answered with `QUEUED{queued:false}`. Then, if the sender holds **seat 0 of an `open`
table with no guest**, the match row is `DELETE`d, spectators are sent
`ERROR{NO_SUCH_MATCH}`, and the code stops resolving. **An open table nobody sits at is a
trap, not a table** — the next player joins it and waits for a host who went to lunch, which
is precisely the failure `/api/tables` used to advertise all day.

A `playing` match is only **detached**: the seat still belongs to that identity, the row keeps
its status, the transcript is untouched, and the opponent gets `PEER{online:false}` rather than
a phantom victory. The way to end a game is to concede it, which is an engine action like any
other. Leaving is a real message and not merely a closed socket, because from the far end those
two look identical and mean opposite things.

**`NOSTR`** — hand a signed event to the server for the record.
```json
{"t":"NOSTR","v":1,"role":"invite"|"accept"|"result","event":{ …signed nostr event… }}
```
**Verified, then stored verbatim.** The referee recomputes the event's canonical id from its
own bytes and verifies the BIP-340 signature before any row exists; either check failing is
`ERROR{BAD_MESSAGE}` and nothing is written (§6.4). It further refuses an event whose pubkey is
not the sender's own seat key, and `role:"result"` before `status = 'over'`. On an accepted
`role:"result"` the server recomputes agreement and broadcasts `NOSTR` to both.

### 2.1a `stake` — the one field that means money

`CREATE`, `JOIN` and `QUEUE` all accept it, and the rules are identical everywhere:

- **A whole number of sats or nothing.** `cleanStake` floors to an integer, and anything not a
  positive integer — `0`, `-1`, `1.5`, `"lots"`, `NaN`, absent — becomes **`0`**, which means a
  friendly game. There is no null stake and no undefined stake on the row.
- **Capped at 1 000 000 sats.** Deliberately low. A fat finger on a stake field is a worse
  experience than a low ceiling, and the referee is recording a promise **it can neither enforce
  nor refund** (§6.7) — it has no business recording life savings.
- **Stored on the match row**, so it survives a referee restart, and echoed in every `STATE` as
  `stake`. A player can always see the wager they are in without trusting their memory of what
  they typed, and both clients sign byte-identical start announcements because the number comes
  from the row rather than from either browser (§6.1a).
- `0` is a first-class value, not a missing one: friendlies pair with friendlies.

**The referee never holds, escrows, moves or refunds a single sat.** It records a number two
identities agreed on, and that is the entire extent of its involvement. Settlement is §6.7.

### 2.2 Server → client (10 types)

**`AUTH`** — sent immediately after the WebSocket opens.
```json
{"t":"AUTH","v":1,"challenge":"<64-hex>","relay":"ws://table.example/ws",
 "kind":22242,"expiresIn":600}
```

**`AUTH_OK`** — the proof was verified; the client may now send its pending table intent.
```json
{"t":"AUTH_OK","v":1,"pubkey":"<64-hex>","eventId":"<64-hex>",
 "active":[{"matchId":"m_7f3a91c2","code":"K7M2QF","status":"playing","seat":0,
            "opponent":"anna","opponentOnline":true,"updatedAt":"2026-08-15T18:32:11.004Z"}]}
```
**Signing in IS the session.** `active` is every unfinished match — `status IN ('open','playing')`
— that this npub holds a seat at, newest first, capped at 10, answered from the database so it
survives a referee restart. `opponentOnline` is the one field the row cannot know and comes from
the live connection map.

A seat token lives in one browser; the seat itself belongs to an **identity**. Before this, a
cleared profile, a private window or simply a second machine meant the match was unreachable —
the row was still there, still `playing`, and nothing the player held could name it. Now the
greeting names it, and `RESUME` with that `matchId` and **no token** walks the ordinary claim
ladder (§4.2, rung 2): same pubkey, no live socket on the seat, seat granted and a fresh token
issued. No new mechanism, no recovery mode, no support flow.

A finished match is never listed. A concluded game is history, not somewhere to return to.

**`STATE`** — full resync. Sent on `CREATE`, on `JOIN` (both seats), on `RESUME`. The only
message carrying whole history.
```json
{"t":"STATE","v":1,
 "matchId":"m_7f3a91c2","code":"K7M2QF","seat":0,"token":"<32-hex>",
 "status":"open"|"playing"|"over",
 "createdAt":"2026-08-15T18:24:02.117Z","stake":2100,
 "role":"seat"|"spectator","downgraded":false,"downgradeReason":null,
 "table":"ws://bitbeam.tail1a2b.ts.net:8777/ws",
 "ruleset":"E1.0","catalogDigest":"sha256:…",
 "players":[
   {"seat":0,"name":"felix","pubkey":"<64-hex>","affinity":"Power","online":true},
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

`createdAt` is the **match row's** ISO timestamp, not the connection's. It is in every `STATE`
for one reason: both seats sign a kind 4600 start announcement over byte-identical content
(§6.1a), and two independently signed events are only comparable if the timestamp comes from
the match rather than from whichever browser happened to click first. A clock is a source of
divergence; the referee's row is not. `stake` (§2.1a) is in every `STATE` for exactly the same
reason, plus one more: **a player must always be able to see the wager they are in** without
trusting their own memory of what they typed into a lobby field.

`claimable` is `true` while the table is open and seat 1 is free. A signed-in cold browser
following the host's share link carries no token, so it lands in the verified-spectator
downgrade. `claimable` says the seat is there for the taking; the client turns that into a
prefilled Join, never into a second host panel. Without a NIP-07 identity the client does not
open the socket.

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

**`QUEUED`** — where you stand in the matchmaking line.
```json
{"t":"QUEUED","v":1,"queued":true,"position":2,"waiting":5}
```
`queued` is `false` with `position:null` when you are not in the line — the answer to `UNQUEUE`
and to `LEAVE`, sent whether or not you were actually queued. `position` is 1-based; `waiting`
is the whole line's length.

**Re-sent to everyone still waiting whenever the queue changes** — a join, an unqueue, a
dropped socket, a pair leaving to play. **A queue you cannot see move is indistinguishable from
a queue that is broken**, and a player watching a frozen number leaves.

Pairing does not produce a final `QUEUED`; it produces `STATE` with `status:"playing"` and a
`view` already dealt. The client treats a `STATE` as ending the search.

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

Transport codes only ever appear in `ERROR`. The complete set the referee emits:
`BAD_MESSAGE`, `BAD_VERSION`, `AUTH_FAILED`, `NIP07_REQUIRED`, `IDENTITY_MISMATCH`,
`NO_SUCH_MATCH`, `MATCH_FULL`, `MATCH_OVER`, `STAKE_MISMATCH`, `SUPERSEDED`,
`DECK_BUILD_FAILED`, `RATE_LIMITED`.

`BAD_TOKEN` is **not emitted by this server**. `net.js` still treats it — alongside
`NO_SUCH_MATCH` and `MATCH_OVER` — as "drop the stored credential and stop retrying", so it
remains reserved: a future referee may use it, and every client already handles it correctly.
A token that matches nothing is a silent spectator downgrade (§4.2), not an error; a token that
matches a seat held by *another* identity is `IDENTITY_MISMATCH`, which is a different and much
louder thing.

One exception, and it is deliberate: `REJECT{code:"NOT_DURABLE"}` is emitted when the SQLite
transaction fails. It is not an engine code, but it *is* a rules-path refusal — the action was
legal and was still not played — so it belongs in `REJECT` where the client's existing
rejection handling will show it and re-render from the bundled view.

**Rules failures are never `ERROR`; transport failures are never `REJECT`.** On stage this
distinction says instantly whether the *rules* refused you or the *plumbing* did.

### 2.5 Rate limits

Four budgets use a 10 s sliding window. Exceeding one is `ERROR{RATE_LIMITED}` and close
4029. Seat action/reject budgets are independent; the control and auth budgets are shared by
clients with the same source address, such as players behind one NAT or reverse proxy.

| Budget | Default | Counts |
|---|---|---|
| `RATE_MAX` | 150 | **accepted** actions only, metered *after* `E.apply` agrees |
| `RATE_MAX_REJECT` | 400 | rejected actions — the runaway-loop guard, nothing more |
| `CONTROL_RATE_MAX` | 30 | control (`CREATE` `JOIN` `RESUME` `QUEUE` `UNQUEUE` `LEAVE` `NOSTR`), malformed, and unseated action messages per client address, retained across reconnects |
| — (auth) | `max(5, CONTROL_RATE_MAX)` | the **first** `AUTH` of a connection, per address, so a signature-guessing loop cannot buy attempts by reconnecting |

The auth budget has no environment variable of its own on purpose: it is a floor, not a knob.
The first `AUTH` on a connection is metered there instead of against the control budget,
because an honest reconnect storm — a flapping socket that re-authenticates every time — must
not lock a player out of their own table by spending the same allowance the game needs.

The TCP peer address is authoritative. `X-Forwarded-For` is attacker input unless a deployment
establishes and validates a trusted proxy chain, and this one does not, so it is ignored
entirely: two clients spoofing different forwarded addresses share one budget (tested).

**A rejection must never cost a player their socket.** `CANNOT_AFFORD`, `NOT_RESOURCE` and
`WRONG_PHASE` are what browsing your own hand looks like on the wire: clicking each card in a
seven-card opening hand is seven rejections, and charging those to the action budget closed the
socket on a player for playing the game. Rejects are therefore metered separately and far more
loosely, and the check happens after the engine has ruled, never before it.

A successful `RESUME` clears the accepted/rejected action buckets for that seat. The
address-scoped control budget deliberately survives reconnects, so reconnecting cannot mint
fresh capacity for control or malformed traffic.

`RATE_MAX` (env) raises the action budget for headless soak runs, which act far faster than any
human. **Leave it unset for the demo** — the default is what protects the table.

### 2.6 HTTP (same process, same port)

```
GET /                      → site/index.html
GET /<path>                → static from site/ , and /art/ /cards/ /rules/ from the repo root
GET /api/health            → {"ok":true,"matches":3,"queued":2,"uptime":1820}
GET /api/tables            → [{matchId,code,name,pubkey,affinity,createdAt,stake,hostOnline}]
                             (status='open', newest first, max 50)
GET /api/match/:matchId    → while status ≠ 'over':
                             {matchId, status, headSeq, headHash, publicHash}
                             once status = 'over':
                             {matchId, status, config, entries, result, verify,
                              transcriptHash, headHash, publicHash,
                              resultContent, resultTags, resultCreatedAt}
```

`/api/tables` is the **relay-free join path**: if every relay dies on stage, players still see
and join tables. Paths resolving outside the allowed roots are `403`, never read.

`health.queued` is the queue depth, so the lobby can say "2 players searching" *before* anyone
commits to waiting rather than only after. `tables[].hostOnline` says whether anyone is
actually sitting at that code: a table whose host closed the tab looks identical to a live one
in a bare list, and joining it is a wait with no end. A dropped socket does **not** delete the
row — that would punish a reconnect — it only flips this flag to `false`; explicit `LEAVE` is
what removes it (§2.1). Rows whose seat 0 has no NIP-07 pubkey (pre-auth builds) are filtered
out entirely, because nobody can ever authenticate into them.

`/api/match/:id` is out-of-band verification, and **verification is a post-match act**.
While a match is live it returns only the four public chain fields. `config` carries the two
hidden seeds, which generate both decklists, both shuffles and every future draw — anyone
holding them can reconstruct the opponent's hand for the rest of the match — and a `matchId` is
not a secret: it is in every `STATE`, and while a table is open it is in `/api/tables`. The
transcript is gated with the config, because an opponent's actions are not public either.

Once the match is over the whole bundle is served, `resultContent`/`resultTags` included, so
the signed result is recoverable even from a cold page that held no socket when the match
ended.

Malformed percent escapes are a `400 {"error":"bad url"}` response. URL parsing and path
decoding share the same error boundary, so a crafted request cannot throw out of the HTTP
handler or strand the connection.

**Static assets: compress the first visit, revalidate every one after it.** The table shipped
~3.9 MB of uncompressed JavaScript on *every single navigation* — `engine.js`, `play.js` and
`play-data.js` are not small. Every response now carries a weak `ETag` derived from size and
mtime (`W/"<size hex>-<mtime hex>"`) plus `vary: accept-encoding`, and an `If-None-Match` that
matches is answered `304` with **no body at all**. Text types — `.html .js .mjs .css .json
.svg .md` — are gzipped when the request says `accept-encoding: gzip`; the test asserts the
compressed body is under **half** the raw one, and `play.js` is well past that. Already
compressed formats (`.png .webp .jpg .woff2`) are never gzipped: it burns CPU to make them
very slightly larger. A gzip failure falls through to sending the raw bytes — a compression
problem is not a serving problem.

Compressed bodies are memoised in a small map **keyed by the same ETag**, so an edit
invalidates its own cache entry and the referee can never serve yesterday's `play.js`.

`cache-control: no-cache` is retained **deliberately, and it is not a mistake**: it means
"revalidate", not "do not store". A stale `play.js` against a fresh `engine.js` is a desync,
which is never a risk worth taking for a few kilobytes — so every asset stays always-fresh,
while a repeat visit costs one conditional request and transfers no body. Compression handles
the first visit; revalidation handles the rest.

### 2.7 Socket admission

The server accepts at most 64 KiB of decompressed WebSocket payload per message
(`MAX_PAYLOAD` overrides the byte count). Oversized frames are closed with WebSocket code
1009 before JSON parsing.

Every HTTP or WebSocket request must name a trusted `Host`: loopback, the explicit bind host,
`PUBLIC_HOST`, or a host passed through the programmatic `trustedHosts` option. This blocks DNS
rebinding on both `/ws` and the HTTP/API surface. A browser socket is then admitted only when
its HTTP(S) `Origin` matches the WebSocket request's `Host`. Native/headless clients without an
`Origin` remain supported. If the page and table intentionally live on different origins, list
the exact page origins in the comma-separated `TABLE_ORIGINS` environment variable; no wildcard
is supported.

---

## 3. Database

Node 24 `node:sqlite` (`DatabaseSync`) — no dependency. DDL is executed at boot with
`CREATE TABLE IF NOT EXISTS` and **inlined in `server/table.js`** (one fewer file to drift out
of sync with the code that reads it). Path `server/matches.db`, already covered by `*.db` in
`.gitignore`. Env: `PORT` (8777), `DB`, `PIN_SEED`, `RATE_MAX`, `CONTROL_RATE_MAX`,
`MAX_PAYLOAD`, `TABLE_ORIGINS`, `PUBLIC_HOST`, `PUBLIC_URL`, `PUBLIC_SCHEME` (§7.1).

Columns are added at boot when missing. `CREATE TABLE IF NOT EXISTS` does nothing to a
database that predates a column and SQLite has no `ADD COLUMN IF NOT EXISTS`, so a demo laptop
carrying yesterday's `matches.db` must still boot — `result_content`, `result_tags_json`,
`result_created_at` and `stake` are `ALTER TABLE`d in if `PRAGMA table_info` says they are
absent.

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
| `nostr_events` | one per (match, role, pubkey) | Signed events verbatim. `role='result'` has one row per player — **enforced**, not assumed: a seat may only submit under its own pubkey, the two seats must hold different keys, and a result is refused before `status='over'` (§6.4). That is what makes confirmed/disputed a query rather than a special case. `sig_checked` is **`1`**: every stored event had its id recomputed from its own bytes and its BIP-340 signature verified *before* the row existed, so the column is a fact rather than an admission (D-11 repaid). |

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
design: there is exactly one recovery mechanism — `RESUME` — and it is the same one used for
the very first connection.** What changed is not the mechanism but what a returning player is
allowed to have forgotten: with `AUTH_OK.active` they may arrive holding nothing at all except
their npub.

### 4.1 Client state that survives a reload

Two stores, and the split is load-bearing.

```js
sessionStorage["600b:match"] = {matchId, seat, token, table, code}      // THIS TAB's session
localStorage ["600b:seats"]  = {"m_7f3a91c2:1": {…same, tab, seenAt}}   // per-seat, for a cold browser
localStorage ["600b:tab"]    // is in sessionStorage; localStorage holds nothing but the map above
```

**A seat credential belongs to a TAB, not to a browser.** One `localStorage` key holding one
record broke playing both sides on one machine twice over: the second tab resumed on the first
tab's token and superseded it, and whichever tab saved last destroyed the other's credential
outright, so a reload came back as the wrong seat. `sessionStorage` is per tab and survives a
reload, which is exactly the lifetime a seat has.

`localStorage["600b:seats"]` exists purely so a **closed** browser can reclaim its seat.
Entries are stamped with the owning tab id and a 4 s heartbeat; a tab may only adopt an entry
whose beat stopped 12 s ago (three missed beats — long enough to survive a GC pause). That
separates the two situations which look identical in storage: *another tab is playing that seat
right now* (leave it alone) versus *the browser was closed and reopened* (it is ours). Adopting
a still-beating entry yields `{matchId, seat:null, token:null}` — land on the table, but as no
one in particular, and let the claim ladder decide.

The heartbeat **rewrites** a missing entry rather than skipping it: two tabs each
read-modify-write the whole map, so one can clobber the other by writing a copy it read a
moment too early, and an entry that vanished would otherwise never come back.

A seat saved by the previous single-key build (`localStorage["600b:match"]`) is still read as a
last resort, so upgrading mid-match does not quietly cost someone their table.

Written on the first `STATE` of a match; cleared on "new match" or "leave table". A spectator
keeps enough to reconnect and holds **no** credential.

### 4.2 Sequence

1. **Page load.** `net.js` reads the saved session (§4.1), or `?match=` — a shared link beats a
   stale local session for the same page. If one is present and a NIP-07 identity is saved it
   **auto-opens the socket, no click**. Otherwise it keeps the session and asks for NIP-07
   sign-in before opening the socket.
2. `onopen` → server `AUTH` challenge → NIP-07 signs kind 22242 → server verifies and replies
   `AUTH_OK{active}` → client sends `RESUME`. Reconnect never trusts the saved pubkey string
   alone. If the client holds nothing to resume, `active` is the list it can offer instead
   (`E1Net.rejoin(matchId)`).
3. **Server resolves the match:** in memory → use it; not in memory (server restarted) →
   `JSON.parse(state_json)`, **one row read, instant**. If `state_json` is missing or
   unparseable, fall back to `E.replay(config, log)` and log a warning. `E.replay` is the
   VERIFICATION path, never the recovery path — recovery must not depend on 300 engine
   applications succeeding while an audience watches.
4. **Seat claim ladder** — strict priority order, evaluated on every `RESUME`:
   1. Valid `token` plus its matching `pubkey` → seat granted. A token under another pubkey is
      `ERROR{IDENTITY_MISMATCH}`. Any socket currently holding that seat
      is sent `ERROR{SUPERSEDED}` and closed 4009. **Takeover, not refusal** — this one rule
      handles reload, sleep/wake, second tab and moving machines identically, and can never
      lock a player out of their own match on stage.
   2. No token, seat's `pubkey` matches, no live socket on it → granted, **fresh token
      issued**. Covers cleared storage, a private window, and a different machine entirely —
      this is the rung `AUTH_OK.active` was built to feed. The client sends
      `RESUME{matchId}` with no token at all and the signed identity *is* the claim.
   3. Otherwise → **silently downgraded to spectator**, `downgraded:true`. **Never a hard
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

Spectator tokens (spectators are NIP-07 identified and read-only) · match resume across different
table URLs · seat handover · two-tabs-of-one-seat playing simultaneously (the second verified
connection wins, preserving reload/takeover recovery) · any clock, timer or rope (§4.4's claim
button is still the only answer to an absent opponent) · async / correspondence play · stored
replays beyond `/api/match/:id`.

**The queue does not survive a restart**, and that is the design, not an omission: it holds
live connections and nothing else (§5.2), so a referee reboot empties it and every waiting
client's forever-retry loop re-`QUEUE`s within seconds. Persisting a queue would mean
persisting rows for people who are no longer connected — the exact ghost the queue exists to
avoid.

**Recovered:** a player who no longer holds *anything* — cleared profile, private window,
second machine — is no longer stuck. `AUTH_OK.active` + tokenless `RESUME` covers it (§2.2, §4.2).

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

### 5.2 Matchmaking — the queue is connections, never rows

`CREATE` + a six-character code is two people who already know each other. `QUEUE` is for the
other case, and it is deliberately a *different mechanism* rather than "create a table and hope".

**The queue is an in-memory array of live connections. A waiting player writes NOTHING to the
database.** The match is minted at the instant two identities pair, in one transaction, with
**both seats already filled, dealt and holding a view**. There is no window in which an `open`
row exists that nobody is sitting at — the test asserts `COUNT(*) WHERE status='open'` is zero
after a pair. Matchmaking that leaves a ghost table behind reproduces exactly the trap `LEAVE`
had to be invented to clean up (§2.1).

The rules, in full:

- **Two connections under the same pubkey are never paired with each other.** The engine would
  deal it happily and one person would hold both hands. A second tab of one npub therefore
  keeps waiting — correctly, and visibly, because `QUEUED` keeps arriving.
- **The stakes must be equal, exactly.** Pairing on the wager is what makes it an *agreement*
  rather than a surprise: nobody is ever dealt into a match for a number they did not ask to
  play for. A friendly is `stake: 0` and pairs with friendlies. There is no rounding, no
  nearest-match and no "close enough" — a mismatched pair simply keeps waiting.
- **First come, first served.** `findPair` scans the array in order and takes the earliest
  *compatible* pair — different pubkeys, equal stakes — so among players who can be matched,
  the one who waited longest plays next. No affinity matching, no rating bucket, no lobby
  preferences. A small population makes any cleverness worse than none.
- **Dead sockets are pruned before pairing.** A queued player who closed the tab is spliced out
  on the next pump, never paired with, and never blocks the person behind them. A dropped
  socket also leaves the queue on `close`/`error`, and everyone behind is re-announced.
- **Both seat rows are written in one `BEGIN IMMEDIATE` transaction** (`insertMatch` then
  `seatOne`). A half-created pair is the worst of both worlds: a table whose host is
  unreachable and a guest with no board.
- **A failed mint does not silently requeue.** If `mintGame` exhausts its 40 re-rolls (D-12),
  both players get `ERROR{DECK_BUILD_FAILED}` and are left out of the line — a re-roll that
  failed 40 times will fail again, and looping quietly is worse than saying so.

`QUEUE` reuses the client's `intent` slot, which is what makes a wait survive a dropped socket:
`intent` is already the thing replayed once a reconnect authenticates, so the player who is
staring at "searching…" is still searching afterwards. A `QUEUED{queued:false}` clears it; a
`STATE` clears it too, because the search is over.

---

## 6. Nostr

Two kinds carry the match record: **4600** (invite, accept, start) and **31600** (result).
Content is always a JSON string with `"v":1` and `"kind"`, so the payload versions
independently of the event kind — one event kind, three discriminated payloads, `#t` filtering
intact.

Three more kinds are *used* but are not ours to define: **22242** (NIP-42 login, §2.1),
**0** (profile metadata, read for a winner's lightning address) and **9734/9735** (NIP-57 zap
request and receipt, §6.7).

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

### 6.1a Kind 4600 — START, signed by BOTH seats

The opening bracket the result event closes. Built by `E1Net.nostr.startEvent(state, stake)`
from a `STATE` message, and signed **independently by each seat over byte-identical content**.

```json
{"kind":4600,"pubkey":"<signer hex>","created_at":1785308642,
 "tags":[["t","start"],["t","600b-timelock-tcg"],["m","m_7f3a91c2"],
         ["p","<seat 0 hex>"],["p","<seat 1 hex>"],
         ["alt","600B Timelock TCG match start"]],
 "content":"{\"v\":1,\"kind\":\"start\",\"matchId\":\"m_7f3a91c2\",\"ruleset\":\"E1.0\",\"catalogDigest\":\"sha256:…\",\"wire\":1,\"players\":[{\"seat\":0,…},{\"seat\":1,…}],\"stake\":2100}"}
```

It names the two identities, the ruleset and card set they agreed to play under, and **the
stake they agreed to — all signed BEFORE a card is drawn, so neither side can invent the terms
afterwards.** `stake` defaults to `STATE.stake` — the referee's row, which both seats can see
and neither can edit — and is a whole number of sats, or `null` for a friendly game (the row's
`0` becomes a JSON `null` here, because "no wager" and "a wager of zero" are the same thing and
the ladder should only have to check one of them).

Byte-identical content is only possible because **every field comes from the referee's `STATE`**
rather than from either browser: `players` is sorted by seat (not by whoever the local client
lists first), and `created_at` is derived from `STATE.createdAt` — the match row's own clock —
for exactly the same reason `resultContent` is passed through untouched in §6.2. Two
independently signed start events must be comparable, and a browser clock is a source of
divergence.

`["t","600b-timelock-tcg"]` alongside `["t","start"]` is what makes the whole game's record
discoverable with one `#t` filter, which is how a ladder finds matches it was never told about.

**Storage role.** `nostr_events.role` is constrained to `invite|accept|result`, and a start
event occupies the seat's handshake role: seat 0 under `invite`, seat 1 under `accept`. Two
seats, two rows, no schema change — the existing `(match_id, role, pubkey)` key already gives
each seat exactly one slot per bracket.

**It is signed automatically, not on a click.** `announceStart()` in `site/play.js` fires on the
first `STATE` with status `playing` and signs once per match — the id is remembered in
`600b:announced`, so a reload does not spend the player's attention on a second popup. Declining
the signer is allowed and the match plays on; the client says so, and says plainly that a declined
start leaves the wager with no signed record.

Every field comes from the referee's `STATE`, including `createdAt`, and that is the point: two
independently signed start events are byte-identical apart from `pubkey`, `id` and `sig`, so the
stake in them is provably the number **both** seats agreed to. `tests/js/net.test.mjs` asserts
exactly that.

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
 "players":[{"seat":0,"pubkey":"…","name":"felix","affinity":"Power"}, …],
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

### 6.4 Signature verification — VERIFIED, not merely stored

The referee verifies the NIP-42 login event with `@noble/curves`: event id, BIP-340 Schnorr
signature, fresh timestamp, connection challenge and relay tag. The npub shown at the table is
therefore a proven NIP-07 identity, and every reconnect repeats that proof before a token or
pubkey can claim a seat.

**Every other event is now held to the same standard.** `handleNostr` recomputes the canonical
NIP-01 id from the event's own bytes and verifies the Schnorr signature over that id *before*
anything is written. Either check failing is `ERROR{BAD_MESSAGE}` and **no row exists**. The
id check is not redundant with the signature check and cannot be dropped: without it a valid
signature could be pasted onto altered content, which is the entire attack. `sig_checked` is
`1` and means it.

The old justification for storing unverified rows — that adding a curve dependency days before
a demo was unjustified risk — **is obsolete, because the dependency was already there.**
NIP-42 login made `@noble/curves` a hard dependency of the referee, so the same three lines
that authenticate a seat now certify what it publishes. There was nothing left to buy by
waiting.

Verification alone is still not enough, because a valid signature is not permission to speak
for someone else. `agreement` therefore rests on both cryptography **and** enforced seat
binding:

1. A seat may submit events **only under its own pubkey**. Without this, one seat could store a
   row attributed to its opponent and drive `agreement` to `confirmed` — or to `disputed` — on
   its own, and the lobby renders that verdict verbatim. Note that signature verification does
   **not** subsume this: a player holding a third keypair can produce a cryptographically
   perfect event under a key that is not their seat's, and the test asserts exactly that case
   is refused.
2. Every seat is created with a NIP-07 pubkey; legacy rows without one cannot submit events.
3. The two seats must hold **different** keys. `nostr_events` is keyed on
   `(match_id, role, pubkey)`, so two seats sharing a key would collapse two results into one
   row.
4. `role:"result"` is refused unless `status = 'over'`. There is no result before there is a
   result.

Together these cap `nostr_events` at three rows per match — one invite, one accept, one result
per seat — and make `confirmed` mean what the lobby says it means: *both seats said the same
thing, and both of them can prove they said it.* That is an enforced constraint, not an
assumption.

**Next:** require authority-key republication before a match changes Ranked rating (D6 in
`multiplayer-architecture.md`). The referee's verification binds what *this* table recorded;
it says nothing about a match played somewhere else. `site/ladder.js` closes the other half by
re-verifying every signature client-side off the relays, trusting no server at all — including
this one.

### 6.5 Flow and popup budget

| Step | Popups |
|---|---|
| Sign in: NIP-42 challenge → kind 22242 (once per connection, and on every reconnect) | 1 |
| Host: Create → `STATE` → sign invite → publish → `NOSTR{invite}` | 1 |
| Guest: see invite (or type the code) → `JOIN` → `STATE` → sign accept → publish | 1 |
| Start: sign the kind 4600 `t=start` announcement over the referee's bytes (§6.1a) | 1 |
| **Play: ZERO nostr, ZERO popups.** Every action is an `ACT` frame. | 0 |
| End: `OVER` → "Publish result" → sign 31600 → publish → agreement broadcast | 1 |
| Settle a stake (optional): sign a kind 9734 zap request, then pay in your own wallet | 1 |

**Handful of popups at the brackets, NONE during play.** That is the whole point of the
owner's split and it is worth one sentence on stage. It also makes delivery-plan S5's
per-match session-key delegation unnecessary — that slice existed only to dodge per-move
popups that no longer exist.

The reconnect signature is the one that can surprise a presenter: a flapping socket asks the
extension to sign again each time it comes back. That is the cost of never trusting a saved
pubkey string, and it is the right trade.

### 6.6 Critical design rule — nostr is the announcement, never the gate

The match is played and finished entirely over the socket after mandatory NIP-07 sign-in.
Invite, accept and result publication remain fire-and-forget: a rejected signing popup or three
dead relays degrades the announcement, not an already authenticated game. Without the extension,
online create/join/resume is unavailable; local hotseat remains fully offline.

Note the ordering: **the table exists on the server before the invite is published.** A relay
failure can never block a match starting.

### 6.7 Settlement — THE APP NEVER HOLDS, ESCROWS OR MOVES SATS

A stake is agreed in the signed start event (§6.1a) and settled entirely outside this software.
There is no wallet here, no escrow account, no custody, no float and nothing of ours to steal:

1. `profile(pubkey)` reads the winner's kind 0 metadata off the relays and takes `lud16` —
   **the winner's own lightning address**, published by the winner, resolved fresh.
2. `payEndpoint(lud16)` fetches `https://<domain>/.well-known/lnurlp/<name>` (LNURL-pay).
   The local part and domain are validated before the request, so a malformed address is an
   error rather than an arbitrary fetch.
3. `zapInvoice({sats, lud16, to, matchId})` checks the wallet's `minSendable`/`maxSendable`,
   optionally signs a **NIP-57 kind 9734** zap request (only when the endpoint advertises
   `allowsNostr` with a valid `nostrPubkey`, and only public nostr data ever reaches the URL),
   and returns the `bolt11` the endpoint issued.
4. The loser pays **that invoice, from their own wallet, with their wallet's own
   confirmation**. `payWithWebln` exists as a convenience and is called only from an explicit
   click; there is no code path that pays anything on its own.

**A refused zap costs the match nothing, because the result is already signed.** Settlement is
a separate, optional, human act layered on top of a record that is already complete — the same
relationship nostr has to the socket everywhere else in this document (§6.6). The zap receipt
(kind 9735) is public and addressed to the winner, so a ladder can *observe* that a stake was
settled without any component of this system ever having been trusted to move it.

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

**`net.js` opens no socket unless the page already holds a match (a saved session, §4.1, or
`?match=`) or the player clicks Create / Join / Search.** From `file://`, `tableUrl()` returns
`null`, the lobby's buttons are disabled and say why, and `play.html` is a hotseat table with no
network code running at all. `tests/js/client.test.mjs` asserts zero `WebSocket` constructions on that
path, because a future "just connect on load" convenience would break it silently.

### Reconnect, from the client side

`sessionStorage["600b:match"] = {matchId, seat, token, table, code}` plus the per-seat
`localStorage["600b:seats"]` map, written on the first `STATE` — see §4.1 for why it is two
stores and not one. On load, a saved match **auto-opens the socket with no click** — on stage the presenter
reopens the tab and sees the board, not a dialog. Backoff 250→4000 ms, ±20 % jitter, forever, no
give-up state: the chip reads "reconnecting…" and the board stays on screen, stale but readable,
rather than blanking. Outbound actions while disconnected are **dropped, not queued** — their
`seq` has moved and the fresh `STATE` drives whatever comes next.

Close code **4009 (`SUPERSEDED`) does not retry.** Without that rule two tabs sharing one
origin's storage evict each other forever — the per-tab split in §4.1 keeps them from getting
into that fight in the first place, and this is the backstop. `ERROR{NO_SUCH_MATCH|BAD_TOKEN|MATCH_OVER}`
clears the stored credential and stops, so a stale match against a fresh database cannot loop.
(`BAD_TOKEN` is handled but never sent — §2.4.)

`Ctrl+Alt+R` forces a `RESUME` — the panic button the runbook asks for.

### The `E1Net` surface

Everything `play.js` is allowed to touch. `net.js` holds no rules and no DOM.

| Group | Members |
|---|---|
| Table | `start(handlers)` · `create` · `join` · `act` · `sendNostr` · `leave` · `resume` · `tables()` |
| Matchmaking | `queue({name,affinity,pubkey})` · `unqueue()` · `rejoin(matchId)` |
| Where we are | `tableUrl` · `publicTable` · `publicTableIsLocal` · `savedMatch` · `saveMatch` |
| Read-only getters | `status` · `session` · `lastState` · `peers` · `queued` · `active` |
| `nostr.*` | `hasNip07` `login` `logout` `sign` `publish` `relays` `query` `profile` `savedPubkey` `npub` `npubDecode` `toHexPubkey` `shortNpub` `inviteEvent` `acceptEvent` `startEvent` `resultEvent` `parseStake` `parseInvite` `subscribeInvites` `hasWebln` `payEndpoint` `zapInvoice` `payWithWebln` |

Handlers: `onStatus` `onState` `onFrame` `onReject` `onPeer` `onQueued` `onOver` `onNostr`
`onError` `onActive`. Each is wrapped — a throwing handler is logged, never allowed to kill the
socket loop.

`rejoin(matchId)` is the `AUTH_OK.active` path made a one-liner: it validates the id shape
(`m_` + 12 hex), clears any queue intent, and sends `RESUME` with **no token**. `query(filter,
ms)` fans one `REQ` across every relay, dedups by event id, and resolves on `EOSE` from all of
them or a deadline — whichever comes first, in the same fire-and-forget spirit as `publish()`:
a dead relay shortens the answer, it never fails the call.

### Lobby

A **panel inside `#setup`**, never a separate page: a navigation mid-demo loses the socket and
the seat. Create / join-by-code / **search for an opponent** (`QUEUE`) / rejoin a match named in
`AUTH_OK.active` / `GET /api/tables` / relay invites, plus NIP-07 sign-in reusing
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
message naming `PUBLIC_HOST`. Behind TLS the referee-side answer is `PUBLIC_URL` (§7.1), and it
is the better one: the client can only refuse to publish something wrong, it cannot invent the
right value.

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
  `table` field in `STATE` and invites points at the Tailscale name — or `PUBLIC_URL` behind
  TLS (§7.1).
- Keep the table terminal beside the `git checkout demo-safe-v1` terminal.
- **Fallback ladder, in order:** relay invite → read the 6-character code aloud →
  `GET /api/tables` → local hotseat on `play.html` (which never stopped working).
- Pin the rehearsed seed via `PIN_SEED`. **Leave `RATE_MAX` unset for the demo** — the default
  is what protects the table, and no human comes near it.
- Same-origin LAN play needs no origin configuration; set `PUBLIC_HOST` to the LAN/Tailscale
  name or address. Set `TABLE_ORIGINS` only when a page hosted elsewhere must connect to this
  table.
- `scripts/demo-two-clients.mjs` is the exception: it is a headless client acting at ~100
  actions/second, which is exactly the traffic the budget exists to bound. Start the referee with
  `RATE_MAX=100000` when running it, as `tests/js/net.test.mjs` already does in-process.

### 7.1 What an invite actually carries — `PUBLIC_URL`

`publicTableUrl()` used to hardcode `ws://` and the bound port. **That was right on a LAN and
wrong everywhere else, silently.** Behind a TLS reverse proxy the page is `https`, the proxy
answers on 443, and an invite reading `ws://host:8777/ws` is *both* mixed-content-blocked by the
browser *and* aimed at a port the internet cannot reach — and nothing in the referee fails, so
the only symptom is that strangers cannot join and cannot say why. The scheme and the port are
deployment facts, not process facts, so a deployment states them.

| Variable | Effect |
|---|---|
| `PUBLIC_URL` | The fully explicit advertised URL. **Validated at boot** — not `ws://` or `wss://` is a startup error, never an invite that fails on someone else's machine. A trailing `/` is stripped, and its host is added to the trusted-`Host` set automatically. |
| `PUBLIC_HOST` | Hostname only; scheme and port are still derived. Unchanged meaning: the LAN / Tailscale answer. |
| `PUBLIC_SCHEME` | `wss` forces `wss://`; anything else is `ws://`. The partial answer for a proxy that keeps the port. |

```bash
PUBLIC_URL=wss://tcg.example/ws node server/table.js   # one variable, TLS done
PUBLIC_HOST=bitbeam.tail1a2b.ts.net node server/table.js  # LAN / Tailscale, unchanged
```

`PUBLIC_URL` wins outright when set; otherwise the URL is `${PUBLIC_SCHEME||ws}://${PUBLIC_HOST||localhost}:${boundPort}/ws`.
It is what `STATE.table` advertises and what the NIP-42 `relay` tag is bound to, so it is also
part of the login proof — another reason to state it explicitly rather than let it drift.

---

## 8. Tests

`npm run test:js` — which is `node --test tests/js/*.test.mjs`. Use the **file/glob form**; the
directory form `node --test tests/js/` fails on Windows.

**284 tests, 284 passing, 0 failing** (2026-08-15, Node v24, ~7 s).

| File | Tests | Covers |
|---|---:|---|
| `tests/js/net.test.mjs` | **48** | in-process integration against a real referee: authoritative views and fog of war; engine/transport error separation; persistence, replay and verification of a full match; resume/takeover/restart; the identity session (`AUTH_OK.active`, tokenless `RESUME`); the matchmaking queue (pairing, self-pairing refusal, stake pairing, dropped sockets, refusal while seated); the wager (integers only, `STAKE_MISMATCH` on join, survives a restart); `LEAVE` closing an abandoned table and *not* closing a live one; verified nostr binding and recoverable results; HTTP/static boundaries, gzip + `ETag` + `304`, `hostOnline`; `PUBLIC_URL` advertising and its boot validation; malformed URLs; WebSocket payload, `Host` and `Origin` admission; address-scoped control/auth budgets across reconnects; action/reject budgets; and illegal combat input over the wire |
| `tests/js/engine.test.mjs` | 37 | the engine's own contract: determinism, canonical JSON, redaction, seat authentication, the turn structure, combat, the manual-delta vocabulary, replay and tamper detection |
| `tests/js/client.test.mjs` | 21 | `site/net.js` against a stubbed `file:`/`http:` environment — including the two-tab seat split and the legacy single-key upgrade — plus real `site/play.js` DOM paths for lobby, recovered result, targeting, clash preview and HTML-safe player names |
| `tests/js/schnorr.test.mjs` | 15 | `site/schnorr.js` against all 19 official BIP-340 vectors, 1000 differential cases versus `@noble/curves`, and NIP-01 event ids over unicode and nested tags |
| `tests/js/ladder.test.mjs` | 12 | `site/ladder.js`: what counts as a match and what is refused — one seat alone, contradicting winners, a bystander co-signing, a good signature over swapped content, a `d` tag addressing a different match, arrival order, and the refusal to publish a ladder at all without a verifier |
| `tests/js/triggers.test.mjs` | 10 | engine-event triggers |
| `tests/js/seeds.test.mjs` | 4 | the Stake landmine and the `mintGame` re-roll, every affinity pairing |
| `tests/js/deck.test.mjs` | 4 | deck construction |
| `tests/js/npc.test.mjs` | 3 | the offline opponent |
| `tests/js/precons.test.mjs` | 2 | the generated preconstructed Stacks |
| `tests/js/wave2…wave12.test.mjs` | 72 | the card-by-card rules waves |
| `scripts/demo-two-clients.mjs` | — | the out-of-process proof against a **running** `node server/table.js` |

The counts move as cards land. **The total is the number to check, and it must never go down.**

---

## 9. Demo debt

**Retired:** **D-1** — hidden information was UI-side only because the peer topology had to
ship both seeds to both clients; a referee does not, and **no** `rng[].s`, public or hidden,
is present in any view. **D-2** is moot for this topology: a handful of signing popups per match,
none during play, so the ad-hoc session key is not needed at all. **D-11** — every stored Nostr
event's id is recomputed from its own bytes and its BIP-340 signature verified before the row
exists; `sig_checked` is `1` (§6.4). The justification for deferring it ("a curve dependency
days before a demo is unjustified risk") died the day NIP-42 login made `@noble/curves` a
dependency anyway — **the cost had already been paid and the debt was being carried for
nothing.**

| ID | Debt | Why acceptable | Repayment |
|---|---|---|---|
| **D-12** | `createGame` throws on Stake cards; worked around with a 40-attempt re-roll and a pinned seed. Keys fails ~16/25 seeds. | The re-roll makes it invisible to clients; the pinned seed makes the demo deterministic. | **P-12:** filter Stake cards in `buildDeckList` when the module is off. |
| **D-13** | Full view resent every frame; no deltas. | 4.6 KB measured, ~1 KB deflated, invisible on LAN/Tailscale. Deletes the entire "client applied a delta wrong" bug class. | **P-13:** deltas, purely additive to the message vocabulary. |
| **D-14** | The referee is a single point of failure; the peer/napplet topology is deferred. | Instant `state_json` recovery + a forever-retrying client. The engine is unchanged, so the P2P path remains reachable. | **P-14:** the WebRTC NAP per `multiplayer-architecture.md`. |
| **D-15** | A matching token and freshly NIP-42-authenticated identity evict the older socket. | Reload, sleep/wake and moving machines recover without letting a leaked token cross identities. | Add explicit seat handover if tournament operations require it. |
| **D-16** | The ladder's authority key does not exist. Ranked rating is derived client-side from relay events (`site/ladder.js`) and nothing republishes an attested score record. | Every input is verified — two distinct seats, byte-identical content, both signers named inside that content, every signature checked — so the table is honest about what it can see. It cannot see abandonment or Sybil farming. | **D6** in `multiplayer-architecture.md`: authority-key republication gating Ranked. |

**D-9** narrows: the transport is now relay-agnostic *and* relay-optional — the server never
opens a relay connection at all.
