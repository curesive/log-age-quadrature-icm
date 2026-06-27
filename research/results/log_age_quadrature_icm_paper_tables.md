# Log-Age Quadrature ICM Paper Result Tables

Generated at: 2026-06-27T16:29:48.760Z

## Exact Small-Field Comparison

| Scenario | Seat | Chips | Exact MH | Log-Age 192 | Difference |
| --- | --- | --- | --- | --- | --- |
| 4-player teaching example | 1 | 40,000 | $3,554 | $3,554 | +$0 |
| 4-player teaching example | 2 | 30,000 | $2,987 | $2,987 | +$0 |
| 4-player teaching example | 3 | 20,000 | $2,241 | $2,241 | +$0 |
| 4-player teaching example | 4 | 10,000 | $1,218 | $1,218 | +$0 |
| 9-player final table example | 1 | 1,500,000 | $132,037 | $132,037 | +$0 |
| 9-player final table example | 5 | 400,000 | $81,290 | $81,290 | +$0 |
| 9-player final table example | 9 | 100,000 | $47,928 | $47,928 | +$0 |

## 9-Player Quadrature Convergence

| Requested nodes | Actual nodes | Max abs error | Mean abs error | Max equity error |
| --- | --- | --- | --- | --- |
| 48 | 128 | $0 | $0 | 2.656e-13 |
| 96 | 128 | $0 | $0 | 2.656e-13 |
| 128 | 128 | $0 | $0 | 2.656e-13 |
| 192 | 192 | $0 | $0 | 1.828e-15 |
| 384 | 384 | $0 | $0 | 1.791e-15 |
| 768 | 768 | $0 | $0 | 1.455e-15 |

## Monte Carlo Comparison

| Scenario | Seat | Trials | Log-Age | MC mean | 95% CI | Inside CI? |
| --- | --- | --- | --- | --- | --- | --- |
| 4-player teaching example | 1 | 200,000 | $3,554 | $3,553 | $3,544 to $3,563 | yes |
| 4-player teaching example | 4 | 200,000 | $1,218 | $1,224 | $1,215 to $1,232 | yes |
| 9-player final table example | 1 | 200,000 | $132,037 | $132,041 | $131,854 to $132,229 | yes |
| 9-player final table example | 5 | 200,000 | $81,290 | $81,355 | $81,156 to $81,555 | yes |
| 9-player final table example | 9 | 200,000 | $47,928 | $47,947 | $47,809 to $48,086 | yes |
| WSOP 2025 Main Event Day 7 - 24 players | 1 | 1,000,000 | $3,073,949 | $3,075,330 | $3,069,595 to $3,081,066 | yes |
| WSOP 2025 Main Event Day 7 - 24 players | 12 | 1,000,000 | $1,547,794 | $1,547,574 | $1,543,351 to $1,551,798 | yes |
| WSOP 2025 Main Event Day 7 - 24 players | 24 | 1,000,000 | $678,213 | $676,661 | $674,353 to $678,969 | yes |
| WSOP 2024 Event 26 High Roller Day 1 - 99 players | 1 | 300,000 | $188,549 | $188,428 | $187,198 to $189,658 | yes |
| WSOP 2024 Event 26 High Roller Day 1 - 99 players | 50 | 300,000 | $66,885 | $66,918 | $66,198 to $67,637 | yes |
| WSOP 2024 Event 26 High Roller Day 1 - 99 players | 99 | 300,000 | $13,145 | $13,191 | $12,870 to $13,511 | yes |
| WSOP 2025 Main Event Snapshot - 522 players | 1 | 500,000 | $366,031 | $363,922 | $360,971 to $366,874 | yes |
| WSOP 2025 Main Event Snapshot - 522 players | 261 | 500,000 | $122,809 | $123,464 | $122,002 to $124,925 | yes |
| WSOP 2025 Main Event Snapshot - 522 players | 522 | 500,000 | $46,039 | $45,618 | $45,116 to $46,120 | yes |

## Empirical Example Values

| Scenario | Seat | Chips | Log-Age ICM value | Equity |
| --- | --- | --- | --- | --- |
| WSOP 2025 Main Event Day 7 - 24 players | 1 / 24 | 63,600,000 | $3,073,949 | 8.091% |
| WSOP 2025 Main Event Day 7 - 24 players | 12 / 24 | 22,500,000 | $1,547,794 | 4.074% |
| WSOP 2025 Main Event Day 7 - 24 players | 24 / 24 | 5,400,000 | $678,213 | 1.785% |
| WSOP 2024 Event 26 High Roller Day 1 - 99 players | 1 / 99 | 1,211,000 | $188,549 | 2.523% |
| WSOP 2024 Event 26 High Roller Day 1 - 99 players | 50 / 99 | 344,000 | $66,885 | 0.895% |
| WSOP 2024 Event 26 High Roller Day 1 - 99 players | 99 / 99 | 61,000 | $13,145 | 0.176% |
| WSOP 2025 Main Event Snapshot - 522 players | 1 / 522 | 4,195,000 | $366,031 | 0.513% |
| WSOP 2025 Main Event Snapshot - 522 players | 261 / 522 | 925,000 | $122,809 | 0.172% |
| WSOP 2025 Main Event Snapshot - 522 players | 522 / 522 | 120,000 | $46,039 | 0.065% |
