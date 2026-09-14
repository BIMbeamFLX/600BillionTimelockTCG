/* The vendored renderer is a classic script the site and the napplet inline.
 * Run: node --test tests/js/vendor.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = fs.readFileSync(path.join(ROOT, "site/vendor/three.js"), "utf8");

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
