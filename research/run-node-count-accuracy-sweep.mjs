import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 13;
const CASES_PER_PLAYER_COUNT = Number(process.env.LAQI_SWEEP_CASES || 100);
const PRIZE_POOL = 1_000_000;
const PANEL_COUNT = 32;
const TAIL_TOLERANCE = 1e-12;
const NODE_COUNTS = [192, 1536];
const LARGE_FIELD_NODE_COUNTS = [192, 384, 768, 1536, 3072, 6144];
const BASE_SEED = 0x1a91_2026;
const EXACT_SCALE_DIGITS = 50;
const EXACT_SCALE = 10n ** BigInt(EXACT_SCALE_DIGITS);
const EXACT_SCALE_NUMBER = 10 ** EXACT_SCALE_DIGITS;

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
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
    const rotateLeft = (value, shift) => (
      ((value << shift) | (value >>> (32 - shift))) >>> 0
    );
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

function normalRandom(random) {
  const radius = Math.sqrt(-2 * Math.log(random()));
  const angle = 2 * Math.PI * random();
  return radius * Math.cos(angle);
}

function buildCaseFamily(caseIndex) {
  if (caseIndex === 0) {
    return {
      stackSigma: null,
      payoutExponent: 1.05,
      payoutFloorWeight: 0.12,
      stacks: [
        2_400_000, 1_650_000, 1_200_000, 950_000, 780_000,
        640_000, 520_000, 430_000, 350_000, 280_000,
        210_000, 140_000, 70_000,
      ],
    };
  }

  const random = xoshiro128StarStar((BASE_SEED + Math.imul(caseIndex, 0x9e3779b1)) >>> 0);
  const progress = CASES_PER_PLAYER_COUNT === 1
    ? 0
    : caseIndex / (CASES_PER_PLAYER_COUNT - 1);
  const stackSigma = 0.25 + (1.75 * progress);
  const stacks = Array.from(
    { length: MAX_PLAYERS },
    () => Math.max(1_000, Math.round(500_000 * Math.exp(stackSigma * normalRandom(random)))),
  ).sort((left, right) => right - left);

  return {
    stackSigma,
    payoutExponent: 0.65 + (0.9 * random()),
    payoutFloorWeight: 0.05 + (0.2 * random()),
    stacks,
  };
}

function buildPayouts(playerCount, payoutExponent, payoutFloorWeight) {
  const weights = Array.from(
    { length: playerCount },
    (_, rank) => payoutFloorWeight + (1 / ((rank + 1) ** payoutExponent)),
  );
  const weightTotal = sum(weights);
  const allocations = weights.map((weight, index) => {
    const exact = (weight / weightTotal) * PRIZE_POOL;
    return { index, payout: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let dollarsLeft = PRIZE_POOL - sum(allocations.map(({ payout }) => payout));
  const remainderOrder = [...allocations].sort(
    (left, right) => right.remainder - left.remainder,
  );
  for (let index = 0; index < dollarsLeft; index += 1) {
    allocations[remainderOrder[index].index].payout += 1;
  }
  return allocations.map(({ payout }) => payout);
}

// This subset dynamic program is the Malmuth-Harville finish-order recursion
// with orderings that share the same prior finishers combined into one state.
// Probabilities use 50-decimal fixed-point BigInt arithmetic so the reference
// is much more precise than the binary64 LAQI values being measured.
function exactMalmuthHarvilleIcm(chipCounts, payouts) {
  const playerCount = chipCounts.length;
  const stateCount = 1 << playerCount;
  const totalChips = sum(chipCounts);
  const stackSums = new Float64Array(stateCount);
  const stateProbabilities = Array.from({ length: stateCount }, () => 0n);
  const equities = Array.from({ length: playerCount }, () => 0n);
  const ranks = new Uint8Array(stateCount);
  stateProbabilities[0] = EXACT_SCALE;

  for (let mask = 1; mask < stateCount; mask += 1) {
    const leastBit = mask & -mask;
    const playerIndex = 31 - Math.clz32(leastBit);
    const previousMask = mask ^ leastBit;
    stackSums[mask] = stackSums[previousMask] + chipCounts[playerIndex];
    ranks[mask] = ranks[previousMask] + 1;
  }

  for (let mask = 0; mask < stateCount - 1; mask += 1) {
    const rank = ranks[mask];
    const stateProbability = stateProbabilities[mask];
    const remainingChips = BigInt(totalChips - stackSums[mask]);

    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const playerBit = 1 << playerIndex;
      if (mask & playerBit) continue;

      const branchProbability = (
        stateProbability * BigInt(chipCounts[playerIndex])
      ) / remainingChips;
      equities[playerIndex] += branchProbability * BigInt(payouts[rank]);
      stateProbabilities[mask | playerBit] += branchProbability;
    }
  }

  const scaledPrizePool = BigInt(PRIZE_POOL) * EXACT_SCALE;
  const scaledEquitySum = equities.reduce((total, value) => total + value, 0n);
  return {
    values: equities.map((value) => Number(value) / EXACT_SCALE_NUMBER),
    scaledEquities: equities,
    prizePoolResidual: Number(scaledEquitySum - scaledPrizePool) / EXACT_SCALE_NUMBER,
  };
}

function directFinishOrderIcm(chipCounts, payouts) {
  const equities = Array.from({ length: chipCounts.length }, () => 0n);

  function recurse(remainingIndexes, remainingChips, rank, probability) {
    for (let offset = 0; offset < remainingIndexes.length; offset += 1) {
      const playerIndex = remainingIndexes[offset];
      const branchProbability = (
        probability * BigInt(chipCounts[playerIndex])
      ) / BigInt(remainingChips);
      equities[playerIndex] += branchProbability * BigInt(payouts[rank]);

      if (remainingIndexes.length > 1) {
        recurse(
          remainingIndexes.slice(0, offset).concat(remainingIndexes.slice(offset + 1)),
          remainingChips - chipCounts[playerIndex],
          rank + 1,
          branchProbability,
        );
      }
    }
  }

  recurse(
    Array.from({ length: chipCounts.length }, (_, index) => index),
    sum(chipCounts),
    0,
    EXACT_SCALE,
  );
  return equities;
}

function absBigInt(value) {
  return value < 0n ? -value : value;
}

function createErrorAccumulator() {
  return {
    comparisonCount: 0,
    sumSquaredDollarError: 0,
    maxAbsDollarError: 0,
    maxRelativeError: 0,
    worst: null,
  };
}

function addErrors(accumulator, approximate, exact, context) {
  for (let playerIndex = 0; playerIndex < exact.length; playerIndex += 1) {
    const dollarError = approximate[playerIndex] - exact[playerIndex];
    const absoluteDollarError = Math.abs(dollarError);
    const relativeError = absoluteDollarError / exact[playerIndex];
    accumulator.comparisonCount += 1;
    accumulator.sumSquaredDollarError += dollarError * dollarError;

    if (absoluteDollarError > accumulator.maxAbsDollarError) {
      accumulator.maxAbsDollarError = absoluteDollarError;
      accumulator.worst = {
        ...context,
        playerIndex: playerIndex + 1,
        exactValue: exact[playerIndex],
        approximateValue: approximate[playerIndex],
        dollarError,
        relativeError,
      };
    }
    accumulator.maxRelativeError = Math.max(accumulator.maxRelativeError, relativeError);
  }
}

function finishErrors(accumulator) {
  return {
    comparisonCount: accumulator.comparisonCount,
    maxAbsDollarError: accumulator.maxAbsDollarError,
    rootMeanSquareDollarError: Math.sqrt(
      accumulator.sumSquaredDollarError / accumulator.comparisonCount,
    ),
    maxRelativeError: accumulator.maxRelativeError,
    worst: accumulator.worst,
  };
}

function scientific(value, digits = 3) {
  return Number(value).toExponential(digits);
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const caseFamilies = Array.from(
  { length: CASES_PER_PLAYER_COUNT },
  (_, caseIndex) => buildCaseFamily(caseIndex),
);
const summaries = [];
let directCrossCheckMaxAbsDollarError = 0;

for (let playerCount = MIN_PLAYERS; playerCount <= MAX_PLAYERS; playerCount += 1) {
  const errors192 = createErrorAccumulator();
  const errors1536 = createErrorAccumulator();
  const differencesBetweenNodes = createErrorAccumulator();
  let exactRuntimeMs = 0;
  let laqi192RuntimeMs = 0;
  let laqi1536RuntimeMs = 0;
  let exactPrizePoolResidual = 0;

  for (let caseIndex = 0; caseIndex < caseFamilies.length; caseIndex += 1) {
    const family = caseFamilies[caseIndex];
    const chipCounts = family.stacks.slice(0, playerCount);
    const payouts = buildPayouts(
      playerCount,
      family.payoutExponent,
      family.payoutFloorWeight,
    );

    let startedAt = performance.now();
    const exactResult = exactMalmuthHarvilleIcm(chipCounts, payouts);
    const exact = exactResult.values;
    exactRuntimeMs += performance.now() - startedAt;

    if (caseIndex === 0 && playerCount <= 9) {
      const direct = directFinishOrderIcm(chipCounts, payouts);
      const maximumScaledDifference = direct.reduce(
        (maximum, value, index) => {
          const difference = absBigInt(value - exactResult.scaledEquities[index]);
          return difference > maximum ? difference : maximum;
        },
        0n,
      );
      directCrossCheckMaxAbsDollarError = Math.max(
        directCrossCheckMaxAbsDollarError,
        Number(maximumScaledDifference) / EXACT_SCALE_NUMBER,
      );
    }

    startedAt = performance.now();
    const laqi192 = solveLogAgeQuadratureIcm(chipCounts, payouts, {
      logAgeNodeCount: NODE_COUNTS[0],
      logAgePanelCount: PANEL_COUNT,
      tailTolerance: TAIL_TOLERANCE,
    }).players.map((player) => player.value);
    laqi192RuntimeMs += performance.now() - startedAt;

    startedAt = performance.now();
    const laqi1536 = solveLogAgeQuadratureIcm(chipCounts, payouts, {
      logAgeNodeCount: NODE_COUNTS[1],
      logAgePanelCount: PANEL_COUNT,
      tailTolerance: TAIL_TOLERANCE,
    }).players.map((player) => player.value);
    laqi1536RuntimeMs += performance.now() - startedAt;

    const context = {
      caseIndex,
      playerCount,
      chipCounts,
      payouts,
      stackSigma: family.stackSigma,
      payoutExponent: family.payoutExponent,
      payoutFloorWeight: family.payoutFloorWeight,
    };
    addErrors(errors192, laqi192, exact, context);
    addErrors(errors1536, laqi1536, exact, context);
    addErrors(differencesBetweenNodes, laqi192, laqi1536, context);
    exactPrizePoolResidual = Math.max(
      exactPrizePoolResidual,
      Math.abs(exactResult.prizePoolResidual),
    );
  }

  summaries.push({
    playerCount,
    cases: CASES_PER_PLAYER_COUNT,
    valuesCompared: CASES_PER_PLAYER_COUNT * playerCount,
    exactPrizePoolResidual,
    error192VsExact: finishErrors(errors192),
    error1536VsExact: finishErrors(errors1536),
    difference192Vs1536: finishErrors(differencesBetweenNodes),
    totalRuntimeMs: {
      exactSubsetDynamicProgram: exactRuntimeMs,
      laqi192: laqi192RuntimeMs,
      laqi1536: laqi1536RuntimeMs,
    },
  });

  console.log(`Completed ${playerCount} players (${CASES_PER_PLAYER_COUNT} cases).`);
}

const largeFieldFixture = JSON.parse(
  await readFile(
    new URL("../examples/wsop-2025-main-event-snapshot-522.json", import.meta.url),
    "utf8",
  ),
);
const largeFieldRuns = [];
for (const nodeCount of LARGE_FIELD_NODE_COUNTS) {
  const startedAt = performance.now();
  const result = solveLogAgeQuadratureIcm(
    largeFieldFixture.chipCounts,
    largeFieldFixture.payouts,
    {
      logAgeNodeCount: nodeCount,
      logAgePanelCount: PANEL_COUNT,
      tailTolerance: TAIL_TOLERANCE,
    },
  );
  largeFieldRuns.push({
    requestedNodes: nodeCount,
    actualNodes: result.metadata.quadratureNodes,
    runtimeMs: performance.now() - startedAt,
    values: result.players.map((player) => player.value),
  });
  console.log(`Completed 522-player run at ${nodeCount} nodes.`);
}

const largeFieldReference = largeFieldRuns.at(-1);
const largeFieldSelfConvergence = largeFieldRuns.map((run) => {
  const errors = createErrorAccumulator();
  addErrors(errors, run.values, largeFieldReference.values, {
    requestedNodes: run.requestedNodes,
    referenceNodes: largeFieldReference.requestedNodes,
  });
  return {
    requestedNodes: run.requestedNodes,
    actualNodes: run.actualNodes,
    runtimeMs: run.runtimeMs,
    comparisonTo6144: finishErrors(errors),
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  machine: {
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model || "unknown",
    logicalCpuCount: cpus().length,
    memoryBytes: totalmem(),
    nodeVersion: process.version,
    execution: "single Node.js process; no worker threads or GPU",
  },
  design: {
    playerRange: [MIN_PLAYERS, MAX_PLAYERS],
    casesPerPlayerCount: CASES_PER_PLAYER_COUNT,
    totalPlayerValuesCompared: sum(summaries.map((summary) => summary.valuesCompared)),
    prizePoolDollars: PRIZE_POOL,
    exactMethod: `Malmuth-Harville finish-order recursion aggregated by prior-finisher subset using ${EXACT_SCALE_DIGITS}-decimal fixed-point arithmetic`,
    stackCases: "one fixed realistic descending stack list plus seeded log-normal families with sigma 0.25 to 2.0",
    payoutCases: "positive descending power-law payout curves normalized to a $1,000,000 active prize pool",
    seed: BASE_SEED,
    laqi: {
      nodeCounts: NODE_COUNTS,
      panelCount: PANEL_COUNT,
      tailTolerance: TAIL_TOLERANCE,
    },
    directFinishOrderCrossCheckThroughPlayers: 9,
    directCrossCheckMaxAbsDollarError,
  },
  summaries,
  largeFieldSelfConvergence: {
    fixtureId: largeFieldFixture.id,
    players: largeFieldFixture.chipCounts.length,
    activePayoutRows: largeFieldFixture.payouts.length,
    activePrizePool: sum(largeFieldFixture.payouts),
    referenceNodes: largeFieldReference.actualNodes,
    note: "Self-convergence only; the 6,144-node result is not asserted to be an exact ICM reference.",
    runs: largeFieldSelfConvergence,
  },
};

const rows = summaries.map((summary) => [
  summary.playerCount,
  summary.valuesCompared.toLocaleString("en-US"),
  scientific(summary.error192VsExact.maxAbsDollarError),
  scientific(summary.error192VsExact.rootMeanSquareDollarError),
  scientific(summary.error192VsExact.maxRelativeError),
  scientific(summary.error1536VsExact.maxAbsDollarError),
  scientific(summary.error1536VsExact.maxRelativeError),
  scientific(summary.difference192Vs1536.maxAbsDollarError),
]);

const markdown = [
  "# LAQI Node-Count Accuracy Sweep",
  "",
  `Generated: ${output.generatedAt}`,
  "",
  `${CASES_PER_PLAYER_COUNT} deterministic cases were tested at each field size. Every case used positive stacks and a descending payout list normalized to a $1,000,000 active prize pool. Errors are the worst observed across all cases and players unless labeled RMSE.`,
  "",
  markdownTable(
    [
      "Players",
      "Values compared",
      "192 max abs ($)",
      "192 RMSE ($)",
      "192 max relative",
      "1536 max abs ($)",
      "1536 max relative",
      "192-1536 max abs ($)",
    ],
    rows,
  ),
  "",
  `The 50-decimal subset implementation was cross-checked against 50-decimal direct finish-order recursion through 9 players; maximum difference: ${scientific(directCrossCheckMaxAbsDollarError)} dollars.`,
  "",
  "## 522-Player Self-Convergence",
  "",
  "This is not an exact comparison. Each result is compared with the same fixture evaluated at 6,144 nodes.",
  "",
  markdownTable(
    ["Nodes", "Runtime (ms)", "Max abs vs 6144 ($)", "RMSE vs 6144 ($)", "Max relative vs 6144"],
    largeFieldSelfConvergence.map((run) => [
      run.actualNodes,
      run.runtimeMs.toFixed(3),
      scientific(run.comparisonTo6144.maxAbsDollarError),
      scientific(run.comparisonTo6144.rootMeanSquareDollarError),
      scientific(run.comparisonTo6144.maxRelativeError),
    ]),
  ),
  "",
].join("\n");

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./results/node_count_accuracy_sweep.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`,
);
await writeFile(
  new URL("./results/node_count_accuracy_sweep_tables.md", import.meta.url),
  markdown,
);
await writeFile(
  new URL(
    "./results/wsop_2025_main_event_522_node_convergence.json",
    import.meta.url,
  ),
  `${JSON.stringify({
    generatedAt: output.generatedAt,
    machine: output.machine,
    settings: {
      panelCount: PANEL_COUNT,
      tailTolerance: TAIL_TOLERANCE,
      requestedNodeCounts: LARGE_FIELD_NODE_COUNTS,
    },
    ...output.largeFieldSelfConvergence,
  }, null, 2)}\n`,
);

console.log(markdown);
