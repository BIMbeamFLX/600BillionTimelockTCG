#!/usr/bin/env node
"use strict";

/* The mint boot check, without the boot.
 *
 *   node server/env-check.js                  this process's environment
 *   node server/env-check.js --from <file>    a NUL-separated environ file
 *   sudo cat /proc/$PID/environ | node server/env-check.js --from -
 *
 * It applies server/mint-env.js, the rules the referee applies before it opens
 * anything, and prints one line per problem, "VARIABLE: reason", then "ok" or
 * "N problems". Exit 0 when clean, 1 with problems, 2 when the environment
 * cannot be read. It never prints a value, writes nothing to disk, binds no
 * port, opens no database and contacts no funding backend.
 *
 * Node built-ins only, besides mint-env.js and the lnurl.js it needs: it runs
 * from a bare copy of those three files (docs/mint-boot-checks.md). */

const fs = require("node:fs");
const tty = require("node:tty");
const { checkEnv } = require("./mint-env.js");

const USAGE = "usage: node env-check.js [--from <environ file> | --from -]";

/* /proc/<pid>/environ holds NAME=value entries, each ended by a NUL byte. Only
   names and positions ever leave this function in a message. */
function parseEnviron(bytes) {
  if (!bytes.length) return { error: "the environment input is empty, and an empty environment is never ok" };
  if (!bytes.includes(0)) {
    return { error: "the input is not NUL-separated: pipe /proc/<pid>/environ, not an environment file" };
  }
  const env = Object.create(null);
  for (const entry of bytes.toString("utf8").split("\0")) {
    const at = entry.indexOf("=");
    /* The first definition wins, as getenv() reads it. */
    if (at > 0 && !(entry.slice(0, at) in env)) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  if (!Object.keys(env).length) return { error: "the input holds no NAME=value entries" };
  return { env };
}

/** Runs the check for `args`; returns the exit code. `io` replaces the process streams in tests. */
function run(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const fail = (message) => {
    stderr.write(`env-check: ${message}\n`);
    return 2;
  };
  let env = io.env || process.env;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--from") return fail(USAGE);
    const fromStdin = args[1] === "-";
    /* A forgotten pipe would otherwise wait for typing that never comes. */
    if (fromStdin && tty.isatty(0)) return fail("--from - reads the environment from a pipe, and stdin is a terminal");
    let bytes;
    try {
      bytes = fs.readFileSync(fromStdin ? 0 : args[1]);
    } catch (error) {
      return fail(`cannot read ${fromStdin ? "stdin" : args[1]} (${(error && error.code) || "read error"})`);
    }
    const parsed = parseEnviron(bytes);
    if (parsed.error) return fail(parsed.error);
    env = parsed.env;
  }
  const problems = checkEnv(env);
  for (const line of problems) stdout.write(`${line}\n`);
  stdout.write(problems.length ? `${problems.length} ${problems.length === 1 ? "problem" : "problems"}\n` : "ok\n");
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exitCode = run(process.argv.slice(2));

module.exports = { run, parseEnviron };
