/* ---------------------------------------------------------------------------
 * bugreport.js — the bug button in the top bar.
 *
 * A report is published as a signed nostr event (NIP-34 issue, kind 1621)
 * rather than posted to an endpoint of ours. Three reasons, in order of how
 * much they matter:
 *
 *   The bounty needs an identity. 210 sats per valid bug has to be payable to
 *   somebody, and a signed event names its author without us running an
 *   account system or storing a single email address.
 *
 *   It cannot be quietly dropped. A report that lands on relays is a report we
 *   cannot lose, forget, or be accused of ignoring — the reporter holds the
 *   same copy we do.
 *
 *   It survives us. Kind 1621 is the NIP-34 issue kind, so the reports are
 *   readable by nostr git tooling instead of only by a script we wrote.
 *
 * The server never sees any of this: server/table.js states that it never opens
 * a relay connection, and that stays true — only the browser talks to relays.
 *
 * Without a NIP-07 extension there is no signature and therefore no bounty, so
 * the dialog says so plainly and still lets the report be copied out by hand.
 * A person who found a bug should never hit a dead end because they lack a
 * browser extension.
 * ------------------------------------------------------------------------- */
(function (root) {
  "use strict";

  const KIND = 1621;              // NIP-34 issue
  const BOUNTY_SATS = 210;
  const PROJECT = "600B Timelock TCG";

  const doc = root.document;
  if (!doc || !doc.createElement) return;   // no DOM: nothing to attach to

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  /* A bug is worth reporting precisely when something is not working, so this
   * has to survive the page being broken. Everything below is defensive on
   * purpose: a throw here would take the report with it. */
  function context() {
    const out = {};
    try { out.page = root.location ? root.location.href : ""; } catch { /* sandboxed */ }
    try { out.agent = root.navigator ? root.navigator.userAgent : ""; } catch { /* ignore */ }
    try { out.viewport = `${root.innerWidth}x${root.innerHeight}`; } catch { /* ignore */ }
    try { out.at = new Date().toISOString(); } catch { /* ignore */ }
    return out;
  }

  /* Console errors are the single most useful thing a reporter can hand over and
   * the one thing they will never think to include. Captured from load, capped,
   * and only ever sent as part of a report the person deliberately submits. */
  const seenErrors = [];
  const noteError = (text) => {
    if (!text) return;
    const line = String(text).slice(0, 300);
    if (seenErrors.length < 5 && !seenErrors.includes(line)) seenErrors.push(line);
  };
  try {
    root.addEventListener("error", (event) => noteError(event && event.message));
    root.addEventListener("unhandledrejection", (event) => {
      const reason = event && event.reason;
      noteError(reason && reason.message ? reason.message : reason);
    });
  } catch { /* some shells forbid listeners; the report still works without */ }

  function reportText(what) {
    const ctx = context();
    const lines = [what.trim(), "", `— ${PROJECT}`];
    if (ctx.page) lines.push(`page: ${ctx.page}`);
    if (ctx.viewport) lines.push(`viewport: ${ctx.viewport}`);
    if (ctx.agent) lines.push(`agent: ${ctx.agent}`);
    if (seenErrors.length) lines.push("", "console:", ...seenErrors.map((e) => `  ${e}`));
    return lines.join("\n");
  }

  async function publishReport(what) {
    const NET = root.E1Net;
    const nostr = root.nostr;
    if (!nostr || typeof nostr.signEvent !== "function") throw new Error("NO_SIGNER");
    if (!NET || typeof NET.publish !== "function") throw new Error("NO_RELAYS");

    const ctx = context();
    const pubkey = await nostr.getPublicKey();
    const unsigned = {
      kind: KIND,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      content: reportText(what),
      tags: [
        ["subject", what.trim().split("\n")[0].slice(0, 80) || "bug report"],
        ["t", "600b-bug"],
        ["client", PROJECT],
        ...(ctx.page ? [["r", ctx.page]] : []),
      ],
    };
    const signed = await nostr.signEvent(unsigned);
    const accepted = await NET.publish(signed);
    if (!accepted || (Array.isArray(accepted) && !accepted.length)) throw new Error("NO_RELAY_ACCEPTED");
    return signed;
  }

  function openDialog() {
    if (doc.getElementById("bugDialog")) return;

    const wrap = el("div", "bug-modal");
    wrap.id = "bugDialog";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Report a bug");

    const panel = el("div", "bug-panel");
    panel.append(el("h2", null, "Report a bug"));
    panel.append(el("p", "bug-sub",
      `${BOUNTY_SATS} sats for every valid bug we can fix from your report. `
      + "Say what you did, what you expected, and what happened instead."));

    const box = doc.createElement("textarea");
    box.id = "bugText";
    box.rows = 7;
    box.placeholder = "I clicked Buy a booster on the shop page and the invoice never appeared…";
    panel.append(box);

    const status = el("p", "bug-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const signer = root.nostr && typeof root.nostr.signEvent === "function";
    if (!signer) {
      status.textContent = "No nostr extension found — you can still copy the report and send it to us, "
        + "but the bounty needs a signature so we know who to pay.";
    }

    const row = el("div", "bug-row");
    const send = el("button", "btn", signer ? "Sign and send" : "Copy report");
    send.type = "button";
    const cancel = el("button", "btn btn--ghost", "Cancel");
    cancel.type = "button";
    row.append(send, cancel);
    panel.append(row, status);
    wrap.append(panel);
    doc.body.append(wrap);
    box.focus();

    const close = () => { wrap.remove(); doc.removeEventListener("keydown", onKey); };
    const onKey = (event) => { if (event.key === "Escape") close(); };
    doc.addEventListener("keydown", onKey);
    cancel.addEventListener("click", close);
    wrap.addEventListener("click", (event) => { if (event.target === wrap) close(); });

    send.addEventListener("click", async () => {
      const what = box.value.trim();
      if (what.length < 12) {
        status.textContent = "A few more words, so we can actually reproduce it.";
        return;
      }
      if (!signer) {
        const text = reportText(what);
        try {
          await root.navigator.clipboard.writeText(text);
          status.textContent = "Copied. Send it to us however you like.";
        } catch {
          box.value = text;
          box.select();
          status.textContent = "Copy the text above and send it to us.";
        }
        return;
      }
      send.disabled = true;
      status.textContent = "Signing…";
      try {
        await publishReport(what);
        status.textContent = `Sent. If we can fix it from your report, ${BOUNTY_SATS} sats are yours.`;
        send.textContent = "Thank you";
        setTimeout(close, 2600);
      } catch (error) {
        send.disabled = false;
        const code = error && error.message;
        status.textContent = code === "NO_RELAYS"
          ? "This page cannot reach a relay. Copy your text and send it to us instead."
          : code === "NO_RELAY_ACCEPTED"
            ? "No relay accepted the report. Try again in a moment."
            : "Your extension did not sign it — no report was sent.";
      }
    });
  }

  function mount() {
    if (doc.getElementById("bugButton")) return;
    const button = el("button", "bug-button", "");
    button.id = "bugButton";
    button.type = "button";
    button.title = `Report a bug — ${BOUNTY_SATS} sats for every valid one`;
    button.setAttribute("aria-label", `Report a bug. ${BOUNTY_SATS} sats bounty for every valid bug.`);
    /* Inline so the icon cannot arrive late or fail to load — this is the button
     * people reach for when other things are already broken. */
    button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"'
      + ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
      + '<path d="M8 6a4 4 0 0 1 8 0"/><rect x="7" y="8" width="10" height="11" rx="5"/>'
      + '<path d="M3 11h4M17 11h4M3 17h4M17 17h4M12 8v11"/></svg>';
    button.addEventListener("click", openDialog);

    const links = doc.querySelector(".nav__links");
    if (links) links.append(button);
    else { button.classList.add("bug-button--float"); doc.body.append(button); }
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mount);
  else mount();

  root.E1Bug = { open: openDialog, KIND, BOUNTY_SATS };
})(globalThis);
