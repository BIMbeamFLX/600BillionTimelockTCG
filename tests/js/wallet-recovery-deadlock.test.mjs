/* A purchase during an unfinished phrase recovery. The purchase needs counter
   slots, which only a finished recovery can hand out, so it must be refused
   before a quote, an invoice or a pending claim exists. And a wallet an older
   build left holding a committed purchase in the middle of a recovery must be
   able to get out: the recovery resumes around the waiting claim, and then the
   claim is collected. (Ported from the PR #73 review, scenario e3.) */

import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { PACK, STORE, bootMint, openWallet } from "./helpers/wallet-fixture.mjs";

const recoveryRequest = (request) => request.method === "POST"
  && /^\/v1\/(restore|checkstate)$/.test(request.path);

/* A purchase-mode mint, a buyer holding one pack, and a second device whose
   recovery of the buyer's phrase was cut off after four requests. */
async function cutRecovery(t) {
  const mint = await bootMint(t, { nutftPurchaseMode: true });
  const buyer = await openWallet(mint);
  await buyer.wallet.buyBooster(mint.url);
  const phrase = await buyer.wallet.recoveryPhrase();

  let cut = true;
  let sent = 0;
  const device = await openWallet(mint, {
    intercept: (request) => (cut && recoveryRequest(request) && ++sent > 4
      ? Response.json({ error: "cut off" }, { status: 400 })
      : null),
  });
  await assert.rejects(device.wallet.restoreSeed(mint.url, phrase), /restore failed \(400\)/);
  assert.ok(device.saved().restoring, "the recovery is unfinished");
  cut = false;
  const sold = async () => (await (await fetch(`${mint.url}/nutft/state`)).json()).sold;
  return { mint, phrase, device, sold };
}

test("a purchase is refused before any quote or claim exists while a recovery is unfinished",
  async (t) => {
    const { mint, device, sold } = await cutRecovery(t);
    const requestsBefore = device.requests.length;

    await assert.rejects(device.wallet.buyBooster(mint.url), /finish recovering/);

    assert.equal(device.saved().pending, null, "no claim was left behind");
    assert.deepEqual(device.requests.slice(requestsBefore).filter((request) => request.path === "/nutft/quote"),
      [], "not even a quote was asked for");
    assert.equal(await sold(), 1, "and the mint committed nothing");
  });

test("a wallet left with a committed purchase in an unfinished recovery resumes, then collects it",
  async (t) => {
    const { mint, phrase, device, sold } = await cutRecovery(t);

    /* What the build under review left behind: the purchase committed at the
       mint, and a claim waiting for its receipt stored beside the checkpoint. */
    const quote = await (await fetch(`${mint.url}/nutft/quote`)).json();
    const purchaseId = randomBytes(32).toString("hex");
    const committed = await fetch(`${mint.url}/nutft/purchase`, {
      method: "POST",
      body: JSON.stringify({ purchase_id: purchaseId, pack_id: quote.pack_id, state: quote.state }),
    });
    assert.equal((await committed.json()).status, "purchased");
    const stuck = device.saved();
    stuck.pending = {
      type: "booster", mintUrl: mint.url, outputs: [],
      body: { idempotency_key: purchaseId, purchase_id: purchaseId, pack_id: quote.pack_id, state: quote.state, outputs: [] },
    };
    device.storage.set(STORE, JSON.stringify(stuck));
    await assert.rejects(device.wallet.recoverPending(), /finish recovering/,
      "the claim cannot take slots while the recovery is unfinished");

    assert.equal(await device.wallet.restoreSeed(mint.url, phrase), PACK,
      "the recovery resumes around the waiting claim");
    assert.equal(device.saved().pending.body.purchase_id, purchaseId, "which it left untouched");

    const collected = await device.wallet.recoverPending();
    assert.equal(collected.cards.length, PACK, "then the committed purchase is collected");
    assert.equal(device.saved().pending, null);
    assert.equal(await sold(), 2, "without drawing another pack");

    const fresh = await openWallet(mint);
    assert.equal(await fresh.wallet.restoreSeed(mint.url, phrase), 2 * PACK,
      "and both packs are under the phrase");
    assert.equal((await device.wallet.buyBooster(mint.url)).cards.length, PACK, "the wallet buys again");
  });
