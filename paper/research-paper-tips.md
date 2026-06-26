# Research Paper Tips

1. Start with the problem: exact ICM is accurate but grows expensive as remaining players and paid ranks increase.
2. Define the model in stages: chip share to race rate, conditioning on search age, rank distribution, payout expectation, quadrature.
3. Keep the first formula example small, such as the 4-player golden case.
4. Separate accuracy and speed claims. Accuracy should be compared to exact Malmuth-Harville on small fields and Monte Carlo confidence intervals on larger fields.
5. Report quadrature settings clearly: default `192` log-age nodes and `32` panels.
6. Include normalization details because readers will check whether total equity equals the remaining prize pool.
7. Use the large examples as empirical demonstrations, not as exact-proof claims.
8. Put the readable snippet in the paper appendix and link to the optimized repository implementation.
9. Explain where the method is deterministic: repeated inputs produce identical outputs, unlike Monte Carlo.
10. Avoid overselling exactness. The method is deterministic quadrature approximation, not a closed-form exact ICM enumerator.
