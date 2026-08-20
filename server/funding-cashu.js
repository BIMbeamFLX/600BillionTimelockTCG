"use strict";

/* A funding source that needs no Lightning node at all.
 *
 * A public Cashu mint will hand anyone a real BOLT11 invoice on request — that
 * is what a NUT-4 mint quote IS. So the shop asks a mint for an invoice, the
 * buyer pays it with any Lightning wallet (Phoenix included), and when it
 * settles the mint issues ecash to us. No channels, no macaroon, no node, no
 * account, no API key. Verified live against a public mint: min_amount 1 sat.
 *
 * WHAT THIS COSTS, said plainly: between "invoice paid" and "we melt out", the
 * sats are held by the mint operator, not by us. They can go offline, lose the
 * database, or refuse to pay out. This is the same trust a custodial wallet
 * asks for. It is a reasonable trade at 21 sats a pack and an unreasonable one
 * for a treasury, so sweep regularly and never let a balance grow large.
 *
 * The rule that is easy to get wrong: checking that a quote is PAID is NOT
 * taking the money. The mint owes us ecash at that point and quotes expire —
 * if we never call mintProofs the payment is confirmed and lost. So isSettled()
 * mints and persists the proofs before it reports true, and reports false if
 * minting failed. Proofs are bearer instruments: the row IS the money. */

const DDL = `
CREATE TABLE IF NOT EXISTS nutft_treasury (
  quote_id    TEXT PRIMARY KEY,
  amount_sat  INTEGER NOT NULL,
  mint_url    TEXT NOT NULL,
  proofs_json TEXT NOT NULL,
  minted_at   TEXT NOT NULL
);
`;

function createCashuFunding(options = {}) {
  const mintUrl = (options.mintUrl || process.env.NUTFT_CASHU_MINT || "").replace(/\/$/, "");
  if (!mintUrl) throw new Error("NUTFT_FUNDING=cashu needs NUTFT_CASHU_MINT (a mint URL)");
  if (!/^https:\/\//i.test(mintUrl)) throw new Error("NUTFT_CASHU_MINT must be https");
  const db = options.db || null;
  if (db) db.exec(DDL);

  const q = db ? {
    get: db.prepare("SELECT quote_id FROM nutft_treasury WHERE quote_id = ?"),
    put: db.prepare("INSERT OR IGNORE INTO nutft_treasury (quote_id, amount_sat, mint_url, proofs_json, minted_at) VALUES (?, ?, ?, ?, ?)"),
  } : null;

  let walletPromise = null;
  const wallet = () => (walletPromise ||= (async () => {
    const cashu = await import("@cashu/cashu-ts");
    const w = new cashu.Wallet(mintUrl, { unit: "sat" });
    await w.loadMint();
    return { w, cashu };
  })());

  const sats = (amountMsat) => {
    if (amountMsat % 1000 !== 0) {
      /* A mint quote is denominated in whole sats. Rounding here would silently
       * charge a different price than the one advertised. */
      throw new Error(`a Cashu mint can only price whole sats; ${amountMsat} msat is not a whole number of sats`);
    }
    return amountMsat / 1000;
  };

  return {
    name: "cashu",
    virtual: false,
    custodial: true,
    mintUrl,

    async createInvoice({ amountMsat }) {
      /* Validate the amount before opening a connection: a bad price is a
       * configuration error and should surface as one, not as a network fault
       * from a mint that was never going to be asked a sensible question. */
      const amountSat = sats(amountMsat);
      const { w } = await wallet();
      const quote = await w.createMintQuoteBolt11(amountSat);
      if (!quote || !quote.request || !quote.quote) throw new Error("mint returned no usable quote");
      /* The identifier is the QUOTE ID, not a payment hash — a mint quote is
       * not addressed by payment hash. The funding interface treats it as an
       * opaque handle, which is why the mint's validation accepts both shapes. */
      return { paymentRequest: quote.request, paymentHash: quote.quote };
    },

    async isSettled(quoteId) {
      /* Already taken possession: the money is ours and recorded. */
      if (q && q.get.get(quoteId)) return true;

      const { w, cashu } = await wallet();
      const state = await w.checkMintQuoteBolt11(quoteId);
      const paid = state && (state.state === cashu.MintQuoteState.PAID || state.state === "PAID");
      const issued = state && (state.state === cashu.MintQuoteState.ISSUED || state.state === "ISSUED");

      /* ISSUED without a treasury row means we minted and then lost the proofs
       * — the sats are gone and no retry recovers them. Do not hand over a pack
       * for money we cannot show; surface it so a human looks. */
      if (issued) {
        console.error(`[nutft] cashu quote ${quoteId} is ISSUED but no proofs are stored — possible lost mint`);
        return false;
      }
      if (!paid) return false;

      /* PAID means the mint owes us ecash. Take it now: quotes expire, and a
       * confirmed payment we never minted is a payment we gave away. */
      const amount = Number(state.amount || 0);
      let proofs;
      try {
        proofs = await w.mintProofsBolt11(amount, quoteId);
      } catch (error) {
        console.error(`[nutft] cashu mintProofs failed for ${quoteId}:`, error && error.message);
        return false;
      }
      if (!Array.isArray(proofs) || !proofs.length) return false;

      if (q) {
        q.put.run(quoteId, amount, mintUrl, JSON.stringify(proofs), new Date().toISOString());
      } else {
        /* Without a database the proofs exist only in this reply and would be
         * lost on restart. Refuse rather than quietly burn the buyer's sats. */
        throw new Error("the Cashu funding source needs a database to store the ecash it receives");
      }
      return true;
    },

    /* What the mint currently holds for us, so a sweep can be scheduled and the
     * balance never becomes a surprise. */
    balanceSat() {
      if (!db) return 0;
      const row = db.prepare("SELECT COALESCE(SUM(amount_sat), 0) AS total FROM nutft_treasury").get();
      return Number(row ? row.total : 0);
    },
  };
}

module.exports = { createCashuFunding, DDL };
