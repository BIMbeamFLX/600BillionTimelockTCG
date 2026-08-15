/* BIP-340 verification — the proof that site/schnorr.js is not merely plausible.
 *
 * Three independent kinds of evidence, because a hand-rolled curve that passes
 * only its author's own idea of a test is worth nothing:
 *   1. the OFFICIAL BIP-340 test vectors, all 19, verbatim from
 *      bitcoin/bips/bip-0340/test-vectors.csv — including every deliberate
 *      failure case (off-curve key, odd-Y R, negated m/s/e, r = 0, s = 0,
 *      r >= p, s >= n). These are the cases a naive implementation passes by
 *      accident and a wrong one fails silently.
 *   2. DIFFERENTIAL testing against @noble/curves: 500 real signatures must be
 *      accepted and 500 mutated ones rejected, with both implementations
 *      agreeing on every single call.
 *   3. NIP-01 event ids over unicode and nested tags, against events actually
 *      signed by @noble — the canonical serialization has to match the one the
 *      signer used or the leaderboard rejects honest players.
 *
 * Run: node --test tests/js/schnorr.test.mjs
 * (the DIRECTORY form of --test fails on Windows; use the file/glob form)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
require("../../site/schnorr.js");
const S = globalThis.E1Schnorr;
const { schnorr } = require("@noble/curves/secp256k1");

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));

// --------------------------------------------------------------- the vectors

/* Verbatim from https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv
 * (index, secret key, public key, aux_rand, message, signature, result, comment).
 * The CSV is uppercase; E1Schnorr accepts lowercase only, so the test lowercases
 * at the call site and the constants stay byte-identical to the source. */
const VECTORS = [
  {
    index: 0,
    sk: "0000000000000000000000000000000000000000000000000000000000000003",
    pk: "F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9",
    aux: "0000000000000000000000000000000000000000000000000000000000000000",
    msg: "0000000000000000000000000000000000000000000000000000000000000000",
    sig: "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0",
    result: true,
    comment: "",
  },
  {
    index: 1,
    sk: "B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "0000000000000000000000000000000000000000000000000000000000000001",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A",
    result: true,
    comment: "",
  },
  {
    index: 2,
    sk: "C90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9",
    pk: "DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8",
    aux: "C87AA53824B4D7AE2EB035A2B5BBBCCC080E76CDC6D1692C4B0B62D798E6D906",
    msg: "7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C",
    sig: "5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7",
    result: true,
    comment: "",
  },
  {
    index: 3,
    sk: "0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710",
    pk: "25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517",
    aux: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    msg: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    sig: "7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3",
    result: true,
    comment: "test fails if msg is reduced modulo p or n",
  },
  {
    index: 4,
    sk: "",
    pk: "D69C3509BB99E412E68B0FE8544E72837DFA30746D8BE2AA65975F29D22DC7B9",
    aux: "",
    msg: "4DF3C3F68FCC83B27E9D42C90431A72499F17875C81A599B566C9889B9696703",
    sig: "00000000000000000000003B78CE563F89A0ED9414F5AA28AD0D96D6795F9C6376AFB1548AF603B3EB45C9F8207DEE1060CB71C04E80F593060B07D28308D7F4",
    result: true,
    comment: "",
  },
  {
    index: 5,
    sk: "",
    pk: "EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B",
    result: false,
    comment: "public key not on the curve",
  },
  {
    index: 6,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "FFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A14602975563CC27944640AC607CD107AE10923D9EF7A73C643E166BE5EBEAFA34B1AC553E2",
    result: false,
    comment: "has_even_y(R) is false",
  },
  {
    index: 7,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "1FA62E331EDBC21C394792D2AB1100A7B432B013DF3F6FF4F99FCB33E0E1515F28890B3EDB6E7189B630448B515CE4F8622A954CFE545735AAEA5134FCCDB2BD",
    result: false,
    comment: "negated message",
  },
  {
    index: 8,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769961764B3AA9B2FFCB6EF947B6887A226E8D7C93E00C5ED0C1834FF0D0C2E6DA6",
    result: false,
    comment: "negated s value",
  },
  {
    index: 9,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "0000000000000000000000000000000000000000000000000000000000000000123DDA8328AF9C23A94C1FEECFD123BA4FB73476F0D594DCB65C6425BD186051",
    result: false,
    comment: "sG - eP is infinite. Test fails in single verification if has_even_y(inf) is defined as true and x(inf) as 0",
  },
  {
    index: 10,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "00000000000000000000000000000000000000000000000000000000000000017615FBAF5AE28864013C099742DEADB4DBA87F11AC6754F93780D5A1837CF197",
    result: false,
    comment: "sG - eP is infinite. Test fails in single verification if has_even_y(inf) is defined as true and x(inf) as 1",
  },
  {
    index: 11,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "4A298DACAE57395A15D0795DDBFD1DCB564DA82B0F269BC70A74F8220429BA1D69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B",
    result: false,
    comment: "sig[0:32] is not an X coordinate on the curve",
  },
  {
    index: 12,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B",
    result: false,
    comment: "sig[0:32] is equal to field size",
  },
  {
    index: 13,
    sk: "",
    pk: "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
    result: false,
    comment: "sig[32:64] is equal to curve order",
  },
  {
    index: 14,
    sk: "",
    pk: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC30",
    aux: "",
    msg: "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
    sig: "6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B",
    result: false,
    comment: "public key is not a valid X coordinate because it exceeds the field size",
  },
  {
    index: 15,
    sk: "0340034003400340034003400340034003400340034003400340034003400340",
    pk: "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117",
    aux: "0000000000000000000000000000000000000000000000000000000000000000",
    msg: "",
    sig: "71535DB165ECD9FBBC046E5FFAEA61186BB6AD436732FCCC25291A55895464CF6069CE26BF03466228F19A3A62DB8A649F2D560FAC652827D1AF0574E427AB63",
    result: true,
    comment: "message of size 0 (added 2022-12)",
  },
  {
    index: 16,
    sk: "0340034003400340034003400340034003400340034003400340034003400340",
    pk: "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117",
    aux: "0000000000000000000000000000000000000000000000000000000000000000",
    msg: "11",
    sig: "08A20A0AFEF64124649232E0693C583AB1B9934AE63B4C3511F3AE1134C6A303EA3173BFEA6683BD101FA5AA5DBC1996FE7CACFC5A577D33EC14564CEC2BACBF",
    result: true,
    comment: "message of size 1 (added 2022-12)",
  },
  {
    index: 17,
    sk: "0340034003400340034003400340034003400340034003400340034003400340",
    pk: "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117",
    aux: "0000000000000000000000000000000000000000000000000000000000000000",
    msg: "0102030405060708090A0B0C0D0E0F1011",
    sig: "5130F39A4059B43BC7CAC09A19ECE52B5D8699D1A71E3C52DA9AFDB6B50AC370C4A482B77BF960F8681540E25B6771ECE1E5A37FD80E5A51897C5566A97EA5A5",
    result: true,
    comment: "message of size 17 (added 2022-12)",
  },
  {
    index: 18,
    sk: "0340034003400340034003400340034003400340034003400340034003400340",
    pk: "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117",
    aux: "0000000000000000000000000000000000000000000000000000000000000000",
    msg: "99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
    sig: "403B12B0D8555A344175EA7EC746566303321E5DBFA8BE6F091635163ECA79A8585ED3E3170807E7C03B720FC54C7B23897FCBA0E9D0B4A06894CFD249F22367",
    result: true,
    comment: "message of size 100 (added 2022-12)",
  },
];

// ------------------------------------------------------- 1. official vectors

test("BIP-340: all 19 official test vectors", async () => {
  assert.equal(VECTORS.length, 19, "the CSV has indices 0..18");
  for (const v of VECTORS) {
    const got = await S.verify(v.sig.toLowerCase(), v.msg.toLowerCase(), v.pk.toLowerCase());
    assert.equal(
      got, v.result,
      `vector ${v.index} expected ${v.result}${v.comment ? ` — ${v.comment}` : ""}`,
    );
  }
});

test("BIP-340: the vectors were transcribed correctly (secret key derives the listed pubkey)", () => {
  /* Guards against a typo in the table above silently turning a real vector into
   * a self-consistent fake. Only the vectors that publish a secret key can be
   * checked this way; the failure cases carry none by design. */
  let checked = 0;
  for (const v of VECTORS) {
    if (!v.sk) continue;
    assert.equal(
      hex(schnorr.getPublicKey(bytes(v.sk))), v.pk.toLowerCase(),
      `vector ${v.index}: secret key does not derive the listed public key`,
    );
    checked += 1;
  }
  assert.equal(checked, 8, "vectors 0,1,2,3,15,16,17,18 carry a secret key");
});

test("BIP-340: @noble agrees with every official vector too", () => {
  // If this ever disagrees, the table is wrong — not both implementations.
  for (const v of VECTORS) {
    let got = false;
    try {
      got = schnorr.verify(bytes(v.sig), bytes(v.msg), bytes(v.pk));
    } catch (err) {
      got = false;
    }
    assert.equal(got, v.result, `@noble disagrees on vector ${v.index}`);
  }
});

test("BIP-340: uppercase vectors are rejected (lowercase hex is the contract)", async () => {
  const v = VECTORS[1];
  assert.equal(await S.verify(v.sig, v.msg, v.pk), false);
});

// --------------------------------------------------- 2. differential fuzzing

const ROUNDS = 500;

test(`differential: ${ROUNDS} @noble signatures are accepted`, async () => {
  for (let i = 0; i < ROUNDS; i++) {
    const sk = randomBytes(32);
    const pk = schnorr.getPublicKey(sk);
    // Mostly 32-byte (what nostr uses), but stir in other lengths so the
    // variable-length message path is exercised against a real signer.
    const msg = randomBytes(i % 7 === 0 ? i % 40 : 32);
    const sig = schnorr.sign(msg, sk);
    assert.equal(schnorr.verify(sig, msg, pk), true, `@noble rejected its own signature at ${i}`);
    assert.equal(
      await S.verify(hex(sig), hex(msg), hex(pk)), true,
      `E1Schnorr rejected a valid signature at ${i}: sig=${hex(sig)} msg=${hex(msg)} pk=${hex(pk)}`,
    );
  }
});

/* Flip exactly one bit somewhere in the triple. One bit is the hard case: a
 * verifier that skips a range check or gets the even-Y rule backwards still
 * rejects garbage, but accepts near-misses. */
const flip = (buf, rnd) => {
  const out = Uint8Array.from(buf);
  const byte = rnd[0] % out.length;
  out[byte] ^= 1 << (rnd[1] % 8);
  return out;
};

test(`differential: ${ROUNDS} single-bit mutations are rejected`, async () => {
  for (let i = 0; i < ROUNDS; i++) {
    const sk = randomBytes(32);
    const pk = schnorr.getPublicKey(sk);
    const msg = randomBytes(32);
    const sig = schnorr.sign(msg, sk);
    const rnd = randomBytes(3);
    let mSig = sig, mMsg = msg, mPk = pk;
    if (rnd[2] % 3 === 0) mSig = flip(sig, rnd);
    else if (rnd[2] % 3 === 1) mMsg = flip(msg, rnd);
    else mPk = flip(pk, rnd);

    const mine = await S.verify(hex(mSig), hex(mMsg), hex(mPk));
    let theirs = false;
    try {
      theirs = schnorr.verify(mSig, mMsg, mPk);
    } catch (err) {
      theirs = false;
    }
    assert.equal(mine, false, `E1Schnorr accepted a mutated signature at ${i}: sig=${hex(mSig)} msg=${hex(mMsg)} pk=${hex(mPk)}`);
    assert.equal(theirs, false, `@noble accepted a mutated signature at ${i}`);
  }
});

test("differential: wholesale wrong signature/pubkey is rejected", async () => {
  for (let i = 0; i < 100; i++) {
    const skA = randomBytes(32), skB = randomBytes(32);
    const pkA = schnorr.getPublicKey(skA), pkB = schnorr.getPublicKey(skB);
    const msg = randomBytes(32);
    const sigA = schnorr.sign(msg, skA);
    assert.equal(await S.verify(hex(sigA), hex(msg), hex(pkA)), true);
    assert.equal(await S.verify(hex(sigA), hex(msg), hex(pkB)), false, "signature verified under the wrong key");
    assert.equal(await S.verify(hex(schnorr.sign(msg, skB)), hex(msg), hex(pkA)), false);
    assert.equal(await S.verify(hex(sigA), hex(randomBytes(32)), hex(pkA)), false, "signature verified over the wrong message");
  }
});

// -------------------------------------------------- 3. NIP-01 events, for real

const nodeEventId = (event) => createHash("sha256")
  .update(Buffer.from(JSON.stringify([
    0, event.pubkey, event.created_at, event.kind, event.tags, event.content,
  ]), "utf8"))
  .digest("hex");

function signEvent(sk, unsigned) {
  const event = Object.assign({ pubkey: hex(schnorr.getPublicKey(sk)) }, unsigned);
  event.pubkey = hex(schnorr.getPublicKey(sk));
  event.id = nodeEventId(event);
  event.sig = hex(schnorr.sign(bytes(event.id), sk));
  return event;
}

const SK = Uint8Array.from(createHash("sha256").update("600b:schnorr:test").digest());

const SAMPLES = [
  {
    name: "plain ascii result event",
    kind: 31600,
    created_at: 1_700_000_000,
    tags: [["d", "m_0123456789ab"], ["t", "600b-timelock-tcg"]],
    content: '{"v":1,"kind":"result","winner":0}',
  },
  {
    name: "unicode content",
    kind: 1,
    created_at: 1_700_000_001,
    // Emoji (surrogate pairs), CJK, RTL, combining marks, a nbsp — all must
    // survive JSON.stringify + UTF-8 verbatim, unescaped.
    tags: [["alt", "600B Timelock TCG — résultat"]],
    content: "GG 🃏♠️ — 600B ティムロック 決着！ مرحبا combining: é end",
  },
  {
    name: "content that JSON must escape",
    kind: 1,
    created_at: 1_700_000_002,
    tags: [],
    content: 'line\nbreak\ttab "quoted" back\\slash \r\b\f and a control ',
  },
  {
    name: "nested / multi-value tags",
    kind: 31600,
    created_at: 1_700_000_003,
    tags: [
      ["e", "0".repeat(64), "wss://relay.damus.io", "root"],
      ["p", "1".repeat(64), "wss://nos.lol"],
      ["relays", "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
      ["alt", "600B Timelock TCG match result"],
      [],
    ],
    content: JSON.stringify({ v: 1, kind: "result", players: [{ seat: 0 }, { seat: 1 }] }),
  },
  {
    name: "empty content, no tags",
    kind: 22242,
    created_at: 1_700_000_004,
    tags: [],
    content: "",
  },
];

test("eventId: matches an independently computed NIP-01 id", async () => {
  for (const s of SAMPLES) {
    const event = signEvent(SK, { kind: s.kind, created_at: s.created_at, tags: s.tags, content: s.content });
    assert.equal(await S.eventId(event), nodeEventId(event), `id mismatch: ${s.name}`);
    assert.match(await S.eventId(event), /^[0-9a-f]{64}$/);
  }
});

test("verifyEvent: accepts events actually signed by @noble", async () => {
  for (const s of SAMPLES) {
    const event = signEvent(SK, { kind: s.kind, created_at: s.created_at, tags: s.tags, content: s.content });
    assert.equal(await S.verifyEvent(event), true, `rejected a valid event: ${s.name}`);
  }
});

test("verifyEvent: rejects every way an event can be tampered with", async () => {
  const base = () => signEvent(SK, {
    kind: 31600,
    created_at: 1_700_000_005,
    tags: [["d", "m_0123456789ab"], ["p", "2".repeat(64)]],
    content: '{"v":1,"kind":"result","winner":1}',
  });

  // Content swapped, id left as signed: the signature still matches the id, so
  // only recomputing the id catches this. This is the relay's attack.
  const swapped = base();
  swapped.content = '{"v":1,"kind":"result","winner":0}';
  assert.equal(await S.verifyEvent(swapped), false, "content swap under a signed id was accepted");

  // Content swapped AND id recomputed: id is self-consistent, signature is not.
  const reid = base();
  reid.content = '{"v":1,"kind":"result","winner":0}';
  reid.id = nodeEventId(reid);
  assert.equal(await S.verifyEvent(reid), false, "re-id'd forgery was accepted");

  // Tag order matters — the serialization is positional.
  const reordered = base();
  reordered.tags = [reordered.tags[1], reordered.tags[0]];
  assert.equal(await S.verifyEvent(reordered), false);

  // Someone else's pubkey on someone else's signature.
  const impostor = base();
  impostor.pubkey = hex(schnorr.getPublicKey(randomBytes(32)));
  assert.equal(await S.verifyEvent(impostor), false);

  for (const field of ["created_at", "kind"]) {
    const bumped = base();
    bumped[field] = bumped[field] + 1;
    assert.equal(await S.verifyEvent(bumped), false, `${field} bump was accepted`);
  }

  const unsigned = base();
  delete unsigned.sig;
  assert.equal(await S.verifyEvent(unsigned), false);

  const idless = base();
  delete idless.id;
  assert.equal(await S.verifyEvent(idless), false);

  // One flipped bit in the signature of an otherwise perfect event.
  const nudged = base();
  nudged.sig = hex(flip(bytes(nudged.sig), Uint8Array.from([7, 3])));
  assert.equal(await S.verifyEvent(nudged), false);
});

test("verifyEvent: 200 freshly signed random events round-trip", async () => {
  for (let i = 0; i < 200; i++) {
    const sk = randomBytes(32);
    const event = signEvent(sk, {
      kind: 31600,
      created_at: 1_700_000_000 + i,
      tags: [["d", `m_${hex(randomBytes(6))}`], ["p", hex(schnorr.getPublicKey(randomBytes(32)))]],
      content: `round ${i} — 🃏 ${hex(randomBytes(8))}`,
    });
    assert.equal(await S.verifyEvent(event), true, `rejected a valid event at ${i}`);
  }
});

// ------------------------------------------------------- 4. malformed inputs

test("verify: malformed input returns false and never throws", async () => {
  const v = VECTORS[1];
  const sig = v.sig.toLowerCase(), msg = v.msg.toLowerCase(), pk = v.pk.toLowerCase();
  assert.equal(await S.verify(sig, msg, pk), true, "the good case must be good first");

  const junk = [
    null, undefined, "", 0, 1, NaN, true, false, [], {},
    () => {}, Symbol.iterator, 12345678901234567890n, new Uint8Array(32),
    "0x" + sig, " " + sig, sig + " ", "\n", "zz", "not hex at all",
    sig.toUpperCase(), pk.toUpperCase(), msg.toUpperCase(),
    sig.slice(0, 126), sig + "00", sig.slice(1), pk.slice(0, 62), pk + "ff",
    "f".repeat(63), "f".repeat(65), "f".repeat(127), "f".repeat(129),
    "g".repeat(64), "G".repeat(128), "0".repeat(64) + " ".repeat(64),
  ];

  for (const bad of junk) {
    const label = String(typeof bad === "symbol" ? "symbol" : bad).slice(0, 40);
    assert.equal(await S.verify(bad, msg, pk), false, `bad sig accepted: ${label}`);
    assert.equal(await S.verify(sig, bad, pk), false, `bad msg accepted: ${label}`);
    assert.equal(await S.verify(sig, msg, bad), false, `bad pubkey accepted: ${label}`);
  }

  assert.equal(await S.verify(), false);
  assert.equal(await S.verify(sig), false);
  assert.equal(await S.verify(sig, msg), false);
});

test("verify: the empty message is a legal 0-byte message, not a parse error", async () => {
  /* BIP-340 vector 15 signs a zero-length message, so "" in the MESSAGE slot is
   * valid input — it just has to be the message that was actually signed. In the
   * signature and pubkey slots "" is a length error and stays rejected (covered
   * above). Documented here so nobody "fixes" fromHex into rejecting "". */
  const v15 = VECTORS[15];
  assert.equal(await S.verify(v15.sig.toLowerCase(), "", v15.pk.toLowerCase()), true);
  const v1 = VECTORS[1];
  assert.equal(await S.verify(v1.sig.toLowerCase(), "", v1.pk.toLowerCase()), false);
});

test("eventId / verifyEvent: malformed input returns null / false, never throws", async () => {
  const good = signEvent(SK, { kind: 1, created_at: 1_700_000_006, tags: [], content: "hi" });
  const junk = [
    null, undefined, "", 0, NaN, true, [], "not an event", 1n,
    {},
    Object.assign({}, good, { pubkey: undefined }),
    Object.assign({}, good, { pubkey: null }),
    Object.assign({}, good, { pubkey: good.pubkey.toUpperCase() }),
    Object.assign({}, good, { pubkey: good.pubkey.slice(0, 63) }),
    Object.assign({}, good, { created_at: "1700000006" }),
    Object.assign({}, good, { created_at: 1.5 }),
    Object.assign({}, good, { created_at: NaN }),
    Object.assign({}, good, { kind: "1" }),
    Object.assign({}, good, { tags: null }),
    Object.assign({}, good, { tags: "[]" }),
    Object.assign({}, good, { content: null }),
    Object.assign({}, good, { content: 42 }),
    Object.assign({}, good, { id: null }),
    Object.assign({}, good, { id: good.id.toUpperCase() }),
    Object.assign({}, good, { sig: null }),
    Object.assign({}, good, { sig: good.sig.toUpperCase() }),
  ];
  for (const bad of junk) {
    // Built with String(), not JSON.stringify() — a BigInt in the junk list must
    // break the module under test, not the assertion message.
    const label = String(bad && typeof bad === "object" ? Object.keys(bad).join(",") : bad).slice(0, 80);
    const id = await S.eventId(bad);
    assert.ok(id === null || /^[0-9a-f]{64}$/.test(id), `eventId returned something odd: ${id}`);
    assert.equal(await S.verifyEvent(bad), false, `verifyEvent accepted: ${label}`);
  }
  // A circular object would make JSON.stringify throw — it must still not escape.
  const circular = Object.assign({}, good);
  circular.tags = [["self"]];
  circular.tags.push(circular.tags);
  assert.equal(await S.eventId(circular), null);
  assert.equal(await S.verifyEvent(circular), false);

  assert.equal(await S.eventId(), null);
  assert.equal(await S.verifyEvent(), false);
});

test("API shape: exactly three functions, all async", () => {
  assert.deepEqual(Object.keys(S).sort(), ["eventId", "verify", "verifyEvent"]);
  for (const name of ["verify", "eventId", "verifyEvent"]) {
    assert.equal(typeof S[name], "function", `${name} is missing`);
    const returned = S[name]("", "", "");
    assert.ok(returned instanceof Promise, `${name} must return a Promise`);
    returned.catch(() => {}); // nothing here may reject, but do not warn if it did
  }
});
