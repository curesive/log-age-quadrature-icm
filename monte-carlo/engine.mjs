import { execFileSync, fork } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEDGER_FORMAT = "log-age-quadrature-monte-carlo-ledger";
const LEDGER_VERSION = 1;
const WORKER_PATH = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const MAX_WORKER_RESTARTS = 8;
export const DEFAULT_CHECKPOINT_INTERVAL_SECONDS = 60;

function nowIso() {
  return new Date().toISOString();
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function emptyMoments(playerCount) {
  return {
    trials: 0,
    means: Array.from({ length: playerCount }, () => 0),
    m2: Array.from({ length: playerCount }, () => 0),
  };
}

function assertSafePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function normalizeNumberList(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  return values.map((value, index) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`${label}[${index}] must be a finite number.`);
    }
    return number;
  });
}

export function normalizeScenario({ name, chipCounts, payouts } = {}) {
  const normalizedChips = normalizeNumberList(chipCounts, "chipCounts");
  if (normalizedChips.some((chips) => chips <= 0)) {
    throw new Error("chipCounts must contain only positive numbers.");
  }

  const normalizedPayouts = normalizeNumberList(payouts, "payouts");
  if (normalizedPayouts.some((payout) => payout < 0)) {
    throw new Error("payouts must contain only non-negative numbers.");
  }

  const activePayouts = normalizedPayouts
    .filter((payout) => payout > 0)
    .sort((left, right) => right - left)
    .slice(0, normalizedChips.length);
  if (activePayouts.length === 0) {
    throw new Error("payouts must contain at least one positive prize.");
  }
  if (activePayouts.some((payout) => !Number.isFinite(payout * payout))) {
    throw new Error("payouts are too large to accumulate finite variance statistics.");
  }

  const totalChips = sum(normalizedChips);
  const totalPrizePool = sum(activePayouts);
  if (!Number.isFinite(totalChips) || !Number.isFinite(totalPrizePool)) {
    throw new Error("chip and payout totals must be finite numbers.");
  }

  const identityInput = JSON.stringify({
    chipCounts: normalizedChips,
    payouts: activePayouts,
  });
  const id = createHash("sha256").update(identityInput).digest("hex");

  return {
    id,
    name: String(name || `scenario-${id.slice(0, 12)}`),
    chipCounts: normalizedChips,
    payouts: activePayouts,
    playerCount: normalizedChips.length,
    paidRankCount: activePayouts.length,
    totalChips,
    totalPrizePool,
  };
}

function readPerformanceCoreCount() {
  if (process.platform !== "darwin") return null;
  try {
    const output = execFileSync("/usr/sbin/sysctl", ["-n", "hw.perflevel0.logicalcpu"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const count = Number(output);
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

export function getSystemCapacity() {
  const logicalCpuCount = os.cpus().length || 1;
  const availableParallelism = os.availableParallelism?.() || logicalCpuCount;
  const maximumWorkers = Math.max(1, Math.min(logicalCpuCount, availableParallelism));
  const performanceCoreCount = readPerformanceCoreCount();
  const recommendedWorkers = Math.max(
    1,
    Math.min(
      maximumWorkers,
      performanceCoreCount || Math.max(1, maximumWorkers - 1),
    ),
  );
  return {
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuModel: os.cpus()[0]?.model || "unknown CPU",
    logicalCpuCount,
    availableParallelism,
    performanceCoreCount,
    maximumWorkers,
    recommendedWorkers,
  };
}

export function chooseChunkTrials(playerCount) {
  const sortingWork = Math.max(1, playerCount * Math.log2(Math.max(2, playerCount)));
  return Math.max(1, Math.min(100_000, Math.floor(5_000_000 / sortingWork)));
}

function createLedger(scenario, seed) {
  const timestamp = nowIso();
  return {
    format: LEDGER_FORMAT,
    version: LEDGER_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    scenario,
    random: {
      algorithm: "xoshiro128**",
      streamDerivation: "SHA-256(baseSeed:taskId)",
      baseSeed: seed || randomBytes(16).toString("hex"),
    },
    aggregate: emptyMoments(scenario.playerCount),
    nextTaskId: "0",
    sessions: [],
    results: [],
  };
}

function validateLedger(ledger, ledgerPath) {
  if (ledger?.format !== LEDGER_FORMAT || ledger?.version !== LEDGER_VERSION) {
    throw new Error(`${ledgerPath} is not a supported Monte Carlo ledger.`);
  }
  const playerCount = ledger.scenario?.playerCount;
  if (
    !Number.isInteger(playerCount) ||
    playerCount <= 0 ||
    ledger.aggregate?.means?.length !== playerCount ||
    ledger.aggregate?.m2?.length !== playerCount
  ) {
    throw new Error(`${ledgerPath} has invalid or incomplete aggregate statistics.`);
  }
  if (!/^\d+$/.test(String(ledger.nextTaskId))) {
    throw new Error(`${ledgerPath} has an invalid nextTaskId.`);
  }
  return ledger;
}

export async function readLedger(ledgerPath) {
  const absolutePath = path.resolve(ledgerPath);
  const contents = await readFile(absolutePath, "utf8");
  return validateLedger(JSON.parse(contents), absolutePath);
}

async function writeLedgerAtomic(ledgerPath, ledger) {
  const absolutePath = path.resolve(ledgerPath);
  const directory = path.dirname(absolutePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireLedgerLock(ledgerPath) {
  const absolutePath = path.resolve(ledgerPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const lockPath = `${absolutePath}.lock`;
  const token = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, token, createdAt: nowIso() })}\n`,
          "utf8",
        );
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        throw error;
      }
      return {
        async release() {
          await handle.close().catch(() => {});
          try {
            const current = JSON.parse(await readFile(lockPath, "utf8"));
            if (current.token === token) await unlink(lockPath);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing = null;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        // An unreadable lock is treated as stale.
      }
      if (existing && isProcessAlive(Number(existing.pid))) {
        throw new Error(
          `Ledger is already in use by process ${existing.pid} (lock: ${lockPath}).`,
        );
      }
      await unlink(lockPath).catch((unlinkError) => {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new Error(`Could not acquire ledger lock ${lockPath}.`);
}

async function cleanupStaleTemporaryLedgers(ledgerPath) {
  const absolutePath = path.resolve(ledgerPath);
  const directory = path.dirname(absolutePath);
  const prefix = `.${path.basename(absolutePath)}.`;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".tmp"))
      .map((entry) => unlink(path.join(directory, entry.name)).catch(() => {})),
  );
}

function mergeBatchMoments(target, batchTrials, sums, squareSums) {
  if (batchTrials <= 0) return;
  const previousTrials = target.trials;
  const combinedTrials = previousTrials + batchTrials;
  if (!Number.isSafeInteger(combinedTrials)) {
    throw new Error("The aggregate trial count exceeded Number.MAX_SAFE_INTEGER.");
  }

  for (let index = 0; index < target.means.length; index += 1) {
    const batchMean = sums[index] / batchTrials;
    const batchM2 = Math.max(
      0,
      squareSums[index] - ((sums[index] * sums[index]) / batchTrials),
    );
    if (previousTrials === 0) {
      target.means[index] = batchMean;
      target.m2[index] = batchM2;
      continue;
    }
    const delta = batchMean - target.means[index];
    target.means[index] += delta * (batchTrials / combinedTrials);
    target.m2[index] +=
      batchM2 + ((delta * delta * previousTrials * batchTrials) / combinedTrials);
  }
  target.trials = combinedTrials;
}

export function buildResults(ledger) {
  const { scenario, aggregate } = ledger;
  const trials = aggregate.trials;
  if (trials === 0) {
    return scenario.chipCounts.map((chips, index) => ({
      playerIndex: index + 1,
      chips,
      meanIcmValue: null,
      equityFraction: null,
      sampleStandardDeviation: null,
      standardError: null,
      margin95: null,
      ci95Low: null,
      ci95High: null,
    }));
  }

  return scenario.chipCounts.map((chips, index) => {
    const mean = aggregate.means[index];
    const variance = trials > 1 ? Math.max(0, aggregate.m2[index] / (trials - 1)) : 0;
    const sampleStandardDeviation = Math.sqrt(variance);
    const standardError = trials > 1 ? sampleStandardDeviation / Math.sqrt(trials) : null;
    const margin95 = standardError === null ? null : 1.96 * standardError;
    return {
      playerIndex: index + 1,
      chips,
      meanIcmValue: mean,
      equityFraction: mean / scenario.totalPrizePool,
      sampleStandardDeviation,
      standardError,
      margin95,
      ci95Low: margin95 === null ? null : mean - margin95,
      ci95High: margin95 === null ? null : mean + margin95,
    };
  });
}

function updateLedgerResults(ledger) {
  ledger.updatedAt = nowIso();
  ledger.results = buildResults(ledger);
}

function deriveSeedWords(baseSeed, taskId) {
  const digest = createHash("sha256")
    .update(`${baseSeed}:${taskId}`)
    .digest();
  return [0, 4, 8, 12].map((offset) => digest.readUInt32LE(offset));
}

async function loadOrCreateLedger({ ledgerPath, scenario, seed }) {
  try {
    const ledger = await readLedger(ledgerPath);
    if (scenario && ledger.scenario.id !== scenario.id) {
      throw new Error(
        `Scenario does not match ledger ${path.resolve(ledgerPath)}. ` +
          `Expected ${ledger.scenario.id}, received ${scenario.id}.`,
      );
    }
    if (seed !== undefined && String(seed) !== ledger.random.baseSeed) {
      throw new Error("A resumed run must use the ledger's existing seed.");
    }
    return { ledger, created: false };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!scenario) {
      throw new Error("chipCounts and payouts (or a scenario file) are required for a new ledger.");
    }
    return { ledger: createLedger(scenario, seed === undefined ? undefined : String(seed)), created: true };
  }
}

function recoverInterruptedSessions(ledger) {
  let recovered = false;
  for (const session of ledger.sessions) {
    if (session.status === "running") {
      session.status = "interrupted";
      session.stopReason = "unclean-shutdown";
      session.stoppedAt = ledger.updatedAt;
      recovered = true;
    }
  }
  return recovered;
}

function validateRunOptions({
  trials,
  minutes,
  workers,
  chunkTrials,
  checkpointIntervalSeconds,
  capacity,
}) {
  const hasTrials = trials !== undefined && trials !== null;
  const hasMinutes = minutes !== undefined && minutes !== null;
  if (hasTrials === hasMinutes) {
    throw new Error("Choose exactly one stop condition: trials or minutes.");
  }
  if (hasTrials) assertSafePositiveInteger(trials, "trials");
  if (hasMinutes && (!Number.isFinite(minutes) || minutes <= 0)) {
    throw new Error("minutes must be a positive number.");
  }
  if (
    hasMinutes &&
    !Number.isSafeInteger(Date.now() + Math.max(1, Math.round(minutes * 60_000)))
  ) {
    throw new Error("minutes is too large to represent a safe wall-clock deadline.");
  }
  assertSafePositiveInteger(workers, "workers");
  if (workers > capacity.maximumWorkers) {
    throw new Error(
      `workers cannot exceed this machine's ${capacity.maximumWorkers} logical CPUs.`,
    );
  }
  assertSafePositiveInteger(chunkTrials, "chunkTrials");
  if (!Number.isFinite(checkpointIntervalSeconds) || checkpointIntervalSeconds <= 0) {
    throw new Error("checkpointIntervalSeconds must be a positive number.");
  }
}

function createWorkerState(slot, coordinator, scenario) {
  const child = fork(WORKER_PATH, [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const state = {
    slot,
    child,
    ready: false,
    alive: true,
    expectedExit: false,
    busy: null,
  };

  const readyPromise = new Promise((resolve, reject) => {
    const readyTimeout = setTimeout(
      () => reject(new Error(`Worker ${slot + 1} did not become ready.`)),
      15_000,
    );
    child.on("message", (message) => {
      if (message?.type === "ready" && !state.ready) {
        child.send({ type: "initialize", scenario });
        return;
      }
      if (message?.type === "initialized" && !state.ready) {
        state.ready = true;
        clearTimeout(readyTimeout);
        resolve();
        return;
      }
      if (message?.type === "result" || message?.type === "task-error") {
        coordinator.enqueue(() => coordinator.handleMessage(state, message));
      }
    });
    child.once("error", (error) => {
      if (!state.ready) {
        clearTimeout(readyTimeout);
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      state.alive = false;
      if (!state.ready) {
        clearTimeout(readyTimeout);
        reject(new Error(`Worker ${slot + 1} exited during startup (${code ?? signal}).`));
      }
      coordinator.enqueue(() => coordinator.handleExit(state, code, signal));
    });
  });

  return { state, readyPromise };
}

export async function runMonteCarlo({
  ledgerPath,
  scenario: scenarioInput,
  seed,
  trials,
  minutes,
  workers: requestedWorkers,
  chunkTrials: requestedChunkTrials,
  checkpointIntervalSeconds: requestedCheckpointIntervalSeconds,
  signal,
  onStart,
  onProgress,
} = {}) {
  if (!ledgerPath) throw new Error("ledgerPath is required.");
  const capacity = getSystemCapacity();
  const scenario = scenarioInput ? normalizeScenario(scenarioInput) : null;
  const workers = requestedWorkers ?? capacity.recommendedWorkers;
  const playerCount = scenario?.playerCount || (await readLedger(ledgerPath)).scenario.playerCount;
  const chunkTrials = requestedChunkTrials ?? chooseChunkTrials(playerCount);
  const checkpointIntervalSeconds =
    requestedCheckpointIntervalSeconds ?? DEFAULT_CHECKPOINT_INTERVAL_SECONDS;
  validateRunOptions({
    trials,
    minutes,
    workers,
    chunkTrials,
    checkpointIntervalSeconds,
    capacity,
  });

  const lock = await acquireLedgerLock(ledgerPath);
  let workerStates = [];
  let abortListener = null;
  let activeLedger = null;
  let activeSession = null;
  try {
    await cleanupStaleTemporaryLedgers(ledgerPath);
    const loaded = await loadOrCreateLedger({ ledgerPath, scenario, seed });
    const ledger = loaded.ledger;
    activeLedger = ledger;
    if (trials !== undefined && !Number.isSafeInteger(ledger.aggregate.trials + trials)) {
      throw new Error(
        "The requested trials would make the ledger exceed Number.MAX_SAFE_INTEGER.",
      );
    }
    const recovered = recoverInterruptedSessions(ledger);
    if (loaded.created || recovered) {
      updateLedgerResults(ledger);
      await writeLedgerAtomic(ledgerPath, ledger);
    }

    let eventChain = Promise.resolve();
    let fatalError = null;
    let finishResolve;
    let finishReject;
    const finished = new Promise((resolve, reject) => {
      finishResolve = resolve;
      finishReject = reject;
    });

    const coordinator = {
      enqueue(action) {
        eventChain = eventChain.then(action).catch((error) => {
          if (!fatalError) {
            fatalError = error;
            finishReject(error);
          }
        });
      },
      async handleMessage() {},
      async handleExit() {},
    };

    const startingWorkers = Array.from({ length: workers }, (_, slot) =>
      createWorkerState(slot, coordinator, ledger.scenario),
    );
    workerStates = startingWorkers.map(({ state }) => state);
    await Promise.all(startingWorkers.map(({ readyPromise }) => readyPromise));

    const startedEpochMs = Date.now();
    const session = {
      sessionNumber: ledger.sessions.length + 1,
      sessionId: randomUUID(),
      status: "running",
      startedAt: new Date(startedEpochMs).toISOString(),
      stoppedAt: null,
      stopReason: null,
      goal: trials !== undefined
        ? { type: "trials", additionalTrials: trials }
        : { type: "time", minutes },
      workers,
      maximumWorkersOnHost: capacity.maximumWorkers,
      chunkTrials,
      checkpointIntervalSeconds,
      checkpointsWritten: 1,
      host: capacity,
      runtimeMs: 0,
      tasksCompleted: 0,
      workerRestarts: 0,
      ...emptyMoments(ledger.scenario.playerCount),
    };
    activeSession = session;
    ledger.sessions.push(session);
    updateLedgerResults(ledger);
    await writeLedgerAtomic(ledgerPath, ledger);

    const durationMs = minutes === undefined ? null : Math.max(1, Math.round(minutes * 60_000));
    if (durationMs !== null && !Number.isSafeInteger(startedEpochMs + durationMs)) {
      throw new Error("minutes is too large to represent a safe wall-clock deadline.");
    }
    const deadlineEpochMs = durationMs === null ? null : startedEpochMs + durationMs;
    let remainingToAssign = trials ?? null;
    let stopRequested = Boolean(signal?.aborted);
    let stopReason = stopRequested ? "requested" : null;
    let finishing = false;
    let restartCount = 0;
    let lastCheckpointEpochMs = Date.now();

    const hasBusyWorkers = () => workerStates.some((state) => state.alive && state.busy);
    const liveWorkerCount = () => workerStates.filter((state) => state.alive).length;

    async function checkpoint({ force = false } = {}) {
      session.runtimeMs = Date.now() - startedEpochMs;
      if (
        !force &&
        Date.now() - lastCheckpointEpochMs < checkpointIntervalSeconds * 1_000
      ) {
        return false;
      }
      session.checkpointsWritten += 1;
      updateLedgerResults(ledger);
      await writeLedgerAtomic(ledgerPath, ledger);
      lastCheckpointEpochMs = Date.now();
      return true;
    }

    async function reserveAndDispatch() {
      if (finishing || fatalError) return;
      if (deadlineEpochMs && Date.now() >= deadlineEpochMs) {
        stopRequested = true;
        stopReason ||= "time-limit";
      }

      const assignments = [];
      for (const state of workerStates) {
        if (!state.alive || !state.ready || state.busy || stopRequested) continue;
        if (remainingToAssign !== null && remainingToAssign <= 0) break;

        const trialLimit = remainingToAssign === null
          ? chunkTrials
          : Math.min(chunkTrials, remainingToAssign);
        const taskId = ledger.nextTaskId;
        ledger.nextTaskId = (BigInt(ledger.nextTaskId) + 1n).toString();
        if (remainingToAssign !== null) remainingToAssign -= trialLimit;
        const task = {
          taskId,
          seedWords: deriveSeedWords(ledger.random.baseSeed, taskId),
          trialLimit,
          deadlineEpochMs,
        };
        state.busy = { taskId, trialLimit };
        assignments.push({ state, task });
      }

      if (stopRequested && assignments.length > 0) {
        for (const { state, task } of assignments) {
          if (remainingToAssign !== null) remainingToAssign += task.trialLimit;
          state.busy = null;
        }
        assignments.length = 0;
      }
      if (assignments.length > 0) {
        for (const { state, task } of assignments) {
          if (!state.alive) {
            if (remainingToAssign !== null) remainingToAssign += task.trialLimit;
            state.busy = null;
            continue;
          }
          state.child.send({ type: "run", task });
        }
      }
      await maybeFinish();
    }

    async function maybeFinish() {
      if (finishing || fatalError) return;
      const trialGoalReached =
        remainingToAssign === 0 && session.trials === trials && !hasBusyWorkers();
      const stoppedAndDrained = stopRequested && !hasBusyWorkers();
      if (!trialGoalReached && !stoppedAndDrained) return;
      finishing = true;
      session.status = stopReason === "requested" ? "interrupted" : "completed";
      session.stopReason = stopReason || (trials !== undefined ? "trial-limit" : "time-limit");
      session.stoppedAt = nowIso();
      await checkpoint({ force: true });
      finishResolve();
    }

    coordinator.handleMessage = async (state, message) => {
      if (finishing || fatalError || !state.busy) return;
      if (message.taskId !== state.busy.taskId) {
        throw new Error(`Worker ${state.slot + 1} returned an unexpected task ID.`);
      }
      const assignment = state.busy;
      state.busy = null;
      if (message.type === "task-error") {
        if (remainingToAssign !== null) remainingToAssign += assignment.trialLimit;
        throw new Error(`Worker ${state.slot + 1} failed task ${message.taskId}: ${message.error}`);
      }

      const completedTrials = Number(message.completedTrials);
      if (
        !Number.isSafeInteger(completedTrials) ||
        completedTrials < 0 ||
        completedTrials > assignment.trialLimit
      ) {
        throw new Error(`Worker ${state.slot + 1} returned an invalid trial count.`);
      }
      if (remainingToAssign !== null && completedTrials !== assignment.trialLimit) {
        remainingToAssign += assignment.trialLimit - completedTrials;
      }
      mergeBatchMoments(session, completedTrials, message.sums, message.squareSums);
      mergeBatchMoments(ledger.aggregate, completedTrials, message.sums, message.squareSums);
      session.tasksCompleted += 1;
      const checkpointed = await checkpoint();
      onProgress?.({
        ledgerPath: path.resolve(ledgerPath),
        sessionTrials: session.trials,
        totalTrials: ledger.aggregate.trials,
        goalTrials: trials ?? null,
        elapsedMs: Date.now() - startedEpochMs,
        checkpointed,
      });
      await reserveAndDispatch();
    };

    coordinator.handleExit = async (state, code, exitSignal) => {
      if (state.expectedExit || finishing) return;
      const assignment = state.busy;
      state.busy = null;
      if (assignment && remainingToAssign !== null) {
        remainingToAssign += assignment.trialLimit;
      }
      if (stopRequested) {
        await maybeFinish();
        return;
      }
      restartCount += 1;
      session.workerRestarts = restartCount;
      if (restartCount > MAX_WORKER_RESTARTS || liveWorkerCount() === 0 && restartCount > workers) {
        throw new Error(
          `Worker ${state.slot + 1} exited unexpectedly (${code ?? exitSignal}); restart limit reached.`,
        );
      }
      const replacement = createWorkerState(state.slot, coordinator, ledger.scenario);
      const index = workerStates.indexOf(state);
      workerStates[index] = replacement.state;
      await replacement.readyPromise;
      await checkpoint({ force: true });
      await reserveAndDispatch();
    };

    abortListener = () => {
      stopRequested = true;
      stopReason = "requested";
      coordinator.enqueue(async () => {
        await maybeFinish();
      });
    };
    signal?.addEventListener("abort", abortListener, { once: true });

    onStart?.({
      created: loaded.created,
      ledgerPath: path.resolve(ledgerPath),
      scenario: ledger.scenario,
      capacity,
      workers,
      chunkTrials,
      checkpointIntervalSeconds,
      goal: session.goal,
      previousTrials: ledger.aggregate.trials,
    });
    await reserveAndDispatch();
    await finished;
    await eventChain;

    for (const state of workerStates) {
      if (!state.alive) continue;
      state.expectedExit = true;
      state.child.send({ type: "shutdown" });
    }

    return {
      ledger,
      ledgerPath: path.resolve(ledgerPath),
      session,
      capacity,
      created: loaded.created,
    };
  } catch (error) {
    for (const state of workerStates) {
      if (state.alive) {
        state.expectedExit = true;
        state.child.kill("SIGTERM");
      }
    }
    if (activeLedger && activeSession?.status === "running") {
      activeSession.status = "interrupted";
      activeSession.stopReason = "engine-error";
      activeSession.stoppedAt = nowIso();
      activeSession.error = error instanceof Error ? error.message : String(error);
      updateLedgerResults(activeLedger);
      await writeLedgerAtomic(ledgerPath, activeLedger).catch(() => {});
    }
    throw error;
  } finally {
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    await lock.release();
  }
}
