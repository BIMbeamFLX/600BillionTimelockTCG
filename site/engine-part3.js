  // --------------------------------------------------- createGame (§7, §8, §18.4)

  const intOr = (value, fallback) => (Number.isInteger(value) ? value : fallback);

  /* Deck construction consumes rng.hidden[seat] in a fixed, documented order:
   * seat 0's deck is built (pool filtered in catalog order) and shuffled, then
   * seat 1's, then seat 0 draws its opening seven, then seat 1. Order of
   * consumption is part of the rules — change it and every seed changes. */
  function buildDeckList(catalog, affinity, stream) {
    const inAffinity = (card) =>
      affinity === "All" ||
      card.affinity.indexOf(affinity) >= 0 ||
      card.affinity.indexOf("Neutral") >= 0;
    const pool = catalog.ids.map((id) => catalog.byId[id]).filter(inAffinity);
    const take = (test, count) => {
      const options = pool.filter(test);
      const out = [];
      if (!options.length) return out;
      for (let i = 0; i < count; i++) out.push(options[nextInt(stream, options.length)].id);
      return out;
    };
    return [
      ...take((c) => c.isResource, 17),
      ...take((c) => c.isAvatar, 14),
      ...take((c) => c.type === "Zap" || c.type === "Operation", 5),
      ...take((c) => c.type === "Hardware" || c.type === "Protocol", 4),
    ];
  }

  function newSeat(config) {
    return {
      name: String(config.name || "Player"),
      pubkey: config.pubkey || null,
      uptime: intOr(config.uptime, START_UPTIME),
      buffer: emptyBuffer(),
      deckCommit: null,
      conceded: false,
      deckedOut: false,
      counters: {},
      autoPass: {
        emptyQueue: config.autoPass ? Boolean(config.autoPass.emptyQueue) : true,
        noLegalResponse: config.autoPass ? Boolean(config.autoPass.noLegalResponse) : false,
      },
      stats: {
        rejectedActions: 0,
        manualProposed: 0,
        manualAccepted: 0,
        manualRejected: 0,
        manualFreeform: 0,
        envelopeViolations: 0,
      },
    };
  }

  function createGame(config, ctx) {
    const context = resolveCtx(ctx);
    const settings = config || {};
    const seatConfigs = settings.seats || [{ name: "Player 1" }, { name: "Player 2" }];
    if (seatConfigs.length !== 2) fail("SCHEMA", "the E1 Classic Profile is exactly two players");
    const seeds = settings.seeds || {};
    if (!Number.isInteger(seeds.public) || !Array.isArray(seeds.hidden) || seeds.hidden.length !== 2) {
      // The factory is pure: it takes every seed as an input and generates none.
      fail("SCHEMA", "config.seeds must be {public:int, hidden:[int,int]}");
    }

    const gameId = settings.gameId || "g_" + sha256hex(canonicalJSON(settings)).slice(0, 12);
    const firstPlayer = settings.firstPlayer === 1 ? 1 : 0;
    const state = {
      v: 1,
      gameId,
      ruleset: settings.ruleset || "E1.0",
      catalogDigest: context.catalog.digest,
      modules: {
        stake: Boolean(settings.modules && settings.modules.stake),
        toss: Boolean(settings.modules && settings.modules.toss),
      },
      policy: Object.assign({}, DEFAULT_POLICY, settings.policy || {}),
      seq: 0,
      prevHash: null,
      status: "playing",
      result: null,
      seats: seatConfigs.map(newSeat),
      objects: {},
      nextUid: 1,
      zones: {},
      queue: [],
      nextQid: 1,
      turn: {
        number: 1,
        active: firstPlayer,
        firstPlayer,
        phase: "open",
        step: "unlock",
        resourcePlays: { used: 0, allowed: 1 },
        repeatCleanup: false,
      },
      priority: { seat: null, passed: [false, false], window: "setup" },
      clash: emptyClash(),
      awaiting: null,
      pendingChoice: null,
      pendingTriggers: { 0: [], 1: [] },
      pendingManual: null,
      manualOpen: [],
      manualBudgetUsed: [0, 0],
      nextMid: 1,
      nextChoiceId: 1,
      effects: [],
      nextEid: 1,
      handLimit: intOr(settings.handLimit, HAND_LIMIT),
      rng: {
        public: newStream(seeds.public),
        hidden: [newStream(seeds.hidden[0]), newStream(seeds.hidden[1])],
      },
    };
    for (const seat of [0, 1]) {
      for (const zone of ZONE_NAMES) state.zones[zoneKey(seat, zone)] = [];
    }

    const env = { state, ctx: context, events: [] };
    for (const seat of [0, 1]) {
      const seatConfig = seatConfigs[seat];
      const stream = state.rng.hidden[seat];
      const deck = Array.isArray(seatConfig.deck) && seatConfig.deck.length
        ? seatConfig.deck.slice()
        : buildDeckList(context.catalog, seatConfig.affinity || "All", stream);
      // An illegal decklist is the cheapest cheat there is; it never reaches
      // the table. Validate before a single object is minted.
      if (deck.length < MIN_STACK) fail("SCHEMA", `seat ${seat} Stack is ${deck.length}, minimum ${MIN_STACK}`);
      for (const cardId of deck) {
        const card = cardOf(context, cardId);
        if (!state.modules.stake && /\bStake\b/.test(card.text || "")) {
          fail("SCHEMA", `${card.name} needs the Stake module (§19.1)`);
        }
      }
      shuffleInPlace(deck, stream);
      const salt = String(seatConfig.salt === undefined ? "" : seatConfig.salt);
      // §3.4 the commitment is over position -> cardId, never over uids:
      // §6.1 re-minting invalidates a uid commitment at the first shuffle.
      state.seats[seat].deckCommit =
        "sha256:" + sha256hex(salt + canonicalJSON(deck.map((cardId, i) => [i, cardId])));
      for (const cardId of deck) {
        const record = newObjectRecord(state, context, cardId, seat, seat, zoneKey(seat, "stack"), null);
        state.objects[record.uid] = record;
        state.zones[zoneKey(seat, "stack")].push(record.uid);
      }
    }
    for (const seat of [0, 1]) drawCards(env, seat, 7);

    enterStep(env, true);
    advanceUntilPriority(env);
    return state;
  }

  const emptyClash = () => ({
    step: null,
    attackers: [],
    meshGroups: {},
    blocks: {},
    order: {},
    assignment: {},
    blockedOnce: [],
    damageDone: { firstStrike: false, regular: false },
  });

  // ------------------------------------------------------------ drawing

  function drawCards(env, seat, count) {
    const state = env.state;
    for (let i = 0; i < count; i++) {
      const stack = zoneArray(state, zoneKey(seat, "stack"));
      if (!stack.length) {
        // §2.2 the loss is recorded, not applied here; a state check owns it,
        // so a simultaneous double-deck-out can still produce a draw.
        state.seats[seat].deckedOut = true;
        emit(env, "DECKED", { seat });
        return;
      }
      const uid = stack[0];
      const cardId = state.objects[uid].cardId;
      const record = moveUid(env, uid, "wallet", { seat });
      emit(env, "DRAW", { seat, count: 1, uid: record.uid }, { [String(seat)]: { cardId } });
    }
  }

  // ------------------------------------------------------- state checks (§16)

  function stateChecks(env) {
    const state = env.state;
    for (let guard = 0; guard < 64; guard++) {
      let changed = false;
      for (const seat of [0, 1]) {
        for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
          const object = state.objects[uid];
          if (!object) continue;
          const card = cardOf(env.ctx, object.cardId);

          if (object.token && zoneName(object.zone) !== "network") continue;
          if (card.isAvatar) {
            const { resilience } = statsOf(state, env.ctx, uid);
            const lethal = object.damage >= resilience;
            if (resilience <= 0) {
              // §15.3 Reboot cannot replace being archived for 0 Resilience.
              moveUid(env, uid, "archive");
              emit(env, "ARCHIVED", { uid, cardId: object.cardId, reason: "resilience" });
              changed = true;
              continue;
            }
            if (lethal) {
              if (object.rebootShields > 0) {
                // §14 Reboot: not decommissioned, damage removed, Commit it,
                // remove it from combat, consume the shield.
                object.rebootShields -= 1;
                object.damage = 0;
                object.committed = true;
                removeFromCombat(state, uid);
                emit(env, "REBOOT", { uid, cardId: object.cardId });
              } else {
                moveUid(env, uid, "archive");
                emit(env, "DECOMMISSIONED", { uid, cardId: object.cardId });
              }
              changed = true;
              continue;
            }
          }
          if (object.attachedTo) {
            const host = state.objects[object.attachedTo];
            if (!host || zoneName(host.zone) !== "network") {
              moveUid(env, uid, "archive");
              emit(env, "ARCHIVED", { uid, cardId: object.cardId, reason: "attachment" });
              changed = true;
            }
          }
        }
      }
      // §18.1 a token outside the Network ceases to exist.
      for (const uid of Object.keys(state.objects)) {
        const object = state.objects[uid];
        if (object.token && zoneName(object.zone) !== "network") {
          removeFromZone(state, object.zone, uid);
          delete state.objects[uid];
          pruneReferences(state, uid);
          emit(env, "TOKEN_GONE", { uid });
          changed = true;
        }
      }
      // §17 effects whose source left the zone that sustained it.
      const liveEffects = state.effects.filter((effect) => {
        if (!effect.expires || effect.expires.kind !== "whileSourceInZone") return true;
        const source = state.objects[effect.sourceUid];
        return Boolean(source) && zoneName(source.zone) === (effect.expires.zone || "network");
      });
      if (liveEffects.length !== state.effects.length) {
        state.effects = liveEffects;
        changed = true;
      }
      // §18.3 reveals expire; a state check clears them.
      for (const object of Object.values(state.objects)) {
        const until = object.revealedUntil;
        if (!until) continue;
        if (state.turn.number > until.turn || (state.turn.number === until.turn && until.phase && until.phase !== state.turn.phase)) {
          object.revealedTo = [];
          object.revealedUntil = null;
          changed = true;
        }
      }
      if (!changed) break;
    }
    recomputeResult(env);
  }

  function removeFromCombat(state, uid) {
    state.clash.attackers = state.clash.attackers.filter((u) => u !== uid);
    delete state.clash.blocks[uid];
    delete state.clash.order[uid];
    delete state.clash.assignment[uid];
    for (const attacker of Object.keys(state.clash.blocks)) {
      state.clash.blocks[attacker] = state.clash.blocks[attacker].filter((u) => u !== uid);
      if (state.clash.order[attacker]) {
        state.clash.order[attacker] = state.clash.order[attacker].filter((u) => u !== uid);
      }
    }
  }

  /* §2.2 including the draw. play.js:201-205 tested alive.length === 1, so a
   * simultaneous loss left both players "alive" and the game hung forever. */
  function recomputeResult(env) {
    const state = env.state;
    if (state.result) return;
    const losers = [];
    const reasons = {};
    for (const seat of [0, 1]) {
      const player = state.seats[seat];
      if (player.conceded) {
        losers.push(seat);
        reasons[seat] = "concede";
      } else if (player.uptime <= 0) {
        losers.push(seat);
        reasons[seat] = "uptime";
      } else if (player.deckedOut) {
        losers.push(seat);
        reasons[seat] = "decked";
      }
    }
    if (!losers.length) return;
    if (losers.length === 2) {
      state.result = { winners: [], reason: "draw", losers };
    } else {
      state.result = { winners: [1 - losers[0]], reason: reasons[losers[0]], losers };
    }
    state.status = "over";
    state.priority.seat = null;
    state.awaiting = null;
    state.pendingChoice = null;
    emit(env, "GAME_OVER", { winners: state.result.winners, reason: state.result.reason });
  }

  // ---------------------------------------------------- the op interpreter (ops.js)

  /* One resumable interpreter, two authors: compiled card ops and MANUAL_PROPOSE
   * deltas run through the same code, so the manual path cannot drift from the
   * automatic path and a card the Python compiler later learns to script
   * migrates from one author to the other with zero engine change. */
  function frameOps(env, item) {
    if (item.kind === "manual") return item.ops;
    const card = cardOf(env.ctx, item.cardId);
    if (item.kind === "ability") {
      const ability = card.abilities[item.abilityIndex];
      return (ability && ability.ops) || [];
    }
    return card.playOps;
  }

  function nextTarget(env, item) {
    const cursor = item.resume.acc.targetIndex || 0;
    item.resume.acc.targetIndex = cursor + 1;
    return item.targets[cursor] || null;
  }

  const seatsOf = (state) => [0, 1];

  function damageTarget(env, target, amount, sourceUid) {
    if (!target) return;
    const state = env.state;
    if (target.kind === "seat") {
      state.seats[target.seat].uptime -= amount; // §15.1
      emit(env, "DAMAGE", { to: "seat", seat: target.seat, amount, sourceUid: sourceUid || null });
      return;
    }
    const object = state.objects[target.uid];
    if (!object) return; // §11.2 do as much as possible
    if (sourceUid && isShieldedFromSource(env, target.uid, sourceUid)) {
      emit(env, "PREVENTED", { uid: target.uid, amount, reason: "shielded" });
      return;
    }
    object.damage += amount; // §15.2 marked until Cleanup
    emit(env, "DAMAGE", { to: "object", uid: target.uid, amount, sourceUid: sourceUid || null });
  }

  function isShieldedFromSource(env, uid, sourceUid) {
    const shield = shieldedFrom(env.state, env.ctx, uid);
    if (!shield) return false;
    const source = env.state.objects[sourceUid];
    if (!source) return false;
    return cardOf(env.ctx, source.cardId).affinity.indexOf(shield) >= 0;
  }

  function addModEffect(env, uid, action, resilience, duration, sourceUid, scope, controller) {
    const state = env.state;
    const effect = {
      id: "e" + state.nextEid,
      sourceUid: sourceUid || null,
      layer: 7,
      kind: "mod",
      scope: scope || "object",
      targetUid: uid || null,
      controller: controller === undefined ? null : controller,
      action: action || 0,
      resilience: resilience || 0,
      grants: [],
      removes: [],
      expires:
        duration === "eot"
          ? { kind: "eot", turn: state.turn.number }
          : { kind: "whileSourceInZone", uid: sourceUid || null, zone: "network" },
      startedSeq: state.seq,
    };
    state.nextEid += 1;
    state.effects.push(effect);
    return effect;
  }

  /* Returns "done" or "pause". On pause the op index is NOT advanced: the frame
   * re-enters at the same op once CHOOSE stores the pick into acc. */
  function runFrame(env, item) {
    const ops = frameOps(env, item);
    while (item.resume.opIndex < ops.length) {
      const op = ops[item.resume.opIndex];
      const outcome = runOp(env, item, op);
      if (outcome === "pause") return "pause";
      item.resume.opIndex += 1;
    }
    return "done";
  }

  function runOp(env, item, op) {
    const state = env.state;
    const controller = item.controller;
    const sourceUid = item.sourceUid;
    switch (op.op) {
      case "generate": {
        let key;
        if (op.affinity === "neutral") key = "N";
        else if (op.affinity === "choice") {
          const chosen = item.resume.acc["choice" + item.resume.opIndex];
          if (!chosen) {
            return raiseChoice(env, item, {
              kind: "mode",
              prompt: "Choose an affinity to generate",
              options: SYMBOLS.map((symbol) => ({ kind: "symbol", symbol })),
              min: 1,
              max: 1,
              slot: "choice" + item.resume.opIndex,
            });
          }
          key = chosen;
        } else key = AFFINITY_SYMBOL[op.affinity] || "N";
        state.seats[controller].buffer[key] += op.amount;
        emit(env, "GENERATE", { seat: controller, symbol: key, amount: op.amount });
        return "done";
      }
      case "damage": {
        if (op.target === "each-player") {
          for (const seat of seatsOf(state)) damageTarget(env, { kind: "seat", seat }, op.amount, sourceUid);
          return "done";
        }
        if (op.target === "each-avatar") {
          for (const seat of seatsOf(state)) {
            for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
              if (cardOf(env.ctx, state.objects[uid].cardId).isAvatar) {
                damageTarget(env, { kind: "object", uid }, op.amount, sourceUid);
              }
            }
          }
          return "done";
        }
        damageTarget(env, nextTarget(env, item), op.amount, sourceUid);
        return "done";
      }
      case "draw":
        drawCards(env, controller, op.amount);
        return "done";
      case "uptime": {
        // play.js:285 was `op.target === "player" ? controller : controller` —
        // a no-op ternary, so "target player gains N Uptime" always healed the
        // controller. The target is now a real seat target.
        const target = op.target === "player" ? nextTarget(env, item) : { kind: "seat", seat: controller };
        const seat = target && target.kind === "seat" ? target.seat : controller;
        state.seats[seat].uptime += op.amount;
        emit(env, "UPTIME", { seat, delta: op.amount });
        return "done";
      }
      case "discard": {
        // Seeded from rng.public and honouring op.target. play.js:293 used
        // Math.random(), the one live nondeterminism in the old engine.
        const target = op.target === "player" ? nextTarget(env, item) : null;
        const seat = target && target.kind === "seat" ? target.seat : 1 - controller;
        for (let i = 0; i < op.amount; i++) {
          const wallet = zoneArray(state, zoneKey(seat, "wallet"));
          if (!wallet.length) break;
          const index = nextInt(state.rng.public, wallet.length);
          const uid = wallet[index];
          // §18.4 log the eligible set and the result so the draw is auditable.
          emit(env, "RANDOM_PICK", { seat, eligible: wallet.slice(), picked: uid, stream: "public" });
          moveUid(env, uid, "archive");
        }
        emit(env, "DISCARD", { seat, count: op.amount });
        return "done";
      }
      case "pump": {
        if (op.target === "target-avatar") {
          const target = nextTarget(env, item);
          if (target && target.kind === "object" && state.objects[target.uid]) {
            addModEffect(env, target.uid, op.action, op.resilience, op.duration, sourceUid, "object");
            emit(env, "PUMP", { uid: target.uid, action: op.action, resilience: op.resilience });
          }
          return "done";
        }
        if (op.target === "this-avatar" && sourceUid && state.objects[sourceUid]) {
          addModEffect(env, sourceUid, op.action, op.resilience, op.duration, sourceUid, "object");
          emit(env, "PUMP", { uid: sourceUid, action: op.action, resilience: op.resilience });
          return "done";
        }
        // "Avatars you control get +A/+R" is a scope, not a snapshot: it must
        // keep applying to whatever the controller has, so it is an effect.
        addModEffect(env, null, op.action, op.resilience, op.duration, sourceUid, "controlledAvatars", controller);
        emit(env, "PUMP", { scope: "controlledAvatars", seat: controller, action: op.action, resilience: op.resilience });
        return "done";
      }
      case "decommission": {
        if (op.scope === "all") {
          for (const seat of seatsOf(state)) {
            for (const uid of zoneArray(state, zoneKey(seat, "network")).slice()) {
              if (cardOf(env.ctx, state.objects[uid].cardId).type.indexOf(op.kind) >= 0) {
                emit(env, "DECOMMISSIONED", { uid, cardId: state.objects[uid].cardId });
                moveUid(env, uid, "archive");
              }
            }
          }
          return "done";
        }
        const target = nextTarget(env, item);
        if (target && target.kind === "object" && state.objects[target.uid]) {
          emit(env, "DECOMMISSIONED", { uid: target.uid, cardId: state.objects[target.uid].cardId });
          moveUid(env, target.uid, "archive");
        }
        return "done";
      }
      case "reboot": {
        // §14 Reboot creates a replacement shield for the rest of the turn.
        // play.js:334 unlocked and cleared damage instead, which is a different
        // (and strictly better) effect than the printed keyword.
        const target = op.scope === "target" ? nextTarget(env, item) : { kind: "object", uid: sourceUid };
        if (target && target.kind === "object" && state.objects[target.uid]) {
          state.objects[target.uid].rebootShields += 1;
          emit(env, "REBOOT_SHIELD", { uid: target.uid });
        }
        return "done";
      }
      default:
        return runManualOp(env, item, op);
    }
  }

  function raiseChoice(env, item, request) {
    const state = env.state;
    state.pendingChoice = {
      id: "c" + state.nextChoiceId,
      seat: item.controller,
      kind: request.kind,
      prompt: request.prompt,
      options: request.options,
      min: request.min,
      max: request.max,
      forQid: item.qid || null,
      slot: request.slot,
    };
    state.nextChoiceId += 1;
    state.priority.seat = null;
    emit(env, "CHOICE_REQUIRED", { seat: item.controller, choiceId: state.pendingChoice.id, kind: request.kind, prompt: request.prompt });
    return "pause";
  }
