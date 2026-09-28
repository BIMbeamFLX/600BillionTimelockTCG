/* The shop is an experiment, and a buyer is told so before paying: on the
   shop page, and in every text a wallet shows at pay time. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createNutftMint, EXPERIMENT } = require("../../server/nutft-mint.js");
const { createMockFunding } = require("../../server/funding.js");
const { createCardMint } = require("../../server/card-mint.js");
const { DatabaseSync } = await import("node:sqlite");

const BASE = "https://tcg.test";
const said = (text) => text.includes(EXPERIMENT);

function setup(t) {
  const funding = createMockFunding({ settleAfterMs: 60_000 });
  const memos = [];
  const createInvoice = funding.createInvoice.bind(funding);
  funding.createInvoice = (args) => {
    if (args.memo !== undefined) memos.push(args.memo);
    return createInvoice(args);
  };
  const db = new DatabaseSync(":memory:");
  const nutft = createNutftMint({
    db, catalogUri: `${BASE}/nutft/catalog`, funding, priceMsat: 5000,
    allowVirtual: "1", sales: "open", publicBase: BASE,
  });
  t.after(() => nutft.stop());
  const cardMint = createCardMint({ nutft, db, publicBase: BASE, sweepEveryMs: 0 });
  return { nutft, cardMint, memos };
}

async function get(mint, path) {
  const res = {
    writeHead() { return res; },
    setHeader() {},
    end(body) { res.body = JSON.parse(body); },
  };
  await mint.handle({ method: "GET", headers: {} }, res, new URL(BASE + path));
  return res.body;
}

const text = (metadata) => JSON.parse(metadata).find(([type]) => type === "text/plain")[1];

test("the notice says the funds are not safe", () => {
  assert.match(EXPERIMENT, /experiment/i);
  assert.match(EXPERIMENT, /not safe/);
});

test("a wallet paying for a card pack is told it is an experiment", async (t) => {
  const { cardMint } = setup(t);
  assert.ok(said(text((await get(cardMint, "/cards/lnurlp")).metadata)));
});

test("a wallet paying for a booster over LNURL is told it is an experiment", async (t) => {
  const { nutft } = setup(t);
  assert.ok(said(text((await get(nutft, "/nutft/lnurlp")).metadata)));
});

test("a booster invoice from the shop says it in its description", async (t) => {
  const { nutft, memos } = setup(t);
  await nutft.payableQuote({});
  assert.equal(memos.length, 1);
  assert.ok(said(memos[0]), memos[0]);
  // phoenixd refuses a description over 128 characters
  assert.ok(memos[0].length <= 128, memos[0]);
});

test("the shop page says it wherever it can take a payment, and only there", () => {
  const html = readFileSync(new URL("../../site/shop.html", import.meta.url), "utf8");
  const note = /<p class="note" id="experimentNote"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(note, "the shop page carries the notice");
  assert.match(note[0], /\shidden>/, "hidden without JS, when nothing can be paid");
  assert.match(note[1], /experiment/);
  assert.match(note[1], /not\s+safe/);
  const js = readFileSync(new URL("../../site/shop.js", import.meta.url), "utf8");
  assert.match(js, /experimentNote\.hidden = !\(PAID_LIVE && ONLINE\)/);
});
