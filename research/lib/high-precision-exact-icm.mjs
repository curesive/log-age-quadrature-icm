export const EXACT_SCALE_DIGITS = 50;
export const EXACT_SCALE = 10n ** BigInt(EXACT_SCALE_DIGITS);
const EXACT_SCALE_NUMBER = 10 ** EXACT_SCALE_DIGITS;

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function validateIntegerList(values, label, { allowZero = false } = {}) {
  return values.map((value, index) => {
    const number = Number(value);
    const minimum = allowZero ? 0 : 1;
    if (!Number.isSafeInteger(number) || number < minimum) {
      throw new RangeError(`${label}[${index}] must be a safe integer >= ${minimum}`);
    }
    return number;
  });
}

// Malmuth-Harville finish-order recursion with orderings that share the same
// prior finishers combined into one subset state. Probabilities use 50-decimal
// fixed-point BigInt arithmetic, making truncation negligible at the precision
// reported in the paper.
export function exactMalmuthHarvilleIcmHighPrecision(chipCounts, payouts) {
  const stacks = validateIntegerList(chipCounts, "chipCounts");
  const prizes = validateIntegerList(payouts, "payouts", { allowZero: true })
    .slice(0, stacks.length);
  const playerCount = stacks.length;
  if (playerCount > 20) {
    throw new RangeError("high-precision subset recursion supports at most 20 players");
  }

  const rankLimit = Math.min(playerCount, prizes.length);
  const stateCount = 1 << playerCount;
  const totalChips = sum(stacks);
  const stackSums = new Float64Array(stateCount);
  const stateProbabilities = Array.from({ length: stateCount }, () => 0n);
  const scaledEquities = Array.from({ length: playerCount }, () => 0n);
  const ranks = new Uint8Array(stateCount);
  stateProbabilities[0] = EXACT_SCALE;

  for (let mask = 1; mask < stateCount; mask += 1) {
    const leastBit = mask & -mask;
    const playerIndex = 31 - Math.clz32(leastBit);
    const previousMask = mask ^ leastBit;
    stackSums[mask] = stackSums[previousMask] + stacks[playerIndex];
    ranks[mask] = ranks[previousMask] + 1;
  }

  for (let mask = 0; mask < stateCount - 1; mask += 1) {
    const rank = ranks[mask];
    if (rank >= rankLimit) continue;

    const remainingChips = BigInt(totalChips - stackSums[mask]);
    const stateProbability = stateProbabilities[mask];
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const playerBit = 1 << playerIndex;
      if (mask & playerBit) continue;

      const branchProbability = (
        stateProbability * BigInt(stacks[playerIndex])
      ) / remainingChips;
      scaledEquities[playerIndex] += branchProbability * BigInt(prizes[rank]);
      stateProbabilities[mask | playerBit] += branchProbability;
    }
  }

  const scaledPrizePool = BigInt(sum(prizes)) * EXACT_SCALE;
  const scaledEquitySum = scaledEquities.reduce(
    (total, value) => total + value,
    0n,
  );
  return {
    method:
      "Malmuth-Harville finish-order recursion aggregated by prior-finisher subset using 50-decimal fixed-point arithmetic",
    scaleDigits: EXACT_SCALE_DIGITS,
    scaledEquities,
    values: scaledEquities.map((value) => Number(value) / EXACT_SCALE_NUMBER),
    prizePoolResidual:
      Number(scaledEquitySum - scaledPrizePool) / EXACT_SCALE_NUMBER,
  };
}

// Convert a binary64 value to the same fixed-point scale without first
// rounding it through a short decimal string. This preserves the last-place
// bits needed to measure sub-nanodollar differences faithfully.
export function binary64ToScaledBigInt(value) {
  if (!Number.isFinite(value)) {
    throw new RangeError("value must be finite");
  }
  if (Object.is(value, -0) || value === 0) return 0n;

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const sign = (bits >> 63n) === 0n ? 1n : -1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponentBits === 0
    ? fraction
    : (1n << 52n) | fraction;
  const binaryExponent = exponentBits === 0
    ? -1022 - 52
    : exponentBits - 1023 - 52;

  let scaled = mantissa * EXACT_SCALE;
  if (binaryExponent >= 0) {
    scaled <<= BigInt(binaryExponent);
  } else {
    scaled /= 1n << BigInt(-binaryExponent);
  }
  return sign * scaled;
}

export function scaledBigIntToDecimal(value, fractionDigits = 12) {
  if (!Number.isInteger(fractionDigits)
      || fractionDigits < 0
      || fractionDigits > EXACT_SCALE_DIGITS) {
    throw new RangeError(`fractionDigits must be between 0 and ${EXACT_SCALE_DIGITS}`);
  }

  const negative = value < 0n;
  let magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(EXACT_SCALE_DIGITS - fractionDigits);
  let rounded = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) rounded += 1n;

  if (fractionDigits === 0) {
    return `${negative ? "-" : ""}${rounded}`;
  }
  const digits = rounded.toString().padStart(fractionDigits + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -fractionDigits)}.${digits.slice(-fractionDigits)}`;
}

export function scaledBigIntToScientific(value, significantDigits = 5) {
  if (!Number.isInteger(significantDigits) || significantDigits < 1) {
    throw new RangeError("significantDigits must be a positive integer");
  }
  if (value === 0n) {
    return significantDigits === 1
      ? "0e+0"
      : `0.${"0".repeat(significantDigits - 1)}e+0`;
  }

  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const fullDigits = magnitude.toString().padStart(EXACT_SCALE_DIGITS + 1, "0");
  const integerDigits = fullDigits.slice(0, -EXACT_SCALE_DIGITS);
  const fractionalDigits = fullDigits.slice(-EXACT_SCALE_DIGITS);
  let exponent;
  let significantSource;
  if (integerDigits !== "0") {
    exponent = integerDigits.length - 1;
    significantSource = integerDigits + fractionalDigits;
  } else {
    const firstNonzero = fractionalDigits.search(/[1-9]/);
    exponent = -(firstNonzero + 1);
    significantSource = fractionalDigits.slice(firstNonzero);
  }

  const roundingSource = significantSource
    .slice(0, significantDigits + 1)
    .padEnd(significantDigits + 1, "0");
  let rounded = BigInt(roundingSource.slice(0, significantDigits));
  if (Number(roundingSource[significantDigits]) >= 5) rounded += 1n;
  let roundedDigits = rounded.toString();
  if (roundedDigits.length > significantDigits) {
    exponent += 1;
    roundedDigits = roundedDigits.slice(0, significantDigits);
  }
  roundedDigits = roundedDigits.padStart(significantDigits, "0");

  const coefficient = significantDigits === 1
    ? roundedDigits
    : `${roundedDigits[0]}.${roundedDigits.slice(1)}`;
  return `${negative ? "-" : ""}${coefficient}e${exponent >= 0 ? "+" : ""}${exponent}`;
}

export function highPrecisionErrorSummary(values, scaledReference) {
  if (values.length !== scaledReference.length) {
    throw new RangeError("values and scaledReference must have equal length");
  }
  const scaledErrors = values.map(
    (value, index) => binary64ToScaledBigInt(value) - scaledReference[index],
  );
  const errors = scaledErrors.map((value) => Number(value) / EXACT_SCALE_NUMBER);
  const absoluteScaledErrors = scaledErrors.map((value) => (
    value < 0n ? -value : value
  ));
  const maxAbsScaledError = absoluteScaledErrors.reduce(
    (maximum, value) => (value > maximum ? value : maximum),
    0n,
  );
  const relativeErrors = absoluteScaledErrors.map(
    (value, index) => Number(value) / Number(scaledReference[index]),
  );

  return {
    errors,
    scaledErrors,
    maxAbsScaledError,
    maxAbsDollarError: Number(maxAbsScaledError) / EXACT_SCALE_NUMBER,
    meanAbsDollarError:
      errors.reduce((total, value) => total + Math.abs(value), 0) / errors.length,
    rootMeanSquareDollarError: Math.sqrt(
      errors.reduce((total, value) => total + (value * value), 0) / errors.length,
    ),
    maxRelativeError: Math.max(...relativeErrors),
  };
}
