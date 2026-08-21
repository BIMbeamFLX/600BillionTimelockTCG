import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CheckStateEnum,
  Mint,
  Wallet,
  getEncodedToken,
} from "@cashu/cashu-ts";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const RESTORE_BATCH_SIZE = 100;
export const RESTORE_GAP_LIMIT = 300;
export const STATE_BATCH_SIZE = 200;
export const TOKEN_PROOF_LIMIT = 200;

const RAW_SEED_PATTERN = /^(?:0x)?([0-9a-f]{128})$/i;
const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-f]{64}$/i;
const STORAGE_KEY_PATTERN = /^cashu_wallet_seed(?:_|$)/;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function storageSeedCandidates(value, found = []) {
  if (!value || typeof value !== "object") return found;

  if (
    typeof value.key === "string"
    && STORAGE_KEY_PATTERN.test(value.key)
    && typeof value.value === "string"
  ) {
    found.push(value.value);
  }

  for (const [key, child] of Object.entries(value)) {
    if (STORAGE_KEY_PATTERN.test(key) && typeof child === "string") {
      found.push(child);
    } else if (child && typeof child === "object") {
      storageSeedCandidates(child, found);
    }
  }
  return found;
}

function extractSeedCandidate(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("No seed was provided.");

  if (!text.startsWith("{") && !text.startsWith("[") && !text.startsWith('"')) {
    return text;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The pasted JSON is invalid.");
  }
  if (typeof parsed === "string") return parsed.trim();

  const candidates = [...new Set(storageSeedCandidates(parsed).map((item) => item.trim()))];
  if (candidates.length === 0) {
    throw new Error("The JSON contains no cashu_wallet_seed_<pubkey> value.");
  }
  if (candidates.length > 1) {
    throw new Error("The JSON contains multiple different Plebeian Cashu seeds.");
  }
  return candidates[0];
}

/** Parse a Plebeian raw seed or a standard BIP39 phrase into Cashu's 64-byte seed. */
export function parseSeedInput(input) {
  const candidate = extractSeedCandidate(input);
  const rawSeed = candidate.match(RAW_SEED_PATTERN);
  if (rawSeed) {
    return {
      seed: Uint8Array.from(Buffer.from(rawSeed[1], "hex")),
      source: "plebeian-raw-seed",
    };
  }

  if (PRIVATE_KEY_PATTERN.test(candidate) || /^nsec1/i.test(candidate)) {
    throw new Error(
      "This looks like a 32-byte Nostr/private key, not Plebeian's 64-byte Cashu seed. "
        + "Do not convert it into recovery words.",
    );
  }

  const mnemonic = candidate
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
  if (validateMnemonic(mnemonic, wordlist)) {
    return { seed: mnemonicToSeedSync(mnemonic), source: "bip39-mnemonic" };
  }

  throw new Error(
    "Input must be a 128-character Plebeian Cashu seed, a Plebeian localStorage "
      + "JSON export, or a valid English BIP39 phrase.",
  );
}

/** Validate and canonicalize a mint base URL without changing its path. */
export function normalizeMintUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`Invalid mint URL: ${value}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Mint URL must use HTTP or HTTPS: ${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Mint URL cannot contain credentials, a query, or a fragment: ${value}`);
  }
  return url.toString().replace(/\/$/, "");
}

function sumProofs(proofs) {
  return proofs.reduce((total, proof) => total + proofAmount(proof), 0);
}

function proofAmount(proof) {
  const amount = proof?.amount;
  const value = amount && typeof amount === "object" && "value" in amount
    ? amount.value
    : amount;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("A restored proof has an invalid amount.");
  }
  return number;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function uniqueProofs(proofs) {
  const bySecret = new Map();
  for (const proof of proofs) {
    if (!bySecret.has(proof.secret)) bySecret.set(proof.secret, proof);
  }
  return [...bySecret.values()];
}

async function checkProofStates(wallet, proofs) {
  const checked = [];
  for (const batch of chunks(proofs, STATE_BATCH_SIZE)) {
    const states = await wallet.checkProofsStates(batch);
    if (!Array.isArray(states) || states.length !== batch.length) {
      throw new Error("The mint returned a malformed NUT-07 proof-state response.");
    }
    checked.push(...batch.map((proof, index) => ({ proof, state: states[index].state })));
  }
  return checked;
}

function tokenEntries(mintUrl, unit, proofs, encodeToken) {
  return chunks(proofs, TOKEN_PROOF_LIMIT).map((batch) => ({
    amount: sumProofs(batch),
    proofCount: batch.length,
    token: encodeToken({ mint: mintUrl, unit, proofs: batch }),
  }));
}

/** Restore deterministic proofs from one mint without spending or swapping them. */
export async function recoverMint(seed, mintUrl, dependencies = {}) {
  const createMint = dependencies.createMint ?? ((url) => new Mint(url));
  const createWallet = dependencies.createWallet
    ?? ((mint, options) => new Wallet(mint, options));
  const encodeToken = dependencies.encodeToken ?? getEncodedToken;
  const mint = createMint(mintUrl);
  const response = await mint.getKeySets();
  const keysets = response?.keysets;
  if (!Array.isArray(keysets) || keysets.length === 0) {
    throw new Error("The mint returned no keysets.");
  }

  const wallets = new Map();
  const proofsByUnit = new Map();
  const statsByUnit = new Map();
  const failures = [];

  for (const keyset of keysets) {
    const unit = typeof keyset.unit === "string" && keyset.unit ? keyset.unit : "sat";
    let wallet = wallets.get(unit);
    try {
      if (!wallet) {
        wallet = createWallet(mint, { bip39seed: seed, unit });
        await wallet.loadMint();
        wallets.set(unit, wallet);
      }
      const restored = await wallet.batchRestore(
        RESTORE_GAP_LIMIT,
        RESTORE_BATCH_SIZE,
        0,
        keyset.id,
      );
      const proofs = uniqueProofs(restored?.proofs ?? []);
      const checked = await checkProofStates(wallet, proofs);
      const unitProofs = proofsByUnit.get(unit) ?? [];
      const stats = statsByUnit.get(unit) ?? { spent: 0, pending: 0, pendingAmount: 0 };

      for (const item of checked) {
        if (item.state === CheckStateEnum.UNSPENT) unitProofs.push(item.proof);
        else if (item.state === CheckStateEnum.PENDING) {
          stats.pending += 1;
          stats.pendingAmount += proofAmount(item.proof);
        } else if (item.state === CheckStateEnum.SPENT) stats.spent += 1;
        else throw new Error(`The mint returned an unknown proof state: ${item.state}`);
      }
      proofsByUnit.set(unit, uniqueProofs(unitProofs));
      statsByUnit.set(unit, stats);
    } catch (error) {
      failures.push({
        mint: mintUrl,
        keysetId: String(keyset.id ?? "unknown"),
        unit,
        error: errorMessage(error),
      });
    }
  }

  const recoveries = [];
  for (const [unit, proofs] of proofsByUnit) {
    const stats = statsByUnit.get(unit) ?? { spent: 0, pending: 0, pendingAmount: 0 };
    if (proofs.length === 0 && stats.pending === 0) continue;
    recoveries.push({
      mint: mintUrl,
      unit,
      amount: sumProofs(proofs),
      proofCount: proofs.length,
      pendingAmount: stats.pendingAmount,
      pendingProofCount: stats.pending,
      spentProofCount: stats.spent,
      tokens: tokenEntries(mintUrl, unit, proofs, encodeToken),
    });
  }
  return { recoveries, failures };
}

/** Write the bearer-token report once, refusing to overwrite an existing file. */
export async function writeRecoveryReport(outputPath, report) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return absolutePath;
}

/** Parse CLI options while deliberately refusing secrets on the command line. */
export function parseArguments(argv) {
  const options = { mints: [], output: "", seedFile: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--mint") options.mints.push(argv[++index]);
    else if (argument === "--output") options.output = argv[++index];
    else if (argument === "--seed-file") options.seedFile = argv[++index];
    else if (argument === "--seed") {
      throw new Error("Do not put a seed in command history. Use hidden input or --seed-file.");
    } else throw new Error(`Unknown option: ${argument}`);
  }

  if (options.help) return options;
  if (options.mints.some((mint) => !mint)) throw new Error("--mint needs a URL.");
  if (!options.output) throw new Error("--output is required.");
  if (options.seedFile === undefined) throw new Error("--seed-file needs a path.");
  options.mints = [...new Set(options.mints.map(normalizeMintUrl))];
  if (options.mints.length === 0) throw new Error("At least one --mint URL is required.");
  return options;
}

const HELP = `Recover Plebeian Market Cashu ecash from its raw 64-byte seed.

Usage:
  npm run recover:plebeian -- --mint <url> [--mint <url> ...] --output <file>
  npm run recover:plebeian -- --mint <url> --output <file> --seed-file <file>

The seed is read in a hidden prompt by default. It may be Plebeian's 128-character
cashu_wallet_seed_<pubkey> value, a localStorage JSON export containing that value,
or a valid English BIP39 phrase. The seed is never accepted as a command-line value.

The output JSON contains bearer Cashu tokens. Keep it private and import every token
into cashu.me. Existing output files are never overwritten.`;

async function readHiddenInput() {
  if (!process.stdin.isTTY) {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    return text;
  }

  process.stderr.write("Plebeian Cashu seed (input hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  return new Promise((resolveInput, rejectInput) => {
    let input = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) rejectInput(error);
      else resolveInput(input);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n" || character === "\u001a") {
          return finish();
        }
        if (character === "\u007f" || character === "\b") {
          input = [...input].slice(0, -1).join("");
        } else input += character;
        if (input.length > 1_000_000) return finish(new Error("Seed input is too large."));
      }
      return undefined;
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${errorMessage(error)}\n\n${HELP}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  let parsedSeed;
  try {
    const input = options.seedFile
      ? await readFile(resolve(options.seedFile), "utf8")
      : await readHiddenInput();
    parsedSeed = parseSeedInput(input);
  } catch (error) {
    process.stderr.write(`Error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const recoveries = [];
  const failures = [];
  try {
    for (const mint of options.mints) {
      process.stderr.write(`Checking ${mint}...\n`);
      try {
        const result = await recoverMint(parsedSeed.seed, mint);
        recoveries.push(...result.recoveries);
        failures.push(...result.failures);
      } catch (error) {
        failures.push({ mint, error: errorMessage(error) });
      }
    }
  } finally {
    parsedSeed.seed.fill(0);
  }

  const recoveredByUnit = recoveries.reduce((totals, item) => {
    totals[item.unit] = (totals[item.unit] ?? 0) + item.amount;
    return totals;
  }, {});
  const recoveredProofCount = recoveries.reduce((total, item) => total + item.proofCount, 0);
  const report = {
    format: "plebeian-cashu-recovery-v1",
    createdAt: new Date().toISOString(),
    sourceFormat: parsedSeed.source,
    warning: "Bearer ecash: anyone with a token can spend it. Import every token into cashu.me.",
    recoveredByUnit,
    recoveries,
    failures,
  };

  try {
    const outputPath = await writeRecoveryReport(options.output, report);
    process.stdout.write(`Recovery report written to ${outputPath}\n`);
    for (const [unit, amount] of Object.entries(recoveredByUnit)) {
      process.stdout.write(`Recovered unspent amount: ${amount} ${unit}\n`);
    }
    process.stdout.write("Open the report locally and import every token into cashu.me.\n");
    if (failures.length > 0) {
      process.stderr.write(`Warning: ${failures.length} mint/keyset check(s) failed.\n`);
      process.exitCode = 2;
    } else if (recoveredProofCount === 0) {
      process.stderr.write("No unspent deterministic proofs were found.\n");
      process.exitCode = 3;
    }
  } catch (error) {
    process.stderr.write(`Error: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) await main();
