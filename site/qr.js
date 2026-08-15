/* 600B Timelock TCG — QR codes, from nothing.
 *
 * WHY THIS EXISTS. A wager is settled by the loser paying a bolt11 invoice from
 * their own wallet — the app never custodies a sat (see net.js). On a desktop
 * that leaves a 200-character string on one screen and the wallet on a phone in
 * someone's hand. A QR is the only bridge, and there is no bundler here: every
 * site/ file is a plain <script>, so a QR library from npm is not reachable
 * from the browser. Hence this file.
 *
 * SCOPE, deliberately narrow. BYTE MODE ONLY. bolt11 is lowercase bech32 and an
 * lnurl is a URL; neither benefits from alphanumeric mode enough to be worth
 * the second code path, and kanji mode is not our problem. What is NOT optional
 * is the error correction: a QR that scans on a clean screen and fails on a
 * cracked phone under a bar light is worse than no QR, because it fails at the
 * one moment money is meant to move.
 *
 * This module holds NO DOM. It returns a matrix and a string; the page decides
 * where to put them. Standard globals only, so `node --test` loads it too —
 * which is the entire reason tests/js/qr.test.mjs can prove it decodes.
 *
 * Conforms to ISO/IEC 18004. Versions 1–40, EC levels L/M/Q/H.
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------ tables

  /* EC levels, in the order their two-bit FORMAT code demands. That order is
   * L=01 M=00 Q=11 H=10 — NOT the ascending strength a human would write — and
   * mixing the two up produces a code every scanner rejects, because it reads
   * the wrong ECC block layout out of an otherwise perfect matrix. So the
   * format bits live here, next to the name, rather than in a bare array. */
  const EC = {
    L: { index: 0, formatBits: 1 },
    M: { index: 1, formatBits: 0 },
    Q: { index: 2, formatBits: 3 },
    H: { index: 3, formatBits: 2 },
  };

  /* Per (level, version): ECC codewords in each block, and how many blocks.
   *
   * These two tables replace the sprawling "group 1 / group 2" table most
   * hand-rolled encoders copy by hand and get wrong somewhere past version 9.
   * They are equivalent: given a block COUNT, the split into short and long
   * blocks is forced arithmetic (see addEcc), because the spec's groups are
   * just "the remainder is spread one codeword at a time over the last
   * blocks". Deriving it beats transcribing 160 rows of two numbers each.
   *
   * Index 0 is a hole so that version numbers index directly. */
  const ECC_PER_BLOCK = [
    // 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
    [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
    [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
    [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
  ];
  const NUM_BLOCKS = [
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
    [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
    [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
    [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
  ];

  const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;
  const MIN_VERSION = 1, MAX_VERSION = 40;

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  // ------------------------------------------------------------- geometry

  /* Modules left over once the finders, timing lines, alignment squares, format
   * and version blocks are carved out. Computed, not tabulated, for the same
   * reason as the block split: an arithmetic identity cannot drift. */
  function rawDataModules(version) {
    let n = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const numAlign = Math.floor(version / 7) + 2;
      n -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) n -= 36; // the two 6x3 version blocks
    }
    return n;
  }

  const totalCodewords = (version) => Math.floor(rawDataModules(version) / 8);

  const dataCodewords = (version, ec) =>
    totalCodewords(version) - ECC_PER_BLOCK[ec.index][version] * NUM_BLOCKS[ec.index][version];

  /* Alignment centres. Row/column 6 is always one of them (it is the timing
   * line), the last is always 4*version+10, and the rest are laid out by
   * stepping DOWNWARD from that last one — not upward from 6, which is the
   * classic mistake and leaves the first gap wider than the rest.
   *
   * The step is a FLOOR division rounded up to an even number. Reaching for
   * Math.ceil here instead reads as the safer choice and is wrong from version
   * 7 onward (6,20,38 where the spec says 6,22,38); the symbol still looks
   * perfect, and every scanner reads garbage, because misplaced alignment
   * squares displace the data modules that flow around them.
   *
   * Version 32 is the one case the arithmetic misses outright. The spec just
   * says 26 there, so this does too. */
  function alignmentCentres(version) {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
    const out = [6];
    for (let pos = version * 4 + 10; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  // -------------------------------------------------------------- GF(256)

  /* The field QR uses: bytes as polynomials modulo x^8+x^4+x^3+x^2+1 (0x11D).
   * Multiplied the long way, eight shift-and-reduce steps, rather than through
   * a log/antilog table pair. The tables are faster and the mask search dwarfs
   * this cost anyway; what the tables also are is one off-by-one from producing
   * ECC that looks plausible and corrects nothing. */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  /* The generator polynomial (x - a^0)(x - a^1)...(x - a^(degree-1)), returned
   * without its leading 1 — it is monic by construction, and leaving the term
   * implicit is what lets the remainder loop below be a plain shift register. */
  function rsDivisor(degree) {
    const out = new Uint8Array(degree);
    out[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        out[j] = gfMul(out[j], root);
        if (j + 1 < degree) out[j] ^= out[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return out;
  }

  function rsRemainder(data, divisor) {
    const out = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ out[0];
      out.copyWithin(0, 1);
      out[out.length - 1] = 0;
      for (let i = 0; i < out.length; i++) out[i] ^= gfMul(divisor[i], factor);
    }
    return out;
  }

  /* THE PART EVERYONE GETS WRONG. Above version 9 the data does not sit in one
   * run: it is cut into blocks of two different lengths, each gets its own ECC,
   * and then the blocks are read out COLUMN-WISE — first codeword of every
   * block, then the second of every block, and so on. Get the interleave wrong
   * and the matrix still looks like a QR code and still has valid-looking ECC;
   * it just decodes to noise, on every scanner, silently.
   *
   * The short blocks get a phantom padding codeword so the column walk lines
   * up, and that phantom is skipped on the way out. That is cheaper than
   * special-casing the ragged column. */
  function addEcc(data, version, ec) {
    const blockCount = NUM_BLOCKS[ec.index][version];
    const eccLen = ECC_PER_BLOCK[ec.index][version];
    const raw = totalCodewords(version);
    const shortBlocks = blockCount - (raw % blockCount);
    const shortLen = Math.floor(raw / blockCount);
    const divisor = rsDivisor(eccLen);

    const blocks = [];
    for (let i = 0, k = 0; i < blockCount; i++) {
      const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
      const dat = Array.from(data.slice(k, k + len));
      k += len;
      const ecc = rsRemainder(dat, divisor);
      if (i < shortBlocks) dat.push(0); // phantom, skipped below
      blocks.push(dat.concat(Array.from(ecc)));
    }

    const out = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i === shortLen - eccLen && j < shortBlocks) continue; // the phantom
        out.push(blocks[j][i]);
      }
    }
    return Uint8Array.from(out);
  }

  // ------------------------------------------------------------- bitstream

  function toBytes(text) {
    if (text instanceof Uint8Array) return text;
    if (typeof text !== "string") throw new Error("E1QR: encode() takes a string or a Uint8Array");
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text);
    // Ancient-browser fallback. Surrogate pairs are joined before encoding, so
    // an emoji is one 4-byte sequence rather than two broken 3-byte ones.
    const out = [];
    for (const ch of text) {
      let cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }

  /* Byte mode's character-count field is 8 bits up to version 9 and 16 bits
   * from version 10 — which means the payload's own length changes how much
   * room the payload has, so version choice and bitstream construction cannot
   * be separated. */
  const countBits = (version) => (version <= 9 ? 8 : 16);

  const bitsNeeded = (byteLen, version) => 4 + countBits(version) + 8 * byteLen;

  function buildBitstream(bytes, version, ec) {
    const capacity = dataCodewords(version, ec) * 8;
    const bits = [];
    const push = (value, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0b0100, 4); // byte mode
    push(bytes.length, countBits(version));
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, capacity - bits.length)); // terminator, truncated if tight
    push(0, (8 - (bits.length % 8)) % 8);

    const out = new Uint8Array(capacity / 8);
    for (let i = 0; i < bits.length; i++) out[i >>> 3] |= bits[i] << (7 - (i & 7));
    // The spec's pad bytes, alternating, until the data region is full.
    for (let i = bits.length / 8, pad = 0xec; i < out.length; i++, pad ^= 0xec ^ 0x11) out[i] = pad;
    return out;
  }

  // ------------------------------------------------------------ the matrix

  function build(bytes, ec, version) {
    const size = version * 4 + 17;
    const modules = [];
    const reserved = []; // function patterns: never masked, never written over
    for (let y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      reserved.push(new Array(size).fill(false));
    }

    const set = (x, y, dark) => {
      modules[y][x] = dark;
      reserved[y][x] = true;
    };

    // Finders, drawn with their separators in one pass: the 9x9 neighbourhood
    // of each centre, clipped at the edges, dark where the Chebyshev distance
    // is neither 2 (the white ring) nor 4 (the separator).
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    for (let i = 8; i < size - 8; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }

    const centres = alignmentCentres(version);
    for (let i = 0; i < centres.length; i++) {
      for (let j = 0; j < centres.length; j++) {
        // The three corners are already finders; an alignment square there
        // would overwrite them.
        const corner = (i === 0 && j === 0) ||
          (i === 0 && j === centres.length - 1) ||
          (i === centres.length - 1 && j === 0);
        if (corner) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            set(centres[j] + dx, centres[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    /* Reserve the format strips before the data walk, so codewords flow around
     * them. Their contents are written after the mask is chosen.
     *
     * Index 6 is SKIPPED in both strips. (8,6) and (6,8) look like they belong
     * to the format block and do not — they are the first modules of the two
     * timing lines, and blanking them here leaves both lines starting light
     * where the spec says dark. Most decoders never notice, because they take
     * the grid from the finder patterns and only ever treat these as reserved;
     * a scanner that counts modules along the timing line does notice. */
    for (let i = 0; i < 9; i++) {
      if (i === 6) continue;
      set(8, i, false);
      set(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      set(size - 1 - i, 8, false);
      set(8, size - 8 + i, false);
    }
    set(8, size - 8, true); // the dark module, mandatory, always here

    if (version >= 7) drawVersion(modules, reserved, size, version);

    const codewords = addEcc(buildBitstream(bytes, version, ec), version, ec);
    drawCodewords(modules, reserved, size, codewords);

    /* Try all eight masks, keep the least penalised. This is not cosmetic: an
     * unmasked matrix can grow large blank fields or accidental finder-shaped
     * runs that make a scanner mis-locate the symbol entirely. */
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(modules, reserved, size, mask);
      drawFormat(modules, size, ec, mask);
      const score = penalty(modules, size);
      if (score < bestScore) {
        bestScore = score;
        best = mask;
      }
      applyMask(modules, reserved, size, mask); // XOR is its own undo
    }
    applyMask(modules, reserved, size, best);
    drawFormat(modules, size, ec, best);

    return { version, ec: ecName(ec), mask: best, size, modules };
  }

  const ecName = (ec) => Object.keys(EC).find((k) => EC[k] === ec);

  /* The zigzag. Two-module-wide columns, right to left, alternating upward and
   * downward — and column 6 is SKIPPED because it is the vertical timing line.
   * Skipping it by decrementing rather than by an index shift is what keeps the
   * up/down parity attached to the true column position. */
  function drawCodewords(modules, reserved, size, data) {
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!reserved[y][x] && i < data.length * 8) {
            modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
    // Any leftover modules stay light — that is the spec's remainder, not a bug.
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function applyMask(modules, reserved, size, mask) {
    const fn = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  /* Format info: 5 data bits (2 EC + 3 mask), a BCH(15,5) remainder under
   * generator 0x537, then XOR with 0x5412 — the mask that stops the all-zero
   * format (L, mask 0) from being a blank strip a scanner cannot lock onto.
   * Written TWICE, in two differently-shaped copies, so a damaged corner still
   * yields the layout. */
  function drawFormat(modules, size, ec, mask) {
    const value = (ec.formatBits << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = (((value << 10) | rem) ^ 0x5412) & 0x7fff;

    for (let i = 0; i <= 5; i++) modules[i][8] = bit(bits, i);
    modules[7][8] = bit(bits, 6);
    modules[8][8] = bit(bits, 7);
    modules[8][7] = bit(bits, 8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(bits, i);

    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(bits, i);
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(bits, i);
    modules[size - 8][8] = true; // the dark module again — mask must not touch it
  }

  /* Version info, versions 7 and up: 6 data bits plus a BCH(18,6) remainder
   * under 0x1F25, mirrored into two 6x3 blocks by the finders. */
  function drawVersion(modules, reserved, size, version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = ((version << 12) | rem) >>> 0;
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      modules[b][a] = dark; reserved[b][a] = true;
      modules[a][b] = dark; reserved[a][b] = true;
    }
  }

  // -------------------------------------------------------------- penalty

  /* The four rules from the spec, scored the way the spec scores them. The
   * finder-lookalike rule (N3) is the fiddly one: the 1:1:3:1:1 run signature
   * has to be found in both directions AND has to count the quiet zone as part
   * of the run at the edges, which is why the run history is terminated with a
   * synthetic light border rather than simply ending. */
  function penalty(modules, size) {
    let score = 0;

    const countFinderish = (h) => {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const pushRun = (len, h) => {
      if (h[0] === 0) len += size; // the leading quiet zone counts as light
      h.pop();
      h.unshift(len);
    };
    const finishRun = (dark, len, h) => {
      if (dark) { pushRun(len, h); len = 0; }
      pushRun(len + size, h); // and the trailing quiet zone
      return countFinderish(h);
    };

    for (let pass = 0; pass < 2; pass++) {
      const at = (a, b) => (pass === 0 ? modules[a][b] : modules[b][a]);
      for (let a = 0; a < size; a++) {
        let colour = false, run = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b++) {
          if (at(a, b) === colour) {
            run++;
            if (run === 5) score += PENALTY_N1;
            else if (run > 5) score++;
          } else {
            pushRun(run, history);
            if (!colour) score += countFinderish(history) * PENALTY_N3;
            colour = at(a, b);
            run = 1;
          }
        }
        score += finishRun(colour, run, history) * PENALTY_N3;
      }
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          score += PENALTY_N2;
        }
      }
    }

    let dark = 0;
    for (const row of modules) for (const m of row) if (m) dark++;
    const total = size * size;
    // Deviation from 50% dark, in whole 5% steps, each step costing N4.
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_N4;
    return score;
  }

  // ----------------------------------------------------------- public API

  function levelOf(options) {
    const raw = String((options && options.ec) || "M").toUpperCase();
    const ec = EC[raw];
    if (!ec) throw new Error(`E1QR: unknown error correction level "${raw}" — use L, M, Q or H`);
    return ec;
  }

  /**
   * Encode text as a QR matrix.
   * @param {string|Uint8Array} text
   * @param {{ec?:"L"|"M"|"Q"|"H"}} [options]
   * @returns {{version:number, ec:string, mask:number, size:number, modules:boolean[][]}}
   *   modules[y][x] — true is dark.
   */
  function encode(text, options) {
    const ec = levelOf(options);
    const bytes = toBytes(text);
    for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
      if (bitsNeeded(bytes.length, version) <= dataCodewords(version, ec) * 8) {
        return build(bytes, ec, version);
      }
    }
    /* Refuse rather than truncate. A silently shortened invoice is a QR that
     * scans cleanly and pays the wrong thing — the worst possible failure for
     * this particular module. */
    const max = dataCodewords(MAX_VERSION, ec) - 3;
    throw new Error(
      `E1QR: ${bytes.length} bytes will not fit in any QR code — ` +
      `the ceiling at error correction ${ecName(ec)} is ${max} bytes (version 40)`
    );
  }

  /* Colours land inside an XML attribute, so anything that is not obviously a
   * CSS colour is refused and the default used instead. A caller passing a
   * string with a quote in it does not get to close the attribute. */
  const COLOUR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([0-9a-z%.,\s/+-]{1,64}\))$/i;
  const colour = (value, fallback) => (COLOUR.test(String(value || "")) ? String(value) : fallback);

  /**
   * Render as a standalone <svg> string.
   * @param {string|Uint8Array} text
   * @param {{ec?:string, dark?:string, light?:string, border?:number, scale?:number, label?:string}} [options]
   */
  function svg(text, options) {
    const opts = options || {};
    const { size, modules } = encode(text, opts);
    /* Four modules of quiet zone, because the spec says four and scanners mean
     * it: a QR flush against a dark page background is the single most common
     * reason a valid code will not read. */
    const border = Number.isInteger(opts.border) && opts.border >= 0 ? opts.border : 4;
    const scale = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 4;
    const dim = size + border * 2;
    const dark = colour(opts.dark, "#000000");
    const light = colour(opts.light, "#ffffff");

    /* One path, horizontal runs merged. A version 40 code is 31329 modules;
     * emitting one <rect> each is megabytes of markup that locks up a phone's
     * renderer for the sake of a picture of a square. */
    let d = "";
    for (let y = 0; y < size; y++) {
      let x = 0;
      while (x < size) {
        if (!modules[y][x]) { x++; continue; }
        let run = 1;
        while (x + run < size && modules[y][x + run]) run++;
        d += `M${x + border} ${y + border}h${run}v1h-${run}z`;
        x += run;
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
      `width="${dim * scale}" height="${dim * scale}" shape-rendering="crispEdges" ` +
      `role="img" aria-label="QR code">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
      `<path fill="${dark}" d="${d}"/></svg>`;
  }

  const API = { encode, svg, MIN_VERSION, MAX_VERSION };

  globalThis.E1QR = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
