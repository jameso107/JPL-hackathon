/**
 * Phase-3 acceptance: an unfamiliar telemetry CSV (foreign column names, no
 * matching filename) is unrecognized at first, then maps via a runtime profile
 * and dispositions end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { ingestFiles } from '../src/ingest';
import { runAnalytics } from '../src/analytics';
import { runBayes } from '../src/reasoning/bayes';
import { analyticsConfig, bayesConfig, hypothesisLibrary } from '../src/config';
import { msrhDemoFiles } from '../src/demo/msrhDemo';
import type { MappingProfile, RawFile } from '../src/types';

/** The MSRH telemetry file re-headed with foreign column names + renamed file. */
function foreignTelemetry(): RawFile {
  const original = msrhDemoFiles.find((f) => f.name === 'telemetry_flights.csv')!;
  const lines = original.text.split('\n');
  lines[0] = [
    'flt_no',
    'mars_day',
    'utc',
    'dur_min',
    'rotor_hrs_total',
    'avg_rpm',
    'vib_amp',
    'motor_degc',
    'ambient_degc',
    'vbatt_start',
    'vbatt_end',
    'wind_mps',
    'ceiling_m',
    'sortie_type',
    'flags',
  ].join(',');
  return { name: 'vehicle_sorties_export.csv', text: lines.join('\n') };
}

const runtimeProfile: MappingProfile = {
  id: 'custom_vehicle_sorties_export_csv',
  role: 'telemetry',
  format: 'csv',
  filePatterns: ['^vehicle_sorties_export\\.csv$'],
  signatureFields: [],
  columns: [
    { to: 'flightNumber', from: ['flt_no'], required: true },
    { to: 'sol', from: ['mars_day'], required: true },
    { to: 'dateUtc', from: ['utc'] },
    { to: 'durationMin', from: ['dur_min'], required: true },
    { to: 'cumulativeRotorHours', from: ['rotor_hrs_total'], required: true },
    { to: 'rotorRpmAvg', from: ['avg_rpm'], required: true },
    { to: 'vibrationG', from: ['vib_amp'], required: true },
    { to: 'motorTempC', from: ['motor_degc'] },
    { to: 'ambientTempC', from: ['ambient_degc'], required: true },
    { to: 'batteryVStart', from: ['vbatt_start'] },
    { to: 'batteryVEnd', from: ['vbatt_end'] },
    { to: 'windSpeedMs', from: ['wind_mps'], required: true },
    { to: 'maxAltitudeM', from: ['ceiling_m'] },
    { to: 'objective', from: ['sortie_type'] },
    { to: 'anomalyFlag', from: ['flags'] },
  ],
};

describe('unfamiliar-file schema mapping', () => {
  it('the foreign CSV is unrecognized without a profile', () => {
    const result = ingestFiles([foreignTelemetry()]);
    expect(result.unrecognized).toContain('vehicle_sorties_export.csv');
    expect(result.model).toBeNull(); // telemetry required, none matched
  });

  it('a runtime profile maps it and the disposition runs end-to-end', () => {
    const result = ingestFiles([foreignTelemetry()], [runtimeProfile]);
    expect(result.unrecognized).toHaveLength(0);
    expect(result.model).not.toBeNull();
    const model = result.model!;
    expect(model.telemetry).toHaveLength(47);
    expect(model.telemetry[46].vibrationG).toBeCloseTo(0.22, 6);
    expect(model.meta.sources[0].profileId).toBe('custom_vehicle_sorties_export_csv');

    // telemetry-only pipeline: analytics + bayes with uniform-prior fallback
    const evidence = runAnalytics(model, analyticsConfig);
    expect(evidence.anomaly.flightRef).toBe('F47');
    const patterns = new Set(evidence.items.map((i) => i.pattern).filter(Boolean));
    expect(patterns).toContain('monotonic_trend_vs_rotor_hours');
    expect(patterns).toContain('confounder_unexplained_residual');

    const bayes = runBayes(evidence, hypothesisLibrary, model, bayesConfig);
    expect(bayes.priorsMeta.uniformFallback).toBe(true);
    expect(bayes.posteriors[0].hypothesisId).toBe('bearing_degradation');
  });

  it('runtime profiles take precedence over built-in profiles', () => {
    // a file whose NAME matches the built-in telemetry pattern but whose
    // columns are foreign: the runtime profile (matched by exact name) wins
    const file = { ...foreignTelemetry(), name: 'telemetry_export.csv' };
    const profile: MappingProfile = {
      ...runtimeProfile,
      id: 'custom_precedence',
      filePatterns: ['^telemetry_export\\.csv$'],
    };
    const result = ingestFiles([file], [profile]);
    expect(result.model?.telemetry).toHaveLength(47);
    expect(result.model?.meta.sources[0].profileId).toBe('custom_precedence');
  });
});
