/* A phrase recovery is hundreds of requests. One cut off part-way -- a mint that
   stays busy past every retry, a closed tab -- must keep what it found and pick
   up from where it stopped, or a client held to a small budget fails at the same
   request on every attempt and never recovers anything. */

import assert from "node:assert/strict";
import test from "node:test";
import { PACK, bootMint, openWallet } from "./helpers/wallet-fixture.mjs";

const recovery = (request) => request.method === "POST" && /\/v1\/(restore|checkstate)$/.test(request.path);

test("a recovery held to three requests an attempt keeps its progress and finishes", async (t) => {
  const mint = await bootMint(t);
  const buyer = await openWallet(mint);
  await buyer.wallet.buyBooster(mint.url);
  const phrase = await buyer.wallet.recoveryPhrase();

  /* Three recovery requests reach the mint per attempt; after that it is busy
     for the rest of the attempt, past every retry the wallet makes. */
  let allowance = 0;
  const reached = [];
  const device = await openWallet(mint, {
    intercept: (request) => {
      if (!recovery(request)) return null;
      if (allowance === 0) return Response.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "20" } });
      allowance -= 1;
      reached.push(request);
      return null;
    },
  });

  let count = null;
  const attempts = [];
  while (count === null && attempts.length < 60) {
    allowance = 3;
    const before = reached.length;
    try {
      count = await device.wallet.restoreSeed(mint.url, phrase);
    } catch (error) {
      assert.match(error.message, /busy \(429\)/);
      assert.ok(device.saved().restoring, "the attempt left a checkpoint");
    }
    attempts.push(reached.length - before);
  }

  assert.equal(count, PACK, `recovered after ${attempts.length} attempts`);
  const saved = device.saved();
  assert.equal(saved.restoring, undefined, "and the checkpoint is gone");
  assert.equal((await device.wallet.snapshotReadOnly(mint.url)).owned.length, PACK,
    "every recovered card is held, none twice");

  /* Resumed, not restarted: every batch reached the mint at most twice (once
     more only when an attempt ended between its restore and its checkstate). */
  const batches = reached.filter((request) => request.path === "/v1/restore")
    .map((request) => request.body.outputs[0].B_);
  const asked = new Map();
  for (const first of batches) asked.set(first, (asked.get(first) || 0) + 1);
  assert.ok(Math.max(...asked.values()) <= 2, "no batch was scanned over and over from slot 0");
});

test("a recovery that was cut off resumes instead of refusing a wallet with cards in it",
  async (t) => {
    const mint = await bootMint(t);
    const buyer = await openWallet(mint);
    await buyer.wallet.buyBooster(mint.url);
    const phrase = await buyer.wallet.recoveryPhrase();

    let cut = true;
    let sent = 0;
    const device = await openWallet(mint, {
      intercept: (request) => {
        if (!recovery(request) || !cut || ++sent < 12) return null;
        return Response.json({ error: "the mint refuses for this test" }, { status: 400 });
      },
    });
    await assert.rejects(device.wallet.restoreSeed(mint.url, phrase), /restore failed \(400\)|unavailable \(400\)/);
    const checkpoint = device.saved();
    assert.ok(checkpoint.restoring.next > 0, "progress was written before the refusal");
    assert.ok(checkpoint.tokens.length > 0, "and the cards found so far are in the wallet");

    await assert.rejects(device.wallet.buyBooster(mint.url), /finish recovering/,
      "nothing may take counter slots while the recovery is unfinished");

    cut = false;
    const firstAttempt = device.posted("/v1/restore");
    assert.equal(await device.wallet.restoreSeed(mint.url, phrase), PACK);
    const secondAttempt = device.posted("/v1/restore").slice(firstAttempt.length);
    const firstSlot = (request) => request.body.outputs[0].B_;
    const resumedAt = firstAttempt.findIndex((request) => firstSlot(request) === firstSlot(secondAttempt[0]));
    assert.equal(resumedAt, checkpoint.restoring.next / 100,
      "the second attempt began at the first batch the first one did not finish, not at slot 0");
  });
