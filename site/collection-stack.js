/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — play with my collection.
 *
 * The NutFT cards a player holds, turned into a Stack the engine accepts:
 *
 *   ownedFromInventory(counts, catalog)          -> { owned, cards, unknown, unknownIds }
 *   pickAffinity(catalog, owned, { profile })    -> "Power" | "Bitcoin" | "Keys" | "Signal" | "Timelock"
 *   buildCollectionStack(catalog, owned, { profile, affinity, precons })
 *                                                -> { ids, fromCollection, filled, affinity }
 *   readWallet(wallet, origin) / readOwned({ napplet, wallet, origin })
 *                                                -> { source, counts, opened, unreadable }
 *   walletExists(storage) / loadWallet({ document })
 *   loadCollection(env)                          -> { status, source, counts, identity, reason }
 *   collectionLine(collection) / optionLabel(n)  -> the words a setup screen shows
 *
 * ASSET IDS ARE CARD IDS. server/nutft-mint.js signs its catalog from
 * cards/nutft-census.json with `asset_id: card.id` ("E1-001"), every proof's
 * nutft tag carries that id, and Bearlett's `nutft/inventory` counts the tag.
 * So the mapping is the identity on catalog ids, and anything else is not a
 * card of this edition: ignored, and counted so a screen can say so.
 *
 * THE BUILDER IS PURE AND DETERMINISTIC. No Math.random, no clock, no globals
 * but the engine's own rules helpers: the stream is seeded from the sorted
 * owned list, so one collection always deals one Stack, and the engine is the
 * authority on copy limits and the Stack floor rather than a fourth copy of
 * them here.
 *
 * Loads in a browser via <script src="collection-stack.js"> and under node via
 * require(). The wallet helpers take every dependency as an argument.
 * ------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory(root);
  root.E1CollectionStack = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const EDITION = "600b-e1";
  /* nutft-wallet.js's own default slot. storage-keys.js does not list it: the
     wallet owns the key, and this file only asks whether anything is there. */
  const WALLET_KEY = "600b:nutft-wallet";
  const WALLET_SCRIPT = "nutft-wallet.js";
  const WALLET_LOAD_MS = 15000;
  /* The setup menu's order, which is also the tie-break: a collection that
     fits two affinities equally well plays the one listed first. */
  const AFFINITIES = Object.freeze(["Power", "Bitcoin", "Keys", "Signal", "Timelock"]);
  const CHOSEN = AFFINITIES.concat(["Neutral"]);

  const isAvatar = (card) => String(card.type || "").indexOf("Avatar") >= 0;
  const isResource = (card) => card.type === "Basic Resource" || card.type === "Resource";
  const isSpell = (card) => card.type === "Zap" || card.type === "Operation";
  const isPermanent = (card) => card.type === "Hardware" || card.type === "Protocol";

  /* THE QUOTAS AND TOP-UPS OF site/engine.js buildDeckList, which does not
     export them. Named here so a collection Stack has the curve an auto-built
     one has; tests/js/collection-stack.test.mjs holds these numbers to the
     Stacks the engine itself deals, so the two cannot drift apart unseen. */
  const QUOTAS = Object.freeze({
    "F1.0": Object.freeze([
      Object.freeze({ name: "avatars", count: 20, test: isAvatar }),
      Object.freeze({ name: "spells", count: 12, test: (card) => !isAvatar(card) && isSpell(card) }),
      Object.freeze({ name: "permanents", count: 8, test: (card) => !isAvatar(card) && isPermanent(card) }),
    ]),
    "E1.0": Object.freeze([
      Object.freeze({ name: "resources", count: 17, test: isResource }),
      Object.freeze({ name: "avatars", count: 14, test: isAvatar }),
      Object.freeze({ name: "spells", count: 5, test: isSpell }),
      Object.freeze({ name: "permanents", count: 4, test: isPermanent }),
    ]),
  });
  const TOP_UPS = Object.freeze({
    "F1.0": Object.freeze([(card) => !isResource(card), () => true]),
    "E1.0": Object.freeze([() => true]),
  });

  // Mirrors buildDeckList: a Stake card never constructs without the Stake module.
  const playable = (card) => !/stake/i.test(card.type || "") && !/\bStake\b/.test(card.text || "");
  const affinitiesOf = (card) => (Array.isArray(card.affinity) ? card.affinity : []);
  const inAffinity = (card, affinity) =>
    affinitiesOf(card).indexOf(affinity) >= 0 || affinitiesOf(card).indexOf("Neutral") >= 0;
  const byCodeUnit = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

  function engineOf(options) {
    const E = (options && options.engine) || root.E1Engine;
    if (!E || typeof E.copyLimit !== "function" || typeof E.nextInt !== "function"
        || typeof E.newStream !== "function" || typeof E.sha256hex !== "function") {
      throw new Error("a collection Stack needs site/engine.js");
    }
    return E;
  }

  function rulesetOf(profile) {
    if (profile === undefined || profile === null) return "F1.0"; // what the Hangar plays
    if (profile === "F1.0" || profile === "E1.0") return profile;
    throw new Error(`unknown rules profile ${JSON.stringify(profile)}`);
  }

  /* A play-data card list, or an engine catalog ({ ids, byId }). */
  function catalogOf(catalog) {
    if (catalog && Array.isArray(catalog.ids) && catalog.byId) return catalog;
    if (!Array.isArray(catalog)) throw new Error("a collection Stack needs a card list");
    const byId = Object.create(null);
    const ids = [];
    for (const card of catalog) {
      if (!card || typeof card.id !== "string" || byId[card.id]) continue;
      byId[card.id] = card;
      ids.push(card.id);
    }
    return { ids, byId };
  }

  /* A Map, a plain object or a list of [id, count] pairs. */
  function entriesOf(counts) {
    if (Array.isArray(counts)) return counts;
    if (counts && typeof counts.get === "function" && typeof counts.forEach === "function") return Array.from(counts);
    return counts && typeof counts === "object" ? Object.entries(counts) : [];
  }

  const isCount = (count) => Number.isInteger(count) && count > 0;

  /* What the inventory's asset ids mean in this catalog. `cards` and `unknown`
     are copies, so "Your collection: 12 cards" counts what the wallet holds. */
  function ownedFromInventory(counts, catalog) {
    const cards = catalogOf(catalog);
    const owned = new Map();
    const unknownIds = [];
    let known = 0;
    let unknown = 0;
    for (const [assetId, count] of entriesOf(counts)) {
      if (!isCount(count)) continue;
      if (typeof assetId === "string" && cards.byId[assetId]) {
        owned.set(assetId, (owned.get(assetId) || 0) + count);
        known += count;
      } else {
        unknown += count;
        unknownIds.push(String(assetId));
      }
    }
    return { owned, cards: known, unknown, unknownIds: unknownIds.sort() };
  }

  /* Catalog ids only, positive whole counts, sorted in code-unit order: the
     same collection handed over in any shape is the same list, and the seed. */
  function sortedOwned(owned, cards) {
    const merged = new Map();
    for (const [id, count] of entriesOf(owned)) {
      if (typeof id !== "string" || !cards.byId[id] || !isCount(count)) continue;
      merged.set(id, (merged.get(id) || 0) + count);
    }
    return Array.from(merged).sort(byCodeUnit);
  }

  function seedOf(sorted, E) {
    const text = sorted.map(([id, count]) => `${id}x${count}`).join(",");
    return parseInt(E.sha256hex(`600b-collection-stack/v1|${text}`).slice(0, 8), 16) | 0;
  }

  /* THE AFFINITY THAT KEEPS THE MOST OF WHAT YOU OWN. Each of the five is
     scored by how many owned copies its Stack would actually take — within the
     copy limit and the quotas, Neutral cards included because every affinity
     takes them — then by the owned copies of that affinity itself, then by
     menu order. Neutral is never picked on its own: a Neutral card fits every
     Stack and no Starter is Neutral, so it would only ever lose cards. */
  function scoreAffinities(cards, sorted, quotas, E) {
    return AFFINITIES.map((affinity) => {
      let placed = 0;
      for (const quota of quotas) {
        let available = 0;
        for (const [id, count] of sorted) {
          const card = cards.byId[id];
          if (quota.test(card) && inAffinity(card, affinity) && playable(card)) {
            available += Math.min(count, E.copyLimit(card));
          }
        }
        placed += Math.min(quota.count, available);
      }
      let own = 0;
      for (const [id, count] of sorted) if (affinitiesOf(cards.byId[id]).indexOf(affinity) >= 0) own += count;
      return { affinity, placed, own };
    });
  }

  function pickAffinity(catalog, owned, options) {
    const opts = options || {};
    const E = engineOf(opts);
    const cards = catalogOf(catalog);
    const sorted = sortedOwned(owned, cards);
    let best = null;
    for (const score of scoreAffinities(cards, sorted, QUOTAS[rulesetOf(opts.profile)], E)) {
      if (!best || score.placed > best.placed || (score.placed === best.placed && score.own > best.own)) best = score;
    }
    return best.affinity;
  }

  function starterFor(precons, affinity) {
    for (const name of Object.keys(precons || {})) {
      const precon = precons[name];
      if (precon && precon.group === "Starter" && precon.affinity === affinity && Array.isArray(precon.cards)) {
        return precon;
      }
    }
    return null;
  }

  /* One Stack from a collection, in three passes:
   *   1. the owned cards of the affinity (and Neutral), each quota filled from
   *      them first, never past a card's copy limit or its owned count;
   *   2. that affinity's Starter for what is left — Fast Starters under F1.0,
   *      Classic Starters under E1.0 — minus the copies you already brought, so
   *      a player who owns the whole Starter plays exactly the Starter;
   *   3. the affinity's pool, the way buildDeckList deals it, and its top-ups
   *      when a category runs dry (your leftover cards before the pool's).
   * `ids` lists the owned copies first: ids.slice(0, fromCollection). */
  function buildCollectionStack(catalog, owned, options) {
    const opts = options || {};
    const E = engineOf(opts);
    const ruleset = rulesetOf(opts.profile);
    const cards = catalogOf(catalog);
    const sorted = sortedOwned(owned, cards);
    const mine = new Map(sorted);
    const quotas = QUOTAS[ruleset];
    const size = Number.isInteger(E.MIN_STACK) ? E.MIN_STACK : 40;
    const affinity = CHOSEN.indexOf(opts.affinity) >= 0
      ? opts.affinity
      : pickAffinity(cards, sorted, { profile: ruleset, engine: E });
    const precons = opts.precons !== undefined
      ? opts.precons
      : ruleset === "F1.0" ? root.E1_PRECONS_FAST : root.E1_PRECONS;

    const stream = E.newStream(seedOf(sorted, E));
    const used = Object.create(null);
    const ids = [];
    const limit = (card) => E.copyLimit(card);
    /* buildDeckList's draw: without replacement inside a pass, the bag refilled
       from whatever is still under its allowance, until the count is met or
       nothing is left. Returns how many it placed. */
    const draw = (candidates, allowed, count) => {
      let bag = [];
      let placed = 0;
      while (placed < count) {
        if (!bag.length) {
          bag = candidates.filter((card) => (used[card.id] || 0) < allowed(card));
          if (!bag.length) break;
        }
        const card = bag.splice(E.nextInt(stream, bag.length), 1)[0];
        used[card.id] = (used[card.id] || 0) + 1;
        ids.push(card.id);
        placed += 1;
      }
      return placed;
    };

    const pool = cards.ids.map((id) => cards.byId[id]).filter((card) => inAffinity(card, affinity) && playable(card));
    const ownedPool = pool.filter((card) => mine.has(card.id));
    const ownedAllowance = (card) => Math.min(mine.get(card.id) || 0, limit(card));

    let fromCollection = 0;
    const room = quotas.map((quota) => {
      const placed = draw(ownedPool.filter(quota.test), ownedAllowance, quota.count);
      fromCollection += placed;
      return quota.count - placed;
    });

    const starter = starterFor(precons, affinity);
    if (starter) {
      /* Up to the Starter's own count of each card, and the copies you brought
         already count toward it: that is the swap. */
      const listed = Object.create(null);
      for (const id of starter.cards) listed[id] = (listed[id] || 0) + 1;
      const starterPool = pool.filter((card) => listed[card.id]);
      const starterAllowance = (card) => Math.min(limit(card), listed[card.id]);
      quotas.forEach((quota, index) => {
        room[index] -= draw(starterPool.filter(quota.test), starterAllowance, room[index]);
      });
    }

    quotas.forEach((quota, index) => {
      room[index] -= draw(pool.filter(quota.test), limit, room[index]);
    });
    for (const test of TOP_UPS[ruleset]) {
      fromCollection += draw(ownedPool.filter(test), ownedAllowance, size - ids.length);
      draw(pool.filter(test), limit, size - ids.length);
    }
    return { ids, fromCollection, filled: ids.length - fromCollection, affinity };
  }

  // ---------------------------------------------------------------- reading

  const inventoryCounts = (napplet, inventory) => {
    if (napplet && napplet.collection && typeof napplet.collection.counts === "function") {
      return napplet.collection.counts(inventory);
    }
    const counts = new Map();
    for (const card of (inventory && inventory.cards) || []) counts.set(card.asset_id, card.count);
    return counts;
  };

  /* THE STACK BUILDER'S WALLET READ, lifted from site/deck.html unchanged: an
     empty wallet is answered without asking the mint, otherwise the snapshot's
     unspent proofs are counted by the asset id in their nutft tag.
     The two other numbers are two different silences. snapshot() does not
     throw on a token this mint cannot open, so a wallet full of them arrives as
     zero owned cards: `unreadable` says how many. And "nothing could be read"
     must not be said over spent or rejected proofs — the mint did read those
     and has an opinion — so `opened` counts owned, spent and invalid alike. */
  async function readWallet(wallet, origin) {
    const state = await wallet.read();
    if (!state.tokens.length) return { source: "wallet", counts: new Map(), opened: 0, unreadable: 0 };
    const view = await wallet.snapshot(origin);
    const counts = new Map();
    for (const item of view.owned) counts.set(item.tag[2], (counts.get(item.tag[2]) || 0) + 1);
    return {
      source: "wallet",
      counts,
      opened: view.owned.length + view.spent.length + view.invalid.length,
      unreadable: view.unreadable.length,
    };
  }

  /* deck.html's order: Bearlett's collection when the shell offers the intent
     domain and holds an inventory, else the page's own wallet. Rejects when
     neither can answer, so the page can say why it fell back. */
  async function readOwned(options) {
    const opts = options || {};
    const napplet = opts.napplet;
    let inventory = null;
    if (napplet && typeof napplet.has === "function" && napplet.has("intent") && napplet.collection) {
      inventory = await Promise.resolve()
        .then(() => napplet.collection.inventory(EDITION))
        .catch(() => null);
    }
    if (inventory) {
      return {
        source: "bearlett",
        counts: inventoryCounts(napplet, inventory),
        opened: inventory.cards.reduce((sum, card) => sum + card.count, 0),
        unreadable: 0,
      };
    }
    if (!opts.wallet) throw new Error("no wallet script on this page");
    return readWallet(opts.wallet, opts.origin);
  }

  /* Storage that throws is storage with nothing in it: a sandboxed frame has an
     opaque origin, and merely reading `localStorage` throws there. */
  function storageOf(storage) {
    if (storage !== undefined) return storage;
    try { return root.localStorage || null; } catch (error) { return null; }
  }

  /* Whether this device holds a wallet with anything in it — read straight from
     storage, never by loading the wallet, which is what keeps a cold page cold. */
  function walletExists(storage) {
    try {
      const store = storageOf(storage);
      const raw = store && typeof store.getItem === "function" ? store.getItem(WALLET_KEY) : null;
      if (!raw) return false;
      const state = JSON.parse(raw);
      return Boolean(state && Array.isArray(state.tokens) && state.tokens.length);
    } catch (error) {
      return false;
    }
  }

  let walletLoading = null;
  /* nutft-wallet.js on demand: the loaded global when there is one, else one
     script tag, resolved with the wallet or null. Only an ask in flight is
     shared; once it settles the global is the cache, and a failed load is
     tried again on the next ask. Never inside a shell: a napplet has no
     network of its own, and its artifact carries no wallet. */
  function loadWallet(options) {
    const opts = options || {};
    const napplet = opts.napplet !== undefined ? opts.napplet : root.E1Napplet;
    if (root.NutFTWallet) return Promise.resolve(root.NutFTWallet);
    if (napplet && napplet.present) return Promise.resolve(null);
    if (walletLoading) return walletLoading;
    const doc = opts.document || root.document;
    const parent = doc && (doc.head || doc.body || doc.documentElement);
    if (!doc || typeof doc.createElement !== "function" || !parent) return Promise.resolve(null);
    walletLoading = new Promise((resolve) => {
      const tag = doc.createElement("script");
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        resolve(root.NutFTWallet || null);
      };
      tag.src = WALLET_SCRIPT;
      tag.async = true;
      tag.addEventListener("load", done);
      tag.addEventListener("error", done);
      timer = setTimeout(done, WALLET_LOAD_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
      parent.appendChild(tag);
    }).then((wallet) => {
      walletLoading = null;
      return wallet;
    });
    return walletLoading;
  }

  /* The signed-in key: the shell's inside one (its answer is final there), the
     site's own login on the website. Null when nobody is signed in. */
  async function identityOf(napplet, net) {
    try {
      if (napplet && napplet.identity && typeof napplet.identity.current === "function") {
        const key = await napplet.identity.current();
        if (key || napplet.present) return key || null;
      }
    } catch (error) {
      if (napplet && napplet.present) return null;
    }
    try {
      return (net && net.nostr && typeof net.nostr.savedPubkey === "function" && net.nostr.savedPubkey()) || null;
    } catch (error) {
      return null;
    }
  }

  /* WHAT A SETUP SCREEN CAN OFFER, AND WHY NOT. Never rejects.
   *   env: { napplet, net, storage?, document?, origin }
   *   -> { status: "cards" | "empty" | "unavailable", source: "shell" | "wallet",
   *        counts: Map(asset_id -> count), identity: pubkey | null, reason }
   * Inside a shell only the collection intent is asked; storage and scripts are
   * never touched. On the website the wallet script loads only when this device
   * holds a wallet with tokens in it. */
  async function loadCollection(env) {
    const opts = env || {};
    const napplet = opts.napplet || null;
    const identity = await identityOf(napplet, opts.net);
    const answer = (status, source, counts, reason) => ({ status, source, counts: counts || new Map(), identity, reason: reason || null });
    if (napplet && napplet.present) {
      const collection = napplet.collection;
      if (typeof napplet.has !== "function" || !napplet.has("intent") || !collection || typeof collection.inventory !== "function") {
        return answer("unavailable", "shell", null, "this shell offers no collection");
      }
      let inventory = null;
      try { inventory = await collection.inventory(EDITION); } catch (error) { inventory = null; }
      const counts = inventory ? inventoryCounts(napplet, inventory) : new Map();
      return answer(counts.size ? "cards" : "empty", "shell", counts, inventory ? null : "no inventory");
    }
    if (!walletExists(opts.storage)) return answer("empty", "wallet", null, "no wallet on this device");
    const wallet = await loadWallet(opts);
    if (!wallet) return answer("unavailable", "wallet", null, "the wallet did not load");
    try {
      const read = await readWallet(wallet, opts.origin);
      return answer(read.counts.size ? "cards" : "empty", "wallet", read.counts);
    } catch (error) {
      return answer("unavailable", "wallet", null, String((error && error.message) || error));
    }
  }

  // ------------------------------------------------------------------ words

  const WORDS = Object.freeze({
    guest: "Sign in to use your cards. You can play with a starter stack now.",
    empty: "No cards in your collection yet. Cards from the shop on tcg.nappelin.com can be handed to your Bearlett collection.",
    noCollection: "No card collection is reachable in this shell. You can play with a starter stack now.",
  });

  const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const optionLabel = (fromCollection, size) => `My collection (${fromCollection} of ${size || 40} cards yours)`;

  /* One line for the setup form. `collection` is loadCollection's answer merged
     with ownedFromInventory's counts. */
  function collectionLine(collection) {
    const c = collection || {};
    if (c.cards > 0) {
      const more = c.unknown ? ` ${counted(c.unknown, "more card is", "more cards are")} not part of this edition.` : "";
      return `Your collection: ${counted(c.cards, "card", "cards")}. “My collection” is in both Stack menus.${more}`;
    }
    if (c.status === "unavailable") {
      return c.source === "shell"
        ? WORDS.noCollection
        : `Your wallet could not be read here (${c.reason}). You can play with a starter stack now.`;
    }
    if (c.unknown) {
      return `Your collection holds ${counted(c.unknown, "card", "cards")} this edition does not know. You can play with a starter stack now.`;
    }
    return c.identity ? WORDS.empty : WORDS.guest;
  }

  return Object.freeze({
    EDITION,
    WALLET_KEY,
    AFFINITIES,
    QUOTAS,
    WORDS,
    ownedFromInventory,
    pickAffinity,
    buildCollectionStack,
    readWallet,
    readOwned,
    walletExists,
    loadWallet,
    loadCollection,
    collectionLine,
    optionLabel,
  });
});
