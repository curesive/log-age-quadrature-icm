# 522-Player Serial Full-Field Monte Carlo Benchmark

Generated: 2026-07-27T22:18:27.622Z

Fixture: `wsop-2025-main-event-snapshot-522`

| Method | Output | Trials | Time | Time / LAQI |
| --- | --- | ---: | ---: | ---: |
| LAQI (192 nodes, 32 panels) | All 522 players | n/a | 109.036 ms | 1.0x |
| Serial Monte Carlo | All 522 players | 1,000,000 | 68.575 s | 628.9x |

The LAQI time is the median of 21 measurements after three warm-up runs. The Monte Carlo time is one complete serial run. Both methods returned values for every player. No worker threads, child processes, or GPU acceleration were used.

| Player | Chips | LAQI 192 | MC mean | MC 95% interval |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 4,195,000 | $366,030.62 | $366,008.23 | $363,899.25 to $368,117.20 |
| 261 | 925,000 | $122,809.41 | $122,313.16 | $121,293.91 to $123,332.41 |
| 522 | 120,000 | $46,039.20 | $45,907.63 | $45,534.72 to $46,280.54 |

Machine: Apple M3 Ultra, Node.js v24.16.0, single Node.js process; no worker threads or GPU.
