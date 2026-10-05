/**
 * Calendar arithmetic.
 *
 * The demand engine must bucket sales days into 7-, 30- and 90-day windows
 * without reading a clock or constructing a `Date`. Two reasons:
 *
 *  - **Purity.** The engine receives `windowEndDate` as a *fact*. Reading the
 *    system clock inside it would make the same facts produce different results
 *    on different days, which is the opposite of what a testable engine is for.
 *  - **Time zones.** `new Date('2026-01-01')` is UTC midnight, but local-time
 *    arithmetic silently shifts days for anyone east or west of Greenwich. A
 *    day number is timezone-free by construction.
 *
 * The civil-date conversion is the standard days-from-civil algorithm, so the
 * result is a plain integer and nothing here can produce `NaN`.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Raised when a calendar date cannot be read. Corrupt input, not a demand signal. */
export class InvalidCalendarDateError extends Error {
  constructor(value: unknown) {
    super(`Not a calendar date (expected YYYY-MM-DD): ${String(value)}`);
    this.name = 'InvalidCalendarDateError';
  }
}

/**
 * Days since 1970-01-01 for a `YYYY-MM-DD` calendar date.
 *
 * Pure integer arithmetic — no `Date`, no timezone, no clock.
 */
export function toDayNumber(calendarDate: string): number {
  const match = DATE_PATTERN.exec(calendarDate.trim());
  if (!match) throw new InvalidCalendarDateError(calendarDate);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidCalendarDateError(calendarDate);
  }

  return daysFromCivil(year, month, day);
}

/**
 * Whole days between two calendar dates: `to - from`.
 *
 * Negative when `to` is earlier than `from`, so callers can detect a
 * future-dated record instead of silently ignoring it.
 */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/**
 * Today's UTC calendar date, as `YYYY-MM-DD`.
 *
 * `toISOString()` already renders UTC, so slicing it *is* the UTC calendar date.
 * There is deliberately no offset correction here: `getTimezoneOffset()` is in
 * minutes, and treating it as days silently moves the window by months.
 *
 * This lives outside the engine because the engine must not read a clock — the
 * repository calls this and passes the result in as a fact.
 */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Howard Hinnant's `days_from_civil`, shifted to a 1970-01-01 epoch. */
function daysFromCivil(year: number, month: number, day: number): number {
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  return era * 146_097 + dayOfEra - 719_468;
}
