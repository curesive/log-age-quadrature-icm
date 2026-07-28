import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const JOB_RECORD_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function pathExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeAtomic(filePath, contents) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
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

async function writeJobRecord(record) {
  await writeAtomic(record.jobFile, `${JSON.stringify(record, null, 2)}\n`);
}

function jobPaths(ledgerPath) {
  const absoluteLedgerPath = path.resolve(ledgerPath);
  return {
    ledgerPath: absoluteLedgerPath,
    jobFile: `${absoluteLedgerPath}.job.json`,
    plistPath: `${absoluteLedgerPath}.launchd.plist`,
  };
}

function launchdTarget(label) {
  return `gui/${process.getuid()}/${label}`;
}

function parseLaunchctlPrint(output) {
  const state = output.match(/^\s*state = (.+)$/m)?.[1]?.trim() || "unknown";
  const pidText = output.match(/^\s*pid = (\d+)$/m)?.[1];
  const exitText = output.match(/^\s*last exit code = (-?\d+)$/m)?.[1];
  return {
    loaded: true,
    state,
    pid: pidText ? Number(pidText) : null,
    lastExitCode: exitText === undefined ? null : Number(exitText),
  };
}

export async function readManagedJobRecord(ledgerPath) {
  const { jobFile } = jobPaths(ledgerPath);
  try {
    const record = JSON.parse(await readFile(jobFile, "utf8"));
    return record?.version === JOB_RECORD_VERSION ? record : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function getLaunchdJobStatus(label) {
  if (!label) return { loaded: false, state: "not-managed", pid: null, lastExitCode: null };
  try {
    const { stdout } = await execFileAsync(
      "/bin/launchctl",
      ["print", launchdTarget(label)],
      { encoding: "utf8", maxBuffer: 2_000_000 },
    );
    return parseLaunchctlPrint(stdout);
  } catch (error) {
    if (error?.code === 113 || /Could not find service/i.test(error?.stderr || "")) {
      return { loaded: false, state: "not-loaded", pid: null, lastExitCode: null };
    }
    throw error;
  }
}

export async function getManagedJobStatus(ledgerPath) {
  const record = await readManagedJobRecord(ledgerPath);
  if (!record) {
    return {
      managed: false,
      loaded: false,
      state: "not-managed",
      pid: null,
      lastExitCode: null,
    };
  }
  const launchd = await getLaunchdJobStatus(record.label);
  return {
    managed: true,
    ...record,
    recordedStatus: record.status,
    ...launchd,
    status: launchd.pid ? "running" : launchd.loaded ? "loaded-inactive" : "not-loaded",
  };
}

function buildPlist({ label, programArguments, workingDirectory, logPath }) {
  const argumentsXml = programArguments
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>LaunchOnlyOnce</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

async function bootoutIfLoaded(record) {
  if (!record?.label) return;
  const status = await getLaunchdJobStatus(record.label);
  if (status.pid) {
    throw new Error(
      `A managed run is already active for this ledger (PID ${status.pid}, ${record.label}).`,
    );
  }
  if (status.loaded) {
    await execFileAsync("/bin/launchctl", ["bootout", launchdTarget(record.label)]).catch(
      (error) => {
        if (!/Could not find service/i.test(error?.stderr || "")) throw error;
      },
    );
  }
}

async function readSessionCount(ledgerPath) {
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    return Array.isArray(ledger.sessions) ? ledger.sessions.length : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function waitForManagedStart(record, previousSessionCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    lastStatus = await getLaunchdJobStatus(record.label);
    const sessionCount = await readSessionCount(record.ledgerPath);
    if (lastStatus.pid && sessionCount > previousSessionCount) {
      return lastStatus;
    }
    if (lastStatus.loaded && !lastStatus.pid && lastStatus.lastExitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let logTail = "";
  try {
    const log = await readFile(record.logPath, "utf8");
    logTail = log.slice(-4_000).trim();
  } catch {
    // The job may have failed before launchd created its output file.
  }
  throw new Error(
    `Managed run did not reach a running ledger session within ${timeoutMs / 1_000} seconds.` +
      (lastStatus ? ` launchd state=${lastStatus.state}, exit=${lastStatus.lastExitCode}.` : "") +
      (logTail ? `\n${logTail}` : ""),
  );
}

export async function startManagedRun({
  ledgerPath,
  cliPath,
  runArguments,
  workingDirectory,
  startupTimeoutMs = 20_000,
}) {
  if (process.platform !== "darwin") {
    throw new Error("The managed background launcher currently requires macOS launchd.");
  }
  const paths = jobPaths(ledgerPath);
  const previousRecord = await readManagedJobRecord(paths.ledgerPath);
  await bootoutIfLoaded(previousRecord);
  const previousSessionCount = await readSessionCount(paths.ledgerPath);
  const identity = createHash("sha256").update(paths.ledgerPath).digest("hex").slice(0, 12);
  const runId = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const label = `com.logage-quadrature-icm.monte-carlo.${identity}.${runId}`;
  const logPath = `${paths.ledgerPath}.launchd-${runId}.log`;
  const programArguments = [
    process.execPath,
    path.resolve(cliPath),
    "run",
    ...runArguments,
    "--quiet",
    "--prevent-sleep",
    "--managed-run",
  ];
  const record = {
    version: JOB_RECORD_VERSION,
    label,
    runId,
    status: "launching",
    createdAt: nowIso(),
    ledgerPath: paths.ledgerPath,
    jobFile: paths.jobFile,
    plistPath: paths.plistPath,
    logPath,
    workingDirectory: path.resolve(workingDirectory),
    programArguments,
    host: os.hostname(),
  };
  await writeAtomic(
    paths.plistPath,
    buildPlist({
      label,
      programArguments,
      workingDirectory: record.workingDirectory,
      logPath,
    }),
  );
  await writeJobRecord(record);
  try {
    await execFileAsync("/bin/launchctl", [
      "bootstrap",
      `gui/${process.getuid()}`,
      paths.plistPath,
    ]);
    const status = await waitForManagedStart(record, previousSessionCount, startupTimeoutMs);
    record.status = "running";
    record.startedAt = nowIso();
    record.pid = status.pid;
    await writeJobRecord(record);
    return { ...record, ...status };
  } catch (error) {
    const launchdStatus = await getLaunchdJobStatus(record.label).catch(() => null);
    if (launchdStatus?.loaded) {
      await execFileAsync("/bin/launchctl", [
        "bootout",
        launchdTarget(record.label),
      ]).catch(() => {});
    }
    record.status = "launch-failed";
    record.error = error instanceof Error ? error.message : String(error);
    await writeJobRecord(record).catch(() => {});
    throw error;
  }
}

async function latestLedgerSession(ledgerPath) {
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    return ledger.sessions?.at(-1) || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function stopManagedRun(ledgerPath, { timeoutMs = 60_000 } = {}) {
  const record = await readManagedJobRecord(ledgerPath);
  if (!record) throw new Error("This ledger has no managed background job record.");
  let status = await getLaunchdJobStatus(record.label);
  if (!status.pid) {
    return { stopped: false, reason: "not-running", record, status };
  }
  await execFileAsync("/bin/launchctl", [
    "kill",
    "SIGINT",
    launchdTarget(record.label),
  ]);
  const deadline = Date.now() + timeoutMs;
  let session = null;
  while (Date.now() < deadline) {
    session = await latestLedgerSession(record.ledgerPath);
    status = await getLaunchdJobStatus(record.label);
    if (session?.status !== "running" && !status.pid) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (session?.status === "running" || status.pid) {
    throw new Error("Managed run did not finish its graceful checkpoint before the stop timeout.");
  }
  if (status.loaded) {
    await execFileAsync("/bin/launchctl", ["bootout", launchdTarget(record.label)]).catch(
      () => {},
    );
  }
  record.status = "stopped";
  record.stoppedAt = nowIso();
  record.pid = null;
  await writeJobRecord(record);
  return { stopped: true, reason: "graceful-stop", record, status, session };
}

export async function removeManagedJobArtifacts(ledgerPath) {
  const paths = jobPaths(ledgerPath);
  const record = await readManagedJobRecord(ledgerPath);
  await bootoutIfLoaded(record);
  await Promise.all([
    pathExists(paths.jobFile) ? unlink(paths.jobFile) : Promise.resolve(),
    pathExists(paths.plistPath) ? unlink(paths.plistPath) : Promise.resolve(),
  ]);
}
