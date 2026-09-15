/* Received cards the recovery phrase cannot find yet. A card that arrives by
   transfer is locked to its sender's secret until the wallet trades it to its
   own key. When that move fails -- a busy mint, a refusal, a slot another device
   just took -- the wallet itself must remember the card, say so, and try again
   on every refresh, probing past slots that are already signed, until a fresh
   device restores every card this one holds. Nothing may depend on the app.
   (Ported from the PR #73 review, scenarios a2, b1, b2 and c2.) */

import assert from "node:assert/strict";
import test from "node:test";
import {
  STORE, bootMint, cashu, copiesOfOneCard, handOver, openWallet, supplier,
} from "./helpers/wallet-fixture.mjs";

const answerTrade = (whichTrade, reply) => {
  let trades = 0;
  return (request) => (request.method === "POST" && request.path === "/nutft/trade" && ++trades === whichTrade
    ? reply()
    : null);
};

async function freshRestore(mint, wallet) {
  const fresh = await openWallet(mint);
  return fresh.wallet.restoreSeed(mint.url, await wallet.wallet.recoveryPhrase());
}

test("a2: a 3-card import whose second move meets a 429 is finished by the next refresh", async (t) => {
  const mint = await bootMint(t);
  const from = await supplier(mint);
  const bob = await openWallet(mint, {
    intercept: answerTrade(2, () => Response.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "3" } })),
  });
  const pubkey = await bob.wallet.destination();
  const proofs = [];
  for (const item of (await from.wallet.snapshotReadOnly(mint.url)).owned.slice(0, 3)) {
    const token = await handOver(from, mint, item.proof, pubkey);
    proofs.push(...cashu.getDecodedToken(token, [item.proof.id]).proofs);
  }
  const unit = (await (await fetch(`${mint.url}/v1/keys`)).json()).keysets[0].unit;

  await assert.rejects(bob.wallet.importToken(mint.url, cashu.getEncodedToken({ mint: mint.url, unit, proofs })),
    (error) => error.imported === 3 && error.transient === true);
  assert.equal((await bob.wallet.snapshotManyReadOnly([mint.url])).unrestorable.length, 2,
    "the pending second card and the untried third are both shown as not yet under the phrase");

  const refreshed = await bob.wallet.snapshotMany([mint.url]);
  assert.equal(refreshed.unrestorable.length, 0, "one refresh moved both");
  assert.equal(bob.saved().pending, null);
  assert.equal(await freshRestore(mint, bob), 3);
});

test("b1: a card whose move is refused once is moved on the next refresh", async (t) => {
  const mint = await bootMint(t);
  const from = await supplier(mint);
  const [first, second] = (await from.wallet.snapshotReadOnly(mint.url)).owned;
  const bob = await openWallet(mint, {
    intercept: answerTrade(2, () => Response.json({ error: "refused for this review" }, { status: 400 })),
  });
  const pubkey = await bob.wallet.destination();
  await bob.wallet.importToken(mint.url, await handOver(from, mint, first.proof, pubkey));

  await assert.rejects(bob.wallet.importToken(mint.url, await handOver(from, mint, second.proof, pubkey)),
    (error) => error.imported === 1 && !error.transient);
  const before = await bob.wallet.snapshotManyReadOnly([mint.url]);
  assert.equal(before.unrestorable.length, 1);
  assert.equal(before.unrestorable[0].proof.secret, bob.saved().unmoved[0].secret);

  assert.equal((await bob.wallet.snapshotMany([mint.url])).unrestorable.length, 0);
  assert.deepEqual(bob.saved().unmoved, []);
  assert.equal(await freshRestore(mint, bob), 2);
});

test("b2: an 'already signed' refusal on a move is retried at once on a fresh slot", async (t) => {
  const mint = await bootMint(t);
  const from = await supplier(mint);
  const [card] = (await from.wallet.snapshotReadOnly(mint.url)).owned;
  const bob = await openWallet(mint, {
    intercept: answerTrade(1, () => Response.json({ error: "output was already signed" }, { status: 400 })),
  });

  assert.equal(await bob.wallet.importToken(mint.url, await handOver(from, mint, card.proof, await bob.wallet.destination())), 1);
  const [refused, moved] = bob.posted("/nutft/trade").map((request) => request.body.outputs[0].B_);
  assert.notEqual(moved, refused, "the second try took the next slot");
  assert.equal((await bob.wallet.snapshotManyReadOnly([mint.url])).unrestorable.length, 0);
  assert.equal(await freshRestore(mint, bob), 1);
});

test("c2: a slot another device takes between the probe and the trade is stepped past", async (t) => {
  const mint = await bootMint(t);
  const from = await supplier(mint, 2);
  const [forLaptop, forPhone] = copiesOfOneCard((await from.wallet.snapshotReadOnly(mint.url)).owned, 2);
  const laptop = await openWallet(mint);
  const pubkey = await laptop.wallet.destination();
  const laptopToken = await handOver(from, mint, forLaptop.proof, pubkey);
  const phoneToken = await handOver(from, mint, forPhone.proof, pubkey);

  let raced = false;
  const phone = await openWallet(mint, {
    storage: new Map([[STORE, laptop.storage.get(STORE)]]),
    intercept: async (request) => {
      if (raced || request.method !== "POST" || request.path !== "/nutft/trade") return null;
      raced = true;
      // The laptop moves its copy into the very slot the phone just probed as free.
      await laptop.wallet.importToken(mint.url, laptopToken);
      return null;
    },
  });

  assert.equal(await phone.wallet.importToken(mint.url, phoneToken), 1);
  assert.equal((await phone.wallet.snapshotManyReadOnly([mint.url])).unrestorable.length, 0);
  assert.equal(await freshRestore(mint, laptop), 2, "both devices' cards are under the phrase");
});
