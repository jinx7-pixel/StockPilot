/**
 * Exact decimal arithmetic.
 *
 * The Stock Risk Engine multiplies and compares quantities, and the project's
 * rule is that authoritative numeric work happens in `numeric`, never in a
 * JavaScript float. Values arrive from PostgreSQL as decimal *strings*; this
 * module lets the engine compare and combine them without ever producing a
 * float.
 *
 * A value is represented as a `bigint` scaled by 10^`SCALE`. Every decimal the
 * engine handles is rounded in SQL to at most four places, well inside that
 * resolution, so nothing is lost.
 *
 * ## Scale matters
 *
 * `multiply` and `divide` take two **scaled** operands and return a scaled
 * result. Composing scaled values without dividing the extra scale out is the
 * classic mistake here: 18 ÷ 6 would otherwise return 0.000003 rather than 3.
 */

/** Working resolution. Larger than the four decimal places the engine produces. */
export const SCALE = 6;

const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** Raised when a value cannot be read as a decimal — corrupt data, not a risk. */
export class InvalidDecimalError extends Error {
  constructor(value: unknown) {
    super(`Not a finite decimal: ${String(value)}`);
    this.name = 'InvalidDecimalError';
  }
}

/**
 * Parse a decimal string (or a safe integer) into a scaled `bigint`.
 *
 * Rejects `NaN`, `Infinity`, exponent notation and empty input, so a corrupt
 * value surfaces as an error rather than silently becoming zero.
 */
export function toScaled(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidDecimalError(value);
    // Safe integers only; anything with a fraction must arrive as a string.
    if (!Number.isInteger(value)) throw new InvalidDecimalError(value);
    return BigInt(value) * SCALE_FACTOR;
  }

  const trimmed = value.trim();
  if (trimmed === '' || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidDecimalError(value);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const padded = fraction.padEnd(SCALE, '0').slice(0, SCALE);

  const magnitude = BigInt(`${whole}${padded}`);
  return negative ? -magnitude : magnitude;
}

/** Render a scaled `bigint` back to a decimal string, trimmed to `decimals`. */
export function fromScaled(scaled: bigint, decimals = 2): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, digits.length - SCALE);
  const fraction = digits.slice(digits.length - SCALE, digits.length - SCALE + decimals);

  const rendered = decimals > 0 ? `${whole}.${fraction}` : whole;
  return negative && scaled !== 0n ? `-${rendered}` : rendered;
}

/** Round half away from zero, matching NUMERIC's behaviour. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n) return quotient;

  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const magnitude = denominator < 0n ? -denominator : denominator;
  const adjustment = twiceRemainder >= magnitude ? 1n : 0n;

  return quotient + (numerator < 0n ? -adjustment : adjustment);
}

/**
 * Multiply two scaled values, keeping the result scaled.
 *
 * `(a·b) / 10^SCALE` removes the doubled scale.
 */
export function multiply(a: bigint, b: bigint): bigint {
  return divideRounded(a * b, SCALE_FACTOR);
}

/**
 * Divide two scaled values, keeping the result scaled.
 *
 * `(a·10^SCALE) / b` restores the scale that dividing it away removed.
 */
export function divide(a: bigint, b: bigint): bigint {
  return divideRounded(a * SCALE_FACTOR, b);
}

/**
 * Square a scaled value. The result carries **twice** the scale, so
 * `square(x) = x² / 10^SCALE` as a plain number.
 */
export function square(scaled: bigint): bigint {
  return scaled * scaled;
}

/**
 * Floor of the square root of a non-negative `bigint`, with no floating point
 * anywhere in the computation.
 *
 * Demand variability needs a standard deviation, and `Math.sqrt` would put an
 * IEEE-754 value inside an otherwise exact-decimal result — the last bit of the
 * answer would depend on the platform. Newton's method converges on the integer
 * part in a handful of iterations and returns the same value everywhere.
 */
export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError('Cannot take the square root of a negative value');
  if (value < 2n) return value;

  // Start above the root, then walk down. The first guess is a power of two at
  // or above `value`, which is guaranteed to be an over-estimate.
  let guess = 1n;
  while (guess * guess <= value) guess <<= 1n;

  let next = (guess + value / guess) / 2n;
  while (next < guess) {
    guess = next;
    next = (guess + value / guess) / 2n;
  }

  return guess;
}

/** Subtract two scaled values, keeping the result scaled. May be negative. */
export function subtract(a: bigint, b: bigint): bigint {
  return a - b;
}

/**
 * Compare two already-scaled values. Returns -1, 0 or 1.
 *
 * The scaled form of {@link compare}, for callers holding `bigint`s that must
 * not be rendered to a string just to be compared.
 */
export function compareScaled(a: bigint, b: bigint): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compare two decimal strings. Returns -1, 0 or 1. */
export function compare(a: string | number, b: string | number): -1 | 0 | 1 {
  const left = toScaled(a);
  const right = toScaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** True when the decimal is strictly greater than zero. */
export function isPositive(value: string | number): boolean {
  return toScaled(value) > 0n;
}

/**
 * Median of a list of decimal strings. `null` for an empty list.
 *
 * The median resists one abnormal supplier delay skewing the whole figure the
 * way a mean would. Even counts take the exact mean of the two middle values.
 */
export function median(values: readonly string[]): string | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => compare(a, b));
  const middle = Math.floor(sorted.length / 2);

  // Every branch returns a rendered decimal, never the raw element. A driver that
  // hands back a number (a `numeric[]` does exactly that) would otherwise escape
  // unformatted and change the JSON type of `effectiveLeadTimeDays` depending on
  // the size of the sample list.
  if (sorted.length % 2 === 1) return fromScaled(toScaled(sorted[middle]!), 2);

  // `divide` takes a **scaled** divisor, so the whole number 2 is `toScaled(2)`.
  // Passing a bare `2n` would mean 0.000002 and inflate the result a millionfold.
  return fromScaled(divide(toScaled(sorted[middle - 1]!) + toScaled(sorted[middle]!), toScaled(2)), 2);
}
