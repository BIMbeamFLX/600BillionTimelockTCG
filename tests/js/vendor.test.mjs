/* The vendored renderer is a classic script the site and the napplet inline.
 * The wallet's libraries are ES modules it imports from this site, never a CDN.
 * Run: node --test tests/js/vendor.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserWallet } from "./helpers/browser-wallet.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = fs.readFileSync(path.join(ROOT, "site/vendor/three.js"), "utf8");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
const WALLET_LIBS = readJson("site/vendor/wallet-libs.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const require = createRequire(import.meta.url);
const { createTable } = require("../../server/table.js");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";
const bootTable = async (t) => {
  const table = await createTable({ port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI });
  t.after(() => table.close());
  return table;
};

test("site/vendor/three.js exposes THREE as a global and names its revision", () => {
  // eslint-disable-next-line no-new-func
  const THREE = new Function(`${SOURCE}; return THREE;`)();
  assert.equal(typeof THREE.WebGLRenderer, "function");
  assert.equal(typeof THREE.Scene, "function");
  const pinned = fs.readFileSync(path.join(ROOT, "site/vendor/three.version"), "utf8").trim();
  assert.equal(`0.${THREE.REVISION}.0`, pinned);
  const declared = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).devDependencies.three;
  assert.equal(declared.replace(/^[\^~]/, ""), pinned);
});

test("the bundle never ends a surrounding script tag", () => {
  assert.equal(SOURCE.includes("</script"), false);
});

test("the wallet's vendored libraries are the pinned builds, byte for byte", () => {
  const declared = readJson("package.json").dependencies;
  assert.deepEqual(Object.keys(WALLET_LIBS).sort(),
    ["cashu-ts.js", "scure-bip32.js", "scure-bip39-english.js", "scure-bip39.js"]);
  for (const [file, pin] of Object.entries(WALLET_LIBS)) {
    const bytes = fs.readFileSync(path.join(ROOT, "site/vendor", file));
    assert.equal(sha256(bytes), pin.sha256, `site/vendor/${file} is the build recorded for it`);
    assert.equal(declared[pin.package].replace(/^[\^~]/, ""), pin.version,
      `site/vendor/${file} is built from the ${pin.package} version package.json declares`);
    assert.ok(bytes.toString("utf8").startsWith(`/* ${pin.package} ${pin.version} (MIT)`));
  }
});

test("the wallet imports its libraries from site/vendor and nothing from another origin", () => {
  const wallet = fs.readFileSync(path.join(ROOT, "site/nutft-wallet.js"), "utf8");
  assert.doesNotMatch(wallet, /esm\.sh/);
  assert.doesNotMatch(wallet, /import\(\s*["'`]https?:/);
  for (const file of Object.keys(WALLET_LIBS)) {
    assert.ok(wallet.includes(`"./vendor/${file}"`), `nutft-wallet.js imports ./vendor/${file}`);
  }
});

test("the referee serves the wallet's libraries as JavaScript, unchanged", async (t) => {
  const table = await bootTable(t);
  for (const [file, pin] of Object.entries(WALLET_LIBS)) {
    const response = await fetch(`${table.url}/vendor/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get("content-type"), /^text\/javascript/,
      `${file}: a module script is refused under any other type`);
    const served = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(served), pin.sha256, `${file} arrives intact`);
  }
});

test("the wallet buys, counts, sends and checks a phrase on the vendored libraries", async (t) => {
  const load = (file) => import(pathToFileURL(path.join(ROOT, "site/vendor", file)).href);
  const [cashu, bip39, english, bip32] = await Promise.all(
    ["cashu-ts.js", "scure-bip39.js", "scure-bip39-english.js", "scure-bip32.js"].map(load),
  );
  assert.equal(english.wordlist.length, 2048);
  /* The same shape nutft-wallet.js assembles from these four imports. */
  const walletCrypto = { ...bip39, wordlist: english.wordlist, HDKey: bip32.HDKey };

  const PACK = require("../../cards/nutft-census.json").mint.cards_per_pack;
  const table = await bootTable(t);
  const fetchImpl = (url, options) =>
    fetch(String(url) === CATALOG_URI ? `${table.url}/nutft/catalog` : url, options);
  const open = (storage) =>
    browserWallet(storage, fetchImpl, { cashu, globals: { __walletCrypto: walletCrypto } });

  const wallet = await open(new Map());
  assert.equal((await wallet.buyBooster(table.url)).cards.length, PACK);
  const owned = (await wallet.snapshot(table.url)).owned;
  assert.equal(owned.length, PACK);
  assert.equal((await wallet.recoveryPhrase()).split(" ").length, 12);

  const recipient = await open(new Map());
  const sent = await wallet.tradeProof(table.url, owned[0].proof.secret, await recipient.destination());
  assert.match(sent.token, /^cashuB/);
  await assert.rejects(recipient.restoreSeed(table.url, "not a phrase"),
    /not a valid 12-word BIP39 phrase/);
});
