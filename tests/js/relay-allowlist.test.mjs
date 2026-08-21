import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRelayWalletAllowlist } = require("../../server/relay-wallet-allowlist.js");
const { createTable } = require("../../server/table.js");

test("wallet backup allowlist stores exact buyer pubkeys once", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "600b-relay-allow-"));
  const file = join(dir, "tcg-wallet-buyers");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const alice = "11".repeat(32);
  const bob = "22".repeat(32);
  const allowlist = createRelayWalletAllowlist(file);
  allowlist.authorizeMany([bob, alice, bob]);

  assert.equal(readFileSync(file, "utf8"), `${alice}\n${bob}\n`);
  assert.throws(() => allowlist.authorize("not-a-pubkey"), /64-character lowercase hex/);
  assert.equal(readFileSync(file, "utf8"), `${alice}\n${bob}\n`,
    "an invalid identity cannot damage the previous allowlist");
});

test("referee startup restores previous paid buyers into the relay allowlist", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createMockFunding } = require("../../server/funding.js");
  const dir = mkdtempSync(join(tmpdir(), "600b-relay-backfill-"));
  const gDbPath = join(dir, "g-mint.db");
  const file = join(dir, "relay-allow", "tcg-wallet-buyers");
  const previousBuyer = "33".repeat(32);

  const existing = new DatabaseSync(gDbPath);
  existing.exec(`
    CREATE TABLE nutft_buyers (
      pubkey TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      at TEXT NOT NULL
    );
  `);
  existing.prepare("INSERT INTO nutft_buyers (pubkey, pack_id, at) VALUES (?, ?, ?)")
    .run(previousBuyer, "set-0001", "2026-08-21T00:00:00.000Z");
  existing.close();

  const table = await createTable({
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    nutftCatalogUri: "http://127.0.0.1/nutft/catalog",
    gNutftEnabled: true,
    gNutftDbPath: gDbPath,
    gNutftCatalogUri: "http://127.0.0.1/g/nutft/catalog",
    gNutftFunding: createMockFunding({ settleAfterMs: 0 }),
    gNutftAllowVirtual: "1",
    gNutftSales: "signed",
    gNutftOnePerKey: true,
    walletBackupAllowlistPath: file,
  });
  t.after(async () => {
    await table.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(readFileSync(file, "utf8"), `${previousBuyer}\n`,
    "deploying the feature repairs access for the buyer who already owns set 1");
});
