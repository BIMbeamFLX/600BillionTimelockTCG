/* A card that arrives while a phrase recovery is unfinished. The import must be
   refused whole, before its token is stored, and a recovery must never drop a
   token it did not write, whatever edition that token belongs to.
   (Ported from the PR #73 review, scenario e2.) */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { PACK, STORE, bootMint, openWallet } from "./helpers/wallet-fixture.mjs";

const require = createRequire(import.meta.url);
const { createMockFunding } = require("../../server/funding.js");
const G_CATALOG = "http://127.0.0.1/g/nutft/catalog";

test("a G card offered during an unfinished E1 recovery is refused whole, and a stored one survives the resume",
  async (t) => {
    const mint = await bootMint(t, {
      gNutftEnabled: true, gNutftDbPath: ":memory:",
      gNutftCollectionId: "600B-G",
      gNutftCensusPath: require.resolve("../../cards/g-census.json"),
      gNutftCatalogUri: G_CATALOG,
      gNutftFunding: createMockFunding({ settleAfterMs: 0 }), gNutftAllowVirtual: "1",
      gNutftSales: "open", gNutftOnePerKey: false,
    });
    const G = `${mint.url}/g`;
    const gCatalog = (request) => (request.path === "/g/nutft/catalog" ? fetch(`${mint.url}/g/nutft/catalog`) : null);

    const buyer = await openWallet(mint);
    await buyer.wallet.buyBooster(mint.url);
    const phrase = await buyer.wallet.recoveryPhrase();

    let cut = true;
    let sent = 0;
    const device = await openWallet(mint, {
      intercept: (request) => gCatalog(request) || (cut && request.method === "POST"
        && /^\/v1\/(restore|checkstate)$/.test(request.path) && ++sent > 4
        ? Response.json({ error: "cut off" }, { status: 400 })
        : null),
    });
    await assert.rejects(device.wallet.restoreSeed(mint.url, phrase), /restore failed \(400\)/);
    const checkpoint = device.storage.get(STORE);

    const gSupplier = await openWallet(mint, { intercept: gCatalog });
    await gSupplier.wallet.buyBooster(G);
    const [gCard] = (await gSupplier.wallet.snapshotReadOnly(G)).owned;
    const gToken = (await gSupplier.wallet.tradeProof(G, gCard.proof.secret, await device.wallet.destination())).token;

    await assert.rejects(device.wallet.importToken(G, gToken), (error) => {
      assert.match(error.message, /finish recovering/);
      assert.equal(error.imported, undefined, "nothing was accepted");
      return true;
    });
    assert.equal(device.storage.get(STORE), checkpoint, "the wallet is byte for byte as the recovery left it");

    /* A token an older build stored in the middle of the recovery. */
    const older = JSON.parse(checkpoint);
    older.tokens.push(gToken);
    device.storage.set(STORE, JSON.stringify(older));

    cut = false;
    assert.equal(await device.wallet.restoreSeed(mint.url, phrase), PACK);
    assert.ok(device.saved().tokens.includes(gToken), "the G token was not the recovery's to drop");
    const held = await device.wallet.snapshotManyReadOnly([mint.url, G]);
    assert.equal(held.owned.filter((item) => item.unit === "600B-G").length, 1);
    assert.equal(held.owned.filter((item) => item.unit === "600B-E1").length, PACK);
  });
