import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { cpus, totalmem } from "node:os";
import {
  solveLogAgeQuadratureIcm,
  solveRawPlayerLogAgeQuadratureIcm,
} from "../src/log-age-quadrature-icm.js";
import {
  exactMalmuthHarvilleIcmHighPrecision,
  highPrecisionErrorSummary,
  scaledBigIntToDecimal,
  scaledBigIntToScientific,
} from "./lib/high-precision-exact-icm.mjs";

const DEFAULT_OPTIONS = {
  logAgeNodeCount: 192,
  logAgePanelCount: 32,
  tailTolerance: 1e-12,
};
const HIGH_PRECISION_OPTIONS = {
  ...DEFAULT_OPTIONS,
  logAgeNodeCount: 1536,
};
const NINE_PLAYER_MC_TRIALS = Number(process.env.LAQI_NINE_MC_TRIALS || 1_000_000);
const LARGE_FIELD_MC_TRIALS = Number(process.env.LAQI_522_MC_TRIALS || 3_000_000);
const NINE_PLAYER_MC_BATCHES = 2;
const LARGE_FIELD_MC_BATCHES = 3;
const BASE_SEED = 0x51a7c0de;

const ninePlayer = {
  id: "nine-player-final-table",
  label: "9-player realistic final-table example",
  chipCounts: [
    1_500_000, 900_000, 700_000, 500_000, 400_000,
    350_000, 300_000, 250_000, 100_000,
  ],
  payouts: [
    180_000, 150_000, 120_000, 90_000, 70_000,
    55_000, 45_000, 38_000, 32_000,
  ],
};

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function quantile(values, probability) {
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + ((ordered[upper] - ordered[lower]) * (position - lower));
}

function activePayouts(payouts, playerCount) {
  return payouts
    .map(Number)
    .filter((payout) => Number.isFinite(payout) && payout > 0)
    .sort((left, right) => right - left)
    .slice(0, playerCount);
}

function exactMalmuthHarvilleIcmDoublePrecision(chipCounts, payouts) {
  const stacks = chipCounts.map(Number);
  const prizes = activePayouts(payouts, stacks.length);
  const equities = Array.from({ length: stacks.length }, () => 0);
  const rankLimit = Math.min(stacks.length, prizes.length);

  function recurse(remainingIndexes, totalRemainingChips, rank, probability) {
    if (rank >= rankLimit) return;

    for (let offset = 0; offset < remainingIndexes.length; offset += 1) {
      const playerIndex = remainingIndexes[offset];
      const branchProbability = probability * (stacks[playerIndex] / totalRemainingChips);
      equities[playerIndex] += branchProbability * prizes[rank];

      if (rank + 1 < rankLimit) {
        const nextIndexes = remainingIndexes
          .slice(0, offset)
          .concat(remainingIndexes.slice(offset + 1));
        recurse(
          nextIndexes,
          totalRemainingChips - stacks[playerIndex],
          rank + 1,
          branchProbability,
        );
      }
    }
  }

  recurse(
    Array.from({ length: stacks.length }, (_, index) => index),
    sum(stacks),
    0,
    1,
  );
  return equities;
}

function serializableHighPrecisionErrorSummary(summary) {
  const { scaledErrors, maxAbsScaledError, ...numericSummary } = summary;
  return {
    ...numericSummary,
    errorsScientific: scaledErrors.map((value) => (
      scaledBigIntToScientific(value, 5)
    )),
    maxAbsDollarErrorScientific:
      scaledBigIntToScientific(maxAbsScaledError, 5),
  };
}

function rotateLeft(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function splitmix32(seed) {
  let state = seed >>> 0;
  return function nextUint32() {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
}

function xoshiro128StarStar(seed) {
  const seedState = splitmix32(seed);
  let state0 = seedState();
  let state1 = seedState();
  let state2 = seedState();
  let state3 = seedState();

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

function monteCarloSelectedPlayers({
  chipCounts,
  payouts,
  selectedIndexes,
  trials,
  batches,
  seed,
  progressLabel,
}) {
  const stacks = chipCounts.map(Number);
  const prizes = activePayouts(payouts, stacks.length);
  const targetCount = selectedIndexes.length;
  const times = new Float64Array(stacks.length);
  const totalSums = new Float64Array(targetCount);
  const totalSquareSums = new Float64Array(targetCount);
  const batchMeans = Array.from({ length: targetCount }, () => []);
  const batchTrialCounts = Array.from({ length: batches }, (_, batchIndex) => {
    const base = Math.floor(trials / batches);
    return base + (batchIndex < trials % batches ? 1 : 0);
  });

  const startedAt = performance.now();
  for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
    const batchTrials = batchTrialCounts[batchIndex];
    const random = xoshiro128StarStar((seed + Math.imul(batchIndex, 0x9e3779b1)) >>> 0);
    const batchSums = new Float64Array(targetCount);

    for (let trial = 0; trial < batchTrials; trial += 1) {
      for (let playerIndex = 0; playerIndex < stacks.length; playerIndex += 1) {
        times[playerIndex] = -Math.log(random()) / stacks[playerIndex];
      }

      for (let targetOffset = 0; targetOffset < targetCount; targetOffset += 1) {
        const targetIndex = selectedIndexes[targetOffset];
        const targetTime = times[targetIndex];
        let playersAhead = 0;

        for (let playerIndex = 0; playerIndex < times.length; playerIndex += 1) {
          if (playerIndex !== targetIndex && times[playerIndex] < targetTime) {
            playersAhead += 1;
          }
        }

        const payout = prizes[playersAhead] || 0;
        batchSums[targetOffset] += payout;
        totalSums[targetOffset] += payout;
        totalSquareSums[targetOffset] += payout * payout;
      }
    }

    for (let targetOffset = 0; targetOffset < targetCount; targetOffset += 1) {
      batchMeans[targetOffset].push(batchSums[targetOffset] / batchTrials);
    }
    console.log(`${progressLabel}: completed batch ${batchIndex + 1}/${batches}`);
  }
  const runtimeMs = performance.now() - startedAt;

  const players = selectedIndexes.map((playerIndex, targetOffset) => {
    const mean = totalSums[targetOffset] / trials;
    const variance = Math.max(
      0,
      (totalSquareSums[targetOffset] - ((totalSums[targetOffset] ** 2) / trials)) /
        Math.max(1, trials - 1),
    );
    const standardError = Math.sqrt(variance / trials);
    const margin95 = 1.96 * standardError;

    return {
      playerIndex: playerIndex + 1,
      chips: stacks[playerIndex],
      mean,
      standardError,
      margin95,
      ci95Low: mean - margin95,
      ci95High: mean + margin95,
      batchMeans: batchMeans[targetOffset],
    };
  });

  return {
    method: "serial exponential-race Monte Carlo",
    prng: "xoshiro128** with SplitMix32 seeding",
    trials,
    batches,
    seed,
    selectedPlayerCount: targetCount,
    runtimeMs,
    players,
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
    warmups,
    samples,
    medianMs: median(timesMs),
    meanMs: sum(timesMs) / timesMs.length,
    minMs: Math.min(...timesMs),
    maxMs: Math.max(...timesMs),
    timesMs,
    result,
  };
}

function errorSummary(values, reference) {
  const errors = values.map((value, index) => value - reference[index]);
  const absoluteErrors = errors.map(Math.abs);
  const relativeErrors = errors.map((error, index) => Math.abs(error) / reference[index]);
  return {
    errors,
    maxAbsDollarError: Math.max(...absoluteErrors),
    meanAbsDollarError: sum(absoluteErrors) / absoluteErrors.length,
    rootMeanSquareDollarError: Math.sqrt(
      sum(errors.map((error) => error * error)) / errors.length,
    ),
    maxRelativeError: Math.max(...relativeErrors),
  };
}

function formatDuration(milliseconds) {
  if (milliseconds < 1) return `${milliseconds.toFixed(3)} ms`;
  if (milliseconds < 1_000) return `${milliseconds.toFixed(2)} ms`;
  return `${(milliseconds / 1_000).toFixed(3)} s`;
}

function formatMoney(value, digits = 2) {
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatScientific(value, digits = 3) {
  return Number(value).toExponential(digits);
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function stripBenchmarkResult(benchmarkResult) {
  const { result, ...timing } = benchmarkResult;
  return timing;
}

console.log("Running 9-player high-precision reference, recursion, and LAQI benchmarks...");
const exactNineHighPrecision = exactMalmuthHarvilleIcmHighPrecision(
  ninePlayer.chipCounts,
  ninePlayer.payouts,
);
const exactNineDoubleBenchmark = benchmark(
  () => exactMalmuthHarvilleIcmDoublePrecision(
    ninePlayer.chipCounts,
    ninePlayer.payouts,
  ),
  { warmups: 2, samples: 7 },
);
const laqiNineBenchmark = benchmark(
  () => solveLogAgeQuadratureIcm(
    ninePlayer.chipCounts,
    ninePlayer.payouts,
    DEFAULT_OPTIONS,
  ),
  { warmups: 5, samples: 31 },
);
const exactNineValues = exactNineHighPrecision.values;
const exactNineDoubleValues = exactNineDoubleBenchmark.result;
const laqiNineValues = laqiNineBenchmark.result.players.map((player) => player.value);
const laqiNineErrors = highPrecisionErrorSummary(
  laqiNineValues,
  exactNineHighPrecision.scaledEquities,
);
const exactNineDoubleErrors = highPrecisionErrorSummary(
  exactNineDoubleValues,
  exactNineHighPrecision.scaledEquities,
);

console.log("Running 9-player Monte Carlo benchmark...");
const monteCarloNine = monteCarloSelectedPlayers({
  chipCounts: ninePlayer.chipCounts,
  payouts: ninePlayer.payouts,
  selectedIndexes: ninePlayer.chipCounts.map((_, index) => index),
  trials: NINE_PLAYER_MC_TRIALS,
  batches: NINE_PLAYER_MC_BATCHES,
  seed: BASE_SEED,
  progressLabel: "9-player Monte Carlo",
});
const monteCarloNineValues = monteCarloNine.players.map((player) => player.mean);
const monteCarloNineErrors = highPrecisionErrorSummary(
  monteCarloNineValues,
  exactNineHighPrecision.scaledEquities,
);
const monteCarloNineCoverage = monteCarloNine.players.filter(
  (player, index) =>
    exactNineValues[index] >= player.ci95Low && exactNineValues[index] <= player.ci95High,
).length;

console.log("Loading and benchmarking the 522-player example...");
const largeField = JSON.parse(
  await readFile(new URL("../examples/wsop-2025-main-event-snapshot-522.json", import.meta.url)),
);
const representativeIndexes = [0, 260, 521];
const laqi522Benchmark = benchmark(
  () => solveLogAgeQuadratureIcm(
    largeField.chipCounts,
    largeField.payouts,
    DEFAULT_OPTIONS,
  ),
  { warmups: 3, samples: 21 },
);
const laqi522HighPrecisionBenchmark = benchmark(
  () => solveLogAgeQuadratureIcm(
    largeField.chipCounts,
    largeField.payouts,
    HIGH_PRECISION_OPTIONS,
  ),
  { warmups: 1, samples: 3 },
);
const laqi522SelectedBenchmark = benchmark(
  () => representativeIndexes.map((playerIndex) =>
    solveRawPlayerLogAgeQuadratureIcm(
      largeField.chipCounts,
      largeField.payouts,
      playerIndex,
      DEFAULT_OPTIONS,
    )),
  { warmups: 2, samples: 11 },
);
const laqi522Values = laqi522Benchmark.result.players.map((player) => player.value);
const laqi522HighPrecisionValues = laqi522HighPrecisionBenchmark.result.players.map(
  (player) => player.value,
);
const laqi522Convergence = errorSummary(laqi522Values, laqi522HighPrecisionValues);

console.log("Running 522-player Monte Carlo benchmark...");
const monteCarlo522 = monteCarloSelectedPlayers({
  chipCounts: largeField.chipCounts,
  payouts: largeField.payouts,
  selectedIndexes: representativeIndexes,
  trials: LARGE_FIELD_MC_TRIALS,
  batches: LARGE_FIELD_MC_BATCHES,
  seed: BASE_SEED ^ 0x522,
  progressLabel: "522-player Monte Carlo",
});
const largeFieldMonteCarloGaps = representativeIndexes.map((playerIndex, offset) => {
  const monteCarlo = monteCarlo522.players[offset];
  const reference = laqi522HighPrecisionValues[playerIndex];
  return {
    playerIndex: playerIndex + 1,
    dollarDifference: monteCarlo.mean - reference,
    standardErrorUnits: (monteCarlo.mean - reference) / monteCarlo.standardError,
    individual95IncludesReference:
      reference >= monteCarlo.ci95Low && reference <= monteCarlo.ci95High,
  };
});
const simultaneous95CriticalValue = 2.39398;
const simultaneous95Coverage = largeFieldMonteCarloGaps.filter(
  (gap) => Math.abs(gap.standardErrorUnits) <= simultaneous95CriticalValue,
).length;
const largestMonteCarloStandardErrorGap = Math.max(
  ...largeFieldMonteCarloGaps.map((gap) => Math.abs(gap.standardErrorUnits)),
);

console.log("Loading and benchmarking the 4,000-player stress fixture...");
const stressFixture = JSON.parse(
  await readFile(
    new URL("./fixtures/wsop-2026-main-event-4000.json", import.meta.url),
    "utf8",
  ),
);
const stressBenchmark = benchmark(
  () => solveLogAgeQuadratureIcm(
    stressFixture.chipCounts,
    stressFixture.payouts,
    DEFAULT_OPTIONS,
  ),
  { warmups: 1, samples: 5 },
);
const stressResult = stressBenchmark.result;
const stressValueSum = sum(stressResult.players.map((player) => player.value));

const machine = {
  platform: process.platform,
  architecture: process.arch,
  cpu: cpus()[0]?.model || "unknown",
  logicalCpuCount: cpus().length,
  memoryBytes: totalmem(),
  nodeVersion: process.version,
  execution: "single Node.js process; no worker threads or GPU",
};

const results = {
  generatedAt: new Date().toISOString(),
  machine,
  settings: {
    productionLaqi: DEFAULT_OPTIONS,
    highPrecisionLaqi: HIGH_PRECISION_OPTIONS,
    monteCarloBatches: {
      ninePlayer: NINE_PLAYER_MC_BATCHES,
      fiveHundredTwentyTwoPlayer: LARGE_FIELD_MC_BATCHES,
    },
    confidenceInterval: "mean +/- 1.96 standard errors",
  },
  ninePlayer: {
    scenario: ninePlayer,
    exactReference: {
      method: exactNineHighPrecision.method,
      scaleDigits: exactNineHighPrecision.scaleDigits,
      prizePoolResidual: exactNineHighPrecision.prizePoolResidual,
    },
    exactValues: exactNineValues,
    exactValueDecimalStrings: exactNineHighPrecision.scaledEquities.map(
      (value) => scaledBigIntToDecimal(value, 15),
    ),
    doublePrecisionExactValues: exactNineDoubleValues,
    laqiValues: laqiNineValues,
    laqiValueDecimalStrings: laqiNineValues.map((value) => value.toFixed(15)),
    monteCarlo: monteCarloNine,
    error: {
      laqiVsExact: serializableHighPrecisionErrorSummary(laqiNineErrors),
      doublePrecisionRecursionVsExact:
        serializableHighPrecisionErrorSummary(exactNineDoubleErrors),
      monteCarloVsExact:
        serializableHighPrecisionErrorSummary(monteCarloNineErrors),
      monteCarloCiCoverage: `${monteCarloNineCoverage}/${ninePlayer.chipCounts.length}`,
    },
    timing: {
      doublePrecisionExact: stripBenchmarkResult(exactNineDoubleBenchmark),
      laqi: stripBenchmarkResult(laqiNineBenchmark),
      monteCarloRuntimeMs: monteCarloNine.runtimeMs,
    },
  },
  fiveHundredTwentyTwoPlayer: {
    scenario: {
      id: largeField.id,
      label: largeField.label,
      players: largeField.chipCounts.length,
      paidRanks: largeField.payouts.length,
    },
    representativeIndexes,
    laqi192Values: representativeIndexes.map((index) => laqi522Values[index]),
    laqi1536Values: representativeIndexes.map((index) => laqi522HighPrecisionValues[index]),
    fullFieldConvergence192Vs1536: laqi522Convergence,
    monteCarlo: monteCarlo522,
    monteCarloComparison: {
      gaps: largeFieldMonteCarloGaps,
      largestAbsoluteStandardErrorGap: largestMonteCarloStandardErrorGap,
      individual95Coverage: `${largeFieldMonteCarloGaps.filter((gap) => gap.individual95IncludesReference).length}/${representativeIndexes.length}`,
      simultaneous95Method: "Bonferroni-adjusted normal intervals for three comparisons",
      simultaneous95CriticalValue,
      simultaneous95Coverage: `${simultaneous95Coverage}/${representativeIndexes.length}`,
    },
    timing: {
      laqi192FullField: stripBenchmarkResult(laqi522Benchmark),
      laqi1536FullField: stripBenchmarkResult(laqi522HighPrecisionBenchmark),
      laqi192RawTargetSelectedThree: stripBenchmarkResult(laqi522SelectedBenchmark),
      monteCarloSelectedThreeRuntimeMs: monteCarlo522.runtimeMs,
    },
  },
  fourThousandPlayerStress: {
    fixture: {
      id: stressFixture.id,
      label: stressFixture.label,
      description: stressFixture.description,
      sourceFacts: stressFixture.sourceFacts,
      generation: stressFixture.generation,
      playerCount: stressFixture.chipCounts.length,
      paidRanks: stressFixture.payouts.length,
    },
    timing: stripBenchmarkResult(stressBenchmark),
    quadratureNodes: stressResult.metadata.quadratureNodes,
    totalPrizePool: stressResult.totalPrizePool,
    resultValueSum: stressValueSum,
    prizePoolDifference: stressValueSum - stressResult.totalPrizePool,
    selectedResults: [0, 1_999, 3_999].map((index) => stressResult.players[index]),
  },
};

const ninePlayerValueRows = ninePlayer.chipCounts.map((chips, index) => {
  return [
    index + 1,
    chips.toLocaleString("en-US"),
    scaledBigIntToDecimal(exactNineHighPrecision.scaledEquities[index], 12),
    laqiNineValues[index].toFixed(12),
    scaledBigIntToScientific(laqiNineErrors.scaledErrors[index], 5),
  ];
});

const ninePlayerMethodRows = [
  [
    "Exact Malmuth-Harville recursion (binary64 implementation)",
    "all 9 players",
    formatDuration(exactNineDoubleBenchmark.medianMs),
    scaledBigIntToScientific(exactNineDoubleErrors.maxAbsScaledError, 5),
    formatScientific(exactNineDoubleErrors.rootMeanSquareDollarError, 4),
    "n/a",
  ],
  [
    "LAQI (192 nodes, 32 panels)",
    "all 9 players",
    formatDuration(laqiNineBenchmark.medianMs),
    scaledBigIntToScientific(laqiNineErrors.maxAbsScaledError, 5),
    formatScientific(laqiNineErrors.rootMeanSquareDollarError, 4),
    "n/a",
  ],
  [
    `Serial Monte Carlo (${NINE_PLAYER_MC_TRIALS.toLocaleString("en-US")} trials)`,
    "all 9 players",
    formatDuration(monteCarloNine.runtimeMs),
    formatMoney(monteCarloNineErrors.maxAbsDollarError),
    formatMoney(monteCarloNineErrors.rootMeanSquareDollarError),
    `${monteCarloNineCoverage}/9`,
  ],
];

const largeFieldRows = representativeIndexes.map((playerIndex, offset) => {
  const mc = monteCarlo522.players[offset];
  const reference = laqi522HighPrecisionValues[playerIndex];
  const production = laqi522Values[playerIndex];
  return [
    playerIndex + 1,
    largeField.chipCounts[playerIndex].toLocaleString("en-US"),
    formatMoney(production),
    formatMoney(reference),
    formatMoney(Math.abs(production - reference), 4),
    formatMoney(mc.mean),
    `+/-${formatMoney(mc.margin95)}`,
    reference >= mc.ci95Low && reference <= mc.ci95High ? "yes" : "no",
  ];
});

const largeFieldTimingRows = [
  [
    "LAQI 192",
    "all 522 players",
    "deterministic",
    formatDuration(laqi522Benchmark.medianMs),
  ],
  [
    "LAQI 192 target-only raw estimate",
    "3 selected players (timing only)",
    "deterministic",
    formatDuration(laqi522SelectedBenchmark.medianMs),
  ],
  [
    "LAQI 1536 reference",
    "all 522 players",
    "deterministic",
    formatDuration(laqi522HighPrecisionBenchmark.medianMs),
  ],
  [
    `Serial Monte Carlo`,
    "3 selected players",
    `${LARGE_FIELD_MC_TRIALS.toLocaleString("en-US")} trials`,
    formatDuration(monteCarlo522.runtimeMs),
  ],
];

const stressRows = [
  ["Entrants represented", stressFixture.sourceFacts.entries.toLocaleString("en-US")],
  ["Players remaining", stressFixture.chipCounts.length.toLocaleString("en-US")],
  ["Active paid ranks", stressFixture.payouts.length.toLocaleString("en-US")],
  ["LAQI settings", "192 nodes, 32 panels"],
  ["Median full-field time", formatDuration(stressBenchmark.medianMs)],
  ["Fastest / slowest measured", `${formatDuration(stressBenchmark.minMs)} / ${formatDuration(stressBenchmark.maxMs)}`],
  ["Prize-pool conservation error", formatScientific(stressValueSum - stressResult.totalPrizePool, 4)],
];

const markdown = [
  "# Core Validation Results",
  "",
  `Generated: ${results.generatedAt}`,
  "",
  `Machine: ${machine.cpu}, ${(machine.memoryBytes / (1024 ** 3)).toFixed(0)} GB RAM, Node.js ${machine.nodeVersion}, ${machine.execution}.`,
  "",
  "All reported deterministic times are medians after warm-up. Monte Carlo times are complete single-thread runtimes. The 95% Monte Carlo intervals use the sample payout variance and a normal critical value of 1.96.",
  "",
  "## 1. Nine-Player Exact Accuracy",
  "",
  markdownTable(
    [
      "Seat",
      "Chips",
      "High-precision exact ICM ($)",
      "LAQI 192 ($)",
      "LAQI - exact ($)",
    ],
    ninePlayerValueRows,
  ),
  "",
  `Maximum absolute LAQI error: ${scaledBigIntToScientific(laqiNineErrors.maxAbsScaledError, 5)} dollars. Maximum relative error: ${formatScientific(laqiNineErrors.maxRelativeError, 4)}.`,
  "",
  "## 2. Nine-Player Accuracy and Time",
  "",
  markdownTable(
    ["Method", "Output", "Time", "Max abs error vs exact", "RMSE vs exact", "Exact values inside 95% CI"],
    ninePlayerMethodRows,
  ),
  "",
  "Errors are measured against the 50-decimal high-precision exact ICM reference above. The binary64 recursion row reflects floating-point rounding in the timed Node.js implementation; the mathematical recurrence itself is exact.",
  "",
  "## 3. 522-Player LAQI and Monte Carlo Comparison",
  "",
  `Production LAQI (192 nodes) was also compared with a 1,536-node full-field LAQI reference. Across all 522 players, the maximum 192-vs-1,536 difference was ${formatMoney(laqi522Convergence.maxAbsDollarError, 4)} and the mean absolute difference was ${formatMoney(laqi522Convergence.meanAbsDollarError, 4)}.`,
  "",
  markdownTable(
    ["Seat", "Chips", "LAQI 192", "LAQI 1536", "LAQI gap", "MC mean", "MC 95% margin", "Reference inside CI?"],
    largeFieldRows,
  ),
  "",
  `The largest Monte Carlo-reference difference was ${largestMonteCarloStandardErrorGap.toFixed(3)} standard errors. ${largeFieldMonteCarloGaps.filter((gap) => gap.individual95IncludesReference).length} of 3 individual 95% intervals contained the reference; all ${simultaneous95Coverage} contained it under a Bonferroni-adjusted simultaneous 95% comparison (critical value ${simultaneous95CriticalValue}).`,
  "",
  markdownTable(
    ["Method", "Output", "Sampling", "Time"],
    largeFieldTimingRows,
  ),
  "",
  "The displayed LAQI dollar values are normalized full-field results. The LAQI target-only raw estimates were measured only for the timing comparison. The selected-player Monte Carlo run used the same simulated finish for all three reported players in each trial and did not compute values for the other 519 players.",
  "",
  "## 4. 4,000-Player LAQI Stress Test",
  "",
  "This stress test uses 4,000 deterministic stacks from ICM Swap Chip Count Gen 2.4 and the observed 2026 WSOP Main Event payout table. The stacks are anchored to a 700,000-chip leader and a 138,120-chip average-stack Hero.",
  "",
  markdownTable(["Measurement", "Result"], stressRows),
  "",
  "Official event dimensions: https://www.wsop.com/tournaments/result/619/",
  "",
  "## Reproduction",
  "",
  "Run `npm run research:validate`. Trial counts can be reduced for a quick check with `LAQI_NINE_MC_TRIALS` and `LAQI_522_MC_TRIALS`; paper results should use the defaults.",
  "",
  "Run `npm run research:verify-nine-player-exact` for a lightweight deterministic check of the 50-decimal Table 1 reference and every reported LAQI difference.",
  "",
].join("\n");

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./results/core_validation_results.json", import.meta.url),
  `${JSON.stringify(results, null, 2)}\n`,
);
await writeFile(
  new URL("./results/core_validation_tables.md", import.meta.url),
  markdown,
);

console.log("Wrote research/results/core_validation_results.json");
console.log("Wrote research/results/core_validation_tables.md");
