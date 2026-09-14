#!/usr/bin/env node
/* One command to play-test the game locally:  npm run local  [-- --port 8777] [-- --lan [ip]]
 *
 * Checks that everything a Fast game needs is built, says how to build what is
 * missing, then starts the table on a throwaway database (so a test session never
 * touches server/matches.db) and prints where to go. Stop it with Ctrl+C.
 *
 * --lan: for a real phone on the same Wi-Fi. The table already listens on every
 * interface (server/table.js binds 0.0.0.0), but it answers 403 to a Host header
 * it does not trust, and it trusts only localhost unless PUBLIC_HOST names another.
 * So --lan picks this machine's LAN IPv4 (or the one given), passes it as
 * PUBLIC_HOST, and prints the phone URL. Without --lan nothing about the table
 * changes. The URL carries &assets=local: plain http from a LAN IP is not a
 * secure context, crypto.subtle is missing there, and faces.js cannot check a
 * Blossom face by hash -- the repo files load instead (WebGL itself needs no
 * secure context).
 */
import { existsSync, readdirSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/* Rank a LAN address: home and office ranges first, then CGNAT (Tailscale's
 * 100.64/10, reachable from a phone on the tailnet), then anything else. */
function rank(address) {
  const [a, b] = address.split(".").map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 0;
  if (a === 172 && b >= 16 && b <= 31) return 0;
  if (a === 100 && b >= 64 && b <= 127) return 1;
  return 2;
}

/** The machine's non-internal IPv4 addresses, best first; link-local 169.254/16 is left out. */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const entry of list || []) {
      const v4 = entry && (entry.family === "IPv4" || entry.family === 4);
      if (!v4 || entry.internal || !IPV4.test(entry.address) || entry.address.startsWith("169.254.")) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found.sort((x, y) => rank(x.address) - rank(y.address));
}

/** The link a phone opens: Fast rules, the 3D table, the stats chip, the repo's card art. */
export function phoneUrl(address, port) {
  return `http://${address}:${port}/play.html?rules=fast&arena=3d&arenastats=1&assets=local`;
}

/** argv -> { port, lan, lanIp }. `--lan` may be followed by the IPv4 to use. */
export function parseArgs(args, env = {}) {
  const at = args.indexOf("--port");
  const port = (at >= 0 && Number(args[at + 1])) || Number(env.PORT) || 8777;
  const lanAt = args.indexOf("--lan");
  const lan = lanAt >= 0;
  const lanIp = lan && IPV4.test(String(args[lanAt + 1] || "")) ? args[lanAt + 1] : null;
  return { port, lan, lanIp };
}

/** The table's environment: PORT and DB always; PUBLIC_HOST only when a LAN host is chosen. */
export function tableEnv(base, { port, db, publicHost }) {
  const env = Object.assign({}, base, { PORT: String(port), DB: db });
  if (publicHost) env.PUBLIC_HOST = publicHost;
  return env;
}

function main() {
  const { port, lan, lanIp } = parseArgs(process.argv.slice(2), process.env);
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

  let publicHost = null;
  if (lan) {
    const found = lanAddresses();
    publicHost = lanIp || (found[0] && found[0].address) || null;
    if (!publicHost) {
      console.log("  --lan: no LAN IPv4 address found on this machine; is the Wi-Fi up?\n");
    } else {
      console.log("  On your phone (same Wi-Fi; docs/local-test.md, \"On your phone\"):");
      console.log(`    ${phoneUrl(publicHost, port)}`);
      const others = found.filter((entry) => entry.address !== publicHost);
      if (others.length) {
        console.log("  The table trusts that one address. Another interface instead:");
        for (const entry of others) console.log(`    npm run local -- --lan ${entry.address}   (${entry.name})`);
      }
      console.log("  Windows may ask to let Node through the firewall: allow it on private networks.\n");
    }
  }

  const child = spawn(process.execPath, [path.join(ROOT, "server", "table.js")], {
    cwd: ROOT,
    stdio: "inherit",
    env: tableEnv(process.env, { port, db, publicHost }),
  });
  child.on("exit", (code) => process.exit(code || 0));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
