"use strict";

/* Per-client token buckets for the HTTP routes that cost the referee work.
 *
 * WHY A TOKEN BUCKET. A client may spend `max` requests at once and then earns
 * one back every windowMs / max, so "20 per minute" is both the burst and the
 * sustained rate. A buyer who runs dry while polling for an invoice to settle
 * is back in service a few seconds later rather than a whole window later, and
 * a bucket stays two numbers however hard it is hammered, where a log of
 * timestamps grows with every hit.
 *
 * MEMORY IS BOUNDED TWICE. A bucket that has refilled is indistinguishable from
 * no bucket at all, so prune() drops it; and past maxKeys the least recently
 * used bucket goes first. Either way the only effect is a client receiving a
 * fresh allowance, so neither can ever lock anybody out. */

/**
 * @param {{limits: Object<string, {max:number, windowMs:number}>,
 *   clock?: () => number, maxKeys?: number}} options
 */
function createRateLimiter({ limits, clock = () => performance.now(), maxKeys = 10_000 }) {
  /** `${limit}|${client}` -> { limit, tokens, at }, least recently used first. */
  const buckets = new Map();

  const refilled = (bucket, now) => {
    const { max, windowMs } = limits[bucket.limit];
    // A clock that steps backwards refills nothing rather than draining.
    return Math.min(max, bucket.tokens + (Math.max(0, now - bucket.at) * max) / windowMs);
  };

  /** Spend one token of `limit` for `client`: {ok:true} or {ok:false, retryAfter} in seconds. */
  function take(limit, client) {
    const { max, windowMs } = limits[limit];
    const key = `${limit}|${client}`;
    const now = clock();
    const found = buckets.get(key);
    const tokens = found ? refilled(found, now) : max;
    // Re-inserted below, which keeps the Map ordered by last use.
    buckets.delete(key);
    if (tokens >= 1) {
      buckets.set(key, { limit, tokens: tokens - 1, at: now });
      if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
      return { ok: true };
    }
    buckets.set(key, { limit, tokens, at: now });
    const wait = Math.ceil(((1 - tokens) * windowMs) / max / 1000);
    return { ok: false, retryAfter: Math.max(1, wait) };
  }

  /** Forget every bucket that has refilled completely. */
  function prune() {
    const now = clock();
    for (const [key, bucket] of buckets) {
      if (refilled(bucket, now) >= limits[bucket.limit].max) buckets.delete(key);
    }
  }

  return {
    take,
    prune,
    get size() {
      return buckets.size;
    },
  };
}

module.exports = { createRateLimiter };
