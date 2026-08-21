import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { patchRelayPolicy } = require("../../server/relay-policy-patch.js");

const ACTIVE_POLICY_SHAPE = `#!/bin/sh
exec python3 -c '
ALLOW = {
"existing-pilot",
}
PRIVATE_KINDS = {443, 444, 445, 1059}
LORE_KIND = 4600

if kind in PRIVATE_KINDS or pubkey in ALLOW:
    emit(event_id, "accept")
'
`;

test("relay migration permits only TCG buyer backup events", () => {
  const patched = patchRelayPolicy(ACTIVE_POLICY_SHAPE);

  assert.equal(patched.changed, true);
  assert.match(patched.source, /WALLET_BACKUP_KIND = 37378/);
  assert.match(patched.source, /\/etc\/relay-allow\/tcg-wallet-buyers/);
  assert.match(
    patched.source,
    /kind in PRIVATE_KINDS or pubkey in ALLOW or wallet_backup_allowed\(pubkey, kind\)/,
  );
  assert.match(patched.source, /LORE_KIND = 4600/, "the existing lore policy is preserved");
  assert.match(patched.source, /"existing-pilot"/, "the existing pilot roster is preserved");

  const repeated = patchRelayPolicy(patched.source);
  assert.equal(repeated.changed, false, "the production deploy is idempotent");
  assert.equal(repeated.source, patched.source);
});

test("relay migration refuses an unknown policy instead of replacing it", () => {
  assert.throws(
    () => patchRelayPolicy("#!/bin/sh\nexit 0\n"),
    /expected active strfry policy anchors/,
  );
});

test("relay migration refuses a partial previous installation", () => {
  const partial = ACTIVE_POLICY_SHAPE.replace(
    "PRIVATE_KINDS = {443, 444, 445, 1059}",
    "PRIVATE_KINDS = {443, 444, 445, 1059}\nWALLET_BACKUP_KIND = 37378",
  );
  assert.throws(() => patchRelayPolicy(partial), /incomplete wallet-backup policy installation/);
});
