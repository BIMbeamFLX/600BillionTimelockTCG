#!/usr/bin/env node
/* Headless bot-vs-bot simulator for both rules profiles.
 *
 *   node scripts/sim.mjs [--games N] [--profile classic|fast|both] [--seed S] [--json out.json]
 *
 * Every pairing of the five affinities plays N games per profile, alternating
 * the first player. Each game is the same loop npc.test.mjs and play.js run:
 * the policy ranks candidates, the engine keeps the first it accepts. The
 * report says what "faster" and "balanced" mean in numbers: turns per game,
 * actions per turn, win rate per affinity, and games that stalled or never
 * reached a verdict. Deterministic: the same arguments print the same report.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "site");
const require = createRequire(import.meta.url);

export const AFFINITIES = ["Power", "Bitcoin", "Keys", "Signal", "Timelock"];
const RULESETS = { classic: "E1.0", fast: "F1.0" };

/* Classic cards for Classic games; the Fast values (site/play-data-fast.js)
 * for Fast games, unless `fastCards: false` asks for Fast rules on Classic cards. */
export function loadEngine({ fastCards = true } = {}) {
  const CARDS = require(path.join(siteDir, "play-data.js"));
  const E = require(path.join(siteDir, "engine.js"));
  const NPC = require(path.join(siteDir, "npc.js"));
  E.setCatalog(CARDS);
  const lookup = (cards) => {
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
    const cache = {};
    return (id) => (cache[id] = cache[id] || E.compileCard(byId[id]));
  };
  const compiledFor = { classic: lookup(CARDS), fast: lookup(CARDS) };
  if (fastCards) {
    const FAST = require(path.join(siteDir, "play-data-fast.js"));
    E.setCatalog(FAST, "F1.0");
    compiledFor.fast = lookup(FAST);
  }
  return { E, NPC, compiled: compiledFor.classic, compiledFor };
}

/* One game. Returns its verdict and counters, never throws for a game that
 * goes wrong: a stall or a turn limit is a result the report has to show. */
export function playGame(env, { profile, affinities, seed, firstPlayer = 0, maxActions = 4000, maxTurns = 60 }) {
  const { E, NPC } = env;
  const compiled = env.compiledFor ? env.compiledFor[profile] : env.compiled;
  let state = null;
  let s = seed >>> 0;
  for (let tries = 0; tries < 40 && !state; tries++) {
    try {
      state = E.createGame({
        ruleset: RULESETS[profile],
        seats: affinities.map((affinity, i) => ({ name: `Bot${i}`, affinity })),
        seeds: { public: s | 0, hidden: [(s ^ 0x5f3759df) | 0, (s + 7717) | 0] },
        firstPlayer,
      });
    } catch (error) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0; // a deal that failed its own checks: redeal
    }
  }
  if (!state) return { outcome: "no-deal", turns: 0, actions: 0 };
  const perSeat = [0, 0];
  let actions = 0;
  while (!state.result) {
    if (actions >= maxActions || state.turn.number > maxTurns) {
      return { outcome: "limit", turns: state.turn.number, actions, perSeat };
    }
    const seat = NPC.waitingSeat(state);
    let next = null;
    for (const move of NPC.candidates(E, state, seat, compiled, { affinity: affinities[seat] })) {
      const result = E.apply(state, { type: move.type, seat, seq: state.seq, at: "", payload: move.payload });
      if (!result.error) {
        next = result.state;
        break;
      }
    }
    if (!next) return { outcome: "stall", turns: state.turn.number, actions, perSeat, window: state.priority.window, awaiting: state.awaiting && state.awaiting.kind };
    state = next;
    actions += 1;
    perSeat[seat] += 1;
  }
  const winners = state.result.winners || [];
  return {
    outcome: winners.length === 1 ? "win" : "draw",
    winner: winners.length === 1 ? winners[0] : null,
    reason: state.result.reason,
    turns: state.turn.number,
    actions,
    perSeat,
    uptime: state.seats.map((seat) => seat.uptime),
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

export function simulate(env, { profile, games, seed }) {
  const rows = [];
  let n = 0;
  for (let a = 0; a < AFFINITIES.length; a++) {
    for (let b = a + 1; b < AFFINITIES.length; b++) {
      for (let g = 0; g < games; g++) {
        const affinities = [AFFINITIES[a], AFFINITIES[b]];
        const result = playGame(env, { profile, affinities, seed: seed + n * 7919, firstPlayer: g % 2 });
        rows.push(Object.assign({ affinities, firstPlayer: g % 2 }, result));
        n += 1;
      }
    }
  }
  const finished = rows.filter((row) => row.outcome === "win" || row.outcome === "draw");
  const affinity = {};
  for (const name of AFFINITIES) {
    const mine = rows.filter((row) => row.outcome === "win" && row.affinities.includes(name));
    const won = mine.filter((row) => row.affinities[row.winner] === name).length;
    affinity[name] = { games: mine.length, winRate: mine.length ? won / mine.length : 0 };
  }
  const decided = rows.filter((row) => row.outcome === "win");
  return {
    profile,
    games: rows.length,
    outcomes: rows.reduce((acc, row) => ((acc[row.outcome] = (acc[row.outcome] || 0) + 1), acc), {}),
    reasons: finished.reduce((acc, row) => ((acc[row.reason] = (acc[row.reason] || 0) + 1), acc), {}),
    turns: { mean: mean(finished.map((row) => row.turns)), p10: quantile(finished.map((row) => row.turns), 0.1), median: quantile(finished.map((row) => row.turns), 0.5), p90: quantile(finished.map((row) => row.turns), 0.9) },
    actionsPerTurn: mean(finished.map((row) => row.actions / Math.max(1, row.turns))),
    firstPlayerWinRate: decided.length ? decided.filter((row) => row.winner === row.firstPlayer).length / decided.length : 0,
    affinity,
    stalls: rows.filter((row) => row.outcome === "stall").slice(0, 5),
  };
}

function format(report) {
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  const lines = [
    `== ${report.profile} — ${report.games} games`,
    `outcomes      ${JSON.stringify(report.outcomes)}`,
    `reasons       ${JSON.stringify(report.reasons)}`,
    `turns         mean ${report.turns.mean.toFixed(1)}  p10 ${report.turns.p10}  median ${report.turns.median}  p90 ${report.turns.p90}`,
    `actions/turn  ${report.actionsPerTurn.toFixed(2)}`,
    `first player  ${pct(report.firstPlayerWinRate)}`,
  ];
  for (const [name, row] of Object.entries(report.affinity)) lines.push(`  ${name.padEnd(9)} ${pct(row.winRate).padStart(6)} of ${row.games}`);
  for (const stall of report.stalls) lines.push(`  stall: ${stall.affinities.join("/")} turn ${stall.turns} ${stall.window} ${stall.awaiting || ""}`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { games: 10, profile: "both", seed: 20260912, json: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key in args) args[key] = key === "games" || key === "seed" ? Number(argv[++i]) : argv[++i];
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEngine();
  const profiles = args.profile === "both" ? ["classic", "fast"] : [args.profile];
  const reports = profiles.map((profile) => simulate(env, { profile, games: args.games, seed: args.seed }));
  for (const report of reports) console.log(format(report) + "\n");
  if (args.json) writeFileSync(args.json, JSON.stringify(reports, null, 2));
}
