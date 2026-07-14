import type { ActionId } from './decision';

/** Typed shapes of the YAML files in config/ (parsed + zod-validated in src/config). */

export interface AnalyticsConfig {
  /** number of early-mission flights used for the baseline median/MAD window */
  baselineWindowFlights: number;
  /** fallback vibration alert threshold (g) when not extractable from maintenance notes */
  defaultAlertThresholdG: number;
  /** fallback original (pre-patch) threshold (g) */
  defaultOriginalThresholdG: number;
  /** fallback bearing-play spec limit (mm) when not extractable from maintenance notes */
  defaultBearingPlayLimitMm: number;
  /** bearing play / limit ratio at which `bearing_play_near_limit` fires */
  bearingPlayNearLimitRatio: number;
  /** sols before the anomaly within which a software change counts as "recent" */
  recentSoftwareChangeSols: number;
  /** wind-twin tolerance (m/s) for the confounder comparison flight */
  windTwinToleranceMs: number;
  /** minimum |t|-statistic for the rotor-hours trend to count as significant */
  trendMinTStat: number;
  /** number of top historical matches to emit as evidence */
  historicalMatchTopK: number;
}

export interface BayesConfig {
  laplaceAlpha: number;
  /** prior mass reserved for the catch-all hypothesis */
  reservedUnknownMass: number;
  /** global exponent applied to evidence weights (calibration hedge vs LR overconfidence) */
  tempering: number;
}

export interface DiagnosticOutcomeSpec {
  /** hypothesis id → expected qualitative outcome label for this diagnostic */
  [hypothesisId: string]: string;
}

export interface DiagnosticSpec {
  id: string;
  name: string;
  description: string;
  durationSols: number;
  /** expertise tags matched against team records */
  requiredExpertise: string[];
  /** expected outcome label per hypothesis; hypotheses with the same label are NOT separated */
  expectedOutcomes: DiagnosticOutcomeSpec;
  /** gate templates: outcome label → next-action text */
  gateActions: Record<string, string>;
  estimatedCostUsd?: number;
}

export interface DiagnosticsCatalog {
  diagnostics: DiagnosticSpec[];
}

export interface LovEntry {
  /** per-flight P(loss of vehicle) under (hypothesis, flight profile) */
  perFlight: number;
  citation: string;
}

export interface RiskDefaults {
  /** hypothesisId → profileId → LOV entry. Profiles: nominal | mitigated | post_service | grounded */
  lovPerFlight: Record<string, Record<string, LovEntry>>;
  /** dollarized penalty for losing the vehicle (asserted, cited) */
  vehicleLossPenaltyUsd: { value: number; citation: string };
  /** dollarized penalty per batch-3 sample not retrieved in time (asserted, cited) */
  sampleShortfallPenaltyUsd: { value: number; citation: string };
  /** baseline per-flight risk for a healthy vehicle, for context in the UI */
  nominalPerFlightLov: { value: number; citation: string };
  /** action metadata: display name, summary, flight profile, prep/delay sols, mitigations */
  actions: Record<
    ActionId,
    {
      name: string;
      summary: string;
      /** which LOV profile applies to flights flown under this action */
      lovProfile: 'nominal' | 'mitigated' | 'post_service' | 'grounded';
      prepDelaySols: number;
      mitigations: string[];
    }
  >;
}

export interface ColumnMapping {
  /** canonical field name (matches the MissionModel record interfaces) */
  to: string;
  /** acceptable source column/field names, first match wins */
  from: string[];
  required?: boolean;
}

export interface MappingProfile {
  id: string;
  role:
    | 'telemetry'
    | 'maintenance'
    | 'anomaly_history'
    | 'inventory'
    | 'timeline'
    | 'team'
    | 'budget';
  format: 'csv' | 'json';
  /** filename regexes (case-insensitive) that suggest this profile */
  filePatterns: string[];
  /** source columns/fields that must be present for a content-based match */
  signatureFields: string[];
  columns: ColumnMapping[];
}

export interface SchemaMappings {
  profiles: MappingProfile[];
}
