# Log-Age Quadrature ICM

Minimal reference implementation, examples, and local browser calculator for
**Log-Age Quadrature ICM**, a deterministic poker tournament ICM method based
on integration over log search age.

## Quick Start

Requirements: Node.js 18 or newer. There are no runtime package dependencies.

```sh
npm test
npm start
```

Open `http://localhost:5173` to use the calculator.

## Repository Layout

- `src/log-age-quadrature-icm.js`: dependency-free solver used by the app and tests.
- `paper/log-age-quadrature-icm-snippet.js`: slower reference version intended for reading and citation.
- `research/`: reproducible benchmark scripts, fixtures, and saved paper results.
- `examples/*.json`: three tournament examples with chip counts and active payouts.
- `web/`: plain HTML, CSS, and JavaScript browser calculator.
- `test/golden.test.js`: exact, validation, conservation, and larger-field tests.

## Solver API

```js
import {
  solveLogAgeQuadratureIcm,
  solvePlayerLogAgeQuadratureIcm,
} from "./src/log-age-quadrature-icm.js";

const chipCounts = [40000, 30000, 20000, 10000];
const payouts = [6000, 3000, 1000, 0];
const options = {
  logAgeNodeCount: 192,
  logAgePanelCount: 32,
  tailTolerance: 1e-12,
};

const fullField = solveLogAgeQuadratureIcm(chipCounts, payouts, options);
const heroOnly = solvePlayerLogAgeQuadratureIcm(
  chipCounts,
  payouts,
  0,
  options,
);
```

`solveLogAgeQuadratureIcm` returns values for every player.
`solvePlayerLogAgeQuadratureIcm` returns one player selected by a zero-based
index.

### Inputs

- `chipCounts`: a nonempty array of positive, finite stack sizes.
- `payouts`: an array containing at least one positive, finite prize.
- `targetPlayerIndex`: a zero-based index into `chipCounts`, for the target-only solver.
- `options`: an optional object containing the numerical settings below.

Payout values are converted to numbers. Nonfinite, zero, and negative payout
rows are ignored. The remaining prizes are sorted from largest to smallest and
limited to the number of players. This active list defines the remaining prize
pool used by the calculation.

### Options

| Option | Default | Minimum | Effect |
| --- | ---: | ---: | --- |
| `logAgeNodeCount` | `192` | `48` | Requested total quadrature nodes. Higher values generally cost more time and can be used for convergence checks. |
| `logAgePanelCount` | `32` | `4` | Number of composite log-age integration panels. |
| `tailTolerance` | `1e-12` | `1e-15` | Controls the upper search-age bound used to truncate the numerical integral. |

The implementation assigns an integer number of Gauss-Legendre nodes to every
panel, so the actual count can be slightly larger than the requested count.
The returned `metadata.quadratureNodes` field records the actual count.

### Full-Field Output

The full-field result has this shape:

```js
{
  model: "Log-Age Quadrature ICM",
  totalPrizePool,
  players: [{
    playerIndex, // one-based in returned results
    chips,
    chipFraction,
    equity,      // fraction of the active prize pool
    value,       // equity * totalPrizePool
  }],
  metadata: {
    logAgeNodeCount,
    logAgePanelCount,
    quadratureNodes,
    paidRanks,
    searchAgeUpperBound,
    normalizedEquitySum,
  },
}
```

The full-field solver normalizes the computed equities so that their sum is
one. Subject only to floating-point rounding, the returned dollar values
therefore sum to `totalPrizePool`.

### Target-Only Output

The target-only result returns the same player fields under `player`, plus
solver metadata. It computes that player's raw quadrature equity without
materializing or normalizing all other players. This is useful when only one or
a few values are needed. Because no full-field normalization factor is applied,
a target-only value can differ slightly from the corresponding normalized
full-field value.

## Example Data

The bundled examples are:

- `wsop-2025-main-event-day7-24.json`
- `wsop-2024-high-roller-day1-99.json`
- `wsop-2025-main-event-snapshot-522.json`

Each file contains `chipCounts`, active `payouts`, and source metadata. See
[`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md) for provenance and reuse terms.

## Method Summary

For each player, Log-Age Quadrature ICM maps chip share to a relative
exponential-race rate. It conditions on search age, uses a product polynomial
to compute rank probabilities among the other players, and integrates expected
payout over log search age with composite Gauss-Legendre quadrature. The
full-field implementation uses an adjoint pass to evaluate all players in one
sweep per quadrature node.

## Tests

```sh
npm test
```

The suite covers the four-player golden values, a nine-player comparison with
exact Malmuth-Harville recursion at sub-cent precision, malformed inputs,
prize-pool conservation, target-only behavior, payout activation, and a
99-player example. GitHub Actions runs it on Node.js 18, 20, 22, and 24.

## Paper Results and Reproduction

The canonical paper artifact is
`research/results/paper_results_v1_0_0.json`. It records the exact values and
benchmark measurements selected for manuscript version 1.0.0. Fresh timing
measurements will vary with the machine and current system load.

| Paper result | Reproduction command | Primary output |
| --- | --- | --- |
| Table 1, nine-player exact accuracy | `npm run research:validate` | `research/results/core_validation_results.json` |
| Table 2, nine-player accuracy and timing | `npm run research:validate` | `research/results/core_validation_tables.md` |
| Table 2, focused one-million-trial Monte Carlo output | `npm run research:validate-nine-player-mc` | `research/results/nine_player_monte_carlo_1m.json` |
| Table 3, 522-player LAQI and three-player Monte Carlo comparison | `npm run research:validate` | `research/results/core_validation_results.json` |
| Table 4, 4,000-player full-field and average-stack target-only timing | `npm run research:stress-main-event` | `research/results/main_event_stress_4000.json` |
| Table 4, 192/384/768/1,536-node convergence | `npm run research:convergence-main-event` | `research/results/main_event_stress_4000_convergence.json` |
| Supplemental 522-player full-field serial Monte Carlo | `npm run research:benchmark-522-full-field-mc` | `research/results/serial_full_field_monte_carlo_522_1m.json` |
| Supplemental 3-13 player exact sweep and 522-player node convergence | `npm run research:sweep-node-accuracy` | `research/results/node_count_accuracy_sweep.json` |

The node-count sweep also writes a readable Markdown table and a standalone
522-player convergence file:

- `research/results/node_count_accuracy_sweep_tables.md`
- `research/results/wsop_2025_main_event_522_node_convergence.json`

The 3-13 player portion uses 100 deterministic stack and payout cases at every
field size and compares 192- and 1,536-node LAQI with a 50-decimal exact
Malmuth-Harville subset calculation. The 522-player portion is a self-convergence
comparison against 6,144 nodes, not an exact-ICM claim.

`npm run research:validate` uses one million Monte Carlo trials for the
nine-player example and three million trials for the three selected players in
the 522-player example. For a shorter exploratory run, override those counts:

```sh
LAQI_NINE_MC_TRIALS=10000 LAQI_522_MC_TRIALS=10000 npm run research:validate
```

In Windows PowerShell, set the variables first:

```powershell
$env:LAQI_NINE_MC_TRIALS=10000
$env:LAQI_522_MC_TRIALS=10000
npm run research:validate
```

After regenerating the source results, rebuild the canonical combined file:

```sh
npm run research:build-paper-results
```

To confirm that the checked-in source artifacts still reproduce the committed
canonical file without changing it:

```sh
npm run research:verify-paper-results
```

## Citation

Please cite the archived software release:

> Wolters, Derek. *Log-Age Quadrature ICM*, version 1.0.0. Zenodo, 2026.
> https://doi.org/10.5281/zenodo.21610089

GitHub and compatible reference managers can read the same metadata from
[`CITATION.cff`](./CITATION.cff). The source release is available as
[`v1.0.0`](https://github.com/curesive/log-age-quadrature-icm/releases/tag/v1.0.0).

## Licensing and Data

- Source code and code listings: [MIT License](./LICENSE).
- Paper prose: [Creative Commons Attribution 4.0 International](./paper/LICENSE.md).
- Example and research data: see [dataset provenance and reuse terms](./DATA_PROVENANCE.md).

The code and paper licenses do not relicense third-party chip counts, payout
schedules, or event facts.
