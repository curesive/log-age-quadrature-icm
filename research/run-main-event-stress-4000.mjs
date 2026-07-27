import { readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  solveLogAgeQuadratureIcm,
  solveRawPlayerLogAgeQuadratureIcm,
} from "../src/log-age-quadrature-icm.js";

const fixtureUrl = new URL("./fixtures/wsop-2026-main-event-4000.json", import.meta.url);
const resultUrl = new URL("./results/main_event_stress_4000.json", import.meta.url);
const WARMUPS = 1;
const SAMPLES = 5;
const LAQI_OPTIONS = {
  logAgeNodeCount: 192,
  logAgePanelCount: 32,
  tailTolerance: 1e-12,
};

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantileSortedDescending(values, probability) {
  const position = (values.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + ((values[upper] - values[lower]) * (position - lower));
}

function benchmark(operation) {
  for (let index = 0; index < WARMUPS; index += 1) operation();

  const timesMs = [];
  let result;
  for (let index = 0; index < SAMPLES; index += 1) {
    const startedAt = performance.now();
    result = operation();
    timesMs.push(performance.now() - startedAt);
  }

  return {
    warmups: WARMUPS,
    samples: SAMPLES,
    medianMs: median(timesMs),
    meanMs: sum(timesMs) / timesMs.length,
    minMs: Math.min(...timesMs),
    maxMs: Math.max(...timesMs),
    timesMs,
    result,
  };
}

const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const { chipCounts, payouts } = fixture;
const heroIndex = chipCounts.indexOf(fixture.generation.heroStack);
if (heroIndex < 0) throw new Error("The fixture does not contain its Hero stack anchor.");

console.log("Running the 4,000-player LAQI stress benchmark...");
const measured = benchmark(() => solveLogAgeQuadratureIcm(chipCounts, payouts, LAQI_OPTIONS));
console.log("Running the average-stack target-only benchmark...");
const measuredTarget = benchmark(() => solveRawPlayerLogAgeQuadratureIcm(
  chipCounts,
  payouts,
  heroIndex,
  LAQI_OPTIONS,
));
const resultValueSum = sum(measured.result.players.map((player) => player.value));
const selectedIndexes = [...new Set([0, heroIndex, 1_999, 3_999])];

const output = {
  generatedAt: new Date().toISOString(),
  scenario: {
    fixtureId: fixture.id,
    entries: fixture.sourceFacts.entries,
    playersRemaining: chipCounts.length,
    paidPlaces: payouts.length,
    prizePoolDollars: fixture.sourceFacts.prizePoolDollars,
    totalChips: fixture.generation.totalChips,
    averageStack: fixture.generation.heroStack,
    chipLeaderStack: fixture.generation.chipLeaderStack,
    chipGenerator: fixture.generation.generator,
    payoutSource: {
      type: "observed PokerNews 2026 WSOP Main Event paytable",
      url: fixture.sourceFacts.payoutUrl,
      retrievedAt: fixture.sourceFacts.payoutRetrievedAt,
    },
  },
  inputSummary: {
    ...fixture.checksums,
    uniqueStackCount: new Set(chipCounts).size,
    chipLeader: chipCounts[0],
    p25Stack: quantileSortedDescending(chipCounts, 0.25),
    medianStack: quantileSortedDescending(chipCounts, 0.5),
    p75Stack: quantileSortedDescending(chipCounts, 0.75),
    shortestStack: chipCounts.at(-1),
    firstPrize: payouts[0],
    minCash: payouts.at(-1),
    payoutTotal: sum(payouts),
  },
  laqi: {
    options: LAQI_OPTIONS,
    timing: {
      warmups: measured.warmups,
      samples: measured.samples,
      medianMs: measured.medianMs,
      meanMs: measured.meanMs,
      minMs: measured.minMs,
      maxMs: measured.maxMs,
      timesMs: measured.timesMs,
    },
    rawTargetAverageStack: {
      playerIndex: heroIndex + 1,
      chips: chipCounts[heroIndex],
      rawEquityEstimate: measuredTarget.result.player.rawEquityEstimate,
      rawValueEstimate: measuredTarget.result.player.rawValueEstimate,
      outputValueType: measuredTarget.result.metadata.outputValueType,
      normalizationApplied: measuredTarget.result.metadata.normalizationApplied,
      normalization: measuredTarget.result.metadata.normalization,
      timing: {
        warmups: measuredTarget.warmups,
        samples: measuredTarget.samples,
        medianMs: measuredTarget.medianMs,
        meanMs: measuredTarget.meanMs,
        minMs: measuredTarget.minMs,
        maxMs: measuredTarget.maxMs,
        timesMs: measuredTarget.timesMs,
      },
    },
    totalPrizePool: measured.result.totalPrizePool,
    resultValueSum,
    prizePoolDifference: resultValueSum - measured.result.totalPrizePool,
    selectedResults: selectedIndexes.map((index) => measured.result.players[index]),
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

await writeFile(resultUrl, `${JSON.stringify(output, null, 2)}\n`);

console.log(JSON.stringify({
  fixture: fixtureUrl.pathname,
  result: resultUrl.pathname,
  playersRemaining: chipCounts.length,
  paidPlaces: payouts.length,
  heroRank: heroIndex + 1,
  medianMs: measured.medianMs,
  targetOnlyMedianMs: measuredTarget.medianMs,
  minMs: measured.minMs,
  maxMs: measured.maxMs,
  prizePoolDifference: output.laqi.prizePoolDifference,
}, null, 2));
