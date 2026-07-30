import { readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";

const fixtureUrl = new URL(
  "./fixtures/wsop-2026-main-event-4000.json",
  import.meta.url,
);
const outputUrl = new URL(
  "./results/main_event_stress_4000_convergence_timing.json",
  import.meta.url,
);
const nodeCounts = [192, 384, 768, 1536];
const panelCount = 32;
const tailTolerance = 1e-12;
const warmups = 1;
const samples = 5;

function summarize(timesMs) {
  const ordered = [...timesMs].sort((left, right) => left - right);
  return {
    medianMs: ordered[Math.floor(ordered.length / 2)],
    meanMs: timesMs.reduce((total, value) => total + value, 0) / timesMs.length,
    minMs: ordered[0],
    maxMs: ordered.at(-1),
    timesMs,
  };
}

const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const runs = [];

for (const logAgeNodeCount of nodeCounts) {
  const options = {
    logAgeNodeCount,
    logAgePanelCount: panelCount,
    tailTolerance,
  };

  console.log(
    `Benchmarking ${logAgeNodeCount.toLocaleString("en-US")} nodes: warm-up`,
  );
  for (let index = 0; index < warmups; index += 1) {
    solveLogAgeQuadratureIcm(fixture.chipCounts, fixture.payouts, options);
  }

  const timesMs = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    solveLogAgeQuadratureIcm(fixture.chipCounts, fixture.payouts, options);
    timesMs.push(performance.now() - startedAt);
    console.log(
      `Benchmarking ${logAgeNodeCount.toLocaleString("en-US")} nodes: measurement ${index + 1}/${samples}`,
    );
  }

  runs.push({
    nodes: logAgeNodeCount,
    ...summarize(timesMs),
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  benchmark:
    "4,000-player full-field LAQI runtime scaling across quadrature node counts",
  fixtureId: fixture.id,
  players: fixture.chipCounts.length,
  paidRanks: fixture.payouts.length,
  settings: {
    nodeCounts,
    panelCount,
    tailTolerance,
    warmups,
    samples,
    timingBasis: "median of five measurements after one warm-up at each node count",
  },
  runs,
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

await writeFile(outputUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: outputUrl.pathname, runs }, null, 2));
