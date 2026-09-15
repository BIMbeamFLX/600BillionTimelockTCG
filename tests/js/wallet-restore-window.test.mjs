/* Phrase recovery walks counter slots a hundred at a time and stops after a run
   of slots the mint never signed. Consecutive cards lie at most N slots apart
   (N = catalog size), but a slot an older wallet reserved and abandoned can push
   the next card to 2N. The scan must reach across that, and still cost a single
   pack no more than a sliver of the recovery budget. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSETS, PACK, STORE, bootMint, handOver, openWallet, supplier,
} from "./helpers/wallet-fixture.mjs";

/* What a wallet from before refused operations gave their slots back leaves
   behind: the counter pushed a whole turn past a slot that was never signed. */
function abandonTurn(wallet) {
  const saved = wallet.saved();
  const [key] = Object.keys(saved.counters);
  saved.counters[key] += ASSETS;
  wallet.storage.set(STORE, JSON.stringify(saved));
}

/* n copies of one card: the same card lands a turn further on each time. */
function copiesOfOneCard(cards, n) {
  const byAsset = new Map();
  for (const item of cards) byAsset.set(item.tag[2], [...(byAsset.get(item.tag[2]) || []), item]);
  const copies = [...byAsset.values()].find((list) => list.length >= n);
  assert.ok(copies, `no card appears ${n} times`);
  return copies.slice(0, n);
}

async function recover(mint, phrase) {
  const fresh = await openWallet(mint);
  const count = await fresh.wallet.restoreSeed(mint.url, phrase);
  return { count, posted: fresh.requests.filter((request) => request.method === "POST") };
}

test("three cards either side of an abandoned turn all come back", async (t) => {
  const mint = await bootMint(t);
  const from = await supplier(mint, 2);
  const cards = (await from.wallet.snapshotReadOnly(mint.url)).owned;
  const [first, again] = copiesOfOneCard(cards, 2);
  const other = cards.find((item) => item.tag[2] !== first.tag[2]);

  const bob = await openWallet(mint);
  const key = await bob.wallet.destination();
  await bob.wallet.importToken(mint.url, await handOver(from, mint, first.proof, key));
  abandonTurn(bob);
  // The same card again: its next free slot is now 2N past the first one.
  await bob.wallet.importToken(mint.url, await handOver(from, mint, again.proof, key));
  await bob.wallet.importToken(mint.url, await handOver(from, mint, other.proof, key));

  const { count } = await recover(mint, await bob.wallet.recoveryPhrase());
  assert.equal(count, 3);
});

test("cards spread as far apart as the counters allow still all come back", async (t) => {
  const mint = await bootMint(t);
  const from = await supplier(mint, 3);
  const copies = copiesOfOneCard((await from.wallet.snapshotReadOnly(mint.url)).owned, 3);

  const bob = await openWallet(mint);
  const key = await bob.wallet.destination();
  for (const [index, copy] of copies.entries()) {
    if (index) abandonTurn(bob);
    await bob.wallet.importToken(mint.url, await handOver(from, mint, copy.proof, key));
  }

  const { count } = await recover(mint, await bob.wallet.recoveryPhrase());
  assert.equal(count, 3, "each card sat 2N slots past the one before it");
});

test("a single pack still recovers inside the recovery budget", async (t) => {
  const mint = await bootMint(t);
  const buyer = await openWallet(mint);
  await buyer.wallet.buyBooster(mint.url);

  const { count, posted } = await recover(mint, await buyer.wallet.recoveryPhrase());
  assert.equal(count, PACK);
  const restores = posted.filter((request) => request.path === "/v1/restore").length;
  const checks = posted.filter((request) => request.path === "/v1/checkstate").length;
  t.diagnostic(`a ${PACK}-card pack: ${restores} restore + ${checks} checkstate = ${restores + checks}`);
  assert.ok(restores + checks < 240, `${restores + checks} recovery requests fit a 240 budget`);
});
