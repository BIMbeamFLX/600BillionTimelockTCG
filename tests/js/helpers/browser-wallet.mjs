/* Runs site/nutft-wallet.js the way a browser would: one fresh global scope
   with fetch, localStorage and WebCrypto injected, so a test can drive the
   wallet against a real mint instance and inspect what it stored.
   `globals` lets a test set the page-level knobs the wallet reads at load,
   NUTFT_UNITS and NUTFT_STORE. */

import { readFile } from "node:fs/promises";
import vm from "node:vm";

export async function browserWallet(storage, fetchImpl, { cashu, nostr, globals = {} }) {
  const source = await readFile(new URL("../../../site/nutft-wallet.js", import.meta.url), "utf8");
  const context = {
    __cashu: cashu,
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    URL,
    setTimeout,
    btoa: (text) => Buffer.from(text, "binary").toString("base64"),
    ...(nostr ? { nostr } : {}),
    ...globals,
  };
  vm.runInNewContext(source, context, { filename: "nutft-wallet.js" });
  return context.NutFTWallet;
}
