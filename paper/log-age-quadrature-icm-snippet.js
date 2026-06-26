// Paper-ready reference snippet for Log-Age Quadrature ICM.
//
// This version favors clarity over speed. It computes each player's equity
// independently with a leave-one-out rank distribution. The web app uses a
// faster full-field adjoint implementation, but the mathematical ingredients
// are the same: exponential race rates, conditioning on search age, a product
// polynomial for rank probabilities, and Gauss-Legendre quadrature over
// log search age.

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function gaussLegendreUnitRule(order) {
  const nodes = new Float64Array(order);
  const weights = new Float64Array(order);
  const halfCount = Math.floor((order + 1) / 2);

  for (let i = 0; i < halfCount; i += 1) {
    let x = Math.cos(Math.PI * ((i + 0.75) / (order + 0.5)));
    let previous = Infinity;
    let derivative = 0;

    while (Math.abs(x - previous) > 1e-14) {
      let p = 1;
      let pPrev = 0;
      for (let degree = 1; degree <= order; degree += 1) {
        const pOlder = pPrev;
        pPrev = p;
        p = ((((2 * degree) - 1) * x * pPrev) - ((degree - 1) * pOlder)) / degree;
      }
      derivative = (order * ((x * p) - pPrev)) / ((x * x) - 1);
      previous = x;
      x -= p / derivative;
    }

    const j = order - 1 - i;
    nodes[i] = 0.5 * (1 - x);
    nodes[j] = 0.5 * (1 + x);
    weights[i] = 1 / ((1 - (x * x)) * (derivative * derivative));
    weights[j] = weights[i];
  }

  return { nodes, weights, order };
}

function buildLogAgeQuadrature(relativeRates, nodeCount = 192, panelCount = 32) {
  const minRate = Math.min(...relativeRates);
  const maxRate = Math.max(...relativeRates);
  const searchAgeUpper = Math.max(32, -Math.log(1e-12 / relativeRates.length) / minRate);
  const firstBreak = Math.min(searchAgeUpper, Math.max(1e-12, 1 / (maxRate * 64)));
  const panelBreaks = [0, firstBreak];
  const remainingPanels = Math.max(1, panelCount - 1);
  const ratio = searchAgeUpper / firstBreak;

  for (let panel = 1; panel <= remainingPanels; panel += 1) {
    panelBreaks.push(firstBreak * (ratio ** (panel / remainingPanels)));
  }

  const rule = gaussLegendreUnitRule(Math.max(4, Math.ceil(nodeCount / panelCount)));
  const nodes = [];
  const weights = [];

  for (let panel = 0; panel < panelBreaks.length - 1; panel += 1) {
    const lower = Math.log1p(panelBreaks[panel]);
    const upper = Math.log1p(panelBreaks[panel + 1]);
    const width = upper - lower;

    for (let i = 0; i < rule.order; i += 1) {
      nodes.push(lower + (width * rule.nodes[i]));
      weights.push(width * rule.weights[i]);
    }
  }

  return { nodes, weights, searchAgeUpper };
}

function aheadProbability(relativeRate, searchAge) {
  const exposure = relativeRate * searchAge;
  if (exposure > 745) return 1;
  if (exposure < 1e-5) return -Math.expm1(-exposure);
  return 1 - Math.exp(-exposure);
}

function leaveOneOutRankDistribution(aheadProbabilities, targetIndex, rankLimit) {
  // distribution[k] is the probability that exactly k other players finish
  // ahead of the target at this search age. Multiplying factors of the form
  // (1 - q_j) + q_j z gives this product-polynomial distribution.
  const distribution = new Float64Array(rankLimit);
  distribution[0] = 1;
  let processed = 0;

  for (let playerIndex = 0; playerIndex < aheadProbabilities.length; playerIndex += 1) {
    if (playerIndex === targetIndex) continue;

    const q = aheadProbabilities[playerIndex];
    const notQ = 1 - q;
    const upperRank = Math.min(rankLimit - 1, processed + 1);

    for (let k = upperRank; k >= 1; k -= 1) {
      distribution[k] = (distribution[k] * notQ) + (distribution[k - 1] * q);
    }
    distribution[0] *= notQ;
    processed += 1;
  }

  return distribution;
}

function normalize(equities) {
  const clamped = equities.map((value) => Math.min(1, Math.max(0, value)));
  const total = sum(clamped);
  return total > 0 ? clamped.map((value) => value / total) : clamped;
}

export function logAgeQuadratureIcm(chipCounts, payoutList, options = {}) {
  const stacks = chipCounts.map(Number);
  const payouts = payoutList
    .map(Number)
    .filter((payout) => Number.isFinite(payout) && payout > 0)
    .sort((a, b) => b - a);
  const playerCount = stacks.length;
  const totalChips = sum(stacks);
  const totalPrizePool = sum(payouts);
  const rankLimit = Math.min(playerCount, payouts.length);
  const chipFractions = stacks.map((stack) => stack / totalChips);
  const relativeRates = chipFractions.map((fraction) => fraction * playerCount);
  const payoutFractions = payouts.slice(0, rankLimit).map((payout) => payout / totalPrizePool);
  const tailBase =
    rankLimit === playerCount
      ? payouts[rankLimit - 1] / totalPrizePool
      : 0;
  const quadrature = buildLogAgeQuadrature(
    relativeRates,
    options.logAgeNodeCount || 192,
    options.logAgePanelCount || 32,
  );
  const rawEquities = Array.from({ length: playerCount }, () => tailBase);
  const aheadProbabilities = new Float64Array(playerCount);

  for (let targetIndex = 0; targetIndex < playerCount; targetIndex += 1) {
    for (let nodeIndex = 0; nodeIndex < quadrature.nodes.length; nodeIndex += 1) {
      const logAge = quadrature.nodes[nodeIndex];
      const searchAge = Math.expm1(logAge);
      const logNodeWeight = Math.log(quadrature.weights[nodeIndex]) + logAge;

      for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
        aheadProbabilities[playerIndex] = aheadProbability(
          relativeRates[playerIndex],
          searchAge,
        );
      }

      const distribution = leaveOneOutRankDistribution(
        aheadProbabilities,
        targetIndex,
        rankLimit,
      );
      let conditionalPayout = 0;
      for (let rank = 0; rank < rankLimit; rank += 1) {
        conditionalPayout += distribution[rank] * payoutFractions[rank];
      }

      // Transforming y = exp(u) - 1 adds exp(u) to the quadrature weight.
      // The target's race density contributes lambda_i * exp(-lambda_i y).
      const centeredPayout = conditionalPayout - tailBase;
      const contributionLog =
        logNodeWeight +
        Math.log(relativeRates[targetIndex]) -
        (relativeRates[targetIndex] * searchAge);
      rawEquities[targetIndex] +=
        Math.exp(Math.max(-745, Math.min(709, contributionLog))) * centeredPayout;
    }
  }

  const equities = normalize(rawEquities);
  return equities.map((equity, index) => ({
    playerIndex: index + 1,
    chips: stacks[index],
    equity,
    value: equity * totalPrizePool,
  }));
}

