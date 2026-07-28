import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  getManagedJobStatus,
  removeManagedJobArtifacts,
  startManagedRun,
  stopManagedRun,
} from "../launchd.mjs";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const projectDirectory = path.resolve(path.dirname(cliPath), "..");

test("foreground CLI refuses to create a Codex-owned run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "laqi-codex-guard-test-"));
  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          cliPath,
          "run",
          "--ledger", path.join(directory, "guard.json"),
          "--chips", "[3,1]",
          "--payouts", "[100,0]",
          "--trials", "10",
          "--workers", "1",
        ],
        { env: { ...process.env, CODEX_THREAD_ID: "guard-test" } },
      ),
      (error) => /Foreground Monte Carlo runs are disabled inside Codex/.test(error.stderr),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "launchd owns a managed run independently and stops it gracefully",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "laqi-launchd-test-"));
    const ledgerPath = path.join(directory, "managed.json");
    try {
      const managed = await startManagedRun({
        ledgerPath,
        cliPath,
        workingDirectory: projectDirectory,
        runArguments: [
          "--ledger", ledgerPath,
          "--chips", "[3,1]",
          "--payouts", "[100,0]",
          "--minutes", "1",
          "--workers", "1",
          "--checkpoint-seconds", "0.2",
        ],
      });
      assert.ok(Number.isInteger(managed.pid) && managed.pid > 0);

      const { stdout } = await execFileAsync("/bin/ps", [
        "-p", String(managed.pid), "-o", "ppid=",
      ]);
      assert.equal(Number(stdout.trim()), 1);

      const live = await getManagedJobStatus(ledgerPath);
      assert.equal(live.managed, true);
      assert.equal(live.status, "running");
      assert.equal(live.pid, managed.pid);

      const stopped = await stopManagedRun(ledgerPath);
      assert.equal(stopped.stopped, true);
      assert.equal(stopped.session.status, "interrupted");
      assert.equal(stopped.session.stopReason, "requested");
      assert.ok(stopped.session.trials > 0);

      const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
      assert.equal(ledger.sessions.at(-1).status, "interrupted");
      const inactive = await getManagedJobStatus(ledgerPath);
      assert.equal(inactive.pid, null);
    } finally {
      await removeManagedJobArtifacts(ledgerPath).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
);
