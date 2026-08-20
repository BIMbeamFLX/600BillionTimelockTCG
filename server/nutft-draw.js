"use strict";

const crypto = require("node:crypto");

function hashParts(...parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(Buffer.isBuffer(part) ? part : Buffer.from(String(part)));
    hash.update(Buffer.from([0]));
  }
  return hash.digest();
}

function censusHash(counts) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(counts).sort()));
  return hashParts(canonical).toString("hex");
}

function draw(counts, order, rho, slot) {
  const remaining = order.reduce((sum, id) => sum + counts[id], 0);
  if (remaining <= 0) throw new Error("pool exhausted");
  let x = Number(BigInt(`0x${hashParts(rho, slot).toString("hex")}`) % BigInt(remaining));
  for (const id of order) {
    if (x < counts[id]) {
      counts[id] -= 1;
      return id;
    }
    x -= counts[id];
  }
  throw new Error("draw failed");
}

/* SEQUENTIAL DRAW: the census order IS the queue.
 *
 * draw() above picks by hash, which is a shuffle -- right for boosters, where
 * nobody should be able to work out which pack holds what. It cannot express
 * "the first twenty-one get the good ones", because a hash has no notion of
 * first.
 *
 * This does: it takes the earliest card in the pool that still has copies. Packs
 * are issued strictly in order (state.nextPack only moves on a claim), so pack 1
 * takes the first card the census lists, pack 2 the next, and so on. A card with
 * several copies simply fills several consecutive packs.
 *
 * It is MORE checkable than the hashed draw, not less: an announced rule like
 * "the first twenty-one sets carry a Genesis card" can be verified against the
 * published census by counting, with no beacon and no hashing. The pool for a
 * sequential slot therefore keeps its census order rather than being sorted.
 */
function drawSequential(counts, order) {
  for (const id of order) {
    if (counts[id] > 0) {
      counts[id] -= 1;
      return id;
    }
  }
  throw new Error("pool exhausted");
}

function openPack(counts, pools, slots, beacon, packId, sequential) {
  const rho = hashParts(Buffer.from(beacon, "hex"), packId);
  const cards = [];
  let slot = 0;
  for (const [pool, amount] of slots) {
    for (let i = 0; i < amount; i += 1) {
      cards.push(sequential && sequential.has(pool)
        ? drawSequential(counts, pools[pool])
        : draw(counts, pools[pool], rho, slot));
      slot += 1;
    }
  }
  return cards;
}

function loadCensus(census) {
  const counts = {};
  const pools = {};
  const basic = [];
  for (const card of census.cards) {
    if (card.copies) {
      counts[card.id] = card.copies;
      (pools[card.pool] ||= []).push(card.id);
    } else if (card.pool === "none") {
      basic.push(card.id);
    }
  }
  /* Sorting a sequential pool would throw its meaning away: its ORDER is the
     rule. Hashed pools are still sorted, so the draw does not depend on the
     order cards happen to appear in the file. */
  const sequential = new Set(Array.isArray(census.mint.sequential) ? census.mint.sequential : []);
  for (const [pool, ids] of Object.entries(pools)) {
    if (!sequential.has(pool)) ids.sort();
  }
  return {
    counts,
    pools,
    basic,
    sequential,
    slots: ["common", "uncommon", "prime"].map((pool) => [pool, census.mint.slots[pool]]),
  };
}

function selfTest(vector) {
  const counts = { ...vector.census };
  const pools = vector.pools;
  const slots = vector.slots;
  if (censusHash(counts) !== vector.commitment) return false;
  let state = Buffer.from(vector.commitment, "hex");
  for (const expected of vector.packs) {
    const cards = openPack(counts, pools, slots, vector.beacon, expected.pack_id);
    state = hashParts(state, expected.pack_id, vector.beacon, cards.join(","));
    if (JSON.stringify(cards) !== JSON.stringify(expected.cards) || state.toString("hex") !== expected.state) {
      return false;
    }
  }
  return JSON.stringify(counts) === JSON.stringify(vector.remaining);
}

if (require.main === module) {
  const vector = require("../cards/nutft-testvector.json");
  if (!selfTest(vector)) process.exitCode = 1;
  console.log(selfTest(vector) ? "NutFT draw vector: PASS" : "NutFT draw vector: FAIL");
}

module.exports = { censusHash, hashParts, loadCensus, openPack, selfTest };
