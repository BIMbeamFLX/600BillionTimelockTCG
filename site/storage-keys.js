/* ---------------------------------------------------------------------------
 * storage-keys.js — the shared storage contract between the napplets.
 *
 * Splitting the site into standalone napplets (matchmaking, play, shop/mint,
 * stacks & collection) turns a handful of localStorage keys into a real
 * interface: one napplet writes a key another reads. deck.html and shop.js both
 * write "600b:decks", and each used to carry its own copy of the key name and
 * the budget caps with a comment begging the other to stay in step. This file
 * is that single source of truth, so the caps can never drift apart again.
 *
 * It is a plain global (not an ES module) so it loads the same way under a
 * shell, over http, and from a bare file:// — the offline invariant. Pages read
 * `globalThis.E1Keys` but keep their own literal as a fallback: a missing
 * include degrades to today's behaviour rather than mis-keying storage.
 *
 * KEY NAMES are the inter-napplet wiring. BUDGET CAPS bound "600b:decks" inside
 * the 512 KB a shell gives the whole napplet (docs/napplet-spec.md). MAX_COPIES
 * is deliberately absent: the per-card limit is a §7 RULES constant that lives
 * with the engine's deck validator, not a storage budget.
 * ------------------------------------------------------------------------- */
(function (root) {
  "use strict";
  if (root.E1Keys) return; // idempotent: first include wins, re-includes are no-ops

  root.E1Keys = Object.freeze({
    // Shared storage keys — the contract each napplet reads/writes.
    PUBKEY: "600b:pubkey", // identity: the signed pubkey, written by napplet.js, read by all
    MATCH: "600b:match", // matchmaking -> play handoff ({matchId, seat, token, table, code})
    DECKS: "600b:decks", // the Stack library ({ name: [ids] }); written by deck.html AND shop.js
    DECK_HANDOFF: "600b:deck-handoff", // one-shot { name, cards[] } any page may hand to deck.html
    SHOP: "600b:shop", // the card collection (no ownership yet — scaffolds the mint)
    PROBE: "600b:probe", // throwaway key used to test whether storage actually persists

    // The "600b:decks" budget — deck.html and shop.js must agree on these.
    DECKS_BUDGET: 160 * 1024, // bytes of the 512 KB napplet budget the Stack library may use
    MAX_STACKS: 32, // saved Stacks that fit in the budget
    MAX_CARDS: 4600, // ids in one Stack — a whole booster box, so a "send everything" never truncates
    MIN_STACK: 40, // §7 floor for a legal Stack
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
