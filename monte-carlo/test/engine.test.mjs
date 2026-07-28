import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildResults,
  getSystemCapacity,
  normalizeScenario,
  readLedger,
  runMonteCarlo,
} from "../engine.mjs";

const fourPlayer = {
  name: "Four-player test",
  chipCounts: [40_000, 30_000, 20_000, 10_000],
  payouts: [6_000, 3_000, 1_000, 0],
};

async function withTemporaryDirectory(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "laqi-mc-test-"));
  try {
    return await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("normalizes standard chip and payout lists consistently", () => {
  const scenario = normalizeScenario({
    chipCounts: [40, 30, 20, 10],
    payouts: [500, 6_000, 3_000, 1_000, 400, 0],
  });
  assert.deepEqual(scenario.chipCounts, [40, 30, 20, 10]);
  assert.deepEqual(scenario.payouts, [6_000, 3_000, 1_000, 500]);
  assert.equal(scenario.totalPrizePool, 10_500);
  assert.equal(scenario.paidRankCount, 4);
  assert.equal(scenario.id.length, 64);
});

test("reports a usable worker ceiling and recommendation", () => {
  const capacity = getSystemCapacity();
  assert.ok(capacity.maximumWorkers >= 1);
  assert.ok(capacity.recommendedWorkers >= 1);
  assert.ok(capacity.recommendedWorkers <= capacity.maximumWorkers);
  assert.ok(capacity.maximumWorkers <= capacity.logicalCpuCount);
});

test("runs an exact trial target, checkpoints it, and resumes into one aggregate", async () => {
  await withTemporaryDirectory(async (directory) => {
    const ledgerPath = path.join(directory, "resume-ledger.json");
    const first = await runMonteCarlo({
      ledgerPath,
      scenario: fourPlayer,
      seed: "resume-test-seed",
      trials: 4_000,
      workers: 2,
      chunkTrials: 400,
    });
    assert.equal(first.session.trials, 4_000);
    assert.equal(first.session.status, "completed");
    assert.equal(first.session.stopReason, "trial-limit");
    assert.equal(first.session.checkpointsWritten, 2);

    const second = await runMonteCarlo({
      ledgerPath,
      trials: 1_500,
      workers: 3,
      chunkTrials: 250,
    });
    assert.equal(second.session.trials, 1_500);

    const ledger = await readLedger(ledgerPath);
    assert.equal(ledger.aggregate.trials, 5_500);
    assert.equal(ledger.sessions.length, 2);
    assert.deepEqual(ledger.sessions.map((session) => session.trials), [4_000, 1_500]);
    assert.ok(ledger.sessions.every((session) => session.status === "completed"));
    assert.ok(!await fileExists(`${ledgerPath}.lock`));

    const results = buildResults(ledger);
    const meanSum = results.reduce((total, player) => total + player.meanIcmValue, 0);
    assert.ok(Math.abs(meanSum - fourPlayer.payouts.reduce((a, b) => a + b, 0)) < 1e-8);
    assert.ok(results.every((player) => Number.isFinite(player.standardError)));
  });
});

test("reproduces task-stream results across worker counts within floating precision", async () => {
  await withTemporaryDirectory(async (directory) => {
    const common = {
      scenario: fourPlayer,
      seed: "parallel-reproducibility-seed",
      trials: 3_000,
      chunkTrials: 300,
    };
    const single = await runMonteCarlo({
      ...common,
      ledgerPath: path.join(directory, "single.json"),
      workers: 1,
    });
    const parallel = await runMonteCarlo({
      ...common,
      ledgerPath: path.join(directory, "parallel.json"),
      workers: Math.min(3, getSystemCapacity().maximumWorkers),
    });
    assertArraysClose(parallel.ledger.aggregate.means, single.ledger.aggregate.means);
    assertArraysClose(parallel.ledger.aggregate.m2, single.ledger.aggregate.m2);
  });
});

test("matches a two-player analytic ICM result within Monte Carlo error", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await runMonteCarlo({
      ledgerPath: path.join(directory, "analytic.json"),
      scenario: {
        chipCounts: [3, 1],
        payouts: [100, 0],
      },
      seed: "analytic-distribution-seed",
      trials: 50_000,
      workers: Math.min(2, getSystemCapacity().maximumWorkers),
      chunkTrials: 5_000,
    });
    const players = buildResults(result.ledger);
    assert.ok(Math.abs(players[0].meanIcmValue - 75) < 1);
    assert.ok(Math.abs(players[1].meanIcmValue - 25) < 1);
  });
});

test("stops a time-limited run and records the time-limit reason", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await runMonteCarlo({
      ledgerPath: path.join(directory, "timed.json"),
      scenario: fourPlayer,
      seed: "time-test-seed",
      minutes: 0.002,
      workers: 1,
      chunkTrials: 100_000,
    });
    assert.equal(result.session.status, "completed");
    assert.equal(result.session.stopReason, "time-limit");
    assert.ok(result.session.trials > 0);
    assert.equal(result.ledger.aggregate.trials, result.session.trials);
  });
});

test("a requested pause saves completed chunks and marks the session interrupted", async () => {
  await withTemporaryDirectory(async (directory) => {
    const controller = new AbortController();
    const ledgerPath = path.join(directory, "paused.json");
    let durableTrialsSeenBeforePause = null;
    const result = await runMonteCarlo({
      ledgerPath,
      scenario: fourPlayer,
      seed: "pause-test-seed",
      trials: 10_000,
      workers: 1,
      chunkTrials: 250,
      signal: controller.signal,
      onProgress() {
        durableTrialsSeenBeforePause = JSON.parse(
          readFileSync(ledgerPath, "utf8"),
        ).aggregate.trials;
        controller.abort();
      },
    });
    assert.equal(result.session.status, "interrupted");
    assert.equal(result.session.stopReason, "requested");
    assert.equal(result.session.trials, 250);
    assert.equal(result.ledger.aggregate.trials, 250);
    assert.equal(durableTrialsSeenBeforePause, 0);
    assert.equal(result.session.checkpointsWritten, 2);
  });
});

test("recovers a stale running session without losing checkpointed work", async () => {
  await withTemporaryDirectory(async (directory) => {
    const ledgerPath = path.join(directory, "recovery.json");
    await runMonteCarlo({
      ledgerPath,
      scenario: fourPlayer,
      seed: "recovery-test-seed",
      trials: 1_000,
      workers: 1,
      chunkTrials: 250,
    });
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.sessions[0].status = "running";
    ledger.sessions[0].stopReason = null;
    ledger.sessions[0].stoppedAt = null;
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    await writeFile(
      `${ledgerPath}.lock`,
      `${JSON.stringify({ pid: 999_999_999, token: "stale", createdAt: new Date().toISOString() })}\n`,
    );
    const staleTemporaryPath = path.join(
      directory,
      ".recovery.json.999999999.abandoned.tmp",
    );
    await writeFile(staleTemporaryPath, "incomplete checkpoint");

    const resumed = await runMonteCarlo({
      ledgerPath,
      trials: 500,
      workers: 1,
      chunkTrials: 100,
    });
    assert.equal(resumed.ledger.aggregate.trials, 1_500);
    assert.equal(resumed.ledger.sessions[0].status, "interrupted");
    assert.equal(resumed.ledger.sessions[0].stopReason, "unclean-shutdown");
    assert.equal(resumed.ledger.sessions[1].status, "completed");
    assert.equal(await fileExists(staleTemporaryPath), false);
  });
});

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertArraysClose(actual, expected, relativeTolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    const scale = Math.max(1, Math.abs(actual[index]), Math.abs(expected[index]));
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= relativeTolerance * scale,
      `array values differ at ${index}: ${actual[index]} vs ${expected[index]}`,
    );
  }
}
