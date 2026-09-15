/* Who counts as one client. An address has one spelling, whether it arrives as
   the socket peer or as a trusted proxy's forwarded hop, and an IPv6 client is
   budgeted by its /64, so rotating through its own addresses or respelling one
   buys no fresh budget. (Ported from the PR #73 review, scenario f4.) */

import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTable, canonicalAddress, budgetOf } = require("../../server/table.js");
const CATALOG_URI = "http://127.0.0.1/nutft/catalog";

async function boot(t, extra = {}) {
  const table = await createTable({
    port: 0, host: "127.0.0.1", dbPath: ":memory:", nutftCatalogUri: CATALOG_URI, rateClock: () => 1, ...extra,
  });
  t.after(() => table.close());
  return table;
}

/* One spending POST the mint turns down at once (400), so 429 means the budget. */
const write = (port, headers = {}) => new Promise((resolve, reject) => {
  const req = request({
    hostname: "127.0.0.1", port, method: "POST", path: "/nutft/trade",
    headers: { "content-type": "application/json", "content-length": 2, ...headers },
  }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
  req.on("error", reject);
  req.end("{}");
});
const writes = async (port, n, headersFor) => {
  const statuses = [];
  for (let i = 0; i < n; i++) statuses.push(await write(port, headersFor(i)));
  return statuses;
};
const count = (statuses, status) => statuses.filter((value) => value === status).length;
const forwardedFor = (address) => ({ "x-forwarded-for": address });

test("addresses have one spelling, and IPv6 is budgeted per /64 as nappelin writes it", () => {
  assert.equal(canonicalAddress("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(canonicalAddress("::FFFF:AC11:1"), "172.17.0.1");
  assert.equal(canonicalAddress("2001:DB8:1:2::1"), "2001:db8:1:2::1");
  assert.equal(canonicalAddress("2001:db8:1:2:0:0:0:1"), "2001:db8:1:2::1");
  assert.equal(canonicalAddress("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(canonicalAddress("fe80::1%eth0"), "fe80::1");
  assert.equal(canonicalAddress(" 198.51.100.7 "), "198.51.100.7");
  assert.equal(budgetOf("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(budgetOf("2001:db8:1:2::9"), "2001:db8:1:2::/64");
  assert.equal(budgetOf("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(budgetOf("203.0.113.1"), "203.0.113.1");
});

test("f4: a trusted proxy's IPv6 clients share one budget per /64, however they spell it", async (t) => {
  const table = await boot(t, { trustProxy: "loopback" });

  const same = await writes(table.port, 25, () => forwardedFor("2001:db8:1:2::1"));
  assert.deepEqual([count(same, 400), count(same, 429)], [20, 5]);
  const rotating = await writes(table.port, 100, (i) => forwardedFor(`2001:db8:1:2::${(i + 2).toString(16)}`));
  assert.equal(count(rotating, 429), 100, "every other address in that /64 draws on the spent budget");
  const respelled = await writes(table.port, 20, (i) => forwardedFor(i % 2 ? "2001:db8:1:2:0:0:0:1" : "2001:DB8:1:2::1"));
  assert.equal(count(respelled, 429), 20, "so does every spelling of the first one");
  const neighbour = await writes(table.port, 5, () => forwardedFor("2001:db8:1:3::1"));
  assert.equal(count(neighbour, 400), 5, "the next /64 is somebody else");

  const ipv4 = await writes(table.port, 21, (i) => forwardedFor(i % 2 ? "::ffff:198.51.100.7" : "198.51.100.7"));
  assert.deepEqual([count(ipv4, 400), count(ipv4, 429)], [20, 1], "an IPv4-mapped spelling is the IPv4 client");
});

test("a forwarded hop that is not an address falls back to the proxy's own budget", async (t) => {
  const table = await boot(t, { trustProxy: "loopback" });
  const garbage = await writes(table.port, 21, (i) => forwardedFor(`not-an-address-${i}`));
  assert.deepEqual([count(garbage, 400), count(garbage, 429)], [20, 1], "no fresh budget per invented string");
  const health = await (await fetch(`${table.url}/api/health`, { headers: forwardedFor("whoever") })).json();
  assert.equal(health.client, "127.0.0.1");
});

test("the socket peer is spelled the same way: a dual-stack listener's mapped peer is logged as IPv4",
  async (t) => {
    const lines = [];
    t.mock.method(console, "warn", (...args) => { lines.push(args.join(" ")); });
    let table;
    try {
      table = await boot(t, { host: "::" });
    } catch (error) {
      if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL") return t.skip("no IPv6 on this host");
      throw error;
    }
    const statuses = await writes(table.port, 21, () => ({}));
    assert.equal(count(statuses, 429), 1);
    assert.deepEqual(lines.filter((line) => line.includes("rate limited")),
      ["[table] rate limited: mint-write for 127.0.0.1 (20 per 60s)"]);
  });
