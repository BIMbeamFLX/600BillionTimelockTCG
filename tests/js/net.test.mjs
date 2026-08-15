/* Table Transport v1 — the S2/S3/S4 proof, headless.
 *
 * Boots server/table.js IN PROCESS on an ephemeral port, connects two real
 * WebSocket clients and plays a real match through the referee. No browser, no
 * DOM, no fixtures: the clients see exactly the bytes a browser sees, and they
 * hold only VIEWS — never a state — which is the contract site/net.js must honour.
 *
 * Run: node --test tests/js/net.test.mjs
 * (the DIRECTORY form of --test fails on Windows; use the file/glob form)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { get as httpGet, request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { createTable, pruneAddressRates } = require("../../server/table.js");
const E = require("../../site/engine.js");
const CARDS = require("../../site/play-data.js");
const WebSocket = require("ws");
const { schnorr } = require("@noble/curves/secp256k1");
E.setCatalog(CARDS);

const CATALOG = E.buildCatalog(CARDS);
const card = (id) => CATALOG.byId[id] || null;
const COMPILED_CACHE = {};
const compiledOf = (id) => COMPILED_CACHE[id] || (COMPILED_CACHE[id] = E.compileCard(card(id)));
const WIRE = 1;

const identityKey = (label) => Uint8Array.from(createHash("sha256").update(`test:${label}`).digest());
const AUTH_SK = identityKey("auth-proof");
const AUTH_PUBKEY = Buffer.from(schnorr.getPublicKey(AUTH_SK)).toString("hex");
const eventId = (event) => createHash("sha256").update(JSON.stringify([
  0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
])).digest("hex");
const signedAuth = (challenge, privateKey = AUTH_SK) => {
  const pubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString("hex");
  const event = {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 22242,
    tags: [["relay", challenge.relay], ["challenge", challenge.challenge]],
    content: "",
  };
  event.id = eventId(event);
  event.sig = Buffer.from(schnorr.sign(event.id, privateKey)).toString("hex");
  return event;
};

// --------------------------------------------------------------- test client

class Client {
  constructor(url, identity = "a") {
    this.url = url;
    this.privateKey = identityKey(identity);
    this.pubkey = Buffer.from(schnorr.getPublicKey(this.privateKey)).toString("hex");
    this.inbox = [];
    this.waiters = [];
    this.view = null;
    this.seat = null;
    this.matchId = null;
    this.token = null;
    this.events = [];
    this.over = null;
  }

  static async open(url, options) {
    const settings = options || {};
    const c = new Client(url, settings.identity || "a");
    const wsOptions = { ...settings };
    delete wsOptions.identity;
    delete wsOptions.skipAuth;
    c.ws = new WebSocket(url, wsOptions);
    c.ws.on("message", (raw) => c.ingest(JSON.parse(String(raw))));
    await new Promise((resolve, reject) => {
      c.ws.once("open", resolve);
      c.ws.once("error", reject);
    });
    if (!settings.skipAuth) {
      const challenge = await c.type("AUTH");
      c.send({ t: "AUTH", event: signedAuth(challenge, c.privateKey) });
      const accepted = await c.next((msg) => msg.t === "AUTH_OK" || msg.t === "ERROR");
      assert.equal(accepted.t, "AUTH_OK", JSON.stringify(accepted));
      assert.equal(accepted.pubkey, c.pubkey);
    }
    return c;
  }

  ingest(msg) {
    if (msg.t === "STATE") {
      this.matchId = msg.matchId;
      this.code = msg.code;
      this.seat = msg.seat;
      if (msg.token) this.token = msg.token;
      this.view = msg.view;
      this.events = msg.events.slice();
      this.status = msg.status;
      this.role = msg.role;
    } else if (msg.t === "FRAME") {
      this.view = msg.view;
      for (const ev of msg.events) this.events.push(ev);
    } else if (msg.t === "REJECT") {
      this.view = msg.view;
    } else if (msg.t === "OVER") {
      this.over = msg;
    } else if (msg.t === "AUTH_OK") {
      // Kept, because Client.open consumes it: the greeting carries this
      // identity's unfinished matches and tests need to read them back.
      this.hello = msg;
    }
    this.inbox.push(msg);
    for (const w of this.waiters.splice(0)) w();
  }

  send(msg) {
    this.ws.send(JSON.stringify(Object.assign({ v: WIRE }, msg)));
  }

  /** Wait for the next message satisfying `match`, consuming it from the inbox. */
  async next(match, ms = 10000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex(match);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error("timed out waiting for a message");
      await new Promise((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 5);
      });
    }
  }

  type(t) {
    return this.next((m) => m.t === t);
  }

  /* Send one action and wait for ITS reply, correlated by seq. Waiting for "the
   * next FRAME" is wrong: a frame caused by the opponent can arrive first, and
   * consuming it as the answer desyncs the client by one action. */
  async act(action) {
    this.send({ t: "ACT", action });
    return this.next(
      (m) =>
        (m.t === "FRAME" && m.seq === action.seq + 1) ||
        (m.t === "REJECT" && m.seq === action.seq) ||
        m.t === "ERROR"
    );
  }

  close() {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once("close", resolve);
      setTimeout(resolve, 1000); // never let cleanup outlive the test
      try {
        this.ws.close();
      } catch (err) {
        resolve();
      }
    });
  }
}

/* Both seats must have caught up before either chooses again — otherwise the
 * driver reasons about a view the referee has already moved past. A browser does
 * not need this; a synchronous scripted client does. */
async function settle(clients, seq, ms = 5000) {
  const deadline = Date.now() + ms;
  for (const c of clients) {
    while ((c.view ? c.view.seq : -1) < seq && Date.now() < deadline && !c.over) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
}

// ------------------------------------------------------------ the match driver

const costOf = (id) => {
  const c = card(id);
  if (!c || !c.costParsed) return 0;
  return Object.values(c.costParsed).reduce((a, b) => a + (Number(b) || 0), 0);
};

/* Chooses one action from a REDACTED VIEW — it has no access to the full state,
 * which is the point: if fog of war were fake, this driver could cheat.
 * Aggressive on purpose (attack with everything, block with nothing) so uptime
 * actually runs out and the match reaches a real result rather than decking. */
function chooseAction(view, seat, banned) {
  if (!view || view.result) return null;
  const seq = view.seq;
  const act = (type, payload) => ({ type, seat, seq, at: "", payload: payload || {} });
  const vetoed = (key) => banned.has(`${seq}:${key}`);

  if (view.pendingManual) {
    return view.pendingManual.seat === seat
      ? act("MANUAL_WITHDRAW", { mid: view.pendingManual.mid })
      : act("MANUAL_REJECT", { mid: view.pendingManual.mid, reason: "scripted client" });
  }
  if (view.pendingChoice && view.pendingChoice.seat === seat) {
    // CHOOSE takes INDICES into the options list, never the option values —
    // sending values earned an endless REJECT loop and a referee kick the
    // moment remote matches contained real choices.
    const options = view.pendingChoice.options || [];
    const minimum = Math.max(0, Number(view.pendingChoice.min) || 0);
    const maximum = Math.min(
      options.length,
      Math.max(minimum, Number(view.pendingChoice.max) || 0),
    );
    const count = minimum || (maximum > 0 ? 1 : 0);
    return act("CHOOSE", {
      choiceId: view.pendingChoice.id,
      selection: Array.from({ length: count }, (_, index) => index),
    });
  }

  const awaiting = view.awaiting;
  if (awaiting) {
    if (awaiting.seat !== seat) return null; // the other seat owes the game an answer
    switch (awaiting.kind) {
      case "attackers": {
        const mine = view.zones[`${seat}:network`] || [];
        const env = { state: view, ctx: E.resolveCtx({}) };
        const attackers = mine.filter((uid) => {
          try {
            return E.canAttack(env, uid);
          } catch {
            return false;
          }
        });
        return act("DECLARE_ATTACKERS", { attackers });
      }
      case "blockers":
        return act("DECLARE_BLOCKERS", { blocks: {} });
      case "order":
        return act("ORDER_BLOCKERS", {
          order: Object.fromEntries(
            Object.entries(view.clash.blocks || {}).map(([attacker, blockers]) => [
              attacker,
              blockers.slice(),
            ]),
          ),
        });
      case "damage":
        return act("ASSIGN_COMBAT_DAMAGE", { assignment: null });
      case "discard": {
        const wallet = view.zones[`${seat}:wallet`] || [];
        return act("DISCARD_TO_LIMIT", { uids: wallet.slice(0, awaiting.count) });
      }
      case "triggers": {
        /* view.pendingTriggers is COUNTS, so a seat can only form the action it is
         * REQUIRED to submit if the view carries its own pendingIds. That is the
         * engine.js `myTriggers` fix; without it a seat is stuck. */
        if (Array.isArray(view.myTriggers)) {
          return act("ORDER_TRIGGERS", { qids: view.myTriggers.map((t) => t.pendingId) });
        }
        return { blocked: "ORDER_TRIGGERS needs view.myTriggers — see the engine.js redaction fix" };
      }
      default:
        return act("CONCEDE");
    }
  }

  if (view.priority.seat !== seat) return null;

  const wallet = view.zones[`${seat}:wallet`] || [];
  const isResource = (uid) => {
    const o = view.objects[uid];
    const c = o && o.cardId ? card(o.cardId) : null;
    return Boolean(c && c.isResource);
  };
  const main = (view.turn.phase === "build1" || view.turn.phase === "build2") && view.turn.step === "main";
  const sorcerySpeed = main && view.turn.active === seat && view.queue.length === 0;
  if (!sorcerySpeed) return act("PASS_PRIORITY");

  if (view.turn.resourcePlays.used < view.turn.resourcePlays.allowed) {
    const uid = wallet.find((u) => isResource(u) && !vetoed("R" + u));
    if (uid) return act("PLAY_RESOURCE", { uid });
  }

  // Nothing is affordable until committed Resources have generated into the
  // buffer, so tap before trying to cast.
  const buffer = view.seats[seat].buffer || {};
  const banked = Object.values(buffer).reduce((a, b) => a + (Number(b) || 0), 0);
  if (banked < 8) {
    const network = view.zones[`${seat}:network`] || [];
    const source = network.find((uid) => {
      const o = view.objects[uid];
      if (!o || !o.cardId || o.committed || vetoed("A" + uid)) return false;
      const c = card(o.cardId);
      return Boolean(c && c.isResource && c.abilities.length);
    });
    if (source) {
      const c = card(view.objects[source].cardId);
      const index = c.abilities.findIndex((ab) => ab.resourceAbility);
      const affinity = (c.affinity || []).find((x) => x !== "Neutral") || "Power";
      if (index >= 0) {
        return act("ACTIVATE_RESOURCE_ABILITY", { uid: source, abilityIndex: index, choice: affinity });
      }
    }
  }

  const castable = wallet
    .filter((uid) => !isResource(uid) && view.objects[uid] && view.objects[uid].cardId && !vetoed(uid))
    // Probe-free: targeted and X cards need choices this scripted client does
    // not make. Probing them every seq inflated the reject rate until the
    // referee (correctly) kicked the client for it.
    .filter((uid) => {
      const compiledCard = compiledOf(view.objects[uid].cardId);
      return (
        compiledCard.playTargetSpec.length === 0 &&
        !(compiledCard.costParsed && compiledCard.costParsed.x)
      );
    })
    .sort((a, b) => costOf(view.objects[a].cardId) - costOf(view.objects[b].cardId));
  if (castable.length) return act("PLAY_CARD", { uid: castable[0] });
  return act("PASS_PRIORITY");
}

/* Drive both clients until the match ends. Rejections are expected and
 * informative: a scripted client cannot know what it can afford, so it probes
 * and the referee says no — which is exactly the behaviour under test. */
async function playOut(a, b, budget = 8000) {
  const clients = [a, b];
  const banned = new Set();
  const rejects = {};
  let blocked = null;
  let actions = 0;

  for (let i = 0; i < budget; i++) {
    if (a.over || b.over) break;
    let acted = false;
    for (const c of clients) {
      if (a.over || b.over) break;
      if (!c.view || c.view.result) continue;
      const action = chooseAction(c.view, c.seat, banned);
      if (!action) continue;
      if (action.blocked) {
        blocked = action.blocked;
        await c.act({ type: "CONCEDE", seat: c.seat, seq: c.view.seq, at: "", payload: {} });
        acted = true;
        continue;
      }
      const reply = await c.act(action);
      actions++;
      acted = true;
      if (reply.t === "ERROR") throw new Error(`transport ERROR mid-match: ${reply.code}`);
      if (reply.t === "REJECT") {
        rejects[reply.code] = (rejects[reply.code] || 0) + 1;
        // Never retry the same refused action at the same seq — probe once, then move on.
        const key =
          action.type === "DECLARE_ATTACKERS" ? "ATTACK"
          : action.type === "PLAY_RESOURCE" ? "R" + action.payload.uid
          : action.type === "ACTIVATE_RESOURCE_ABILITY" ? "A" + action.payload.uid
          : action.payload.uid;
        banned.add(`${action.seq}:${key}`);
        continue;
      }
      await settle(clients, reply.seq);
      /* OVER is sent immediately after the winning FRAME but lands one tick
       * later. Waiting for it explicitly is the difference between a proven
       * end-of-match and a race. */
      if (reply.view && reply.view.result) {
        // OVER goes to BOTH seats; wait for both so either may be inspected.
        for (const x of clients) if (!x.over) await x.type("OVER");
      }
    }
    if (!acted) break;
  }
  return { rejects, blocked, actions };
}

// --------------------------------------------------------------------- setup

const tmpDb = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "600b-net-")), name);

test("expired address-rate buckets are removed", () => {
  const rates = new Map([
    ["expired", [1, 2]],
    ["active", [10_001, 19_999]],
  ]);

  pruneAddressRates(rates, 20_000, 10_000);

  assert.equal(rates.has("expired"), false);
  assert.deepEqual(rates.get("active"), [10_001, 19_999]);
});

function httpJsonWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = httpGet({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers: { Host: host },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
  });
}

/* One cleanup path, registered before anything can fail: clients first, then the
 * table. Closing the table first terminates the sockets and a later client
 * close() would wait for an event that already fired. */
async function boot(t, name, extra) {
  const table = await createTable(
    Object.assign({ port: 0, dbPath: tmpDb(name), host: "127.0.0.1", rateMax: 1000000 }, extra || {})
  );
  const clients = [];
  let clientIndex = 0;
  table.client = async (options) => {
    const settings = { identity: String.fromCharCode(97 + clientIndex), ...(options || {}) };
    clientIndex += 1;
    const c = await Client.open(table.wsUrl, settings);
    clients.push(c);
    return c;
  };
  t.after(async () => {
    for (const c of clients) await c.close();
    await table.close();
  });
  return table;
}

async function twoSeats(table) {
  const a = await table.client();
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  const b = await table.client();
  b.send({ t: "JOIN", code: created.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  await b.type("STATE");
  await a.type("STATE"); // seat 0 is told the table filled
  return { a, b, created };
}

// ---------------------------------------------------------------------- tests

test("CREATE + JOIN give the two seats different views of one state", async (t) => {
  const table = await boot(t, "t1.db");
  const { a, b } = await twoSeats(table);

  assert.equal(a.seat, 0);
  assert.equal(b.seat, 1);
  assert.equal(a.matchId, b.matchId);
  assert.equal(a.view.forSeat, 0);
  assert.equal(b.view.forSeat, 1);
  assert.equal(a.view.gameId, b.view.gameId);
  assert.equal(a.view.seq, b.view.seq);
  assert.equal(a.view.policy.freeform, "deny", "public tables must not expose manual edits");
  assert.notEqual(JSON.stringify(a.view), JSON.stringify(b.view));
  assert.ok(a.token && b.token && a.token !== b.token);
  // Both seats agree on the shared reality even though their views differ.
  assert.equal(a.view.catalogDigest, b.view.catalogDigest);
});

test("fog of war is enforced by the referee, not the UI", async (t) => {
  const table = await boot(t, "t2.db");
  const { a, b } = await twoSeats(table);

  const mine = a.view.zones["0:wallet"];
  assert.ok(mine.length > 0);
  for (const uid of mine) assert.ok(a.view.objects[uid].cardId, "own hand must show cardIds");

  // The opponent's Wallet is an ordered array of uid SHELLS: the list is required
  // so a random discard can name its eligible set, the identities are not.
  const theirs = a.view.zones["1:wallet"];
  assert.ok(theirs.length > 0);
  for (const uid of theirs) {
    assert.deepEqual(Object.keys(a.view.objects[uid]).sort(), ["owner", "uid", "zone"]);
    assert.equal(a.view.objects[uid].cardId, undefined);
  }
  for (const uid of b.view.zones["0:wallet"]) {
    assert.equal(b.view.objects[uid].cardId, undefined);
  }

  /* NO SEED OF ANY KIND LEAVES THE SERVER — public included. Only the draw
   * counters do, which prove the referee performed exactly the number of draws
   * the log accounts for. The public seed used to ship whole "for audit"; under
   * a referee that is a live oracle, because a seat holding it can test
   * candidate hidden seeds against gameId and deckCommit, and under PIN_SEED it
   * derived them outright. Audit belongs to the post-match OVER bundle. */
  for (const view of [a.view, b.view]) {
    for (const stream of [view.rng.public].concat(view.rng.hidden)) {
      assert.equal(stream.s, undefined, "an rng seed reached a client");
      assert.equal(typeof stream.n, "number", "the draw counter must survive");
    }
  }
  assert.ok(!/"s"\s*:/.test(JSON.stringify(a.view.rng)), "no seed field anywhere in rng");

  // The Stack is a count, not a list, even for its owner.
  assert.equal(Array.isArray(a.view.zones["0:stack"]), false);
  assert.equal(typeof a.view.zones["0:stack"].n, "number");
  // A view is tagged and can never be fed back into apply().
  assert.equal(a.view.redacted, true);
  assert.throws(() => E.view(a.view, 1), /REDACTED_STATE|cannot re-redact/);
  // And it IS a legal input to the read-only helpers the UI runs.
  assert.ok(E.legalActions(a.view, 0).length > 0);
});

test("an illegal action is rejected with the ENGINE's code and a fresh view", async (t) => {
  const table = await boot(t, "t3.db");
  const { a, b } = await twoSeats(table);

  // 1. claiming the other seat — the engine checks this, not the server
  const notYours = await b.act({ type: "PASS_PRIORITY", seat: 0, seq: b.view.seq, at: "", payload: {} });
  assert.equal(notYours.t, "REJECT");
  assert.equal(notYours.code, "NOT_YOUR_SEAT");
  assert.ok(notYours.view, "a rejection must carry a fresh view");
  assert.equal(notYours.view.forSeat, 1, "and it must be the SENDER's view");

  // 2. a stale seq
  const stale = await a.act({ type: "PASS_PRIORITY", seat: 0, seq: a.view.seq + 99, at: "", payload: {} });
  assert.equal(stale.code, "SEQ_MISMATCH");
  assert.equal(stale.view.seq, a.view.seq, "the correction is current");

  // 3. a nonexistent object
  const unknown = await a.act({ type: "PLAY_CARD", seat: 0, seq: a.view.seq, at: "", payload: { uid: "o99999" } });
  assert.ok(["UNKNOWN_OBJECT", "NOT_IN_ZONE", "SCHEMA"].includes(unknown.code), unknown.code);

  // 4. transport failures are ERROR, rules failures are REJECT — never mixed.
  a.ws.send(JSON.stringify({ t: "ACT", v: 99, action: {} }));
  assert.equal((await a.type("ERROR")).code, "BAD_VERSION");
  a.send({ t: "WAT" });
  assert.equal((await a.type("ERROR")).code, "BAD_MESSAGE");

  // Every rejection is recorded: rejection rate is the cheapest cheat signal.
  const rows = table.db.prepare("SELECT code FROM rejects WHERE match_id = ?").all(a.matchId);
  assert.ok(rows.length >= 3, `expected rejects to be logged, got ${rows.length}`);
  assert.ok(rows.some((r) => r.code === "NOT_YOUR_SEAT"));
  // ...and none of them entered the chain.
  const chain = table.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE match_id = ?").get(a.matchId);
  assert.equal(chain.n, 0);
});

test("a duplicate ACT is SEQ_MISMATCH, never a double-play", async (t) => {
  const table = await boot(t, "t4.db");
  const { a } = await twoSeats(table);

  const action = { type: "PASS_PRIORITY", seat: 0, seq: a.view.seq, at: "", payload: {} };
  a.send({ t: "ACT", action });
  a.send({ t: "ACT", action }); // the double-click
  const first = await a.next((m) => m.t === "FRAME" && m.seq === action.seq + 1);
  const second = await a.next((m) => m.t === "REJECT" && m.seq === action.seq);
  assert.equal(first.t, "FRAME");
  assert.equal(second.code, "SEQ_MISMATCH");

  const dupes = table.db
    .prepare("SELECT seq, COUNT(*) AS n FROM entries WHERE match_id = ? GROUP BY seq HAVING n > 1")
    .all(a.matchId);
  assert.deepEqual(dupes, [], "the chain must never contain a seq twice");
  const atSeq = table.db
    .prepare("SELECT COUNT(*) AS n FROM entries WHERE match_id = ? AND seq = ?")
    .get(a.matchId, action.seq);
  assert.equal(atSeq.n, 1);
});

test("a full remote match: transcript persists, replays, and verifies", async (t) => {
  const table = await boot(t, "t5.db");
  const { a, b } = await twoSeats(table);

  const { rejects, blocked, actions } = await playOut(a, b);
  if (blocked) t.diagnostic(`driver fell back to CONCEDE: ${blocked}`);
  t.diagnostic(`actions sent: ${actions} · rejections: ${JSON.stringify(rejects)}`);

  const over = a.over || b.over;
  assert.ok(over, "the match must reach a result");
  assert.ok(Array.isArray(over.result.winners), "winners is an ARRAY — a draw has none");
  t.diagnostic(`result: ${JSON.stringify(over.result)} over ${over.transcript.length} entries`);

  // The referee verified the match against WHAT IT PERSISTED, not against memory.
  assert.equal(over.verify.ok, true, JSON.stringify(over.verify));
  assert.equal(over.verify.divergedAt, null);

  // A fresh replay of the transcript reproduces the published head hash.
  const replayed = E.replay(over.config, over.transcript.map((e) => e.action));
  assert.equal(replayed.error, null);
  assert.equal(E.hashState(replayed.state), over.transcript.at(-1).stateHash);
  assert.equal(E.publicHash(replayed.state), over.publicHash);
  assert.deepEqual(replayed.state.result, over.result);
  assert.equal(E.entryHash(over.transcript.at(-1)), over.headHash);

  // And a client can verify the whole match itself, from the bundle it was sent.
  const clientSide = E.verifyMatch({ config: over.config, log: over.transcript });
  assert.equal(clientSide.ok, true, JSON.stringify(clientSide.error));
  assert.deepEqual(clientSide.result, over.result);
  assert.equal(clientSide.headHash, E.hashState(replayed.state));

  // The transcript on disk is the transcript that was broadcast.
  const rows = table.db.prepare("SELECT * FROM entries WHERE match_id = ? ORDER BY seq").all(over.matchId);
  assert.equal(rows.length, over.transcript.length);
  assert.equal(rows.at(-1).hash, over.headHash);
  for (const row of rows) assert.equal(row.at, "", "`at` is hashed and must stay deterministic");
  // The chain is contiguous and each link names the one before it.
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].seq, rows[i - 1].seq + 1);
    assert.equal(rows[i].prev, rows[i - 1].hash);
  }

  // transcriptHash — the cross-topology agreement field — is reproducible.
  const recomputed = E.sha256hex(
    E.canonicalJSON(over.transcript.map((e) => ({ seq: e.seq, seat: e.seat, at: e.at, action: e.action })))
  );
  assert.equal(recomputed, over.transcriptHash);

  // Both players are handed the SAME bytes to sign, so agreement is a string compare.
  assert.equal(a.over.resultContent, b.over.resultContent);
  assert.deepEqual(a.over.resultTags, b.over.resultTags);
  const payload = JSON.parse(over.resultContent);
  assert.equal(payload.v, 1);
  assert.equal(payload.kind, "result");
  assert.deepEqual(payload.winners, over.result.winners);
  assert.equal(payload.transcriptHash, over.transcriptHash);
  assert.equal(payload.publicHash, over.publicHash);
  assert.equal(payload.actions, over.transcript.length);

  // Tamper detection still bites on the persisted chain.
  const tampered = over.transcript.map((e) => ({ ...e }));
  const mid = Math.floor(tampered.length / 2);
  tampered[mid].action = { type: "CONCEDE", seat: 0, seq: tampered[mid].seq, at: "", payload: {} };
  assert.equal(E.verifyMatch({ config: over.config, log: tampered }).ok, false);

  // The row is closed out and the verdict is on disk.
  const row = table.db.prepare("SELECT * FROM matches WHERE match_id = ?").get(over.matchId);
  assert.equal(row.status, "over");
  assert.equal(JSON.parse(row.verify_json).ok, true);
  assert.equal(row.transcript_hash, over.transcriptHash);
  assert.ok(row.ended_at);
});

test("RESUME by token restores the exact seat and view", async (t) => {
  const table = await boot(t, "t6.db");
  const { a, b } = await twoSeats(table);

  // Advance a little so the resume happens mid-match, not at seq 0.
  const banned = new Set();
  for (let i = 0; i < 10; i++) {
    const c = [a, b].find((x) => {
      const action = chooseAction(x.view, x.seat, banned);
      return action && !action.blocked;
    });
    if (!c) break;
    const reply = await c.act(chooseAction(c.view, c.seat, banned));
    if (reply.t === "FRAME") await settle([a, b], reply.seq);
  }
  assert.ok(a.view.seq > 0, "the match must have moved before we resume");

  const liveView = JSON.stringify(a.view);
  const { matchId, token } = a;
  await a.close();
  assert.equal((await b.next((m) => m.t === "PEER" && m.online === false)).seat, 0);

  const again = await table.client({ identity: "a" });
  again.send({ t: "RESUME", matchId, token, pubkey: again.pubkey });
  const state = await again.type("STATE");
  assert.equal(state.seat, 0);
  assert.equal(state.role, "seat");
  assert.equal(state.downgraded, false);
  assert.equal(state.full, true);
  assert.equal(JSON.stringify(state.view), liveView, "the resumed view must be the live view");
  assert.ok(Array.isArray(state.events), "enough log to render must come back too");
  assert.equal((await b.next((m) => m.t === "PEER" && m.online === true)).seat, 0);

  // The resumed connection plays immediately — no re-handshake, no re-deal.
  const action = chooseAction(again.view, 0, new Set());
  if (action && !action.blocked) {
    const reply = await again.act(action);
    assert.ok(["FRAME", "REJECT"].includes(reply.t), JSON.stringify(reply));
  }
});

test("a valid token and matching NIP-07 identity take the seat over; a verified stranger spectates", async (t) => {
  const table = await boot(t, "t7.db");
  const { a } = await twoSeats(table);

  // Takeover, not refusal: the stale tab is told SUPERSEDED and closed, so a
  // player can never be locked out of their own match.
  const twin = await table.client({ identity: "a" });
  twin.send({ t: "RESUME", matchId: a.matchId, token: a.token, pubkey: twin.pubkey });
  assert.equal((await a.type("ERROR")).code, "SUPERSEDED");
  assert.equal((await twin.type("STATE")).seat, 0);

  // A stranger with a NIP-07 identity but no seat credential becomes an audience member.
  const stranger = await table.client();
  stranger.send({ t: "RESUME", matchId: a.matchId, pubkey: stranger.pubkey });
  const spec = await stranger.type("STATE");
  assert.equal(spec.role, "spectator");
  assert.equal(spec.seat, null);
  assert.equal(spec.downgraded, true);
  assert.ok(spec.downgradeReason);
  assert.equal(spec.token, undefined, "a spectator must never receive a seat token");
  // Spectator fog: NEITHER hand is visible, not even as uid shells.
  assert.equal(Array.isArray(spec.view.zones["0:wallet"]), false);
  assert.equal(Array.isArray(spec.view.zones["1:wallet"]), false);
  assert.equal(spec.view.forSeat, null);
  // And a spectator cannot act.
  stranger.send({ t: "ACT", action: { type: "PASS_PRIORITY", seat: 0, seq: spec.view.seq, at: "", payload: {} } });
  assert.equal((await stranger.type("ERROR")).code, "BAD_MESSAGE");

  // A bad token is a downgrade too, never a crash.
  const forger = await table.client();
  forger.send({ t: "RESUME", matchId: a.matchId, token: "0".repeat(32), pubkey: forger.pubkey });
  assert.equal((await forger.type("STATE")).role, "spectator");
  // An unknown match IS a hard error — there is nothing to spectate.
  forger.send({ t: "RESUME", matchId: "m_deadbeefdead", token: a.token, pubkey: forger.pubkey });
  assert.equal((await forger.type("ERROR")).code, "NO_SUCH_MATCH");
});

test("the referee survives being killed: a new process rebuilds from the DB", async (t) => {
  const dbPath = tmpDb("t8.db");
  const first = await createTable({ port: 0, dbPath, host: "127.0.0.1", rateMax: 1000000 });
  const a = await Client.open(first.wsUrl, { identity: "a" });
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  const b = await Client.open(first.wsUrl, { identity: "b" });
  b.send({ t: "JOIN", code: created.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  await b.type("STATE");
  await a.type("STATE");

  const banned = new Set();
  for (let i = 0; i < 10; i++) {
    const c = [a, b].find((x) => {
      const action = chooseAction(x.view, x.seat, banned);
      return action && !action.blocked;
    });
    if (!c) break;
    const reply = await c.act(chooseAction(c.view, c.seat, banned));
    if (reply.t === "FRAME") await settle([a, b], reply.seq);
  }
  const before = JSON.stringify(a.view);
  const { matchId, token } = a;
  const seq = a.view.seq;
  assert.ok(seq > 0);
  await a.close();
  await b.close();
  await first.close(); // a hard stop, as kill -9 would be

  const second = await boot(t, "unused.db", { dbPath });
  const revived = await second.client({ identity: "a" });
  revived.send({ t: "RESUME", matchId, token, pubkey: revived.pubkey });
  const state = await revived.type("STATE");
  assert.equal(state.seat, 0);
  assert.equal(state.status, "playing");
  assert.equal(state.view.seq, seq);
  assert.equal(JSON.stringify(state.view), before, "recovery must be byte-identical");
  // Recovery is a row read, but the transcript is still there to verify against.
  const rows = second.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE match_id = ?").get(matchId);
  assert.equal(rows.n, seq);
});

test("nostr events are stored verbatim and agreement is a query", async (t) => {
  const table = await boot(t, "t9.db");
  const { a, b } = await twoSeats(table);

  const content = JSON.stringify({ v: 1, kind: "result", matchId: a.matchId, winners: [0] });
  /* GENUINELY SIGNED, because the referee now verifies these. Both seats sign
   * the SAME content, so `confirmed` remains a content comparison. */
  const ev = (privateKey, over) => {
    const event = Object.assign(
      {
        pubkey: Buffer.from(schnorr.getPublicKey(privateKey)).toString("hex"),
        kind: 31600,
        created_at: 1785310322,
        tags: [["d", a.matchId]],
        content,
      },
      over || {}
    );
    event.id = eventId(event);
    event.sig = Buffer.from(schnorr.sign(event.id, privateKey)).toString("hex");
    return event;
  };

  // The agreement broadcast goes to BOTH seats, so a message is matched by what
  // it says rather than by "the next NOSTR" — b already holds a's broadcast.
  const nostr = (c, n) => c.next((m) => m.t === "NOSTR" && m.events.length === n);

  /* The handshake is signable at once — that is what it is for. A RESULT is not:
   * there is no result until the match has one. */
  a.send({ t: "NOSTR", role: "invite", event: ev(a.privateKey, { kind: 4600 }) });
  a.send({ t: "NOSTR", role: "result", event: ev(a.privateKey) });
  assert.equal((await a.type("ERROR")).code, "BAD_MESSAGE", "a result before OVER is not a result");

  /* ONE SEAT MUST NOT BE ABLE TO MANUFACTURE MUTUAL AGREEMENT, and a valid
   * signature is not permission to speak for someone else. These two events are
   * cryptographically PERFECT — seat 1 holds the other keys outright here — so
   * seat binding is the only thing that can refuse them, which is exactly the
   * property being asserted. */
  b.send({ t: "NOSTR", role: "result", event: ev(a.privateKey) });
  assert.equal((await b.type("ERROR")).code, "BAD_MESSAGE", "seat 1 spoke under seat 0's key");
  b.send({ t: "NOSTR", role: "result", event: ev(AUTH_SK) });
  assert.equal((await b.type("ERROR")).code, "BAD_MESSAGE", "seat 1 invented a third pubkey");

  // And an event whose signature does not verify is not a record of anything.
  const tampered = ev(a.privateKey);
  tampered.content = JSON.stringify({ v: 1, kind: "result", matchId: a.matchId, winners: [1] });
  a.send({ t: "NOSTR", role: "result", event: tampered });
  assert.equal((await a.type("ERROR")).code, "BAD_MESSAGE", "content was swapped under a good signature");

  // Now finish the match for real, so a result exists to agree about.
  await a.act({ type: "CONCEDE", seat: 0, seq: a.view.seq, at: "", payload: {} });
  await a.type("OVER");
  await b.type("OVER");

  a.send({ t: "NOSTR", role: "result", event: ev(a.privateKey) });
  assert.equal((await nostr(a, 1)).agreement, "pending");
  assert.equal((await nostr(b, 1)).agreement, "pending", "both seats learn the state of play");

  b.send({ t: "NOSTR", role: "result", event: ev(b.privateKey) });
  const confirmed = await nostr(b, 2);
  assert.equal(confirmed.agreement, "confirmed");
  assert.equal(confirmed.events.length, 2);
  assert.equal(JSON.parse(confirmed.events[0].content).matchId, a.matchId, "stored verbatim");

  // A disagreeing republication flips it, and is never silently dropped.
  b.send({ t: "NOSTR", role: "result", event: ev(b.privateKey, { content: '{"v":1,"winners":[1]}' }) });
  assert.equal((await b.next((m) => m.t === "NOSTR" && m.agreement === "disputed")).events.length, 2);

  await new Promise((r) => setTimeout(r, 50));
  const kinds = table.db.prepare("SELECT role, kind, pubkey, sig_checked FROM nostr_events WHERE match_id=? ORDER BY role").all(a.matchId);
  assert.ok(kinds.some((k) => k.role === "invite" && k.kind === 4600));
  // Seat binding caps the table at one row per (role, seat): three rows, never
  // a fourth invented by one side.
  assert.equal(kinds.filter((k) => k.role === "result").length, 2);
  for (const k of kinds) {
    assert.ok([a.pubkey, b.pubkey].includes(k.pubkey), "a row under a foreign pubkey");
    /* D-11 IS REPAID. Every stored event's id was recomputed from its own bytes
     * and its signature verified before the row existed, so this column is a
     * fact rather than an admission. */
    assert.equal(k.sig_checked, 1);
  }

  // A malformed event is refused rather than stored.
  a.send({ t: "NOSTR", role: "result", event: { pubkey: "nope" } });
  assert.equal((await a.type("ERROR")).code, "BAD_MESSAGE");
});

test("online identity requires a fresh, verified NIP-42 signature", async (t) => {
  const table = await boot(t, "t-auth.db");
  const client = await table.client({ skipAuth: true, identity: "auth-proof" });

  client.send({ t: "CREATE", name: "claim only", affinity: "Power", pubkey: AUTH_PUBKEY });
  const refused = await client.next((msg) => msg.t === "ERROR" || msg.t === "STATE");
  assert.equal(refused.t, "ERROR", "a bare pubkey claim opened a table");
  assert.equal(refused.code, "NIP07_REQUIRED");
  assert.equal(table.db.prepare("SELECT COUNT(*) AS n FROM matches").get().n, 0);

  const challenge = await client.type("AUTH");
  client.send({ t: "AUTH", event: signedAuth(challenge) });
  const authenticated = await client.type("AUTH_OK");
  assert.equal(authenticated.pubkey, AUTH_PUBKEY);

  client.send({ t: "CREATE", name: "signed", affinity: "Power" });
  const created = await client.type("STATE");
  assert.equal(created.players[0].pubkey, AUTH_PUBKEY);

  const replay = await table.client({ skipAuth: true, identity: "auth-proof" });
  await replay.type("AUTH");
  replay.send({ t: "AUTH", event: signedAuth(challenge) });
  assert.equal((await replay.type("ERROR")).code, "AUTH_FAILED",
    "an AUTH event from another connection replayed successfully");
});

test("NIP-07 identity is required and bound to every online seat", async (t) => {
  const table = await boot(t, "t16.db");

  const a = await table.client({ identity: "a" });
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  assert.equal(created.players[0].pubkey, a.pubkey);

  const b = await table.client({ identity: "b" });
  b.send({ t: "JOIN", code: created.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  const joined = await b.type("STATE");
  await a.type("STATE");
  assert.deepEqual(joined.players.map((p) => p.pubkey), [a.pubkey, b.pubkey]);

  const noIdentity = await table.client({ identity: "c", skipAuth: true });
  noIdentity.send({ t: "RESUME", matchId: a.matchId, token: a.token });
  assert.equal((await noIdentity.type("ERROR")).code, "NIP07_REQUIRED");

  const wrongIdentity = await table.client({ identity: "c" });
  wrongIdentity.send({ t: "RESUME", matchId: a.matchId, token: a.token, pubkey: wrongIdentity.pubkey });
  assert.equal((await wrongIdentity.type("ERROR")).code, "IDENTITY_MISMATCH");
});

test("a finished match can still be signed after a reload, a reconnect and a restart", async (t) => {
  const dbPath = tmpDb("t12.db");
  // Created by hand, not via boot(): this test closes it mid-way to prove a
  // referee restart cannot erase the closing beat, so it must not be closed twice.
  const table = await createTable({ port: 0, dbPath, host: "127.0.0.1", rateMax: 1000000 });
  const a = await Client.open(table.wsUrl, { identity: "a" });
  a.send({ t: "CREATE", v: WIRE, name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  const b = await Client.open(table.wsUrl, { identity: "b" });
  b.send({ t: "JOIN", v: WIRE, code: created.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  await b.type("STATE");
  await a.type("STATE");
  const matchId = a.matchId;

  /* Seat 1 is GONE — terminated, no close frame — when the match ends. This is
   * the demo-day case: a slept laptop, a dropped wifi, a closed tab. */
  b.ws.terminate();
  await new Promise((r) => setTimeout(r, 80));
  await a.act({ type: "CONCEDE", seat: 0, seq: a.view.seq, at: "", payload: {} });
  const over = await a.type("OVER");
  assert.ok(over.resultContent && over.resultTags, "the winner got the signable bytes");

  // Seat 1 comes back the way site/net.js does. It must be handed the SAME bytes
  // its opponent already signed, or the two signatures can never be compared.
  const b2 = await Client.open(table.wsUrl, { identity: "b" });
  b2.send({ t: "RESUME", v: WIRE, matchId, token: b.token, pubkey: b2.pubkey });
  const state = await b2.type("STATE");
  assert.equal(state.status, "over");
  assert.equal(state.resultContent, over.resultContent, "STATE must carry the exact bytes");
  assert.deepEqual(state.resultTags, over.resultTags);
  assert.equal(state.resultCreatedAt, over.resultCreatedAt);
  const replayed = await b2.type("OVER");
  assert.equal(replayed.resultContent, over.resultContent, "OVER is re-sent on resume");
  assert.equal(replayed.verify.ok, true);

  // And from a cold page that never held a socket when the match ended.
  const body = await (await fetch(`${table.url}/api/match/${matchId}`)).json();
  assert.equal(body.resultContent, over.resultContent);
  assert.deepEqual(body.resultTags, over.resultTags);

  /* A referee restart must not erase the closing beat either: finishMatch is
   * never re-run, so the bytes have to come off the row. */
  await a.close();
  await b2.close();
  await table.close(); // a hard stop, as kill -9 would be

  const table2 = await boot(t, "unused.db", { dbPath });
  const c = await table2.client({ identity: "b" });
  c.send({ t: "RESUME", v: WIRE, matchId, token: b.token, pubkey: c.pubkey });
  const after = await c.type("STATE");
  assert.equal(after.status, "over");
  assert.equal(after.resultContent, over.resultContent, "a restart lost the signable bytes");
  assert.deepEqual(after.resultTags, over.resultTags);
});

test("HTTP: health, the relay-free table list, and out-of-band verification", async (t) => {
  const table = await boot(t, "t10.db");

  const health = await (await fetch(`${table.url}/api/health`)).json();
  assert.equal(health.ok, true);

  const a = await table.client();
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  assert.equal(created.status, "open");
  assert.equal(created.view, null, "no game exists until seat 1 arrives");
  assert.match(created.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

  // The relay-free join path: if every relay dies on stage, tables are still findable.
  const tables = await (await fetch(`${table.url}/api/tables`)).json();
  assert.equal(tables.length, 1);
  assert.equal(tables[0].code, created.code);

  const b = await table.client();
  b.send({ t: "JOIN", code: created.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  await b.type("STATE");
  await a.type("STATE");
  assert.equal((await (await fetch(`${table.url}/api/tables`)).json()).length, 0, "a full table is no longer open");

  /* WHILE A MATCH IS LIVE THIS ENDPOINT SAYS ALMOST NOTHING. config carries the
   * two hidden seeds, which generate both decklists, both shuffles and every
   * future draw — a matchId is in every STATE and, while the table is open, in
   * /api/tables, so publishing them mid-match hands any passer-by the opponent's
   * hand for the rest of the game. The transcript is gated with them: an
   * opponent's actions are not public either. */
  const live = await (await fetch(`${table.url}/api/match/${a.matchId}`)).json();
  assert.equal(live.status, "playing");
  assert.equal(live.config, undefined, "the config reached an unauthenticated caller");
  assert.equal(live.entries, undefined, "the transcript reached an unauthenticated caller");
  assert.ok(!JSON.stringify(live).includes("seeds"), "a seed appeared in the live payload");
  assert.deepEqual(Object.keys(live).sort(), ["headHash", "headSeq", "matchId", "publicHash", "status"]);
  assert.equal((await fetch(`${table.url}/api/match/m_nope`)).status, 404);

  // A second JOIN on a full table is refused with a TRANSPORT code.
  const c = await table.client();
  c.send({ t: "JOIN", code: created.code, name: "eve", affinity: "Keys", pubkey: c.pubkey });
  assert.equal((await c.type("ERROR")).code, "MATCH_FULL");
  c.send({ t: "JOIN", code: "ZZZZZZ", name: "eve", affinity: "Keys", pubkey: c.pubkey });
  assert.equal((await c.type("ERROR")).code, "NO_SUCH_MATCH");

  // Post-match it becomes the out-of-band verification path it was meant to be.
  await a.act({ type: "CONCEDE", seat: 0, seq: a.view.seq, at: "", payload: {} });
  await a.type("OVER");
  const done = await (await fetch(`${table.url}/api/match/${a.matchId}`)).json();
  assert.equal(done.status, "over");
  assert.ok(done.config.seeds, "the finished match exposes the config so anyone can replay");
  assert.equal(E.hashState(E.createGame(done.config)), E.hashState(E.createGame(done.config)));
  assert.equal(E.verifyMatch({ config: done.config, log: done.entries }).ok, true);

  // Static files come off the same port — one process on demo day.
  const page = await fetch(`${table.url}/play.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /engine\.js/);
  assert.equal((await fetch(`${table.url}/engine.js`)).status, 200);
  // Traversal is refused, never served.
  assert.ok((await fetch(`${table.url}/%2e%2e/package.json`)).status >= 400);
});

test("pre-NIP-07 legacy tables are neither advertised nor joinable", async (t) => {
  const table = await boot(t, "legacy-open.db");
  const host = await table.client();
  host.send({ t: "CREATE", name: "legacy", affinity: "Power", pubkey: host.pubkey });
  const created = await host.type("STATE");
  table.db.prepare("UPDATE matches SET seat0_pubkey=NULL WHERE match_id=?").run(created.matchId);
  table.matches.get(created.matchId).players[0].pubkey = null;

  const tables = await (await fetch(`${table.url}/api/tables`)).json();
  assert.equal(tables.some((entry) => entry.matchId === created.matchId), false);

  const guest = await table.client({ identity: "b" });
  guest.send({ t: "JOIN", code: created.code, name: "guest", affinity: "Signal", pubkey: guest.pubkey });
  assert.equal((await guest.type("ERROR")).code, "NO_SUCH_MATCH");
});

test("malformed URL escapes return 400 without killing the table", async (t) => {
  const table = await boot(t, "t17.db");

  const malformed = await fetch(`${table.url}/%E0%A4%A`, { signal: AbortSignal.timeout(1000) });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "bad url" });

  const health = await (await fetch(`${table.url}/api/health`)).json();
  assert.equal(health.ok, true, "the malformed request killed the referee");
});

test("oversized WebSocket messages are closed before parsing", async (t) => {
  const table = await boot(t, "t18.db", { maxPayload: 1024 });
  const attacker = await table.client();
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("oversized socket stayed open")), 1000);
    attacker.ws.once("close", (closeCode) => {
      clearTimeout(timeout);
      resolve(closeCode);
    });
    attacker.ws.send("x".repeat(1025));
  });
  assert.equal(code, 1009);

  const health = await (await fetch(`${table.url}/api/health`)).json();
  assert.equal(health.ok, true, "the oversized payload killed the referee");
});

test("browser WebSockets accept same-origin pages and reject foreign origins", async (t) => {
  const table = await boot(t, "t20.db");
  const foreign = new WebSocket(table.wsUrl, { headers: { Origin: "https://evil.example" } });

  await assert.rejects(
    new Promise((resolve, reject) => {
      foreign.once("open", () => {
        foreign.close();
        reject(new Error("foreign origin opened the game socket"));
      });
      foreign.once("error", reject);
    }),
    /403/,
  );

  const same = new WebSocket(table.wsUrl, { headers: { Origin: table.url } });
  await new Promise((resolve, reject) => {
    same.once("open", resolve);
    same.once("error", reject);
  });
  await new Promise((resolve) => {
    same.once("close", resolve);
    same.close();
  });

  const splitTable = await boot(t, "t21.db", { allowedOrigins: ["https://play.example"] });
  const split = new WebSocket(splitTable.wsUrl, {
    headers: { Origin: "https://play.example" },
  });
  await new Promise((resolve, reject) => {
    split.once("open", resolve);
    split.once("error", reject);
  });
  await new Promise((resolve) => {
    split.once("close", resolve);
    split.close();
  });
});

test("browser WebSockets reject DNS-rebinding hosts", async (t) => {
  const table = await boot(t, "t22.db");
  const attackerHost = `rebind.attacker:${table.port}`;
  const rebound = new WebSocket(table.wsUrl, {
    headers: { Host: attackerHost, Origin: `http://${attackerHost}` },
  });

  await assert.rejects(
    new Promise((resolve, reject) => {
      rebound.once("open", () => {
        rebound.close();
        reject(new Error("DNS-rebinding socket opened the game table"));
      });
      rebound.once("error", reject);
    }),
    /403/,
  );
});

test("HTTP APIs reject DNS-rebinding hosts", async (t) => {
  const table = await boot(t, "t27.db");
  const response = await httpJsonWithHost(
    `${table.url}/api/tables`,
    `rebind.attacker:${table.port}`,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: "host not allowed" });
});

test("configured table hosts remain admissible", async (t) => {
  const cases = [
    { name: "t23.db", options: { publicHost: "table.lan" }, hostname: "table.lan" },
    { name: "t24.db", options: { trustedHosts: ["alias.lan"] }, hostname: "alias.lan" },
  ];
  for (const entry of cases) {
    const table = await boot(t, entry.name, entry.options);
    const authority = `${entry.hostname}:${table.port}`;
    const socket = new WebSocket(table.wsUrl, {
      headers: { Host: authority, Origin: `http://${authority}` },
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await new Promise((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    const response = await httpJsonWithHost(`${table.url}/api/health`, authority);
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  }
});

test("CREATE, JOIN, RESUME, and NOSTR share a connection rate limit", async (t) => {
  const table = await boot(t, "t19.db", { controlMax: 2 });
  const client = await table.client();

  client.send({ t: "JOIN", code: "ZZZZZZ", name: "probe", affinity: "Power", pubkey: client.pubkey });
  assert.equal((await client.type("ERROR")).code, "NO_SUCH_MATCH");

  client.send({ t: "CREATE", name: "host", affinity: "Power", pubkey: client.pubkey });
  await client.type("STATE");

  client.send({ t: "NOSTR", role: "invite", event: {} });
  assert.equal((await client.type("ERROR")).code, "RATE_LIMITED");

  const rows = table.db.prepare("SELECT COUNT(*) AS n FROM matches").get();
  assert.equal(rows.n, 1, "rate-limited control traffic mutated the database");
  assert.equal((await (await fetch(`${table.url}/api/health`)).json()).ok, true);
});

test("control budgets survive reconnects and ignore untrusted forwarding headers", async (t) => {
  const table = await boot(t, "t25.db", { controlMax: 1 });
  const first = await table.client({ headers: { "X-Forwarded-For": "198.51.100.10" } });
  first.send({ t: "JOIN", code: "ZZZZZZ", name: "probe", affinity: "Power", pubkey: first.pubkey });
  assert.equal((await first.type("ERROR")).code, "NO_SUCH_MATCH");
  await first.close();

  const second = await table.client({ headers: { "X-Forwarded-For": "203.0.113.20" } });
  second.send({ t: "JOIN", code: "ZZZZZZ", name: "probe", affinity: "Power", pubkey: second.pubkey });
  assert.equal((await second.type("ERROR")).code, "RATE_LIMITED");
});

test("malformed, bad-version, and unknown messages share the address budget", async (t) => {
  const table = await boot(t, "t26.db", { controlMax: 2 });
  const client = await table.client();

  client.ws.send("{");
  assert.equal((await client.type("ERROR")).code, "BAD_MESSAGE");
  client.ws.send(JSON.stringify({ t: "JOIN", v: 999 }));
  assert.equal((await client.type("ERROR")).code, "BAD_VERSION");
  client.send({ t: "UNKNOWN" });
  assert.equal((await client.type("ERROR")).code, "RATE_LIMITED");
});

test("unseated ACT messages cannot bypass the address budget", async (t) => {
  const table = await boot(t, "t28.db", { controlMax: 1 });
  const client = await table.client();

  client.send({ t: "ACT", action: { type: "PASS_PRIORITY" } });
  assert.equal((await client.type("ERROR")).code, "NO_SUCH_MATCH");
  client.send({ t: "ACT", action: { type: "PASS_PRIORITY" } });
  assert.equal((await client.type("ERROR")).code, "RATE_LIMITED");
});

test("rejected card clicks are free; only a runaway loop is closed", async (t) => {
  const table = await boot(t, "t11.db", { rateMax: 30, rejectMax: 400 });
  const { a, b } = await twoSeats(table);

  /* WHAT A HUMAN ACTUALLY DOES. Clicking each card in your opening hand on turn
   * 1 is rejected every time — CANNOT_AFFORD, NOT_RESOURCE, WRONG_PHASE are what
   * browsing your own hand looks like on the wire. Charging those to the action
   * budget kicked the player off the socket for playing the game. Sixty clicks
   * is twice the old ceiling and must cost nothing. */
  const rejects = {};
  for (let i = 0; i < 60; i++) {
    const hand = a.view.zones["0:wallet"];
    const reply = await a.act({
      type: "PLAY_CARD", seat: 0, seq: a.view.seq, at: "",
      payload: { uid: hand[i % hand.length] },
    });
    assert.notEqual(reply.t, "ERROR", `a card click was rate-limited after ${i} clicks`);
    if (reply.t === "REJECT") rejects[reply.code] = (rejects[reply.code] || 0) + 1;
  }
  t.diagnostic(`60 card clicks, all free: ${JSON.stringify(rejects)}`);
  assert.ok(Object.keys(rejects).length > 0, "the clicks must really have been rejected");
  assert.equal(a.ws.readyState, 1, "the socket was closed by ordinary play");

  // A loop that never learns is still cut off — that is what the budget is for.
  for (let i = 0; i < 500; i++) {
    a.send({ t: "ACT", action: { type: "PASS_PRIORITY", seat: 0, seq: 9999, at: "", payload: {} } });
  }
  assert.equal((await a.type("ERROR")).code, "RATE_LIMITED");

  // The opponent is untouched and the match is still playable.
  assert.equal((await b.next((m) => m.t === "PEER" && m.online === false)).seat, 0);
  const reply = await b.act({ type: "PASS_PRIORITY", seat: 1, seq: b.view.seq, at: "", payload: {} });
  assert.ok(["FRAME", "REJECT"].includes(reply.t));

  /* And a kicked seat is not re-kicked the instant it returns. The window used
   * to survive the disconnect, so the first action on the fresh socket was
   * RATE_LIMITED again for the rest of the 10 s window. */
  const back = await table.client({ identity: "a" });
  back.send({ t: "RESUME", v: WIRE, matchId: a.matchId, token: a.token, pubkey: back.pubkey });
  const state = await back.type("STATE");
  assert.equal(state.seat, 0);
  const first = await back.act({ type: "PASS_PRIORITY", seat: 0, seq: state.view.seq, at: "", payload: {} });
  assert.notEqual(first.t, "ERROR", "a reconnected seat was immediately re-kicked");
});

test("a table refuses to seat the same connection twice", async (t) => {
  const table = await boot(t, "t13.db");
  const a = await table.client();
  a.send({ t: "CREATE", name: "solo", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");

  /* A presenter who fumbles and types their OWN code into the join box used to
   * be registered at conns[0] AND conns[1]: the match started against itself,
   * left /api/tables, delivered both seats' unredacted views down one socket,
   * and the real opponent got MATCH_FULL forever with no way back. */
  a.send({ t: "JOIN", code: created.code, name: "solo-again", affinity: "Signal", pubkey: a.pubkey });
  assert.equal((await a.type("ERROR")).code, "MATCH_FULL");

  // A second tab of the same login is refused on the pubkey alone.
  const dup = await table.client({ identity: "a" });
  dup.send({ t: "JOIN", code: created.code, name: "me-again", affinity: "Keys", pubkey: dup.pubkey });
  assert.equal((await dup.type("ERROR")).code, "MATCH_FULL");

  // The table survived all of it: a real opponent still gets seat 1.
  const b = await table.client();
  b.send({ t: "JOIN", code: created.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  const joined = await b.type("STATE");
  assert.equal(joined.seat, 1);
  assert.equal(joined.status, "playing");
});

test("the host's share link offers the free seat to a NIP-07 identity", async (t) => {
  const table = await boot(t, "t14.db");
  const a = await table.client();
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  assert.equal(created.claimable, true, "an open table with a free seat says so");

  /* A signed-in cold browser opening ?match=…&code=… carries no token, so it
   * lands in the verified-spectator branch. It is still the person the host invited:
   * the STATE must say the seat is there for the taking, or both people sit
   * looking at the same host screen waiting for the other to join. */
  const b = await table.client();
  b.send({ t: "RESUME", matchId: created.matchId, pubkey: b.pubkey });
  const downgraded = await b.type("STATE");
  assert.equal(downgraded.role, "spectator");
  assert.equal(downgraded.status, "open");
  assert.equal(downgraded.claimable, true, "the free seat was not offered");
  assert.equal(downgraded.code, created.code, "the code to join with must be in the STATE");

  // And acting on it seats them for real.
  b.send({ t: "JOIN", code: downgraded.code, name: "anna", affinity: "Signal", pubkey: b.pubkey });
  const seated = await b.next((m) => m.t === "STATE" && m.seat === 1);
  assert.equal(seated.status, "playing");
  assert.equal(seated.claimable, false);
});

test("no seat can attack from its Wallet, over the wire", async (t) => {
  /* PINNED so this test is deterministic: on a random seed the scripted driver
   * often decks out before anyone lands an Avatar, and a test that only
   * sometimes reaches the code under test is not a regression test. Under pin 15
   * seat 1 is asked for attackers on turn 2 holding six cards. */
  const table = await boot(t, "t15.db", { pinSeed: 15 });
  const { a, b } = await twoSeats(table);

  /* site/play.js only ever offers Network cards, so no local hotseat test can
   * reach this — it takes a modified client, which is exactly the threat. Drive
   * a real match until someone is asked to declare attackers, then name a card
   * that is still in hand. */
  /* Anything the seat owns that is NOT on the Network: the Wallet if it still
   * holds a card, otherwise the Archive. Both are out of combat under §5.2/§6. */
  const offNetwork = (view, seat) => {
    const wallet = view.zones[`${seat}:wallet`] || [];
    if (wallet.length) return wallet[0];
    const archive = (view.zones[`${seat}:archive`] || []).filter((u) => view.objects[u].owner === seat);
    return archive.length ? archive[0] : null;
  };

  const banned = new Set();
  let declaring = null;
  let illegal = null;
  for (let i = 0; i < 6000 && !declaring; i++) {
    let acted = false;
    for (const c of [a, b]) {
      if (!c.view || c.view.result) continue;
      if (c.view.awaiting && c.view.awaiting.kind === "attackers" && c.view.awaiting.seat === c.seat) {
        illegal = offNetwork(c.view, c.seat);
        if (illegal) { declaring = c; break; }
      }
      const action = chooseAction(c.view, c.seat, banned);
      if (!action || action.blocked) continue;
      const reply = await c.act(action);
      acted = true;
      if (reply.t === "ERROR") throw new Error("transport ERROR: " + reply.code);
      if (reply.t === "REJECT") {
        const key = action.type === "DECLARE_ATTACKERS" ? "ATTACK"
          : action.type === "PLAY_RESOURCE" ? "R" + action.payload.uid
          : action.type === "ACTIVATE_RESOURCE_ABILITY" ? "A" + action.payload.uid
          : action.payload.uid;
        banned.add(`${action.seq}:${key}`);
        continue;
      }
      await settle([a, b], reply.seq);
    }
    if (!acted && !declaring) break;
  }
  assert.ok(declaring, "never reached a declare-attackers step with an off-Network card");

  const seat = declaring.seat;
  const zoneBefore = declaring.view.objects[illegal].zone;
  const uptimeBefore = declaring.view.seats[1 - seat].uptime;
  t.diagnostic(`seat ${seat} declares ${illegal} from ${zoneBefore}`);
  const reply = await declaring.act({
    type: "DECLARE_ATTACKERS", seat, seq: declaring.view.seq, at: "", payload: { attackers: [illegal] },
  });
  assert.equal(reply.t, "REJECT", "the referee accepted an attack from off the Network");
  assert.equal(reply.code, "NOT_IN_ZONE", "and refused it with the blocker path's own code");
  assert.equal(reply.view.objects[illegal].zone, zoneBefore, "the card moved");
  assert.equal(reply.view.seats[1 - seat].uptime, uptimeBefore, "damage was dealt by a refused attack");
  // Nothing illegal reached the hash chain, so the transcript still certifies.
  const rows = table.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE match_id=?").get(a.matchId);
  assert.equal(rows.n, declaring.view.seq, "a refused declaration was written to the transcript");
});

// ------------------------------------------------------------- matchmaking

test("the queue pairs two identities into one fully seated match", async (t) => {
  const table = await boot(t, "q1.db");
  const a = await table.client();
  a.send({ t: "QUEUE", name: "felix", affinity: "Power" });
  const waiting = await a.type("QUEUED");
  assert.equal(waiting.queued, true);
  assert.equal(waiting.position, 1);
  assert.equal(waiting.waiting, 1);

  const b = await table.client();
  b.send({ t: "QUEUE", name: "anna", affinity: "Signal" });

  const first = await a.type("STATE");
  const second = await b.type("STATE");
  assert.equal(first.matchId, second.matchId);
  assert.equal(first.status, "playing");
  assert.equal(second.status, "playing");
  assert.equal(first.seat, 0);
  assert.equal(second.seat, 1);
  // DEALT, not merely opened: a queued player never waits at an empty table.
  assert.ok(first.view && second.view, "both seats must hold a view immediately");
  assert.equal(first.view.forSeat, 0);
  assert.equal(second.view.forSeat, 1);
  assert.equal(first.view.gameId, second.view.gameId);
  assert.ok(first.token && second.token && first.token !== second.token);
  assert.equal(first.players[1].name, "anna");
  assert.equal(second.players[0].name, "felix");

  // And no ghost table is left advertised behind the pair.
  const open = table.db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status='open'").get();
  assert.equal(open.n, 0, "matchmaking must not leave an open row behind");
});

test("one identity is never matched against itself", async (t) => {
  const table = await boot(t, "q2.db");
  const a = await table.client({ identity: "solo" });
  const b = await table.client({ identity: "solo" }); // the same npub, a second tab
  a.send({ t: "QUEUE", name: "tab one", affinity: "Power" });
  await a.type("QUEUED");
  b.send({ t: "QUEUE", name: "tab two", affinity: "Power" });
  const still = await b.type("QUEUED");
  assert.equal(still.queued, true, "a second tab of one npub must keep waiting");
  assert.equal(still.waiting, 2);

  // A third, genuinely different player pairs with whoever waited longest.
  const c = await table.client({ identity: "other" });
  c.send({ t: "QUEUE", name: "anna", affinity: "Signal" });
  const dealt = await a.type("STATE");
  assert.equal(dealt.status, "playing");
  assert.equal(dealt.players[0].name, "tab one", "the queue is first come, first served");
  assert.equal(dealt.players[1].name, "anna");
});

test("leaving the queue and dropping the socket both free the place", async (t) => {
  const table = await boot(t, "q3.db");
  const a = await table.client();
  a.send({ t: "QUEUE", name: "felix", affinity: "Power" });
  await a.type("QUEUED");
  a.send({ t: "UNQUEUE" });
  const out = await a.next((m) => m.t === "QUEUED" && m.queued === false);
  assert.equal(out.waiting, 0);

  // A queued player who closes the tab must not block the person behind them.
  const b = await table.client({ identity: "b" });
  b.send({ t: "QUEUE", name: "anna", affinity: "Signal" });
  await b.type("QUEUED");
  await b.close();
  const c = await table.client({ identity: "c" });
  c.send({ t: "QUEUE", name: "cara", affinity: "Keys" });
  const alone = await c.type("QUEUED");
  assert.equal(alone.queued, true, "a dead socket must never be paired with");
  assert.equal(alone.waiting, 1, "a closed socket must be gone from the queue");
});

test("queueing is refused while seated at a live match", async (t) => {
  const table = await boot(t, "q4.db");
  const { a } = await twoSeats(table);
  a.send({ t: "QUEUE", name: "felix", affinity: "Power" });
  const refused = await a.type("ERROR");
  assert.equal(refused.code, "MATCH_FULL");
});

test("an unauthenticated connection cannot queue", async (t) => {
  const table = await boot(t, "q5.db");
  const a = await table.client({ skipAuth: true });
  await a.type("AUTH");
  a.send({ t: "QUEUE", name: "nobody", affinity: "Power" });
  const refused = await a.type("ERROR");
  assert.equal(refused.code, "NIP07_REQUIRED");
});

// ------------------------------------------------ the session is the identity

test("signing in finds the match this npub is seated at", async (t) => {
  const table = await boot(t, "s1.db");
  const { a, b } = await twoSeats(table);
  const matchId = a.matchId;
  const wallet = a.view.zones["0:wallet"].slice();
  // The browser goes away entirely: closed tab, cleared profile, other machine.
  await a.close();

  const cold = await Client.open(table.wsUrl, { identity: "a" });
  t.after(() => cold.close());
  const hello = cold.hello;
  assert.ok(Array.isArray(hello.active), "AUTH_OK must carry this identity's matches");
  assert.equal(hello.active.length, 1);
  assert.equal(hello.active[0].matchId, matchId);
  assert.equal(hello.active[0].seat, 0);
  assert.equal(hello.active[0].status, "playing");
  assert.equal(hello.active[0].opponent, "anna");
  assert.equal(hello.active[0].opponentOnline, true);

  // And that alone is enough to sit back down: no token, no saved anything.
  cold.send({ t: "RESUME", matchId });
  const back = await cold.type("STATE");
  assert.equal(back.seat, 0, "the npub must recover its own seat");
  assert.equal(back.role, "seat");
  assert.ok(back.token, "a seat recovered without a token is issued a fresh one");
  assert.equal(back.view.forSeat, 0);
  assert.deepEqual(back.view.zones["0:wallet"], wallet, "and the same hand it left with");
  assert.equal(b.seat, 1);
});

test("a finished match is not offered as somewhere to return to", async (t) => {
  const table = await boot(t, "s2.db");
  const { a } = await twoSeats(table);
  await a.act({ type: "CONCEDE", seat: 0, seq: a.view.seq, at: "", payload: {} });
  await a.next((m) => m.t === "OVER");

  const cold = await Client.open(table.wsUrl, { identity: "a" });
  t.after(() => cold.close());
  assert.deepEqual(cold.hello.active, [], "a concluded match is history, not a session");
});

// ------------------------------------------------------------------ leaving

test("LEAVE closes an abandoned open table instead of advertising it forever", async (t) => {
  const table = await boot(t, "l1.db");
  const a = await table.client();
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const created = await a.type("STATE");
  assert.equal((await (await fetch(table.url + "/api/tables")).json()).length, 1);

  a.send({ t: "LEAVE" });
  await a.next((m) => m.t === "QUEUED" && m.queued === false);
  assert.deepEqual(await (await fetch(table.url + "/api/tables")).json(), [],
    "a table nobody is sitting at must not stay on the list");
  const row = table.db.prepare("SELECT COUNT(*) AS n FROM matches WHERE match_id=?").get(created.matchId);
  assert.equal(row.n, 0);

  // And leaving frees the identity to start again immediately.
  a.send({ t: "QUEUE", name: "felix", affinity: "Power" });
  const queued = await a.next((m) => m.t === "QUEUED" && m.queued === true);
  assert.equal(queued.position, 1);
});

test("LEAVE during a live match keeps the seat and the transcript", async (t) => {
  const table = await boot(t, "l2.db");
  const { a, b } = await twoSeats(table);
  const matchId = a.matchId;
  a.send({ t: "LEAVE" });
  const away = await b.next((m) => m.t === "PEER" && m.seat === 0);
  assert.equal(away.online, false, "the opponent is told, not left guessing");

  const row = table.db.prepare("SELECT status FROM matches WHERE match_id=?").get(matchId);
  assert.equal(row.status, "playing", "walking away must not destroy a match in progress");

  // The seat is still this identity's to reclaim.
  a.send({ t: "RESUME", matchId, token: a.token });
  const back = await a.type("STATE");
  assert.equal(back.seat, 0);
});

test("conceding ends the match for both seats and clears the session", async (t) => {
  const table = await boot(t, "l3.db");
  const { a, b } = await twoSeats(table);
  const reply = await a.act({ type: "CONCEDE", seat: 0, seq: a.view.seq, at: "", payload: {} });
  assert.equal(reply.t, "FRAME");
  const over = await b.next((m) => m.t === "OVER");
  assert.deepEqual(over.result.winners, [1], "the seat that stayed wins");
  assert.equal(over.result.reason, "concede");
  assert.ok(over.resultContent, "a resignation is a signable result like any other");

  const cold = await Client.open(table.wsUrl, { identity: "b" });
  t.after(() => cold.close());
  assert.deepEqual(cold.hello.active, [], "a resigned match is not somewhere to return to");
});

test("/api/tables says whether the host is actually sitting there", async (t) => {
  const table = await boot(t, "l4.db");
  const a = await table.client();
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  await a.type("STATE");
  const live = await (await fetch(table.url + "/api/tables")).json();
  assert.equal(live[0].hostOnline, true);

  await a.close();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const cold = await (await fetch(table.url + "/api/tables")).json();
  assert.equal(cold.length, 1, "a dropped socket is not an abandoned table");
  assert.equal(cold[0].hostOnline, false, "a code whose host closed the tab must say so");
});

// ------------------------------------------------------- serving the site

/** A raw request, because fetch() transparently decodes and hides the encoding. */
function rawGet(url, headers) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpGet(
      { hostname: target.hostname, port: target.port, path: target.pathname, headers: headers || {} },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    request.on("error", reject);
  });
}

test("text assets are compressed, and a repeat visit revalidates instead of re-downloading", async (t) => {
  const table = await boot(t, "h1.db");

  const plain = await rawGet(`${table.url}/play.js`);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers["content-encoding"], undefined, "no encoding unless asked for");
  assert.ok(plain.headers.etag, "every asset must carry an ETag to revalidate against");

  const zipped = await rawGet(`${table.url}/play.js`, { "accept-encoding": "gzip" });
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers["content-encoding"], "gzip");
  assert.equal(zipped.headers.vary, "accept-encoding");
  assert.equal(zipped.body[0], 0x1f, "a gzip body starts with the gzip magic");
  assert.equal(zipped.body[1], 0x8b);
  assert.ok(
    zipped.body.length < plain.body.length / 2,
    `compression must actually pay: ${plain.body.length} -> ${zipped.body.length}`
  );

  /* THE WHOLE POINT. `no-cache` means "ask me first", not "do not store", so a
   * second visit is a 304 with no body rather than another 300 KB. */
  const fresh = await rawGet(`${table.url}/play.js`, { "if-none-match": plain.headers.etag });
  assert.equal(fresh.status, 304);
  assert.equal(fresh.body.length, 0, "a revalidation must not resend the file");
  assert.equal(fresh.headers["cache-control"], "no-cache", "and it must stay always-fresh");

  // The gzip cache is keyed by mtime, so it can never serve a stale build.
  const second = await rawGet(`${table.url}/play.js`, { "accept-encoding": "gzip" });
  assert.equal(second.headers.etag, zipped.headers.etag);
  assert.ok(second.body.equals(zipped.body));
});

test("already-compressed formats are served as they are", async (t) => {
  const table = await boot(t, "h2.db");
  const png = await rawGet(`${table.url}/art/brand/600B-logo-primary.png`, {
    "accept-encoding": "gzip",
  });
  assert.equal(png.status, 200);
  assert.equal(png.headers["content-encoding"], undefined, "gzipping a PNG only makes it bigger");
  assert.ok(png.headers.etag, "but it still revalidates");
});

test("a TLS deployment advertises the URL an invite must actually carry", async (t) => {
  /* The old builder hardcoded ws:// and the bound port, so behind a reverse
   * proxy every published invite was both mixed-content-blocked and aimed at a
   * port the internet cannot reach — silently, because nothing failed here. */
  const table = await boot(t, "h3.db", { publicUrl: "wss://tcg.example/ws" });
  const a = await table.client();
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey });
  const state = await a.type("STATE");
  assert.equal(state.table, "wss://tcg.example/ws");
});

test("an advertised table URL that is not a websocket is refused at boot", async (t) => {
  await assert.rejects(
    () => createTable({ port: 0, dbPath: tmpDb("h4.db"), host: "127.0.0.1", publicUrl: "https://tcg.example/ws" }),
    /ws:\/\/ or wss:\/\//
  );
});

// ------------------------------------------------------------------ stakes

test("the queue pairs on the wager, so both seats agreed to the same number", async (t) => {
  const table = await boot(t, "w1.db");
  const a = await table.client({ identity: "a" });
  a.send({ t: "QUEUE", name: "felix", affinity: "Power", stake: 500 });
  await a.type("QUEUED");

  /* Someone looking for a friendly must never be dealt into a 500-sat match
   * just because they were next in line. */
  const b = await table.client({ identity: "b" });
  b.send({ t: "QUEUE", name: "anna", affinity: "Signal", stake: 0 });
  const waiting = await b.type("QUEUED");
  assert.equal(waiting.queued, true, "a friendly must not pair with a wager");
  assert.equal(waiting.waiting, 2);

  const c = await table.client({ identity: "c" });
  c.send({ t: "QUEUE", name: "cara", affinity: "Keys", stake: 500 });
  const dealt = await a.type("STATE");
  assert.equal(dealt.status, "playing");
  assert.equal(dealt.stake, 500, "the agreed wager is on the match");
  assert.equal(dealt.players[1].name, "cara");

  const other = await c.type("STATE");
  assert.equal(other.stake, 500, "and both seats are told the identical number");
  assert.equal(
    table.db.prepare("SELECT stake FROM matches WHERE match_id=?").get(dealt.matchId).stake,
    500
  );
});

test("a stake is a whole number of sats or it is nothing", async (t) => {
  const table = await boot(t, "w2.db");
  const a = await table.client({ identity: "a" });
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey, stake: -5 });
  assert.equal((await a.type("STATE")).stake, 0, "a negative wager is a friendly");

  const b = await table.client({ identity: "b" });
  b.send({ t: "CREATE", name: "anna", affinity: "Signal", pubkey: b.pubkey, stake: 12.7 });
  assert.equal((await b.type("STATE")).stake, 0, "half a sat is not a wager");

  const c = await table.client({ identity: "c" });
  c.send({ t: "CREATE", name: "cara", affinity: "Keys", pubkey: c.pubkey, stake: 99999999999 });
  assert.equal((await c.type("STATE")).stake, 1000000, "and it is capped, not trusted");
});

test("a guest is never dealt into a wager it did not accept", async (t) => {
  const table = await boot(t, "w3.db");
  const a = await table.client({ identity: "a" });
  a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: a.pubkey, stake: 2100 });
  const open = await a.type("STATE");

  // The open-table list is where a guest LEARNS the wager before committing.
  const listed = await (await fetch(table.url + "/api/tables")).json();
  assert.equal(listed[0].stake, 2100);

  const b = await table.client({ identity: "b" });
  b.send({ t: "JOIN", code: open.code, name: "anna", affinity: "Signal", stake: 0 });
  const refused = await b.type("ERROR");
  assert.equal(refused.code, "STAKE_MISMATCH");
  assert.match(refused.message, /2100/, "and it says what the table actually plays for");

  // Stating the number it was shown gets it seated.
  b.send({ t: "JOIN", code: open.code, name: "anna", affinity: "Signal", stake: 2100 });
  const seated = await b.type("STATE");
  assert.equal(seated.status, "playing");
  assert.equal(seated.stake, 2100);
});

test("the agreed wager survives a referee restart", async (t) => {
  /* The wager is the one fact about a match the referee cannot recompute, so if
   * it did not persist, a reload would quietly turn a 500-sat game friendly. */
  const dbPath = tmpDb("w4.db");
  const first = await createTable({ port: 0, dbPath, host: "127.0.0.1", rateMax: 1000000 });
  const a = await Client.open(first.wsUrl, { identity: "a" });
  a.send({ t: "QUEUE", name: "felix", affinity: "Power", stake: 750 });
  await a.type("QUEUED");
  const b = await Client.open(first.wsUrl, { identity: "b" });
  b.send({ t: "QUEUE", name: "anna", affinity: "Signal", stake: 750 });
  const dealt = await a.type("STATE");
  const token = dealt.token;
  await a.close();
  await b.close();
  await first.close();

  const second = await createTable({ port: 0, dbPath, host: "127.0.0.1", rateMax: 1000000 });
  t.after(async () => second.close());
  const back = await Client.open(second.wsUrl, { identity: "a" });
  t.after(() => back.close());
  back.send({ t: "RESUME", matchId: dealt.matchId, token });
  const resumed = await back.type("STATE");
  assert.equal(resumed.stake, 750);
  assert.equal(resumed.seat, 0);
});

// -------------------------------------------------------------------- CORS

test("a page on a listed origin can read the lobby; anyone else cannot", async (t) => {
  /* THE RELAY-FREE JOIN PATH IS THE FALLBACK FOR WHEN EVERY RELAY IS DOWN. If
   * the page and the referee live on different origins and this header is
   * missing, the browser opens the socket but silently refuses to read
   * /api/tables — no error anyone can see, just an empty lobby. */
  const table = await boot(t, "c1.db", { allowedOrigins: ["https://600.wtf"] });

  const allowed = await rawGet(`${table.url}/api/tables`, { origin: "https://600.wtf" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://600.wtf");
  assert.equal(allowed.headers.vary, "origin");

  const stranger = await rawGet(`${table.url}/api/tables`, { origin: "https://evil.example" });
  assert.equal(stranger.status, 200, "the data is still served to non-browsers");
  assert.equal(
    stranger.headers["access-control-allow-origin"],
    undefined,
    "but no unlisted page may read it — a wildcard would let anyone enumerate tables"
  );

  const noOrigin = await rawGet(`${table.url}/api/health`);
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers["access-control-allow-origin"], undefined);
});

test("a preflight is answered without reaching any handler", async (t) => {
  const table = await boot(t, "c2.db", { allowedOrigins: ["https://600.wtf"] });
  const target = new URL(`${table.url}/api/tables`);
  const options = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method: "OPTIONS",
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: { origin: "https://600.wtf" },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-origin"], "https://600.wtf");
  assert.match(options.headers["access-control-allow-methods"], /GET/);
});
