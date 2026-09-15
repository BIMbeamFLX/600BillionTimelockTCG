"use strict";

/* Mint settings: which configurations may boot the E1 and Edition G mints.
 *
 * The rules live here and nowhere else. createNutftMint and the funding
 * backends apply them to what they are given, the referee applies them to its
 * environment before it opens anything, and server/env-check.js applies them to
 * a running service's environment as a dry run. None of them keeps its own
 * copy, so the dry run and the boot cannot disagree about a refusal.
 *
 * A problem is one line, "VARIABLE: reason". A reason names variables and
 * rules, never a value: values include passwords, macaroons and, pasted by
 * mistake, private keys. docs/mint-boot-checks.md lists every refusal.
 *
 * Node built-ins and ./lnurl.js only, so the dry run needs no node_modules. */

const path = require("node:path");
const { toPubkeyHex } = require("./lnurl.js");

const SALES = ["closed", "allowlist", "signed", "open"];
const BACKENDS = ["lnd", "phoenixd", "cashu", "mock", "none"];
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?)$/i;
/* The wallet refuses any other keyset unit, so a mint with one could never be read. */
const COLLECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SUPPLY_INTERVAL = { fallback: 86_400, min: 60 };

/* The editions differ in names and defaults only. A G setting never falls back
   to an E1 variable (ADR 0003), and G's permanent settings, hashed into every
   card or signed into its catalog, have no default at all. */
const EDITIONS = {
  E1: {
    prefix: "",
    defaults: { catalogUri: "http://localhost:8777/nutft/catalog", collectionId: "600B-E1", sales: "open", onePerKey: false, priceMsat: 21_000 },
    permanent: [],
  },
  G: {
    prefix: "G_",
    defaults: { sales: "closed", onePerKey: true, priceMsat: 210_000 },
    permanent: ["catalogUri", "collectionId", "censusPath"],
  },
};
const PERMANENT = {
  catalogUri: "it is hashed into every Edition G card for good, and G never uses NUTFT_CATALOG_URI",
  collectionId: "it is hashed into every Edition G card for good",
  censusPath: "the census it names is signed into the Edition G catalog for good",
};
const SUFFIX = {
  catalogUri: "CATALOG_URI", collectionId: "COLLECTION_ID", censusPath: "CENSUS_PATH",
  catalogMirrors: "CATALOG_MIRRORS", publicBase: "PUBLIC_BASE", backend: "FUNDING",
  sales: "SALES", allowlist: "ALLOWLIST", onePerKey: "ONE_PER_KEY",
  priceMsat: "PRICE_MSAT", priceSchedule: "PRICE_SCHEDULE", purchaseMode: "PURCHASE_MODE",
  allowVirtual: "ALLOW_VIRTUAL", invoiceTtlSeconds: "INVOICE_TTL_SECONDS",
  claimGraceSeconds: "CLAIM_GRACE_SECONDS", beacon: "BEACON", beaconSource: "BEACON_SOURCE",
  beaconConfirmations: "BEACON_CONFIRMATIONS",
};
/* Edition G has no beacon, so it reads none of these from its environment. */
const G_FIXED = new Set(["beacon", "beaconSource", "beaconConfirmations"]);

function problemList() {
  const problems = [];
  const push = (line) => { if (!problems.includes(line)) problems.push(line); };
  return {
    problems,
    add: (variable, reason) => push(`${variable}: ${reason}`),
    absorb: (lines) => lines.forEach(push),
  };
}

/* Runs `decide(add)` and throws what it reported as one error. */
function orThrow(decide) {
  const { problems, add } = problemList();
  const value = decide(add);
  if (problems.length) throw new Error(problems.join("; "));
  return value;
}

/* Unset, or empty: systemd hands a process `NAME=` as an empty string. */
const blank = (raw) => raw === undefined || raw === null || String(raw).trim() === "";
const entries = (raw) => (Array.isArray(raw) ? raw : String(raw).split(",")).map((entry) => String(entry).trim());
const wholeNumber = (raw) => (typeof raw === "number" ? raw : /^\s*\d+\s*$/.test(String(raw)) ? Number(raw) : NaN);

/* On or off. Anything else is refused rather than read as off, which is how an
   empty or mistyped protection used to switch itself off. */
function flag(add, variable, raw, fallback) {
  if (blank(raw)) return fallback;
  if (typeof raw === "boolean") return raw;
  const word = String(raw).toLowerCase();
  if (["1", "true", "yes", "on"].includes(word)) return true;
  if (["0", "false", "no", "off"].includes(word)) return false;
  add(variable, "must be on or off: 1, true, yes, on, 0, false, no or off");
  return fallback;
}

function whole(add, variable, raw, min, fallback, unit) {
  if (blank(raw)) return fallback;
  const value = wholeNumber(raw);
  if (Number.isSafeInteger(value) && value >= min) return value;
  add(variable, `must be a whole number of ${unit}, at least ${min}`);
  return fallback;
}

/* Taken exactly as written: a catalog URI is hashed into cards, so nothing here
   trims or rewrites it. */
function httpUrl(raw) {
  if (typeof raw !== "string" || raw !== raw.trim()) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url : null;
}

/* A public origin is published in links and certificates, so it may not carry
   credentials, and the mint appends paths to it. */
const publicOrigin = (raw) => {
  const url = httpUrl(raw);
  return Boolean(url && !url.username && !url.password && !url.search && !url.hash);
};

function supplyRelays(add, raw) {
  if (blank(raw)) return [];
  const list = entries(raw);
  list.forEach((relay, index) => {
    /* By position: a relay URL can carry an access token in its query. */
    if (relay && !/^wss?:\/\/\S+$/.test(relay)) add("NUTFT_SUPPLY_RELAYS", `entry ${index + 1} is not a ws:// or wss:// URL`);
  });
  return list.filter(Boolean);
}

function supplyInterval(add, raw) {
  if (blank(raw)) return SUPPLY_INTERVAL.fallback;
  const seconds = wholeNumber(raw);
  if (Number.isSafeInteger(seconds) && (seconds === 0 || seconds >= SUPPLY_INTERVAL.min)) return seconds;
  add("NUTFT_SUPPLY_INTERVAL_SECONDS", `must be 0 (no timer) or a whole number of seconds, at least ${SUPPLY_INTERVAL.min}`);
  return SUPPLY_INTERVAL.fallback;
}

/* What lnd.readConfig reads: a caller's explicit values, then the environment. */
function lndSettings(options = {}, env = process.env) {
  return {
    url: options.url || env.LND_REST_URL || "",
    macaroon: options.macaroon || env.LND_MACAROON || "",
    macaroonPath: options.macaroonPath || env.LND_MACAROON_PATH || "",
    certPath: options.certPath || env.LND_TLS_CERT_PATH || "",
    insecure: String(options.insecure ?? env.LND_INSECURE ?? "") === "1",
  };
}

function lndProblems(settings, selectedBy) {
  const { problems, add } = problemList();
  if (blank(settings.url)) {
    add("LND_REST_URL", `required when ${selectedBy}`);
    return problems;
  }
  const url = httpUrl(String(settings.url).trim());
  if (!url) add("LND_REST_URL", "must be an absolute http:// or https:// URL");
  if (blank(settings.macaroon) && blank(settings.macaroonPath)) {
    add("LND_MACAROON_PATH", "required with LND_REST_URL (or LND_MACAROON): an invoice-only macaroon");
  } else if (!blank(settings.macaroon) && !/^[0-9a-f]+$/i.test(String(settings.macaroon))) {
    add("LND_MACAROON", "must be hex");
  }
  if (url && url.protocol === "https:" && blank(settings.certPath) && !settings.insecure) {
    add("LND_TLS_CERT_PATH", "required for an https LND_REST_URL: LND's tls.cert, or LND_INSECURE=1 for a throwaway local node");
  }
  return problems;
}

/* What phoenixd.readConfig reads: a caller's explicit values, then the environment. */
function phoenixdSettings(options = {}, env = process.env) {
  const allowRemote = options.allowRemote ?? env.PHOENIXD_ALLOW_REMOTE ?? "";
  return {
    url: options.url || env.PHOENIXD_URL || "",
    password: options.password || env.PHOENIXD_PASSWORD || "",
    passwordPath: options.passwordPath || env.PHOENIXD_PASSWORD_PATH || "",
    allowRemote: allowRemote === true || allowRemote === "1" || allowRemote === "true",
  };
}

function phoenixdProblems(settings, selectedBy) {
  const { problems, add } = problemList();
  if (blank(settings.url)) {
    add("PHOENIXD_URL", `required when ${selectedBy}`);
    return problems;
  }
  const url = httpUrl(String(settings.url).trim());
  if (!url) add("PHOENIXD_URL", "must be an absolute http:// or https:// URL, for example http://127.0.0.1:9740");
  if (blank(settings.password) && blank(settings.passwordPath)) {
    add("PHOENIXD_PASSWORD_PATH", "required with PHOENIXD_URL (or PHOENIXD_PASSWORD), which has no password otherwise: "
      + "the http-password-limited-access value from phoenix.conf");
  }
  if (url && url.protocol === "http:" && !LOOPBACK.test(url.hostname) && !settings.allowRemote) {
    add("PHOENIXD_URL", "names a host that is not loopback, so plain http would send the password in clear over the network; "
      + "use TLS or a tunnel, or set PHOENIXD_ALLOW_REMOTE=1 if the hop is genuinely private");
  }
  return problems;
}

function cashuProblems(mintUrl, selectedBy) {
  const { problems, add } = problemList();
  if (blank(mintUrl)) add("NUTFT_CASHU_MINT", `required when ${selectedBy}`);
  else if (!/^https:\/\//i.test(String(mintUrl))) add("NUTFT_CASHU_MINT", "must be https (an https:// mint URL)");
  return problems;
}

/**
 * One mint's settings: a caller's explicit `options` first, then `env` under the
 * edition's own variable names. Returns { settings, problems, warnings }.
 */
function resolveMint(options = {}, env = process.env, editionName = "E1") {
  const isG = editionName === "G";
  const edition = isG ? EDITIONS.G : EDITIONS.E1;
  const { problems, add, absorb } = problemList();
  const warnings = [];
  const name = (key) => `${edition.prefix}NUTFT_${SUFFIX[key]}`;
  const read = (key) => {
    if (options[key] !== undefined && options[key] !== null) return options[key];
    return isG && G_FIXED.has(key) ? undefined : env[name(key)];
  };
  const settings = { edition: isG ? "G" : "E1" };

  /* Identity: taken as written, and never defaulted for G. */
  for (const key of ["catalogUri", "collectionId", "censusPath"]) {
    const raw = read(key);
    if (!blank(raw)) settings[key] = String(raw);
    else if (edition.permanent.includes(key)) add(name(key), `required when G_NUTFT_ENABLED is on: ${PERMANENT[key]}`);
    else settings[key] = edition.defaults[key];
  }
  if (settings.catalogUri !== undefined && !httpUrl(settings.catalogUri)) {
    add(name("catalogUri"), "must be an absolute http:// or https:// URL");
  }
  if (settings.collectionId !== undefined && !COLLECTION_ID.test(settings.collectionId)) {
    add(name("collectionId"), "must be 1 to 64 letters, digits, dots, dashes or underscores, starting with a letter or digit");
  }

  settings.catalogMirrors = [];
  const mirrors = read("catalogMirrors");
  if (!blank(mirrors)) {
    entries(mirrors).forEach((entry, index) => {
      if (!entry) return;
      if (httpUrl(entry)) settings.catalogMirrors.push(entry.replace(/\/+$/, ""));
      else add(name("catalogMirrors"), `entry ${index + 1} is not an absolute http:// or https:// URL`);
    });
  }

  /* The site's origin. Both mints live on one referee, so G may use the E1
     value or PUBLIC_URL's: it names the site, not an edition. */
  settings.publicBase = "";
  const base = [[name("publicBase"), options.publicBase], [name("publicBase"), env[name("publicBase")]]]
    .concat(isG ? [["NUTFT_PUBLIC_BASE", env.NUTFT_PUBLIC_BASE]] : [])
    .find(([, value]) => !blank(value));
  if (base) {
    if (publicOrigin(base[1])) settings.publicBase = String(base[1]).replace(/\/$/, "");
    else add(base[0], "must be an absolute http:// or https:// URL, with no user, password, query or fragment");
  } else if (!blank(env.PUBLIC_URL)) {
    const derived = String(env.PUBLIC_URL).replace(/^ws/, "http").replace(/\/ws$/, "").replace(/\/$/, "");
    if (/^wss?:\/\//.test(env.PUBLIC_URL) && publicOrigin(derived)) settings.publicBase = derived;
    else add("PUBLIC_URL", "must be a ws:// or wss:// URL: the mints derive their public base from it");
  }

  /* Funding. An injected source is explicit by construction. From the
     environment nothing is guessed: PHOENIXD_URL and LND_REST_URL are set for G
     or the beacon as often as for E1, and used to make E1 a paid mint. */
  const fundingVariable = name("backend");
  let backend = "none";
  if (options.funding) backend = String(options.funding.name || "injected");
  else if (options.lnd) backend = "lnd";
  else if (options.lnd !== null) {
    const raw = read("backend");
    if (blank(raw)) {
      if (isG) add(fundingVariable, "required when G_NUTFT_ENABLED is on: lnd, phoenixd, cashu, mock or none");
      else if (!blank(env.PHOENIXD_URL) || !blank(env.LND_REST_URL)) {
        add(fundingVariable, "unset while PHOENIXD_URL or LND_REST_URL is set: E1 no longer takes its funding from them, "
          + "so set lnd, phoenixd, cashu, mock or none");
      }
    } else if (!BACKENDS.includes(String(raw).toLowerCase())) {
      add(fundingVariable, "must be lnd, phoenixd, cashu, mock or none");
    } else {
      backend = String(raw).toLowerCase();
      const selectedBy = `${fundingVariable}=${backend}`;
      if (backend === "lnd") absorb(lndProblems(lndSettings(options.lndOptions, env), selectedBy));
      if (backend === "phoenixd") absorb(phoenixdProblems(phoenixdSettings(options.phoenixd, env), selectedBy));
      if (backend === "cashu") absorb(cashuProblems(options.mintUrl || env.NUTFT_CASHU_MINT, selectedBy));
      if (backend === "mock") whole(add, "NUTFT_MOCK_SETTLE_MS", options.settleAfterMs ?? env.NUTFT_MOCK_SETTLE_MS, 0, 0, "milliseconds");
    }
  }
  settings.backend = backend;
  settings.fundingVariable = fundingVariable;
  const paid = backend !== "none";
  const wholeSats = backend === "phoenixd" || backend === "cashu";
  const virtual = options.funding ? Boolean(options.funding.virtual) : backend === "mock";

  /* Who may buy. A paid mint never opens by default: its sales mode is named. */
  const salesVariable = name("sales");
  const sales = read("sales");
  if (blank(sales)) {
    settings.sales = edition.defaults.sales;
    if (paid) add(salesVariable, "required for a paid mint: closed, allowlist, signed or open (early access is allowlist)");
  } else if (SALES.includes(String(sales).toLowerCase())) {
    settings.sales = String(sales).toLowerCase();
  } else {
    settings.sales = "closed";
    add(salesVariable, "must be closed, allowlist, signed or open");
  }

  settings.allowlist = new Set();
  const listVariable = name("allowlist");
  const list = read("allowlist");
  if (!blank(list)) {
    entries(list).forEach((entry, index) => {
      if (!entry) return;
      const key = toPubkeyHex(entry);
      if (key) settings.allowlist.add(key);
      /* By position only: the likeliest paste mistake is a private key. */
      else if (/^nsec1/i.test(entry)) add(listVariable, `an nsec (private key) was pasted into ${listVariable} at entry ${index + 1}; remove it`);
      else add(listVariable, `entry ${index + 1} is not an npub or a 64-character hex public key`);
    });
  }
  if (settings.sales === "allowlist" && !settings.allowlist.size) {
    add(listVariable, `holds no key, so ${salesVariable}=allowlist would sell to nobody; list the early-access keys or use closed`);
  }

  const oneVariable = name("onePerKey");
  settings.onePerKey = flag(add, oneVariable, read("onePerKey"), edition.defaults.onePerKey);
  if (settings.onePerKey && settings.sales !== "allowlist" && settings.sales !== "signed") {
    add(oneVariable, `needs ${salesVariable}=allowlist or signed: without a signed request there is no key to count`);
  }
  /* A known gap, said out loud rather than advertised as a rule: the buyer is
     recorded only with a paid issuance, so a free claim is never counted. */
  if (settings.onePerKey && !paid) {
    warnings.push(`${oneVariable}: this mint is free, and a free claim records no buyer, so one per key is not enforced`);
  }

  const satsOnly = "must be a whole number of sats (divisible by 1000): phoenixd and Cashu invoice whole sats";
  const priceVariable = name("priceMsat");
  const priceMsat = whole(add, priceVariable, read("priceMsat"), 1, edition.defaults.priceMsat, "millisatoshis");
  if (wholeSats && priceMsat % 1000 !== 0) add(priceVariable, satsOnly);
  settings.priceTiers = [{ upTo: Infinity, msat: priceMsat }];
  const scheduleVariable = name("priceSchedule");
  const schedule = read("priceSchedule");
  if (!blank(schedule)) {
    settings.priceTiers = [];
    entries(schedule).forEach((entry, index) => {
      const match = /^(\d+)\s*:\s*(\d+)$/.exec(entry);
      const tier = match && { upTo: Number(match[1]), msat: Number(match[2]) };
      if (!tier || tier.upTo < 1 || tier.msat < 1) {
        add(scheduleVariable, `entry ${index + 1} is not "packs:msat" with two whole numbers above 0`);
        return;
      }
      const last = settings.priceTiers[settings.priceTiers.length - 1];
      if (last && tier.upTo <= last.upTo) {
        add(scheduleVariable, `thresholds must increase: entry ${index + 1} starts at or below the one before it`);
      }
      if (wholeSats && tier.msat % 1000 !== 0) add(scheduleVariable, `entry ${index + 1} ${satsOnly}`);
      settings.priceTiers.push(tier);
    });
  }

  settings.purchaseMode = flag(add, name("purchaseMode"), read("purchaseMode"), false);
  if (virtual && String(read("allowVirtual") ?? "") !== "1") {
    add(name("allowVirtual"), `${fundingVariable}=mock issues virtual sats that settle themselves; `
      + `set ${name("allowVirtual")}=1 to confirm a staging deployment`);
  }

  /* G sets its own windows. Where E1 sets one and G does not, G used to take
     E1's; a refusal makes that visible instead of silently changing how long a
     paid, unclaimed G set stays reserved for its buyer. */
  const windowSeconds = (key, fallback) => {
    const raw = read(key);
    const e1Variable = `NUTFT_${SUFFIX[key]}`;
    if (isG && blank(raw) && !blank(env[e1Variable])) {
      add(name(key), `unset while ${e1Variable} is set: Edition G does not inherit it, so set G's own value`);
    }
    return whole(add, name(key), raw, 60, fallback, "seconds");
  };
  settings.invoiceTtlSeconds = windowSeconds("invoiceTtlSeconds", 900);
  settings.claimGraceSeconds = windowSeconds("claimGraceSeconds", 3600);
  if (settings.claimGraceSeconds < settings.invoiceTtlSeconds) {
    add(name("claimGraceSeconds"), `must be at least ${name("invoiceTtlSeconds")}: a paid pack cannot be held for less time than an unpaid one`);
  }

  const beacon = read("beacon");
  settings.beacon = blank(beacon) ? "00".repeat(32) : String(beacon).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(settings.beacon)) add(name("beacon"), "must be 64 hex characters (32 bytes)");
  const source = read("beaconSource");
  settings.beaconLive = source === "lnd";
  if (!blank(source) && !settings.beaconLive) add(name("beaconSource"), "must be lnd, or unset for the fixed beacon");
  settings.beaconConfirmations = whole(add, name("beaconConfirmations"), read("beaconConfirmations"), 1, 1, "blocks");
  if (settings.beaconLive && !options.chainLnd && !options.beaconGetInfo && !options.lnd) {
    absorb(lndProblems(lndSettings(options.lndOptions, env), `${name("beaconSource")}=lnd`));
  }

  /* Node turns a NaN interval into one millisecond: the sweep would never rest. */
  settings.reconcileMs = 120_000;
  const reconcile = options.reconcileMs ?? env.NUTFT_RECONCILE_MS;
  if (!blank(reconcile)) {
    if (Number.isFinite(Number(reconcile))) settings.reconcileMs = Number(reconcile);
    else add("NUTFT_RECONCILE_MS", "must be a number of milliseconds");
  }

  return { settings, problems, warnings };
}

/**
 * Every problem the referee would refuse to boot with, from `env` alone. No
 * file, database, port or network is touched.
 */
function checkEnv(env) {
  const { problems, add, absorb } = problemList();
  absorb(resolveMint({}, env, "E1").problems);
  if (flag(add, "G_NUTFT_ENABLED", env.G_NUTFT_ENABLED, false)) {
    if (blank(env.G_NUTFT_DB)) {
      add("G_NUTFT_DB", "required when G_NUTFT_ENABLED is on: the file holds the Edition G signing keys");
    } else if (!blank(env.DB) && env.DB !== ":memory:" && path.resolve(env.G_NUTFT_DB) === path.resolve(env.DB)) {
      add("G_NUTFT_DB", "names the same file as DB: Edition G needs a database of its own");
    }
    absorb(resolveMint({}, env, "G").problems);
  }
  supplyRelays(add, env.NUTFT_SUPPLY_RELAYS);
  supplyInterval(add, env.NUTFT_SUPPLY_INTERVAL_SECONDS);
  return problems;
}

module.exports = {
  checkEnv, resolveMint, orThrow, flag, whole, supplyRelays, supplyInterval,
  lndSettings, lndProblems, phoenixdSettings, phoenixdProblems, cashuProblems,
};
