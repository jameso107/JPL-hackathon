import { describe, expect, it } from 'vitest';
import { runTriage } from '../src/triage';
import { diagnosticsCatalog, hypothesisLibrary } from '../src/config';
import type {
  BayesResult,
  EngineerRecord,
  HypothesisPosterior,
  MissionModel,
  MissionTimeline,
  TriageStep,
  WaterfallStep,
} from '../src/types';

import timelineRaw from '../examples/msrh/mission_timeline.json?raw';
import teamRaw from '../examples/msrh/engineering_team.json?raw';

// ---------------------------------------------------------------------------
// Inline MSRH fixture (decoupled from src/ingest per the contract)
// ---------------------------------------------------------------------------

interface RawTimeline {
  current_sol: number;
  helicopter_status: string;
  scheduled_flights: {
    flight_id: string;
    sol: number;
    objective: string;
    target_site: string;
    priority: string;
    dependency: string;
    notes: string;
    estimated_duration_min: number;
    status: string;
  }[];
  earth_return_window: {
    window_open_sol: number;
    window_close_sol: number;
    samples_required: number;
    samples_cached: number;
    samples_pending_retrieval: number;
    pending_sample_flights: string[];
  };
  delay_cost_per_sol_usd: number;
  notes: string;
}

function parseTimeline(text: string): MissionTimeline {
  const raw = JSON.parse(text) as RawTimeline;
  return {
    currentSol: raw.current_sol,
    helicopterStatus: raw.helicopter_status,
    scheduledFlights: raw.scheduled_flights.map((f) => ({
      flightId: f.flight_id,
      sol: f.sol,
      objective: f.objective,
      targetSite: f.target_site,
      priority: f.priority,
      dependency: f.dependency,
      notes: f.notes,
      estimatedDurationMin: f.estimated_duration_min,
      status: f.status,
    })),
    earthReturnWindow: {
      windowOpenSol: raw.earth_return_window.window_open_sol,
      windowCloseSol: raw.earth_return_window.window_close_sol,
      samplesRequired: raw.earth_return_window.samples_required,
      samplesCached: raw.earth_return_window.samples_cached,
      samplesPendingRetrieval: raw.earth_return_window.samples_pending_retrieval,
      pendingSampleFlights: raw.earth_return_window.pending_sample_flights,
    },
    delayCostPerSolUsd: raw.delay_cost_per_sol_usd,
    notes: raw.notes,
  };
}

interface RawEngineer {
  name: string;
  role: string;
  expertise: string[];
  certifications: string[];
  current_assignment: string;
  shift: string;
  timezone: string;
  availability: string;
  years_experience: number;
}

function parseTeam(text: string): EngineerRecord[] {
  const raw = JSON.parse(text) as RawEngineer[];
  return raw.map((e) => ({
    name: e.name,
    role: e.role,
    expertise: e.expertise,
    certifications: e.certifications,
    currentAssignment: e.current_assignment,
    shift: e.shift,
    timezone: e.timezone,
    availability: e.availability,
    yearsExperience: e.years_experience,
  }));
}

function buildModel(): MissionModel {
  const timeline = parseTimeline(timelineRaw);
  const team = parseTeam(teamRaw);
  return {
    telemetry: [],
    timeline,
    team,
    meta: {
      vehicle: 'MSRH',
      currentSol: timeline.currentSol,
      sources: [
        { role: 'timeline', fileName: 'mission_timeline.json', profileId: 'fixture', recordCount: 1 },
        { role: 'team', fileName: 'engineering_team.json', profileId: 'fixture', recordCount: team.length },
      ],
    },
  };
}

/** Synthetic posterior vector per the contract: bearing 0.65, blade 0.10,
 *  others uniform remainder (incl. unknown_other) = 0.25 / 7 each. */
function syntheticBayes(): BayesResult {
  const rest = 0.25 / 7;
  const posteriorFor = (id: string): number =>
    id === 'bearing_degradation' ? 0.65 : id === 'blade_erosion' ? 0.1 : rest;
  const posteriors: HypothesisPosterior[] = hypothesisLibrary.hypotheses
    .map((h) => {
      const p = posteriorFor(h.id);
      const waterfall: WaterfallStep[] = [
        { kind: 'prior', label: 'prior', delta: Math.log(p), cumulative: Math.log(p) },
        { kind: 'posterior', label: 'posterior', delta: 0, cumulative: Math.log(p) },
      ];
      return {
        hypothesisId: h.id,
        name: h.name,
        prior: p,
        posterior: p,
        logOddsShift: 0,
        waterfall,
        priorContributions: [],
        matchedEvidence: [],
      };
    })
    .sort((a, b) => b.posterior - a.posterior);
  return {
    posteriors,
    priorsMeta: {
      usedRecords: [],
      excludedRecords: [],
      laplaceAlpha: 1,
      reservedUnknownMass: 0.05,
      uniformFallback: false,
    },
    tempering: 0.7,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const model = buildModel();
const bayes = syntheticBayes();
const plan = runTriage(bayes, model, diagnosticsCatalog, hypothesisLibrary);

function step(diagnosticId: string): TriageStep {
  const s = plan.steps.find((x) => x.diagnosticId === diagnosticId);
  if (!s) throw new Error(`step ${diagnosticId} missing`);
  return s;
}

describe('runTriage — discrimination scoring & ordering', () => {
  it('ground_spin_spectrum is step 1 (it separates the most posterior-weighted pairs)', () => {
    expect(plan.steps[0].diagnosticId).toBe('ground_spin_spectrum');
  });

  it('matches the hand-computed discrimination score for ground_spin_spectrum', () => {
    // Σ_{i<j} p_i p_j = (1 − Σ p²)/2, minus the same-label pairs
    // (blade_erosion, fod_impact) and (environmental_transient, software_threshold_artifact).
    const rest = 0.25 / 7;
    const sumSq = 0.65 ** 2 + 0.1 ** 2 + 7 * rest ** 2;
    const expected = (1 - sumSq) / 2 - 0.1 * rest - rest * rest;
    expect(plan.steps[0].discriminationScore).toBeCloseTo(expected, 9);
  });

  it('discrimination scores are descending, above the 0.005 noise floor, capped at 6 steps', () => {
    expect(plan.steps.length).toBeLessThanOrEqual(6);
    expect(plan.steps.length).toBe(6); // 7 catalog diagnostics all score > 0.005 → cap applies
    for (let i = 1; i < plan.steps.length; i++) {
      expect(plan.steps[i].discriminationScore).toBeLessThanOrEqual(
        plan.steps[i - 1].discriminationScore,
      );
    }
    for (const s of plan.steps) expect(s.discriminationScore).toBeGreaterThan(0.005);
    // sensor_cross_check has the lowest score for these posteriors → dropped by the cap
    expect(plan.steps.some((s) => s.diagnosticId === 'sensor_cross_check')).toBe(false);
  });

  it('separates lists the top pairs by posterior product, led by bearing vs blade', () => {
    const first = plan.steps[0];
    expect(first.separates.length).toBeLessThanOrEqual(5);
    expect(first.separates[0]).toBe('bearing_degradation vs blade_erosion');
  });
});

describe('runTriage — sequential scheduling', () => {
  it('steps are sequential from currentSol + 1 and stay within the margin', () => {
    expect(plan.steps[0].startSol).toBe(246);
    for (let i = 1; i < plan.steps.length; i++) {
      expect(plan.steps[i].startSol).toBe(
        plan.steps[i - 1].startSol + plan.steps[i - 1].durationSols,
      );
    }
    const last = plan.steps[plan.steps.length - 1];
    expect(plan.completionSol).toBe(last.startSol + last.durationSols);
    expect(plan.totalDurationSols).toBe(
      plan.steps.reduce((sum, s) => sum + s.durationSols, 0),
    );
    expect(plan.completionSol).toBeLessThanOrEqual(320); // effective deadline
    expect(plan.completionSol - 245).toBeLessThanOrEqual(75); // margin
  });
});

describe('runTriage — gates', () => {
  it('step 1 has a bearing_sideband_signature gate supporting bearing_degradation', () => {
    const gss = step('ground_spin_spectrum');
    const gate = gss.gates.find((g) => g.outcome === 'bearing_sideband_signature');
    expect(gate).toBeDefined();
    expect(gate?.supports).toEqual(['bearing_degradation']);
    // refutes = hypotheses with other labels AND posterior ≥ 0.05 → only blade_erosion here
    expect(gate?.refutes).toContain('blade_erosion');
    expect(gate?.refutes).not.toContain('dust_contamination');
    expect(gate?.refutes).not.toContain('bearing_degradation');
    expect(gate?.nextAction.length).toBeGreaterThan(0);
  });

  it('every step has at least one gate with a next action, and a nonempty rationale', () => {
    for (const s of plan.steps) {
      expect(s.gates.length).toBeGreaterThanOrEqual(1);
      for (const g of s.gates) expect(g.nextAction.length).toBeGreaterThan(0);
      expect(s.rationale.length).toBeGreaterThan(0);
      expect(s.rationale).toContain('Separates');
    }
  });

  it('an inconclusive outcome supports nothing', () => {
    const gss = step('ground_spin_spectrum');
    const inconclusive = gss.gates.find((g) => g.outcome === 'inconclusive');
    expect(inconclusive?.supports).toEqual([]);
  });
});

describe('runTriage — personnel candidates', () => {
  it('Chen & Rodriguez are the top-2 candidates for step 1, above Johansson', () => {
    const gss = step('ground_spin_spectrum');
    expect(gss.candidates.length).toBeGreaterThanOrEqual(2);
    const names = gss.candidates.map((c) => c.name);
    expect(names[0]).toBe('Chen, Wei');
    expect(names[1]).toBe('Rodriguez, Maria');
    const johansson = gss.candidates.find((c) => c.name === 'Johansson, Erik');
    if (johansson) {
      expect(johansson.score).toBeLessThan(gss.candidates[1].score);
    }
  });

  it('candidate match rationales carry tags, cert level, and availability', () => {
    const gss = step('ground_spin_spectrum');
    const chen = gss.candidates.find((c) => c.name === 'Chen, Wei');
    expect(chen?.matchRationale).toContain('rotor_dynamics');
    expect(chen?.matchRationale).toContain('vibration_analysis');
    expect(chen?.matchRationale).toContain('Level A');
    expect(chen?.matchRationale).toContain('available');
    for (const s of plan.steps) {
      expect(s.candidates.length).toBeLessThanOrEqual(3);
      for (const c of s.candidates) expect(c.matchRationale.length).toBeGreaterThan(0);
    }
  });

  it('skips candidates gracefully when the team file is absent', () => {
    const { team: _team, ...rest } = model;
    const noTeamPlan = runTriage(bayes, { ...rest }, diagnosticsCatalog, hypothesisLibrary);
    expect(noTeamPlan.steps.every((s) => s.candidates.length === 0)).toBe(true);
    expect(noTeamPlan.notes.some((n) => /no.*team|personnel/i.test(n))).toBe(true);
  });
});

describe('runTriage — notes & costs', () => {
  it('includes the margin note and the sensor-inference caveat', () => {
    expect(plan.notes.some((n) => n.includes('75-sol'))).toBe(true);
    expect(
      plan.notes.some((n) => n.includes('sensor_cross_check') && n.includes('MA-008/MA-010')),
    ).toBe(true);
  });

  it('carries estimated costs from the diagnostics catalog', () => {
    expect(step('ground_spin_spectrum').estimatedCostUsd).toBe(15000);
    for (const s of plan.steps) {
      const spec = diagnosticsCatalog.diagnostics.find((d) => d.id === s.diagnosticId);
      expect(s.estimatedCostUsd).toBe(spec?.estimatedCostUsd);
    }
  });
});
