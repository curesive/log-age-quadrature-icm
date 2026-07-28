import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildResults, normalizeScenario } from "../monte-carlo/engine.mjs";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const ledgerPath = fileURLToPath(new URL(
  "./results/parallel_full_field_monte_carlo_522_25b.json",
  import.meta.url,
));
const scenarioPath = fileURLToPath(new URL(
  "../examples/wsop-2025-main-event-snapshot-522.json",
  import.meta.url,
));
const convergencePath = fileURLToPath(new URL(
  "./results/wsop_2025_main_event_522_node_convergence.json",
  import.meta.url,
));
const paperResultsPath = fileURLToPath(new URL(
  "./results/paper_results_v1_0_0.json",
  import.meta.url,
));

const [ledgerContents, scenarioContents, convergenceContents, paperResultsContents] =
  await Promise.all([
    readFile(ledgerPath, "utf8"),
    readFile(scenarioPath, "utf8"),
    readFile(convergencePath, "utf8"),
    readFile(paperResultsPath, "utf8"),
  ]);

const ledger = JSON.parse(ledgerContents);
const sourceScenario = JSON.parse(scenarioContents);
const convergence = JSON.parse(convergenceContents);
const paperResults = JSON.parse(paperResultsContents);
const normalizedSourceScenario = normalizeScenario({
  name: sourceScenario.name || sourceScenario.label,
  chipCounts: sourceScenario.chipCounts || sourceScenario.playerChipCounts,
  payouts: sourceScenario.payouts || sourceScenario.payoutList,
});

assert.equal(ledger.format, "log-age-quadrature-monte-carlo-ledger");
assert.equal(ledger.version, 1);
assert.equal(ledger.scenario.id, normalizedSourceScenario.id);
assert.equal(ledger.scenario.playerCount, 522);
assert.equal(ledger.scenario.paidRankCount, 522);
assert.equal(ledger.aggregate.trials, 25_000_000_000);
assert.equal(
  ledger.sessions.reduce((total, session) => total + session.trials, 0),
  ledger.aggregate.trials,
);
assert.ok(ledger.sessions.every((session) =>
  session.status === "completed" || session.status === "interrupted"));
assert.deepEqual(buildResults(ledger), ledger.results);
assert.ok(
  Math.abs(
    ledger.aggregate.means.reduce((total, value) => total + value, 0) -
      ledger.scenario.totalPrizePool,
  ) < 1e-6,
);
assert.equal(convergence.fixtureId, "wsop-2025-main-event-snapshot-522");
assert.equal(convergence.referenceNodes, 6_144);

const laqi192 = solveLogAgeQuadratureIcm(
  ledger.scenario.chipCounts,
  ledger.scenario.payouts,
  {
    logAgeNodeCount: 192,
    logAgePanelCount: 32,
    tailTolerance: 1e-12,
  },
);
const comparisons = ledger.results.map((monteCarlo, index) => {
  const laqiValue = laqi192.players[index].value;
  const difference = monteCarlo.meanIcmValue - laqiValue;
  return {
    playerIndex: index + 1,
    chips: monteCarlo.chips,
    laqi192Value: laqiValue,
    monteCarloMean: monteCarlo.meanIcmValue,
    monteCarloMinusLaqi: difference,
    standardErrorUnits: difference / monteCarlo.standardError,
    margin95: monteCarlo.margin95,
    laqiInsideIndividual95: Math.abs(difference) <= monteCarlo.margin95,
  };
});
const largestAbsoluteDifference = comparisons.reduce((largest, row) =>
  Math.abs(row.monteCarloMinusLaqi) > Math.abs(largest.monteCarloMinusLaqi)
    ? row
    : largest);
const largestAbsoluteStandardErrorGap = comparisons.reduce((largest, row) =>
  Math.abs(row.standardErrorUnits) > Math.abs(largest.standardErrorUnits)
    ? row
    : largest);
const individual95CoverageCount = comparisons.filter(
  (row) => row.laqiInsideIndividual95,
).length;
const activeRuntimeMs = ledger.sessions.reduce(
  (total, session) => total + session.runtimeMs,
  0,
);
const marginValues = ledger.results.map((row) => row.margin95);
const laqiPaperTimeMs =
  paperResults.results.table3FiveHundredTwentyTwoPlayerComparison
    .timing.laqi192FullField.timeMs;
const convergence192 = convergence.runs.find((run) => run.requestedNodes === 192);

const summary = {
  artifact: {
    path: "research/results/parallel_full_field_monte_carlo_522_25b.json",
    sha256: createHash("sha256").update(ledgerContents).digest("hex"),
  },
  scenario: {
    id: ledger.scenario.id,
    players: ledger.scenario.playerCount,
    activePayoutRows: ledger.scenario.paidRankCount,
    totalPrizePool: ledger.scenario.totalPrizePool,
  },
  monteCarlo: {
    trials: ledger.aggregate.trials,
    sessions: ledger.sessions.length,
    workersBySession: ledger.sessions.map((session) => session.workers),
    activeRuntimeMs,
    activeRuntimeHours: activeRuntimeMs / 3_600_000,
    averageTrialsPerSecond: ledger.aggregate.trials / (activeRuntimeMs / 1_000),
    individual95MarginRange: {
      minimum: Math.min(...marginValues),
      maximum: Math.max(...marginValues),
    },
  },
  laqi192: {
    paperTimingMs: laqiPaperTimeMs,
    monteCarloActiveRuntimeDividedByLaqiTiming: activeRuntimeMs / laqiPaperTimeMs,
    maximumDifferenceFrom6144Nodes:
      convergence192.comparisonTo6144.maxAbsDollarError,
  },
  comparison: {
    laqiInsideIndividual95: {
      count: individual95CoverageCount,
      total: comparisons.length,
      percent: (100 * individual95CoverageCount) / comparisons.length,
      note: "These are individual intervals, not a simultaneous 522-player confidence band.",
    },
    rootMeanSquareDollarDifference: Math.sqrt(
      comparisons.reduce(
        (total, row) => total + row.monteCarloMinusLaqi ** 2,
        0,
      ) / comparisons.length,
    ),
    largestAbsoluteDollarDifference: largestAbsoluteDifference,
    largestAbsoluteStandardErrorGap,
    representativePlayers: [0, 260, 521].map((index) => comparisons[index]),
  },
};

console.log(JSON.stringify(summary, null, 2));
