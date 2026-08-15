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
 * pull, and keeps the box, the odds and the commitment honest.
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

  /* The Stack Builder's own store, written in its own shape ({ name: [ids] }).
   * A pulled card has somewhere to go the moment it lands. */
  const DECK_STORE = "600b:decks";
  const DRAFT_NAME = "Booster pulls";
  const HISTORY_MAX = 60; // packs kept in the log; the counters keep counting

  /* The live mint's base URL. Null until the operator has one — the shop then
   * explains itself instead of pretending to sell. */
  const MINT_URL = null;
  const PAID_LIVE = Boolean(MINT_URL);

  const params = new URLSearchParams(root.location.search);
  const MODE = params.get("shop") === "mint" ? "mint" : "demo";
  /* What the button will ACTUALLY do. Asking for mint mode without a mint
   * gets the free pull and a notice, never a control that no-ops. */
  const PULL_MODE = MODE === "mint" && PAID_LIVE ? "mint" : "demo";

  const RANK = { promo: 3, rare: 3, uncommon: 2, common: 1 };
  const SATS = Math.round(((BOX.priceMsat || 0) * (BOX.packSize || 0)) / 1000);

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const rarityOf = (id) => (BY_ID[id] && BY_ID[id].rarity) || "common";
  const rankOf = (id) => RANK[rarityOf(id)] || 1;
  const nameOf = (id) => (BY_ID[id] && BY_ID[id].name) || id;
  const pad = (n, width) => String(n).padStart(width, "0");
  /* Read live, not once at load: the preference can change mid-session. */
  const reduced = () =>
    Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ------------------------------------------------------------- storage

  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE));
      if (saved && typeof saved.cursor === "number" && saved.pulls) {
        return {
          cursor: saved.cursor,
          pulls: saved.pulls,
          packs: typeof saved.packs === "number" ? saved.packs : 0,
          history: Array.isArray(saved.history) ? saved.history : [],
        };
      }
    } catch (error) {
      /* a corrupt record is a fresh box, not a crash */
    }
    return { cursor: 0, pulls: {}, packs: 0, history: [] };
  };
  const save = (state) => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (error) {
      /* private mode: the session still works, it just will not persist */
    }
  };

  let state = load();
  let busy = false;

  // ----------------------------------------------------------- the pull

  /* Everything a pack needs to be checked later: which cards, which slice of
   * the box they came off, and which of them were new. Written once, on the
   * pull, so the log can never drift from the collection. */
  function record(cards, from) {
    const seen = {};
    const fresh = cards.map((id) => {
      const had = (state.pulls[id] || 0) + (seen[id] || 0);
      seen[id] = (seen[id] || 0) + 1;
      return had === 0;
    });
    for (const id of cards) state.pulls[id] = (state.pulls[id] || 0) + 1;
    state.packs = (state.packs || 0) + 1;
    const entry = { n: state.packs, at: Date.now(), from, ids: cards.slice(), fresh };
    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    save(state);
    return entry;
  }

  /* The one pull path. Demo takes the next `n` off the box; mint asks the
   * mint for them against an invoice the buyer pays themselves. Both return
   * the same record, so the reveal below never learns which mode it is in. */
  async function pullPack(n) {
    if (PULL_MODE === "mint") {
      /* Live path, deliberately thin: ask for an invoice, show it, wait for
       * the mint to confirm. The buyer's wallet pays; nothing here handles
       * their credentials. */
      const res = await fetch(`${MINT_URL}/pack?count=${n}`, { method: "POST" });
      if (!res.ok) throw new Error(`the mint refused the request (${res.status})`);
      const cards = (await res.json()).cards || [];
      return record(cards, null);
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

  function openGallery(cardId) {
    root.open(`cards.html#${cardId}`, "_blank", "noopener");
  }

  /* LEFT = act, RIGHT = explain. On a face-down card the fast action is
   * "turn it over now"; once it is up, the fast action is "put it in a Stack". */
  function bindCardHands(node, cardId, isFaceDown) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    const act = () => {
      if (isFaceDown && !node.classList.contains("flipped")) {
        node.classList.remove("charging");
        node.classList.add("flipped");
        return;
      }
      addToStack(cardId);
    };
    node.addEventListener("click", act);
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      act();
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
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
      `${nameOf(cardId)}, ${rarity}. Click to add to a Stack, right-click for details.`
    );
    bindCardHands(node, cardId, true);
    return node;
  }

  function packSummary(entry) {
    const best = entry.ids.reduce((top, id) => Math.max(top, rankOf(id)), 1);
    const news = entry.fresh.filter(Boolean).length;
    const rareOdds = (BOX.odds && BOX.odds.rare) || 0;
    let line;
    if (best === 3) {
      line = `A rare. That is the ${rareOdds}% — the box is not being kind to you, it is being honest.`;
    } else if (best === 2) {
      line = "An uncommon in the pack.";
    } else {
      line = `${entry.ids.length} commons. The floor of the set — and the backbone of a Stack.`;
    }
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
  async function revealPack(entry) {
    const tray = $("packTray");
    const bay = $("packBay");
    const skip = $("revealAll");
    const note = $("packNote");
    const token = (revealToken += 1);
    skipping = false;

    tray.innerHTML = "";
    tray.hidden = false;
    tray.style.setProperty("--n", String(Math.max(1, entry.ids.length)));
    dealt = entry.ids.map((id, i) => {
      const node = cardNode(id, i, entry.fresh[i]);
      tray.append(node);
      return node;
    });
    arcRow(dealt, 8, -18);

    const summary = packSummary(entry);
    $("packSlot").textContent = `PACK #${pad(entry.n, 3)} · ${slotLabel(entry)}`;

    if (reduced()) {
      /* No stagger, no charge, no skip control to offer: the whole pack is
       * already there and the note is the final one, not a placeholder. */
      for (const node of dealt) node.classList.add("flipped");
      skip.hidden = true;
      note.className = `pack-note${summary.best === 3 ? " is-rare" : ""}`;
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
        if (rank === 3) bay.classList.add("bay--charged");
        await beat(rank === 3 ? 760 : 300);
        if (token !== revealToken) return;
        node.classList.remove("charging");
      }
      node.classList.add("flipped");
      await beat(rank === 3 ? 880 : rank === 2 ? 480 : 280);
    }
    if (token !== revealToken) return;
    bay.classList.remove("bay--charged");
    skip.hidden = true;
    note.className = `pack-note${summary.best === 3 ? " is-rare" : ""}`;
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
    $("revealAll").hidden = true;
    $("packSlot").textContent = "";
    $("packNote").className = "pack-note";
    $("packNote").textContent = "";
  }

  // ------------------------------------------------- into the Stack Builder

  const readDecks = () => {
    try {
      return JSON.parse(localStorage.getItem(DECK_STORE)) || {};
    } catch (error) {
      return {};
    }
  };

  /* Write the draft in the Stack Builder's own format, under one fixed name,
   * so sending twice replaces instead of piling up. */
  function writeDraft(ids) {
    try {
      const all = readDecks();
      all[DRAFT_NAME] = ids;
      localStorage.setItem(DECK_STORE, JSON.stringify(all));
      return ids.length;
    } catch (error) {
      return -1;
    }
  }

  function stackNote(text) {
    const node = $("stackNote");
    if (node) node.textContent = text;
  }

  function addToStack(cardId) {
    const all = readDecks();
    const list = Array.isArray(all[DRAFT_NAME]) ? all[DRAFT_NAME].slice() : [];
    list.push(cardId);
    const n = writeDraft(list);
    stackNote(
      n < 0
        ? "This browser will not let the shop save a Stack (private mode?)."
        : `${nameOf(cardId)} added — "${DRAFT_NAME}" holds ${n} cards. Load it in the Stack Builder.`
    );
  }

  function sendCollection() {
    const ids = [];
    for (const id of Object.keys(state.pulls)) {
      for (let i = 0; i < state.pulls[id]; i += 1) ids.push(id);
    }
    const n = writeDraft(ids);
    stackNote(
      n < 0
        ? "This browser will not let the shop save a Stack (private mode?)."
        : `Sent — "${DRAFT_NAME}" now holds ${n} cards. Open the Stack Builder and press Load.`
    );
  }

  // ---------------------------------------------------------- collection

  function ownedTile(id) {
    const card = BY_ID[id];
    const rarity = rarityOf(id);
    const tile = el("div", `owned rarity-${rarity}`);
    const img = el("img");
    img.alt = nameOf(id);
    img.loading = "lazy";
    if (FACES && card) FACES.setFace(img, card.face);
    else if (card) img.src = `../art/cards/node-runner-web/${encodeURIComponent(card.face)}`;
    tile.append(img);
    if (state.pulls[id] > 1) tile.append(el("span", "owned__n", `×${state.pulls[id]}`));
    tile.title = `${nameOf(id)} — ${rarity} ×${state.pulls[id]}`;
    tile.setAttribute(
      "aria-label",
      `${nameOf(id)}, ${rarity}, ${state.pulls[id]} copies. Click to add to a Stack, right-click for details.`
    );
    bindCardHands(tile, id, false);
    return tile;
  }

  function renderCollection() {
    const box = $("collection");
    const ids = Object.keys(state.pulls).filter((id) => BY_ID[id]);
    const total = ids.reduce((n, id) => n + state.pulls[id], 0);
    $("ownedCount").textContent = total;
    $("uniqueCount").textContent = ids.length;
    $("dupeCount").textContent = Math.max(0, total - ids.length);
    $("collectionTools").hidden = !ids.length;
    box.innerHTML = "";
    if (!ids.length) {
      box.append(el("p", "muted", "Nothing opened yet. The first pack is free."));
      return;
    }
    ids
      .sort((a, b) => rankOf(b) - rankOf(a) || nameOf(a).localeCompare(nameOf(b)))
      .forEach((id) => box.append(ownedTile(id)));
  }

  function renderHistory() {
    const block = $("historyBlock");
    const list = $("historyList");
    list.innerHTML = "";
    block.hidden = !state.history.length;
    if (!state.history.length) return;
    for (const entry of state.history) {
      const when = new Date(entry.at);
      const row = el("li", "hist");
      row.append(el("b", "hist__n", `#${pad(entry.n, 3)}`));
      const time = el("span", "hist__box", `${pad(when.getHours(), 2)}:${pad(when.getMinutes(), 2)}`);
      time.title = when.toLocaleString();
      row.append(time, el("span", "hist__box", slotLabel(entry)));
      const cards = el("span", "hist__cards");
      entry.ids.forEach((id, i) => {
        const chip = el("span", `hist__c rarity-${rarityOf(id)}`, nameOf(id));
        chip.title = `${id} — ${rarityOf(id)}. Click to add to a Stack, right-click for details.`;
        if (entry.fresh[i]) chip.append(el("i", null, "NEW"));
        chip.addEventListener("click", () => addToStack(id));
        chip.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openGallery(id);
        });
        cards.append(chip);
      });
      row.append(cards);
      list.append(row);
    }
  }

  // ------------------------------------------------------------- the proof

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
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
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
    $("boxCommit").textContent = BOX.commitment || "—";
    $("boxSeed").textContent = BOX.seed;
    $("boxSize").textContent = BOX.box.length;
    $("boxTotal").textContent = BOX.box.length;
    $("packSize").textContent = BOX.packSize;
    $("packSizeFact").textContent = BOX.packSize;
    $("packPrice").textContent = PAID_LIVE ? `${SATS} sats` : "free";

    const odds = $("odds");
    odds.innerHTML = "";
    Object.entries(BOX.odds || {})
      .sort((a, b) => (RANK[b[0]] || 1) - (RANK[a[0]] || 1))
      .forEach(([rarity, percent]) => {
        const row = el("div", `odd rarity-${rarity}`);
        row.append(el("b", null, `${percent}%`), el("span", null, rarity));
        odds.append(row);
      });
  }

  function renderModeCopy() {
    const paidState = $("paidState");
    paidState.className = `state ${PAID_LIVE ? "state--live" : "state--off"}`;
    paidState.textContent = PAID_LIVE ? "PAID · LIVE" : "PAID · NOT LIVE YET";

    const modeBox = $("modeNote");
    modeBox.className = `note mode-${PULL_MODE}`;
    modeBox.innerHTML =
      PULL_MODE === "mint"
        ? "<strong>Mint mode.</strong> Packs are paid in sats with your own Lightning wallet; the mint issues each card as a signed event. This page never sees your wallet or your keys."
        : "<strong>Alpha — free demo packs.</strong> The box, the order, the odds and the fingerprint below are the real ones; only the payment is skipped. Your collection lives in this browser. When the mint goes live the same packs cost sats and the cards become yours on Nostr.";

    const paidNote = $("paidNote");
    const stranded = MODE === "mint" && !PAID_LIVE;
    paidNote.hidden = !stranded;
    if (stranded) {
      paidNote.innerHTML =
        "<strong>Paid packs are not live yet.</strong> You asked for mint mode, but no mint is connected to this page — nothing here can request an invoice, and nothing can take a payment. The button below opens a <b>free</b> pack off the same committed box at the same odds. Nothing is owed and no purchase is implied.";
    }

    const button = $("openPack");
    button.textContent = PAID_LIVE ? `Buy a pack · ${SATS} sats` : "Open a free pack";
  }

  function syncControls() {
    const left = Math.max(0, BOX.box.length - state.cursor);
    const empty = PULL_MODE === "demo" && left <= 0;
    $("boxLeft").textContent = left;
    $("boxFill").style.width = `${BOX.box.length ? (left / BOX.box.length) * 100 : 0}%`;
    $("resetBox").hidden = !(PULL_MODE === "demo" && state.cursor > 0);
    const button = $("openPack");
    button.disabled = busy || empty;
    if (empty) {
      /* A disabled button must say why. The note only explains when there is
       * nothing else there — the last pack's own summary outranks it. */
      button.textContent = "The box is empty";
      const note = $("packNote");
      if (!note.textContent) {
        note.className = "pack-note";
        note.textContent =
          "Every card in this box has been pulled — the order is now fully revealed and checkable. Reset to open the next one.";
      }
    } else if (busy) {
      button.textContent = "Opening…";
    } else {
      button.textContent = PAID_LIVE ? `Buy a pack · ${SATS} sats` : "Open a free pack";
    }
  }

  function init() {
    if (!BOX.box.length) return;
    renderBoxFacts();
    renderModeCopy();
    renderCollection();
    renderHistory();
    syncControls();

    $("openPack").addEventListener("click", async () => {
      busy = true;
      syncControls();
      const note = $("packNote");
      note.className = "pack-note";
      note.textContent = "";
      try {
        await revealPack(await pullPack(BOX.packSize));
        renderCollection();
        renderHistory();
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

    $("resetBox").addEventListener("click", () => {
      if (!root.confirm("Reset the demo box and your local collection?")) return;
      state = { cursor: 0, pulls: {}, packs: 0, history: [] };
      save(state);
      clearTray();
      stackNote("");
      renderCollection();
      renderHistory();
      syncControls();
    });

    $("sendStack").addEventListener("click", sendCollection);

    $("verifyBox").addEventListener("click", async () => {
      const button = $("verifyBox");
      const out = $("verifyResult");
      button.disabled = true;
      out.className = "verdict";
      out.textContent = `Hashing all ${BOX.box.length} cards…`;
      try {
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

    $("copyCommit").addEventListener("click", async () => {
      const node = $("boxCommit");
      const out = $("verifyResult");
      if (await copyText(BOX.commitment || "")) {
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
    box: BOX,
    pullPack,
    recomputeCommitment,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
