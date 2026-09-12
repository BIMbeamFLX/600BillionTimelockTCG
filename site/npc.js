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
 *
 * Under the Fast profile there are no Resources to play or commit and no Clash
 * to declare: the bot plays what its pool affords — aiming single-target cards
 * at the opponent's things when they hurt and at its own when they help — and
 * then sends each ready Avatar at the best target it sees.
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
    const ctx = { state, ctx: E.resolveCtx({}, state) };
    const attackers = (state.clash && state.clash.attackers) || [];
    const defenders = zoneOf(state, seat, "network").slice();
    const used = new Set();
    const blocks = {};
    const byThreat = attackers.slice().sort((a, b) => {
      const sa = E.statsOf(state, E.resolveCtx({}, state), a) || { action: 0 };
      const sb = E.statsOf(state, E.resolveCtx({}, state), b) || { action: 0 };
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

  /* Ops that hurt whatever they target. A single-target card with one of these
   * aims at the opponent first; every other targeted card aims at the bot's
   * own side first. The engine still judges legality — this only orders tries. */
  const HARMFUL_OPS = new Set([
    "damage", "divideDamage", "decommission", "coldStorage", "bounce", "toggleCommitted",
    "drainBuffer", "stealGeneratedBuffer", "discard", "invalidate", "invalidateByCostX",
    "gridEruption", "finalSettlement", "feeSpike", "routeMisdirection", "setAffinity", "rewriteWords",
  ]);

  const isFast = (E, state) => Boolean(E.profileOf) && E.profileOf(state).id === "fast";

  /* Fast target tries for a card with exactly one target: objects and seats on
   * the side the card is meant for, biggest Avatar first, then the other side. */
  function targetTries(E, state, seat, card) {
    const ctx = E.resolveCtx({}, state);
    const harmful = card.playOps.some((op) => HARMFUL_OPS.has(op.op));
    const sides = harmful ? [1 - seat, seat] : [seat, 1 - seat];
    const tries = [];
    for (const side of sides) {
      const objects = zoneOf(state, side, "network").slice().sort((a, b) => {
        const power = (uid) => {
          try {
            return E.statsOf(state, ctx, uid).action || 0;
          } catch (error) {
            return 0;
          }
        };
        return power(b) - power(a);
      });
      for (const uid of objects) tries.push([{ kind: "object", uid }]);
      tries.push([{ kind: "seat", seat: side }]);
    }
    return tries;
  }

  /* Fast attacks, ranked per ready Avatar: lethal to the face; otherwise the
   * best trade it wins (kills and survives), then an even trade worth at least
   * what it costs; otherwise the face. With a Firewall in the way and no
   * Broadcast, only a Firewall is on the list. */
  function planAttacks(E, state, seat, compiled) {
    const ctx = E.resolveCtx({}, state);
    const env = { state, ctx };
    const opponent = 1 - seat;
    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch (error) {
        return fallback;
      }
    };
    const stats = (uid) => safe(() => E.statsOf(state, ctx, uid), { action: 0, resilience: 0 });
    const has = (uid, keyword) => safe(() => E.keywordsOf(state, ctx, uid).indexOf(keyword) >= 0, false);
    const left = (uid) => stats(uid).resilience - (state.objects[uid].damage || 0);
    const ready = zoneOf(state, seat, "network")
      .filter((uid) => safe(() => E.canAttack(env, uid), false))
      .sort((a, b) => stats(b).action - stats(a).action);
    if (!ready.length) return [];
    const theirs = zoneOf(state, opponent, "network").filter((uid) => {
      const object = state.objects[uid];
      const card = object && object.cardId ? compiled(object.cardId) : null;
      return Boolean(card && card.isAvatar);
    });
    const firewalls = theirs.filter((uid) => has(uid, "Firewall"));
    const power = ready.reduce((sum, uid) => sum + Math.max(0, stats(uid).action), 0);
    const lethal = !firewalls.length && power >= state.seats[opponent].uptime;
    const face = { kind: "seat", seat: opponent };
    const moves = [];
    for (const attacker of ready) {
      const strength = Math.max(0, stats(attacker).action);
      const toughness = left(attacker);
      const walled = firewalls.length > 0 && !has(attacker, "Broadcast");
      if (lethal) moves.push({ attacker, target: face });
      const pool = walled ? firewalls : theirs;
      const trades = pool
        .map((uid) => ({
          uid,
          kills: strength >= left(uid),
          survives: stats(uid).action < toughness || (has(attacker, "First Strike") && strength >= left(uid)),
          worth: Math.max(0, stats(uid).action) + left(uid),
        }))
        .filter((trade) => trade.kills)
        .sort((a, b) => Number(b.survives) - Number(a.survives) || b.worth - a.worth || (a.uid < b.uid ? -1 : 1));
      for (const trade of trades) {
        if (walled || trade.survives || trade.worth >= strength + toughness) {
          moves.push({ attacker, target: { kind: "object", uid: trade.uid } });
        }
      }
      if (walled) {
        for (const uid of firewalls) moves.push({ attacker, target: { kind: "object", uid } });
      } else {
        moves.push({ attacker, target: face });
      }
    }
    return moves;
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
        const ctx = { state, ctx: E.resolveCtx({}, state) };
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
      /* THE NPC FROZE HERE. `unlock` is the very first step of every turn, and
       * nothing answered it — so the moment a board held a card whose unlock is
       * a CHOICE rather than automatic, the opponent stopped playing and the
       * game sat there forever. It went unseen because the old deck builder
       * sampled with replacement and dealt 23 unique cards out of 40, so the
       * cards that ask this question were rarely in play; a deck of 40 distinct
       * cards meets them constantly.
       *
       * `caps` limits how many of each type may be unlocked, so the greedy
       * "take everything selectable" answer is often illegal. Unlocking as much
       * as the caps allow is both legal and right — a committed permanent is a
       * permanent that cannot act. */
      if (awaiting.kind === "unlock") {
        const required = (awaiting.required || []).slice();
        const selectable = (awaiting.selectable || []).filter((uid) => required.indexOf(uid) < 0);
        const caps = awaiting.caps || {};
        const used = {};
        const picked = required.slice();
        for (const uid of selectable) {
          const object = state.objects[uid];
          const card = object && object.cardId ? compiled(object.cardId) : null;
          // The engine keys caps by type ("Avatar", "Resource", …); the old
          // "Other" bucket never matched, so a capped unlock was always refused.
          const kind = !card ? "Other" : card.isResource ? "Resource" : card.isAvatar ? "Avatar" : card.type;
          const cap = caps[kind];
          if (cap !== undefined) {
            used[kind] = used[kind] || 0;
            if (used[kind] >= cap) continue;
            used[kind] += 1;
          }
          picked.push(uid);
        }
        push("CHOOSE_UNLOCK", { uids: picked });
        // Falling back to the required minimum keeps a legal answer available
        // even if a cap is expressed in a way the loop above did not expect.
        push("CHOOSE_UNLOCK", { uids: required });
      }
      // The engine names this prompt "drawReplacement"; "draw" is kept for old states.
      if (awaiting.kind === "draw" || awaiting.kind === "drawReplacement") push("CHOOSE_DRAW", { skip: false });
      /* Three prompts the policy used to leave unanswered, each a stall. */
      if (awaiting.kind === "remotePlay") {
        const card = compiled(awaiting.cardId);
        const modes = card && card.playModes ? card.playModes.map((mode, index) => index) : [null];
        const payer = awaiting.payer === undefined ? seat : awaiting.payer;
        for (const mode of modes) {
          const spec = card && (mode === null ? card.playTargetSpec : card.playModes[mode].targetSpec) || [];
          const tries = spec.length === 1 ? targetTries(E, state, payer, card) : [[]];
          for (const targets of tries) {
            push("REMOTE_PLAY_CARD", mode === null ? { targets } : { targets, modes: [mode] });
          }
        }
      }
      if (awaiting.kind === "sovereignDamage") {
        const own = zoneOf(state, seat, "network").filter((uid) => state.objects[uid] && !state.objects[uid].token);
        push("CHOOSE_SOVEREIGN_ARCHIVE", { uids: own.slice(0, awaiting.amount) });
      }
      if (awaiting.kind === "tombstoneCleanup") {
        push("CHOOSE_TOMBSTONE_CLEANUP", { uids: awaiting.tasks.map((task) => task.options[0]) });
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

    if (isFast(E, state)) return fastCandidates(E, state, seat, compiled, out, push);

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

    /* 2 — commit resources for Buffer, but only toward a live plan, and only
     * in the bot's own Build phases. Buffer with no purpose is not thrift —
     * it is §12.1 burn, and the old unconditional commit bled the bot a point
     * of Uptime at nearly every phase boundary (also in the OPPONENT's turn,
     * where it generated with nothing it could legally play). The bot now
     * simulates its generators one by one and stops at the first prefix that
     * makes some hand card payable; no reachable card, no generation. */
    const inOwnBuild =
      state.turn.active === seat &&
      (state.turn.phase === "build1" || state.turn.phase === "build2");
    if (inOwnBuild) {
      const generators = [];
      for (const uid of network) {
        const object = state.objects[uid];
        if (!object || object.committed) continue;
        const card = compiled(object.cardId);
        if (!card) continue;
        card.abilities.forEach((ability, abilityIndex) => {
          if (!ability.resourceAbility || ability.manual) return;
          const payload = { uid, abilityIndex };
          let symbol = null;
          let amount = 0;
          for (const op of ability.ops) {
            if (op.op !== "generate") continue;
            if (op.affinity === "choice") {
              // Prefer the stack's own affinity when the card offers it;
              // otherwise take the first affinity the card names.
              const offered =
                Array.isArray(op.options) && op.options.length
                  ? op.options
                  : ["Power", "Bitcoin", "Keys", "Signal", "Timelock"];
              const pick = offered.indexOf(affinity) >= 0 ? affinity : offered[0];
              payload.choice = SYMBOL_OF[pick] ? SYMBOL_OF[pick] : pick;
              symbol = payload.choice;
            } else {
              symbol = SYMBOL_OF[op.affinity] || op.affinity || "N";
            }
            amount += op.amount || 1;
          }
          if (symbol && amount) generators.push({ payload, symbol, amount });
        });
      }
      /* The plan: scripted, target-free, non-X cards only — the same shape
       * step 3 is willing to play. X cards are excluded on purpose: paying
       * into an open-ended X invites exactly the leftover that burns. */
      const wants = wallet
        .map((uid) => compiled(state.objects[uid].cardId))
        .filter(
          (card) =>
            card &&
            !card.isResource &&
            !card.manual &&
            !card.playModes &&
            card.playTargetSpec.length === 0 &&
            !(card.costParsed && card.costParsed.x)
        );
      const sim = Object.assign({}, buffer);
      let need = wants.some((card) => E.canPay(sim, card.costParsed)) ? 0 : -1;
      for (let i = 0; need === -1 && i < generators.length; i++) {
        sim[generators[i].symbol] = (sim[generators[i].symbol] || 0) + generators[i].amount;
        if (wants.some((card) => E.canPay(sim, card.costParsed))) need = i + 1;
      }
      for (let i = 0; i < Math.max(0, need); i++) {
        push("ACTIVATE_RESOURCE_ABILITY", generators[i].payload);
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
        !card.playModes && // modes are a judgement call this policy skips
        card.playTargetSpec.length === 0 &&
        E.canPay(buffer, card.costParsed)
      );
    });
    playable.sort((a, b) => {
      const ca = compiled(state.objects[a].cardId);
      const cb = compiled(state.objects[b].cardId);
      return (cb.isAvatar ? 1 : 0) - (ca.isAvatar ? 1 : 0);
    });
    for (const uid of playable) {
      const card = compiled(state.objects[uid].cardId);
      const payload = { uid, targets: [] };
      if (card.costParsed && card.costParsed.x) {
        // Announce the biggest X the Buffer covers after the fixed part,
        // capped so the bot never dumps its whole economy into one card.
        const pool = Object.values(buffer).reduce((total, n) => total + n, 0);
        const fixed = Object.entries(card.costParsed)
          .filter(([key]) => key !== "x")
          .reduce((total, entry) => total + entry[1], 0);
        const x = Math.max(0, Math.min(3, Math.floor((pool - fixed) / card.costParsed.x)));
        if (!x) continue; // an X card at X=0 is a wasted card
        payload.x = x;
      }
      push("PLAY_CARD", payload);
    }

    /* 4 — nothing left worth doing. */
    push("PASS_PRIORITY");
    return out;
  }

  /* Fast: play what the pool affords, then attack, then pass. Avatars first,
   * then the dearest card, so the curve is spent rather than trickled. */
  function fastCandidates(E, state, seat, compiled, out, push) {
    const buffer = state.seats[seat].buffer;
    const pool = Object.values(buffer).reduce((total, n) => total + n, 0);
    const price = (cost) => (cost ? E.flattenCost(cost) : null);
    const total = (cost) => (cost ? (cost.generic || 0) : 0);
    if (state.turn.active === seat && ["build1", "build2"].indexOf(state.turn.phase) >= 0) {
      const playable = zoneOf(state, seat, "wallet")
        .map((uid) => ({ uid, card: compiled(state.objects[uid].cardId) }))
        .filter(({ card }) =>
          card && !card.isResource && !card.manual && !card.playModes &&
          card.playTargetSpec.length <= 1 && E.canPay(buffer, price(card.costParsed)))
        .sort((a, b) =>
          Number(b.card.isAvatar) - Number(a.card.isAvatar) ||
          total(price(b.card.costParsed)) - total(price(a.card.costParsed)) ||
          (a.uid < b.uid ? -1 : 1));
      for (const { uid, card } of playable) {
        const payload = { uid, targets: [] };
        if (card.costParsed && card.costParsed.x) {
          const fixed = total(price(Object.assign({}, card.costParsed, { x: 0 })));
          const x = Math.max(0, Math.min(3, Math.floor((pool - fixed) / card.costParsed.x)));
          if (!x) continue;
          payload.x = x;
        }
        if (card.playTargetSpec.length === 1) {
          for (const targets of targetTries(E, state, seat, card)) push("PLAY_CARD", Object.assign({}, payload, { targets }));
        } else {
          push("PLAY_CARD", payload);
        }
      }
      for (const move of planAttacks(E, state, seat, compiled)) push("DECLARE_ATTACK", move);
    }
    push("PASS_PRIORITY");
    return out;
  }

  const api = { waitingSeat, candidates, planAttacks };
  globalScope.E1Npc = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
