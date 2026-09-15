# The bar (`site/rail.js`)

The bar is the Hypershell rail from nappelin's design handoff, carried into the TCG: five buttons at
the edge of every page — **Account, Music, Wallet, Chat, Share** — each opening a small panel. It is
chrome, so it speaks Hypershell (iron ground, brass voice, IBM Plex Mono, Josefin Sans titles, square
corners, no shadow). The one brand mark on it is the 600 Billion number on the Account button.

It is not a sixth page and not a menu. Each panel is built once and kept for the life of the page:
opening one shows it, closing hides it, nothing is torn down.

## Adding it to a page

One tag, in `<head>`, after `napplet.js` and before the page's first app script. Not `defer`:

```html
<script src="napplet.js"></script>
<script src="rail.js"></script>
```

That is all. The script:

- injects its own `<style id="tcg-rail-css">` built from the contract tokens, each with a literal
  fallback (`var(--iron, #0f0c08)`), so a page without `600b.css` (play.html) draws the same bar;
- sets `data-tcg-rail="<edge>"` on `<html>` immediately, which pads `<body>` on the bar's edge before
  the first paint — nothing on the page shifts when the bar arrives;
- builds the bar at `DOMContentLoaded` and appends it to the end of `<body>`.

A page that loads `rail.js` does not need `nostr-id.js`: the Account panel replaces the old sign-in
chip, and `nostr-id.js` injects nothing where `E1Rail` exists (it only keeps wiring a chip a page still
writes into its own markup). Every page that used to load `nostr-id.js` now loads `rail.js`.

Loading `rail.js` twice is harmless: the second include changes nothing.

## The edge

| Edge | Size | Published on `<html>` |
| --- | --- | --- |
| `right` (default) | 104px wide | `--tcg-rail-right: 104px` |
| `bottom` (default under 700px wide) | 64px tall, plus the bottom safe-area inset | `--tcg-rail-bottom` |
| `left` | 104px wide | `--tcg-rail-left: 104px` |
| `top` | 64px tall | `--tcg-rail-top: 64px` |

The **Move** button at the end of the bar cycles right → bottom → left → top and remembers the choice
in `localStorage` as `600b:rail`. Without a stored choice the bar follows the window: bottom under
700px, right otherwise. Storage that refuses to keep anything only costs the bar its memory.

The body gets `padding` equal to the four variables, so in-flow content never sits under the bar. A
page with its own **fixed** chrome near an edge reads the same variables to stay clear, e.g.
`right: calc(18px + var(--tcg-rail-right, 0px))` (intro.html does this for its film and Skip button).
The bar handles the two pieces of site-wide fixed chrome itself: the sticky `.nav` moves below a top
bar, and the floating bug button (`.bug-button--float`) moves clear of a right or bottom bar.

Stacking: the bar sits at `z-index: 55` — above page content and the effect layers, below every page
dialog, card menu and overlay (60 and up), which cover it while they are open.

## The panels

- **Account** — sign in, who is signed in, sign out. It uses the same doors as the table, in order:
  `E1Net.nostr` where the page has net.js, `E1Napplet.identity` where it does not, a bare NIP-07
  extension last — all three keep the key under `600b:pubkey`. Without an extension the panel says,
  verbatim, "No compatible browser extension found. You can play as a guest." The label reads
  SIGN IN, GUEST (the player chose to play as a guest this tab session) or ACCOUNT. A display name
  appears only where net.js can verify the profile's signature; elsewhere the short npub stands.
- **Music** — where `E1FX` is on the page (play.html) the table mounts its sound controls into
  `E1Rail.slot("music")`. Elsewhere: "Sound plays at the table." and a link to play.html. The label
  reads PAUSED while the table's sound is muted, PLAYING only while its room tone actually runs,
  MUSIC otherwise.
- **Wallet** — the NutFT card wallet at a glance: cards held and how many are different, whether the
  site's own mint answers, and cards sent but not yet marked delivered. When storage
  (`600b:nutft-wallet`, or the page's `NUTFT_STORE`) holds no card token at all, the panel says "No
  cards on this device yet." and nothing is loaded or asked: no `nutft-wallet.js`, no mint. Otherwise
  `nutft-wallet.js` loads the first time the panel opens, never with the page. The count comes from
  the same `snapshotMany` wallet.html reads, and only when the page's origin answers `/v1/info` with
  the NutFT capability; otherwise the numbers are dashes and the panel says "Not available here
  yet." The E1 mint's `/v1/info` says nothing about Edition G, so the G mint (`/g`) is counted only
  when a stored token names it — a token carries its mint's URL — and an origin that never issued a
  G card is never asked for one. An unfinished transfer or booster is never counted over — counting
  would finish it first, and that belongs to wallet.html. The brass blinking dot on the button (cards
  sent, not yet delivered) is read straight from storage, so it is right without loading anything.
- **Chat** — "Chat lives in Nappelin." and a link to `https://nappelin.com/hangar/` in a new tab. No
  rooms, no input, nothing pretending to be live.
- **Share** — the current page's link with only `rules` and `arena` kept (values of letters, digits,
  `-` and `_`); `match`, `code`, `table`, `relay`, keys, credentials, every other parameter and the
  fragment are dropped. Copy link, and a QR from `qr.js`, loaded the first time Share opens.

Keyboard and pointer: every button is a real `<button>` with `aria-expanded` and `aria-controls`.
Opening a panel moves focus into it; Escape or the × closes it and returns focus to its button; a
second click on the button closes it; a click or focus outside the bar closes it and leaves focus
where it went. One Escape closes one layer: while a panel is open the bar takes that Escape, and the
page's own Escape handling waits for the next one. The rise when a panel opens is the only motion
(`.18s ease-out`), and `prefers-reduced-motion` removes it.

## The API

`rail.js` is a classic script and exposes `globalThis.E1Rail`:

| Call | Answer |
| --- | --- |
| `E1Rail.slot(name)` | The panel's own mount point (`"account"`, `"music"`, `"wallet"`, `"chat"`, `"share"`): the same element on every call, created before the page even has a body. `null` for any other name. |
| `E1Rail.open(name)` | Opens that panel and moves focus into it. `true` if it opened. |
| `E1Rail.close()` | Closes whatever is open. |
| `E1Rail.setBadge(name, state)` | `"wallet"`: `"pending"` lights the brass dot, `null` returns it to what storage says. `"music"`: `"playing"` or `"paused"` set the label, `null` returns it to what `E1FX` says. Anything else returns `false` — including `"account"`. |
| `E1Rail.edge()` | `"right"`, `"bottom"`, `"left"` or `"top"`. |

The table mounts its sound controls like this (play.js):

```js
const railMusic = globalThis.E1Rail ? E1Rail.slot("music") : null;
E1FX.init({ control: true, parent: railMusic || document.getElementById("fxControl") });
```

## Events

Both travel on `window` as `CustomEvent`s.

**`e1:identity` — the bar tells the page who is signed in.** `detail: { pubkey: "<64 hex>" | null }`.

- After every successful sign-in in the Account panel, with the new key.
- After a sign-out in the Account panel, with `null` (only when the key really was forgotten).
- Once after load, with the saved key, if one is saved. Nothing is sent at load for a signed-out
  page. The load-time event is sent in a task after `DOMContentLoaded`, so a page that starts
  listening from its own `DOMContentLoaded` init still hears it.

A refused or cancelled sign-in sends nothing. The event is about the bar's own actions: a page that
signs in through its own control already knows.

play.html and matchmaking.html keep one door: where the bar is drawn, their **Sign in with nostr**
button opens the Account panel instead of asking the signer itself, and their own Sign out is hidden.
Where the bar is inert (inside a napplet), both buttons sign in and out as before. The table resumes a
saved seat and re-opens its lobby on it:

```js
window.addEventListener("e1:identity", (event) => {
  const pubkey = event.detail.pubkey; // hex, or null after a sign-out
  // resume the saved seat, or leave it
});
```

**`e1:auth` — the page tells the bar whether the table accepted the login.** `detail: { ok: true | false }`,
sent by play.js and matchmaking.js when the referee's answer flips: `ok: true` on AUTH_OK, `ok: false`
when the seat closes, retries, is superseded or is left, or the player signs out (which ends the
table's session).

```js
window.dispatchEvent(new CustomEvent("e1:auth", { detail: { ok: true } }));
```

## The embed rule

Inside a napplet shell the bar does nothing: `E1Napplet.embedded()` is true (a `window.napplet`, a
`nappletContext`, or `?embed=1`), and the Hangar draws its own bar around the frame. No style, no
padding, no listeners, no storage read. `E1Rail` still exists there, inert — `slot()` answers `null`,
`open()` answers `false` — so `E1Rail.slot("music") || fallback` works everywhere. The napplet build
leaves `rail.js` out entirely (`OMITTED_SCRIPTS` in `scripts/build_napplet.py`).

## The green rule

The account dot is the only green (`--signal`) this site draws, and exactly one thing lights it: an
`e1:auth` event whose `detail.ok` is `true` — the referee accepted the player's signed table login.
A truthy value that is not `true` does nothing, and `setBadge` cannot reach it.

Because the table sends `e1:auth` only when its answer flips, the dot follows the **last** event,
bound to the key that was signed in when that event arrived:

- `ok: false` puts it out.
- Signing out hides it — a signed-out page never shows green. Signing out also ends the table's
  session: net.js closes the socket without giving up the seat, so the table's last word becomes
  `ok: false`, and the dot stays dark after signing back in, with the same key or another, until the
  table verifies the new login (`ok: true`).
- A key signed out and back in from another tab, while this page's table login stands, shows it
  again: that login is still the verified one. A different key does not, until the table verifies it.

The Account panel says "The table has verified this key." in words under the same condition,
without a second green. The words fit the lobby, which has no seat, as well as the table.

## Tests

`node --test tests/js/rail.test.mjs` runs the script against a stand-in scope with a stub DOM:
injected once, inert when embedded, the edge cycle with persistence and the narrow default, share
scrubbing, one music slot for the life of the page, no green without `e1:auth` ok and the dot
following the table's last word for the key it verified, `e1:identity` at load (reaching a page that
listens from its own init), on sign-in and on sign-out and never on a refused sign-in, Escape closing
and returning focus, the wallet script never loading before its panel opens nor for an empty wallet,
and no `/g/` request from an origin that never issued a G card.
