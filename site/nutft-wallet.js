(function (root) {
  "use strict";

  const STORE = "600b:nutft-wallet";
  const CASHU_URL = "https://esm.sh/@cashu/cashu-ts@4.7.2?bundle";
  let cashuPromise;
  let memory = null;

  const cashu = () => (cashuPromise ||= root.__cashu ? Promise.resolve(root.__cashu) : import(CASHU_URL));
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
    const saved = root.localStorage.getItem(STORE);
    if (!saved) return (memory = { privateKey: "", pubkey: "", tokens: [] });
    try { memory = JSON.parse(saved); }
    catch { throw new Error("Wallet storage is corrupted. Preserve 600b:nutft-wallet before making changes."); }
    if (!memory || typeof memory !== "object" || typeof memory.privateKey !== "string" || typeof memory.pubkey !== "string" || !Array.isArray(memory.tokens) || memory.tokens.some((token) => typeof token !== "string")) {
      memory = null;
      throw new Error("Wallet storage has an invalid shape. Preserve 600b:nutft-wallet before making changes.");
    }
    return memory;
  }

  function write(state) {
    root.localStorage.setItem(STORE, JSON.stringify(state));
    memory = state;
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
    const [infoResponse, response] = await Promise.all([fetch(`${mintUrl}/v1/info`), fetch(`${mintUrl}/v1/keys`)]);
    if (!infoResponse.ok) throw new Error(`mint capabilities unavailable (${infoResponse.status})`);
    if (!response.ok) throw new Error(`mint keys unavailable (${response.status})`);
    const info = await infoResponse.json();
    const capability = info.nuts && info.nuts[31];
    if (!capability || capability.supported !== true || !capability.versions?.includes(1) || capability.output_openings !== true || capability.p2bk !== true || capability.dleq !== true || typeof capability.catalog_issuer !== "string") {
      throw new Error("mint does not advertise the required NUT-31/P2BK/DLEQ capabilities");
    }
    const data = await response.json();
    const keyset = data.keysets && data.keysets.find((entry) => entry.active !== false);
    if (!keyset || keyset.unit !== "600B-E1") throw new Error("mint does not advertise the 600B-E1 NutFT unit");
    return { id: keyset.id, keys: keyset.keys, catalogIssuer: capability.catalog_issuer };
  }

  const opening = (output) => ({
    secret: new TextDecoder().decode(output.secret),
    blinding_factor: output.blindingFactor.toString(16).padStart(64, "0"),
    p2pk_e: output.ephemeralE,
  });

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
        idempotency_key: root.crypto.randomUUID(),
        pack_id: quote.pack_id,
        state: quote.state,
        outputs: outputs.map((output, index) => ({
          amount: 1,
          id: output.blindedMessage.id,
          B_: output.blindedMessage.B_,
          nutft: opening(output),
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

  async function verifyCatalog(catalogUri, catalog, c, issuerExpected) {
    const { issuer_pubkey: issuer, signature, ...payload } = catalog || {};
    const digestHex = await digest(canonical(payload));
    if (!catalog || catalog.collection_id !== "600B-E1" || catalog.catalog_uri !== catalogUri || issuer !== issuerExpected || !signature || !c.schnorrVerifyDigest(signature, digestHex, issuer)) {
      throw new Error("catalog signature or collection validation failed");
    }
    return catalog;
  }

  async function snapshot(mintUrl) {
    const c = await cashu();
    const keyset = await getKeyset(mintUrl, c);
    const catalogs = new Map();
    const owned = [];
    const spent = [];
    const invalid = [];
    for (const proof of await proofs(mintUrl)) {
      try {
        const parsed = JSON.parse(proof.secret);
        const tags = parsed?.[1]?.tags?.filter((tag) => Array.isArray(tag) && tag[0] === "nutft") || [];
        const tag = tags[0] && tags[0].slice(1);
        if (JSON.stringify(parsed) !== proof.secret || tags.length !== 1 || !tag || tag.length !== 5 || tag[0] !== "1" || proof.id !== keyset.id || proof.amount.toString() !== "1" || !proof.p2pk_e || !c.hasValidDleq(proof, keyset, { require: true }) || await binding(tag) !== tag[4]) throw new Error("invalid NutFT proof");
        let catalog = catalogs.get(tag[3]);
        if (!catalog) {
          const catalogResponse = await fetch(tag[3]);
          if (!catalogResponse.ok) throw new Error(`catalog unavailable (${catalogResponse.status})`);
          catalog = await catalogResponse.json();
          await verifyCatalog(tag[3], catalog, c, keyset.catalogIssuer);
          catalogs.set(tag[3], catalog);
        }
        const asset = catalog.assets.find((card) => card.asset_id === tag[2]);
        if (!asset || asset.asset_binding !== tag[4]) throw new Error(`catalog has no verified asset ${tag[2]}`);
        const stateResponse = await fetch(`${mintUrl}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys: [c.hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true)] }) });
        if (!stateResponse.ok) throw new Error(`proof state unavailable (${stateResponse.status})`);
        const proofState = (await stateResponse.json()).states[0].state;
        (proofState === "SPENT" ? spent : owned).push({ proof, tag, asset, state: proofState });
      } catch (error) {
        invalid.push({ proof, error: error.message });
      }
    }
    return { catalog: catalogs.values().next().value || null, owned, spent, invalid };
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
    const idempotencyKey = root.crypto.randomUUID();
    const response = await fetch(`${mintUrl}/nutft/trade`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        inputs: c.serializeProofs([signed]),
        outputs: [{ amount: 1, id: output.blindedMessage.id, B_: output.blindedMessage.B_, nutft: opening(output) }],
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
