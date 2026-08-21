/* Player-facing checkout failures, kept separate from shop.js so the words can
 * be tested without booting the whole page. The raw error remains visible as a
 * diagnostic, but the first line always says what the buyer can do next. */
(function (root) {
  "use strict";

  function describe(error, context = {}) {
    const technical = String(
      (error && error.message) || error || "unknown checkout error",
    );
    const signerMissing = /NIP-07 signer|install a nostr extension|sign the request/i.test(technical);

    if (context.sales === "signed" && signerMissing) {
      return {
        code: "SIGNER_REQUIRED",
        title: "Nostr signer needed.",
        action: "Add or unlock a NIP-07 signer (Alby or nos2x), then press Buy again. "
          + "Any nostr key works here — there is no allowlist.",
        safety: "Checkout stopped before Lightning. No invoice was created and no sats moved.",
        technical,
      };
    }

    return {
      code: "CHECKOUT_FAILED",
      title: "Checkout stopped.",
      action: "Try again. If it stops at the same place, copy the diagnostic below.",
      safety: context.invoiceShown
        ? "An invoice was created. Check your wallet before starting another payment."
        : "No payment was confirmed and no cards were issued.",
      technical,
    };
  }

  function render(note, error, context = {}) {
    const result = describe(error, context);
    const doc = note.ownerDocument || root.document;
    note.className = "pack-note purchase-error is-error";
    note.textContent = "";
    if ("innerHTML" in note) note.innerHTML = "";
    else if (Array.isArray(note.children)) note.children.length = 0;
    note.setAttribute("role", "alert");
    note.setAttribute("aria-live", "assertive");

    const title = doc.createElement("strong");
    title.textContent = result.title;
    const action = doc.createElement("div");
    action.textContent = result.action;
    const safety = doc.createElement("div");
    safety.className = "purchase-error__safety";
    safety.textContent = result.safety;
    const diagnostic = doc.createElement("code");
    diagnostic.className = "purchase-error__diagnostic";
    diagnostic.textContent = `${result.code} · ${result.technical}`;
    note.append(title, action, safety, diagnostic);
    return result;
  }

  root.E1MintErrors = { describe, render };
})(globalThis);
