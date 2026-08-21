"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PUBKEY = /^[0-9a-f]{64}$/;

function checkedPubkey(value) {
  if (typeof value !== "string" || !PUBKEY.test(value)) {
    throw new Error("relay wallet buyer pubkey must be 64-character lowercase hex");
  }
  return value;
}

/** Maintain the TCG-owned, kind-scoped relay allowlist as an atomic text file. */
function createRelayWalletAllowlist(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("relay wallet allowlist path must be absolute");
  }

  const read = () => {
    let body;
    try { body = fs.readFileSync(filePath, "utf8"); }
    catch (error) {
      if (error && error.code === "ENOENT") return new Set();
      throw error;
    }
    return new Set(body.split(/\r?\n/).filter(Boolean).map(checkedPubkey));
  };

  const authorizeMany = (pubkeys) => {
    if (!pubkeys || typeof pubkeys[Symbol.iterator] !== "function") {
      throw new Error("relay wallet buyer pubkeys must be iterable");
    }
    const additions = Array.from(pubkeys, checkedPubkey);
    const entries = read();
    for (const pubkey of additions) entries.add(pubkey);

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
    const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    try {
      fs.writeFileSync(temporary, [...entries].sort().map((key) => `${key}\n`).join(""), {
        encoding: "utf8",
        mode: 0o644,
      });
      fs.renameSync(temporary, filePath);
      fs.chmodSync(filePath, 0o644);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
    }
    return entries.size;
  };

  return {
    authorize: (pubkey) => authorizeMany([pubkey]),
    authorizeMany,
    entries: () => [...read()].sort(),
  };
}

module.exports = { createRelayWalletAllowlist };
