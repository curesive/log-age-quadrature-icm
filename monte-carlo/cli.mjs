#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildResults,
  getSystemCapacity,
  readLedger,
  runMonteCarlo,
} from "./engine.mjs";
import {
  getManagedJobStatus,
  startManagedRun,
  stopManagedRun,
} from "./launchd.mjs";

const CLI_PATH = fileURLToPath(import.meta.url);

const HELP = `Log-Age Quadrature ICM Monte Carlo engine

Commands:
  monte-carlo system
  monte-carlo start --ledger FILE (--trials N | --minutes N) [scenario options]
  monte-carlo run --ledger FILE (--trials N | --minutes N) [scenario options]
  monte-carlo status --ledger FILE [--json]
  monte-carlo stop --ledger FILE

New-ledger scenario options:
  --scenario FILE       JSON with chipCounts/playerChipCounts and payouts/payoutList
  --chips LIST          JSON array (recommended) or comma/space-separated values
  --payouts LIST        JSON array (recommended) or comma/space-separated values
  --name TEXT           Scenario label
  --seed TEXT           Base seed; fixed in the ledger after creation

Run options:
  --workers N|max       Parallel child processes (default: recommended CPU count)
  --chunk-trials N      Trials per worker work batch (default: automatic)
  --checkpoint-seconds N
                        Durable save interval (default: 60 seconds)
  --quiet               Suppress progress updates

Examples:
  node monte-carlo/cli.mjs system
  node monte-carlo/cli.mjs start --ledger runs/final-table.json \\
    --chips '[40000,30000,20000,10000]' --payouts '[6000,3000,1000,0]' \\
    --minutes 720 --workers 20
  node monte-carlo/cli.mjs run --ledger runs/final-table.json --minutes 60 --workers max
  node monte-carlo/cli.mjs status --ledger runs/final-table.json
  node monte-carlo/cli.mjs stop --ledger runs/final-table.json
`;

function parseArguments(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "run";
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const equalsIndex = token.indexOf("=");
    const key = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (equalsIndex !== -1) {
      options[key] = token.slice(equalsIndex + 1);
      continue;
    }
    if (
      key === "json" ||
      key === "quiet" ||
      key === "help" ||
      key === "prevent-sleep" ||
      key === "managed-run"
    ) {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${key} requires a value.`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function parseList(value, label) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${label} is not valid JSON: ${error.message}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${label} JSON must be an array.`);
    return parsed;
  }
  return text
    .split(/[\s,;|]+/)
    .filter(Boolean)
    .map((item) => Number(item.replaceAll("_", "").replace(/^\$/, "")));
}

function parsePositiveInteger(value, label) {
  if (value === undefined) return undefined;
  const number = Number(String(value).replaceAll("_", ""));
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return number;
}

function parsePositiveNumber(value, label) {
  if (value === undefined) return undefined;
  const number = Number(String(value).replaceAll("_", ""));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return number;
}

async function loadScenario(options) {
  let fileScenario = null;
  if (options.scenario) {
    const scenarioPath = path.resolve(options.scenario);
    fileScenario = JSON.parse(await readFile(scenarioPath, "utf8"));
  }
  const chipCounts = parseList(options.chips, "chips") ??
    fileScenario?.chipCounts ?? fileScenario?.playerChipCounts ??
    fileScenario?.remainingChipCounts;
  const payouts = parseList(options.payouts, "payouts") ??
    fileScenario?.payouts ?? fileScenario?.payoutList;
  if (!chipCounts && !payouts && !fileScenario) return null;
  return {
    name: options.name ?? fileScenario?.name ?? fileScenario?.label,
    chipCounts,
    payouts,
  };
}

function currency(value) {
  if (value === null) return "-";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function printCapacity(capacity) {
  console.log(`CPU: ${capacity.cpuModel}`);
  console.log(`Logical CPUs / maximum workers: ${capacity.maximumWorkers}`);
  if (capacity.performanceCoreCount) {
    console.log(`Performance cores / recommended workers: ${capacity.recommendedWorkers}`);
  } else {
    console.log(`Recommended workers: ${capacity.recommendedWorkers}`);
  }
  console.log(`Host: ${capacity.host} (${capacity.platform})`);
}

function printManagedStatus(managed) {
  if (!managed?.managed) {
    console.log("Managed service: none (foreground or legacy ledger)");
    return;
  }
  const state = managed.pid ? "running" : managed.loaded ? managed.state : "not loaded";
  console.log(`Managed service: ${state}${managed.pid ? ` (PID ${managed.pid})` : ""}`);
  console.log(`launchd label: ${managed.label}`);
  console.log(`Service log: ${managed.logPath}`);
}

function printLedger(ledger, ledgerPath, managed = null) {
  console.log(`Ledger: ${path.resolve(ledgerPath)}`);
  console.log(`Scenario: ${ledger.scenario.name}`);
  console.log(`Scenario ID: ${ledger.scenario.id}`);
  console.log(`Players: ${ledger.scenario.playerCount}; paid ranks: ${ledger.scenario.paidRankCount}`);
  console.log(`Completed trials: ${ledger.aggregate.trials.toLocaleString("en-US")}`);
  console.log(`Sessions: ${ledger.sessions.length}`);
  const latestSession = ledger.sessions.at(-1);
  if (latestSession) {
    console.log(
      `Latest session: ${latestSession.status} (${latestSession.stopReason || "in progress"})`,
    );
  }
  if (managed) printManagedStatus(managed);
  if (latestSession?.status === "running" && !managed?.pid) {
    console.log(
      "Warning: the ledger says running but no managed service is active; " +
      "the session is foreground or stale.",
    );
  }
  console.log("");
  console.log("Player  Chips              Mean ICM           Std. error        95% margin");
  const displayResults = buildResults(ledger).slice(0, 50);
  for (const result of displayResults) {
    console.log(
      `${String(result.playerIndex).padStart(6)}  ` +
      `${String(result.chips).padStart(17)}  ` +
      `${currency(result.meanIcmValue).padStart(17)}  ` +
      `${currency(result.standardError).padStart(17)}  ` +
      `${currency(result.margin95).padStart(17)}`,
    );
  }
  if (ledger.scenario.playerCount > displayResults.length) {
    console.log(`... ${ledger.scenario.playerCount - displayResults.length} more players are in the JSON ledger.`);
  }
}

function buildManagedRunArguments(options) {
  const argumentsList = ["--ledger", path.resolve(options.ledger)];
  const values = [
    ["scenario", options.scenario ? path.resolve(options.scenario) : undefined],
    ["chips", options.chips],
    ["payouts", options.payouts],
    ["name", options.name],
    ["seed", options.seed],
    ["trials", options.trials],
    ["minutes", options.minutes],
    ["workers", options.workers],
    ["chunk-trials", options["chunk-trials"]],
    ["checkpoint-seconds", options["checkpoint-seconds"]],
  ];
  for (const [name, value] of values) {
    if (value === undefined) continue;
    argumentsList.push(`--${name}`, String(value));
  }
  return argumentsList;
}

function startSleepGuard(enabled) {
  if (!enabled || process.platform !== "darwin") return null;
  const child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
  return child;
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (options.help || command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "system") {
    printCapacity(getSystemCapacity());
    return;
  }
  if (command === "status") {
    if (!options.ledger) throw new Error("status requires --ledger FILE.");
    const [ledger, managedService] = await Promise.all([
      readLedger(options.ledger),
      getManagedJobStatus(options.ledger),
    ]);
    if (options.json) console.log(JSON.stringify({ managedService, ledger }, null, 2));
    else printLedger(ledger, options.ledger, managedService);
    return;
  }
  if (command === "stop" || command === "pause") {
    if (!options.ledger) throw new Error(`${command} requires --ledger FILE.`);
    const result = await stopManagedRun(options.ledger);
    if (!result.stopped) {
      console.log("No managed run is currently active for this ledger.");
      return;
    }
    console.log(
      `Managed run paused cleanly after ${result.session.trials.toLocaleString("en-US")} ` +
      `session trials.`,
    );
    console.log(`Ledger: ${path.resolve(options.ledger)}`);
    return;
  }
  if (command === "start") {
    if (!options.ledger) throw new Error("start requires --ledger FILE.");
    if ((options.trials === undefined) === (options.minutes === undefined)) {
      throw new Error("start requires exactly one of --trials or --minutes.");
    }
    parsePositiveInteger(options.trials, "trials");
    parsePositiveNumber(options.minutes, "minutes");
    parsePositiveInteger(options["chunk-trials"], "chunk-trials");
    parsePositiveNumber(options["checkpoint-seconds"], "checkpoint-seconds");
    if (options.workers !== undefined && options.workers !== "max") {
      const parsedWorkers = parsePositiveInteger(options.workers, "workers");
      if (parsedWorkers > getSystemCapacity().maximumWorkers) {
        throw new Error(
          `workers cannot exceed this machine's ${getSystemCapacity().maximumWorkers} logical CPUs.`,
        );
      }
    }
    const suppliedScenario = await loadScenario(options);
    if (!suppliedScenario) {
      await readLedger(options.ledger).catch((error) => {
        if (error?.code === "ENOENT") {
          throw new Error("A new managed ledger requires --scenario or chip/payout inputs.");
        }
        throw error;
      });
    }
    const managed = await startManagedRun({
      ledgerPath: options.ledger,
      cliPath: CLI_PATH,
      runArguments: buildManagedRunArguments(options),
      workingDirectory: process.cwd(),
    });
    const ledger = await readLedger(options.ledger);
    console.log("Started an OS-managed Monte Carlo run independent of Codex.");
    printManagedStatus({ managed: true, ...managed });
    console.log(`Scenario: ${ledger.scenario.name}`);
    console.log(`Ledger: ${path.resolve(options.ledger)}`);
    console.log(
      `Checkpoint interval: ${ledger.sessions.at(-1).checkpointIntervalSeconds} seconds`,
    );
    return;
  }
  if (command !== "run") throw new Error(`Unknown command: ${command}`);
  if (!options.ledger) throw new Error("run requires --ledger FILE.");
  if (process.env.CODEX_THREAD_ID && !options["managed-run"]) {
    throw new Error(
      "Foreground Monte Carlo runs are disabled inside Codex because Codex can reclaim " +
      "long command sessions. Use the start command to launch an OS-managed run.",
    );
  }

  const capacity = getSystemCapacity();
  const workers = options.workers === "max"
    ? capacity.maximumWorkers
    : parsePositiveInteger(options.workers, "workers");
  const scenario = await loadScenario(options);
  const controller = new AbortController();
  const sleepGuard = startSleepGuard(options["prevent-sleep"]);
  let signalCount = 0;
  const requestStop = () => {
    signalCount += 1;
    if (signalCount === 1) {
      console.error("\nPause requested; finishing current checkpoint batches...");
      controller.abort();
    } else {
      console.error("\nSecond stop signal received; exiting immediately.");
      process.exit(130);
    }
  };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  let lastProgressAt = 0;
  try {
    const result = await runMonteCarlo({
      ledgerPath: options.ledger,
      scenario,
      seed: options.seed,
      trials: parsePositiveInteger(options.trials, "trials"),
      minutes: parsePositiveNumber(options.minutes, "minutes"),
      workers,
      chunkTrials: parsePositiveInteger(options["chunk-trials"], "chunk-trials"),
      checkpointIntervalSeconds: parsePositiveNumber(
        options["checkpoint-seconds"],
        "checkpoint-seconds",
      ),
      signal: controller.signal,
      onStart(info) {
        if (options.quiet) return;
        console.log(`${info.created ? "Created" : "Resuming"}: ${info.ledgerPath}`);
        console.log(`Scenario: ${info.scenario.name} (${info.scenario.playerCount} players)`);
        console.log(
          `Workers: ${info.workers}/${info.capacity.maximumWorkers}; ` +
          `work chunk: ${info.chunkTrials.toLocaleString("en-US")} trials; ` +
          `durable checkpoint: ${info.checkpointIntervalSeconds}s`,
        );
        console.log(`Prior trials: ${info.previousTrials.toLocaleString("en-US")}`);
      },
      onProgress(info) {
        if (options.quiet || Date.now() - lastProgressAt < 2_000) return;
        lastProgressAt = Date.now();
        const goal = info.goalTrials === null
          ? "time limit"
          : info.goalTrials.toLocaleString("en-US");
        process.stderr.write(
          `${info.checkpointed ? "checkpoint saved" : "progress"}: ` +
          `session ${info.sessionTrials.toLocaleString("en-US")}/${goal}; ` +
          `ledger ${info.totalTrials.toLocaleString("en-US")} trials\n`,
        );
      },
    });
    if (!options.quiet) {
      console.log("");
      console.log(
        `Session ${result.session.status}: ${result.session.trials.toLocaleString("en-US")} ` +
        `trials in ${(result.session.runtimeMs / 1_000).toFixed(3)} seconds.`,
      );
    }
    printLedger(result.ledger, result.ledgerPath);
  } finally {
    sleepGuard?.kill("SIGTERM");
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
}

main().catch((error) => {
  console.error(`Monte Carlo error: ${error.message}`);
  process.exitCode = 1;
});
