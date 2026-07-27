import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const DEFAULT_TRIALS = 1_000_000;
const DEFAULT_SEED = 0x5221c0de;
const LAQI_OPTIONS = {
  logAgeNodeCount: 192,
  logAgePanelCount: 32,
  tailTolerance: 1e-12,
};
const LAQI_WARMUPS = 3;
const LAQI_SAMPLES = 21;
const fixtureUrl = new URL(
  "../examples/wsop-2025-main-event-snapshot-522.json",
  import.meta.url,
);
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rotateLeft(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function splitmix32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
}

function xoshiro128StarStar(seed) {
  const seedWord = splitmix32(seed);
  let state0 = seedWord();
  let state1 = seedWord();
  let state2 = seedWord();
  let state3 = seedWord();

  return function random() {
    const result = Math.imul(rotateLeft(Math.imul(state1, 5), 7), 9) >>> 0;
    const temporary = (state1 << 9) >>> 0;
    state2 ^= state0;
    state3 ^= state1;
    state1 ^= state2;
    state0 ^= state3;
    state2 ^= temporary;
    state3 = rotateLeft(state3, 11);
    return (result + 0.5) / 4_294_967_296;
  };
}

function benchmark(operation, { warmups, samples }) {
  for (let index = 0; index < warmups; index += 1) operation();

  const timesMs = [];
  let result;
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    result = operation();
    timesMs.push(performance.now() - startedAt);
  }

  return {
    result,
    warmups,
    samples,
    timesMs,
    medianMs: median(timesMs),
    meanMs: sum(timesMs) / timesMs.length,
    minMs: Math.min(...timesMs),
    maxMs: Math.max(...timesMs),
  };
}

function runSerialFullFieldMonteCarlo(chipCounts, payouts, trials, seed) {
  const playerCount = chipCounts.length;
  const paidRankCount = Math.min(playerCount, payouts.length);
  const random = xoshiro128StarStar(seed);
  const finishTimes = new Float64Array(playerCount);
  const playerOrder = Array.from({ length: playerCount }, (_, index) => index);
  const sums = new Float64Array(playerCount);
  const squareSums = new Float64Array(playerCount);

  const startedAt = performance.now();
  for (let trial = 0; trial < trials; trial += 1) {
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      finishTimes[playerIndex] = -Math.log(random()) / chipCounts[playerIndex];
    }

    playerOrder.sort((left, right) => {
      const difference = finishTimes[left] - finishTimes[right];
      return difference || left - right;
    });

    for (let rankIndex = 0; rankIndex < paidRankCount; rankIndex += 1) {
      const payout = payouts[rankIndex];
      const playerIndex = playerOrder[rankIndex];
      sums[playerIndex] += payout;
      squareSums[playerIndex] += payout * payout;
    }
  }
  const runtimeMs = performance.now() - startedAt;

  const players = chipCounts.map((chips, playerIndex) => {
    const mean = sums[playerIndex] / trials;
    const variance = Math.max(
      0,
      (squareSums[playerIndex] - ((sums[playerIndex] ** 2) / trials)) /
        Math.max(1, trials - 1),
    );
    const standardError = Math.sqrt(variance / trials);
    const margin95 = 1.96 * standardError;
    return {
      playerIndex: playerIndex + 1,
      chips,
      mean,
      standardError,
      margin95,
      ci95Low: mean - margin95,
      ci95High: mean + margin95,
    };
  });

  return { runtimeMs, players };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const trials = Number(process.env.LAQI_FULL_FIELD_MC_TRIALS || DEFAULT_TRIALS);
const seed = Number(process.env.LAQI_FULL_FIELD_MC_SEED || DEFAULT_SEED) >>> 0;
if (!Number.isSafeInteger(trials) || trials <= 0) {
  throw new Error("LAQI_FULL_FIELD_MC_TRIALS must be a positive safe integer.");
}
const trialLabel = trials === DEFAULT_TRIALS ? "1m" : String(trials);
const jsonResultUrl = new URL(
  `./results/serial_full_field_monte_carlo_522_${trialLabel}.json`,
  import.meta.url,
);
const markdownResultUrl = new URL(
  `./results/serial_full_field_monte_carlo_522_${trialLabel}.md`,
  import.meta.url,
);

const fixtureText = await readFile(fixtureUrl, "utf8");
const fixture = JSON.parse(fixtureText);
const chipCounts = fixture.chipCounts.map(Number);
const payouts = fixture.payouts
  .map(Number)
  .filter((payout) => Number.isFinite(payout) && payout > 0)
  .sort((left, right) => right - left)
  .slice(0, chipCounts.length);
const totalPrizePool = sum(payouts);

console.log("Benchmarking full-field LAQI...");
const laqiBenchmark = benchmark(
  () => solveLogAgeQuadratureIcm(chipCounts, payouts, LAQI_OPTIONS),
  { warmups: LAQI_WARMUPS, samples: LAQI_SAMPLES },
);

console.log(
  `Running ${trials.toLocaleString("en-US")} serial full-field Monte Carlo trials...`,
);
const monteCarlo = runSerialFullFieldMonteCarlo(chipCounts, payouts, trials, seed);
const meanValueSum = sum(monteCarlo.players.map((player) => player.mean));
const representativeIndexes = [0, 260, 521];
const representativePlayers = representativeIndexes.map((index) => ({
  ...monteCarlo.players[index],
  laqi192Value: laqiBenchmark.result.players[index].value,
}));

const output = {
  generatedAt: new Date().toISOString(),
  benchmark: "522-player serial full-field Monte Carlo versus full-field LAQI",
  scenario: {
    fixtureId: fixture.id,
    players: chipCounts.length,
    activePayoutRows: payouts.length,
    totalPrizePool,
    fixtureSha256: sha256(fixtureText),
  },
  monteCarlo: {
    method: "serial exponential-race Monte Carlo with full finish-order sorting",
    output: "all 522 players",
    trials,
    prng: "xoshiro128** with SplitMix32 seeding",
    seed,
    runtimeMs: monteCarlo.runtimeMs,
    trialsPerSecond: trials / (monteCarlo.runtimeMs / 1_000),
    meanValueSum,
    prizePoolDifference: meanValueSum - totalPrizePool,
    players: monteCarlo.players,
  },
  laqi: {
    method: "Log-Age Quadrature ICM full-field solver",
    output: "all 522 players",
    options: LAQI_OPTIONS,
    timing: {
      warmups: laqiBenchmark.warmups,
      samples: laqiBenchmark.samples,
      medianMs: laqiBenchmark.medianMs,
      meanMs: laqiBenchmark.meanMs,
      minMs: laqiBenchmark.minMs,
      maxMs: laqiBenchmark.maxMs,
      timesMs: laqiBenchmark.timesMs,
    },
    totalPrizePool: laqiBenchmark.result.totalPrizePool,
    normalizedValueSum: sum(
      laqiBenchmark.result.players.map((player) => player.value),
    ),
  },
  comparison: {
    monteCarloTimeDividedByLaqiMedian:
      monteCarlo.runtimeMs / laqiBenchmark.medianMs,
    representativePlayers,
  },
  machine: {
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model || "unknown",
    logicalCpuCount: cpus().length,
    memoryBytes: totalmem(),
    nodeVersion: process.version,
    execution: "single Node.js process; no worker threads or GPU",
  },
};

const markdown = [
  "# 522-Player Serial Full-Field Monte Carlo Benchmark",
  "",
  `Generated: ${output.generatedAt}`,
  "",
  `Fixture: \`${output.scenario.fixtureId}\``,
  "",
  "| Method | Output | Trials | Time | Time / LAQI |",
  "| --- | --- | ---: | ---: | ---: |",
  `| LAQI (192 nodes, 32 panels) | All 522 players | n/a | ${output.laqi.timing.medianMs.toFixed(3)} ms | 1.0x |`,
  `| Serial Monte Carlo | All 522 players | ${trials.toLocaleString("en-US")} | ${(output.monteCarlo.runtimeMs / 1_000).toFixed(3)} s | ${output.comparison.monteCarloTimeDividedByLaqiMedian.toFixed(1)}x |`,
  "",
  "The LAQI time is the median of 21 measurements after three warm-up runs. The Monte Carlo time is one complete serial run. Both methods returned values for every player. No worker threads, child processes, or GPU acceleration were used.",
  "",
  "| Player | Chips | LAQI 192 | MC mean | MC 95% interval |",
  "| ---: | ---: | ---: | ---: | ---: |",
  ...representativePlayers.map((player) =>
    `| ${player.playerIndex} | ${player.chips.toLocaleString("en-US")} | ${formatMoney(player.laqi192Value)} | ${formatMoney(player.mean)} | ${formatMoney(player.ci95Low)} to ${formatMoney(player.ci95High)} |`,
  ),
  "",
  `Machine: ${output.machine.cpu}, Node.js ${output.machine.nodeVersion}, ${output.machine.execution}.`,
];

await writeFile(jsonResultUrl, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(markdownResultUrl, `${markdown.join("\n")}\n`);

console.log(JSON.stringify({
  result: jsonResultUrl.pathname,
  monteCarloRuntimeMs: output.monteCarlo.runtimeMs,
  laqiMedianMs: output.laqi.timing.medianMs,
  speedRatio: output.comparison.monteCarloTimeDividedByLaqiMedian,
}, null, 2));
