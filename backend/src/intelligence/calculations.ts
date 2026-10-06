/**
 * Shared replenishment arithmetic.
 *
 * The Stock Risk Engine and the Reorder Engine both need the same two numbers —
 * safety stock and the reorder point. Computing them twice would let the two
 * features quietly disagree about the same product on the same day, which is the
 * one failure a replenishment system can least afford: a user comparing
 * `/stock-risk` with `/reorder` must never see two different reorder points for
 * one product.
 *
 * So the formulas live here, once, and both engines call them. They are pure
 * functions over exact decimal strings: no SQL, no clock, no configuration.
 */

import { compare, fromScaled, multiply, toScaled } from './decimal.js';

/**
 * Safety stock: `averageDailySales × safetyStockDays`.
 *
 * `null` when there is no positive demand rate. A zero or absent rate means
 * there is no demand to buffer, and returning `0` would present "we calculated
 * zero" where the truth is "we know nothing" — a distinction the engines both
 * surface as `INSUFFICIENT_DATA`.
 */
export function calculateSafetyStock(
  averageDailySales: string,
  safetyStockDays: number,
): string | null {
  if (compare(averageDailySales, 0) <= 0) return null;

  return fromScaled(
    multiply(toScaled(averageDailySales), toScaled(safetyStockDays)),
    2,
  );
}

/**
 * Reorder point: `averageDailySales × (leadTimeDays + safetyStockDays)`.
 *
 * `null` when the demand rate is not positive or the lead time is unusable. A
 * lead time of exactly zero is **valid** and is not treated as missing: a
 * supplier measured at same-day turnaround genuinely has a zero-day lead time,
 * and treating that as no evidence would hide a fast, well-managed supplier.
 */
export function calculateReorderPoint(
  averageDailySales: string,
  leadTimeDays: string,
  safetyStockDays: number,
): string | null {
  if (compare(averageDailySales, 0) <= 0) return null;
  if (compare(leadTimeDays, 0) < 0) return null;

  // Lead time plus the safety buffer, both in days, before scaling into the
  // rate multiplication.
  const coverageDays = toScaled(leadTimeDays) + toScaled(safetyStockDays);

  return fromScaled(multiply(toScaled(averageDailySales), coverageDays), 2);
}

/** Add a whole number of days to a scaled day count. Shared by both engines. */
export function addDays(scaled: bigint, days: number): bigint {
  return scaled + toScaled(days);
}
