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
  theme    -> 600B dark fallback palette
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

theme: optional. Map theme.colors.background/text onto :root, html, body and app
       root; surface -> panels, border -> chrome lines, primary -> action buttons,
       muted -> secondary text. Subscribe themeOnChanged and repaint all tokens.
       Fallback palette: bg #09080B, text #FFF7EC, primary #FF6A00, surface #19151F,
       border rgba(185,145,228,.27), muted #C7BBCC. The five affinity accent colors
       (P #F3C244, B #F7931A, K #FFF7EC, S #7447B8, T #17BEBB — the locked E1
       "Plate" palette) are brand-fixed and never follow the shell theme.

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
`identity, outbox, resource, storage, intent` (`<meta name="napplet-requires">`); `table` is a
host channel, not a NAP domain. `dm`, `common`, `notify` are not used.

### 3a. Identity and outbox — what the prelude really offers

- `napplet.identity.getPublicKey(): Promise<string>` is the whole identity surface (empty string
  when nobody is signed in). There is **no** `get()`, `request()` or `signEvent`.
  `E1Napplet.identity.current()`/`login()` call it; `login()` rejects with "sign in to the shell
  first" rather than prompting, because signing in is the Hangar's flow.
- `E1Napplet.identity.sign(event)` has no shell path: it rejects with
  `"the shell signs only through outbox.publish and table.sign"` unless a NIP-07 signer exists.
- `napplet.outbox.publish(template)` takes an **unsigned** template; the host signs with its
  identity and fans out to `wss://relay.nappelin.com` + damus/nos.lol/primal. It resolves the raw
  result message — `error` on failure, never a rejection. `E1Napplet.outbox.publish` returns
  `{ok, via:"shell", event}` (the signed event, from `msg.event || msg.result`) or
  `{ok:false, via:"shell", error}`. `E1Napplet.outbox.query(filters)` → `msg.events || []`. On the
  website the same calls sign with NIP-07 and use `E1Net.nostr`'s own fan-out.
- **net.js consequence.** play.js keeps its `sign → publish → sendNostr` order. Inside a shell
  `E1Net.nostr.sign()` of a kind 4600/31600 template therefore *publishes it through the outbox*
  and returns the signed event (the referee still records it verbatim); `publish()` recognises an
  event the host already fanned out and reports `{ok:true, accepted:["shell"], tried:1}` instead of
  sending a second copy. A kind 9734 zap request cannot be signed in a shell at all.
- The shell's pubkey is cached **in memory** by net.js (`savedPubkey()`); `localStorage` is never
  named at a call site outside a try, because the getter itself throws in the sandbox.
- Embed detection: `E1Napplet.embedded()` is `window.napplet` (object) OR `window.nappletContext`
  OR `?embed=1`. `E1Napplet.escape()` posts `{type:"nappelin.escape"}` to `parent`; no-op on the
  website. Under embed with no `theme` domain, `E1Napplet.NAPPELIN_THEME` (iron `#0f0c08`,
  parchment `#ece3d0`, brass `#e7bf76`, …) is painted instead of the 600B fallback palette.
- `tableUrl()` in a srcdoc frame: `?table=` → the seat's saved table → `globalThis.E1_TABLE_URL`
  (a `wss?://` constant the build may inject) → the page origin → `wss://tcg.nappelin.com/ws`
  when embedded → null.

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
