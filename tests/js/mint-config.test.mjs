/* Mint configuration that silently does the wrong thing must stop the boot,
 * and nothing about a configured value may reach a log line or an error.
 *
 * Every fake secret below carries MARKER, and every test that feeds one in
 * asserts that MARKER never comes back out. */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createNutftMint } = require("../../server/nutft-mint.js");
const { createFunding } = require("../../server/funding.js");
const phoenixd = require("../../server/phoenixd.js");
const { createSupplyLedger } = require("../../server/nutft-supply.js");

const { checkEnv, resolveMint } = require("../../server/mint-env.js");
const { createBeacon } = require("../../server/beacon.js");
const { createTable } = require("../../server/table.js");

const MARKER = "zqleakmarker7";
const TABLE_JS = require.resolve("../../server/table.js");
const G_CENSUS = require.resolve("../../cards/g-census.json");

/* A production-shaped environment with fake values: both mints paid through
   phoenixd, E1 in early access, G signed and one per key. */
const PROD = Object.freeze({
  PUBLIC_URL: "wss://tcg.example.com/ws",
  DB: "/srv/tcg-data/matches.db",
  NUTFT_CATALOG_URI: "https://tcg.example.com/nutft/catalog",
  NUTFT_FUNDING: "phoenixd",
  NUTFT_SALES: "allowlist",
  NUTFT_ALLOWLIST: "b".repeat(64),
  PHOENIXD_URL: "http://127.0.0.1:9740",
  PHOENIXD_PASSWORD_PATH: "/srv/tcg-secrets/phoenixd-password",
  G_NUTFT_ENABLED: "1",
  G_NUTFT_DB: "/srv/tcg-data/g-mint.db",
  G_NUTFT_FUNDING: "phoenixd",
  G_NUTFT_CATALOG_URI: "https://tcg.example.com/g/nutft/catalog",
  G_NUTFT_COLLECTION_ID: "600B-G",
  G_NUTFT_CENSUS_PATH: "/srv/tcg600/cards/g-census.json",
  G_NUTFT_SALES: "signed",
  G_NUTFT_ONE_PER_KEY: "1",
  G_NUTFT_PRICE_MSAT: "210000",
});

/* The problems checkEnv reports for PROD with `changes` applied (undefined deletes). */
function problemsWith(changes) {
  const env = { ...PROD, ...changes };
  for (const [key, value] of Object.entries(changes)) if (value === undefined) delete env[key];
  return checkEnv(env);
}

function assertProblem(problems, pattern) {
  assert.ok(problems.some((line) => pattern.test(line)), `expected ${pattern} in:\n${problems.join("\n")}`);
}

/* Everything console.error and console.warn print while `work` runs. */
async function captureLogs(t, work) {
  const lines = [];
  const saved = { error: console.error, warn: console.warn };
  console.error = (...args) => lines.push(args.map(String).join(" "));
  console.warn = (...args) => lines.push(args.map(String).join(" "));
  t.after(() => Object.assign(console, saved));
  try {
    await work();
  } finally {
    Object.assign(console, saved);
  }
  return lines.join("\n");
}

/* Sets process.env for one test; undefined deletes. Restored afterwards. */
function withEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  t.after(() => apply(saved));
}

const thrown = (work) => {
  try {
    work();
  } catch (error) {
    return String(error && error.message);
  }
  return "";
};

/* The referee as systemd starts it: a fresh environment holding only what the
   platform needs to run node, plus the variables under test. */
function bootReferee(t, env) {
  const dir = mkdtempSync(join(tmpdir(), "600b-boot-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const platform = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (process.env[key] !== undefined) platform[key] = process.env[key];
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TABLE_JS], {
      env: { ...platform, PORT: "0", DB: join(dir, "matches.db"), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test("a rejected allowlist entry refuses the start, named by its position, never echoed", async (t) => {
  const listed = "b".repeat(64);
  let message = "";
  const logs = await captureLogs(t, () => {
    message = thrown(() => createNutftMint({
      catalogUri: "https://x/nutft/catalog", lnd: null, sales: "allowlist",
      allowlist: `nsec1${MARKER}, npub1${MARKER}, ${listed}`,
    }));
  });
  assert.match(message, /NUTFT_ALLOWLIST: an nsec \(private key\) was pasted into NUTFT_ALLOWLIST at entry 1; remove it/);
  assert.match(message, /NUTFT_ALLOWLIST: entry 2 is not an npub/);
  assert.ok(!`${message}\n${logs}`.includes(MARKER), "no allowlist entry reaches an error or the log");
});

test("configuration errors name the variable and the rule, never the value", () => {
  const messages = [
    thrown(() => createNutftMint({ catalogUri: "https://x/nutft/catalog", lnd: null, sales: `open${MARKER}` })),
    thrown(() => createNutftMint({ catalogUri: "https://x/nutft/catalog", lnd: null, priceSchedule: `${MARKER}:21000` })),
    thrown(() => createFunding({ backend: `lnd${MARKER}` })),
    thrown(() => createSupplyLedger({
      privateKey: Buffer.alloc(32, 1), canonical: JSON.stringify, read: () => ({}), copies: { a: 1 },
      packs: 1, issuedPerPack: 1, relays: `wss://relay.example, http://relay.example/?token=${MARKER}`,
    })),
    thrown(() => phoenixd.readConfig({ url: `http://${MARKER}.example:9740`, password: `pw${MARKER}` })),
  ];
  assert.match(messages[0], /NUTFT_SALES: must be/);
  assert.match(messages[1], /NUTFT_PRICE_SCHEDULE: entry 1/);
  assert.match(messages[2], /NUTFT_FUNDING: must be/);
  assert.match(messages[3], /NUTFT_SUPPLY_RELAYS: entry 2/);
  assert.match(messages[4], /PHOENIXD_URL: .*in clear over the network/);
  for (const message of messages) assert.ok(message && !message.includes(MARKER), message);
});

test("a phoenixd URL without a password points at the limited-access password", () => {
  const message = thrown(() => phoenixd.readConfig({ url: "http://127.0.0.1:9740" }));
  assert.match(message, /http-password-limited-access/);
  assert.doesNotMatch(message, /the http-password line/, "never the full-access password");
});

test("an LND_REST_URL that no mint reads demands no macaroon", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createMockFunding } = require("../../server/funding.js");
  withEnv(t, { LND_REST_URL: "https://node.example:8080", LND_MACAROON: undefined, LND_MACAROON_PATH: undefined });
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const free = createNutftMint({ catalogUri: "https://x/nutft/catalog", lnd: null });
  const paid = createNutftMint({
    db, catalogUri: "https://x/nutft/catalog", funding: createMockFunding({}), allowVirtual: "1", sales: "open",
  });
  t.after(() => { free.stop(); paid.stop(); });
  assert.equal(free.sealed, false);
  assert.equal(paid.funding.name, "mock", "neither the free nor the mock mint touched the lnd settings");
});

test("a mint told to fund through lnd without LND_REST_URL refuses instead of going free", (t) => {
  withEnv(t, { LND_REST_URL: undefined });
  assert.throws(() => createFunding({ backend: "lnd" }), /LND_REST_URL/);
});

test("a production-shaped environment and a bare local one both pass", () => {
  assert.deepEqual(checkEnv(PROD), []);
  assert.deepEqual(checkEnv({ PORT: "8777", DB: "/tmp/matches.db" }), [], "npm run local sets only PORT and DB");
});

test("Edition G states its own identity: nothing permanent falls back to E1", async () => {
  const problems = problemsWith({ G_NUTFT_CATALOG_URI: undefined, G_NUTFT_COLLECTION_ID: "", G_NUTFT_CENSUS_PATH: undefined });
  assertProblem(problems, /^G_NUTFT_CATALOG_URI: required when G_NUTFT_ENABLED is on/);
  assertProblem(problems, /^G_NUTFT_COLLECTION_ID: required when G_NUTFT_ENABLED is on/);
  assertProblem(problems, /^G_NUTFT_CENSUS_PATH: required when G_NUTFT_ENABLED is on/);
  assertProblem(problemsWith({ G_NUTFT_DB: undefined }), /^G_NUTFT_DB: required/);
  assertProblem(problemsWith({ G_NUTFT_DB: PROD.DB }), /^G_NUTFT_DB: names the same file as DB/);

  /* The library path refuses too: a G table without a catalog URI no longer
     takes NUTFT_CATALOG_URI or the localhost default. */
  const { createMockFunding } = require("../../server/funding.js");
  await assert.rejects(() => createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: "http://127.0.0.1/nutft/catalog",
    gNutftEnabled: true, gNutftDbPath: ":memory:", gNutftCollectionId: "600B-G", gNutftCensusPath: G_CENSUS,
    gNutftFunding: createMockFunding({}), gNutftAllowVirtual: "1", gNutftSales: "signed",
  }), /G_NUTFT_CATALOG_URI: required/);
});

test("Edition G keeps its own mirrors, windows and price; only the site origin is shared", () => {
  const env = {
    ...PROD, NUTFT_CATALOG_MIRRORS: "https://blossom.example", NUTFT_PRICE_MSAT: "5000",
    NUTFT_PRICE_SCHEDULE: "10:1000", NUTFT_PUBLIC_BASE: "https://tcg.example.com",
  };
  delete env.G_NUTFT_PRICE_MSAT;
  const { settings, problems } = resolveMint({}, env, "G");
  assert.deepEqual(problems, []);
  assert.deepEqual(settings.catalogMirrors, [], "E1's mirrors hold E1's catalog blob, not G's");
  assert.deepEqual(settings.priceTiers, [{ upTo: Infinity, msat: 210_000 }], "never E1's price or schedule");
  assert.equal(settings.publicBase, "https://tcg.example.com", "one referee serves one site for both mints");

  const windows = problemsWith({ NUTFT_INVOICE_TTL_SECONDS: "600", NUTFT_CLAIM_GRACE_SECONDS: "7200" });
  assertProblem(windows, /^G_NUTFT_INVOICE_TTL_SECONDS: unset while NUTFT_INVOICE_TTL_SECONDS is set/);
  assertProblem(windows, /^G_NUTFT_CLAIM_GRACE_SECONDS: unset while NUTFT_CLAIM_GRACE_SECONDS is set/);
  assert.deepEqual(problemsWith({
    NUTFT_CLAIM_GRACE_SECONDS: "7200", G_NUTFT_CLAIM_GRACE_SECONDS: "7200",
  }), [], "stating G's own value clears it");

  for (const price of ["0", "abc", "-210000", "2.1e5", " "]) {
    const problems = problemsWith({ G_NUTFT_PRICE_MSAT: price });
    if (price.trim()) assertProblem(problems, /^G_NUTFT_PRICE_MSAT: must be a whole number of millisatoshis, at least 1/);
    else assert.deepEqual(problems, [], "blank means unset: G's own 210 sat");
  }
});

test("a paid mint names its funding and its sales mode; nothing turns E1 paid or open by itself", () => {
  assertProblem(problemsWith({ NUTFT_FUNDING: undefined }), /^NUTFT_FUNDING: unset while PHOENIXD_URL or LND_REST_URL is set/);
  assertProblem(checkEnv({ LND_REST_URL: "https://node.example:8080" }), /^NUTFT_FUNDING: unset while PHOENIXD_URL or LND_REST_URL is set/);
  assertProblem(problemsWith({ NUTFT_FUNDING: "phoenixd ", NUTFT_SALES: "open" }), /^NUTFT_FUNDING: must be lnd, phoenixd, cashu, mock or none/);
  assertProblem(problemsWith({ NUTFT_SALES: undefined }), /^NUTFT_SALES: required for a paid mint/);
  assertProblem(problemsWith({ G_NUTFT_SALES: "" }), /^G_NUTFT_SALES: required for a paid mint/);
  assert.deepEqual(problemsWith({ NUTFT_FUNDING: "none", NUTFT_SALES: undefined, NUTFT_ALLOWLIST: undefined }), [],
    "a free E1 may still default to open");

  const { createMockFunding } = require("../../server/funding.js");
  assert.throws(() => createNutftMint({ catalogUri: "https://x/nutft/catalog", funding: createMockFunding({}), allowVirtual: "1" }),
    /NUTFT_SALES: required for a paid mint/);
});

test("values that used to pass startup and fail later refuse the boot", () => {
  assertProblem(problemsWith({ NUTFT_BEACON_CONFIRMATIONS: "two" }), /^NUTFT_BEACON_CONFIRMATIONS: must be a whole number of blocks, at least 1/);
  assert.throws(() => createBeacon({ confirmations: "two" }), /NUTFT_BEACON_CONFIRMATIONS: must be a whole number/);
  assertProblem(problemsWith({ NUTFT_RECONCILE_MS: "2min" }), /^NUTFT_RECONCILE_MS: must be a number of milliseconds/);
  assertProblem(problemsWith({ NUTFT_PUBLIC_BASE: "tcg.example.com" }), /^NUTFT_PUBLIC_BASE: must be an absolute http:\/\/ or https:\/\/ URL/);
  assertProblem(problemsWith({ G_NUTFT_PUBLIC_BASE: "tcg.example.com/g" }), /^G_NUTFT_PUBLIC_BASE: must be an absolute/);
  assertProblem(problemsWith({ NUTFT_PRICE_MSAT: "21500" }), /^NUTFT_PRICE_MSAT: must be a whole number of sats \(divisible by 1000\)/);
  assertProblem(problemsWith({ G_NUTFT_PRICE_MSAT: "210500" }), /^G_NUTFT_PRICE_MSAT: must be a whole number of sats/);
  assertProblem(problemsWith({ NUTFT_PRICE_SCHEDULE: "2100:21000,5000:42500" }), /^NUTFT_PRICE_SCHEDULE: entry 2 must be a whole number of sats/);
  assertProblem(problemsWith({ G_NUTFT_PRICE_SCHEDULE: "10:210000,5:420000" }), /^G_NUTFT_PRICE_SCHEDULE: thresholds must increase/);
  assert.deepEqual(problemsWith({ NUTFT_FUNDING: "lnd", PHOENIXD_URL: undefined, PHOENIXD_PASSWORD_PATH: undefined,
    G_NUTFT_FUNDING: "lnd", NUTFT_PRICE_MSAT: "21500", LND_REST_URL: "https://node.example:8080",
    LND_MACAROON_PATH: "/srv/tcg-secrets/invoice.macaroon", LND_TLS_CERT_PATH: "/srv/tcg-secrets/tls.cert" }), [],
    "lnd invoices in millisatoshis, so only phoenixd and Cashu need whole sats");
  assertProblem(problemsWith({ NUTFT_CATALOG_MIRRORS: "https://blossom.example,blossom.example" }), /^NUTFT_CATALOG_MIRRORS: entry 2 is not/);
  assertProblem(problemsWith({ NUTFT_SUPPLY_INTERVAL_SECONDS: "30" }), /^NUTFT_SUPPLY_INTERVAL_SECONDS: must be 0 \(no timer\)/);
  assertProblem(problemsWith({ G_NUTFT_COLLECTION_ID: "600B G" }), /^G_NUTFT_COLLECTION_ID: must be 1 to 64 letters/);
});

test("an empty or mistyped flag never switches a protection off", () => {
  const empty = resolveMint({}, { ...PROD, G_NUTFT_ONE_PER_KEY: "" }, "G");
  assert.equal(empty.settings.onePerKey, true, "G_NUTFT_ONE_PER_KEY= is unset, and unset is on");
  assertProblem(problemsWith({ G_NUTFT_ONE_PER_KEY: "", G_NUTFT_SALES: "open" }),
    /^G_NUTFT_ONE_PER_KEY: needs G_NUTFT_SALES=allowlist or signed/);
  for (const variable of ["G_NUTFT_ONE_PER_KEY", "NUTFT_ONE_PER_KEY", "NUTFT_PURCHASE_MODE", "G_NUTFT_PURCHASE_MODE", "G_NUTFT_ENABLED"]) {
    assertProblem(problemsWith({ [variable]: "ture" }), new RegExp(`^${variable}: must be on or off`));
    assertProblem(problemsWith({ [variable]: "1 " }), new RegExp(`^${variable}: must be on or off`));
  }
  assertProblem(problemsWith({ NUTFT_BEACON_SOURCE: "LND" }), /^NUTFT_BEACON_SOURCE: must be lnd, or unset/);
});

test("LND settings are required only from a mint or a beacon that selects lnd", () => {
  const unused = { LND_REST_URL: "https://node.example:8080" };
  assert.deepEqual(problemsWith(unused), [], "phoenixd mints never ask for a macaroon");
  assertProblem(problemsWith({ ...unused, NUTFT_FUNDING: "lnd" }), /^LND_MACAROON_PATH: required with LND_REST_URL/);
  assertProblem(problemsWith({ ...unused, NUTFT_BEACON_SOURCE: "lnd" }), /^LND_MACAROON_PATH: required with LND_REST_URL/);
  assertProblem(problemsWith({ G_NUTFT_FUNDING: "lnd" }), /^LND_REST_URL: required when G_NUTFT_FUNDING=lnd/);
  assertProblem(problemsWith({ ...unused, LND_MACAROON: "not-hex", NUTFT_FUNDING: "lnd" }), /^LND_MACAROON: must be hex/);
});

test("PIN_SEED is announced at boot as testing only, without its value", async (t) => {
  /* G_NUTFT_ENABLED without G_NUTFT_DB refuses before any port is bound. */
  const { code, output } = await bootReferee(t, { PIN_SEED: "424242", G_NUTFT_ENABLED: "1" });
  assert.equal(code, 1);
  assert.match(output, /PIN_SEED is set: .*Testing only, never in production/);
  assert.ok(!output.includes("424242"), "the seed stays out of the journal");
});
