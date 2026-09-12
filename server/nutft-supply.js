"use strict";

/* The supply ledger: what this mint has issued, signed and chained.
 *
 * The mint already keeps a per-card `remaining` table and a commitment that
 * moves on every claim, and /nutft/state serves both. But that answer is
 * unsigned and only ever "as of now": a holder cannot keep a copy that binds
 * the mint, and two holders cannot tell whether they were told the same
 * thing. This module turns the same figures into Nostr events, signed with
 * the catalog key a wallet already trusts, each naming the id of the one
 * before it. The chain is kept in the mint's own database, served a page at
 * a time under /nutft/supply, and pushed to relays when any are configured.
 *
 * A PAGE, NOT THE WHOLE CHAIN. A snapshot carries one count per printed card,
 * so Edition One's is about 5 KB and the chain grows without bound. Served
 * whole it would eventually exceed what a client will read in one response,
 * and supply verification would stop working with no warning. So the route
 * answers with at most SUPPLY_PAGE snapshots: the newest ones by default,
 * which is what a client that has never seen this chain wants, or the page
 * beginning at ?from=<seq>, which is how a returning client reaches back to
 * the snapshot it remembers. Every response says which sequence numbers it
 * covers and how long the chain is, so a client always knows what it has.
 *
 * Snapshots are taken on a timer, not per sale. A per-sale event would
 * timestamp every purchase; a timer says only how many cards left the mint
 * during one interval, which is the whole point of counting in public and
 * nothing more. The interval is the operator's dial.
 *
 * The ledger never contradicts itself. Before it signs, the books must
 * balance: every issued card was one decrement of one count, and every pack
 * issued exactly `issued_per_pack` of them, so (printed - remaining) has to
 * equal sold x issued_per_pack. Counts must not grow and packs sold must not
 * shrink between one snapshot and the next. A state that fails that check is
 * refused and reported, not attested.
 *
 * ISSUED, NOT RESERVED. A committed purchase takes a pack out of the mint's
 * counts before anybody has claimed it, and releaseExpiredPurchases puts it
 * back when the buyer never returns. So the mint's own counts describe what
 * is ALLOCATED, and that figure goes down as well as up. What a holder wants
 * to know is how many cards are in someone's hands, so the caller's read()
 * gives back the reservations, and the four transitions then move the way a
 * count of issued cards should:
 *
 *   a purchase opens     allocated +1, reserved +1  -> issued unchanged
 *   it is claimed        allocated  0, reserved -1  -> issued +1
 *   it expires           allocated -1, reserved -1  -> issued unchanged
 *   a claim with no purchase          allocated +1  -> issued +1
 *
 * The mint's draw commitment is deliberately NOT in a snapshot. It follows
 * allocation too, so it would move without issuance moving; a signed field a
 * verifier cannot check is worse than one that is not there. It stays where
 * it belongs, on /nutft/state and the quote. */

const crypto = require("node:crypto");
const WebSocket = require("ws");
const { schnorr } = require("@noble/curves/secp256k1");

const SUPPLY_KIND = 7610;
const SUPPLY_SCHEMA = "600b-nutft-supply-v1";
/* Snapshots per response. 100 of Edition One's is about half a megabyte,
   comfortably inside the two a napplet will read, and it covers a client that
   checks in at least every hundred selling days in a single request. */
const SUPPLY_PAGE = 100;
const MIN_INTERVAL_SECONDS = 60;
const DEFAULT_INTERVAL_SECONDS = 86_400;
const PUBLISH_TIMEOUT_MS = 10_000;

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const sum = (counts) => Object.values(counts).reduce((total, n) => total + n, 0);

/* NIP-01: an event's id is the SHA-256 of exactly this array serialization. */
function eventId(event) {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  return crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
}

function parseRelays(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  for (const relay of list) {
    if (!/^wss?:\/\/\S+$/.test(relay)) throw new Error(`NUTFT_SUPPLY_RELAYS entries must be ws:// or wss:// URLs: ${relay}`);
  }
  return list;
}

function parseInterval(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_INTERVAL_SECONDS;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || (seconds !== 0 && seconds < MIN_INTERVAL_SECONDS)) {
    throw new Error(`NUTFT_SUPPLY_INTERVAL_SECONDS must be 0 (no timer) or at least ${MIN_INTERVAL_SECONDS}`);
  }
  return seconds;
}

function createSupplyLedger(options) {
  const { db, privateKey, canonical, collectionId, catalogUri, censusSha256, copies, read } = options;
  if (!Buffer.isBuffer(privateKey) || privateKey.length !== 32) throw new Error("the supply ledger needs the 32-byte catalog key");
  if (typeof canonical !== "function" || typeof read !== "function") throw new Error("the supply ledger needs canonical() and read()");
  if (!copies || typeof copies !== "object" || !Object.keys(copies).length) throw new Error("the supply ledger needs the printed copies per card");
  const packs = options.packs;
  const issuedPerPack = options.issuedPerPack;
  if (!Number.isInteger(packs) || packs <= 0) throw new Error("census.mint.packs must be a positive integer");
  if (!Number.isInteger(issuedPerPack) || issuedPerPack <= 0) throw new Error("census.mint.paid_cards_per_pack must be a positive integer");
  const relays = parseRelays(options.relays);
  const intervalSeconds = parseInterval(options.intervalSeconds);
  const publishTimeoutMs = options.publishTimeoutMs || PUBLISH_TIMEOUT_MS;
  const now = options.now || (() => Math.floor(Date.now() / 1000));
  const log = options.log || ((message) => console.error(`[nutft supply] ${message}`));
  const pubkey = hex(schnorr.getPublicKey(privateKey));
  const ids = Object.keys(copies).sort();
  const printed = sum(copies);

  let q = null;
  const memory = [];
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nutft_supply (
        seq          INTEGER PRIMARY KEY,
        id           TEXT NOT NULL UNIQUE,
        event_json   TEXT NOT NULL,
        published_at TEXT
      )
    `);
    q = {
      all: db.prepare("SELECT event_json FROM nutft_supply ORDER BY seq"),
      range: db.prepare("SELECT event_json FROM nutft_supply WHERE seq >= ? ORDER BY seq LIMIT ?"),
      latest: db.prepare("SELECT event_json FROM nutft_supply ORDER BY seq DESC LIMIT 1"),
      unpublished: db.prepare("SELECT id, event_json FROM nutft_supply WHERE published_at IS NULL ORDER BY seq"),
      put: db.prepare("INSERT INTO nutft_supply (seq, id, event_json) VALUES (?, ?, ?)"),
      markPublished: db.prepare("UPDATE nutft_supply SET published_at = ? WHERE id = ? AND published_at IS NULL"),
    };
  }
  const parse = (row) => JSON.parse(row.event_json);
  /* Only this process writes the table, so the head is read once and then
     kept; /nutft/state hands it out without a query. */
  const headRow = q ? q.latest.get() : null;
  let head = headRow ? parse(headRow) : null;
  let fault = null;

  const events = () => (q ? q.all.all().map(parse) : memory.map((row) => row.event));
  const unpublished = () => (q
    ? q.unpublished.all().map((row) => ({ id: row.id, event: parse(row) }))
    : memory.filter((row) => !row.published_at));

  const seqOf = (event) => JSON.parse(event.content).seq;
  const headSeq = () => (head ? seqOf(head) : 0);

  /* One bounded page, oldest first. Without a `from` it is the tail: the
     newest snapshots, which is what a client with no history of its own is
     asking for. With one it starts there, which is how a client walks back to
     the snapshot it remembers. A `from` past the head yields no events and a
     truthful `total`, rather than an error: "there is nothing at that
     sequence number yet" is an answer. */
  const page = (from) => {
    const total = headSeq();
    const wanted = Number.isInteger(from) && from > 0 ? from : total - SUPPLY_PAGE + 1;
    const start = Math.max(1, wanted);
    const events = total === 0 ? [] : (q
      ? q.range.all(start, SUPPLY_PAGE).map(parse)
      : memory.filter((row) => seqOf(row.event) >= start).slice(0, SUPPLY_PAGE).map((row) => row.event));
    return {
      total,
      page_size: SUPPLY_PAGE,
      first_seq: events.length ? seqOf(events[0]) : 0,
      last_seq: events.length ? seqOf(events[events.length - 1]) : 0,
      events,
    };
  };

  const figures = () => {
    const current = read();
    const remaining = {};
    for (const id of ids) remaining[id] = current.remaining[id];
    return { remaining, sold: current.sold };
  };

  /* The books, checked before anything is signed. Returns the first thing
     wrong in words, or null when everything balances. */
  const audit = (current, previous) => {
    for (const id of ids) {
      const left = current.remaining[id];
      if (!Number.isInteger(left) || left < 0 || left > copies[id]) return `remaining[${id}] is ${left}, outside 0..${copies[id]}`;
    }
    if (!Number.isInteger(current.sold) || current.sold < 0 || current.sold > packs) return `sold is ${current.sold}, outside 0..${packs}`;
    /* Against the previous snapshot BEFORE the identity below. A state that
       moved backwards usually breaks the identity too, and "this count grew"
       names the fault where "the books do not balance" only describes it. */
    if (previous) {
      if (current.sold < previous.sold) return `packs sold went from ${previous.sold} to ${current.sold}`;
      for (const id of ids) {
        if (current.remaining[id] > previous.remaining[id]) return `remaining[${id}] grew from ${previous.remaining[id]} to ${current.remaining[id]}`;
      }
    }
    const issued = printed - sum(current.remaining);
    if (issued !== current.sold * issuedPerPack) {
      return `${issued} cards left the mint but ${current.sold} packs x ${issuedPerPack} is ${current.sold * issuedPerPack}`;
    }
    return null;
  };

  /* Sign the current figures when they moved since the last snapshot.
     Returns the new event, or null when there is nothing new to say. Throws
     when the books do not balance; nothing is signed then. */
  function snapshot() {
    const previous = head ? JSON.parse(head.content) : null;
    const current = figures();
    const found = audit(current, previous);
    if (found) {
      fault = found;
      throw new Error(`supply ledger refuses to attest: ${found}`);
    }
    fault = null;
    /* Nothing new to say. Both are compared, not just the pack count: a
       count that moved while sold stood still is a fault the audit above has
       already named, and must not be silently skipped as "unchanged". */
    if (previous && previous.sold === current.sold
        && canonical(previous.remaining) === canonical(current.remaining)) return null;
    const seq = previous ? previous.seq + 1 : 1;
    const prev = head ? head.id : null;
    const content = canonical({
      schema: SUPPLY_SCHEMA,
      collection_id: collectionId,
      catalog_uri: catalogUri,
      census_sha256: censusSha256,
      seq,
      prev,
      packs,
      issued_per_pack: issuedPerPack,
      sold: current.sold,
      remaining: current.remaining,
    });
    const tags = [["x", censusSha256]];
    if (prev) tags.push(["e", prev, "", "prev"]);
    /* A clock that stepped back must not produce a chain that runs backwards. */
    const created_at = Math.max(now(), head ? head.created_at : 0);
    const unsigned = { pubkey, created_at, kind: SUPPLY_KIND, tags, content };
    const id = eventId(unsigned);
    /* Zero auxiliary randomness, like the catalog: the same figures at the
       same second sign to the same bytes on every machine. */
    const sig = hex(schnorr.sign(Buffer.from(id, "hex"), privateKey, new Uint8Array(32)));
    const event = { ...unsigned, id, sig };
    if (q) q.put.run(seq, id, JSON.stringify(event));
    else memory.push({ id, event, published_at: null });
    head = event;
    return event;
  }

  /* One relay, every event, one connection. Resolves to the ids the relay
     accepted; a relay that never answers or refuses everything resolves to an
     empty set after the timeout, and the events stay pending for next time. */
  function publishTo(relay, list) {
    return new Promise((resolve) => {
      const accepted = new Set();
      let answered = 0;
      let done = false;
      let socket = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (socket) { try { socket.close(); } catch { /* already closed */ } }
        resolve(accepted);
      };
      const timer = setTimeout(finish, publishTimeoutMs);
      try {
        socket = new WebSocket(relay);
      } catch (error) {
        log(`${relay}: ${error.message}`);
        return finish();
      }
      socket.on("open", () => { for (const event of list) socket.send(JSON.stringify(["EVENT", event])); });
      socket.on("message", (data) => {
        let frame;
        try { frame = JSON.parse(String(data)); } catch { return; }
        if (!Array.isArray(frame) || frame[0] !== "OK") return;
        answered += 1;
        if (frame[2] === true) accepted.add(frame[1]);
        else log(`${relay} refused ${frame[1]}: ${frame[3] || "no reason given"}`);
        if (answered >= list.length) finish();
      });
      socket.on("error", (error) => { log(`${relay}: ${error.message}`); finish(); });
      socket.on("close", finish);
    });
  }

  let publishing = null;
  /* Every snapshot no relay has accepted yet, to every relay. A snapshot is
     marked published once one relay has taken it; relays de-duplicate by id,
     so offering it again to the others later costs nothing. */
  function publish(targets = relays) {
    if (!targets.length) return Promise.resolve({ pending: 0, published: 0 });
    if (publishing) return publishing;
    publishing = (async () => {
      const rows = unpublished();
      if (!rows.length) return { pending: 0, published: 0 };
      const list = rows.map((row) => row.event);
      const accepted = new Set();
      for (const relay of targets) {
        for (const id of await publishTo(relay, list)) accepted.add(id);
      }
      const at = new Date().toISOString();
      for (const row of rows) {
        if (!accepted.has(row.id)) continue;
        if (q) q.markPublished.run(at, row.id);
        else row.published_at = at;
      }
      return { pending: rows.length - accepted.size, published: accepted.size };
    })().finally(() => { publishing = null; });
    return publishing;
  }

  let timer = null;
  const tick = () => {
    try {
      snapshot();
    } catch (error) {
      log(error.message);
      return;
    }
    publish().catch((error) => log(error.message));
  };
  function start() {
    if (timer || intervalSeconds === 0) return;
    timer = setInterval(tick, intervalSeconds * 1000);
    if (typeof timer.unref === "function") timer.unref();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    kind: SUPPLY_KIND,
    issuer: pubkey,
    relays,
    intervalSeconds,
    snapshot,
    publish,
    start,
    stop,
    events,
    latest: () => head,
    fault: () => fault,
    page,
    chain: (from) => ({
      kind: SUPPLY_KIND,
      schema: SUPPLY_SCHEMA,
      issuer: pubkey,
      collection_id: collectionId,
      census_sha256: censusSha256,
      relays,
      fault,
      ...page(from),
    }),
  };
}

module.exports = { SUPPLY_KIND, SUPPLY_PAGE, SUPPLY_SCHEMA, createSupplyLedger, eventId };
