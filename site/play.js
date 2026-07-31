/* 600B Timelock TCG — local hotseat engine.
 *
 * Enforces the E1 rules framework: turn structure, the once-per-turn Resource
 * play, Buffer generation and resource burn, costs, clash with First Strike and
 * Overflow, and state checks. Card abilities the compiler recognised resolve
 * automatically; everything else is announced and resolved by the table using
 * the manual controls, which is why all 295 cards are playable. */
(() => {
  "use strict";

  const CARDS = window.E1_CARDS || [];
  const SYMBOLS = ["P", "B", "K", "S", "T"];
  const SYMBOL_NAME = { P: "Power", B: "Bitcoin", K: "Keys", S: "Signal", T: "Timelock" };
  const NAME_SYMBOL = { Power: "P", Bitcoin: "B", Keys: "K", Signal: "S", Timelock: "T" };
  const PHASES = [
    { id: "unlock", label: "Unlock", auto: true },
    { id: "maintenance", label: "Maintenance" },
    { id: "draw", label: "Draw", auto: true },
    { id: "build1", label: "Build I" },
    { id: "clash", label: "Clash" },
    { id: "build2", label: "Build II" },
    { id: "end", label: "End" },
    { id: "cleanup", label: "Cleanup", auto: true },
  ];
  const CLASH_STAGES = ["attackers", "blockers", "damage", "done"];
  const START_UPTIME = 20;
  const HAND_LIMIT = 7;

  const isResource = (card) => card.type === "Basic Resource" || card.type === "Resource";
  const isPermanent = (card) =>
    isResource(card) || /Avatar|Hardware|Protocol/.test(card.type);
  const isAvatar = (card) => card.type.includes("Avatar");
  const hasKeyword = (card, name) => card.keywords.some((k) => k.name === name);

  let state = null;
  let uidSeq = 1;
  let pending = null; // { prompt, kinds, onPick, cancel }

  // ---------------------------------------------------------------- deck build

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(pool, count, rand) {
    const out = [];
    if (!pool.length) return out;
    for (let i = 0; i < count; i++) out.push(pool[Math.floor(rand() * pool.length)]);
    return out;
  }

  /* 40 cards in the rulebook's recommended prototype shape (section 7). */
  function buildDeck(affinity, seed) {
    const rand = rng(seed);
    const inAffinity = (card) =>
      affinity === "All" || card.affinity.includes(affinity) || card.affinity.includes("Neutral");
    const pool = CARDS.filter(inAffinity);
    const of = (test) => pool.filter(test);
    const deck = [
      ...pick(of(isResource), 17, rand),
      ...pick(of((c) => isAvatar(c)), 14, rand),
      ...pick(of((c) => c.type === "Zap" || c.type === "Operation"), 5, rand),
      ...pick(of((c) => c.type === "Hardware" || c.type === "Protocol"), 4, rand),
    ].filter(Boolean);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.map((card) => ({ uid: uidSeq++, card }));
  }

  function newPlayer(name, affinity, seed) {
    return {
      name,
      affinity,
      uptime: START_UPTIME,
      stack: buildDeck(affinity, seed),
      wallet: [],
      network: [],
      archive: [],
      cold: [],
      buffer: { P: 0, B: 0, K: 0, S: 0, T: 0, N: 0 },
      lost: false,
    };
  }

  // ------------------------------------------------------------------- helpers

  const active = () => state.players[state.turnPlayer];
  const inactive = () => state.players[1 - state.turnPlayer];
  const phase = () => PHASES[state.phase];

  function log(message, tone) {
    state.log.unshift({ message, tone, turn: state.turn });
    if (state.log.length > 220) state.log.pop();
  }

  function draw(player, count) {
    for (let i = 0; i < count; i++) {
      if (!player.stack.length) {
        player.lost = true;
        log(`${player.name} cannot draw from an empty Stack and loses.`, "bad");
        return;
      }
      player.wallet.push(player.stack.shift());
    }
  }

  function bufferTotal(player) {
    return SYMBOLS.concat("N").reduce((sum, key) => sum + player.buffer[key], 0);
  }

  function burnBuffer(player, reason) {
    const total = bufferTotal(player);
    if (!total) return;
    player.uptime -= total;
    for (const key of SYMBOLS.concat("N")) player.buffer[key] = 0;
    log(`${player.name} burns ${total} unspent Resource${total > 1 ? "s" : ""} (${reason}) — −${total} Uptime.`, "warn");
  }

  function canPay(player, cost) {
    if (!cost) return true;
    const buffer = { ...player.buffer };
    for (const symbol of SYMBOLS) {
      const need = cost[symbol] || 0;
      if (buffer[symbol] < need) return false;
      buffer[symbol] -= need;
    }
    const pool = SYMBOLS.reduce((sum, s) => sum + buffer[s], 0) + buffer.N;
    return pool >= (cost.generic || 0);
  }

  function pay(player, cost) {
    if (!cost) return true;
    if (!canPay(player, cost)) return false;
    for (const symbol of SYMBOLS) player.buffer[symbol] -= cost[symbol] || 0;
    let generic = cost.generic || 0;
    for (const key of ["N", ...SYMBOLS]) {
      while (generic > 0 && player.buffer[key] > 0) {
        player.buffer[key]--;
        generic--;
      }
    }
    return true;
  }

  function moveTo(player, entry, zone) {
    for (const name of ["network", "wallet", "archive", "cold", "stack"]) {
      const index = player[name].indexOf(entry);
      if (index >= 0) player[name].splice(index, 1);
    }
    entry.damage = 0;
    entry.plusAction = 0;
    entry.plusResilience = 0;
    entry.committed = false;
    entry.attacking = false;
    entry.blocking = null;
    player[zone].push(entry);
  }

  const statOf = (entry) => ({
    action: (entry.card.action || 0) + (entry.plusAction || 0),
    resilience: (entry.card.resilience || 0) + (entry.plusResilience || 0),
  });

  function ownerOf(entry) {
    return state.players.find((p) =>
      ["network", "wallet", "archive", "cold", "stack"].some((z) => p[z].includes(entry))
    );
  }

  // -------------------------------------------------------------- state checks

  function stateChecks() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const player of state.players) {
        if (player.uptime <= 0 && !player.lost) {
          player.lost = true;
          log(`${player.name} is at 0 Uptime and loses.`, "bad");
          changed = true;
        }
        for (const entry of [...player.network]) {
          if (!isAvatar(entry.card)) continue;
          const { resilience } = statOf(entry);
          if (resilience <= 0 || (entry.damage || 0) >= resilience) {
            moveTo(player, entry, "archive");
            log(`${entry.card.name} is decommissioned.`, "warn");
            changed = true;
          }
        }
      }
    }
    const alive = state.players.filter((p) => !p.lost);
    if (alive.length === 1 && !state.winner) {
      state.winner = alive[0].name;
      log(`${alive[0].name} wins the game.`, "good");
    }
  }

  // ------------------------------------------------------------------ abilities

  function targetsFor(kind) {
    const out = [];
    for (const player of state.players) {
      for (const entry of player.network) {
        const card = entry.card;
        const match =
          kind === "any"
            ? isAvatar(card)
            : kind === "avatar" || kind === "this"
              ? isAvatar(card)
              : card.type.includes(kind);
        if (match) out.push({ type: "entry", entry, player });
      }
    }
    if (kind === "any" || kind === "player") {
      for (const player of state.players) out.push({ type: "player", player });
    }
    return out;
  }

  function damageTo(target, amount, sourceName) {
    if (target.type === "player") {
      target.player.uptime -= amount;
      log(`${sourceName} deals ${amount} damage to ${target.player.name}.`, "warn");
    } else {
      target.entry.damage = (target.entry.damage || 0) + amount;
      log(`${sourceName} deals ${amount} damage to ${target.entry.card.name}.`, "warn");
    }
  }

  /* Resolve one compiled op, asking for a target when the template needs one. */
  function runOps(ops, controller, sourceEntry, done) {
    const queue = [...ops];
    const sourceName = sourceEntry ? sourceEntry.card.name : "The ability";

    const step = () => {
      if (!queue.length) {
        stateChecks();
        render();
        if (done) done();
        return;
      }
      const op = queue.shift();
      switch (op.op) {
        case "generate": {
          const key =
            op.affinity === "neutral" || op.affinity === "choice"
              ? "N"
              : NAME_SYMBOL[op.affinity] || "N";
          controller.buffer[key] += op.amount;
          const label = op.affinity === "choice" ? "any affinity" : op.affinity;
          log(`${controller.name} generates ${op.amount} ${label}.`, "good");
          return step();
        }
        case "damage": {
          if (op.target === "each-player") {
            for (const player of state.players) damageTo({ type: "player", player }, op.amount, sourceName);
            return step();
          }
          if (op.target === "each-avatar") {
            for (const player of state.players)
              for (const entry of [...player.network])
                if (isAvatar(entry.card)) damageTo({ type: "entry", entry }, op.amount, sourceName);
            return step();
          }
          return requestTarget(`Choose a target for ${op.amount} damage`, op.target, (target) => {
            damageTo(target, op.amount, sourceName);
            step();
          });
        }
        case "draw":
          draw(controller, op.amount);
          log(`${controller.name} draws ${op.amount}.`);
          return step();
        case "uptime": {
          const who = op.target === "player" ? controller : controller;
          who.uptime += op.amount;
          log(`${who.name} gains ${op.amount} Uptime.`, "good");
          return step();
        }
        case "discard": {
          const victim = state.players.find((p) => p !== controller);
          for (let i = 0; i < op.amount && victim.wallet.length; i++) {
            const entry = victim.wallet[Math.floor(Math.random() * victim.wallet.length)];
            moveTo(victim, entry, "archive");
          }
          log(`${victim.name} discards ${op.amount}.`, "warn");
          return step();
        }
        case "pump": {
          const apply = (entry) => {
            entry.plusAction = (entry.plusAction || 0) + op.action;
            entry.plusResilience = (entry.plusResilience || 0) + op.resilience;
            if (op.duration === "eot") state.untilEndOfTurn.push({ entry, ...op });
          };
          if (op.target === "target-avatar") {
            return requestTarget("Choose an Avatar to pump", "avatar", (target) => {
              apply(target.entry);
              log(`${target.entry.card.name} gets +${op.action}/+${op.resilience}.`, "good");
              step();
            });
          }
          if (op.target === "this-avatar" && sourceEntry) apply(sourceEntry);
          else
            for (const entry of controller.network)
              if (isAvatar(entry.card)) apply(entry);
          log(`+${op.action}/+${op.resilience} applied.`, "good");
          return step();
        }
        case "decommission": {
          if (op.scope === "all") {
            for (const player of state.players)
              for (const entry of [...player.network])
                if (entry.card.type.includes(op.kind)) moveTo(player, entry, "archive");
            log(`All ${op.kind}s decommissioned.`, "warn");
            return step();
          }
          return requestTarget(`Choose a ${op.kind} to decommission`, op.kind, (target) => {
            const owner = ownerOf(target.entry);
            moveTo(owner, target.entry, "archive");
            log(`${target.entry.card.name} is decommissioned.`, "warn");
            step();
          });
        }
        case "reboot":
          if (sourceEntry) {
            sourceEntry.committed = false;
            sourceEntry.damage = 0;
            log(`${sourceEntry.card.name} reboots.`, "good");
          }
          return step();
        default:
          return step();
      }
    };
    step();
  }

  function requestTarget(prompt, kinds, onPick) {
    const options = targetsFor(kinds);
    if (!options.length) {
      log(`${prompt}: no legal target, the effect is invalidated.`, "warn");
      render();
      return;
    }
    pending = { prompt, options, onPick };
    render();
  }

  function resolveAbility(entry, ability, controller) {
    if (ability.manual || !ability.ops) {
      log(`${entry.card.name}: “${ability.text}” — resolve manually.`, "manual");
      state.manualNote = `${entry.card.name}: ${ability.text}`;
      render();
      return;
    }
    runOps(ability.ops, controller, entry);
  }

  function activateAbility(entry, index) {
    const controller = ownerOf(entry);
    if (controller !== active() || state.winner) return;
    const ability = entry.card.abilities[index];
    if (!ability || ability.kind !== "activated") return;
    const cost = ability.cost || "";
    if (/Commit/i.test(cost)) {
      if (entry.committed) return log(`${entry.card.name} is already committed.`, "warn");
      entry.committed = true;
    }
    const symbolCost = {};
    let generic = (cost.match(/\d+/) || [])[0];
    if (generic) symbolCost.generic = Number(generic);
    for (const ch of cost) if (SYMBOLS.includes(ch)) symbolCost[ch] = (symbolCost[ch] || 0) + 1;
    if (Object.keys(symbolCost).length && !pay(controller, symbolCost)) {
      entry.committed = false;
      return log(`Not enough Resources in the Buffer for ${entry.card.name}.`, "warn");
    }
    log(`${controller.name} activates ${entry.card.name}: ${ability.text}`);
    resolveAbility(entry, ability, controller);
    render();
  }

  // ---------------------------------------------------------------- playing

  function playFromWallet(entry) {
    const player = active();
    if (state.winner) return;
    const card = entry.card;
    const canSorcerySpeed = ["build1", "build2"].includes(phase().id);

    if (isResource(card)) {
      if (!canSorcerySpeed) return log("Play Resources during Build I or Build II.", "warn");
      if (state.resourcePlayed) return log("You have already played a Resource this turn.", "warn");
      moveTo(player, entry, "network");
      state.resourcePlayed = true;
      log(`${player.name} plays ${card.name}.`);
      stateChecks();
      return render();
    }

    const isZap = card.type === "Zap";
    if (!isZap && !canSorcerySpeed)
      return log(`${card.type}s are played during Build I or Build II.`, "warn");
    if (!pay(player, card.costParsed))
      return log(`Not enough Resources in the Buffer for ${card.name}.`, "warn");

    log(`${player.name} plays ${card.name}.`);
    const playAbilities = card.abilities.filter((a) => a.kind === "play" || a.kind === "static");
    if (isPermanent(card)) {
      moveTo(player, entry, "network");
      const auto = playAbilities.filter((a) => !a.manual && a.ops);
      for (const ability of auto) runOps(ability.ops, player, entry);
      const manual = card.abilities.filter((a) => a.manual);
      if (manual.length) {
        state.manualNote = `${card.name}: ${manual.map((a) => a.text).join(" / ")}`;
        log(`${card.name}: resolve “${manual[0].text}” manually.`, "manual");
      }
    } else {
      // Zaps and Operations resolve, then go to the Archive.
      const auto = card.abilities.filter((a) => !a.manual && a.ops);
      moveTo(player, entry, "archive");
      if (auto.length) {
        for (const ability of auto) runOps(ability.ops, player, entry);
      } else {
        state.manualNote = `${card.name}: ${card.text}`;
        log(`${card.name}: resolve manually, then it is archived.`, "manual");
      }
    }
    stateChecks();
    render();
  }

  // ------------------------------------------------------------------- phases

  function runPhaseEntry() {
    const player = active();
    switch (phase().id) {
      case "unlock":
        for (const entry of player.network) entry.committed = false;
        log(`${player.name} unlocks everything.`);
        return nextPhase();
      case "draw":
        // Section 8: the first player does draw during their first turn.
        draw(player, 1);
        log(`${player.name} draws for turn.`);
        stateChecks();
        return nextPhase();
      case "clash":
        state.clash = { stage: "attackers", attackers: [], blocks: {} };
        burnBuffer(state.players[0], "Clash begins");
        burnBuffer(state.players[1], "Clash begins");
        break;
      case "cleanup": {
        while (player.wallet.length > HAND_LIMIT) {
          moveTo(player, player.wallet[player.wallet.length - 1], "archive");
        }
        for (const p of state.players)
          for (const entry of p.network) entry.damage = 0;
        for (const effect of state.untilEndOfTurn) {
          effect.entry.plusAction -= effect.action;
          effect.entry.plusResilience -= effect.resilience;
        }
        state.untilEndOfTurn = [];
        log(`${player.name} cleans up.`);
        stateChecks();
        return endTurn();
      }
    }
    stateChecks();
    render();
  }

  function nextPhase() {
    if (state.winner) return render();
    // Clash steps are inside one phase; the Buffer only burns at its start and end.
    if (phase().id === "clash" && state.clash.stage !== "done") {
      return advanceClash();
    }
    burnBuffer(active(), `end of ${phase().label}`);
    state.phase += 1;
    if (state.phase >= PHASES.length) return endTurn();
    log(`— ${phase().label} —`);
    runPhaseEntry();
  }

  function endTurn() {
    state.turnPlayer = 1 - state.turnPlayer;
    if (state.turnPlayer === state.firstPlayer) state.turn += 1;
    state.phase = 0;
    state.resourcePlayed = false;
    state.clash = { stage: null, attackers: [], blocks: {} };
    log(`=== Turn ${state.turn} · ${active().name} ===`);
    runPhaseEntry();
  }

  // -------------------------------------------------------------------- clash

  function canAttack(entry) {
    const card = entry.card;
    return (
      isAvatar(card) &&
      !entry.committed &&
      !hasKeyword(card, "Firewall") &&
      !hasKeyword(card, "Boot Delay")
    );
  }

  function toggleAttacker(entry) {
    if (phase().id !== "clash" || state.clash.stage !== "attackers") return;
    if (ownerOf(entry) !== active()) return;
    if (!canAttack(entry) && !entry.attacking) {
      return log(`${entry.card.name} cannot attack.`, "warn");
    }
    entry.attacking = !entry.attacking;
    render();
  }

  function toggleBlock(blocker) {
    if (phase().id !== "clash" || state.clash.stage !== "blockers") return;
    if (ownerOf(blocker) !== inactive()) return;
    if (blocker.committed) return log(`${blocker.card.name} is committed and cannot block.`, "warn");
    const attackers = state.clash.attackers;
    if (!attackers.length) return;
    const current = attackers.indexOf(blocker.blocking);
    const next = current + 1 >= attackers.length ? null : attackers[current + 1];
    blocker.blocking = next;
    render();
  }

  function dealCombatDamage(firstStrike) {
    const attackerSide = active();
    const defenderSide = inactive();
    for (const attacker of state.clash.attackers) {
      if (!attackerSide.network.includes(attacker)) continue;
      const fs = hasKeyword(attacker.card, "First Strike");
      if (fs !== firstStrike) continue;
      const blockers = defenderSide.network.filter((b) => b.blocking === attacker);
      const power = statOf(attacker).action;
      if (!blockers.length) {
        defenderSide.uptime -= power;
        log(`${attacker.card.name} hits ${defenderSide.name} for ${power}.`, "warn");
      } else {
        let remaining = power;
        for (const blocker of blockers) {
          const lethal = Math.max(0, statOf(blocker).resilience - (blocker.damage || 0));
          const assign = Math.min(remaining, lethal);
          blocker.damage = (blocker.damage || 0) + assign;
          remaining -= assign;
        }
        if (remaining > 0 && hasKeyword(attacker.card, "Overflow")) {
          defenderSide.uptime -= remaining;
          log(`${attacker.card.name} overflows ${remaining} to ${defenderSide.name}.`, "warn");
        }
      }
    }
    for (const blocker of defenderSide.network) {
      if (!blocker.blocking) continue;
      const fs = hasKeyword(blocker.card, "First Strike");
      if (fs !== firstStrike) continue;
      blocker.blocking.damage = (blocker.blocking.damage || 0) + statOf(blocker).action;
    }
    stateChecks();
  }

  function advanceClash() {
    const clash = state.clash;
    if (clash.stage === "attackers") {
      clash.attackers = active().network.filter((e) => e.attacking);
      for (const attacker of clash.attackers) attacker.committed = true;
      log(
        clash.attackers.length
          ? `${active().name} attacks with ${clash.attackers.map((a) => a.card.name).join(", ")}.`
          : `${active().name} declares no attackers.`
      );
      clash.stage = clash.attackers.length ? "blockers" : "done";
      if (clash.stage === "done") return nextPhaseAfterClash();
      return render();
    }
    if (clash.stage === "blockers") {
      const blockers = inactive().network.filter((b) => b.blocking);
      log(blockers.length ? `${inactive().name} blocks with ${blockers.length}.` : `${inactive().name} does not block.`);
      clash.stage = "damage";
      dealCombatDamage(true);
      dealCombatDamage(false);
      for (const entry of [...active().network, ...inactive().network]) {
        entry.attacking = false;
        entry.blocking = null;
      }
      clash.stage = "done";
      burnBuffer(state.players[0], "Clash ends");
      burnBuffer(state.players[1], "Clash ends");
      return nextPhaseAfterClash();
    }
    return nextPhaseAfterClash();
  }

  function nextPhaseAfterClash() {
    state.phase += 1;
    log(`— ${phase().label} —`);
    runPhaseEntry();
  }

  // ------------------------------------------------------------ manual controls

  function manual(action, value) {
    const player = state.players[value?.side ?? state.turnPlayer];
    switch (action) {
      case "uptime":
        player.uptime += value.delta;
        log(`Manual: ${player.name} Uptime ${value.delta > 0 ? "+" : ""}${value.delta}.`, "manual");
        break;
      case "generate":
        player.buffer[value.symbol] += 1;
        log(`Manual: ${player.name} generates 1 ${SYMBOL_NAME[value.symbol] || "neutral"}.`, "manual");
        break;
      case "draw":
        draw(player, 1);
        log(`Manual: ${player.name} draws a card.`, "manual");
        break;
      case "clear":
        state.manualNote = null;
        break;
    }
    stateChecks();
    render();
  }

  function moveEntry(entry, zone) {
    const owner = ownerOf(entry);
    moveTo(owner, entry, zone);
    log(`Manual: ${entry.card.name} → ${zone}.`, "manual");
    stateChecks();
    render();
  }

  // ------------------------------------------------------------------- render

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function faceUrl(card) {
    return "../art/cards/node-runner-web/" + encodeURIComponent(card.face);
  }

  function cardNode(entry, options = {}) {
    const card = entry.card;
    const node = el("div", "gcard");
    if (entry.committed) node.classList.add("committed");
    if (entry.attacking) node.classList.add("attacking");
    if (entry.blocking) node.classList.add("blocking");
    if (options.faceDown) {
      node.classList.add("facedown");
      return node;
    }
    const img = el("img");
    img.src = faceUrl(card);
    img.alt = card.name;
    img.loading = "lazy";
    node.append(img);

    if (isAvatar(card)) {
      const stats = statOf(entry);
      const badge = el("span", "gstats", `${stats.action}/${stats.resilience - (entry.damage || 0)}`);
      if (entry.damage) badge.classList.add("hurt");
      node.append(badge);
    }
    if (card.manual) node.append(el("span", "gmanual", "!"));

    const targetable =
      pending && pending.options.some((o) => o.type === "entry" && o.entry === entry);
    if (targetable) node.classList.add("targetable");

    node.addEventListener("click", () => {
      if (targetable) {
        const chosen = pending.options.find((o) => o.type === "entry" && o.entry === entry);
        const cb = pending.onPick;
        pending = null;
        return cb(chosen);
      }
      if (options.onClick) options.onClick(entry);
    });
    node.addEventListener("mouseenter", () => showInspector(entry));
    return node;
  }

  function showInspector(entry) {
    const card = entry.card;
    const box = document.getElementById("inspector");
    box.innerHTML = "";
    const img = el("img");
    img.src = faceUrl(card);
    img.alt = card.name;
    box.append(img);
    const info = el("div", "ibody");
    info.append(el("strong", null, card.name));
    info.append(el("div", "imeta", `${card.type}${card.subtype ? " — " + card.subtype : ""} · ${card.affinity.join("/")} · Cost ${card.cost || "—"}`));
    if (card.text) info.append(el("p", "itext", card.text));
    if (card.manual) info.append(el("p", "imanualnote", "Assisted: resolve this card's text at the table."));
    const acts = el("div", "iacts");
    card.abilities.forEach((ability, index) => {
      if (ability.kind !== "activated") return;
      const button = el("button", null, `Activate: ${ability.text}`);
      button.addEventListener("click", () => activateAbility(entry, index));
      acts.append(button);
    });
    if (ownerOf(entry) && ownerOf(entry).network.includes(entry)) {
      for (const zone of ["archive", "wallet", "cold"]) {
        const button = el("button", "ghost", `→ ${zone}`);
        button.addEventListener("click", () => moveEntry(entry, zone));
        acts.append(button);
      }
      const toggle = el("button", "ghost", entry.committed ? "Unlock" : "Commit");
      toggle.addEventListener("click", () => {
        entry.committed = !entry.committed;
        render();
      });
      acts.append(toggle);
    }
    info.append(acts);
    box.append(info);
  }

  function renderZone(container, entries, options) {
    container.innerHTML = "";
    for (const entry of entries) container.append(cardNode(entry, options));
  }

  function render() {
    const you = active();
    const foe = inactive();

    document.getElementById("turnchip").innerHTML =
      `Turn <b>${state.turn}</b> · <b>${you.name}</b>` +
      (state.winner ? ` · <b>${state.winner} wins</b>` : "");

    const ribbon = document.getElementById("phases");
    ribbon.innerHTML = "";
    PHASES.forEach((p, index) => {
      const node = el("div", "phase" + (index === state.phase ? " active" : index < state.phase ? " done" : ""), p.label);
      ribbon.append(node);
    });

    for (const [side, player] of [["you", you], ["foe", foe]]) {
      document.getElementById(`${side}Name`).textContent = player.name;
      document.getElementById(`${side}Uptime`).textContent = player.uptime;
      document.getElementById(`${side}Counts`).textContent =
        `Stack ${player.stack.length} · Wallet ${player.wallet.length} · Archive ${player.archive.length}`;
      const buffer = document.getElementById(`${side}Buffer`);
      buffer.innerHTML = "";
      for (const key of [...SYMBOLS, "N"]) {
        if (!player.buffer[key]) continue;
        buffer.append(el("span", "pip pip-" + key, `${player.buffer[key]} ${key}`));
      }
    }

    renderZone(document.getElementById("foeNetwork"), foe.network, {
      onClick: (entry) => toggleBlock(entry),
    });
    renderZone(document.getElementById("youNetwork"), you.network, {
      onClick: (entry) => {
        if (phase().id === "clash" && state.clash.stage === "attackers") toggleAttacker(entry);
        else showInspector(entry);
      },
    });
    renderZone(document.getElementById("youHand"), you.wallet, {
      onClick: (entry) => playFromWallet(entry),
    });
    renderZone(
      document.getElementById("foeHand"),
      foe.wallet.map((e) => e),
      { faceDown: true }
    );

    const prompt = document.getElementById("prompt");
    if (state.winner) {
      prompt.textContent = `${state.winner} wins. Start a new game to play again.`;
      prompt.className = "prompt good";
    } else if (pending) {
      prompt.textContent = pending.prompt + " — click a highlighted target.";
      prompt.className = "prompt target";
    } else if (state.manualNote) {
      prompt.textContent = "Assisted: " + state.manualNote;
      prompt.className = "prompt manual";
    } else if (phase().id === "clash") {
      const stage = state.clash.stage;
      prompt.textContent =
        stage === "attackers"
          ? `${you.name}: click your Avatars to declare attackers, then Continue.`
          : stage === "blockers"
            ? `${foe.name}: click your Avatars to assign blocks, then Continue.`
            : "Clash resolved.";
      prompt.className = "prompt target";
    } else {
      prompt.textContent = `${you.name} — ${phase().label}. Play cards from your Wallet, then Continue.`;
      prompt.className = "prompt";
    }

    const logBox = document.getElementById("log");
    logBox.innerHTML = "";
    for (const entry of state.log.slice(0, 60)) {
      logBox.append(el("div", "logline " + (entry.tone || ""), entry.message));
    }

    document.getElementById("resourceChip").textContent = state.resourcePlayed
      ? "Resource play used"
      : "Resource play available";
  }

  // -------------------------------------------------------------------- setup

  function startGame() {
    const affinityA = document.getElementById("deckA").value;
    const affinityB = document.getElementById("deckB").value;
    const seed = Number(document.getElementById("seed").value) || Math.floor(Math.random() * 1e9);
    uidSeq = 1;
    state = {
      players: [
        newPlayer(document.getElementById("nameA").value || "Player 1", affinityA, seed),
        newPlayer(document.getElementById("nameB").value || "Player 2", affinityB, seed + 7717),
      ],
      turnPlayer: 0,
      firstPlayer: 0,
      turn: 1,
      phase: 0,
      resourcePlayed: false,
      clash: { stage: null, attackers: [], blocks: {} },
      untilEndOfTurn: [],
      log: [],
      manualNote: null,
      winner: null,
    };
    for (const player of state.players) draw(player, 7);
    document.getElementById("setup").hidden = true;
    document.getElementById("table").hidden = false;
    log(`=== Turn 1 · ${active().name} ===`);
    runPhaseEntry();
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
    document.getElementById("continue").addEventListener("click", () => {
      if (pending || state?.winner) return;
      nextPhase();
    });
    document.getElementById("endturn").addEventListener("click", () => {
      if (pending || state?.winner) return;
      state.phase = PHASES.length - 1;
      runPhaseEntry();
    });
    document.getElementById("cancelTarget").addEventListener("click", () => {
      pending = null;
      render();
    });
    document.getElementById("clearManual").addEventListener("click", () => manual("clear", {}));
    document.querySelectorAll("[data-manual]").forEach((button) => {
      button.addEventListener("click", () => {
        const [action, arg] = button.dataset.manual.split(":");
        const side = button.dataset.side === "foe" ? 1 - state.turnPlayer : state.turnPlayer;
        if (action === "uptime") manual("uptime", { delta: Number(arg), side });
        if (action === "generate") manual("generate", { symbol: arg, side });
        if (action === "draw") manual("draw", { side });
      });
    });
    document.getElementById("cardCount").textContent = CARDS.length;
  }

  window.addEventListener("DOMContentLoaded", init);
  window.E1_GAME = { get state() { return state; }, startGame };
})();
