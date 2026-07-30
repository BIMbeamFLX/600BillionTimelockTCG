# 600B Timelock TCG — Napplet Build Spec (v1)

Output of `design-napplet`. Consumed by `build-napplet`, verified by `test-napplet`.
Decisions locked with FLX 2026-07-28: **moves are WebRTC-only (no move locks, no move
log on relays); Nostr events only for invites/handshake where needed and for match
results/stats.**

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
       (P #FF6A00, B #F3C244, K #7447B8, S #FFF7EC, T #5E5ACB) are brand-fixed and
       never follow the shell theme.

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
  hidden    commit-reveal, no dealer: at match start each player sends
            hash(decklist + shuffleSeed); at match end / concede / dispute the seed
            and decklist are revealed and the opponent's client re-verifies every
            draw retroactively.
  results   at match end each client offers "publish result": outbox.publish one
            addressable event (d=matchId) with {matchId, players, winner, turns,
            engineVersion, transcriptHash}. Stats view: outbox.query both players'
            result events; agreement => confirmed, mismatch => shown as disputed.
  cards     trimmed card database (id, name, cost, type line, affinity, A/R, rules
            text) bundled inline from cards/e1-cards.json (483 KB source, trimmed
            subset well under budget). Card face images (art/cards/final/) are NOT
            bundled: fetched via resource.bytes from the published asset location,
            in-memory LRU cache, text-card fallback.

relay escape hatches: none.
```

## Flagged gaps (resolve at build time, do not invent)

1. **webrtc surface**: no published NAP doc yet; the implementation boundary is the
   `@napplet/nap/webrtc` typings (`WebrtcOpenRequest`, `WebrtcSession`,
   `WebrtcMessageEvent`, `WebrtcPeerEvent`, `WebrtcStateEvent`, `WebrtcClosedEvent`).
   Read them during build; do not assume shapes beyond `open/send/close/onEvent`.
2. **Result event kind**: no established Nostr convention for game results. Pick one
   addressable kind, version it inside the payload, document it in this file.
3. **Asset base URL** for card images is set at publish time (nsite/Blossom).
4. **storage quota is 512 KB**: match history is a capped ring buffer (last ~50
   results); decks are card-ID lists (tiny).
5. **Engine**: the deterministic E1 engine (LIFO queue, state checks, resource burn)
   is the core build effort and must be pure/seedable so both peers replay
   identically. Rulebook §9–§17 is the contract; `cards/e1-cards.json` is the card
   authority.

## Explicitly out of scope for v1

- Sats/Cashu stakes (no `value` NAP exists yet; sandbox forbids direct mint HTTP).
  Revisit when NAP-VALUE ships or via companion service outside the napplet.
- Matchmaking lobby, spectating, tournaments, INC/intent integration.
- Stake Mode / Toss Legacy modules (rulebook §19) — off, as in the default profile.
