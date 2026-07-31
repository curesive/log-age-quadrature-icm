import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { solveLogAgeQuadratureIcm } from "../src/log-age-quadrature-icm.js";
import {
  binary64ToScaledBigInt,
  exactMalmuthHarvilleIcmHighPrecision,
  scaledBigIntToDecimal,
  scaledBigIntToScientific,
} from "./lib/high-precision-exact-icm.mjs";

const coreResultsUrl = new URL(
  "./results/core_validation_results.json",
  import.meta.url,
);
const coreTablesUrl = new URL(
  "./results/core_validation_tables.md",
  import.meta.url,
);
const core = JSON.parse(await readFile(coreResultsUrl, "utf8"));
const tables = await readFile(coreTablesUrl, "utf8");
const { chipCounts, payouts } = core.ninePlayer.scenario;

const exact = exactMalmuthHarvilleIcmHighPrecision(chipCounts, payouts);
const laqi = solveLogAgeQuadratureIcm(chipCounts, payouts, {
  logAgeNodeCount: 192,
  logAgePanelCount: 32,
  tailTolerance: 1e-12,
}).players.map((player) => player.value);

const expectedExactDecimals = exact.scaledEquities.map(
  (value) => scaledBigIntToDecimal(value, 15),
);
const canonicalLaqiScaled = core.ninePlayer.laqiValues.map(
  binary64ToScaledBigInt,
);
const canonicalScaledErrors = canonicalLaqiScaled.map(
  (value, index) => value - exact.scaledEquities[index],
);
const expectedErrorScientific = canonicalScaledErrors.map(
  (value) => scaledBigIntToScientific(value, 5),
);
const maximumCanonicalScaledError = canonicalScaledErrors.reduce(
  (maximum, value) => {
    const magnitude = value < 0n ? -value : value;
    return magnitude > maximum ? magnitude : maximum;
  },
  0n,
);
const expectedMaximumScientific = scaledBigIntToScientific(
  maximumCanonicalScaledError,
  5,
);
const expectedMaximumRelativeError = Math.max(
  ...canonicalScaledErrors.map((value, index) => (
    Number(value < 0n ? -value : value)
    / Number(exact.scaledEquities[index])
  )),
);

assert.deepEqual(
  core.ninePlayer.exactValueDecimalStrings,
  expectedExactDecimals,
  "checked-in high-precision exact values are stale",
);
for (let index = 0; index < laqi.length; index += 1) {
  const canonicalValue = core.ninePlayer.laqiValues[index];
  const crossRuntimeTolerance = (
    2 * Number.EPSILON * Math.max(1, Math.abs(canonicalValue))
  );
  assert.ok(
    Math.abs(laqi[index] - canonicalValue) <= crossRuntimeTolerance,
    `runtime LAQI value for player ${index + 1} differs from the canonical Node.js 24 value`,
  );
}
assert.deepEqual(
  core.ninePlayer.error.laqiVsExact.errorsScientific,
  expectedErrorScientific,
  "checked-in player differences are stale",
);
assert.equal(
  core.ninePlayer.error.laqiVsExact.maxAbsDollarErrorScientific,
  expectedMaximumScientific,
  "checked-in maximum difference is stale",
);
assert.equal(
  core.ninePlayer.error.laqiVsExact.maxRelativeError.toExponential(4),
  expectedMaximumRelativeError.toExponential(4),
  "checked-in maximum relative difference is stale",
);

assert.match(
  tables,
  /\| 3 \| 700,000 \| 101729\.086340549830 \| 101729\.086340549838 \| 8\.8580e-12 \|/,
  "Table 1 player 3 does not contain the high-precision difference",
);
assert.match(
  tables,
  /Maximum absolute LAQI error: 1\.6175e-10 dollars\./,
  "Table 1 maximum error does not contain the high-precision value",
);

console.log(JSON.stringify({
  verified: true,
  players: chipCounts.length,
  maximumAbsoluteDifference: expectedMaximumScientific,
  playerThreeAbsoluteDifference:
    expectedErrorScientific[2].replace(/^-/, ""),
}, null, 2));
