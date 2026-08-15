/* 600B Timelock TCG — local hotseat table.
 *
 * This file holds NO rules. It is a view and a controller: it owns the DOM, the
 * wording of the log, and the local click-gathering that turns a sequence of
 * clicks into one validated action. Every state change goes through
 * E1Engine.apply(), which is the same reducer a server or a peer would run.
 *
 * The table renders view(full, uiSeat(full)) rather than the full state, so the
 * fog-of-war path is exercised on every frame of the local game every day and
 * cannot rot. One implementation, continuously verified, instead of a redaction
 * path that only runs in production. */
(() => {
  "use strict";

  const E = globalThis.E1Engine;
  const CARDS = globalThis.E1_CARDS || [];
  const SYMBOLS = ["P", "B", "K", "S", "T"];
  // The locked Plate icon per symbol — shown in the buffer pips so a resource
  // reads by shape, not just by colour.
  const SYMBOL_ICON = { P: "power", B: "bitcoin", K: "keys", S: "signal", T: "timelock" };
  const SYMBOL_NAME = { P: "Power", B: "Bitcoin", K: "Keys", S: "Signal", T: "Timelock", N: "neutral" };
  const CARD_BY_ID = Object.create(null);
  const COMPILED = Object.create(null);
  for (const card of CARDS) CARD_BY_ID[card.id] = card;
  const compiled = (cardId) => {
    if (!COMPILED[cardId]) COMPILED[cardId] = E.compileCard(CARD_BY_ID[cardId]);
    return COMPILED[cardId];
  };

  /* Host-side session. `full` is the unredacted state — in a multiplayer build
   * this object lives on the server (or with the dealer) and each client holds
   * only its view. The log is accumulated by the host, not stored in state. */
  const session = {
    full: null,
    log: [],       // the chained transcript
    events: [],    // rendered as the table log
    notice: null,  // last rejection, shown in #prompt
    /* Remote play. `seat` is null in hotseat and 0|1 when a referee has seated
     * us — every remote branch in this file keys off exactly that, which is why
     * the local game is preserved by construction rather than by care.
     * `awaitingSeq` is set when an action goes out and cleared by the FRAME or
     * REJECT that answers it, so a double-click cannot produce two actions. */
    seat: null,
    role: "hotseat",     // hotseat | seat | spectator
    awaitingSeq: null,
    /* Solo mode: the seat the NPC policy drives (site/npc.js), or null. Only
     * ever set for the hotseat game — a networked table never hosts a bot. */
    npc: null,
    npcAffinity: "Bitcoin",
    config: null,        // the hotseat createGame config, kept so verify() can replay
  };

  /* Local click-gathering. None of this is game state: it is the half-formed
   * intent between the first click and the one action that gets dispatched. */
  let picking = null; // { kind:"play"|"ability", uid, abilityIndex, spec, targets }
  let attackers = [];
  let meshGroupActive = false;
  let blocks = {};
  let choiceSelection = [];
  let choiceSelectionId = null;
  let awaitingSelection = [];
  let awaitingSelectionKey = null;

  /* Which seat the hotseat table is currently speaking to. Priority rather than
   * turn.active, because the defender acts during the blockers step — and for a
   * pending proposal it is the OPPONENT of the proposer, since they are the one
   * whose verdict the game is waiting on. */
  /* Remote play makes this a lock rather than a preference: E.view(v, otherSeat)
   * throws REDACTED_STATE, so a state the referee redacted for seat N can only
   * ever be rendered as seat N. A spectator holds a view for nobody and is shown
   * seat 0's side of the table. */
  const uiSeat = (s) =>
    s && s.redacted
      ? (s.forSeat === null ? 0 : s.forSeat)
      : session.npc !== null
        ? 1 - session.npc // solo: the table always shows the human's side
        : (s.pendingChoice && s.pendingChoice.seat) ??
          (s.pendingManual ? 1 - s.pendingManual.seat : null) ??
          (s.awaiting && s.awaiting.seat) ??
          s.priority.seat ??
          s.turn.active;

  /* Hotseat holds the unredacted state and renders the redaction of it, so the
   * fog-of-war path runs every frame of the local game. A remote seat was SENT
   * exactly that view by the referee and renders it as-is: view() is idempotent
   * for the same seat, so this is one code path, not two. */
  const viewNow = () => {
    const s = session.full;
    if (!s) return null;
    return s.redacted ? s : E.view(s, uiSeat(s));
  };

  // ------------------------------------------------------------- dispatch

  function dispatch(type, seat, payload) {
    const state = session.full;
    if (!state) return false;
    const action = { type, seat, seq: state.seq, at: "", payload: payload || {} };

    /* A spectator holds a view redacted for nobody. Without this it would fall
     * through to the hotseat branch and be told "apply() refuses a redacted
     * state" — the engine's internal complaint, correct and useless. */
    if (session.role === "spectator") {
      session.notice = "You are spectating this table — you cannot act.";
      render();
      return false;
    }

    /* Remote: the client never applies anything. It sends the action and waits
     * for the referee's FRAME (or REJECT, which arrives with a fresh view). The
     * local path below is untouched and still runs the hotseat game. */
    if (session.seat !== null) {
      if (session.awaitingSeq !== null) return false; // swallow the double-click
      if (!globalThis.E1Net.act(action)) {
        session.notice = "Not connected to the table — the action was not sent.";
        render();
        return false;
      }
      session.awaitingSeq = action.seq;
      session.notice = null;
      render();
      return true;
    }

    const result = E.apply(state, action);
    if (result.error) {
      // Every rejection used to be a log(..., "warn") line and the click
      // silently did nothing. Now it is a code with a message.
      session.notice = result.error.message;
      session.lastErrorCode = result.error.code;
      render();
      return false;
    }
    session.notice = null;
    session.lastErrorCode = null;
    const prev = session.log.length ? session.log[session.log.length - 1].hash : state.gameId;
    const stateHash = E.hashState(result.state);
    const entry = { seq: action.seq, seat, at: "", action, prev, stateHash };
    entry.hash = E.entryHash(entry);
    session.log.push(entry);
    session.full = result.state;
    // Events arrive redacted for whichever seat the table is showing.
    for (const event of E.redactEvents(result.events, uiSeat(result.state))) {
      session.events.unshift(event);
      fx(event);
    }
    if (session.events.length > 240) session.events.length = 240;
    render();
    scheduleNpc();
    return true;
  }

  // ------------------------------------------------------------------ npc

  /* The bot plays through the same dispatch() as a human click — same engine
   * validation, same log, same FX. A short delay per action keeps its turns
   * readable instead of instantaneous. */
  let npcTimer = null;

  function npcTurnPending() {
    const full = session.full;
    return (
      session.npc !== null &&
      session.seat === null &&
      full &&
      !full.result &&
      globalThis.E1Npc &&
      globalThis.E1Npc.waitingSeat(full) === session.npc
    );
  }

  /* The bot's assisted abilities arrive as Tier B proposals the HUMAN would
   * have to ack — a junction commit every single turn. A warrant-backed
   * proposal is already bounded by the card's own envelope, so solo mode
   * accepts those automatically; it stays in the log and can still be flagged.
   * Free-form proposals (the bot never makes one) would still wait. */
  function npcAutoConsent() {
    const full = session.full;
    return (
      session.npc !== null &&
      session.seat === null &&
      full &&
      !full.result &&
      full.pendingManual &&
      full.pendingManual.seat === session.npc &&
      full.pendingManual.warrant &&
      (full.pendingManual.warrant.kind === "static" || full.pendingManual.warrant.kind === "open")
    );
  }

  function scheduleNpc() {
    if (npcTimer) { clearTimeout(npcTimer); npcTimer = null; }
    if (!npcTurnPending() && !npcAutoConsent()) return;
    npcTimer = setTimeout(npcStep, 550);
  }

  function npcStep() {
    npcTimer = null;
    if (npcAutoConsent()) {
      dispatch("MANUAL_ACCEPT", 1 - session.npc, { mid: session.full.pendingManual.mid });
      return;
    }
    if (!npcTurnPending()) return;
    const seat = session.npc;
    const list = globalThis.E1Npc.candidates(E, session.full, seat, compiled, {
      affinity: session.npcAffinity,
    });
    const notice = session.notice;
    for (const move of list) {
      if (dispatch(move.type, seat, move.payload)) return; // dispatch reschedules
    }
    /* Nothing applied: restore whatever notice the human was reading — the
     * bot's rejected attempts are its own problem, not a message. */
    session.notice = notice;
    render();
  }

  // -------------------------------------------------------------- effects

  /* The engine emits structured rules events; E1FX speaks its own fixed
   * vocabulary of 23 cues. This is the translation between them, and it is
   * deliberately the ONLY place the two meet — the engine never learns that
   * sound exists, and the FX layer never learns the rules.
   *
   * Driving effects from the event stream rather than from click handlers is
   * what makes them work unchanged for a networked seat or a replay: anything
   * that produces events produces the show. */
  const FX_PHASE = { open: "unlock", build1: "build1", clash: "clash", build2: "build2", close: "cleanup" };

  function fx(event) {
    showActionFx(event);
    const FX = globalThis.E1FX;
    if (!FX) return; // the game must run with fx.js absent
    const card = event.cardId ? CARD_BY_ID[event.cardId] : null;
    const affinity = card && card.affinity ? card.affinity[0] : undefined;
    switch (event.t) {
      case "TURN": return FX.emit("turn:begin", { seat: event.seat, number: event.number });
      case "PHASE": return FX.emit("phase:enter", { phase: FX_PHASE[event.phase] || event.phase });
      case "DRAW": return FX.emit("card:draw", { seat: event.seat });
      case "GENERATE":
        return FX.emit("resource:generate", { seat: event.seat, affinity: event.symbol, amount: event.amount });
      case "BURN": return FX.emit("buffer:burn", { seat: event.seat, amount: event.amount });
      case "QUEUED":
        return FX.emit("card:play", { seat: event.seat, cardType: card && card.type, affinity });
      case "ENTERS":
        // A Resource entering play is the once-per-turn land drop, not a spell.
        return card && /Resource/.test(card.type)
          ? FX.emit("resource:play", { seat: event.seat, affinity })
          : FX.emit("card:play", { seat: event.seat, cardType: card && card.type, affinity });
      case "ARCHIVED": case "INVALIDATED": return FX.emit("card:archive", { seat: event.seat });
      case "DECOMMISSIONED": return FX.emit("avatar:decommission", { uid: event.uid });
      case "DAMAGE":
        return event.to === "seat"
          ? FX.emit("damage:player", { seat: event.seat, amount: event.amount })
          : FX.emit("damage:avatar", { uid: event.uid, amount: event.amount });
      case "UPTIME":
        return event.delta > 0 ? FX.emit("uptime:gain", { seat: event.seat, amount: event.delta }) : undefined;
      case "ATTACKERS":
        FX.emit("clash:begin", {});
        return FX.emit("clash:declareAttackers", { count: (event.attackers || []).length });
      case "BLOCKERS": return FX.emit("clash:declareBlockers", { count: event.count || 0 });
      case "PASS_PRIORITY": return FX.emit("priority:pass", { seat: event.seat });
      case "MANUAL_ANNOUNCED": case "MANUAL_PROPOSED": case "MANUAL_APPLIED":
        return FX.emit("manual:resolve", { seat: event.seat });
      case "GAME_OVER": return FX.emit("game:win", { seat: event.winner });
      default: return undefined;
    }
  }

  // ---------------------------------------------------------- log wording

  const nameOf = (cardId) => (CARD_BY_ID[cardId] ? CARD_BY_ID[cardId].name : "a card");
  const seatName = (seat) => (session.full ? session.full.seats[seat].name : `Seat ${seat}`);

  function showActionFx(event) {
    const host = document.getElementById("actionFx");
    if (!host || !event) return;
    const described = describe(event);
    const label = described && described[0]
      ? described[0]
      : String(event.t || "ACTION").replaceAll("_", " ");
    const impact = ["DAMAGE", "BURN", "ARCHIVED", "DECOMMISSIONED", "INVALIDATED", "GAME_OVER"];
    const gains = ["UPTIME", "GENERATE", "DRAW", "REBOOT", "PREVENTED", "PUMP", "COUNTER"];
    const actions = ["QUEUED", "ENTERS", "RESOLVED", "ATTACKERS", "BLOCKERS", "COMMIT", "PAID", "SPEND"];
    const tone = impact.indexOf(event.t) >= 0
      ? "impact"
      : gains.indexOf(event.t) >= 0
        ? "gain"
        : actions.indexOf(event.t) >= 0 ? "action" : "system";
    const icon = tone === "impact" ? "⚡" : tone === "gain" ? "▲" : tone === "action" ? "◆" : "·";
    const FX = globalThis.E1FX;
    const reducedMotion = FX && typeof FX.get === "function" && FX.get().motionActive === "reduced";
    const node = el("div", `action-burst ${tone}${reducedMotion ? " reduced" : ""}`, `${icon} ${label}`);
    host.append(node);
    if (host.children.length > 5) {
      // Phase/pass chatter can arrive immediately after resolution. Keep the
      // bounded overlay, but sacrifice ordinary beats before a hit or Uptime
      // change that the player still needs to understand.
      const removable = Array.from(host.children).find((child) =>
        child !== node && !/(?:^|\s)(?:impact|gain)(?:\s|$)/.test(child.className || ""),
      ) || host.children[0];
      if (removable && removable.remove) removable.remove();
    }
    const timer = setTimeout(() => node.remove(), 1400);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  /* The engine emits structured events and never prose; all wording lives here
   * so it can change without touching a hashed byte. */
  function describe(event) {
    const p = event;
    switch (event.t) {
      case "TURN": return [`=== Turn ${p.number} · ${seatName(p.seat)} ===`, ""];
      case "PHASE": return [`— ${p.phase} —`, ""];
      case "UNLOCK": return [`${seatName(p.seat)} unlocks everything.`, ""];
      case "DRAW": return [`${seatName(p.seat)} draws${p.cardId ? ` ${nameOf(p.cardId)}` : " a card"}.`, ""];
      case "DECKED": return [`${seatName(p.seat)} cannot draw from an empty Stack.`, "bad"];
      case "BURN": return [`${seatName(p.seat)} burns ${p.amount} unspent Resource${p.amount > 1 ? "s" : ""} (${p.reason}) — −${p.amount} Uptime.`, "warn"];
      case "GENERATE": return [`${seatName(p.seat)} generates ${p.amount} ${SYMBOL_NAME[p.symbol] || p.symbol}.`, "good"];
      case "PAID": return [`${seatName(p.seat)} pays ${bufferText(p.payment)}.`, ""];
      case "SPEND": return [`${seatName(p.seat)} spends ${p.amount} ${SYMBOL_NAME[p.symbol]}.`, ""];
      case "QUEUED": return [`${seatName(p.seat)} announces ${nameOf(p.cardId)}.`, ""];
      case "ENTERS": return [`${nameOf(p.cardId)} enters the Network.`, ""];
      case "RESOLVED": return [`${nameOf(p.cardId)} resolves.`, ""];
      case "INVALIDATED": return [`${nameOf(p.cardId)} is invalidated (${p.reason}) and archived.`, "warn"];
      case "OP_SKIPPED": return [`${p.cardId ? nameOf(p.cardId) + "'s" : "A"} leftover effect fizzles — its object left play.`, "warn"];
      case "ARCHIVED": return [`${nameOf(p.cardId)} is archived.`, "warn"];
      case "DECOMMISSIONED": return [`${nameOf(p.cardId)} is decommissioned.`, "warn"];
      case "REBOOT": return [`${nameOf(p.cardId)} Reboots instead of being decommissioned.`, "good"];
      case "REBOOT_SHIELD": return ["A Reboot shield is created.", "good"];
      case "DAMAGE":
        return p.to === "seat"
          ? [`${seatName(p.seat)} takes ${p.amount} damage.`, "warn"]
          : [`${p.amount} damage is marked on the board.`, "warn"];
      case "PREVENTED": return ["Damage is prevented — Shielded.", "good"];
      case "UPTIME": return [`${seatName(p.seat)} ${p.delta >= 0 ? "gains" : "loses"} ${Math.abs(p.delta)} Uptime.`, p.delta >= 0 ? "good" : "warn"];
      case "PUMP": return ["A stat modifier is applied.", "good"];
      case "COUNTER": return [`A ${p.name} counter is placed.`, "good"];
      case "COMMIT": return [p.value ? "An object is committed." : "An object is unlocked.", ""];
      case "ATTACKERS": {
        const meshCount = new Set(Object.values(p.meshGroups || {})).size;
        return [p.attackers.length
          ? `${seatName(p.seat)} attacks with ${p.attackers.length}${meshCount ? ` in ${meshCount} Mesh group${meshCount === 1 ? "" : "s"}` : ""}.`
          : `${seatName(p.seat)} declares no attackers.`, ""];
      }
      case "BLOCKERS": return [`${seatName(p.seat)} declares blocks.`, ""];
      case "ORDER": return ["Blockers are ordered.", ""];
      case "COMBAT_DAMAGE": return [p.firstStrike ? "First Strike damage." : "Combat damage.", "warn"];
      case "DISCARD": case "DISCARDED": return [`${seatName(p.seat)} discards.`, "warn"];
      case "RANDOM_PICK": return [`Random choice from ${p.eligible.length} eligible.`, ""];
      case "SHUFFLE": return ["A zone is shuffled.", ""];
      case "CLEANUP": return [`${seatName(p.seat)} cleans up.`, ""];
      case "PASS_PRIORITY": return [`${seatName(p.seat)} passes${p.auto ? " (auto)" : ""}.`, ""];
      case "MANUAL_ANNOUNCED": return [`${nameOf(p.cardId)}: resolve at the table.`, "manual"];
      case "MANUAL_PROPOSED": return [`${seatName(p.seat)} proposes (Tier ${p.tier}): ${p.cardText}`, "manual"];
      case "MANUAL_APPLIED": return [`Manual edit applied: ${opsText(p.ops)}`, "manual"];
      case "MANUAL_ACCEPTED": return [`${seatName(p.seat)} accepts.`, "manual"];
      case "MANUAL_REJECTED": return [`${seatName(p.seat)} REJECTS — the card fizzles.${p.reason ? " " + p.reason : ""}`, "bad"];
      case "MANUAL_RESOLVED": return ["Assisted ability closed with no change.", "manual"];
      case "MANUAL_WITHDRAWN": return ["Proposal withdrawn.", "manual"];
      case "MANUAL_FLAGGED": return [`⚑ ${seatName(p.seat)} flags a manual edit: ${p.reason}`, "bad"];
      case "NOTE": return [p.text, "manual"];
      case "CONCEDE": return [`${seatName(p.seat)} rugpulls — the network routes on without them.`, "bad"];
      case "TOKEN": return ["A token is created.", "good"];
      case "GAME_OVER":
        return [p.reason === "draw" ? "The game is a draw." : `${seatName(p.winners[0])} wins (${p.reason}).`, "good"];
      default: return null;
    }
  }

  const bufferTotal = (buffer) => Object.values(buffer).reduce((sum, n) => sum + n, 0);

  const bufferText = (buffer) =>
    Object.keys(buffer)
      .filter((key) => buffer[key])
      .map((key) => `${buffer[key]} ${key}`)
      .join(" + ") || "nothing";

  const opsText = (ops) =>
    ops
      .map((op) => {
        if (op.op === "note") return op.text;
        const bits = Object.keys(op)
          .filter((key) => key !== "op")
          .map((key) => `${key}=${JSON.stringify(op[key])}`);
        return `${op.op}(${bits.join(", ")})`;
      })
      .join("; ");

  // ------------------------------------------------------------ DOM helpers

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const faceUrl = (card) => "../art/cards/node-runner-web/" + encodeURIComponent(card.face);
  /* Blossom resolver with local cache (faces.js). Absent — the stub DOM of
   * the tests, or a build without the blob map — every face is the repo file. */
  const FACES = globalThis.E1Faces || null;
  const setFace = (img, card, badgeHost) => {
    if (FACES) FACES.setFace(img, card.face, badgeHost);
    else img.src = faceUrl(card);
  };

  // ------------------------------------------------------- click intentions

  /* Clicking a card during Unlock/Maintenance/Draw used to answer only "Build
   * I or Build II only" — technically true, practically a wall in front of the
   * first thing every new player tries. If the phase is the ONLY objection and
   * the table is waiting on this seat anyway, walk Continue toward Build and
   * retry the same play at each step. */
  function playAdvancing(seat, attempt) {
    if (attempt()) return;
    for (let i = 0; i < 6; i++) {
      if (session.lastErrorCode !== "WRONG_PHASE") return;
      const full = session.full;
      if (!full || full.result || session.seat !== null) return;
      if (full.turn.active !== seat || uiSeat(full) !== seat) return;
      /* Never walk the turn forward over a full Buffer: §12.1 burns unspent
       * Resources at every phase boundary, so "helpfully" advancing to reach
       * Build I destroyed the very Buffer the card was about to be paid with
       * — and charged Uptime for the privilege. An empty Buffer has nothing
       * to lose, which is the case at the start of a turn where this help is
       * actually wanted. */
      if (bufferTotal(full.seats[seat].buffer) > 0) {
        session.notice =
          "Resources burn when the phase ends — press Continue to reach Build I, then spend them there.";
        render();
        return;
      }
      const before = full.seq;
      advance();
      if (!session.full || session.full.seq === before) return;
      if (attempt()) return;
    }
  }

  /* Left-click on a card: the detail popup. Rules text as printed, then the
   * same plain-English help the gallery shows, and — from the Wallet — the
   * play button right where the explanation is. Targeting and clash clicks
   * never reach this: they are handled before the zone onClick fires. */
  /* The Queue, rendered. A played card waits here until priority passes, and
   * a zone nobody can see is a card that vanished. */
  function renderQueue(v) {
    const wrap = document.getElementById("queueWrap");
    const zone = document.getElementById("queue");
    if (!wrap || !zone) return;
    const items = v.queue || [];
    wrap.hidden = !items.length;
    zone.innerHTML = "";
    for (const item of items) {
      if (!item.cardId) continue;
      const card = CARD_BY_ID[item.cardId];
      const node = el("div", "gcard");
      const img = el("img");
      setFace(img, card, node);
      img.alt = card.name;
      node.append(img);
      node.append(el("span", "gstats", v.seats[item.controller].name));
      node.addEventListener("mouseenter", () => {
        const box = document.getElementById("inspector");
        box.innerHTML = "";
        const face = el("img");
        setFace(face, card);
        face.alt = card.name;
        box.append(face);
        const info = el("div", "ibody");
        info.append(el("strong", null, card.name));
        info.append(el("div", "imeta", `${card.id} · on the Queue · ${v.seats[item.controller].name}`));
        if (card.text) info.append(el("p", "itext", card.text));
        box.append(info);
      });
      zone.append(node);
    }
  }

  function openCardDetail(v, seat, uid, canPlay, at) {
    const object = v.objects[uid];
    if (!object || !object.cardId) return;
    const card = CARD_BY_ID[object.cardId];
    const dialog = document.getElementById("cardDetail");
    setFace(dialog.querySelector(".face"), card);
    dialog.querySelector(".face").alt = card.name;
    /* The card's home on Blossom: the hash is the address, the links prove it. */
    const blobBox = document.getElementById("cdBlossom");
    if (blobBox) {
      const sha = FACES && FACES.blobs ? FACES.blobs[card.face] : null;
      if (sha) {
        blobBox.innerHTML = "";
        blobBox.append("blossom ");
        blobBox.append(el("span", "sha", sha.slice(0, 12) + "…"));
        for (const server of FACES.mirrors) {
          blobBox.append(" · ");
          const link = el("a", null, new URL(server).host);
          link.href = `${server}/${sha}`;
          link.target = "_blank";
          link.rel = "noopener";
          blobBox.append(link);
        }
      } else {
        blobBox.textContent = "";
      }
    }
    dialog.querySelector(".cd-name").textContent = card.name;
    dialog.querySelector(".cd-meta").textContent =
      `${card.id} · ${card.type}${card.subtype ? " — " + card.subtype : ""}` +
      ` · ${card.affinity.join("/")} · Cost ${card.cost || "—"}`;
    dialog.querySelector(".cd-rules").textContent = card.text || "";
    // The card face writes flavor as a code comment; the window does the same.
    dialog.querySelector(".cd-flavor").textContent = card.flavor || "";
    dialog.querySelector(".cd-help").textContent =
      card.help || "No extra help for this one — the rules text is the whole story.";
    const play = document.getElementById("cdPlay");
    play.hidden = !canPlay;
    play.onclick = () => {
      dialog.close();
      beginPlay(v, seat, uid);
    };
    /* Own Network cards act from here too — the popup is the action hub, so
     * every activation the inspector offers appears here as well: scripted
     * abilities directly, and any still-assisted junction as a proposal. */
    const acts = document.getElementById("cdActs");
    acts.innerHTML = "";
    if (object.controller === seat && object.zone.endsWith(":network")) {
      compiled(card.id).abilities.forEach((ability, index) => {
        if (ability.kind === "activated" && !ability.manual && ability.ops) {
          const choiceOp = ability.resourceAbility && ability.ops.find((op) => op.affinity === "choice");
          if (choiceOp) {
            const offered =
              Array.isArray(choiceOp.options) && choiceOp.options.length
                ? choiceOp.options.map((name) => SYMBOLS.find((s) => SYMBOL_NAME[s] === name) || name)
                : SYMBOLS;
            for (const symbol of offered) {
              const button = el("button", "btn ghost", `Activate → ${SYMBOL_NAME[symbol]}`);
              if (ability.commit && object.committed) button.disabled = true;
              button.addEventListener("click", () => {
                dialog.close();
                beginAbility(v, seat, uid, index, symbol);
              });
              acts.append(button);
            }
            return;
          }
          const button = el("button", "btn ghost", `Activate: ${ability.text}`);
          if (ability.commit && object.committed) button.disabled = true;
          button.addEventListener("click", () => {
            dialog.close();
            beginAbility(v, seat, uid, index);
          });
          acts.append(button);
          return;
        }
        const generate = junctionGenerate(ability);
        if (!generate) return;
        for (const name of generate.names) {
          const button = el("button", "btn ghost", `Generate → ${name}`);
          if (object.committed) button.disabled = true;
          button.addEventListener("click", () => {
            dialog.close();
            proposeJunctionGenerate(seat, uid, index, ability, name);
          });
          acts.append(button);
        }
      });
    }
    document.getElementById("cdClose").onclick = () => dialog.close();
    dialog.showModal();
    placeWindow(dialog, at);
  }

  /* Both windows hang at the hand that opened them: near the pointer, clamped
   * to the viewport. No pointer (keyboard, small screen) means centred. */
  function placeWindow(box, at) {
    if (!box.getBoundingClientRect || !box.style) return;
    const small = window.innerWidth < 700;
    if (!at || typeof at.x !== "number" || small) {
      box.classList.remove("at-pointer");
      box.style.left = "";
      box.style.top = "";
      box.style.margin = "";
      return;
    }
    box.classList.add("at-pointer");
    box.style.margin = "0";
    const rect = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, at.x + 16));
    const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, at.y - rect.height / 3));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  /* The choice menu: which affinity a junction makes, which of several
   * abilities to fire, which X. It opens where the mouse already is. */
  function openActionMenu(title, entries, at) {
    closeActionMenu();
    const menu = el("div", "ctxmenu");
    menu.append(el("div", "ctxtitle", title));
    for (const entry of entries) {
      const button = el("button", entry.disabled ? "disabled" : null, entry.label);
      if (entry.disabled) button.disabled = true;
      else
        button.addEventListener("click", () => {
          closeActionMenu();
          entry.run();
        });
      menu.append(button);
    }
    document.body.append(menu);
    placeWindow(menu, at);
    setTimeout(() => document.addEventListener("click", closeActionMenu, { once: true }), 0);
  }

  function closeActionMenu() {
    const open = document.querySelector(".ctxmenu");
    if (open) open.remove();
  }

  /* Right-click on your own Network card: fire what it can do. One unambiguous
   * ability runs immediately; a junction's two affinities, or several
   * abilities, open the menu. Nothing activatable falls back to the card. */
  function activateFromBoard(v, seat, uid, at) {
    const object = v.objects[uid];
    if (!object || !object.cardId) return;
    const card = compiled(object.cardId);
    const entries = [];
    card.abilities.forEach((ability, index) => {
      if (ability.kind !== "activated" || ability.manual || !ability.ops) return;
      const blocked = ability.commit && object.committed;
      const choiceOp = ability.resourceAbility && ability.ops.find((op) => op.affinity === "choice");
      if (choiceOp) {
        const offered =
          Array.isArray(choiceOp.options) && choiceOp.options.length
            ? choiceOp.options.map((name) => SYMBOLS.find((s) => SYMBOL_NAME[s] === name) || name)
            : SYMBOLS;
        for (const symbol of offered) {
          entries.push({
            label: `Generate ${SYMBOL_NAME[symbol]}`,
            disabled: blocked,
            run: () => beginAbility(v, seat, uid, index, symbol),
          });
        }
        return;
      }
      entries.push({
        label: ability.text,
        disabled: blocked,
        run: () => beginAbility(v, seat, uid, index),
      });
    });
    for (const grantorUid of v.zones[`${seat}:network`] || []) {
      const grantor = v.objects[grantorUid];
      if (!grantor || !grantor.cardId) continue;
      for (const ability of compiled(grantor.cardId).abilities) {
        const rule = ability.kind === "rule-static" && ability.rule &&
          ability.rule.name === "tribalActivatedAbility" ? ability.rule : null;
        if (!rule || String(card.subtype || "").indexOf(rule.tribe) < 0) continue;
        entries.push({
          label: `${rule.tribe}: granted ability`,
          disabled: false,
          run: () => dispatch("ACTIVATE_GRANTED_ABILITY", seat, { uid, grantorUid }),
        });
      }
    }
    if (!entries.length) return void openCardDetail(v, seat, uid, false, at);
    const live = entries.filter((e) => !e.disabled);
    if (live.length === 1 && entries.length === 1) return void live[0].run();
    entries.push({ label: "Card details…", run: () => openCardDetail(v, seat, uid, false, at) });
    openActionMenu(CARD_BY_ID[object.cardId].name, entries, at);
  }

  /* No browser prompt() anywhere: an X and a mode are one styled menu each,
   * at the pointer, so the common card is one click and the rare one is two. */
  function beginPlay(v, seat, uid, at) {
    const object = v.objects[uid];
    if (!object || !object.cardId) return;
    const card = compiled(object.cardId);
    if (card.isResource) return void playAdvancing(seat, () => dispatch("PLAY_RESOURCE", seat, { uid }));
    const finish = (x, modes) => {
      const spec = modes ? card.playModes[modes[0]].targetSpec : card.playTargetSpec;
      if (spec.length === 1 && spec[0].variable && spec[0].exactX && !x) {
        return void playAdvancing(seat, () => dispatch("PLAY_CARD", seat, playPayload(uid, [], 0, modes)));
      }
      if (!spec.length) {
        return void playAdvancing(seat, () => dispatch("PLAY_CARD", seat, playPayload(uid, [], x, modes)));
      }
      picking = { kind: "play", uid, spec, targets: [], x, modes };
      render();
    };
    const chooseMode = (x) => {
      if (!card.playModes) return finish(x, undefined);
      openActionMenu(
        `${card.name} — choose one`,
        card.playModes.map((mode, index) => ({ label: mode.text, run: () => finish(x, [index]) })),
        at
      );
    };
    if (card.costParsed && card.costParsed.x) {
      const options = [];
      for (let n = 0; n <= 6; n++) options.push({ label: `X = ${n}`, run: () => chooseMode(n) });
      return void openActionMenu(`${card.name} — each X costs ${card.costParsed.x}`, options, at);
    }
    chooseMode(0);
  }

  function beginRemotePlay(v, seat, additionalCosts) {
    const awaiting = v.awaiting;
    if (!awaiting || awaiting.kind !== "remotePlay" || awaiting.seat !== seat) return;
    const card = compiled(awaiting.cardId);
    const costs = Array.isArray(additionalCosts) ? additionalCosts.slice() : [];
    if (card.playOps.some((op) => op.op === "additionalArchiveAvatar") && !costs.length) {
      picking = {
        kind: "remoteCost",
        uid: awaiting.uid,
        spec: [{ kind: "avatar", whose: "remote-payer", prompt: "an Avatar to archive as the additional cost" }],
        targets: [],
      };
      return void render();
    }
    const finish = (x, modes) => {
      const spec = modes ? card.playModes[modes[0]].targetSpec : card.playTargetSpec;
      if (spec.length === 1 && spec[0].variable && spec[0].exactX && !x) {
        const payload = { targets: [], x: 0 };
        if (modes) payload.modes = modes;
        if (costs.length) payload.additionalCosts = costs;
        return void dispatch("REMOTE_PLAY_CARD", seat, payload);
      }
      if (!spec.length) {
        const payload = { targets: [], x: x || 0 };
        if (modes) payload.modes = modes;
        if (costs.length) payload.additionalCosts = costs;
        return void dispatch("REMOTE_PLAY_CARD", seat, payload);
      }
      picking = { kind: "remote", uid: awaiting.uid, spec, targets: [], x, modes, additionalCosts: costs };
      render();
    };
    const chooseMode = (x) => {
      if (!card.playModes) return finish(x, undefined);
      openActionMenu(
        `${card.name} — choose one`,
        card.playModes.map((mode, index) => ({ label: mode.text, run: () => finish(x, [index]) }))
      );
    };
    if (card.costParsed && card.costParsed.x) {
      openActionMenu(
        `${card.name} — choose X`,
        Array.from({ length: 7 }, (_, x) => ({ label: `X = ${x}`, run: () => chooseMode(x) }))
      );
      return;
    }
    chooseMode(0);
  }

  /* canonicalJSON refuses `undefined` — that is what keeps a replay honest.
   * So an absent mode must be ABSENT from the payload, not present-and-
   * undefined: passing `modes: undefined` threw on every non-modal card and
   * took the whole click with it. */
  function playPayload(uid, targets, x, modes) {
    const payload = { uid, targets, x: x || 0 };
    if (Array.isArray(modes)) payload.modes = modes;
    return payload;
  }

  function beginAbility(v, seat, uid, abilityIndex, choice) {
    const card = compiled(v.objects[uid].cardId);
    const ability = card.abilities[abilityIndex];
    if (ability.resourceAbility) {
      const payload = { uid, abilityIndex };
      if (choice) payload.choice = choice;
      return void dispatch("ACTIVATE_RESOURCE_ABILITY", seat, payload);
    }
    const finish = (x) => {
      if (ability.targetSpec.length === 1 && ability.targetSpec[0].variable &&
          ability.targetSpec[0].exactX && !x) {
        return void dispatch("ACTIVATE_ABILITY", seat, { uid, abilityIndex, targets: [], x: 0 });
      }
      if (!ability.targetSpec.length) {
        return void dispatch("ACTIVATE_ABILITY", seat, { uid, abilityIndex, targets: [], x: x || 0 });
      }
      picking = { kind: "ability", uid, abilityIndex, spec: ability.targetSpec, targets: [], x };
      render();
    };
    if (ability.costParsed && ability.costParsed.x) {
      return void openActionMenu(
        `${card.name} — choose X`,
        Array.from({ length: 7 }, (_, x) => ({ label: `X = ${x}`, run: () => finish(x) }))
      );
    }
    finish(0);
  }

  const currentPickSpec = () => {
    if (!picking) return null;
    const variable = picking.spec.length === 1 && picking.spec[0].variable;
    return variable ? picking.spec[0] : picking.spec[picking.targets.length];
  };

  function completePicking() {
    if (!picking) return false;
    const {
      kind, uid, abilityIndex, targets, x, modes, baseTargets,
      copyModes: pendingCopyModes, additionalCosts,
    } = picking;
    picking = null;
    if (kind === "remoteCost") {
      beginRemotePlay(session.full, uiSeat(session.full), targets.map((entry) => entry.uid));
    } else if (kind === "play") {
      const played = compiled(session.full.objects[uid].cardId);
      if (played.playOps.some((op) => op.op === "copyQueue")) {
        const queueTarget = targets.find((target) => target.kind === "queue");
        const original = queueTarget && session.full.queue.find((entry) => entry.qid === queueTarget.qid);
        const copied = original && original.cardId ? compiled(original.cardId) : null;
        const copyModes = original ? (original.modes || []).slice() : [];
        const copySpec = copied
          ? copied.playModes && copyModes.length
            ? copied.playModes[copyModes[0]].targetSpec
            : copied.playTargetSpec
          : [];
        if (copySpec.length) {
          picking = {
            kind: "copyPlay", uid, spec: copySpec, targets: [], x, modes,
            baseTargets: targets, copyModes,
          };
          return void render();
        }
        const payload = playPayload(uid, targets, x, modes);
        payload.copyTargets = [];
        if (copyModes.length) payload.copyModes = copyModes;
        return void dispatch("PLAY_CARD", uiSeat(session.full), payload);
      }
      dispatch("PLAY_CARD", uiSeat(session.full), playPayload(uid, targets, x, modes));
    }
    else if (kind === "copyPlay") {
      const payload = playPayload(uid, baseTargets || [], x, modes);
      payload.copyTargets = targets;
      if (pendingCopyModes && pendingCopyModes.length) payload.copyModes = pendingCopyModes;
      dispatch("PLAY_CARD", uiSeat(session.full), payload);
    }
    else if (kind === "remote") {
      const payload = { targets, x: x || 0 };
      if (Array.isArray(modes)) payload.modes = modes;
      if (Array.isArray(additionalCosts) && additionalCosts.length) payload.additionalCosts = additionalCosts;
      dispatch("REMOTE_PLAY_CARD", uiSeat(session.full), payload);
    } else dispatch("ACTIVATE_ABILITY", uiSeat(session.full), { uid, abilityIndex, targets, x: x || 0 });
    return true;
  }

  function offerTarget(target) {
    if (!picking) return false;
    const spec = currentPickSpec();
    if (!spec) return false;
    if (spec.variable) {
      const encoded = JSON.stringify(target);
      const duplicate = picking.targets.findIndex((entry) => JSON.stringify(entry) === encoded);
      if (duplicate >= 0) picking.targets.splice(duplicate, 1);
      else picking.targets.push(target);
      if (spec.exactX && picking.targets.length === (picking.x || 0)) return completePicking();
      render();
      return true;
    }
    picking.targets.push(target);
    if (picking.targets.length < picking.spec.length) {
      render();
      return true;
    }
    return completePicking();
  }

  const wantsTarget = (v, uid) => {
    if (!picking) return false;
    const spec = currentPickSpec();
    if (!spec) return false;
    const object = v.objects[uid];
    if (!object || !object.cardId) return false;
    const card = compiled(object.cardId);
    if (spec.kind === "seat" || spec.kind === "queue") return false;
    const zone = String(object.zone || "").split(":")[1];
    if (spec.zone && zone !== spec.zone) return false;
    if (spec.whose === "you" && object.owner !== uiSeat(session.full)) return false;
    if (spec.whose === "you-controller" && object.controller !== uiSeat(session.full)) return false;
    if (spec.whose === "opponent-controller" && object.controller === uiSeat(session.full)) return false;
    if (spec.whose === "remote-payer") {
      const awaiting = session.full.awaiting;
      if (!awaiting || object.controller !== awaiting.payer || zone !== "network") return false;
    }
    const ctx = E.resolveCtx({});
    if (spec.affinity && E.affinitiesOf(v, ctx, uid).indexOf(spec.affinity) < 0) return false;
    if (spec.notAffinity && E.affinitiesOf(v, ctx, uid).indexOf(spec.notAffinity) >= 0) return false;
    if (spec.maximumAction !== undefined && E.statsOf(v, ctx, uid).action > spec.maximumAction) return false;
    if (spec.requireCommitted && !object.committed) return false;
    if (spec.notKeyword && E.keywordsOf(v, ctx, uid).indexOf(spec.notKeyword) >= 0) return false;
    if (spec.kind === "card") return true;
    if (spec.kind === "avatar" || spec.kind === "any") return card.isAvatar;
    if (spec.kind.indexOf("type:") === 0) return card.type.indexOf(spec.kind.slice(5)) >= 0;
    if (spec.kind.indexOf("keyword:") === 0) {
      return E.keywordsOf(v, ctx, uid).indexOf(spec.kind.slice(8)) >= 0;
    }
    return true;
  };

  /* A player can BE the target — Zap's "any target", Wallet Scramble's
   * "player". The engine accepts {kind:"seat"} for both (§11.2); the Queue
   * already showed the shape for non-object targets: give the thing its own
   * clickable surface. The playerbar IS the player. */
  const wantsSeatTarget = () => {
    if (!picking) return false;
    const spec = currentPickSpec();
    return Boolean(spec && (spec.kind === "seat" || spec.kind === "any"));
  };

  // Where the hand is: a mouse event becomes an anchor for menus and windows.
  const pt = (event) =>
    event && typeof event.clientX === "number" ? { x: event.clientX, y: event.clientY } : null;

  // ------------------------------------------------------------ card nodes

  function cardNode(v, uid, options) {
    const object = v.objects[uid];
    const node = el("div", "gcard");
    if (!object || !object.cardId) {
      node.classList.add("facedown"); // a shell: the opponent's Wallet
      return node;
    }
    const card = CARD_BY_ID[object.cardId];
    if (object.committed) node.classList.add("committed");
    if (v.clash.attackers.indexOf(uid) >= 0 || attackers.indexOf(uid) >= 0) node.classList.add("attacking");
    if ((meshGroupActive && attackers.indexOf(uid) >= 0) ||
        (v.clash.meshGroups && v.clash.meshGroups[uid])) node.classList.add("meshed");
    const blocking = Object.keys(v.clash.blocks).some((a) => v.clash.blocks[a].indexOf(uid) >= 0) ||
      Object.keys(blocks).some((a) => blocks[a].indexOf(uid) >= 0);
    if (blocking) node.classList.add("blocking");

    const img = el("img");
    setFace(img, card, node);
    img.alt = card.name;
    img.loading = "lazy";
    node.append(img);

    if (compiled(card.id).isAvatar) {
      const stats = engineStats(v, uid);
      const badge = el("span", "gstats", `${stats.action}/${stats.resilience - object.damage}`);
      if (object.damage) badge.classList.add("hurt");
      node.append(badge);
    }
    if (object.bootDelay) node.append(el("span", "gboot", "⏻"));
    if (card.manual) node.append(el("span", "gmanual", "!"));
    if (wantsTarget(v, uid)) node.classList.add("targetable");
    node.dataset.uid = uid; // the arrow layer finds its endpoints by uid
    if (blockTarget === uid) node.classList.add("blockpick");
    if (options && options.mark) {
      for (const name of (options.mark(uid) || "").split(" ")) if (name) node.classList.add(name);
    }

    node.addEventListener("click", (event) => {
      if (wantsTarget(v, uid)) return void offerTarget({ kind: "object", uid });
      if (options && options.onClick) options.onClick(uid, event);
    });
    // LEFT acts, RIGHT explains — and while a pick is open, either button
    // lands the target, because a click on a glowing card means the target.
    if (options && options.onContext) {
      node.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (wantsTarget(v, uid)) return void offerTarget({ kind: "object", uid });
        options.onContext(uid, event);
      });
    }
    node.addEventListener("mouseenter", () => showInspector(v, uid));
    if (options && options.canPlay && options.canPlay(uid)) node.classList.add("canplay");
    if (options && options.canAct && options.canAct(uid)) node.classList.add("canact");
    if (options && options.canAttack && options.canAttack(uid)) node.classList.add("canattack");
    return node;
  }

  /* Hearthstone's oldest lesson: show the player what they CAN do. A hand
   * card glows when it could be played right now; a Network card glows when
   * an ability of it is worth a click. */
  function playGlow(v, seat, uid) {
    const full = session.full;
    if (!full || full.result || full.turn.active !== seat) return false;
    const object = v.objects[uid];
    if (!object || !object.cardId) return false;
    const card = compiled(object.cardId);
    if (card.isResource) {
      return full.turn.resourcePlays.used < full.turn.resourcePlays.allowed;
    }
    return E.canPay(v.seats[seat].buffer, card.costParsed);
  }

  function actGlow(v, seat, uid) {
    const full = session.full;
    if (!full || full.result || full.turn.active !== seat) return false;
    const object = v.objects[uid];
    if (!object || !object.cardId || object.committed) return false;
    const card = compiled(object.cardId);
    return card.abilities.some(
      (ability) =>
        ability.kind === "activated" &&
        !ability.manual &&
        ability.ops &&
        (!ability.costParsed || E.canPay(v.seats[seat].buffer, ability.costParsed))
    );
  }

  /* During the attackers step, every Avatar that may legally swing says so.
   * The rules were always enforced; nothing ever pointed at them. */
  function attackGlow(v, seat, uid) {
    if (!v.awaiting || v.awaiting.kind !== "attackers" || v.awaiting.seat !== seat) return false;
    if (attackers.indexOf(uid) >= 0) return false; // already declared: it reads as attacking
    try {
      return E.canAttack({ state: v, ctx: E.resolveCtx({}) }, uid);
    } catch (error) {
      return false;
    }
  }

  /* The turn button narrates the turn: gold and pulsing when everything is
   * spent ("job's done"), dimmed when it is not your turn at all. */
  function renderTurnButton(v, seat) {
    const button = document.getElementById("endturn");
    if (!button) return;
    const full = session.full;
    button.classList.remove("ready", "foeturn");
    if (!full || full.result) return void (button.textContent = "End turn");
    const myTurn = full.turn.active === seat;
    if (!myTurn) {
      button.classList.add("foeturn");
      button.textContent = session.npc !== null ? "NPC turn…" : "Their turn…";
      return;
    }
    button.textContent = "End turn";
    const anythingLeft =
      v.zones[`${seat}:wallet`].some((uid) => playGlow(v, seat, uid)) ||
      v.zones[`${seat}:network`].some((uid) => actGlow(v, seat, uid));
    if (!anythingLeft) button.classList.add("ready");
  }

  /* Stats are computed by the engine so the badge can never disagree with the
   * rules. The view carries everything statsOf needs. */
  function engineStats(v, uid) {
    try {
      return E.statsOf(v, E.resolveCtx({}), uid);
    } catch (error) {
      const card = CARD_BY_ID[v.objects[uid].cardId];
      return { action: card.action || 0, resilience: card.resilience || 0 };
    }
  }

  function showInspector(v, uid) {
    const object = v.objects[uid];
    const box = document.getElementById("inspector");
    box.innerHTML = "";
    if (!object || !object.cardId) {
      box.append(el("span", null, "Face down."));
      return;
    }
    const card = CARD_BY_ID[object.cardId];
    const seat = uiSeat(session.full);
    const img = el("img");
    setFace(img, card);
    img.alt = card.name;
    box.append(img);
    const info = el("div", "ibody");
    info.append(el("strong", null, card.name));
    info.append(el("div", "imeta",
      `${card.id} · ${card.type}${card.subtype ? " — " + card.subtype : ""} · ${card.affinity.join("/")} · Cost ${card.cost || "—"}`));
    if (card.text) info.append(el("p", "itext", card.text));
    if (card.manual) info.append(el("p", "imanualnote", "Assisted: propose the effect, your opponent sees it."));

    const acts = el("div", "iacts");
    if (object.controller === seat && object.zone.endsWith(":network")) {
      compiled(card.id).abilities.forEach((ability, index) => {
        if (ability.kind !== "activated") return;
        /* Assisted junctions — "Commit: generate 1 X or 1 Y." carries no
         * script, so a plain activation only announces "resolve at the table"
         * and generates NOTHING. Offer the honest one-click proposal the NPC
         * already uses: commit as the cost, one Resource as the effect,
         * bounded by the ability's envelope, Tier B for the opponent. */
        const generate = junctionGenerate(ability);
        if (generate) {
          for (const name of generate.names) {
            const button = el("button", null, `Generate → ${name} (assisted)`);
            if (object.committed) button.disabled = true;
            button.addEventListener("click", () =>
              proposeJunctionGenerate(seat, uid, index, ability, name));
            acts.append(button);
          }
          return;
        }
        // "generate N Resources of one affinity" needs the affinity picked at
        // activation. One button per affinity beats a modal: it keeps the whole
        // table in the page and never blocks the renderer.
        const choiceOp = ability.resourceAbility && ability.ops.find((op) => op.affinity === "choice");
        if (choiceOp) {
          // A junction offers exactly the affinities it names; an open choice
          // offers all five. Mirror the engine's own restriction.
          const offered =
            Array.isArray(choiceOp.options) && choiceOp.options.length
              ? choiceOp.options.map((name) => SYMBOLS.find((s) => SYMBOL_NAME[s] === name) || name)
              : SYMBOLS;
          for (const symbol of offered) {
            const button = el("button", null, `Activate → ${SYMBOL_NAME[symbol]}`);
            button.addEventListener("click", () => beginAbility(v, seat, uid, index, symbol));
            acts.append(button);
          }
          return;
        }
        const button = el("button", null, `Activate: ${ability.text}`);
        button.addEventListener("click", () => beginAbility(v, seat, uid, index));
        acts.append(button);
      });
      if (v.policy && v.policy.freeform === "allow") {
        for (const zone of ["archive", "cold"]) {
          const button = el("button", "ghost", `→ ${zone} (propose)`);
          button.addEventListener("click", () =>
            propose(seat, [{ op: "moveObject", uid, toZone: zone }], `move ${card.name} to ${zone}`));
          acts.append(button);
        }
        const toggle = el("button", "ghost", (object.committed ? "Unlock" : "Commit") + " (propose)");
        toggle.addEventListener("click", () =>
          propose(seat, [{ op: "setCommitted", uid, value: !object.committed }], `toggle ${card.name}`));
        acts.append(toggle);
      }
    }
    info.append(acts);
    box.append(info);
  }

  // ------------------------------------------------------------------ coach

  /* The first-game tour, Hearthstone style: one bubble, one highlighted
   * element, steps that advance themselves when the board shows the player
   * did the thing. Runs once; "Skip tour" and finishing both end it for good.
   * The tour speaks to the hotseat/solo player in seat 0. */
  const COACH_KEY = "600b:coach";
  let coachIndex = (() => {
    try {
      return localStorage.getItem(COACH_KEY) === "done" ? -1 : 0;
    } catch (error) {
      return 0;
    }
  })();

  const COACH_STEPS = [
    {
      title: "Welcome, runner",
      text: "Your first table is best against the NPC. Tick “NPC opponent”, then press Start game.",
      anchor: "#start",
      done: () => Boolean(session.full),
    },
    {
      title: "Play a Resource",
      text: "Glowing cards can be played right now. Left-click plays it; right-click opens the card and explains it. Play one Resource.",
      anchor: "#youHand",
      done: () => {
        const full = session.full;
        return Boolean(full && (full.turn.resourcePlays.used > 0 || full.zones["0:network"].length > 0));
      },
    },
    {
      title: "Generate",
      text: "Click your Resource on the Network and pick an affinity. That fills your Buffer — the pips beside your name pay for everything.",
      anchor: "#youNetwork",
      done: () => {
        const full = session.full;
        return Boolean(full && Object.values(full.seats[0].buffer).some((n) => n > 0));
      },
    },
    {
      title: "Spend it",
      text: "Cards you can afford glow gold. Play one — or press Next if nothing glows this turn.",
      anchor: "#youHand",
      done: () => {
        const full = session.full;
        return Boolean(
          full &&
            full.zones["0:network"].some((uid) => {
              const object = full.objects[uid];
              return object && object.cardId && !compiled(object.cardId).isResource;
            })
        );
      },
    },
    {
      title: "End your turn",
      text: "When the turn button glows gold, everything is spent. End the turn and watch the NPC play by the same rules.",
      anchor: "#endturn",
      done: () => {
        const full = session.full;
        return Boolean(full && full.turn.active !== 0);
      },
    },
    {
      title: "You are live",
      text: "Uptime 0 = offline. Attack during Clash, block on defense, and left-click anything you don't understand — every card explains itself. GLHF!",
      anchor: null,
      done: () => false,
    },
  ];

  function finishCoach() {
    coachIndex = -1;
    try {
      localStorage.setItem(COACH_KEY, "done");
    } catch (error) {
      void error;
    }
    coachStep();
  }

  function coachStep() {
    // The client tests run play.js in a DOM shim without querySelector; the
    // coach is presentation only and simply sits out.
    if (typeof document.querySelector !== "function") return;
    const bubble = document.getElementById("coach");
    if (!bubble) return;
    const previous = document.querySelector(".coach-target");
    if (previous) previous.classList.remove("coach-target");
    if (coachIndex < 0) return void (bubble.hidden = true);
    while (coachIndex < COACH_STEPS.length && COACH_STEPS[coachIndex].done()) coachIndex += 1;
    if (coachIndex >= COACH_STEPS.length) return void finishCoach();
    const step = COACH_STEPS[coachIndex];
    document.getElementById("coachTitle").textContent = step.title;
    document.getElementById("coachText").textContent = step.text;
    document.getElementById("coachNext").textContent =
      coachIndex === COACH_STEPS.length - 1 ? "Done" : "Next";
    bubble.hidden = false;
    const anchor = step.anchor ? document.querySelector(step.anchor) : null;
    bubble.style.left = bubble.style.right = bubble.style.top = bubble.style.bottom = "";
    if (anchor && anchor.offsetParent !== null) {
      anchor.classList.add("coach-target");
      const rect = anchor.getBoundingClientRect();
      const below = rect.bottom + 12;
      bubble.style.left = `${Math.max(12, Math.min(window.innerWidth - 340, rect.left))}px`;
      bubble.style.top =
        below + 170 < window.innerHeight ? `${below}px` : `${Math.max(12, rect.top - 180)}px`;
    } else {
      bubble.style.right = "24px";
      bubble.style.bottom = "24px";
    }
  }

  /* Every human override routes through one audited, attributed, consent-aware
   * door. A free-form warrant is used for the generic table controls, which is
   * always Tier B and always needs a reason. */
  function propose(seat, ops, reason) {
    dispatch("MANUAL_PROPOSE", seat, { warrant: { kind: "freeform", note: reason }, ops, reason });
  }

  /* "Commit: generate 1 X or 1 Y." — the shape of every assisted junction.
   * Returns the affinity names it offers, or null for anything else. */
  const GENERATE_SYMBOL = { Power: "P", Bitcoin: "B", Keys: "K", Signal: "S", Timelock: "T" };
  function junctionGenerate(ability) {
    if (!ability.manual || !/^commit:/i.test((ability.text || "").trim())) return null;
    const match = /generate 1 (\w+)(?: or 1 (\w+))?/i.exec(ability.text);
    if (!match) return null;
    const names = [match[1], match[2]].filter((name) => GENERATE_SYMBOL[name]);
    return names.length ? { names } : null;
  }

  function proposeJunctionGenerate(seat, uid, abilityIndex, ability, name) {
    dispatch("MANUAL_PROPOSE", seat, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [
        { op: "setCommitted", uid, value: true },
        { op: "addBuffer", seat, symbol: GENERATE_SYMBOL[name], amount: 1 },
      ],
      reason: `assisted: ${ability.text}`,
    });
  }

  // ---------------------------------------------------------------- render

  function renderZone(id, v, uids, options) {
    const container = document.getElementById(id);
    container.innerHTML = "";
    const nodes = [];
    const list = Array.isArray(uids) ? uids : [];
    for (const uid of list) nodes.push(cardNode(v, uid, options));
    if (!Array.isArray(uids) && uids && uids.n) {
      for (let i = 0; i < uids.n; i++) nodes.push(el("div", "gcard facedown"));
    }
    for (const node of nodes) container.append(node);
    arcZone(nodes, options && options.arc);
  }

  /* Which rail of the Network a permanent belongs on. Avatars are the bodies —
   * they attack and they block — so they get the rail nearest the clash lane.
   * Everything that pays for them or supports them (Resources, Hardware,
   * Protocols) sits on the back rail. The test is the SAME one that decides
   * whether a card wears a stats badge, so the invariant a player can see is:
   * every card with numbers on it is on the Avatar rail.
   *
   * Two things do not read from the card: a token's own profile is not carried
   * into the redacted view (E1-273's Swarm Drone keeps the SOURCE card's
   * cardId), and a facedown Network permanent is a masked deploy, which is a
   * 2/2 Avatar whatever the card underneath says. Both fight, so both go up. */
  const netRail = (v, uid) => {
    const object = v.objects[uid];
    if (!object || !object.cardId) return "avatar";
    if (object.token || object.facedown) return "avatar";
    return compiled(object.cardId).isAvatar ? "avatar" : "resource";
  };

  /* A back-rail card is small, so its art alone stops answering "what does
   * this pay in". The rail says it in Plate icons along the card's footer.
   * Read LIVE from the engine, never from the printed card: affinity rewrites
   * are a real effect and the rail must not lie about the current identity. */
  function railAffinity(v, uid, node) {
    let names = [];
    try {
      names = E.affinitiesOf(v, E.resolveCtx({}), uid) || [];
    } catch (error) {
      names = [];
    }
    const strip = el("span", "netaff");
    for (const name of names) {
      const key = GENERATE_SYMBOL[name];
      if (!key || !SYMBOL_ICON[key]) continue; // Neutral has no plate
      const slot = el("i", "pip-" + key);
      const icon = el("img", null);
      icon.src = `../art/resources/${SYMBOL_ICON[key]}.svg`;
      icon.alt = name;
      slot.append(icon);
      strip.append(slot);
    }
    if (strip.children && strip.children.length) node.append(strip);
  }

  /* The Network as two readable rails instead of one crowd.
   *
   * The DOM stays FLAT — every card is still a DIRECT child of the zone —
   * because the arrow layer, the drag handler and the client tests all read
   * the zone's children. So the split is a wrapped flex line: each card
   * carries its rail class, CSS `order` sorts them, and one full-width break
   * element forces the wrap between them. That break has no dataset.uid and no
   * child image, so every children-scanning reader steps straight over it.
   *
   * arcZone is called once PER RAIL with that rail's own nodes: one call
   * across both would bow a single arc over the whole zone and the rails would
   * lean into each other. */
  function renderNetwork(id, v, uids, options) {
    const container = document.getElementById(id);
    container.innerHTML = "";
    const rails = { avatar: [], resource: [] };
    const list = Array.isArray(uids) ? uids : [];
    for (const uid of list) {
      const rail = netRail(v, uid);
      const node = cardNode(v, uid, options);
      if (node.classList) node.classList.add(rail === "avatar" ? "netavt" : "netres");
      if (rail === "resource") railAffinity(v, uid, node);
      rails[rail].push(node);
      container.append(node);
    }
    // An empty rail must not reserve a gap: on turn one there is one row and
    // no caption, so the break exists only while both rails are occupied.
    if (rails.avatar.length && rails.resource.length) {
      // Captions the rail BELOW it, on both sides, so the divider always
      // introduces what comes next in reading order.
      container.append(el("div", "netcut", (options && options.cutLabel) || ""));
    }
    arcZone(rails.avatar, options && options.arc);
    arcZone(rails.resource, options && options.resourceArc);
  }

  /* Cards sit on an arc, never a rank. "ring": the row bows toward the clash
   * lane, centre card proud. "fan": a held hand — edges drop away and every
   * card tilts around a low pivot. Written as CSS vars per card so committed
   * rotation and hover pop compose on top instead of fighting inline styles. */
  function arcZone(nodes, arc) {
    if (!arc) return;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const style = nodes[i].style;
      if (!style || !style.setProperty) continue; // the test DOM has no CSSOM
      const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0; // -1 … 1 across the row
      const lift = arc.mode === "fan" ? t * t * arc.depth : (1 - t * t) * arc.depth;
      style.setProperty("--rot", `${(t * arc.spread).toFixed(2)}deg`);
      style.setProperty("--lift", `${lift.toFixed(1)}px`);
    }
  }

  function render() {
    const full = session.full;
    if (!full) return;
    const seat = uiSeat(full);
    const v = viewNow();               // the table renders the redacted view
    const foe = 1 - seat;

    /* The name is whoever the table is speaking to, which in remote play is
     * always you — so the turn owner is named separately whenever it is not the
     * same person. Hotseat gets it too: the defender speaks during blockers. */
    const turnchip = document.getElementById("turnchip");
    turnchip.innerHTML = "";
    turnchip.append(
      "Turn ", el("b", null, String(v.turn.number)),
      " · ", el("b", null, v.seats[seat].name)
    );
    if (v.turn.active !== seat) turnchip.append(" · ", `${v.seats[v.turn.active].name}'s turn`);
    if (v.result) {
      const outcome = v.result.reason === "draw" ? "draw" : `${v.seats[v.result.winners[0]].name} wins`;
      turnchip.append(" · ", el("b", null, outcome));
    }

    const ribbon = document.getElementById("phases");
    ribbon.innerHTML = "";
    const here = E.TURN_RIBBON.findIndex(
      (slot) => slot.phase === v.turn.phase && (slot.step === null || slot.step === v.turn.step)
    );
    E.TURN_RIBBON.forEach((slot, index) => {
      ribbon.append(el("div", "phase" + (index === here ? " active" : index < here ? " done" : ""), slot.label));
    });

    for (const [side, who] of [["you", seat], ["foe", foe]]) {
      document.getElementById(`${side}Bar`).classList.toggle("seat-target", wantsSeatTarget());
      document.getElementById(`${side}Name`).textContent = v.seats[who].name;
      const uptime = v.seats[who].uptime;
      document.getElementById(`${side}Uptime`).textContent = uptime;
      const uptimeMeter = document.getElementById(`${side}UptimeMeter`);
      const uptimeRatio = Math.max(0, Math.min(100, uptime / 20 * 100));
      if (uptimeMeter) {
        if (uptimeMeter.style && uptimeMeter.style.setProperty) {
          uptimeMeter.style.setProperty("--uptime-ratio", `${Math.round(uptimeRatio * 10) / 10}%`);
        }
        if (uptimeMeter.setAttribute) uptimeMeter.setAttribute("aria-valuenow", String(uptime));
        uptimeMeter.classList.toggle("offline", uptime <= 0);
        uptimeMeter.classList.toggle("critical", uptime > 0 && uptime <= 5);
        uptimeMeter.classList.toggle("low", uptime > 5 && uptime <= 10);
        uptimeMeter.classList.toggle("boosted", uptime > 20);
      }
      const uptimeStatus = document.getElementById(`${side}UptimeStatus`);
      if (uptimeStatus) {
        uptimeStatus.textContent = uptime <= 0
          ? "OFFLINE"
          : uptime <= 5 ? "CRITICAL" : uptime <= 10 ? "DEGRADED" : uptime > 20 ? "BOOSTED" : "ONLINE";
      }
      document.getElementById(`${side}Counts`).textContent =
        `Stack ${v.zoneCounts[`${who}:stack`]} · Wallet ${v.zoneCounts[`${who}:wallet`]} · Archive ${v.zoneCounts[`${who}:archive`]}` +
        (v.seats[who].stats.manualRejected ? ` · rejected ${v.seats[who].stats.manualRejected}` : "");
      const buffer = document.getElementById(`${side}Buffer`);
      buffer.innerHTML = "";
      for (const key of [...SYMBOLS, "N"]) {
        if (!v.seats[who].buffer[key]) continue;
        const pip = el("span", "pip pip-" + key, `${v.seats[who].buffer[key]}`);
        if (SYMBOL_ICON[key]) {
          const icon = el("img", null);
          icon.src = `../art/resources/${SYMBOL_ICON[key]}.svg`;
          icon.alt = key;
          pip.append(icon);
        } else {
          pip.append(` ${key}`);
        }
        buffer.append(pip);
      }
    }

    const plan = previewClash(v);
    const blocking = Boolean(v.awaiting && v.awaiting.kind === "blockers" && v.awaiting.seat === seat);

    /* Their side reads top-down: Resources first, then the Avatars sitting on
     * the edge of the clash lane. Ours is the mirror of it (Avatars on top),
     * so on both boards the fighters face each other across the Queue and no
     * attack arrow has to cross its own back rail. The row order itself is
     * CSS `order`; the label is the caption of the rail below the line. */
    renderNetwork("foeNetwork", v, v.zones[`${foe}:network`], {
      // Same hand on the enemy board: left acts (select the attacker to
      // block), right explains. Details were left-click-only here before,
      // which broke the one rule the rest of the table teaches.
      onClick: (uid) => toggleBlock(v, uid),
      onContext: (uid, event) => openCardDetail(v, seat, uid, false, pt(event)),
      arc: { mode: "ring", spread: -4, depth: 14 },
      // The back rail is a short row: the same bow at the same depth would
      // read as a wobble across two or three cards, so it is flatter.
      resourceArc: { mode: "ring", spread: -3, depth: 7 },
      cutLabel: "Avatars",
      mark: (uid) => {
        // An attacker still looking for a blocker is the thing to click next.
        const unblocked = blocking && v.clash.attackers.indexOf(uid) >= 0 && !(blocks[uid] || []).length;
        return (plan.dying.has(uid) ? "willdie " : "") + (unblocked ? "needsblock" : "");
      },
    });
    renderNetwork("youNetwork", v, v.zones[`${seat}:network`], {
      // Same hand as the Wallet: left acts, right explains. During the
      // attackers step the left click is the attack declaration instead.
      /* One handler owns the click, so a step never gets two answers. The
       * blockers case used to live in a separate capture listener on the
       * zone, which meant clicking your Avatar to block ALSO ran
       * activateFromBoard on it — assigning the block and firing the card. */
      onClick: (uid, event) => {
        const awaiting = v.awaiting && v.awaiting.seat === seat ? v.awaiting.kind : null;
        if (toggleAwaitingSelection(v, seat, uid)) return;
        if (awaiting === "attackers") return void toggleAttacker(uid);
        if (awaiting === "blockers") return void assignBlocker(uid);
        activateFromBoard(v, seat, uid, pt(event));
      },
      onContext: (uid, event) => openCardDetail(v, seat, uid, false, pt(event)),
      canAct: (uid) => actGlow(v, seat, uid),
      canAttack: (uid) => attackGlow(v, seat, uid),
      arc: { mode: "ring", spread: 4, depth: -14 },
      resourceArc: { mode: "ring", spread: 3, depth: -7 },
      cutLabel: "Resources",
      mark: (uid) => {
        const marks = [];
        if (awaitingSelection.indexOf(uid) >= 0) marks.push("selected");
        if (plan.dying.has(uid)) marks.push("willdie");
        // While an attacker is picked, say which Avatars may legally answer it
        // instead of letting the player find out by being refused.
        if (blocking && blockTarget && !blockingWhat(uid)) {
          let legal = false;
          try {
            legal = E.canBlock({ state: v, ctx: E.resolveCtx({}) }, uid, blockTarget);
          } catch (error) {
            legal = false;
          }
          marks.push(legal ? "canblock" : "cantblock");
        }
        return marks.join(" ");
      },
    });
    renderZone("youHand", v, v.zones[`${seat}:wallet`], {
      onClick: (uid, event) => beginPlay(v, seat, uid, pt(event)),
      onContext: (uid, event) => openCardDetail(v, seat, uid, true, pt(event)),
      canPlay: (uid) => playGlow(v, seat, uid),
      arc: { mode: "fan", spread: 13, depth: 20 },
    });
    renderQueue(v);
    renderTurnButton(v, seat);
    coachStep(v, seat);
    renderZone("foeHand", v, v.zones[`${foe}:wallet`], { arc: { mode: "fan", spread: -8, depth: -10 } });

    renderPrompt(v, seat);
    renderChoice(v, seat);
    renderManualPanel(v, seat);

    const logBox = document.getElementById("log");
    logBox.innerHTML = "";
    for (const event of session.events.slice(0, 70)) {
      const line = describe(event);
      if (!line) continue;
      logBox.append(el("div", "logline " + (line[1] || ""), line[0]));
    }

    const resourceChip = document.getElementById("resourceChip");
    const resourceSpent = v.turn.resourcePlays.used >= v.turn.resourcePlays.allowed;
    resourceChip.textContent = resourceSpent ? "Resource play used" : "Resource play free";
    resourceChip.classList.toggle("quiet", resourceSpent);
    document.getElementById("continue").textContent = continueLabel(v, seat);

    /* The simplest UI is the one that is not there: escape hatches appear
     * only while there is something to escape from. */
    document.getElementById("cancelTarget").hidden =
      !picking && !attackers.length && !Object.keys(blocks).length && blockTarget === null;
    document.getElementById("clearManual").hidden =
      !(v.manualOpen || []).some((entry) => entry.seat === seat);

    renderHud(v, seat);
    renderClashStrip(v, seat, plan);
    renderQuickClash(v, seat);
    renderMeshGroup(v, seat);
    // While a clash step is open the Avatars are draggable, so a touch on one
    // must pull a line rather than scroll the page.
    const youZone = document.getElementById("youNetwork");
    if (youZone && youZone.classList) {
      const draggable = Boolean(
        v.awaiting && v.awaiting.seat === seat &&
        (v.awaiting.kind === "attackers" || v.awaiting.kind === "blockers")
      );
      youZone.classList.toggle("draggable", draggable);
    }
    drawClashArrows();
  }

  /* The arithmetic nobody should have to do in their head: what gets through,
   * and who does not come back. Same numbers the engine will produce. */
  function renderClashStrip(v, seat, plan) {
    const strip = document.getElementById("clashStrip");
    if (!strip) return;
    const show = Boolean(plan.rows.length) && v.turn.phase === "clash" && !v.result;
    strip.hidden = !show;
    if (!show) return;
    strip.innerHTML = "";
    const chip = (cls, text) => strip.append(el("span", cls, text));
    chip("cs-label", "If this resolves");

    const defender = v.seats[plan.defenderSeat];
    const hitting = plan.defenderSeat === seat ? "you take" : `${defender.name} takes`;
    chip(plan.toPlayer ? "cs-hit" : "cs-none", `${hitting} ${plan.toPlayer}`);
    if (plan.toPlayer >= defender.uptime) chip("cs-lethal", "lethal");

    let mine = 0;
    let theirs = 0;
    for (const uid of plan.dying) {
      if (!v.objects[uid]) continue;
      if (v.objects[uid].controller === seat) mine += 1;
      else theirs += 1;
    }
    if (theirs) chip("cs-kill", `they lose ${theirs}`);
    if (mine) chip("cs-loss", `you lose ${mine}`);
    if (!mine && !theirs) chip("cs-none", "nothing dies");
  }

  /* One button for the tedious part of the step: sending everything, or
   * taking every block back. It never confirms — Continue still does that.
   * The label is rendered here; the behaviour is installed once at init, so
   * the listener is not rebuilt on every frame. */
  function renderQuickClash(v, seat) {
    const button = document.getElementById("quickClash");
    if (!button) return;
    const awaiting = v.awaiting && v.awaiting.seat === seat ? v.awaiting.kind : null;
    if (awaiting === "attackers") {
      const eligible = (v.zones[`${seat}:network`] || []).filter((uid) => attackGlow(v, seat, uid));
      button.hidden = !eligible.length;
      button.textContent = `Send all ${eligible.length}`;
    } else if (awaiting === "blockers") {
      const assigned = Object.keys(blocks).reduce((n, key) => n + blocks[key].length, 0);
      button.hidden = !assigned;
      button.textContent = `Clear ${assigned} block${assigned === 1 ? "" : "s"}`;
    } else {
      button.hidden = true;
    }
  }

  function quickClashAction() {
    const full = session.full;
    if (!full || full.result) return;
    const seat = uiSeat(full);
    const v = viewNow();
    const awaiting = v.awaiting && v.awaiting.seat === seat ? v.awaiting.kind : null;
    if (awaiting === "attackers") {
      for (const uid of v.zones[`${seat}:network`] || []) {
        if (attackGlow(v, seat, uid) && attackers.indexOf(uid) < 0) attackers.push(uid);
      }
      return void render();
    }
    if (awaiting === "blockers") {
      blocks = {};
      blockTarget = null;
      render();
    }
  }

  /* One line that answers "where are we, and what can I do": the active
   * phase, whose move it is, and live counts fed by the same glow logic
   * the cards themselves use. */
  function renderHud(v, seat) {
    const slot = E.TURN_RIBBON.find(
      (entry) => entry.phase === v.turn.phase && (entry.step === null || entry.step === v.turn.step)
    );
    document.getElementById("hudPhase").textContent = slot ? slot.label : v.turn.phase;
    document.getElementById("hudWho").textContent = v.result
      ? "Game over"
      : v.turn.active === seat
        ? `${v.seats[seat].name} — your move`
        : `${v.seats[v.turn.active].name}'s turn`;
    const can = document.getElementById("hudCan");
    can.innerHTML = "";
    const chip = (text, cls) => can.append(el("span", `cando${cls ? " " + cls : ""}`, text));
    if (v.result) return;
    const playable = (v.zones[`${seat}:wallet`] || []).filter((uid) => playGlow(v, seat, uid)).length;
    if (picking) chip("pick a target", "attack");
    if (v.awaiting && v.awaiting.seat === seat && v.awaiting.kind === "attackers") {
      const ready = (v.zones[`${seat}:network`] || []).filter((uid) => attackGlow(v, seat, uid)).length;
      chip(ready + attackers.length ? `${ready + attackers.length} can attack` : "no attackers ready", ready + attackers.length ? "attack" : "quiet");
    }
    if (v.awaiting && v.awaiting.seat === seat && v.awaiting.kind === "blockers") chip("assign blocks", "attack");
    chip(playable ? `${playable} playable` : "nothing to play", playable ? "" : "quiet");
  }

  /* A drag in progress: which card is being pulled, what the pull means, and
   * where the pointer is. `moved` is what separates a drag from a click — a
   * pointer that never travelled is still a click, and the click path stays
   * the primary one. */
  let dragging = null;

  /* Attacks and blocks are lines you can see: ember arrows from attackers to
   * the player they are sent at, violet arrows from blockers to attackers.
   * Pending declarations are dashed; the engine's word is solid. */
  function drawClashArrows() {
    if (!document.createElementNS || !document.querySelector) return; // test DOM
    const lines = document.getElementById("arrowLines");
    if (!lines) return;
    while (lines.firstChild) lines.removeChild(lines.firstChild);
    const full = session.full;
    if (!full || full.result) return;
    const v = viewNow();
    const seat = uiSeat(full);
    const inClash = v.turn.phase === "clash";
    const rectOf = (sel) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return rect.width || rect.height ? rect : null;
    };
    const top = (r) => ({ x: r.x + r.width / 2, y: r.y + 6 });
    const bottom = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height - 6 });
    const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    const draw = (from, to, kind, pending) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      path.setAttribute("d", `M ${from.x} ${from.y} Q ${from.x + dx / 2 - dy * 0.12} ${from.y + dy / 2 + dx * 0.12} ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", kind === "atk" ? "#ff6a00" : "#17bebb");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("opacity", ".9");
      if (pending) path.setAttribute("stroke-dasharray", "7 5");
      path.setAttribute("marker-end", `url(#arrow${kind === "atk" ? "Atk" : "Blk"})`);
      lines.append(path);
    };
    const cardRect = (uid) => rectOf(`.gcard[data-uid="${uid}"]`);
    const declared = inClash ? v.clash.attackers : [];
    for (const uid of new Set([...declared, ...attackers])) {
      const rect = cardRect(uid);
      const object = v.objects[uid];
      if (!rect || !object) continue;
      const mine = object.controller === seat;
      const barRect = rectOf(mine ? "#foeBar" : "#youBar");
      if (!barRect) continue;
      draw(mine ? top(rect) : bottom(rect), center(barRect), "atk", declared.indexOf(uid) < 0);
    }
    const pairs = [];
    for (const [atk, list] of Object.entries(inClash ? v.clash.blocks : {})) {
      for (const blocker of list) pairs.push([blocker, atk, false]);
    }
    for (const [atk, list] of Object.entries(blocks)) {
      for (const blocker of list) pairs.push([blocker, atk, true]);
    }
    for (const [blocker, atk, pending] of pairs) {
      const from = cardRect(blocker);
      const to = cardRect(atk);
      if (from && to) draw(center(from), center(to), "blk", pending);
    }

    // The line you are currently pulling, following the pointer.
    if (dragging && dragging.moved) {
      const rect = cardRect(dragging.uid);
      if (rect) {
        draw(center(rect), { x: dragging.x, y: dragging.y }, dragging.kind === "attack" ? "atk" : "blk", true);
      }
    }
  }

  /* Drag an Avatar at what it should fight: onto the opponent to attack, onto
   * an attacker to block it. The same declarations the clicks make — this is
   * the gesture, not a second rulebook. Below the movement threshold nothing
   * happens here and the click handler does its usual job. */
  function installClashDrag() {
    const zone = document.getElementById("youNetwork");
    if (!zone || !zone.addEventListener) return;
    let suppressClick = false;

    const dragKind = () => {
      const full = session.full;
      if (!full || full.result) return null;
      const seat = uiSeat(full);
      if (!full.awaiting || full.awaiting.seat !== seat) return null;
      if (full.awaiting.kind === "attackers") return "attack";
      if (full.awaiting.kind === "blockers") return "block";
      return null;
    };

    /* A drop does not always produce a click — release outside a target, or
     * on a surface that swallows it, and none arrives. Arming the suppressor
     * for exactly one interaction, and disarming it when the next one begins,
     * is what stops a stale flag from eating a legitimate click later. */
    window.addEventListener("pointerdown", () => { suppressClick = false; }, true);

    zone.addEventListener("pointerdown", (event) => {
      const node = event.target && event.target.closest ? event.target.closest(".gcard") : null;
      if (!node || !node.dataset || !node.dataset.uid) return;
      const kind = dragKind();
      if (!kind) return;
      dragging = { uid: node.dataset.uid, kind, x: event.clientX, y: event.clientY, moved: false };
    });

    window.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      if (Math.abs(event.clientX - dragging.x) > 6 || Math.abs(event.clientY - dragging.y) > 6) {
        dragging.moved = true;
      }
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      if (dragging.moved) drawClashArrows();
    });

    window.addEventListener("pointerup", (event) => {
      const drag = dragging;
      dragging = null;
      if (!drag) return;
      if (!drag.moved) return void drawClashArrows(); // it was a click after all
      suppressClick = true; // the click that follows a drag must not act twice

      const target = document.elementFromPoint
        ? document.elementFromPoint(event.clientX, event.clientY)
        : null;
      const within = (selector) => Boolean(target && target.closest && target.closest(selector));
      const droppedCard = target && target.closest ? target.closest(".gcard") : null;
      const droppedUid = droppedCard && droppedCard.dataset ? droppedCard.dataset.uid : null;

      if (drag.kind === "attack") {
        // Anywhere on the opponent's side means "go at them".
        if (within("#foeBar") || within("#foeNetwork") || within("#foeHand")) {
          if (attackers.indexOf(drag.uid) < 0) return void toggleAttacker(drag.uid);
        }
        return void render();
      }

      const full = session.full;
      const attacking = full && full.clash ? full.clash.attackers : [];
      if (droppedUid && attacking.indexOf(droppedUid) >= 0) {
        blockTarget = droppedUid;
        return void assignBlocker(drag.uid);
      }
      render();
    });

    window.addEventListener(
      "click",
      (event) => {
        if (!suppressClick) return;
        suppressClick = false;
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
      },
      true
    );
  }

  function continueLabel(v, seat) {
    const spec = currentPickSpec();
    if (spec && spec.variable) return `Confirm ${picking.targets.length} target(s)`;
    if (v.awaiting && v.awaiting.seat === seat) {
      if (v.awaiting.kind === "attackers") return "Declare attackers";
      if (v.awaiting.kind === "blockers") return "Declare blocks";
      if (v.awaiting.kind === "order") return "Confirm order";
      if (v.awaiting.kind === "damage") return "Assign damage";
      if (v.awaiting.kind === "discard") return "Discard";
      if (v.awaiting.kind === "unlock") return "Unlock chosen cards";
      if (v.awaiting.kind === "sovereignDamage") return `Archive ${v.awaiting.amount} cards`;
      if (v.awaiting.kind === "tombstoneCleanup") return "Remove Tombstone marks";
      if (v.awaiting.kind === "remotePlay") return "Play chosen card";
    }
    return "Continue";
  }

  /* A pending choice gets real buttons. Until now the only choices were
   * pre-seeded by the affinity buttons, so a raised choice soft-locked the
   * human — with optional costs ("you may pay 1…") they are routine. */
  function renderChoice(v, seat) {
    const row = document.getElementById("choiceRow");
    if (!row) return;
    row.innerHTML = "";
    /* Picking a card ON THE QUEUE (the set's counterspells): the Queue has no
     * board zone of its own, so its items appear here as buttons. */
    if (picking && currentPickSpec() && currentPickSpec().kind === "queue") {
      for (const item of v.queue) {
        if (!item.cardId) continue;
        const button = el("button", "btn ghost", `→ ${nameOf(item.cardId)}`);
        button.addEventListener("click", () => offerTarget({ kind: "queue", qid: item.qid }));
        row.append(button);
      }
      return;
    }
    const choice = v.pendingChoice;
    if (!choice || !choice.options || choice.seat !== seat) {
      choiceSelection = [];
      choiceSelectionId = null;
      if (v.awaiting && v.awaiting.seat === seat && v.awaiting.kind === "drawReplacement") {
        const draw = el("button", "btn ghost", "Draw a card");
        draw.addEventListener("click", () => dispatch("CHOOSE_DRAW", seat, { skip: false }));
        const skip = el("button", "btn ghost", "Skip draw — gain protection");
        skip.addEventListener("click", () => dispatch("CHOOSE_DRAW", seat, { skip: true }));
        row.append(draw, skip);
      }
      if (!v.awaiting && v.priority && v.priority.seat === seat && (v.effects || []).some(
        (effect) => effect.kind === "uptimeResourceAbility" && effect.controller === seat
      )) {
        const uptime = el("button", "btn ghost", "Pay 1 Uptime → 1 neutral Resource");
        uptime.addEventListener("click", () => dispatch("ACTIVATE_UPTIME_RESOURCE", seat, {}));
        row.append(uptime);
      }
      return;
    }
    if (choiceSelectionId !== choice.id) {
      choiceSelectionId = choice.id;
      choiceSelection = [];
    }
    const immediate = choice.min === 1 && choice.max === 1;
    choice.options.forEach((option, index) => {
      const object = option.uid && v.objects[option.uid];
      const label =
        option.label ||
        (option.symbol
          ? SYMBOL_NAME[option.symbol] || option.symbol
          : option.value || (object && object.cardId ? nameOf(object.cardId) : `Option ${index + 1}`));
      const selectedAt = choiceSelection.indexOf(index);
      const prefix = choice.kind === "order" && selectedAt >= 0 ? `${selectedAt + 1}. ` : "";
      const button = el("button", "btn ghost" + (selectedAt >= 0 ? " active" : ""), prefix + label);
      button.addEventListener("click", () => {
        if (immediate) return void dispatch("CHOOSE", seat, { choiceId: choice.id, selection: [index] });
        const at = choiceSelection.indexOf(index);
        if (at >= 0) choiceSelection.splice(at, 1);
        else if (choiceSelection.length < choice.max) choiceSelection.push(index);
        render();
      });
      row.append(button);
    });
    if (!immediate) {
      const allowed = choiceSelection.length >= choice.min && choiceSelection.length <= choice.max;
      const confirm = el("button", "btn" + (allowed ? " primary" : " ghost"),
        choiceSelection.length ? `Confirm ${choiceSelection.length}` : "Choose none");
      confirm.disabled = !allowed;
      confirm.addEventListener("click", () => {
        if (!allowed) return;
        const selection = choiceSelection.slice();
        choiceSelection = [];
        dispatch("CHOOSE", seat, { choiceId: choice.id, selection });
      });
      row.append(confirm);
    }
  }

  function selectedMesh(v) {
    const selected = attackers.filter((uid) => v.objects[uid]);
    const meshCount = selected.filter((uid) => {
      try {
        return E.keywordsOf(v, E.resolveCtx({}), uid).indexOf("Mesh") >= 0;
      } catch (error) {
        return false;
      }
    }).length;
    return { selected, legal: selected.length >= 2 && meshCount >= 1 && selected.length - meshCount <= 1 };
  }

  function renderMeshGroup(v, seat) {
    const button = document.getElementById("meshGroup");
    if (!button) return;
    const awaiting = v.awaiting && v.awaiting.seat === seat && v.awaiting.kind === "attackers";
    const selection = selectedMesh(v);
    button.hidden = !awaiting || !selection.legal;
    button.textContent = meshGroupActive ? "Split Mesh" : `Form Mesh (${selection.selected.length})`;
    button.classList.toggle("active", meshGroupActive);
  }

  function toggleMeshGroup() {
    const v = viewNow();
    if (!v || !selectedMesh(v).legal) return;
    meshGroupActive = !meshGroupActive;
    session.notice = meshGroupActive
      ? "Mesh formed — if one member is blocked, the whole group is blocked."
      : null;
    render();
  }

  function toggleAwaitingSelection(v, seat, uid) {
    const awaiting = v.awaiting;
    if (!awaiting || awaiting.seat !== seat) return false;
    const key = `${awaiting.kind}:${v.seq}`;
    if (awaitingSelectionKey !== key) {
      awaitingSelectionKey = key;
      awaitingSelection = awaiting.kind === "unlock" ? (awaiting.required || []).slice() : [];
    }
    let allowed = false;
    let maximum = Infinity;
    if (awaiting.kind === "sovereignDamage") {
      const object = v.objects[uid];
      allowed = Boolean(object && object.controller === seat && !object.token);
      maximum = awaiting.amount;
    } else if (awaiting.kind === "tombstoneCleanup") {
      const task = awaiting.tasks[awaitingSelection.length];
      allowed = Boolean(task && task.options.indexOf(uid) >= 0);
      maximum = awaiting.tasks.length;
    } else if (awaiting.kind === "unlock") {
      allowed = (awaiting.required || []).concat(awaiting.selectable || []).indexOf(uid) >= 0;
      maximum = (awaiting.required || []).length + Object.values(awaiting.caps || {})
        .reduce((sum, count) => sum + count, 0);
    }
    if (!allowed) return false;
    const index = awaitingSelection.indexOf(uid);
    const required = awaiting.kind === "unlock" && (awaiting.required || []).indexOf(uid) >= 0;
    if (index >= 0 && awaiting.kind !== "tombstoneCleanup" && !required) awaitingSelection.splice(index, 1);
    else if (awaitingSelection.length < maximum) awaitingSelection.push(uid);
    render();
    return true;
  }

  function renderPrompt(v, seat) {
    const prompt = document.getElementById("prompt");
    let text;
    let tone = "prompt";
    if (session.notice) {
      text = session.notice;
      tone = "prompt bad";
    } else if (v.result) {
      text = v.result.reason === "draw"
        ? "Both players lost during the same state check — the game is a draw."
        : `${v.seats[v.result.winners[0]].name} wins. Start a new game to play again.`;
      tone = "prompt good";
    } else if (v.pendingManual) {
      text = v.pendingManual.seat === seat
        ? "Waiting for your opponent to accept or reject your proposal."
        : `${v.seats[v.pendingManual.seat].name} proposes: ${v.pendingManual.cardText}`;
      tone = "prompt manual";
    } else if (picking) {
      const spec = currentPickSpec();
      const surface =
        spec.kind === "seat" ? "player bar" : spec.kind === "any" ? "card or player bar" : "card";
      const picked = spec.variable ? ` ${picking.targets.length} selected; Continue confirms.` : "";
      text = `Choose ${spec.prompt} — click a highlighted ${surface}.${picked}`;
      tone = "prompt target";
    } else if (v.pendingChoice && v.pendingChoice.options) {
      text = v.pendingChoice.prompt;
      tone = "prompt target";
    } else if (v.awaiting && v.awaiting.seat === seat) {
      const map = {
        attackers:
          "CLASH — click the glowing Avatars to send them at your opponent, then Continue. " +
          "An Avatar that arrived this turn has Boot Delay and must wait (§5.2).",
        blockers: "click an attacker, then your Avatar, to block. Then Continue.",
        order: "confirm the order your blockers take damage in.",
        damage: "confirm combat damage assignment.",
        unlock: "choose the capped cards to unlock, then Continue.",
        drawReplacement: "choose whether to draw or gain the attack shield.",
        sovereignDamage: `choose ${v.awaiting.amount || 0} non-proxy cards to archive.`,
        tombstoneCleanup: "choose one marked Resource for each archived Tombstone.",
        remotePlay: "choose targets and play the selected opponent card.",
        discard: "your Wallet is over the limit — click cards to discard, then Continue.",
      };
      text = `${v.seats[seat].name}: ${map[v.awaiting.kind] || "act."}`;
      tone = "prompt target";
    } else if (v.manualOpen.length) {
      const open = v.manualOpen[0];
      text = `Assisted — ${v.seats[open.seat].name}: ${open.cardText}`;
      tone = "prompt manual";
    } else if (session.seat !== null && v.priority.seat !== seat) {
      /* Remote only. Hotseat passes the keyboard between seats, so "act" is
       * always addressed to whoever is holding it; a networked seat that cannot
       * act must be told so, or it clicks Continue into a rejection. */
      text = v.priority.seat === null
        ? `Waiting on the other seat — ${v.turn.phase}/${v.turn.step}.`
        : `Waiting for ${v.seats[v.priority.seat].name} — ${v.turn.phase}/${v.turn.step}.`;
    } else {
      text = `${v.seats[seat].name} — ${v.turn.phase}/${v.turn.step}. Play from your Wallet, then Continue.`;
    }
    prompt.textContent = text;
    prompt.className = tone;
  }

  function renderManualPanel(v, seat) {
    const panel = document.getElementById("manualPanel");
    const box = document.getElementById("manualPending");
    panel.hidden = !v.pendingManual && !(v.manualOpen || []).length;
    box.innerHTML = "";
    if (v.pendingManual) {
      const p = v.pendingManual;
      box.append(el("div", "mtitle", `Tier ${p.tier} proposal from ${v.seats[p.seat].name}`));
      box.append(el("div", "mtext", p.cardText || p.reason || ""));
      box.append(el("div", "mdiff", opsText(p.ops)));
      if (p.seat !== seat) {
        const accept = el("button", null, "Accept");
        accept.addEventListener("click", () => dispatch("MANUAL_ACCEPT", seat, { mid: p.mid }));
        const reason = el("input", "mreason");
        reason.placeholder = "reason (optional)";
        const reject = el("button", "ghost", "Reject (card fizzles)");
        reject.addEventListener("click", () =>
          dispatch("MANUAL_REJECT", seat, { mid: p.mid, reason: reason.value }));
        const row = el("div", "manualgrid");
        row.append(accept, reject);
        box.append(reason, row);
      } else {
        const withdraw = el("button", "ghost", "Withdraw");
        withdraw.addEventListener("click", () => dispatch("MANUAL_WITHDRAW", seat, { mid: p.mid }));
        box.append(withdraw);
      }
      return;
    }
    for (const open of v.manualOpen) {
      const row = el("div", "mopen");
      row.append(el("div", "mtext", `${v.seats[open.seat].name}: ${open.cardText}`));
      if (open.seat === seat) {
        const done = el("button", "ghost", "Resolved, no change");
        done.addEventListener("click", () => dispatch("MANUAL_RESOLVE", seat, { mid: open.mid }));
        row.append(done);
      } else {
        const reason = el("input", "mreason");
        reason.placeholder = "why is this disputed?";
        const flag = el("button", "ghost", "⚑ Flag");
        flag.addEventListener("click", () =>
          dispatch("MANUAL_FLAG", seat, { mid: open.mid, reason: reason.value || "disputed" }));
        row.append(reason, flag);
      }
      box.append(row);
    }
  }

  // ------------------------------------------------------------- clash UI

  /* DECLARE_ATTACKERS is one atomic action (§13.1 "at the same time"), so a
   * single ineligible card would make the whole declaration illegal. The UI
   * therefore refuses the click and says why, rather than letting the player
   * build a set the engine will reject as a unit. */
  function toggleAttacker(uid) {
    const index = attackers.indexOf(uid);
    if (index >= 0) {
      attackers.splice(index, 1);
      if (meshGroupActive && !selectedMesh(viewNow()).legal) meshGroupActive = false;
      return void render();
    }
    const v = viewNow();
    if (!E.canAttack({ state: v, ctx: E.resolveCtx({}) }, uid)) {
      const object = v.objects[uid];
      const card = CARD_BY_ID[object.cardId];
      session.notice = !compiled(card.id).isAvatar
        ? `${card.name} is not an Avatar and cannot attack.`
        : object.bootDelay
          ? `${card.name} has Boot Delay until you begin a turn with it (§5.2).`
          : object.committed
            ? `${card.name} is committed and cannot attack.`
            : `${card.name} cannot attack.`;
      return void render();
    }
    attackers.push(uid);
    if (meshGroupActive && !selectedMesh(v).legal) meshGroupActive = false;
    render();
  }

  /* Pending local declarations are the only UI-owned input. The forecast itself
   * comes from engine.js, which simulates the real combat-damage path on a clone. */
  function previewClash(v) {
    const alive = (uid) => Boolean(v.objects[uid]);
    const declared = (attackers.length ? attackers : v.clash.attackers || []).filter(alive);
    const pendingBlocks = {};
    for (const uid of declared) {
      const pending = blocks[uid] || [];
      const confirmed = (v.clash.blocks && v.clash.blocks[uid]) || [];
      pendingBlocks[uid] = (pending.length ? pending : confirmed).filter(alive);
    }
    const plan = E.previewClash(v, { attackers: declared, blocks: pendingBlocks });
    return { ...plan, dying: new Set(plan.dying) };
  }

  let blockTarget = null;
  function toggleBlock(v, uid) {
    const seat = uiSeat(session.full);
    if (!v.awaiting || v.awaiting.kind !== "blockers" || v.awaiting.seat !== seat) {
      return void showInspector(v, uid);
    }
    // Clicking an attacker selects it; clicking your own Avatar assigns it.
    if (v.clash.attackers.indexOf(uid) >= 0) {
      blockTarget = uid;
      session.notice = null;
      return void render();
    }
  }

  /* Which attacker, if any, this Avatar is currently holding off. */
  function blockingWhat(uid) {
    return Object.keys(blocks).find((attacker) => blocks[attacker].indexOf(uid) >= 0) || null;
  }

  function assignBlocker(uid) {
    // A second click takes the blocker back — the same hand as the Wallet,
    // where clicking a declared attacker un-declares it.
    const already = blockingWhat(uid);
    if (already) {
      blocks[already] = blocks[already].filter((u) => u !== uid);
      if (!blocks[already].length) delete blocks[already];
      session.notice = null;
      return void render();
    }
    if (!blockTarget) {
      session.notice = "Click the attacker you want to block first, then the Avatar that blocks it.";
      return void render();
    }
    const v = viewNow();
    // Same reasoning as attackers: the declaration is atomic, and the keyword
    // gates of §14 (Broadcast, Shielded, Backchannel) are checked here so the
    // player learns immediately which blocks are legal.
    if (!E.canBlock({ state: v, ctx: E.resolveCtx({}) }, uid, blockTarget)) {
      const card = CARD_BY_ID[v.objects[uid].cardId];
      session.notice = v.objects[uid].committed
        ? `${card.name} is committed and cannot block (§13.2).`
        : `${card.name} cannot block that attacker — check Broadcast, Shielded or Backchannel.`;
      return void render();
    }
    for (const key of Object.keys(blocks)) blocks[key] = blocks[key].filter((u) => u !== uid);
    blocks[blockTarget] = (blocks[blockTarget] || []).concat([uid]);
    render();
  }

  /* One click on Continue submits whatever the current step is waiting for. */
  function advance() {
    const full = session.full;
    if (!full || full.result) return;
    const seat = uiSeat(full);
    const pickSpec = currentPickSpec();
    if (pickSpec && pickSpec.variable) {
      const minimum = pickSpec.exactX ? (picking.x || 0) : (pickSpec.min || 0);
      if (picking.targets.length < minimum) {
        session.notice = `Choose ${minimum} target(s) before confirming.`;
        return void render();
      }
      return void completePicking();
    }
    const awaiting = full.awaiting;
    if (awaiting && awaiting.seat === seat) {
      if (awaiting.kind === "attackers") {
        const declared = meshGroupActive
          ? attackers.map((uid) => ({ uid, mesh: "mesh-1" }))
          : attackers.slice();
        attackers = [];
        meshGroupActive = false;
        return void dispatch("DECLARE_ATTACKERS", seat, { attackers: declared });
      }
      if (awaiting.kind === "blockers") {
        const declared = {};
        for (const key of Object.keys(blocks)) if (blocks[key].length) declared[key] = blocks[key];
        blocks = {};
        blockTarget = null;
        return void dispatch("DECLARE_BLOCKERS", seat, { blocks: declared });
      }
      if (awaiting.kind === "order") {
        const order = {};
        for (const key of Object.keys(full.clash.blocks)) order[key] = full.clash.blocks[key].slice();
        return void dispatch("ORDER_BLOCKERS", seat, { order });
      }
      if (awaiting.kind === "damage") {
        // null accepts the engine's canonical minimal-lethal-in-order split.
        return void dispatch("ASSIGN_COMBAT_DAMAGE", seat, { assignment: null });
      }
      if (awaiting.kind === "discard") {
        const wallet = full.zones[`${seat}:wallet`];
        const over = wallet.length - full.handLimit;
        return void dispatch("DISCARD_TO_LIMIT", seat, { uids: wallet.slice(0, over) });
      }
      if (awaiting.kind === "triggers") {
        /* ORDER_TRIGGERS must name EVERY waiting pendingId. A full state carries
         * the arrays; a view carries myTriggers, because view()'s counts cannot
         * express an action the seat is obliged to take. Same branch, both. */
        const waiting = full.myTriggers || full.pendingTriggers[String(seat)];
        return void dispatch("ORDER_TRIGGERS", seat, { qids: waiting.map((t) => t.pendingId) });
      }
      if (awaiting.kind === "unlock") {
        const uids = awaitingSelection.length ? awaitingSelection.slice() : (awaiting.required || []).slice();
        awaitingSelection = [];
        return void dispatch("CHOOSE_UNLOCK", seat, { uids });
      }
      if (awaiting.kind === "sovereignDamage") {
        if (awaitingSelection.length !== awaiting.amount) {
          session.notice = `Choose exactly ${awaiting.amount} non-proxy card(s) on your Network.`;
          return void render();
        }
        const uids = awaitingSelection.slice();
        awaitingSelection = [];
        return void dispatch("CHOOSE_SOVEREIGN_ARCHIVE", seat, { uids });
      }
      if (awaiting.kind === "tombstoneCleanup") {
        if (awaitingSelection.length !== awaiting.tasks.length) {
          session.notice = "Choose one marked Resource for each Tombstone.";
          return void render();
        }
        const uids = awaitingSelection.slice();
        awaitingSelection = [];
        return void dispatch("CHOOSE_TOMBSTONE_CLEANUP", seat, { uids });
      }
      if (awaiting.kind === "remotePlay") return void beginRemotePlay(full, seat);
    }
    if (full.priority.seat === null) {
      session.notice = "Waiting on a pending decision.";
      return void render();
    }
    if (session.seat !== null && full.priority.seat !== session.seat) {
      // Sending it would be a correct NOT_YOUR_SEAT rejection; saying so here is
      // faster and quieter than a round trip.
      session.notice = `Waiting for ${full.seats[full.priority.seat].name}.`;
      return void render();
    }
    dispatch("PASS_PRIORITY", full.priority.seat);
  }

  // --------------------------------------------------------- remote / lobby

  /* Everything below is the networked table. It shares the whole board, the log
   * wording, the click-gathering and the FX with the local game above — the only
   * difference is where a state change comes from. Nothing here runs unless the
   * player asks for a table or already holds one, which is what keeps play.html
   * a working offline hotseat from file:// with no server. */

  const NET = globalThis.E1Net;
  const remote = {
    over: null,        // the OVER message, kept so the result can be signed later
    agreement: null,   // pending | confirmed | disputed, from the referee
    invite: null,      // the invite we joined from, if any (for the accept event)
    unsubscribe: null,
    catalogOk: true,
  };

  const $ = (id) => document.getElementById(id);
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
    const foe = session.seat === null ? null : NET.peers[1 - session.seat];
    chip.hidden = false;
    chip.textContent = `${who} · ${label}` + (foe === false ? " · opponent away" : "");
    chip.className = "turnchip netchip" + (NET.status === "live" ? "" : " stale");
  }

  function renderNetPanel() {
    const panel = $("netPanel");
    if (!panel) return;
    panel.hidden = session.role === "hotseat";
    if (panel.hidden) return;
    const state = NET.lastState;
    const info = $("netInfo");
    info.innerHTML = "";
    if (!state) return;
    const line = (text) => info.append(el("div", "netline", text));
    line(`Match ${state.matchId}${state.code ? " · code " + state.code : ""}`);
    for (const p of state.players || []) {
      const tag = p.pubkey ? " · " + nostr().shortNpub(p.pubkey) : " · identity missing";
      line(`Seat ${p.seat}: ${p.name || "—"}${tag} · ${p.online ? "online" : "away"}`);
    }
    if (state.downgraded) line(`Spectating — ${state.downgradeReason || "seat taken"}.`);
    if (remote.over) {
      const v = remote.over.verify || {};
      line(`Verified from the referee's database: ${v.ok ? "OK" : "FAILED"}`);
      line(`publicHash ${String(remote.over.publicHash).slice(0, 16)}…`);
    }
    if (remote.agreement) line(`Result agreement: ${remote.agreement}`);
    $("publishResult").hidden = !(remote.over && nostr().hasNip07() && session.seat !== null);
    $("publishAccept").hidden = !(session.seat === 1 && !remote.over && nostr().hasNip07());
  }

  /* A view is only renderable against the same card set the referee used. The
   * engine would fail CATALOG_MISMATCH on the first click anyway; saying so
   * before the first click is the difference between a bug and a banner. */
  function checkCatalog(msg) {
    if (!msg.catalogDigest) return true;
    let mine;
    try {
      mine = E.buildCatalog(CARDS).digest;
    } catch (error) {
      return true; // if we cannot compute it, do not invent a failure
    }
    remote.catalogOk = mine === msg.catalogDigest;
    if (!remote.catalogOk) {
      netNotice(`Card set mismatch — this table runs ${msg.catalogDigest}, this browser has ${mine}. Reload with a matching build before playing.`, "bad");
    }
    return remote.catalogOk;
  }

  function adoptState(msg) {
    checkCatalog(msg);
    session.seat = msg.seat === 0 || msg.seat === 1 ? msg.seat : null;
    session.role = msg.role === "spectator" ? "spectator" : "seat";
    session.awaitingSeq = null;
    session.notice = null;
    picking = null;
    attackers = [];
    meshGroupActive = false;
    blocks = {};
    blockTarget = null;
    if (msg.view) {
      session.full = msg.view;
      // The referee ships events oldest-first; this log unshifts, so reverse once.
      session.events = (msg.events || []).slice().reverse();
    }
    if (msg.result) remote.agreement = remote.agreement || null;

    /* A result belongs to ONE match. Sitting down at a new table without
     * pressing Leave must not leave the previous match's bytes under the
     * "Publish result" button, which would sign a finished match a second time. */
    if (msg.status !== "over" || (remote.over && remote.over.matchId !== msg.matchId)) {
      remote.over = null;
      remote.agreement = null;
    }

    /* THE CLOSING BEAT SURVIVES A RELOAD. The referee used to hand out the
     * signable bytes exactly once, in the live OVER, so a seat that was away or
     * merely refreshed could never publish its own result and the agreement
     * counter could never leave "none". A finished match now carries them in
     * every STATE, so adopt them whenever we do not already hold them. */
    if (msg.status === "over" && msg.resultContent && !remote.over) {
      remote.over = {
        matchId: msg.matchId,
        result: msg.result,
        headHash: msg.headHash || null,
        publicHash: msg.publicHash || null,
        transcriptHash: msg.transcriptHash || null,
        verify: msg.verify || null,
        resultContent: msg.resultContent,
        resultTags: msg.resultTags,
        resultCreatedAt: msg.resultCreatedAt,
      };
    }

    if (msg.status === "open" && msg.downgraded) {
      /* THE PERSON FOLLOWING THE HOST'S SHARE LINK CAME TO PLAY. They arrive
       * with no token but with a NIP-07 identity, so the referee downgrades them to a
       * spectator — of an empty table. Showing them the HOST panel then left
       * both people staring at the same screen waiting for the other to join.
       * The referee says whether the seat is still free; offer it. */
      $("setup").hidden = false;
      $("table").hidden = true;
      $("hostPanel").hidden = true;
      if (msg.code) $("joinCode").value = msg.code;
      netNotice(
        msg.claimable
          ? "This table is waiting for a second player — press Join to take seat 1."
          : "This table is full. You are watching.",
        msg.claimable ? "good" : ""
      );
    } else if (msg.status === "open") {
      // The table exists on the server before any invite is published: a relay
      // failure can never block a match starting.
      $("setup").hidden = false;
      $("table").hidden = true;
      $("hostPanel").hidden = false;
      $("tableCode").textContent = msg.code || "------";
      netNotice(`Table open. Read the code aloud, publish the invite, or send this link: ${matchLink(msg)}`, "good");
    } else if (session.full) {
      $("setup").hidden = true;
      $("table").hidden = false;
      render();
    }
    renderNetChip();
    renderNetPanel();
    renderLobbyButtons();
  }

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

  const NET_HANDLERS = {
    onState: adoptState,

    onFrame(msg) {
      session.full = msg.view;
      session.awaitingSeq = null;
      session.notice = null;
      for (const event of msg.events || []) {
        session.events.unshift(event);
        fx(event);
      }
      if (session.events.length > 240) session.events.length = 240;
      render();
      renderNetChip();
    },

    onReject(msg) {
      /* Codes, not prose the transport invented — and the fresh view means a
       * desynced client is corrected in the same message it is scolded by. */
      session.notice = msg.message || msg.code;
      if (msg.view) session.full = msg.view;
      session.awaitingSeq = null;
      picking = null;
      render();
    },

    onPeer() {
      renderNetChip();
      renderNetPanel();
    },

    onOver(msg) {
      remote.over = msg;
      renderNetPanel();
      renderNetChip();
    },

    onNostr(msg) {
      if (msg.role !== "result") return;
      remote.agreement = msg.agreement;
      renderNetPanel();
    },

    onStatus() {
      renderNetChip();
    },

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
        NO_TABLE: "This page is not being served by a table. Open it from the referee (npm run table), or pass ?table=ws://host:8777/ws.",
      }[msg.code] || msg.message || msg.code;
      netNotice(text, "bad");
      session.notice = text;
      if (session.full) render();
      renderNetChip();
    },
  };

  // ---- lobby actions ------------------------------------------------------

  const lobbyName = () => ($("netName").value || "Player").slice(0, 40);
  const lobbyAffinity = () => $("netAffinity").value;

  function createTable() {
    if (!NET.tableUrl()) return void NET_HANDLERS.onError({ code: "NO_TABLE" });
    const pubkey = nostr().savedPubkey();
    if (!pubkey) return void NET_HANDLERS.onError({ code: "NIP07_REQUIRED" });
    netNotice("Opening a table…", "");
    NET.create({ name: lobbyName(), affinity: lobbyAffinity(), pubkey });
  }

  function joinTable(code, invite) {
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
        item.append(el("span", null, `${row.code} · ${row.name} · ${row.affinity}`));
        const button = el("button", "btn ghost", "Join");
        button.addEventListener("click", () => joinTable(row.code));
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

  // ---- the three signed moments -------------------------------------------

  async function signAndSend(role, unsigned) {
    try {
      const signed = await nostr().sign(unsigned);
      const res = await nostr().publish(signed);
      NET.sendNostr(role, signed); // the referee records it verbatim either way
      netNotice(res.ok
        ? `Published to ${res.accepted.length}/${res.tried} relays.`
        : `No relay accepted the ${role}. The match is unaffected — nostr is the announcement, never the gate.`,
        res.ok ? "good" : "");
    } catch (error) {
      netNotice(`Signing was declined — ${role} not published. The match is unaffected.`, "");
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

  function publishAccept() {
    const state = NET.lastState;
    if (!state) return;
    const host = (state.players || []).find((p) => p.seat === 0);
    signAndSend("accept", nostr().acceptEvent({
      matchId: state.matchId,
      invite: remote.invite ? remote.invite.id : null,
      table: NET.publicTable(),
      name: lobbyName(),
      affinity: lobbyAffinity(),
      to: host ? host.pubkey : null,
    }));
  }

  function publishResult() {
    if (!remote.over) return;
    // Both players sign the referee's exact bytes, so agreement is a string
    // compare rather than two browsers hoping to re-serialise identically.
    signAndSend("result", nostr().resultEvent(remote.over));
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
   * your own code into the join box used to seat one connection at BOTH seats,
   * which killed the table and locked the real opponent out for good. The
   * referee refuses it now; the button simply stops offering. */
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

    $("nostrLogin").addEventListener("click", login);
    $("nostrLogout").addEventListener("click", () => { nostr().logout(); renderIdentity(); });
    $("createTable").addEventListener("click", createTable);
    $("joinTable").addEventListener("click", () => joinTable());
    $("refreshTables").addEventListener("click", refreshTables);
    $("checkInvites").addEventListener("click", checkInvites);
    $("publishInvite").addEventListener("click", publishInvite);
    $("publishAccept").addEventListener("click", publishAccept);
    $("publishResult").addEventListener("click", publishResult);
    $("copyCode").addEventListener("click", () => {
      const state = NET.lastState;
      if (state) navigator.clipboard.writeText(matchLink(state)).then(
        () => netNotice("Link copied.", "good"),
        () => netNotice(matchLink(state), "")
      );
    });
    $("forceResume").addEventListener("click", () => {
      NET.resume();
      netNotice("Resynced from the referee.", "");
    });
    $("leaveTable").addEventListener("click", () => {
      NET.leave();
      session.seat = null;
      session.role = "hotseat";
      session.full = null;
      remote.over = null;
      remote.agreement = null;
      $("table").hidden = true;
      $("setup").hidden = false;
      $("hostPanel").hidden = true;
      renderNetChip();
      renderIdentity();
    });

    /* The panic button the runbook asks for: a forced RESUME without hunting
     * for the panel. Ignored while typing into a field. */
    window.addEventListener("keydown", (event) => {
      if (event.key !== "r" || !event.ctrlKey || !event.altKey) return;
      if (session.role === "hotseat") return;
      event.preventDefault();
      NET.resume();
    });

    renderIdentity();
    /* Auto-open only if this page already holds a match (localStorage or a
     * ?match= link). A cold play.html opens no socket at all. */
    const started = NET.start(NET_HANDLERS);
    if (started.resuming) netNotice("Rejoining your table…", "");
    else if (started.loginRequired) netNotice("Sign in with NIP-07 to open this table.", "bad");
  }

  // -------------------------------------------------------------- setup

  function startGame() {
    const seedInput = document.getElementById("seed").value.trim();
    // The engine generates no randomness of its own: every seed is an input.
    // A blank field is turned into one here, in the UI, where that is allowed.
    const base = seedInput ? (Number(seedInput) | 0) : (crypto.getRandomValues(new Int32Array(1))[0] | 0);
    const npcBox = document.getElementById("npcB");
    const solo = Boolean(npcBox && npcBox.checked);
    const nameB = document.getElementById("nameB").value || (solo ? "NPC" : "Player 2");
    // A "custom:<name>" choice is a Stack saved by the Stack Builder: the
    // explicit decklist goes to the engine, which validates it (min 40, no
    // Stake cards) before a single object is minted.
    const stacks = (() => {
      try {
        return JSON.parse(localStorage.getItem("600b:decks")) || {};
      } catch (error) {
        return {};
      }
    })();
    const choose = (value) => {
      const precons = globalThis.E1_PRECONS || {};
      if (value && value.startsWith("precon:") && precons[value.slice(7)]) {
        return { deck: precons[value.slice(7)].cards.slice() };
      }
      if (value && value.startsWith("custom:") && Array.isArray(stacks[value.slice(7)])) {
        return { deck: stacks[value.slice(7)].slice() };
      }
      return { affinity: value };
    };
    const config = {
      seats: [
        { name: document.getElementById("nameA").value || "Player 1", ...choose(document.getElementById("deckA").value) },
        { name: solo && nameB === "Player 2" ? "NPC" : nameB, ...choose(document.getElementById("deckB").value) },
      ],
      seeds: { public: base, hidden: [(base ^ 0x5f3759df) | 0, (base + 7717) | 0] },
      firstPlayer: 0,
      policy: { freeform: "deny" },
    };
    session.npc = solo ? 1 : null;
    // "All" is a fine stack but no answer to "generate 1 of one affinity";
    // a custom Stack answers with its own dominant affinity.
    const prefAffinity = (seatConfig) => {
      if (seatConfig.affinity) return seatConfig.affinity !== "All" ? seatConfig.affinity : "Bitcoin";
      const tally = {};
      for (const cardId of seatConfig.deck) {
        const card = CARD_BY_ID[cardId];
        for (const aff of (card && card.affinity) || []) {
          if (aff !== "Neutral") tally[aff] = (tally[aff] || 0) + 1;
        }
      }
      return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || "Bitcoin";
    };
    session.npcAffinity = prefAffinity(config.seats[1]);
    try {
      session.full = E.createGame(config);
      session.config = config; // kept so E1_GAME.verify() can replay the hotseat
    } catch (error) {
      document.getElementById("prompt").textContent = String(error.message || error);
      return;
    }
    /* The stage wears seat one's world plate — the board opens onto the
     * affinity it is about to play. (The test DOM has no querySelector.) */
    if (document.querySelector) {
      const stage = document.querySelector(".stage");
      if (stage) stage.className = `stage plate-${prefAffinity(config.seats[0])}`;
    }
    session.log = [];
    session.events = [];
    session.notice = null;
    session.seat = null;        // hotseat: this table applies its own actions
    session.role = "hotseat";
    session.awaitingSeq = null;
    attackers = [];
    meshGroupActive = false;
    blocks = {};
    picking = null;
    document.getElementById("setup").hidden = true;
    document.getElementById("table").hidden = false;
    if (globalThis.E1FX) globalThis.E1FX.emit("game:start", {});
    render();
    scheduleNpc();
  }

  function init() {
    /* Mount the audio control into the table's control row. Mounting is lazy
     * about the AudioContext: nothing is created until a real user gesture, so
     * this never trips the browser's autoplay policy. */
    if (globalThis.E1FX) {
      try {
        globalThis.E1FX.init({ control: true, parent: document.getElementById("fxControl") });
      } catch (error) {
        void error; // sound is never load-bearing
      }
    }
    const affinities = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock"];
    // Stacks saved by the Stack Builder (site/deck.html) join the affinity
    // presets. Custom Stacks are a local-table feature: the referee mints
    // networked games from affinities, so remote play keeps the presets only.
    const savedStacks = (() => {
      try {
        return JSON.parse(localStorage.getItem("600b:decks")) || {};
      } catch (error) {
        return {};
      }
    })();
    const precons = globalThis.E1_PRECONS || {};
    for (const id of ["deckA", "deckB"]) {
      const select = document.getElementById(id);
      for (const name of affinities) {
        const option = el("option", null, name === "All" ? "All affinities" : name);
        option.value = name;
        select.append(option);
      }
      // The precon library: curated, fully scripted Stacks, ready on turn one.
      for (const shelf of ["Starter", "Classic"]) {
        const names = Object.keys(precons).filter((name) => precons[name].group === shelf);
        if (!names.length) continue;
        const group = document.createElement("optgroup");
        group.label = shelf === "Starter" ? "Starter Stacks" : "Classic library";
        for (const name of names) {
          const option = el("option", null, `${name} · ${precons[name].affinity}`);
          option.value = `precon:${name}`;
          group.append(option);
        }
        select.append(group);
      }
      const names = Object.keys(savedStacks).sort();
      if (names.length) {
        const group = document.createElement("optgroup");
        group.label = "Saved Stacks";
        for (const name of names) {
          const option = el("option", null, `${name} (${savedStacks[name].length})`);
          option.value = `custom:${name}`;
          group.append(option);
        }
        select.append(group);
      }
      select.value = id === "deckA" ? "Power" : "Signal";
    }
    document.getElementById("start").addEventListener("click", startGame);
    document.getElementById("continue").addEventListener("click", advance);

    document.getElementById("coachNext").addEventListener("click", () => {
      coachIndex += 1;
      if (coachIndex >= COACH_STEPS.length) finishCoach();
      else coachStep();
    });
    document.getElementById("coachSkip").addEventListener("click", finishCoach);
    coachStep(); // the lobby step, for a first visit

    /* Rugpull = concede with the setting's own word for it. The win goes to
     * the player who did NOT rugpull (§2.2: concession). It lives with the
     * table admin controls, not the gameplay row, and asks before it fires —
     * it is the one action in the game that cannot be answered or undone. */
    document.getElementById("rugpull").addEventListener("click", () => {
      const full = session.full;
      if (!full || full.result || session.role === "spectator") return;
      if (!window.confirm("Rugpull? The game ends immediately and the win goes to the other player.")) return;
      const seat =
        session.seat !== null
          ? session.seat
          : session.npc !== null
            ? 1 - session.npc
            : uiSeat(full);
      dispatch("CONCEDE", seat, {});
    });

    document.getElementById("endturn").addEventListener("click", () => {
      // Not a single action: the turn machine advances only via PASS_PRIORITY,
      // so "End turn" is a burst of them that stops at the first real decision.
      // Remote, the burst is one action: the referee answers asynchronously, so
      // the next pass can only be decided by the FRAME that has not arrived yet.
      if (session.seat !== null) return void advance();
      const startTurn = session.full && session.full.turn.active;
      for (let i = 0; i < 60; i++) {
        const full = session.full;
        if (!full || full.result || full.turn.active !== startTurn) break;
        if (full.priority.seat === null && !full.awaiting) break;
        if (full.pendingManual || full.pendingChoice) break;
        const before = full.seq;
        advance();
        if (session.full.seq === before) break; // rejected: stop rather than spin
      }
    });

    document.getElementById("cancelTarget").addEventListener("click", () => {
      picking = null;
      attackers = [];
      meshGroupActive = false;
      blocks = {};
      blockTarget = null;
      session.notice = null;
      render();
    });

    // The playerbars are static HTML, so the target handler installs once and
    // checks at click time whether a player is currently a legal choice.
    for (const side of ["you", "foe"]) {
      document.getElementById(`${side}Bar`).addEventListener("click", () => {
        if (!wantsSeatTarget() || !session.full) return;
        const seat = uiSeat(session.full);
        offerTarget({ kind: "seat", seat: side === "you" ? seat : 1 - seat });
      });
    }

    document.getElementById("quickClash").addEventListener("click", quickClashAction);
    document.getElementById("meshGroup").addEventListener("click", toggleMeshGroup);
    installClashDrag();

    // Fewer clicks: the waiting Queue is itself the Continue button, and the
    // space bar is Continue for hands that never leave the keyboard.
    document.getElementById("queue").addEventListener("click", advance);

    // The arrow layer measures screen positions, so scrolling or resizing
    // moves the endpoints out from under it: redraw on both, coalesced.
    let arrowFrame = null;
    const redrawArrows = () => {
      if (arrowFrame !== null || typeof requestAnimationFrame !== "function") return;
      arrowFrame = requestAnimationFrame(() => {
        arrowFrame = null;
        drawClashArrows();
      });
    };
    window.addEventListener("scroll", redrawArrows, { passive: true });
    window.addEventListener("resize", redrawArrows);
    window.addEventListener("keydown", (event) => {
      if (event.key !== " " || !session.full) return;
      const tag = ((event.target && event.target.tagName) || "").toLowerCase();
      if (["input", "textarea", "select", "button", "summary", "a"].indexOf(tag) >= 0) return;
      if (document.querySelector && document.querySelector(".ctxmenu")) return;
      const detail = document.getElementById("cardDetail");
      if (detail && detail.open) return;
      event.preventDefault();
      advance();
    });

    document.getElementById("clearManual").addEventListener("click", () => {
      const full = session.full;
      if (!full) return;
      const seat = uiSeat(full);
      const mine = full.manualOpen.find((entry) => entry.seat === seat);
      if (mine) dispatch("MANUAL_RESOLVE", seat, { mid: mine.mid });
    });

    /* Every data-manual button becomes a one-op MANUAL_PROPOSE: same clicks,
     * same feel, every one now landing in the chain with an author. */
    document.querySelectorAll("[data-manual]").forEach((button) => {
      button.addEventListener("click", () => {
        const full = session.full;
        if (!full) return;
        const seat = uiSeat(full);
        const [verb, arg] = button.dataset.manual.split(":");
        const side = button.dataset.side === "foe" ? 1 - seat : seat;
        if (verb === "uptime") {
          propose(seat, [{ op: "addUptime", seat: side, delta: Number(arg) }], `Uptime ${arg} for ${full.seats[side].name}`);
        } else if (verb === "generate") {
          propose(seat, [{ op: "addBuffer", seat: side, symbol: arg, amount: 1 }], `generate 1 ${SYMBOL_NAME[arg]}`);
        } else if (verb === "draw") {
          propose(seat, [{ op: "moveTopOfStack", seat: side, count: 1, toZone: "wallet" }], "draw a card");
        }
      });
    });

    document.getElementById("cardCount").textContent = CARDS.length;

    // Last, and guarded: a missing net.js must not take the hotseat down with it.
    if (globalThis.E1Net) {
      try {
        initNet();
      } catch (error) {
        console.error("lobby init failed — the local game is unaffected", error);
      }
    }
  }

  window.addEventListener("DOMContentLoaded", init);

  /* Exposed for the console and for the transport: in hotseat `state` is the
   * authoritative state and `log` is the chained transcript that replays it; in
   * remote play `state` is this seat's VIEW and the transcript lives on the
   * referee (GET /api/match/:id, and in the OVER message). */
  window.E1_GAME = {
    get state() { return session.full; },
    get log() { return session.log; },
    get mode() { return session.role; },
    get seat() { return session.seat; },
    get over() { return remote.over; },
    net: globalThis.E1Net || null,
    view: (seat) => E.view(session.full, seat),
    hash: () => E.hashState(session.full),
    publicHash: () => E.publicHash(session.full),
    verify: () => E.verifyMatch({ config: session.config, log: session.log }),
    /* The clash preview, exposed so a test can play the fight out and prove
     * the numbers on screen are the numbers the engine will produce. */
    preview: () => (session.full ? previewClash(viewNow()) : null),
    startGame,
    dispatch,
  };
})();
