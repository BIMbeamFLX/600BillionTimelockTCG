#!/usr/bin/env node
/* A Lightning smoke test against the real phoenixd, run ON THE BOX.
 *
 * WHY A SCRIPT AND NOT A UNIT TEST. tests/js/nutft.test.mjs already covers the
 * adapter's judgement -- that it refuses to leak its password, that it will not
 * round a fractional price, that a short payment is not a sale. None of that
 * touches a node. This does the one thing they cannot: prove that THIS node,
 * with THIS password, answers the two calls the mint depends on, and that the
 * amount it reports as received is the amount that was actually sent.
 *
 * IT NEVER PRINTS THE PASSWORD. Not in an error, not in a URL, not on failure.
 *
 * USE THE LIMITED CREDENTIAL:
 *
 *     export PHOENIXD_URL=http://127.0.0.1:9740
 *     export PHOENIXD_PASSWORD="$(grep '^http-password-limited-access=' ~/.phoenix/phoenix.conf | cut -d= -f2-)"
 *     node scripts/phoenixd_smoke.mjs --sats 21
 *
 * `http-password-limited-access` covers createinvoice, payments/incoming and
 * getbalance -- everything here. `http-password` additionally covers payinvoice
 * and closechannel, and this script has no business holding that.
 *
 *   --sats N        invoice amount, default 21
 *   --wait S        how long to watch for the payment, default 180s
 *   --no-invoice    only read the balance and stop (no payment needed)
 */

import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const phoenixd = require("../server/phoenixd.js");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);

const sats = Number(arg("sats", 21));
const waitSeconds = Number(arg("wait", 180));
if (!Number.isInteger(sats) || sats <= 0) {
  console.error("--sats must be a positive whole number of sats");
  process.exit(2);
}

/* The fee-credit cap. With no channel open, an incoming payment is added to the
   fee credit rather than the balance: it cannot be spent or withdrawn, and at
   the cap phoenixd REFUSES incoming payments outright -- the shop stops taking
   money with nothing in our logs to explain it. */
const FEE_CREDIT_CAP = 50_000;

let config;
try {
  config = phoenixd.readConfig({});
} catch (error) {
  console.error(`config: ${error.message}`);
  process.exit(2);
}
if (!config) {
  console.error("PHOENIXD_URL is not set. This script must run on the box, against loopback.");
  process.exit(2);
}

const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);

console.log("\nphoenixd smoke test");
console.log(`  node                   ${config.url}`);

// ------------------------------------------------------------------ 1. balance
let balance;
try {
  balance = await phoenixd.balance(config);
} catch (error) {
  console.error(`\nFAILED at getbalance: ${error.message}`);
  console.error("Either the node is not running, or the password is not the one it wants.");
  process.exit(1);
}
line("balance", `${balance.balanceSat} sat`);
line("fee credit", `${balance.feeCreditSat} sat`);

const headroom = FEE_CREDIT_CAP - balance.feeCreditSat;
if (balance.balanceSat === 0) {
  line("channel", "NONE — incoming payments become fee credit, not balance");
  line("payouts", "IMPOSSIBLE until a channel exists");
  line("headroom", `${headroom} sat before incoming payments are REFUSED`);
  if (headroom <= 0) {
    console.log("\n  The fee-credit cap is reached. This node will refuse incoming payments.");
  }
} else {
  line("channel", "open — payouts are possible");
}

if (has("no-invoice")) {
  console.log("\n--no-invoice: stopping before creating one.\n");
  process.exit(0);
}

// ------------------------------------------------------------------ 2. invoice
//
// externalId must be RECONSTRUCTIBLE: if the mint's database is lost and the
// node is not, this field is the only record of what the sats were for. The
// `acct:` prefix belongs to the agent-api on the same node; ours is `tcg:`.
const orderId = `smoke-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;
const externalId = `tcg:smoke:${orderId}:${randomBytes(6).toString("hex")}`;

let invoice;
try {
  invoice = await phoenixd.createInvoice(config, {
    amountMsat: sats * 1000,
    memo: "600B smoke test",
    externalId,
    expirySeconds: Math.max(waitSeconds + 60, 300),
  });
} catch (error) {
  console.error(`\nFAILED at createinvoice: ${error.message}`);
  process.exit(1);
}

console.log("\n  invoice created");
line("externalId", externalId);
line("paymentHash", invoice.paymentHash);
console.log(`\n${invoice.paymentRequest}\n`);
console.log(`  Pay exactly ${sats} sat. Watching for ${waitSeconds}s...\n`);

// ------------------------------------------------------------------- 3. settle
//
// isSettled compares the RECEIVED amount against what was asked, never isPaid
// alone: BOLT 4 lets a payer send up to twice the invoice, and phoenixd sets
// isPaid without regard to how much actually turned up.
const deadline = Date.now() + waitSeconds * 1000;
let settled = false;
while (Date.now() < deadline) {
  try {
    settled = await phoenixd.isSettled(config, invoice.paymentHash, sats * 1000);
  } catch (error) {
    console.error(`  (transient) ${error.message}`);
  }
  if (settled) break;
  await new Promise((r) => setTimeout(r, 3000));
}

if (!settled) {
  console.log("  NOT SETTLED within the window.");
  console.log("  Not a failure of the code: an unpaid invoice is indistinguishable from an");
  console.log("  unwatched one. Re-run, or check the payment by hand:");
  console.log(`    curl -su :PASSWORD ${config.url}/payments/incoming/${invoice.paymentHash}`);
  process.exit(1);
}

const after = await phoenixd.balance(config);
console.log("  SETTLED — the received amount covers the invoice.\n");
line("balance now", `${after.balanceSat} sat  (was ${balance.balanceSat})`);
line("fee credit now", `${after.feeCreditSat} sat  (was ${balance.feeCreditSat})`);
if (after.balanceSat === balance.balanceSat && after.feeCreditSat > balance.feeCreditSat) {
  console.log("\n  The sats went to FEE CREDIT, not balance: still no channel, still no payouts.");
}
console.log("");
