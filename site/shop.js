/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — the booster shop.
 *
 * One box, opened from the top. `shop-data.js` ships the ordered box, the seed
 * that shuffled it and the SHA-256 over that order, so a pull is auditable
 * rather than trusted: publish the commitment before selling, reveal the order
 * when the box is empty, and anyone can replay it. The page does not ask to be
 * believed — it re-hashes the whole box in the browser on request.
 *
 * TWO MODES, ONE PULL PATH. `demo` opens free packs against a local cursor —
 * the same box, the same odds, nothing owed. `mint` asks the LNURL mint for an
 * invoice, the buyer pays it with their OWN wallet, and the mint issues the
 * card. Switching is configuration (MINT_URL + ?shop=mint), never a rewrite:
 * both modes call pullPack() and render the identical reveal.
 *
 * While MINT_URL is null there IS no paid mode. Rather than leave a button
 * that quietly does nothing, the page says so in words, falls back to the free
 * pull, and keeps the box, the odds and the commitment honest. A sandboxed
 * napplet cannot reach a mint at all, which is precisely why sats stakes are
 * out of scope for napplet v1 (docs/napplet-spec.md) — so the page ASKS before
 * it offers, and says something true instead of failing at a wall.
 *
 * This file never sees a payment credential. It requests an invoice and shows
 * it; the wallet that pays it is the buyer's.
 *
 * Nothing here touches browser storage, a nostr extension or a bare palette:
 * it all goes through the napplet adapter, which is async, so state is read at
 * boot and every write is a queued read-modify-write. No pull is signed and no
 * collection is published, so a free pack still needs no identity at all — but
 * EARLY ACCESS does. While the mint sells to a short list of nostr keys, the
 * page asks the identity domain who the buyer is and asks the mint whether that
 * key may buy. It asks only when the buyer presses something: a page that
 * signed on load would pop the extension at every visitor who wandered past.
 * ------------------------------------------------------------------------ */
(function (root) {
  "use strict";

  const BOX = root.E1_BOX || { box: [], odds: {}, packSize: 5 };
  const CARDS = root.E1_CARDS || [];
  const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const FACES = root.E1Faces || null;
  /* The shared storage contract (site/storage-keys.js). Prefer it; fall back to
   * this file's own literals so a missing include degrades to today's values. */
  const K = root.E1Keys || {};
  const STORE = K.SHOP || "600b:shop";
  const PROBE = K.PROBE || "600b:probe";
  const BACK = "600B-Timelock-card-back.webp";

  /* The Stack Builder's own store, written in its own shape ({ name: [ids] }).
   * A pulled card has somewhere to go the moment it lands. */
  const DECK_STORE = K.DECKS || "600b:decks";
  const DRAFT_NAME = "Booster pulls";

  /* ------------------------------------------------------------ the budget
   * A shell gives the WHOLE napplet 512 KB (docs/napplet-spec.md, flagged gap
   * 4), so this page takes a share and lives inside it rather than discovering
   * the ceiling as a silent loss. The log is a ring buffer; if the record is
   * still over budget the OLDEST packs are dropped until it fits, because the
   * cursor and the pull tally are what a player would actually miss — the log
   * is a nicety, the tally is what tells a pack which of its cards are new.
   * DECK_* now come from site/storage-keys.js, shared with deck.html which owns
   * the other side of this key. */
  const HISTORY_MAX = 60; // packs kept in the log; the tally keeps counting
  const SHOP_BUDGET = 96 * 1024;
  const DECK_BUDGET = K.DECKS_BUDGET || 160 * 1024;
  const MAX_DRAFT = K.MAX_CARDS || 4600; // one whole box, so a full box of pulls never truncates
  const MAX_STACKS = K.MAX_STACKS || 32;
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

  /* ------------------------------------------------------ the napplet seam
   * The shell's storage NAP inside a shell, localStorage on the website, and —
   * if napplet.js itself never loaded — a memory store that forgets honestly
   * rather than one that pretends to save. */
  const NAP = root.E1Napplet || null;
  const memory = new Map();
  const store = (NAP && NAP.storage) || {
    async get(key) { return memory.has(key) ? memory.get(key) : null; },
    async json(key, fallback) { const raw = memory.get(key); return raw ? JSON.parse(raw) : fallback; },
    async set(key, value) { memory.set(key, String(value)); return false; },
    async remove(key) { memory.delete(key); return true; },
  };
  /* A sandbox that blocks outbound fetch is detectable before anything is
   * tried, so the paid path can be withdrawn with an explanation instead of
   * throwing a network error in a buyer's face. */
  const ONLINE = NAP ? NAP.canReachInternet() : true;

  const NO_STORE =
    "This shell keeps no storage, so your collection and pull history live only until you close the page. " +
    "The box, the odds and the fingerprint are unaffected.";
  const REFUSED =
    "This browser refused to save (private mode, or the disk is full), so your collection will not survive a reload.";

  /* The live mint's base URL. Null until the operator has one — the shop then
   * explains itself instead of pretending to sell. */
  const MINT_URL = root.location && /^https?:$/.test(root.location.protocol) ? root.location.origin : null;
  const PAID_LIVE = Boolean(MINT_URL);

  const params = new URLSearchParams(root.location.search);
  let claim = params.get("claim");
  const MODE = params.get("shop") === "mint" ? "mint" : "demo";
  /* What the button will ACTUALLY do. Asking for mint mode without a mint —
   * or from a sandbox that cannot reach one — gets the free pull and a notice,
   * never a control that no-ops or dies at a wall. */
  const PULL_MODE = MODE === "mint" && PAID_LIVE && ONLINE ? "mint" : "demo";

  /* Every rung the ladder below names, and Basic shares the floor with Common
   * on purpose: RANK drives the REVEAL, and a Basic Resource is not a moment —
   * it turns over first with the commons and never charges. The table has to be
   * complete anyway, because everything downstream of it indexes it directly. */
  const RANK = { genesis: 5, vault: 4, promo: 3, rare: 3, uncommon: 2, common: 1, basic: 1 };
  /* Rarest first, and an unknown rarity sorts to the end rather than to the
   * front — indexOf returns -1, so anything the ladder does not name would lead
   * the table it has no claim to lead. */
  const LADDER = ["genesis", "vault", "promo", "rare", "uncommon", "common", "basic"];
  const rungOf = (rarity) => { const i = LADDER.indexOf(rarity); return i < 0 ? LADDER.length : i; };

  /* ------------------------------------------------------------ the mint box
   * The NutFT mint does not sell the box above. It sells a bigger, different one
   * — packs of 15, committed as a CENSUS of print runs rather than as a shuffled
   * order. Not one of its figures is written down in this file any more; see
   * boxFromMint below for where they come from and why.
   *
   * EVERY SHARE IS OVER THE WHOLE BOX — every card a buyer can receive, not just
   * the numbered ones. A buyer counting what came out of their packs counts the
   * Basic too, so a percentage that quietly drops a fifteenth of the box is a
   * percentage that flatters every remaining row by x1.0713: it would print Rare
   * as 6.64% of a box in which Rare is 6.19%.
   *
   * `issued` is the arithmetic nobody wants to leave out: the prime pool is
   * printed deeper than there are prime slots to draw it, so a tail of copies
   * exists that no pack can ever reach, which is why the page reports `printed`
   * and `issued` separately. Genesis, Vault and Rare are therefore ceilings,
   * while the prime SLOT is exactly one card in every pack. */
  /* The one row the mint's per-card figures cannot describe. Basics carry no
   * print run — that is what uncapped means — so their "copies" is a SLOT count,
   * one per pack, filled in from the mint's own pack count in boxFromMint.
   *
   * AND EVERY ONE OF THOSE SLOTS IS THE SAME CARD. The mint fills the basic slot
   * from catalog.basic[0] (server/nutft-mint.js), so nine of the ten Basics
   * never leave the catalog. Printed as "N copies · 10 cards" the row read as
   * roughly a tenth of N each — a number no buyer will ever see — so the tile
   * states the slot and the single card that fills it instead. */
  const BASIC_TIER = { name: "Basic", cards: 10, oneCard: true };

  /* NOTHING ABOUT THE MINT'S BOX IS WRITTEN DOWN HERE ANY MORE.
   *
   * Every number below used to be a literal, and every one of them was wrong
   * within a day of the mint being resized: the pack count, the print run, the
   * per-tier copies, and the census fingerprint the verify button re-hashes. A
   * page that states a supply figure the mint disagrees with is worse than a
   * page that states none, because the whole argument here is that you can
   * check it.
   *
   * So it is DERIVED, from the two things the mint already serves: /nutft/state
   * carries the commitment, the pack count and -- the part worth having -- the
   * exact number of each card still unminted, and /nutft/catalog carries each
   * card's tier and print run. Everything on the page is computed from those.
   *
   * Until the mint answers, `ready` is false and every figure is zero. Call
   * sites check the flag and say "not read yet" rather than printing a zero
   * that looks like a fact. Keeping the SHAPE rather than using null means a
   * dozen call sites do not each need a guard against a crash. */
  const EMPTY_BOX = { ready: false, packs: 0, packSize: 0, cards: 0, printed: 0,
    numberedCards: 0, issued: 0, commitment: "", tiers: [] };
  let MINT_BOX = EMPTY_BOX;

  /* Fold the mint's per-card figures into the rows the page shows. `remaining`
   * is per asset id and is the honest answer to "how many are left" -- the shop
   * shows it beside the print run so a buyer can see the box running down
   * instead of being told a total and asked to trust it. */
  function boxFromMint(state, catalog) {
    if (!state || !catalog || !Array.isArray(catalog.assets)) return null;
    const order = ["Genesis", "Vault", "Rare", "Uncommon", "Common", "Basic"];
    const rows = new Map(order.map((name) => [name, { name, cards: 0, copies: 0, left: 0 }]));
    const remaining = state.remaining || {};
    let printed = 0;
    for (const asset of catalog.assets) {
      const row = rows.get(asset.tier);
      if (!row) continue;                       // a tier this page has never heard of
      row.cards += 1;
      const copies = Number(asset.copies || 0);
      row.copies += copies;
      printed += copies;
      /* Absent from `remaining` means the mint has issued every copy, which is
         zero left -- not "unknown". Only a card that was never capped (a Basic)
         has no figure to report at all. */
      if (copies) row.left += Number(remaining[asset.asset_id] ?? remaining[asset.id] ?? 0);
    }
    const basic = rows.get("Basic");
    if (basic) { basic.oneCard = true; basic.copies = Number(state.packs || 0); basic.left = null; }
    const packSize = Number(state.cards_per_pack || 0);
    const paid = Number(state.paid_cards_per_pack || 0);
    const packs = Number(state.packs || 0);
    if (!packs || !packSize) return null;      // an answer we cannot do arithmetic on
    return {
      ready: true,
      packs, packSize, printed,
      cards: packs * packSize,
      /* What a buyer can actually receive, which is not the print run: the
         prime pool is deeper than the number of prime slots, so a tail of
         copies exists and is never drawn. */
      issued: packs * (paid || Math.max(0, packSize - 1)),
      numberedCards: catalog.assets.filter((a) => Number(a.copies || 0) > 0).length,
      commitment: state.census_sha256 || "",
      tiers: order.map((name) => rows.get(name)).filter((row) => row.cards > 0),
    };
  }
  let nutftState = { sold: 0, packs: MINT_BOX.packs, tier_odds: {} };

  /* ------------------------------------------------------------ the G edition
   * Starter sets are a printing of their own, and the reason is arithmetic, not
   * marketing. A starter set has to hold a Genesis card to be worth starting
   * with; taking those copies out of E1 would have made "E1 prints N of each
   * Genesis card" quietly false, and that number is committed in the census the
   * verify button re-hashes. So these are G cards — their own collection id,
   * their own catalog, their own published cap — and E1's census does not move.
   *
   * There is no G mint yet, so nothing this drives may offer to sell one. The
   * shape is published ahead of the till: numbers here, sentences built from
   * them below, and not one figure typed into the copy twice. */
  /* READ FROM THE CENSUS, not typed here. These figures were hand-written and
     said "2 decks of 40 = 80 cards" while cards/g-census.json printed 82 — the
     two extra slots that carry the Genesis card and the promo. On a page whose
     whole argument is that its numbers are the mint's, a number the mint
     disagrees with is the one thing that must not appear.

     site/g-data.js is generated by scripts/build_g_supply.py from the same run
     that writes the census, so the two cannot drift. The fallback below is the
     no-JS-bundle case; it is deliberately the same shape, and if it is ever
     reached the page is at least self-consistent. */
  const G = globalThis.E1_G || null;
  const STARTER = {
    collectionId: (G && G.collectionId) || "600B-G",
    sets: (G && G.sets) || 210,
    decksPerSet: (G && G.decksPerSet) || 2,
    deckSize: (G && G.deckSize) || 40,
    cardsPerSet: (G && G.cardsPerSet) || 82,
    genesisSets: (G && G.genesisSets) || 21,
    genesisPerSet: 1,
    perGenesisCard: (G && G.perGenesisCard) || 3,
    /* The promo's name and face are presentation, not supply: the census names
       only its id, because a mint has no opinion about what a card is called. */
    promo: { id: (G && G.promoId) || "FIPS-P01", name: "Global FIPS Balloon Network", face: "Global FIPS Balloon Network.webp" },
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const rarityOf = (id) => (BY_ID[id] && BY_ID[id].rarity) || "common";
  /* Indexed directly, and it raises. A rarity RANK has never heard of means a
   * re-tiering reached the card data without reaching this file, and scoring it
   * as a common is exactly how the two rarest pulls in the game came to be
   * announced as a quiet pack. Fail where it is loud, not where it is subtle. */
  const rankOf = (id) => {
    const rarity = rarityOf(id);
    if (!(rarity in RANK)) throw new Error(`shop: no rank for rarity "${rarity}"`);
    return RANK[rarity];
  };
  const nameOf = (id) => (BY_ID[id] && BY_ID[id].name) || id;
  const pad = (n, width) => String(n).padStart(width, "0");
  /* 941625 is a number you count with a finger; 941 625 is not. Grouped by hand
   * rather than with toLocaleString, because a shell can be running in any
   * locale and the box's size is not a number that should read differently in
   * one of them. Non-breaking, so a group never wraps onto its own line. */
  const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  /* Read live, not once at load: the preference can change mid-session. */
  const reduced = () =>
    Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ------------------------------------------------------------- storage

  const fresh = () => ({ cursor: 0, pulls: {}, packs: 0, history: [] });

  /* A corrupt or hostile record is a fresh box, not a crash — and a shell may
   * hand back anything at all, so the shape is rebuilt rather than trusted. */
  const normalize = (saved) => {
    if (!saved || typeof saved !== "object") return fresh();
    if (typeof saved.cursor !== "number" || !saved.pulls || typeof saved.pulls !== "object") return fresh();
    return {
      cursor: saved.cursor,
      pulls: saved.pulls,
      packs: typeof saved.packs === "number" ? saved.packs : 0,
      history: (Array.isArray(saved.history) ? saved.history : []).slice(0, HISTORY_MAX),
    };
  };

  /* One writer at a time, across both keys: a click on a pulled card and a
   * click on "send everything" would otherwise read the same copy of the deck
   * store and the second would undo the first. */
  let chain = Promise.resolve();
  function queue(job) {
    const run = chain.then(job, job);
    chain = run.catch(() => {});
    return run;
  }

  /** Writes the shop record inside its budget. Returns "" or a sentence. */
  function persist() {
    return queue(async () => {
      try {
        while (state.history.length > HISTORY_MAX) state.history.pop();
        let text = JSON.stringify(state);
        /* The log is what gets sacrificed, oldest first, and only far enough
         * to fit. The collection and the box cursor are never trimmed. */
        while (text.length > SHOP_BUDGET && state.history.length) {
          state.history.pop();
          text = JSON.stringify(state);
        }
        if (text.length > SHOP_BUDGET) {
          return `Your collection is ${kb(text.length)} against a ${kb(SHOP_BUDGET)} budget — reset the box to clear it.`;
        }
        let ok = false;
        try { ok = await store.set(STORE, text); }
        catch (error) { return String((error && error.message) || error); }
        if (ok === false) return durable ? REFUSED : NO_STORE;
        return "";
      } catch (error) {
        return String((error && error.message) || error);
      }
    });
  }

  /* Can this environment persist at all? A shell WITHOUT the storage domain
   * falls through to localStorage, which in a sandbox is missing or mute, so
   * the only honest test is a tiny write — do one and clean it up. */
  async function probeStorage() {
    try {
      const ok = await store.set(PROBE, "1");
      if (ok !== false) await store.remove(PROBE);
      return ok !== false;
    } catch (error) {
      return false;
    }
  }

  let state = fresh();
  let durable = false;
  let booting = true;
  let busy = false;
  let lastStoreProblem = "";

  // ----------------------------------------------------------- the pull

  /* Everything a pack needs to be checked later: which cards, which slice of
   * the box they came off, and which of them were new. Written once, on the
   * pull, so the log can never drift from the tally. */
  async function record(cards, from, token) {
    const seen = {};
    const isNew = cards.map((id) => {
      const had = (state.pulls[id] || 0) + (seen[id] || 0);
      seen[id] = (seen[id] || 0) + 1;
      return had === 0;
    });
    for (const id of cards) state.pulls[id] = (state.pulls[id] || 0) + 1;
    state.packs = (state.packs || 0) + 1;
    const entry = { n: state.packs, at: Date.now(), from, ids: cards.slice(), fresh: isNew, token: token || null };
    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    /* Awaited, not fired: the pack is not recorded until the bytes have landed
     * or the budget has said no, and the answer is carried to the caller. */
    lastStoreProblem = await persist();
    return entry;
  }

  /* The one pull path. Demo takes the next `n` off the box; mint asks the
   * mint for them against an invoice the buyer pays themselves. Both return
   * the same record, so the reveal below never learns which mode it is in. */
  async function pullPack(n) {
    if (PULL_MODE === "mint") {
      /* Live path, deliberately thin: ask for an invoice, show it, wait for
       * the mint to confirm. The buyer's wallet pays; nothing here handles
       * their credentials. Unreachable unless ONLINE — kept as a belt so a
       * future edit cannot quietly reintroduce a fetch into a sandbox. */
      if (!ONLINE) throw new Error("This shell blocks outbound requests, so no mint can be reached from here.");
      if (!root.NutFTWallet) throw new Error("the NutFT wallet is not available");
      /* A paid mint answers the quote with an invoice. Show it and let the
         buyer settle it in their own wallet — the page never sees a credential,
         and the mint is the only thing that decides when it is paid. */
      const options = {
        onInvoice: showInvoice,
        onWaiting: () => { const note = $("packNote"); if (note && note.dataset) note.dataset.waiting = "1"; },
      };
      const issued = claim
        ? await root.NutFTWallet.claimBooster(MINT_URL, claim, options)
        : await root.NutFTWallet.buyBooster(MINT_URL, options);
      if (claim) {
        claim = null;
        params.delete("claim");
        const search = params.toString();
        if (root.history) root.history.replaceState(null, "", `${root.location.pathname}${search ? `?${search}` : ""}`);
      }
      clearInvoice();
      nutftState.sold += 1;
      return record(issued.cards.map((card) => card.asset_id), null, issued.token);
    }
    const remaining = BOX.box.length - state.cursor;
    if (remaining <= 0) throw new Error("This box is empty. Reset it to open the next one.");
    const from = state.cursor;
    const cards = BOX.box.slice(from, from + Math.min(n, remaining));
    state.cursor += cards.length;
    return record(cards, from);
  }

  // ---------------------------------------------------------- the reveal

  let revealToken = 0;
  let skipping = false;
  let dealt = [];

  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const beat = (ms) => (skipping || reduced() ? Promise.resolve() : sleep(ms));

  /* Cards sit on an arc, never a rank — the same --rot/--lift contract the
   * table uses, so hover and flip compose on top instead of fighting it. */
  /* Chunks the pack into rows and arcs each one on its own. Arcing all 15 as a
     single sweep bends a GRID, which reads as a mistake rather than a hand --
     the curve has to belong to the row you are looking at. */
  function arcRows(nodes, perRow, spread, depth) {
    for (let i = 0; i < nodes.length; i += perRow) {
      arcRow(nodes.slice(i, i + perRow), spread, depth);
    }
  }

  function arcRow(nodes, spread, depth) {
    const n = nodes.length;
    for (let i = 0; i < n; i += 1) {
      const style = nodes[i].style;
      if (!style || !style.setProperty) continue;
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0; // -1 … 1 across the row
      style.setProperty("--rot", `${(t * spread).toFixed(2)}deg`);
      style.setProperty("--lift", `${((1 - t * t) * depth).toFixed(1)}px`);
    }
  }

  /* A right click opens the gallery entry in its own tab and leaves the reveal
   * where it is. A HOLD cannot ask for a tab: it fires on a timer, and Safari
   * does not count a timer as the user gesture a new tab needs, so the popup
   * blocker would eat it and the touch path would do nothing at all — which is
   * the bug being fixed. A phone gets the same page in this tab instead; back
   * returns to the shop, and every pull is in storage, not in the DOM. */
  function openGallery(cardId, sameTab) {
    const url = `cards.html?card=${encodeURIComponent(cardId)}`;
    if (sameTab) {
      root.location.href = url;
      return;
    }
    root.open(url, "_blank", "noopener");
  }

  /* ------------------------------------------------------- the touch hand
   * A FINGER HAS NO SECOND BUTTON. iOS Safari never fires contextmenu, so on a
   * phone the gallery entry of the card you just pulled was unreachable — the
   * page said "right-click" at something that cannot be right-clicked. Press
   * and hold is the touch right click, at the same 420 ms play.js and the Stack
   * Builder use, so every page in the game answers to one gesture.
   *
   * ONE watcher for the whole page rather than a listener per node: the tray
   * and the log are both rebuilt from scratch on every pull.
   * Capture phase, so the hold is given up before any click handler gets a say. */
  let cardHold = null;

  function dropCardHold() {
    if (!cardHold) return;
    clearTimeout(cardHold.timer);
    cardHold = null;
  }

  function installCardHold() {
    if (!root.addEventListener) return;
    root.addEventListener("pointermove", (event) => {
      if (!cardHold) return;
      // Finger jitter is not travel; a scroll off a card is not a hold.
      if (Math.abs(event.clientX - cardHold.x) > 6 || Math.abs(event.clientY - cardHold.y) > 6) {
        dropCardHold();
      }
    }, true);
    root.addEventListener("pointerup", dropCardHold, true);
    root.addEventListener("pointercancel", dropCardHold, true);
    // A finger that leaves the window is not still pressing anything.
    root.addEventListener("blur", dropCardHold);
  }

  /** Press and hold `node` to run `open()`. Returns the swallow for whatever
   *  the release fires next: `take()` eats the click exactly once, and
   *  `pending` lets Android's own long-press contextmenu stand down rather than
   *  open a second tab over the one the hold just opened. `held` is cleared on
   *  every press, so the swallow can only ever eat what belongs to the hold
   *  that set it. */
  function bindHold(node, open) {
    let held = false;
    node.addEventListener("pointerdown", (event) => {
      held = false;
      if (event.pointerType === "mouse") return; // the mouse already has a right button
      dropCardHold();
      const timer = setTimeout(() => {
        cardHold = null;
        held = true;
        open();
      }, 420);
      cardHold = { timer, x: event.clientX, y: event.clientY };
    });
    return {
      get pending() { return held; },
      take() {
        if (!held) return false;
        held = false;
        return true;
      },
    };
  }

  /* LEFT = act, RIGHT = explain. On a face-down card the fast action is
   * "turn it over now"; once it is up, the fast action is "put it in a Stack".
   * Every card that gets hands is dealt face down — the collection grid, which
   * was the one caller that started face up, is on the wallet now. */
  function bindCardHands(node, cardId) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    const act = async () => {
      if (!node.classList.contains("flipped")) {
        node.classList.remove("charging");
        node.classList.add("flipped");
        return;
      }
      /* The write is awaited so the note under the pack bay is the ANSWER, not
       * an optimistic guess made before the bytes landed. */
      stackNote("Saving…");
      await addToStack(cardId);
    };
    const hold = bindHold(node, () => openGallery(cardId, true));
    node.addEventListener("click", () => {
      if (hold.take()) return; // that click belonged to the hold that opened the gallery
      act();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      act();
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (hold.pending) return;
      openGallery(cardId);
    });
  }

  function cardNode(cardId, index, isNew) {
    const card = BY_ID[cardId];
    const rarity = rarityOf(cardId);
    const node = el("div", `pull rarity-${rarity}`);
    node.style.setProperty("--i", String(index));
    const inner = el("div", "pull__inner");
    const back = el("div", "pull__face pull__back");
    const backImg = el("img");
    backImg.alt = "";
    if (FACES) FACES.setFace(backImg, BACK);
    else backImg.src = `../art/cards/node-runner-web/${encodeURIComponent(BACK)}`;
    back.append(backImg);
    const front = el("div", "pull__face pull__front");
    const img = el("img");
    img.alt = (card && card.name) || cardId;
    if (FACES && card) FACES.setFace(img, card.face);
    else if (card) img.src = `../art/cards/node-runner-web/${encodeURIComponent(card.face)}`;
    front.append(img);
    inner.append(back, front);
    node.append(inner, el("span", "pull__burst"));
    if (rarity !== "common") node.append(el("span", "pull__rarity", rarity.toUpperCase()));
    if (isNew) node.append(el("span", "pull__new", "NEW"));
    node.title = `${nameOf(cardId)} — ${rarity}`;
    node.setAttribute(
      "aria-label",
      `${nameOf(cardId)}, ${rarity}. Click or tap to add to a Stack; right-click, or press and hold, for details.`
    );
    bindCardHands(node, cardId);
    return node;
  }

  /* What the pack says about itself. This used to be three fixed sentences, one
     per tier, and the rare one quoted the pull odds at you — so opening ten
     packs meant reading the same line ten times. The odds belong in the box's
     own numbers, not in a remark about your luck.

     Written in the set's own register: short, dry, and about the world rather
     than about probability. The last line used is never picked twice running,
     which is the difference between a voice and a stuck record.

     ONE POOL PER RANK, and the ranks are RANK's own. When the ladder grew a
     Vault and a Genesis rung this table did not, so the two rarest pulls in the
     game fell through to the commons pool and announced themselves as a quiet
     pack — printed in the ember the reveal correctly gave them. The two are now
     reconciled at load, below, so a new rung cannot ship without a voice.

     No counts in any of these lines: the free box and the mint's box print
     different numbers of the same tier, so a sentence that names one of them is
     a lie in the other mode. */
  const PACK_LINES = {
    5: [
      "Genesis. The set starts at this card, and a Stack may hold exactly one of it.",
      "A genesis card. There is no second copy for your Stack; there was never meant to be.",
      "Genesis, off the top of the box. Somebody had to be first, and the chain kept the receipt.",
      "That is genesis. Everything else in the set is downstream of it.",
      "Genesis. Block zero does not come round again.",
    ],
    4: [
      "Vault. Something was sealed a long time ago, and it just came open.",
      "A vault card. The lock was never decorative.",
      "Vault pull. Whatever was being kept in there is on the table now.",
      "That is a vault card — deep in the box, and it surfaced anyway.",
      "Vault. The kind of card the rest of the set was arranged around.",
    ],
    3: [
      "A rare. Somebody in the set is going to remember this one.",
      "That is a rare. The block clock does not do favours — it does arithmetic.",
      "A rare, off the top of the box, exactly where it always was.",
      "Rare. Opens once. Make it count.",
      "A rare. The order was fixed before you got here, and it was fixed like this.",
      "Rare pull. Somewhere a relay just picked up the signal.",
    ],
    2: [
      "An uncommon rode along.",
      "One uncommon. The set's middle class, and it does the work.",
      "An uncommon — the card you did not plan for and end up building around.",
      "Uncommon in the wrapper. Turns out the wall had opinions.",
      "One uncommon. Not the headline; often the reason it worked.",
    ],
    1: [
      "All commons. The floor of the set, and the backbone of a Stack.",
      "Commons, top to bottom. Somebody has to run the grid.",
      "Nothing rare here. The box is not being unkind, it is being a box.",
      "Commons. Unglamorous, load-bearing, and in every Stack that ever won.",
      "A quiet pack. The network runs on quiet packs.",
    ],
  };
  /* A rank the reveal can produce and this table cannot answer is the defect
   * above. Reconciled once, here, where a missing pool is a page that refuses to
   * boot — never at the moment somebody opens the rarest pack of their life. */
  for (const rank of new Set(Object.values(RANK))) {
    if (!PACK_LINES[rank]) throw new Error(`shop: no pack line for rank ${rank}`);
  }

  let lastLine = "";
  function packLine(best, count) {
    /* Indexed, not defaulted: see the check above — this cannot be undefined
     * unless RANK and PACK_LINES have drifted, and then it must say so. */
    const pool = PACK_LINES[best];
    if (!pool) throw new Error(`shop: no pack line for rank ${best}`);
    const fresh = pool.filter((line) => line !== lastLine);
    const pick = fresh[Math.floor(Math.random() * fresh.length)] || pool[0];
    lastLine = pick;
    return best === 1 && count ? pick.replace("All commons", `${count} commons`) : pick;
  }

  function packSummary(entry) {
    const best = entry.ids.reduce((top, id) => Math.max(top, rankOf(id)), 1);
    const news = entry.fresh.filter(Boolean).length;
    let line = packLine(best, entry.ids.length);
    if (news) line += ` ${news} new to your collection.`;
    return { line, best };
  }

  function slotLabel(entry) {
    if (typeof entry.from !== "number") return "MINTED";
    return `BOX ${pad(entry.from + 1, 4)}–${pad(entry.from + entry.ids.length, 4)}`;
  }

  /* The reveal escalates: commons turn straight over, an uncommon holds a
   * moment, a rare charges first and then gets the room to land. The arc keeps
   * box order; only the order of TURNING is dramatic, and the log below always
   * shows the true positions. */
  /* Take the screen for the length of the opening, then give it back. Dismissal
     is deliberately generous — click anywhere, or press Escape — because a
     modal you cannot leave is worse than no modal, and this one has nothing to
     confirm. */
  function enterStage(bay) {
    if (bay.classList.contains("bay--stage")) return;
    bay.classList.add("bay--stage");
    document.documentElement.style.overflow = "hidden";
    const hint = el("div", "bay--stage-note", "Esc or ✕ to close");
    hint.id = "stageHint";
    document.body.append(hint);

    /* The close, spelled out. This used to be `bay.addEventListener("click")`,
       which closed the stage on ANY click inside it -- including the click on
       a card that turns it over, because the flip handler is on the card and
       the card is in the bay. Turning over the first card of a pack you had
       just paid for therefore threw the pack away. Now: the button, Escape, or
       a click that landed on the BACKDROP and not on anything in it. */
    const x = el("button", "stage-x", "✕");
    x.id = "stageClose";
    x.type = "button";
    x.setAttribute("aria-label", "Close the pack");
    x.addEventListener("click", () => leaveStage(bay));
    document.body.append(x);

    const leave = (event) => {
      if (event.type === "keydown") {
        if (event.key !== "Escape") return;
      } else if (event.target !== bay) {
        return;                       // it hit a card, not the backdrop
      }
      leaveStage(bay);
    };
    bay.__leave = leave;
    document.addEventListener("keydown", leave);
    bay.addEventListener("click", leave);
    x.focus();
  }

  function leaveStage(bay) {
    if (!bay.classList.contains("bay--stage")) return;
    bay.classList.remove("bay--stage");
    document.documentElement.style.overflow = "";
    const hint = document.getElementById("stageHint");
    if (hint) hint.remove();
    const x = document.getElementById("stageClose");
    if (x) x.remove();
    if (bay.__leave) {
      document.removeEventListener("keydown", bay.__leave);
      bay.removeEventListener("click", bay.__leave);
      bay.__leave = null;
    }
  }

  /* The die covers the beat where the cards are dealt face down, which without
     it reads as the page stuttering. It resolves into them rather than being
     dismissed: same place, same moment. */
  function rollDie(bay, faces) {
    const die = el("div", "pack-die", String(faces));
    die.setAttribute("aria-hidden", "true");
    bay.append(die);
    const remove = () => die.remove();
    die.addEventListener("animationend", remove, { once: true });
    /* A stuck animation must not leave a die on the screen forever. */
    const timer = setTimeout(remove, 1400);
    if (timer && typeof timer.unref === "function") timer.unref();
    return die;
  }

  async function revealPack(entry) {
    const tray = $("packTray");
    const bay = $("packBay");
    const skip = $("revealAll");
    const note = $("packNote");
    const token = (revealToken += 1);
    enterStage(bay);
    rollDie(bay, entry.ids.length);
    await beat(560);
    if (token !== revealToken) return;
    skipping = false;

    tray.innerHTML = "";
    tray.hidden = false;
    /* --n keeps the off-stage flex row honest; --cols/--rows drive the grid the
       stage switches to. Five to a row unless the pack is smaller than that. */
    const perRow = Math.min(5, Math.max(1, entry.ids.length));
    tray.style.setProperty("--n", String(Math.max(1, entry.ids.length)));
    tray.style.setProperty("--cols", String(perRow));
    tray.style.setProperty("--rows", String(Math.ceil(entry.ids.length / perRow)));
    dealt = entry.ids.map((id, i) => {
      const node = cardNode(id, i, entry.fresh[i]);
      tray.append(node);
      return node;
    });
    arcRows(dealt, perRow, 8, -18);

    const summary = packSummary(entry);
    $("packSlot").textContent = `PACK #${pad(entry.n, 3)} · ${slotLabel(entry)}`;

    if (reduced()) {
      /* No stagger, no charge, no skip control to offer: the whole pack is
       * already there and the note is the final one, not a placeholder. */
      for (const node of dealt) node.classList.add("flipped");
      skip.hidden = true;
      note.className = `pack-note${summary.best >= 3 ? " is-rare" : ""}`;
      note.textContent = summary.line;
      return;
    }

    note.className = "pack-note";
    note.textContent = "Turning them over…";
    skip.hidden = dealt.length < 2;

    // Commons first, the best card last: the pack builds instead of peaking.
    const order = entry.ids
      .map((id, i) => i)
      .sort((a, b) => rankOf(entry.ids[a]) - rankOf(entry.ids[b]) || a - b);

    for (const i of order) {
      if (token !== revealToken) return;
      const node = dealt[i];
      if (node.classList.contains("flipped")) continue; // the player beat us to it
      const rank = rankOf(entry.ids[i]);
      if (rank > 1 && !skipping) {
        node.classList.add("charging");
        if (rank >= 3) bay.classList.add("bay--charged");
        await beat(rank >= 3 ? 760 : 300);
        if (token !== revealToken) return;
        node.classList.remove("charging");
      }
      node.classList.add("flipped");
      await beat(rank >= 3 ? 880 : rank === 2 ? 480 : 280);
    }
    if (token !== revealToken) return;
    bay.classList.remove("bay--charged");
    skip.hidden = true;
    note.className = `pack-note${summary.best >= 3 ? " is-rare" : ""}`;
    note.textContent = summary.line;
  }

  function clearTray() {
    revealToken += 1;
    skipping = false;
    dealt = [];
    const tray = $("packTray");
    tray.innerHTML = "";
    tray.hidden = true;
    $("packBay").classList.remove("bay--charged");
    leaveStage($("packBay"));
    $("revealAll").hidden = true;
    $("packSlot").textContent = "";
    $("packNote").className = "pack-note";
    $("packNote").textContent = "";
  }

  // ------------------------------------------------- into the Stack Builder

  /* The Stack Builder owns this key and must not lose a Stack to a pull, so
   * every handoff is a read-modify-write inside the shared budget rather than
   * a blind overwrite of a copy that may be minutes old. */
  const readDecks = (raw) => {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [name, ids] of Object.entries(raw)) {
      if (Array.isArray(ids)) out[String(name)] = ids.filter((id) => typeof id === "string");
    }
    return out;
  };

  /** `make(current)` returns the draft's new card list. Resolves to
   *  { n, problem } — n is the draft length, problem is "" or a sentence. */
  function writeDraft(make) {
    return queue(async () => {
      try {
        const all = readDecks(await store.json(DECK_STORE, {}));
        const list = make(Array.isArray(all[DRAFT_NAME]) ? all[DRAFT_NAME] : []);
        if (list.length > MAX_DRAFT) {
          return { n: -1, problem: `That would be ${list.length} cards; ${MAX_DRAFT} is the most one Stack can hold. Trim "${DRAFT_NAME}" in the Stack Builder.` };
        }
        if (!(DRAFT_NAME in all) && Object.keys(all).length >= MAX_STACKS) {
          return { n: -1, problem: `The Stack Builder already holds ${MAX_STACKS} Stacks — delete one there before sending cards over.` };
        }
        const text = JSON.stringify(Object.assign({}, all, { [DRAFT_NAME]: list }));
        if (text.length > DECK_BUDGET) {
          return { n: -1, problem: `Your saved Stacks are full — ${kb(text.length)} against a ${kb(DECK_BUDGET)} budget. Delete a Stack in the Stack Builder to make room.` };
        }
        let ok = false;
        try { ok = await store.set(DECK_STORE, text); }
        catch (error) { return { n: -1, problem: String((error && error.message) || error) }; }
        if (ok === false) {
          return { n: -1, problem: durable ? "This browser refused to save the Stack (private mode?)." : NO_STORE };
        }
        return { n: list.length, problem: "" };
      } catch (error) {
        return { n: -1, problem: String((error && error.message) || error) };
      }
    });
  }

  function stackNote(text) {
    const node = $("stackNote");
    if (node) node.textContent = text;
  }

  function storeNote(text) {
    const node = $("storeNote");
    if (node) node.textContent = text || "";
  }

  async function addToStack(cardId) {
    const res = await writeDraft((list) => list.concat(cardId));
    stackNote(
      res.problem ||
        `${nameOf(cardId)} added — "${DRAFT_NAME}" holds ${res.n} cards. Load it in the Stack Builder.`
    );
  }

  /* The per-pack rows are no longer DRAWN, but state.history is still written on
     every pull: pack number, time, and the slice of the box it came off. That
     record is what makes the fingerprint on this page checkable, so it is kept
     rather than dropped — the wallet can render it whenever it wants to, and
     nothing has to be reconstructed to make that possible.
     The block itself still shows, because it now carries the route to the
     wallet and a buyer who has just opened a pack needs to be told where the
     cards went. */
  function renderHistory() {
    const block = $("historyBlock");
    if (block) block.hidden = !state.history.length;
  }

  // ------------------------------------------------------------- the proof

  const hexOf = (digest) =>
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  /* The exact recipe the generator committed: SHA-256 over every card id in
   * box order, each followed by a zero byte. Recomputed here, in the reader's
   * own browser, so "trust us" never has to appear on the page. */
  async function recomputeCommitment() {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle || typeof TextEncoder === "undefined") return null;
    const encoder = new TextEncoder();
    const parts = BOX.box.map((id) => encoder.encode(id));
    const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length + 1, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
      bytes[offset] = 0;
      offset += 1;
    }
    const digest = await subtle.digest("SHA-256", bytes);
    return hexOf(digest);
  }

  /* The mint's box is a census, not an order, so its fingerprint has its own
   * recipe — and it is replicated here BYTE FOR BYTE from the mint's own
   * (server/nutft-draw.js, censusHash): the entries of { id: copies } are
   * sorted, written as JSON with no whitespace, and closed with a single zero
   * byte. That zero byte is the same terminator the free box's order uses, which
   * is why one plain sentence can describe both.
   *
   * The entries are sorted, not the keys — the mint sorts entries and the ids
   * are fixed width, so the two orders are the same order; copying the mint's
   * call exactly is cheaper than reasoning about when they diverge.
   *
   * Basics never enter: they have no `copies`, which is precisely what makes
   * them uncapped, and a card with nothing to commit to has nothing in the
   * commitment. */
  async function recomputeCensus(assets) {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle || typeof TextEncoder === "undefined") return null;
    const counts = {};
    for (const asset of assets) {
      const id = asset && (asset.asset_id || asset.id);
      if (id && asset.copies) counts[id] = asset.copies;
    }
    const canonical = JSON.stringify(Object.fromEntries(Object.entries(counts).sort()));
    const body = new TextEncoder().encode(canonical);
    const bytes = new Uint8Array(body.length + 1);
    bytes.set(body, 0);
    const digest = await subtle.digest("SHA-256", bytes);
    return {
      hex: hexOf(digest),
      cards: Object.keys(counts).length,
      copies: Object.values(counts).reduce((sum, n) => sum + n, 0),
    };
  }

  /* What the mint says about itself right now. `remaining` is the whole point:
   * it is the per-card supply, and it only ever goes down, so a reader can come
   * back tomorrow and check that it did. */
  function renderMintState() {
    if (PULL_MODE !== "mint") return;
    const sold = Number(nutftState.sold) || 0;
    const packs = Number(nutftState.packs) || MINT_BOX.packs;
    const remaining = nutftState.remaining && typeof nutftState.remaining === "object"
      ? Object.values(nutftState.remaining)
      : [];
    $("mintSold").textContent = num(sold);
    $("mintLeft").textContent = num(Math.max(0, packs - sold));
    $("mintNext").textContent = nutftState.next_pack || "—";
    $("mintRoll").textContent = nutftState.state || "—";
    $("mintRemaining").textContent = remaining.length
      ? `${num(remaining.reduce((sum, n) => sum + (Number(n) || 0), 0))} across ${remaining.length} cards`
      : "—";
  }

  /** Reads /nutft/state into `nutftState`. Returns "" or a sentence. */
  async function readMintState() {
    if (!MINT_URL) return "There is no mint connected to this page.";
    try {
      const response = await fetch(`${MINT_URL}/nutft/state`);
      if (!response.ok) return `The mint answered ${response.status}; the numbers above are the last ones it gave.`;
      nutftState = await response.json();
      /* The catalog carries each card's tier and print run; the state carries
         what is left of each. Neither alone can answer "how many Rares are
         still in there", so the box facts are rebuilt from both — and only
         when both arrived, so a half-read never renders as a fact. */
      try {
        const catalogResponse = await fetch(`${MINT_URL}/nutft/catalog`);
        if (catalogResponse.ok) {
          const derived = boxFromMint(nutftState, await catalogResponse.json());
          if (derived) MINT_BOX = derived;
        }
      } catch { /* the state alone still renders; the tier rows just wait */ }
      renderMintState();
      renderBoxFacts();
      renderTiers();
      renderStarter();
      syncControls();
      return "";
    } catch (error) {
      return String((error && error.message) || error);
    }
  }

  /* ------------------------------------------------------------ early access
   * Who the buyer is, and whether this box will sell to them — settled before
   * the click rather than discovered by it.
   *
   * The mint opens to a short list of nostr keys first. Until this existed the
   * page drew a live Buy button for everybody and the refusal arrived from the
   * server after the purchase was attempted, which is the one thing a shop
   * built on "check it yourself" should never do.
   *
   * NONE of it is load-bearing for the free box. The row only appears where
   * there is a mint to ask, every failure is a sentence rather than a thrown
   * page, and no signature is ever requested until the buyer presses something.
   */

  /* bech32, BIP-173. Written out rather than imported: site/net.js has this
   * encoder, but net.js is the whole table transport, and a shop page has no
   * business loading match plumbing for forty lines of arithmetic. index.html
   * keeps its own copy for the same reason. */
  const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function bech32Polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  }
  function npubOf(hexKey) {
    if (!/^[0-9a-f]{64}$/.test(hexKey || "")) return "";
    const words = [];
    let acc = 0, bits = 0;
    for (const byte of hexKey.match(/../g).map((h) => parseInt(h, 16))) {
      acc = (acc << 8) | byte; bits += 8;
      while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); }
    }
    if (bits) words.push((acc << (5 - bits)) & 31);
    const hrp = [];
    for (const c of "npub") hrp.push(c.charCodeAt(0) >> 5);
    hrp.push(0);
    for (const c of "npub") hrp.push(c.charCodeAt(0) & 31);
    const mod = bech32Polymod(hrp.concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
    let checksum = "";
    for (let i = 0; i < 6; i += 1) checksum += B32[(mod >> (5 * (5 - i))) & 31];
    return "npub1" + words.map((w) => B32[w]).join("") + checksum;
  }
  const shortNpub = (hexKey) => {
    const npub = npubOf(hexKey);
    return npub ? `${npub.slice(0, 12)}…${npub.slice(-5)}` : "";
  };

  /* napplet.js owns the identity seam: the shell's key inside a shell, a NIP-07
   * extension on the website, and the same 600b:pubkey the rest of the site
   * signs in with — so signing in here signs you in for a match too. If
   * napplet.js never loaded there is no seam, the row says so, and the free box
   * carries on. */
  const ID = (NAP && NAP.identity) || null;
  const NO_SIGNER =
    "No nostr signer in this browser. Early access is proved with a nostr key, so you need a NIP-07 "
    + "extension — Alby or nos2x are the usual two — and then a key that is on the list. "
    + "The free pack below needs none of this.";
  const SIGN_IN_FIRST =
    "The mint opens to a few nostr keys before it opens to everyone. Sign in to find out whether yours "
    + "is one of them: it costs nothing, buys nothing, and reserves nothing.";
  const ASK_THE_MINT =
    "Signed in. Ask the mint whether this key has early access — it will not sell you anything to answer.";

  let signedIn = null;   // hex pubkey the page is currently showing, or null
  let access = null;     // the mint's last eligibility answer, or null

  /* Random, not a counter: a counter restarts at one on every page load, so two
     loads inside the same second would collide exactly where a counter was
     supposed to stop them. */
  function nonce() {
    const rng = root.crypto && root.crypto.getRandomValues
      ? Array.from(root.crypto.getRandomValues(new Uint8Array(8)))
      : Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
    return rng.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* NIP-98, the same event site/nutft-wallet.js builds for a gated quote. That
   * one is module-private, so this is a second copy rather than a call, and it
   * must keep the same shape: server/nip98.js verifies both against one rule —
   * kind 27235, an absolute `u`, a `method`, and a clock inside the window.
   *
   * Returns the pubkey alongside the header, because the SIGNER decides who
   * signed. The stored key is only what the last login wrote down, and a buyer
   * who switched accounts in their extension since would otherwise be shown one
   * npub beside an answer about a different one. */
  async function signedProof(url, method) {
    if (!ID) return null;
    const signed = await ID.sign({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      /* THE NONCE IS NOT DECORATION. created_at has one-second resolution, so
         two checks inside the same second produce byte-identical events, which
         hash to one id — and the mint's replay store correctly refuses the
         second as "already been used". Pressing a button twice is not an
         attack, and it must not read as one. Found by pressing it twice. */
      tags: [["u", url], ["method", method], ["nonce", nonce()]],
    });
    if (!signed || !signed.sig) return null;
    /* btoa is byte-wise, so one non-ASCII byte anywhere in the event would
       throw. Encode as UTF-8 first and the header survives whatever the signer
       decided to add. */
    const bytes = new TextEncoder().encode(JSON.stringify(signed));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { header: `Nostr ${root.btoa(binary)}`, pubkey: String(signed.pubkey || "").toLowerCase() };
  }

  /* Which refusals are about the KEY, and which are about the request.
   *
   * "not on the list" and "already has its set" are verdicts: this key cannot
   * buy, and the Buy button should say so rather than wait to fail. Everything
   * else the gate can say — an expired clock, a proof minted for another
   * deployment, an authorization already used — is the REQUEST being wrong, not
   * the buyer, and closing the button over one of those would take a working
   * sale away from somebody whose only mistake was pressing Check twice.
   *
   * An unrecognised refusal is treated as the second kind on purpose: guessing
   * wrong that way costs a click, guessing wrong the other way costs a sale. */
  function verdictOn(answer) {
    if (!answer || answer.may_buy || answer.sales === "closed") return "";
    if (/not on the list/i.test(answer.reason)) return "unlisted";
    if (/already has its set/i.test(answer.reason)) return "spent";
    return "";
  }

  /* The mint's answer, in words a buyer can act on. Its own sentence is the
   * fallback rather than the first resort: it is accurate but written for the
   * person who deployed the mint, and "this key is not on the list yet" does
   * not tell anybody what to do about it. */
  function accessWords(answer) {
    if (answer.may_buy) {
      return answer.sales === "open"
        ? "The box is open to everyone — no key is needed to buy."
        : "This key has early access. The button below will work.";
    }
    if (answer.sales === "closed") {
      return "The till is shut: nothing is on sale yet, for anyone. Your key is signed in and there is "
        + "nothing else to do until the box opens.";
    }
    if (verdictOn(answer) === "unlisted") {
      return "This key is not on the early-access list. Copy your npub and send it to whoever is running "
        + "the sale — nothing else here can put it on.";
    }
    if (verdictOn(answer) === "spent") {
      return "This key has already taken its one starter set. It is in your wallet, not still on the shelf.";
    }
    /* Not a verdict, so it says so: the buyer is not being turned away, the
       request simply did not arrive in a state the mint could answer. */
    return `The mint could not read the request: ${answer.reason}. Nothing is refused — try again.`;
  }

  /** Asks /nutft/eligibility about the signed-in key. Returns a sentence. */
  async function askAboutMyKey() {
    if (!MINT_URL) return "There is no mint connected to this page.";
    const target = new URL(`${MINT_URL}/nutft/eligibility`, root.location.href).href;
    let proof = null;
    if (signedIn || (ID && ID.source() !== "none")) {
      try { proof = await signedProof(target, "GET"); }
      catch (error) {
        return "Your nostr signer did not sign the request. That signature is the only thing that proves "
          + "the key is yours, so the mint cannot answer without it.";
      }
    }
    /* The signer, not the cache, decides whose answer this is. */
    if (proof && /^[0-9a-f]{64}$/.test(proof.pubkey)) signedIn = proof.pubkey;
    let answer;
    try {
      const response = await fetch(target, proof ? { headers: { Authorization: proof.header } } : undefined);
      /* A "no" arrives as a 200 with may_buy false — anything else is the
         request failing, not the mint declining, and must not be read as one. */
      if (!response.ok) return `The mint answered ${response.status}; it did not say whether this key may buy.`;
      answer = await response.json();
    } catch (error) {
      return `The mint could not be reached: ${String((error && error.message) || error)}`;
    }
    /* Only an answer we actually SIGNED for is allowed to close the Buy button.
       An anonymous check is refused by definition in early access, while the
       wallet would still reach for the signer at the click and go through — so
       acting on an unproven no would break a path that works. */
    access = { ...answer, signed: Boolean(proof) };
    renderIdentity();
    syncControls();
    return accessWords(answer);
  }

  const identityNote = (text) => { const node = $("mintIdentityNote"); if (node) node.textContent = text; };

  function renderIdentity() {
    const row = $("mintIdentity");
    if (!row) return;
    /* Mint mode only, which also covers the stranded and walled-off cases: with
       no mint to ask, an early-access control could only ever mislead. */
    row.hidden = PULL_MODE !== "mint";
    if (row.hidden) return;
    const on = Boolean(signedIn);
    $("nostrLogin").hidden = on;
    $("nostrWho").hidden = !on;
    $("nostrCheck").hidden = !on;
    $("copyNpub").hidden = !on;
    $("nostrLogout").hidden = !on;
    if (on) $("nostrWho").textContent = shortNpub(signedIn) || "signed in";
  }

  /* The invoice, shown while the mint waits to be paid. Deliberately plain: the
     bolt11 as selectable text, a copy button, and a lightning: link a phone can
     open. No QR library is pulled in for this — the string is long enough that a
     scannable code needs real care, and a wrong QR is worse than none. */
  function showInvoice(invoice) {
    const note = $("packNote");
    if (!note) return;
    note.className = "pack-note";
    note.innerHTML = "";
    const sats = Math.round(Number(invoice.priceMsat || 0) / 1000);
    const head = document.createElement("strong");
    head.textContent = invoice.testMint
      ? `Test invoice — ${sats} sat, not real money.`
      : `Pay ${sats} sat to open this booster.`;
    /* Built here, appended below with everything else: .after() on a node that
       is not in the document yet does nothing, so the warning would silently
       never appear — the one message that must not go missing. */
    let warn = null;
    if (invoice.testMint) {
      /* This mint's invoices carry the mainnet lnbc prefix, so a real wallet
         will happily try to pay one. Say so above the string, not below it. */
      warn = document.createElement("div");
      warn.style.cssText = "margin-top:4px;color:var(--gold);font-size:12px";
      warn.textContent = "It pays itself in a few seconds — do not scan it with a real wallet.";
    }
    const body = document.createElement("div");
    body.style.cssText = "margin-top:6px;word-break:break-all;font:11px/1.5 ui-monospace,Consolas,monospace;color:var(--muted)";
    body.textContent = invoice.paymentRequest;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px";
    const copy = document.createElement("button");
    copy.className = "btn btn--small";
    copy.type = "button";
    copy.textContent = "Copy invoice";
    copy.addEventListener("click", async () => {
      copy.textContent = (await copyText(invoice.paymentRequest)) ? "Copied" : "Select it above";
      if (!copy.textContent.startsWith("Copied")) selectNode(body);
    });
    const open = document.createElement("a");
    open.className = "btn btn--small btn--ghost";
    open.href = `lightning:${invoice.paymentRequest}`;
    open.textContent = "Open in wallet";
    row.append(copy, open);
    const wait = document.createElement("div");
    wait.style.cssText = "margin-top:8px;color:var(--muted);font-size:12px";
    wait.textContent = "Waiting for payment… the cards appear as soon as the mint confirms it.";
    note.append(head);
    if (warn) note.append(warn);
    note.append(body, row, wait);
  }

  function clearInvoice() {
    const note = $("packNote");
    if (note) { note.innerHTML = ""; note.textContent = ""; }
  }

  async function copyText(text) {
    try {
      if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* denied or insecure context — fall back to a selection the user can copy */
    }
    return false;
  }

  function selectNode(node) {
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = root.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (error) {
      return false;
    }
  }

  // --------------------------------------------------------------- boot

  function renderBoxFacts() {
    const mint = PULL_MODE === "mint";
    /* The census fingerprint is a commitment, so the page shows the one it was
     * PUBLISHED against until the mint has answered — never the word "loading"
     * where a fingerprint belongs.
     *
     * Once the mint HAS answered, the number on screen is the mint's, because
     * that is the box a buyer is about to open. What must not happen is the swap
     * going unannounced: the same forty digits under the same word "published"
     * would be a different census wearing this page's label. So the label names
     * whose fingerprint it is, and drift is stated there as well as by the
     * verify button, which explains it in a full sentence. */
    const served = mint ? String(nutftState.census_sha256 || "") : "";
    const drifted = Boolean(served) && served !== MINT_BOX.commitment;
    $("boxCommit").textContent = mint ? served || MINT_BOX.commitment : BOX.commitment || "—";
    $("commitLabel").textContent = mint
      ? drifted
        ? "Fingerprint this mint serves — NOT the one this page was published against · SHA-256"
        : "Published census fingerprint · SHA-256"
      : "Published box fingerprint · SHA-256";
    $("boxSize").textContent = num(BOX.box.length);
    $("mintBoxLine").textContent =
      `The mint's box is ${num(MINT_BOX.cards)} cards — ${num(MINT_BOX.packs)} packs of ${MINT_BOX.packSize}.`;
    $("packSize").textContent = mint ? MINT_BOX.packSize : BOX.packSize;
    $("packPrice").textContent = mint ? "NutFT demo" : "free";
  }

  /* ---------------------------------------------------------- what is inside
   * The free box's tiers are COUNTED, not quoted: the whole order ships inside
   * this page, so the honest number is the one taken out of it here, and it
   * cannot drift from the fingerprint the button re-hashes. */
  function demoTiers() {
    const copies = {};
    const distinct = {};
    for (const id of BOX.box) {
      const rarity = rarityOf(id);
      copies[rarity] = (copies[rarity] || 0) + 1;
      (distinct[rarity] || (distinct[rarity] = new Set())).add(id);
    }
    /* Ordered by the ladder, not by RANK: RANK exists to drive the reveal and
     * deliberately gives Basic and Common the same weight there, which would
     * leave two rows tied and their order decided by whichever happened to come
     * off the box first. A published table must read the same every time. */
    return Object.keys(copies)
      .sort((a, b) => rungOf(a) - rungOf(b))
      .map((rarity) => ({
        name: rarity.charAt(0).toUpperCase() + rarity.slice(1),
        cards: distinct[rarity].size,
        copies: copies[rarity],
      }));
  }

  /* The frame only owns two accents, so the seven rungs borrow them rather than
   * inventing a colour per tier: everything drawn from the prime slot wears the
   * ember, Uncommon wears the purple, and the floor of the set wears neither.
   * Same rule for a tile in this table and for a card on the tray. */
  const bandOf = (rarity) => {
    const rung = rungOf(rarity);
    if (rung <= rungOf("rare")) return " rarity-rare";
    if (rung === rungOf("uncommon")) return " rarity-uncommon";
    return "";
  };

  function tierTile(tier, total) {
    const node = el("div", `odd${bandOf(tier.name.toLowerCase())}`);
    node.append(el("b", null, `${total ? ((tier.copies / total) * 100).toFixed(2) : "0.00"}%`));
    node.append(el("span", null, tier.name.toUpperCase()));
    /* One row does not fit the pattern, and stating it wrong is worse than
     * leaving the figure out: the mint's basic slot is filled from the same card
     * every pack, so "copies · cards" would divide a slot count across ten cards
     * that never receive it. The free box's own Basic row is genuinely spread
     * across all ten, is counted out of the shipped order, and keeps the plain
     * wording — the flag is set on the mint's row only. */
    node.append(el("i", null, tier.oneCard
      ? `${num(tier.copies)} slots · one card, the same one in every pack`
      : `${num(tier.copies)} copies · ${tier.cards} cards`));
    /* HOW MANY ARE STILL IN THERE. The print run is a promise; this is the
       state of the box right now, straight out of the mint's own remaining
       count. It is the figure a buyer actually wants and the one nothing on
       this page could show while the numbers were written down by hand.
       Null means the row has no print run to run down — the Basic slot. */
    if (typeof tier.left === "number") {
      const share = tier.copies ? Math.round((tier.left / tier.copies) * 100) : 0;
      const left = el("u", "odd__left", `${num(tier.left)} still unminted · ${share}% of the run`);
      left.title = `${num(tier.copies - tier.left)} of ${num(tier.copies)} already issued`;
      node.append(left);
    }
    return node;
  }

  function renderTiers() {
    const wrap = $("boxTiers");
    if (!wrap) return;
    const mint = PULL_MODE === "mint";
    const total = mint ? MINT_BOX.cards : BOX.box.length;
    wrap.innerHTML = "";
    for (const tier of mint ? MINT_BOX.tiers : demoTiers()) wrap.append(tierTile(tier, total));

    const claim =
      "Rarity here is copies in the box, exactly like a printed booster box — not a hidden dice roll.";
    if (mint) {
      /* Added up rather than written down: this figure only means anything as
       * the sum of the rows above it, and a literal would be free to disagree
       * with them one edit later. */
      if (!MINT_BOX.ready) {
        /* Not read yet is a different sentence from a number. Printing zeros
           here would look exactly like a fact, and this page's whole argument
           is that its figures come from somewhere checkable. */
        $("tiersLead").textContent = `${claim} The shares below come from the mint itself — waiting for it to answer.`;
        $("tiersNote").textContent = "";
        return;
      }
      const rowSum = MINT_BOX.tiers.reduce((n, tier) => n + tier.copies, 0);
      $("tiersLead").textContent =
        `${claim} Every share below is a share of the whole box the mint advertises — ` +
        `${num(MINT_BOX.cards)} cards, ${num(MINT_BOX.packs)} packs of ${MINT_BOX.packSize} — Basics counted in.`;
      $("tiersNote").innerHTML =
        `<strong>The arithmetic, in full.</strong> Of those ${num(MINT_BOX.cards)} cards, ${num(MINT_BOX.issued)} are ` +
        `numbered copies — ${MINT_BOX.issued / MINT_BOX.packs} in every pack, drawn from a print run of ` +
        `${num(MINT_BOX.printed)} across ` +
        `${MINT_BOX.numberedCards} cards — and ${num(MINT_BOX.packs)} are Basics, one free in every pack. Basics are the ` +
        `one exception to "copies in the box": they carry no print run at all, so their row is a slot count, and the ` +
        `mint fills that slot from the same Basic every time — the other ${BASIC_TIER.cards - 1} of the ` +
        `${BASIC_TIER.cards} are in the catalog and in the game, but never in a pack. ` +
        `The six rows add to ${num(rowSum)} copies, which is ${rowSum - MINT_BOX.cards} more than the box holds: the prime ` +
        `pool is printed ${MINT_BOX.unreachable} copies deeper than ${num(MINT_BOX.packs)} packs can ever reach, so ` +
        `Genesis, Vault and Rare are ceilings while the prime slot itself is exactly one card per pack. ` +
        `The free alpha box in this shop's demo mode is a different, smaller box: ${num(BOX.box.length)} cards, ` +
        `${BOX.packSize} per pack.`;
      return;
    }
    $("tiersLead").textContent =
      `${claim} These are the ${num(BOX.box.length)} cards of the free alpha box, counted straight out of the ` +
      `order this page ships, so the figures add up to the box and to 100%.`;
    /* This row used to claim the homepage counts this same box. It is not this
     * page's number to promise: the homepage has its own copy of the figure and
     * this page cannot see whether the two agree. Say what THIS box is — the one
     * every pack on this page is dealt from, counted out of the order shipped
     * here — and let the homepage speak for its own total. */
    $("tiersNote").innerHTML =
      `<strong>One box, not the only box.</strong> This is the free alpha box — ${num(BOX.box.length)} cards, ` +
      `${BOX.packSize} per pack — and every pack on this page comes off it. The NutFT mint sells a separate and much ` +
      `larger one: ${num(MINT_BOX.packs)} packs of ${MINT_BOX.packSize}, ${num(MINT_BOX.cards)} cards, committed as a ` +
      `census of print runs rather than as a shuffled order. Its numbers are published ` +
      `<a href="shop.html?shop=mint">in mint mode</a>.`;
  }

  /* --------------------------------------------------------- starter sets */

  /* Found by NAME, and it raises. MINT_BOX.tiers is ordered for the table above,
   * so a row that moves must not silently become a different tier down here —
   * the same reasoning as rankOf, and the same answer: fail where it is loud. */
  const tierNamed = (name) => {
    const tier = MINT_BOX.tiers.find((row) => row.name === name);
    if (!tier) throw new Error(`shop: no "${name}" tier in the mint census`);
    return tier;
  };

  /* Not the same question as "is the tier missing".
   *
   * The box is derived from the mint now, so before it answers there are no
   * tiers at all -- and a throw there took the whole of init() down with it,
   * which is how the tier table came to render empty while the mint was
   * perfectly healthy. A tier that is ABSENT once the box has been read is
   * still a fault worth raising loudly; a box that has not arrived yet is just
   * a page that is not ready. */
  const boxRead = () => MINT_BOX.ready;

  /* Every figure the starter section prints, in one place: STARTER's own numbers
   * and the census's Genesis row, multiplied out. The homepage has already shown
   * once what a total typed twice does to a page about scarcity. */
  function starterFacts() {
    if (!boxRead()) return null;
    const genesis = tierNamed("Genesis");
    const perTitle = genesis.copies / genesis.cards;
    /* "E1 keeps N copies of each Genesis card" is only a sentence while the run
     * divides evenly across the titles. If it stops dividing, say so here rather
     * than print 21.000000001 under a claim about supply. */
    if (!Number.isInteger(perTitle)) {
      throw new Error("shop: the E1 Genesis print run does not divide evenly across its cards");
    }
    const decks = STARTER.sets * STARTER.decksPerSet;
    return {
      decks,
      cards: decks * STARTER.deckSize,
      setCards: STARTER.decksPerSet * STARTER.deckSize,
      plainSets: STARTER.sets - STARTER.genesisSets,
      genesisCopies: STARTER.genesisSets * STARTER.genesisPerSet,
      titles: genesis.cards,
      e1Copies: genesis.copies,
      perTitle,
      /* The floor the spread rule puts under variety, and it is arithmetic
       * rather than a promise: capping any one card at `perGenesisCard` copies
       * means the run cannot be squeezed onto fewer titles than this. Saying
       * "all nine appear" would be the over-claim — the cap forbids piling up,
       * it does not oblige every card to show. */
      minTitles: Math.ceil((STARTER.genesisSets * STARTER.genesisPerSet) / STARTER.perGenesisCard),
    };
  }

  function renderStarter() {
    const f = starterFacts();
    const promo = STARTER.promo;

    /* SPLIT, because the old version blanked the whole section whenever the
       mint had not answered -- and most of these figures never needed it. Sets,
       decks, the cards in the run, the strong count and the collection id come
       out of STARTER, which is a constant in this file; only the sentences that
       COMPARE the G run against E1's Genesis print run need the census. The
       free box view has no mint at all, so on that page the entire block was a
       column of em dashes, and it now sits directly under the booster where
       nobody can miss it. */
    const decks = STARTER.sets * STARTER.decksPerSet;
    /* What a set HOLDS, which is not decks x deckSize: the two extra slots carry
       the Genesis card and the promo in a strong set, a Vault card and a Basic
       in a plain one. Multiplying the decks out was how the page came to
       publish 80 against the census's 82. */
    const setCards = STARTER.cardsPerSet;
    $("starterLead").textContent =
      `${num(STARTER.sets)} sets, each a box with ${STARTER.decksPerSet} decks of ${STARTER.deckSize} in it — ` +
      `${setCards} cards, and enough for two people to sit down and play without owning anything else. ` +
      `There is no pack to open: a set is a fixed pair of decks, and you know which kind you are buying.`;
    $("starterSetLine").textContent = `${STARTER.decksPerSet} decks · ${setCards} cards`;
    $("starterSets").textContent = num(STARTER.sets);
    $("starterDecks").textContent = num(decks);
    $("starterCards").textContent = num(STARTER.sets * STARTER.cardsPerSet);
    $("starterStrong").textContent = num(STARTER.genesisSets);
    $("starterPlain").textContent = num(STARTER.sets - STARTER.genesisSets);
    $("starterCollection").textContent = STARTER.collectionId;
    $("starterPanel1").textContent =
      `${STARTER.decksPerSet} decks of ${STARTER.deckSize}, built to be played against each other straight out ` +
      `of the box. Across the whole run that is ${num(decks)} decks and ${num(STARTER.sets * STARTER.cardsPerSet)} cards.`;

    $("starterPromoLine").textContent =
      `${promo.name} (${promo.id}) — one in each of the ${STARTER.genesisSets} strong sets, and nowhere else in ` +
      `this edition.`;
    /* ABOVE THE GUARD, all three of these. The promo face in particular: below
       it, the free box view — which is what the nav's "Shop" link opens — never
       set a src at all and painted an empty card-shaped rectangle under the
       heading "The promo". The section that says a thing is not on sale was
       also stranded, so the dead button had a bare em dash where its reason
       belonged. None of the three needs a census to be true. */
    const face = $("starterPromoFace");
    face.alt = promo.name;
    /* NOT lazy. setFace hands this an object URL, and a lazily-loaded image that
       is assigned one never decoded it here — the probe loaded the identical
       blob instantly with the attribute gone. It is one 150KB image in a
       section that now sits directly under the booster, so there is nothing to
       defer and an empty card-shaped rectangle to avoid. */
    face.removeAttribute("loading");
    if (FACES) FACES.setFace(face, promo.face);
    else face.src = `../art/cards/node-runner-web/${encodeURIComponent(promo.face)}`;

    $("starterState").innerHTML =
      "<strong>Not on sale yet.</strong> There is no G mint. Nothing on this page can quote a price, request an " +
      "invoice or take an order for a starter set, and no list is being kept. When a G mint exists it will publish " +
      "this edition's catalog and its cap the same way the E1 mint publishes its census, and this button will do " +
      "something.";

    /* The strong sets, said without the E1 comparison, which is the only part
       that needs the census. */
    $("starterPanel2").textContent =
      `${STARTER.genesisSets} of the ${num(STARTER.sets)} sets are the strong ones: one of their two decks carries ` +
      `a single Genesis card, and one ${promo.name} promo comes in the box with it. No Genesis card appears in ` +
      `more than ${STARTER.perGenesisCard} of those ${STARTER.genesisSets} sets. The other ` +
      `${num(STARTER.sets - STARTER.genesisSets)} sets hold ${STARTER.decksPerSet} decks with no Genesis card in either.`;

    /* The rest compares this run against E1's, so it waits. readMintState calls
       this again once the box has been read. */
    if (!f) return;

    $("starterPanel2").textContent =
      `${STARTER.genesisSets} of the ${num(STARTER.sets)} sets are the strong ones: one of their two decks carries ` +
      `a single Genesis card, and one ${promo.name} promo comes in the box with it. No Genesis card appears in ` +
      `more than ${STARTER.perGenesisCard} of those ${STARTER.genesisSets} sets, so the ${f.genesisCopies} copies ` +
      `land on at least ${f.minTitles} of the game's ${f.titles} Genesis cards rather than piling onto one. ` +
      `The other ${num(f.plainSets)} sets hold ${STARTER.decksPerSet} decks with no Genesis card in either.`;

    /* Shown only now, with something in them. */
    const panel3Box = $("starterPanel3Box");
    if (panel3Box) panel3Box.hidden = false;
    $("starterNote").hidden = false;

    $("starterPanel3").textContent =
      `These are a separate edition, marked G: their own collection id (${STARTER.collectionId}), their own ` +
      `catalog, their own cap of ${num(STARTER.sets)} sets, published the way the mint publishes its census. ` +
      `Not one card here comes out of the E1 box. Edition One still prints ${f.perTitle} copies of each of its ` +
      `${f.titles} Genesis cards, and that stays true whether or not a single starter set is ever sold.`;

    $("starterNote").innerHTML =
      `<strong>Why a second edition rather than a slice of the first.</strong> E1's Genesis run is ` +
      `${num(f.e1Copies)} copies — ${f.perTitle} of each of ${f.titles} cards — and that number is inside the ` +
      `census fingerprint above. Reserving ${f.genesisCopies} of them for starter sets would have left the ` +
      `fingerprint intact and the sentence underneath it wrong: buyers would have been counting a print run that ` +
      `${f.genesisCopies} cards had already been taken out of. The ${f.genesisCopies} Genesis cards in these sets ` +
      `are G cards instead, counted against G's own cap of ${num(STARTER.sets)} sets, and E1 keeps every one of ` +
      `its ${num(f.e1Copies)}.`;
  }

  function renderModeCopy() {
    const mint = PULL_MODE === "mint";
    /* THE CHECK IS THE PRODUCT, so it is never the thing that gets hidden. Mint
     * mode used to hide both buttons under a panel that still read "You check
     * it, not us" and a hero that promised a re-hash in about a second: the one
     * mode where a satoshi moves was the one mode you could not check. The
     * mint's box is a census rather than an order, so the check below is a
     * different check — it is not an absent one. */
    $("verifyBox").hidden = false;
    $("copyCommit").hidden = false;
    $("verifyBox").textContent = mint
      ? "Re-hash the mint's census in my browser"
      : "Verify this box in my browser";
    $("heroEyebrow").textContent = mint ? "Edition One · NutFT Mint" : "Edition One · Booster Box";
    $("heroDemo").hidden = mint;
    $("heroMint").hidden = !mint;
    $("proofDemo").hidden = mint;
    $("proofMint").hidden = !mint;
    $("footnoteDemo").hidden = mint;
    $("footnoteMint").hidden = !mint;
    $("mintState").hidden = !mint;
    if (mint && MINT_URL) $("stateLink").href = `${MINT_URL}/nutft/state`;
    const paidState = $("paidState");
    paidState.className = `state ${PULL_MODE === "mint" ? "state--live" : "state--off"}`;
    paidState.textContent = PULL_MODE === "mint" ? "NUTFT · DEMO" : "NUTFT · OPEN ?SHOP=MINT";

    const modeBox = $("modeNote");
    modeBox.className = `note mode-${PULL_MODE}`;
    modeBox.innerHTML =
      PULL_MODE === "mint"
        /* Said here rather than only in the footnotes, because a reader who
           arrived from the homepage has just been shown a 4 535-card box and is
           now looking at a different one. Two boxes are fine; two boxes with
           nothing saying so is the page contradicting itself. */
        ? "<strong>NutFT mint mode.</strong> This is the mint's own box — a census of print runs, not the free alpha box the rest of the site counts. The demo issues one Cashu proof per card into the browser wallet. The mint validates the disclosed output opening and CardBinding; the wallet verifies P2BK, DLEQ, proof state, and catalog data."
        : "<strong>Alpha — free demo packs.</strong> The box, the order, the odds and the fingerprint below are the real ones; only the payment is skipped. Your collection lives in this browser. When the mint goes live the same packs cost sats and the cards become yours on Nostr.";

    /* Two different truths, and the page must not tell the wrong one: there is
     * no mint, or there is a mint this sandbox cannot reach. */
    const paidNote = $("paidNote");
    const stranded = MODE === "mint" && !PAID_LIVE;
    const walled = MODE === "mint" && PAID_LIVE && !ONLINE;
    paidNote.hidden = !(stranded || walled);
    if (stranded) {
      paidNote.innerHTML =
        "<strong>Paid packs are not live yet.</strong> You asked for mint mode, but no mint is connected to this page — nothing here can request an invoice, and nothing can take a payment. The button below opens a <b>free</b> pack off the same committed box at the same odds. Nothing is owed and no purchase is implied.";
    } else if (walled) {
      paidNote.innerHTML =
        "<strong>Paid packs cannot run here.</strong> This shell does not let the page make outbound requests, so no invoice can be fetched and no payment can settle — sats stakes are out of scope for this build for exactly that reason. The button below opens a <b>free</b> pack off the same committed box at the same odds.";
    }

    /* Said once, plainly, whenever the page is walled off — the box, the odds
     * and the fingerprint all ship inside the page, so almost everything here
     * still works and the player deserves to know which part does not. */
    const netNote = $("netNote");
    if (netNote) {
      netNote.hidden = ONLINE;
      if (!ONLINE) {
        netNote.innerHTML =
          "<strong>No internet from this shell.</strong> The box, its order, the odds and the fingerprint all ship inside this page, so packs, the collection and the in-browser verification work exactly as they do online. Card art falls back to the copies bundled with the game, and anything that needs a mint is unavailable.";
      }
    }

    const button = $("openPack");
    button.textContent = PULL_MODE === "mint" ? "Buy a booster · demo mint" : "Open a free pack";
  }

  function syncControls() {
    const mint = PULL_MODE === "mint";
    const left = mint
      ? Math.max(0, nutftState.packs - nutftState.sold)
      : Math.max(0, BOX.box.length - state.cursor);
    const empty = left <= 0;
    $("boxLeft").textContent = num(left);
    /* Two boxes, two units. The demo box counts down in CARDS off a fixed
     * order; the mint counts down in PACKS, because packs are what it sells and
     * what its own state endpoint decrements. The label follows the number
     * rather than the number following the label. */
    $("boxLeftLabel").textContent = mint ? "PACKS LEFT" : "LEFT IN BOX";
    const total = mint ? nutftState.packs : BOX.box.length;
    $("boxFill").style.width = `${total ? (left / total) * 100 : 0}%`;
    $("resetBox").hidden = !(PULL_MODE === "demo" && state.cursor > 0);
    const button = $("openPack");
    /* `closed` is the cutover state: the mint refuses new sales while already
       paid packs stay claimable. It refuses politely and the page shows why,
       but only AFTER the click -- and a control that looks live and does
       nothing is the thing this page says it exists not to be.

       `allowlist` used to be deliberately excluded here, because whether one
       particular key may buy was the mint's answer to give and not the shop's
       to guess. It still is -- the difference is that the mint now answers it,
       at /nutft/eligibility, without selling anything to do so. So this reads
       the answer rather than guessing it, and only ever a SIGNED one: an
       anonymous check is refused by definition in early access, while the
       wallet would still reach for the signer at the click and succeed. */
    const shut = mint && nutftState.sales === "closed";
    const refused = mint && access && access.signed && access.may_buy === false && !shut;
    button.disabled = booting || busy || empty || shut || refused;
    if (booting) {
      /* Until storage answers, the cursor is unknown — pulling now would open
       * the top of the box a second time and then be overwritten. */
      button.textContent = "Opening the shop…";
    } else if (shut) {
      button.textContent = "The box is not open yet";
      const note = $("packNote");
      if (!note.textContent) {
        note.className = "pack-note";
        note.textContent = "This mint is not selling yet. Everything above is already published "
          + "and checkable — the census fingerprint, the print run of every tier, and how much of "
          + "each is still unminted. Only the till is shut.";
      }
    } else if (empty) {
      /* A disabled button must say why. The note only explains when there is
       * nothing else there — the last pack's own summary outranks it. */
      button.textContent = mint ? "Every pack has been sold" : "The box is empty";
      const note = $("packNote");
      if (!note.textContent) {
        note.className = "pack-note";
        note.textContent = mint
          ? "Every pack in this census has been sold. What remains of each card is still published above, and the fingerprint still covers the print run it started from."
          : "Every card in this box has been pulled — the order is now fully revealed and checkable. Reset to open the next one.";
      }
    } else if (refused) {
      /* No note here on purpose: the reason is already sitting in the identity
         row a few lines above the button, in words written for this exact
         refusal. Saying it twice would only make the page look unsure. */
      button.textContent = access.reason && /already has its set/i.test(access.reason)
        ? "This key already has its set"
        : "Not open to this key yet";
    } else if (busy) {
      button.textContent = "Opening…";
    } else {
      button.textContent = PULL_MODE === "mint" ? "Buy a booster · demo mint" : "Open a free pack";
    }
  }

  /* Storage is async, so the page paints its bundled facts first, binds every
   * control, and only then reads the cursor and the pull tally. The button
   * stays disabled until that read lands — a pull against an unknown cursor
   * would open the top of the box twice. */
  async function boot() {
    try { state = normalize(await store.json(STORE, null)); }
    catch (error) { state = fresh(); }
    if (PULL_MODE === "mint") {
      /* The page has already painted the census it was published against, so a
       * mint that cannot be reached leaves a stale-but-true number rather than
       * a blank — and the note says which it is. */
      const problem = await readMintState();
      $("mintStateNote").textContent = problem || `Read at ${new Date().toLocaleTimeString()}.`;
      /* Who the browser already knows about, read from storage. Never a
         signature: a page that signed on load would pop the extension at every
         visitor, and asking the mint is the buyer's move to make. */
      try { signedIn = ID ? await ID.current() : null; }
      catch (error) { signedIn = null; }
      renderIdentity();
      if (signedIn) identityNote(ASK_THE_MINT);
      else identityNote(ID && ID.source() !== "none" ? SIGN_IN_FIRST : NO_SIGNER);
    }
    durable = await probeStorage();
    booting = false;
    renderHistory();
    syncControls();
    if (!durable) storeNote(NO_STORE);
  }

  function init() {
    installCardHold();
    if (!BOX.box.length) return;
    renderBoxFacts();
    renderModeCopy();
    renderTiers();
    renderMintState();
    renderIdentity();
    renderStarter();
    renderHistory();
    syncControls();
    bindControls();
    boot();
  }

  function bindControls() {
    $("openPack").addEventListener("click", async () => {
      busy = true;
      syncControls();
      const note = $("packNote");
      note.className = "pack-note";
      note.textContent = "";
      try {
        lastStoreProblem = "";
        await revealPack(await pullPack(PULL_MODE === "mint" ? MINT_BOX.packSize : BOX.packSize));
        renderHistory();
        /* Re-read the mint. The box facts and the per-tier "still unminted"
           figures came from a snapshot taken at boot, so a buyer watched their
           own purchase leave every counter untouched -- the worst possible
           thing for a page whose argument is that these numbers are the
           mint's and not ours. The pull just changed them; ask again.
           Not awaited: the pack is already revealed, and the counters catching
           up a moment later is fine while blocking the reveal on a round trip
           is not. */
        if (PULL_MODE === "mint") readMintState().catch(() => {});
        /* Whatever storage said about THIS pack, said now — never swallowed. */
        storeNote(lastStoreProblem || (durable ? "" : NO_STORE));
      } catch (error) {
        clearTray();
        note.className = "pack-note is-error";
        note.textContent = String((error && error.message) || error);
      } finally {
        busy = false;
        syncControls();
      }
    });

    $("revealAll").addEventListener("click", () => {
      skipping = true;
      for (const node of dealt) {
        node.classList.remove("charging");
        node.classList.add("flipped");
      }
      $("revealAll").hidden = true;
    });

    $("resetBox").addEventListener("click", async () => {
      if (!root.confirm("Reset the demo box and your local pulls?")) return;
      state = fresh();
      clearTray();
      stackNote("");
      renderHistory();
      syncControls();
      storeNote(await persist());
    });

    /* Three answers, and they are three different questions. `recomputed` is
     * what the catalog the mint is actually selling from adds up to; `served`
     * is the fingerprint that same mint publishes for it; `published` is the
     * one this page was built against. recomputed != served is a mint
     * disagreeing with itself, which is the only accusation worth making.
     * recomputed == served but != published is a DIFFERENT census — worth
     * saying plainly, and not the same accusation at all. Collapsing the two
     * into one MISMATCH would cry wolf every time the box is legitimately
     * reissued, and a check that cries wolf is a check nobody reads. */
    async function verifyCensus(out) {
      out.textContent = "Fetching the catalog the mint signs…";
      const response = await fetch(`${MINT_URL}/nutft/catalog`);
      if (!response.ok) throw new Error(`the mint answered ${response.status}`);
      const catalog = await response.json();
      const assets = Array.isArray(catalog.assets) ? catalog.assets : [];
      out.textContent = `Hashing the print runs of ${assets.length} cards…`;
      const got = await recomputeCensus(assets);
      if (!got) {
        out.textContent =
          "This browser will not hash here — crypto.subtle needs a secure context (https, or localhost). The recipe is in the footnote; any sha256 tool gives the same answer.";
        return;
      }
      const served = String(catalog.census_sha256 || nutftState.census_sha256 || "");
      const tally = `${num(got.copies)} copies across ${got.cards} numbered cards`;
      if (served && got.hex !== served) {
        out.className = "verdict bad";
        out.textContent =
          `MISMATCH · the catalog this mint is selling from adds up to ${got.hex} (${tally}), but the mint publishes ${served}. Do not trust this mint.`;
        return;
      }
      if (got.hex === MINT_BOX.commitment) {
        out.className = "verdict ok";
        out.textContent = `MATCH · ${got.hex} — ${tally}, the census this page was published against.`;
        return;
      }
      out.textContent =
        `DIFFERENT CENSUS · this mint is selling ${got.hex} (${tally}). That is internally consistent, but it is not ` +
        `the ${MINT_BOX.commitment} this page was published against. Check which one you were promised.`;
    }

    $("verifyBox").addEventListener("click", async () => {
      const button = $("verifyBox");
      const out = $("verifyResult");
      button.disabled = true;
      out.className = "verdict";
      try {
        if (PULL_MODE === "mint") {
          await verifyCensus(out);
          return;
        }
        out.textContent = `Hashing all ${num(BOX.box.length)} cards…`;
        const hex = await recomputeCommitment();
        if (!hex) {
          out.textContent =
            "This browser will not hash here — crypto.subtle needs a secure context (https, or localhost). The recipe is in the footnote; any sha256 tool gives the same answer.";
        } else if (hex === BOX.commitment) {
          out.className = "verdict ok";
          out.textContent = `MATCH · ${hex} — this box is the box that was committed.`;
        } else {
          out.className = "verdict bad";
          out.textContent = `MISMATCH · your browser computed ${hex}. Do not trust this box.`;
        }
      } catch (error) {
        out.className = "verdict bad";
        out.textContent = `The check could not run: ${String((error && error.message) || error)}`;
      } finally {
        button.disabled = false;
      }
    });

    $("refreshState").addEventListener("click", async () => {
      const button = $("refreshState");
      const note = $("mintStateNote");
      button.disabled = true;
      note.textContent = "Reading…";
      const problem = await readMintState();
      /* Silence would be indistinguishable from a request that never went out,
       * so a good read says the time it happened rather than nothing at all. */
      note.textContent = problem || `Read at ${new Date().toLocaleTimeString()}.`;
      button.disabled = false;
    });

    /* Early access. Bound whether or not the row is visible — the nodes exist
       in both modes and renderIdentity decides what is shown — but guarded, so
       a cached page served an older shop.html cannot take the whole binding
       pass down with it and leave the free box without a working button. */
    if ($("mintIdentity")) {
      const asking = async (button, work) => {
        button.disabled = true;
        try { identityNote(await work()); }
        catch (error) { identityNote(String((error && error.message) || error)); }
        finally { button.disabled = false; }
      };

      $("nostrLogin").addEventListener("click", () => {
        const button = $("nostrLogin");
        if (!ID || ID.source() === "none") { identityNote(NO_SIGNER); return; }
        return asking(button, async () => {
          signedIn = await ID.login();
          renderIdentity();
          /* Straight on to the question, because it is the one they came to
             ask. This is the second prompt of the pair, and the only place the
             page ever spends two: the buyer just pressed the button that means
             "tell me about my key". */
          return askAboutMyKey();
        });
      });

      $("nostrCheck").addEventListener("click", () => asking($("nostrCheck"), askAboutMyKey));

      $("copyNpub").addEventListener("click", async () => {
        const npub = npubOf(signedIn);
        const full = $("npubFull");
        if (!npub) { identityNote("There is no key here to copy yet."); return; }
        if (await copyText(npub)) {
          full.hidden = true;
          identityNote("Your npub is on the clipboard. Send it to whoever runs the sale to be added.");
          return;
        }
        /* Clipboard blocked (private mode, or an insecure origin). The chip is
           shortened, so the full string has to be put somewhere selectable
           before anyone is told to select it. */
        full.hidden = false;
        full.textContent = npub;
        identityNote(selectNode(full)
          ? "Clipboard blocked here — your npub is selected below, copy it by hand."
          : "Clipboard blocked here — your npub is below, copy it by hand.");
      });

      $("nostrLogout").addEventListener("click", () => {
        if (ID) ID.forget();
        signedIn = null;
        /* The answer went with the key. Leaving it behind would keep the Buy
           button closed against a key nobody is signed in as any more. */
        access = null;
        $("npubFull").hidden = true;
        renderIdentity();
        syncControls();
        identityNote("Forgotten on this device. Your extension still holds the key — this page no longer does.");
      });
    }

    $("copyCommit").addEventListener("click", async () => {
      const node = $("boxCommit");
      const out = $("verifyResult");
      /* Whatever is on the page is what gets copied — in mint mode that is the
       * census fingerprint, and copying the free box's would hand somebody a
       * hash of a box they are not looking at. */
      if (await copyText(node.textContent === "—" ? "" : node.textContent)) {
        out.className = "verdict";
        out.textContent = "Fingerprint copied to the clipboard.";
        return;
      }
      out.className = "verdict";
      out.textContent = selectNode(node)
        ? "Clipboard blocked here — the fingerprint is selected, copy it by hand."
        : "Clipboard blocked here — select the fingerprint above and copy it by hand.";
    });
  }

  root.addEventListener("DOMContentLoaded", init);
  root.E1_SHOP = {
    get state() {
      return state;
    },
    mode: MODE,
    pullMode: PULL_MODE,
    paidLive: PAID_LIVE,
    online: ONLINE,
    box: BOX,
    budget: { shop: SHOP_BUDGET, decks: DECK_BUDGET, history: HISTORY_MAX, draft: MAX_DRAFT },
    boot,
    persist,
    writeDraft,
    pullPack,
    recomputeCommitment,
    napplet: () => (NAP ? NAP.report() : null),
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
