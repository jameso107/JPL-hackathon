import { describe, expect, it } from 'vitest';
import { ingestFiles } from '../src/ingest';
import { parseCsvRows } from '../src/ingest/csv';
import type { RawFile } from '../src/types';

import telemetryRaw from '../examples/msrh/telemetry_flights.csv?raw';
import maintenanceRaw from '../examples/msrh/maintenance_log.json?raw';
import anomalyRaw from '../examples/msrh/anomaly_history.json?raw';
import inventoryRaw from '../examples/msrh/parts_inventory.csv?raw';
import timelineRaw from '../examples/msrh/mission_timeline.json?raw';
import teamRaw from '../examples/msrh/engineering_team.json?raw';
import budgetRaw from '../examples/msrh/budget_contingency.csv?raw';

const msrhFiles: RawFile[] = [
  { name: 'telemetry_flights.csv', text: telemetryRaw },
  { name: 'maintenance_log.json', text: maintenanceRaw },
  { name: 'anomaly_history.json', text: anomalyRaw },
  { name: 'parts_inventory.csv', text: inventoryRaw },
  { name: 'mission_timeline.json', text: timelineRaw },
  { name: 'engineering_team.json', text: teamRaw },
  { name: 'budget_contingency.csv', text: budgetRaw },
];

describe('ingestFiles — full MSRH dataset', () => {
  const result = ingestFiles(msrhFiles);

  it('ingests all 7 files cleanly with the expected record counts', () => {
    expect(result.model).not.toBeNull();
    const model = result.model!;
    expect(model.telemetry).toHaveLength(47);
    expect(model.maintenance).toHaveLength(10);
    expect(model.anomalyHistory).toHaveLength(15);
    expect(model.inventory).toHaveLength(13);
    expect(model.timeline?.scheduledFlights).toHaveLength(6);
    expect(model.team).toHaveLength(10);
    expect(model.budget).toHaveLength(6);
    expect(result.unrecognized).toEqual([]);
    expect(result.missingRoles).toEqual([]);
    expect(result.notices.filter((n) => n.level === 'error')).toEqual([]);
    expect(result.notices.filter((n) => n.level === 'warning')).toEqual([]);
  });

  it('fills meta: vehicle MSRH, currentSol from timeline, one source per file', () => {
    const model = result.model!;
    expect(model.meta.vehicle).toBe('MSRH');
    expect(model.meta.currentSol).toBe(245);
    expect(model.meta.sources).toHaveLength(7);
    const telemetrySource = model.meta.sources.find((s) => s.role === 'telemetry');
    expect(telemetrySource?.profileId).toBe('msrh_telemetry_v1');
    expect(telemetrySource?.fileName).toBe('telemetry_flights.csv');
    expect(telemetrySource?.recordCount).toBe(47);
    const roles = new Set(model.meta.sources.map((s) => s.role));
    expect(roles.size).toBe(7);
  });

  it('F47 carries anomalyFlag VIBRATION_EXCEEDANCE with sourceRow 48', () => {
    const model = result.model!;
    const f47 = model.telemetry.find((t) => t.flightNumber === 47);
    expect(f47?.anomalyFlag).toBe('VIBRATION_EXCEEDANCE');
    expect(f47?.sourceRow).toBe(48);
    expect(f47?.vibrationG).toBeCloseTo(0.22, 10);
    const f38 = model.telemetry.find((t) => t.flightNumber === 38);
    expect(f38?.anomalyFlag).toBe('MINOR_VIBRATION_NOTE');
    expect(f38?.sourceRow).toBe(39);
  });

  it('empty trailing anomaly_flag maps to undefined; telemetry sorted by flightNumber', () => {
    const model = result.model!;
    const f1 = model.telemetry[0];
    expect(f1.flightNumber).toBe(1);
    expect(f1.anomalyFlag).toBeUndefined();
    expect(f1.sourceRow).toBe(2); // first data row = 2 (header = 1)
    const nums = model.telemetry.map((t) => t.flightNumber);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it('MSRH-RA-002 upper bearing has quantity_mars_depot 0 and resupply Sol 320', () => {
    const part = result.model!.inventory?.find((p) => p.partNumber === 'MSRH-RA-002');
    expect(part).toBeDefined();
    expect(part!.quantityMarsDepot).toBe(0);
    expect(part!.quantityEarthStaging).toBe(2);
    expect(part!.nextResupplySol).toBe(320);
    expect(part!.unitCostUsd).toBe(142000);
    // empty trailing notes field on MSRH-RA-003 → ''
    const ra003 = result.model!.inventory?.find((p) => p.partNumber === 'MSRH-RA-003');
    expect(ra003?.notes).toBe('');
  });

  it('maps the nested timeline structurally (earth_return_window, scheduled_flights)', () => {
    const timeline = result.model!.timeline!;
    expect(timeline.currentSol).toBe(245);
    expect(timeline.helicopterStatus).toBe('GROUNDED_ANOMALY_REVIEW');
    expect(timeline.delayCostPerSolUsd).toBe(285000);
    expect(timeline.earthReturnWindow.windowOpenSol).toBe(380);
    expect(timeline.earthReturnWindow.windowCloseSol).toBe(410);
    expect(timeline.earthReturnWindow.samplesPendingRetrieval).toBe(2);
    expect(timeline.earthReturnWindow.pendingSampleFlights).toEqual(['F48', 'F51']);
    const f48 = timeline.scheduledFlights.find((f) => f.flightId === 'F48');
    expect(f48?.priority).toBe('critical');
    expect(f48?.sol).toBe(250);
    expect(f48?.dependency).toBe('None');
    const f49 = timeline.scheduledFlights.find((f) => f.flightId === 'F49');
    expect(f49?.dependency).toBe('F48 completion');
  });

  it('maps commanding_engineer and executionMethod for maintenance records', () => {
    const ma008 = result.model!.maintenance?.find((m) => m.actionId === 'MA-008');
    expect(ma008?.commandingEngineer).toBe('Rodriguez, Maria');
    expect(ma008?.executionMethod).toBe('robotic_arm_commanded');
    expect(ma008?.subsystem).toBe('rotor_assembly');
    expect(ma008?.sol).toBe(225);
  });

  it('maps team expertise/certification arrays', () => {
    const chen = result.model!.team?.find((e) => e.name === 'Chen, Wei');
    expect(chen?.expertise).toContain('rotor_dynamics');
    expect(chen?.certifications).toContain('MSRH Flight Hardware Level A');
    expect(chen?.yearsExperience).toBe(12);
  });
});

describe('ingestFiles — column aliases & CSV parsing edge cases', () => {
  it('maps legacy `technician` alias to commandingEngineer', () => {
    const legacyMaintenance = JSON.stringify([
      {
        action_id: 'MA-X01',
        sol: 100,
        date_utc: '2028-01-01',
        action: 'Bearing check',
        subsystem: 'rotor_assembly',
        technician: 'Smith, Jane',
        notes: 'Legacy export format.',
        duration_hours: 1.0,
      },
    ]);
    const result = ingestFiles([
      { name: 'telemetry_flights.csv', text: telemetryRaw },
      { name: 'maintenance_log_legacy.json', text: legacyMaintenance },
    ]);
    const rec = result.model?.maintenance?.[0];
    expect(rec?.commandingEngineer).toBe('Smith, Jane');
    // missing execution_method → 'unknown'
    expect(rec?.executionMethod).toBe('unknown');
  });

  it('parses quoted fields containing commas and escaped quotes', () => {
    const csv =
      'flight_number,sol,date_utc,duration_minutes,cumulative_rotor_hours,rotor_rpm_avg,vibration_amplitude_g,ambient_temp_c,wind_speed_ms,flight_objective,anomaly_flag\n' +
      '1,84,2028-04-10,1.8,0.03,2526,0.121,-53.6,7.0,"site survey, extended ""alpha"" leg",\n';
    const result = ingestFiles([{ name: 'telemetry_quoted.csv', text: csv }]);
    expect(result.model).not.toBeNull();
    const rec = result.model!.telemetry[0];
    expect(rec.objective).toBe('site survey, extended "alpha" leg');
    expect(rec.anomalyFlag).toBeUndefined();
    // optional columns absent from the file default: strings '' / numbers 0
    expect(rec.motorTempC).toBe(0);
    expect(rec.batteryVStart).toBe(0);
  });

  it('handles CRLF line endings and trailing newline', () => {
    const csv =
      'flight_number,sol,date_utc,duration_minutes,cumulative_rotor_hours,rotor_rpm_avg,vibration_amplitude_g,ambient_temp_c,wind_speed_ms,flight_objective,anomaly_flag\r\n' +
      '1,84,2028-04-10,1.8,0.03,2526,0.121,-53.6,7.0,recon,\r\n' +
      '2,85,2028-04-11,2.0,0.06,2530,0.122,-40.0,5.0,recon,FLAGGED\r\n';
    const result = ingestFiles([{ name: 'telemetry_crlf.csv', text: csv }]);
    expect(result.model!.telemetry).toHaveLength(2);
    expect(result.model!.telemetry[1].anomalyFlag).toBe('FLAGGED');
    expect(result.model!.telemetry[1].sourceRow).toBe(3);
  });

  it('parseCsvRows: no phantom record after trailing newline; empty trailing field kept', () => {
    expect(parseCsvRows('a,b,\n')).toEqual([['a', 'b', '']]);
    expect(parseCsvRows('a,"b,c",d\r\ne,f,')).toEqual([
      ['a', 'b,c', 'd'],
      ['e', 'f', ''],
    ]);
  });

  it('non-numeric value in a numeric field emits a warning and skips the row', () => {
    const csv =
      'flight_number,sol,date_utc,duration_minutes,cumulative_rotor_hours,rotor_rpm_avg,vibration_amplitude_g,ambient_temp_c,wind_speed_ms,flight_objective,anomaly_flag\n' +
      '1,84,2028-04-10,1.8,0.03,2526,0.121,-53.6,7.0,recon,\n' +
      '2,85,2028-04-11,2.0,0.06,2530,not_a_number,-40.0,5.0,recon,\n' +
      '3,88,2028-04-14,2.2,0.09,2540,0.124,-45.0,4.0,recon,\n';
    const result = ingestFiles([{ name: 'telemetry_bad_row.csv', text: csv }]);
    expect(result.model!.telemetry).toHaveLength(2);
    expect(result.model!.telemetry.map((t) => t.flightNumber)).toEqual([1, 3]);
    const warnings = result.notices.filter((n) => n.level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/non-numeric/i);
    expect(warnings[0].message).toMatch(/row 3/);
  });

  it('missing required column → error notice, file contributes nothing', () => {
    const csv = 'sol,vibration_amplitude_g\n84,0.121\n';
    // name matches the telemetry profile by filename, but flight_number etc. are missing
    const result = ingestFiles([{ name: 'telemetry_partial.csv', text: csv }]);
    expect(result.model).toBeNull();
    const errors = result.notices.filter((n) => n.level === 'error');
    expect(errors.some((n) => /required column/i.test(n.message))).toBe(true);
    expect(result.missingRoles).toContain('telemetry');
  });
});

describe('ingestFiles — profile matching', () => {
  it('matches by content signature when the filename is unhelpful', () => {
    const result = ingestFiles([{ name: 'data_export_001.csv', text: telemetryRaw }]);
    expect(result.model).not.toBeNull();
    expect(result.model!.telemetry).toHaveLength(47);
    expect(result.model!.meta.sources[0].profileId).toBe('msrh_telemetry_v1');
    expect(result.unrecognized).toEqual([]);
  });

  it('lists unmatched files in unrecognized without failing ingest', () => {
    const result = ingestFiles([
      { name: 'telemetry_flights.csv', text: telemetryRaw },
      { name: 'random_notes.txt', text: 'hello, this is not a dataset' },
    ]);
    expect(result.unrecognized).toEqual(['random_notes.txt']);
    expect(result.model).not.toBeNull();
    expect(result.model!.telemetry).toHaveLength(47);
  });
});

describe('ingestFiles — degradation', () => {
  it('missing telemetry → model null + "telemetry is required" error', () => {
    const withoutTelemetry = msrhFiles.filter((f) => f.name !== 'telemetry_flights.csv');
    const result = ingestFiles(withoutTelemetry);
    expect(result.model).toBeNull();
    expect(result.missingRoles).toEqual(['telemetry']);
    const errors = result.notices.filter((n) => n.level === 'error');
    expect(errors.some((n) => n.message.includes('telemetry is required'))).toBe(true);
  });

  it('telemetry-only ingest reports the other 6 roles missing with capability notices', () => {
    const result = ingestFiles([{ name: 'telemetry_flights.csv', text: telemetryRaw }]);
    expect(result.model).not.toBeNull();
    expect(result.missingRoles.sort()).toEqual(
      ['anomaly_history', 'budget', 'inventory', 'maintenance', 'team', 'timeline'].sort(),
    );
    expect(result.model!.meta.currentSol).toBeUndefined();
    const infoMessages = result.notices.filter((n) => n.level === 'info').map((n) => n.message);
    expect(infoMessages.some((m) => m.includes('heritage priors → uniform prior'))).toBe(true);
    expect(infoMessages.some((m) => m.includes('parts/lead-time joins disabled'))).toBe(true);
    expect(infoMessages.some((m) => m.includes('delay-cost math & window pressure disabled'))).toBe(true);
    expect(infoMessages.some((m) => m.includes('personnel matching disabled'))).toBe(true);
    expect(infoMessages.some((m) => m.includes('budget checks disabled'))).toBe(true);
  });

  it('never throws, even on garbage input', () => {
    expect(() => ingestFiles([])).not.toThrow();
    expect(() =>
      ingestFiles([
        { name: 'telemetry_flights.csv', text: '{{{{not csv at all' },
        { name: 'maintenance_log.json', text: 'not json' },
      ]),
    ).not.toThrow();
    const result = ingestFiles([{ name: 'maintenance_log.json', text: 'not json' }]);
    expect(result.model).toBeNull();
    expect(result.notices.some((n) => n.level === 'error')).toBe(true);
  });
});
