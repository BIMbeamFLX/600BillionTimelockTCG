/* ---------------------------------------------------------------------------
 * matchmaking.js — the online lobby, its own napplet.
 *
 * This is the half of play.js that finds you an opponent: NIP-07 sign-in, the
 * queue, create/join by code, challenge-by-npub, the invite lists and the
 * resume list. It holds the socket and the seat here, on its own page, so the
 * table (play.html) can be a lighter thing that only ever renders a match it is
 * already in.
 *
 * THE ONE DIVERGENCE FROM play.js. When the referee seats you it sends a STATE.
 * net.js has already written the session to sessionStorage `600b:match` BEFORE
 * this file's handler runs (net.js saveMatch, on every STATE with a seat), and
 * sessionStorage survives a same-tab navigation — so instead of flipping a
 * hidden `#table` into view the way play.js does, this handler navigates to
 * play.html. That page boots, net.js reads the saved session, RESUMEs by the
 * signed identity (no token to marshal — the AUTH-proven npub is the claim),
 * and the referee re-sends the full STATE. A found match is a page change, and
 * the seat is never lost because the referee, not the browser, remembers it.
 *
 * Faithful copy, not a rewrite: the lobby is stress-tested, so every action
 * body below is play.js's, verbatim, minus the table-only calls (render,
 * announceStart, the endgame). The shared helpers it leaned on ($, el, nostr,
 * netNotice, satsWord, matchLink, the slim session/remote) are carried here
 * because play.js's copies are lexical siblings that do not cross a file.
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  const NET = globalThis.E1Net;

  /* A slim session/remote: the lobby only ever needs the few fields its actions
   * and the net chip read. `seat` stays null until the referee seats us, and a
   * seat is the moment we navigate away — so on this page it is null in
   * practice, and the chip stays hidden, exactly as in hotseat. */
  const session = { seat: null, role: "hotseat", full: null };
  const remote = { invite: null, unsubscribe: null };

  const KEYS = globalThis.E1Keys || { DECKS: "600b:decks" };
  const STAKE_KEY = "600b:stake"; // the wager last chosen, so it is not retyped every match

  // ------------------------------------------------------------ DOM helpers
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const nostr = () => NET.nostr;

  function netNotice(text, tone) {
    const box = $("netNotice");
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || "";
    box.className = "prompt " + (tone || "");
  }

  function renderNetChip() {
    const chip = $("netchip");
    if (!chip) return;
    if (session.seat === null && session.role === "hotseat") {
      chip.hidden = true;
      return;
    }
    const label = {
      idle: "offline", connecting: "connecting…", live: "live",
      reconnecting: "reconnecting…", superseded: "seat taken elsewhere", gone: "table gone",
    }[NET.status] || NET.status;
    const who = session.role === "spectator" ? "spectating" : `seat ${session.seat}`;
    chip.hidden = false;
    chip.textContent = `${who} · ${label}`;
    chip.className = "turnchip netchip" + (NET.status === "live" ? "" : " stale");
  }

  /* play.js writes an in-match rail here; the lobby has none, so this is where
   * that call quietly ends. renderIdentity still calls it, unchanged. */
  function renderNetPanel() { /* no table rail on the lobby page */ }

  /* The share link is for a SECOND player, so it points at this lobby (the
   * current page) where Join lives — net.js reads ?match=/?code= on load,
   * the referee offers the open seat, and onState's downgraded branch shows
   * the Join prompt. Copied from matchmaking.html, location.href already is
   * matchmaking.html. */
  const matchLink = (msg) => {
    try {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("match", msg.matchId);
      if (msg.code) url.searchParams.set("code", msg.code);
      return url.toString();
    } catch (error) {
      return msg.matchId;
    }
  };

  // ---- the hand-off -------------------------------------------------------

  /* The seat is dealt: leave the lobby for the table. net.js already saved the
   * session; the ?match=/?code= are a belt-and-braces fallback the table reads
   * only if the store was somehow lost. Shell-aware: assign, then href, then a
   * link the player can press — a host that refuses a location rewrite must not
   * read as a hang. */
  let handingOff = false;
  function handOff(msg) {
    if (handingOff) return;
    handingOff = true;
    const q = msg && msg.matchId
      ? "?match=" + encodeURIComponent(msg.matchId) + (msg.code ? "&code=" + encodeURIComponent(msg.code) : "")
      : "";
    const url = "play.html" + q;
    netNotice("Your seat is ready — opening the table…", "good");
    try { location.assign(url); return; } catch (error) { /* fall through */ }
    try { location.href = url; return; } catch (error) { /* fall through */ }
    handingOff = false;
    netNotice(`Your seat is ready. Open the table: ${url}`, "good");
  }

  // ---- which Stack you play ----------------------------------------------

  /* The Stack Builder's library, read through the napplet seam when there is
   * one and localStorage otherwise — the same two doors deck.html writes it
   * through. Shape is { name: ["E1-001", …] }. */
  let stackLibrary = {};
  const MIN_STACK = (globalThis.E1Keys && globalThis.E1Keys.MIN_STACK) || 40;

  function loadStackLibrary(onReady) {
    const N = globalThis.E1Napplet;
    const done = (value) => {
      stackLibrary = value && typeof value === "object" ? value : {};
      if (typeof onReady === "function") onReady();
    };
    if (N && N.storage) {
      N.storage.json(KEYS.DECKS, {}).then(done, () => done({}));
      return;
    }
    try { done(JSON.parse(localStorage.getItem(KEYS.DECKS))); } catch (error) { done({}); }
  }

  const deckMode = () => {
    const picked = document.querySelector('input[name="deckmode"]:checked');
    return picked ? picked.value : "ready";
  };

  /* The Stack about to be sent, or undefined for "the referee deals". Undefined
   * is the old behaviour exactly, so Ready mode sends nothing new. */
  function chosenDeck() {
    if (deckMode() !== "custom") return undefined;
    const name = $("stackChoice").value;
    const cards = stackLibrary[name];
    return Array.isArray(cards) && cards.length ? cards : undefined;
  }

  function renderStackPick() {
    const custom = deckMode() === "custom";
    const pick = $("stackPick");
    const note = $("stackNote");
    const choice = $("stackChoice");
    if (!pick || !note || !choice) return;
    pick.hidden = !custom;
    if (!custom) { renderLobbyButtons(); return; }

    const names = Object.keys(stackLibrary);
    if (choice.length !== names.length) {
      choice.innerHTML = "";
      for (const name of names) {
        const option = el("option", null, `${name} · ${stackLibrary[name].length} cards`);
        option.value = name;
        choice.append(option);
      }
    }
    if (!names.length) {
      note.textContent = "No saved Stacks yet — build one in the Stack Builder, then it appears here.";
      note.className = "stacknote bad";
    } else {
      const cards = stackLibrary[choice.value] || [];
      const short = cards.length < MIN_STACK;
      note.textContent = short
        ? `That Stack holds ${cards.length} cards; a legal Stack is at least ${MIN_STACK} (§7). The table would refuse it.`
        : `${cards.length} cards. The referee checks it against §7 before dealing.`;
      note.className = "stacknote" + (short ? " bad" : "");
    }
    renderLobbyButtons();
  }

  // ---- matchmaking --------------------------------------------------------

  const lobbyStake = () => {
    const sats = Math.floor(Number($("stakeSats") && $("stakeSats").value));
    return Number.isFinite(sats) && sats > 0 ? sats : 0;
  };
  const satsWord = (sats) => (sats > 0 ? `${sats.toLocaleString("en-US")} sats` : "a friendly");
  const lobbyName = () => ($("netName").value || "Player").slice(0, 40);
  const lobbyAffinity = () => $("netAffinity").value;

  function findMatch() {
    if (!NET.tableUrl()) return void NET_HANDLERS.onError({ code: "NO_TABLE" });
    const pubkey = nostr().savedPubkey();
    if (!pubkey) return void NET_HANDLERS.onError({ code: "NIP07_REQUIRED" });
    const stake = lobbyStake();
    try { localStorage.setItem(STAKE_KEY, String(stake)); } catch (error) { /* private mode */ }
    netNotice(`Looking for an opponent playing for ${satsWord(stake)}…`, "");
    NET.queue({ name: lobbyName(), affinity: lobbyAffinity(), pubkey, stake, deck: chosenDeck() });
    renderQueue();
  }

  function cancelFind() {
    NET.unqueue();
    netNotice("Stopped looking.", "");
    renderQueue();
  }

  /* The queue is the one place a player waits with nothing to do, so it says
   * where they stand and how to stop. A line you cannot see move is
   * indistinguishable from one that is broken. */
  function renderQueue() {
    const chip = $("queueChip");
    const cancel = $("cancelFind");
    const find = $("findMatch");
    if (!chip || !cancel || !find) return;
    const queued = NET.queued;
    chip.hidden = !queued;
    cancel.hidden = !queued;
    find.hidden = Boolean(queued);
    if (!queued) return;
    chip.textContent = queued.waiting > 1
      ? `searching · ${queued.position} of ${queued.waiting} waiting`
      : "searching · you are first in line";
  }

  /* Every unfinished match this npub holds a seat at, offered as a way back in.
   * The list comes from the referee and survives anything a browser can lose. */
  function renderResume() {
    const card = $("resumeCard");
    const list = $("resumeList");
    if (!card || !list) return;
    const active = (NET.active || []).filter((m) => !NET.session || m.matchId !== NET.session.matchId);
    card.hidden = active.length === 0;
    list.innerHTML = "";
    for (const match of active) {
      const row = el("div", "resumerow");
      const who = el("span", "resumewho");
      const foe = match.opponent ? `vs ${match.opponent}` : "waiting for an opponent";
      who.append(el("b", null, `seat ${match.seat}`), document.createTextNode(` · ${foe}`));
      if (match.status === "playing") {
        who.append(document.createTextNode(match.opponentOnline ? " · they are here" : " · they are away"));
      }
      row.append(who);
      const back = el("button", "btn", "Rejoin");
      back.addEventListener("click", () => {
        netNotice("Taking your seat…", "");
        NET.rejoin(match.matchId);
      });
      row.append(back);
      list.append(row);
    }
  }

  // ---- lobby actions ------------------------------------------------------

  function createTable() {
    if (!NET.tableUrl()) return void NET_HANDLERS.onError({ code: "NO_TABLE" });
    const pubkey = nostr().savedPubkey();
    if (!pubkey) return void NET_HANDLERS.onError({ code: "NIP07_REQUIRED" });
    const stake = lobbyStake();
    netNotice(`Opening a table for ${satsWord(stake)}…`, "");
    NET.create({ name: lobbyName(), affinity: lobbyAffinity(), pubkey, stake, deck: chosenDeck() });
  }

  /* `stake` is what this player was SHOWN, echoed back as an acknowledgement.
   * The referee refuses the join if the table's number has moved since, so a
   * shared link can never seat someone in a wager they never saw. */
  function joinTable(code, invite, stake) {
    if (!NET.tableUrl()) return void NET_HANDLERS.onError({ code: "NO_TABLE" });
    const pubkey = nostr().savedPubkey();
    if (!pubkey) return void NET_HANDLERS.onError({ code: "NIP07_REQUIRED" });
    const value = String(code || $("joinCode").value || "").trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(value)) return void netNotice("A table code is six characters, no 0/O/1/I.", "bad");
    remote.invite = invite || null;
    netNotice("Joining…", "");
    NET.join({
      code: value,
      name: lobbyName(),
      affinity: lobbyAffinity(),
      pubkey,
      stake: stake === undefined ? undefined : stake,
      deck: chosenDeck(),
      table: invite ? invite.table : undefined,
    });
  }

  async function refreshTables() {
    const list = $("tableList");
    list.innerHTML = "";
    try {
      const rows = await NET.tables();
      if (!rows.length) return void list.append(el("div", "netline", "No open tables."));
      for (const row of rows) {
        const item = el("div", "netrow");
        const bits = [row.code, row.name, row.affinity];
        if (row.stake) bits.push(`${row.stake.toLocaleString("en-US")} sats`);
        if (row.hostOnline === false) bits.push("host away");
        item.append(el("span", null, bits.join(" · ")));
        const button = el("button", "btn ghost", row.stake ? `Join for ${row.stake} sats` : "Join");
        button.addEventListener("click", () => joinTable(row.code, null, row.stake || 0));
        item.append(button);
        list.append(item);
      }
    } catch (error) {
      list.append(el("div", "netline", "Could not reach the table's /api/tables — is the referee running?"));
    }
  }

  function checkInvites() {
    const list = $("inviteList");
    list.innerHTML = "";
    if (!nostr().savedPubkey()) {
      list.append(el("div", "netline", "Sign in with NIP-07 before checking invitations."));
      return;
    }
    list.append(el("div", "netline", "Listening for invites on the relays…"));
    if (remote.unsubscribe) remote.unsubscribe();
    let first = true;
    remote.unsubscribe = nostr().subscribeInvites(nostr().savedPubkey(), (invite) => {
      if (first) { list.innerHTML = ""; first = false; }
      const item = el("div", "netrow");
      item.append(el("span", null,
        `${invite.code} · ${invite.host.name || "?"} (${invite.host.affinity || "?"}) · ${nostr().shortNpub(invite.pubkey)}`));
      const button = el("button", "btn ghost", "Join");
      button.addEventListener("click", () => joinTable(invite.code, invite));
      item.append(button);
      list.append(item);
    });
  }

  // ---- the signed invite --------------------------------------------------

  async function signAndSend(role, unsigned) {
    try {
      const signed = await nostr().sign(unsigned);
      const res = await nostr().publish(signed);
      NET.sendNostr(role, signed); // the referee records it verbatim either way
      netNotice(res.ok
        ? `Published to ${res.accepted.length}/${res.tried} relays.`
        : `No relay accepted the ${role}. The match is unaffected — nostr is the announcement, never the gate.`,
        res.ok ? "good" : "");
      return true;
    } catch (error) {
      netNotice(`Signing was declined — ${role} not published. The match is unaffected.`, "");
      return false;
    }
  }

  function publishInvite() {
    const state = NET.lastState;
    if (!state) return;
    const to = String($("challengeNpub").value || "").trim();
    if (NET.publicTableIsLocal()) {
      netNotice("This table is only reachable at a loopback address — an invite carrying it cannot be joined from another machine. Start the referee with PUBLIC_HOST set to the Tailscale name and open this page through it.", "bad");
      return;
    }
    signAndSend("invite", nostr().inviteEvent({
      matchId: state.matchId,
      code: state.code,
      table: NET.publicTable(),
      name: lobbyName(),
      affinity: lobbyAffinity(),
      ruleset: state.ruleset,
      catalogDigest: state.catalogDigest,
      to: to ? nostr().toHexPubkey(to) : null,
    }));
  }

  // ---- identity -----------------------------------------------------------

  function renderIdentity() {
    const pubkey = nostr().savedPubkey();
    $("nostrLogin").hidden = Boolean(pubkey);
    $("nostrWho").hidden = !pubkey;
    $("nostrLogout").hidden = !pubkey;
    if (pubkey) $("nostrWho").textContent = nostr().shortNpub(pubkey);
    renderLobbyButtons();
    renderNetPanel();
  }

  /* A host waiting at their own open table must not be able to join it: typing
   * your own code into the join box used to seat one connection at BOTH seats.
   * The referee refuses it now; the button simply stops offering. */
  function renderLobbyButtons() {
    const url = NET.tableUrl();
    const identified = Boolean(nostr().savedPubkey());
    $("netTable").textContent = url ? `table ${url}` : "no table server — hotseat only";
    const state = NET.lastState;
    const hosting = Boolean(state && state.status === "open" && state.seat === 0);
    $("createTable").disabled = !url || !identified || hosting;
    $("joinTable").disabled = !url || !identified || hosting;
    $("refreshTables").disabled = !url || !identified;
    $("checkInvites").disabled = !url || !identified;
    const needsStack = deckMode() === "custom" && !chosenDeck();
    $("createTable").disabled = $("createTable").disabled || needsStack;
    $("joinTable").disabled = $("joinTable").disabled || needsStack;
    $("findMatch").disabled = !url || !identified || hosting || needsStack;
  }

  async function login() {
    try {
      await nostr().login();
      renderIdentity();
      netNotice("Signed in with NIP-07. Online tables are now available.", "good");
      if (NET.session) NET.resume();
    } catch (error) {
      netNotice(String(error.message || error), "bad");
    }
  }

  // ---- the referee's messages ---------------------------------------------

  const NET_HANDLERS = {
    /* A STATE means one of three things on this page: a table we opened is still
     * waiting (stay, show the code), a share-link seat is offered (stay, show
     * Join), or we are seated and playing (leave for the table). */
    onState(msg) {
      session.seat = msg.seat === 0 || msg.seat === 1 ? msg.seat : null;
      session.role = msg.role === "spectator" ? "spectator" : (session.seat === null ? "hotseat" : "seat");
      if (msg.view) session.full = msg.view;

      if (msg.status === "open" && msg.downgraded) {
        $("hostPanel").hidden = true;
        if (msg.code) $("joinCode").value = msg.code;
        netNotice(
          msg.claimable
            ? "This table is waiting for a second player — press Join to take seat 1."
            : "This table is full. You are watching.",
          msg.claimable ? "good" : ""
        );
        renderNetChip();
        renderLobbyButtons();
        renderResume();
        return;
      }
      if (msg.status === "open") {
        $("hostPanel").hidden = false;
        $("tableCode").textContent = msg.code || "------";
        netNotice(`Table open. Read the code aloud, publish the invite, or send this link: ${matchLink(msg)}`, "good");
        renderNetChip();
        renderLobbyButtons();
        renderResume();
        return;
      }
      // Seated: playing, or a finished match we rejoined to see its ending.
      handOff(msg);
    },

    onReject(msg) {
      netNotice(msg.message || msg.code, "bad");
    },

    onPeer() {
      renderNetChip();
    },

    onStatus() {
      renderNetChip();
      renderQueue();
      renderLobbyButtons();
    },

    onQueued() {
      renderQueue();
    },

    /* The referee has just told us which matches this identity is sitting at. */
    onActive() {
      renderResume();
    },

    onFrame() { /* frames belong to the table; we have already navigated */ },
    onOver() { /* the ending belongs to the table */ },
    onNostr() { /* result agreement is shown at the table */ },

    onError(msg) {
      const text = {
        NO_SUCH_MATCH: "No table with that code.",
        MATCH_FULL: "Both seats at that table are taken.",
        MATCH_OVER: "That match is already finished.",
        DECK_BUILD_FAILED: "The referee could not build a legal deck pair — try again.",
        RATE_LIMITED: "Too many actions too quickly.",
        SUPERSEDED: "Your seat was claimed by another tab or machine.",
        NIP07_REQUIRED: "NIP-07 sign-in is required for every online table.",
        AUTH_FAILED: "The NIP-07 login proof was rejected or expired. Reconnect and sign the fresh challenge.",
        IDENTITY_MISMATCH: "This seat belongs to a different NIP-07 identity.",
        STAKE_MISMATCH: msg.message || "That table plays for a different stake than the one you were shown.",
        BAD_DECK: msg.message || "That Stack is not legal at this table.",
        NO_TABLE: "This page is not being served by a table. Open it from the referee (npm run table), or pass ?table=ws://host:8777/ws.",
      }[msg.code] || msg.message || msg.code;
      netNotice(text, "bad");
      renderNetChip();
    },
  };

  // ---- boot ---------------------------------------------------------------

  function initNet() {
    const affinities = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock"];
    const select = $("netAffinity");
    for (const name of affinities) {
      const option = el("option", null, name === "All" ? "All affinities" : name);
      option.value = name;
      select.append(option);
    }
    // Keys builds a legal deck on roughly a third of seeds (D-12); the referee
    // re-rolls, but a rehearsed demo should not lean on it.
    select.value = "Power";

    try {
      const saved = Number(localStorage.getItem(STAKE_KEY));
      if (Number.isFinite(saved) && saved > 0) $("stakeSats").value = String(Math.floor(saved));
    } catch (error) { /* private mode */ }

    for (const radio of document.querySelectorAll('input[name="deckmode"]')) {
      radio.addEventListener("change", renderStackPick);
    }
    $("stackChoice").addEventListener("change", renderStackPick);
    loadStackLibrary(renderStackPick);

    $("nostrLogin").addEventListener("click", login);
    $("nostrLogout").addEventListener("click", () => { nostr().logout(); renderIdentity(); });
    $("findMatch").addEventListener("click", findMatch);
    $("cancelFind").addEventListener("click", cancelFind);
    $("createTable").addEventListener("click", createTable);
    $("joinTable").addEventListener("click", () => joinTable());
    $("refreshTables").addEventListener("click", refreshTables);
    $("checkInvites").addEventListener("click", checkInvites);
    $("publishInvite").addEventListener("click", publishInvite);
    $("copyCode").addEventListener("click", () => {
      const state = NET.lastState;
      if (state) navigator.clipboard.writeText(matchLink(state)).then(
        () => netNotice("Link copied.", "good"),
        () => netNotice(matchLink(state), "")
      );
    });

    renderIdentity();
    /* If this page already holds a match — a seat left mid-game, then reopened —
     * NET.start RESUMEs and the STATE that follows hands us straight to the
     * table. A cold lobby opens no socket until an action asks for one. */
    const started = NET.start(NET_HANDLERS);
    if (started.resuming) netNotice("Rejoining your table…", "");
    else if (started.loginRequired) netNotice("Sign in with NIP-07 to reopen your table.", "bad");
  }

  function boot() {
    if (!NET) {
      netNotice("The transport did not load — reload the page.", "bad");
      return;
    }
    initNet();
  }

  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
