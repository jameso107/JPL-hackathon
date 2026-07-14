/**
 * End-to-end integration: the full pipeline over the bundled MSRH demo case.
 * This is the PRD Phase-1 acceptance test — ingest all seven files → Evidence
 * Package reproduces the known findings → posteriors rank bearing degradation
 * first → decision + triage artifacts are coherent → deterministic narrative
 * fallback works with no network.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ingestFiles } from '../src/ingest';
import { runAnalytics } from '../src/analytics';
import { runBayes } from '../src/reasoning/bayes';
import { runDecision } from '../src/decision';
import { runTriage } from '../src/triage';
import { buildFallbackNarrative } from '../src/reasoning/llm';
import {
  analyticsConfig,
  bayesConfig,
  diagnosticsCatalog,
  hypothesisLibrary,
  riskDefaults,
} from '../src/config';
import { msrhDemoFiles } from '../src/demo/msrhDemo';
import type {
  BayesResult,
  DecisionAnalysis,
  EvidencePackage,
  MissionModel,
  TriagePlan,
} from '../src/types';

let model: MissionModel;
let evidence: EvidencePackage;
let bayes: BayesResult;
let decision: DecisionAnalysis;
let triage: TriagePlan;

beforeAll(() => {
  const result = ingestFiles(msrhDemoFiles);
  expect(result.model).not.toBeNull();
  model = result.model!;
  evidence = runAnalytics(model, analyticsConfig);
  bayes = runBayes(evidence, hypothesisLibrary, model, bayesConfig);
  decision = runDecision(bayes, model, riskDefaults);
  triage = runTriage(bayes, model, diagnosticsCatalog, hypothesisLibrary);
});

describe('E2E: MSRH Flight 47 demo case', () => {
  it('ingests all seven files with no errors and no missing roles', () => {
    const result = ingestFiles(msrhDemoFiles);
    expect(result.unrecognized).toHaveLength(0);
    expect(result.missingRoles).toHaveLength(0);
    expect(result.notices.filter((n) => n.level === 'error')).toHaveLength(0);
    expect(result.model!.telemetry).toHaveLength(47);
  });

  it('evidence package reproduces the known findings', () => {
    const patterns = new Set(evidence.items.map((i) => i.pattern).filter(Boolean));
    expect(patterns).toContain('monotonic_trend_vs_rotor_hours');
    expect(patterns).toContain('confounder_unexplained_residual');
    expect(patterns).toContain('bearing_play_near_limit');
    expect(patterns).toContain('gradual_onset_multi_flight');
    expect(patterns).toContain('exceeds_original_threshold');
    expect(evidence.anomaly.flightRef).toBe('F47');
    // inventory gap + 75-sol margin surface as constraints
    const constraints = evidence.items.filter((i) => i.kind === 'constraint');
    expect(constraints.length).toBeGreaterThanOrEqual(3);
    const text = constraints.map((c) => c.statement).join(' ');
    expect(text).toMatch(/MSRH-RA-002/);
    expect(text).toMatch(/75/);
    // every item has provenance
    for (const item of evidence.items) {
      expect(item.provenance.file.length).toBeGreaterThan(0);
      expect(
        (item.provenance.rows?.length ?? 0) + (item.provenance.recordIds?.length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it('bearing degradation ranks first with a defensible posterior', () => {
    expect(bayes.posteriors[0].hypothesisId).toBe('bearing_degradation');
    expect(bayes.posteriors[0].posterior).toBeGreaterThan(0.5);
    const total = bayes.posteriors.reduce((s, p) => s + p.posterior, 0);
    expect(total).toBeCloseTo(1, 9);
    // environmental transient suppressed by the confounder evidence
    const env = bayes.posteriors.find((p) => p.hypothesisId === 'environmental_transient')!;
    expect(env.posterior).toBeLessThan(0.05);
    // waterfall invariant end-to-end
    for (const p of bayes.posteriors) {
      const last = p.waterfall[p.waterfall.length - 1];
      expect(last.cumulative).toBeCloseTo(Math.log(p.posterior), 9);
    }
  });

  it('decision recommends a flying action and grounding forfeits batch-3 samples', () => {
    expect(['mitigation_service_then_reassess', 'fly_critical_only_mitigated']).toContain(
      decision.recommendedActionId,
    );
    const ground = decision.actions.find((a) => a.actionId === 'ground_until_resupply')!;
    expect(ground.expectedSamples).toBe(0);
    expect(decision.schedule.marginSols.value).toBe(75);
    expect(decision.schedule.effectiveDeadlineSol.value).toBe(320);
  });

  it('triage plan starts with the ground rotor-spin spectral run and fits the margin', () => {
    expect(triage.steps[0].diagnosticId).toBe('ground_spin_spectrum');
    expect(triage.steps[0].candidates.map((c) => c.name)).toContain('Chen, Wei');
    expect(triage.completionSol).toBeLessThan(320);
    for (const step of triage.steps) expect(step.gates.length).toBeGreaterThan(0);
  });

  it('deterministic narrative fallback works offline and cites real evidence ids', () => {
    const narrative = buildFallbackNarrative({
      evidence,
      bayes,
      decision,
      triage,
      vehicle: model.meta.vehicle,
    });
    expect(narrative.executiveSummary.length).toBeGreaterThan(50);
    const validIds = new Set(evidence.items.map((i) => i.id));
    for (const hr of narrative.hypothesisRationales) {
      for (const id of hr.citedEvidence) expect(validIds.has(id)).toBe(true);
    }
    expect(narrative.caveats.length).toBeGreaterThan(0);
  });
});
