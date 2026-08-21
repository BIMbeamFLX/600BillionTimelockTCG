/* ---------------------------------------------------------------------------
 * nostr-id.js — the sign-in chip in the top bar, on every page that has one.
 *
 * This lived inside index.html, which meant the front door was the only place
 * on the site where a person could say who they are. Somebody who lands on the
 * shop, buys a pack and then walks to the table had to go back to the front
 * door to sign in first. The chip is not front-door furniture: it belongs to
 * the top bar, and the top bar is on nine pages.
 *
 * ONE COPY, ON PURPOSE. Identity goes through globalThis.E1Napplet and through
 * nothing else — the shell's identity NAP inside a shell, a NIP-07 extension
 * writing 600b:pubkey on the open web, which is the same key net.js reads to
 * seat you at a table. A second implementation, however small, is a second
 * notion of who is signed in, and the two disagree the first time one of them
 * is changed. Reaching past the adapter — straight to window.nostr or to
 * localStorage — is the same mistake by a shorter route.
 *
 * The page works with none of it. No extension, no shell, no relay, storage
 * that refuses to keep anything: the chip stays, says one sentence about why,
 * and nothing here throws. Signing in buys nothing and unlocks nothing on
 * eight of the nine pages; only an online duel ever needs a key.
 *
 * Nothing here calls alert(). A napplet shell need not grant this page a modal
 * dialog, so everything sign-in has to say is said in place, in #loginNote.
 * ------------------------------------------------------------------------- */
(function (root) {
  "use strict";

  const doc = root.document;
  if (!doc || !doc.createElement) return;   // no DOM: nothing to attach to

  /* --- minimal bech32 (npub) encoder, BIP-173 ---
   * site/net.js has this too, and net.js is 56KB of match transport. A shop
   * page has no business loading match plumbing for forty lines of arithmetic,
   * so the forty lines travel with the chip instead. */
  const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(vals) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of vals) {
      const b = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  }
  function hrpExpand(hrp) {
    const out = [];
    for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
    out.push(0);
    for (const c of hrp) out.push(c.charCodeAt(0) & 31);
    return out;
  }
  function toWords(bytes) {
    const out = []; let acc = 0, bits = 0;
    for (const b of bytes) {
      acc = (acc << 8) | b; bits += 8;
      while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); }
    }
    if (bits) out.push((acc << (5 - bits)) & 31);
    return out;
  }
  /* Returns "" for anything that is not 32 hex bytes, so a junk saved value
     degrades to a blank chip instead of throwing on load. */
  function npubEncode(hex) {
    if (typeof hex !== "string" || !/^[0-9a-f]{64}$/i.test(hex)) return "";
    const bytes = hex.match(/../g).map(h => parseInt(h, 16));
    const words = toWords(bytes);
    const vals = hrpExpand("npub").concat(words, [0, 0, 0, 0, 0, 0]);
    const mod = polymod(vals) ^ 1;
    let checksum = "";
    for (let i = 0; i < 6; i++) checksum += B32[(mod >> (5 * (5 - i))) & 31];
    return "npub1" + words.map(w => B32[w]).join("") + checksum;
  }

  // ------------------------------------------------------------------- style

  /* Travels with the chip rather than sitting in nine <style> blocks, which is
     the only way the ninth page cannot drift from the other eight. Every
     colour and face is a 600b.css token; nothing below invents one. */
  const CSS = `
#loginBtn { cursor: pointer; padding: 9px 14px; background: var(--ember); color: var(--black); border: 0; font: 13px/1 var(--display); letter-spacing: .08em; text-transform: uppercase; }
#loginBtn:hover { filter: brightness(1.1); }
#who { display: none; align-items: center; gap: 9px; }
#who img { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--ember); object-fit: cover; }
#who .n { font-weight: 700; font-size: 13px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#who .k { color: var(--muted); font-size: 10px; font-family: var(--mono); }
#who button { cursor: pointer; background: none; border: 1px solid var(--line); color: var(--muted); padding: 5px 7px; font-size: 11px; }
/* Whatever sign-in has to say, said in place. A napplet shell need not grant
   modal dialogs, so alert() is not a thing these pages may depend on to tell
   somebody their extension is missing. */
#loginNote { flex-basis: 100%; color: var(--muted); font-size: 12px; }
#loginNote b { color: var(--power); }
/* "Sign-in is optional" was the button's title= — a tooltip, which a phone
   never shows and a keyboard rarely does. It was also the ONLY place the site
   said so, so it is text now, standing next to the button it describes. */
#loginWhy { margin: 0; max-width: 22ch; color: var(--ink-dim); font: 700 10px/1.4 var(--body); letter-spacing: .1em; text-transform: uppercase; }

/* Both narrow rules say the same thing to two different measurements. A phone
   is the viewport; a napplet panel 320px wide on a 27" monitor is not, and the
   pages that declare the page container are the ones that can be asked. */
@media (max-width: 359px) { #loginBtn { padding: 8px 10px; font-size: 12px; } }
@container page (max-width: 359px) { #loginBtn { padding: 8px 10px; font-size: 12px; } }
`;

  function addStyle() {
    if (doc.getElementById("nostrIdCss")) return;
    const style = doc.createElement("style");
    style.id = "nostrIdCss";
    style.textContent = CSS;
    (doc.head || doc.documentElement).append(style);
  }

  // ------------------------------------------------------------------ markup

  /* The 1x1 transparent GIF is the src a signed-out avatar carries: an <img>
     with no src at all is a broken-image icon in the top bar of every page. */
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const MARKUP = `
<button id="loginBtn" type="button">⚡ Sign in with Nostr</button>
<p id="loginWhy">Optional — only online duels need it</p>
<div id="who">
  <img id="whoPic" alt="" src="${BLANK}" referrerpolicy="no-referrer">
  <div><div class="n" id="whoName"></div><div class="k" id="whoNpub"></div></div>
  <button id="logoutBtn" type="button">sign out</button>
</div>
<p id="loginNote" role="status" hidden></p>
`;

  /* index.html carries this markup in its own source and always has. Injecting
     a second copy there would put two #loginBtn in one document, and every
     getElementById below would then be talking to whichever came first. */
  function mount() {
    const nav = doc.querySelector("nav.nav");
    if (!nav) return false;                       // a page with no top bar owns no chip
    if (!doc.getElementById("loginBtn")) {
      const links = nav.querySelector(".nav__links");
      const holder = doc.createElement("div");
      holder.innerHTML = MARKUP;
      const parts = Array.from(holder.childNodes);
      /* After the links, so the chip lands at the far end of the bar — the
         brand's margin-right:auto has already pushed everything that way. */
      if (links) links.after(...parts);
      else nav.append(...parts);
    }
    addStyle();
    return true;
  }

  // --------------------------------------------------------------- behaviour

  const RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

  function wire() {
    const els = {
      login: doc.getElementById("loginBtn"), who: doc.getElementById("who"),
      pic: doc.getElementById("whoPic"), name: doc.getElementById("whoName"),
      npub: doc.getElementById("whoNpub"), logout: doc.getElementById("logoutBtn"),
      note: doc.getElementById("loginNote"), why: doc.getElementById("loginWhy"),
    };
    if (!els.login || !els.who) return;

    /* The one seam. Identity and the key it is stored under belong to the
       adapter, not to any page: inside a shell it is the identity NAP, on the
       open web it is NIP-07 writing 600b:pubkey — the same key net.js reads to
       seat you at a table. */
    const nap = root.E1Napplet;

    const say = (text) => {
      if (!els.note) return;
      els.note.textContent = text || "";
      els.note.hidden = !text;
    };

    if (els.pic) els.pic.addEventListener("error", () => { els.pic.style.display = "none"; });

    function showUser(pubkey, profile) {
      els.login.style.display = "none";
      /* The line saying sign-in is optional belongs to the button; once somebody
         is signed in there is no button and nothing left to call optional. */
      if (els.why) els.why.hidden = true;
      els.who.style.display = "flex";
      const np = npubEncode(pubkey);
      els.npub.textContent = np ? np.slice(0, 12) + "…" + np.slice(-5) : "";
      els.name.textContent = (profile && (profile.display_name || profile.name)) || "Nostrich";
      if (profile && profile.picture) { els.pic.src = profile.picture; els.pic.style.display = "block"; }
      else els.pic.style.display = "none";
    }

    function showSignedOut() {
      els.who.style.display = "none";
      els.login.style.display = "inline-block";
      if (els.why) els.why.hidden = false;
    }

    /* Best-effort only: a sandbox with no way out, no relay, no WebSocket or a
       four-second silence all end the same way — a signed-in chip with the
       default name. No page ever waits on a relay to render. */
    function fetchProfile(pubkey) {
      return new Promise(resolve => {
        if (nap && typeof nap.canReachInternet === "function" && !nap.canReachInternet()) { resolve(null); return; }
        if (typeof WebSocket === "undefined") { resolve(null); return; }
        let done = false; const sockets = [];
        const finish = p => {
          if (done) return;
          done = true;
          for (const w of sockets) { try { w.close(); } catch (e) { /* already gone */ } }
          resolve(p);
        };
        setTimeout(() => finish(null), 4500);
        for (const url of RELAYS) {
          try {
            const ws = new WebSocket(url); sockets.push(ws);
            ws.onerror = () => { /* next relay */ };
            ws.onopen = () => ws.send(JSON.stringify(["REQ", "p", { kinds: [0], authors: [pubkey], limit: 1 }]));
            ws.onmessage = m => {
              try {
                const [type, , ev] = JSON.parse(m.data);
                if (type === "EVENT" && ev && ev.content) finish(JSON.parse(ev.content));
              } catch (e) { /* not the event we asked for */ }
            };
          } catch (e) { /* next relay */ }
        }
      });
    }

    async function login() {
      say("");
      /* napplet.js is the seam and it did not load. Saying so is the honest
         answer; guessing at window.nostr instead would sign somebody in under
         a key the rest of the site cannot see. */
      if (!nap || !nap.identity) { say("Sign-in is unavailable here — site/napplet.js did not load. Everything else on this page still works."); return; }
      let pubkey;
      try {
        pubkey = await nap.identity.login();
      } catch (err) {
        /* A missing signer is the ordinary case, not an error: the whole site
           works without one. Say which of the two it was, in place. */
        say(nap.identity.source() === "none"
          ? "No signer here. Install Alby or nos2x and reload — or just play the local hotseat, which never needs one."
          : "Sign-in did not complete: " + String((err && err.message) || err));
        return;
      }
      showUser(pubkey, null);
      showUser(pubkey, await fetchProfile(pubkey));
    }

    els.login.addEventListener("click", login);

    els.logout.addEventListener("click", async () => {
      if (!nap || !nap.identity) return void showSignedOut();
      nap.identity.forget();
      /* When the shell owns the identity there is nothing here to forget, and a
         button that visibly does nothing is worse than one that says why. */
      if (await nap.identity.current()) {
        say("This identity comes from the app shell — sign out there.");
        return;
      }
      showSignedOut();
      say("");
    });

    /* Never prompts. A signed-in chip on load means the adapter already had a
       key; no key means the button, which is exactly the signed-out state. */
    (async () => {
      if (!nap || !nap.identity) return;
      const saved = await nap.identity.current();
      if (!saved) return;
      showUser(saved, null);
      showUser(saved, await fetchProfile(saved));
    })();
  }

  function start() {
    if (mount()) wire();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
})(globalThis);
