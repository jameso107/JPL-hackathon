import type { PatternTag } from './evidence';

/** Hypothesis library (config/hypotheses.*.yaml) + Bayes engine output. */

export interface EvidenceResponse {
  pattern: PatternTag;
  /** likelihood ratio P(pattern | H) / P(pattern | not H); <1 = evidence against */
  lr: number;
  /** provenance/justification string rendered in the UI, e.g. "ANM-013 heritage predictive model" */
  citation?: string;
}

export interface Hypothesis {
  id: string;
  name: string;
  category: string;
  description: string;
  /** matched (case-insensitive substring) against same-category anomaly-history root causes → priors */
  priorKeywords: string[];
  evidenceResponse: EvidenceResponse[];
  /** diagnostic ids from config/diagnostics.yaml that discriminate this hypothesis */
  diagnostics: string[];
  repairOptions: string[];
  /** catch-all hypothesis retains reserved prior mass and never receives LRs */
  isCatchAll?: boolean;
}

export interface HypothesisLibrary {
  category: string;
  hypotheses: Hypothesis[];
}

/** One bar in the log-odds waterfall. */
export interface WaterfallStep {
  kind: 'prior' | 'evidence' | 'normalization' | 'posterior';
  /** evidence item id for kind=evidence */
  evidenceId?: string;
  label: string;
  /** contribution to the hypothesis log-score (natural log). For prior: ln(prior).
   *  For evidence: weight × tempering × ln(LR). For normalization: -ln(Z).
   *  For posterior: running total = ln(posterior). */
  delta: number;
  /** running total after applying this step */
  cumulative: number;
}

export interface PriorContribution {
  anomalyId: string;
  vehicle: string;
  matchedKeyword: string;
}

export interface HypothesisPosterior {
  hypothesisId: string;
  name: string;
  prior: number;
  posterior: number;
  /** ln(posterior) - ln(prior), for quick "what moved it" display */
  logOddsShift: number;
  waterfall: WaterfallStep[];
  priorContributions: PriorContribution[];
  /** evidence ids that matched this hypothesis's evidenceResponse patterns */
  matchedEvidence: string[];
}

export interface BayesResult {
  /** sorted by posterior, descending */
  posteriors: HypothesisPosterior[];
  priorsMeta: {
    /** anomaly-history records used (same category, resolved) */
    usedRecords: string[];
    /** records excluded as unresolved/current-event */
    excludedRecords: string[];
    laplaceAlpha: number;
    reservedUnknownMass: number;
    /** true when anomaly_history was missing → uniform priors */
    uniformFallback: boolean;
  };
  /** global soft-evidence tempering factor applied to all evidence exponents */
  tempering: number;
}
