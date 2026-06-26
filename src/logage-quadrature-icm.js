const DEFAULT_NODE_COUNT = 192;
const DEFAULT_PANEL_COUNT = 32;
const DEFAULT_TAIL_TOLERANCE = 1e-12;
const MAX_SEARCH_AGE_UPPER_BOUND = Number.MAX_VALUE / 4;
const SMALL_EXPOSURE_THRESHOLD = 1e-5;
const LEGENDRE_TOLERANCE = 1e-14;
const EXP_UNDERFLOW_CUTOFF = -745;
const EXP_OVERFLOW_CUTOFF = 709;

const legendreRuleCache = new Map();

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function safeDivide(numerator, denominator, fallback = 0) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : fallback;
}

function clampProbability(value) {
  return Math.min(1, Math.max(0, value));
}

function sanitizeInputs(chipCounts, payouts) {
  const stacks = chipCounts.map(Number);
  if (!stacks.length || stacks.some((stack) => !Number.isFinite(stack) || stack <= 0)) {
    throw new Error("chipCounts must contain positive numeric stack sizes.");
  }

  const activePayouts = payouts
    .map(Number)
    .filter((payout) => Number.isFinite(payout) && payout > 0)
    .sort((left, right) => right - left);
  if (!activePayouts.length) {
    throw new Error("payouts must contain at least one positive prize.");
  }

  const totalChips = sum(stacks);
  const totalPrizePool = sum(activePayouts);
  return { stacks, activePayouts, totalChips, totalPrizePool };
}

function buildUnitGaussLegendreRule(order) {
  const resolvedOrder = Math.max(4, Math.floor(Number(order) || 16));
  if (legendreRuleCache.has(resolvedOrder)) {
    return legendreRuleCache.get(resolvedOrder);
  }

  const nodes = new Float64Array(resolvedOrder);
  const weights = new Float64Array(resolvedOrder);
  const halfCount = Math.floor((resolvedOrder + 1) / 2);

  for (let index = 0; index < halfCount; index += 1) {
    let root = Math.cos(Math.PI * ((index + 0.75) / (resolvedOrder + 0.5)));
    let previousRoot = Infinity;
    let derivative = 0;

    while (Math.abs(root - previousRoot) > LEGENDRE_TOLERANCE) {
      let polynomial = 1;
      let previousPolynomial = 0;

      for (let degree = 1; degree <= resolvedOrder; degree += 1) {
        const olderPolynomial = previousPolynomial;
        previousPolynomial = polynomial;
        polynomial =
          ((((2 * degree) - 1) * root * previousPolynomial) -
            ((degree - 1) * olderPolynomial)) /
          degree;
      }

      derivative =
        (resolvedOrder * ((root * polynomial) - previousPolynomial)) /
        ((root * root) - 1);
      previousRoot = root;
      root -= polynomial / derivative;
    }

    const mirroredIndex = resolvedOrder - 1 - index;
    const mappedLeft = 0.5 * (1 - root);
    const mappedRight = 0.5 * (1 + root);
    const mappedWeight = 1 / ((1 - (root * root)) * (derivative * derivative));

    nodes[index] = mappedLeft;
    nodes[mirroredIndex] = mappedRight;
    weights[index] = mappedWeight;
    weights[mirroredIndex] = mappedWeight;
  }

  const rule = { order: resolvedOrder, nodes, weights };
  legendreRuleCache.set(resolvedOrder, rule);
  return rule;
}

function chooseSearchAgeUpperBound(relativeRates, tailTolerance) {
  const minimumRate = Math.min(...relativeRates);
  const perPlayerTolerance = Math.max(
    1e-15,
    safeDivide(tailTolerance, Math.max(1, relativeRates.length)),
  );
  const requested = Math.max(32, -Math.log(perPlayerTolerance) / minimumRate);

  return {
    searchAgeUpperBound:
      Number.isFinite(requested) && requested <= MAX_SEARCH_AGE_UPPER_BOUND
        ? requested
        : MAX_SEARCH_AGE_UPPER_BOUND,
    requestedSearchAgeUpperBound: requested,
    minimumRelativeRate: minimumRate,
  };
}

function buildCompositeLogAgeRule(nodeCount, panelCount, searchAgeUpperBound, relativeRates) {
  const nodesPerPanel = Math.max(4, Math.ceil(nodeCount / panelCount));
  const rule = buildUnitGaussLegendreRule(nodesPerPanel);
  const maximumRate = Math.max(...relativeRates);
  const firstBreak = Math.min(
    searchAgeUpperBound,
    Math.max(1e-12, 1 / (maximumRate * 64)),
  );
  const panelBreaks = [0];

  if (firstBreak < searchAgeUpperBound) {
    panelBreaks.push(firstBreak);
    const remainingPanels = Math.max(1, panelCount - 1);
    const ratio = searchAgeUpperBound / firstBreak;

    for (let panelIndex = 1; panelIndex <= remainingPanels; panelIndex += 1) {
      panelBreaks.push(firstBreak * (ratio ** (panelIndex / remainingPanels)));
    }
  } else {
    for (let panelIndex = 1; panelIndex <= panelCount; panelIndex += 1) {
      panelBreaks.push((searchAgeUpperBound * panelIndex) / panelCount);
    }
  }

  const nodes = [];
  const weights = [];
  for (let panelIndex = 0; panelIndex < panelBreaks.length - 1; panelIndex += 1) {
    const lower = Math.log1p(panelBreaks[panelIndex]);
    const upper = Math.log1p(panelBreaks[panelIndex + 1]);
    const width = upper - lower;

    for (let nodeIndex = 0; nodeIndex < rule.order; nodeIndex += 1) {
      nodes.push(lower + (width * rule.nodes[nodeIndex]));
      weights.push(width * rule.weights[nodeIndex]);
    }
  }

  return { nodes, weights, order: nodes.length, panelCount: panelBreaks.length - 1 };
}

function aheadProbability(rate, searchAge) {
  const exposure = rate * searchAge;
  if (exposure > 745) return 1;
  if (exposure < SMALL_EXPOSURE_THRESHOLD) return -Math.expm1(-exposure);
  return 1 - Math.exp(-exposure);
}

function buildPrefixStates(prefixStates, aheadProbabilities, rankLimit, playerCount) {
  prefixStates.fill(0);
  prefixStates[0] = 1;

  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
    const previousOffset = playerIndex * rankLimit;
    const nextOffset = previousOffset + rankLimit;
    const successProbability = aheadProbabilities[playerIndex];
    const failureProbability = 1 - successProbability;
    const upperRank = Math.min(rankLimit - 1, playerIndex + 1);

    prefixStates[nextOffset] = prefixStates[previousOffset] * failureProbability;

    for (let rankIndex = 1; rankIndex <= upperRank; rankIndex += 1) {
      prefixStates[nextOffset + rankIndex] =
        (prefixStates[previousOffset + rankIndex] * failureProbability) +
        (prefixStates[previousOffset + rankIndex - 1] * successProbability);
    }
  }
}

function addFullFieldNode({
  playerCount,
  rankLimit,
  payoutFractions,
  relativeRates,
  searchAge,
  logNodeWeight,
  tailBaseFraction,
  prefixStates,
  aheadProbabilities,
  adjointNext,
  adjointPrevious,
  rawEquities,
}) {
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
    aheadProbabilities[playerIndex] = aheadProbability(relativeRates[playerIndex], searchAge);
  }

  // Prefix states hold the distribution of "players ahead" after processing
  // players 0..i. A reverse adjoint pass reuses those states to recover every
  // player's leave-one-out conditional payout at this quadrature node.
  buildPrefixStates(prefixStates, aheadProbabilities, rankLimit, playerCount);
  adjointNext.set(payoutFractions);

  let nextAdjoint = adjointNext;
  let previousAdjoint = adjointPrevious;

  for (let playerIndex = playerCount - 1; playerIndex >= 0; playerIndex -= 1) {
    const previousOffset = playerIndex * rankLimit;
    let conditionalPayout = 0;

    for (let rankIndex = 0; rankIndex < rankLimit; rankIndex += 1) {
      conditionalPayout += nextAdjoint[rankIndex] * prefixStates[previousOffset + rankIndex];
    }

    const centeredPayout = conditionalPayout - tailBaseFraction;
    if (centeredPayout !== 0) {
      const contributionLog =
        logNodeWeight +
        Math.log(relativeRates[playerIndex]) -
        (relativeRates[playerIndex] * searchAge);
      const contributionWeight =
        contributionLog < EXP_UNDERFLOW_CUTOFF
          ? 0
          : Math.exp(Math.min(EXP_OVERFLOW_CUTOFF, contributionLog));
      rawEquities[playerIndex] += contributionWeight * centeredPayout;
    }

    const successProbability = aheadProbabilities[playerIndex];
    const failureProbability = 1 - successProbability;
    previousAdjoint[rankLimit - 1] = nextAdjoint[rankLimit - 1] * failureProbability;

    for (let rankIndex = rankLimit - 2; rankIndex >= 0; rankIndex -= 1) {
      previousAdjoint[rankIndex] =
        (nextAdjoint[rankIndex] * failureProbability) +
        (nextAdjoint[rankIndex + 1] * successProbability);
    }

    const swap = nextAdjoint;
    nextAdjoint = previousAdjoint;
    previousAdjoint = swap;
  }
}

function buildLeaveOneOutDistribution(distribution, aheadProbabilities, targetIndex, rankLimit) {
  distribution.fill(0);
  distribution[0] = 1;
  let processedPlayers = 0;

  for (let playerIndex = 0; playerIndex < aheadProbabilities.length; playerIndex += 1) {
    if (playerIndex === targetIndex) continue;

    const successProbability = aheadProbabilities[playerIndex];
    const failureProbability = 1 - successProbability;
    const upperRank = Math.min(rankLimit - 1, processedPlayers + 1);

    for (let rankIndex = upperRank; rankIndex >= 1; rankIndex -= 1) {
      distribution[rankIndex] =
        (distribution[rankIndex] * failureProbability) +
        (distribution[rankIndex - 1] * successProbability);
    }
    distribution[0] *= failureProbability;
    processedPlayers += 1;
  }
}

function normalizeEquities(rawEquities) {
  const clamped = Array.from(rawEquities, clampProbability);
  const total = sum(clamped);
  if (total <= 0) return clamped;
  return clamped.map((equity) => equity / total);
}

function buildContext(chipCounts, payouts, options = {}) {
  const { stacks, activePayouts, totalChips, totalPrizePool } =
    sanitizeInputs(chipCounts, payouts);
  const playerCount = stacks.length;
  const rankLimit = Math.min(playerCount, activePayouts.length);
  const nodeCount = Math.max(48, Math.floor(options.logAgeNodeCount || DEFAULT_NODE_COUNT));
  const panelCount = Math.max(4, Math.floor(options.logAgePanelCount || DEFAULT_PANEL_COUNT));
  const tailTolerance = Math.max(1e-15, Number(options.tailTolerance) || DEFAULT_TAIL_TOLERANCE);
  const chipFractions = stacks.map((stack) => stack / totalChips);
  const relativeRates = Float64Array.from(
    chipFractions.map((chipFraction) => chipFraction * playerCount),
  );
  const payoutFractions = Float64Array.from(
    activePayouts.slice(0, rankLimit).map((payout) => payout / totalPrizePool),
  );
  const tailBaseFraction =
    rankLimit === playerCount
      ? safeDivide(activePayouts[rankLimit - 1], totalPrizePool)
      : 0;
  const upperBound = chooseSearchAgeUpperBound(relativeRates, tailTolerance);
  const quadratureRule = buildCompositeLogAgeRule(
    nodeCount,
    panelCount,
    upperBound.searchAgeUpperBound,
    relativeRates,
  );

  return {
    stacks,
    activePayouts,
    totalChips,
    totalPrizePool,
    playerCount,
    rankLimit,
    nodeCount,
    panelCount,
    tailTolerance,
    chipFractions,
    relativeRates,
    payoutFractions,
    tailBaseFraction,
    upperBound,
    quadratureRule,
  };
}

function formatPlayerResult({
  index,
  stack,
  chipFraction,
  equity,
  totalPrizePool,
}) {
  return {
    playerIndex: index + 1,
    chips: stack,
    chipFraction,
    equity,
    value: equity * totalPrizePool,
  };
}

export function solveLogageQuadratureIcm(chipCounts, payouts, options = {}) {
  const context = buildContext(chipCounts, payouts, options);
  const {
    stacks,
    totalPrizePool,
    playerCount,
    rankLimit,
    chipFractions,
    relativeRates,
    payoutFractions,
    tailBaseFraction,
    quadratureRule,
  } = context;
  const rawEquities = new Float64Array(playerCount);
  const aheadProbabilities = new Float64Array(playerCount);
  const prefixStates = new Float64Array((playerCount + 1) * rankLimit);
  const adjointNext = new Float64Array(rankLimit);
  const adjointPrevious = new Float64Array(rankLimit);

  if (tailBaseFraction) {
    rawEquities.fill(tailBaseFraction);
  }

  for (let nodeIndex = 0; nodeIndex < quadratureRule.order; nodeIndex += 1) {
    const logAge = quadratureRule.nodes[nodeIndex];
    const searchAge = Math.expm1(logAge);
    const logNodeWeight = Math.log(quadratureRule.weights[nodeIndex]) + logAge;

    addFullFieldNode({
      playerCount,
      rankLimit,
      payoutFractions,
      relativeRates,
      searchAge,
      logNodeWeight,
      tailBaseFraction,
      prefixStates,
      aheadProbabilities,
      adjointNext,
      adjointPrevious,
      rawEquities,
    });
  }

  const equities = normalizeEquities(rawEquities);
  const players = equities.map((equity, index) =>
    formatPlayerResult({
      index,
      stack: stacks[index],
      chipFraction: chipFractions[index],
      equity,
      totalPrizePool,
    }),
  );

  return {
    model: "Logage Quadrature ICM",
    totalPrizePool,
    players,
    metadata: {
      logAgeNodeCount: context.nodeCount,
      logAgePanelCount: context.panelCount,
      quadratureNodes: quadratureRule.order,
      paidRanks: rankLimit,
      searchAgeUpperBound: context.upperBound.searchAgeUpperBound,
      normalizedEquitySum: sum(equities),
    },
  };
}

export function solvePlayerLogageQuadratureIcm(
  chipCounts,
  payouts,
  targetPlayerIndex,
  options = {},
) {
  const context = buildContext(chipCounts, payouts, options);
  const {
    stacks,
    totalPrizePool,
    playerCount,
    rankLimit,
    chipFractions,
    relativeRates,
    payoutFractions,
    tailBaseFraction,
    quadratureRule,
  } = context;
  const targetIndex = Number(targetPlayerIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= playerCount) {
    throw new Error("targetPlayerIndex must be a zero-based index into chipCounts.");
  }

  const aheadProbabilities = new Float64Array(playerCount);
  const distribution = new Float64Array(rankLimit);
  let rawEquity = tailBaseFraction || 0;

  for (let nodeIndex = 0; nodeIndex < quadratureRule.order; nodeIndex += 1) {
    const logAge = quadratureRule.nodes[nodeIndex];
    const searchAge = Math.expm1(logAge);
    const logNodeWeight = Math.log(quadratureRule.weights[nodeIndex]) + logAge;

    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      aheadProbabilities[playerIndex] = aheadProbability(relativeRates[playerIndex], searchAge);
    }

    buildLeaveOneOutDistribution(distribution, aheadProbabilities, targetIndex, rankLimit);

    let conditionalPayout = 0;
    for (let rankIndex = 0; rankIndex < rankLimit; rankIndex += 1) {
      conditionalPayout += distribution[rankIndex] * payoutFractions[rankIndex];
    }

    const centeredPayout = conditionalPayout - tailBaseFraction;
    if (centeredPayout !== 0) {
      const contributionLog =
        logNodeWeight +
        Math.log(relativeRates[targetIndex]) -
        (relativeRates[targetIndex] * searchAge);
      const contributionWeight =
        contributionLog < EXP_UNDERFLOW_CUTOFF
          ? 0
          : Math.exp(Math.min(EXP_OVERFLOW_CUTOFF, contributionLog));
      rawEquity += contributionWeight * centeredPayout;
    }
  }

  const equity = clampProbability(rawEquity);
  return {
    model: "Logage Quadrature ICM",
    totalPrizePool,
    player: formatPlayerResult({
      index: targetIndex,
      stack: stacks[targetIndex],
      chipFraction: chipFractions[targetIndex],
      equity,
      totalPrizePool,
    }),
    metadata: {
      logAgeNodeCount: context.nodeCount,
      logAgePanelCount: context.panelCount,
      quadratureNodes: quadratureRule.order,
      paidRanks: rankLimit,
      searchAgeUpperBound: context.upperBound.searchAgeUpperBound,
      normalization: "target-only raw equity",
    },
  };
}

