import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createBlindSignature,
  createNewMintKeys,
  getDecodedToken,
  pointFromHex,
  verifyUnblindedSignature,
} from "@cashu/cashu-ts";

import {
  normalizeMintUrl,
  parseArguments,
  parseSeedInput,
  recoverMint,
  writeRecoveryReport,
} from "../../scripts/recover-plebeian-cashu.mjs";

const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon "
  + "abandon abandon abandon about";
const BIP39_SEED = "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1"
  + "9a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4";

test("parses the exact 64-byte Plebeian raw seed", () => {
  const parsed = parseSeedInput(BIP39_SEED.toUpperCase());
  assert.equal(parsed.source, "plebeian-raw-seed");
  assert.equal(Buffer.from(parsed.seed).toString("hex"), BIP39_SEED);
});

test("extracts the Plebeian seed from a localStorage JSON export", () => {
  const parsed = parseSeedInput(JSON.stringify([
    { key: "unrelated", value: "ignore" },
    { key: "cashu_wallet_seed_deadbeef", value: BIP39_SEED },
  ]));
  assert.equal(parsed.source, "plebeian-raw-seed");
  assert.equal(Buffer.from(parsed.seed).toString("hex"), BIP39_SEED);
});

test("derives the standard BIP39 seed used by cashu.me", () => {
  const parsed = parseSeedInput(MNEMONIC);
  assert.equal(parsed.source, "bip39-mnemonic");
  assert.equal(Buffer.from(parsed.seed).toString("hex"), BIP39_SEED);
});

test("rejects Nostr keys instead of presenting them as Cashu seeds", () => {
  assert.throws(() => parseSeedInput("11".repeat(32)), /Nostr\/private key/);
  assert.throws(() => parseSeedInput("nsec1notaseed"), /Nostr\/private key/);
});

test("normalizes mint URLs and rejects embedded credentials", () => {
  assert.equal(normalizeMintUrl("https://mint.example/path/"), "https://mint.example/path");
  assert.throws(() => normalizeMintUrl("https://user:pass@mint.example"), /credentials/);
});

test("CLI parsing requires explicit mints and output without accepting a seed", () => {
  const parsed = parseArguments([
    "--mint", "https://mint.example/", "--mint", "https://mint.example",
    "--output", "recovery.json",
  ]);
  assert.deepEqual(parsed.mints, ["https://mint.example"]);
  assert.throws(() => parseArguments(["--seed", "secret"]), /command history/);
  assert.throws(() => parseArguments(["--mint", "https://mint.example"]), /--output/);
});

test("restores only unspent proofs and reports pending and failed keysets", async () => {
  const keysets = [
    { id: "0011223344556677", unit: "sat" },
    { id: "0099aabbccddeeff", unit: "sat" },
  ];
  const proof = (id, suffix, amount) => ({
    id,
    amount,
    secret: suffix.repeat(64).slice(0, 64),
    C: `02${suffix.repeat(64).slice(0, 64)}`,
  });
  const restored = new Map([
    [keysets[0].id, [
      proof(keysets[0].id, "1", 8),
      proof(keysets[0].id, "2", 4),
      proof(keysets[0].id, "3", 2),
    ]],
  ]);
  const states = new Map([
    ["1".repeat(64), "UNSPENT"],
    ["2".repeat(64), "PENDING"],
    ["3".repeat(64), "SPENT"],
  ]);
  let loadCount = 0;
  const wallet = {
    async loadMint() { loadCount += 1; },
    async batchRestore(_gap, _batch, _counter, keysetId) {
      if (keysetId === keysets[1].id) throw new Error("restore unavailable");
      return { proofs: restored.get(keysetId) ?? [] };
    },
    async checkProofsStates(proofs) {
      return proofs.map((item) => ({ state: states.get(item.secret) }));
    },
  };
  const result = await recoverMint(new Uint8Array(64), "https://mint.example", {
    createMint: () => ({ async getKeySets() { return { keysets }; } }),
    createWallet: () => wallet,
  });

  assert.equal(loadCount, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /restore unavailable/);
  assert.equal(result.recoveries.length, 1);
  assert.deepEqual(
    {
      amount: result.recoveries[0].amount,
      proofCount: result.recoveries[0].proofCount,
      pendingAmount: result.recoveries[0].pendingAmount,
      pendingProofCount: result.recoveries[0].pendingProofCount,
      spentProofCount: result.recoveries[0].spentProofCount,
    },
    { amount: 8, proofCount: 1, pendingAmount: 4, pendingProofCount: 1, spentProofCount: 1 },
  );
  const token = result.recoveries[0].tokens[0].token;
  const decoded = getDecodedToken(token, keysets.map((keyset) => keyset.id));
  assert.equal(decoded.mint, "https://mint.example");
  assert.equal(decoded.proofs.length, 1);
  assert.equal(Number(decoded.proofs[0].amount.value), 8);
});

test("restores and verifies a proof through the real cashu-ts recovery path", async () => {
  const keyset = createNewMintKeys(3, new Uint8Array(32).fill(7), { unit: "sat" });
  const publicKeys = Object.fromEntries(
    Object.entries(keyset.pubKeys).map(([amount, key]) => [
      amount,
      Buffer.from(key).toString("hex"),
    ]),
  );
  let restoreCalls = 0;
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const parsed = body.length ? JSON.parse(Buffer.concat(body).toString("utf8")) : {};
    let result;
    if (request.url === "/v1/info") {
      result = { name: "Recovery test mint", version: "test", pubkey: "", contact: [], nuts: {} };
    } else if (request.url === "/v1/keysets") {
      result = {
        keysets: [{
          id: keyset.keysetId,
          unit: "sat",
          active: true,
          input_fee_ppk: 0,
        }],
      };
    } else if (request.url?.startsWith("/v1/keys")) {
      result = { keysets: [{ id: keyset.keysetId, unit: "sat", keys: publicKeys }] };
    } else if (request.url === "/v1/restore") {
      restoreCalls += 1;
      if (restoreCalls === 1) {
        const output = parsed.outputs[0];
        const blind = createBlindSignature(
          pointFromHex(output.B_),
          keyset.privKeys["1"],
          keyset.keysetId,
        );
        result = {
          outputs: [{ ...output, amount: 1 }],
          signatures: [{
            id: keyset.keysetId,
            amount: 1,
            C_: blind.C_.toHex(true),
          }],
        };
      } else result = { outputs: [], signatures: [] };
    } else if (request.url === "/v1/checkstate") {
      result = {
        states: parsed.Ys.map((Y) => ({ Y, state: "UNSPENT", witness: null })),
      };
    } else {
      response.writeHead(404);
      response.end();
      return;
    }
    const encoded = JSON.stringify(result);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(encoded),
    });
    response.end(encoded);
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const mintUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await recoverMint(parseSeedInput(MNEMONIC).seed, mintUrl);
    assert.equal(result.failures.length, 0);
    assert.equal(result.recoveries.length, 1);
    assert.equal(result.recoveries[0].amount, 1);
    assert.equal(restoreCalls, 4, "one signed batch followed by three empty batches");
    const token = result.recoveries[0].tokens[0].token;
    const decoded = getDecodedToken(token, [keyset.keysetId]);
    assert.equal(decoded.proofs.length, 1);
    const restoredProof = decoded.proofs[0];
    assert.equal(
      verifyUnblindedSignature(
        {
          ...restoredProof,
          secret: new TextEncoder().encode(restoredProof.secret),
          C: pointFromHex(restoredProof.C),
        },
        keyset.privKeys["1"],
      ),
      true,
    );
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    }));
  }
});

test("writes a recovery report once and never overwrites it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plebeian-recovery-test-"));
  const output = join(directory, "cashu-recovery-test.json");
  const report = { format: "plebeian-cashu-recovery-v1", recoveries: [] };
  assert.equal(await writeRecoveryReport(output, report), output);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), report);
  await assert.rejects(() => writeRecoveryReport(output, report), /EEXIST/);
});
