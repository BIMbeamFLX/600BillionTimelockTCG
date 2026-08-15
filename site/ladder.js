/* ---------------------------------------------------------------------------
 * 600B Timelock TCG — the ladder, derived from nostr and nothing else.
 *
 * There is no ladder server, no accounts table and no row anyone can edit. A
 * standing is a FUNCTION of published events: every match is announced when it
 * is dealt and again when it ends, both seats sign the closing bytes, and this
 * file replays those signatures into a table. Delete this file and the record
 * survives; delete the record and no one can forge it back.
 *
 * WHAT COUNTS AS A MATCH — all four, or it is not counted:
 *   1. Two DISTINCT pubkeys published a kind 31600 result for the same matchId.
 *   2. Their `content` is byte-identical. The referee hands both seats the same
 *      bytes precisely so this is a string compare rather than two browsers
 *      hoping to re-serialise a parsed object the same way.
 *   3. Both signers are the two players NAMED INSIDE that content. Without this
 *      a bystander could co-sign a stranger's match and manufacture agreement.
 *   4. Every signature verifies, and every event id is the hash of its own
 *      bytes. A valid signature pasted onto altered content is the whole attack
 *      this check exists to stop.
 *
 * A match that fails any of these is not "suspicious", it is simply absent —
 * and it is reported in `rejected` with a reason, because a ladder that
 * silently drops results is indistinguishable from one that is broken.
 *
 * This file holds NO DOM and NO transport. leaderboard.html renders it;
 * site/net.js fetches for it; site/schnorr.js does the arithmetic.
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  const KIND_RESULT = 31600;
  const KIND_HANDSHAKE = 4600; // the start announcement, t=start
  const KIND_ZAP_RECEIPT = 9735;
  const TOPIC = "600b-timelock-tcg";

  /* Elo, K=24, everyone starts at 1500. Chosen because it is explainable in one
   * sentence to a player who just lost points, which no cleverer system is. It
   * is order-dependent, so results are always replayed oldest-first — two
   * browsers computing the same table from the same events must agree. */
  const START_RATING = 1500;
  const K = 24;

  const isHex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

  /* Guarded against a null EVENT, not merely null tags: a relay can hand back
   * anything at all, and the first thing this file does with a stranger's JSON
   * must not be to dereference it. */
  const tagValue = (event, name) => {
    const tags = event && Array.isArray(event.tags) ? event.tags : [];
    for (const tag of tags) if (Array.isArray(tag) && tag[0] === name) return tag[1];
    return null;
  };

  /* An event off a relay is UNTRUSTED INPUT, and this is the boundary where that
   * stops being true. Shape first, cryptography second: there is no point
   * verifying a signature over something that is not a result. */
  function parseResult(event) {
    if (!event || event.kind !== KIND_RESULT || !isHex64(event.pubkey)) return null;
    if (typeof event.content !== "string") return null;
    let body;
    try {
      body = JSON.parse(event.content);
    } catch (err) {
      return null;
    }
    if (!body || body.v !== 1 || body.kind !== "result") return null;
    if (typeof body.matchId !== "string" || !/^m_[0-9a-f]{12}$/.test(body.matchId)) return null;
    if (!Array.isArray(body.players) || body.players.length !== 2) return null;
    const seats = [0, 1].map((seat) => body.players.find((p) => p && p.seat === seat) || null);
    if (!seats[0] || !seats[1]) return null;
    if (!isHex64(seats[0].pubkey) || !isHex64(seats[1].pubkey)) return null;
    if (seats[0].pubkey === seats[1].pubkey) return null; // a match against yourself is not one
    const winners = Array.isArray(body.winners) ? body.winners.filter((s) => s === 0 || s === 1) : [];
    if (winners.length > 1) return null; // two winners is not a result this game can produce
    return {
      matchId: body.matchId,
      seats,
      winners,
      reason: typeof body.reason === "string" ? body.reason : null,
      turns: Number.isInteger(body.turns) ? body.turns : 0,
      endedAt: typeof body.endedAt === "string" ? body.endedAt : null,
      /* The d tag is what makes kind 31600 addressable; it must agree with the
       * body or the event is addressed to one match and describes another. */
      addressed: tagValue(event, "d") === body.matchId,
    };
  }

  /* The opening bracket. Read only for the STAKE — the amount both players
   * signed up to before either knew how it would go, which is the only moment
   * that consent is meaningful. */
  function parseStart(event) {
    if (!event || event.kind !== KIND_HANDSHAKE || !isHex64(event.pubkey)) return null;
    let body;
    try {
      body = JSON.parse(event.content);
    } catch (err) {
      return null;
    }
    if (!body || body.v !== 1 || body.kind !== "start") return null;
    if (typeof body.matchId !== "string") return null;
    return {
      matchId: body.matchId,
      by: event.pubkey,
      stake: Number.isInteger(body.stake) && body.stake > 0 ? body.stake : null,
    };
  }

  const verifier = () => globalThis.E1Schnorr || null;

  /* Verification is the expensive part, so it runs once per unique event id and
   * the answer is remembered for the life of the page. A ladder re-rendered on
   * a filter change must not re-verify three hundred signatures. */
  const verdicts = new Map();

  async function verified(event) {
    const S = verifier();
    /* NO VERIFIER, NO LADDER. Degrading to "trust the relay" would silently
     * turn a cryptographic record into a rumour, which is worse than showing
     * nothing, because it looks identical. */
    if (!S) throw new Error("site/schnorr.js is required to verify results");
    const key = String(event && event.id);
    if (verdicts.has(key)) return verdicts.get(key);
    const promise = S.verifyEvent(event).catch(() => false);
    verdicts.set(key, promise);
    return promise;
  }

  /* Kind 31600 is ADDRESSABLE: one row per (pubkey, d), newest wins. Relays are
   * supposed to enforce that and several do not, so a client that does not
   * replace by (pubkey, matchId) will count one player's corrected result twice
   * and call the match disputed. */
  function newestPerAuthor(events) {
    const best = new Map();
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const d = tagValue(event, "d");
      if (!d) continue;
      const key = `${event.pubkey}:${d}`;
      const held = best.get(key);
      if (!held || (event.created_at || 0) > (held.created_at || 0)) best.set(key, event);
    }
    return Array.from(best.values());
  }

  const applyElo = (a, b, scoreA) => {
    const expectedA = 1 / (1 + Math.pow(10, (b - a) / 400));
    return Math.round(K * (scoreA - expectedA));
  };

  /**
   * Fold signed events into a standings table.
   * @param {object[]} events raw nostr events, any mix of kinds
   * @param {{verify?:boolean}} options
   */
  async function standings(events, options) {
    const settings = options || {};
    const list = Array.isArray(events) ? events : [];
    const shouldVerify = settings.verify !== false;

    const stakes = new Map(); // matchId -> agreed sats, only when BOTH seats signed it
    const starts = new Map(); // matchId -> Map(pubkey -> stake)
    for (const event of list) {
      const start = parseStart(event);
      if (!start) continue;
      if (shouldVerify && !(await verified(event))) continue;
      if (!starts.has(start.matchId)) starts.set(start.matchId, new Map());
      starts.get(start.matchId).set(start.by, start.stake);
    }
    for (const [matchId, signers] of starts) {
      const values = Array.from(signers.values());
      /* A stake is only binding when BOTH sides signed the SAME number. One
       * player announcing a wager the other never agreed to is not a wager. */
      if (values.length === 2 && values[0] === values[1] && values[0] !== null) {
        stakes.set(matchId, values[0]);
      }
    }

    // matchId -> content -> [events]
    const byMatch = new Map();
    const rejected = [];
    for (const event of newestPerAuthor(list)) {
      const parsed = parseResult(event);
      if (!parsed) continue;
      if (!parsed.addressed) {
        rejected.push({ matchId: parsed.matchId, why: "the d tag names a different match" });
        continue;
      }
      // Only the two seats named inside the result may sign it.
      if (!parsed.seats.some((s) => s.pubkey === event.pubkey)) {
        rejected.push({ matchId: parsed.matchId, why: "signed by someone who did not play" });
        continue;
      }
      if (shouldVerify && !(await verified(event))) {
        rejected.push({ matchId: parsed.matchId, why: "signature does not verify" });
        continue;
      }
      if (!byMatch.has(parsed.matchId)) byMatch.set(parsed.matchId, new Map());
      const contents = byMatch.get(parsed.matchId);
      if (!contents.has(event.content)) contents.set(event.content, { parsed, signers: new Set() });
      contents.get(event.content).signers.add(event.pubkey);
    }

    const confirmed = [];
    for (const [matchId, contents] of byMatch) {
      const agreed = Array.from(contents.values()).filter((c) => c.signers.size === 2);
      if (!agreed.length) {
        const signed = Array.from(contents.values()).reduce((n, c) => n + c.signers.size, 0);
        rejected.push({
          matchId,
          why: contents.size > 1 ? "the two seats signed different results" : `only ${signed} of 2 seats signed`,
        });
        continue;
      }
      if (agreed.length > 1) {
        rejected.push({ matchId, why: "more than one agreed result for one match" });
        continue;
      }
      const { parsed } = agreed[0];
      confirmed.push(Object.assign({}, parsed, { stake: stakes.get(matchId) || null }));
    }

    /* Oldest first. Elo is path-dependent, so the order is part of the answer:
     * two clients folding the same events in different orders would publish
     * different ladders and each would look like the other's bug. */
    confirmed.sort((a, b) => {
      const at = Date.parse(a.endedAt || "") || 0;
      const bt = Date.parse(b.endedAt || "") || 0;
      return at - bt || a.matchId.localeCompare(b.matchId);
    });

    const players = new Map();
    const seatOf = (pubkey, name) => {
      if (!players.has(pubkey)) {
        players.set(pubkey, {
          pubkey, name: name || null, rating: START_RATING,
          matches: 0, wins: 0, losses: 0, draws: 0, staked: 0, turns: 0,
        });
      }
      const row = players.get(pubkey);
      if (name) row.name = name; // the most recent name a player signed under
      return row;
    };

    for (const match of confirmed) {
      const rows = match.seats.map((s) => seatOf(s.pubkey, s.name));
      const before = rows.map((r) => r.rating);
      const score = match.winners.length === 0 ? [0.5, 0.5] : [
        match.winners[0] === 0 ? 1 : 0,
        match.winners[0] === 1 ? 1 : 0,
      ];
      for (let seat = 0; seat < 2; seat++) {
        const row = rows[seat];
        row.matches += 1;
        row.turns += match.turns;
        if (score[seat] === 1) row.wins += 1;
        else if (score[seat] === 0.5) row.draws += 1;
        else row.losses += 1;
        row.rating += applyElo(before[seat], before[1 - seat], score[seat]);
        // Sats put at risk, whether or not the loser ever settled.
        if (match.stake) row.staked += match.stake;
      }
    }

    const rows = Array.from(players.values()).sort(
      (a, b) => b.rating - a.rating || b.wins - a.wins || a.pubkey.localeCompare(b.pubkey)
    );
    return { rows, matches: confirmed, rejected, counted: confirmed.length };
  }

  /* The relay-side half. Kept separate from standings() so the fold is a pure
   * function that tests can drive with a fixed event list. */
  async function fetchEvents(options) {
    const net = globalThis.E1Net;
    if (!net || !net.nostr || typeof net.nostr.query !== "function") {
      throw new Error("site/net.js is required to read the ladder off the relays");
    }
    const settings = options || {};
    const limit = Number.isInteger(settings.limit) ? settings.limit : 500;
    const filters = [
      { kinds: [KIND_RESULT], "#t": [TOPIC], limit },
      { kinds: [KIND_HANDSHAKE], "#t": ["start"], limit },
    ];
    const batches = await Promise.all(filters.map((f) => net.nostr.query(f, settings.ms || 4000)));
    return batches.flat();
  }

  async function load(options) {
    return standings(await fetchEvents(options), options);
  }

  const API = {
    KIND_RESULT, KIND_HANDSHAKE, KIND_ZAP_RECEIPT, TOPIC, START_RATING, K,
    parseResult, parseStart, standings, fetchEvents, load,
  };

  globalThis.E1Ladder = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
