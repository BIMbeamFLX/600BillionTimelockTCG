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
