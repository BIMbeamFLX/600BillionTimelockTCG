import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const SOURCE = await readFile(new URL("../../site/nostr-wallet-sync.js", import.meta.url), "utf8");
const PUBKEY = "a".repeat(64);
const D_TAG = "com.600b.nutft-wallet.v0";

const backup = (key, tokens = []) => JSON.stringify({
  format: "600b-nutft-wallet-v1",
  wallet: { privateKey: key, pubkey: `${key}-p2bk`, tokens, outgoing: [] },
});

function event(id, revision, previous = "", content = "ciphertext") {
  const nonce = String(revision + 1).padStart(32, "0");
  return {
    id,
    pubkey: PUBKEY,
    created_at: 1_700_000_000 + revision,
    kind: 37378,
    tags: [
      ["d", `${D_TAG}:${nonce}`], ["sync", D_TAG], ["prev", previous],
      ["schema", "0"], ["rev", String(revision)],
    ],
    content,
    sig: "b".repeat(128),
  };
}

function relayClass(backend) {
  return class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(name, listener) {
      const list = this.listeners.get(name) || [];
      list.push(listener);
      this.listeners.set(name, list);
    }

    emit(name, value) {
      for (const listener of this.listeners.get(name) || []) listener(value);
    }

    send(raw) {
      const message = JSON.parse(raw);
      (backend.requests ||= []).push(message);
      if (message[0] === "REQ") {
        const subscription = message[1];
        for (const found of backend.events) {
          queueMicrotask(() => this.emit("message", {
            data: JSON.stringify(["EVENT", subscription, found]),
          }));
        }
        queueMicrotask(() => this.emit("message", {
          data: JSON.stringify(["EOSE", subscription]),
        }));
        return;
      }
      if (message[0] === "EVENT") {
        backend.events.push(message[1]);
        queueMicrotask(() => this.emit("message", {
          data: JSON.stringify(["OK", message[1].id, true, "stored"]),
        }));
      }
    }

    close() {}
  };
}

function load({ backend = { events: [] }, wallet, storage = new Map(), identity } = {}) {
  let nextId = backend.events.length + 1;
  const signer = identity || {
    login: async () => PUBKEY,
    nip44: {
      available: () => true,
      encrypt: async (_pubkey, cleartext) => `sealed:${cleartext}`,
      decrypt: async (_pubkey, ciphertext) => ciphertext.slice("sealed:".length),
    },
    sign: async (unsigned) => ({
      ...unsigned,
      id: (nextId++).toString(16).padStart(64, "0"),
      pubkey: PUBKEY,
      sig: "c".repeat(128),
    }),
  };
  const context = {
    crypto: globalThis.crypto,
    Blob,
    Response,
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date,
    Promise,
    WebSocket: relayClass(backend),
    setTimeout,
    clearTimeout,
    btoa: (text) => Buffer.from(text, "binary").toString("base64"),
    atob: (text) => Buffer.from(text, "base64").toString("binary"),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    E1Napplet: { identity: signer },
    NutFTWallet: wallet,
    E1Schnorr: { verifyEvent: async () => true },
    module: { exports: {} },
  };
  context.globalThis = context;
  vm.runInNewContext(SOURCE, context, { filename: "nostr-wallet-sync.js" });
  return { sync: context.E1WalletSync, storage, identity: signer };
}

test("encrypted snapshot envelope round-trips and binds its signed revision", async () => {
  const { sync } = load();
  const packed = await sync.packSnapshot(3, "d".repeat(64), backup("wallet", ["one", "two"]));
  const unpacked = await sync.unpackSnapshot(packed, "d".repeat(64), 3);
  assert.equal(unpacked.revision, 3);
  assert.deepEqual(Array.from(unpacked.backup.wallet.tokens), ["one", "two"]);
  await assert.rejects(() => sync.unpackSnapshot(packed, "e".repeat(64), 3), /does not match/);
});

test("first device publishes and a fresh mobile wallet restores through BIMCVP", async () => {
  const backend = { events: [] };
  const desktopBackup = backup("desktop", ["cashu-one", "cashu-two"]);
  const desktop = load({
    backend,
    wallet: {
      exportBackup: async () => desktopBackup,
      replaceBackup: async () => { throw new Error("desktop must not restore"); },
    },
  });
  const published = await desktop.sync.sync();
  assert.equal(published.status, "published");
  assert.equal(backend.events.length, 1);
  assert.deepEqual(Array.from(backend.requests[0][2].kinds), [37378]);
  assert.equal("#sync" in backend.requests[0][2], false,
    "the production strfry relay does not index arbitrary tags");
  assert.equal(backend.events[0].tags[1][0], "sync");
  assert.equal(backend.events[0].tags[1][1], D_TAG);
  assert.equal(desktop.storage.has("600b:nutft-wallet-sync-v0"), true);

  let replacement = null;
  const emptyMobile = backup("generated-mobile");
  const mobile = load({
    backend,
    wallet: {
      exportBackup: async () => emptyMobile,
      replaceBackup: async (remote, expected) => { replacement = { remote, expected }; return 2; },
    },
  });
  const restored = await mobile.sync.sync();
  assert.equal(restored.status, "restored");
  assert.equal(restored.tokens, 2);
  assert.equal(replacement.expected, emptyMobile);
  assert.deepEqual(JSON.parse(replacement.remote), JSON.parse(desktopBackup));
  assert.equal(backend.events.length, 1, "restoring never publishes another branch");
});

test("a wallet larger than nos2x plaintext limit is encrypted in bounded pieces", async () => {
  const backend = { events: [] };
  const plaintextSizes = [];
  let nextId = 1;
  const strictSigner = {
    login: async () => PUBKEY,
    nip44: {
      available: () => true,
      encrypt: async (_pubkey, plaintext) => {
        const size = new TextEncoder().encode(plaintext).length;
        plaintextSizes.push(size);
        if (size > 65535) {
          throw new Error("nos2x: invalid plaintext size: must be between 1 and 65535 bytes");
        }
        return `sealed:${plaintext}`;
      },
      decrypt: async (_pubkey, ciphertext) => ciphertext.slice("sealed:".length),
    },
    sign: async (unsigned) => ({
      ...unsigned,
      id: (nextId++).toString(16).padStart(64, "0"),
      pubkey: PUBKEY,
      sig: "c".repeat(128),
    }),
  };
  let noisyToken = "";
  for (let index = 0; index < 12000; index += 1) {
    noisyToken += ((index * 2654435761) >>> 0).toString(16).padStart(8, "0");
  }
  const largeWallet = load({
    backend,
    identity: strictSigner,
    wallet: {
      exportBackup: async () => backup("desktop", [noisyToken]),
      replaceBackup: async () => 0,
    },
  });

  const result = await largeWallet.sync.sync();
  assert.equal(result.status, "published");
  assert.ok(plaintextSizes.length > 1, "the snapshot crossed the signer in multiple pieces");
  assert.ok(plaintextSizes.every((size) => size > 0 && size <= 65535));
  assert.equal(
    backend.events.length, 1,
    "the encrypted pieces still form one signed snapshot event",
  );
  const cleartext = await largeWallet.sync.decryptPayload(
    strictSigner, PUBKEY, backend.events[0].content,
  );
  const restored = await largeWallet.sync.unpackSnapshot(cleartext, "", 0);
  assert.equal(restored.backup.wallet.tokens[0], noisyToken);
});

test("a relay fork is reported instead of silently choosing a wallet", async () => {
  const genesis = event("1".repeat(64), 0);
  const left = event("2".repeat(64), 1, genesis.id);
  const right = event("3".repeat(64), 1, genesis.id);
  const { sync } = load();
  await assert.rejects(
    () => sync.chainFrom([genesis, left, right], PUBKEY),
    /two devices extended.*both branches were preserved/,
  );
});

test("a non-empty fresh device refuses a different remote wallet", async () => {
  const backend = { events: [] };
  const desktop = load({
    backend,
    wallet: {
      exportBackup: async () => backup("desktop", ["remote"]),
      replaceBackup: async () => 0,
    },
  });
  await desktop.sync.sync();

  let replaced = false;
  const mobile = load({
    backend,
    wallet: {
      exportBackup: async () => backup("mobile", ["local"]),
      replaceBackup: async () => { replaced = true; },
    },
  });
  await assert.rejects(() => mobile.sync.sync(), /different unsynced wallet/);
  assert.equal(replaced, false);
});

test("wallet page loads verifier, wallet and sync in dependency order", async () => {
  const html = await readFile(new URL("../../site/wallet.html", import.meta.url), "utf8");
  const verifier = html.indexOf('<script src="schnorr.js"></script>');
  const wallet = html.indexOf('<script src="nutft-wallet.js"></script>');
  const sync = html.indexOf('<script src="nostr-wallet-sync.js"></script>');
  assert.ok(verifier >= 0 && verifier < wallet && wallet < sync);
  assert.match(html, /id="syncWallet"/);
  assert.match(html, /relay\.bimcvp\.com/);
});
