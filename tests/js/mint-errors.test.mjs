import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadMintErrors() {
  const url = new URL("../../site/mint-errors.js", import.meta.url);
  const source = existsSync(url) ? readFileSync(url, "utf8") : "";
  const context = {};
  vm.runInNewContext(source, context, { filename: "mint-errors.js" });
  return context.E1MintErrors;
}

test("a signed G checkout without NIP-07 says exactly where it stopped", () => {
  const errors = loadMintErrors();
  assert.ok(errors, "the shop needs a purchase-error formatter");

  const result = errors.describe(
    new Error("early access: add or unlock a NIP-07 signer (Alby or nos2x), then press Buy again. Any nostr key works here — there is no allowlist. Checkout stopped before Lightning; no invoice was created."),
    { sales: "signed", product: "starter set" },
  );

  assert.equal(result.code, "SIGNER_REQUIRED");
  assert.match(result.title, /nostr signer needed/i);
  assert.match(result.action, /NIP-07/i);
  assert.match(result.action, /any nostr key/i);
  assert.match(result.action, /no allowlist/i);
  assert.match(result.safety, /no invoice was created/i);
});

test("the checkout failure renders as a visible alert with a diagnostic code", () => {
  const errors = loadMintErrors();
  const makeNode = (tag) => ({
    tag,
    className: "",
    textContent: "",
    children: [],
    attributes: {},
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const note = makeNode("p");
  note.ownerDocument = { createElement: makeNode };

  const result = errors.render(
    note,
    new Error("early access: sign the request with your nostr key to buy a booster"),
    { sales: "signed", product: "starter set" },
  );
  const visibleText = [note.textContent, ...note.children.map((node) => node.textContent)].join(" ");

  assert.equal(result.code, "SIGNER_REQUIRED");
  assert.equal(note.attributes.role, "alert");
  assert.match(note.className, /is-error/);
  assert.match(visibleText, /Nostr signer needed/i);
  assert.match(visibleText, /SIGNER_REQUIRED/);
  assert.match(visibleText, /sign the request/i);
});

test("the G buy button loads and uses the purchase-error renderer", () => {
  const html = readFileSync(new URL("../../site/shop.html", import.meta.url), "utf8");
  const shop = readFileSync(new URL("../../site/shop.js", import.meta.url), "utf8");
  const formatter = html.indexOf('<script src="mint-errors.js"></script>');
  const controller = html.indexOf('<script src="shop.js"></script>');

  assert.ok(formatter >= 0, "shop.html loads the formatter");
  assert.ok(formatter < controller, "the formatter loads before the buy controller");
  assert.match(shop, /E1MintErrors\.render\(note, error/);
  assert.match(shop, /sales:\s*starterMint\?\.info\?\.sales/);
});
