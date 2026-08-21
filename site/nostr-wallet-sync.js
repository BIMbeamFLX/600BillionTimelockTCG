/* 600B NutFT wallet sync over the BIMCVP relay.
 *
 * cashu-sync v0's important rule is preserved: a complete encrypted snapshot
 * extends one remembered head and is replaced only after that head was checked.
 * relay.bimcvp.com is ordinary strfry, not cashu-sync's compare-and-swap relay,
 * so every snapshot gets a unique parameterized-replaceable `d` value and
 * remains immutable. A dedicated kind lets strfry query by `kind + author`;
 * the production relay does not index arbitrary tags. The
 * signed `prev` chain then makes simultaneous children visible as a conflict;
 * neither branch is silently selected and no local bearer wallet is merged.
 *
 * The event content is NIP-44-encrypted to the same signer. The relay can see
 * the signer, time and ciphertext size, but never the wallet key or Cashu
 * tokens. Large ciphertexts are stored as hash-addressed blobs on the BIMCVP
 * Blossom server; the signed event contains only the verified pointer. An npub
 * identifies the chain; only its signer can open it. */
(function (root) {
  "use strict";

  const RELAY_URL = "wss://relay.bimcvp.com";
  const BLOSSOM_URL = "https://blossom.bimcvp.com";
  const KIND = 37378;
  const D_TAG = "com.600b.nutft-wallet.v0";
  const META_STORE = "600b:nutft-wallet-sync-v0";
  const FORMAT = "600b-nutft-wallet-sync-v0";
  const CHUNK_FORMAT = "600b-nip44-chunks-v1";
  const BLOB_FORMAT = "600b-wallet-blossom-v1";
  const MAX_NIP44_PLAINTEXT_BYTES = 60000;
  const MAX_NIP44_CHUNKS = 21;
  const MAX_DIRECT_CIPHERTEXT_BYTES = 50000;
  const MAX_RELAY_EVENT_BYTES = 65536;
  const MAX_BLOB_BYTES = 2000000;
  const MAX_EVENTS = 500;
  const RELAY_TIMEOUT_MS = 12000;
  const BLOSSOM_TIMEOUT_MS = 120000;
  const HEX_32 = /^[0-9a-f]{32}$/;
  const HEX_64 = /^[0-9a-f]{64}$/;

  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map(
        (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
      ).join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const utf8 = (text) => new TextEncoder().encode(text);
  const eventBytes = (event) => utf8(JSON.stringify(event)).length;
  const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const sha256Bytes = async (bytes) => hex(new Uint8Array(
    await root.crypto.subtle.digest("SHA-256", bytes),
  ));
  const digest = async (value) => hex(new Uint8Array(
    await root.crypto.subtle.digest("SHA-256", utf8(canonical(value))),
  ));

  function base64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return root.btoa(binary);
  }

  function unbase64(text) {
    const binary = root.atob(text);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function gzip(bytes) {
    if (typeof root.CompressionStream !== "function") return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new root.CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzip(bytes) {
    if (typeof root.DecompressionStream !== "function") {
      throw new Error("this browser cannot open compressed wallet snapshots");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream("gzip"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  function parseBackup(text) {
    let backup;
    try { backup = JSON.parse(text); }
    catch { throw new Error("the wallet backup is not valid JSON"); }
    if (backup?.format !== "600b-nutft-wallet-v1" || !backup.wallet
        || typeof backup.wallet.privateKey !== "string"
        || typeof backup.wallet.pubkey !== "string"
        || !Array.isArray(backup.wallet.tokens)) {
      throw new Error("the wallet backup has an invalid format");
    }
    return backup;
  }

  async function packSnapshot(revision, previousEventId, backupText) {
    const snapshot = {
      schema: 0,
      revision,
      previous_event_id: previousEventId,
      backup: parseBackup(backupText),
    };
    const encoded = JSON.stringify(snapshot);
    const compressed = await gzip(utf8(encoded));
    return compressed
      ? JSON.stringify({ codec: "gzip-base64", data: base64(compressed) })
      : JSON.stringify({ codec: "base64-json", data: base64(utf8(encoded)) });
  }

  async function unpackSnapshot(cleartext, outerPreviousEventId, outerRevision) {
    let wrapper;
    try { wrapper = JSON.parse(cleartext); }
    catch { throw new Error("the decrypted wallet snapshot is not valid JSON"); }
    let encoded;
    if (wrapper?.codec === "gzip-base64" && typeof wrapper.data === "string") {
      encoded = await gunzip(unbase64(wrapper.data));
    } else if (wrapper?.codec === "base64-json" && typeof wrapper.data === "string") {
      encoded = new TextDecoder().decode(unbase64(wrapper.data));
    } else if (wrapper?.codec === "plain-json" && typeof wrapper.data === "string") {
      /* Read snapshots created by the first deployed sync build. New fallback
       * snapshots are base64 so their chunk boundaries are always ASCII. */
      encoded = wrapper.data;
    } else {
      throw new Error("the decrypted wallet snapshot uses an unsupported codec");
    }
    let snapshot;
    try { snapshot = JSON.parse(encoded); }
    catch { throw new Error("the decrypted wallet snapshot has an invalid envelope"); }
    if (snapshot?.schema !== 0 || snapshot.revision !== outerRevision
        || snapshot.previous_event_id !== outerPreviousEventId) {
      throw new Error("the encrypted revision does not match the signed snapshot event");
    }
    parseBackup(JSON.stringify(snapshot.backup));
    return snapshot;
  }

  const singleTag = (event, name) => {
    const tags = Array.isArray(event?.tags) ? event.tags : [];
    const found = tags.filter((tag) => Array.isArray(tag) && tag[0] === name
      && typeof tag[1] === "string");
    return found.length === 1 ? found[0][1] : null;
  };

  const revisionOf = (event) => {
    const value = singleTag(event, "rev");
    return /^(0|[1-9][0-9]*)$/.test(value || "") && Number.isSafeInteger(Number(value))
      ? Number(value) : null;
  };

  async function verifySnapshotEvent(event, pubkey) {
    const verifier = root.E1Schnorr;
    const previous = singleTag(event, "prev");
    const revision = revisionOf(event);
    const coordinate = singleTag(event, "d");
    const nonce = coordinate?.startsWith(`${D_TAG}:`) ? coordinate.slice(D_TAG.length + 1) : "";
    const exactTags = Array.isArray(event?.tags) && event.tags.length === 5
      && canonical(event.tags) === canonical([
        ["d", coordinate], ["sync", D_TAG], ["prev", previous],
        ["schema", "0"], ["rev", String(revision)],
      ]);
    if (!verifier || typeof verifier.verifyEvent !== "function" || event?.kind !== KIND
        || event.pubkey !== pubkey || typeof event.content !== "string"
        || eventBytes(event) > MAX_RELAY_EVENT_BYTES || !HEX_32.test(nonce)
        || !exactTags || revision === null
        || (previous !== "" && !HEX_64.test(previous))) return false;
    try { return await verifier.verifyEvent(event); }
    catch { return false; }
  }

  function relaySocket() {
    if (typeof root.WebSocket !== "function") {
      throw new Error("this browser cannot connect to the BIMCVP relay");
    }
    return new root.WebSocket(RELAY_URL);
  }

  function relayRequest(message, onMessage) {
    return new Promise((resolve, reject) => {
      const socket = relaySocket();
      let settled = false;
      const timer = root.setTimeout(
        () => finish(new Error("BIMCVP relay timed out")),
        RELAY_TIMEOUT_MS,
      );
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        try { socket.close(); } catch { /* already closed */ }
        if (error) reject(error); else resolve(value);
      };
      socket.addEventListener("open", () => socket.send(JSON.stringify(message)));
      socket.addEventListener("error", () => finish(new Error("BIMCVP relay connection failed")));
      socket.addEventListener("close", () => {
        if (!settled) finish(new Error("BIMCVP relay closed before answering"));
      });
      socket.addEventListener("message", (incoming) => {
        let parsed;
        try { parsed = JSON.parse(String(incoming.data)); }
        catch { return; }
        try {
          const answer = onMessage(parsed);
          if (answer?.done) finish(answer.error || null, answer.value);
        } catch (error) { finish(error); }
      });
    });
  }

  async function relayEvents(pubkey) {
    const subscription = `600b-wallet-${hex(root.crypto.getRandomValues(new Uint8Array(8)))}`;
    const events = [];
    const filter = { kinds: [KIND], authors: [pubkey], limit: MAX_EVENTS };
    const found = await relayRequest(["REQ", subscription, filter], (message) => {
      if (message[0] === "EVENT" && message[1] === subscription && message[2]) {
        events.push(message[2]);
      }
      if (message[0] === "EOSE" && message[1] === subscription) {
        return { done: true, value: events };
      }
      if (message[0] === "CLOSED" && message[1] === subscription) {
        const reason = message[2] || "closed";
        return { done: true, error: new Error(`BIMCVP relay refused wallet reads: ${reason}`) };
      }
      return null;
    });
    if (found.length >= MAX_EVENTS) {
      throw new Error(
        "the relay returned the wallet history limit; use the backup file "
          + "instead of guessing a head",
      );
    }
    return found;
  }

  async function publishEvent(event) {
    return relayRequest(["EVENT", event], (message) => {
      if (message[0] !== "OK" || message[1] !== event.id) return null;
      if (message[2] === true) return { done: true, value: event.id };
      const reason = message[3] || "rejected";
      return { done: true, error: new Error(`BIMCVP relay refused wallet sync: ${reason}`) };
    });
  }

  async function chainFrom(events, pubkey) {
    const byId = new Map();
    for (const event of events) {
      if (!(await verifySnapshotEvent(event, pubkey))) {
        throw new Error("the BIMCVP relay returned a wallet event that could not be verified");
      }
      byId.set(event.id, event);
    }
    if (!byId.size) return [];

    const roots = [...byId.values()].filter((event) => singleTag(event, "prev") === "");
    if (roots.length !== 1) {
      throw new Error("wallet sync has more than one beginning; no branch was selected");
    }
    const children = new Map();
    for (const event of byId.values()) {
      const previous = singleTag(event, "prev");
      if (previous && !byId.has(previous)) {
        throw new Error("wallet sync history is incomplete; no snapshot was applied");
      }
      const list = children.get(previous) || [];
      list.push(event);
      children.set(previous, list);
    }

    const chain = [];
    let event = roots[0];
    while (event) {
      if (revisionOf(event) !== chain.length) {
        throw new Error("wallet sync revisions do not form one continuous chain");
      }
      chain.push(event);
      const next = children.get(event.id) || [];
      if (next.length > 1) {
        throw new Error(
          "two devices extended the same wallet snapshot; both branches were preserved "
            + "and neither was selected",
        );
      }
      event = next[0] || null;
    }
    if (chain.length !== byId.size) {
      throw new Error("wallet sync contains an orphaned branch; no snapshot was applied");
    }
    return chain;
  }

  function readMeta(pubkey) {
    try {
      const meta = JSON.parse(root.localStorage.getItem(META_STORE) || "null");
      if (meta?.format === FORMAT && meta.pubkey === pubkey
          && Number.isSafeInteger(meta.revision) && meta.revision >= 0
          && HEX_64.test(meta.headEventId || "")
          && HEX_64.test(meta.walletDigest || "")) return meta;
    } catch { /* missing metadata is a fresh device, not a broken wallet */ }
    return null;
  }

  function writeMeta(pubkey, revision, headEventId, walletDigest) {
    root.localStorage.setItem(META_STORE, JSON.stringify({
      format: FORMAT, pubkey, revision, headEventId, walletDigest,
    }));
  }

  const emptyWallet = (backup) => {
    const state = backup.wallet;
    return state.tokens.length === 0 && !state.pending
      && (!Array.isArray(state.outgoing) || state.outgoing.length === 0);
  };

  async function encryptPayload(identity, pubkey, cleartext) {
    if (utf8(cleartext).length !== cleartext.length) {
      throw new Error("the packed wallet snapshot is not safe to split at ASCII boundaries");
    }
    const chunks = [];
    for (let offset = 0; offset < cleartext.length; offset += MAX_NIP44_PLAINTEXT_BYTES) {
      const part = cleartext.slice(offset, offset + MAX_NIP44_PLAINTEXT_BYTES);
      const ciphertext = await identity.nip44.encrypt(pubkey, part);
      if (typeof ciphertext !== "string" || !ciphertext) {
        throw new Error("the signer returned an empty NIP-44 wallet chunk");
      }
      chunks.push(ciphertext);
    }
    if (!chunks.length || chunks.length > MAX_NIP44_CHUNKS) {
      throw new Error("this wallet needs too many NIP-44 chunks; download the backup file instead");
    }
    return JSON.stringify({ format: CHUNK_FORMAT, chunks });
  }

  async function decryptPayload(identity, pubkey, content) {
    let envelope = null;
    try { envelope = JSON.parse(content); }
    catch { /* The first deployed sync build stored one raw NIP-44 ciphertext. */ }
    if (envelope?.format !== CHUNK_FORMAT) {
      return identity.nip44.decrypt(pubkey, content);
    }
    if (!Array.isArray(envelope.chunks) || !envelope.chunks.length
        || envelope.chunks.length > MAX_NIP44_CHUNKS
        || envelope.chunks.some((chunk) => typeof chunk !== "string" || !chunk)) {
      throw new Error("the encrypted wallet chunk envelope is invalid");
    }
    const cleartext = [];
    for (const chunk of envelope.chunks) {
      cleartext.push(await identity.nip44.decrypt(pubkey, chunk));
    }
    return cleartext.join("");
  }

  const blossomSignal = () => (typeof root.AbortSignal?.timeout === "function"
    ? root.AbortSignal.timeout(BLOSSOM_TIMEOUT_MS) : undefined);

  function blossomPointer(content) {
    let pointer;
    try { pointer = JSON.parse(content); }
    catch { return null; }
    if (pointer?.format !== BLOB_FORMAT) return null;
    if (!HEX_64.test(pointer.sha256 || "")
        || pointer.url !== `${BLOSSOM_URL}/${pointer.sha256}`
        || !Number.isSafeInteger(pointer.bytes) || pointer.bytes < 1
        || pointer.bytes > MAX_BLOB_BYTES) {
      throw new Error("the signed Blossom wallet pointer is invalid");
    }
    return pointer;
  }

  async function downloadBlob(pointer) {
    if (typeof root.fetch !== "function") {
      throw new Error("this browser cannot download the encrypted wallet blob");
    }
    let response;
    try {
      response = await root.fetch(pointer.url, { signal: blossomSignal(), cache: "no-store" });
    } catch {
      throw new Error("the encrypted wallet blob could not be downloaded from BIMCVP Blossom");
    }
    if (!response.ok) {
      throw new Error(
        `BIMCVP Blossom could not find the encrypted wallet blob (${response.status})`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== pointer.bytes || bytes.length > MAX_BLOB_BYTES
        || await sha256Bytes(bytes) !== pointer.sha256) {
      throw new Error("the encrypted wallet blob does not match its signed SHA-256 pointer");
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("the encrypted wallet blob is not valid UTF-8"); }
  }

  async function blossomAuthorization(identity, pubkey, sha256) {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = {
      kind: 24242,
      created_at: now,
      tags: [["t", "upload"], ["x", sha256], ["expiration", String(now + 600)]],
      content: "upload encrypted 600B wallet snapshot",
    };
    const signed = await identity.sign(unsigned);
    const exact = signed?.kind === unsigned.kind && signed.pubkey === pubkey
      && signed.created_at === unsigned.created_at && signed.content === unsigned.content
      && canonical(signed.tags) === canonical(unsigned.tags);
    if (!exact || !(await root.E1Schnorr.verifyEvent(signed))) {
      throw new Error("the signer returned an invalid Blossom upload authorization");
    }
    return `Nostr ${base64(utf8(JSON.stringify(signed)))}`;
  }

  async function uploadBlob(identity, pubkey, content) {
    if (typeof root.fetch !== "function") {
      throw new Error("this browser cannot upload the encrypted wallet blob");
    }
    const bytes = utf8(content);
    if (!bytes.length || bytes.length > MAX_BLOB_BYTES) {
      throw new Error("this wallet is too large for Blossom sync; keep the backup file instead");
    }
    const sha256 = await sha256Bytes(bytes);
    const authorization = await blossomAuthorization(identity, pubkey, sha256);
    let response;
    try {
      response = await root.fetch(`${BLOSSOM_URL}/upload`, {
        method: "PUT",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "X-SHA-256": sha256,
        },
        body: bytes,
        signal: blossomSignal(),
      });
    } catch {
      throw new Error("the encrypted wallet blob upload to BIMCVP Blossom failed");
    }
    if (!response.ok) {
      const reason = response.headers.get("x-reason") || `HTTP ${response.status}`;
      throw new Error(`BIMCVP Blossom refused the encrypted wallet blob: ${reason}`);
    }
    let descriptor;
    try { descriptor = await response.json(); }
    catch { throw new Error("BIMCVP Blossom returned an invalid blob descriptor"); }
    if (descriptor?.sha256 !== sha256 || descriptor.size !== bytes.length) {
      throw new Error("BIMCVP Blossom returned the wrong wallet blob descriptor");
    }
    const pointer = {
      format: BLOB_FORMAT,
      sha256,
      url: `${BLOSSOM_URL}/${sha256}`,
      bytes: bytes.length,
    };
    await downloadBlob(pointer);
    return pointer;
  }

  async function decryptHead(event, pubkey) {
    const previous = singleTag(event, "prev");
    const revision = revisionOf(event);
    const identity = root.E1Napplet.identity;
    const pointer = blossomPointer(event.content);
    const content = pointer ? await downloadBlob(pointer) : event.content;
    const cleartext = await decryptPayload(identity, pubkey, content);
    return unpackSnapshot(cleartext, previous, revision);
  }

  async function publishSnapshot(pubkey, revision, previousEventId, backupText) {
    const identity = root.E1Napplet.identity;
    const cleartext = await packSnapshot(revision, previousEventId, backupText);
    const ciphertext = await encryptPayload(identity, pubkey, cleartext);
    const content = utf8(ciphertext).length > MAX_DIRECT_CIPHERTEXT_BYTES
      ? JSON.stringify(await uploadBlob(identity, pubkey, ciphertext)) : ciphertext;
    const nonce = hex(root.crypto.getRandomValues(new Uint8Array(16)));
    const unsigned = {
      kind: KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", `${D_TAG}:${nonce}`], ["sync", D_TAG], ["prev", previousEventId],
        ["schema", "0"], ["rev", String(revision)],
      ],
      content,
    };
    const signed = await identity.sign(unsigned);
    if (!(await verifySnapshotEvent(signed, pubkey))) {
      throw new Error("the signer returned a wallet snapshot event that could not be verified");
    }
    await publishEvent(signed);
    const backup = parseBackup(backupText);
    const walletDigest = await digest(backup.wallet);
    writeMeta(pubkey, revision, signed.id, walletDigest);
    return { status: "published", revision, head: signed.id, tokens: backup.wallet.tokens.length };
  }

  async function sync() {
    const nap = root.E1Napplet;
    const wallet = root.NutFTWallet;
    if (!nap?.identity || !wallet || !root.E1Schnorr) {
      throw new Error("wallet sync is unavailable on this page");
    }
    const pubkey = await nap.identity.login();
    if (!nap.identity.nip44?.available?.()) {
      throw new Error(
        "this Nostr signer does not offer NIP-44; use the wallet backup file on this device",
      );
    }

    const beforeText = await wallet.exportBackup();
    const before = parseBackup(beforeText);
    const beforeDigest = await digest(before.wallet);
    const meta = readMeta(pubkey);
    const chain = await chainFrom(await relayEvents(pubkey), pubkey);
    const head = chain.at(-1) || null;

    if (!head) {
      if (meta) throw new Error("the relay lost a remembered wallet head; refusing rollback");
      return publishSnapshot(pubkey, 0, "", beforeText);
    }

    if (meta && !chain.some((event) => event.id === meta.headEventId)) {
      throw new Error(
        "this device's remembered wallet head is not in the relay history; refusing rollback",
      );
    }
    const remote = await decryptHead(head, pubkey);
    const remoteText = JSON.stringify(remote.backup);
    const remoteDigest = await digest(remote.backup.wallet);
    if (meta?.headEventId === head.id) {
      if (meta.revision !== remote.revision) {
        throw new Error("the encrypted revision disagrees with this device's remembered head");
      }
      if (beforeDigest === meta.walletDigest) {
        return {
          status: "current", revision: remote.revision, head: head.id,
          tokens: before.wallet.tokens.length,
        };
      }
      return publishSnapshot(pubkey, remote.revision + 1, head.id, beforeText);
    }

    if (meta) {
      if (remote.revision <= meta.revision) {
        throw new Error("the relay returned an older wallet revision; refusing rollback");
      }
      if (beforeDigest !== meta.walletDigest) {
        if (remoteDigest === beforeDigest) {
          writeMeta(pubkey, remote.revision, head.id, remoteDigest);
          return {
            status: "current", revision: remote.revision, head: head.id,
            tokens: before.wallet.tokens.length,
          };
        }
        throw new Error(
          "this device and another device both changed the wallet; "
            + "neither snapshot was overwritten",
        );
      }
    } else if (!emptyWallet(before) && remoteDigest !== beforeDigest) {
      throw new Error(
        "this device already holds a different unsynced wallet; download both backups "
          + "instead of overwriting either one",
      );
    }

    await wallet.replaceBackup(remoteText, beforeText);
    writeMeta(pubkey, remote.revision, head.id, remoteDigest);
    return {
      status: "restored", revision: remote.revision, head: head.id,
      tokens: remote.backup.wallet.tokens.length,
    };
  }

  root.E1WalletSync = Object.freeze({
    sync, packSnapshot, unpackSnapshot, verifySnapshotEvent, chainFrom,
    encryptPayload, decryptPayload,
    RELAY_URL, KIND, D_TAG, FORMAT,
  });
  if (typeof module === "object" && module.exports) module.exports = root.E1WalletSync;
})(globalThis);
