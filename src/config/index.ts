/**
 * Loads and validates all YAML configuration at module init.
 * Config is bundled via Vite ?raw imports — the app never fetches config at runtime.
 * A config error is a build/startup error, never a silent runtime fallback.
 */
import { parse } from 'yaml';
import { z } from 'zod';
import type {
  AnalyticsConfig,
  BayesConfig,
  DiagnosticsCatalog,
  HypothesisLibrary,
  RiskDefaults,
  SchemaMappings,
} from '../types';

import hypothesesVibrationRaw from '../../config/hypotheses.vibration.yaml?raw';
import riskDefaultsRaw from '../../config/risk_defaults.yaml?raw';
import diagnosticsRaw from '../../config/diagnostics.yaml?raw';
import analyticsRaw from '../../config/analytics.yaml?raw';
import schemaMappingsRaw from '../../config/schema_mappings/msrh.yaml?raw';

// ---------------------------------------------------------------------------
// zod schemas (snake_case YAML → camelCase TS)
// ---------------------------------------------------------------------------

const patternTag = z.enum([
  'vibration_exceedance',
  'monotonic_trend_vs_rotor_hours',
  'trend_projection_reaches_threshold',
  'acute_departure_from_trend',
  'gradual_onset_multi_flight',
  'sudden_onset_single_flight',
  'confounder_unexplained_residual',
  'confounder_explains_anomaly',
  'bearing_play_near_limit',
  'maintenance_wear_progression',
  'exceeds_original_threshold',
  'recent_software_change',
  'high_wind_during_anomaly',
]);

const hypothesesSchema = z.object({
  category: z.string(),
  hypotheses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      prior_keywords: z.array(z.string()),
      evidence_response: z.array(
        z.object({
          pattern: patternTag,
          lr: z.number().positive(),
          citation: z.string().optional(),
        }),
      ),
      diagnostics: z.array(z.string()),
      repair_options: z.array(z.string()),
      is_catch_all: z.boolean().optional(),
    }),
  ),
});

const citedNumber = z.object({ value: z.number(), citation: z.string() });

const lovEntry = z.object({ per_flight: z.number().min(0).max(1), citation: z.string() });

const riskDefaultsSchema = z.object({
  nominal_per_flight_lov: citedNumber,
  vehicle_loss_penalty_usd: citedNumber,
  sample_shortfall_penalty_usd: citedNumber,
  lov_per_flight: z.record(
    z.object({
      nominal: lovEntry,
      mitigated: lovEntry,
      post_service: lovEntry,
      grounded: lovEntry,
    }),
  ),
  actions: z.record(
    z.object({
      name: z.string(),
      summary: z.string(),
      lov_profile: z.enum(['nominal', 'mitigated', 'post_service', 'grounded']),
      prep_delay_sols: z.number().min(0),
      mitigations: z.array(z.string()),
    }),
  ),
});

const diagnosticsSchema = z.object({
  diagnostics: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      duration_sols: z.number().positive(),
      required_expertise: z.array(z.string()),
      estimated_cost_usd: z.number().optional(),
      expected_outcomes: z.record(z.string()),
      gate_actions: z.record(z.string()),
    }),
  ),
});

const analyticsFileSchema = z.object({
  analytics: z.object({
    baseline_window_flights: z.number().int().positive(),
    default_alert_threshold_g: z.number().positive(),
    default_original_threshold_g: z.number().positive(),
    default_bearing_play_limit_mm: z.number().positive(),
    bearing_play_near_limit_ratio: z.number().min(0).max(1),
    recent_software_change_sols: z.number().positive(),
    wind_twin_tolerance_ms: z.number().positive(),
    trend_min_t_stat: z.number().positive(),
    historical_match_top_k: z.number().int().positive(),
  }),
  bayes: z.object({
    laplace_alpha: z.number().positive(),
    reserved_unknown_mass: z.number().min(0).max(0.5),
    tempering: z.number().min(0).max(1),
  }),
});

const mappingsSchema = z.object({
  profiles: z.array(
    z.object({
      id: z.string(),
      role: z.enum([
        'telemetry',
        'maintenance',
        'anomaly_history',
        'inventory',
        'timeline',
        'team',
        'budget',
      ]),
      format: z.enum(['csv', 'json']),
      file_patterns: z.array(z.string()),
      signature_fields: z.array(z.string()),
      columns: z.array(
        z.object({
          to: z.string(),
          from: z.array(z.string()),
          required: z.boolean().optional(),
        }),
      ),
    }),
  ),
});

// ---------------------------------------------------------------------------
// parse + export typed config
// ---------------------------------------------------------------------------

const hypRaw = hypothesesSchema.parse(parse(hypothesesVibrationRaw));
export const hypothesisLibrary: HypothesisLibrary = {
  category: hypRaw.category,
  hypotheses: hypRaw.hypotheses.map((h) => ({
    id: h.id,
    name: h.name,
    category: hypRaw.category,
    description: h.description,
    priorKeywords: h.prior_keywords,
    evidenceResponse: h.evidence_response.map((e) => ({
      pattern: e.pattern,
      lr: e.lr,
      citation: e.citation,
    })),
    diagnostics: h.diagnostics,
    repairOptions: h.repair_options,
    isCatchAll: h.is_catch_all ?? false,
  })),
};

const riskRaw = riskDefaultsSchema.parse(parse(riskDefaultsRaw));
export const riskDefaults: RiskDefaults = {
  nominalPerFlightLov: riskRaw.nominal_per_flight_lov,
  vehicleLossPenaltyUsd: riskRaw.vehicle_loss_penalty_usd,
  sampleShortfallPenaltyUsd: riskRaw.sample_shortfall_penalty_usd,
  lovPerFlight: Object.fromEntries(
    Object.entries(riskRaw.lov_per_flight).map(([hyp, profiles]) => [
      hyp,
      Object.fromEntries(
        Object.entries(profiles).map(([profile, entry]) => [
          profile,
          { perFlight: entry.per_flight, citation: entry.citation },
        ]),
      ),
    ]),
  ),
  actions: Object.fromEntries(
    Object.entries(riskRaw.actions).map(([id, a]) => [
      id,
      {
        name: a.name,
        summary: a.summary,
        lovProfile: a.lov_profile,
        prepDelaySols: a.prep_delay_sols,
        mitigations: a.mitigations,
      },
    ]),
  ) as RiskDefaults['actions'],
};

const diagRaw = diagnosticsSchema.parse(parse(diagnosticsRaw));
export const diagnosticsCatalog: DiagnosticsCatalog = {
  diagnostics: diagRaw.diagnostics.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    durationSols: d.duration_sols,
    requiredExpertise: d.required_expertise,
    estimatedCostUsd: d.estimated_cost_usd,
    expectedOutcomes: d.expected_outcomes,
    gateActions: d.gate_actions,
  })),
};

const cfgRaw = analyticsFileSchema.parse(parse(analyticsRaw));
export const analyticsConfig: AnalyticsConfig = {
  baselineWindowFlights: cfgRaw.analytics.baseline_window_flights,
  defaultAlertThresholdG: cfgRaw.analytics.default_alert_threshold_g,
  defaultOriginalThresholdG: cfgRaw.analytics.default_original_threshold_g,
  defaultBearingPlayLimitMm: cfgRaw.analytics.default_bearing_play_limit_mm,
  bearingPlayNearLimitRatio: cfgRaw.analytics.bearing_play_near_limit_ratio,
  recentSoftwareChangeSols: cfgRaw.analytics.recent_software_change_sols,
  windTwinToleranceMs: cfgRaw.analytics.wind_twin_tolerance_ms,
  trendMinTStat: cfgRaw.analytics.trend_min_t_stat,
  historicalMatchTopK: cfgRaw.analytics.historical_match_top_k,
};
export const bayesConfig: BayesConfig = {
  laplaceAlpha: cfgRaw.bayes.laplace_alpha,
  reservedUnknownMass: cfgRaw.bayes.reserved_unknown_mass,
  tempering: cfgRaw.bayes.tempering,
};

const mapRaw = mappingsSchema.parse(parse(schemaMappingsRaw));
export const schemaMappings: SchemaMappings = {
  profiles: mapRaw.profiles.map((p) => ({
    id: p.id,
    role: p.role,
    format: p.format,
    filePatterns: p.file_patterns,
    signatureFields: p.signature_fields,
    columns: p.columns,
  })),
};
