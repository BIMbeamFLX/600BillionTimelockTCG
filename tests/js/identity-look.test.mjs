/* site/identity-look.js — a member's own look at their seat.
 *
 * The seat must never wait on a profile, so most of what is worth testing is a
 * fallback: a signature that does not hold, bytes that are not what the hash
 * says, an image over the cap, a relay that never answers, a relay that answers
 * too late, a seat that changed hands while it waited. The events are really
 * signed and the real verifier checks them, because a test that skipped the
 * signature would be testing a path no browser takes.
 *
 * Run: node --test tests/js/identity-look.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { schnorr } = require("@noble/curves/secp256k1");
const { createHash } = require("node:crypto");
require("../../site/schnorr.js");
const L = require("../../site/identity-look.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAPPLET_JS = fs.readFileSync(path.join(HERE, "..", "..", "site", "napplet.js"), "utf8");

const SK = (label) => Uint8Array.from(createHash("sha256").update(`look:${label}`).digest());
const MEMBER = SK("member");
const STRANGER = SK("stranger");
const KEY = (sk) => Buffer.from(schnorr.getPublicKey(sk)).toString("hex");
const PK = KEY(MEMBER);
const verify = (event) => globalThis.E1Schnorr.verifyEvent(event);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function signed(sk, event) {
  const full = Object.assign({ pubkey: KEY(sk) }, event);
  full.id = createHash("sha256").update(JSON.stringify([
    0, full.pubkey, full.created_at, full.kind, full.tags, full.content,
  ])).digest("hex");
  full.sig = Buffer.from(schnorr.sign(full.id, sk)).toString("hex");
  return full;
}

/* A 1x1 PNG, and copies of it that hash differently: the trailer is ignored by
 * every decoder and by the sniffer, and it is all a test needs to tell rungs apart. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64");
const png = (label) => Buffer.concat([PNG, Buffer.from(label)]);
const AVATAR = png("avatar");
const FULLBODY = png("fullbody");
const BLOSSOM = "https://blossom.bimcvp.com";

const profileEvent = (meta, over) => signed(MEMBER, Object.assign(
  { kind: 0, created_at: 1789000000, tags: [], content: JSON.stringify(meta) }, over || {}));

/* The shape the Hangar will sign when a character is delivered (Path C): the
 * image lives on blossom.bimcvp.com under its sha256, the url is a hint. */
const imeta = (role, bytes, extra) => ["imeta", `role ${role}`, `x ${sha(bytes)}`, "m image/png",
  `url ${BLOSSOM}/${sha(bytes)}.png`, "dim 1024x1024", ...(extra || [])];
const lookEvent = (tags, over) => signed(MEMBER, Object.assign(
  { kind: 30077, created_at: 1789000100, tags: [["d", ""], ...tags], content: "Root form, Edition One." }, over || {}));

/** A blob host that serves exactly the files it is given, and remembers what was asked. */
function host(files) {
  const asked = [];
  return {
    asked,
    bytes: async (url) => {
      asked.push(url);
      return files[url] ? new Blob([files[url]]) : null;
    },
  };
}
const byHash = (...list) => Object.fromEntries(list.map((bytes) => [`${BLOSSOM}/${sha(bytes)}`, bytes]));

/** Deps for a relay that answers at once with `events`. */
function deps(events, extra) {
  return Object.assign({ query: async () => events, verify, npub: () => "npub1member…xyz" }, extra || {});
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** A clock the test turns by hand: deadlines pass when the test says so. */
function manualClock() {
  const waiting = [];
  return {
    sleep: (ms) => new Promise((resolve) => waiting.push({ ms, resolve })),
    pass(ms) {
      for (const timer of waiting.filter((item) => item.ms === ms)) {
        waiting.splice(waiting.indexOf(timer), 1);
        timer.resolve();
      }
    },
  };
}

async function waitFor(check, what) {
  for (let turn = 0; turn < 400; turn += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, turn < 50 ? 0 : 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("the parser reads a real-shaped kind 0 and a NIP-3D kind 30077", () => {
  const profile = L.parseProfile(profileEvent({
    name: "flx", display_name: "FLX", picture: "https://blossom.primal.net/abc.jpg", lud16: "flx@example.com",
  }));
  assert.deepEqual(profile, { name: "FLX", nameVia: "display_name", picture: "https://blossom.primal.net/abc.jpg" });
  assert.deepEqual(L.parseProfile(profileEvent({ name: "flx" })), { name: "flx", nameVia: "name", picture: null });
  assert.deepEqual(L.parseProfile(profileEvent({ about: "no name" })), { name: null, nameVia: "none", picture: null });
  assert.equal(L.parseProfile({ content: "not json" }), null);
  assert.equal(L.parseProfile({ content: "[1,2]" }), null);

  const reps = L.parseLook(lookEvent([
    imeta("avatar", AVATAR),
    ["imeta", "role fullbody", `x ${sha(FULLBODY).toUpperCase()}`, "size 812340", "alt Root form"],
    ["imeta", "role model", `x ${"c".repeat(64)}`, "m model/gltf-binary", "profile vrm1"],
    ["imeta", "role avatar", "x not-a-hash", `url ${BLOSSOM}/nothing.png`], // no identity, no entry
    ["imeta", `x ${"d".repeat(64)}`], // no role
    ["imeta", "role banner", `x ${"e".repeat(64)}`, "__proto__ polluted", "url javascript:alert(1)"],
    ["p", PK],
  ]));
  assert.deepEqual(reps.map((rep) => rep.role), ["avatar", "fullbody", "model", "banner"]);
  assert.deepEqual(reps[0], {
    role: "avatar", x: sha(AVATAR), m: "image/png", url: `${BLOSSOM}/${sha(AVATAR)}.png`,
    dim: "1024x1024", size: null, alt: null,
  });
  assert.equal(reps[1].x, sha(FULLBODY), "x is compared in lower case");
  assert.equal(reps[1].size, 812340);
  assert.equal(reps[1].alt, "Root form");
  assert.equal(reps[3].url, null, "a javascript: hint is no hint");
  assert.equal({}.polluted, undefined, "a field named __proto__ stays a field");
});

test("the ladder: avatar, then fullbody, then the kind 0 picture, then the default", async () => {
  const profile = profileEvent({ display_name: "FLX", picture: "https://blossom.primal.net/flx.png" });
  const both = lookEvent([imeta("fullbody", FULLBODY), imeta("avatar", AVATAR)]);
  const files = byHash(AVATAR, FULLBODY);

  const avatar = await L.resolve(PK, deps([both, profile], { bytes: host(files).bytes }));
  assert.equal(avatar.image.via, "avatar", "avatar outranks fullbody whatever the tag order");
  assert.match(avatar.image.url, /^blob:/);
  assert.deepEqual([avatar.name, avatar.nameVia, avatar.pubkey], ["FLX", "display_name", PK]);

  const onlyBody = lookEvent([imeta("fullbody", FULLBODY)]);
  assert.equal((await L.resolve(PK, deps([onlyBody, profile], { bytes: host(files).bytes }))).image.via, "fullbody");

  const picture = await L.resolve(PK, deps([profile], { hotlink: true }));
  assert.deepEqual(picture.image, { url: "https://blossom.primal.net/flx.png", via: "picture" });

  const nothing = await L.resolve(PK, deps([profileEvent({ name: "flx" })], { hotlink: true }));
  assert.deepEqual(nothing.image, { url: null, via: "none" }, "no picture: the table paints its default portrait");
  assert.deepEqual([nothing.name, nothing.nameVia], ["flx", "name"]);

  const silent = await L.resolve(PK, deps([]));
  assert.deepEqual([silent.name, silent.nameVia, silent.image.via], ["npub1member…xyz", "npub", "none"]);
});

test("the default look wins over a newer named look, and a forged event is not believed", async () => {
  const files = byHash(AVATAR, FULLBODY);
  const plain = lookEvent([imeta("avatar", AVATAR)], { created_at: 1789000100 });
  const skin = signed(MEMBER, {
    kind: 30077, created_at: 1789000900, tags: [["d", "tournament"], imeta("avatar", FULLBODY)], content: "",
  });
  let got = await L.resolve(PK, deps([skin, plain], { bytes: host(files).bytes, objectUrl: (blob) => `blob:${blob.size}` }));
  assert.equal(got.image.url, `blob:${AVATAR.length}`, 'the ["d", ""] look is the one a seat wears');
  got = await L.resolve(PK, deps([skin], { bytes: host(files).bytes, objectUrl: (blob) => `blob:${blob.size}` }));
  assert.equal(got.image.url, `blob:${FULLBODY.length}`, "without it, the newest look");

  /* A relay may answer with anything: another key's event, or this key's event
   * with the content swapped after signing. Neither may dress the seat. */
  const forged = Object.assign({}, profileEvent({ display_name: "FLX" }), { content: JSON.stringify({ display_name: "Mallory" }) });
  const strangers = signed(STRANGER, { kind: 0, created_at: 1789009999, tags: [], content: JSON.stringify({ name: "Eve" }) });
  got = await L.resolve(PK, deps([forged, strangers]));
  assert.deepEqual([got.name, got.nameVia], ["npub1member…xyz", "npub"]);
  got = await L.resolve(PK, deps([forged, profileEvent({ name: "flx" }, { created_at: 1788000000 })]));
  assert.equal(got.name, "flx", "an older, genuine profile still counts once the forgery is set aside");

  got = await L.resolve(PK, { query: async () => [profileEvent({ name: "flx" })] });
  assert.equal(got.nameVia, "npub", "no verifier, no trust");
});

test("a sha mismatch falls one rung; a wrong mirror alone does not", async () => {
  const profile = profileEvent({ name: "flx", picture: "https://example.com/flx.png" });
  const look = lookEvent([imeta("avatar", AVATAR), imeta("fullbody", FULLBODY)]);

  /* Blossom and the hint both serve something else under the avatar's hash, the
   * way a host that answers an error page with 200 would. */
  const wrong = { [`${BLOSSOM}/${sha(AVATAR)}`]: png("not the avatar"), [`${BLOSSOM}/${sha(AVATAR)}.png`]: png("nor this"),
    [`${BLOSSOM}/${sha(FULLBODY)}`]: FULLBODY };
  const served = host(wrong);
  const fell = await L.resolve(PK, deps([look, profile], { bytes: served.bytes }));
  assert.equal(fell.image.via, "fullbody");
  assert.deepEqual(served.asked, [`${BLOSSOM}/${sha(AVATAR)}`, `${BLOSSOM}/${sha(AVATAR)}.png`, `${BLOSSOM}/${sha(FULLBODY)}`],
    "the hash on Blossom first, then the hint, then the next rung");

  const hintOnly = host({ [`${BLOSSOM}/${sha(AVATAR)}`]: png("stale"), [`${BLOSSOM}/${sha(AVATAR)}.png`]: AVATAR });
  assert.equal((await L.resolve(PK, deps([look], { bytes: hintOnly.bytes }))).image.via, "avatar",
    "a source is not a rung: the hint can still deliver the right bytes");

  const neither = host({});
  const last = await L.resolve(PK, deps([look, profile], { bytes: neither.bytes }));
  assert.deepEqual(last.image, { url: null, via: "none" }, "inside a shell the unlisted picture host is refused too");
  assert.equal(neither.asked.at(-1), "https://example.com/flx.png");
});

test("the size cap: a declared size, a large Blob and a fetch that runs past it all fall a rung", async () => {
  const cap = 3 * 1024 * 1024;
  assert.equal(L.LIMITS.maxBytes, cap);
  const huge = Buffer.concat([PNG, Buffer.alloc(cap)]);
  const profile = profileEvent({ name: "flx", picture: "https://example.com/flx.png" });

  const declared = host(byHash(AVATAR, FULLBODY));
  const bigTag = lookEvent([imeta("avatar", AVATAR, [`size ${cap + 1}`]), imeta("fullbody", FULLBODY)]);
  assert.equal((await L.resolve(PK, deps([bigTag], { bytes: declared.bytes }))).image.via, "fullbody");
  assert.equal(declared.asked.some((url) => url.includes(sha(AVATAR))), false, "a declared oversize is never fetched");

  const served = host(byHash(huge, FULLBODY));
  const bigBlob = lookEvent([imeta("avatar", huge), imeta("fullbody", FULLBODY)]);
  assert.equal((await L.resolve(PK, deps([bigBlob], { bytes: served.bytes }))).image.via, "fullbody");
  assert.equal(served.asked.filter((url) => url.includes(sha(huge))).length, 1,
    "the same hash from the hint would be just as big, so it is not asked for");

  /* The website reads a fetch body in chunks and stops at the cap. */
  let pulled = 0;
  let cancelled = false;
  const streaming = async (url) => ({
    ok: true,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (pulled >= cap + 1024 * 1024) return { done: true };
          pulled += 512 * 1024;
          return { done: false, value: new Uint8Array(512 * 1024) };
        },
        cancel: async () => { cancelled = true; },
      }),
    },
    url,
  });
  const fetched = await L.resolve(PK, deps([lookEvent([imeta("avatar", huge)]), profile], { fetch: streaming, hotlink: true }));
  assert.deepEqual(fetched.image, { url: "https://example.com/flx.png", via: "picture" });
  assert.ok(cancelled && pulled <= cap + 512 * 1024, `the reader stopped at the cap (read ${pulled} bytes)`);

  const announced = await L.resolve(PK, deps([lookEvent([imeta("avatar", huge)])], {
    fetch: async () => ({ ok: true, headers: { get: (name) => (name === "content-length" ? String(cap + 1) : null) },
      arrayBuffer: async () => assert.fail("a body announced over the cap is not read") }),
  }));
  assert.equal(announced.image.via, "none");
});

test("bytes an <img> does not draw fall a rung, told by the bytes and not the claim", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const look = lookEvent([imeta("avatar", svg), imeta("fullbody", FULLBODY)]);
  assert.equal((await L.resolve(PK, deps([look], { bytes: host(byHash(svg, FULLBODY)).bytes }))).image.via, "fullbody");
  assert.equal(L.sniff(PNG), "image/png");
  assert.equal(L.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(L.sniff(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(L.sniff(Buffer.from("\0\0\0\x1cftypavif")), "image/avif");
  assert.equal(L.sniff(Buffer.from("GIF89a")), "image/gif");
  assert.equal(L.sniff(svg), null);
});

test("no pubkey asks nobody and answers the default", async () => {
  let asked = 0;
  const query = async () => { asked += 1; return []; };
  for (const pubkey of [null, undefined, "", "npub1xyz", "a".repeat(63), "g".repeat(64), 42]) {
    assert.deepEqual(await L.resolve(pubkey, { query, verify }), {
      pubkey: null, name: null, nameVia: "none", image: { url: null, via: "none" },
    });
  }
  assert.equal(asked, 0);
  const book = L.book({ query, verify });
  assert.equal(book.seat("seat0", null, () => assert.fail("nobody to repaint")), null);
  assert.equal(asked, 0);
});

test("a relay query that never answers ends on the fallback at the deadline", async () => {
  const clock = manualClock();
  let filters = null;
  const pending = L.resolve(PK, {
    query: (asked) => { filters = asked; return new Promise(() => {}); },
    verify, sleep: clock.sleep, timeout: 2500, npub: () => "npub1member…xyz",
  });
  await waitFor(() => filters, "the query");
  assert.deepEqual(filters, [
    { kinds: [30077], authors: [PK], limit: 8 },
    { kinds: [0], authors: [PK], limit: 1 },
  ], "one query, the look first");
  let settled = null;
  pending.then((look) => { settled = look; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, null, "still inside the deadline");
  clock.pass(2500);
  await waitFor(() => settled, "the deadline");
  assert.deepEqual(settled, { pubkey: PK, name: "npub1member…xyz", nameVia: "npub", image: { url: null, via: "none" } });
  assert.equal(L.LIMITS.timeout, 2500);
});

test("a relay that answers after the deadline still upgrades the look", async () => {
  const clock = manualClock();
  const relay = deferred();
  const late = [];
  const first = L.resolve(PK, {
    query: () => relay.promise, verify, hotlink: true, sleep: clock.sleep, timeout: 2500,
    onLate: (look) => late.push(look),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  clock.pass(2500);
  assert.equal((await first).image.via, "none", "the seat was not kept waiting");
  relay.resolve([profileEvent({ display_name: "FLX", picture: "https://example.com/flx.png" })]);
  await waitFor(() => late.length, "the late look");
  assert.deepEqual(late[0].image, { url: "https://example.com/flx.png", via: "picture" });
  assert.equal(late[0].name, "FLX");

  /* A late answer with nothing in it upgrades nothing, so it is not reported. */
  const empty = deferred();
  const quiet = [];
  const second = L.resolve(PK, { query: () => empty.promise, verify, sleep: clock.sleep, timeout: 50, onLate: (look) => quiet.push(look) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  clock.pass(50);
  await second;
  empty.resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(quiet, []);
});

test("a seat that changed hands before a late answer is not repainted by it", async () => {
  const clock = manualClock();
  const OTHER = KEY(STRANGER);
  const relays = { [PK]: deferred(), [OTHER]: deferred() };
  const queries = {};
  const book = L.book({
    query: (filters) => {
      const author = filters[0].authors[0];
      queries[author] = (queries[author] || 0) + 1;
      return relays[author].promise;
    },
    verify, hotlink: true, sleep: clock.sleep, timeout: 2500,
  });
  const heard = [];
  const repaint = (look) => heard.push(look.pubkey);

  assert.equal(book.seat("seat1", PK, repaint), null, "nothing known yet: the seat paints its default");
  await new Promise((resolve) => setTimeout(resolve, 0));
  clock.pass(2500); // the member's relay is slow: the seat settles on the fallback
  await waitFor(() => book.peek(PK), "the fallback");
  assert.deepEqual(heard, [], "a fallback that changes nothing repaints nothing");

  // A rematch: someone else sits down in seat 1 before the member's relay answers.
  assert.equal(book.seat("seat1", OTHER, repaint), null);
  relays[PK].resolve([profileEvent({ display_name: "FLX", picture: "https://example.com/flx.png" })]);
  await waitFor(() => book.peek(PK).image.url, "the member's late look");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(heard, [], "seat 1 changed hands, so the member's late look must not repaint it");
  assert.equal(book.peek(PK).name, "FLX", "the answer is still kept for the page's life");

  // The seat's current holder is heard.
  relays[OTHER].resolve([signed(STRANGER, { kind: 0, created_at: 1789000000, tags: [], content: JSON.stringify({ name: "anna" }) })]);
  await waitFor(() => heard.length, "the new holder's look");
  assert.deepEqual(heard, [OTHER]);

  // And the member sitting down again gets the cached look at once, with no second query.
  assert.equal(book.seat("seat0", PK, repaint).name, "FLX");
  assert.deepEqual(queries, { [PK]: 1, [OTHER]: 1 });
});

test("one query per key, and a replaced look revokes the object URL it held", async () => {
  let queries = 0;
  const revoked = [];
  let made = 0;
  const book = L.book(deps([], {
    query: async () => { queries += 1; return [lookEvent([imeta("avatar", AVATAR)]), profileEvent({ name: "flx" })]; },
    bytes: host(byHash(AVATAR)).bytes,
    objectUrl: () => `blob:look/${(made += 1)}`,
    revoke: (url) => revoked.push(url),
  }));
  const heard = [];
  book.seat("seat0", PK, () => heard.push("seat0"));
  book.seat("setup", PK, () => heard.push("setup"));
  book.seat("seat0", PK, () => heard.push("seat0"));
  await waitFor(() => book.peek(PK), "the look");
  assert.equal(queries, 1, "three binds, one query");
  assert.equal(book.peek(PK).image.url, "blob:look/1");
  await waitFor(() => heard.length === 2, "both holders");
  assert.deepEqual(heard.sort(), ["seat0", "setup"]);

  // The browser could not draw it: the object URL goes and the key keeps its name.
  book.broken("blob:look/1");
  assert.deepEqual(revoked, ["blob:look/1"]);
  assert.deepEqual(book.peek(PK).image, { url: null, via: "none" });
  assert.equal(book.peek(PK).name, "flx");

  // A hotlinked picture that will not draw loses its place too, but it is not ours to revoke.
  const linked = L.book(deps([profileEvent({ name: "flx", picture: "https://example.com/flx.png" })], {
    hotlink: true, revoke: (url) => revoked.push(url),
  }));
  linked.seat("seat0", PK, () => {});
  await waitFor(() => linked.peek(PK), "the hotlinked look");
  linked.broken("https://example.com/flx.png");
  assert.deepEqual(linked.peek(PK).image, { url: null, via: "none" });
  assert.deepEqual(revoked, ["blob:look/1"], "only an object URL is revoked");
});

test("a picture that is not http(s) is never a source", async () => {
  const hostile = [
    "javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "data:image/png;base64,iVBORw0KGgo=",
    "blob:https://example.com/0000", "file:///etc/passwd", "vbscript:msgbox(1)", "//example.com/flx.png",
    "https://user:secret@example.com/flx.png", "https://example.com/" + "a".repeat(2100), 42, null,
  ];
  let fetched = 0;
  const bytes = async () => { fetched += 1; return PNG; };
  for (const picture of hostile) {
    assert.equal(L.safeUrl(picture), null, String(picture).slice(0, 40));
    for (const hotlink of [true, false]) {
      const got = await L.resolve(PK, deps([profileEvent({ name: "flx", picture })], { hotlink, bytes }));
      assert.deepEqual(got.image, { url: null, via: "none" }, `${String(picture).slice(0, 40)} became a source`);
    }
    // Nor as a look's url hint: the hash on Blossom is still asked, the hint never is.
    const asked = host({});
    await L.resolve(PK, deps([lookEvent([["imeta", "role avatar", `x ${sha(AVATAR)}`, `url ${picture}`]])], { bytes: asked.bytes }));
    assert.deepEqual(asked.asked, [`${BLOSSOM}/${sha(AVATAR)}`]);
  }
  assert.equal(fetched, 0, "nothing was fetched for a hostile picture");
  assert.equal(L.safeUrl("https://example.com/flx.png"), "https://example.com/flx.png");
  assert.equal(L.safeUrl("http://localhost:8777/art/flx.png"), "http://localhost:8777/art/flx.png");
});

test("names are cleaned text, never markup, and bounded", async () => {
  const markup = '<img src=x onerror="globalThis.pwned=true">';
  let got = await L.resolve(PK, deps([profileEvent({ display_name: markup })]));
  assert.equal(got.name, markup.slice(0, 40), "kept as the literal characters, for textContent to show");
  assert.equal(globalThis.pwned, undefined);

  got = await L.resolve(PK, deps([profileEvent({ display_name: "F\u{202e}XL\u{200b}\u{2066}\ninjected\u{0}", name: "flx" })]));
  assert.equal(got.name, "FXL injected", "no bidi override, no zero-width, no control characters");

  got = await L.resolve(PK, deps([profileEvent({ display_name: "\u{200b} \u{202e}", name: "  flx  " })]));
  assert.deepEqual([got.name, got.nameVia], ["flx", "name"], "a display_name that is only invisible is no name");

  got = await L.resolve(PK, deps([profileEvent({ display_name: "🟧".repeat(60) })]));
  assert.equal(Array.from(got.name).length, 40, "bounded by characters, not by UTF-16 halves");
  assert.equal(got.name, "🟧".repeat(40));

  got = await L.resolve(PK, deps([profileEvent({ display_name: 7, name: ["flx"] })]));
  assert.equal(got.nameVia, "npub");
});

/* ------------------------------------------------------------------ the Hangar
 * Exactly the wiring play.js uses inside a shell, through the real adapter:
 * E1Napplet.outbox.query answers the shell's `{ event, sidecar }` items and
 * E1Napplet.resource.bytes answers a Blob, or null when the host refuses. */
function loadAdapter(shell) {
  const scope = { module: { exports: {} }, napplet: shell, URL, Blob };
  scope.globalThis = scope;
  const keys = Object.keys(scope);
  new Function(...keys, NAPPLET_JS)(...keys.map((key) => scope[key]));
  return scope.module.exports;
}

test("inside the Hangar the Path C look resolves through resource.bytes with its sha256 checked", async () => {
  const look = lookEvent([imeta("avatar", AVATAR, ["alt FLX, Signal Runner"])]);
  const profile = profileEvent({ display_name: "FLX", picture: "https://nostr.build/i/flx.jpg" });
  const requested = [];
  const N = loadAdapter({
    outbox: {
      query: async (filters) => ({
        type: "outbox.query.result",
        events: [look, profile].map((event) => ({ event, sidecar: { relayHints: ["wss://relay.nappelin.com"] } })),
        filters,
      }),
    },
    resource: {
      bytes: async (url) => {
        requested.push(url);
        /* host.ts grants the TCG blossom.bimcvp.com, blossom.primal.net and
         * nostr.download; everything else is refused, which the adapter turns
         * into null. */
        if (!/^https:\/\/(blossom\.bimcvp\.com|blossom\.primal\.net|nostr\.download)\//.test(url)) {
          throw new Error("origin not granted");
        }
        return url === `${BLOSSOM}/${sha(AVATAR)}` ? new Blob([AVATAR], { type: "application/octet-stream" }) : null;
      },
    },
  });
  const wiring = { query: (filters) => N.outbox.query(filters), bytes: (url) => N.resource.bytes(url), verify, hotlink: false };

  const got = await L.resolve(PK, wiring);
  assert.equal(got.image.via, "avatar");
  assert.match(got.image.url, /^blob:/);
  assert.deepEqual(requested, [`${BLOSSOM}/${sha(AVATAR)}`], "one request, by hash, to the granted Blossom host");
  assert.equal(got.name, "FLX");

  // The same shape with bytes that do not hash to x: the unlisted picture host is refused, so the default.
  requested.length = 0;
  const tampered = lookEvent([imeta("avatar", png("swapped on the server"))]);
  const N2 = loadAdapter({
    outbox: { query: async () => ({ events: [{ event: tampered }, { event: profile }] }) },
    resource: {
      bytes: async (url) => {
        requested.push(url);
        if (!url.startsWith(BLOSSOM)) throw new Error("origin not granted");
        return new Blob([AVATAR]);
      },
    },
  });
  const fallback = await L.resolve(PK, { query: (f) => N2.outbox.query(f), bytes: (u) => N2.resource.bytes(u), verify });
  assert.deepEqual(fallback.image, { url: null, via: "none" });
  assert.equal(requested.length, 3, "Blossom by hash, the url hint, then the refused kind 0 picture");
  assert.equal(fallback.name, "FLX", "the name still comes from kind 0");
});
