import { describe, expect, it } from 'vitest';
import {
  analyticsConfig,
  bayesConfig,
  diagnosticsCatalog,
  hypothesisLibrary,
  riskDefaults,
  schemaMappings,
} from '../src/config';

describe('config loading (YAML + zod)', () => {
  it('loads the vibration hypothesis library with a single catch-all', () => {
    expect(hypothesisLibrary.category).toBe('vibration');
    expect(hypothesisLibrary.hypotheses).toHaveLength(9);
    expect(hypothesisLibrary.hypotheses.filter((h) => h.isCatchAll)).toHaveLength(1);
    const bearing = hypothesisLibrary.hypotheses.find((h) => h.id === 'bearing_degradation');
    expect(bearing?.evidenceResponse.find((e) => e.pattern === 'bearing_play_near_limit')?.lr).toBe(8);
  });

  it('loads risk defaults with LOV entries for every hypothesis and full citations', () => {
    for (const h of hypothesisLibrary.hypotheses) {
      const entry = riskDefaults.lovPerFlight[h.id];
      expect(entry, `missing LOV for ${h.id}`).toBeDefined();
      for (const profile of ['nominal', 'mitigated', 'post_service', 'grounded'] as const) {
        expect(entry[profile].perFlight).toBeGreaterThanOrEqual(0);
        expect(entry[profile].citation.length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(riskDefaults.actions)).toHaveLength(4);
  });

  it('diagnostics catalog covers every hypothesis in expected outcomes', () => {
    for (const d of diagnosticsCatalog.diagnostics) {
      for (const h of hypothesisLibrary.hypotheses) {
        expect(d.expectedOutcomes[h.id], `${d.id} missing outcome for ${h.id}`).toBeDefined();
      }
      for (const label of Object.values(d.expectedOutcomes)) {
        expect(d.gateActions[label], `${d.id} missing gate action for ${label}`).toBeDefined();
      }
    }
  });

  it('analytics + bayes config values are sane', () => {
    expect(analyticsConfig.baselineWindowFlights).toBe(10);
    expect(bayesConfig.reservedUnknownMass).toBeCloseTo(0.05);
    expect(bayesConfig.tempering).toBeCloseTo(0.7);
  });

  it('schema mappings include a profile per dataset role', () => {
    const roles = new Set(schemaMappings.profiles.map((p) => p.role));
    expect(roles.size).toBe(7);
  });
});
