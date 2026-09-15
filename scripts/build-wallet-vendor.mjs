#!/usr/bin/env node
/* Bundle the NutFT wallet's libraries into same-origin ES modules:
 *   node scripts/build-wallet-vendor.mjs
 *
 * site/nutft-wallet.js used to import these from esm.sh at runtime, so a wallet
 * holding bearer cards ran whatever that CDN served on the day. Each library is
 * now built from the exact npm version pinned below into site/vendor/, and the
 * sha256 of every bundle is written to site/vendor/wallet-libs.json, which
 * tests/js/vendor.test.mjs checks. The output is committed: nothing downstream
 * needs npm. The build refuses to run against any other installed version.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUNDLES = [
  { file: "cashu-ts.js", pkg: "@cashu/cashu-ts", version: "4.7.2", code: 'export * from "@cashu/cashu-ts";' },
  { file: "scure-bip39.js", pkg: "@scure/bip39", version: "2.3.0", code: 'export * from "@scure/bip39";' },
  {
    file: "scure-bip39-english.js",
    pkg: "@scure/bip39",
    version: "2.3.0",
    code: 'export { wordlist } from "@scure/bip39/wordlists/english.js";',
  },
  { file: "scure-bip32.js", pkg: "@scure/bip32", version: "2.3.0", code: 'export * from "@scure/bip32";' },
];

const installedVersion = (pkg) =>
  JSON.parse(readFileSync(path.join(ROOT, "node_modules", pkg, "package.json"), "utf8")).version;

const record = {};
for (const { file, pkg, version, code } of BUNDLES) {
  const installed = installedVersion(pkg);
  if (installed !== version) {
    throw new Error(`${pkg} is ${installed} in node_modules; this build is pinned to ${version}`);
  }
  const out = path.join(ROOT, "site/vendor", file);
  await build({
    stdin: { contents: code, resolveDir: ROOT, loader: "js" },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    outfile: out,
    banner: { js: `/* ${pkg} ${version} (MIT) — built by scripts/build-wallet-vendor.mjs, do not edit */` },
  });
  const bytes = readFileSync(out);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  record[file] = { package: pkg, version, sha256 };
  console.log(`site/vendor/${file} ${pkg}@${version} ${(bytes.length / 1024).toFixed(0)} KB ${sha256}`);
}
writeFileSync(path.join(ROOT, "site/vendor/wallet-libs.json"), `${JSON.stringify(record, null, 2)}\n`);
