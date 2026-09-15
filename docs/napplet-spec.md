# 600B Timelock TCG — Napplet Build Spec (v1)

Output of `design-napplet`. Consumed by `build-napplet`, verified by `test-napplet`.
Decisions locked with FLX 2026-07-28: **moves are WebRTC-only (no move locks, no move
log on relays); Nostr events only for invites/handshake where needed and for match
results/stats.**

> **Amended 2026-07-31** — see `multiplayer-architecture.md`. The transport and symmetric-engine
> decisions stand. The `hidden` scheme below is **replaced**: committing `hash(decklist +
> shuffleSeed)` lets a player read their own draw order from turn one, because they generate their
> own seed. The commitment prevents changing the order, not knowing it, and the resulting transcript
> verifies clean. Replaced by per-card commitments plus an opponent-held secret permutation.

> **Amended 2026-08-15 for the public Table topology** — online create, join and resume require
> a NIP-07 pubkey; anonymous seats are no longer offered. Local hotseat remains extension-free.
> The Table verifies a fresh NIP-42 Schnorr proof before accepting a table intent. This
> supersedes the anonymous identity fallbacks below wherever they describe the Table
> implementation.

```
nappletType: 600b-timelock-tcg
purpose: Play two-player 600B Timelock TCG (E1) matches over shell-mediated WebRTC;
         Nostr is used only for match invites and published match results/stats.

NAPs used: webrtc (req), identity (opt), dm (opt), outbox (opt), common (opt),
           storage (opt), resource (opt), theme (opt), notify (opt)
requires: [webrtc]

optional domains and fallbacks:
  identity -> anonymous "Player 1/2" labels when absent
  dm       -> manual invite string (npub + matchId, copy/paste) when absent
  outbox   -> results stay local (storage history); stats view shows local-only note
  common   -> short pubkey instead of profile name/avatar
  storage  -> preconstructed decks only; no saved decks, settings or history
  resource -> text-rendered card faces from bundled card data (no images)
  theme    -> the Hypershell core tokens (docs/brand-hypershell.md)
  notify   -> in-UI badge only

SDK helpers: webrtc.open({scope:{type:'direct',pubkey}}) / webrtc.send(sessionId, msg)
             / webrtc.close / webrtcOnEvent; identity read; dmSend / dmSubscribe /
             dmOnMessage; outbox.publish / outbox.query; commonGetProfile;
             storage.getItem / storage.setItem; resource.bytes; theme tokens +
             themeOnChanged; notify badge

config schema: none (settings stored via storage: sound, reducedMotion)

archetype metadata: none (v1)
INC topics and payload validation: none (v1)
intent dispatch: none (v1)

layout:
  tiny:  match-status card (uptime dials, turn, phase) + "open full view" prompt;
         menus collapse to icons; no board rendering below ~360px width
  large: full board — opponent Network row, own Network row, hand fan, Queue strip,
         phase ribbon, uptime dials, card inspector panel
  strategy: CSS grid + clamp() + container queries; no fixed viewport assumptions;
            no horizontal overflow at any size; portrait = stacked board with
            tap-to-zoom card inspector

theme: optional. Amended 2026-09-15 for the Nappelin Hypershell (docs/brand-hypershell.md).
       Read theme.get() (then nappletContext.theme) and repaint on every theme.changed.
       Accept only { tokens: { "--iron", "--brass", "--brass-2", "--brass-3", "--parchment",
       "--signal", "--panel", "--well", "--divider", "--hairline", "--emphasis",
       "--body-ink", "--headline", "--mono", "--r" } }, each value checked for its kind:
       colours are hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba()/hsl()/hsla() with
       numeric arguments only, or black/white/transparent; --headline and --mono are font
       family lists (quoted or bare names, commas); --r is 0 or a px/rem/em length. A
       value containing url( image-set( var( env( expression( @ ; { } < \ or a line break,
       or of the wrong kind, keeps its default: a url() in a token is a fetch from every
       viewer's browser. The legacy colors object is not read: until its Hypershell
       theme service ships, the Hangar answers every napplet with
       {colors:{background,text,primary}}, so a payload with colors and no tokens naming
       these names repaints nothing. Fallback: the same core tokens
       (iron #0f0c08, brass #e7bf76 / #c9973f / #8f6a2a, parchment #ece3d0,
       signal #6de8a6). The brand layer never follows the shell theme: the five
       affinity Plates (P #F3C244, B #F7931A, K #FFF7EC, S #7447B8, T #17BEBB), ember
       #ff6a00 inside the game world, and Anton for game titles and card names.

data flow:
  invite    dm message carrying {matchId, protocolVersion, deckFormat} (optional;
            manual copy/paste fallback). Incoming payloads are untrusted: validate
            schema + version before use.
  connect   webrtc.open direct scope to the opponent pubkey; the shell brokers
            signaling and consent. All gameplay traffic is session messages.
  moves     JSON envelopes {v, matchId, seq, move} sent per action, applied without
            locks. Both peers run the identical deterministic E1 engine; every
            incoming move is validated locally. Divergence => desync: match void,
            both sides keep their transcript.
  hidden    DeckOracle interface, no dealer. Each player publishes a per-card hash
            commitment for their own decklist; the OPPONENT holds a secret committed
            permutation over those slots and releases it one slot at a time on draw.
            Neither player knows their own deck order, so self-knowledge, deck
            stacking and draw equivocation are PREVENTED, not merely detected.
            Cost ~80 SHA-256 hashes and a few KB per match. Full reveal at match end
            still allows retroactive verification. (Superseded design: naive
            hash(decklist + shuffleSeed) commit-reveal — see amendment above.)
  results   at match end each client offers "publish result": outbox.publish one
            addressable event (d=matchId) with {matchId, players, winner, turns,
            engineVersion, transcriptHash}. Stats view: outbox.query both players'
            result events; agreement => confirmed, mismatch => shown as disputed.
  cards     trimmed card database (id, name, cost, type line, affinity, A/R, rules
            text) bundled inline from cards/e1-cards.json (483 KB source, trimmed
            subset well under budget). Card face images (art/cards/node-runner-web/) are NOT
            bundled: fetched via resource.bytes from the published asset location,
            in-memory LRU cache, text-card fallback.

relay escape hatches: none.
```

## Nostr event kinds (fixed 2026-08-01 — closes flagged gap #2)

Two kinds, and only two. **No move is ever a Nostr event**, in either topology: moves are
WebRTC session messages in the napplet and WebSocket frames at the Table, which is the
2026-07-28 lock restored verbatim. Content is always a JSON *string* carrying `"v"` and
`"kind"`, so the payload versions independently of the event kind. Shipped in `site/net.js`;
normative wire detail in `net-protocol.md` §6.

| Kind | Class | Use | Discriminator |
|---|---|---|---|
| **4600** | regular | match **invite** and **accept** | `["t","invite"]` / `["t","accept"]` |
| **31600** | addressable | signed match **result** | `["d", matchId]` |

4600 is regular rather than ephemeral (2xxxx) on purpose: relays do not store ephemeral
events, so a guest who opens the lobby thirty seconds late would see nothing. A NIP-40
`expiration` tag recovers most of the hygiene. Content is plaintext — a `p` tag makes an
invite *addressed*, not private.

**Invite** content: `{v:1, kind:"invite", matchId, code, table, host:{name,affinity}, ruleset,
catalogDigest, wire}`. The load-bearing field is `table`: it tells the guest which referee to
socket into. **Accept** content: `{v:1, kind:"accept", matchId, invite, table,
guest:{name,affinity}}`.

**Result** content: `{v:1, kind:"result", matchId, gameId, ruleset, catalogDigest, topology,
wire, players[], winners[], losers[], reason, turns, actions, publicHash, transcriptHash,
headHash, startedAt, endedAt}`. Note `winners` is an **array**: the engine legitimately
produces `{winners:[], reason:"draw", losers:[0,1]}` on a simultaneous loss, which a singular
`winnerSeat` cannot represent.

**Agreement predicate (normative).** Two 31600 events for one `matchId` agree iff
`{matchId, gameId, winners, losers, reason, turns, publicHash, transcriptHash}` are deep-equal
→ `confirmed`; differ → `disputed`; one present → `pending`. `headHash` is **never** an
agreement field: under split hidden streams two peers hold legitimately different full states,
so a state-derived head cannot be compared across seats. `publicHash` — the intersection of
both views — is what is comparable across topologies.

Both players sign the **same bytes** for tags and content; the only differences between the two
events are `pubkey`, `id` and `sig`. In the Table topology the referee hands both clients those
bytes in `OVER.resultTags` / `OVER.resultContent` and `net.js` passes them through untouched,
because re-serialising a parsed object in two browsers is a needless way to manufacture a
dispute.

**Signature verification.** The Table referee verifies a fresh, connection-bound NIP-42 login
event with `@noble/curves` before it accepts `CREATE`, `JOIN` or `RESUME`. The npub shown at the
table is therefore the NIP-07 identity that proved possession of the key. Invite, accept and
result-event verification remains a later slice; those rows still record
`nostr_events.sig_checked = 0` honestly.

**Nostr is the announcement, never the gate.** The table is created, joined, played and finished
over the socket and a six-character code; the table exists on the server *before* any invite is
published. Three dead relays degrade only invite/result publication. A missing extension or a
declined login signature blocks online seating; anonymous remote seats are not offered. Local
hotseat remains extension-free.

## Flagged gaps (resolve at build time, do not invent)

1. **webrtc surface**: no published NAP doc yet; the implementation boundary is the
   `@napplet/nap/webrtc` typings (`WebrtcOpenRequest`, `WebrtcSession`,
   `WebrtcMessageEvent`, `WebrtcPeerEvent`, `WebrtcStateEvent`, `WebrtcClosedEvent`).
   Read them during build; do not assume shapes beyond `open/send/close/onEvent`.
2. ~~**Result event kind**~~ — **RESOLVED 2026-08-01**: kind **31600** addressable
   (`d = matchId`) for results, kind **4600** regular for invite/accept. See "Nostr event
   kinds" above.
3. **Asset base URL** for card images is set at publish time (nsite/Blossom).
4. **storage quota is 512 KB**: match history is a capped ring buffer (last ~50
   results); decks are card-ID lists (tiny).
5. **Engine**: the deterministic E1 engine (LIFO queue, state checks, resource burn)
   is the core build effort and must be pure/seedable so both peers replay
   identically. Rulebook §9–§17 is the contract; `cards/e1-cards.json` is the card
   authority. Built as `site/engine.js` — one headless JS module shared by the
   napplet, the local hotseat table and the optional Table referee.
6. ~~**Assisted cards**~~ — **RESOLVED 2026-08-15**: all 295 cards compile to engine
   operations; released local and remote policies deny free-form resolution.
7. ~~**Keyword enforcement**~~ — **RESOLVED 2026-08-15**: the printed keyword and static-rule
   families are enforced and covered by card-family regression tests and bot soaks.

## Explicitly out of scope for v1

- Sats/Cashu stakes (no `value` NAP exists yet; sandbox forbids direct mint HTTP).
  Revisit when NAP-VALUE ships or via companion service outside the napplet.
- Matchmaking lobby, spectating, tournaments, INC/intent integration.
- Stake Mode / Toss Legacy modules (rulebook §19) — off, as in the default profile.

## The nappelin Hangar as the shell (fixed 2026-09-13)

The napplet now ships into a concrete shell: the nappelin Hangar loads one self-contained
`index.html` in a `sandbox="allow-scripts"` frame (opaque origin — `localStorage`, `sessionStorage`
and `caches` throw at the point of access, `location.protocol` is `about:`), and injects a
`window.napplet` prelude carrying ONLY the granted domains. Everything below is what
`site/napplet.js` (`E1Napplet`) and `site/net.js` actually do against that shell; flagged gap 1
above is closed by it.

**`requires: [webrtc]` is superseded.** There is no WebRTC NAP and none is needed: the Table
topology (amended 2026-08-15) plays over a referee socket, and inside the Hangar that socket is a
*pipe the host opens on the napplet's behalf* — see "the table channel". The artifact declares
`identity, outbox, resource, storage, intent, link, x-nappelin-cue` (`<meta name="napplet-requires">`; §5 for the last); `table` is a
host channel, not a NAP domain. `dm`, `common`, `notify` are not used.

### 3a. Identity and outbox — what the prelude really offers

- `napplet.identity.getPublicKey(): Promise<string>` is the whole identity surface (empty string
  when nobody is signed in). There is **no** `get()`, `request()` or `signEvent`.
  `E1Napplet.identity.current()`/`login()` call it; `login()` rejects with "sign in to the shell
  first" rather than prompting, because signing in is the Hangar's flow.
- `E1Napplet.identity.sign(event)` has no shell path: it rejects with
  `"the shell signs only through outbox.publish and table.sign"` unless a NIP-07 signer exists.
- `napplet.outbox.publish(template, options)` takes an **unsigned** template; the host signs with
  its identity, then fans out. It resolves the raw result message
  `{type, id, ok, event?, eventId?, relays?, error?}` — `error` on failure, never a rejection.
  **The relays are named** (2026-09-15): the Hangar's relay-pool router (Kehto 0.20) looks up the
  signer's NIP-65 relay list unless the publish says `toOutbox: false`, finds none for anyone
  (nappelin's `loadRelayLists` is an empty Map), and refuses with `"relay list unavailable"` —
  after signing. So `E1Napplet.outbox.publish` passes
  `{relays: ["wss://relay.nappelin.com", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"], toOutbox: false}`
  (the host drops any relay it does not allow). It returns `{ok, via:"shell", event}` or
  `{ok:false, via:"shell", error, event}` — a refusal still carries the event the host signed.
- `napplet.outbox.query(filters, options)` resolves `{type, id, events: [{event, sidecar}], incomplete?, error?}`;
  `E1Napplet.outbox.query(filters)` passes `{relays: [the same four]}` from the one constant its
  publish uses (`OUTBOX_RELAYS`), and hands on the bare events. A query with `authors` otherwise
  asks the router for those authors' relay lists, finds none, and reads only whatever fallback the
  router keeps (flagged `incomplete`), so a member's kind 0 read by `site/identity-look.js` or by
  net.js `profile()` and `sessions()` names the relays instead. On the website the same calls sign
  with NIP-07 and use `E1Net.nostr`'s own fan-out.
- **net.js consequence.** play.js keeps its `sign → publish → sendNostr` order. Inside a shell
  `E1Net.nostr.sign()` of a kind 4600/31600 template therefore *publishes it through the outbox*
  and returns the signed event (the referee still records it verbatim); `publish()` recognises an
  event the host already fanned out and reports `{ok:true, accepted:["shell"], tried:1}` instead of
  sending a second copy — or `{ok:false, accepted:[], tried:1, error}` when the host signed it and
  its relays refused, because signed is not published. Only a host that could not sign makes
  `sign()` reject. A kind 9734 zap request cannot be signed in a shell at all.
- The shell's pubkey is cached **in memory** by net.js (`savedPubkey()`); `localStorage` is never
  named at a call site outside a try, because the getter itself throws in the sandbox.
- Embed detection: `E1Napplet.embedded()` is `window.napplet` (object) OR `window.nappletContext`
  OR `?embed=1`. `E1Napplet.escape()` posts `{type:"nappelin.escape"}` to `parent`; no-op on the
  website. Under embed with no `theme` domain, `E1Napplet.NAPPELIN_THEME` (iron `#0f0c08`,
  parchment `#ece3d0`, brass `#e7bf76`, …) is painted; since 2026-09-15 the website's fallback is
  the same Hypershell core token set.
- `tableUrl()` in a srcdoc frame: `?table=` → the seat's saved table → `globalThis.E1_TABLE_URL`
  (a `wss?://` constant; `scripts/build_napplet.py` injects `wss://tcg.nappelin.com/ws` in `<head>`)
  → the page origin → `wss://tcg.nappelin.com/ws` when embedded → null.

### 3b. The table channel (napplet ⇄ Hangar page, over `postMessage`)

`E1Napplet.table.available()` is true when `napplet.table` exists, when
`napplet.shell.supports("table")` is true, or simply when the page is embedded inside a parent
window — the channel needs no prelude object. `E1Napplet.table.connect(url, handlers)` returns
`{ send(text), close(), sign(event): Promise<signedEvent>, channel, via }` with handlers
`{ onOpen(), onMessage(text), onClose({code, reason}), onError(message) }`. Without a host it is a
real `WebSocket` and `sign` is NIP-07 — `site/net.js` sees one shape either way (`dial()`).

| napplet → host | fields | host answers |
| --- | --- | --- |
| `table.open` | `id`, `url` (wss://…) | `table.open.result {id, ok:true, channel}` or `{id, ok:false, error}` |
| `table.send` | `channel`, `data` (string) | nothing (unknown channel drops silently) |
| `table.close` | `channel` | `table.closed {channel, code:1000, reason:"closed by napplet"}` |
| `table.sign` | `id`, `channel`, `event` (unsigned kind 22242) | `table.sign.result {id, ok:true, event}` or `{id, ok:false, error}` |

Host → napplet, unsolicited: `table.opened {channel}`, `table.message {channel, data}`,
`table.closed {channel, code, reason}`. Every request carries a fresh `id` and replies are matched
on it; the unsolicited three are matched on `channel`. The adapter listens **only** to
`event.source === parent`; a `table.open` nobody answers within 8 s is reported through `onError`
and `onClose({code:1006})` so a plain iframe never hangs.

Host rules (nappelin `apps/hangar/src/table-channel.ts`): the `url` origin must be in the
napplet's table allowlist (for `600b-timelock-tcg`: `wss://tcg.nappelin.com`,
`wss://tcg.zapburg.com`, `ws://localhost:8777`, `ws://localhost:8790`, `ws://127.0.0.1:8777`);
at most two channels per frame; `table.sign` signs with the host identity ONLY a kind 22242 with
empty content and exactly `["relay", r]` + `["challenge", c]` where `c` is 64 lowercase hex and
`new URL(r).host` equals the channel's host — anything else is
`"the host signs only a table login for the table you opened"`, nobody signed in is
`"sign in first"`. net.js keeps its own relay-host check on the challenge and it fires *first*:
the two checks agree by construction, so a host refusal is only ever reached for a host-side
reason (session closed, guest signed out), and surfaces as `AUTH_FAILED` through `onError`.

Tests: `tests/js/net-shell.test.mjs` (a fake Hangar over real `ws` sockets to an in-process
referee: open → host-signed AUTH → CREATE → STATE; refusals; foreign `event.source` ignored;
the website path through the adapter), `tests/js/napplet.test.mjs` (the adapter over a fake parent).

### 3c. Online play from inside the Hangar (2026-09-15)

The plumbing the embedded lobby stands on (napplet-v2 Block A). Everything here is the website
path unchanged when there is no shell.

**The seat, without storage.** Inside a shell (`E1Napplet.embedded()`) net.js never reaches
`localStorage` or `sessionStorage` (their getters throw in the frame). The seat lives in memory
and is mirrored to `E1Napplet.storage` under `600b:seats`, the website's map shape:
`{"<matchId>:<seat>": {matchId, seat, token, table, code, pubkey, seenAt}}`. Each entry names the
pubkey that holds it; at most 8 of them are kept; a write re-reads and merges, so a second Hangar
tab's entries survive. When the frame loads, the newest entry for the identity signed in now
becomes the session: a Hangar guest (a new key per page) never resumes another key's seat. The
mirror and the identity both answer asynchronously, so until they have, `E1Net.start(handlers)`
returns `{resuming:false, restoring}` where `restoring` is a promise of start's usual answer
(`{resuming, matchId?, seat?, loginRequired?}`), and the seat is resumed then — unless the page
has created, joined, queued, rejoined or left in the meantime, which wins. A mirror that refuses
every access costs only the reload's auto-resume: `AUTH_OK.active` still names the seat, and
`E1Net.rejoin(matchId)` takes it. Seat tokens go to that storage and to the socket, never into an
address, a log line or an error message.

**Invites through the outbox.** `E1Napplet.outbox.subscribe(filters, onEvent, onClosed) → unsubscribe()`
wraps the prelude's NAP-OUTBOX handle (`outbox.subscribe(filters, {relays})` → `{on("event" | "closed", fn), close()}`,
the same four relays a query names): `onEvent` gets bare events, `onClosed(reason)` hears a
subscription the shell ended, and without a shell outbox it is called once with `"unavailable"`
(`E1Napplet.outbox.canSubscribe()` asks first). It never throws. Inside a shell
`E1Net.nostr.subscribeInvites(pubkey, onInvite)` subscribes there with the website's filter
(`kinds:[4600]`, `#t:["invite"]`, `#p:[pubkey]`, the last hour, 40) and still parses and
signature-checks every row with `E1Schnorr` before `onInvite` sees it; a shell that cannot
subscribe, or ends the subscription, is `onError{INVITES_UNAVAILABLE}`.

**The napplet closes its own subscriptions,** because the host keeps them until the frame is
destroyed. At most 8 are open at once: a ninth closes the oldest, quietly, as that one's own
`unsubscribe()` would, because the newest is the one a member just asked for and is looking at
(and the lobby ends its previous invite subscription before it opens another, so an oldest one
past eight is a leak with nothing on screen). `E1Napplet.outbox.closeAll()` ends every open one,
also quietly; `site/play.js` calls it, with the lobby's own `close()` (which empties the invite
list), when the lobby is put away for a local game, when a board takes the lobby's place, when a
table is left and when a table ends (`OVER`). The adapter itself calls it on `pagehide`. Only a
subscription the shell ended calls `onClosed`.

**Open tables over the socket.** The frame has no HTTP to the referee. `E1Net.tables()` asks an
open, signed-in socket with `TABLES` (docs/net-protocol.md §2.1) and resolves the rows
`/api/tables` serves. When a host carries the socket and none is open it first calls
`E1Net.connect({table?})`, which opens and signs in a socket with no table in it (it is not reopened
when it drops). Lists asked for together share one `TABLES`; a list that cannot be had rejects
with an `Error` whose `code` is the reason (`NIP07_REQUIRED`, `RATE_LIMITED`, `TABLE_CLOSED`,
`TIMEOUT` after 15 s, `BAD_MESSAGE` from a referee that predates `TABLES`). On the website
`tables()` keeps reading `/api/tables` until a signed-in socket is open.

**No stakes.** `E1Net.stakesAllowed()` is `false` when embedded. `create` and `queue` then send
`stake: 0` whatever they are given, and `join` sends an explicit `stake: 0`, so a table that plays
for sats answers `ERROR{STAKE_MISMATCH}` ("this table plays for N sats") and seats nobody.

**The launch code.** `E1Net.launchCode()` returns `window.nappletContext.args.code` (nappelin #105)
once, checked again against `^[A-HJ-NP-Z2-9]{6}$`, else the website's `?code=`; every later call
returns null, and a frozen, absent or throwing context is simply null. On the website `start()`
reads `?code=` once and removes it from the address with `history.replaceState`, valid or not.

**Host facts this rests on** (nappelin `apps/hangar/src/host.ts`, Kehto shell and services 0.20,
read 2026-09-15): the outbox router has no NIP-65 relay lists, hence the named relays on every
publish, query and subscription and `toOutbox: false`; the relays a query or subscription names
are the ones the router reads when it allows them (a query without authors reads its fallback set
beside them), and it falls back to that set only when it allows none; subscription and query
results are `{event, sidecar}`; a subscription is closed
with `outbox.close {id, subId}` and ended by the host with `outbox.closed {subId, reason?}`; the
host has no per-frame cap on subscriptions and drops them without `outbox.closed` when the frame
closes or the identity changes (which closes the frame too). Storage values are strings of at
most 8 MB per key under 200-character keys; the napplet holds itself to 512 KB.

### 3d. The first screen and the lobby inside the Hangar (2026-09-15)

**One lobby, two pages.** `site/lobby.js` is the online lobby: `E1Lobby.mount(root, NET, hooks)`
builds its markup into `root` and returns `{handlers, refresh(), notice(text, tone), open(),
close(), launchCode, invite}`. `matchmaking.html` mounts it into `#online` and, when the referee deals a
seat, still hands off to `play.html`. Embedded, `play.js` mounts it into `#lobby` (where the
website keeps its small online door) with `{embedded: true, start: false, onSeat, onLobby,
collection, stack}` and starts the one `E1Net` itself: while the member sits at a table or watches
one the board reads the referee's messages, otherwise the lobby does, and an open table is always
the lobby's. A dealt seat shows the board in place (a local game still on the table is put away
first); leaving the table, or "Find another opponent" after a match, shows the lobby again and
never closes the frame. A frame reloaded while its member hosts an open table takes the seat back
from the mirror (§3c) and opens the lobby on that table's code, over a first screen where nothing
was chosen yet. In the open-table list a member's own table is offered as Rejoin, never as Join
(a join to it is `OWN_TABLE`, "That is your own table."), and a table whose host has been away
past the referee's grace is not listed at all (docs/net-protocol.md §2.6).

**Inside the Hangar the lobby differs from the website's in exactly this.** No sign-in button:
the shell's key is the identity, read when the frame loads (an identity change closes the frame,
so a reload is the change), and without one the lobby says "Sign in to Nappelin to play online.
Hotseat and games against the computer work now." No stake field and no stake note; create, queue
and join always send `stake: 0`; a table for sats is listed without a Join, and a
`STAKE_MISMATCH` reads "This table plays for sats; stakes are not available in Nappelin yet."
The settlement screen never opens. No share link: the host panel shows the code to read aloud
and "Send an invite", which the host signs through the outbox (as it signs the result). The
launch code (`E1Net.launchCode()`) is read once at mount, fills Join, opens the online choice,
and is never joined by itself or written into any address. The open-table list and the invite
list say in one line why they are empty: the table server cannot be reached (`NO_TABLE`,
`TABLE_REFUSED`, `TABLE_CLOSED`, `TIMEOUT`), the sign-in could not be confirmed, too many requests,
a referee too old to list tables, or invites that this shell cannot list.

**My collection online.** The referee takes a Stack in `CREATE`, `JOIN` and `QUEUE` under Classic
and Fast alike, and checks it twice: `cleanDeck` in `server/table.js` (a list of 40 to 300 known
ids of the table's ruleset, no Stake card, and each card's own copy limit under those rules, asked
of the engine's `E.copyLimit`: one for a genesis card, no limit for a Basic Resource, four for the rest)
and `E.createGame` (the same floor and limits again). A Stack past a limit is refused as `BAD_DECK`
naming the card, before any seat changes. So the embedded lobby
offers "My collection" once the member holds a card, labelled "n of 40 cards yours", and sends the
Stack `buildCollectionStack` deals for the table's rules: the lobby's rules for a table it opens
or a match it searches, an invite's `ruleset` for a join from an invite, the row's `ruleset` for a
join from the open-table list or a typed code that is listed there, and the lobby's rules for a
bare code with no row. A `BAD_DECK` refusal of a join names the table's rules; when they are not
the ones the Stack was built under, the lobby says "That table plays other rules. Pick Ready for a
starter Stack, then join again." The quick match pairs a built Stack only with another built Stack.
A collection Stack claims no possession at the table either.

**The first screen.** Embedded, `play.html` opens on `#first`: "Playing as" with the member's
look (name and picture through the seat code's `E1Look` book, the short npub until it lands,
"Not signed in" once the shell has said nobody), the choice Against the computer / Hotseat /
Online, which stays above the setup form or the lobby it opens, and the collection line. Every
service the shell does not give says so in one line: no identity, no collection app (the
collection line), and inside the lobby the table server and the invites.

**The first-game tour** belongs to the local game: it opens with Against the computer or Hotseat,
never over the first screen or the lobby. Whether it is done is stored under `600b:coach` through
`E1Napplet.storage` (the shell's storage inside the Hangar, localStorage on the website, and
localStorage directly on a page without the adapter), so a member who finished or skipped it does
not meet it again in the next frame. That answer is asynchronous, and the tour stays hidden until
it is known; storage that refuses to answer counts as a tour not done yet.

**The empty collection's door.** `E1Napplet.link.open(url)` asks NAP-LINK (`napplet.link.open`,
which resolves `{status: "opened" | "denied"}`) for an https URL only, and resolves `{ok: true}`
or `{ok: false, error}` on every outcome, a host that never answers included after 30 s, the
prelude's own deadline. When the collection line is the empty one and the shell grants `link`,
one button opens the constant `https://tcg.nappelin.com/shop.html`; the Hangar asks the member
first, and a refusal or 30 s of silence leaves the line as it was.

**For guild admins.** TIMELOCK TCG can sit in a guild's Play list: the Guilds tab opens the same
`600b-timelock-tcg` napplet, which starts on the first screen above, so a member plays against the
computer or hotseat at once and online once they are signed in. To gather members for a game
night, link the event to `https://nappelin.com/hangar/?napplet=600b-timelock-tcg`; the member who
hosts reads the table code aloud or sends it as an invite, and everyone else joins with it.
Tables opened from Nappelin never play for sats.

### 4. The inventory intent (bearlett → nappelin → game)

"INC/intent integration" is no longer out of scope for one purpose: knowing what the player owns
without a wallet in the frame. Bearlett (the collection napplet) stores a `nutft/inventory` and
re-emits it on `napplet:collection/inventory`; nappelin answers the `collection` intent from that
stored value for sender `600b-timelock-tcg` only.

`E1Napplet.collection.inventory(edition = "600b-e1")` →
`napplet.intent.invoke({archetype:"collection", action:"inventory",
convention:"napplet:collection/inventory", payload:{edition}})` → `result.inventory`, validated,
or `null` (nothing stored, another edition, no intent domain — never a throw).
`E1Napplet.collection.available()` asks `intent.available("collection")`.
`E1Napplet.collection.counts(inventory)` is the `asset_id → count` Map the Stack rules read.

Payload `nutft/inventory` v1 — exactly these fields, nothing else:

```json
{ "v": 1, "kind": "nutft/inventory", "edition": "600b-e1", "collection_id": "600B-E1",
  "catalog_uri": "https://…/nutft/catalog", "mint": "https://…", "at": 1757800000,
  "cards": [ { "asset_id": "E1-001", "count": 2 } ] }
```

`cards` sorted by `asset_id` (strictly ascending, no duplicates), `count ≥ 1`, at most 4096
entries, no proofs, no secrets, no pubkeys. `catalog_uri` is an https URL **or `""`** (bearlett
emits the empty string while the wallet holds no cards); `mint` is https; both ≤ 2048 chars; `at`
is floored unix seconds. The validator lives in `site/napplet.js` (`E1Napplet.collection.parse`).

Readers: `site/deck.html` asks the collection first when `E1Napplet.has("intent")` and says
"Cards from your Bearlett collection" under the mode buttons; `site/play.js`'s NutFT possession
check takes the same branch. Both fall back to the page's own NutFT wallet on the website.

### 5. Music cues and audio focus (NAP-CUE, 2026-09-15)

The Hangar's music napplet (DJ David Clanker) follows the table, and the table's own sound bed
steps back while that music plays. Spec: nappelin `specs/naps/nap-cue.md` (drafted in #107, merged in #128), under the
interim domain `x-nappelin-cue`. The manifest declares `["requires", "x-nappelin-cue"]`; a catalog
that does not grant it still launches the napplet, and the check below stays false.

**Nothing is sent until the shell says so.** `E1Napplet.cue.available()` is
`napplet.shell.supports("x-nappelin-cue") === true`, inside a frame with a parent. That is the only
probe: no `napplet["x-nappelin-cue"]` object is read, and anything but a plain `true` is a no. On the website, or without the feature, every call is a no-op and
nothing is posted.

| direction | message | fields |
| --- | --- | --- |
| napplet → host | `x-nappelin-cue.send` | `id`, `mood?`, `moment?` |
| host → napplet | `x-nappelin-cue.send.result` | `id`, `accepted: true` or `error` |
| host → music handler | `x-nappelin-cue.cue` | `mood?`, `moment?` (DJ David Clanker only; the TCG never receives it) |
| host → napplet | `x-nappelin-cue.focus` | `music: "playing" \| "idle"` (on change, and once at launch) |

It rides the table channel's pipe (§3b): a fresh `id` per send, replies matched on it, only
`event.source === parent` heard, and no answer within 8 s is an error.

- **Vocabulary, closed.** `mood`: `calm`, `tension`, `battle`, `victory`, `defeat` (held until the
  next one). `moment`: `turn`, `attack`, `lethal`, `match-end`, `booster-open`. Anything else
  resolves `{ok:false, error:"invalid request"}` without posting.
- **Throttles, the shell's own.** A mood at most once per 8 s: inside the window the latest one
  waits and is sent when it opens (an earlier waiting mood resolves `superseded`; a wait that ends
  on the mood already sent sends nothing). Moments at most 4 per second; extras resolve
  `rate limited` and are dropped.
- **Results.** `send()` never throws: `{ok:true, accepted:true}` or `{ok:false, error}`. An error
  (`not permitted`, `invalid request`, `rate limited`) is final and never retried. `accepted`
  says the shell took the cue, not that anyone listened, so nothing in the game depends on it.
- `E1Napplet.cue.onFocus(fn)` calls `fn("playing" | "idle")` and returns `unsubscribe()`.

**What the table sends** (`site/play.js`, only when embedded and available; derived from the
engine events `fx()` already receives and the view `render()` draws, sent on change only):

| cue | when |
| --- | --- |
| `turn` | a `TURN` event names a different seat than the turn before |
| `attack` | an `ATTACKERS` event with at least one attacker (Classic), or an `ATTACK` event (Fast `DECLARE_ATTACK`) |
| `lethal` | once per match, a seat `DAMAGE` or an `UPTIME` loss leaves that seat at 0 or less; sent before `match-end` |
| `match-end` | the view's `result` appears for a match first seen unfinished |
| `calm` | the first screen, setup, the lobby, a table left, `pagehide`, a draw; and in play when nothing below holds |
| `tension` | either seat at 6 Uptime or less (`CUE_TENSION_UPTIME`: 30% of the 20 start, one big Avatar's hit) |
| `battle` | an attack was made this turn (`turn.attacked` is not empty) |
| `victory` / `defeat` | a result with a winner, from the local seat: a referee's seat or the human in solo play; hotseat and spectators hear `victory` |

`booster-open` is never sent: the shop is not in the napplet. A resync (`STATE`) sends moods but no
moments, and a match first seen finished does not announce `match-end` again.

**Focus ducks the bed.** `playing` → `E1FX.duckBed(0.35)` and `E1FX.holdPressure(true)`; `idle` →
`E1FX.unduckBed()` and `E1FX.holdPressure(false)`. An untimed public `duckBed(depth)` is that held
focus level: fx.js's own ducks (a hold tone, a burn, the game-over fanfare) never lift the bed above
it and release back to it rather than to full, and `unduckBed()` returns the bed to 1. A focus duck
asked for before audio is armed is applied when the graph is built; holding the pressure pulse
leaves the saved pressure setting alone.

Tests: `tests/js/napplet.test.mjs` (the adapter over a fake parent and an injected clock),
`tests/js/client.test.mjs` (a scripted hotseat Fast game, a referee's seat, focus ducking),
`tests/js/fx-focus.test.mjs` (the bed's releases over a fake Web Audio graph).
