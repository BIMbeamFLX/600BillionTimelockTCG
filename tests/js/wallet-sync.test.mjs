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
        const eventBytes = new TextEncoder().encode(JSON.stringify(message[1])).length;
        if (backend.maxEventBytes && eventBytes > backend.maxEventBytes) {
          queueMicrotask(() => this.emit("message", {
            data: JSON.stringify([
              "OK", message[1].id, false, `invalid: event too large: ${eventBytes}`,
            ]),
          }));
          return;
        }
        backend.events.push(message[1]);
        queueMicrotask(() => this.emit("message", {
          data: JSON.stringify(["OK", message[1].id, true, "stored"]),
        }));
      }
    }

    close() {}
  };
}

async function blossomFetch(backend, url, options = {}) {
  const target = new URL(url);
  if (target.origin !== "https://blossom.bimcvp.com") {
    throw new Error(`unexpected fetch target ${target.origin}`);
  }
  const blobs = (backend.blobs ||= new Map());
  if (target.pathname === "/upload" && options.method === "PUT") {
    const bytes = new Uint8Array(await new Response(options.body).arrayBuffer());
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    const authorization = options.headers?.Authorization || options.headers?.authorization || "";
    if (!authorization.startsWith("Nostr ")) return new Response("auth required", { status: 401 });
    blobs.set(sha256, bytes);
    (backend.uploads ||= []).push({ sha256, authorization, bytes: bytes.length });
    return new Response(JSON.stringify({
      url: `${target.origin}/${sha256}.json`,
      sha256,
      size: bytes.length,
      type: "application/json",
      uploaded: 1_700_000_000,
    }), { status: 201, headers: { "content-type": "application/json" } });
  }
  const sha256 = target.pathname.slice(1).split(".")[0];
  const bytes = blobs.get(sha256);
  return bytes
    ? new Response(bytes, { status: 200, headers: { "content-type": "application/json" } })
    : new Response("missing", { status: 404 });
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
    fetch: (url, options) => blossomFetch(backend, url, options),
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

test("a large wallet round-trips through a Blossom pointer and a 65536-byte relay", async () => {
  const backend = { events: [], maxEventBytes: 65536 };
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
        return `sealed:${Buffer.from(plaintext, "utf8").toString("base64")}`;
      },
      decrypt: async (_pubkey, ciphertext) => Buffer.from(
        ciphertext.slice("sealed:".length), "base64",
      ).toString("utf8"),
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
  assert.equal(backend.events.length, 1, "the relay stores only the signed snapshot pointer");
  assert.ok(
    new TextEncoder().encode(JSON.stringify(backend.events[0])).length <= backend.maxEventBytes,
  );
  assert.equal(backend.blobs.size, 1, "the encrypted wallet is one content-addressed blob");
  const pointer = JSON.parse(backend.events[0].content);
  assert.equal(pointer.format, "600b-wallet-blossom-v1");
  assert.equal(pointer.url, `https://blossom.bimcvp.com/${pointer.sha256}`);
  assert.equal(pointer.bytes, backend.blobs.get(pointer.sha256).length);
  const auth = JSON.parse(Buffer.from(
    backend.uploads[0].authorization.slice("Nostr ".length), "base64",
  ).toString("utf8"));
  assert.equal(auth.kind, 24242);
  assert.deepEqual(auth.tags.find((tag) => tag[0] === "x"), ["x", pointer.sha256]);

  let replacement = null;
  const emptyMobile = backup("generated-mobile");
  const mobile = load({
    backend,
    identity: strictSigner,
    wallet: {
      exportBackup: async () => emptyMobile,
      replaceBackup: async (remote, expected) => { replacement = { remote, expected }; return 1; },
    },
  });
  const restored = await mobile.sync.sync();
  assert.equal(restored.status, "restored");
  assert.equal(replacement.expected, emptyMobile);
  assert.equal(JSON.parse(replacement.remote).wallet.tokens[0], noisyToken);
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
