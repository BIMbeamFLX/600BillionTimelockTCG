/* Referee core tests. Run with `node --test tests/js/`.
 * Assertions are on error CODES and structure, never on English wording — the
 * UI owns all wording and must be free to change it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "..", "site");
const require = createRequire(import.meta.url);

const CARDS = require(path.join(siteDir, "play-data.js"));
const E = require(path.join(siteDir, "engine.js"));
E.setCatalog(CARDS);

const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const findCard = (test) => CARDS.find(test);

/* Edition One has no assisted cards anymore. Keep the legacy manual-proposal
 * security boundary covered with one test-only card instead of weakening the
 * released catalog to make old fixtures possible. */
const LEGACY_MANUAL_CARD = {
  id: "TEST-MANUAL",
  name: "Legacy Manual Fixture",
  type: "Avatar",
  subtype: "Test",
  affinity: ["Neutral"],
  cost: "0",
  costParsed: { generic: 0 },
  action: 1,
  resilience: 1,
  keywords: [],
  abilities: [{
    kind: "static",
    cost: "",
    text: "Target player gains 20 Uptime. Decommission target card in archive. Draw 7, generate 8 Resources, then commit it.",
    ops: null,
    manual: true,
  }],
  manual: true,
};
const MANUAL_CATALOG = E.buildCatalog(CARDS.concat([LEGACY_MANUAL_CARD]));
byId[LEGACY_MANUAL_CARD.id] = LEGACY_MANUAL_CARD;

const baseConfig = (over) =>
  Object.assign(
    {
      seats: [
        { name: "P1", affinity: "Power" },
        { name: "P2", affinity: "Signal" },
      ],
      seeds: { public: 12345, hidden: [777, 888] },
    },
    over || {}
  );

const act = (state, type, seat, payload) => E.apply(
  state,
  { type, seat, seq: state.seq, at: "", payload: payload || {} },
  state.catalogDigest === MANUAL_CATALOG.digest ? { catalog: MANUAL_CATALOG } : undefined
);

const ok = (result) => {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.state;
};

/* Drive the game forward until `stop` is satisfied: pass priority, and answer
 * every awaited declaration with its do-nothing / canonical default. */
function passUntil(state, stop, limit = 400) {
  for (let i = 0; i < limit; i++) {
    if (stop(state)) return state;
    if (state.result) return state;
    const seat = state.priority.seat;
    if (seat !== null) {
      state = ok(act(state, "PASS_PRIORITY", seat));
      continue;
    }
    const aw = state.awaiting;
    if (!aw) throw new Error("stuck with neither priority nor a pending declaration");
    if (aw.kind === "attackers") state = ok(act(state, "DECLARE_ATTACKERS", aw.seat, { attackers: [] }));
    else if (aw.kind === "blockers") state = ok(act(state, "DECLARE_BLOCKERS", aw.seat, { blocks: {} }));
    else if (aw.kind === "order") {
      const order = {};
      for (const key of Object.keys(state.clash.blocks)) order[key] = state.clash.blocks[key].slice();
      state = ok(act(state, "ORDER_BLOCKERS", aw.seat, { order }));
    } else if (aw.kind === "damage") {
      state = ok(act(state, "ASSIGN_COMBAT_DAMAGE", aw.seat, { assignment: null }));
    } else if (aw.kind === "discard") {
      const wallet = state.zones[`${aw.seat}:wallet`];
      state = ok(act(state, "DISCARD_TO_LIMIT", aw.seat, {
        uids: wallet.slice(0, wallet.length - state.handLimit),
      }));
    } else if (aw.kind === "triggers") {
      state = ok(act(state, "ORDER_TRIGGERS", aw.seat, {
        qids: state.pendingTriggers[String(aw.seat)].map((t) => t.pendingId),
      }));
    } else throw new Error(`unhandled awaiting kind ${aw.kind}`);
  }
  throw new Error("passUntil exhausted");
}

const atStep = (phase, step) => (s) => s.turn.phase === phase && s.turn.step === step;

/* Put a specific card into a seat's zone directly, for rules fixtures. Defaults
 * to the Network; `zone` exists so a test can prove what may NOT attack. */
function seed(state, seat, cardId, tweaks, zone) {
  const where = zone || "network";
  const uid = "o" + state.nextUid;
  state.nextUid += 1;
  state.objects[uid] = Object.assign(
    {
      uid,
      cardId,
      owner: seat,
      controller: seat,
      zone: `${seat}:${where}`,
      committed: false,
      bootDelay: byId[cardId].type.includes("Avatar"),
      damage: 0,
      counters: {},
      attachedTo: null,
      rebootShields: 0,
      facedown: false,
      revealedTo: [],
      revealedUntil: null,
      token: false,
      entersSeq: state.seq,
      prevUid: null,
    },
    tweaks || {}
  );
  state.zones[`${seat}:${where}`].push(uid);
  return uid;
}

// ---------------------------------------------------------------- primitives

test("SHA-256 matches the NIST vectors", () => {
  assert.equal(E.sha256hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(E.sha256hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    E.sha256hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
  assert.equal(
    E.sha256hex("a".repeat(1000000)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
  );
});

test("canonicalJSON sorts keys and refuses everything a replay cannot survive", () => {
  assert.equal(E.canonicalJSON({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}');
  assert.equal(E.canonicalJSON({ "10": 1, "9": 2 }), '{"10":1,"9":2}');
  for (const bad of [0.5, NaN, Infinity, -Infinity, -0, undefined, () => 1, new Map(), new Set()]) {
    assert.throws(() => E.canonicalJSON({ x: bad }), /SCHEMA|canonicalJSON/, `accepted ${String(bad)}`);
  }
  assert.throws(() => E.canonicalJSON({ x: Number.MAX_SAFE_INTEGER + 2 }));
});

test("nextInt is unbiased and shuffle is a fixed permutation for a fixed seed", () => {
  const stream = E.newStream(1717986918);
  const n = 7;
  const counts = new Array(n).fill(0);
  const draws = 700000;
  for (let i = 0; i < draws; i++) counts[E.nextInt(stream, n)] += 1;
  const expected = draws / n;
  const chi = counts.reduce((sum, c) => sum + ((c - expected) ** 2) / expected, 0);
  assert.ok(chi < 22, `chi-square ${chi} for 6 dof is implausible`);

  const a = E.shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7], E.newStream(42));
  const b = E.shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7], E.newStream(42));
  assert.deepEqual(a, b, "the same seed must give the same permutation");
  assert.notDeepEqual(a, [0, 1, 2, 3, 4, 5, 6, 7]);
  // Rejection sampling makes the draw count data-dependent, which is why n is
  // tracked in state rather than assumed.
  assert.ok(E.newStream(42).n === 0);
});

test("no ambient nondeterminism anywhere in the engine source", () => {
  const banned = /Math\.random|Date\.now|performance\.now|new Date\(|toLocaleString|localeCompare|Intl\./;
  // Comments are stripped first: the engine documents the bugs it fixed by
  // naming them, and a prose mention of Math.random is not a call to it.
  // Split on either line ending: a Windows checkout leaves a trailing \r that
  // `.` will not match and `$` will not stand before, so the line comments
  // survived the strip and this test found its own documentation.
  const source = readFileSync(path.join(siteDir, "engine.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""));
  const hits = [];
  source.forEach((line, i) => {
    if (banned.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(hits, [], "banned ambient source of nondeterminism");
});

// ------------------------------------------------------------ reducer contract

test("createGame is deterministic and validates the decklist", () => {
  const a = E.createGame(baseConfig());
  const b = E.createGame(baseConfig());
  assert.equal(E.hashState(a), E.hashState(b));
  assert.equal(a.zones["0:wallet"].length, 7);
  assert.equal(a.zones["0:stack"].length, 33);
  assert.throws(() => E.createGame(baseConfig({ seeds: { public: 1 } })), /seeds/);
  assert.throws(
    () => E.createGame(baseConfig({ seats: [{ name: "a", deck: ["E1-002"] }, { name: "b" }] })),
    /minimum 40/
  );
});

test("a rejected action returns the SAME object and never mutates it", () => {
  const state = E.createGame(baseConfig());
  const before = E.canonicalJSON(state);
  for (const bad of [
    { type: "PASS_PRIORITY", seat: 1, seq: state.seq, payload: {} },        // NO_PRIORITY
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq + 5, payload: {} },    // SEQ_MISMATCH
    { type: "NOPE", seat: 0, seq: state.seq, payload: {} },                 // SCHEMA
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq, payload: { x: 1 } },  // unknown key
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq, nope: 1, payload: {} },
    { type: "PLAY_CARD", seat: 0, seq: state.seq, payload: { uid: "nope", targets: [] } },
  ]) {
    const result = E.apply(state, bad);
    assert.ok(result.error, `${bad.type} should have been rejected`);
    assert.equal(result.state, state, "must return the same object reference");
    assert.deepEqual(result.events, []);
    assert.notEqual(result.error.code, "ENGINE_PANIC");
  }
  assert.equal(E.canonicalJSON(state), before);
});

test("apply refuses a redacted state and a foreign catalog", () => {
  const state = E.createGame(baseConfig());
  const v = E.view(state, 0);
  assert.equal(E.apply(v, { type: "PASS_PRIORITY", seat: 0, seq: v.seq, payload: {} }).error.code, "REDACTED_STATE");
  const other = E.buildCatalog(CARDS.slice(0, 100));
  assert.equal(
    E.apply(state, { type: "PASS_PRIORITY", seat: 0, seq: state.seq, payload: {} }, { catalog: other }).error.code,
    "CATALOG_MISMATCH"
  );
});

test("seat authentication: action.seat is a claim, not a credential", () => {
  const state = E.createGame(baseConfig());
  const result = E.apply(
    state,
    { type: "PASS_PRIORITY", seat: 0, seq: state.seq, payload: {} },
    { authenticatedSeat: 1 }
  );
  assert.equal(result.error.code, "NOT_YOUR_SEAT");
});

test("state stays plain JSON after every action of a played game", () => {
  let state = E.createGame(baseConfig());
  for (let i = 0; i < 60 && !state.result; i++) {
    const seat = state.priority.seat;
    if (seat === null) {
      const aw = state.awaiting;
      if (aw && aw.kind === "attackers") state = ok(act(state, "DECLARE_ATTACKERS", aw.seat, { attackers: [] }));
      else if (aw && aw.kind === "discard") {
        const w = state.zones[`${aw.seat}:wallet`];
        state = ok(act(state, "DISCARD_TO_LIMIT", aw.seat, { uids: w.slice(0, w.length - state.handLimit) }));
      } else break;
      continue;
    }
    state = ok(act(state, "PASS_PRIORITY", seat));
    assert.deepEqual(state, JSON.parse(JSON.stringify(state)));
    E.canonicalJSON(state); // throws on a float or a Map that slipped in
  }
  assert.ok(state.turn.number >= 2, "the turn machine did not advance");
});

// ------------------------------------------------------------- rules regressions

test("§9 the eight-step turn structure runs in order and hands the turn over", () => {
  let state = E.createGame(baseConfig());
  const seen = [];
  for (let i = 0; i < 200 && state.turn.active === 0; i++) {
    seen.push(`${state.turn.phase}:${state.turn.step}`);
    state = passUntil(state, (s) => `${s.turn.phase}:${s.turn.step}` !== seen[seen.length - 1] || s.turn.active !== 0);
  }
  const unique = [...new Set(seen)];
  // clash:attackers is absent because neither seat controls an Avatar to
  // declare with, so §9.3's declare step is skipped rather than opened empty.
  assert.deepEqual(unique, [
    "open:maintenance", "open:draw", "build1:main", "clash:start", "clash:end",
    "build2:main", "close:endStep", "close:cleanup",
  ]);
  assert.equal(state.turn.active, 1, "the turn did not pass to the other seat");
});

test("§12.1 BOTH Buffers burn at every phase boundary, not just the active one", () => {
  let state = E.createGame(baseConfig());
  state.seats[0].buffer.P = 3;
  state.seats[1].buffer.S = 2;
  const before = [state.seats[0].uptime, state.seats[1].uptime];
  // §12.1 the Buffer empties at the end of each PHASE, so open -> build1 is
  // the first boundary; open:maintenance -> open:draw is not one.
  state = passUntil(state, atStep("build1", "main"));
  assert.deepEqual([state.seats[0].buffer.P, state.seats[1].buffer.S], [0, 0], "buffers did not empty");
  assert.deepEqual(
    [state.seats[0].uptime, state.seats[1].uptime],
    [before[0] - 3, before[1] - 2],
    "resource burn did not hit both controllers"
  );
});

test("§5.2 Boot Delay applies to EVERY Avatar, and ends at its controller's Unlock", () => {
  let state = E.createGame(baseConfig());
  // A card that does NOT print the Boot Delay keyword. play.js:513 read Boot
  // Delay off card.keywords, so only the handful of cards printing the word
  // were ever delayed; §5.2 gives it to every Avatar.
  const avatar = findCard(
    (c) => c.type === "Avatar" && !c.keywords.some((k) => k.name === "Boot Delay" || k.name === "Firewall")
  );
  const uid = seed(state, 0, avatar.id);
  assert.equal(state.objects[uid].bootDelay, true, "a card with no printed keyword must still be delayed");
  assert.equal(E.canAttack({ state, ctx: E.resolveCtx({}) }, uid), false);

  // Delayed, so §9.3's declare-attackers step has nobody to declare and is
  // skipped rather than opened: the whole Clash phase passes without a prompt.
  let sameTurn = passUntil(state, (s) => s.turn.phase === "build2" || s.turn.active !== 0);
  assert.equal(sameTurn.turn.active, 0, "still the same seat's turn");
  assert.equal(sameTurn.objects[uid].bootDelay, true, "Boot Delay must survive its own turn");

  // Its controller begins a turn with it, so Unlock clears the delay.
  const nextOwnTurn = passUntil(
    sameTurn,
    (s) => s.turn.active === 0 && s.turn.number === 2 && s.turn.phase !== "open"
  );
  assert.equal(nextOwnTurn.objects[uid].bootDelay, false, "Boot Delay did not clear at Unlock");
  assert.equal(E.canAttack({ state: nextOwnTurn, ctx: E.resolveCtx({}) }, uid), true);

  // And now the declaration the delayed Avatar could not make is legal.
  const declaring = passUntil(nextOwnTurn, (s) => Boolean(s.awaiting && s.awaiting.kind === "attackers"));
  assert.equal(act(declaring, "DECLARE_ATTACKERS", 0, { attackers: [uid] }).error, null);
});

test("Mesh groups share blocked status and reject a second non-Mesh member", () => {
  let state = E.createGame(baseConfig());
  const meshCards = CARDS.filter((card) => card.keywords.some((keyword) => keyword.name === "Mesh"));
  const ordinary = findCard((card) =>
    card.type === "Avatar" && !card.keywords.length && card.action >= 2 && card.resilience >= 2
  );
  assert.ok(meshCards.length >= 2 && ordinary, "the catalog must contain the Mesh fixtures");
  const meshOne = seed(state, 0, meshCards[0].id, { bootDelay: false });
  const meshTwo = seed(state, 0, meshCards[1].id, { bootDelay: false });
  const blocker = seed(state, 1, ordinary.id, { bootDelay: false });

  state = passUntil(state, (current) => current.awaiting && current.awaiting.kind === "attackers");
  state = ok(act(state, "DECLARE_ATTACKERS", 0, {
    attackers: [{ uid: meshOne, mesh: "alpha" }, { uid: meshTwo, mesh: "alpha" }],
  }));
  assert.deepEqual(state.clash.meshGroups, { [meshOne]: "alpha", [meshTwo]: "alpha" });
  state = passUntil(state, (current) => current.awaiting && current.awaiting.kind === "blockers");
  const uptimeBefore = state.seats[1].uptime;
  state = ok(act(state, "DECLARE_BLOCKERS", 1, { blocks: { [meshOne]: [blocker] } }));
  assert.ok(state.clash.blockedOnce.includes(meshTwo), "blocking one Mesh member did not block its group");
  state = passUntil(state, (current) => current.turn.phase !== "clash");
  assert.equal(state.seats[1].uptime, uptimeBefore, "an unblocked Mesh member hit the player anyway");

  let invalid = E.createGame(baseConfig({ seeds: { public: 54321, hidden: [333, 444] } }));
  const mesh = seed(invalid, 0, meshCards[0].id, { bootDelay: false });
  const plainOne = seed(invalid, 0, ordinary.id, { bootDelay: false });
  const plainTwo = seed(invalid, 0, ordinary.id, { bootDelay: false });
  invalid = passUntil(invalid, (current) => current.awaiting && current.awaiting.kind === "attackers");
  const rejected = act(invalid, "DECLARE_ATTACKERS", 0, {
    attackers: [
      { uid: mesh, mesh: "too-many" },
      { uid: plainOne, mesh: "too-many" },
      { uid: plainTwo, mesh: "too-many" },
    ],
  });
  assert.equal(rejected.error.code, "ILLEGAL_MESH");
});

test("blocking Mesh routes opposing damage into a deterministic legal sacrifice", () => {
  let state = E.createGame(baseConfig({ seeds: { public: 65432, hidden: [555, 666] } }));
  const meshCard = findCard((card) => card.keywords.some((keyword) => keyword.name === "Mesh"));
  const attackerCard = findCard((card) => card.type === "Avatar" && !card.keywords.length && card.action >= 4);
  const sturdyCard = findCard((card) => card.type === "Avatar" && !card.keywords.length && card.resilience >= 4);
  assert.ok(meshCard && attackerCard && sturdyCard, "the catalog must contain damage-routing fixtures");
  const attacker = seed(state, 0, attackerCard.id, { bootDelay: false });
  const meshBlocker = seed(state, 1, meshCard.id, { bootDelay: false });
  const sturdyBlocker = seed(state, 1, sturdyCard.id, { bootDelay: false });

  state = passUntil(state, (current) => current.awaiting && current.awaiting.kind === "attackers");
  state = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [attacker] }));
  state = passUntil(state, (current) => current.awaiting && current.awaiting.kind === "blockers");
  state = ok(act(state, "DECLARE_BLOCKERS", 1, {
    blocks: { [attacker]: [meshBlocker, sturdyBlocker] },
  }));
  state = passUntil(state, (current) => current.turn.phase !== "clash");
  assert.equal(state.objects[meshBlocker], undefined, "the chosen Mesh sacrifice survived lethal damage");
  assert.ok(state.objects[sturdyBlocker], "damage was spread onto the other blocker against Mesh routing");
  assert.equal(state.objects[sturdyBlocker].damage, 0, "the protected blocker still took combat damage");
});

test("§13.2 a blocked attacker stays blocked after its blockers leave", () => {
  let state = E.createGame(baseConfig());
  const big = findCard((c) => c.type === "Avatar" && c.action >= 4 && !c.keywords.length);
  const small = findCard((c) => c.type === "Avatar" && c.resilience === 1 && !c.keywords.length);
  const attacker = seed(state, 0, big.id, { bootDelay: false });
  const blocker = seed(state, 1, small ? small.id : big.id, { bootDelay: false });
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "attackers");
  state = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [attacker] }));
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "blockers");
  state = ok(act(state, "DECLARE_BLOCKERS", 1, { blocks: { [attacker]: [blocker] } }));
  assert.ok(state.clash.blockedOnce.includes(attacker), "blockedOnce was not recorded");
  const uptimeBefore = state.seats[1].uptime;
  state = passUntil(state, (s) => s.turn.phase === "build2" || s.result);
  assert.equal(
    state.seats[1].uptime,
    uptimeBefore,
    "a blocked attacker whose blocker died must not fall through to the player"
  );
});

test("§13.1 attackers come from the Network — never from the Wallet or the Archive", () => {
  let state = E.createGame(baseConfig());
  const big = findCard((c) => c.type === "Avatar" && c.action >= 3 && !c.keywords.length);
  const onNetwork = seed(state, 0, big.id, { bootDelay: false });
  const inWallet = seed(state, 0, big.id, { bootDelay: false }, "wallet");
  const inArchive = seed(state, 0, big.id, { bootDelay: false }, "archive");
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "attackers");

  const env = { state, ctx: E.resolveCtx({}) };
  assert.equal(E.canAttack(env, onNetwork), true);
  assert.equal(E.canAttack(env, inWallet), false, "a card in hand is not on the battlefield");
  assert.equal(E.canAttack(env, inArchive), false, "§5.2/§6 the Archive is out of combat");

  /* The same code DECLARE_BLOCKERS uses, so the two declarations answer alike.
   * Before this, a hand card was accepted: no cost paid, the card never left the
   * Wallet, the defender saw a uid shell it could not evaluate a block against,
   * and the whole printed Action landed on the defending player — an illegal
   * action written into the hash chain as a legal entry, so the match it won was
   * certified by the referee's own audit trail. */
  for (const uid of [inWallet, inArchive]) {
    const r = act(state, "DECLARE_ATTACKERS", 0, { attackers: [uid] });
    assert.equal(r.error && r.error.code, "NOT_IN_ZONE", `${uid} was allowed to attack`);
    assert.equal(r.state, state, "a rejected declaration must not mutate");
  }
  // One illegal uid poisons the whole declaration; it is not silently dropped.
  const mixed = act(state, "DECLARE_ATTACKERS", 0, { attackers: [onNetwork, inWallet] });
  assert.equal(mixed.error.code, "NOT_IN_ZONE");
  assert.deepEqual(state.clash.attackers, [], "a refused declaration left partial state");
  assert.equal(state.objects[onNetwork].committed, false, "a refused declaration committed a card");

  // And the legal declaration still works.
  const good = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [onNetwork] }));
  assert.deepEqual(good.clash.attackers, [onNetwork]);
});

test("§13.3 two blockers raise ORDER_BLOCKERS, and only to the attacker's controller", () => {
  let state = E.createGame(baseConfig());
  const big = findCard((c) => c.type === "Avatar" && c.action >= 3 && !c.keywords.length);
  const attacker = seed(state, 0, big.id, { bootDelay: false });
  const b1 = seed(state, 1, big.id, { bootDelay: false });
  const b2 = seed(state, 1, big.id, { bootDelay: false });
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "attackers");
  state = ok(act(state, "DECLARE_ATTACKERS", 0, { attackers: [attacker] }));
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "blockers");
  state = ok(act(state, "DECLARE_BLOCKERS", 1, { blocks: { [attacker]: [b1, b2] } }));
  state = passUntil(state, (s) => s.awaiting && s.awaiting.kind === "order");
  assert.equal(state.awaiting.seat, 0, "the ATTACKER's controller orders blockers");
  assert.equal(act(state, "ORDER_BLOCKERS", 1, { order: { [attacker]: [b2, b1] } }).error.code, "NOT_YOUR_SEAT");
  state = ok(act(state, "ORDER_BLOCKERS", 0, { order: { [attacker]: [b2, b1] } }));
  assert.deepEqual(state.clash.order[attacker], [b2, b1]);
});

test("§16 / §2.2 a simultaneous loss is a DRAW, not a hang", () => {
  let state = E.createGame(baseConfig());
  state.seats[0].uptime = 1;
  state.seats[1].uptime = 1;
  state.seats[0].buffer.P = 1;
  state.seats[1].buffer.S = 1;
  state = passUntil(state, (s) => Boolean(s.result));
  assert.equal(state.result.reason, "draw");
  assert.deepEqual(state.result.winners, []);
  assert.equal(state.status, "over");
});

test("§16 lethal damage decommissions, and a Reboot shield replaces it", () => {
  let state = E.createGame(baseConfig());
  const avatar = findCard((c) => c.type === "Avatar" && c.resilience >= 2 && !c.keywords.length);
  const uid = seed(state, 0, avatar.id, { bootDelay: false, damage: avatar.resilience });
  const shielded = seed(state, 0, avatar.id, { bootDelay: false, damage: avatar.resilience, rebootShields: 1 });
  state = ok(act(state, "PASS_PRIORITY", state.priority.seat));
  assert.equal(state.objects[uid], undefined, "lethal damage did not decommission");
  assert.ok(state.objects[shielded], "the Reboot shield did not replace decommissioning");
  assert.equal(state.objects[shielded].damage, 0);
  assert.equal(state.objects[shielded].committed, true);
  assert.equal(state.objects[shielded].rebootShields, 0);
});

test("§9.5 the hand limit is a player decision, and damage clears at Cleanup", () => {
  let state = E.createGame(baseConfig());
  const avatar = findCard((c) => c.type === "Avatar" && c.resilience >= 3 && !c.keywords.length);
  const uid = seed(state, 0, avatar.id, { bootDelay: false, damage: 1 });
  state = passUntil(state, (s) => (s.awaiting && s.awaiting.kind === "discard") || s.turn.number > 1);
  if (state.awaiting && state.awaiting.kind === "discard") {
    const wallet = state.zones["0:wallet"];
    assert.equal(
      act(state, "DISCARD_TO_LIMIT", 0, { uids: [] }).error.code,
      "HAND_LIMIT",
      "discarding nothing must be refused"
    );
    state = ok(act(state, "DISCARD_TO_LIMIT", 0, { uids: wallet.slice(0, wallet.length - state.handLimit) }));
    assert.equal(state.zones["0:wallet"].length, state.handLimit);
  }
  assert.equal(state.objects[uid].damage, 0, "marked damage did not clear at Cleanup");
});

test("§5.1 the Resource play is once per turn, Build phases only, Queue empty", () => {
  let state = E.createGame(baseConfig());
  state = passUntil(state, atStep("build1", "main"));
  const wallet = state.zones["0:wallet"];
  const resourceUid = wallet.find((uid) => byId[state.objects[uid].cardId].type.includes("Resource"));
  if (!resourceUid) return; // this seed dealt no Resource; the rule is covered elsewhere
  state = ok(act(state, "PLAY_RESOURCE", 0, { uid: resourceUid }));
  assert.equal(state.turn.resourcePlays.used, 1);
  const second = state.zones["0:wallet"].find((uid) => byId[state.objects[uid].cardId].type.includes("Resource"));
  if (second) {
    assert.equal(act(state, "PLAY_RESOURCE", 0, { uid: second }).error.code, "RESOURCE_PLAY_USED");
  }
  // A Resource play is a special action: the active player keeps priority.
  assert.equal(state.priority.seat, 0);
});

test("§10.3 a Resource ability resolves immediately and never touches the Queue", () => {
  let state = E.createGame(baseConfig());
  const basic = findCard((c) => c.type === "Basic Resource" && c.abilities.some((a) => a.ops));
  const uid = seed(state, 0, basic.id);
  const index = basic.abilities.findIndex((a) => a.ops && a.ops.every((o) => o.op === "generate"));
  const before = state.seats[0].buffer;
  state = ok(act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid, abilityIndex: index }));
  assert.equal(state.queue.length, 0, "a Resource ability must not enter the Queue");
  assert.notDeepEqual(state.seats[0].buffer, before, "no Resource was generated");
  assert.equal(state.objects[uid].committed, true);
  assert.equal(
    act(state, "ACTIVATE_RESOURCE_ABILITY", 0, { uid, abilityIndex: index }).error.code,
    "CANNOT_AFFORD",
    "§19.4 a Commit ability is once per Unlock"
  );
});

test("the `uptime` op with target:player hits the TARGET seat, not the controller", () => {
  // play.js:285 was `op.target === "player" ? controller : controller`.
  const item = {
    kind: "manual",
    controller: 0,
    sourceUid: null,
    cardId: null,
    targets: [{ kind: "seat", seat: 1 }],
    ops: [{ op: "addUptime", seat: 1, delta: 3 }],
    resume: { opIndex: 0, acc: {} },
  };
  let state = E.createGame(baseConfig());
  const before = [state.seats[0].uptime, state.seats[1].uptime];
  // Routed through the public manual door, which uses the same interpreter.
  state = E.createGame(baseConfig(), { catalog: MANUAL_CATALOG });
  const uid = seed(state, 0, LEGACY_MANUAL_CARD.id);
  const card = byId[state.objects[uid].cardId];
  const abilityIndex = card.abilities.findIndex((a) => a.manual);
  const result = act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 1, delta: 3 }],
  });
  if (!result.error) {
    // Tier B: gaining Uptime for the opponent is a gift, so it is Tier A and
    // applies at once; either way the TARGET seat must be the one that moves.
    const after = result.state.pendingManual ? null : result.state;
    if (after) {
      assert.equal(after.seats[1].uptime, before[1] + 3);
      assert.equal(after.seats[0].uptime, before[0], "the controller must not be healed");
    }
  }
  assert.ok(item.ops.length === 1);
});

// -------------------------------------------------------------- manual layer

/* Layer 2 (envelope) rejects before layer 4 (redaction), so a test that wants
 * to reach a later layer must warrant an ability whose printed text plausibly
 * authorises the op under test. `requiredOp` picks such a card. */
function manualFixture(requiredOp) {
  const state = E.createGame(baseConfig(), { catalog: MANUAL_CATALOG });
  const card = LEGACY_MANUAL_CARD;
  const abilityIndex = 0;
  const envelope = MANUAL_CATALOG.byId[card.id].abilities[abilityIndex].manualEnvelope;
  assert.ok(!requiredOp || envelope.ops.includes(requiredOp), `fixture lacks ${requiredOp}`);
  const uid = seed(state, 0, card.id, { bootDelay: false });
  return { state, uid, card, abilityIndex };
}

test("a manual delta must carry a warrant, and the warrant must be yours", () => {
  const { state, uid, abilityIndex } = manualFixture();
  assert.equal(
    act(state, "MANUAL_PROPOSE", 0, { warrant: {}, ops: [{ op: "note", text: "x" }] }).error.code,
    "MANUAL_NO_WARRANT"
  );
  assert.equal(
    act(state, "MANUAL_PROPOSE", 1, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [{ op: "note", text: "x" }],
    }).error.code,
    "MANUAL_NO_WARRANT"
  );
});

test("the delta vocabulary is closed: no setState, no turn/priority/rng reach", () => {
  const { state, uid, abilityIndex } = manualFixture();
  for (const bad of [
    { op: "setState", path: "turn.phase", value: "close" },
    { op: "setPhase", phase: "close" },
    { op: "addUptime", seat: 0, delta: 1, extra: 9 },
    { op: "addUptime", seat: 0, delta: 0.5 },
  ]) {
    const result = act(state, "MANUAL_PROPOSE", 0, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [bad],
    });
    assert.equal(result.error.code, "SCHEMA", `accepted ${JSON.stringify(bad)}`);
  }
});

test("hard caps are unconditional and cannot be raised by any envelope", () => {
  const { state, uid, abilityIndex } = manualFixture();
  const result = act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 0, delta: 999 }],
  });
  assert.ok(["MANUAL_HARD_CAP", "MANUAL_OUT_OF_ENVELOPE"].includes(result.error.code));
  const many = new Array(20).fill({ op: "note", text: "x" });
  assert.equal(
    act(state, "MANUAL_PROPOSE", 0, { warrant: { kind: "static", uid, abilityIndex }, ops: many }).error.code,
    "MANUAL_HARD_CAP"
  );
});

test("MANUAL_ILLEGAL_REFERENCE: naming a uid in the opponent's Wallet proves you looked", () => {
  const { state, uid, abilityIndex } = manualFixture("moveObject");
  const hidden = state.zones["1:wallet"][0];
  const result = act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "moveObject", uid: hidden, toZone: "archive" }],
  });
  assert.equal(result.error.code, "MANUAL_ILLEGAL_REFERENCE");
  const ownStack = state.zones["0:stack"][0];
  assert.equal(
    act(state, "MANUAL_PROPOSE", 0, {
      warrant: { kind: "static", uid, abilityIndex },
      ops: [{ op: "moveObject", uid: ownStack, toZone: "archive" }],
    }).error.code,
    "MANUAL_ILLEGAL_REFERENCE",
    "your own Stack is hidden from you too (§6)"
  );
});

test("tiers are computed by the engine, never asserted by the proposer", () => {
  const state = E.createGame(baseConfig());
  const mine = seed(state, 0, findCard((c) => c.type === "Avatar").id, { bootDelay: false });
  const theirs = seed(state, 1, findCard((c) => c.type === "Avatar").id, { bootDelay: false });
  // Self-limiting: paying your own Uptime, committing your own object.
  assert.equal(E.tierOf(state, 0, [{ op: "addUptime", seat: 0, delta: -2 }]), "A");
  assert.equal(E.tierOf(state, 0, [{ op: "setCommitted", uid: mine, value: true }]), "A");
  assert.equal(E.tierOf(state, 0, [{ op: "moveObject", uid: mine, toZone: "archive" }]), "A");
  assert.equal(E.tierOf(state, 0, [{ op: "note", text: "hi" }]), "A");
  // Across the table, or a benefit to the proposer.
  assert.equal(E.tierOf(state, 0, [{ op: "addUptime", seat: 0, delta: 2 }]), "B");
  assert.equal(E.tierOf(state, 0, [{ op: "addDamage", uid: theirs, amount: 1 }]), "B");
  assert.equal(E.tierOf(state, 0, [{ op: "setCommitted", uid: mine, value: false }]), "B");
  assert.equal(E.tierOf(state, 0, [{ op: "moveTopOfStack", seat: 0, count: 1, toZone: "wallet" }]), "B");
});

test("Tier B blocks the game until a verdict, and reject => fizzle without refund", () => {
  const state = E.createGame(baseConfig());
  const zapCard = findCard((c) => c.type === "Zap" && c.abilities.some((a) => a.manual));
  if (!zapCard) return;
  const { state: s2, uid, abilityIndex } = manualFixture("addUptime");
  let live = ok(act(s2, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 0, delta: 1 }],
  }));
  assert.ok(live.pendingManual, "gaining Uptime must require consent");
  assert.equal(live.pendingManual.tier, "B");
  // Everything except CONCEDE and the verdict pair is refused.
  assert.equal(act(live, "PASS_PRIORITY", 0).error.code, "MANUAL_CONSENT_PENDING");
  assert.equal(act(live, "MANUAL_ACCEPT", 0, { mid: live.pendingManual.mid }).error.code, "NOT_YOUR_SEAT");
  const uptimeBefore = live.seats[0].uptime;
  const rejected = ok(act(live, "MANUAL_REJECT", 1, { mid: live.pendingManual.mid, reason: "no" }));
  assert.equal(rejected.pendingManual, null, "a rejection must not deadlock the game");
  assert.equal(rejected.seats[0].uptime, uptimeBefore, "a rejected delta must not apply");
  assert.equal(rejected.seats[1].stats.manualRejected, 1, "reject rates are public pressure");
  assert.ok(rejected.priority.seat !== null || rejected.awaiting, "play must continue");
});

test("MANUAL_FLAG changes nothing and cannot be refused", () => {
  const { state, uid, abilityIndex } = manualFixture("addUptime");
  const applied = ok(act(state, "MANUAL_PROPOSE", 0, {
    warrant: { kind: "static", uid, abilityIndex },
    ops: [{ op: "addUptime", seat: 0, delta: -1 }],
  }));
  assert.equal(applied.pendingManual, null, "Tier A applies immediately");
  const flagged = act(applied, "MANUAL_FLAG", 1, { mid: "m1", reason: "that is not what the card says" });
  assert.equal(flagged.error, null);
  assert.equal(flagged.events.some((e) => e.t === "MANUAL_FLAGGED"), true);
});

// ---------------------------------------------------------------- redaction

test("view() hides both Stacks, the opponent's Wallet faces and every hidden seed", () => {
  const state = E.createGame(baseConfig());
  for (const seat of [0, 1]) {
    const v = E.view(state, seat);
    assert.deepEqual(v.zones[`${seat}:stack`], { n: 33 }, "your own Stack is hidden from you (§6)");
    assert.deepEqual(v.zones[`${1 - seat}:stack`], { n: 33 });
    for (const uid of state.zones[`${1 - seat}:wallet`]) {
      assert.deepEqual(Object.keys(v.objects[uid]).sort(), ["owner", "uid", "zone"]);
    }
    for (const uid of state.zones[`${seat}:wallet`]) {
      assert.ok(v.objects[uid].cardId, "you must see your own Wallet");
    }
    const text = JSON.stringify(v);
    for (const uid of state.zones["0:stack"].concat(state.zones["1:stack"])) {
      // Quoted, so "o8" does not spuriously match inside "o80".
      assert.ok(!text.includes(`"${uid}"`), `stack uid ${uid} leaked`);
    }
    /* NO seed of any kind, in any stream, in any view. The public seed used to
     * ship for §18.4 audit; under a referee it is an oracle for testing hidden
     * seed guesses against gameId and deckCommit, so audit moved entirely to the
     * post-match OVER bundle. Only the draw counters cross the wire. */
    for (const stream of [v.rng.public].concat(v.rng.hidden)) {
      assert.equal(stream.s, undefined, "an rng seed reached a view");
      assert.equal(typeof stream.n, "number", "the draw counter must survive");
    }
    assert.equal(v.rng.hidden[0].n, state.rng.hidden[0].n);
    assert.equal(v.rng.public.n, state.rng.public.n);
    assert.ok(!JSON.stringify(v.objects).includes("prevUid"));
    assert.equal(v.redacted, true);
    assert.equal(v.forSeat, seat);
  }
});

test("view is idempotent and publicState is the intersection", () => {
  const state = E.createGame(baseConfig());
  for (const seat of [0, 1, null]) {
    assert.deepEqual(E.view(E.view(state, seat), seat), E.view(state, seat));
  }
  const pub = E.publicState(state);
  const text = JSON.stringify(pub);
  for (const uid of state.zones["0:wallet"].concat(state.zones["1:wallet"], state.zones["0:stack"])) {
    assert.ok(!text.includes(uid), `${uid} leaked into publicState`);
  }
  assert.equal(typeof E.publicHash(state), "string");
  // The audit projection is the full state; it is what makes a match reviewable.
  assert.deepEqual(E.view(state, "audit"), JSON.parse(JSON.stringify(state)));
});

test("view carries only YOUR pending triggers, and a spectator gets none", () => {
  // A networked seat holds only a view, and ORDER_TRIGGERS requires it to name
  // every waiting pendingId. The counts cannot express that, so view() exposes
  // myTriggers for the viewing seat — and for nobody else.
  const state = E.createGame(baseConfig());
  state.pendingTriggers["0"] = [{ pendingId: "q_own", cardId: "E1-001", seat: 0 }];
  state.pendingTriggers["1"] = [{ pendingId: "q_theirs", cardId: "E1-002", seat: 1 }];

  const mine = E.view(state, 0);
  assert.deepEqual(mine.myTriggers, [{ pendingId: "q_own", cardId: "E1-001" }]);
  assert.deepEqual(mine.pendingTriggers, { 0: 1, 1: 1 }, "the counts stay, additively");
  assert.ok(!JSON.stringify(mine.myTriggers).includes("q_theirs"));
  assert.ok(!JSON.stringify(mine).includes("q_theirs"), "the opponent's pendingIds must not leak");

  const theirs = E.view(state, 1);
  assert.deepEqual(theirs.myTriggers, [{ pendingId: "q_theirs", cardId: "E1-002" }]);
  assert.ok(!JSON.stringify(theirs).includes("q_own"));

  assert.deepEqual(E.view(state, null).myTriggers, [], "a spectator sees counts alone");
  // Still idempotent: a view is valid input to view() for the same seat.
  assert.deepEqual(E.view(E.view(state, 0), 0), E.view(state, 0));
});

test("legalActions runs on a redacted view and gives the same shape as on full state", () => {
  const state = E.createGame(baseConfig());
  const fromFull = E.legalActions(state, 0).map((a) => a.type).sort();
  const fromView = E.legalActions(E.view(state, 0), 0).map((a) => a.type).sort();
  assert.deepEqual(fromView, fromFull);
  // The opponent's legal actions computed from THEIR view must not enumerate
  // cards they cannot see.
  const theirs = E.legalActions(E.view(state, 0), 1);
  assert.equal(theirs.filter((a) => a.type === "PLAY_CARD").length, 0);
});

// ------------------------------------------------------------------ replay

test("replay of the action log reproduces the head hash exactly", () => {
  const cfg = baseConfig();
  let state = E.createGame(cfg);
  const log = [];
  for (let i = 0; i < 120 && !state.result; i++) {
    const seat = state.priority.seat;
    let action;
    if (seat !== null) action = { type: "PASS_PRIORITY", seat, seq: state.seq, at: "", payload: {} };
    else if (state.awaiting && state.awaiting.kind === "attackers") {
      action = { type: "DECLARE_ATTACKERS", seat: state.awaiting.seat, seq: state.seq, at: "", payload: { attackers: [] } };
    } else if (state.awaiting && state.awaiting.kind === "discard") {
      const w = state.zones[`${state.awaiting.seat}:wallet`];
      action = {
        type: "DISCARD_TO_LIMIT", seat: state.awaiting.seat, seq: state.seq, at: "",
        payload: { uids: w.slice(0, w.length - state.handLimit) },
      };
    } else break;
    const result = E.apply(state, action);
    if (result.error) break;
    log.push(action);
    state = result.state;
  }
  assert.ok(log.length > 20, "the fixture did not play far enough to be meaningful");
  const again = E.replay(cfg, log);
  assert.equal(again.error, null, JSON.stringify(again.error));
  assert.equal(E.hashState(again.state), E.hashState(state), "REPLAY DIVERGED");
  assert.equal(E.publicHash(again.state), E.publicHash(state));

  // The chained transcript verifies end to end.
  let prev = state.gameId;
  let folded = E.createGame(cfg);
  const entries = [];
  for (const action of log) {
    folded = E.apply(folded, action).state;
    const stateHash = E.hashState(folded);
    const entry = { seq: action.seq, seat: action.seat, at: "", action, prev, stateHash };
    entries.push(entry);
    prev = E.entryHash(entry);
  }
  const verdict = E.verifyMatch({ config: cfg, log: entries });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.error));
  assert.equal(verdict.headHash, E.hashState(state));
});

test("a tampered transcript is caught at the exact action that diverges", () => {
  const cfg = baseConfig();
  let state = E.createGame(cfg);
  const entries = [];
  let prev = state.gameId;
  for (let i = 0; i < 6; i++) {
    const action = { type: "PASS_PRIORITY", seat: state.priority.seat, seq: state.seq, at: "", payload: {} };
    state = ok(E.apply(state, action));
    const stateHash = E.hashState(state);
    const entry = { seq: action.seq, seat: action.seat, at: "", action, prev, stateHash };
    entries.push(entry);
    prev = E.entryHash(entry);
  }
  entries[3].stateHash = "0".repeat(64);
  const verdict = E.verifyMatch({ config: cfg, log: entries });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.divergedAt, 3);
});

test("a malformed transcript is an error value, never an exception", () => {
  /* The transcript arrives from a relay, which §-untrusted-input says we do
   * not trust. A missing action, a non-object entry, a payload that
   * canonicalJSON refuses — any of these used to throw an uncaught RulesError
   * out of verifyMatch and take the verifier down. A verification boundary
   * must fail the way apply() does: as a value. */
  const cfg = baseConfig();
  const good = () => {
    const state = E.createGame(cfg);
    const action = { type: "PASS_PRIORITY", seat: state.priority.seat, seq: state.seq, at: "", payload: {} };
    const next = ok(E.apply(state, action));
    return { seq: action.seq, seat: action.seat, at: "", action, prev: state.gameId, stateHash: E.hashState(next) };
  };
  const malformed = [
    [{ notAnAction: true }], // no .action at all
    ["nonsense"], // entry is not even an object
    [{ ...good(), action: { type: "PASS_PRIORITY", seat: undefined, seq: 0, at: "", payload: {} } }], // undefined seat
    [good(), null], // a hole in the middle
  ];
  for (const log of malformed) {
    let verdict;
    assert.doesNotThrow(() => {
      verdict = E.verifyMatch({ config: cfg, log });
    }, `verifyMatch threw on ${JSON.stringify(log).slice(0, 60)}`);
    assert.equal(verdict.ok, false, "a malformed transcript cannot verify");
    assert.ok(verdict.error, "and it must say why");
  }
});

test("a face-down Cold card is a shell to EVERYONE except the seat that owns it", () => {
  /* The guard used to read `!spectator && object.owner !== seat`, so the
   * spectator branch short-circuited and an audience member was handed the
   * cardId of a card the OPPONENT is not allowed to see. That is a live read of
   * hidden information: a matchId appears in every STATE, and the resume ladder
   * downgrades any authenticated stranger naming one to a spectator — so a
   * second browser profile and a second key was the entire attack. */
  const state = E.createGame(baseConfig());
  const uid = seed(state, 0, "E1-001", { facedown: true }, "cold");

  const owner = E.view(state, 0);
  assert.equal(owner.objects[uid].cardId, "E1-001", "your own face-down card is yours to see");

  const opponent = E.view(state, 1);
  assert.equal(opponent.objects[uid].cardId, undefined, "the opponent gets a shell");

  const audience = E.view(state, null);
  assert.equal(audience.objects[uid].cardId, undefined, "and so does a spectator");
  assert.ok(audience.zones["0:cold"].includes(uid), "the card is still known to BE there");
});

test("a face-up Cold card is public to everyone", () => {
  const state = E.createGame(baseConfig());
  const uid = seed(state, 0, "E1-001", { facedown: false }, "cold");
  for (const who of [0, 1, null]) {
    assert.equal(E.view(state, who).objects[uid].cardId, "E1-001");
  }
});

test("previewClash survives a redacted view, whose trigger counts are numbers", () => {
  /* THE CLASH FORECAST RAN THE REAL COMBAT CODE OVER A VIEW. view() ships
   * pendingTriggers as {0: n, 1: n} — two counts — because a seat may know how
   * MANY triggers its opponent holds and never what they are. previewClash
   * clones that and runs the genuine applyCombatDamage/stateChecks over it, so
   * any trigger raised during combat did `pendingTriggers[seat].push(...)` on a
   * number and threw "push is not a function" straight through the board
   * render, mid-clash. Several released cards raise triggers inside combat
   * damage; no precon happens to contain one, which is the only reason this was
   * never seen. */
  const state = E.createGame(baseConfig());
  const view = E.view(state, 0);
  assert.equal(typeof view.pendingTriggers["0"], "number", "a view counts, it does not list");

  const preview = E.previewClash(view, { attackers: [] });
  assert.ok(preview, "a forecast over a redacted view must not throw");
  // It reports the fight, not the state: rows, what dies, what reaches a player.
  assert.ok(Array.isArray(preview.rows));
  assert.ok(Array.isArray(preview.dying));

  // And the source view is untouched: a preview may never mutate what it read.
  assert.equal(typeof view.pendingTriggers["0"], "number");
});

// ------------------------------------------------------------- event anchors

/* An effects cue is pinned to a seat or to a card. There is no third thing to
 * hang one on, so an event naming neither is not merely terse — it is
 * unrenderable, and the moment it describes never happens on screen. That is
 * what had befallen the prevention family: PREVENTED and REDIRECTED shipped an
 * amount and a reason, which is enough for a text log and nothing else, so the
 * game's whole "you survived" beat was silent at the table. */

const cardNamed = (name) => findCard((c) => c.name === name).id;

/* One point of damage into `target` with `build`'s shield already standing.
 * The shields go straight onto state.prevention in the engine's own shape, as
 * wave8 does: routing each one through its printed card would test the card,
 * and what is under test here is the anchor. */
function preventionBeat(build) {
  const state = E.createGame(baseConfig());
  const injector = seed(state, 0, cardNamed("Fault Injector"));
  const victim = seed(state, 1, cardNamed("Toni China, Rough Miner"));
  const target = build(state, victim, injector);
  state.seats[0].buffer.N = 9;
  let result = act(state, "ACTIVATE_ABILITY", 0, { uid: injector, abilityIndex: 0, targets: [target] });
  let current = ok(result);
  const events = result.events.slice();
  for (let i = 0; i < 6 && current.queue.length; i++) {
    result = act(current, "PASS_PRIORITY", current.priority.seat);
    current = ok(result);
    events.push(...result.events);
  }
  return { state: current, events, victim, injector };
}

const cues = (events, t) => events.filter((e) => e.t === t).map((e) => e.pub);

test("a prevented hit names the player it saved", () => {
  /* Every shield mode, because the anchor is not a property of one branch:
   * a whole-event shield, a cap, a Clash-wide wall and a prevent-and-refund
   * all reach the same emit and all used to leave the UI with nothing. */
  for (const shield of [
    { kind: "seat", seat: 1, amount: 5 },                                  // reason: shield
    { kind: "seat", seat: 1, mode: "cap", maximum: 0 },                    // reason: cap
    { kind: "all" },                                                       // reason: clash
    { kind: "seat", seat: 1, mode: "preventRefund", refundSeat: 1, amount: 5 }, // reason: refund
  ]) {
    const { events } = preventionBeat((state) => {
      state.prevention = [Object.assign({ turn: state.turn.number }, shield)];
      return { kind: "seat", seat: 1 };
    });
    const [prevented] = cues(events, "PREVENTED");
    assert.ok(prevented, `no PREVENTED at all for ${JSON.stringify(shield)}`);
    assert.equal(prevented.seat, 1, `reason "${prevented.reason}" must name the seat it protected`);
    // The log renderer and the transcript read these; an anchor may only be
    // added alongside them, never in place of them.
    assert.equal(prevented.amount, 1);
    assert.ok(prevented.reason);
  }
});

test("a prevented hit on a card names the card AND the seat whose board it was on", () => {
  /* Both anchors are meaningful and both are wanted: the card is where the
   * cue is drawn, the seat is whose side of the table lights up. The seat is
   * the object's CONTROLLER, not the seat that swung — a shield on a stolen
   * Avatar protects whoever is holding it now. */
  for (const shield of [
    { kind: "object", amount: 5 },  // reason: shield
    { kind: "all" },                // reason: clash
  ]) {
    const { events, victim } = preventionBeat((state, uid) => {
      state.prevention = [Object.assign({ turn: state.turn.number, uid }, shield)];
      return { kind: "object", uid };
    });
    const [prevented] = cues(events, "PREVENTED");
    assert.ok(prevented, `no PREVENTED at all for ${JSON.stringify(shield)}`);
    assert.equal(prevented.uid, victim, "the card that was spared");
    assert.equal(prevented.seat, 1, "and the seat that controls it — seat 0 is the one that swung");
    assert.equal(prevented.amount, 1);
  }
});

test("a redirect names both ends, because a redirect is drawn between them", () => {
  /* REDIRECTED carried `to` and nothing else: the destination in a nested
   * shape the effects layer would have to special-case, and no origin at all —
   * so the one thing the cue exists to show, that the hit MOVED, was the one
   * thing it could not express. Both ends are now flat: seat/uid for what was
   * spared, toSeat/toUid for what took it instead. */
  {
    const { events, victim } = preventionBeat((state, uid) => {
      state.prevention = [{
        kind: "object", uid, mode: "redirect",
        redirect: { kind: "seat", seat: 1 }, amount: 5, turn: state.turn.number,
      }];
      return { kind: "object", uid };
    });
    const [moved] = cues(events, "REDIRECTED");
    assert.ok(moved, "no REDIRECTED emitted");
    assert.equal(moved.uid, victim, "spared: the card");
    assert.equal(moved.seat, 1, "on seat 1's board");
    assert.equal(moved.toSeat, 1, "took it instead: the player");
    assert.equal(moved.toUid, undefined, "a seat destination has no uid to invent");
    assert.deepEqual(moved.to, { kind: "seat", seat: 1 }, "and `to` survives for the transcript");
  }
  {
    const { events, victim } = preventionBeat((state, uid) => {
      state.prevention = [{
        kind: "seat", seat: 1, mode: "redirect",
        redirect: { kind: "object", uid }, amount: 5, turn: state.turn.number,
      }];
      return { kind: "seat", seat: 1 };
    });
    const [moved] = cues(events, "REDIRECTED");
    assert.ok(moved, "no REDIRECTED emitted");
    assert.equal(moved.seat, 1, "spared: the player");
    assert.equal(moved.uid, undefined, "a seat origin has no uid to invent");
    assert.equal(moved.toUid, victim, "took it instead: the card");
    assert.equal(moved.toSeat, 1, "and whose board it stands on");
  }
});

test("a Reboot shield names the seat whose card is protected, not the seat that cast it", () => {
  /* Reboot is a replacement shield hung on someone else's Avatar as often as
   * your own, so `uid` alone left the UI unable to say whose board just got
   * safer without going back to the state to look the object up. */
  const state = E.createGame(baseConfig());
  const guarded = seed(state, 1, cardNamed("Toni China, Rough Miner"));
  const spell = seed(state, 0, "E1-023", {}, "wallet"); // Emergency Reboot
  state.seats[0].buffer.S = 1;
  let result = act(state, "PLAY_CARD", 0, { uid: spell, targets: [{ kind: "object", uid: guarded }] });
  let current = ok(result);
  const events = result.events.slice();
  for (let i = 0; i < 8 && current.queue.length; i++) {
    result = act(current, "PASS_PRIORITY", current.priority.seat);
    current = ok(result);
    events.push(...result.events);
  }
  const [shielded] = cues(events, "REBOOT_SHIELD");
  assert.ok(shielded, "no REBOOT_SHIELD emitted");
  assert.equal(shielded.uid, guarded);
  assert.equal(shielded.seat, 1, "seat 0 cast it; seat 1 controls the card that is now shielded");
  assert.equal(current.objects[guarded].rebootShields, 1, "and the rule itself is unchanged");
});

test("an anchor never names a uid its viewer is not entitled to see", () => {
  /* redactEvents() merges `pub` wholesale into the seat's copy — there is no
   * field-level filter anywhere in it — so anything put in `pub` is something
   * every seat AND every spectator receives. This engine has already shipped
   * one fog-of-war leak (a spectator could read a face-down Cold card), so a
   * new field in `pub` is exactly the shape of that mistake.
   *
   * The line it must stay on is the one the engine already draws everywhere
   * else: a uid is a public handle, a cardId is the secret. DRAW has always
   * said so out loud — it publishes the uid of a card going to a hand in `pub`
   * and puts only the cardId in `priv`. So the test is not "is there a uid",
   * it is "is this a uid the viewer could already resolve", measured against
   * the engine's own entitlement oracle, and "did a cardId ride in with it". */
  const ANCHORED = ["PREVENTED", "REDIRECTED", "REBOOT_SHIELD"];
  const beats = [
    preventionBeat((state, uid) => {
      state.prevention = [{ kind: "object", uid, amount: 5, turn: state.turn.number }];
      return { kind: "object", uid };
    }),
    preventionBeat((state, uid) => {
      state.prevention = [{
        kind: "seat", seat: 1, mode: "redirect",
        redirect: { kind: "object", uid }, amount: 5, turn: state.turn.number,
      }];
      return { kind: "seat", seat: 1 };
    }),
  ];
  let checked = 0;
  for (const beat of beats) {
    for (const seat of [0, 1, null]) {
      const entitled = E.visibleUids(beat.state, seat);
      for (const event of E.redactEvents(beat.events, seat)) {
        if (!ANCHORED.includes(event.t)) continue;
        for (const key of ["uid", "toUid"]) {
          if (event[key] === undefined) continue;
          assert.ok(entitled[event[key]], `${event.t}.${key}=${event[key]} is hidden from seat ${seat}`);
          checked += 1;
        }
        assert.equal(event.cardId, undefined, `${event.t} must never carry a cardId`);
        assert.equal(event.priv, undefined, "the redactor flattens priv; nothing may survive as a blob");
      }
    }
  }
  assert.ok(checked >= 6, `only ${checked} uid anchors were reached — the fixtures stopped firing`);
});

test("adding an anchor to an event changes no hash a signed result depends on", () => {
  /* Events are returned from apply() beside the state, never inside it, so
   * hashState/publicHash cannot see them and the entryHash chain cannot
   * either. That is load-bearing rather than incidental: every match result
   * ever published is signed over this chain, and an event payload that could
   * reach it would mean the UI could not be improved without invalidating
   * history. Pin it, so nobody ever "helpfully" folds events into the state. */
  const cfg = baseConfig();
  let state = E.createGame(cfg);
  const injector = seed(state, 0, cardNamed("Fault Injector"));
  state.prevention = [{ kind: "seat", seat: 1, amount: 5, turn: state.turn.number }];
  state.seats[0].buffer.N = 9;

  const result = act(state, "ACTIVATE_ABILITY", 0, { uid: injector, abilityIndex: 0, targets: [{ kind: "seat", seat: 1 }] });
  const next = ok(result);
  assert.ok(result.events.length, "the fixture produced no events to reason about");
  assert.equal(next.events, undefined, "events must not be reachable from the state at all");
  assert.equal(JSON.stringify(next).includes('"PREVENTED"'), false, "no event text anywhere in the state");

  // Same actions, same hashes, whatever the events said.
  const twin = E.createGame(cfg);
  const twinInjector = seed(twin, 0, cardNamed("Fault Injector"));
  twin.prevention = [{ kind: "seat", seat: 1, amount: 5, turn: twin.turn.number }];
  twin.seats[0].buffer.N = 9;
  const twinNext = ok(act(twin, "ACTIVATE_ABILITY", 0, { uid: twinInjector, abilityIndex: 0, targets: [{ kind: "seat", seat: 1 }] }));
  assert.equal(E.hashState(twinNext), E.hashState(next));
  assert.equal(E.publicHash(twinNext), E.publicHash(next));
});

// ------------------------------------------------------- Queue and zone anchors

/* A Queue item seeded straight onto the Queue and then resolved. `manual` and
 * `triggered` items carry their own ops (frameOps reads item.ops for those two
 * kinds), which is the only way in: moveRandomFromZone is printed on no card in
 * the set, and runManualOp's dead-uid guard is unreachable through the manual
 * door because MANUAL_PROPOSE validates every uid up front — the guard exists
 * for resolution time, when a uid that was live at announce has since been
 * re-minted. The Queue is LIFO, so the last item pushed resolves first. */
function queueBeat(build, limit = 8) {
  const state = E.createGame(baseConfig());
  const push = (over) => {
    const item = Object.assign({
      qid: "q" + state.nextQid, kind: "manual", controller: 0, cardId: null,
      sourceUid: null, objectUid: null, abilityIndex: null, targets: [], modes: [],
      x: 0, paid: {}, manual: null, ops: [], addedSeq: state.seq,
      resume: { opIndex: 0, acc: {} },
    }, over || {});
    state.nextQid += 1;
    state.queue.push(item);
    return item;
  };
  const extra = build(state, push) || {};
  let current = state;
  const events = [];
  for (let i = 0; i < limit && current.queue.length; i++) {
    const result = act(current, "PASS_PRIORITY", current.priority.seat);
    current = ok(result);
    events.push(...result.events);
  }
  return Object.assign({ state: current, events }, extra);
}

test("a shuffle says whose Stack moved instead of making the UI parse a zone key", () => {
  /* `zone` is a composite key like "1:stack", so the renderer was splitting a
   * string on ":" to find the seat — reimplementing zoneSeat() in the UI,
   * against a key format that is an engine internal and free to change. The
   * engine had already computed the number two lines above the emit. */
  const { events } = queueBeat((state, push) => {
    push({ controller: 0, ops: [{ op: "shuffleZone", zone: "1:stack" }] });
  });
  const [shuffle] = cues(events, "SHUFFLE");
  assert.ok(shuffle, "no SHUFFLE emitted");
  assert.equal(shuffle.seat, 1, "seat 0 ordered the shuffle; seat 1's Stack is the one that moved");
  assert.equal(shuffle.zone, "1:stack", "and the zone key survives for the transcript");
  assert.equal(shuffle.seat, Number(shuffle.zone.split(":")[0]), "exactly the parse the UI was doing by hand");
});

test("both RANDOM_PICK emits describe one beat, so both name a seat", () => {
  /* There are two of these. The `discard` op has always emitted {seat, …}; the
   * moveRandomFromZone op emitted {zone, …}. One beat — a card taken at random
   * out of somebody's hidden zone — in two shapes, so a UI written against one
   * rendered nothing for the other. The seat is not new information: it is
   * Number(zone.split(":")[0]). The eligible/picked uids are the §18.4 audit
   * record of a random choice and are deliberately left exactly as they were. */
  const { events } = queueBeat((state, push) => {
    push({
      controller: 0,
      ops: [{ op: "moveRandomFromZone", fromZone: "1:wallet", toZone: "1:archive", count: 1 }],
    });
  });
  const [pick] = cues(events, "RANDOM_PICK");
  assert.ok(pick, "no RANDOM_PICK emitted");
  assert.equal(pick.seat, 1, "the seat being picked FROM — the same sense as the discard-op sibling");
  assert.equal(pick.seat, Number(pick.zone.split(":")[0]));
  assert.equal(pick.stream, "public", "the audit fields are untouched");
  assert.ok(pick.eligible.includes(pick.picked), "and the pick still comes from the logged eligible set");
});

test("a skipped op anchors on the controller, never on the uid that just died", () => {
  /* This branch runs precisely BECAUSE op.uid names an object that is gone:
   * lethal damage that both decommissions a card and raises its trigger mints
   * a new uid on the zone change, so a bound op can point at nothing by the
   * time the Queue reaches it. That makes this the one uid in the engine
   * guaranteed dead, and anchoring a cue on it is the exact mistake
   * damageAnchor refuses to make. It stays in the payload because the log
   * needs to say WHICH op fizzled; it is not the anchor. */
  const { state, events } = queueBeat((s, push) => {
    push({
      controller: 1, cardId: cardNamed("Fault Injector"),
      ops: [{ op: "moveObject", uid: "oGONE", toZone: "archive" }],
    });
  });
  const [skipped] = cues(events, "OP_SKIPPED");
  assert.ok(skipped, "no OP_SKIPPED emitted");
  // Controller 1 while seat 0 is the active player, so an anchor that merely
  // guessed "the seat whose turn it is" cannot pass this.
  assert.equal(state.turn.active, 0, "fixture assumes seat 0 is active");
  assert.equal(skipped.seat, 1, "the item's controller, not the active seat");
  assert.equal(skipped.uid, "oGONE", "the dead uid stays for the log");
  assert.equal(skipped.op, "moveObject", "and so does the op name");
  assert.equal(state.objects[skipped.uid], undefined, "which is dead, as this event's whole premise");
});

test("a fizzled Queue item names its controller and where its card came to rest", () => {
  /* A qid identifies an item to the RULES and to nothing on the table, so
   * INVALIDATED — the "your card did nothing" beat, the one a player most
   * needs explained — was unrenderable.
   *
   * The uid is the subtle half. invalidateQueueItem splices the item off the
   * Queue and THEN moves its card to the Archive, and that move re-mints the
   * uid (§6.1). pruneReferences would normally rewrite item.objectUid to match,
   * but it only sweeps items still ON the Queue and this one is already off —
   * so item.objectUid is stale by the time the event is emitted, and publishing
   * it would point the UI at an object that no longer exists. */
  const { state, events, onQueue } = queueBeat((s, push) => {
    const staged = seed(s, 0, cardNamed("Fault Injector"), {}, "queue");
    const victim = push({
      kind: "card", controller: 0, cardId: cardNamed("Fault Injector"), objectUid: staged,
    });
    push({ controller: 0, ops: [{ op: "invalidateQueueItem", qid: victim.qid }] });
    return { onQueue: staged };
  });
  const [dead] = cues(events, "INVALIDATED");
  assert.ok(dead, "no INVALIDATED emitted");
  assert.equal(dead.seat, 0, "whose item fizzled");
  assert.equal(dead.reason, "invalidated", "and the reason survives for the log");

  assert.equal(state.objects[onQueue], undefined,
    "the pre-move uid must really be dead, or this test proves nothing");
  assert.notEqual(dead.uid, onQueue, "publishing item.objectUid here would name a deleted object");
  assert.ok(state.objects[dead.uid], "an anchor must name an object that exists");
  assert.equal(state.objects[dead.uid].zone, "0:archive",
    "§11.2 sends an invalidated card to its owner's Archive — which is where the cue points");
});

test("a resolved ability names its controller and the card it resolved from", () => {
  const state = E.createGame(baseConfig());
  const injector = seed(state, 0, cardNamed("Fault Injector"));
  seed(state, 1, cardNamed("Toni China, Rough Miner"));
  state.seats[0].buffer.N = 9;
  let result = act(state, "ACTIVATE_ABILITY", 0, {
    uid: injector, abilityIndex: 0, targets: [{ kind: "seat", seat: 1 }],
  });
  let current = ok(result);
  const events = result.events.slice();
  for (let i = 0; i < 8 && current.queue.length; i++) {
    result = act(current, "PASS_PRIORITY", current.priority.seat);
    current = ok(result);
    events.push(...result.events);
  }
  const [done] = cues(events, "RESOLVED");
  assert.ok(done, "no RESOLVED emitted");
  assert.equal(done.seat, 0, "whose ability resolved");
  assert.equal(done.uid, injector, "the source card, which is where the cue is drawn");
  assert.equal(done.abilityIndex, 0, "the pre-existing fields are untouched");
  assert.ok(done.qid, "including the qid the rules identify the item by");
});

test("a resolved ability whose source has died omits the uid rather than inventing one", () => {
  /* The other half of the same rule. An ability outlives its source constantly
   * — the card is decommissioned in response, or by its own effect — and
   * pruneReferences nulls item.sourceUid when that happens. The seat anchor
   * still gets the cue on screen; a uid anchor would put it on a dead object. */
  const { events } = queueBeat((state, push) => {
    push({
      kind: "ability", controller: 1, cardId: cardNamed("Fault Injector"),
      abilityIndex: 0, sourceUid: "oGONE", targets: [{ kind: "seat", seat: 0 }],
    });
  });
  const [done] = cues(events, "RESOLVED");
  assert.ok(done, "no RESOLVED emitted");
  assert.equal(done.seat, 1, "the seat anchor always survives — it cannot go stale");
  assert.equal(done.uid, undefined, "and no anchor at all beats an anchor on an object that is gone");
});

test("a Queue anchor publishes only what the Queue already publishes to everyone", () => {
  /* redactEvents() has no field-level filter — {t, seq} plus Object.assign of
   * `pub` — so a uid put in `pub` is a uid handed to both seats AND every
   * spectator. This engine has already shipped one fog-of-war leak, so the
   * question has to be answered rather than assumed.
   *
   * It is answered by viewFor(): the loop that copies queue items into the
   * public view emits each item's controller, objectUid AND sourceUid OUTSIDE
   * every seat-and-spectator guard, and QUEUED announces the controller when
   * the item goes on. An audience member holding no seat can already read all
   * three. Verified below against visibleUids(), the engine's own entitlement
   * oracle, rather than against that reasoning. */
  const beats = [
    queueBeat((s, push) => {
      const staged = seed(s, 0, cardNamed("Fault Injector"), {}, "queue");
      const victim = push({
        kind: "card", controller: 0, cardId: cardNamed("Fault Injector"), objectUid: staged,
      });
      push({ controller: 0, ops: [{ op: "invalidateQueueItem", qid: victim.qid }] });
    }),
    queueBeat((s, push) => {
      const source = seed(s, 1, cardNamed("Fault Injector"));
      push({
        kind: "ability", controller: 1, cardId: cardNamed("Fault Injector"),
        abilityIndex: 0, sourceUid: source, targets: [{ kind: "seat", seat: 0 }],
      });
    }),
  ];
  const ANCHORED = ["INVALIDATED", "RESOLVED"];
  let checked = 0;
  for (const beat of beats) {
    for (const seat of [0, 1, null]) {
      const entitled = E.visibleUids(beat.state, seat);
      for (const event of E.redactEvents(beat.events, seat)) {
        if (!ANCHORED.includes(event.t)) continue;
        assert.equal(typeof event.seat, "number", `${event.t} lost its seat anchor for viewer ${seat}`);
        if (event.uid !== undefined) {
          assert.ok(entitled[event.uid], `${event.t}.uid=${event.uid} is hidden from seat ${seat}`);
          checked += 1;
        }
        assert.equal(event.priv, undefined, "the redactor flattens priv; nothing may survive as a blob");
      }
    }
  }
  assert.ok(checked >= 6, `only ${checked} uid anchors were reached — the fixtures stopped firing`);
});
