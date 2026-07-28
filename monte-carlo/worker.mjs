const UINT32_SCALE = 4_294_967_296;
let workerScenario = null;

function rotateLeft(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function createXoshiro128StarStar(seedWords) {
  let state0 = seedWords[0] >>> 0;
  let state1 = seedWords[1] >>> 0;
  let state2 = seedWords[2] >>> 0;
  let state3 = seedWords[3] >>> 0;

  if ((state0 | state1 | state2 | state3) === 0) {
    state0 = 0x9e3779b9;
  }

  return function random() {
    const result = Math.imul(rotateLeft(Math.imul(state1, 5), 7), 9) >>> 0;
    const temporary = (state1 << 9) >>> 0;
    state2 ^= state0;
    state3 ^= state1;
    state1 ^= state2;
    state0 ^= state3;
    state2 ^= temporary;
    state3 = rotateLeft(state3, 11);
    return (result + 0.5) / UINT32_SCALE;
  };
}

function runTask({ seedWords, trialLimit, deadlineEpochMs }) {
  if (!workerScenario) throw new Error("Worker received a task before initialization.");
  const { chipCounts, payouts } = workerScenario;
  const playerCount = chipCounts.length;
  const paidRankCount = payouts.length;
  const random = createXoshiro128StarStar(seedWords);
  const finishTimes = new Float64Array(playerCount);
  const playerOrder = Array.from({ length: playerCount }, (_, index) => index);
  const sums = new Float64Array(playerCount);
  const squareSums = new Float64Array(playerCount);
  const deadlineCheckInterval = playerCount >= 1_000 ? 1 : playerCount >= 100 ? 8 : 64;
  const startedAt = performance.now();
  let completedTrials = 0;

  while (completedTrials < trialLimit) {
    if (
      deadlineEpochMs &&
      completedTrials % deadlineCheckInterval === 0 &&
      Date.now() >= deadlineEpochMs
    ) {
      break;
    }

    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      finishTimes[playerIndex] = -Math.log(random()) / chipCounts[playerIndex];
    }

    playerOrder.sort((left, right) => {
      const difference = finishTimes[left] - finishTimes[right];
      return difference || left - right;
    });

    for (let rankIndex = 0; rankIndex < paidRankCount; rankIndex += 1) {
      const payout = payouts[rankIndex];
      const playerIndex = playerOrder[rankIndex];
      sums[playerIndex] += payout;
      squareSums[playerIndex] += payout * payout;
    }

    completedTrials += 1;
  }

  return {
    completedTrials,
    runtimeMs: performance.now() - startedAt,
    sums: Array.from(sums),
    squareSums: Array.from(squareSums),
  };
}

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "shutdown") {
    process.disconnect();
    return;
  }

  if (message.type === "initialize") {
    const chipCounts = Float64Array.from(message.scenario?.chipCounts || []);
    const payouts = Float64Array.from(message.scenario?.payouts || []);
    if (chipCounts.length === 0 || payouts.length === 0) {
      throw new Error("Worker initialization requires chip counts and payouts.");
    }
    workerScenario = { chipCounts, payouts };
    process.send?.({ type: "initialized" });
    return;
  }

  if (message.type !== "run") return;

  try {
    const result = runTask(message.task);
    process.send?.({
      type: "result",
      taskId: message.task.taskId,
      ...result,
    });
  } catch (error) {
    process.send?.({
      type: "task-error",
      taskId: message.task.taskId,
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
  }
});

process.on("disconnect", () => process.exit(0));
process.send?.({ type: "ready" });
