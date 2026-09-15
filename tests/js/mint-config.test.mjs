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

const MARKER = "zqleakmarker7";
const TABLE_JS = require.resolve("../../server/table.js");

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

test("a rejected allowlist entry is named by its position, never echoed", async (t) => {
  const listed = "b".repeat(64);
  const logs = await captureLogs(t, () => {
    createNutftMint({
      catalogUri: "https://x/nutft/catalog", lnd: null, sales: "allowlist",
      allowlist: `nsec1${MARKER}, npub1${MARKER}, ${listed}`,
    });
  });
  assert.match(logs, /an nsec \(private key\) was pasted into NUTFT_ALLOWLIST at entry 1; remove it/);
  assert.match(logs, /NUTFT_ALLOWLIST entry 2 is not an npub/);
  assert.ok(!logs.includes(MARKER), "no allowlist entry reaches the log");
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
  assert.match(messages[0], /NUTFT_SALES must be/);
  assert.match(messages[1], /NUTFT_PRICE_SCHEDULE entry 1/);
  assert.match(messages[2], /NUTFT_FUNDING must be/);
  assert.match(messages[3], /NUTFT_SUPPLY_RELAYS entry 2/);
  assert.match(messages[4], /PHOENIXD_URL .*in clear over the network/);
  for (const message of messages) assert.ok(message && !message.includes(MARKER), message);
});

test("a phoenixd URL without a password points at the limited-access password", () => {
  const message = thrown(() => phoenixd.readConfig({ url: "http://127.0.0.1:9740" }));
  assert.match(message, /http-password-limited-access/);
  assert.doesNotMatch(message, /the http-password line/, "never the full-access password");
});

test("PIN_SEED is announced at boot as testing only, without its value", async (t) => {
  /* G_NUTFT_ENABLED without G_NUTFT_DB refuses before any port is bound. */
  const { code, output } = await bootReferee(t, { PIN_SEED: "424242", G_NUTFT_ENABLED: "1" });
  assert.equal(code, 1);
  assert.match(output, /PIN_SEED is set: .*Testing only, never in production/);
  assert.ok(!output.includes("424242"), "the seed stays out of the journal");
});
