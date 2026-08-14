/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — the booster shop.
 *
 * One box, opened from the top. `shop-data.js` ships the ordered box, the seed
 * that shuffled it and the SHA-256 over that order, so a pull is auditable
 * rather than trusted: publish the commitment before selling, reveal the order
 * when the box is empty, and anyone can replay it.
 *
 * TWO MODES, ONE PULL PATH. `demo` opens free packs against a local cursor —
 * the same box, the same odds, nothing owed. `mint` asks the LNURL mint for an
 * invoice, the buyer pays it with their OWN wallet, and the mint issues the
 * card. Switching is configuration (MINT_URL + SHOP.mode), never a rewrite:
 * both modes call pullPack() and render the identical reveal.
 *
 * This file never sees a payment credential. It requests an invoice and shows
 * it; the wallet that pays it is the buyer's.
 * ------------------------------------------------------------------------ */
(function (root) {
  "use strict";

  const BOX = root.E1_BOX || { box: [], odds: {}, packSize: 5 };
  const CARDS = root.E1_CARDS || [];
  const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  const FACES = root.E1Faces || null;
  const STORE = "600b:shop";
  const BACK = "600B-Timelock-card-back.webp";

  /* The live mint's base URL. Null until the operator has one — mint mode
   * then explains itself instead of pretending to sell. */
  const MINT_URL = null;

  const params = new URLSearchParams(root.location.search);
  const MODE = params.get("shop") === "mint" ? "mint" : "demo";

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ------------------------------------------------------------- storage

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE));
      if (saved && typeof saved.cursor === "number" && saved.pulls) return saved;
    } catch (error) {
      /* a corrupt record is a fresh box, not a crash */
    }
    return { cursor: 0, pulls: {} };
  };
  const save = (state) => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (error) {
      /* private mode: the session still works, it just will not persist */
    }
  };

  let state = load();

  // ----------------------------------------------------------- the pull

  /* The one pull path. Demo takes the next `n` off the box; mint asks the
   * mint for them against an invoice the buyer pays themselves. Both return
   * the same shape, so the reveal below never learns which mode it is in. */
  async function pullPack(n) {
    if (MODE === "mint") {
      if (!MINT_URL) {
        throw new Error(
          "The mint is not live yet. Alpha runs on free demo packs — the box, the odds and the commitment are already the real ones."
        );
      }
      /* Live path, deliberately thin: ask for an invoice, show it, wait for
       * the mint to confirm. The buyer's wallet pays; nothing here handles
       * their credentials. */
      const res = await fetch(`${MINT_URL}/pack?count=${n}`, { method: "POST" });
      if (!res.ok) throw new Error(`the mint refused the request (${res.status})`);
      return (await res.json()).cards;
    }
    const remaining = BOX.box.length - state.cursor;
    if (remaining <= 0) throw new Error("This box is empty. Reset it to open the next one.");
    const cards = BOX.box.slice(state.cursor, state.cursor + Math.min(n, remaining));
    state.cursor += cards.length;
    for (const id of cards) state.pulls[id] = (state.pulls[id] || 0) + 1;
    save(state);
    return cards;
  }

  // ---------------------------------------------------------- the reveal

  function cardNode(cardId, index) {
    const card = BY_ID[cardId];
    const node = el("div", `pull rarity-${(card && card.rarity) || "common"}`);
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
    node.append(inner);
    if (card && card.rarity && card.rarity !== "common") {
      node.append(el("span", "pull__rarity", card.rarity.toUpperCase()));
    }
    node.title = card ? `${card.name} — ${card.rarity || "common"}` : cardId;
    // Right-click opens the card in the gallery, same hand as the table.
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      root.open(`cards.html#${cardId}`, "_blank", "noopener");
    });
    return node;
  }

  function revealPack(cards) {
    const tray = $("packTray");
    tray.innerHTML = "";
    tray.hidden = false;
    const reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cards.forEach((id, i) => {
      const node = cardNode(id, i);
      tray.append(node);
      if (reduced) node.classList.add("flipped");
      else setTimeout(() => node.classList.add("flipped"), 120 + i * 220);
    });
    const best = cards
      .map((id) => (BY_ID[id] && BY_ID[id].rarity) || "common")
      .sort((a, b) => ({ rare: 0, uncommon: 1, common: 2 }[a] - { rare: 0, uncommon: 1, common: 2 }[b]))[0];
    $("packNote").textContent =
      best === "rare"
        ? "A rare. That is the 2.98% — the box is not being kind to you, it is being honest."
        : best === "uncommon"
          ? "An uncommon in the pack."
          : "Five commons. The floor of the set — and the backbone of a Stack.";
  }

  // ---------------------------------------------------------- collection

  function renderCollection() {
    const box = $("collection");
    const ids = Object.keys(state.pulls);
    $("ownedCount").textContent = ids.reduce((n, id) => n + state.pulls[id], 0);
    $("uniqueCount").textContent = ids.length;
    $("boxLeft").textContent = Math.max(0, BOX.box.length - state.cursor);
    box.innerHTML = "";
    if (!ids.length) {
      box.append(el("p", "muted", "Nothing opened yet. The first pack is free."));
      return;
    }
    const order = { rare: 0, uncommon: 1, common: 2 };
    ids
      .sort((a, b) => {
        const ra = order[(BY_ID[a] || {}).rarity] ?? 2;
        const rb = order[(BY_ID[b] || {}).rarity] ?? 2;
        return ra - rb || (BY_ID[a] || {}).name.localeCompare((BY_ID[b] || {}).name);
      })
      .forEach((id) => {
        const card = BY_ID[id];
        if (!card) return;
        const tile = el("div", `owned rarity-${card.rarity || "common"}`);
        const img = el("img");
        img.alt = card.name;
        img.loading = "lazy";
        if (FACES) FACES.setFace(img, card.face);
        else img.src = `../art/cards/node-runner-web/${encodeURIComponent(card.face)}`;
        tile.append(img);
        if (state.pulls[id] > 1) tile.append(el("span", "owned__n", `×${state.pulls[id]}`));
        tile.title = `${card.name} — ${card.rarity || "common"}`;
        box.append(tile);
      });
  }

  // --------------------------------------------------------------- boot

  function renderBoxFacts() {
    $("boxCommit").textContent = BOX.commitment || "—";
    $("boxSeed").textContent = BOX.seed;
    $("boxSize").textContent = BOX.box.length;
    $("packSize").textContent = BOX.packSize;
    $("packPrice").textContent =
      MODE === "mint" ? `${(BOX.priceMsat * BOX.packSize) / 1000} sats` : "free";
    const odds = $("odds");
    odds.innerHTML = "";
    for (const [rarity, percent] of Object.entries(BOX.odds || {})) {
      const row = el("div", "odd");
      row.append(el("b", null, `${percent}%`), el("span", null, rarity));
      odds.append(row);
    }
  }

  function init() {
    if (!BOX.box.length) return;
    renderBoxFacts();
    renderCollection();

    const modeBox = $("modeNote");
    modeBox.className = `note mode-${MODE}`;
    modeBox.innerHTML =
      MODE === "mint"
        ? "<strong>Mint mode.</strong> Packs are paid in sats with your own Lightning wallet; the mint issues each card as a signed event. This page never sees your wallet or your keys."
        : "<strong>Alpha — free demo packs.</strong> The box, the order, the odds and the commitment below are the real ones; only the payment is skipped. Your collection lives in this browser. When the mint goes live the same packs cost sats and the cards become yours on Nostr.";

    const button = $("openPack");
    button.textContent = MODE === "mint" ? `Buy a pack · ${(BOX.priceMsat * BOX.packSize) / 1000} sats` : "Open a free pack";
    button.addEventListener("click", async () => {
      button.disabled = true;
      $("packNote").textContent = "";
      try {
        revealPack(await pullPack(BOX.packSize));
        renderCollection();
      } catch (error) {
        $("packNote").textContent = String(error.message || error);
      } finally {
        button.disabled = false;
      }
    });

    $("resetBox").addEventListener("click", () => {
      if (!root.confirm("Reset the demo box and your local collection?")) return;
      state = { cursor: 0, pulls: {} };
      save(state);
      $("packTray").hidden = true;
      $("packNote").textContent = "";
      renderCollection();
    });
  }

  root.addEventListener("DOMContentLoaded", init);
  root.E1_SHOP = { get state() { return state; }, mode: MODE, box: BOX, pullPack };
})(typeof globalThis !== "undefined" ? globalThis : this);
