/* A card that arrives by transfer is moved under this wallet's recovery phrase
   by trading it to the wallet's own key at the next counter slot. When the mint
   refuses that move, or a purchase, the slot must be given back and the caller
   told; otherwise the card stays under the sender's secret and every later card
   sits beyond a run of slots a restore gives up on. */

import assert from "node:assert/strict";
import test from "node:test";
import { bootMint, handOver, openWallet, supplier } from "./helpers/wallet-fixture.mjs";

const refuseFirst = (path, answer) => {
  let refused = false;
  return (request) => {
    if (refused || request.method !== "POST" || request.path !== path) return null;
    refused = true;
    return answer();
  };
};

async function cardFor(mint, receiver) {
  const from = await supplier(mint);
  const [card] = (await from.wallet.snapshotReadOnly(mint.url)).owned;
  return handOver(from, mint, card.proof, await receiver.wallet.destination());
}

test("a refused move gives its slot back, the caller hears it, and the next attempt takes that slot",
  async (t) => {
    const mint = await bootMint(t);
    const bob = await openWallet(mint, {
      intercept: refuseFirst("/nutft/trade", () => Response.json({ error: "refused for this test" }, { status: 400 })),
    });
    const token = await cardFor(mint, bob);

    await assert.rejects(bob.wallet.importToken(mint.url, token), (error) => {
      assert.equal(error.imported, 1, "the import itself landed");
      assert.match(error.message, /recovery phrase: refused for this test/);
      return true;
    });
    assert.equal(bob.saved().pending, null);
    assert.equal(bob.counter(), 0, "the refused move handed its slot back");
    const [held] = (await bob.wallet.snapshotReadOnly(mint.url)).owned;
    assert.ok(held, "the card is in the wallet, still under the key it arrived with");

    await bob.wallet.tradeProof(mint.url, held.proof.secret, await bob.wallet.destination());
    const [refused, retried] = bob.posted("/nutft/trade").map((request) => request.body.outputs[0].B_);
    assert.equal(retried, refused, "the next attempt used the very slot the refusal gave back");
    assert.ok(bob.counter() > 0);
    assert.equal(bob.saved().outgoing.length, 0, "a card moved to this wallet's own phrase is no hand-off");
    assert.equal((await bob.wallet.snapshotReadOnly(mint.url)).owned.length, 1);
  });

test("an 'output was already signed' refusal keeps the counter past that slot", async (t) => {
  const mint = await bootMint(t);
  const bob = await openWallet(mint, {
    intercept: refuseFirst("/nutft/trade", () => Response.json({ error: "output was already signed" }, { status: 400 })),
  });
  const token = await cardFor(mint, bob);

  await assert.rejects(bob.wallet.importToken(mint.url, token), /already signed/);
  const past = bob.counter();
  assert.ok(past > 0, "that slot belongs to someone else, so the counter stays beyond it");

  const [held] = (await bob.wallet.snapshotReadOnly(mint.url)).owned;
  await bob.wallet.tradeProof(mint.url, held.proof.secret, await bob.wallet.destination());
  const [refused, retried] = bob.posted("/nutft/trade").map((request) => request.body.outputs[0].B_);
  assert.notEqual(retried, refused, "the next attempt took a fresh slot");
  assert.ok(bob.counter() > past);
});

test("a move the mint is too busy for stays pending and lands in the wallet, not the hand-offs",
  async (t) => {
    const mint = await bootMint(t);
    const bob = await openWallet(mint, {
      intercept: refuseFirst("/nutft/trade", () => Response.json({ error: "rate limited" }, { status: 429 })),
    });
    const token = await cardFor(mint, bob);

    await assert.rejects(bob.wallet.importToken(mint.url, token), (error) => {
      assert.equal(error.imported, 1);
      assert.equal(error.transient, true);
      return true;
    });
    assert.equal(bob.saved().pending.type, "trade", "the move is kept for the next attempt");

    await bob.wallet.recoverPending();
    const saved = bob.saved();
    assert.equal(saved.pending, null);
    assert.equal(saved.outgoing.length, 0, "finished later, it is still this wallet's card");
    assert.equal((await bob.wallet.snapshotReadOnly(mint.url)).owned.length, 1);
  });

test("a refused booster gives its slots back, so the next purchase reuses them", async (t) => {
  const mint = await bootMint(t);
  const buyer = await openWallet(mint, {
    intercept: refuseFirst("/nutft/booster", () => Response.json({ error: "stale booster quote" }, { status: 400 })),
  });

  await assert.rejects(buyer.wallet.buyBooster(mint.url), /stale booster quote/);
  assert.equal(buyer.saved().pending, null);
  assert.equal(buyer.counter(), 0, "fifteen slots would otherwise lie unsigned in front of every later card");

  await buyer.wallet.buyBooster(mint.url);
  const [refused, bought] = buyer.posted("/nutft/booster").map((request) => request.body.outputs[0].B_);
  assert.equal(bought, refused, "the same pack went to the same slots");
});
