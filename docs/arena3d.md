# Arena 3D — the WebGL table

`site/play.html?arena=3d` draws the table as a three.js scene; `?arena=dom` is the classic
DOM table, which stays a first-class fallback. Five scripts, all optional, load before
`play.js`: `site/vendor/three.js` (r0.186, `globalThis.THREE`), `site/arena3d-layout.js`
(`E1ArenaLayout`, pure, node-testable), `site/arena3d.js` (`E1Arena3D`, the scene),
`site/arena3d-fx.js` (`E1Arena3DFx`, the motion book) and `site/arena3d-env.js`
(`E1Arena3DEnv`, the room around the table). The rules engine is untouched.

## How it works

`play.js` keeps rendering the DOM exactly as before: `render()` rebuilds every zone, each
card is a `.gcard[data-uid]` with its own listeners, and `mark()` writes the state classes
(`targetable`, `canplay`, `committed`, `willdie`, …). In 3D mode those nodes become
**invisible hitboxes**: the arena owns the layout in world space and, after every `sync`
and every animation frame, projects each card's mesh to a rectangle in `.board` pixels and
writes `left/top/width/height` onto the matching node (`.board.arena3d .gcard` is
`position: absolute`). Click, drag (`installClashDrag`), `elementFromPoint`, keyboard,
screen readers, coach anchors, `drawClashArrows`, the client tests and every
`getBoundingClientRect` in `fx.js` keep working unchanged.

Numbers stay DOM: the `.gstats`, `.gcost`, `.gboot` chips inside a hitbox stay visible and
crisp; only the face `img` / `.gart` tile is hidden. Card motion (play, draw, attack,
death) is 3D; overlays (damage chips, rings, glyph rain) stay `fx.js` DOM over the canvas,
anchored to the projected hitboxes; sounds and hit-stop timing stay in `fx.js`.

The hand-off, all in `site/play.js` under `// --- 3D table`:

| moment | what play.js does |
| --- | --- |
| first `render()` of a game in 3D mode | `mountArena()`: resolves the card back through the face path, `E1Arena3D.create({ host: #board, THREE, faces.urlFor, cards, geometry, back, plates, affinity, reduced, quality: "auto", onReady, onLost })`, adds `.arena3d` to the board |
| end of every `render()` | `syncArena()`: `arena.sync(view, seat, { nodes, marks, foeHandCount, queue })` — `nodes` maps `data-uid` → node for every `.gcard`; foe hand shells get `foe-hand-N`, Queue nodes are keyed `queue:<qid>` and also passed as `queue[i].node`; then `syncStates()` calls `arena.setState(uid, {…})` from the classes on each node (with the same aliases `arena3d.js` applies: `canact`→`canplay`, `needsblock`/`canblock`→`targetable`, `blockpick`→`selected`, `meshed`→`attacking`) |
| `mouseenter`/`focus` and `mouseleave`/`blur` on a card | `arena.hover(uid)` / `arena.hover(null)` |
| `fxFlush()` | every cue `fx.js` gets is forwarded to `arena.fx.cue(name, detail)` with the same detail object (`uid`, `targetUid`, `seat`, `targetSeat`, `amount`, `lethal`, plus the `el`/`rect` fxBind added). A cue about a Queue item (`qid`) is forwarded with `uid: "queue:<qid>"`, the registry's name for it. `target:request` carries `uids` of the targetable nodes |
| `renderWithFx()` in 3D mode | skips `fxTurns()` (the commit sweep) and `fxFlight()` (the FLIP diff); `fx.js` runs with `cardMotion` answering false, so `card:play`, `resource:play`, `card:draw`, `attack:strike`, `card:archive`, `avatar:decommission` keep their sounds, rings, chips and the hit-stop delay but do not move the card node |
| `startGame` | `arena.setPlate(affinity)` — the world plate of seat one, the same one the stage wears |
| `create()` throws, `supported()` false, `onLost` | `loseArena()`: dispose, drop `.arena3d`, classic table, the line "3D table unavailable here; showing the classic table." in `#netNotice` and `#prompt`; no retry until the player picks 3D again |

`E1_GAME.arena` is the live arena (or `null`), `E1_GAME.arenaMode` the resolved mode and
`E1_GAME.setArenaMode("3d"|"dom")` switches without saving — for the proof and the console.

## The flag

Resolved once at load (`resolveArenaMode`) and again when the saved choice arrives:

1. `?arena=3d` or `?arena=dom` in the URL wins for this page load (never saved).
2. Else the saved choice: key `600b:arena`, read and written through `E1Napplet.storage`
   inside a napplet and `localStorage` on the site — the same two doors as `600b:decks`.
3. Else `3d` when `E1Arena3D.supported()` (a WebGL2 context can be created) and the player
   has not asked for `prefers-reduced-motion: reduce`; otherwise `dom`.

`3d` is only ever honoured where `supported()` is true. The "Table: 3D / Classic" select
sits in the board's control row (`#arenaTable`) and in `#setup` next to the rules
(`#arenaSetup`); both say the same thing, the choice is saved on change, and the whole
label is hidden where 3D cannot run. Switching mid-game mounts or disposes the arena on
the running table.

## Quality tiers

`arena3d-layout.js` `quality(sample)` picks a tier after a 1.5 s frame-time sample:
`high` (DPR cap 2, shadows), `mid` (DPR 1.5, shadows), `low` (DPR 1, no shadows, smaller
particle cap). The arena renders only when dirty or animating — no idle 60 fps loop.
`arena.quality("high"|"mid"|"low")` forces a tier; `arena.snapshot()` returns a PNG data
URL of the current frame. Reduced motion (the `fx.js` toggle or the media query, read
through `opts.reduced`) keeps hover (instant), drops the parallax, and every effect in
`arena3d-fx.js` cuts to its end state.

## The environment

`arena3d-env.js` is attached by `create()` as `arena.env = E1Arena3DEnv.attach(arena,
{ backdrop, affinity, reduced })` (a still shim when the script is missing). Five layers,
none of them touching a card: a **cyclorama** (a 34-unit cylinder segment behind the far
edge wearing `opts.backdrop` — play.js passes `../art/site/hero-play.webp`, or
`window.E1_BACKDROP_URL`, the data URL the napplet build emits in `<head>` — dimmed to
45 %, tinted with the Plate colour of the affinity, black at the bottom, following the
pointer parallax at 30 %); three additive **fog** sheets drifting behind the slab (none in
tier `low`); **embers** as one `THREE.Points` cloud rising through the void (240 / 120 /
40 per tier, respawning at the bottom, buffers updated in place); brass **packets**
running the slab's PCB traces (`world.traces`, exported by `drawPlayfield`; 8 / 6 / 4 per
tier, one per trace, 1.2 units/s); and **breathing** — the world plate and the queue glow
±12 % over 4.5 s, the key light ±3 % on a slow noise. `setPlate(affinity)` also calls
`env.setAffinity`, `quality(tier)` forwards, `dispose` disposes it.

The loop: `env.animating()` is true while the tab is visible and motion is not reduced;
when only the environment moves the arena skips every other rAF (~30 fps), and a hidden
tab stops the loop. Reduced motion draws the cyclorama, fog and embers once, static, with
no packets. `arena.env.stats()` and `arena.env.inspect()` are the console's view of it.
`tests/js/arena3d-env.test.mjs` pins the counts, the respawn, the packets on their
polylines, reduced mode, dispose and the tint.

## Adding a cue

1. `play.js` `fx(event)` translates a rules event into one of the `fx.js` `EVENTS` names
   with a detail (`uid`, `seat`, …) and a `bind` (which node the detail's `el` becomes).
   Nothing else is needed for the arena: `fxFlush()` forwards every cue it emits.
2. `arena3d-fx.js`: add `CUES['name'] = (d) => …` — look the mesh up by `d.uid` (or the
   translated `queue:<qid>`), animate it with the pools, respect `reduced()`, and clean up.
   No audio there: sounds are `fx.js`'s job and already fire at `strikeMs`.
3. If the DOM motion for the same cue moves the card node, guard it in `fx.js` with
   `cardMotion()` so the two tables never both move the card.
4. Pin it in `tests/js/arena3d-fx.test.mjs` (the motion) and, if `play.js` changed, in
   `tests/js/client.test.mjs` under "the 3D table" (a fake `E1Arena3D` records `sync`,
   `setState`, `hover` and `fx.cue`).

## Running the proof

```sh
npm run test:js                              # client + arena3d-layout + arena3d-fx + arena3d-env tests
./.venv/Scripts/python.exe -m pytest -q tests/   # includes the napplet build (< 3 MB)
npm run local                                # then open play.html?rules=fast&arena=3d
```

In the browser: start an NPC game — cards in a fan, tokens on the arcs, an attack with
lunge, hit-stop and shake, a death shatter, a win. `E1_GAME.arena.snapshot()` gives the
screenshot; `E1_GAME.arena.world.quality` the tier. Frame time during an attack should
stay under 8 ms on desktop at DPR 1.5; a 375×812 mobile emulation must land on `low`
and still play. `?arena=dom` on the same URL is the classic table for comparison.

The napplet build (`npm run build:napplet`) inlines `vendor/three.js` and the four
arena scripts like every other `<script src>`, and emits the hero as
`window.E1_BACKDROP_URL` for the cyclorama; inside the shell the world plates are
not shipped, so `plates` is empty there and the arena draws without one.
