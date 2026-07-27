import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  solveLogAgeQuadratureIcm,
  solveNormalizedPlayerLogAgeQuadratureIcm,
  solvePlayerLogAgeQuadratureIcm,
  solveRawPlayerLogAgeQuadratureIcm,
} from "../src/log-age-quadrature-icm.js";
import { logAgeQuadratureIcm } from "../paper/log-age-quadrature-icm-snippet.js";

const fourPlayer = {
  chipCounts: [40000, 30000, 20000, 10000],
  payouts: [6000, 3000, 1000, 0],
};

const ninePlayer = {
  chipCounts: [
    1500000, 900000, 700000, 500000, 400000, 350000, 300000, 250000, 100000,
  ],
  payouts: [
    180000, 150000, 120000, 90000, 70000, 55000, 45000, 38000, 32000,
  ],
};

function cents(value) {
  return Math.round(value * 100) / 100;
}

function exactMalmuthHarvilleIcm(chipCounts, payouts) {
  const values = Array.from({ length: chipCounts.length }, () => 0);
  const activePayouts = payouts.slice(0, chipCounts.length);

  function recurse(remainingIndexes, remainingChips, rank, probability) {
    if (rank >= activePayouts.length) return;

    for (let offset = 0; offset < remainingIndexes.length; offset += 1) {
      const playerIndex = remainingIndexes[offset];
      const branchProbability = probability * (chipCounts[playerIndex] / remainingChips);
      values[playerIndex] += branchProbability * activePayouts[rank];

      if (rank + 1 < activePayouts.length) {
        recurse(
          remainingIndexes.slice(0, offset).concat(remainingIndexes.slice(offset + 1)),
          remainingChips - chipCounts[playerIndex],
          rank + 1,
          branchProbability,
        );
      }
    }
  }

  recurse(
    Array.from({ length: chipCounts.length }, (_, index) => index),
    chipCounts.reduce((total, chips) => total + chips, 0),
    0,
    1,
  );
  return values;
}

test("full-field solver matches 4-player golden values", () => {
  const result = solveLogAgeQuadratureIcm(fourPlayer.chipCounts, fourPlayer.payouts);
  assert.equal(cents(result.players[0].value), 3553.97);
  assert.equal(cents(result.players[1].value), 2986.90);
  assert.equal(cents(result.players[2].value), 2241.27);
  assert.equal(cents(result.players[3].value), 1217.86);
});

test("normalized selected-player solver returns the full-field value", () => {
  const full = solveLogAgeQuadratureIcm(ninePlayer.chipCounts, ninePlayer.payouts);
  const selected = solveNormalizedPlayerLogAgeQuadratureIcm(
    ninePlayer.chipCounts,
    ninePlayer.payouts,
    0,
  );
  assert.deepEqual(selected.player, full.players[0]);
  assert.equal(cents(selected.player.value), 132036.56);
  assert.equal(selected.metadata.outputValueType, "normalized-full-field");
  assert.equal(selected.metadata.normalizationApplied, true);
});

test("raw target solver labels its estimate and retains v1.0 aliases", () => {
  const raw = solveRawPlayerLogAgeQuadratureIcm(
    ninePlayer.chipCounts,
    ninePlayer.payouts,
    0,
  );
  const compatibility = solvePlayerLogAgeQuadratureIcm(
    ninePlayer.chipCounts,
    ninePlayer.payouts,
    0,
  );

  assert.equal(raw.metadata.outputValueType, "raw-target-estimate");
  assert.equal(raw.metadata.normalizationApplied, false);
  assert.equal(raw.player.value, raw.player.rawValueEstimate);
  assert.equal(raw.player.equity, raw.player.rawEquityEstimate);
  assert.deepEqual(compatibility, raw);
});

test("192-node solver matches exact 9-player ICM to substantially less than one cent", () => {
  const exactValues = exactMalmuthHarvilleIcm(ninePlayer.chipCounts, ninePlayer.payouts);
  const result = solveLogAgeQuadratureIcm(ninePlayer.chipCounts, ninePlayer.payouts);
  const errors = result.players.map((player, index) =>
    Math.abs(player.value - exactValues[index]));
  const maximumError = Math.max(...errors);

  assert.ok(
    maximumError < 2e-8,
    `maximum 9-player dollar error ${maximumError} exceeded 2e-8`,
  );
});

test("full-field equities conserve the prize pool", () => {
  const result = solveLogAgeQuadratureIcm(ninePlayer.chipCounts, ninePlayer.payouts);
  const equitySum = result.players.reduce((total, player) => total + player.equity, 0);
  const valueSum = result.players.reduce((total, player) => total + player.value, 0);
  assert.ok(Math.abs(equitySum - 1) < 1e-9);
  assert.ok(Math.abs(valueSum - result.totalPrizePool) < 1e-6);
  assert.equal(result.metadata.outputValueType, "normalized-full-field");
  assert.equal(result.metadata.normalizationApplied, true);
  assert.ok(result.metadata.rawEquitySum > 0);
  assert.ok(result.metadata.normalizationFactor > 0);
});

test("payout rows beyond the remaining player count are ignored", () => {
  const chipCounts = [40000, 30000, 20000, 10000];
  const activePayouts = [6000, 3000, 1000, 500];
  const fullEventPayouts = [400, 6000, 300, 3000, 1000, 500];
  const expected = solveLogAgeQuadratureIcm(chipCounts, activePayouts);
  const result = solveLogAgeQuadratureIcm(chipCounts, fullEventPayouts);
  const target = solveRawPlayerLogAgeQuadratureIcm(chipCounts, fullEventPayouts, 0);
  const snippet = logAgeQuadratureIcm(chipCounts, fullEventPayouts);

  assert.equal(result.totalPrizePool, 10500);
  assert.equal(target.totalPrizePool, 10500);
  assert.deepEqual(
    result.players.map((player) => cents(player.value)),
    expected.players.map((player) => cents(player.value)),
  );
  assert.equal(cents(target.player.rawValueEstimate), cents(expected.players[0].value));
  assert.ok(
    Math.abs(snippet.reduce((total, player) => total + player.value, 0) - 10500) < 1e-6,
  );
});

test("solver rejects malformed inputs and invalid target indexes", () => {
  assert.throws(
    () => solveLogAgeQuadratureIcm("40000,30000", [1000]),
    /chipCounts must be an array/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([40000, 30000], "1000,500"),
    /payouts must be an array/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([], [1000]),
    /positive numeric stack sizes/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([40000, 0], [1000]),
    /positive numeric stack sizes/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([40000, -1], [1000]),
    /positive numeric stack sizes/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([Number.MAX_VALUE, Number.MAX_VALUE], [1000]),
    /finite positive total/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([40000, 30000], [0, -1, "not a prize"]),
    /at least one positive prize/,
  );
  assert.throws(
    () => solveLogAgeQuadratureIcm([40000, 30000], [1000], null),
    /options must be an object/,
  );
  assert.throws(
    () => solveRawPlayerLogAgeQuadratureIcm([40000, 30000], [1000], 2),
    /zero-based index/,
  );
  assert.throws(
    () => solveNormalizedPlayerLogAgeQuadratureIcm([40000, 30000], [1000], 2),
    /zero-based index/,
  );
});

test("99-player example produces finite values and conserves the active prize pool", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../examples/wsop-2024-high-roller-day1-99.json", import.meta.url),
      "utf8",
    ),
  );
  const result = solveLogAgeQuadratureIcm(fixture.chipCounts, fixture.payouts);
  const selected = solveNormalizedPlayerLogAgeQuadratureIcm(
    fixture.chipCounts,
    fixture.payouts,
    49,
  );
  const raw = solveRawPlayerLogAgeQuadratureIcm(
    fixture.chipCounts,
    fixture.payouts,
    49,
  );
  const valueSum = result.players.reduce((total, player) => total + player.value, 0);

  assert.equal(result.players.length, 99);
  assert.equal(result.metadata.paidRanks, 48);
  assert.ok(result.players.every((player) =>
    Number.isFinite(player.equity) && Number.isFinite(player.value) && player.value >= 0));
  assert.ok(Math.abs(valueSum - result.totalPrizePool) < 1e-6);
  assert.deepEqual(selected.player, result.players[49]);
  assert.ok(
    Math.abs(raw.player.rawValueEstimate - selected.player.value) > 1e-6,
    "raw target estimate should remain distinguishable from normalized output",
  );
});
