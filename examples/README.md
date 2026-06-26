# Examples

These examples are compact extracts from the local empirical chip-count and payout benchmark files.

Use `examples/index.json` to list them programmatically. Each example has:

- `chipCounts`: positive chip stacks for active players.
- `payouts`: active payout rows for the remaining field.
- `playersRemaining`: number of active players in the snapshot.
- `source`: provenance metadata.

The active payout rule used here is:

```js
const activePayoutList = payoutList.slice(
  0,
  Math.min(playersRemaining, payoutList.length),
);
```
