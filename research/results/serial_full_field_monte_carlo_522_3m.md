# 522-Player Serial Full-Field Monte Carlo Benchmark

Generated: 2026-07-30T18:25:04.608Z

Fixture: `wsop-2025-main-event-snapshot-522`

| Method | Output | Trials | Time | Time / LAQI |
| --- | --- | ---: | ---: | ---: |
| LAQI (192 nodes, 32 panels) | All 522 players | n/a | 105.164 ms | 1.0x |
| Serial Monte Carlo | All 522 players | 3,000,000 | 199.762 s | 1899.5x |

The LAQI time is the median of 21 measurements after three warm-up runs. The Monte Carlo time is one complete serial run. Both methods returned values for every player. No worker threads, child processes, or GPU acceleration were used.

Across all 522 players, 522 Monte Carlo estimates were within 1% of LAQI, and the maximum absolute relative difference was 0.864%. LAQI was inside 491 of 522 individual Monte Carlo 95% intervals.

| Player | Chips | LAQI 192 | MC mean | MC 95% interval |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 4,195,000 | $366,030.62 | $365,756.04 | $364,539.76 to $366,972.32 |
| 261 | 925,000 | $122,809.41 | $122,641.44 | $122,050.24 to $123,232.64 |
| 522 | 120,000 | $46,039.20 | $45,938.77 | $45,724.30 to $46,153.23 |

Machine: Apple M3 Ultra, Node.js v24.16.0, single Node.js process; no worker threads or GPU.
