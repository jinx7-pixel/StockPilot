/**
 * Decision Explanation — shared renderer.
 *
 * Displays the server's `decision`, `confidence`, `evidence` and `limitations`
 * for any intelligence result.
 *
 * There is **no calculation of any kind in this file**: no scoring, no
 * weighting, no derivation of a confidence level from the evidence list, no
 * counting of limitations. Every value printed is a string the server sent. A
 * browser that second-guessed a decision would produce a screen disagreeing with
 * the assessment behind it, which is the one thing this architecture must never
 * do.
 */

export interface EvidenceItem {
  source: 'demand' | 'inventory' | 'supplier' | 'data_quality';
  metric: string;
  value: string | number;
  unit?: string;
  interpretation: string;
}

export interface DecisionExplanation {
  decision: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  evidence: EvidenceItem[];
  limitations: string[];
}

const SOURCE_LABEL: Record<EvidenceItem['source'], string> = {
  demand: 'Demand',
  inventory: 'Inventory',
  supplier: 'Supplier',
  data_quality: 'Data quality',
};

const SOURCE_BADGE: Record<EvidenceItem['source'], string> = {
  demand: 'bg-sky-100 text-sky-700',
  inventory: 'bg-indigo-100 text-indigo-700',
  supplier: 'bg-teal-100 text-teal-700',
  data_quality: 'bg-slate-100 text-slate-600',
};

const CONFIDENCE_BADGE: Record<DecisionExplanation['confidence'], string> = {
  HIGH: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-orange-100 text-orange-700',
  INSUFFICIENT: 'bg-slate-100 text-slate-500',
};

const CONFIDENCE_LABEL: Record<DecisionExplanation['confidence'], string> = {
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
  LOW: 'Low confidence',
  INSUFFICIENT: 'Insufficient evidence',
};

/**
 * A metric value plus its unit, rendered exactly as the server sent it.
 * No rounding, no unit conversion, no substitution.
 */
function formatValue(item: EvidenceItem): string {
  return item.unit === undefined ? String(item.value) : `${item.value} ${item.unit}`;
}

export function DecisionExplanationView({
  explanation,
  decisionLabel,
}: {
  explanation: DecisionExplanation;
  /** Human label for the decision, e.g. "Overstocked". Display only. */
  decisionLabel?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Decision
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
          {decisionLabel ?? explanation.decision}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONFIDENCE_BADGE[explanation.confidence]}`}
        >
          {CONFIDENCE_LABEL[explanation.confidence]}
        </span>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Evidence
        </h3>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {explanation.evidence.map((item, index) => (
            <li key={`${item.source}-${item.metric}-${index}`} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SOURCE_BADGE[item.source]}`}
                >
                  {SOURCE_LABEL[item.source]}
                </span>
                <span className="text-sm font-medium text-slate-900">{item.metric}</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">
                  {formatValue(item)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{item.interpretation}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Limitations
        </h3>
        {explanation.limitations.length === 0 ? (
          <p className="text-sm text-slate-500">
            None. The evidence above was sufficient for this decision.
          </p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
            {explanation.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}