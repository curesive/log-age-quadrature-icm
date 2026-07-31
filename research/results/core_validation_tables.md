# Core Validation Results

Generated: 2026-07-31T01:53:25.814Z

Machine: Apple M3 Ultra, 96 GB RAM, Node.js v24.16.0, single Node.js process; no worker threads or GPU.

All reported deterministic times are medians after warm-up. Monte Carlo times are complete single-thread runtimes. The 95% Monte Carlo intervals use the sample payout variance and a normal critical value of 1.96.

## 1. Nine-Player Exact Accuracy

| Seat | Chips | High-precision exact ICM ($) | LAQI 192 ($) | LAQI - exact ($) |
| --- | --- | --- | --- | --- |
| 1 | 1,500,000 | 132036.562564619979 | 132036.562564619817 | -1.6175e-10 |
| 2 | 900,000 | 111705.716389656741 | 111705.716389656649 | -9.2314e-11 |
| 3 | 700,000 | 101729.086340549830 | 101729.086340549838 | 8.8580e-12 |
| 4 | 500,000 | 89047.486383118845 | 89047.486383118827 | -1.7870e-11 |
| 5 | 400,000 | 81290.131488488333 | 81290.131488488274 | -5.9333e-11 |
| 6 | 350,000 | 76947.224784960699 | 76947.224784960752 | 5.2706e-11 |
| 7 | 300,000 | 72232.680967998947 | 72232.680967998982 | 3.5015e-11 |
| 8 | 250,000 | 67082.915759234878 | 67082.915759234893 | 1.5287e-11 |
| 9 | 100,000 | 47928.195321371749 | 47928.195321371859 | 1.1026e-10 |

Maximum absolute LAQI error: 1.6175e-10 dollars. Maximum relative error: 2.3006e-15.

## 2. Nine-Player Accuracy and Time

| Method | Output | Time | Max abs error vs exact | RMSE vs exact | Exact values inside 95% CI |
| --- | --- | --- | --- | --- | --- |
| Exact Malmuth-Harville recursion (binary64 implementation) | all 9 players | 41.36 ms | 1.2643e-9 | 4.9607e-10 | n/a |
| LAQI (192 nodes, 32 panels) | all 9 players | 0.106 ms | 1.6175e-10 | 7.8173e-11 | n/a |
| Serial Monte Carlo (1,000,000 trials) | all 9 players | 350.42 ms | $55.03 | $29.75 | 9/9 |

Errors are measured against the 50-decimal high-precision exact ICM reference above. The binary64 recursion row reflects floating-point rounding in the timed Node.js implementation; the mathematical recurrence itself is exact.

## 3. 522-Player LAQI and Monte Carlo Comparison

Production LAQI (192 nodes) was also compared with a 1,536-node full-field LAQI reference. Across all 522 players, the maximum 192-vs-1,536 difference was $0.0098 and the mean absolute difference was $0.0041.

| Seat | Chips | LAQI 192 | LAQI 1536 | LAQI gap | MC mean | MC 95% margin | Reference inside CI? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 4,195,000 | $366,030.62 | $366,030.61 | $0.0098 | $366,112.60 | +/-$1,215.56 | yes |
| 261 | 925,000 | $122,809.41 | $122,809.41 | $0.0007 | $122,867.04 | +/-$592.67 | yes |
| 522 | 120,000 | $46,039.20 | $46,039.20 | $0.0039 | $45,891.69 | +/-$213.29 | yes |

The largest Monte Carlo-reference difference was 1.355 standard errors. 3 of 3 individual 95% intervals contained the reference; all 3 contained it under a Bonferroni-adjusted simultaneous 95% comparison (critical value 2.39398).

| Method | Output | Sampling | Time |
| --- | --- | --- | --- |
| LAQI 192 | all 522 players | deterministic | 103.57 ms |
| LAQI 192 target-only raw estimate | 3 selected players (timing only) | deterministic | 40.76 ms |
| LAQI 1536 reference | all 522 players | deterministic | 827.57 ms |
| Serial Monte Carlo | 3 selected players | 3,000,000 trials | 34.898 s |

The displayed LAQI dollar values are normalized full-field results. The LAQI target-only raw estimates were measured only for the timing comparison. The selected-player Monte Carlo run used the same simulated finish for all three reported players in each trial and did not compute values for the other 519 players.

## 4. 4,000-Player LAQI Stress Test

This stress test uses 4,000 deterministic stacks from ICM Swap Chip Count Gen 2.4 and the observed 2026 WSOP Main Event payout table. The stacks are anchored to a 700,000-chip leader and a 138,120-chip average-stack Hero.

| Measurement | Result |
| --- | --- |
| Entrants represented | 9,208 |
| Players remaining | 4,000 |
| Active paid ranks | 1,383 |
| LAQI settings | 192 nodes, 32 panels |
| Median full-field time | 2.468 s |
| Fastest / slowest measured | 2.456 s / 2.471 s |
| Prize-pool conservation error | 2.9802e-7 |

Official event dimensions: https://www.wsop.com/tournaments/result/619/

## Reproduction

Run `npm run research:validate`. Trial counts can be reduced for a quick check with `LAQI_NINE_MC_TRIALS` and `LAQI_522_MC_TRIALS`; paper results should use the defaults.

Run `npm run research:verify-nine-player-exact` for a lightweight deterministic check of the 50-decimal Table 1 reference and every reported LAQI difference.
