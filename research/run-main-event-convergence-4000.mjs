import { readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const fixtureUrl = new URL("./fixtures/wsop-2026-main-event-4000.json", import.meta.url);
const defaultOutputUrl = new URL(
  "./results/main_event_stress_4000_convergence.json",
  import.meta.url,
);
const outputFlagIndex = process.argv.indexOf("--output");
const outputTarget =
  outputFlagIndex >= 0 && process.argv[outputFlagIndex + 1]
    ? resolve(process.argv[outputFlagIndex + 1])
    : defaultOutputUrl;
const nodeCounts = [192, 384, 768, 1536];
const panelCount = 32;
const tailTolerance = 1e-12;

function compareValues(values, referenceValues) {
  let maxAbsDollarDifference = 0;
  let maxAbsPlayerIndex = 1;
  let maxRelativeDifference = 0;
  let squaredDifferenceSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    const absoluteDifference = Math.abs(values[index] - referenceValues[index]);
    const relativeDifference = referenceValues[index] === 0
      ? 0
      : absoluteDifference / Math.abs(referenceValues[index]);

    squaredDifferenceSum += absoluteDifference ** 2;
    if (absoluteDifference > maxAbsDollarDifference) {
      maxAbsDollarDifference = absoluteDifference;
      maxAbsPlayerIndex = index + 1;
    }
    maxRelativeDifference = Math.max(maxRelativeDifference, relativeDifference);
  }

  return {
    maxAbsDollarDifference,
    maxAbsPlayerIndex,
    rmseDollarDifference: Math.sqrt(squaredDifferenceSum / values.length),
    maxRelativeDifference,
  };
}

const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const heroIndex = fixture.chipCounts.indexOf(fixture.generation.heroStack);
if (heroIndex < 0) throw new Error("The fixture does not contain its Hero stack anchor.");

const measuredRuns = [];
for (const logAgeNodeCount of nodeCounts) {
  console.log(`Running ${logAgeNodeCount.toLocaleString("en-US")}-node full field...`);
  const startedAt = performance.now();
  const result = solveLogAgeQuadratureIcm(fixture.chipCounts, fixture.payouts, {
    logAgeNodeCount,
    logAgePanelCount: panelCount,
    tailTolerance,
  });
  measuredRuns.push({
    nodes: logAgeNodeCount,
    actualNodes: result.metadata.quadratureNodes,
    runtimeMs: performance.now() - startedAt,
    heroValue: result.players[heroIndex].value,
    values: result.players.map((player) => player.value),
  });
}

const referenceRun = measuredRuns.at(-1);
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
  settings: {
    requestedNodeCounts: nodeCounts,
    panelCount,
    tailTolerance,
  },
  fixtureId: fixture.id,
  players: fixture.chipCounts.length,
  paidRanks: fixture.payouts.length,
  heroIndex: heroIndex + 1,
  heroStack: fixture.chipCounts[heroIndex],
  referenceNodes: referenceRun.nodes,
  note: "Self-convergence comparison; 1536 nodes is not an exact reference.",
  runs: measuredRuns.map(({ values, ...run }) => ({
    ...run,
    heroDifferenceVs1536: run.heroValue - referenceRun.heroValue,
    ...compareValues(values, referenceRun.values),
  })),
};

await writeFile(outputTarget, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${outputTarget instanceof URL ? outputTarget.pathname : outputTarget}`);
