# Dataset Provenance and Reuse

The example and research fixtures in this repository combine author-created
formatting and generated data with tournament facts retrieved from third-party
sources. The repository does not relicense third-party data.

## License Boundary

- Source code, including scripts and code listings, is licensed under the
  repository's [MIT License](./LICENSE).
- Paper prose is licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) as described in
  [paper/LICENSE.md](./paper/LICENSE.md).
- Author-created descriptions, metadata, and presentations of generated
  results may be reused under CC BY 4.0 to the extent that the author holds the
  applicable rights.
- The deterministic synthetic chip stacks in the 4,000-player fixture are
  author-created data and may be reused under CC BY 4.0.
- Chip counts, payout schedules, event facts, names, and other material derived
  from third-party sources are excluded from the MIT and CC BY 4.0 grants.
  Consult the original source and its terms before redistributing or reusing
  that material. PokerNews publishes its current
  [Terms and Conditions](https://www.pokernews.com/terms-conditions.htm).

## Empirical Examples

The three files below contain chip counts and expanded payout schedules derived
from public PokerNews event pages. Player names were removed during preparation.

| Repository file | Event | Chip-count source | Payout source |
| --- | --- | --- | --- |
| `examples/wsop-2025-main-event-day7-24.json` | 2025 WSOP Main Event, Day 7 | [PokerNews chip counts](https://www.pokernews.com/tours/wsop/2025-wsop/event-81-10000-wsop-main-event/day7/chips.htm) | [PokerNews payouts](https://www.pokernews.com/tours/wsop/2025-wsop/event-81-10000-wsop-main-event/payouts.htm) |
| `examples/wsop-2025-main-event-snapshot-522.json` | 2025 WSOP Main Event, 522-player snapshot | [PokerNews event coverage](https://www.pokernews.com/tours/wsop/2025-wsop/event-81-10000-wsop-main-event/) | [PokerNews payouts](https://www.pokernews.com/tours/wsop/2025-wsop/event-81-10000-wsop-main-event/payouts.htm) |
| `examples/wsop-2024-high-roller-day1-99.json` | 2024 WSOP Event 26, Day 1 | [PokerNews chip counts](https://www.pokernews.com/tours/wsop/2024-wsop/event-26-25000-high-roller/day1/chips.htm) | [PokerNews payouts](https://www.pokernews.com/tours/wsop/2024-wsop/event-26-25000-high-roller/payouts.htm) |

The files' `source` objects record the local preparation inputs, row counts, and
event metadata used to build the repository examples. The 2024 sources were
retrieved on April 26 and May 7, 2026. The 2025 sources were retrieved on May 7,
2026.

## Synthetic 4,000-Player Fixture

`research/fixtures/wsop-2026-main-event-4000.json` uses two kinds of input:

- Chip stacks are deterministic synthetic output from ICM Swap Chip Count Gen
  2.4. The fixture records the generator version, seed, 700,000-chip leader
  anchor, 138,120-chip average-stack hero, and chip-count checksum.
- Payouts and event facts were retrieved from the
  [PokerNews 2026 WSOP Main Event payout page](https://www.pokernews.com/tours/wsop/2026-wsop/2026-wsop-main-event/payouts.htm)
  on July 17, 2026. The fixture records the retrieval timestamp and payout
  checksum.

## Generated Results

Files under `research/results/` are numerical outputs produced by the included
scripts from the documented inputs. Their formatting and repository-authored
commentary are available under CC BY 4.0, but that grant does not extend to any
underlying third-party input data represented in the results.

`research/results/parallel_full_field_monte_carlo_522_25b.json` is a derived
simulation ledger, not a new empirical data source. Its chip counts and payout
list match `examples/wsop-2025-main-event-snapshot-522.json`, identified by the
scenario SHA-256 stored in the ledger. The ledger adds only simulation settings,
session metadata, aggregate moments, and per-player Monte Carlo estimates.

This provenance statement is informational and does not replace the terms of
the original data providers.
