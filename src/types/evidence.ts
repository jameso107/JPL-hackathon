/** Evidence Package — the contract between the analytics engine and everything downstream. */

export type EvidenceKind =
  | 'trend'
  | 'exceedance'
  | 'historical_match'
  | 'maintenance_correlation'
  | 'confounder'
  | 'constraint'
  | 'prediction';

/**
 * Canonical pattern tags consumed by the Bayes layer. Hypothesis configs declare
 * likelihood ratios per tag, so new analytics and new hypotheses compose without
 * code changes on either side. Constraint evidence carries no pattern (weight 0
 * for inference; consumed by the decision module).
 */
export type PatternTag =
  | 'vibration_exceedance'
  | 'monotonic_trend_vs_rotor_hours'
  | 'trend_projection_reaches_threshold'
  | 'acute_departure_from_trend'
  | 'gradual_onset_multi_flight'
  | 'sudden_onset_single_flight'
  | 'confounder_unexplained_residual'
  | 'confounder_explains_anomaly'
  | 'bearing_play_near_limit'
  | 'maintenance_wear_progression'
  | 'exceeds_original_threshold'
  | 'recent_software_change'
  | 'high_wind_during_anomaly';

export interface Provenance {
  file: string;
  /** 1-based data row numbers in source CSVs (header = row 1) */
  rows?: number[];
  /** record ids in source JSON files (e.g. "MA-008", "ANM-013", "MSRH-RA-002", "F48") */
  recordIds?: string[];
}

export interface EvidenceItem {
  /** "EV-01", "EV-02", … in emission order */
  id: string;
  kind: EvidenceKind;
  pattern?: PatternTag;
  /** human-readable, chart-ready statement */
  statement: string;
  /** raw numbers behind the statement, keyed by short names used in charts/tests */
  value: Record<string, number>;
  provenance: Provenance;
  /** 0–1 computed significance; soft-evidence exponent in the Bayes update */
  weight: number;
}

export interface EvidencePackage {
  anomaly: {
    description: string;
    category: string;
    /** e.g. "F47" */
    flightRef?: string;
  };
  items: EvidenceItem[];
  computedAt: string;
}
