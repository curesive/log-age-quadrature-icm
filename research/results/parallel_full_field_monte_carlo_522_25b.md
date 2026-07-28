# 25-Billion-Trial 522-Player Monte Carlo Validation

The archived ledger contains the complete full-field output from 25,000,000,000
Monte Carlo ICM trials for the bundled 522-player WSOP scenario. It stores the
scenario, base seed, task-stream counter, running moments, four session records,
and all 522 means, standard errors, and individual 95% confidence intervals.

## Headline results

| Measurement | Result |
| --- | ---: |
| Monte Carlo trials | 25,000,000,000 |
| Players evaluated per trial | 522 |
| Active controller runtime across four sessions | 25 h 42 m 50.542 s |
| Mean throughput across all sessions | 270,064 trials/s |
| Workers by session | 8, 20, 16, 20 |
| Individual Monte Carlo 95% margin range | $2.3702-$13.3323 |
| 192-node LAQI values inside individual Monte Carlo 95% intervals | 490/522 (93.9%) |
| LAQI-Monte Carlo root-mean-square difference | $3.9349 |
| Largest absolute LAQI-Monte Carlo difference | $16.8714 |
| Largest absolute standardized difference | 3.0951 standard errors |
| Maximum 192-node versus 6,144-node LAQI difference | $0.009761 |
| Paper-reported 192-node full-field LAQI time | 103.271 ms |
| Monte Carlo active runtime / LAQI time | approximately 896,000x |

The 95% intervals above are individual Monte Carlo intervals. With 522
comparisons, some values are expected to fall outside their individual
intervals even when the deterministic values and simulation target the same
model. The 93.9% observed inclusion rate is therefore interpreted across the
field, rather than as a requirement that all 522 individual intervals contain
LAQI simultaneously.

## Representative players

| Player | Chips | LAQI 192 | Monte Carlo mean | MC - LAQI | MC 95% margin | LAQI inside interval? |
| ---: | ---: | ---: | ---: | ---: | ---: | :---: |
| 1 | 4,195,000 | $366,030.6243 | $366,038.3033 | $7.6790 | $13.3323 | Yes |
| 261 | 925,000 | $122,809.4053 | $122,812.9330 | $3.5277 | $6.4914 | Yes |
| 522 | 120,000 | $46,039.1960 | $46,039.2623 | $0.0663 | $2.3702 | Yes |

Run `npm run research:verify-522-mc-25b` to verify the ledger against the
bundled scenario, reconstruct its per-player results from the stored moments,
recalculate the 192-node LAQI comparison, and print the machine-readable
summary. This verification performs no additional Monte Carlo trials.

The first session ended through an unclean shutdown after its latest durable
checkpoint. Its 207,900,980 completed and checkpointed trials were retained,
the session was marked `interrupted`, and later sessions resumed from the same
ledger. The session totals sum exactly to the 25-billion-trial aggregate.

Ledger SHA-256:
`ef10f7ebf7b1b4a13845470d44dcb4e4a5e287088ad6600ab54e962f2b6c581c`.
