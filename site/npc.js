/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — NPC opponent policy.
 *
 * A pure move-picker over the referee core: given an unredacted state and a
 * seat, produce a RANKED list of candidate actions. The caller (play.js in the
 * browser, the test harness headless) applies them in order and keeps the
 * first one the engine accepts — the policy never mutates state and never
 * needs to be right about legality, only reasonable about preference.
 *
 * The policy is deliberately simple and fully scripted: it plays its Resource
 * for the turn, commits resources for Buffer, plays what it can afford that
 * needs no targets, attacks with everything eligible, blocks greedily, and
 * accepts every proposal its opponent makes (the honor system, extended to a
 * bot that has no honor to lose). It never proposes manual edits itself.
 * ------------------------------------------------------------------------ */
(function (globalScope) {
  "use strict";

  const SYMBOL_OF = { Power: "P", Bitcoin: "B", Keys: "K", Signal: "S", Timelock: "T" };

  /* Which seat the table is waiting on — the same ladder play.js's uiSeat
   * climbs, restated for an unredacted state. */
  function waitingSeat(state) {
    if (!state || state.result) return null;
    if (state.pendingChoice) return state.pendingChoice.seat;
    if (state.pendingManual) return 1 - state.pendingManual.seat;
    if (state.awaiting) return state.awaiting.seat;
    if (state.priority.seat !== null) return state.priority.seat;
    return state.turn.active;
  }

  function zoneOf(state, seat, zone) {
    return state.zones[`${seat}:${zone}`] || [];
  }

  /* Greedy block plan: walk the attackers biggest-Action-first and spend the
   * first legal, still-unassigned defender on each. One blocker per attacker —
   * gang blocks are a judgement call this policy does not pretend to have. */
  function planBlocks(E, state, seat) {
    const ctx = { state, ctx: E.resolveCtx({}) };
    const attackers = (state.clash && state.clash.attackers) || [];
    const defenders = zoneOf(state, seat, "network").slice();
    const used = new Set();
    const blocks = {};
    const byThreat = attackers.slice().sort((a, b) => {
      const sa = E.statsOf(state, E.resolveCtx({}), a) || { action: 0 };
      const sb = E.statsOf(state, E.resolveCtx({}), b) || { action: 0 };
      return (sb.action || 0) - (sa.action || 0);
    });
    for (const attacker of byThreat) {
      for (const defender of defenders) {
        if (used.has(defender)) continue;
        let legal = false;
        try {
          legal = E.canBlock(ctx, defender, attacker);
        } catch (error) {
          legal = false;
        }
        if (legal) {
          blocks[attacker] = [defender];
          used.add(defender);
          break;
        }
      }
    }
    return blocks;
  }

  /* The ranked candidate list. `compiled` is a cardId -> compiled-card lookup
   * (play.js passes its cache; tests wrap E.compileCard). `prefs.affinity` is
   * the stack affinity the bot answers "choice" resource abilities with. */
  function candidates(E, state, seat, compiled, prefs) {
    const out = [];
    const push = (type, payload) => out.push({ type, payload: payload || {} });
    if (!state || state.result) return out;

    /* A proposal from the opponent: accept it. The bot extends the honor
     * system rather than judging edits it cannot understand. */
    if (state.pendingManual) {
      if (state.pendingManual.seat !== seat) push("MANUAL_ACCEPT", { mid: state.pendingManual.mid });
      return out;
    }

    /* A pending effect choice: take the first legal number of first options. */
    if (state.pendingChoice) {
      if (state.pendingChoice.seat === seat) {
        const min = state.pendingChoice.min || 0;
        const max = state.pendingChoice.max == null ? min : state.pendingChoice.max;
        const count = Math.max(min, Math.min(1, max));
        const selection = [];
        for (let i = 0; i < count && i < state.pendingChoice.options.length; i += 1) selection.push(i);
        push("CHOOSE", { choiceId: state.pendingChoice.id, selection });
      }
      return out;
    }

    const awaiting = state.awaiting;
    if (awaiting && awaiting.seat === seat) {
      if (awaiting.kind === "attackers") {
        const ctx = { state, ctx: E.resolveCtx({}) };
        const eligible = zoneOf(state, seat, "network").filter((uid) => {
          try {
            return E.canAttack(ctx, uid);
          } catch (error) {
            return false;
          }
        });
        push("DECLARE_ATTACKERS", { attackers: eligible });
        push("DECLARE_ATTACKERS", { attackers: [] });
      }
      if (awaiting.kind === "blockers") {
        push("DECLARE_BLOCKERS", { blocks: planBlocks(E, state, seat) });
        push("DECLARE_BLOCKERS", { blocks: {} });
      }
      if (awaiting.kind === "order") {
        const order = {};
        for (const key of Object.keys(state.clash.blocks)) order[key] = state.clash.blocks[key].slice();
        push("ORDER_BLOCKERS", { order });
      }
      if (awaiting.kind === "damage") push("ASSIGN_COMBAT_DAMAGE", { assignment: null });
      if (awaiting.kind === "discard") {
        const wallet = zoneOf(state, seat, "wallet");
        const over = wallet.length - state.handLimit;
        push("DISCARD_TO_LIMIT", { uids: wallet.slice(0, Math.max(0, over)) });
      }
      if (awaiting.kind === "triggers") {
        const waiting = state.pendingTriggers[String(seat)] || [];
        push("ORDER_TRIGGERS", { qids: waiting.map((t) => t.pendingId) });
      }
      return out;
    }

    if (state.priority.seat !== seat) return out;

    const wallet = zoneOf(state, seat, "wallet");
    const network = zoneOf(state, seat, "network");
    const buffer = state.seats[seat].buffer;
    const affinity = (prefs && prefs.affinity) || "Bitcoin";

    /* 1 — the free Resource play for the turn. */
    if (state.turn.active === seat && state.turn.resourcePlays.used < state.turn.resourcePlays.allowed) {
      for (const uid of wallet) {
        const card = compiled(state.objects[uid].cardId);
        if (card && card.isResource) {
          push("PLAY_RESOURCE", { uid });
          break;
        }
      }
    }

    /* 2 — commit resources for Buffer. Junctions answer "choice" ops with the
     * stack's own affinity. */
    for (const uid of network) {
      const object = state.objects[uid];
      if (!object || object.committed) continue;
      const card = compiled(object.cardId);
      if (!card) continue;
      card.abilities.forEach((ability, abilityIndex) => {
        if (!ability.resourceAbility || ability.manual) return;
        const payload = { uid, abilityIndex };
        const choiceOp = ability.ops.find((op) => op.affinity === "choice");
        if (choiceOp) {
          // Prefer the stack's own affinity when the card offers it;
          // otherwise take the first affinity the card names.
          const offered =
            Array.isArray(choiceOp.options) && choiceOp.options.length
              ? choiceOp.options
              : ["Power", "Bitcoin", "Keys", "Signal", "Timelock"];
          const pick = offered.indexOf(affinity) >= 0 ? affinity : offered[0];
          payload.choice = SYMBOL_OF[pick] ? SYMBOL_OF[pick] : pick;
        }
        push("ACTIVATE_RESOURCE_ABILITY", payload);
      });
    }

    /* 2b — any junction still marked assisted (none since the parser learned
     * "generate 1 X or 1 Y", but a future card could regress): the honest
     * route is a static-warrant proposal of exactly the card text — commit as
     * the cost, one Resource as the effect — which the engine bounds by the
     * ability's envelope and the opponent may still reject or flag. */
    for (const uid of network) {
      const object = state.objects[uid];
      if (!object || object.committed) continue;
      const card = compiled(object.cardId);
      if (!card) continue;
      card.abilities.forEach((ability, abilityIndex) => {
        if (!ability.manual || !ability.text) return;
        const match = /generate 1 (\w+)(?: or 1 (\w+))?/i.exec(ability.text);
        if (!match || !/^commit:/i.test(ability.text.trim())) return;
        const names = [match[1], match[2]].filter(Boolean);
        const pick = names.indexOf(affinity) >= 0 ? affinity : names[0];
        const symbol = SYMBOL_OF[pick];
        if (!symbol) return;
        push("MANUAL_PROPOSE", {
          warrant: { kind: "static", uid, abilityIndex },
          ops: [
            { op: "setCommitted", uid, value: true },
            { op: "addBuffer", seat, symbol, amount: 1 },
          ],
          reason: `assisted: ${ability.text}`,
        });
      });
    }

    /* 3 — play what the Buffer can afford. Scripted cards with no targeting
     * requirement only: the bot neither proposes manual edits nor guesses at
     * targets. Avatars first — a board wins clashes, a hand does not. */
    const playable = wallet.filter((uid) => {
      const card = compiled(state.objects[uid].cardId);
      return (
        card &&
        !card.isResource &&
        !card.manual &&
        card.playTargetSpec.length === 0 &&
        E.canPay(buffer, card.costParsed)
      );
    });
    playable.sort((a, b) => {
      const ca = compiled(state.objects[a].cardId);
      const cb = compiled(state.objects[b].cardId);
      return (cb.isAvatar ? 1 : 0) - (ca.isAvatar ? 1 : 0);
    });
    for (const uid of playable) push("PLAY_CARD", { uid, targets: [] });

    /* 4 — nothing left worth doing. */
    push("PASS_PRIORITY");
    return out;
  }

  const api = { waitingSeat, candidates };
  globalScope.E1Npc = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
