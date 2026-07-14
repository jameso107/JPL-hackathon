import { describe, expect, it } from 'vitest';
import { expectedSamplesSequential, runDecision } from '../src/decision';
import { hypothesisLibrary, riskDefaults } from '../src/config';
import type {
  ActionEvaluation,
  BayesResult,
  BudgetLine,
  EngineerRecord,
  FlightRecord,
  HypothesisPosterior,
  MissionModel,
  MissionTimeline,
  PartRecord,
  WaterfallStep,
} from '../src/types';

import telemetryRaw from '../examples/msrh/telemetry_flights.csv?raw';
import inventoryRaw from '../examples/msrh/parts_inventory.csv?raw';
import budgetRaw from '../examples/msrh/budget_contingency.csv?raw';
import timelineRaw from '../examples/msrh/mission_timeline.json?raw';
import teamRaw from '../examples/msrh/engineering_team.json?raw';

// ---------------------------------------------------------------------------
// Inline MSRH fixture (decoupled from src/ingest per the contract)
// ---------------------------------------------------------------------------

function csvRows(text: string): string[][] {
  // The MSRH CSVs consumed here contain no quoted fields.
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','));
}

function col(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`missing column ${name}`);
  return i;
}

function parseTelemetry(text: string): FlightRecord[] {
  const [header, ...rows] = csvRows(text);
  const c = (name: string) => col(header, name);
  return rows.map((r, i) => ({
    flightNumber: Number(r[c('flight_number')]),
    sol: Number(r[c('sol')]),
    dateUtc: r[c('date_utc')],
    durationMin: Number(r[c('duration_minutes')]),
    cumulativeRotorHours: Number(r[c('cumulative_rotor_hours')]),
    rotorRpmAvg: Number(r[c('rotor_rpm_avg')]),
    vibrationG: Number(r[c('vibration_amplitude_g')]),
    motorTempC: Number(r[c('motor_temp_c')]),
    ambientTempC: Number(r[c('ambient_temp_c')]),
    batteryVStart: Number(r[c('battery_voltage_start')]),
    batteryVEnd: Number(r[c('battery_voltage_end')]),
    windSpeedMs: Number(r[c('wind_speed_ms')]),
    maxAltitudeM: Number(r[c('max_altitude_m')]),
    objective: r[c('flight_objective')],
    anomalyFlag: r[c('anomaly_flag')] || undefined,
    sourceRow: i + 2,
  }));
}

function parseInventory(text: string): PartRecord[] {
  const [header, ...rows] = csvRows(text);
  const c = (name: string) => col(header, name);
  return rows.map((r) => ({
    partNumber: r[c('part_number')],
    description: r[c('description')],
    quantityMarsDepot: Number(r[c('quantity_mars_depot')]),
    quantityEarthStaging: Number(r[c('quantity_earth_staging')]),
    nextResupplySol: Number(r[c('next_resupply_sol')]),
    unitCostUsd: Number(r[c('unit_cost_usd')]),
    leadTimeWeeksFromEarth: Number(r[c('lead_time_weeks_from_earth')]),
    notes: r[c('notes')] ?? '',
  }));
}

function parseBudget(text: string): BudgetLine[] {
  const [header, ...rows] = csvRows(text);
  const c = (name: string) => col(header, name);
  return rows.map((r) => ({
    category: r[c('category')],
    allocatedUsd: Number(r[c('allocated_usd')]),
    spentUsd: Number(r[c('spent_usd')]),
    remainingUsd: Number(r[c('remaining_usd')]),
    notes: r[c('notes')] ?? '',
  }));
}

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
  const telemetry = parseTelemetry(telemetryRaw);
  const inventory = parseInventory(inventoryRaw);
  const budget = parseBudget(budgetRaw);
  const timeline = parseTimeline(timelineRaw);
  const team = parseTeam(teamRaw);
  return {
    telemetry,
    inventory,
    budget,
    timeline,
    team,
    meta: {
      vehicle: 'MSRH',
      currentSol: timeline.currentSol,
      sources: [
        { role: 'telemetry', fileName: 'telemetry_flights.csv', profileId: 'fixture', recordCount: telemetry.length },
        { role: 'inventory', fileName: 'parts_inventory.csv', profileId: 'fixture', recordCount: inventory.length },
        { role: 'budget', fileName: 'budget_contingency.csv', profileId: 'fixture', recordCount: budget.length },
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
const analysis = runDecision(bayes, model, riskDefaults);

function action(id: string): ActionEvaluation {
  const a = analysis.actions.find((x) => x.actionId === id);
  if (!a) throw new Error(`action ${id} missing`);
  return a;
}

describe('runDecision — schedule facts', () => {
  it('computes the golden schedule numbers with citations, asserted: false', () => {
    expect(analysis.schedule.currentSol).toBe(245);
    expect(analysis.schedule.effectiveDeadlineSol.value).toBe(320);
    expect(analysis.schedule.marginSols.value).toBe(75);
    expect(analysis.schedule.delayCostPerSolUsd.value).toBe(285000);
    for (const cv of [
      analysis.schedule.effectiveDeadlineSol,
      analysis.schedule.marginSols,
      analysis.schedule.delayCostPerSolUsd,
    ]) {
      expect(cv.asserted).toBe(false);
      expect(cv.citation.length).toBeGreaterThan(0);
      expect(cv.citation).toContain('mission_timeline.json');
    }
  });
});

describe('runDecision — action evaluations', () => {
  it('evaluates all four actions, sorted ascending by expected risk-adjusted cost', () => {
    expect(analysis.actions).toHaveLength(4);
    for (let i = 1; i < analysis.actions.length; i++) {
      expect(analysis.actions[i].expectedRiskAdjustedCostUsd).toBeGreaterThanOrEqual(
        analysis.actions[i - 1].expectedRiskAdjustedCostUsd,
      );
    }
    expect(analysis.recommendedActionId).toBe(analysis.actions[0].actionId);
  });

  it('ground_until_resupply: delay 85 sols, direct cost $24,490,400, zero expected samples', () => {
    const ground = action('ground_until_resupply');
    expect(ground.delaySols.value).toBe(85);
    expect(ground.directCostUsd).toBe(85 * 285000 + 142000 + 3400 + 35000 + 85000);
    expect(ground.directCostUsd).toBe(24_490_400);
    expect(ground.expectedSamples).toBe(0);
    expect(ground.flightsFlown).toEqual([]);
    expect(ground.marginConsumedSols).toBe(85); // raw, exceeds the 75-sol margin
    expect(ground.summary).toContain('post-window-open deadline');
    expect(ground.summary).toContain('shortfall 2');
  });

  it('flight sets: critical-only flies F48/F49/F51/F52 in sol order; full manifest all six', () => {
    expect(action('fly_critical_only_mitigated').flightsFlown).toEqual(['F48', 'F49', 'F51', 'F52']);
    expect(action('mitigation_service_then_reassess').flightsFlown).toEqual(['F48', 'F49', 'F51', 'F52']);
    expect(action('resume_full_manifest').flightsFlown).toEqual(['F48', 'F49', 'F50', 'F51', 'F52', 'F53']);
  });

  it('LOV ordering: resume_full > fly_critical > ground', () => {
    const resume = action('resume_full_manifest');
    const critical = action('fly_critical_only_mitigated');
    const ground = action('ground_until_resupply');
    expect(resume.lovProbability).toBeGreaterThan(critical.lovProbability);
    expect(critical.lovProbability).toBeGreaterThan(ground.lovProbability);
    expect(ground.lovProbability).toBeCloseTo(0.0005, 10); // single dormancy term
  });

  it('sample-banking survival math walks the sol-ordered flight list (no hard-coded exponents)', () => {
    // fly critical only: ST-17 banks after 2 flights, ST-19 after 4 → (1−p)² + (1−p)⁴
    const critical = action('fly_critical_only_mitigated');
    const bearingCrit = critical.perHypothesis.find((h) => h.hypothesisId === 'bearing_degradation');
    const pMit = riskDefaults.lovPerFlight.bearing_degradation.mitigated.perFlight;
    expect(bearingCrit?.expectedSamples).toBeCloseTo((1 - pMit) ** 2 + (1 - pMit) ** 4, 12);

    // full manifest: F50 sits between the pairs → (1−p)² + (1−p)⁵
    const resume = action('resume_full_manifest');
    const bearingFull = resume.perHypothesis.find((h) => h.hypothesisId === 'bearing_degradation');
    const pNom = riskDefaults.lovPerFlight.bearing_degradation.nominal.perFlight;
    expect(bearingFull?.expectedSamples).toBeCloseTo((1 - pNom) ** 2 + (1 - pNom) ** 5, 12);
  });

  it('survival property: E[samples] strictly decreases as per-flight loss p increases', () => {
    const flights = ['F48', 'F49', 'F50', 'F51', 'F52', 'F53'];
    const banking = ['F49', 'F52'];
    let previous = expectedSamplesSequential(flights, banking, 0);
    expect(previous).toBe(2);
    for (const p of [0.001, 0.005, 0.02, 0.05, 0.1, 0.25, 0.5]) {
      const e = expectedSamplesSequential(flights, banking, p);
      expect(e).toBeLessThan(previous);
      previous = e;
    }
  });

  it('recommends a mitigated flying action', () => {
    expect(['fly_critical_only_mitigated', 'mitigation_service_then_reassess']).toContain(
      analysis.recommendedActionId,
    );
  });

  it('risk-adjusted cost applies the asserted penalties per hypothesis', () => {
    const ground = action('ground_until_resupply');
    const bearing = ground.perHypothesis.find((h) => h.hypothesisId === 'bearing_degradation');
    const expected =
      ground.directCostUsd +
      0.0005 * riskDefaults.vehicleLossPenaltyUsd.value +
      2 * riskDefaults.sampleShortfallPenaltyUsd.value;
    expect(bearing?.riskAdjustedCostUsd).toBeCloseTo(expected, 6);
  });
});

describe('runDecision — budget checks, asserted inputs, sensitivity', () => {
  it('grounding blows the ops + schedule-reserve budget', () => {
    const ground = action('ground_until_resupply');
    expect(
      ground.budgetViolations.some(
        (v) => v.includes('mission_operations') && v.includes('schedule_reserve'),
      ),
    ).toBe(true);
  });

  it('every asserted input has a nonempty citation; penalties + nominal LOV present', () => {
    expect(analysis.assertedInputs.length).toBeGreaterThan(0);
    for (const input of analysis.assertedInputs) {
      expect(input.citation.length).toBeGreaterThan(0);
      expect(input.label.length).toBeGreaterThan(0);
    }
    const labels = analysis.assertedInputs.map((i) => i.label).join(' | ');
    expect(labels).toContain('Vehicle-loss penalty');
    expect(labels).toContain('Sample-shortfall penalty');
    expect(labels).toContain('Nominal per-flight LOV');
    expect(labels).toContain('bearing_degradation');
  });

  it('emits the two computed sensitivity notes (grid flip point + penalty crossover)', () => {
    expect(analysis.sensitivityNotes.length).toBeGreaterThanOrEqual(2);
    for (const note of analysis.sensitivityNotes) expect(note.length).toBeGreaterThan(0);
    expect(analysis.sensitivityNotes.some((n) => n.includes('bearing_degradation'))).toBe(true);
    expect(analysis.sensitivityNotes.some((n) => /vehicle-loss penalty/i.test(n))).toBe(true);
  });

  it('throws a clear error when the timeline is missing', () => {
    const { timeline: _timeline, ...rest } = model;
    expect(() => runDecision(bayes, { ...rest }, riskDefaults)).toThrow(/timeline/i);
  });
});

it.skipIf(!process.env.DEBUG_DECISION)('debug print', () => {
  for (const a of analysis.actions) {
    console.log(
      a.actionId,
      '| EC', Math.round(a.expectedRiskAdjustedCostUsd).toLocaleString(),
      '| direct', Math.round(a.directCostUsd).toLocaleString(),
      '| LOV', a.lovProbability.toFixed(4),
      '| samples', a.expectedSamples.toFixed(3),
      '| delay', a.delaySols.value,
      '| violations', a.budgetViolations.length,
    );
  }
  console.log('recommended:', analysis.recommendedActionId);
  for (const n of analysis.sensitivityNotes) console.log('NOTE:', n);
});
