/* ---------------------------------------------------------------------------
 * matchmaking.js — the website's online lobby page.
 *
 * The lobby itself (sign-in, the queue, create/join by code, challenge-by-npub,
 * the invite and resume lists) is site/lobby.js, which the table mounts inside
 * the Hangar too. This page mounts it into #online and keeps the one thing only
 * the website does with a dealt seat: it leaves for the table.
 *
 * THE ONE DIVERGENCE FROM play.js. When the referee seats you it sends a STATE.
 * net.js has already written the session to sessionStorage `600b:match` BEFORE
 * the lobby's handler runs (net.js saveMatch, on every STATE with a seat), and
 * sessionStorage survives a same-tab navigation — so instead of flipping a
 * hidden `#table` into view the way play.js does, this page navigates to
 * play.html. That page boots, net.js reads the saved session, RESUMEs by the
 * signed identity (no token to marshal — the AUTH-proven npub is the claim),
 * and the referee re-sends the full STATE. A found match is a page change, and
 * the seat is never lost because the referee, not the browser, remembers it.
 * ------------------------------------------------------------------------- */
(() => {
  "use strict";

  const NET = globalThis.E1Net;
  let lobby = null;
  const notice = (text, tone) => { if (lobby) lobby.notice(text, tone); };

  /* The seat is dealt: leave the lobby for the table. net.js already saved the
   * session; the ?match=/?code= are a belt-and-braces fallback the table reads
   * only if the store was somehow lost. Shell-aware: assign, then href, then a
   * link the player can press — a host that refuses a location rewrite must not
   * read as a hang. */
  let handingOff = false;
  function handOff(msg) {
    if (handingOff) return;
    handingOff = true;
    const q = msg && msg.matchId
      ? "?match=" + encodeURIComponent(msg.matchId) + (msg.code ? "&code=" + encodeURIComponent(msg.code) : "")
      : "";
    const url = "play.html" + q;
    notice("Your seat is ready — opening the table…", "good");
    try { location.assign(url); return; } catch (error) { /* fall through */ }
    try { location.href = url; return; } catch (error) { /* fall through */ }
    handingOff = false;
    notice(`Your seat is ready. Open the table: ${url}`, "good");
  }

  function boot() {
    const root = document.getElementById("online");
    if (!NET || !globalThis.E1Lobby) {
      if (root) root.textContent = "The lobby did not load — reload the page.";
      return;
    }
    lobby = globalThis.E1Lobby.mount(root, NET, { embedded: false, onSeat: handOff });
  }

  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
