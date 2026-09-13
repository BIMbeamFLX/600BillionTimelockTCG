#!/usr/bin/env node
/* One command to play-test the game locally:  npm run local  [-- --port 8777]
 *
 * Checks that everything a Fast game needs is built, says how to build what is
 * missing, then starts the table on a throwaway database (so a test session never
 * touches server/matches.db) and prints where to go. Stop it with Ctrl+C.
 */
import { existsSync, readdirSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 8777;
const python = process.platform === "win32" ? ".\\.venv\\Scripts\\python.exe" : "./.venv/bin/python";

const count = (dir, suffix) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(suffix)).length : 0);
const checks = [
  {
    name: "Fast card values", ok: existsSync(path.join(ROOT, "site", "play-data-fast.js")),
    fix: `${python} scripts/design_fast_cards.py && ${python} scripts/build_play_data.py --fast`,
  },
  {
    name: "Fast precons", ok: existsSync(path.join(ROOT, "site", "precons-fast.js")),
    fix: `${python} scripts/build_precons.py --fast`,
  },
  {
    name: "Sound samples (9)", ok: count(path.join(ROOT, "site", "fx"), ".wav") >= 9,
    fix: `${python} scripts/build_fx_samples.py`,
  },
  {
    name: "Fast card faces (295, optional)",
    ok: existsSync(path.join(ROOT, "site", "fast-faces.js")) && count(path.join(ROOT, "art", "cards", "fast-web"), ".webp") >= 296,
    fix: `${python} scripts/build_fast_faces.py   (about 5 minutes; without it Fast games show the Classic faces)`,
    optional: true,
  },
  { name: "node_modules", ok: existsSync(path.join(ROOT, "node_modules", "ws")), fix: "npm ci" },
];

console.log("\n600B Timelock TCG — local play-test\n");
let blocked = false;
for (const check of checks) {
  console.log(`  ${check.ok ? "ok " : check.optional ? "-- " : "!! "} ${check.name}`);
  if (!check.ok) {
    console.log(`      build it: ${check.fix}`);
    if (!check.optional) blocked = true;
  }
}
if (blocked) {
  console.log("\nSomething required is missing; build it and run `npm run local` again.\n");
  process.exit(1);
}

const db = path.join(mkdtempSync(path.join(tmpdir(), "600b-local-")), "matches.db");
const base = `http://localhost:${port}`;
console.log(`
  Fast vs the NPC   ${base}/play.html?rules=fast     (tick "NPC opponent", press Start game)
  Classic vs NPC    ${base}/play.html?rules=classic
  Hotseat           same page, leave "NPC opponent" unticked — two players, one screen
  Fast Stacks       ${base}/deck.html?rules=fast
  Sound + motion    ${base}/fx-demo.html             (click once to arm audio)
  Online, 2 tabs    ${base}/matchmaking.html         (needs a NIP-07 signer in the browser)
  Checklist         docs/local-test.md

  table db (throwaway): ${db}
`);

const child = spawn(process.execPath, [path.join(ROOT, "server", "table.js")], {
  cwd: ROOT,
  stdio: "inherit",
  env: Object.assign({}, process.env, { PORT: String(port), DB: db }),
});
child.on("exit", (code) => process.exit(code || 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
