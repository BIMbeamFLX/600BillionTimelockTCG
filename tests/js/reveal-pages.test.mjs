import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function pages() {
  const source = await readFile(new URL("../../site/reveal-pages.js", import.meta.url), "utf8");
  const context = {};
  vm.runInNewContext(source, context, { filename: "reveal-pages.js" });
  return context.E1RevealPages;
}

test("a normal 15-card booster stays on one reveal page", async () => {
  const reveal = await pages();
  const ids = Array.from({ length: 15 }, (_, index) => `E1-${index + 1}`);
  const result = reveal.split(ids, ids.map(() => false));
  assert.equal(result.length, 1);
  assert.deepEqual(Array.from(result[0].ids), ids);
});

test("an 82-card starter set becomes eight balanced reveal pages", async () => {
  const reveal = await pages();
  const ids = Array.from({ length: 82 }, (_, index) => `G-${index + 1}`);
  const fresh = ids.map((_, index) => index % 2 === 0);
  const result = reveal.split(ids, fresh);
  assert.equal(result.length, 8);
  assert.deepEqual(Array.from(result, (page) => page.ids.length), [11, 11, 10, 10, 10, 10, 10, 10]);
  assert.deepEqual(Array.from(result.flatMap((page) => page.ids)), ids);
  assert.deepEqual(Array.from(result.flatMap((page) => page.fresh)), fresh);
});

test("the successful G checkout opens the paged reveal controls", async () => {
  const html = await readFile(new URL("../../site/shop.html", import.meta.url), "utf8");
  const shop = await readFile(new URL("../../site/shop.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('<script src="reveal-pages.js"></script>')
    < html.indexOf('<script src="shop.js"></script>'));
  for (const id of ["revealPages", "revealPrev", "revealPageLabel", "revealNext"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(shop, /await revealStarterSet\(issued\)/);
  assert.match(shop, /SET #\$\{pad\(entry\.n, 4\)\} · PAGE/);
});
