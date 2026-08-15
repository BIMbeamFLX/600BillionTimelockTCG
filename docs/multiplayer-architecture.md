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
| D6 | Leaderboard trust | **Dual-signed results + 600B authority key** |
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
| **P4** | NIP-07/NIP-42 login complete; dual-verified results and authority-key leaderboard remain |
| **P5** | `DeckOracle` v2 — opponent-held permutation |
| **P6** | Table referee hardening for ranked; async play; spectating and replays |

## Open, not yet decided

- Timer model (chess-clock reserve plus a soft per-action rope is the recommendation)
- Lobby versus matchmaking queue for a small population
- Result event kind — no Nostr convention exists for game results; pick and version one
