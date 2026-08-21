"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DECLARATION_ANCHOR = "PRIVATE_KINDS = {443, 444, 445, 1059}";
const GATE_ANCHOR = "if kind in PRIVATE_KINDS or pubkey in ALLOW:";
const MARKER = "WALLET_BACKUP_KIND = 37378";
const PATCHED_GATE =
  "if kind in PRIVATE_KINDS or pubkey in ALLOW or wallet_backup_allowed(pubkey, kind):";
const WALLET_POLICY = `${MARKER}
WALLET_BACKUP_ALLOWLIST = "/etc/relay-allow/tcg-wallet-buyers"

def wallet_backup_allowed(pubkey, kind):
    if kind != WALLET_BACKUP_KIND:
        return False
    try:
        with open(WALLET_BACKUP_ALLOWLIST, "r", encoding="ascii") as allowlist:
            return any(line.rstrip("\\n") == pubkey for line in allowlist)
    except OSError:
        return False
`;

function exactlyOnce(source, value) {
  return source.indexOf(value) >= 0 && source.indexOf(value) === source.lastIndexOf(value);
}

/** Add the TCG buyer rule to the known production policy without replacing it. */
function patchRelayPolicy(source) {
  if (typeof source !== "string") throw new Error("strfry policy source must be text");
  if (source.includes(MARKER)) {
    if (
      !exactlyOnce(source, MARKER)
      || !exactlyOnce(source, "def wallet_backup_allowed(pubkey, kind):")
      || !exactlyOnce(source, PATCHED_GATE)
    ) {
      throw new Error("incomplete wallet-backup policy installation");
    }
    return { source, changed: false };
  }
  if (!exactlyOnce(source, DECLARATION_ANCHOR) || !exactlyOnce(source, GATE_ANCHOR)) {
    throw new Error("expected active strfry policy anchors were not found exactly once");
  }

  const withRule = source.replace(
    DECLARATION_ANCHOR,
    `${DECLARATION_ANCHOR}\n${WALLET_POLICY}`,
  );
  return {
    changed: true,
    source: withRule.replace(GATE_ANCHOR, PATCHED_GATE),
  };
}

function installPolicy(target) {
  if (!path.isAbsolute(target)) throw new Error("strfry policy target must be absolute");
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) throw new Error("strfry policy target must be a regular file");
  const result = patchRelayPolicy(fs.readFileSync(target, "utf8"));
  if (!result.changed) return { ...result, backup: null };

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backup = `${target}.tcg-wallet-backup-${stamp}`;
  const temporary = `${target}.tmp-${process.pid}`;
  fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  try {
    fs.writeFileSync(temporary, result.source, { encoding: "utf8", mode: stat.mode });
    fs.chmodSync(temporary, stat.mode);
    fs.chownSync(temporary, stat.uid, stat.gid);
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }
  return { ...result, backup };
}

if (require.main === module) {
  try {
    const result = installPolicy(process.argv[2] || "");
    console.log(result.changed ? "changed" : "unchanged");
    if (result.backup) console.log(`backup=${result.backup}`);
  } catch (error) {
    console.error(`relay policy install failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { installPolicy, patchRelayPolicy };
