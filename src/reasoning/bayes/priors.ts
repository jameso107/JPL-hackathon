/**
 * Prior construction from same-category resolved anomaly-history records.
 * See docs/CONTRACTS.md §Bayes (Priors).
 *
 * - Usable records: category === anomaly category AND resolution does not
 *   contain "PENDING" (case-insensitive).
 * - count(h) = usable records whose rootCause (lowercased) contains ANY of
 *   h.priorKeywords (case-insensitive substring). A record may count for
 *   multiple hypotheses.
 * - Laplace smoothing: p(h) = (count + α) / (N + α·K) over the K non-catch-all
 *   hypotheses; prior(h) = p(h)·(1 − R); catch-all keeps the reserved mass R.
 * - Missing/empty anomaly history → uniform fallback: (1 − R)/K each, catch-all R.
 */
import type {
  AnomalyRecord,
  BayesConfig,
  Hypothesis,
  PriorContribution,
} from '../../types';

export interface PriorComputation {
  /** hypothesisId → prior probability */
  priors: Map<string, number>;
  /** hypothesisId → heritage records that contributed to its count */
  contributions: Map<string, PriorContribution[]>;
  usedRecords: string[];
  excludedRecords: string[];
  uniformFallback: boolean;
}

export function computePriors(
  history: AnomalyRecord[] | undefined,
  category: string,
  hypotheses: Hypothesis[],
  cfg: BayesConfig,
): PriorComputation {
  const reserved = cfg.reservedUnknownMass;
  const regular = hypotheses.filter((h) => !h.isCatchAll);
  const k = regular.length;

  const priors = new Map<string, number>();
  const contributions = new Map<string, PriorContribution[]>();
  for (const h of hypotheses) contributions.set(h.id, []);

  // No anomaly history at all → uniform fallback.
  if (!history || history.length === 0) {
    for (const h of hypotheses) {
      priors.set(h.id, h.isCatchAll ? reserved : (1 - reserved) / k);
    }
    return {
      priors,
      contributions,
      usedRecords: [],
      excludedRecords: [],
      uniformFallback: true,
    };
  }

  const sameCategory = history.filter((r) => r.category === category);
  const isPending = (r: AnomalyRecord) => r.resolution.toUpperCase().includes('PENDING');
  const usable = sameCategory.filter((r) => !isPending(r));
  const excluded = sameCategory.filter(isPending);
  const n = usable.length;

  for (const h of hypotheses) {
    if (h.isCatchAll) {
      priors.set(h.id, reserved);
      continue;
    }
    const contribs = contributions.get(h.id)!;
    let count = 0;
    for (const record of usable) {
      const rootCause = record.rootCause.toLowerCase();
      const matchedKeyword = h.priorKeywords.find(
        (kw) => kw.length > 0 && rootCause.includes(kw.toLowerCase()),
      );
      if (matchedKeyword !== undefined) {
        count += 1;
        contribs.push({
          anomalyId: record.anomalyId,
          vehicle: record.vehicle,
          matchedKeyword,
        });
      }
    }
    const smoothed = (count + cfg.laplaceAlpha) / (n + cfg.laplaceAlpha * k);
    priors.set(h.id, smoothed * (1 - reserved));
  }

  return {
    priors,
    contributions,
    usedRecords: usable.map((r) => r.anomalyId),
    excludedRecords: excluded.map((r) => r.anomalyId),
    uniformFallback: false,
  };
}
