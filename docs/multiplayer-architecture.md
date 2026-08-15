# 600B Timelock TCG — Multiplayer Architecture

Decision record. Supersedes the transport and hidden-information decisions locked
2026-07-28 in `napplet-spec.md`; everything else in that spec stands.

**End state:** the game ships as a napplet on `napplet.run`, card faces live on Blossom,
identity is NIP-07, and both public unranked and ranked table play run on that identity.

---

## The shape

```
napplet (future P2P option)                Table (public unranked + ranked)
┌────────────────────────────┐             ┌──────────────────────────┐
│ peer A          peer B     │             │ referee + dealer         │
│  engine.js  ≡  engine.js   │◄── same ───►│  engine.js (headless)    │
│  DeckOracle: commitments   │   engine    │  DeckOracle: server-held │
└────────────┬───────────────┘             └────────────┬─────────────┘
  shell-brokered WebRTC                       WebSocket
             │                                          │
             └────────────► dual-signed result ◄────────┘
                                    │
                        600B authority key republishes
                                    │
                              Nostr leaderboard
```

One engine, three topologies. The only thing that varies is who answers
*"what card is at Stack slot i, and is this seat entitled to know?"*

---

## Decisions

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Where authority stops | The **Table** is authoritative for public unranked and ranked play; P2P remains a future option |
| D2 | Card legality | **All 295 Edition One cards are scripted**; no assisted or free-form cards in either format |
| D3 | Engine language | **JavaScript**, one pure headless module |
| D4 | 2026-07-28 napplet lock | **Amended** — P2P target and symmetric engines kept, shuffle scheme replaced |
| D5 | Hidden information | **Opponent-held secret permutation** over per-card commitments |
| D6 | Leaderboard trust | **Dual-signed results + 600B authority key** — signatures done, authority key not |
| D8 | fips.network | **Lore now**, native-client stunt later |

### D3 — why JavaScript

The expensive part of every topology is identical: a pure, seeded, serialisable,
headless rules engine. Written in Python it could never run in a browser peer, so P2P
would be foreclosed permanently and the client would need a second engine anyway — two
implementations that must agree exactly on 295 cards, where every divergence is a desync.

### D5 — why the locked shuffle had to change

The scheme locked on 2026-07-28 was:

> each player sends `hash(decklist + shuffleSeed)` at match start; the seed is revealed
> at the end and the opponent re-verifies every draw.

A player generates their own `shuffleSeed`, so **they know their entire draw order from
turn one**. The commitment prevents *changing* the order; it does nothing to prevent
*knowing* it. In a card game that is decisive — mulligan decisions, knowing exactly when
an answer arrives, knowing the top card every turn — and the resulting transcript
verifies clean, so post-hoc checking never catches it.

The replacement: per-card hash commitments plus a **secret permutation held by the
opponent**, released one slot at a time. Neither player knows their own order. It costs
about 80 SHA-256 hashes and a few kilobytes per match, and it *prevents* deck stacking,
draw equivocation and self-knowledge rather than detecting them afterwards.

Because a TCG has no shared deck — each player shuffles only their own — the mental-poker
impossibility results do not bind here, which is why this is cheap.

### D2 — one rules surface

The compiler now emits zero assisted cards: all 295 Edition One cards resolve through
engine operations. Casual and Ranked therefore use the same rules surface. Ranked may later
restrict deck construction or matchmaking, but it does not need a smaller card pool.

### D6 — what "verified" means on the ladder

Both players co-sign the result. A 600B authority key republishes an addressable score
record **only** when the signatures agree and the transcript replays clean against the
versioned engine. Without an authority, two fresh npubs can farm rating for free —
abandonment and Sybil rating farming are the two problems P2P provably cannot fix
on its own.

**Where this stands.** The signature half is built and the authority half is not.

A match is now bracketed by four signatures, not two: both seats sign a kind 4600 `t=start`
announcement over byte-identical content when the match is dealt, and both sign the kind 31600
result when it ends (`docs/net-protocol.md` §6.1a, §6.2). `server/table.js` verifies every one
of them — canonical id recomputed from the event's own bytes, BIP-340 signature checked — before
a row exists, and refuses an event submitted under a pubkey that is not the sender's own seat.

`site/ladder.js` then computes a standing from relay events **and nothing else**. There is no
ladder server, no accounts table and no row anyone can edit. A match counts only if all four
hold: two distinct pubkeys published a result for the same `matchId`; the `content` is
byte-identical; both signers are the two players *named inside* that content; and every
signature verifies against a recomputed id (`site/schnorr.js`, checked against all 19 official
BIP-340 vectors). Anything failing is reported in `rejected` with a reason — **a ladder that
silently drops results is indistinguishable from one that is broken.** Elo, K=24, start 1500,
replayed oldest-first so two browsers computing from the same events agree.

What that still cannot do is exactly what D6 predicted. Verified signatures prove *these two
keys agreed on this outcome*; they say nothing about whether the two keys are two people, or
whether a losing player simply closed the tab before the result existed. **The authority key is
the missing half, not a formality** — until it republishes, "Ranked" is a word for an
unauthenticated Elo table with very good hygiene.

---

## Known non-viable: fips.network as transport

A browser tab cannot open a FIPS connection. No WebRTC, no WebSocket, no WASM build, no
JS SDK; the only application interface is a native IPv6 TUN adapter, and the JSON control
socket is control-only with no send/recv for payloads. A peer reachable only at an
`fd00::` literal cannot be issued a TLS certificate, so any https build is
mixed-content-blocked.

The balloon mesh is 600B lore, not a FIPS capability, and no relationship exists between
the projects. Keep the promo card; point its protocol note at a true FIPS fact — a Nostr
keypair *is* the routing address, and the mesh reroutes around damage on its own.

P2P was never blocked by cryptography. It was blocked by FIPS having no browser path —
and the napplet shell's WebRTC NAP solves that instead.

---

## Delivery order

| Phase | Delivers |
| --- | --- |
| **P0** | All 295 cards compiled and enforced; no assisted tier remains |
| **P1** | Headless `engine.js`: seeded, serialisable, action-log replayable, redacting |
| **P2** | Remove the legacy manual proposal path after compatibility migration |
| **P3** | Napplet build: shell-brokered WebRTC, symmetric engines, `DeckOracle` v1 |
| **P4** | NIP-07/NIP-42 login complete; every stored and published event signature-verified; relay-derived ladder shipped. **Authority-key republication remains.** |
| **P5** | `DeckOracle` v2 — opponent-held permutation |
| **P6** | Table referee hardening for ranked; async play; spectating and replays |

## Decided since

- **Lobby *and* matchmaking queue** — they answer different questions and are cheap together.
  A six-character code is for two people who already know each other; `QUEUE` is for the rest.
  The queue holds live connections and never database rows, so it leaves no ghost table behind
  (`net-protocol.md` §5.2).
- **Result event kind: 31600, addressable on `d = matchId`.** The handshake, start announcement
  and result share kind 4600/31600 with a versioned JSON payload, so the content can move
  without burning a kind. No Nostr convention existed; this is ours and it is versioned.
- **Settlement is non-custodial and always will be.** A stake is agreed inside the signed start
  event and paid winner-to-loser as a NIP-57 zap against the winner's own lightning address.
  Nothing in this system holds, escrows or moves sats (`net-protocol.md` §6.7).

## Open, not yet decided

- Timer model (chess-clock reserve plus a soft per-action rope is the recommendation) — still
  the largest hole for ranked play, and the reason §4.4's "claim the win" is a button a human
  presses rather than a rule
- The authority key itself: where it lives, what it signs, and what disqualifies a match
