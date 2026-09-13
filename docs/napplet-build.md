# The napplet build

- Build: with the venv active, `python scripts/build_napplet.py` (or `npm run build:napplet`). Output: `dist/napplet/600b-timelock-tcg/index.html` plus `.nip5a-manifest.json`. `dist/` is gitignored.
- Manifest: kind 35129, unsigned template (`created_at: 0`), tags `d`, `title`, `description`, one `path` per file with its sha256, `x` = sha256 over the sorted `<sha> <path>\n` lines (the rule `@napplet/vite-plugin` uses), one `requires` per NAP domain.
- Inlined: every `<script src>` of `site/play.html` (napplet, engine, npc, both card catalogs, blob map, faces, face geometry, precons, fx, schnorr, net, portraits, play) plus the Anton font and the hero image as data URLs.
- Left out: `nutft-wallet.js` (imports esm.sh at runtime), `qr.js`, `bugreport.js`, `nostr-id.js`, the masthead logo and the four affinity world plates (they would push the file past 3 MB). `play.js` degrades without each of them.
- Not bundled by design: card faces. `faces.js` keeps fetching them by hash from the Blossom mirrors.
- Head additions: `window.E1_NAPPLET_BUILD` (sha256 of the source `play.html`) and `<meta name="napplet-requires" content="identity,outbox,resource,storage,intent">`.
- How the host loads it: the nappelin Hangar injects `window.napplet` and sets the file as `srcdoc` of an `<iframe sandbox="allow-scripts">`. `E1Napplet.embedded()` sees the object, `play.html` adds `html.embedded`: site chrome hidden, nappelin tokens painted, background layers absolute, every link routed to `E1Napplet.escape()`.
- Local preview without a host: open `site/play.html?embed=1`.
- Size guard: the script prints the size and exits 1 above 3 MB. Tests: `tests/test_build_napplet.py`.
