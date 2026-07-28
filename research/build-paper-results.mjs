import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const ARTIFACT_CREATED_AT = "2026-07-28T21:40:20Z";
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
    id: "full-field-monte-carlo-522",
    path: "research/results/serial_full_field_monte_carlo_522_1m.json",
    url: new URL(
      "./results/serial_full_field_monte_carlo_522_1m.json",
      import.meta.url,
    ),
    role: "Supplemental serial full-field Monte Carlo timing benchmark",
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
  fiveHundredTwentyTwoPlayer: {
    laqi192RawTargetSelectedThreeMedianMs: 40.462,
    monteCarloSelectedThreeRuntimeMs: 34658.816,
    laqi192FullFieldMedianMs: 103.271,
    monteCarloTimeDividedBySelectedLaqi: 856.6,
  },
  fourThousandPlayer: {
    laqi192FullFieldMedianMs: 2470.660083,
    laqi192RawTargetAverageStackMedianMs: 462.647459,
    convergenceRuntimeMsByNode: {
      192: 2916.0849160000002,
      384: 5367.066124999999,
      768: 10685.504124999998,
      1536: 21359.97275,
    },
  },
};

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
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
const fullFieldMonteCarlo = sources["full-field-monte-carlo-522"];
const parallelFullFieldMonteCarlo =
  sources["parallel-full-field-monte-carlo-522-25b"];
const nodeConvergence522 = sources["node-convergence-522"];

const ninePlayerRows = core.ninePlayer.scenario.chipCounts.map((chips, index) => {
  const exactValue = core.ninePlayer.exactValues[index];
  const laqiValue = core.ninePlayer.laqiValues[index];
  return {
    playerIndex: index + 1,
    chips,
    laqi192Value: laqiValue,
    exactMalmuthHarvilleValue: exactValue,
    signedDollarDifference: laqiValue - exactValue,
    absoluteDollarDifference: Math.abs(laqiValue - exactValue),
  };
});

const fiveHundredTwentyTwoRows =
  core.fiveHundredTwentyTwoPlayer.representativeIndexes.map((playerIndex, offset) => {
    const monteCarlo = core.fiveHundredTwentyTwoPlayer.monteCarlo.players[offset];
    const laqiValue = core.fiveHundredTwentyTwoPlayer.laqi192Values[offset];
    return {
      playerIndex: playerIndex + 1,
      chips: monteCarlo.chips,
      laqi192FullFieldValue: laqiValue,
      monteCarloMean: monteCarlo.mean,
      monteCarloMinusLaqi: monteCarlo.mean - laqiValue,
      monteCarloStandardError: monteCarlo.standardError,
      monteCarloCi95Low: monteCarlo.ci95Low,
      monteCarloCi95High: monteCarlo.ci95High,
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
    const laqi192Value = parallelMonteCarloLaqi192.players[index].value;
    const monteCarloMinusLaqi = monteCarlo.meanIcmValue - laqi192Value;
    return {
      playerIndex: index + 1,
      chips: monteCarlo.chips,
      laqi192Value,
      monteCarloMean: monteCarlo.meanIcmValue,
      monteCarloMinusLaqi,
      monteCarloStandardError: monteCarlo.standardError,
      monteCarloMargin95: monteCarlo.margin95,
      standardErrorUnits: monteCarloMinusLaqi / monteCarlo.standardError,
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
      monteCarloErrorVsExact: ninePlayerMonteCarlo.summary,
      monteCarloPlayers: ninePlayerMonteCarlo.players,
    },
    table3FiveHundredTwentyTwoPlayerComparison: {
      fixtureId: core.fiveHundredTwentyTwoPlayer.scenario.id,
      playersRemaining: core.fiveHundredTwentyTwoPlayer.scenario.players,
      activePayoutRows: core.fiveHundredTwentyTwoPlayer.scenario.paidRanks,
      monteCarloTrials: core.fiveHundredTwentyTwoPlayer.monteCarlo.trials,
      rows: fiveHundredTwentyTwoRows,
      timing: {
        laqi192RawTargetSelectedThree: {
          timeMs:
            paperTimings.fiveHundredTwentyTwoPlayer
              .laqi192RawTargetSelectedThreeMedianMs,
          basis: "median after warm-up",
          output: "three target-only raw-equity estimates; timing only",
          timeDividedBySelectedLaqi: 1,
        },
        serialMonteCarloSelectedThree: {
          timeMs:
            paperTimings.fiveHundredTwentyTwoPlayer.monteCarloSelectedThreeRuntimeMs,
          basis: "one complete serial run",
          output: "three selected players",
          trials: 3_000_000,
          timeDividedBySelectedLaqi:
            paperTimings.fiveHundredTwentyTwoPlayer
              .monteCarloTimeDividedBySelectedLaqi,
        },
        laqi192FullField: {
          timeMs: paperTimings.fiveHundredTwentyTwoPlayer.laqi192FullFieldMedianMs,
          basis: "median after warm-up",
          output: "all 522 players",
        },
      },
      valueNote:
        "Displayed LAQI values are normalized 192-node full-field values. Target-only raw-estimate timing is reported separately and does not produce the displayed values.",
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
      representativeFullFieldResultNodes: convergence.referenceNodes,
      representativeFullFieldResults: representativeStressReferencePlayers,
      representativeFullFieldResultsAt192Nodes: representativeStress192Players,
      valueNote:
        "Representative ICM values use normalized 1,536-node full-field results. The 192-node target-only calculation is a raw estimate used only for timing.",
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
          runtimeMs:
            paperTimings.fourThousandPlayer.convergenceRuntimeMsByNode[run.nodes] ??
            run.runtimeMs,
          maxRelativeDifferencePercent: run.maxRelativeDifference * 100,
        })),
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
        paperTimingMs:
          paperTimings.fiveHundredTwentyTwoPlayer.laqi192FullFieldMedianMs,
        monteCarloActiveRuntimeDividedByLaqiTiming:
          parallelMonteCarloActiveRuntimeMs /
          paperTimings.fiveHundredTwentyTwoPlayer.laqi192FullFieldMedianMs,
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
        rootMeanSquareDollarDifference: Math.sqrt(
          parallelMonteCarloComparisons.reduce(
            (total, player) => total + player.monteCarloMinusLaqi ** 2,
            0,
          ) / parallelMonteCarloComparisons.length,
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
      purpose: "Support the manuscript's separate full-field runtime comparison.",
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
