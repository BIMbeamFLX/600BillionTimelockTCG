/* The ladder is a FUNCTION of signed events, so these tests are the ladder's
 * whole trust model written down: what counts, what is refused, and why.
 *
 * Run: node --test tests/js/ladder.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { schnorr } = require("@noble/curves/secp256k1");
require("../../site/schnorr.js");
const Ladder = require("../../site/ladder.js");

const KEY = (label) => Uint8Array.from(createHash("sha256").update(`ladder:${label}`).digest());
const PUB = (sk) => Buffer.from(schnorr.getPublicKey(sk)).toString("hex");

const ALICE = KEY("alice");
const BOB = KEY("bob");
const MALLORY = KEY("mallory");

const eventId = (event) => createHash("sha256").update(JSON.stringify([
  0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
])).digest("hex");

function sign(sk, event) {
  const full = Object.assign({ pubkey: PUB(sk) }, event);
  full.id = eventId(full);
  full.sig = Buffer.from(schnorr.sign(full.id, sk)).toString("hex");
  return full;
}

/** The exact bytes the referee hands BOTH seats — that is why agreement is a string compare. */
function resultContent(matchId, winnerSeat, extra) {
  return JSON.stringify(Object.assign({
    v: 1,
    kind: "result",
    matchId,
    players: [
      { seat: 0, pubkey: PUB(ALICE), name: "alice", affinity: "Power" },
      { seat: 1, pubkey: PUB(BOB), name: "bob", affinity: "Signal" },
    ],
    winners: winnerSeat === null ? [] : [winnerSeat],
    losers: winnerSeat === null ? [0, 1] : [1 - winnerSeat],
    reason: winnerSeat === null ? "draw" : "uptime",
    turns: 7,
    endedAt: "2026-08-15T12:00:00.000Z",
  }, extra || {}));
}

const resultEvent = (sk, matchId, content, createdAt) =>
  sign(sk, {
    kind: 31600,
    created_at: createdAt || 1785310322,
    tags: [["d", matchId], ["t", "600b-timelock-tcg"]],
    content,
  });

const startEvent = (sk, matchId, stake) =>
  sign(sk, {
    kind: 4600,
    created_at: 1785310000,
    tags: [["t", "start"], ["t", "600b-timelock-tcg"], ["m", matchId]],
    content: JSON.stringify({ v: 1, kind: "start", matchId, stake }),
  });

/** One match both seats agreed on, alice winning. */
const agreedMatch = (matchId, winnerSeat) => {
  const content = resultContent(matchId, winnerSeat);
  return [resultEvent(ALICE, matchId, content), resultEvent(BOB, matchId, content)];
};

// ---------------------------------------------------------------- counting

test("a match counts only when both seats signed byte-identical bytes", async () => {
  const { rows, counted, rejected } = await Ladder.standings(agreedMatch("m_0000000000a1", 0));
  assert.equal(counted, 1);
  assert.deepEqual(rejected, []);
  assert.equal(rows.length, 2);

  const alice = rows.find((r) => r.pubkey === PUB(ALICE));
  const bob = rows.find((r) => r.pubkey === PUB(BOB));
  assert.equal(alice.wins, 1);
  assert.equal(alice.losses, 0);
  assert.equal(bob.wins, 0);
  assert.equal(bob.losses, 1);
  assert.equal(alice.name, "alice", "the name a player signed under is the name shown");

  // From equal footing, Elo is symmetric: what one gains the other loses.
  assert.equal(alice.rating - Ladder.START_RATING, Ladder.START_RATING - bob.rating);
  assert.ok(alice.rating > bob.rating);
  assert.equal(rows[0].pubkey, PUB(ALICE), "the table is sorted by rating");
});

test("one seat alone proves nothing", async () => {
  const matchId = "m_0000000000a2";
  const content = resultContent(matchId, 0);
  const { counted, rejected } = await Ladder.standings([resultEvent(ALICE, matchId, content)]);
  assert.equal(counted, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].why, /only 1 of 2/);
});

test("two seats claiming different winners cancel out", async () => {
  const matchId = "m_0000000000a3";
  const { counted, rejected } = await Ladder.standings([
    resultEvent(ALICE, matchId, resultContent(matchId, 0)),
    resultEvent(BOB, matchId, resultContent(matchId, 1)),
  ]);
  assert.equal(counted, 0, "a disputed match must not silently pick a side");
  assert.match(rejected[0].why, /different results/);
});

test("a bystander cannot co-sign someone else's match", async () => {
  /* Without the "signed by a named player" rule, anyone could supply the second
   * signature on a real result and manufacture agreement out of one seat. */
  const matchId = "m_0000000000a4";
  const content = resultContent(matchId, 0);
  const { counted, rejected } = await Ladder.standings([
    resultEvent(ALICE, matchId, content),
    resultEvent(MALLORY, matchId, content),
  ]);
  assert.equal(counted, 0);
  assert.ok(rejected.some((r) => /did not play/.test(r.why)));
});

test("a good signature over swapped content is refused", async () => {
  const matchId = "m_0000000000a5";
  const honest = resultEvent(ALICE, matchId, resultContent(matchId, 0));
  const forged = resultEvent(BOB, matchId, resultContent(matchId, 0));
  // The attack this exists to stop: keep the signature, change what it says.
  forged.content = resultContent(matchId, 1);
  const { counted, rejected } = await Ladder.standings([honest, forged]);
  assert.equal(counted, 0);
  assert.ok(rejected.some((r) => /signature does not verify|different results/.test(r.why)));
});

test("an event addressed to a different match than it describes is refused", async () => {
  const matchId = "m_0000000000a6";
  const content = resultContent(matchId, 0);
  const mislabelled = sign(ALICE, {
    kind: 31600,
    created_at: 1785310322,
    tags: [["d", "m_0000000000ff"], ["t", "600b-timelock-tcg"]],
    content,
  });
  const { rejected } = await Ladder.standings([mislabelled, resultEvent(BOB, matchId, content)]);
  assert.ok(rejected.some((r) => /d tag/.test(r.why)));
});

test("kind 31600 is addressable: one row per author per match, newest wins", async () => {
  /* Relays are supposed to replace these and several do not. A client that
   * counts both copies calls its own corrected result a dispute. */
  const matchId = "m_0000000000a7";
  const content = resultContent(matchId, 0);
  const { counted, rejected } = await Ladder.standings([
    resultEvent(ALICE, matchId, resultContent(matchId, 1), 1785310000), // an earlier, wrong one
    resultEvent(ALICE, matchId, content, 1785310999),                   // the correction
    resultEvent(BOB, matchId, content, 1785310999),
  ]);
  assert.equal(counted, 1, "the superseded copy must not count as a disagreement");
  assert.deepEqual(rejected, []);
});

// ------------------------------------------------------------------ stakes

test("a stake binds only when both seats signed the same number", async () => {
  const matchId = "m_0000000000b1";
  const both = await Ladder.standings([
    ...agreedMatch(matchId, 0),
    startEvent(ALICE, matchId, 500),
    startEvent(BOB, matchId, 500),
  ]);
  assert.equal(both.matches[0].stake, 500);
  assert.equal(both.rows.find((r) => r.pubkey === PUB(ALICE)).staked, 500);

  const onlyOne = await Ladder.standings([...agreedMatch(matchId, 0), startEvent(ALICE, matchId, 500)]);
  assert.equal(onlyOne.matches[0].stake, null, "one player cannot impose a wager on the other");

  const disagreed = await Ladder.standings([
    ...agreedMatch(matchId, 0),
    startEvent(ALICE, matchId, 500),
    startEvent(BOB, matchId, 50),
  ]);
  assert.equal(disagreed.matches[0].stake, null, "two different numbers are not an agreement");
});

// --------------------------------------------------------------- soundness

test("a draw splits the difference and moves nobody from equal footing", async () => {
  const { rows, counted } = await Ladder.standings(agreedMatch("m_0000000000c1", null));
  assert.equal(counted, 1);
  for (const row of rows) {
    assert.equal(row.draws, 1);
    assert.equal(row.rating, Ladder.START_RATING, "an even draw between equals is worth nothing");
  }
});

test("the table does not depend on the order events arrive in", async () => {
  /* Elo is path-dependent, so results are replayed oldest-first by endedAt. Two
   * clients folding the same events in different arrival orders must agree, or
   * each one looks like the other's bug. */
  const first = [
    ...agreedMatch("m_0000000000d1", 0),
    ...agreedMatch("m_0000000000d2", 1),
    ...agreedMatch("m_0000000000d3", 0),
  ];
  const forward = await Ladder.standings(first);
  const backward = await Ladder.standings(first.slice().reverse());
  assert.deepEqual(
    backward.rows.map((r) => [r.pubkey, r.rating]),
    forward.rows.map((r) => [r.pubkey, r.rating])
  );
  assert.equal(forward.counted, 3);
});

test("rubbish off a relay is ignored rather than believed", async () => {
  const junk = [
    null,
    {},
    { kind: 31600, pubkey: "nope", content: "{}" },
    { kind: 31600, pubkey: PUB(ALICE), content: "not json", tags: [] },
    sign(ALICE, { kind: 1, created_at: 1, tags: [], content: "gm" }),
    // Shaped like a result, but a match against yourself is not one.
    resultEvent(ALICE, "m_0000000000e1", JSON.stringify({
      v: 1, kind: "result", matchId: "m_0000000000e1",
      players: [{ seat: 0, pubkey: PUB(ALICE) }, { seat: 1, pubkey: PUB(ALICE) }],
      winners: [0],
    })),
  ];
  const { rows, counted } = await Ladder.standings(junk);
  assert.equal(counted, 0);
  assert.deepEqual(rows, []);
});

test("refusing to verify is refusing to publish a ladder", async () => {
  /* Degrading to "trust the relay" would turn a cryptographic record into a
   * rumour that looks identical to the real thing. */
  const held = globalThis.E1Schnorr;
  globalThis.E1Schnorr = null;
  try {
    await assert.rejects(() => Ladder.standings(agreedMatch("m_0000000000f1", 0)), /schnorr/i);
  } finally {
    globalThis.E1Schnorr = held;
  }
});
