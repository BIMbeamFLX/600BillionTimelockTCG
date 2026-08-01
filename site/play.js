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
  };

  /* Local click-gathering. None of this is game state: it is the half-formed
   * intent between the first click and the one action that gets dispatched. */
  let picking = null; // { kind:"play"|"ability", uid, abilityIndex, spec, targets }
  let attackers = [];
  let blocks = {};

  /* Which seat the hotseat table is currently speaking to. Priority rather than
   * turn.active, because the defender acts during the blockers step — and for a
   * pending proposal it is the OPPONENT of the proposer, since they are the one
   * whose verdict the game is waiting on. */
  const uiSeat = (s) =>
    (s.pendingChoice && s.pendingChoice.seat) ??
    (s.pendingManual ? 1 - s.pendingManual.seat : null) ??
    (s.awaiting && s.awaiting.seat) ??
    s.priority.seat ??
    s.turn.active;

  // ------------------------------------------------------------- dispatch

  function dispatch(type, seat, payload) {
    const state = session.full;
    if (!state) return false;
    const action = { type, seat, seq: state.seq, at: "", payload: payload || {} };
    const result = E.apply(state, action);
    if (result.error) {
      // Every rejection used to be a log(..., "warn") line and the click
      // silently did nothing. Now it is a code with a message.
      session.notice = result.error.message;
      render();
      return false;
    }
    session.notice = null;
    const prev = session.log.length ? session.log[session.log.length - 1].hash : state.gameId;
    const stateHash = E.hashState(result.state);
    const entry = { seq: action.seq, seat, at: "", action, prev, stateHash };
    entry.hash = E.entryHash(entry);
    session.log.push(entry);
    session.full = result.state;
    // Events arrive redacted for whichever seat the table is showing.
    for (const event of E.redactEvents(result.events, uiSeat(result.state))) {
      session.events.unshift(event);
    }
    if (session.events.length > 240) session.events.length = 240;
    render();
    return true;
  }

  // ---------------------------------------------------------- log wording

  const nameOf = (cardId) => (CARD_BY_ID[cardId] ? CARD_BY_ID[cardId].name : "a card");
  const seatName = (seat) => (session.full ? session.full.seats[seat].name : `Seat ${seat}`);

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
      case "ATTACKERS": return [p.attackers.length ? `${seatName(p.seat)} attacks with ${p.attackers.length}.` : `${seatName(p.seat)} declares no attackers.`, ""];
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
      case "TOKEN": return ["A token is created.", "good"];
      case "GAME_OVER":
        return [p.reason === "draw" ? "The game is a draw." : `${seatName(p.winners[0])} wins (${p.reason}).`, "good"];
      default: return null;
    }
  }

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

  // ------------------------------------------------------- click intentions

  function beginPlay(v, seat, uid) {
    const object = v.objects[uid];
    if (!object || !object.cardId) return;
    const card = compiled(object.cardId);
    if (card.isResource) return void dispatch("PLAY_RESOURCE", seat, { uid });
    const spec = card.playTargetSpec;
    if (!spec.length) return void dispatch("PLAY_CARD", seat, { uid, targets: [] });
    picking = { kind: "play", uid, spec, targets: [] };
    render();
  }

  function beginAbility(v, seat, uid, abilityIndex, choice) {
    const card = compiled(v.objects[uid].cardId);
    const ability = card.abilities[abilityIndex];
    if (ability.resourceAbility) {
      const payload = { uid, abilityIndex };
      if (choice) payload.choice = choice;
      return void dispatch("ACTIVATE_RESOURCE_ABILITY", seat, payload);
    }
    if (!ability.targetSpec.length) {
      return void dispatch("ACTIVATE_ABILITY", seat, { uid, abilityIndex, targets: [] });
    }
    picking = { kind: "ability", uid, abilityIndex, spec: ability.targetSpec, targets: [] };
    render();
  }

  function offerTarget(target) {
    if (!picking) return false;
    picking.targets.push(target);
    if (picking.targets.length < picking.spec.length) {
      render();
      return true;
    }
    const { kind, uid, abilityIndex, targets } = picking;
    picking = null;
    if (kind === "play") dispatch("PLAY_CARD", uiSeat(session.full), { uid, targets });
    else dispatch("ACTIVATE_ABILITY", uiSeat(session.full), { uid, abilityIndex, targets });
    return true;
  }

  const wantsTarget = (v, uid) => {
    if (!picking) return false;
    const spec = picking.spec[picking.targets.length];
    if (!spec) return false;
    const object = v.objects[uid];
    if (!object || !object.cardId) return false;
    const card = compiled(object.cardId);
    if (spec.kind === "seat") return false;
    if (spec.kind === "avatar" || spec.kind === "any") return card.isAvatar;
    if (spec.kind.indexOf("type:") === 0) return card.type.indexOf(spec.kind.slice(5)) >= 0;
    return true;
  };

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
    const blocking = Object.keys(v.clash.blocks).some((a) => v.clash.blocks[a].indexOf(uid) >= 0) ||
      Object.keys(blocks).some((a) => blocks[a].indexOf(uid) >= 0);
    if (blocking) node.classList.add("blocking");

    const img = el("img");
    img.src = faceUrl(card);
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

    node.addEventListener("click", () => {
      if (wantsTarget(v, uid)) return void offerTarget({ kind: "object", uid });
      if (options && options.onClick) options.onClick(uid);
    });
    node.addEventListener("mouseenter", () => showInspector(v, uid));
    return node;
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
    img.src = faceUrl(card);
    img.alt = card.name;
    box.append(img);
    const info = el("div", "ibody");
    info.append(el("strong", null, card.name));
    info.append(el("div", "imeta",
      `${card.type}${card.subtype ? " — " + card.subtype : ""} · ${card.affinity.join("/")} · Cost ${card.cost || "—"}`));
    if (card.text) info.append(el("p", "itext", card.text));
    if (card.manual) info.append(el("p", "imanualnote", "Assisted: propose the effect, your opponent sees it."));

    const acts = el("div", "iacts");
    if (object.controller === seat && object.zone.endsWith(":network")) {
      compiled(card.id).abilities.forEach((ability, index) => {
        if (ability.kind !== "activated") return;
        // "generate N Resources of one affinity" needs the affinity picked at
        // activation. One button per affinity beats a modal: it keeps the whole
        // table in the page and never blocks the renderer.
        const needsChoice = ability.resourceAbility && ability.ops.some((op) => op.affinity === "choice");
        if (needsChoice) {
          for (const symbol of SYMBOLS) {
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
      /* The inspector's zone and commit buttons used to be unattributed
       * arbitrary state writes. They are now one-op proposals that land in the
       * chain with an author, and the opponent sees anything that helps you. */
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
    info.append(acts);
    box.append(info);
  }

  /* Every human override routes through one audited, attributed, consent-aware
   * door. A free-form warrant is used for the generic table controls, which is
   * always Tier B and always needs a reason. */
  function propose(seat, ops, reason) {
    dispatch("MANUAL_PROPOSE", seat, { warrant: { kind: "freeform", note: reason }, ops, reason });
  }

  // ---------------------------------------------------------------- render

  function renderZone(id, v, uids, options) {
    const container = document.getElementById(id);
    container.innerHTML = "";
    const list = Array.isArray(uids) ? uids : [];
    for (const uid of list) container.append(cardNode(v, uid, options));
    if (!Array.isArray(uids) && uids && uids.n) {
      for (let i = 0; i < uids.n; i++) container.append(el("div", "gcard facedown"));
    }
  }

  function render() {
    const full = session.full;
    if (!full) return;
    const seat = uiSeat(full);
    const v = E.view(full, seat);      // the table renders the redacted view
    const foe = 1 - seat;

    document.getElementById("turnchip").innerHTML =
      `Turn <b>${v.turn.number}</b> · <b>${v.seats[seat].name}</b>` +
      (v.result ? ` · <b>${v.result.reason === "draw" ? "draw" : v.seats[v.result.winners[0]].name + " wins"}</b>` : "");

    const ribbon = document.getElementById("phases");
    ribbon.innerHTML = "";
    const here = E.TURN_RIBBON.findIndex(
      (slot) => slot.phase === v.turn.phase && (slot.step === null || slot.step === v.turn.step)
    );
    E.TURN_RIBBON.forEach((slot, index) => {
      ribbon.append(el("div", "phase" + (index === here ? " active" : index < here ? " done" : ""), slot.label));
    });

    for (const [side, who] of [["you", seat], ["foe", foe]]) {
      document.getElementById(`${side}Name`).textContent = v.seats[who].name;
      document.getElementById(`${side}Uptime`).textContent = v.seats[who].uptime;
      document.getElementById(`${side}Counts`).textContent =
        `Stack ${v.zoneCounts[`${who}:stack`]} · Wallet ${v.zoneCounts[`${who}:wallet`]} · Archive ${v.zoneCounts[`${who}:archive`]}` +
        (v.seats[who].stats.manualRejected ? ` · rejected ${v.seats[who].stats.manualRejected}` : "");
      const buffer = document.getElementById(`${side}Buffer`);
      buffer.innerHTML = "";
      for (const key of [...SYMBOLS, "N"]) {
        if (!v.seats[who].buffer[key]) continue;
        buffer.append(el("span", "pip pip-" + key, `${v.seats[who].buffer[key]} ${key}`));
      }
    }

    renderZone("foeNetwork", v, v.zones[`${foe}:network`], {
      onClick: (uid) => toggleBlock(v, uid),
    });
    renderZone("youNetwork", v, v.zones[`${seat}:network`], {
      onClick: (uid) => {
        if (v.awaiting && v.awaiting.kind === "attackers" && v.awaiting.seat === seat) toggleAttacker(uid);
        else showInspector(v, uid);
      },
    });
    renderZone("youHand", v, v.zones[`${seat}:wallet`], { onClick: (uid) => beginPlay(v, seat, uid) });
    renderZone("foeHand", v, v.zones[`${foe}:wallet`], {});

    renderPrompt(v, seat);
    renderManualPanel(v, seat);

    const logBox = document.getElementById("log");
    logBox.innerHTML = "";
    for (const event of session.events.slice(0, 70)) {
      const line = describe(event);
      if (!line) continue;
      logBox.append(el("div", "logline " + (line[1] || ""), line[0]));
    }

    document.getElementById("resourceChip").textContent =
      v.turn.resourcePlays.used >= v.turn.resourcePlays.allowed
        ? "Resource play used"
        : "Resource play available";
    document.getElementById("continue").textContent = continueLabel(v, seat);
  }

  function continueLabel(v, seat) {
    if (v.awaiting && v.awaiting.seat === seat) {
      if (v.awaiting.kind === "attackers") return "Declare attackers";
      if (v.awaiting.kind === "blockers") return "Declare blocks";
      if (v.awaiting.kind === "order") return "Confirm order";
      if (v.awaiting.kind === "damage") return "Assign damage";
      if (v.awaiting.kind === "discard") return "Discard";
    }
    return "Continue";
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
      text = `Choose ${picking.spec[picking.targets.length].prompt} — click a highlighted card.`;
      tone = "prompt target";
    } else if (v.pendingChoice && v.pendingChoice.options) {
      text = v.pendingChoice.prompt;
      tone = "prompt target";
    } else if (v.awaiting && v.awaiting.seat === seat) {
      const map = {
        attackers: "click your Avatars to declare attackers, then Continue.",
        blockers: "click an attacker, then your Avatar, to block. Then Continue.",
        order: "confirm the order your blockers take damage in.",
        damage: "confirm combat damage assignment.",
        discard: "your Wallet is over the limit — click cards to discard, then Continue.",
      };
      text = `${v.seats[seat].name}: ${map[v.awaiting.kind] || "act."}`;
      tone = "prompt target";
    } else if (v.manualOpen.length) {
      const open = v.manualOpen[0];
      text = `Assisted — ${v.seats[open.seat].name}: ${open.cardText}`;
      tone = "prompt manual";
    } else {
      text = `${v.seats[seat].name} — ${v.turn.phase}/${v.turn.step}. Play from your Wallet, then Continue.`;
    }
    prompt.textContent = text;
    prompt.className = tone;
  }

  function renderManualPanel(v, seat) {
    const box = document.getElementById("manualPending");
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
      return void render();
    }
    const v = E.view(session.full, uiSeat(session.full));
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
    render();
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

  function assignBlocker(uid) {
    if (!blockTarget) {
      session.notice = "Click the attacker you want to block first.";
      return void render();
    }
    const v = E.view(session.full, uiSeat(session.full));
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
    const awaiting = full.awaiting;
    if (awaiting && awaiting.seat === seat) {
      if (awaiting.kind === "attackers") {
        const declared = attackers.slice();
        attackers = [];
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
        return void dispatch("ORDER_TRIGGERS", seat, {
          qids: full.pendingTriggers[String(seat)].map((t) => t.pendingId),
        });
      }
    }
    if (full.priority.seat === null) {
      session.notice = "Waiting on a pending decision.";
      return void render();
    }
    dispatch("PASS_PRIORITY", full.priority.seat);
  }

  // -------------------------------------------------------------- setup

  function startGame() {
    const seedInput = document.getElementById("seed").value.trim();
    // The engine generates no randomness of its own: every seed is an input.
    // A blank field is turned into one here, in the UI, where that is allowed.
    const base = seedInput ? (Number(seedInput) | 0) : (crypto.getRandomValues(new Int32Array(1))[0] | 0);
    const config = {
      seats: [
        { name: document.getElementById("nameA").value || "Player 1", affinity: document.getElementById("deckA").value },
        { name: document.getElementById("nameB").value || "Player 2", affinity: document.getElementById("deckB").value },
      ],
      seeds: { public: base, hidden: [(base ^ 0x5f3759df) | 0, (base + 7717) | 0] },
      firstPlayer: 0,
    };
    try {
      session.full = E.createGame(config);
    } catch (error) {
      document.getElementById("prompt").textContent = String(error.message || error);
      return;
    }
    session.log = [];
    session.events = [];
    session.notice = null;
    attackers = [];
    blocks = {};
    picking = null;
    document.getElementById("setup").hidden = true;
    document.getElementById("table").hidden = false;
    render();
  }

  function init() {
    const affinities = ["All", "Power", "Bitcoin", "Keys", "Signal", "Timelock"];
    for (const id of ["deckA", "deckB"]) {
      const select = document.getElementById(id);
      for (const name of affinities) {
        const option = el("option", null, name === "All" ? "All affinities" : name);
        option.value = name;
        select.append(option);
      }
      select.value = id === "deckA" ? "Power" : "Signal";
    }
    document.getElementById("start").addEventListener("click", startGame);
    document.getElementById("continue").addEventListener("click", advance);

    document.getElementById("endturn").addEventListener("click", () => {
      // Not a single action: the turn machine advances only via PASS_PRIORITY,
      // so "End turn" is a burst of them that stops at the first real decision.
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
      blocks = {};
      blockTarget = null;
      session.notice = null;
      render();
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

    // Clicking your own Avatar during the blockers step assigns it to the
    // attacker you selected; the network zone handler routes it here.
    document.getElementById("youNetwork").addEventListener("click", (event) => {
      const full = session.full;
      if (!full || !full.awaiting || full.awaiting.kind !== "blockers") return;
      const node = event.target.closest(".gcard");
      if (!node) return;
      const index = Array.from(node.parentNode.children).indexOf(node);
      const uid = full.zones[`${uiSeat(full)}:network`][index];
      if (uid) assignBlocker(uid);
    }, true);

    document.getElementById("cardCount").textContent = CARDS.length;
  }

  window.addEventListener("DOMContentLoaded", init);

  /* Exposed for the console and for future transport code: `full` is the
   * authoritative state, `log` is the chained transcript that replays it. */
  window.E1_GAME = {
    get state() { return session.full; },
    get log() { return session.log; },
    view: (seat) => E.view(session.full, seat),
    hash: () => E.hashState(session.full),
    publicHash: () => E.publicHash(session.full),
    verify: () => E.verifyMatch({ config: null, log: session.log }),
    startGame,
    dispatch,
  };
})();
