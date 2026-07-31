import assert from "node:assert/strict";
import test from "node:test";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";
import {
  exactMalmuthHarvilleIcmHighPrecision,
  highPrecisionErrorSummary,
  scaledBigIntToDecimal,
  scaledBigIntToScientific,
} from "../research/lib/high-precision-exact-icm.mjs";

const chipCounts = [
  1_500_000, 900_000, 700_000, 500_000, 400_000,
  350_000, 300_000, 250_000, 100_000,
];
const payouts = [
  180_000, 150_000, 120_000, 90_000, 70_000,
  55_000, 45_000, 38_000, 32_000,
];

test("nine-player high-precision reference reproduces the paper values", () => {
  const exact = exactMalmuthHarvilleIcmHighPrecision(chipCounts, payouts);
  const laqi = solveLogAgeQuadratureIcm(chipCounts, payouts, {
    logAgeNodeCount: 192,
    logAgePanelCount: 32,
    tailTolerance: 1e-12,
  }).players.map((player) => player.value);
  const errors = highPrecisionErrorSummary(laqi, exact.scaledEquities);

  assert.deepEqual(
    exact.scaledEquities.map((value) => scaledBigIntToDecimal(value, 12)),
    [
      "132036.562564619979",
      "111705.716389656741",
      "101729.086340549830",
      "89047.486383118845",
      "81290.131488488333",
      "76947.224784960699",
      "72232.680967998947",
      "67082.915759234878",
      "47928.195321371749",
    ],
  );
  assert.deepEqual(
    errors.scaledErrors.map((value) => scaledBigIntToScientific(value, 5)),
    [
      "-1.6175e-10",
      "-9.2314e-11",
      "8.8580e-12",
      "-1.7870e-11",
      "-5.9333e-11",
      "5.2706e-11",
      "3.5015e-11",
      "1.5287e-11",
      "1.1026e-10",
    ],
  );
  assert.equal(
    scaledBigIntToScientific(errors.maxAbsScaledError, 5),
    "1.6175e-10",
  );
  assert.equal(errors.maxRelativeError.toExponential(4), "2.3006e-15");
});
