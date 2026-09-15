/* One recovery phrase, two devices. Counters live in each browser, so a laptop
   and a phone restored at counter 0 derive the same output for their next copy
   of a card, and the mint signs it only once. The second device must notice and
   take the next free slot, or its card stays where the phrase cannot find it. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  STORE, bootMint, copiesOfOneCard, handOver, openWallet, supplier,
} from "./helpers/wallet-fixture.mjs";

test("two devices on one phrase each take a copy of a card, and a fresh one recovers both",
  async (t) => {
    const mint = await bootMint(t);
    const from = await supplier(mint, 2);
    const [forLaptop, forPhone] = copiesOfOneCard((await from.wallet.snapshotReadOnly(mint.url)).owned, 2);

    const laptop = await openWallet(mint);
    const pubkey = await laptop.wallet.destination();
    const phrase = await laptop.wallet.recoveryPhrase();
    // The phone holds the same phrase and has not received anything yet either.
    const phone = await openWallet(mint, { storage: new Map([[STORE, laptop.storage.get(STORE)]]) });

    await laptop.wallet.importToken(mint.url, await handOver(from, mint, forLaptop.proof, pubkey));
    await phone.wallet.importToken(mint.url, await handOver(from, mint, forPhone.proof, pubkey));

    const [onLaptop] = laptop.posted("/nutft/trade");
    const [onPhone] = phone.posted("/nutft/trade");
    assert.notEqual(onPhone.body.outputs[0].B_, onLaptop.body.outputs[0].B_,
      "the phone stepped past the slot the laptop had filled");
    assert.equal((await phone.wallet.snapshotReadOnly(mint.url)).owned.length, 1);

    const fresh = await openWallet(mint);
    assert.equal(await fresh.wallet.restoreSeed(mint.url, phrase), 2);
  });
