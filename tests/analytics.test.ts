import { describe, expect, it } from 'vitest';
import { runAnalytics } from '../src/analytics';
import { analyticsConfig } from '../src/config';
import type {
  AnomalyRecord,
  BudgetLine,
  EvidenceItem,
  EvidencePackage,
  FlightRecord,
  MaintenanceRecord,
  MissionModel,
  MissionTimeline,
  PartRecord,
  PatternTag,
} from '../src/types';

import telemetryRaw from '../examples/msrh/telemetry_flights.csv?raw';
import maintenanceRaw from '../examples/msrh/maintenance_log.json?raw';
import anomalyHistoryRaw from '../examples/msrh/anomaly_history.json?raw';
import inventoryRaw from '../examples/msrh/parts_inventory.csv?raw';
import timelineRaw from '../examples/msrh/mission_timeline.json?raw';
import budgetRaw from '../examples/msrh/budget_contingency.csv?raw';

// ---------------------------------------------------------------------------
// Inline fixture parsing (deliberately NOT src/ingest — stays decoupled)
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** rows as string cells, with their 1-based CSV row number (header = row 1) */
function parseCsv(raw: string): { cells: string[]; row: number }[] {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line, i) => ({ line, row: i + 1 }))
    .filter(({ line, row }) => row > 1 && line.trim().length > 0)
    .map(({ line, row }) => ({ cells: splitCsvLine(line), row }));
}

const telemetry: FlightRecord[] = parseCsv(telemetryRaw).map(({ cells: c, row }) => ({
  flightNumber: Number(c[0]),
  sol: Number(c[1]),
  dateUtc: c[2],
  durationMin: Number(c[3]),
  cumulativeRotorHours: Number(c[4]),
  rotorRpmAvg: Number(c[5]),
  vibrationG: Number(c[6]),
  motorTempC: Number(c[7]),
  ambientTempC: Number(c[8]),
  batteryVStart: Number(c[9]),
  batteryVEnd: Number(c[10]),
  windSpeedMs: Number(c[11]),
  maxAltitudeM: Number(c[12]),
  objective: c[13],
  anomalyFlag: c[14] ? c[14] : undefined,
  sourceRow: row,
}));

const inventory: PartRecord[] = parseCsv(inventoryRaw).map(({ cells: c }) => ({
  partNumber: c[0],
  description: c[1],
  quantityMarsDepot: Number(c[2]),
  quantityEarthStaging: Number(c[3]),
  nextResupplySol: Number(c[4]),
  unitCostUsd: Number(c[5]),
  leadTimeWeeksFromEarth: Number(c[6]),
  notes: c[7] ?? '',
}));

const budget: BudgetLine[] = parseCsv(budgetRaw).map(({ cells: c }) => ({
  category: c[0],
  allocatedUsd: Number(c[1]),
  spentUsd: Number(c[2]),
  remainingUsd: Number(c[3]),
  notes: c[4] ?? '',
}));

interface RawMaintenance {
  action_id: string;
  sol: number;
  date_utc: string;
  action: string;
  subsystem: string;
  notes: string;
  duration_hours: number;
  commanding_engineer: string;
  execution_method: string;
}
const maintenance: MaintenanceRecord[] = (JSON.parse(maintenanceRaw) as RawMaintenance[]).map(
  (m) => ({
    actionId: m.action_id,
    sol: m.sol,
    dateUtc: m.date_utc,
    action: m.action,
    subsystem: m.subsystem,
    commandingEngineer: m.commanding_engineer,
    executionMethod: m.execution_method as MaintenanceRecord['executionMethod'],
    notes: m.notes,
    durationHours: m.duration_hours,
  }),
);

interface RawAnomaly {
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
const anomalyHistory: AnomalyRecord[] = (JSON.parse(anomalyHistoryRaw) as RawAnomaly[]).map(
  (a) => ({
    anomalyId: a.anomaly_id,
    vehicle: a.vehicle,
    sol: a.sol,
    category: a.category,
    severity: a.severity,
    description: a.description,
    rootCause: a.root_cause,
    resolution: a.resolution,
    downtimeSols: a.downtime_sols,
    relatedMaintenance: a.related_maintenance,
  }),
);

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
const rawTimeline = JSON.parse(timelineRaw) as RawTimeline;
const timeline: MissionTimeline = {
  currentSol: rawTimeline.current_sol,
  helicopterStatus: rawTimeline.helicopter_status,
  scheduledFlights: rawTimeline.scheduled_flights.map((f) => ({
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
    windowOpenSol: rawTimeline.earth_return_window.window_open_sol,
    windowCloseSol: rawTimeline.earth_return_window.window_close_sol,
    samplesRequired: rawTimeline.earth_return_window.samples_required,
    samplesCached: rawTimeline.earth_return_window.samples_cached,
    samplesPendingRetrieval: rawTimeline.earth_return_window.samples_pending_retrieval,
    pendingSampleFlights: rawTimeline.earth_return_window.pending_sample_flights,
  },
  delayCostPerSolUsd: rawTimeline.delay_cost_per_sol_usd,
  notes: rawTimeline.notes,
};

function buildModel(): MissionModel {
  return {
    telemetry,
    maintenance,
    anomalyHistory,
    inventory,
    timeline,
    budget,
    meta: {
      vehicle: 'MSRH',
      currentSol: timeline.currentSol,
      sources: [
        { role: 'telemetry', fileName: 'telemetry_flights.csv', profileId: 'test', recordCount: telemetry.length },
        { role: 'maintenance', fileName: 'maintenance_log.json', profileId: 'test', recordCount: maintenance.length },
        { role: 'anomaly_history', fileName: 'anomaly_history.json', profileId: 'test', recordCount: anomalyHistory.length },
        { role: 'inventory', fileName: 'parts_inventory.csv', profileId: 'test', recordCount: inventory.length },
        { role: 'timeline', fileName: 'mission_timeline.json', profileId: 'test', recordCount: 1 },
        { role: 'budget', fileName: 'budget_contingency.csv', profileId: 'test', recordCount: budget.length },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function expectNear(actual: number, expected: number, tol: number, label = ''): void {
  expect(Math.abs(actual - expected), `${label} actual=${actual} expected=${expected}±${tol}`).toBeLessThanOrEqual(tol);
}

function byPattern(pkg: EvidencePackage, pattern: PatternTag): EvidenceItem {
  const item = pkg.items.find((i) => i.pattern === pattern);
  expect(item, `missing evidence item with pattern ${pattern}`).toBeDefined();
  return item!;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('runAnalytics — full MSRH dataset', () => {
  const pkg = runAnalytics(buildModel(), analyticsConfig);

  it('identifies F47 as the vibration anomaly', () => {
    expect(pkg.anomaly.flightRef).toBe('F47');
    expect(pkg.anomaly.category).toBe('vibration');
    expect(pkg.anomaly.description).toContain('0.220');
    expect(Date.parse(pkg.computedAt)).not.toBeNaN();
  });

  it('emits exactly the contract pattern set, in contract order', () => {
    const expected: PatternTag[] = [
      'vibration_exceedance',
      'monotonic_trend_vs_rotor_hours',
      'trend_projection_reaches_threshold',
      'acute_departure_from_trend',
      'confounder_unexplained_residual',
      'high_wind_during_anomaly',
      'gradual_onset_multi_flight',
      'bearing_play_near_limit',
      'maintenance_wear_progression',
      'recent_software_change',
      'exceeds_original_threshold',
    ];
    const emitted = pkg.items.filter((i) => i.pattern).map((i) => i.pattern);
    expect(emitted).toEqual(expected);
  });

  it('assigns sequential ids over the emitted items', () => {
    expect(pkg.items.map((i) => i.id)).toEqual(
      pkg.items.map((_, idx) => `EV-${String(idx + 1).padStart(2, '0')}`),
    );
    expect(pkg.items).toHaveLength(20); // 11 patterned + 3 historical + 6 constraints
  });

  it('every item has weight in [0,1] and full provenance', () => {
    for (const item of pkg.items) {
      expect(item.weight, item.id).toBeGreaterThanOrEqual(0);
      expect(item.weight, item.id).toBeLessThanOrEqual(1);
      expect(item.provenance.file.length, item.id).toBeGreaterThan(0);
      const hasRows = (item.provenance.rows?.length ?? 0) > 0;
      const hasIds = (item.provenance.recordIds?.length ?? 0) > 0;
      expect(hasRows || hasIds, `${item.id} missing rows/recordIds`).toBe(true);
      expect(item.statement.length, item.id).toBeGreaterThan(0);
    }
  });

  it('EV-01 robust baseline matches the goldens', () => {
    const ev = byPattern(pkg, 'vibration_exceedance');
    expect(ev.id).toBe('EV-01');
    expectNear(ev.value.median, 0.1285, 1e-5, 'median');
    expectNear(ev.value.mad, 0.0045, 1e-5, 'mad');
    expectNear(ev.value.robustSigma, 0.006672, 1e-5, 'robustSigma');
    expectNear(ev.value.z, 13.71, 0.05, 'z');
    expect(ev.value.vibration).toBe(0.22);
    expect(ev.value.thresholdCurrent).toBe(0.186);
    expect(ev.value.thresholdOriginal).toBe(0.2);
    expect(ev.weight).toBe(1);
    // provenance: baseline window rows 2..11, F47 row 48, threshold source MA-009
    for (const row of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 48]) {
      expect(ev.provenance.rows).toContain(row);
    }
    expect(ev.provenance.recordIds).toContain('MA-009');
  });

  it('EV-02 OLS trend matches the goldens', () => {
    const ev = byPattern(pkg, 'monotonic_trend_vs_rotor_hours');
    expectNear(ev.value.slope, 0.024504, 1e-4, 'slope');
    expectNear(ev.value.intercept, 0.120305, 1e-4, 'intercept');
    expectNear(ev.value.r2, 0.7982, 1e-3, 'r2');
    expectNear(ev.value.t, 13.19, 0.1, 't');
    expectNear(ev.value.rmse, 0.008393, 1e-4, 'rmse');
    expect(ev.value.n).toBe(46);
    expectNear(ev.weight, 0.7982, 1e-3, 'weight = min(1, R²)');
  });

  it('EV-03 threshold-crossing projection matches the goldens', () => {
    const ev = byPattern(pkg, 'trend_projection_reaches_threshold');
    expectNear(ev.value.crossingHours, 2.681, 0.01, 'crossingHours');
    expect(ev.value.anomalyHours).toBe(2.37);
    expect(ev.weight).toBe(0.5);
  });

  it('EV-04 acute departure from trend matches the goldens', () => {
    const ev = byPattern(pkg, 'acute_departure_from_trend');
    expectNear(ev.value.residual, 0.0416, 5e-4, 'residual');
    expectNear(ev.value.ratio, 4.96, 0.05, 'residual/RMSE');
    expect(ev.weight).toBe(1);
  });

  it('EV-05 confounder regression matches the goldens and names the wind twin', () => {
    const ev = byPattern(pkg, 'confounder_unexplained_residual');
    expectNear(ev.value.r2, 0.1402, 5e-3, 'r2');
    expectNear(ev.value.rmse, 0.017947, 5e-4, 'rmse');
    expectNear(ev.value.predicted, 0.1331, 2e-3, 'predicted');
    expectNear(ev.value.residual, 0.0869, 2e-3, 'residual');
    expectNear(ev.value.ratio, 4.84, 0.05, 'residual/RMSE');
    expect(ev.weight).toBe(1);
    expect(ev.value.twinFlight).toBe(23);
    expect(ev.value.twinVibration).toBe(0.148);
    expect(ev.statement).toContain('F23');
  });

  it('EV-06 high wind percentile is 1.0 (ties the fleet max)', () => {
    const ev = byPattern(pkg, 'high_wind_during_anomaly');
    expect(ev.value.percentile).toBe(1);
    expect(ev.weight).toBe(1);
  });

  it('EV-07 classifies gradual onset via the F38 precursor', () => {
    const ev = byPattern(pkg, 'gradual_onset_multi_flight');
    expectNear(ev.weight, 0.8, 1e-9, 'weight');
    expect(ev.value.precursorFlight).toBe(38);
    expect(ev.provenance.rows).toContain(39);
    expect(ev.provenance.rows).toContain(48);
  });

  it('EV-08 bearing play near limit: 0.0035 / 0.004 = 0.875', () => {
    const ev = byPattern(pkg, 'bearing_play_near_limit');
    expect(ev.value.latestPlayMm).toBe(0.0035);
    expect(ev.value.limitMm).toBe(0.004);
    expectNear(ev.weight, 0.875, 1e-9, 'weight');
    expect(ev.provenance.recordIds).toContain('MA-010');
    expect(ev.provenance.recordIds).toContain('MA-008');
  });

  it('EV-09 wear progression across the three bearing-play records', () => {
    const ev = byPattern(pkg, 'maintenance_wear_progression');
    expectNear(ev.weight, 2 / 3, 1e-9, 'weight = (count-1)/3');
    expect(ev.provenance.recordIds).toEqual(['MA-002', 'MA-008', 'MA-010']);
    expect(ev.value.count).toBe(3);
    expect([ev.value.play1, ev.value.play2, ev.value.play3]).toEqual([0.002, 0.003, 0.0035]);
    expect([ev.value.sol1, ev.value.sol2, ev.value.sol3]).toEqual([120, 225, 240]);
  });

  it('EV-10 recent software change: MA-009, delta 13 sols before Sol 245', () => {
    const ev = byPattern(pkg, 'recent_software_change');
    expect(ev.provenance.recordIds).toEqual(['MA-009']);
    expect(ev.value.deltaSols).toBe(13);
    expect(ev.value.anomalyEventSol).toBe(245);
    expectNear(ev.weight, 0.567, 0.01, 'weight = 1 - 13/30');
  });

  it('EV-11 exceeds the original pre-patch threshold with weight 0.5', () => {
    const ev = byPattern(pkg, 'exceeds_original_threshold');
    expect(ev.value.thresholdOriginal).toBe(0.2);
    expectNear(ev.weight, 0.5, 1e-6, 'weight');
  });

  it('historical matches: ANM-003 & ANM-013 top-2 at 1.0, scores descending in [0,1]', () => {
    const hist = pkg.items.filter((i) => i.kind === 'historical_match');
    expect(hist).toHaveLength(analyticsConfig.historicalMatchTopK);
    const top2 = hist.slice(0, 2).map((i) => i.provenance.recordIds?.[0]).sort();
    expect(top2).toEqual(['ANM-003', 'ANM-013']);
    expectNear(hist[0].value.score, 1.0, 1e-9, 'top score');
    expectNear(hist[1].value.score, 1.0, 1e-9, 'second score');
    for (let i = 0; i < hist.length; i++) {
      expect(hist[i].value.score).toBeGreaterThanOrEqual(0);
      expect(hist[i].value.score).toBeLessThanOrEqual(1);
      if (i > 0) expect(hist[i].value.score).toBeLessThanOrEqual(hist[i - 1].value.score);
      expect(hist[i].pattern).toBeUndefined();
      expect(hist[i].weight).toBe(hist[i].value.score);
    }
    // unresolved ANM-015 (resolution PENDING) must never appear
    expect(hist.some((i) => i.provenance.recordIds?.includes('ANM-015'))).toBe(false);
  });

  it('constraint items carry the storyline facts with weight 0 and no pattern', () => {
    const constraints = pkg.items.filter((i) => i.kind === 'constraint');
    expect(constraints).toHaveLength(6);
    for (const c of constraints) {
      expect(c.weight).toBe(0);
      expect(c.pattern).toBeUndefined();
    }

    const bearing = constraints.find((c) => c.provenance.recordIds?.includes('MSRH-RA-002'))!;
    expect(bearing).toBeDefined();
    expect(bearing.value).toMatchObject({
      qtyMars: 0,
      qtyEarth: 2,
      resupplySol: 320,
      unitCost: 142000,
      leadTimeWeeks: 52,
    });

    const lubricant = constraints.find((c) => c.provenance.recordIds?.includes('MSRH-GN-001'))!;
    expect(lubricant).toBeDefined();
    expect(lubricant.value.qtyMars).toBe(3);

    const tl = constraints.find((c) => c.provenance.file === 'mission_timeline.json')!;
    expect(tl).toBeDefined();
    expect(tl.value.effectiveDeadlineSol).toBe(320);
    expect(tl.value.marginSols).toBe(75);
    expect(tl.value.curingSols).toBe(60);
    expect(tl.value.delayCostPerSolUsd).toBe(285000);

    const spare = constraints.find((c) => c.provenance.recordIds?.includes('spare_parts'))!;
    expect(spare).toBeDefined();
    expect(spare.value.remainingUsd).toBe(566000);
    expect(spare.value.bearingSetCostUsd).toBe(280000);

    const reserve = constraints.find((c) => c.provenance.recordIds?.includes('schedule_reserve'))!;
    expect(reserve).toBeDefined();
    expect(reserve.value.remainingUsd).toBe(500000);

    const testing = constraints.find((c) =>
      c.provenance.recordIds?.includes('testing_verification'),
    )!;
    expect(testing).toBeDefined();
    expect(testing.value.remainingUsd).toBe(205000);
    expect(testing.value.campaignCostUsd).toBe(85000);
  });
});

describe('runAnalytics — degraded inputs', () => {
  it('telemetry-only model still emits items 1-7 and nothing else', () => {
    const model: MissionModel = {
      telemetry,
      meta: {
        vehicle: 'MSRH',
        sources: [
          { role: 'telemetry', fileName: 'telemetry_flights.csv', profileId: 'test', recordCount: telemetry.length },
        ],
      },
    };
    const pkg = runAnalytics(model, analyticsConfig);
    expect(pkg.items).toHaveLength(7);
    expect(pkg.items.map((i) => i.pattern)).toEqual([
      'vibration_exceedance',
      'monotonic_trend_vs_rotor_hours',
      'trend_projection_reaches_threshold',
      'acute_departure_from_trend',
      'confounder_unexplained_residual',
      'high_wind_during_anomaly',
      'gradual_onset_multi_flight',
    ]);
    expect(pkg.items.map((i) => i.id)).toEqual(
      ['EV-01', 'EV-02', 'EV-03', 'EV-04', 'EV-05', 'EV-06', 'EV-07'],
    );
    // thresholds fall back to config
    expect(pkg.items[0].value.thresholdCurrent).toBe(analyticsConfig.defaultAlertThresholdG);
    expect(pkg.items[0].value.thresholdOriginal).toBe(analyticsConfig.defaultOriginalThresholdG);
    expect(pkg.items.some((i) => i.kind === 'maintenance_correlation')).toBe(false);
    expect(pkg.items.some((i) => i.kind === 'historical_match')).toBe(false);
    expect(pkg.items.some((i) => i.kind === 'constraint')).toBe(false);
    for (const item of pkg.items) {
      expect(item.weight).toBeGreaterThanOrEqual(0);
      expect(item.weight).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to the max-vibration flight when no EXCEEDANCE flag exists', () => {
    const stripped = telemetry.map((f) => ({ ...f, anomalyFlag: undefined }));
    const model: MissionModel = {
      telemetry: stripped,
      meta: { vehicle: 'MSRH', sources: [] },
    };
    const pkg = runAnalytics(model, analyticsConfig);
    expect(pkg.anomaly.flightRef).toBe('F47'); // F47 is also the max-vibration flight
    expect(pkg.anomaly.description).toMatch(/maximum-vibration/i);
  });

  it('returns an empty package for a model with no telemetry rows', () => {
    const model: MissionModel = { telemetry: [], meta: { vehicle: 'MSRH', sources: [] } };
    const pkg = runAnalytics(model, analyticsConfig);
    expect(pkg.items).toHaveLength(0);
  });
});
