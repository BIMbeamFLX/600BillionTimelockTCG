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
/* What an operator copies to the box: docs/mint-boot-checks.md §1, docs/deploy.md §9.2a. */
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
  "NUTFT_RECONCILE_MS: must be a number of milliseconds, at most 2147483647",
  "G_NUTFT_CATALOG_URI: required when G_NUTFT_ENABLED is on: it is hashed into every Edition G card for good, and G never uses NUTFT_CATALOG_URI",
  "G_NUTFT_SALES: required for a paid mint: closed, allowlist, signed or open (early access is allowlist)",
  "G_NUTFT_ONE_PER_KEY: needs G_NUTFT_SALES=allowlist or signed: without a signed request there is no key to count",
  "G_NUTFT_PRICE_MSAT: must be a whole number of millisatoshis, at least 1",
  "G_NUTFT_PRICE_SCHEDULE: entry 1 must be a whole number of sats (divisible by 1000): phoenixd and Cashu invoice whole sats",
  "G_NUTFT_ONE_PER_KEY: meaning changes (off → on)",
  "NUTFT_PURCHASE_MODE: set, but the running build ignores it",
];

/* E1 funding through a node the release can reach. */
const LND_E1 = Object.freeze({ NUTFT_FUNDING: "lnd", LND_MACAROON: "abcdef", LND_TLS_CERT_PATH: "/srv/tcg-secrets/tls.cert" });
/* Spellings the running build (d753505) reads one way and the release another,
   each with the one row it must print. */
const MEANING_CASES = [
  [{ NUTFT_ONE_PER_KEY: "yes" }, "NUTFT_ONE_PER_KEY: meaning changes (off → on)"],
  [{ NUTFT_ONE_PER_KEY: "On" }, "NUTFT_ONE_PER_KEY: meaning changes (off → on)"],
  [{ NUTFT_ONE_PER_KEY: "TRUE" }, "NUTFT_ONE_PER_KEY: meaning changes (off → on)"],
  [{ G_NUTFT_ONE_PER_KEY: "" }, "G_NUTFT_ONE_PER_KEY: meaning changes (off → on)"],
  [{ G_NUTFT_ONE_PER_KEY: "  " }, "G_NUTFT_ONE_PER_KEY: meaning changes (off → on)"],
  [{ G_NUTFT_PRICE_MSAT: " " }, "G_NUTFT_PRICE_MSAT: meaning changes (21000 msat → 210000 msat)"],
  [{ G_NUTFT_PRICE_MSAT: " ", NUTFT_PRICE_MSAT: "42000" }, "G_NUTFT_PRICE_MSAT: meaning changes (the NUTFT_PRICE_MSAT price → 210000 msat)"],
  [{ G_NUTFT_FUNDING: "cashu", NUTFT_CASHU_MINT: "https://mint.example", NUTFT_RECONCILE_MS: " " },
    "NUTFT_RECONCILE_MS: meaning changes (every 30000 ms → every 120000 ms)"],
  [{ NUTFT_PUBLIC_BASE: " " }, "NUTFT_PUBLIC_BASE: meaning changes (a blank origin → the PUBLIC_URL origin)"],
  [{ G_NUTFT_PUBLIC_BASE: " ", NUTFT_PUBLIC_BASE: "https://tcg.example.com" },
    "G_NUTFT_PUBLIC_BASE: meaning changes (a blank origin → the NUTFT_PUBLIC_BASE origin)"],
  [{ NUTFT_COLLECTION_ID: " " }, "NUTFT_COLLECTION_ID: meaning changes (a blank collection id → 600B-E1)"],
  [{ ...LND_E1, LND_REST_URL: "https://node.example:8080 " },
    "LND_REST_URL: meaning changes (a URL no lnd call reached → the same URL without its surrounding spaces)"],
  [{ ...LND_E1, LND_REST_URL: " https://node.example:8080/ " },
    "LND_REST_URL: meaning changes (a URL no lnd call reached → the same URL without its surrounding spaces)"],
];
/* E1 alone, whose old build took lnd funding from a blank LND_REST_URL. */
const FREE_BY_BLANK_LND = Object.freeze({
  PUBLIC_URL: "wss://tcg.example.com/ws", LND_REST_URL: " ", LND_MACAROON_PATH: `/srv/tcg-secrets/${MARKER}.macaroon`, LND_INSECURE: "1",
});
/* Values both builds read the same way: no row. */
const SAME_MEANING = [
  { NUTFT_ONE_PER_KEY: "1" }, { NUTFT_ONE_PER_KEY: "true" }, { NUTFT_ONE_PER_KEY: "0" }, { NUTFT_ONE_PER_KEY: "no" },
  { NUTFT_ONE_PER_KEY: "OFF" }, { NUTFT_ONE_PER_KEY: "" },
  { G_NUTFT_ONE_PER_KEY: undefined }, { G_NUTFT_ONE_PER_KEY: "on" }, { G_NUTFT_ONE_PER_KEY: "YES" }, { G_NUTFT_ONE_PER_KEY: "0" },
  /* d753505 advertises no mirrors and runs no supply timer: an unset G list or a
     blank interval reads the same in both builds. */
  { NUTFT_CATALOG_MIRRORS: "https://blossom.example" }, { NUTFT_CATALOG_MIRRORS: "https://blossom.example", G_NUTFT_CATALOG_MIRRORS: "" },
  { NUTFT_SUPPLY_INTERVAL_SECONDS: "\t" },
  { G_NUTFT_PRICE_MSAT: "" }, { G_NUTFT_PRICE_MSAT: " 210000 " }, { G_NUTFT_PRICE_MSAT: " ", NUTFT_PRICE_MSAT: "210000" },
  { NUTFT_RECONCILE_MS: " " }, { G_NUTFT_FUNDING: "cashu", NUTFT_CASHU_MINT: "https://mint.example", NUTFT_RECONCILE_MS: "30000" },
  { NUTFT_SUPPLY_INTERVAL_SECONDS: "0" }, { NUTFT_SUPPLY_INTERVAL_SECONDS: "" },
  { NUTFT_PUBLIC_BASE: "" }, { G_NUTFT_PUBLIC_BASE: "" }, { NUTFT_COLLECTION_ID: "" }, { NUTFT_COLLECTION_ID: "600B-E1" },
  { NUTFT_FUNDING: undefined, PHOENIXD_URL: undefined, G_NUTFT_FUNDING: "none", LND_REST_URL: " " },
  /* A leading space or a tab still reached the node, and a mint on phoenixd never read the URL. */
  { ...LND_E1, LND_REST_URL: " https://node.example:8080" }, { ...LND_E1, LND_REST_URL: "\thttps://node.example:8080\t" },
  { LND_REST_URL: "https://node.example:8080 " },
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

test("a value the release would read differently prints its meaning change and exits 1", () => {
  for (const [changes, row] of MEANING_CASES) {
    const result = node(ENV_CHECK, ["--from", "-"], { input: environ({ ...CLEAN, ...changes }) });
    assert.equal(result.stdout, `${row}\n1 problem\n`, JSON.stringify(changes));
    assert.equal(result.code, 1, JSON.stringify(changes));
    assertNoMarker(row, result);
  }
  const funding = node(ENV_CHECK, ["--from", "-"], { input: environ(FREE_BY_BLANK_LND) });
  assert.equal(funding.stdout, "NUTFT_FUNDING: meaning changes (lnd → none)\n1 problem\n");
  assert.equal(funding.code, 1);
  assertNoMarker("blank lnd", funding);

  /* A refusal and a meaning change for the same variable are both shown: the
     row says why a limit the operator thinks is off is refused as on. */
  const both = node(ENV_CHECK, ["--from", "-"], { input: environ({ ...CLEAN, NUTFT_ONE_PER_KEY: "yes", NUTFT_SALES: "open" }) });
  assert.deepEqual(both.stdout.trimEnd().split("\n"), [
    "NUTFT_ONE_PER_KEY: needs NUTFT_SALES=allowlist or signed: without a signed request there is no key to count",
    "NUTFT_ONE_PER_KEY: meaning changes (off → on)",
    "2 problems",
  ]);
});

test("values both builds read the same way print no meaning change", () => {
  const { meaningChanges } = require("../../server/env-check.js");
  for (const changes of SAME_MEANING) {
    assert.deepEqual(meaningChanges(defined({ ...CLEAN, ...changes })), [], JSON.stringify(changes));
  }
  const canonical = {
    ...CLEAN, NUTFT_ONE_PER_KEY: "1", G_NUTFT_ONE_PER_KEY: "0", G_NUTFT_CATALOG_MIRRORS: "",
    NUTFT_SUPPLY_RELAYS: " ", G_NUTFT_PRICE_MSAT: "210000",
  };
  assert.equal(node(ENV_CHECK, ["--from", "-"], { input: environ(canonical) }).stdout, "ok\n");
  assert.deepEqual(meaningChanges({ G_NUTFT_ENABLED: "0", G_NUTFT_ONE_PER_KEY: "" }), [], "a G the old build never opened");
});

test("a variable only the release reads stops the deploy while it is set", () => {
  const cases = [
    [{ NUTFT_CATALOG_MIRRORS: `https://${MARKER}.example` }, "NUTFT_CATALOG_MIRRORS"],
    [{ G_NUTFT_CATALOG_MIRRORS: `https://${MARKER}.example` }, "G_NUTFT_CATALOG_MIRRORS"],
    [{ NUTFT_PURCHASE_MODE: "yes" }, "NUTFT_PURCHASE_MODE"],
    [{ G_NUTFT_PURCHASE_MODE: "1" }, "G_NUTFT_PURCHASE_MODE"],
    [{ NUTFT_PURCHASE_MODE: "0" }, "NUTFT_PURCHASE_MODE"],
    [{ NUTFT_SUPPLY_RELAYS: `wss://${MARKER}.example` }, "NUTFT_SUPPLY_RELAYS"],
    [{ NUTFT_SUPPLY_INTERVAL_SECONDS: "3600" }, "NUTFT_SUPPLY_INTERVAL_SECONDS"],
    [{ TABLE_RULESETS: "E1.0" }, "TABLE_RULESETS"],
  ];
  for (const [changes, variable] of cases) {
    const result = node(ENV_CHECK, ["--from", "-"], { input: environ({ ...CLEAN, ...changes }) });
    assert.equal(result.stdout, `${variable}: set, but the running build ignores it\n1 problem\n`, JSON.stringify(changes));
    assert.equal(result.code, 1);
    assertNoMarker(variable, result);
  }
  const { ignoredByRunningBuild } = require("../../server/env-check.js");
  for (const quiet of [
    { NUTFT_CATALOG_MIRRORS: "" }, { NUTFT_SUPPLY_RELAYS: "  " }, { NUTFT_PURCHASE_MODE: undefined }, { TABLE_RULESETS: "" },
    { G_NUTFT_ENABLED: "0", G_NUTFT_PURCHASE_MODE: "1", G_NUTFT_CATALOG_MIRRORS: "https://blossom.example" },
  ]) {
    assert.deepEqual(ignoredByRunningBuild(defined({ ...CLEAN, ...quiet })), [], JSON.stringify(quiet));
  }
});

test("meaning change rows never carry a value", () => {
  const env = {
    ...CLEAN, PUBLIC_URL: `wss://${MARKER}.example/ws`,
    NUTFT_PRICE_MSAT: "42000", G_NUTFT_CATALOG_URI: `https://${MARKER}.example/g/nutft/catalog`,
    NUTFT_ONE_PER_KEY: "Yes", G_NUTFT_ONE_PER_KEY: "", G_NUTFT_PRICE_MSAT: " ",
    NUTFT_PUBLIC_BASE: " ", G_NUTFT_PUBLIC_BASE: " ", NUTFT_COLLECTION_ID: " ",
  };
  const result = node(ENV_CHECK, ["--from", "-"], { input: environ(env) });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, [
    "NUTFT_ONE_PER_KEY: meaning changes (off → on)",
    "G_NUTFT_ONE_PER_KEY: meaning changes (off → on)",
    "G_NUTFT_PRICE_MSAT: meaning changes (the NUTFT_PRICE_MSAT price → 210000 msat)",
    "NUTFT_PUBLIC_BASE: meaning changes (a blank origin → the PUBLIC_URL origin)",
    "G_NUTFT_PUBLIC_BASE: meaning changes (a blank origin → the PUBLIC_URL origin)",
    "NUTFT_COLLECTION_ID: meaning changes (a blank collection id → 600B-E1)",
    "6 problems",
    "",
  ].join("\n"));
  assertNoMarker("meaning changes", result);
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

test("the doc names exactly those files, points operators at deploy.md, and never runs node as root", () => {
  const doc = readFileSync(join(REPO, "docs", "mint-boot-checks.md"), "utf8").replace(/\r?\n/g, " ");
  const needs = /The check needs three files from the release clone: (.+?)\. /.exec(doc);
  assert.ok(needs, "§1 lists the files the check needs");
  assert.deepEqual([...needs[1].matchAll(/`(server\/[\w.-]+\.js)`/g)].map((match) => match[1]).sort(), [...CHECK_FILES].sort());
  assert.match(doc, /The operator's page is \[docs\/deploy\.md §9\.2a\]\(deploy\.md\)/);
  assert.match(doc, /NeedDaemonReload/, "the process must match its files before the check");
  assert.doesNotMatch(doc, /sudo\s+node/, "only the environ read runs as root");
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
