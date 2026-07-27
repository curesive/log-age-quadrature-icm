# Core Validation Results

Generated: 2026-07-27T05:00:13.090Z

Machine: Apple M3 Ultra, 96 GB RAM, Node.js v24.16.0, single Node.js process; no worker threads or GPU.

All reported deterministic times are medians after warm-up. Monte Carlo times are complete single-thread runtimes. The 95% Monte Carlo intervals use the sample payout variance and a normal critical value of 1.96.

## 1. Nine-Player Exact Accuracy

| Seat | Chips | Exact MH ($) | LAQI 192 ($) | LAQI - exact ($) |
| --- | --- | --- | --- | --- |
| 1 | 1,500,000 | 132036.5625646212 | 132036.5625646198 | -1.4261e-9 |
| 2 | 900,000 | 111705.7163896566 | 111705.7163896566 | 8.7311e-11 |
| 3 | 700,000 | 101729.0863405498 | 101729.0863405498 | 0.0000e+0 |
| 4 | 500,000 | 89047.4863831188 | 89047.4863831188 | 5.8208e-11 |
| 5 | 400,000 | 81290.1314884878 | 81290.1314884883 | 5.0932e-10 |
| 6 | 350,000 | 76947.2247849606 | 76947.2247849608 | 1.8917e-10 |
| 7 | 300,000 | 72232.6809679994 | 72232.6809679990 | -4.3656e-10 |
| 8 | 250,000 | 67082.9157592348 | 67082.9157592349 | 1.1642e-10 |
| 9 | 100,000 | 47928.1953213718 | 47928.1953213719 | 5.0932e-11 |

Maximum absolute LAQI error: 1.426088e-9 dollars. Maximum relative error: 1.080070e-14.

## 2. Nine-Player Accuracy and Time

| Method | Output | Time | Max abs error vs exact | RMSE vs exact | Exact values inside 95% CI |
| --- | --- | --- | --- | --- | --- |
| Exact Malmuth-Harville recursion | all 9 players | 40.42 ms | baseline | baseline | n/a |
| LAQI (192 nodes, 32 panels) | all 9 players | 0.088 ms | 1.4261e-9 | 5.3194e-10 | n/a |
| Serial Monte Carlo (1,000,000 trials) | all 9 players | 325.73 ms | $55.03 | $29.75 | 9/9 |

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
| LAQI 192 | all 522 players | deterministic | 97.92 ms |
| LAQI 192 | 3 selected players | deterministic | 38.70 ms |
| LAQI 1536 reference | all 522 players | deterministic | 780.73 ms |
| Serial Monte Carlo | 3 selected players | 3,000,000 trials | 33.549 s |

The selected-player Monte Carlo run used the same simulated finish for all three reported players in each trial. It did not compute values for the other 519 players.

## 4. 4,000-Player LAQI Stress Test

This stress test uses 4,000 deterministic stacks from ICM Swap Chip Count Gen 2.4 and the observed 2026 WSOP Main Event payout table. The stacks are anchored to a 700,000-chip leader and a 138,120-chip average-stack Hero.

| Measurement | Result |
| --- | --- |
| Entrants represented | 9,208 |
| Players remaining | 4,000 |
| Active paid ranks | 1,383 |
| LAQI settings | 192 nodes, 32 panels |
| Median full-field time | 2.259 s |
| Fastest / slowest measured | 2.252 s / 2.260 s |
| Prize-pool conservation error | 2.9802e-7 |

Official event dimensions: https://www.wsop.com/tournaments/result/619/

## Reproduction

Run `npm run research:validate`. Trial counts can be reduced for a quick check with `LAQI_NINE_MC_TRIALS` and `LAQI_522_MC_TRIALS`; paper results should use the defaults.
