import assert from "node:assert/strict";
import test from "node:test";
import {
  solveLogageQuadratureIcm,
  solvePlayerLogageQuadratureIcm,
} from "../src/logage-quadrature-icm.js";

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

test("full-field solver matches 4-player golden values", () => {
  const result = solveLogageQuadratureIcm(fourPlayer.chipCounts, fourPlayer.payouts);
  assert.equal(cents(result.players[0].value), 3553.97);
  assert.equal(cents(result.players[1].value), 2986.90);
  assert.equal(cents(result.players[2].value), 2241.27);
  assert.equal(cents(result.players[3].value), 1217.86);
});

test("target solver matches the full-field result for a selected player", () => {
  const full = solveLogageQuadratureIcm(ninePlayer.chipCounts, ninePlayer.payouts);
  const target = solvePlayerLogageQuadratureIcm(ninePlayer.chipCounts, ninePlayer.payouts, 0);
  assert.equal(cents(target.player.value), cents(full.players[0].value));
  assert.equal(cents(target.player.value), 132036.56);
});

test("full-field equities conserve the prize pool", () => {
  const result = solveLogageQuadratureIcm(ninePlayer.chipCounts, ninePlayer.payouts);
  const equitySum = result.players.reduce((total, player) => total + player.equity, 0);
  const valueSum = result.players.reduce((total, player) => total + player.value, 0);
  assert.ok(Math.abs(equitySum - 1) < 1e-9);
  assert.ok(Math.abs(valueSum - result.totalPrizePool) < 1e-6);
});
