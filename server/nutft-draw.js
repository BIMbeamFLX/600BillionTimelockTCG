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

function openPack(counts, pools, slots, beacon, packId) {
  const rho = hashParts(Buffer.from(beacon, "hex"), packId);
  const cards = [];
  let slot = 0;
  for (const [pool, amount] of slots) {
    for (let i = 0; i < amount; i += 1) {
      cards.push(draw(counts, pools[pool], rho, slot));
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
  for (const ids of Object.values(pools)) ids.sort();
  return {
    counts,
    pools,
    basic,
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
