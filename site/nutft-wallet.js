(function (root) {
  "use strict";

  const STORE = "600b:nutft-wallet";
  const CASHU_URL = "https://esm.sh/@cashu/cashu-ts@4.7.2?bundle";
  let cashuPromise;
  let memory = null;
  let queue = Promise.resolve();

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
  const validState = (state) => state && typeof state === "object" && typeof state.privateKey === "string" && typeof state.pubkey === "string" && Array.isArray(state.tokens) && state.tokens.every((token) => typeof token === "string") && (state.pending == null || typeof state.pending === "object");

  /* ALWAYS re-read storage. The cache used to be returned outright, so this
   * function could not see a write made by another TAB — and every decision
   * about `pending` is made from what it returns.
   *
   * The loss that made this urgent: the shop opens a booster pending in one
   * tab; the wallet, opened earlier, still holds a cached state with no pending;
   * a send there passes the "is a transfer already running" guard, and its
   * write() then overwrites the booster pending with the trade's. For a PAID
   * booster that destroys the outputs, so the sats are gone with nothing left to
   * claim — precisely the loss the comment in submitPending warns about, reached
   * by a route it never considered. The site actively moves players between
   * shop.html and wallet.html, so two open tabs is the normal case, not an edge.
   *
   * `memory` stays as the parse target and as the fallback for a shell with no
   * storage at all, where it is the only place a wallet can live. Re-parsing a
   * few kilobytes per call is not a cost worth a correctness hole. */
  async function read() {
    let saved = null;
    try { saved = root.localStorage.getItem(STORE); }
    catch { return memory || (memory = { privateKey: "", pubkey: "", tokens: [], outgoing: [] }); }
    if (saved === null && memory) return memory;
    if (!saved) return (memory = { privateKey: "", pubkey: "", tokens: [], outgoing: [] });
    try { memory = JSON.parse(saved); }
    catch { throw new Error("Wallet storage is corrupted. Preserve 600b:nutft-wallet before making changes."); }
    if (!validState(memory)) {
      memory = null;
      throw new Error("Wallet storage has an invalid shape. Preserve 600b:nutft-wallet before making changes.");
    }
    return memory;
  }

  function write(state) {
    root.localStorage.setItem(STORE, JSON.stringify(state));
    memory = state;
  }

  /* Transfers this wallet has sent and not yet marked delivered. Newest first.
     Read-only copies: a caller mutating the array must not be able to drop a
     token that is still the only claim on a card. */
  async function outgoing() {
    const state = await read();
    return (Array.isArray(state.outgoing) ? state.outgoing : []).map((entry) => ({ ...entry }));
  }

  /* Forget one, once it is known to be in the recipient's hands. Deliberately
     explicit and deliberately not automatic: this wallet cannot observe whether
     the other side claimed it, so only a person can say so. */
  async function forgetOutgoing(token) {
    const state = await read();
    const kept = (Array.isArray(state.outgoing) ? state.outgoing : []).filter((entry) => entry.token !== token);
    write({ ...state, outgoing: kept });
    return kept.length;
  }

  function locked(work) {
    if (root.navigator?.locks) return root.navigator.locks.request(STORE, work);
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
  }

  async function identity(c) {
    const state = await read();
    if (!state.privateKey) {
      const privateKey = c.createRandomSecretKey();
      const next = { ...state, privateKey: hex(privateKey), pubkey: hex(c.getPubKeyFromPrivKey(privateKey)) };
      write(next);
      return next;
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
  const savedOutput = (output) => ({ id: output.blindedMessage.id, B_: output.blindedMessage.B_, ...opening(output) });
  const restoreOutput = (saved, c) => new c.OutputData(
    { amount: c.Amount.from(1), id: saved.id, B_: saved.B_ },
    BigInt(`0x${saved.blinding_factor}`),
    new TextEncoder().encode(saved.secret),
    saved.p2pk_e,
  );
  const requestOutput = (saved) => ({ amount: 1, id: saved.id, B_: saved.B_, nutft: { secret: saved.secret, blinding_factor: saved.blinding_factor, p2pk_e: saved.p2pk_e } });
  const boosterOutputs = (cards, state, c, keyset) => cards.map((card) => c.OutputData.createSingleP2PKData({
    pubkey: state.pubkey,
    blindKeys: true,
    additionalTags: [["nutft", "1", card.collection_id, card.asset_id, card.catalog_uri, card.asset_binding]],
  }, 1, keyset.id));

  async function finishPending(state, pending, response, c, keyset) {
    if (pending.type === "booster") {
      const outputs = pending.outputs.map((saved) => restoreOutput(saved, c));
      const proofs = outputs.map((output, index) => output.toProof({ ...response.signatures[index], amount: c.Amount.from(1) }, keyset));
      for (let i = 0; i < proofs.length; i += 1) {
        const tag = c.getTag(proofs[i].secret, "nutft");
        if (!tag || tag.length !== 5 || tag[0] !== "1" || tag[2] !== response.cards[i].asset_id || tag[4] !== response.cards[i].asset_binding || await binding(tag) !== tag[4] || !c.hasValidDleq(proofs[i], keyset, { require: true }) || proofs[i].amount.toString() !== "1" || !proofs[i].p2pk_e) {
          throw new Error(`wallet rejected issued proof ${i + 1}`);
        }
      }
      const token = c.getEncodedToken({ mint: pending.mintUrl, unit: response.unit, proofs });
      write({ ...state, tokens: [...state.tokens, token], pending: null });
      return { ...response, token, proofs };
    }
    const all = readableProofs(state, keyset, c);
    const index = all.findIndex((proof) => proof.secret === pending.input_secret);
    if (index < 0) throw new Error("pending transfer input is no longer in this wallet");
    const output = restoreOutput(pending.outputs[0], c);
    const proof = output.toProof({ ...response.signature, amount: c.Amount.from(1) }, keyset);
    const oldTag = c.getTag(all[index].secret, "nutft");
    const newTag = c.getTag(proof.secret, "nutft");
    if (!newTag || newTag[4] !== oldTag[4] || !proof.p2pk_e || !c.hasValidDleq(proof, keyset, { require: true })) throw new Error("wallet rejected replacement proof");
    const remaining = all.filter((_, itemIndex) => itemIndex !== index);
    /* CARRY THE UNREADABLE TOKENS THROUGH. This line rebuilds the whole token
       list out of the proofs it could read, so anything it could not read would
       be dropped on the floor by a write it never mentioned. That did not
       matter while an unreadable token threw; it matters now that one is
       tolerated, because those tokens are the only record a person has of cards
       bought from a mint this one cannot open. Losing them silently, during a
       trade of an unrelated card, would be the worst kind of data loss: quiet,
       and triggered by something that looked unrelated. */
    const { opaque } = splitTokens(state, keyset, c);
    const rebuilt = remaining.length
      ? [c.getEncodedToken({ mint: pending.mintUrl, unit: response.unit, proofs: remaining })]
      : [];
    const token = c.getEncodedToken({ mint: pending.mintUrl, unit: response.unit, proofs: [proof] });
    /* PERSIST THE OUTGOING TOKEN. It is the only thing that can ever claim this
       card: the sender no longer holds it, the recipient does not have it yet,
       and it is locked to a key only the recipient has. Returning it and writing
       nothing meant the single copy lived in whatever variable the caller kept —
       so a reload, a closed tab or a crash between the trade and the hand-off
       destroyed the card outright. Nobody could claim it, ever. That is not a
       hypothetical: it happened to a card during development.
       Kept until the sender says it was delivered. They are a few hundred bytes
       each, and an undelivered transfer nobody can find is the worse trade. */
    const outgoing = [
      { token, asset_id: response.asset_id || null, at: new Date().toISOString() },
      ...(Array.isArray(state.outgoing) ? state.outgoing : []),
    ];
    write({ ...state, tokens: [...rebuilt, ...opaque], outgoing, pending: null });
    return { ...response, token, proof };
  }

  /* "not settled yet" is not a rejection, it is a wait. Treating it as one was
     dangerous: the pending outputs were discarded, and a buyer who then paid had
     nothing left to claim with — their sats gone and no way to ask again. */
  const AWAITING_PAYMENT = /not settled yet|is still sealed|not mined yet/i;

  async function submitPending(state, c, keyset) {
    let pending = state.pending;
    if (pending.type === "booster" && !pending.outputs.length && pending.body.payment_hash) {
      const response = await fetch(`${pending.mintUrl}/nutft/reveal?payment_hash=${encodeURIComponent(pending.body.payment_hash)}`);
      if (!response.ok) throw new Error(`sealed booster unavailable (${response.status})`);
      const opened = await response.json();
      if (!Array.isArray(opened.cards)) {
        const wait = new Error(opened.note || "the booster is still sealed");
        wait.awaitingPayment = true;
        throw wait;
      }
      const outputs = boosterOutputs(opened.cards, state, c, keyset).map(savedOutput);
      pending = { ...pending, outputs, body: { ...pending.body, pack_id: opened.pack_id, state: opened.state, outputs: outputs.map(requestOutput) } };
      state = { ...state, pending };
      write(state);
    }
    const path = pending.type === "booster" ? "/nutft/booster" : "/nutft/trade";
    /* Signed only if the mint refuses without one, and retried BEFORE the
       pending is discarded below — an early-access refusal must never cost a
       buyer their outputs, least of all on a mint they have already paid. */
    const response = await postSigned(`${pending.mintUrl}${path}`, pending.body);
    if (!response.ok) {
      const detail = response.detail || `mint refused ${pending.type} (${response.status})`;
      if (AWAITING_PAYMENT.test(detail)) {
        /* Keep the pending exactly as it is. The same outputs must be resubmitted
           once the invoice settles, and the idempotency key makes that safe. */
        const wait = new Error(detail);
        wait.awaitingPayment = true;
        throw wait;
      }
      write({ ...state, pending: null });
      throw new Error(detail);
    }
    return finishPending(state, pending, await response.json(), c, keyset);
  }

  async function recoverPending() {
    const state = await read();
    if (!state.pending) return null;
    const c = await cashu();
    return submitPending(state, c, await getKeyset(state.pending.mintUrl, c));
  }

  /* Resubmit until the mint stops saying "not yet". The mint is the authority on
     settlement, so there is nothing else to ask and no state to guess at. */
  async function awaitSettlement(state, c, keyset, opts) {
    const deadline = Date.now() + Number(opts.timeoutMs || 900_000);
    let delay = 1500;
    for (;;) {
      try {
        return await submitPending(state, c, keyset);
      } catch (error) {
        if (!error.awaitingPayment) throw error;
        if (Date.now() > deadline) {
          /* The pending survives on purpose: the invoice may still settle, and
             recoverPending() can finish the sale later. */
          throw new Error("the invoice was not paid in time — reopen the shop to finish this booster");
        }
        if (typeof opts.onWaiting === "function") opts.onWaiting();
        await new Promise((done) => setTimeout(done, delay));
        delay = Math.min(delay * 1.4, 8000);
      }
    }
  }

  /* NIP-98: prove to the mint that we hold a key it will recognise.
   *
   * Only used when the mint refuses an anonymous request — see requestQuote.
   * Signing every purchase would pop the extension on every booster and hand
   * the mint an identity it does not need for an open sale. Early access is the
   * one case where the mint genuinely has to know who is asking. */
  async function nip98Header(url, method) {
    const signer = root.nostr;
    if (!signer || typeof signer.signEvent !== "function") return null;
    const unsigned = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [["u", url], ["method", method]],
    };
    const signed = await signer.signEvent(unsigned);
    if (!signed || !signed.sig) return null;
    /* THE PAGE MUST NOT SAY "signed out" WHILE ACTING AS YOU.
     *
     * The signer is read straight off the extension, deliberately — that is what
     * NIP-98 needs. But the site keeps its own idea of who is signed in under
     * 600b:pubkey, and the two came apart: after a sign-out the nav chip read
     * "Sign in with Nostr", the shop offered to sign you in, and pressing Buy
     * still completed a purchase under the extension's key. Nothing silent
     * happened — the extension asks — but the page claimed one thing and did
     * another, and on a one-per-key mint that spends somebody's allocation
     * under a name the page never showed.
     *
     * So the key that just signed is adopted. Whoever bought is now who the
     * page says bought. Wrapped because storage can refuse in private mode, and
     * a purchase must not fail over a display detail. */
    try {
      if (/^[0-9a-f]{64}$/i.test(signed.pubkey || "")) {
        root.localStorage.setItem("600b:pubkey", signed.pubkey);
      }
    } catch (error) { /* private mode: the sale still stands */ }
    /* btoa is byte-wise; a non-ASCII byte anywhere in the event would throw.
       Encode as UTF-8 first so the header survives any content the signer adds. */
    const bytes = new TextEncoder().encode(JSON.stringify(signed));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Nostr ${root.btoa(binary)}`;
  }

  /* Ask for a quote anonymously, and only reach for the signer if the mint says
     this is an early-access sale. The mint's own words are carried through on
     failure: "this key is not on the list yet" tells a buyer what to do, where
     a bare 403 tells them nothing. */
  async function requestQuote(mintUrl) {
    const target = new URL(`${mintUrl}/nutft/quote`, root.location ? root.location.href : undefined).href;
    const read = async (response) => {
      if (response.ok) return { quote: await response.json() };
      let reason = `booster quote unavailable (${response.status})`;
      try {
        const body = await response.json();
        if (body && body.error) reason = body.error;
      } catch { /* not JSON: keep the status line */ }
      return { reason };
    };

    let attempt = await read(await fetch(target));
    if (attempt.quote) return attempt.quote;

    if (/early access/i.test(attempt.reason)) {
      let header = null;
      let declined = false;
      try { header = await nip98Header(target, "GET"); } catch { declined = true; }
      if (!header) throw new Error(earlyAccessAdvice(attempt.reason, declined));
      attempt = await read(await fetch(target, { headers: { Authorization: header } }));
      if (attempt.quote) return attempt.quote;
    }
    throw new Error(attempt.reason);
  }

  /* Read the mint's own refusal out of a failed response -- or THROW, because
     anything that is not the mint refusing must not be treated as one.
   *
   * submitPending discards the pending on a refusal, since a refusal means
   * those outputs will never be signed. A proxy's HTML 502, a captive-portal
   * page or a truncated body is NOT a refusal: the mint may well have accepted,
   * and on a trade the input proof is already spent, so the outputs have to
   * survive for a retry under the same idempotency key.
   *
   * Found twice independently -- once here, once in review -- which is the best
   * evidence a bug of this shape gets. */
  async function refusal(response) {
    let body;
    try { body = await response.json(); }
    catch {
      /* A proxy's HTML 502 is not the mint refusing the request. Keep the
         pending bearer outputs so the same idempotent request can be retried. */
      throw new Error(`mint gateway returned a non-JSON error (${response.status}); request preserved for retry`);
    }
    if (!body || typeof body.error !== "string" || !body.error) {
      throw new Error(`mint returned an invalid error response (${response.status}); request preserved for retry`);
    }
    return body.error;
  }

  /* POST a body, and if the mint answers "early access", sign a NIP-98 proof
     and send it once more. The mint's own words are carried through: they tell a
     buyer whether to install an extension, switch keys, or simply wait. */
  async function postSigned(target, body) {
    const url = new URL(target, root.location ? root.location.href : undefined).href;
    const send = (header) => fetch(url, {
      method: "POST",
      headers: header
        ? { "content-type": "application/json", Authorization: header }
        : { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const first = await send(null);
    if (first.ok) return first;
    const detail = await refusal(first);
    if (!/early access/i.test(detail)) return { ok: false, status: first.status, detail };

    let header = null;
    let declined = false;
    try { header = await nip98Header(url, "POST"); } catch { declined = true; }
    if (!header) {
      return { ok: false, status: first.status, detail: earlyAccessAdvice(detail, declined) };
    }
    const second = await send(header);
    if (second.ok) return second;
    return { ok: false, status: second.status, detail: await refusal(second) };
  }

  /* Telling someone to install what they already have is worse than saying
     nothing, so a declined prompt gets its own sentence. */
  const earlyAccessAdvice = (detail, declined) => {
    if (declined) {
      return "early access: your nostr extension did not sign the request — the signature is "
        + "what proves your key is on the list, so the sale cannot go ahead without it";
    }
    return /sign the request/i.test(detail)
      ? "early access: this sale is open to a few keys first — install a nostr extension "
        + "and sign in with a key that is on the list"
      : detail;
  };

  async function buyBoosterUnlocked(mintUrl, opts = {}) {
    const c = await cashu();
    let state = await identity(c);
    if (state.pending) {
      const keysetForPending = await getKeyset(state.pending.mintUrl, c);
      return awaitSettlement(state, c, keysetForPending, opts);
    }
    const keyset = await getKeyset(mintUrl, c);
    const quote = await requestQuote(mintUrl);
    const outputs = Array.isArray(quote.cards) ? boosterOutputs(quote.cards, state, c, keyset) : [];
    const saved = outputs.map(savedOutput);
    const pending = { type: "booster", mintUrl, outputs: saved, body: {
      idempotency_key: root.crypto.randomUUID(),
      pack_id: quote.pack_id,
      state: quote.state,
      /* Absent on a free mint, required on a paid one. Carried inside the
         pending so a resumed sale claims the invoice it was quoted against. */
      payment_hash: quote.payment_hash,
      outputs: saved.map(requestOutput),
    } };
    state = { ...state, pending };
    write(state);
    /* A paid mint hands back an invoice the buyer settles in their own wallet.
       Show it, then wait — nothing here ever touches their credentials. */
    if (quote.paid && quote.payment_request && typeof opts.onInvoice === "function") {
      opts.onInvoice({
        paymentRequest: quote.payment_request,
        paymentHash: quote.payment_hash,
        priceMsat: quote.price_msat,
        testMint: Boolean(quote.test_mint),
      });
    }
    return awaitSettlement(state, c, keyset, opts);
  }

  const buyBooster = (mintUrl, opts) => locked(() => buyBoosterUnlocked(mintUrl, opts || {}));

  /* Decode PER TOKEN, and survive one that cannot be decoded.
   *
   * This used to be a bare flatMap over getDecodedToken, so a single token this
   * mint cannot read threw and took the WHOLE wallet with it. That is not a
   * rare state: a token minted before a mint's keyset rotated, or one bought
   * from a different mint entirely — staging, say — can never decode against
   * this keyset, ever. One of those made snapshot() throw, which blanked the
   * wallet page, permanently dropped the Stack Builder out of OG mode, and made
   * every trade impossible. The only escape was clearing storage, which throws
   * away every good card along with the bad one.
   *
   * A card this mint cannot read is not the same as a card that does not exist.
   * The unreadable ones are counted and handed back so the page can say how
   * many there are and where they probably came from, instead of a wallet full
   * of cards silently reporting nothing at all. */
  async function claimBoosterUnlocked(mintUrl, paymentHash, opts = {}) {
    const c = await cashu();
    let state = await identity(c);
    if (state.pending) {
      if (state.pending.body.payment_hash !== paymentHash) throw new Error("finish the pending wallet operation before claiming another booster");
      return awaitSettlement(state, c, await getKeyset(state.pending.mintUrl, c), opts);
    }
    const keyset = await getKeyset(mintUrl, c);
    const pending = { type: "booster", mintUrl, outputs: [], body: {
      idempotency_key: root.crypto.randomUUID(), pack_id: null, state: null,
      payment_hash: paymentHash, outputs: [],
    } };
    state = { ...state, pending };
    write(state);
    return awaitSettlement(state, c, keyset, opts);
  }

  const claimBooster = (mintUrl, paymentHash, opts) => locked(() => claimBoosterUnlocked(mintUrl, paymentHash, opts || {}));

  async function decodeTokens(mintUrl) {
    const c = await cashu();
    const state = await read();
    const keyset = await getKeyset(mintUrl, c);
    const list = [];
    const unreadable = [];
    for (const token of state.tokens) {
      try {
        list.push(...c.getDecodedToken(token, [keyset.id]).proofs);
      } catch (error) {
        unreadable.push({ token, error: error && error.message ? error.message : String(error) });
      }
    }
    return { proofs: list, unreadable };
  }

  async function proofs(mintUrl) {
    return (await decodeTokens(mintUrl)).proofs;
  }

  /* The synchronous half of the same rule, for the paths that already hold a
     state and a keyset.
   *
   * Every one of these asks "what does this wallet hold", and every one of them
   * used its own bare flatMap. Fixing only decodeTokens left the TRADE path
   * still throwing on a dead token — which is the worst place for it, because a
   * trade is the operation a person reaches for to move a card OUT of a wallet
   * they cannot otherwise use. It was found by trying a trade with one dead
   * token in storage, not by reading the code. */
  function splitTokens(state, keyset, c) {
    const proofs = [];
    const opaque = [];
    for (const token of state.tokens) {
      try { proofs.push(...c.getDecodedToken(token, [keyset.id]).proofs); }
      catch { opaque.push(token); }
    }
    return { proofs, opaque };
  }

  const readableProofs = (state, keyset, c) => splitTokens(state, keyset, c).proofs;

  async function verifyCatalog(catalogUri, catalog, c, issuerExpected) {
    const { issuer_pubkey: issuer, signature, ...payload } = catalog || {};
    const digestHex = await digest(canonical(payload));
    if (!catalog || catalog.collection_id !== "600B-E1" || catalog.catalog_uri !== catalogUri || issuer !== issuerExpected || !signature || !c.schnorrVerifyDigest(signature, digestHex, issuer)) {
      throw new Error("catalog signature or collection validation failed");
    }
    return catalog;
  }

  async function inspectProof(mintUrl, proof, c, keyset, catalogs) {
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
    return { proof, tag, asset, state: (await stateResponse.json()).states[0].state };
  }

  async function snapshot(mintUrl) {
    /* A pending the mint refuses must not hide the cards that are fine. This ran
       uncaught, so one stuck transfer threw before a single proof was inspected
       and the whole collection vanished behind an error — the same shape as the
       unreadable-token bug, one level up. The recovery is still attempted, and
       the page has its own route to retry it. */
    try { await locked(recoverPending); } catch { /* reported by recoverPending's own caller */ }
    const c = await cashu();
    const walletState = await read();
    const keyset = await getKeyset(mintUrl, c);
    const catalogs = new Map();
    const owned = [];
    const spent = [];
    const invalid = [];
    const { proofs: readable, unreadable } = await decodeTokens(mintUrl);
    for (const proof of readable) {
      try {
        const item = await inspectProof(mintUrl, proof, c, keyset, catalogs);
        if (!c.maybeDeriveP2BKPrivateKeys(walletState.privateKey, proof).length) throw new Error("proof is not addressed to this wallet");
        (item.state === "SPENT" ? spent : owned).push(item);
      } catch (error) {
        invalid.push({ proof, error: error.message });
      }
    }
    /* `unreadable` is deliberately its own bucket and not folded into
       `invalid`: an invalid proof is one this mint HAS an opinion about and
       rejects, while an unreadable token is one it cannot even open. A page
       that conflates them tells a buyer their card is bad when the truth is
       that they are looking at the wrong mint. */
    return { catalog: catalogs.values().next().value || null, owned, spent, invalid, unreadable };
  }

  async function tradeProofUnlocked(mintUrl, secret, recipientPubkey) {
    const c = await cashu();
    let state = await identity(c);
    /* REFUSE, do not silently finish something else. This used to call
       submitPending and hand back THAT token — so asking to send card X while an
       older transfer was unfinished completed the older trade and returned a
       token for card Y. The caller had every reason to believe it had just sent
       X. Finishing a pending is a deliberate act with its own entry point. */
    if (state.pending) {
      throw new Error("finish the transfer already in progress before starting another");
    }
    const keyset = await getKeyset(mintUrl, c);
    const all = readableProofs(state, keyset, c);
    const index = all.findIndex((proof) => proof.secret === secret);
    if (index < 0) throw new Error("card is not in this wallet");
    const oldProof = all[index];
    const keys = c.maybeDeriveP2BKPrivateKeys(state.privateKey, oldProof);
    if (!keys.length) throw new Error("wallet cannot derive the P2BK spending key");
    const signed = c.signP2PKProof(oldProof, keys[0]);
    const tag = c.getTag(oldProof.secret, "nutft");
    if (typeof recipientPubkey !== "string") throw new Error("recipient P2BK public key is required");
    c.pointFromHex(recipientPubkey);
    const output = c.OutputData.createSingleP2PKData({
      pubkey: recipientPubkey,
      blindKeys: true,
      additionalTags: [["nutft", ...tag]],
    }, 1, keyset.id);
    const saved = savedOutput(output);
    const pending = { type: "trade", mintUrl, input_secret: oldProof.secret, outputs: [saved], body: { idempotency_key: root.crypto.randomUUID(), inputs: c.serializeProofs([signed]), outputs: [requestOutput(saved)] } };
    state = { ...state, pending };
    write(state);
    return submitPending(state, c, keyset);
  }

  const tradeProof = (mintUrl, secret, recipientPubkey) => locked(() => tradeProofUnlocked(mintUrl, secret, recipientPubkey));

  async function destinationUnlocked() {
    const c = await cashu();
    return (await identity(c)).pubkey;
  }

  const destination = () => locked(destinationUnlocked);

  async function importTokenUnlocked(mintUrl, token) {
    const c = await cashu();
    let state = await identity(c);
    if (state.pending) await submitPending(state, c, await getKeyset(state.pending.mintUrl, c));
    state = await read();
    const keyset = await getKeyset(mintUrl, c);
    const decoded = c.getDecodedToken(token, [keyset.id]);
    if (decoded.mint !== mintUrl || decoded.unit !== "600B-E1" || !decoded.proofs.length) throw new Error("token mint, unit, or proofs are invalid");
    /* The token being imported above may still throw — a caller pasting a
       broken token deserves to hear so. But the wallet it is landing in must
       not: a dead token already in storage cannot be allowed to block an
       import, or a person is stuck with it forever. */
    const existing = new Set(readableProofs(state, keyset, c).map((proof) => proof.secret));
    const incoming = new Set();
    const catalogs = new Map();
    for (const proof of decoded.proofs) {
      if (existing.has(proof.secret)) throw new Error("token is already in this wallet");
      if (incoming.has(proof.secret)) throw new Error("token contains a duplicate proof");
      incoming.add(proof.secret);
      const item = await inspectProof(mintUrl, proof, c, keyset, catalogs);
      if (item.state !== "UNSPENT" || !c.maybeDeriveP2BKPrivateKeys(state.privateKey, proof).length) throw new Error("token is spent or not addressed to this wallet");
    }
    write({ ...state, tokens: [...state.tokens, token] });
    return decoded.proofs.length;
  }

  const importToken = (mintUrl, token) => locked(() => importTokenUnlocked(mintUrl, token));

  async function exportBackup() {
    const state = await read();
    return JSON.stringify({ format: "600b-nutft-wallet-v1", wallet: state }, null, 2);
  }

  async function restoreBackupUnlocked(text) {
    let backup;
    try { backup = JSON.parse(text); }
    catch { throw new Error("wallet backup is not valid JSON"); }
    if (backup?.format !== "600b-nutft-wallet-v1" || !validState(backup.wallet)) throw new Error("wallet backup has an invalid format");
    const current = await read();
    if (current.tokens.length || current.pending) throw new Error("restore requires an empty wallet so existing bearer assets are not overwritten");
    write(backup.wallet);
    return backup.wallet.tokens.length;
  }

  const restoreBackup = (text) => locked(() => restoreBackupUnlocked(text));

  root.NutFTWallet = { buyBooster, claimBooster, snapshot, tradeProof, importToken, destination, recoverPending, outgoing, forgetOutgoing, exportBackup, restoreBackup, read, cashu, hex, bytes };
})(globalThis);
