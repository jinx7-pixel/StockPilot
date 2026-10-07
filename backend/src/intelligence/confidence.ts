/**
 * Confidence & Evidence layer.
 *
 * A **pure** vocabulary and set of rules shared by every intelligence engine. No
 * SQL, no I/O, no clock, no scoring model — it only shapes facts the engines have
 * already measured.
 *
 * ## What this layer deliberately does not do
 *
 * **It does not compute confidence.** Each engine already derives a
 * decision-specific confidence from the sources that decision actually depends
 * on, and several combine them conservatively already: Stock Risk and Reorder
 * both refuse `HIGH` unless demand evidence *and* supplier lead-time evidence
 * hold up, so "demand HIGH + supplier LOW" is already `MEDIUM` or lower in the
 * approved implementation.
 *
 * Adding a second confidence ladder on top would either duplicate those rules
 * or silently change approved values, and both were ruled out. So this layer
 * *surfaces* the confidence each engine already computed and attaches the facts
 * behind it. {@link combineConfidence} exists for the same rule expressed once,
 * and is exercised directly in the tests.
 *
 * There is deliberately **no 0-100 score**. Confidence is ordinal evidence
 * quality, and a number on that scale would invite readers to treat a gap as a
 * difference when it is only a category.
 *
 * ## Evidence and limitations are different jobs
 *
 * Evidence is what the engine *used*, including figures that argue against its
 * own verdict. Limitations are what a reader *cannot* conclude. A product can be
 * confidently dead and still have no supplier history; conflating the two would
 * hide the first behind the second.
 */

import type { ConfidenceLevel } from './types.js';

/** The four transactional sources evidence may be drawn from. */
export const EVIDENCE_SOURCES = ['demand', 'inventory', 'supplier', 'data_quality'] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * One measured fact behind a decision, traceable to the calculation the engine
 * actually performed.
 */
export interface EvidenceItem {
  source: EvidenceSource;
  /** The quantity itself, named as the engine reports it. */
  metric: string;
  value: string | number;
  unit?: string;
  /** What this figure means for the decision, in plain words. */
  interpretation: string;
}

/**
 * The locked explanation envelope attached to every intelligence response.
 *
 * It is additive: `confidence`, `reason` and each engine's own `evidence` object
 * stay exactly where they were, so existing consumers are unaffected.
 */
export interface DecisionExplanation {
  /** The decision this explanation is about. */
  decision: string;
  /** Decision-specific confidence, mirrored from the engine's own value. */
  confidence: ConfidenceLevel;
  evidence: EvidenceItem[];
  /** Explicit statements about what the evidence cannot support. */
  limitations: string[];
}

/**
 * Confidence ordering, weakest first.
 *
 * `INSUFFICIENT` sorts below `LOW` on purpose: "we do not know" is a weaker
 * position than "we know it is weakly", and combining the two must not let the
 * latter read as the former.
 */
const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  INSUFFICIENT: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/**
 * Combine the confidence of several evidence sources **conservatively**.
 *
 * The result is the weakest contributor, never an average: two sources one of
 * which is shaky cannot jointly support a strong claim, and averaging would let
 * a strong source paper over a weak one. This is the rule the existing engines
 * already apply by hand; stating it once makes it checkable.
 */
export function combineConfidence(...levels: readonly ConfidenceLevel[]): ConfidenceLevel {
  if (levels.length === 0) return 'INSUFFICIENT';

  return levels.reduce<ConfidenceLevel>(
    (weakest, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[weakest] ? level : weakest),
    'HIGH',
  );
}

/**
 * Assemble evidence in a stable, readable order.
 *
 * Entries whose `value` is `null` or `undefined` are **dropped**: a metric the
 * engine could not compute has no value to report, and printing it as a dash
 * beside an interpretation would imply something was measured.
 */
export function buildEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
  return items
    .filter((item) => item.value !== null && item.value !== undefined)
    .sort((a, b) => EVIDENCE_SOURCES.indexOf(a.source) - EVIDENCE_SOURCES.indexOf(b.source));
}

/**
 * Assemble limitations: de-duplicated and stably ordered.
 *
 * Engines emit them in the order the weakness becomes relevant to the reader,
 * which keeps the output deterministic without forcing a global sort that would
 * scramble a narrative.
 */
export function buildLimitations(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

/** Convenience constructor that keeps evidence entries uniform across engines. */
export function evidence(
  source: EvidenceSource,
  metric: string,
  value: string | number | null | undefined,
  interpretation: string,
  unit?: string,
): EvidenceItem {
  const item: EvidenceItem = { source, metric, value: value as string | number, interpretation };
  if (unit !== undefined) item.unit = unit;
  return item;
}