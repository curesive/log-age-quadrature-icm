# Resumable Parallel Monte Carlo ICM

This engine runs exact ICM Monte Carlo trials in parallel child processes. It is intended for very long jobs that need to pause, checkpoint, and resume without keeping individual trial records in memory or on disk.

## Worker Capacity

The engine detects the current machine's available logical CPUs and, on Apple
Silicon, its performance-core count. The logical CPU count is the maximum
accepted worker count; the performance-core count is used as the default when
available. Use `--workers max` to select every detected logical CPU, or set any
integer from 1 through the reported maximum.

Check the detected values at any time:

```sh
npm run monte-carlo -- system
```

The controller itself is lightweight. Each configured worker is a separate Node process, so trials execute in true parallel across CPU cores rather than competing inside one JavaScript event loop.

## Start a Persistent Background Run

Use `start` for long runs and for every run launched through Codex. `start` submits a named macOS `launchd` service whose parent is PID 1, not Codex or the invoking terminal. Closing Codex, ending a Codex turn, closing the terminal, or hitting Codex's command-session lifetime cannot terminate that service.

The managed service also starts a macOS idle-sleep assertion for exactly the lifetime of the controller. Natural completion or a graceful `stop` releases it automatically.

Twelve-hour 522-player example:

```sh
npm run monte-carlo -- start \
  --ledger monte-carlo/runs/wsop-2025-main-event-snapshot-522.json \
  --scenario examples/wsop-2025-main-event-snapshot-522.json \
  --minutes 720 \
  --workers 8
```

`start` returns after macOS `launchd` has started the controller and the new
ledger session is visible. The process continues independently in the
background. The persistent `start`, `stop`, and `pause` commands require macOS;
the foreground `run`, `status`, engine API, and tests are portable Node.js.

This protects against Codex and terminal cleanup, but no user process can be literally unkillable. Logging out, rebooting, powering off, manually killing the service, or an OS/hardware failure can still stop it. The atomic ledger limits lost work to the configured checkpoint interval and can be resumed afterward.

## Start a Trial-Limited Run

From the project root:

```sh
npm run monte-carlo -- start \
  --ledger monte-carlo/runs/four-player.json \
  --scenario monte-carlo/examples/four-player.json \
  --trials 1000000 \
  --workers 20
```

You can provide lists directly instead of a scenario file. JSON arrays are recommended because they are unambiguous:

```sh
npm run monte-carlo -- start \
  --ledger monte-carlo/runs/final-table.json \
  --name "Final table" \
  --chips '[1500000,900000,700000,500000,400000,350000,300000,250000,100000]' \
  --payouts '[180000,150000,120000,90000,70000,55000,45000,38000,32000]' \
  --trials 10000000 \
  --workers 20
```

`--trials` always means additional trials for this invocation. The run stops only after that exact number has been merged into the ledger.

## Start a Time-Limited Run

```sh
npm run monte-carlo -- start \
  --ledger monte-carlo/runs/final-table.json \
  --scenario my-scenario.json \
  --minutes 120 \
  --workers max
```

The timer begins after all workers are ready. Workers check the deadline inside their current batch, return their partial batch, and the controller saves the combined result. Small scheduling and checkpoint overhead can put the recorded wall time slightly past the requested duration.

Choose exactly one of `--trials` or `--minutes`.

## Resume the Same Scenario

After the ledger exists, omit the chip and payout inputs. The immutable scenario and random base seed come from the ledger:

```sh
npm run monte-carlo -- start \
  --ledger monte-carlo/runs/final-table.json \
  --trials 50000000 \
  --workers 24
```

Each invocation adds a session to `sessions` and adds its statistics to `aggregate`. You may change the worker count, stop mode, work-batch size, and checkpoint interval between sessions. If scenario inputs are supplied again, their normalized scenario hash must match the existing ledger.

## Pause and Inspect

Pause a managed run from any later Codex turn or terminal:

```sh
npm run monte-carlo -- stop --ledger monte-carlo/runs/final-table.json
```

`stop` sends `SIGINT` through `launchd`, lets active worker batches finish, forces a final atomic checkpoint, marks the session `interrupted`, and unloads the service. `pause` is an alias for `stop`.

For a foreground `run`, press `Ctrl-C` once for the same clean pause behavior. Pressing it twice forces an immediate exit; the previous durable checkpoint remains usable.

Inspect a ledger:

```sh
npm run monte-carlo -- status --ledger monte-carlo/runs/final-table.json
npm run monte-carlo -- status --ledger monte-carlo/runs/final-table.json --json
```

Status also reports the managed service PID, `launchd` label, and service log path. The ledger includes:

- The normalized chip counts, active payouts, and a SHA-256 scenario identity.
- A fixed random base seed and monotonically allocated task-stream IDs.
- Total completed trials, running means, and stable variance accumulators.
- Per-player mean ICM value, equity fraction, standard error, and 95% interval.
- A session ledger with worker count, goal, runtime, completed trials, and stop reason.

Writes use a temporary file, disk synchronization, and atomic rename. A sidecar `.lock` file prevents concurrent writers. If the controller or computer stops unexpectedly, the next invocation removes the dead-process lock and any abandoned temporary checkpoint, marks the prior session `interrupted`, and resumes from the last completed checkpoint.

## Checkpoint and Disk-Write Policy

Worker results are merged in memory continuously, but durable ledger writes are time-based. The default is one save every 60 seconds, plus forced saves at session start, graceful pause, natural completion, engine error, and worker restart:

```sh
--checkpoint-seconds 60
```

An abrupt process or power loss can discard at most approximately one checkpoint interval of trials. Increase the interval to reduce writes further, or decrease it when a smaller recovery window matters more.

Checkpoint traffic is approximately the serialized ledger size multiplied by
the number of checkpoints. The completed 522-player ledger is about 346 KiB,
so a 12-hour run at the 60-second default writes roughly 250 MB in total. The
earlier per-batch design could project toward hundreds of gigabytes over the
same run; it is no longer used.

## Inputs and Calculation

Scenario files accept either naming convention:

```json
{
  "name": "Example",
  "chipCounts": [40000, 30000, 20000, 10000],
  "payouts": [6000, 3000, 1000, 0]
}
```

`playerChipCounts`/`payoutList` are also accepted. Chip counts must be positive finite numbers. Payouts must be non-negative; positive rows are sorted from largest to smallest and only the first `playerCount` rows are active, matching the deterministic solver's standard input behavior.

Each trial samples the equivalent independent exponential race with chip counts as rates. Sorting those finish times produces the ICM elimination order, and payouts are awarded by rank. A worker combines its trials before sending them to the controller. The controller uses parallel-moment merging, so numerical variance remains stable over long resumed runs and the ledger never grows per trial.

Work-batch size controls scheduling and clean-stop latency, not durable-save frequency. The automatic size scales down for larger fields. Override it when needed:

```sh
--chunk-trials 5000
```

Smaller chunks pause more quickly but add coordination overhead. Larger chunks improve throughput but can take longer to finish after a graceful stop request.

## Foreground Mode

`run` remains available for tests and short interactive jobs:

```sh
npm run monte-carlo -- run \
  --ledger monte-carlo/runs/test.json \
  --scenario monte-carlo/examples/four-player.json \
  --trials 100000
```

Foreground mode is a child of the invoking shell. The CLI refuses foreground `run` inside a detected Codex thread, preventing Codex from accidentally owning a long-running controller. Use `start` for all Codex work and unattended multi-hour jobs.

## Tests

```sh
npm run test:monte-carlo
```

## Archived 25-Billion-Trial Result

The completed 522-player ledger is stored outside the writable `runs/`
directory at
`research/results/parallel_full_field_monte_carlo_522_25b.json`. Its four
sessions total exactly 25,000,000,000 trials. A concise result table is in
`research/results/parallel_full_field_monte_carlo_522_25b.md`.

Verify the artifact without adding trials or changing it:

```sh
npm run research:verify-522-mc-25b
```

Use a new path under `monte-carlo/runs/` for exploratory runs and independent
replications. That directory and the machine-specific `launchd` job files and
logs are intentionally ignored by Git.
