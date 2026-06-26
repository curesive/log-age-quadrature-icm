# Log-Age Quadrature ICM

Minimal reference implementation, examples, and local browser calculator for **Log-Age Quadrature ICM**, a deterministic poker tournament ICM method based on log-search-age quadrature.

## Quick Start

Requirements: Node.js 18 or newer.

```sh
npm test
npm start
```

Then open:

```text
http://localhost:5173
```

No runtime packages are required. The calculator is plain HTML, CSS, and JavaScript.

## Repository Layout

- `src/log-age-quadrature-icm.js`: dependency-free solver used by the app and tests.
- `paper/log-age-quadrature-icm-snippet.js`: slower, clearer reference snippet for a paper appendix.
- `examples/*.json`: three baked-in tournament examples with chip counts and active payout rows.
- `web/`: local browser calculator.
- `test/golden.test.js`: lightweight Node test suite.

## Solver API

```js
import {
  solveLogAgeQuadratureIcm,
  solvePlayerLogAgeQuadratureIcm,
} from "./src/log-age-quadrature-icm.js";

const chipCounts = [40000, 30000, 20000, 10000];
const payouts = [6000, 3000, 1000, 0];

const fullField = solveLogAgeQuadratureIcm(chipCounts, payouts);
const heroOnly = solvePlayerLogAgeQuadratureIcm(chipCounts, payouts, 0);
```

`solveLogAgeQuadratureIcm` returns every player's equity and dollar value.
`solvePlayerLogAgeQuadratureIcm` returns one zero-based target player's value.

## Example Data

The bundled examples are:

- `wsop-2025-main-event-day7-24.json`
- `wsop-2024-high-roller-day1-99.json`
- `wsop-2025-main-event-snapshot-522.json`

Each file contains:

- `chipCounts`: active player stacks.
- `payouts`: active payout rows, sliced to `min(playersRemaining, sourcePayoutRows)`.
- `source`: provenance metadata copied from the local data preparation workspace.

## Method Summary

For each player, Log-Age Quadrature ICM maps chip share to a relative exponential-race rate. It conditions on search age, uses a product polynomial to compute rank probabilities among the other players, and integrates expected payout over log search age with composite Gauss-Legendre quadrature. The full-field implementation uses an adjoint pass so all players can be evaluated in one sweep per quadrature node.

## License

Released under the [MIT License](./LICENSE).
