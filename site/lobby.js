/* ---------------------------------------------------------------------------
 * lobby.js — the online lobby, one module for every page that finds an opponent.
 *
 *   E1Lobby.mount(root, NET, hooks) -> { handlers, refresh(), notice(text, tone), open(), launchCode, invite }
 *
 * Create a table, join one by its code, the quick match and its Stop, the open
 * tables, the invites, the way back to an unfinished match, the rules and the
 * Stack. Lifted from matchmaking.js, which is now a page that mounts this; the
 * action bodies are its own, and they were play.js's before that.
 *
 * TWO PAGES, ONE LOBBY. On the website (matchmaking.html) it holds the socket,
 * signs in with NIP-07 through the side bar, offers stakes, and a dealt seat is
 * a page change to play.html. Inside the Hangar (play.html, E1Napplet.embedded())
 * the page itself is the table: `hooks.onSeat` shows the board in place, there is
 * no sign-in button because the shell's identity is the only one, no stake field
 * because a code handed round a guild's game night grants a seat and nothing
 * else, and no share link because the shell owns the address.
 *
 * hooks:
 *   embedded   override E1Napplet.embedded()
 *   start      false when the page calls NET.start itself (play.html routes the
 *              referee's messages between this lobby and its board)
 *   onSeat(msg, invite)  a STATE that seats this player, or lets them watch a match
 *   onLobby()  an open table to show: the page brings the lobby into view
 *   collection() and stack(ruleset)  the member's cards, and the Stack they make
 *              under those rules ({ ids, fromCollection }); offers "My collection"
 *
 * The markup is built here from constant text, so both pages carry one copy of
 * it. Everything a player or a relay wrote reaches the page as textContent.
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  const TABLE_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
  const STAKE_KEY = "600b:stake";

  /* The Hangar's words: plain English, and never "NIP-07", which is the website's. */
  const WORDS = Object.freeze({
    noIdentity: "Sign in to Nappelin to play online. Hotseat and games against the computer work now.",
    stakes: "This table plays for sats; stakes are not available in Nappelin yet.",
    unreachable: "The table server cannot be reached right now. Hotseat and games against the computer work now.",
    invites: "Invites cannot be listed here right now. You can still join with a table code.",
  });

  const SITE_ERRORS = {
    NO_SUCH_MATCH: "No table with that code.",
    MATCH_FULL: "Both seats at that table are taken.",
    MATCH_OVER: "That match is already finished.",
    DECK_BUILD_FAILED: "The referee could not build a legal deck pair — try again.",
    RATE_LIMITED: "Too many actions too quickly.",
    SUPERSEDED: "Your seat was claimed by another tab or machine.",
    NIP07_REQUIRED: "NIP-07 sign-in is required for every online table.",
    AUTH_FAILED: "The NIP-07 login proof was rejected or expired. Reconnect and sign the fresh challenge.",
    IDENTITY_MISMATCH: "This seat belongs to a different NIP-07 identity.",
    NO_TABLE: "This page is not being served by a table. Open it from the referee (npm run table), or pass ?table=ws://host:8777/ws.",
  };
  const HANGAR_ERRORS = Object.assign({}, SITE_ERRORS, {
    RATE_LIMITED: "Too many requests too quickly. Wait a few seconds, then try again.",
    SUPERSEDED: "Your seat was taken up in another Nappelin window.",
    NIP07_REQUIRED: WORDS.noIdentity,
    AUTH_FAILED: "The table could not confirm your Nappelin sign-in. Try again in a moment.",
    IDENTITY_MISMATCH: "This seat belongs to a different Nappelin account.",
    STAKE_MISMATCH: WORDS.stakes,
    NO_TABLE: WORDS.unreachable,
    TABLE_REFUSED: WORDS.unreachable,
    TABLE_CLOSED: WORDS.unreachable,
    TIMEOUT: WORDS.unreachable,
    INVITES_UNAVAILABLE: WORDS.invites,
    BAD_MESSAGE: "This table server cannot list open tables. Join with a table code instead.",
  });

  const BTN = 'class="btn tcg-btn tcg-btn--primary"';
  const GHOST = 'class="btn ghost tcg-btn"';

  /* The lobby's markup: constant text only, the website's fields where they apply. */
  function markup(embed, mine) {
    const site = (html) => (embed ? "" : html);
    return (embed
      ? '<p>Play another member at the table server. Your Nappelin account signs you in, and nothing is staked.</p>'
        + '<p class="prompt" id="lobbyIdentity" hidden></p>'
      : '<h1 id="lobbyHeading">Play <span>across the table</span></h1>'
        + "<p>One referee runs the rules and deals both seats; every play travels over a socket, and only the"
        + " invite, the accept and the signed result ever touch a relay. NIP-07 sign-in is required for every"
        + " online seat.</p>"
        + `<div class="netid"><button ${GHOST} id="nostrLogin">Sign in with nostr</button>`
        + '<span class="chip tcg-chip" id="nostrWho" hidden></span>'
        + `<button ${GHOST} id="nostrLogout" hidden>Sign out</button>`
        + '<span class="chip tcg-chip" id="netTable"></span></div>')
      + '<div class="resumecard" id="resumeCard" hidden><div class="zlabel">Match in progress</div><div id="resumeList"></div></div>'
      + '<div class="deckmode" id="deckMode"><div class="zlabel">Which Stack do you play?</div>'
      + '<label class="moderow"><input type="radio" name="deckmode" value="ready" id="deckReady" checked> <b>Ready</b> — the referee deals you a Stack of your affinity</label>'
      + '<label class="moderow"><input type="radio" name="deckmode" value="custom" id="deckCustom"> <b>My Stack</b> — play one you built</label>'
      + (mine
        ? '<label class="moderow" id="deckCollectionRow" hidden><input type="radio" name="deckmode" value="collection" id="deckCollection"> <b>My collection</b> — <span id="deckCollectionLabel"></span></label>'
        : "")
      + '<div class="stackpick" id="stackPick" hidden><label for="stackChoice">Your Stacks</label><select id="stackChoice"></select><p class="stacknote" id="stackNote"></p></div></div>'
      + `<div class="findrow" id="findRow"><button ${BTN} id="findMatch">Find an opponent</button>`
      + site('<label class="stakelabel" for="stakeSats">Play for <input id="stakeSats" type="number" min="0" step="1" value="0" inputmode="numeric" autocomplete="off"> sats</label>')
      + `<span class="chip tcg-chip" id="queueChip" hidden></span><button ${GHOST} id="cancelFind" hidden>Stop looking</button></div>`
      + site('<p class="stakenote" id="stakeNote">A wager is matched, not merely announced — you are only ever dealt against someone who'
        + " asked for the same number. Both seats sign it before the first card. Nothing is escrowed:"
        + " at the end the loser pays the winner from their own wallet, and a refused zap cannot"
        + " change a signed result. Leave it at 0 for a friendly.</p>")
      + '<div class="seats seats-gap"><div class="seat">'
      + '<label for="netName">Your name</label><input id="netName" value="Player" autocomplete="off">'
      + '<label for="netAffinity">Stack affinity</label><select id="netAffinity"></select>'
      + '<label for="netRules">Rules — for a table you open or a match you search</label>'
      + '<select id="netRules"><option value="E1.0">Classic</option><option value="F1.0">Fast</option></select></div>'
      + '<div class="seat"><label for="joinCode">Join with a table code</label>'
      + `<div class="joinrow"><input id="joinCode" placeholder="K7M2QF" maxlength="6" autocomplete="off" spellcheck="false"><button ${BTN} id="joinTable">Join</button></div>`
      + (embed
        ? '<label for="challengeNpub">Invite someone by their npub (optional)</label><input id="challengeNpub" placeholder="npub1… — leave it blank for an open invite" autocomplete="off" spellcheck="false">'
        : '<label for="challengeNpub">Challenge an npub (optional)</label><input id="challengeNpub" placeholder="npub1… — blank makes an open invite" autocomplete="off" spellcheck="false">')
      + "</div></div>"
      + `<div class="startrow"><button ${BTN} id="createTable">Create table</button>`
      + `<button ${GHOST} id="refreshTables">Open tables</button><button ${GHOST} id="checkInvites">Check invites</button></div>`
      + '<div class="prompt" id="netNotice" hidden></div>'
      + '<div class="hostpanel" id="hostPanel" hidden><div class="zlabel">Table code — read it aloud</div>'
      + '<div class="tablecode" id="tableCode">------</div><div class="startrow" style="margin-top:10px">'
      + site(`<button ${GHOST} id="copyCode">Copy join link</button>`)
      + `<button ${GHOST} id="publishInvite">${embed ? "Send an invite" : "Publish invite to nostr"}</button>`
      + '<span class="chip tcg-chip">waiting for a second seat</span></div></div>'
      + '<div id="tableList" class="netlist"></div><div id="inviteList" class="netlist"></div>'
      + site('<p class="localnote">Prefer hotseat on one machine, or an NPC to learn against? <a href="play.html">Play locally →</a></p>');
  }

  function mount(root, NET, hooks) {
    const opts = hooks || {};
    const N = globalThis.E1Napplet || null;
    const embed = opts.embedded !== undefined
      ? Boolean(opts.embedded)
      : Boolean(N && typeof N.embedded === "function" && N.embedded());
    const offersCollection = typeof opts.collection === "function" && typeof opts.stack === "function";
    if (root) root.innerHTML = markup(embed, offersCollection);

    /* A slim session: the lobby only reads the seat and role its chip shows. */
    const session = { seat: null, role: "hotseat" };
    const remote = { invite: null, unsubscribe: null };
    const KEYS = globalThis.E1Keys || { DECKS: "600b:decks" };
    const MIN_STACK = (globalThis.E1Keys && globalThis.E1Keys.MIN_STACK) || 40;
    // The shell's key, once it answers: net.js learns it asynchronously too.
    let shellKey = null;

    const $ = (id) => document.getElementById(id);
    const on = (id, type, fn) => {
      const node = $(id);
      if (node) node.addEventListener(type, fn);
    };
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const nostr = () => NET.nostr;
    const myKey = () => {
      let key = null;
      try { key = nostr().savedPubkey(); } catch (error) { key = null; }
      return key || (embed ? shellKey : null);
    };
    /* One line for a refusal, or null when the page has no words for its code. */
    const words = (msg) => {
      const known = (embed ? HANGAR_ERRORS : SITE_ERRORS)[msg.code];
      if (known) return known;
      if (msg.code === "STAKE_MISMATCH") return msg.message || "That table plays for a different stake than the one you were shown.";
      if (msg.code === "BAD_DECK") return msg.message || "That Stack is not legal at this table.";
      return null;
    };

    function netNotice(text, tone) {
      const box = $("netNotice");
      if (!box) return;
      box.hidden = !text;
      box.textContent = text || "";
      box.className = "prompt " + (tone || "");
    }

    /* The side bar's account dot (site/rail.js) is the one green, and it means the
     * referee accepted this player's login: net.js reports "live" only from
     * AUTH_OK, and every way out of it is a status change too. Edges only. */
    let authShown = null;
    function announceAuth(ok) {
      if (authShown === ok) return;
      authShown = ok;
      try {
        window.dispatchEvent(new CustomEvent("e1:auth", { detail: { ok } }));
      } catch (error) {
        void error; // no event target (the test DOM): nobody is listening either
      }
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

    /* The website's share link is for a SECOND player, so it points at this lobby
     * (the current page) where Join lives. Inside the Hangar there is no link:
     * the shell owns the address, and a code is read aloud or sent as an invite. */
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

    // ---- which Stack you play -------------------------------------------

    /* The Stack Builder's library, read through the napplet seam when there is
     * one and localStorage otherwise — never localStorage inside the Hangar. */
    let stackLibrary = {};
    function loadStackLibrary(onReady) {
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

    const checked = (id) => {
      const node = $(id);
      return Boolean(node && node.checked);
    };
    const deckMode = () => (offersCollection && checked("deckCollection") ? "collection" : checked("deckCustom") ? "custom" : "ready");

    /* The member's cards as a Stack under `ruleset`, or null when they hold none. */
    function collectionStack(ruleset) {
      if (!offersCollection) return null;
      try {
        const stack = opts.stack(ruleset);
        return stack && Array.isArray(stack.ids) && stack.ids.length && stack.fromCollection > 0 ? stack : null;
      } catch (error) {
        return null;
      }
    }

    /* The Stack about to be sent, or undefined for "the referee deals". Undefined
     * is the old behaviour exactly, so Ready mode sends nothing new. A collection
     * Stack is built under the rules of the table it is for. */
    function chosenDeck(ruleset) {
      const mode = deckMode();
      if (mode === "collection") {
        const stack = collectionStack(ruleset || lobbyRuleset());
        return stack ? stack.ids.slice() : undefined;
      }
      if (mode !== "custom") return undefined;
      const choice = $("stackChoice");
      const cards = choice ? stackLibrary[choice.value] : null;
      return Array.isArray(cards) && cards.length ? cards : undefined;
    }

    /* "My collection" joins the choice once the member holds a card, counted under
     * the rules chosen; a choice whose cards are gone falls back to Ready. */
    function renderCollectionChoice() {
      if (!offersCollection) return;
      const row = $("deckCollectionRow");
      const stack = collectionStack(lobbyRuleset());
      if (row) row.hidden = !stack;
      const label = $("deckCollectionLabel");
      if (label && stack) label.textContent = `${stack.fromCollection} of ${stack.ids.length} cards yours`;
      if (!stack && checked("deckCollection")) {
        $("deckCollection").checked = false;
        const ready = $("deckReady");
        if (ready) ready.checked = true;
      }
    }

    function renderStackPick() {
      renderCollectionChoice();
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

    // ---- matchmaking ----------------------------------------------------

    const lobbyStake = () => {
      if (embed) return 0;
      const sats = Math.floor(Number($("stakeSats") && $("stakeSats").value));
      return Number.isFinite(sats) && sats > 0 ? sats : 0;
    };
    const satsWord = (sats) => (sats > 0 ? `${sats.toLocaleString("en-US")} sats` : "a friendly");
    const lobbyName = () => (($("netName") && $("netName").value) || "Player").slice(0, 40);
    const lobbyAffinity = () => ($("netAffinity") && $("netAffinity").value) || "All";
    const lobbyRuleset = () => ($("netRules") && $("netRules").value === "F1.0" ? "F1.0" : "E1.0");

    /* The two checks every table action starts with, and the key it plays as. */
    function readyKey() {
      if (!NET.tableUrl()) return void handlers.onError({ code: "NO_TABLE" });
      const pubkey = myKey();
      if (!pubkey) return void handlers.onError({ code: "NIP07_REQUIRED" });
      return pubkey;
    }

    function findMatch() {
      const pubkey = readyKey();
      if (!pubkey) return;
      const stake = lobbyStake();
      if (!embed) try { localStorage.setItem(STAKE_KEY, String(stake)); } catch (error) { /* private mode */ }
      netNotice(embed ? "Looking for an opponent…" : `Looking for an opponent playing for ${satsWord(stake)}…`, "");
      const ruleset = lobbyRuleset();
      NET.queue({ name: lobbyName(), affinity: lobbyAffinity(), ruleset, pubkey, stake, deck: chosenDeck(ruleset) });
      renderQueue();
    }

    function cancelFind() {
      NET.unqueue();
      netNotice("Stopped looking.", "");
      renderQueue();
    }

    /* The queue is the one place a player waits with nothing to do, so it says
     * where they stand and how to stop. */
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

    /* Every unfinished match this key holds a seat at, offered as a way back in.
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

    // ---- lobby actions --------------------------------------------------

    function createTable() {
      const pubkey = readyKey();
      if (!pubkey) return;
      const stake = lobbyStake();
      netNotice(embed ? "Opening a table…" : `Opening a table for ${satsWord(stake)}…`, "");
      const ruleset = lobbyRuleset();
      NET.create({ name: lobbyName(), affinity: lobbyAffinity(), ruleset, pubkey, stake, deck: chosenDeck(ruleset) });
    }

    /* `stake` is what this player was SHOWN, echoed back as an acknowledgement;
     * the referee refuses the join if the table's number has moved since. Inside
     * the Hangar it is always an explicit 0, so a table that plays for sats
     * answers STAKE_MISMATCH instead of binding a guest to its number. */
    function joinTable(code, invite, stake) {
      const pubkey = readyKey();
      if (!pubkey) return;
      const value = String(code || ($("joinCode") && $("joinCode").value) || "").trim().toUpperCase();
      if (!TABLE_CODE.test(value)) return void netNotice("A table code is six characters, no 0/O/1/I.", "bad");
      remote.invite = invite || null;
      netNotice("Joining…", "");
      /* The host's rules are the table's: an invite names them, a bare code does not
       * (the open-table rows carry no ruleset), so the lobby's own choice stands in. */
      const named = invite && (invite.ruleset === "F1.0" || invite.ruleset === "E1.0") ? invite.ruleset : null;
      NET.join({
        code: value,
        name: lobbyName(),
        affinity: lobbyAffinity(),
        pubkey,
        stake: embed ? 0 : stake === undefined ? undefined : stake,
        deck: chosenDeck(named || lobbyRuleset()),
        table: invite ? invite.table : undefined,
      });
    }

    /* Why a list could not be had, in one line. */
    function listWords(error) {
      const text = error && error.code ? words(error) : null;
      if (text) return text;
      return embed ? WORDS.unreachable : "Could not reach the table's /api/tables — is the referee running?";
    }

    async function refreshTables() {
      const list = $("tableList");
      if (!list) return;
      list.innerHTML = "";
      try {
        const rows = await NET.tables();
        if (!rows.length) return void list.append(el("div", "netline", "No open tables."));
        for (const row of rows) {
          const item = el("div", "netrow");
          const bits = [row.code, row.name, row.affinity];
          if (row.stake) bits.push(embed ? "plays for sats" : `${row.stake.toLocaleString("en-US")} sats`);
          if (row.hostOnline === false) bits.push("host away");
          item.append(el("span", null, bits.join(" · ")));
          /* Inside the Hangar a table that plays for sats is listed, not offered. */
          if (!(embed && row.stake)) {
            const button = el("button", "btn ghost", !embed && row.stake ? `Join for ${row.stake} sats` : "Join");
            button.addEventListener("click", () => joinTable(row.code, null, embed ? 0 : row.stake || 0));
            item.append(button);
          }
          list.append(item);
        }
      } catch (error) {
        list.append(el("div", "netline", listWords(error)));
      }
    }

    function checkInvites() {
      const list = $("inviteList");
      if (!list) return;
      list.innerHTML = "";
      const pubkey = myKey();
      if (!pubkey) {
        list.append(el("div", "netline", embed ? WORDS.noIdentity : "Sign in with NIP-07 before checking invitations."));
        return;
      }
      list.append(el("div", "netline", embed ? "Listening for invites…" : "Listening for invites on the relays…"));
      if (remote.unsubscribe) remote.unsubscribe();
      let first = true;
      remote.unsubscribe = nostr().subscribeInvites(pubkey, (invite) => {
        if (first) { list.innerHTML = ""; first = false; }
        const item = el("div", "netrow");
        const stake = embed ? (invite.stake ? " · plays for sats" : "")
          : ` · ${Number.isInteger(invite.stake) ? satsWord(invite.stake) : "stake unknown"}`;
        item.append(el("span", null,
          `${invite.code} · ${invite.host.name || "?"} (${invite.host.affinity || "?"}) · ${nostr().shortNpub(invite.pubkey)}${stake}`));
        if (!(embed && invite.stake)) {
          const button = el("button", "btn ghost", !embed && invite.stake ? `Join for ${invite.stake} sats` : "Join");
          button.addEventListener("click", () => joinTable(invite.code, invite, embed ? 0 : invite.stake));
          item.append(button);
        }
        list.append(item);
      });
    }

    // ---- the signed invite ----------------------------------------------

    /* Inside the Hangar signing IS publishing: the host signs the template its
     * outbox sends (net.js sign), and the referee records the signed event. */
    async function signAndSend(role, unsigned) {
      try {
        const signed = await nostr().sign(unsigned);
        const res = await nostr().publish(signed);
        NET.sendNostr(role, signed); // the referee records it verbatim either way
        if (embed) {
          netNotice(res.ok ? "Invite sent." : "No relay took the invite. The table stays open: read the code aloud instead.", res.ok ? "good" : "");
        } else {
          netNotice(res.ok
            ? `Published to ${res.accepted.length}/${res.tried} relays.`
            : `No relay accepted the ${role}. The match is unaffected — nostr is the announcement, never the gate.`,
          res.ok ? "good" : "");
        }
        return true;
      } catch (error) {
        netNotice(embed
          ? "The invite could not be sent. The table stays open: read the code aloud instead."
          : `Signing was declined — ${role} not published. The match is unaffected.`, "");
        return false;
      }
    }

    function publishInvite() {
      const state = NET.lastState;
      if (!state) return;
      const to = String(($("challengeNpub") && $("challengeNpub").value) || "").trim();
      const recipient = to ? nostr().toHexPubkey(to) : null;
      if (to && !recipient) return void netNotice("Enter a valid npub or 64-character public key.", "bad");
      if (NET.publicTableIsLocal()) {
        netNotice(embed
          ? "This table is only reachable from this machine, so an invite could not be joined from anywhere else."
          : "This table is only reachable at a loopback address — an invite carrying it cannot be joined from another machine. Start the referee with PUBLIC_HOST set to the Tailscale name and open this page through it.", "bad");
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
        stake: state.stake,
        to: recipient,
      }));
    }

    // ---- identity -------------------------------------------------------

    /* The website shows who is signed in and a door to sign in; the Hangar has
     * one identity, the shell's, and says in one line when there is none. */
    function renderIdentity() {
      const pubkey = myKey();
      shownKey = pubkey || null;
      if (embed) {
        const line = $("lobbyIdentity");
        if (line) {
          line.hidden = Boolean(pubkey);
          line.textContent = pubkey ? "" : WORDS.noIdentity;
        }
      } else {
        $("nostrLogin").hidden = Boolean(pubkey);
        $("nostrWho").hidden = !pubkey;
        $("nostrLogout").hidden = !pubkey || barAccount();
        if (pubkey) $("nostrWho").textContent = nostr().shortNpub(pubkey);
      }
      renderLobbyButtons();
    }

    /* A host waiting at their own open table must not be able to join it: typing
     * your own code into the join box used to seat one connection at BOTH seats.
     * The referee refuses it now; the button simply stops offering. */
    function renderLobbyButtons() {
      const url = NET.tableUrl();
      const identified = Boolean(myKey());
      const table = $("netTable");
      if (table) table.textContent = url ? `table ${url}` : "no table server — hotseat only";
      const state = NET.lastState;
      const hosting = Boolean(state && state.status === "open" && state.seat === 0);
      const mode = deckMode();
      const needsStack = mode !== "ready" && !chosenDeck();
      const set = (id, off) => {
        const node = $(id);
        if (node) node.disabled = off;
      };
      set("createTable", !url || !identified || hosting || needsStack);
      set("joinTable", !url || !identified || hosting || needsStack);
      set("refreshTables", !url || !identified);
      set("checkInvites", !url || !identified);
      set("findMatch", !url || !identified || hosting || needsStack);
    }

    async function login() {
      try {
        await nostr().login();
        signedIn();
      } catch (error) {
        netNotice(String(error.message || error), "bad");
      }
    }

    function signedIn() {
      renderIdentity();
      netNotice("Signed in with NIP-07. Online tables are now available.", "good");
      if (NET.session) NET.resume();
    }

    /* ONE DOOR FOR SIGNING IN on the website. Where the side bar is drawn
     * (site/rail.js), its Account panel signs in and out: this button only opens
     * it, and the bar's e1:identity brings the answer back. Without a bar the
     * button signs in by itself. Inside the Hangar there is no button at all. */
    const barAccount = () => Boolean(globalThis.E1Rail && globalThis.E1Rail.slot("account"));
    let shownKey = null;

    function signIn() {
      if (barAccount() && globalThis.E1Rail.open("account")) return undefined;
      return login();
    }

    /* The bar's word on who is signed in. Its load-time event names the key this
     * page already drew, which changes nothing; a new key is a sign-in, null a
     * sign-out. */
    function onBarIdentity(event) {
      const pubkey = (event && event.detail && event.detail.pubkey) || null;
      if (pubkey === shownKey) return;
      if (!pubkey) {
        renderIdentity();
        announceAuth(false);
        return;
      }
      signedIn();
    }

    // ---- the referee's messages -----------------------------------------

    const handlers = {
      /* A STATE means one of three things here: a table we opened is still
       * waiting (stay, show the code), a seat at an open table is offered (stay,
       * show Join), or we are seated or watching a match (the page takes over). */
      onState(msg) {
        session.seat = msg.seat === 0 || msg.seat === 1 ? msg.seat : null;
        session.role = msg.role === "spectator" ? "spectator" : (session.seat === null ? "hotseat" : "seat");

        if (msg.status === "open") {
          const waiting = !msg.downgraded;
          if ($("hostPanel")) $("hostPanel").hidden = !waiting;
          if (waiting) {
            if ($("tableCode")) $("tableCode").textContent = msg.code || "------";
            netNotice(embed
              ? "Table open. Read the code aloud, or send an invite."
              : `Table open. Read the code aloud, publish the invite, or send this link: ${matchLink(msg)}`, "good");
          } else {
            if (msg.code && $("joinCode")) $("joinCode").value = msg.code;
            netNotice(
              msg.claimable
                ? "This table is waiting for a second player — press Join to take seat 1."
                : "This table is full. You are watching.",
              msg.claimable ? "good" : ""
            );
          }
          renderNetChip();
          renderLobbyButtons();
          renderResume();
          if (typeof opts.onLobby === "function") opts.onLobby(msg);
          return;
        }
        // Seated: playing, or a finished match we rejoined to see its ending.
        if ($("hostPanel")) $("hostPanel").hidden = true;
        if (typeof opts.onSeat === "function") opts.onSeat(msg, remote.invite);
      },

      onReject(msg) {
        netNotice(msg.message || msg.code, "bad");
      },

      onPeer() {
        renderNetChip();
      },

      onStatus(info) {
        renderNetChip();
        renderQueue();
        renderLobbyButtons();
        announceAuth(Boolean(info && info.status === "live"));
      },

      onQueued() {
        renderQueue();
      },

      /* The referee has just told us which matches this identity is sitting at. */
      onActive() {
        renderResume();
      },

      onFrame() { /* frames belong to the table */ },
      onOver() { /* the ending belongs to the table */ },
      onNostr() { /* result agreement is shown at the table */ },

      onError(msg) {
        if (msg.code === "INVITES_UNAVAILABLE") {
          const list = $("inviteList");
          if (list) {
            list.innerHTML = "";
            list.append(el("div", "netline", embed ? WORDS.invites : msg.message || msg.code));
          }
          return;
        }
        netNotice(words(msg) || msg.message || msg.code, "bad");
        renderNetChip();
      },
    };

    // ---- boot -----------------------------------------------------------

    const affinities = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock"];
    const select = $("netAffinity");
    if (select) {
      for (const name of affinities) {
        const option = el("option", null, name === "All" ? "All affinities" : name);
        option.value = name;
        select.append(option);
      }
      // Keys builds a legal deck on roughly a third of seeds (D-12); the referee
      // re-rolls, but a rehearsed demo should not lean on it.
      select.value = "Power";
    }

    if (!embed) {
      try {
        const saved = Number(localStorage.getItem(STAKE_KEY));
        if (Number.isFinite(saved) && saved > 0 && $("stakeSats")) $("stakeSats").value = String(Math.floor(saved));
      } catch (error) { /* private mode */ }
    }

    for (const id of ["deckReady", "deckCustom", "deckCollection", "stackChoice", "netRules"]) on(id, "change", renderStackPick);
    renderStackPick();
    loadStackLibrary(renderStackPick);

    if (!embed) {
      on("nostrLogin", "click", signIn);
      on("nostrLogout", "click", () => { nostr().logout(); renderIdentity(); announceAuth(false); });
      window.addEventListener("e1:identity", onBarIdentity);
      on("copyCode", "click", () => {
        const state = NET.lastState;
        if (state) navigator.clipboard.writeText(matchLink(state)).then(
          () => netNotice("Link copied.", "good"),
          () => netNotice(matchLink(state), "")
        );
      });
    }
    on("findMatch", "click", findMatch);
    on("cancelFind", "click", cancelFind);
    on("createTable", "click", createTable);
    on("joinTable", "click", () => joinTable());
    on("refreshTables", "click", refreshTables);
    on("checkInvites", "click", checkInvites);
    on("publishInvite", "click", publishInvite);

    /* A TABLE CODE THIS PAGE WAS OPENED WITH, read once (E1Net.launchCode: the
     * Hangar's launch argument, or the website's ?code=) and put in the join box.
     * It is never joined by itself, and never written into any address. */
    const launchCode = typeof NET.launchCode === "function" ? NET.launchCode() : null;
    if (launchCode && $("joinCode")) $("joinCode").value = launchCode;

    renderIdentity();
    /* The shell's identity answers after the first paint: draw it again then. */
    if (embed && N && N.identity && typeof N.identity.current === "function") {
      Promise.resolve()
        .then(() => N.identity.current())
        .then((key) => { shellKey = key || null; }, () => { shellKey = null; })
        .then(renderIdentity);
    }

    /* If this page already holds a match — a seat left mid-game, then reopened —
     * NET.start RESUMEs and the STATE that follows hands the page the board. A
     * cold lobby opens no socket until an action asks for one. */
    const told = (started) => {
      if (!started) return;
      if (started.resuming) netNotice("Rejoining your table…", "");
      else if (started.loginRequired) netNotice(embed ? WORDS.noIdentity : "Sign in with NIP-07 to reopen your table.", "bad");
    };
    if (opts.start !== false) {
      const started = NET.start(handlers);
      told(started);
      if (started && started.restoring && typeof started.restoring.then === "function") started.restoring.then(told, () => {});
    }

    let opened = false;
    return {
      handlers,
      launchCode,
      get invite() { return remote.invite; },
      notice: netNotice,
      told,
      refresh() {
        renderIdentity();
        renderStackPick();
      },
      /* The page brought the lobby into view. The first time, a member who is
       * signed in sees the open tables at once: asking is what tells them whether
       * the table server can be reached. */
      open() {
        renderIdentity();
        if (opened || !myKey()) return;
        opened = true;
        refreshTables();
      },
    };
  }

  globalThis.E1Lobby = { mount, WORDS };
})();
