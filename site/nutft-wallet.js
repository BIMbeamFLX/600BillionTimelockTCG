(function (root) {
  "use strict";

  const STORE = "600b:nutft-wallet";
  const CASHU_URL = root.NUTFT_CASHU_URL || "https://esm.sh/@cashu/cashu-ts@4.7.2?bundle";
  let cashuPromise;
  let memory = null;

  const cashu = () => (cashuPromise ||= import(CASHU_URL));
  const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const bytes = (value) => Uint8Array.from(value.match(/.{2}/g).map((part) => parseInt(part, 16)));
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const digest = async (value) => hex(new Uint8Array(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const reference = (tag) => ({ collection_id: tag[1], asset_id: tag[2], catalog_uri: tag[3] });
  const binding = async (tag) => digest(`Cashu_NutFT_v1${canonical(reference(tag))}`);

  async function read() {
    if (memory) return memory;
    try {
      const saved = root.localStorage.getItem(STORE);
      memory = saved ? JSON.parse(saved) : { privateKey: "", pubkey: "", tokens: [] };
    } catch (error) {
      memory = { privateKey: "", pubkey: "", tokens: [] };
    }
    return memory;
  }

  function write(state) {
    memory = state;
    try { root.localStorage.setItem(STORE, JSON.stringify(state)); } catch (error) { /* browser storage is optional */ }
  }

  async function identity(c) {
    const state = await read();
    if (!state.privateKey) {
      const privateKey = c.createRandomSecretKey();
      state.privateKey = hex(privateKey);
      state.pubkey = hex(c.getPubKeyFromPrivKey(privateKey));
      write(state);
    }
    return state;
  }

  async function getKeyset(mintUrl, c) {
    const response = await fetch(`${mintUrl}/v1/keys`);
    if (!response.ok) throw new Error(`mint keys unavailable (${response.status})`);
    const data = await response.json();
    const keyset = data.keysets && data.keysets.find((entry) => entry.active !== false);
    if (!keyset || keyset.unit !== "600B-E1") throw new Error("mint does not advertise the 600B-E1 NutFT unit");
    return { id: keyset.id, keys: keyset.keys };
  }

  async function buyBooster(mintUrl) {
    const c = await cashu();
    const state = await identity(c);
    const keyset = await getKeyset(mintUrl, c);
    const quoteResponse = await fetch(`${mintUrl}/nutft/quote`);
    if (!quoteResponse.ok) throw new Error(`booster quote unavailable (${quoteResponse.status})`);
    const quote = await quoteResponse.json();
    const outputs = quote.cards.map((card) => c.OutputData.createSingleP2PKData({
      pubkey: state.pubkey,
      blindKeys: true,
      additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
    }, 1, keyset.id));
    const response = await fetch(`${mintUrl}/nutft/booster`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pack_id: quote.pack_id,
        state: quote.state,
        outputs: outputs.map((output, index) => ({
          amount: 1,
          id: output.blindedMessage.id,
          B_: output.blindedMessage.B_,
          nutft: {
            collection_id: quote.cards[index].collection_id,
            asset_id: quote.cards[index].asset_id,
            catalog_uri: quote.cards[index].catalog_uri,
          },
        })),
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error || `mint refused booster (${response.status})`);
    const issued = await response.json();
    const proofs = outputs.map((output, index) => output.toProof({
      ...issued.signatures[index],
      amount: c.Amount.from(issued.signatures[index].amount),
    }, keyset));
    for (let i = 0; i < proofs.length; i += 1) {
      const tag = c.getTag(proofs[i].secret, "nutft");
      if (!tag || tag.length !== 5 || tag[0] !== "1" || tag[2] !== issued.cards[i].asset_id || tag[4] !== issued.cards[i].asset_binding) {
        throw new Error(`wallet rejected CardBinding for ${issued.cards[i].asset_id}`);
      }
      if (await binding(tag) !== tag[4]) throw new Error(`wallet rejected asset binding for ${tag[2]}`);
      if (!c.hasValidDleq(proofs[i], keyset, { require: true })) throw new Error("wallet rejected mint DLEQ proof");
      if (proofs[i].amount.toString() !== "1" || proofs[i].p2pk_e === undefined) throw new Error("wallet rejected NutFT amount or P2BK destination");
    }
    const token = c.getEncodedToken({ mint: mintUrl, unit: issued.unit, proofs });
    state.tokens.push(token);
    write(state);
    return { ...issued, token, proofs };
  }

  async function proofs(mintUrl) {
    const c = await cashu();
    const state = await read();
    const keyset = await getKeyset(mintUrl, c);
    return state.tokens.flatMap((token) => c.getDecodedToken(token, [keyset.id]).proofs);
  }

  async function verifyCatalog(mintUrl, catalog, c) {
    const { issuer_pubkey: issuer, signature, ...payload } = catalog || {};
    const digestHex = await digest(canonical(payload));
    if (!catalog || catalog.collection_id !== "600B-E1" || !issuer || !signature || !c.schnorrVerifyDigest(signature, digestHex, issuer)) {
      throw new Error("catalog signature or collection validation failed");
    }
    return catalog;
  }

  async function snapshot(mintUrl) {
    const c = await cashu();
    const keyset = await getKeyset(mintUrl, c);
    const catalog = await (await fetch(`${mintUrl}/nutft/catalog`)).json();
    await verifyCatalog(mintUrl, catalog, c);
    const owned = [];
    for (const proof of await proofs(mintUrl)) {
      const tag = c.getTag(proof.secret, "nutft");
      if (!tag || tag.length !== 5 || tag[0] !== "1" || proof.id !== keyset.id || proof.amount.toString() !== "1" || !proof.p2pk_e || !c.hasValidDleq(proof, keyset, { require: true }) || await binding(tag) !== tag[4]) {
        throw new Error("wallet rejected a NutFT proof during reload");
      }
      const asset = catalog.assets.find((card) => card.asset_id === tag[2]);
      if (!asset || asset.asset_binding !== tag[4]) throw new Error(`catalog has no verified asset ${tag[2]}`);
      const state = await (await fetch(`${mintUrl}/v1/checkstate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ Ys: [c.hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true)] }),
      })).json();
      owned.push({ proof, tag, asset, state: state.states[0].state });
    }
    return { catalog, owned };
  }

  async function tradeProof(mintUrl, secret) {
    const c = await cashu();
    const state = await identity(c);
    const keyset = await getKeyset(mintUrl, c);
    const all = state.tokens.flatMap((token) => c.getDecodedToken(token, [keyset.id]).proofs);
    const index = all.findIndex((proof) => proof.secret === secret);
    if (index < 0) throw new Error("card is not in this wallet");
    const oldProof = all[index];
    const keys = c.maybeDeriveP2BKPrivateKeys(state.privateKey, oldProof);
    if (!keys.length) throw new Error("wallet cannot derive the P2BK spending key");
    const signed = c.signP2PKProof(oldProof, keys[0]);
    const tag = c.getTag(oldProof.secret, "nutft");
    const output = c.OutputData.createSingleP2PKData({
      pubkey: state.pubkey,
      blindKeys: true,
      additionalTags: [["nutft", ...tag]],
    }, 1, keyset.id);
    const idempotencyKey = `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await fetch(`${mintUrl}/nutft/trade`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        inputs: c.serializeProofs([signed]),
        outputs: [{ amount: 1, id: output.blindedMessage.id, B_: output.blindedMessage.B_, nutft: {
          collection_id: tag[1], asset_id: tag[2], catalog_uri: tag[3],
        } }],
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error || `trade refused (${response.status})`);
    const result = await response.json();
    const proof = output.toProof({ ...result.signature, amount: c.Amount.from(1) }, keyset);
    if (c.getTag(proof.secret, "nutft")[4] !== tag[4] || !proof.p2pk_e || !c.hasValidDleq(proof, keyset, { require: true })) throw new Error("wallet rejected replacement proof");
    const token = c.getEncodedToken({ mint: mintUrl, unit: result.unit, proofs: all.map((item, i) => i === index ? proof : item) });
    state.tokens = [token];
    write(state);
    return result;
  }

  root.NutFTWallet = { buyBooster, snapshot, tradeProof, read, cashu, hex, bytes };
})(globalThis);
