#!/usr/bin/env node
/* Bundle the third-party renderer into one classic script:  node scripts/build-vendor.mjs
 *
 * The site loads plain <script src> tags and the napplet build inlines them, so
 * Three.js (an ES module since r160) is wrapped into an IIFE that exposes
 * `globalThis.THREE`. The output is committed: nothing downstream needs npm.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(path.join(ROOT, "node_modules/three/package.json"), "utf8")).version;
const out = path.join(ROOT, "site/vendor/three.js");

await build({
  stdin: { contents: 'export * from "three";', resolveDir: ROOT, loader: "js" },
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "THREE",
  target: ["es2020"],
  legalComments: "none",
  outfile: out,
  banner: { js: `/* three.js r${version} (MIT) — built by scripts/build-vendor.mjs, do not edit */` },
});
const bytes = readFileSync(out).length;
writeFileSync(path.join(ROOT, "site/vendor/three.version"), `${version}\n`);
console.log(`site/vendor/three.js r${version} ${(bytes / 1024).toFixed(0)} KB`);
