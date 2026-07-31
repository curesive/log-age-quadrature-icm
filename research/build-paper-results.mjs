import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const ARTIFACT_CREATED_AT = "2026-07-31T01:51:27Z";
const PAPER_VERSION = "1.0.0";
const outputUrl = new URL(
  `./results/paper_results_v${PAPER_VERSION.replaceAll(".", "_")}.json`,
  import.meta.url,
);

const sourceDefinitions = [
  {
    id: "core-validation",
    path: "research/results/core_validation_results.json",
    url: new URL("./results/core_validation_results.json", import.meta.url),
    role: "Nine-player exact values and 522-player comparison values",
  },
  {
    id: "nine-player-monte-carlo",
    path: "research/results/nine_player_monte_carlo_1m.json",
    url: new URL("./results/nine_player_monte_carlo_1m.json", import.meta.url),
    role: "Nine-player Monte Carlo estimates and uncertainty",
  },
  {
    id: "main-event-stress",
    path: "research/results/main_event_stress_4000.json",
    url: new URL("./results/main_event_stress_4000.json", import.meta.url),
    role: "Four-thousand-player fixture metadata and normalized LAQI values",
  },
  {
    id: "main-event-convergence",
    path: "research/results/main_event_stress_4000_convergence.json",
    url: new URL(
      "./results/main_event_stress_4000_convergence.json",
      import.meta.url,
    ),
    role: "Four-thousand-player node-count convergence comparison",
  },
  {
    id: "main-event-convergence-timing",
    path: "research/results/main_event_stress_4000_convergence_timing.json",
    url: new URL(
      "./results/main_event_stress_4000_convergence_timing.json",
      import.meta.url,
    ),
    role: "Four-thousand-player standardized full-field runtime scaling benchmark",
  },
  {
    id: "full-field-monte-carlo-522",
    path: "research/results/serial_full_field_monte_carlo_522_3m.json",
    url: new URL(
      "./results/serial_full_field_monte_carlo_522_3m.json",
      import.meta.url,
    ),
    role: "Matched 522-player full-field LAQI and three-million-trial serial Monte Carlo timing benchmark",
  },
  {
    id: "parallel-full-field-monte-carlo-522-25b",
    path: "research/results/parallel_full_field_monte_carlo_522_25b.json",
    url: new URL(
      "./results/parallel_full_field_monte_carlo_522_25b.json",
      import.meta.url,
    ),
    role: "Final 25-billion-trial full-field Monte Carlo validation ledger",
  },
  {
    id: "node-convergence-522",
    path: "research/results/wsop_2025_main_event_522_node_convergence.json",
    url: new URL(
      "./results/wsop_2025_main_event_522_node_convergence.json",
      import.meta.url,
    ),
    role: "522-player 192-to-6,144-node LAQI self-convergence comparison",
  },
];

const paperTimings = {
  ninePlayer: {
    laqi192FullFieldMedianMs: 0.106,
    exactFullFieldMedianMs: 42.878,
    monteCarloFullFieldRuntimeMs: 360.487,
    exactTimeDividedByLaqi: 404.4,
    monteCarloTimeDividedByLaqi: 3399.5,
  },
  fourThousandPlayer: {
    laqi192FullFieldMedianMs: 2470.660083,
    laqi192RawTargetAverageStackMedianMs: 462.647459,
  },
};

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function roundForArtifact(value, decimalPlaces = 6) {
  return Number(value.toFixed(decimalPlaces));
}

async function loadSource(definition) {
  const text = await readFile(definition.url, "utf8");
  return {
    ...definition,
    sha256: sha256(text),
    data: JSON.parse(text),
  };
}

const loadedSources = await Promise.all(sourceDefinitions.map(loadSource));
const sources = Object.fromEntries(
  loadedSources.map((source) => [source.id, source.data]),
);
const core = sources["core-validation"];
const ninePlayerMonteCarlo = sources["nine-player-monte-carlo"];
const stress = sources["main-event-stress"];
const convergence = sources["main-event-convergence"];
const convergenceTiming = sources["main-event-convergence-timing"];
const fullFieldMonteCarlo = sources["full-field-monte-carlo-522"];
const parallelFullFieldMonteCarlo =
  sources["parallel-full-field-monte-carlo-522-25b"];
const nodeConvergence522 = sources["node-convergence-522"];

const ninePlayerRows = core.ninePlayer.scenario.chipCounts.map((chips, index) => {
  const exactValue = core.ninePlayer.exactValues[index];
  const laqiValue = core.ninePlayer.laqiValues[index];
  const signedDollarDifference =
    core.ninePlayer.error.laqiVsExact.errors[index];
  return {
    playerIndex: index + 1,
    chips,
    laqi192Value: laqiValue,
    laqi192ValueDecimal: core.ninePlayer.laqiValueDecimalStrings[index],
    exactMalmuthHarvilleValue: exactValue,
    exactMalmuthHarvilleValueDecimal:
      core.ninePlayer.exactValueDecimalStrings[index],
    signedDollarDifference,
    signedDollarDifferenceScientific:
      core.ninePlayer.error.laqiVsExact.errorsScientific[index],
    absoluteDollarDifference: Math.abs(signedDollarDifference),
  };
});

const fiveHundredTwentyTwoRows =
  fullFieldMonteCarlo.comparison.representativePlayers.map((monteCarlo) => {
    const laqiValue = monteCarlo.laqi192Value;
    return {
      playerIndex: monteCarlo.playerIndex,
      chips: monteCarlo.chips,
      laqi192FullFieldValue: laqiValue,
      monteCarloMean: monteCarlo.mean,
      monteCarloMinusLaqi: monteCarlo.mean - laqiValue,
      monteCarloStandardError: monteCarlo.standardError,
      monteCarloCi95Low: monteCarlo.ci95Low,
      monteCarloCi95High: monteCarlo.ci95High,
      absoluteRelativeDifference:
        Math.abs(monteCarlo.mean - laqiValue) / laqiValue,
      laqiInsideMonteCarloCi95:
        laqiValue >= monteCarlo.ci95Low && laqiValue <= monteCarlo.ci95High,
    };
  });

const parallelMonteCarloLaqi192 = solveLogAgeQuadratureIcm(
  parallelFullFieldMonteCarlo.scenario.chipCounts,
  parallelFullFieldMonteCarlo.scenario.payouts,
  {
    logAgeNodeCount: 192,
    logAgePanelCount: 32,
    tailTolerance: 1e-12,
  },
);
const parallelMonteCarloComparisons = parallelFullFieldMonteCarlo.results.map(
  (monteCarlo, index) => {
    // Transcendental functions can differ by a few last-place bits across
    // operating-system math libraries. Paper-facing dollar values are rounded
    // below one millionth of a dollar so the canonical artifact is portable.
    const rawLaqi192Value = parallelMonteCarloLaqi192.players[index].value;
    const laqi192Value = roundForArtifact(rawLaqi192Value);
    const monteCarloMinusLaqi = roundForArtifact(
      monteCarlo.meanIcmValue - rawLaqi192Value,
    );
    return {
      playerIndex: index + 1,
      chips: monteCarlo.chips,
      laqi192Value,
      monteCarloMean: monteCarlo.meanIcmValue,
      monteCarloMinusLaqi,
      monteCarloStandardError: monteCarlo.standardError,
      monteCarloMargin95: monteCarlo.margin95,
      standardErrorUnits: roundForArtifact(
        monteCarloMinusLaqi / monteCarlo.standardError,
        9,
      ),
      laqiInsideIndividualMonteCarlo95:
        Math.abs(monteCarloMinusLaqi) <= monteCarlo.margin95,
    };
  },
);
const parallelMonteCarloActiveRuntimeMs =
  parallelFullFieldMonteCarlo.sessions.reduce(
    (total, session) => total + session.runtimeMs,
    0,
  );
const parallelMonteCarloMargin95Values =
  parallelFullFieldMonteCarlo.results.map((player) => player.margin95);
const parallelMonteCarloIndividual95Coverage =
  parallelMonteCarloComparisons.filter(
    (player) => player.laqiInsideIndividualMonteCarlo95,
  ).length;
const parallelMonteCarloLargestAbsoluteDifference =
  parallelMonteCarloComparisons.reduce((largest, player) =>
    Math.abs(player.monteCarloMinusLaqi) >
    Math.abs(largest.monteCarloMinusLaqi)
      ? player
      : largest);
const parallelMonteCarloLargestAbsoluteStandardErrorGap =
  parallelMonteCarloComparisons.reduce((largest, player) =>
    Math.abs(player.standardErrorUnits) > Math.abs(largest.standardErrorUnits)
      ? player
      : largest);
const nodeConvergence522At192 = nodeConvergence522.runs.find(
  (run) => run.requestedNodes === 192,
);

const stressResultsByPlayer = new Map(
  stress.laqi.selectedResults.map((player) => [player.playerIndex, player]),
);
const representativeStress192Players = [1, 1566, 4000].map((playerIndex) =>
  stressResultsByPlayer.get(playerIndex),
);
const representativeStressReferencePlayers =
  convergence.referenceRepresentativeFullFieldResults;
const stressSpeedRatio =
  paperTimings.fourThousandPlayer.laqi192FullFieldMedianMs /
  paperTimings.fourThousandPlayer.laqi192RawTargetAverageStackMedianMs;
const chipLeader192Value = stressResultsByPlayer.get(1).value;
const chipLeader1536Value = representativeStressReferencePlayers.find(
  (player) => player.playerIndex === 1,
).value;

const artifact = {
  schema: "log-age-quadrature-icm-paper-results",
  schemaVersion: 1,
  artifactCreatedAt: ARTIFACT_CREATED_AT,
  paper: {
    title: "Log-Age Quadrature ICM: Fast Deterministic Dollar Equity for Poker Tournaments",
    version: PAPER_VERSION,
    status: "preprint draft",
  },
  selectionPolicy: {
    canonical: true,
    purpose:
      "Record the exact numerical values and benchmark measurements selected for the manuscript.",
    deterministicValues:
      "Copied from the checked-in solver result artifacts identified below.",
    paperTimings:
      "Recorded aggregate measurements selected from the manuscript results worksheet. Later reruns may differ because benchmark time depends on system state.",
    rawTimingSamples:
      "Available where present in a source artifact; otherwise only the selected aggregate measurement was retained.",
  },
  environment: {
    cpu: "Apple M3 Ultra",
    architecture: "arm64",
    logicalCpuCount: 28,
    memoryBytes: 103079215104,
    nodeVersion: "v24.16.0",
    execution: "single Node.js process; no worker threads or GPU",
  },
  solverSettings: {
    standard: {
      logAgeNodeCount: 192,
      logAgePanelCount: 32,
      tailTolerance: 1e-12,
    },
    convergenceReference: {
      logAgeNodeCount: 1536,
      logAgePanelCount: 32,
      tailTolerance: 1e-12,
      exactReference: false,
    },
  },
  sourceArtifacts: loadedSources.map(({ data, url, ...source }) => source),
  results: {
    table1NinePlayerExactAccuracy: {
      playersRemaining: 9,
      chipCounts: core.ninePlayer.scenario.chipCounts,
      payouts: core.ninePlayer.scenario.payouts,
      activePrizePool: sum(core.ninePlayer.scenario.payouts),
      rows: ninePlayerRows,
      summary: core.ninePlayer.error.laqiVsExact,
    },
    table2NinePlayerAccuracyAndTime: {
      timing: {
        laqi192FullField: {
          timeMs: paperTimings.ninePlayer.laqi192FullFieldMedianMs,
          basis: "median after warm-up",
          timeDividedByLaqi: 1,
        },
        exactMalmuthHarvilleFullField: {
          timeMs: paperTimings.ninePlayer.exactFullFieldMedianMs,
          basis: "median after warm-up",
          timeDividedByLaqi: paperTimings.ninePlayer.exactTimeDividedByLaqi,
        },
        serialMonteCarloFullField: {
          trials: 1_000_000,
          timeMs: paperTimings.ninePlayer.monteCarloFullFieldRuntimeMs,
          basis: "one complete serial run",
          timeDividedByLaqi: paperTimings.ninePlayer.monteCarloTimeDividedByLaqi,
        },
      },
      laqiErrorVsExact: core.ninePlayer.error.laqiVsExact,
      doublePrecisionRecursionErrorVsExact:
        core.ninePlayer.error.doublePrecisionRecursionVsExact,
      monteCarloErrorVsExact: ninePlayerMonteCarlo.summary,
      monteCarloPlayers: ninePlayerMonteCarlo.players,
    },
    table3FiveHundredTwentyTwoPlayerComparison: {
      fixtureId: fullFieldMonteCarlo.scenario.fixtureId,
      playersRemaining: fullFieldMonteCarlo.scenario.players,
      activePayoutRows: fullFieldMonteCarlo.scenario.activePayoutRows,
      monteCarloTrials: fullFieldMonteCarlo.monteCarlo.trials,
      rows: fiveHundredTwentyTwoRows,
      fieldWideComparison: fullFieldMonteCarlo.comparison.fieldWide,
      timing: {
        laqi192FullField: {
          timeMs: fullFieldMonteCarlo.laqi.timing.medianMs,
          basis: `median of ${fullFieldMonteCarlo.laqi.timing.samples} measurements after ${fullFieldMonteCarlo.laqi.timing.warmups} warm-up runs`,
          output: fullFieldMonteCarlo.laqi.output,
          timeDividedByLaqi: 1,
        },
        serialMonteCarloFullField: {
          timeMs: fullFieldMonteCarlo.monteCarlo.runtimeMs,
          basis: "one complete serial run",
          output: fullFieldMonteCarlo.monteCarlo.output,
          trials: fullFieldMonteCarlo.monteCarlo.trials,
          timeDividedByLaqi:
            fullFieldMonteCarlo.comparison
              .monteCarloTimeDividedByLaqiMedian,
        },
      },
      valueNote:
        "All displayed values and timings come from the same matched full-field benchmark, in which both methods returned all 522 normalized player values.",
    },
    table4FourThousandPlayerStress: {
      fixtureId: stress.scenario.fixtureId,
      totalEntrants: stress.scenario.entries,
      playersRemaining: stress.scenario.playersRemaining,
      activePayoutRows: stress.scenario.paidPlaces,
      totalPrizePool: stress.scenario.prizePoolDollars,
      chipLeaderStack: stress.scenario.chipLeaderStack,
      averageStack: stress.scenario.averageStack,
      timing: {
        laqi192FullFieldMedianMs:
          paperTimings.fourThousandPlayer.laqi192FullFieldMedianMs,
        laqi192RawTargetAverageStackMedianMs:
          paperTimings.fourThousandPlayer.laqi192RawTargetAverageStackMedianMs,
        fullFieldTimeDividedByRawTargetTime: stressSpeedRatio,
        fullFieldBasis: "median of five measurements after one warm-up",
        rawTargetBasis:
          "median of five target-only raw-equity measurements after one warm-up; timing only",
      },
      representativeFullFieldResultNodes: 192,
      representativeFullFieldResults: representativeStress192Players,
      convergenceReferenceFullFieldResultNodes: convergence.referenceNodes,
      convergenceReferenceFullFieldResults: representativeStressReferencePlayers,
      valueNote:
        "Representative Table 4 ICM values use normalized 192-node full-field results. The separately reported raw target-only calculation is used only for timing.",
      convergence: {
        referenceNodes: convergence.referenceNodes,
        exactReference: false,
        note: convergence.note,
        chipLeaderComparison: {
          playerIndex: 1,
          chips: stress.scenario.chipLeaderStack,
          valueAt192Nodes: chipLeader192Value,
          valueAt1536Nodes: chipLeader1536Value,
          absoluteDollarDifference: Math.abs(chipLeader192Value - chipLeader1536Value),
          relativeDifferenceFraction:
            Math.abs(chipLeader192Value - chipLeader1536Value) /
            chipLeader1536Value,
          relativeDifferencePercent:
            (Math.abs(chipLeader192Value - chipLeader1536Value) /
              chipLeader1536Value) * 100,
        },
        runs: convergence.runs.map((run) => ({
          ...run,
          maxRelativeDifferencePercent: run.maxRelativeDifference * 100,
        })),
      },
      standardizedRuntimeScaling: {
        benchmark: convergenceTiming.benchmark,
        settings: convergenceTiming.settings,
        machine: convergenceTiming.machine,
        runs: convergenceTiming.runs,
      },
    },
    table5TwentyFiveBillionTrialValidation: {
      purpose:
        "Validate 192-node LAQI against a high-precision full-field Monte Carlo benchmark.",
      fixtureId: core.fiveHundredTwentyTwoPlayer.scenario.id,
      scenarioSha256: parallelFullFieldMonteCarlo.scenario.id,
      playersRemaining: parallelFullFieldMonteCarlo.scenario.playerCount,
      activePayoutRows: parallelFullFieldMonteCarlo.scenario.paidRankCount,
      activePrizePool: parallelFullFieldMonteCarlo.scenario.totalPrizePool,
      monteCarlo: {
        method: "parallel full-field exponential-race Monte Carlo",
        trials: parallelFullFieldMonteCarlo.aggregate.trials,
        sessions: parallelFullFieldMonteCarlo.sessions.length,
        workersBySession: parallelFullFieldMonteCarlo.sessions.map(
          (session) => session.workers,
        ),
        activeRuntimeMs: parallelMonteCarloActiveRuntimeMs,
        activeRuntimeHours: parallelMonteCarloActiveRuntimeMs / 3_600_000,
        averageTrialsPerSecond:
          parallelFullFieldMonteCarlo.aggregate.trials /
          (parallelMonteCarloActiveRuntimeMs / 1_000),
        random: parallelFullFieldMonteCarlo.random,
        host: {
          cpuModel: parallelFullFieldMonteCarlo.sessions.at(-1).host.cpuModel,
          platform: parallelFullFieldMonteCarlo.sessions.at(-1).host.platform,
          logicalCpuCount:
            parallelFullFieldMonteCarlo.sessions.at(-1).host.logicalCpuCount,
          performanceCoreCount:
            parallelFullFieldMonteCarlo.sessions.at(-1).host.performanceCoreCount,
        },
        individual95MarginRange: {
          minimum: Math.min(...parallelMonteCarloMargin95Values),
          maximum: Math.max(...parallelMonteCarloMargin95Values),
        },
      },
      laqi192: {
        settings: {
          logAgeNodeCount: 192,
          logAgePanelCount: 32,
          tailTolerance: 1e-12,
        },
        paperTimingMs: fullFieldMonteCarlo.laqi.timing.medianMs,
        monteCarloActiveRuntimeDividedByLaqiTiming:
          parallelMonteCarloActiveRuntimeMs /
          fullFieldMonteCarlo.laqi.timing.medianMs,
        maximumDifferenceFrom6144Nodes:
          nodeConvergence522At192.comparisonTo6144.maxAbsDollarError,
        convergenceReferenceIsExact: false,
      },
      comparison: {
        individual95Coverage: {
          count: parallelMonteCarloIndividual95Coverage,
          total: parallelMonteCarloComparisons.length,
          percent:
            (100 * parallelMonteCarloIndividual95Coverage) /
            parallelMonteCarloComparisons.length,
          note:
            "Individual normal intervals; not a simultaneous 522-player confidence band.",
        },
        rootMeanSquareDollarDifference: roundForArtifact(
          Math.sqrt(
            parallelMonteCarloComparisons.reduce(
              (total, player) => total + player.monteCarloMinusLaqi ** 2,
              0,
            ) / parallelMonteCarloComparisons.length,
          ),
        ),
        largestAbsoluteDollarDifference:
          parallelMonteCarloLargestAbsoluteDifference,
        largestAbsoluteStandardErrorGap:
          parallelMonteCarloLargestAbsoluteStandardErrorGap,
        representativePlayers: [0, 260, 521].map(
          (index) => parallelMonteCarloComparisons[index],
        ),
      },
      ledgerNote:
        "The first session was recovered from its last durable checkpoint after an unclean shutdown; all checkpointed trials were retained and session totals sum to the aggregate.",
    },
    supplementalFullFieldMonteCarlo522: {
      purpose: "Support the manuscript's matched 522-player full-field runtime comparison.",
      fixtureId: fullFieldMonteCarlo.scenario.fixtureId,
      playersRemaining: fullFieldMonteCarlo.scenario.players,
      monteCarlo: {
        trials: fullFieldMonteCarlo.monteCarlo.trials,
        timeMs: fullFieldMonteCarlo.monteCarlo.runtimeMs,
        output: fullFieldMonteCarlo.monteCarlo.output,
        method: fullFieldMonteCarlo.monteCarlo.method,
      },
      laqi192FullField: {
        medianMs: fullFieldMonteCarlo.laqi.timing.medianMs,
        warmups: fullFieldMonteCarlo.laqi.timing.warmups,
        samples: fullFieldMonteCarlo.laqi.timing.samples,
      },
      monteCarloTimeDividedByLaqi:
        fullFieldMonteCarlo.comparison.monteCarloTimeDividedByLaqiMedian,
      representativePlayers: fullFieldMonteCarlo.comparison.representativePlayers,
    },
  },
};

await writeFile(outputUrl, `${JSON.stringify(artifact, null, 2)}\n`);

console.log(JSON.stringify({
  output: outputUrl.pathname,
  paperVersion: artifact.paper.version,
  sourceArtifactCount: artifact.sourceArtifacts.length,
  resultSectionCount: Object.keys(artifact.results).length,
}, null, 2));
