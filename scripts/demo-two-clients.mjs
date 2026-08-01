/* Drive two clients through a real match against a RUNNING table server.
 *
 * This is the out-of-process proof: nothing is stubbed, the server is a separate
 * `node server/table.js`, and these two clients hold only VIEWS. If fog of war
 * were UI-side, this script could read the opponent's hand — it checks that it
 * cannot.
 *
 *   RATE_MAX=100000 node server/table.js     # terminal 1
 *   node scripts/demo-two-clients.mjs        # terminal 2
 *
 * RATE_MAX is needed here and ONLY here: this script acts at ~100 actions per
 * second, which is precisely the traffic the referee's action budget exists to
 * bound. A human never approaches it, so the demo itself leaves RATE_MAX unset.
 *
 * Env: TABLE (ws url, default ws://127.0.0.1:8777/ws)
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../site/engine.js");
const CARDS = require("../site/play-data.js");
const WebSocket = require("ws");
E.setCatalog(CARDS);

const CATALOG = E.buildCatalog(CARDS);
const card = (id) => CATALOG.byId[id] || null;
const URL = process.env.TABLE || "ws://127.0.0.1:8777/ws";
const ok = (label, value) => console.log(`${value ? "  PASS" : "  FAIL"}  ${label}`);

class Client {
  constructor() { this.inbox = []; this.waiters = []; this.over = null; }
  static async open(url) {
    const c = new Client();
    c.ws = new WebSocket(url);
    await new Promise((res, rej) => { c.ws.once("open", res); c.ws.once("error", rej); });
    c.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === "STATE") { c.seat = m.seat; c.view = m.view; c.matchId = m.matchId; c.code = m.code; c.token = m.token || c.token; }
      if (m.t === "FRAME" || m.t === "REJECT") c.view = m.view;
      if (m.t === "OVER") c.over = m;
      c.inbox.push(m);
      for (const w of c.waiters.splice(0)) w();
    });
    return c;
  }
  send(m) { this.ws.send(JSON.stringify({ v: 1, ...m })); }
  async next(match, ms = 15000) {
    const dl = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex(match);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      if (Date.now() > dl) throw new Error("timed out waiting for a message");
      await new Promise((r) => { this.waiters.push(r); setTimeout(r, 5); });
    }
  }
  type(t) { return this.next((m) => m.t === t); }
  act(action) {
    this.send({ t: "ACT", action });
    return this.next((m) =>
      (m.t === "FRAME" && m.seq === action.seq + 1) ||
      (m.t === "REJECT" && m.seq === action.seq) || m.t === "ERROR");
  }
}

const costOf = (id) => {
  const c = card(id);
  if (!c || !c.costParsed) return 0;
  return Object.values(c.costParsed).reduce((a, b) => a + (Number(b) || 0), 0);
};

function chooseAction(view, seat, banned) {
  if (!view || view.result) return null;
  const seq = view.seq;
  const act = (type, payload) => ({ type, seat, seq, at: "", payload: payload || {} });
  const vetoed = (k) => banned.has(`${seq}:${k}`);
  if (view.pendingManual) {
    return view.pendingManual.seat === seat
      ? act("MANUAL_WITHDRAW", { mid: view.pendingManual.mid })
      : act("MANUAL_REJECT", { mid: view.pendingManual.mid, reason: "scripted" });
  }
  if (view.pendingChoice && view.pendingChoice.seat === seat) {
    const o = view.pendingChoice.options || [];
    return act("CHOOSE", { choiceId: view.pendingChoice.id, selection: o.slice(0, 1).map((x) => (x && x.value !== undefined ? x.value : x)) });
  }
  const aw = view.awaiting;
  if (aw) {
    if (aw.seat !== seat) return null;
    switch (aw.kind) {
      case "attackers": {
        if (vetoed("ATTACK")) return act("DECLARE_ATTACKERS", { attackers: [] });
        const mine = view.zones[`${seat}:network`] || [];
        return act("DECLARE_ATTACKERS", {
          attackers: mine.filter((u) => {
            const o = view.objects[u];
            if (!o || !o.cardId || o.committed || o.bootDelay) return false;
            const c = card(o.cardId);
            return !!(c && c.isAvatar && (c.keywords || []).indexOf("Firewall") < 0);
          }),
        });
      }
      case "blockers": return act("DECLARE_BLOCKERS", { blocks: {} });
      case "order": return act("ORDER_BLOCKERS", { order: {} });
      case "damage": return act("ASSIGN_COMBAT_DAMAGE", { assignment: null });
      case "discard": return act("DISCARD_TO_LIMIT", { uids: (view.zones[`${seat}:wallet`] || []).slice(0, aw.count) });
      case "triggers":
        if (Array.isArray(view.myTriggers)) return act("ORDER_TRIGGERS", { qids: view.myTriggers.map((t) => t.pendingId) });
        return act("CONCEDE"); // needs the engine's myTriggers redaction fix
      default: return act("CONCEDE");
    }
  }
  if (view.priority.seat !== seat) return null;
  const wallet = view.zones[`${seat}:wallet`] || [];
  const isRes = (u) => { const o = view.objects[u]; const c = o && o.cardId ? card(o.cardId) : null; return !!(c && c.isResource); };
  const main = (view.turn.phase === "build1" || view.turn.phase === "build2") && view.turn.step === "main";
  if (!(main && view.turn.active === seat && view.queue.length === 0)) return act("PASS_PRIORITY");
  if (view.turn.resourcePlays.used < view.turn.resourcePlays.allowed) {
    const u = wallet.find((x) => isRes(x) && !vetoed("R" + x));
    if (u) return act("PLAY_RESOURCE", { uid: u });
  }
  const banked = Object.values(view.seats[seat].buffer || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  if (banked < 8) {
    const src = (view.zones[`${seat}:network`] || []).find((u) => {
      const o = view.objects[u];
      if (!o || !o.cardId || o.committed || vetoed("A" + u)) return false;
      const c = card(o.cardId);
      return !!(c && c.isResource && c.abilities.length);
    });
    if (src) {
      const c = card(view.objects[src].cardId);
      const i = c.abilities.findIndex((ab) => ab.resourceAbility);
      const aff = (c.affinity || []).find((x) => x !== "Neutral") || "Power";
      if (i >= 0) return act("ACTIVATE_RESOURCE_ABILITY", { uid: src, abilityIndex: i, choice: aff });
    }
  }
  const castable = wallet
    .filter((u) => !isRes(u) && view.objects[u] && view.objects[u].cardId && !vetoed(u))
    .sort((x, y) => costOf(view.objects[x].cardId) - costOf(view.objects[y].cardId));
  if (castable.length) return act("PLAY_CARD", { uid: castable[0] });
  return act("PASS_PRIORITY");
}

const settle = async (cs, seq) => {
  const dl = Date.now() + 5000;
  for (const c of cs) while ((c.view ? c.view.seq : -1) < seq && Date.now() < dl && !c.over) await new Promise((r) => setTimeout(r, 2));
};

// ------------------------------------------------------------------------ run

console.log(`table: ${URL}`);
const a = await Client.open(URL);
a.send({ t: "CREATE", name: "felix", affinity: "Power", pubkey: "a".repeat(64) });
const created = await a.type("STATE");
console.log(`match ${created.matchId}  code ${created.code}  (seat 0 = felix)`);

const b = await Client.open(URL);
b.send({ t: "JOIN", code: created.code, name: "anna", affinity: "Signal", pubkey: "b".repeat(64) });
await b.type("STATE");
await a.type("STATE");
console.log(`seat 1 = anna joined; game ${a.view.gameId}\n`);

console.log("1. TWO SEATS, TWO VIEWS OF ONE STATE");
ok(`same gameId (${a.view.gameId}) and same seq (${a.view.seq})`, a.view.gameId === b.view.gameId && a.view.seq === b.view.seq);
ok("the two views are NOT byte-identical", JSON.stringify(a.view) !== JSON.stringify(b.view));
console.log(`        seat 0 view ${JSON.stringify(a.view).length} B · seat 1 view ${JSON.stringify(b.view).length} B`);

console.log("\n2. FOG OF WAR IS SERVER-ENFORCED");
const own = a.view.zones["0:wallet"];
const foe = a.view.zones["1:wallet"];
ok(`seat 0 reads its own ${own.length}-card hand`, own.every((u) => a.view.objects[u].cardId));
ok(`seat 0 sees seat 1's ${foe.length} hand cards as uid shells only`, foe.every((u) => !a.view.objects[u].cardId));
ok("seat 1 likewise cannot read seat 0's hand", b.view.zones["0:wallet"].every((u) => !b.view.objects[u].cardId));
/* NO seed of any kind, public included. The public seed used to ship "for
 * audit"; under a referee it is a live oracle — a seat holding it can test
 * candidate hidden seeds against gameId and deckCommit, and under PIN_SEED it
 * derived them by addition. Audit is the post-match bundle in section 6. */
const streams = [a.view.rng.public, b.view.rng.public].concat(a.view.rng.hidden, b.view.rng.hidden);
ok("no rng seed of any kind appears in either view", streams.every((s) => s.s === undefined));
ok("the draw counters still do", streams.every((s) => typeof s.n === "number"));
ok("the Stack is a count, never a list", !Array.isArray(a.view.zones["0:stack"]));
console.log(`        seat 0 example own card: ${a.view.objects[own[0]].cardId} · seat 1 example: ${JSON.stringify(a.view.objects[foe[0]])}`);

/* And the HTTP audit endpoint says nothing about a LIVE match: config carries
 * the hidden seeds, which generate both decks, both shuffles and every future
 * draw, and a matchId is not a secret — it is in every STATE. */
const liveBase = URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const liveAudit = await (await fetch(`${liveBase}/api/match/${a.matchId}`)).json();
ok(`GET /api/match/${a.matchId} while playing hides the config`, liveAudit.config === undefined);
ok("…and the transcript with it", liveAudit.entries === undefined);
ok("…and names no seed at all", !JSON.stringify(liveAudit).includes("seeds"));

console.log("\n3. AN ILLEGAL ACTION IS REJECTED WITH THE ENGINE'S OWN CODE");
for (const probe of [
  { label: "seat 1 claims seat 0", c: b, action: { type: "PASS_PRIORITY", seat: 0, seq: b.view.seq, at: "", payload: {} } },
  { label: "a stale seq", c: a, action: { type: "PASS_PRIORITY", seat: 0, seq: a.view.seq + 99, at: "", payload: {} } },
  { label: "a card that does not exist", c: a, action: { type: "PLAY_CARD", seat: 0, seq: a.view.seq, at: "", payload: { uid: "o99999" } } },
]) {
  const r = await probe.c.act(probe.action);
  ok(`${probe.label} -> ${r.t} ${r.code}`, r.t === "REJECT" && !!r.view);
}

console.log("\n4. A FULL REMOTE MATCH");
const banned = new Set();
const rejects = {};
let sent = 0;
const t0 = Date.now();
for (let i = 0; i < 8000 && !a.over && !b.over; i++) {
  let acted = false;
  for (const c of [a, b]) {
    if (a.over || b.over) break;
    if (!c.view || c.view.result) continue;
    const action = chooseAction(c.view, c.seat, banned);
    if (!action) continue;
    const r = await c.act(action);
    sent++;
    acted = true;
    if (r.t === "ERROR") {
      // Say which knob, rather than dying with a bare code on stage.
      const hint = r.code === "RATE_LIMITED"
        ? " — this script acts at machine speed; start the referee with RATE_MAX=100000"
        : "";
      throw new Error("transport ERROR: " + r.code + hint);
    }
    if (r.t === "REJECT") {
      rejects[r.code] = (rejects[r.code] || 0) + 1;
      const key = action.type === "DECLARE_ATTACKERS" ? "ATTACK"
        : action.type === "PLAY_RESOURCE" ? "R" + action.payload.uid
        : action.type === "ACTIVATE_RESOURCE_ABILITY" ? "A" + action.payload.uid
        : action.payload.uid;
      banned.add(`${action.seq}:${key}`);
      continue;
    }
    await settle([a, b], r.seq);
    if (r.view && r.view.result) for (const x of [a, b]) if (!x.over) await x.type("OVER");
  }
  if (!acted) break;
}
const over = a.over || b.over;
console.log(`   ${sent} actions sent in ${Date.now() - t0} ms · rejections ${JSON.stringify(rejects)}`);
ok("the match reached a result", !!over);
if (!over) process.exit(1);
console.log(`   result: ${JSON.stringify(over.result)} after ${over.transcript.length} transcript entries, turn ${JSON.parse(over.resultContent).turns}`);

console.log("\n5. THE TRANSCRIPT PERSISTS, REPLAYS AND VERIFIES");
ok(`the referee's own verifyMatch over the DB passed (divergedAt ${over.verify.divergedAt})`, over.verify.ok === true);
const replayed = E.replay(over.config, over.transcript.map((e) => e.action));
ok("E.replay of the transcript succeeds", replayed.error === null);
ok(`E.replay reproduces the head stateHash ${over.transcript.at(-1).stateHash.slice(0, 16)}…`,
  E.hashState(replayed.state) === over.transcript.at(-1).stateHash);
ok(`E.entryHash of the last entry == OVER.headHash ${over.headHash.slice(0, 16)}…`,
  E.entryHash(over.transcript.at(-1)) === over.headHash);
ok(`E.publicHash matches ${over.publicHash.slice(0, 16)}…`, E.publicHash(replayed.state) === over.publicHash);
ok("the replayed result equals the published result", JSON.stringify(replayed.state.result) === JSON.stringify(over.result));
ok("a client-side E.verifyMatch on the bundle also passes", E.verifyMatch({ config: over.config, log: over.transcript }).ok === true);
let chain = true;
for (let i = 1; i < over.transcript.length; i++) {
  if (over.transcript[i].prev !== over.transcript[i - 1].hash) chain = false;
}
ok(`the hash chain is unbroken across all ${over.transcript.length} entries`, chain);
const tampered = over.transcript.map((e) => ({ ...e }));
const mid = Math.floor(tampered.length / 2);
tampered[mid].action = { type: "CONCEDE", seat: 0, seq: tampered[mid].seq, at: "", payload: {} };
ok(`tampering with entry ${mid} is detected`, E.verifyMatch({ config: over.config, log: tampered }).ok === false);
ok("both players were handed identical bytes to sign", a.over.resultContent === b.over.resultContent);

console.log("\n6. THE SAME TRANSCRIPT OFF THE HTTP AUDIT ENDPOINT");
const httpBase = URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const audit = await (await fetch(`${httpBase}/api/match/${over.matchId}`)).json();
ok(`GET /api/match/${over.matchId} returns ${audit.entries.length} entries`, audit.entries.length === over.transcript.length);
ok("status is over and the stored verdict is ok", audit.status === "over" && audit.verify.ok === true);
ok("the persisted head hash matches the broadcast one", audit.headHash === over.headHash);
ok("verifying the DB copy from scratch passes", E.verifyMatch({ config: audit.config, log: audit.entries }).ok === true);

a.ws.close();
b.ws.close();
console.log("\nDONE.");
process.exit(0);
