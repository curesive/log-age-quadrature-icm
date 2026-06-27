import { readFile, writeFile } from "node:fs/promises";
import {
  solveLogAgeQuadratureIcm,
} from "../src/log-age-quadrature-icm.js";

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatMoney(value) {
  return `$${Math.round(Number(value)).toLocaleString("en-US")}`;
}

function formatPercent(value, digits = 4) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatSignedMoney(value) {
  const rounded = Math.round(Number(value));
  const prefix = rounded >= 0 ? "+" : "-";
  return `${prefix}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

function activePayouts(payouts) {
  return payouts
    .map(Number)
    .filter((payout) => Number.isFinite(payout) && payout > 0)
    .sort((left, right) => right - left);
}

function exactMalmuthHarvilleIcm(chipCounts, payouts) {
  const stacks = chipCounts.map(Number);
  const prizes = activePayouts(payouts);
  const equities = Array.from({ length: stacks.length }, () => 0);
  const rankLimit = Math.min(stacks.length, prizes.length);

  function recurse(remainingIndexes, rank, probability) {
    if (rank >= rankLimit) {
      return;
    }

    const totalRemainingChips = remainingIndexes.reduce(
      (total, playerIndex) => total + stacks[playerIndex],
      0,
    );

    for (let offset = 0; offset < remainingIndexes.length; offset += 1) {
      const playerIndex = remainingIndexes[offset];
      const branchProbability = probability * (stacks[playerIndex] / totalRemainingChips);
      equities[playerIndex] += branchProbability * prizes[rank];

      if (rank + 1 < rankLimit) {
        const nextIndexes = remainingIndexes
          .slice(0, offset)
          .concat(remainingIndexes.slice(offset + 1));
        recurse(nextIndexes, rank + 1, branchProbability);
      }
    }
  }

  recurse(Array.from({ length: stacks.length }, (_, index) => index), 0, 1);
  return equities;
}

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function monteCarloSelectedPlayers({
  chipCounts,
  payouts,
  selectedIndexes,
  trials,
  seed,
}) {
  const stacks = chipCounts.map(Number);
  const prizes = activePayouts(payouts);
  const random = mulberry32(seed);
  const accumulators = selectedIndexes.map(() => ({
    sum: 0,
    sumSquares: 0,
  }));
  const times = new Float64Array(stacks.length);

  for (let trial = 0; trial < trials; trial += 1) {
    for (let playerIndex = 0; playerIndex < stacks.length; playerIndex += 1) {
      const u = Math.max(Number.MIN_VALUE, random());
      times[playerIndex] = -Math.log(u) / stacks[playerIndex];
    }

    for (let selectedOffset = 0; selectedOffset < selectedIndexes.length; selectedOffset += 1) {
      const targetIndex = selectedIndexes[selectedOffset];
      const targetTime = times[targetIndex];
      let playersAhead = 0;

      for (let playerIndex = 0; playerIndex < times.length; playerIndex += 1) {
        if (playerIndex !== targetIndex && times[playerIndex] < targetTime) {
          playersAhead += 1;
        }
      }

      const payout = prizes[playersAhead] || 0;
      accumulators[selectedOffset].sum += payout;
      accumulators[selectedOffset].sumSquares += payout * payout;
    }
  }

  return selectedIndexes.map((playerIndex, selectedOffset) => {
    const accumulator = accumulators[selectedOffset];
    const mean = accumulator.sum / trials;
    const sampleVariance = Math.max(
      0,
      (accumulator.sumSquares - ((accumulator.sum * accumulator.sum) / trials)) /
        Math.max(1, trials - 1),
    );
    const standardDeviation = Math.sqrt(sampleVariance);
    const standardError = standardDeviation / Math.sqrt(trials);
    const margin95 = 1.96 * standardError;

    return {
      playerIndex: playerIndex + 1,
      chips: stacks[playerIndex],
      mean,
      standardDeviation,
      standardError,
      ci95Low: mean - margin95,
      ci95High: mean + margin95,
      margin95,
      trials,
      seed,
    };
  });
}

function fullFieldRows(chipCounts, payouts, options = {}) {
  return solveLogAgeQuadratureIcm(chipCounts, payouts, options).players;
}

function selectedSeatIndexes(playerCount) {
  return [
    0,
    Math.floor((playerCount - 1) / 2),
    playerCount - 1,
  ];
}

async function loadExample(filePath) {
  return JSON.parse(await readFile(new URL(filePath, import.meta.url), "utf8"));
}

function toMarkdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const fourPlayer = {
  id: "four-player-golden",
  label: "4-player teaching example",
  chipCounts: [40000, 30000, 20000, 10000],
  payouts: [6000, 3000, 1000, 0],
};

const ninePlayer = {
  id: "nine-player-final-table",
  label: "9-player final table example",
  chipCounts: [
    1500000, 900000, 700000, 500000, 400000, 350000, 300000, 250000, 100000,
  ],
  payouts: [
    180000, 150000, 120000, 90000, 70000, 55000, 45000, 38000, 32000,
  ],
};

const smallExactScenarios = [fourPlayer, ninePlayer];

const empiricalExamples = [
  await loadExample("../examples/wsop-2025-main-event-day7-24.json"),
  await loadExample("../examples/wsop-2024-high-roller-day1-99.json"),
  await loadExample("../examples/wsop-2025-main-event-snapshot-522.json"),
];

const exactComparison = [];
for (const scenario of smallExactScenarios) {
  const exact = exactMalmuthHarvilleIcm(scenario.chipCounts, scenario.payouts);
  const logAge = fullFieldRows(scenario.chipCounts, scenario.payouts);
  const prizePool = sum(activePayouts(scenario.payouts));

  for (let index = 0; index < scenario.chipCounts.length; index += 1) {
    exactComparison.push({
      scenario: scenario.label,
      playerIndex: index + 1,
      chips: scenario.chipCounts[index],
      exactValue: exact[index],
      logAgeValue: logAge[index].value,
      dollarDiff: logAge[index].value - exact[index],
      poolDiffBps: ((logAge[index].value - exact[index]) / prizePool) * 10000,
    });
  }
}

const convergence = [];
for (const scenario of smallExactScenarios) {
  const exact = exactMalmuthHarvilleIcm(scenario.chipCounts, scenario.payouts);
  for (const requestedNodes of [48, 96, 128, 192, 384, 768]) {
    const result = solveLogAgeQuadratureIcm(
      scenario.chipCounts,
      scenario.payouts,
      { logAgeNodeCount: requestedNodes },
    );
    const errors = result.players.map((player, index) => player.value - exact[index]);
    convergence.push({
      scenario: scenario.label,
      requestedNodes,
      actualQuadratureNodes: result.metadata.quadratureNodes,
      maxAbsDollarError: Math.max(...errors.map((value) => Math.abs(value))),
      meanAbsDollarError: sum(errors.map((value) => Math.abs(value))) / errors.length,
      maxAbsEquityError: Math.max(
        ...errors.map((value) => Math.abs(value) / result.totalPrizePool),
      ),
    });
  }
}

const monteCarloScenarios = [
  {
    ...fourPlayer,
    selectedIndexes: [0, 3],
    trials: 200000,
    seed: 4104,
  },
  {
    ...ninePlayer,
    selectedIndexes: [0, 4, 8],
    trials: 200000,
    seed: 4109,
  },
  ...empiricalExamples.map((example, index) => ({
    id: example.id,
    label: example.label,
    chipCounts: example.chipCounts,
    payouts: example.payouts,
    selectedIndexes: selectedSeatIndexes(example.chipCounts.length),
    trials: index === 0 ? 1000000 : index === 1 ? 300000 : 500000,
    seed: 8001 + index,
  })),
];

const monteCarloComparison = [];
for (const scenario of monteCarloScenarios) {
  const logAgeRows = fullFieldRows(scenario.chipCounts, scenario.payouts);
  const mcRows = monteCarloSelectedPlayers(scenario);

  for (const mcRow of mcRows) {
    const logAgeRow = logAgeRows[mcRow.playerIndex - 1];
    monteCarloComparison.push({
      scenario: scenario.label,
      playerIndex: mcRow.playerIndex,
      chips: mcRow.chips,
      logAgeValue: logAgeRow.value,
      monteCarloMean: mcRow.mean,
      ci95Low: mcRow.ci95Low,
      ci95High: mcRow.ci95High,
      margin95: mcRow.margin95,
      trials: mcRow.trials,
      seed: mcRow.seed,
      logAgeInsideCi:
        logAgeRow.value >= mcRow.ci95Low && logAgeRow.value <= mcRow.ci95High,
    });
  }
}

const empiricalSummary = [];
for (const example of empiricalExamples) {
  const result = solveLogAgeQuadratureIcm(example.chipCounts, example.payouts);
  const seats = selectedSeatIndexes(example.chipCounts.length);

  empiricalSummary.push({
    scenario: example.label,
    players: example.chipCounts.length,
    payoutRows: example.payouts.length,
    prizePool: result.totalPrizePool,
    quadratureNodes: result.metadata.quadratureNodes,
    selectedPlayers: seats.map((index) => ({
      playerIndex: index + 1,
      chips: example.chipCounts[index],
      value: result.players[index].value,
      equity: result.players[index].equity,
    })),
    equitySum: result.metadata.normalizedEquitySum,
  });
}

const exactRowsForPaper = exactComparison
  .filter((row) =>
    row.scenario === fourPlayer.label ||
    [1, 5, 9].includes(row.playerIndex)
  )
  .map((row) => [
    row.scenario,
    row.playerIndex,
    row.chips.toLocaleString("en-US"),
    formatMoney(row.exactValue),
    formatMoney(row.logAgeValue),
    formatSignedMoney(row.dollarDiff),
  ]);

const convergenceRowsForPaper = convergence
  .filter((row) => row.scenario === ninePlayer.label)
  .map((row) => [
    row.requestedNodes,
    row.actualQuadratureNodes,
    formatMoney(row.maxAbsDollarError),
    formatMoney(row.meanAbsDollarError),
    `${row.maxAbsEquityError.toExponential(3)}`,
  ]);

const monteCarloRowsForPaper = monteCarloComparison.map((row) => [
  row.scenario,
  row.playerIndex,
  row.trials.toLocaleString("en-US"),
  formatMoney(row.logAgeValue),
  formatMoney(row.monteCarloMean),
  `${formatMoney(row.ci95Low)} to ${formatMoney(row.ci95High)}`,
  row.logAgeInsideCi ? "yes" : "no",
]);

const empiricalRowsForPaper = empiricalSummary.flatMap((scenario) =>
  scenario.selectedPlayers.map((player) => [
    scenario.scenario,
    `${player.playerIndex} / ${scenario.players}`,
    player.chips.toLocaleString("en-US"),
    formatMoney(player.value),
    formatPercent(player.equity, 3),
  ]),
);

const results = {
  generatedAt: new Date().toISOString(),
  method: {
    logAgeNodeCount: 192,
    logAgePanelCount: 32,
    exactMethod: "recursive Malmuth-Harville / Plackett-Luce enumeration for small fields",
    monteCarloMethod:
      "seeded exponential-race simulation with 95% normal confidence intervals",
  },
  exactComparison,
  convergence,
  monteCarloComparison,
  empiricalSummary,
};

const tablesMarkdown = [
  "# Log-Age Quadrature ICM Paper Result Tables",
  "",
  `Generated at: ${results.generatedAt}`,
  "",
  "## Exact Small-Field Comparison",
  "",
  toMarkdownTable(
    ["Scenario", "Seat", "Chips", "Exact MH", "Log-Age 192", "Difference"],
    exactRowsForPaper,
  ),
  "",
  "## 9-Player Quadrature Convergence",
  "",
  toMarkdownTable(
    ["Requested nodes", "Actual nodes", "Max abs error", "Mean abs error", "Max equity error"],
    convergenceRowsForPaper,
  ),
  "",
  "## Monte Carlo Comparison",
  "",
  toMarkdownTable(
    ["Scenario", "Seat", "Trials", "Log-Age", "MC mean", "95% CI", "Inside CI?"],
    monteCarloRowsForPaper,
  ),
  "",
  "## Empirical Example Values",
  "",
  toMarkdownTable(
    ["Scenario", "Seat", "Chips", "Log-Age ICM value", "Equity"],
    empiricalRowsForPaper,
  ),
  "",
].join("\n");

await writeFile(
  new URL("./results/log_age_quadrature_icm_paper_results.json", import.meta.url),
  `${JSON.stringify(results, null, 2)}\n`,
);

await writeFile(
  new URL("./results/log_age_quadrature_icm_paper_tables.md", import.meta.url),
  tablesMarkdown,
);

console.log("Wrote research/results/log_age_quadrature_icm_paper_results.json");
console.log("Wrote research/results/log_age_quadrature_icm_paper_tables.md");
