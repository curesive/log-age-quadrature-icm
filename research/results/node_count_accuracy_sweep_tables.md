# LAQI Node-Count Accuracy Sweep

Generated: 2026-07-27T22:43:13.524Z

100 deterministic cases were tested at each field size. Every case used positive stacks and a descending payout list normalized to a $1,000,000 active prize pool. Errors are the worst observed across all cases and players unless labeled RMSE.

| Players | Values compared | 192 max abs ($) | 192 RMSE ($) | 192 max relative | 1536 max abs ($) | 1536 max relative | 192-1536 max abs ($) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 300 | 1.106e-9 | 3.162e-10 | 2.916e-15 | 1.630e-9 | 4.424e-15 | 1.281e-9 |
| 4 | 400 | 1.106e-9 | 2.664e-10 | 2.795e-15 | 9.895e-10 | 4.222e-15 | 1.164e-9 |
| 5 | 500 | 9.313e-10 | 2.221e-10 | 3.520e-15 | 1.048e-9 | 5.471e-15 | 9.022e-10 |
| 6 | 600 | 8.731e-10 | 2.086e-10 | 3.826e-15 | 1.455e-9 | 6.899e-15 | 9.313e-10 |
| 7 | 700 | 7.567e-10 | 1.875e-10 | 3.643e-15 | 7.858e-10 | 6.457e-15 | 6.694e-10 |
| 8 | 800 | 6.694e-10 | 1.672e-10 | 4.969e-15 | 9.895e-10 | 8.376e-15 | 6.112e-10 |
| 9 | 900 | 1.106e-9 | 1.689e-10 | 5.563e-15 | 8.731e-10 | 5.839e-15 | 7.276e-10 |
| 10 | 1,000 | 1.281e-9 | 1.616e-10 | 5.936e-15 | 9.313e-10 | 6.730e-15 | 6.403e-10 |
| 11 | 1,100 | 1.979e-9 | 1.707e-10 | 7.529e-15 | 8.440e-10 | 9.181e-15 | 1.164e-9 |
| 12 | 1,200 | 4.045e-9 | 2.254e-10 | 1.575e-14 | 1.048e-9 | 6.828e-15 | 2.998e-9 |
| 13 | 1,300 | 1.269e-8 | 4.825e-10 | 5.148e-14 | 7.567e-10 | 7.113e-15 | 1.211e-8 |

The 50-decimal subset implementation was cross-checked against 50-decimal direct finish-order recursion through 9 players; maximum difference: 5.386e-41 dollars.

## 522-Player Self-Convergence

This is not an exact comparison. Each result is compared with the same fixture evaluated at 6,144 nodes.

| Nodes | Runtime (ms) | Max abs vs 6144 ($) | RMSE vs 6144 ($) | Max relative vs 6144 |
| --- | --- | --- | --- | --- |
| 192 | 116.715 | 9.761e-3 | 4.694e-3 | 9.948e-8 |
| 384 | 231.223 | 4.488e-8 | 9.148e-9 | 1.226e-13 |
| 768 | 463.723 | 1.513e-9 | 4.050e-10 | 7.555e-15 |
| 1536 | 960.387 | 1.659e-9 | 4.520e-10 | 1.045e-14 |
| 3072 | 1862.255 | 2.794e-9 | 5.230e-10 | 1.216e-14 |
| 6144 | 3657.032 | 0.000e+0 | 0.000e+0 | 0.000e+0 |
