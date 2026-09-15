#!/usr/bin/env node
"use strict";

/* The mint boot check, without the boot.
 *
 *   node server/env-check.js                  this process's environment
 *   node server/env-check.js --from <file>    a NUL-separated environ file
 *   sudo cat /proc/$PID/environ | node server/env-check.js --from -
 *
 * It applies server/mint-env.js, the rules the referee applies before it opens
 * anything, and prints one line per problem, "VARIABLE: reason", then "ok" or
 * "N problems". A problem is a refusal, a value this release would start with
 * but read differently from the build it replaces ("meaning changes"), or a
 * variable only this release reads ("set, but the running build ignores it").
 * Exit 0 when clean, 1 with problems, 2 when the environment cannot be read.
 * It never prints a value, writes nothing to disk, binds no port, opens no
 * database and contacts no funding backend.
 *
 * Node built-ins only, besides mint-env.js and the lnurl.js it needs: it runs
 * from a bare copy of those three files (docs/mint-boot-checks.md). */

const fs = require("node:fs");
const tty = require("node:tty");
const { checkEnv, flag } = require("./mint-env.js");

const USAGE = "usage: node env-check.js [--from <environ file> | --from -]";

/* ---- Spellings whose meaning changes with this release --------------------
 *
 * THIS TABLE AND THE NEXT describe d753505, the build running on 2026-09-15.
 * Rebuild both against the running build before every release.
 *
 * Production runs d753505, and the line numbers below are that build's. It
 * accepts some values that this release also accepts but reads differently. A
 * value the release refuses is already a problem line; these would start
 * without a word and move a limit, a price, a timer, an origin, an identity or
 * the funding. Each row models how d753505 read one variable, without
 * importing any of it, and returns [old, new] in fixed words, never the value,
 * or null when the meaning stays or d753505 could not have started with the
 * value. The boot never uses this table. */

/* Set, blank, and nothing else: whitespace the old Number() read as 0 and the
   old `||` kept as a value, while the release reads it as unset. */
const blankOnly = (raw) => typeof raw === "string" && raw !== "" && raw.trim() === "";
/* `process.env.X || fallback`: only an unset or empty value falls back. */
const oldSet = (raw) => raw !== undefined && raw !== "";
/* table.js:2155, `enabled()`. */
const oldEnabled = (raw) => ["1", "true", "yes", "on"].includes(String(raw || "").toLowerCase());
/* funding.js:93, `String(options.backend || process.env.NUTFT_FUNDING || "").toLowerCase()`. */
const oldBackend = (raw) => String(raw || "").toLowerCase();
const onOff = (on) => (on ? "on" : "off");

/* The release's reading of a flag through the boot's own parser, or null where
   it refuses the spelling: that is a problem line already. */
function newFlag(raw, fallback) {
  let refused = false;
  const value = flag(() => { refused = true; }, "", raw, fallback);
  return refused ? null : value;
}

const MEANING_CHANGES = [
  ["NUTFT_ONE_PER_KEY", (env) => {
    /* nutft-mint.js:323-324: only "1" and "true", exactly, were on. */
    const before = env.NUTFT_ONE_PER_KEY === "1" || env.NUTFT_ONE_PER_KEY === "true";
    const after = newFlag(env.NUTFT_ONE_PER_KEY, false);
    return after === null || after === before ? null : [onOff(before), onOff(after)];
  }],
  ["G_NUTFT_ONE_PER_KEY", (env, g) => {
    /* table.js:2177-2179 into :376: unset was on, and a set value went through
       enabled(), so an empty or blank one was off. */
    if (!g.enabled) return null;
    const before = env.G_NUTFT_ONE_PER_KEY === undefined || oldEnabled(env.G_NUTFT_ONE_PER_KEY);
    const after = newFlag(env.G_NUTFT_ONE_PER_KEY, true);
    return after === null || after === before ? null : [onOff(before), onOff(after)];
  }],
  ["G_NUTFT_PRICE_MSAT", (env, g) => {
    /* table.js:2181-2183 and :377-378 into nutft-mint.js:261-266: a set value
       went through Number(), which reads a blank one as 0, and 0 fell back to
       NUTFT_PRICE_MSAT, then 21000. Only a paid G with a flat price used it
       (nutft-mint.js:347 refused a price not above 0). */
    if (!g.enabled || !g.paid || oldSet(env.G_NUTFT_PRICE_SCHEDULE) || !blankOnly(env.G_NUTFT_PRICE_MSAT)) return null;
    const before = Number(oldSet(env.NUTFT_PRICE_MSAT) ? env.NUTFT_PRICE_MSAT : 21_000);
    if (!(before > 0) || before === 210_000) return null;
    return [oldSet(env.NUTFT_PRICE_MSAT) ? "the NUTFT_PRICE_MSAT price" : "21000 msat", "210000 msat"];
  }],
  ["NUTFT_RECONCILE_MS", (env, g) => {
    /* nutft-mint.js:371-372: Math.max(30000, Number(value || 120000)), read
       only for a funding source that sweeps (Cashu); a blank value made 30000. */
    const cashu = oldBackend(env.NUTFT_FUNDING) === "cashu" || (g.enabled && oldBackend(env.G_NUTFT_FUNDING) === "cashu");
    return cashu && blankOnly(env.NUTFT_RECONCILE_MS) ? ["every 30000 ms", "every 120000 ms"] : null;
  }],
  ["NUTFT_PUBLIC_BASE", (env) => {
    /* nutft-mint.js:391-392: `options.publicBase || process.env.NUTFT_PUBLIC_BASE
       || … PUBLIC_URL`, so a blank value was the origin itself, and every
       request that checks a signature or builds a link on it failed. */
    return blankOnly(env.NUTFT_PUBLIC_BASE) ? ["a blank origin", originOf(env, [])] : null;
  }],
  ["G_NUTFT_PUBLIC_BASE", (env, g) => {
    /* table.js:2184 and :379 into nutft-mint.js:391: the same, for G. */
    return g.enabled && blankOnly(env.G_NUTFT_PUBLIC_BASE)
      ? ["a blank origin", originOf(env, ["NUTFT_PUBLIC_BASE"])] : null;
  }],
  ["NUTFT_COLLECTION_ID", (env) => {
    /* nutft-mint.js:80: `options.collectionId || process.env.NUTFT_COLLECTION_ID
       || "600B-E1"`: a blank value was the collection id of every E1 card. */
    return blankOnly(env.NUTFT_COLLECTION_ID) ? ["a blank collection id", "600B-E1"] : null;
  }],
  ["NUTFT_FUNDING", (env) => {
    /* funding.js:89-111: with NUTFT_FUNDING empty, a non-empty PHOENIXD_URL
       chose phoenixd (:95), else a non-empty LND_REST_URL chose lnd (:106), and
       lnd.js:29-49 took even a blank URL given a hex macaroon and a certificate
       path or LND_INSECURE=1. The release reads that URL as unset: E1 is free. */
    if (oldSet(env.NUTFT_FUNDING) || oldSet(env.PHOENIXD_URL) || !blankOnly(env.LND_REST_URL)) return null;
    const macaroon = oldSet(env.LND_MACAROON) ? /^[0-9a-f]+$/i.test(env.LND_MACAROON) : oldSet(env.LND_MACAROON_PATH);
    return macaroon && (oldSet(env.LND_TLS_CERT_PATH) || env.LND_INSECURE === "1") ? ["lnd", "none"] : null;
  }],
  ["LND_REST_URL", (env, g) => {
    /* lnd.js:30 and :49 kept the URL as written, and every request was
       new URL(url + path) (lnd.js:58, beacon.js:41): a trailing space made that
       throw or went into the path, so no call reached the node and nothing
       sold. The release trims it and sells. Read only by a mint funding through
       lnd, chosen (funding.js:106) or auto-detected, or by the beacon
       (nutft-mint.js:418). A blank URL is the NUTFT_FUNDING row. */
    const raw = env.LND_REST_URL;
    if (!oldSet(raw) || blankOnly(raw) || raw === raw.trim()) return null;
    const e1 = oldBackend(env.NUTFT_FUNDING);
    const usesLnd = e1 === "lnd" || (!e1 && !oldSet(env.PHOENIXD_URL))
      || (g.enabled && oldBackend(env.G_NUTFT_FUNDING) === "lnd") || env.NUTFT_BEACON_SOURCE === "lnd";
    const request = (base) => { try { return new URL(`${base}/v1/invoices`).href; } catch { return null; } };
    return usesLnd && request(raw.replace(/\/$/, "")) !== request(raw.trim().replace(/\/$/, ""))
      ? ["a URL no lnd call reached", "the same URL without its surrounding spaces"] : null;
  }],
];

/* ---- Variables the running build never reads -------------------------------
 *
 * Describes d753505, the build running on 2026-09-15; rebuild it against the
 * running build before every release.
 *
 * d753505 has no catalog mirrors, no committed purchases, no supply ledger and
 * no ruleset choice for tables: its server/ has no nutft-supply.js, and neither
 * its nutft-mint.js nor its table.js reads any of these names. Set on the box, they do
 * nothing today and act the moment the release starts, so each one set to more
 * than blanks stops the deploy until someone decides. The second field says
 * whether the variable belongs to Edition G, which counts only while G is on. */
const IGNORED_BY_RUNNING_BUILD = [
  ["NUTFT_CATALOG_MIRRORS", false],
  ["G_NUTFT_CATALOG_MIRRORS", true],
  ["NUTFT_PURCHASE_MODE", false],
  ["G_NUTFT_PURCHASE_MODE", true],
  ["NUTFT_SUPPLY_RELAYS", false],
  ["NUTFT_SUPPLY_INTERVAL_SECONDS", false],
  ["TABLE_RULESETS", false],
];

/** One "VARIABLE: set, but the running build ignores it" line per such variable that is set. */
function ignoredByRunningBuild(env) {
  const gEnabled = oldEnabled(env.G_NUTFT_ENABLED);
  return IGNORED_BY_RUNNING_BUILD
    .filter(([variable, edition]) => (!edition || gEnabled) && oldSet(env[variable]) && !blankOnly(env[variable]))
    .map(([variable]) => `${variable}: set, but the running build ignores it`);
}

/* Where the release takes a mint's origin from once a blank value counts as unset. */
function originOf(env, fallbacks) {
  const source = [...fallbacks, "PUBLIC_URL"].find((name) => env[name] !== undefined && String(env[name]).trim() !== "");
  return source ? `the ${source} origin` : "no origin";
}

/** One "VARIABLE: meaning changes (old → new)" line per variable the release would read differently. */
function meaningChanges(env) {
  /* table.js:2169 and funding.js:89-111: which mints d753505 opened, and
     whether G took money (lnd without LND_REST_URL gave G away for free). */
  const gBackend = oldBackend(env.G_NUTFT_FUNDING);
  const g = {
    enabled: oldEnabled(env.G_NUTFT_ENABLED),
    paid: ["mock", "phoenixd", "cashu"].includes(gBackend) || (gBackend === "lnd" && oldSet(env.LND_REST_URL)),
  };
  return MEANING_CHANGES.flatMap(([variable, change]) => {
    const meanings = change(env, g);
    return meanings ? [`${variable}: meaning changes (${meanings[0]} → ${meanings[1]})`] : [];
  });
}

/* /proc/<pid>/environ holds NAME=value entries, each ended by a NUL byte. Only
   names and positions ever leave this function in a message. */
function parseEnviron(bytes) {
  if (!bytes.length) return { error: "the environment input is empty, and an empty environment is never ok" };
  if (!bytes.includes(0)) {
    return { error: "the input is not NUL-separated: pipe /proc/<pid>/environ, not an environment file" };
  }
  const env = Object.create(null);
  for (const entry of bytes.toString("utf8").split("\0")) {
    const at = entry.indexOf("=");
    /* The first definition wins, as getenv() reads it. */
    if (at > 0 && !(entry.slice(0, at) in env)) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  if (!Object.keys(env).length) return { error: "the input holds no NAME=value entries" };
  return { env };
}

/** Runs the check for `args`; returns the exit code. `io` replaces the process streams in tests. */
function run(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const fail = (message) => {
    stderr.write(`env-check: ${message}\n`);
    return 2;
  };
  let env = io.env || process.env;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--from") return fail(USAGE);
    const fromStdin = args[1] === "-";
    /* A forgotten pipe would otherwise wait for typing that never comes. */
    if (fromStdin && tty.isatty(0)) return fail("--from - reads the environment from a pipe, and stdin is a terminal");
    let bytes;
    try {
      bytes = fs.readFileSync(fromStdin ? 0 : args[1]);
    } catch (error) {
      return fail(`cannot read ${fromStdin ? "stdin" : args[1]} (${(error && error.code) || "read error"})`);
    }
    const parsed = parseEnviron(bytes);
    if (parsed.error) return fail(parsed.error);
    env = parsed.env;
  }
  /* A meaning change, or a variable only the release reads, stops a deploy
     exactly like a refusal: the release would start, and a buyer would meet a
     different shop. */
  const problems = [...checkEnv(env), ...meaningChanges(env), ...ignoredByRunningBuild(env)];
  for (const line of problems) stdout.write(`${line}\n`);
  stdout.write(problems.length ? `${problems.length} ${problems.length === 1 ? "problem" : "problems"}\n` : "ok\n");
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));

module.exports = { run, parseEnviron, meaningChanges, ignoredByRunningBuild };
