  // ------------------------------------------------------------ core.js

  const HAND_LIMIT = 7;
  const START_UPTIME = 20;
  const MIN_STACK = 40;

  const PHASE_ORDER = ["open", "build1", "clash", "build2", "close"];
  const PHASE_STEPS = {
    open: ["unlock", "maintenance", "draw"],
    build1: ["main"],
    clash: ["start", "attackers", "blockers", "order", "firstStrike", "damage", "end"],
    build2: ["main"],
    close: ["endStep", "cleanup"],
  };
  /* The eight visible slots of the printed turn structure, in order. play.html
   * renders this ribbon; the engine's (phase, step) pair is the authority. */
  const TURN_RIBBON = [
    { phase: "open", step: "unlock", label: "Unlock" },
    { phase: "open", step: "maintenance", label: "Maintenance" },
    { phase: "open", step: "draw", label: "Draw" },
    { phase: "build1", step: "main", label: "Build I" },
    { phase: "clash", step: null, label: "Clash" },
    { phase: "build2", step: "main", label: "Build II" },
    { phase: "close", step: "endStep", label: "End" },
    { phase: "close", step: "cleanup", label: "Cleanup" },
  ];

  const DEFAULT_POLICY = {
    priority: "full",
    manualConsent: "ask",
    freeform: "allow",
    manualBudget: null,
    assistedAnnounce: "advisory",
  };

  const HARD_CAPS = {
    uptimeSwing: 20,
    objectsTouched: 8,
    cardsDrawn: 7,
    bufferAdded: 8,
    opsPerDelta: 12,
  };

  let defaultCatalog = null;

  function setCatalog(cards) {
    defaultCatalog = Array.isArray(cards) ? buildCatalog(cards) : cards;
    return defaultCatalog;
  }

  /* The catalog is injected, never stored in state: it keeps the state small
   * and makes redaction a one-field operation (hide a card by omitting cardId). */
  function resolveCtx(ctx) {
    const given = ctx || {};
    let catalog = given.catalog || null;
    if (Array.isArray(catalog)) catalog = buildCatalog(catalog);
    if (!catalog) {
      if (!defaultCatalog && root && Array.isArray(root.E1_CARDS)) setCatalog(root.E1_CARDS);
      catalog = defaultCatalog;
    }
    if (!catalog || !catalog.byId) fail("CATALOG_MISMATCH", "no card catalog available");
    return {
      catalog,
      authenticatedSeat:
        given.authenticatedSeat === undefined ? null : given.authenticatedSeat,
      policy: given.policy || null,
      verifySignatures: Boolean(given.verifySignatures),
    };
  }

  const cardOf = (ctx, cardId) => {
    const card = ctx.catalog.byId[cardId];
    if (!card) fail("CATALOG_MISMATCH", `unknown card ${cardId}`);
    return card;
  };
  const cardFor = (env, uid) => cardOf(env.ctx, objectOf(env.state, uid).cardId);

  // ----------------------------------------------------------- zone helpers

  const zoneKey = (seat, zone) => `${seat}:${zone}`;
  const zoneSeat = (key) => Number(key.split(":")[0]);
  const zoneName = (key) => key.split(":")[1];

  function zoneArray(state, key) {
    const list = state.zones[key];
    if (!list) fail("NOT_IN_ZONE", `unknown zone ${key}`);
    return list;
  }

  function objectOf(state, uid) {
    const object = state.objects[uid];
    if (!object) fail("UNKNOWN_OBJECT", `unknown object ${uid}`);
    return object;
  }

  const objectsIn = (state, key) => zoneArray(state, key).map((uid) => state.objects[uid]);

  function mintUid(state) {
    // "o"-prefixed on purpose: integer-like keys order differently under
    // JSON.stringify than under a code-unit-sorted canonicaliser, and anywhere
    // those two meet is a silent hash divergence.
    const uid = "o" + state.nextUid;
    state.nextUid += 1;
    return uid;
  }

  function removeFromZone(state, key, uid) {
    const list = zoneArray(state, key);
    const index = list.indexOf(uid);
    if (index < 0) fail("NOT_IN_ZONE", `${uid} is not in ${key}`);
    list.splice(index, 1);
  }

  function insertIntoZone(state, key, uid, position) {
    const list = zoneArray(state, key);
    if (position === undefined || position === null || position >= list.length) list.push(uid);
    else list.splice(Math.max(0, position), 0, uid);
  }

  function newObjectRecord(state, ctx, cardId, owner, controller, key, prevUid) {
    const card = cardOf(ctx, cardId);
    const zone = zoneName(key);
    return {
      uid: mintUid(state),
      cardId,
      owner,
      controller,
      zone: key,
      committed: false,
      // §5.2 Boot Delay is a RULE for every Avatar entering the Network, not a
      // printed keyword. play.js:513 read it off card.keywords, so only the
      // handful of cards that print the word were ever delayed.
      bootDelay: zone === "network" && card.isAvatar,
      damage: 0,
      counters: {},
      attachedTo: null,
      rebootShields: 0,
      facedown: false,
      revealedTo: [],
      revealedUntil: null,
      token: false,
      entersSeq: state.seq,
      prevUid: prevUid || null,
    };
  }

  /* §6.1 — every zone change except Network->Network mints a fresh object with
   * no memory of the old one. This is also an anti-cheat primitive: shuffling a
   * hidden zone re-mints every uid in it, so uid tracking conveys exactly what
   * a physical table conveys and no more. prevUid keeps the audit chain, and is
   * stripped from every view. */
  function moveUid(env, uid, toZone, options) {
    const state = env.state;
    const object = objectOf(state, uid);
    const settings = options || {};
    const fromKey = object.zone;
    const publicZone = toZone === "network" || toZone === "queue" || toZone === "stake";
    const toSeat =
      settings.seat !== undefined && settings.seat !== null
        ? settings.seat
        : publicZone
          ? object.controller
          : object.owner; // §17.2 a controlled card leaves to its OWNER's zone
    const toKey = zoneKey(toSeat, toZone);
    const networkToNetwork = zoneName(fromKey) === "network" && toZone === "network";

    removeFromZone(state, fromKey, uid);
    if (networkToNetwork) {
      object.zone = toKey;
      object.controller = toSeat;
      insertIntoZone(state, toKey, uid, settings.position);
      return object;
    }
    delete state.objects[uid];
    const record = newObjectRecord(state, env.ctx, object.cardId, object.owner, toSeat, toKey, uid);
    record.token = object.token;
    record.facedown = toZone === "cold" ? Boolean(settings.facedown) : false;
    state.objects[record.uid] = record;
    insertIntoZone(state, toKey, record.uid, settings.position);
    pruneReferences(state, uid);
    return record;
  }

  /* §3.1 invariant 5: effects and queue targets never point at a dead uid. */
  function pruneReferences(state, deadUid) {
    state.effects = state.effects.filter(
      (effect) => effect.targetUid !== deadUid && effect.sourceUid !== deadUid
    );
    for (const item of state.queue) {
      item.targets = item.targets.filter((t) => t.kind !== "object" || t.uid !== deadUid);
      if (item.objectUid === deadUid) item.objectUid = null;
      if (item.sourceUid === deadUid) item.sourceUid = null;
    }
    for (const key of ["attackers", "blockedOnce"]) {
      state.clash[key] = state.clash[key].filter((uid) => uid !== deadUid);
    }
    delete state.clash.meshGroups[deadUid];
    delete state.clash.blocks[deadUid];
    delete state.clash.order[deadUid];
    delete state.clash.assignment[deadUid];
    for (const attacker of Object.keys(state.clash.blocks)) {
      state.clash.blocks[attacker] = state.clash.blocks[attacker].filter((u) => u !== deadUid);
      if (state.clash.order[attacker]) {
        state.clash.order[attacker] = state.clash.order[attacker].filter((u) => u !== deadUid);
      }
    }
    for (const object of Object.values(state.objects)) {
      if (object.attachedTo === deadUid) object.attachedTo = null;
    }
  }

  // -------------------------------------------------- stats and continuous effects

  /* §17 layer 7: printed stats, then counters, then modifier effects oldest
   * first. Total ordering with a uid tie-break so no comparison returns 0. */
  function effectsFor(state, uid) {
    const object = state.objects[uid];
    const matching = state.effects.filter((effect) => {
      if (effect.kind !== "mod") return false;
      if (effect.scope === "object") return effect.targetUid === uid;
      if (effect.scope === "controlledAvatars") return effect.controller === object.controller;
      return false;
    });
    matching.sort((a, b) => a.startedSeq - b.startedSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return matching;
  }

  function statsOf(state, ctx, uid) {
    const object = objectOf(state, uid);
    const card = cardOf(ctx, object.cardId);
    if (!card.isAvatar) return { action: 0, resilience: 0 };
    let action = card.action || 0;
    let resilience = card.resilience || 0;
    const plusOne = object.counters["+1/+1"] || 0; // §18.2
    action += plusOne;
    resilience += plusOne;
    for (const effect of effectsFor(state, uid)) {
      if (effect.scope === "controlledAvatars" && !card.isAvatar) continue;
      action += effect.action || 0;
      resilience += effect.resilience || 0;
    }
    return { action, resilience };
  }

  function keywordsOf(state, ctx, uid) {
    const object = objectOf(state, uid);
    const card = cardOf(ctx, object.cardId);
    const names = card.keywords.map((k) => k.name);
    for (const effect of state.effects) {
      if (effect.kind !== "grant" || effect.targetUid !== uid) continue;
      if (effect.remove) {
        const index = names.indexOf(effect.keyword);
        if (index >= 0) names.splice(index, 1);
      } else if (names.indexOf(effect.keyword) < 0) {
        names.push(effect.keyword);
      }
    }
    // Firewall is printed as a subtype on several cards, never as a keyword.
    if (/Firewall/.test(card.subtype || "") && names.indexOf("Firewall") < 0) names.push("Firewall");
    return names;
  }

  const hasKeywordUid = (state, ctx, uid, name) => keywordsOf(state, ctx, uid).indexOf(name) >= 0;

  function shieldedFrom(state, ctx, uid) {
    const card = cardOf(ctx, objectOf(state, uid).cardId);
    const entry = card.keywords.find((k) => k.name === "Shielded");
    return entry ? entry.from : null;
  }

  // ------------------------------------------------------------- costs (§11, §12)

  const emptyBuffer = () => ({ P: 0, B: 0, K: 0, S: 0, T: 0, N: 0 });
  const bufferTotal = (buffer) => BUFFER_KEYS.reduce((sum, key) => sum + buffer[key], 0);

  function canPay(buffer, cost) {
    if (!cost) return true;
    const pool = Object.assign({}, buffer);
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if (pool[symbol] < need) return false;
      pool[symbol] -= need;
    }
    return bufferTotal(pool) >= (cost.generic || 0);
  }

  /* The documented canonical auto-payment, reproducing play.js's pay() exactly:
   * specific symbols first, then generic from N, then P,B,K,S,T in that order.
   * Convenience in the UI, authority in the engine — both paths run the same
   * validator below, so an explicit payment can never take a cheaper route. */
  function autoPayment(buffer, cost) {
    const payment = emptyBuffer();
    if (!cost) return payment;
    const pool = Object.assign({}, buffer);
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if (pool[symbol] < need) fail("CANNOT_AFFORD", `not enough ${symbol} in the Buffer`);
      pool[symbol] -= need;
      payment[symbol] += need;
    }
    let generic = cost.generic || 0;
    for (const key of ["N", "P", "B", "K", "S", "T"]) {
      while (generic > 0 && pool[key] > 0) {
        pool[key] -= 1;
        payment[key] += 1;
        generic -= 1;
      }
    }
    if (generic > 0) fail("CANNOT_AFFORD", "not enough Resources in the Buffer");
    return payment;
  }

  /* play.js:139 auto-spent in a fixed order, which is the engine making a player
   * decision — with several ways to satisfy a generic cost it could pick a
   * strictly worse assignment. A payment is now stated and verified. */
  function verifyPayment(buffer, cost, payment) {
    for (const key of BUFFER_KEYS) {
      const amount = payment[key] || 0;
      if (!Number.isInteger(amount) || amount < 0) fail("BAD_PAYMENT", `bad amount for ${key}`);
      if (amount > buffer[key]) fail("BAD_PAYMENT", `Buffer holds no ${amount} ${key}`);
    }
    if (!cost) {
      if (bufferTotal(payment) !== 0) fail("BAD_PAYMENT", "payment offered for a free cost");
      return payment;
    }
    let specific = 0;
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if ((payment[symbol] || 0) < need) fail("BAD_PAYMENT", `${symbol} must be paid with ${symbol}`);
      specific += need;
    }
    const total = bufferTotal(payment);
    if (total !== specific + (cost.generic || 0)) {
      fail("BAD_PAYMENT", `payment totals ${total}, cost totals ${specific + (cost.generic || 0)}`);
    }
    return payment;
  }

  function spendBuffer(seat, buffer, payment) {
    for (const key of BUFFER_KEYS) buffer[key] -= payment[key] || 0;
    return payment;
  }

  /* §12.1 Classic resource burn. play.js:488 burned only the active seat at
   * phase ends while :459/:599 burned both at Clash — internally inconsistent.
   * The Buffer empties for BOTH controllers at every phase boundary and at
   * Clash start and end. This is not damage and cannot be prevented. */
  function burnBuffers(env, reason) {
    for (const seat of [0, 1]) {
      const player = env.state.seats[seat];
      const total = bufferTotal(player.buffer);
      if (!total) continue;
      player.uptime -= total;
      player.buffer = emptyBuffer();
      emit(env, "BURN", { seat, amount: total, reason });
    }
  }

  // -------------------------------------------------------------------- events

  /* Structured, never pre-formatted prose: play.js:99 formatted at write time
   * and a string cannot be redacted after the fact. The UI owns all wording. */
  function emit(env, t, pub, priv) {
    const event = { t, seq: env.state.seq, pub: pub || {} };
    if (priv) event.priv = priv;
    env.events.push(event);
    return event;
  }

  function redactEvents(events, seat) {
    const key = String(seat);
    return events.map((event) => {
      const out = { t: event.t, seq: event.seq };
      Object.assign(out, event.pub);
      if (event.priv && seat !== null && event.priv[key]) Object.assign(out, event.priv[key]);
      return out;
    });
  }
