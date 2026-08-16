# Handover — infrastructure and a Cashu mint for card trading

For Breno. Written 2026-08-16 against `main` at the current head.

The point of this document is to be honest about a seam: **the game is finished and
the ownership layer does not exist.** Everything below "What we have" is real,
tested and running. Everything under "What we need" is a hole with nothing in it —
not a partial implementation you have to work around.

---

## 1 · What the game is, in one paragraph

A two-player trading card game that runs entirely in a browser. 295 Edition One
cards plus 2 promos. Identity is a nostr key (NIP-07); there are no accounts, no
users table, no passwords and no email anywhere in the system. A match is played
against a referee process over a WebSocket; the result is signed by both players
and published to nostr, and the leaderboard is recomputed in the reader's own
browser from those signed events. Optional sats wagers are settled wallet to
wallet over Lightning — **the software never holds, escrows or moves a satoshi**,
and that is a deliberate architectural commitment rather than a limitation we
intend to remove.

---

## 2 · What we have

### 2.1 Card data — one source of truth

- `cards/e1-cards.json` — the canonical 295 cards: id, name, type, affinity, cost,
  rules text, help text, flavour, protocol note, art direction, art prompt.
- Compiled to `site/play-data.js` by `scripts/build_play_data.py`. The compiler
  turns printed rules text into engine operations, so the printed card and the
  rules engine cannot disagree. **All 295 auto-resolve; zero require a human
  adjudicator.**
- Card ids are stable and are the only identifier you should ever key on:
  `E1-001` … `E1-295`, plus promos.

### 2.2 Card faces — already content-addressed, already on Blossom

This is the part most relevant to you, because it is the ownership-adjacent piece
that already works.

- 297 rendered WebP faces in `art/cards/node-runner-web/`.
- `cards/e1-blob-manifest.json` — the canonical manifest: for every face, its
  `file`, `sha256`, `bytes`, `card_type`, `affinity`, `rarity` and a Blossom URL.
- `site/blob-map.js` — face filename → SHA-256, emitted from that manifest.
- `site/faces.js` resolves a face by **hash, not by URL**: it asks
  `https://<mirror>/<sha256>.webp` across three Blossom mirrors
  (`blossom.primal.net`, `blossom.bimcvp.com`, `nostr.download`), verifies the
  bytes against the hash before use, caches in Cache Storage, and falls back to a
  local file.
- `scripts/check_blobs.py` verifies every hash in the manifest is actually
  retrievable from a mirror, and exits non-zero if not. It gates deploys.

**Why this matters to a mint:** a card's artwork already has a canonical,
verifiable, transport-independent identifier. If a token needs to commit to "which
card", `(card_id, sha256)` is a pair that is already published and already checked
by the client.

### 2.3 The booster shop — an auditable print run with no payment path

- `scripts/build_shop_data.py` emits `site/shop-data.js`: a **fixed, ordered box**
  of **4,535 cards**, the seed that shuffled it, and a **SHA-256 commitment over
  that order**. Pack size 5. Odds: common 79.38%, uncommon 17.64%, rare 2.98%.
- The commitment is the fairness story: publish the hash before selling, reveal
  the order when the box is empty, and anyone can replay it. The shop page
  recomputes the digest in the browser to prove the box matches the commitment.
- `site/shop.js` has two modes. `demo` opens free packs against a local cursor —
  same box, same odds, nothing owed. `mint` posts to `MINT_URL`.
  **`MINT_URL` is `null`, so the paid path does not exist**; the UI says so
  plainly rather than offering a button that does nothing.
- The mint-mode call it already makes is: `POST ${MINT_URL}/pack?count=<n>`.
  That is the only shape currently assumed and we are not attached to it.

### 2.4 Identity, matches, and the ladder

- **Identity:** NIP-07 nostr keys. The referee verifies a fresh NIP-42 challenge
  (BIP-340, `@noble/curves`) before seating anyone. No anonymous online seats.
- **Referee:** `server/table.js` — one Node process serving the static site, a
  JSON API and the match WebSocket, persisting to SQLite. One transaction per
  accepted action, committed *before* the opponent sees it.
- **Match record:** both players sign a kind-31600 addressable event over
  byte-identical content. A match counts only when two distinct pubkeys signed the
  same bytes and both signers are the players named inside.
- **Ladder:** `site/ladder.js` + `site/schnorr.js` — a dependency-free BIP-340
  verifier so the browser checks every signature itself. It refuses to run without
  the verifier rather than trusting a relay.
- **Wagers:** agreed at match start, signed by both seats in a kind-4600 `t=start`
  event, and settled after the match by the loser paying the winner's own
  lightning address (NIP-57). Nothing is escrowed.

### 2.5 Deployment shape

- `scripts/publish_site.py` builds a `dist/` publish set from git-tracked files
  and **refuses to run if any referenced asset is missing**. ~58 files / 7.8 MB
  without card faces (Blossom serves those), ~343 files / 46 MB with them.
- `docs/deploy.md` — two topologies, env vars, reverse-proxy requirements,
  pre-flight checklist. It is explicit that **none of it has been executed end to
  end yet.**
- Static-only hosting (nsite) has no `/ws` and no `/api/*`, so online play needs
  the referee reachable separately. A static deploy alone is hotseat/NPC only.

---

## 3 · What we do NOT have

Say this plainly, because it is the whole job:

**There is no ownership of a card anywhere in this system.**

- A player's collection lives in `localStorage` under `600b:shop`. Clearing the
  browser deletes it. There is no server-side record, no token, no signature and
  no transfer mechanism.
- `site/shop.js` currently tells the player *"the cards become yours on Nostr"*
  when the mint goes live. **No mechanism behind that sentence exists**, in code
  or in design. A security review flagged it as an unbacked forward claim. It is
  a promise you would be implementing, not integrating with.
- There is no trading, no secondary market, no escrow, no price discovery, and no
  concept of a card being spent, locked or transferred.
- Deck construction does **not** check ownership. The Stack Builder lets anyone
  build with any of the 295 cards, and the referee validates only the format
  rules (40 minimum, max 3 copies of a card, Basic Resources exempt, no
  disabled-module cards). Making decks ownership-gated is a product decision
  nobody has taken.

---

## 4 · What we need from you

### 4.1 The core question, first

**What does a token commit to, and what does redeeming it mean?**

Options we can see, with no strong preference yet:

1. **Card-backed ecash.** A Cashu token whose keyset represents "one copy of
   `E1-004`". Trading is a normal Cashu swap. Redeeming means the mint marks it
   spent and the holder's collection reflects it. Simple, private, and the mint is
   trusted for issuance and redemption.
2. **Sats-denominated with a card claim.** Tokens are ordinary ecash; the card
   claim is a separate signed record. Cleaner economics, but then card ownership
   is not the token and needs its own home.
3. **Pack-as-token.** The mint sells sealed packs; the *pull* happens on redemption
   against the committed box order, so the box commitment (§2.3) becomes the
   fairness proof for a paid product rather than a demo.

Option 3 is the one that fits what already exists — the committed box, the
published odds and the in-browser verification were built for exactly that
argument — but it is your call.

### 4.2 What we need regardless of the shape

- **An HTTP contract we can code against.** The client currently assumes
  `POST /pack?count=<n>`. Give us the real one: endpoints, auth, error shapes.
  Anything we call must be safe to call from a browser (CORS) and must fail
  legibly, because our design rule is that a refused action always lands on a
  definite sentence rather than a spinner.
- **How a player proves who they are to the mint.** Everything on our side is a
  nostr pubkey. If the mint wants NIP-98 HTTP auth, or a Cashu-native scheme, say
  which — but assume the player has a NIP-07 signer and nothing else. No accounts,
  no email, no password. We will not add them.
- **Where a collection lives.** Today it is `localStorage`, which we consider
  temporary. If the mint is authoritative, we want a read endpoint keyed by pubkey.
  If ownership is bearer-token-only, tell us, because then losing the token is
  losing the card and the UI has to say that in as many words.
- **The trust statement, in one sentence.** We will print it on the page. Our
  house rule is that the UI must state exactly what it can and cannot prove — the
  ladder page, for example, says outright that it cannot prove a match was played.
  Whatever the mint's custody model is, a player will read it before paying.

### 4.3 Constraints we will not trade away

These are not preferences; they are load-bearing and reviewed.

1. **The game client never custodies funds.** No key handling, no auto-payment, no
   escrow held by us. Every payment is the player's own wallet, with their wallet
   confirming. A mint may custody — that is what a mint is — but the boundary must
   be visible and stated.
2. **Identity is a nostr key.** No account system will be added.
3. **Content addressing stays honest.** If a token references artwork, it
   references the SHA-256. We verify hashes before use and we would like the mint
   to as well.
4. **Nothing may block play.** The whole game is free and works with no mint, no
   relays, and no server. Hotseat and the NPC run from a file with zero network.
   Ownership must be additive; a mint outage must never stop a match.
5. **The site is static and buildable without a bundler.** Plain scripts. If you
   need a client library, it has to work as a `<script>` tag or we vendor it.

### 4.4 Infrastructure we have not built and would take help on

- **TLS + reverse proxy for the referee.** `docs/deploy.md` §4 has an untested
  nginx sketch. `/ws` must be upgraded, `/api/*` proxied, and `PUBLIC_URL` must be
  set to the public `wss://` URL — the referee cannot infer scheme or port and a
  wrong value produces invites that fail silently on someone else's machine.
- **A published Blossom pipeline.** Card faces are on Blossom, but uploading is
  currently a manual step outside the repo. Right now **all 296 faces are
  re-rendered and unpublished** — a frame redesign moved every card to a full
  4:5 art window and re-hashed the whole set except the card back
  (`uv run python scripts/check_blobs.py` lists them). A scripted, keyed upload
  path would close that.
- **Production DB hygiene.** Start on a fresh `matches.db`. A historic commit on
  the public remote contains a WAL file with hidden per-match seeds; those seeds
  are worthless against a database that does not contain those matches, which is
  why "fresh file" is a checklist item rather than a nice-to-have.

---

## 5 · Where to start reading

| Question | File |
|---|---|
| What is a card? | `cards/e1-cards.json`, `docs/e1-draw-cycle.md` |
| How do faces resolve? | `site/faces.js`, `cards/e1-blob-manifest.json`, `scripts/check_blobs.py` |
| What is the shop today? | `site/shop.js`, `scripts/build_shop_data.py` |
| How does a match work? | `docs/net-protocol.md` (normative) |
| How is a result trusted? | `site/ladder.js`, `site/schnorr.js` |
| How do we deploy? | `docs/deploy.md`, `scripts/publish_site.py` |
| What is still broken? | `docs/handover/2026-08-15/BUGS.md` and its postscript |

Tests: `npm run test:js` (292) and `uv run pytest -q` (108). Both green on `main`.
