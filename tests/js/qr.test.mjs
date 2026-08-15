/* site/qr.js — proven by decoding, not by looking.
 *
 * A QR code that LOOKS like a QR code and does not scan is the worst possible
 * bug in this module, because the eye cannot tell the two apart and the failure
 * surfaces at the one moment money is meant to move. So nothing here asserts
 * "the matrix has the right shape". Everything asserts "a decoder read the
 * payload back, byte for byte".
 *
 * THE ROUTE TAKEN: a real round trip. jsQR — an independent, pure-JS QR
 * DECODER — reads a raster of the matrix, and separately reads a raster of the
 * emitted SVG produced by resvg. Encoder and decoder share no code.
 *
 * ONE PATCH, AND WHY. jsQR's own version table gives version 23 the alignment
 * centres 6,30,54,74,102. The spec's are 6,30,54,78,102 — evenly spaced by 24,
 * like every other version, and the value this encoder's construction rule
 * produces. jsQR's 74 is a transcription typo in the decoder, and it is
 * corrected in memory below rather than worked around, so version 23 gets the
 * same round trip as the other 39. `alignment squares sit where the spec puts
 * them` pins our side of that disagreement independently.
 *
 * IF jsQR IS ABSENT the round trips SKIP LOUDLY and the golden digests still
 * run — those matrices were verified by jsQR when they were recorded, so they
 * remain a real guarantee against regression, just not against a first
 * mistake. jsQR is not in package.json (it is a test-only decoder, and
 * package.json is not this module's to edit); install it with
 * `npm install --no-save --no-package-lock jsqr@1.4.0`.
 *
 * Run: node --test tests/js/qr.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const QR = require("../../site/qr.js");
const { Resvg } = require("@resvg/resvg-js");

// ------------------------------------------------------------- the decoder

/* Loaded from source and evaluated here rather than required, because the one
 * bad table entry has to be corrected before the module closes over it. */
function loadDecoder() {
  let source;
  try {
    source = readFileSync(require.resolve("jsqr/dist/jsQR.js"), "utf8");
  } catch (err) {
    return null;
  }
  const fixed = source.replace("[6, 30, 54, 74, 102]", "[6, 30, 54, 78, 102]");
  if (fixed === source) throw new Error("jsQR's version-23 table changed — re-check the patch above");
  const mod = { exports: {} };
  new Function("module", "exports", fixed)(mod, mod.exports);
  const fn = mod.exports.default || mod.exports;
  return typeof fn === "function" ? fn : null;
}

const jsQR = loadDecoder();
const NO_DECODER = jsQR ? false : "jsqr not installed — see the header of this file";

/* Modules to RGBA, by hand. No canvas, no image codec: a decoder that takes
 * raw pixels lets the whole round trip stay in one process. */
function raster(result, scale = 4, border = 4) {
  const dim = (result.size + border * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < result.size; y++) {
    for (let x = 0; x < result.size; x++) {
      if (!result.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const p = (((y + border) * scale + dy) * dim + (x + border) * scale + dx) * 4;
          data[p] = 0; data[p + 1] = 0; data[p + 2] = 0;
        }
      }
    }
  }
  return { data, dim };
}

function roundTrip(text, options) {
  const result = QR.encode(text, options);
  const { data, dim } = raster(result);
  const read = jsQR(data, dim, dim, { inversionAttempts: "dontInvert" });
  assert.ok(read, `no decode at version ${result.version} ec ${result.ec} mask ${result.mask}`);
  assert.equal(read.data, text, `payload changed at version ${result.version} ec ${result.ec}`);
  return result;
}

// ------------------------------------------------------------------ fixtures

const LEVELS = ["L", "M", "Q", "H"];

/* A real-shaped bolt11: the exact thing this module exists for. */
const INVOICE =
  "lnbc2500n1pj9x8k4pp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5" +
  "xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se9" +
  "03vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";

/* Deterministic filler for the long payloads. A Lehmer generator rather than a
 * repeating alphabet: a periodic payload flatters the mask chooser, and a test
 * that only ever feeds it periodic data never exercises the penalty rules. */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
function filler(n) {
  let out = "lnbc", x = 1;
  while (out.length < n) {
    x = (x * 48271) % 2147483647;
    out += ALPHABET[x % 36];
  }
  return out.slice(0, n);
}

/* The published byte-mode capacity, version 1..40 x L/M/Q/H. Transcribed from
 * ISO/IEC 18004, and the reason it is here rather than derived: qr.js computes
 * these from its own block tables, so deriving them again would prove nothing.
 * A single wrong entry in ECC_PER_BLOCK or NUM_BLOCKS moves one of these
 * numbers, and every scanner would reject that version. */
const CAPACITY = [
  [17, 14, 11, 7], [32, 26, 20, 14], [53, 42, 32, 24], [78, 62, 46, 34],
  [106, 84, 60, 44], [134, 106, 74, 58], [154, 122, 86, 64], [192, 152, 108, 84],
  [230, 180, 130, 98], [271, 213, 151, 119], [321, 251, 177, 137], [367, 287, 203, 155],
  [425, 331, 241, 177], [458, 362, 258, 194], [520, 412, 292, 220], [586, 450, 322, 250],
  [644, 504, 364, 280], [718, 560, 394, 310], [792, 624, 442, 338], [858, 666, 482, 382],
  [929, 711, 509, 403], [1003, 779, 565, 439], [1091, 857, 611, 461], [1171, 911, 661, 511],
  [1273, 997, 715, 535], [1367, 1059, 751, 593], [1465, 1125, 805, 625], [1528, 1190, 868, 658],
  [1628, 1264, 908, 698], [1732, 1370, 982, 742], [1840, 1452, 1030, 790], [1952, 1538, 1112, 842],
  [2068, 1628, 1168, 898], [2188, 1722, 1228, 958], [2303, 1809, 1283, 983], [2431, 1911, 1351, 1051],
  [2563, 1989, 1423, 1093], [2699, 2099, 1499, 1139], [2809, 2213, 1579, 1219], [2953, 2331, 1663, 1273],
];
const capacity = (version, ec) => CAPACITY[version - 1][LEVELS.indexOf(ec)];

// ------------------------------------------------------------- round trips

test("a short string round-trips at every EC level", { skip: NO_DECODER }, () => {
  for (const ec of LEVELS) {
    const result = roundTrip("600B", { ec });
    assert.equal(result.version, 1);
    assert.equal(result.ec, ec);
  }
});

test("a bolt11 invoice round-trips at every EC level", { skip: NO_DECODER }, () => {
  assert.equal(INVOICE.length, 210);
  assert.match(INVOICE, /^lnbc[0-9a-z]+$/);
  for (const ec of LEVELS) roundTrip(INVOICE, { ec });
});

test("M is the default level", { skip: NO_DECODER }, () => {
  assert.equal(QR.encode(INVOICE).ec, "M");
  assert.deepEqual(QR.encode(INVOICE).modules, QR.encode(INVOICE, { ec: "m" }).modules);
});

/* The versions where something structural changes, so a break in any of them
 * is a break in a whole class of codes:
 *   1  no alignment patterns at all
 *   2  the first alignment pattern
 *   6/7 the version-information blocks appear at 7
 *   9/10 the character-count field widens from 8 bits to 16
 *   14 four alignment rows, and multi-block interleaving in earnest
 *   23 the version whose alignment spacing jsQR itself gets wrong
 *   32 the one version whose alignment step the formula cannot compute
 *   40 the ceiling, and the deepest block interleave there is */
test("every structural boundary version round-trips, at every EC level", { skip: NO_DECODER }, () => {
  for (const ec of LEVELS) {
    for (const version of [1, 2, 6, 7, 9, 10, 14, 23, 32, 40]) {
      const payload = filler(capacity(version, ec));
      const result = roundTrip(payload, { ec });
      assert.equal(result.version, version, `${payload.length} bytes at ec ${ec}`);
    }
  }
});

test("the version-40 ceiling round-trips at every EC level", { skip: NO_DECODER }, () => {
  for (const ec of LEVELS) {
    const result = roundTrip(filler(capacity(40, ec)), { ec });
    assert.equal(result.version, 40);
    assert.equal(result.size, 177);
  }
});

test("non-ASCII payloads survive as UTF-8", { skip: NO_DECODER }, () => {
  // Not what bolt11 needs, but a lightning ADDRESS or a memo can carry it, and
  // a mangled multi-byte sequence is the kind of thing an ASCII-only test never
  // notices.
  for (const text of ["⚡ 600B — Zahlung", "Grüße aus Österreich", "日本語"]) {
    roundTrip(text, { ec: "H" });
  }
});

test("the rendered SVG itself scans, not merely the matrix", { skip: NO_DECODER }, () => {
  /* The matrix round trip says the bits are right. This says the PICTURE is
   * right: path geometry, module orientation, quiet zone and colours, put
   * through a real SVG renderer and then through the decoder. */
  for (const ec of LEVELS) {
    const image = new Resvg(QR.svg(INVOICE, { ec, scale: 6 })).render();
    const read = jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height, {
      inversionAttempts: "dontInvert",
    });
    assert.ok(read, `rendered SVG did not decode at ec ${ec}`);
    assert.equal(read.data, INVOICE);
  }
});

// ------------------------------------------------------- version selection

test("capacity matches the published table, and the smallest version wins", () => {
  /* Pinned through the public API only. A payload of exactly the published
   * capacity for version v must land on v: one byte of slack anywhere in the
   * block tables and it lands on v+1, one byte too many and it lands on v-1. */
  for (const ec of LEVELS) {
    for (let version = 1; version <= 40; version++) {
      const result = QR.encode(filler(capacity(version, ec)), { ec });
      assert.equal(result.version, version, `${capacity(version, ec)} bytes at ec ${ec}`);
      assert.equal(result.size, version * 4 + 17);
    }
  }
});

test("a ten-character string is not a version-40 code", () => {
  // Ten bytes fits version 1 outright at L, M and Q; at H version 1 holds only
  // seven, so H steps to version 2 — and no further.
  for (const [ec, version] of [["L", 1], ["M", 1], ["Q", 1], ["H", 2]]) {
    const result = QR.encode("lnbc10n1pj", { ec });
    assert.equal(result.version, version);
    assert.equal(result.size, version * 4 + 17);
  }
  // And one byte past a version's capacity steps up exactly one version.
  assert.equal(QR.encode(filler(capacity(9, "M") + 1), { ec: "M" }).version, 10);
  assert.equal(QR.encode(filler(capacity(1, "H") + 1), { ec: "H" }).version, 2);
});

test("over-long input throws a clear Error rather than emitting a broken code", () => {
  for (const ec of LEVELS) {
    const tooLong = filler(capacity(40, ec) + 1);
    assert.throws(
      () => QR.encode(tooLong, { ec }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /will not fit/);
        assert.match(err.message, new RegExp(String(capacity(40, ec))));
        assert.match(err.message, new RegExp(`error correction ${ec}`));
        return true;
      },
      `ec ${ec} accepted ${tooLong.length} bytes`
    );
    // svg() must refuse for the same reason rather than render half an invoice.
    assert.throws(() => QR.svg(tooLong, { ec }), /will not fit/);
  }
});

test("a bad EC level is refused by name", () => {
  assert.throws(() => QR.encode("x", { ec: "Z" }), /unknown error correction level "Z"/);
  assert.throws(() => QR.encode(null), /string or a Uint8Array/);
});

// ----------------------------------------------------------- the geometry

/* The one structural assertion in this file, because it is the one place where
 * a well-regarded decoder disagrees with the spec and so cannot arbitrate. */
const isAlignment = (m, cx, cy) => {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (m[cy + dy][cx + dx] !== (Math.max(Math.abs(dx), Math.abs(dy)) !== 1)) return false;
    }
  }
  return true;
};

test("alignment squares sit where the spec puts them", () => {
  // version 7 → 6,22,38. The centre is the interesting one: stepping down from
  // the last centre gives 22, stepping up from 6 gives 20, and 20 is what a
  // rounding slip produces.
  const v7 = QR.encode(filler(capacity(7, "L")), { ec: "L" }).modules;
  assert.ok(isAlignment(v7, 22, 22), "version 7 has no alignment square at 22,22");
  assert.ok(!isAlignment(v7, 20, 20), "version 7 has a stray alignment square at 20,20");

  // version 23 → 6,30,54,78,102, evenly spaced by 24. jsQR's table says 74.
  const v23 = QR.encode(filler(capacity(23, "L")), { ec: "L" }).modules;
  for (const c of [30, 54, 78, 102]) {
    assert.ok(isAlignment(v23, c, c), `version 23 has no alignment square at ${c},${c}`);
  }
  assert.ok(!isAlignment(v23, 74, 74), "version 23 has an alignment square at jsQR's 74,74");

  // version 32 is the one the spacing formula cannot compute → 6,34,60,86,112,138.
  const v32 = QR.encode(filler(capacity(32, "L")), { ec: "L" }).modules;
  for (const c of [34, 60, 86, 112, 138]) {
    assert.ok(isAlignment(v32, c, c), `version 32 has no alignment square at ${c},${c}`);
  }
});

test("the dark module and the timing lines are where they must be", () => {
  for (let version = 1; version <= 12; version++) {
    const { modules, size } = QR.encode(filler(capacity(version, "M")), { ec: "M" });
    assert.equal(modules[size - 8][8], true, `version ${version} lost its dark module`);
    for (let i = 8; i < size - 8; i++) {
      assert.equal(modules[6][i], i % 2 === 0, `version ${version} horizontal timing at ${i}`);
      assert.equal(modules[i][6], i % 2 === 0, `version ${version} vertical timing at ${i}`);
    }
  }
});

// ------------------------------------------------------------------- SVG

test("svg() parses as XML, carries a viewBox and a four-module quiet zone", () => {
  const { size } = QR.encode(INVOICE, { ec: "M" });
  const svg = QR.svg(INVOICE, { ec: "M" });
  const dim = size + 8;

  // resvg's parser is a real XML parser, and it refuses malformed input — which
  // is what makes parsing here evidence of anything at all.
  assert.throws(() => new Resvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"</svg>'));
  const image = new Resvg(svg).render();
  assert.equal(image.width, image.height);

  assert.match(svg, new RegExp(`viewBox="0 0 ${dim} ${dim}"`));
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  // Every dark run lives strictly inside the border — that IS the quiet zone.
  const path = svg.match(/<path[^>]*d="([^"]*)"/);
  assert.ok(path, "no <path> in the output");
  const runs = [...path[1].matchAll(/M(\d+) (\d+)h(\d+)/g)];
  assert.ok(runs.length > 0);
  for (const [, x, y, run] of runs) {
    assert.ok(Number(x) >= 4 && Number(y) >= 4, `run at ${x},${y} intrudes on the quiet zone`);
    assert.ok(Number(x) + Number(run) <= 4 + size, `run at ${x},${y} overruns the right border`);
    assert.ok(Number(y) + 1 <= 4 + size, `run at ${x},${y} overruns the bottom border`);
  }

  // One path, never one rect per module: a version 40 code is 31329 modules.
  assert.equal((svg.match(/<path/g) || []).length, 1);
  assert.equal((svg.match(/<rect/g) || []).length, 1); // the light background
  assert.ok(QR.svg(filler(2953), { ec: "L" }).length < 400000);
});

test("svg() takes colours from options and refuses ones that would break out", () => {
  const themed = QR.svg("600B", { dark: "#0b1020", light: "rgb(255, 250, 240)" });
  assert.match(themed, /fill="#0b1020"/);
  assert.match(themed, /fill="rgb\(255, 250, 240\)"/);
  assert.match(QR.svg("600B"), /fill="#000000"/);
  assert.match(QR.svg("600B"), /fill="#ffffff"/);

  /* A colour string lands inside an XML attribute. Anything that is not
   * plausibly a colour is dropped for the default rather than escaped — there
   * is no legitimate caller this costs anything. */
  const hostile = QR.svg("600B", { dark: '"><script>alert(1)</script><x y="' });
  assert.doesNotMatch(hostile, /<script/);
  assert.match(hostile, /fill="#000000"/);
  new Resvg(hostile).render(); // still well-formed XML
});

test("svg() honours border and scale", () => {
  const { size } = QR.encode("600B");
  assert.match(QR.svg("600B", { border: 0 }), new RegExp(`viewBox="0 0 ${size} ${size}"`));
  assert.match(QR.svg("600B", { scale: 10 }), new RegExp(`width="${(size + 8) * 10}"`));
});

// --------------------------------------------------------------- goldens

/* Frozen matrices. Each was round-tripped through jsQR at the moment it was
 * recorded, so these digests carry that proof forward into any environment
 * where the decoder is not installed. They are not a substitute for the round
 * trip — they cannot catch a first mistake, only a later one. */
const GOLDEN = [
  ["600B", "M", 1, 2, "c82dd874a9780ce42ffb67507293df99"],
  [INVOICE, "L", 9, 2, "939109461a21ea3690355eb4288862cf"],
  [INVOICE, "M", 10, 2, "f073e64b38717b4a61c7a27b3089fcbd"],
  [INVOICE, "Q", 13, 2, "7cc7c78ff5d48824188977ecbdd549fc"],
  [INVOICE, "H", 15, 4, "c3266ef26eb4b359717ab307000441d8"],
  [filler(1091), "L", 23, 2, "034c7e1deb54cba118813a14e877dc68"],
  [filler(2953), "L", 40, 2, "f9fd1157bb555d52606020d3b05047af"],
  ["", "M", 1, 3, "09e0cba0337174fdb2d0a6e4aa123183"],
  ["⚡ 600B — Zahlung", "H", 3, 6, "ef0c45b335e8a56fed9249350f6a983e"],
];

test("known-good matrices are byte-for-byte unchanged", () => {
  for (const [text, ec, version, mask, digest] of GOLDEN) {
    const result = QR.encode(text, { ec });
    assert.equal(result.version, version, `version for ${JSON.stringify(text.slice(0, 12))}`);
    assert.equal(result.mask, mask, `mask for ${JSON.stringify(text.slice(0, 12))}`);
    const flat = result.modules.map((row) => row.map((m) => (m ? 1 : 0)).join("")).join("");
    const got = createHash("sha256")
      .update(`${result.version}/${result.ec}/${result.mask}/${flat}`)
      .digest("hex")
      .slice(0, 32);
    assert.equal(got, digest, `matrix changed for ${JSON.stringify(text.slice(0, 12))} at ec ${ec}`);
  }
});

test("encode() returns a square boolean matrix and nothing else", () => {
  const result = QR.encode(INVOICE);
  assert.equal(result.modules.length, result.size);
  for (const row of result.modules) {
    assert.equal(row.length, result.size);
    for (const m of row) assert.equal(typeof m, "boolean");
  }
  // Uint8Array in, same code out — the byte-mode path takes bytes either way.
  const bytes = new TextEncoder().encode(INVOICE);
  assert.deepEqual(QR.encode(bytes).modules, result.modules);
});

test("the decoder was actually available", { skip: NO_DECODER }, () => {
  assert.equal(typeof jsQR, "function");
});
