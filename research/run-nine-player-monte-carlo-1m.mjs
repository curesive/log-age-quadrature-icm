import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const scenario = {
  label: "9-player realistic final-table example",
  chipCounts: [
    1_500_000, 900_000, 700_000, 500_000, 400_000,
    350_000, 300_000, 250_000, 100_000,
  ],
  payouts: [
    180_000, 150_000, 120_000, 90_000, 70_000,
    55_000, 45_000, 38_000, 32_000,
  ],
  exactValues: [
    132036.56256462124,
    111705.71638965656,
    101729.08634054984,
    89047.48638311877,
    81290.13148848776,
    76947.22478496056,
    72232.68096799942,
    67082.91575923478,
    47928.19532137181,
  ],
};

const trials = 1_000_000;
const batches = 2;
const seed = 0x51a7c0de;

function rotateLeft(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function splitmix32(initialSeed) {
  let state = initialSeed >>> 0;
  return function nextUint32() {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
}

function xoshiro128StarStar(initialSeed) {
  const seedState = splitmix32(initialSeed);
  let state0 = seedState();
  let state1 = seedState();
  let state2 = seedState();
  let state3 = seedState();

  return function random() {
    const result = Math.imul(rotateLeft(Math.imul(state1, 5), 7), 9) >>> 0;
    const temporary = (state1 << 9) >>> 0;
    state2 ^= state0;
    state3 ^= state1;
    state1 ^= state2;
    state0 ^= state3;
    state2 ^= temporary;
    state3 = rotateLeft(state3, 11);
    return (result + 0.5) / 4_294_967_296;
  };
}

const times = new Float64Array(scenario.chipCounts.length);
const sums = new Float64Array(scenario.chipCounts.length);
const squareSums = new Float64Array(scenario.chipCounts.length);
const batchMeans = Array.from({ length: scenario.chipCounts.length }, () => []);
const trialsPerBatch = trials / batches;

const startedAt = performance.now();
for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
  const random = xoshiro128StarStar((seed + Math.imul(batchIndex, 0x9e3779b1)) >>> 0);
  const batchSums = new Float64Array(scenario.chipCounts.length);

  for (let trial = 0; trial < trialsPerBatch; trial += 1) {
    for (let playerIndex = 0; playerIndex < scenario.chipCounts.length; playerIndex += 1) {
      times[playerIndex] = -Math.log(random()) / scenario.chipCounts[playerIndex];
    }

    for (let targetIndex = 0; targetIndex < scenario.chipCounts.length; targetIndex += 1) {
      let playersAhead = 0;
      for (let playerIndex = 0; playerIndex < times.length; playerIndex += 1) {
        if (playerIndex !== targetIndex && times[playerIndex] < times[targetIndex]) {
          playersAhead += 1;
        }
      }

      const payout = scenario.payouts[playersAhead];
      batchSums[targetIndex] += payout;
      sums[targetIndex] += payout;
      squareSums[targetIndex] += payout * payout;
    }
  }

  for (let playerIndex = 0; playerIndex < scenario.chipCounts.length; playerIndex += 1) {
    batchMeans[playerIndex].push(batchSums[playerIndex] / trialsPerBatch);
  }
}
const runtimeMs = performance.now() - startedAt;

const players = scenario.chipCounts.map((chips, index) => {
  const mean = sums[index] / trials;
  const variance = Math.max(
    0,
    (squareSums[index] - ((sums[index] ** 2) / trials)) / (trials - 1),
  );
  const standardError = Math.sqrt(variance / trials);
  const margin95 = 1.96 * standardError;
  const error = mean - scenario.exactValues[index];

  return {
    playerIndex: index + 1,
    chips,
    exactValue: scenario.exactValues[index],
    mean,
    error,
    absoluteError: Math.abs(error),
    relativeAbsoluteError: Math.abs(error) / scenario.exactValues[index],
    standardError,
    margin95,
    ci95Low: mean - margin95,
    ci95High: mean + margin95,
    exactInsideCi95: Math.abs(error) <= margin95,
    batchMeans: batchMeans[index],
  };
});

const rootMeanSquareDollarError = Math.sqrt(
  players.reduce((total, player) => total + (player.error ** 2), 0) / players.length,
);
const results = {
  generatedAt: new Date().toISOString(),
  scenario,
  method: "serial exponential-race Monte Carlo",
  prng: "xoshiro128** with SplitMix32 seeding",
  trials,
  batches,
  seed,
  runtimeMs,
  summary: {
    maxAbsDollarError: Math.max(...players.map((player) => player.absoluteError)),
    rootMeanSquareDollarError,
    maxRelativeAbsoluteError: Math.max(
      ...players.map((player) => player.relativeAbsoluteError),
    ),
    ci95Coverage: `${players.filter((player) => player.exactInsideCi95).length}/9`,
    minimumMargin95: Math.min(...players.map((player) => player.margin95)),
    maximumMargin95: Math.max(...players.map((player) => player.margin95)),
  },
  players,
};

await writeFile(
  new URL("./results/nine_player_monte_carlo_1m.json", import.meta.url),
  `${JSON.stringify(results, null, 2)}\n`,
);

console.log(JSON.stringify(results.summary, null, 2));
console.log(`Runtime: ${runtimeMs.toFixed(3)} ms`);
