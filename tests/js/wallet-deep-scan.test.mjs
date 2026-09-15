/* Wallets from before refused operations handed their counter slots back. When
   such a wallet lost a purchase to an error, it kept the pack's slots and moved
   on, leaving a run of unsigned slots longer than a recovery's normal window;
   every card bought after it lies beyond where a recovery stops. A deep scan
   searches further, and on a device that already recovered part of the wallet
   it continues from there. (Ported from the PR #73 review, scenario e4.) */

import assert from "node:assert/strict";
import test from "node:test";
import { PACK, STORE, bootMint, openWallet } from "./helpers/wallet-fixture.mjs";

test("a recovery stopped by an abandoned pack is completed by searching further", async (t) => {
  const mint = await bootMint(t);
  let busy = false;
  const bob = await openWallet(mint, {
    intercept: (request) => (busy && request.method === "POST" && request.path === "/nutft/booster"
      ? Response.json({ error: "rate limited" }, { status: 429 })
      : null),
  });
  await bob.wallet.buyBooster(mint.url);
  const afterFirst = bob.counter();
  busy = true;
  await assert.rejects(bob.wallet.buyBooster(mint.url, { timeoutMs: 1 }), /still pending/);
  busy = false;
  /* What the old wallet left: the claim dropped, the counter past its pack. */
  bob.storage.set(STORE, JSON.stringify({ ...bob.saved(), pending: null }));
  const abandoned = bob.counter() - afterFirst;
  await bob.wallet.buyBooster(mint.url);
  const phrase = await bob.wallet.recoveryPhrase();
  assert.ok(abandoned > 2 * 295 + 100, `an unsigned run of ${abandoned} slots, past the normal window`);

  const device = await openWallet(mint);
  assert.equal(await device.wallet.restoreSeed(mint.url, phrase), PACK,
    "a normal recovery stops at the abandoned pack");
  const firstPass = device.posted("/v1/restore").length;

  assert.equal(await device.wallet.restoreSeed(mint.url, phrase, { gapSlots: 3000 }), PACK,
    "searching further finds the pack beyond it");
  const saved = device.saved();
  assert.equal(saved.restoring, undefined);
  assert.equal((await device.wallet.snapshotReadOnly(mint.url)).owned.length, 2 * PACK,
    "the device now holds both packs, none twice");
  assert.equal(device.counter(), bob.counter(), "and its counter reached the original wallet's");
  const secondPass = device.posted("/v1/restore").slice(firstPass);
  const startedAt = device.posted("/v1/restore").findIndex((request) =>
    request.body.outputs[0].B_ === secondPass[0].body.outputs[0].B_);
  assert.ok(startedAt > 0, "the deeper search continued where the first stopped, not at slot 0");
});
