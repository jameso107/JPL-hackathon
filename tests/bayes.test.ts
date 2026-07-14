import { describe, expect, it } from 'vitest';
import anomalyHistoryRaw from '../examples/msrh/anomaly_history.json?raw';
import { bayesConfig, hypothesisLibrary } from '../src/config';
import { runBayes } from '../src/reasoning/bayes';
import type {
  AnomalyRecord,
  BayesConfig,
  BayesResult,
  EvidenceItem,
  EvidenceKind,
  EvidencePackage,
  HypothesisLibrary,
  MissionModel,
  PatternTag,
} from '../src/types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const expectClose = (actual: number, expected: number, tol: number) => {
  expect(Math.abs(actual - expected), `expected ${actual} ≈ ${expected} ± ${tol}`).toBeLessThanOrEqual(tol);
};

function makeItem(
  id: string,
  kind: EvidenceKind,
  pattern: PatternTag | undefined,
  weight: number,
): EvidenceItem {
  return {
    id,
    kind,
    pattern,
    statement: `${id} fixture`,
    value: {},
    provenance: { file: 'inline-fixture' },
    weight,
  };
}

function makeModel(anomalyHistory?: AnomalyRecord[]): MissionModel {
  return {
    telemetry: [],
    anomalyHistory,
    meta: { vehicle: 'MSRH', sources: [] },
  };
}

function assertWaterfallInvariants(result: BayesResult) {
  for (const p of result.posteriors) {
    const steps = p.waterfall;
    expect(steps.length).toBeGreaterThanOrEqual(3);

    // first step: prior with delta == cumulative == ln(prior)
    expect(steps[0].kind).toBe('prior');
    expectClose(steps[0].delta, Math.log(p.prior), 1e-9);
    expectClose(steps[0].cumulative, Math.log(p.prior), 1e-9);

    // running total is consistent
    for (let i = 1; i < steps.length; i++) {
      expectClose(steps[i].cumulative, steps[i - 1].cumulative + steps[i].delta, 1e-9);
    }

    // middle steps are evidence bars, each tied to an evidence id
    for (const s of steps.slice(1, -2)) {
      expect(s.kind).toBe('evidence');
      expect(s.evidenceId).toBeDefined();
      expect(s.delta).not.toBe(0);
    }

    // penultimate: normalization; last: posterior with delta 0
    expect(steps[steps.length - 2].kind).toBe('normalization');
    const last = steps[steps.length - 1];
    expect(last.kind).toBe('posterior');
    expect(last.delta).toBe(0);

    // invariant: cumulative of the last step == ln(posterior) within 1e-9
    expectClose(last.cumulative, Math.log(p.posterior), 1e-9);

    // logOddsShift consistency
    expectClose(p.logOddsShift, Math.log(p.posterior) - Math.log(p.prior), 1e-9);
  }
}

const byId = (result: BayesResult, id: string) => {
  const found = result.posteriors.find((p) => p.hypothesisId === id);
  expect(found, `missing posterior for ${id}`).toBeDefined();
  return found!;
};

// ---------------------------------------------------------------------------
// synthetic exact-arithmetic case
// ---------------------------------------------------------------------------

const syntheticCfg: BayesConfig = {
  laplaceAlpha: 1.0,
  reservedUnknownMass: 0.2,
  tempering: 0.5,
};

const syntheticLibrary: HypothesisLibrary = {
  category: 'test',
  hypotheses: [
    {
      id: 'h1',
      name: 'Hypothesis One',
      category: 'test',
      description: 'synthetic',
      priorKeywords: ['alpha'],
      evidenceResponse: [
        { pattern: 'vibration_exceedance', lr: 4.0 },
        { pattern: 'monotonic_trend_vs_rotor_hours', lr: 2.0 },
      ],
      diagnostics: [],
      repairOptions: [],
    },
    {
      id: 'h2',
      name: 'Hypothesis Two',
      category: 'test',
      description: 'synthetic',
      priorKeywords: ['beta'],
      evidenceResponse: [{ pattern: 'vibration_exceedance', lr: 2.0 }],
      diagnostics: [],
      repairOptions: [],
    },
    {
      id: 'catch',
      name: 'Catch-all',
      category: 'test',
      description: 'synthetic',
      priorKeywords: [],
      evidenceResponse: [],
      diagnostics: [],
      repairOptions: [],
      isCatchAll: true,
    },
  ],
};

function syntheticRecord(
  anomalyId: string,
  category: string,
  rootCause: string,
  resolution: string,
): AnomalyRecord {
  return {
    anomalyId,
    vehicle: 'TestCraft',
    sol: 100,
    category,
    severity: 'low',
    description: 'synthetic record',
    rootCause,
    resolution,
    downtimeSols: 0,
    relatedMaintenance: 'None',
  };
}

const syntheticHistory: AnomalyRecord[] = [
  syntheticRecord('T-1', 'test', 'Alpha coupling failure in the widget', 'Fixed'),
  syntheticRecord('T-2', 'test', 'beta overload event', 'Fixed'),
  syntheticRecord('T-3', 'test', 'secondary ALPHA drift', 'Closed out'),
  syntheticRecord('T-4', 'test', 'alpha suspected', 'Pending review board'), // excluded
  syntheticRecord('T-5', 'other', 'alpha in unrelated category', 'Fixed'), // ignored
];

const syntheticPkg: EvidencePackage = {
  anomaly: { description: 'synthetic anomaly', category: 'test' },
  items: [
    makeItem('EV-01', 'exceedance', 'vibration_exceedance', 0.5),
    makeItem('EV-02', 'trend', 'monotonic_trend_vs_rotor_hours', 1.0),
    makeItem('EV-03', 'constraint', undefined, 0), // pattern-less → ignored by the update
  ],
  computedAt: new Date().toISOString(),
};

describe('runBayes — synthetic exact arithmetic', () => {
  const result = runBayes(syntheticPkg, syntheticLibrary, makeModel(syntheticHistory), syntheticCfg);

  // hand-computed expectations
  // N = 3 usable, counts: h1 = 2 (T-1, T-3), h2 = 1 (T-2); α = 1, K = 2, R = 0.2
  const priorH1 = ((2 + 1) / (3 + 2)) * 0.8; // 0.48
  const priorH2 = ((1 + 1) / (3 + 2)) * 0.8; // 0.32
  const priorC = 0.2;
  const tau = 0.5;
  const s1 = Math.log(priorH1) + tau * (0.5 * Math.log(4) + 1.0 * Math.log(2));
  const s2 = Math.log(priorH2) + tau * (0.5 * Math.log(2));
  const sc = Math.log(priorC);
  const z = Math.exp(s1) + Math.exp(s2) + Math.exp(sc);

  it('computes Laplace-smoothed, reserved-mass priors exactly', () => {
    expectClose(byId(result, 'h1').prior, priorH1, 1e-12);
    expectClose(byId(result, 'h2').prior, priorH2, 1e-12);
    expectClose(byId(result, 'catch').prior, priorC, 1e-12);
  });

  it('matches the hand-computed softmax to 1e-9', () => {
    expectClose(byId(result, 'h1').posterior, Math.exp(s1) / z, 1e-9);
    expectClose(byId(result, 'h2').posterior, Math.exp(s2) / z, 1e-9);
    expectClose(byId(result, 'catch').posterior, Math.exp(sc) / z, 1e-9);
    const total = result.posteriors.reduce((acc, p) => acc + p.posterior, 0);
    expectClose(total, 1, 1e-9);
  });

  it('emits the exact waterfall steps for h1', () => {
    const steps = byId(result, 'h1').waterfall;
    expect(steps.map((s) => s.kind)).toEqual([
      'prior',
      'evidence',
      'evidence',
      'normalization',
      'posterior',
    ]);
    expectClose(steps[0].delta, Math.log(priorH1), 1e-12);
    expect(steps[1].evidenceId).toBe('EV-01');
    expect(steps[1].label).toBe('vibration_exceedance');
    expectClose(steps[1].delta, 0.5 * tau * Math.log(4), 1e-12);
    expect(steps[2].evidenceId).toBe('EV-02');
    expectClose(steps[2].delta, 1.0 * tau * Math.log(2), 1e-12);
    expectClose(steps[3].delta, -Math.log(z), 1e-9);
  });

  it('skips absent-LR patterns and pattern-less items (no bar, no matched id)', () => {
    expect(byId(result, 'h2').matchedEvidence).toEqual(['EV-01']);
    expect(byId(result, 'h1').matchedEvidence).toEqual(['EV-01', 'EV-02']);
    // EV-03 (constraint, no pattern) never appears anywhere
    for (const p of result.posteriors) {
      expect(p.matchedEvidence).not.toContain('EV-03');
      expect(p.waterfall.some((s) => s.evidenceId === 'EV-03')).toBe(false);
    }
  });

  it('catch-all score is ln(prior) exactly — no evidence bars', () => {
    const catchAll = byId(result, 'catch');
    expect(catchAll.matchedEvidence).toEqual([]);
    expect(catchAll.waterfall.map((s) => s.kind)).toEqual(['prior', 'normalization', 'posterior']);
  });

  it('records prior contributions with the first matched keyword', () => {
    expect(byId(result, 'h1').priorContributions).toEqual([
      { anomalyId: 'T-1', vehicle: 'TestCraft', matchedKeyword: 'alpha' },
      { anomalyId: 'T-3', vehicle: 'TestCraft', matchedKeyword: 'alpha' },
    ]);
    expect(byId(result, 'h2').priorContributions).toEqual([
      { anomalyId: 'T-2', vehicle: 'TestCraft', matchedKeyword: 'beta' },
    ]);
    expect(byId(result, 'catch').priorContributions).toEqual([]);
  });

  it('fills priorsMeta with PENDING-excluded and category-filtered records', () => {
    expect(result.priorsMeta.usedRecords).toEqual(['T-1', 'T-2', 'T-3']);
    expect(result.priorsMeta.excludedRecords).toEqual(['T-4']);
    expect(result.priorsMeta.uniformFallback).toBe(false);
    expect(result.priorsMeta.laplaceAlpha).toBe(1.0);
    expect(result.priorsMeta.reservedUnknownMass).toBe(0.2);
    expect(result.tempering).toBe(0.5);
  });

  it('satisfies the waterfall invariant for every hypothesis', () => {
    assertWaterfallInvariants(result);
  });
});

// ---------------------------------------------------------------------------
// MSRH end-to-end (EvidencePackage built inline from the §Analytics golden table)
// ---------------------------------------------------------------------------

interface RawAnomalyRecord {
  anomaly_id: string;
  vehicle: string;
  sol: number;
  category: string;
  severity: string;
  description: string;
  root_cause: string;
  resolution: string;
  downtime_sols: number;
  related_maintenance: string;
}

const msrhHistory: AnomalyRecord[] = (JSON.parse(anomalyHistoryRaw) as RawAnomalyRecord[]).map(
  (r) => ({
    anomalyId: r.anomaly_id,
    vehicle: r.vehicle,
    sol: r.sol,
    category: r.category,
    severity: r.severity,
    description: r.description,
    rootCause: r.root_cause,
    resolution: r.resolution,
    downtimeSols: r.downtime_sols,
    relatedMaintenance: r.related_maintenance,
  }),
);

/** Golden pattern/weight table from docs/CONTRACTS.md §Analytics (items 1–11). */
const msrhPkg: EvidencePackage = {
  anomaly: {
    description:
      'Flight 47 vibration 0.22 g exceeded the 0.186 g alert threshold; auto-grounding triggered.',
    category: 'vibration',
    flightRef: 'F47',
  },
  items: [
    makeItem('EV-01', 'exceedance', 'vibration_exceedance', 1.0),
    makeItem('EV-02', 'trend', 'monotonic_trend_vs_rotor_hours', 0.7982),
    makeItem('EV-03', 'prediction', 'trend_projection_reaches_threshold', 0.5),
    makeItem('EV-04', 'exceedance', 'acute_departure_from_trend', 1.0),
    makeItem('EV-05', 'confounder', 'confounder_unexplained_residual', 1.0),
    makeItem('EV-06', 'exceedance', 'high_wind_during_anomaly', 1.0),
    makeItem('EV-07', 'exceedance', 'gradual_onset_multi_flight', 0.8),
    makeItem('EV-08', 'maintenance_correlation', 'bearing_play_near_limit', 0.875),
    makeItem('EV-09', 'maintenance_correlation', 'maintenance_wear_progression', 0.667),
    makeItem('EV-10', 'maintenance_correlation', 'recent_software_change', 0.567),
    makeItem('EV-11', 'exceedance', 'exceeds_original_threshold', 0.5),
    // display-only items: no pattern → no Bayes contribution
    makeItem('EV-12', 'historical_match', undefined, 1.0),
    makeItem('EV-13', 'historical_match', undefined, 1.0),
    makeItem('EV-14', 'historical_match', undefined, 0.8),
    makeItem('EV-15', 'constraint', undefined, 0),
  ],
  computedAt: new Date().toISOString(),
};

describe('runBayes — MSRH golden case', () => {
  const result = runBayes(msrhPkg, hypothesisLibrary, makeModel(msrhHistory), bayesConfig);

  it('uses exactly the resolved same-category records for priors', () => {
    expect(result.priorsMeta.usedRecords).toEqual([
      'ANM-001',
      'ANM-003',
      'ANM-007',
      'ANM-010',
      'ANM-013',
    ]);
    expect(result.priorsMeta.excludedRecords).toEqual(['ANM-015']);
    expect(result.priorsMeta.uniformFallback).toBe(false);
  });

  it('matches golden priors to 1e-4 and sums to 1', () => {
    expectClose(byId(result, 'bearing_degradation').prior, 0.36538, 1e-4);
    expectClose(byId(result, 'dust_contamination').prior, 0.14615, 1e-4);
    for (const id of [
      'blade_erosion',
      'fod_impact',
      'sensor_artifact',
      'structural_loosening',
      'environmental_transient',
      'software_threshold_artifact',
    ]) {
      expectClose(byId(result, id).prior, 0.07308, 1e-4);
    }
    expectClose(byId(result, 'unknown_other').prior, 0.05, 1e-12);
    const total = result.posteriors.reduce((acc, p) => acc + p.prior, 0);
    expectClose(total, 1, 1e-9);
  });

  it('records heritage prior contributions for bearing_degradation', () => {
    const bearing = byId(result, 'bearing_degradation');
    expect(bearing.priorContributions.map((c) => c.anomalyId)).toEqual([
      'ANM-003',
      'ANM-007',
      'ANM-010',
      'ANM-013',
    ]);
    for (const c of bearing.priorContributions) {
      expect(['bearing', 'lubricant']).toContain(c.matchedKeyword);
    }
    const dust = byId(result, 'dust_contamination');
    expect(dust.priorContributions.map((c) => c.anomalyId)).toEqual(['ANM-001']);
    expect(dust.priorContributions[0].matchedKeyword).toBe('dust ingestion');
  });

  it('ranks bearing_degradation #1 with posterior in [0.55, 0.97]', () => {
    expect(result.posteriors[0].hypothesisId).toBe('bearing_degradation');
    const posterior = result.posteriors[0].posterior;
    expect(posterior).toBeGreaterThanOrEqual(0.55);
    expect(posterior).toBeLessThanOrEqual(0.97);
  });

  it('keeps the storyline alternatives suppressed', () => {
    expect(byId(result, 'environmental_transient').posterior).toBeLessThan(0.05);
    expect(byId(result, 'software_threshold_artifact').posterior).toBeLessThan(0.1);
    const unknown = byId(result, 'unknown_other').posterior;
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeLessThan(0.2);
  });

  it('posteriors sum to 1 (1e-9) and are sorted descending', () => {
    const total = result.posteriors.reduce((acc, p) => acc + p.posterior, 0);
    expectClose(total, 1, 1e-9);
    for (let i = 1; i < result.posteriors.length; i++) {
      expect(result.posteriors[i].posterior).toBeLessThanOrEqual(
        result.posteriors[i - 1].posterior,
      );
    }
    expect(result.posteriors).toHaveLength(hypothesisLibrary.hypotheses.length);
  });

  it('waterfall invariant holds for every hypothesis', () => {
    assertWaterfallInvariants(result);
  });

  it('matched evidence covers exactly the patterns with a declared LR', () => {
    const bearing = byId(result, 'bearing_degradation');
    // bearing LRs: vibration_exceedance, monotonic_trend, trend_projection,
    // acute_departure, gradual_onset, bearing_play_near_limit, wear_progression
    expect(bearing.matchedEvidence).toEqual([
      'EV-01',
      'EV-02',
      'EV-03',
      'EV-04',
      'EV-07',
      'EV-08',
      'EV-09',
    ]);
    // sensor_artifact declares exceeds_original_threshold with lr = 1.0 → zero
    // contribution → no bar for EV-11
    const sensor = byId(result, 'sensor_artifact');
    expect(sensor.matchedEvidence).toEqual(['EV-02', 'EV-10']);
    // display-only items never match
    for (const p of result.posteriors) {
      for (const id of ['EV-12', 'EV-13', 'EV-14', 'EV-15']) {
        expect(p.matchedEvidence).not.toContain(id);
      }
    }
  });

  it('positive evidence shifts bearing up in log-odds', () => {
    expect(byId(result, 'bearing_degradation').logOddsShift).toBeGreaterThan(0);
    expect(byId(result, 'environmental_transient').logOddsShift).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// uniform fallback
// ---------------------------------------------------------------------------

describe('runBayes — uniform fallback without anomaly history', () => {
  it.each([
    ['missing history', makeModel(undefined)],
    ['empty history', makeModel([])],
  ])('falls back to uniform priors (%s)', (_name, model) => {
    const result = runBayes(msrhPkg, hypothesisLibrary, model, bayesConfig);
    expect(result.priorsMeta.uniformFallback).toBe(true);
    expect(result.priorsMeta.usedRecords).toEqual([]);
    expect(result.priorsMeta.excludedRecords).toEqual([]);

    // (1 − R)/K for the 8 regular hypotheses, R for the catch-all
    for (const p of result.posteriors) {
      if (p.hypothesisId === 'unknown_other') {
        expectClose(p.prior, 0.05, 1e-12);
      } else {
        expectClose(p.prior, 0.95 / 8, 1e-12);
      }
      expect(p.priorContributions).toEqual([]);
    }

    const total = result.posteriors.reduce((acc, p) => acc + p.posterior, 0);
    expectClose(total, 1, 1e-9);
    assertWaterfallInvariants(result);

    // evidence still dominates: bearing remains the leading hypothesis
    expect(result.posteriors[0].hypothesisId).toBe('bearing_degradation');
  });
});
