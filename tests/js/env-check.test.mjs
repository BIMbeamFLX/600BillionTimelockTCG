/* server/env-check.js: the dry run an operator pipes a running service's
 * environment into before a deploy. It must agree with the boot, run without
 * node_modules, and never print a value. Every fake secret here carries
 * MARKER, and every run asserts that MARKER never reaches stdout or stderr. */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { builtinModules } from "node:module";

const require = createRequire(import.meta.url);
const { checkEnv } = require("../../server/mint-env.js");

const MARKER = "zqleakmarker9";
const REPO = join(dirname(require.resolve("../../package.json")));
const ENV_CHECK = join(REPO, "server", "env-check.js");
const TABLE_JS = join(REPO, "server", "table.js");
/* What an operator copies to the box: docs/mint-boot-checks.md step (a). */
const CHECK_FILES = ["server/env-check.js", "server/mint-env.js", "server/lnurl.js"];

const CLEAN = Object.freeze({
  PUBLIC_URL: "wss://tcg.example.com/ws",
  DB: "/srv/tcg-data/matches.db",
  NUTFT_CATALOG_URI: "https://tcg.example.com/nutft/catalog",
  NUTFT_FUNDING: "phoenixd",
  NUTFT_SALES: "allowlist",
  NUTFT_ALLOWLIST: "c".repeat(64),
  PHOENIXD_URL: "http://127.0.0.1:9740",
  PHOENIXD_PASSWORD: `pw-${MARKER}`,
  G_NUTFT_ENABLED: "1",
  G_NUTFT_DB: "/srv/tcg-data/g-mint.db",
  G_NUTFT_FUNDING: "phoenixd",
  G_NUTFT_CATALOG_URI: "https://tcg.example.com/g/nutft/catalog",
  G_NUTFT_COLLECTION_ID: "600B-G",
  G_NUTFT_CENSUS_PATH: "/srv/tcg600/cards/g-census.json",
  G_NUTFT_SALES: "signed",
  G_NUTFT_ONE_PER_KEY: "1",
  PIN_SEED: "7",
  PALACE_NSEC: `nsec1${MARKER}`,
});

/* One broken environment per failure class, each problem it must print. */
const BROKEN = Object.freeze({
  ...CLEAN,
  G_NUTFT_CATALOG_URI: "",
  G_NUTFT_PRICE_MSAT: "0",
  NUTFT_FUNDING: undefined,
  G_NUTFT_SALES: undefined,
  NUTFT_BEACON_CONFIRMATIONS: `${MARKER}`,
  NUTFT_RECONCILE_MS: `${MARKER}ms`,
  NUTFT_PUBLIC_BASE: `${MARKER}.example.com`,
  G_NUTFT_PRICE_SCHEDULE: "10:210500",
  G_NUTFT_ONE_PER_KEY: "",
  NUTFT_PURCHASE_MODE: `yes-${MARKER}`,
  NUTFT_ALLOWLIST: `nsec1${MARKER}, npub1${MARKER}`,
});
const BROKEN_LINES = [
  "NUTFT_PUBLIC_BASE: must be an absolute http:// or https:// URL, with no user, password, query or fragment",
  "NUTFT_FUNDING: unset while PHOENIXD_URL or LND_REST_URL is set: E1 no longer takes its funding from them, so set lnd, phoenixd, cashu, mock or none",
  "NUTFT_ALLOWLIST: an nsec (private key) was pasted into NUTFT_ALLOWLIST at entry 1; remove it",
  "NUTFT_ALLOWLIST: entry 2 is not an npub or a 64-character hex public key",
  "NUTFT_ALLOWLIST: holds no key, so NUTFT_SALES=allowlist would sell to nobody; list the early-access keys or use closed",
  "NUTFT_PURCHASE_MODE: must be on or off: 1, true, yes, on, 0, false, no or off",
  "NUTFT_BEACON_CONFIRMATIONS: must be a whole number of blocks, at least 1",
  "NUTFT_RECONCILE_MS: must be a number of milliseconds",
  "G_NUTFT_CATALOG_URI: required when G_NUTFT_ENABLED is on: it is hashed into every Edition G card for good, and G never uses NUTFT_CATALOG_URI",
  "G_NUTFT_SALES: required for a paid mint: closed, allowlist, signed or open (early access is allowlist)",
  "G_NUTFT_ONE_PER_KEY: needs G_NUTFT_SALES=allowlist or signed: without a signed request there is no key to count",
  "G_NUTFT_PRICE_MSAT: must be a whole number of millisatoshis, at least 1",
  "G_NUTFT_PRICE_SCHEDULE: entry 1 must be a whole number of sats (divisible by 1000): phoenixd and Cashu invoice whole sats",
];

/* Every variable in docs/deploy.md §10 (66 names), each holding MARKER. */
const ALL_VARIABLES = [
  "PORT", "DB", "PUBLIC_URL", "PUBLIC_HOST", "PUBLIC_SCHEME", "TABLE_ORIGINS", "TRUST_PROXY", "TABLE_RULESETS",
  "TCG_WALLET_BACKUP_ALLOWLIST", "PIN_SEED", "RATE_MAX", "CONTROL_RATE_MAX", "MAX_PAYLOAD",
  "NUTFT_CATALOG_URI", "NUTFT_COLLECTION_ID", "NUTFT_CENSUS_PATH", "NUTFT_CATALOG_MIRRORS", "NUTFT_PUBLIC_BASE",
  "NUTFT_SALES", "NUTFT_ALLOWLIST", "NUTFT_ONE_PER_KEY", "NUTFT_PRICE_MSAT", "NUTFT_PRICE_SCHEDULE",
  "NUTFT_PURCHASE_MODE", "NUTFT_INVOICE_TTL_SECONDS", "NUTFT_CLAIM_GRACE_SECONDS", "NUTFT_SUPPLY_RELAYS",
  "NUTFT_SUPPLY_INTERVAL_SECONDS",
  "G_NUTFT_ENABLED", "G_NUTFT_DB", "G_NUTFT_FUNDING", "G_NUTFT_CATALOG_URI", "G_NUTFT_COLLECTION_ID",
  "G_NUTFT_CENSUS_PATH", "G_NUTFT_CATALOG_MIRRORS", "G_NUTFT_PUBLIC_BASE", "G_NUTFT_SALES", "G_NUTFT_ALLOWLIST",
  "G_NUTFT_ONE_PER_KEY", "G_NUTFT_PRICE_MSAT", "G_NUTFT_PRICE_SCHEDULE", "G_NUTFT_PURCHASE_MODE",
  "G_NUTFT_ALLOW_VIRTUAL", "G_NUTFT_INVOICE_TTL_SECONDS", "G_NUTFT_CLAIM_GRACE_SECONDS",
  "NUTFT_FUNDING", "NUTFT_ALLOW_VIRTUAL", "NUTFT_MOCK_SETTLE_MS", "NUTFT_CASHU_MINT", "NUTFT_TEST_MINT",
  "NUTFT_RECONCILE_MS", "LND_REST_URL", "LND_MACAROON", "LND_MACAROON_PATH", "LND_TLS_CERT_PATH", "LND_INSECURE",
  "PHOENIXD_URL", "PHOENIXD_PASSWORD", "PHOENIXD_PASSWORD_PATH", "PHOENIXD_ALLOW_REMOTE",
  "NUTFT_BEACON", "NUTFT_BEACON_SOURCE", "NUTFT_BEACON_CONFIRMATIONS",
  "PALACE_NSEC", "TABLE", "BLOSSOM_SECRET_KEY",
];
const EVERYTHING_MARKED = Object.fromEntries(ALL_VARIABLES.map((name) => [name, `x${MARKER}`]));
/* Overlays that walk each branch that reads a value: every backend, both
   allowlists, both public bases, and G switched on. */
const LEAK_VARIANTS = {
  "every variable": EVERYTHING_MARKED,
  "G enabled": { ...EVERYTHING_MARKED, G_NUTFT_ENABLED: "1" },
  lnd: {
    ...EVERYTHING_MARKED, G_NUTFT_ENABLED: "on", NUTFT_FUNDING: "lnd", G_NUTFT_FUNDING: "lnd", NUTFT_BEACON_SOURCE: "lnd",
    LND_REST_URL: `https://${MARKER}.example:8080`, LND_MACAROON: `zz${MARKER}`, LND_MACAROON_PATH: "", LND_TLS_CERT_PATH: "",
  },
  phoenixd: {
    ...EVERYTHING_MARKED, G_NUTFT_ENABLED: "1", NUTFT_FUNDING: "phoenixd", G_NUTFT_FUNDING: "phoenixd",
    PHOENIXD_URL: `http://${MARKER}.example:9740`, PHOENIXD_PASSWORD: `pw${MARKER}`, PHOENIXD_ALLOW_REMOTE: "",
    NUTFT_PRICE_MSAT: `21${MARKER}`, NUTFT_PRICE_SCHEDULE: `10:21500,${MARKER}`,
  },
  "cashu and mock": {
    ...EVERYTHING_MARKED, G_NUTFT_ENABLED: "1", NUTFT_FUNDING: "cashu", G_NUTFT_FUNDING: "mock",
    NUTFT_CASHU_MINT: `http://${MARKER}.example`,
  },
  "allowlists and public bases": {
    ...EVERYTHING_MARKED, G_NUTFT_ENABLED: "1", NUTFT_SALES: "allowlist", G_NUTFT_SALES: "allowlist",
    NUTFT_ALLOWLIST: `nsec1${MARKER}, npub1${MARKER}, ${MARKER}`, G_NUTFT_ALLOWLIST: `NSEC1${MARKER}`,
    NUTFT_PUBLIC_BASE: `https://operator:${MARKER}@tcg.example.com`, G_NUTFT_PUBLIC_BASE: `https://tcg.example.com/?t=${MARKER}`,
  },
};

const platform = () => {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};
const defined = (env) => Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
const environ = (env) => Buffer.from(Object.entries(defined(env)).map(([name, value]) => `${name}=${value}\0`).join(""));

function node(script, args, { env = {}, input, cwd } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, env: { ...platform(), ...defined(env) }, input: input ?? Buffer.alloc(0), encoding: "utf8", timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assertNoMarker(label, { stdout, stderr }) {
  assert.ok(!`${stdout}\n${stderr}`.includes(MARKER), `${label} printed a value:\n${stdout}${stderr}`);
}

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a clean environment prints ok and exits 0, from stdin, a file and its own environment", (t) => {
  const file = join(tempDir(t, "600b-envcheck-"), "environ");
  writeFileSync(file, environ(CLEAN));
  for (const [label, result] of [
    ["--from -", node(ENV_CHECK, ["--from", "-"], { input: environ(CLEAN) })],
    ["--from file", node(ENV_CHECK, ["--from", file])],
    ["own environment", node(ENV_CHECK, [], { env: CLEAN })],
    ["table.js --check-env", node(TABLE_JS, ["--check-env"], { env: CLEAN })],
  ]) {
    assert.equal(result.stdout, "ok\n", label);
    assert.equal(result.stderr, "", label);
    assert.equal(result.code, 0, label);
    assertNoMarker(label, result);
  }
});

test("a broken environment prints one line per problem, the count, and exits 1", () => {
  const expected = [...BROKEN_LINES, `${BROKEN_LINES.length} problems`].sort();
  const result = node(ENV_CHECK, ["--from", "-"], { input: environ(BROKEN) });
  assert.equal(result.code, 1);
  assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), expected);
  assert.equal(result.stdout.trimEnd().split("\n").at(-1), `${BROKEN_LINES.length} problems`, "the count comes last");
  assert.equal(result.stderr, "");
  assertNoMarker("broken", result);
  assert.equal(node(ENV_CHECK, ["--from", "-"], { input: environ({ ...CLEAN, NUTFT_SALES: "shut" }) }).stdout,
    "NUTFT_SALES: must be closed, allowlist, signed or open\n1 problem\n");
});

test("no value is ever printed, whatever each variable holds and however it is read", (t) => {
  const dir = tempDir(t, "600b-envcheck-leak-");
  for (const [label, env] of Object.entries(LEAK_VARIANTS)) {
    const file = join(dir, "environ");
    writeFileSync(file, environ(env));
    for (const [mode, result] of [
      ["--from -", node(ENV_CHECK, ["--from", "-"], { input: environ(env) })],
      ["--from file", node(ENV_CHECK, ["--from", file])],
      ["own environment", node(ENV_CHECK, [], { env })],
    ]) {
      assert.equal(result.code, 1, `${label} via ${mode} finds problems`);
      assert.match(result.stdout, /^\d+ problems?\n$/m);
      assertNoMarker(`${label} via ${mode}`, result);
    }
  }
});

test("the referee refuses to boot with the same lines, before it opens its database", (t) => {
  const dir = tempDir(t, "600b-envcheck-boot-");
  for (const env of [BROKEN, ...Object.values(LEAK_VARIANTS)]) {
    const db = join(dir, "data", "matches.db");
    const result = node(TABLE_JS, [], { env: { ...env, PORT: "0", DB: db } });
    assert.equal(result.code, 1);
    const refused = result.stderr.split("\n").filter((line) => line.startsWith("[table] refusing to start: "));
    assert.deepEqual(refused.map((line) => line.slice("[table] refusing to start: ".length)),
      checkEnv({ ...defined(env), PORT: "0", DB: db }), "the boot and the dry run print the same problems");
    assert.ok(refused.length > 0);
    assert.ok(!existsSync(join(dir, "data")), "no database file or directory was created");
    assertNoMarker("boot", result);
  }
});

test("unreadable, empty or non-environ input exits 2 without echoing it", (t) => {
  const dir = tempDir(t, "600b-envcheck-bad-");
  const cases = [
    ["a missing file", ["--from", join(dir, "no-such-pid", "environ")], undefined, /^env-check: cannot read .*environ \(ENOENT\)\n$/],
    ["empty stdin", ["--from", "-"], Buffer.alloc(0), /^env-check: the environment input is empty, and an empty environment is never ok\n$/],
    ["a plain environment file", ["--from", "-"], Buffer.from(`NUTFT_SALES=open\nPHOENIXD_PASSWORD=${MARKER}\n`),
      /^env-check: the input is not NUL-separated: pipe \/proc\/<pid>\/environ, not an environment file\n$/],
    ["NULs without variables", ["--from", "-"], Buffer.from(`${MARKER}\0\0`), /^env-check: the input holds no NAME=value entries\n$/],
    ["an unknown flag", ["--form", "-"], Buffer.alloc(0), /^env-check: usage: node env-check\.js/],
  ];
  for (const [label, args, input, pattern] of cases) {
    const result = node(ENV_CHECK, args, { input });
    assert.equal(result.code, 2, label);
    assert.equal(result.stdout, "", `${label}: nothing on stdout, so nothing reads as ok`);
    assert.match(result.stderr, pattern, label);
    assertNoMarker(label, result);
  }
});

test("the check runs from a bare copy of its three files, without node_modules, and writes nothing", (t) => {
  const dir = tempDir(t, "600b-envcheck-copy-");
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  for (const file of CHECK_FILES) {
    const source = readFileSync(join(REPO, file), "utf8");
    for (const [, required] of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      const local = required.startsWith("./") && CHECK_FILES.includes(`server/${required.slice(2)}`);
      assert.ok(builtins.has(required) || local, `${file} requires ${required}, which a bare copy does not have`);
    }
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    copyFileSync(join(REPO, file), join(dir, file));
  }
  const script = join(dir, "server", "env-check.js");
  const clean = node(script, ["--from", "-"], { input: environ(CLEAN), cwd: dir });
  assert.deepEqual(clean, { code: 0, stdout: "ok\n", stderr: "" });
  const broken = node(script, ["--from", "-"], { input: environ(BROKEN), cwd: dir });
  assert.equal(broken.code, 1);
  assert.equal(broken.stdout.trimEnd().split("\n").length, BROKEN_LINES.length + 1);
  assertNoMarker("bare copy", broken);
  assert.deepEqual(readdirSync(dir, { recursive: true }).map(String).sort(),
    ["server", ...CHECK_FILES.map((file) => file.replace("/", process.platform === "win32" ? "\\" : "/"))].sort(),
    "the run left no file behind");
});
