/**
 * Column mapping + type coercion for tabular dataset roles, and the structural
 * snake_case → camelCase mapping for the mission timeline.
 * See docs/CONTRACTS.md §Ingest.
 */
import type {
  DatasetRole,
  EarthReturnWindow,
  ExecutionMethod,
  IngestNotice,
  MappingProfile,
  MissionTimeline,
  ScheduledFlight,
} from '../types';

// ---------------------------------------------------------------------------
// Field kinds per role — drive coercion + defaults so every canonical field is
// populated even when a profile or source file omits an optional column.
// Defaults per contract: strings '', numbers 0, anomalyFlag undefined,
// executionMethod 'unknown'.
// ---------------------------------------------------------------------------

export type FieldKind = 'string' | 'number' | 'stringArray' | 'optionalString' | 'executionMethod';

export type TabularRole = Exclude<DatasetRole, 'timeline'>;

export const roleFieldKinds: Record<TabularRole, Record<string, FieldKind>> = {
  telemetry: {
    flightNumber: 'number',
    sol: 'number',
    dateUtc: 'string',
    durationMin: 'number',
    cumulativeRotorHours: 'number',
    rotorRpmAvg: 'number',
    vibrationG: 'number',
    motorTempC: 'number',
    ambientTempC: 'number',
    batteryVStart: 'number',
    batteryVEnd: 'number',
    windSpeedMs: 'number',
    maxAltitudeM: 'number',
    objective: 'string',
    anomalyFlag: 'optionalString',
  },
  maintenance: {
    actionId: 'string',
    sol: 'number',
    dateUtc: 'string',
    action: 'string',
    subsystem: 'string',
    commandingEngineer: 'string',
    executionMethod: 'executionMethod',
    notes: 'string',
    durationHours: 'number',
  },
  anomaly_history: {
    anomalyId: 'string',
    vehicle: 'string',
    sol: 'number',
    category: 'string',
    severity: 'string',
    description: 'string',
    rootCause: 'string',
    resolution: 'string',
    downtimeSols: 'number',
    relatedMaintenance: 'string',
  },
  inventory: {
    partNumber: 'string',
    description: 'string',
    quantityMarsDepot: 'number',
    quantityEarthStaging: 'number',
    nextResupplySol: 'number',
    unitCostUsd: 'number',
    leadTimeWeeksFromEarth: 'number',
    notes: 'string',
  },
  team: {
    name: 'string',
    role: 'string',
    expertise: 'stringArray',
    certifications: 'stringArray',
    currentAssignment: 'string',
    shift: 'string',
    timezone: 'string',
    availability: 'string',
    yearsExperience: 'number',
  },
  budget: {
    category: 'string',
    allocatedUsd: 'number',
    spentUsd: 'number',
    remainingUsd: 'number',
    notes: 'string',
  },
};

const EXECUTION_METHODS: readonly ExecutionMethod[] = [
  'autonomous',
  'robotic_arm_commanded',
  'software_uplink',
  'remote_imaging_inspection',
  'telemetry_review',
  'unknown',
];

export function defaultForKind(kind: FieldKind): unknown {
  switch (kind) {
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'stringArray':
      return [];
    case 'optionalString':
      return undefined;
    case 'executionMethod':
      return 'unknown';
  }
}

type CoerceResult = { ok: true; value: unknown } | { ok: false; detail: string };

/** Coerce a raw source value into the target field kind. Never throws. */
export function coerceValue(kind: FieldKind, raw: unknown): CoerceResult {
  switch (kind) {
    case 'number': {
      if (raw === undefined || raw === null) return { ok: true, value: 0 };
      if (typeof raw === 'number') {
        return Number.isNaN(raw) ? { ok: false, detail: 'NaN' } : { ok: true, value: raw };
      }
      const s = String(raw).trim();
      if (s === '') return { ok: true, value: 0 }; // empty cell → numeric default
      const n = Number(s);
      if (Number.isNaN(n)) return { ok: false, detail: s };
      return { ok: true, value: n };
    }
    case 'string':
      if (raw === undefined || raw === null) return { ok: true, value: '' };
      return { ok: true, value: String(raw) };
    case 'optionalString': {
      if (raw === undefined || raw === null) return { ok: true, value: undefined };
      const s = String(raw);
      return { ok: true, value: s === '' ? undefined : s };
    }
    case 'stringArray': {
      if (Array.isArray(raw)) return { ok: true, value: raw.map((x) => String(x)) };
      if (typeof raw === 'string' && raw !== '') return { ok: true, value: [raw] };
      return { ok: true, value: [] };
    }
    case 'executionMethod': {
      if (typeof raw === 'string' && (EXECUTION_METHODS as readonly string[]).includes(raw)) {
        return { ok: true, value: raw };
      }
      return { ok: true, value: 'unknown' };
    }
  }
}

// ---------------------------------------------------------------------------
// Generic tabular mapper
// ---------------------------------------------------------------------------

export interface SourceRecord {
  source: Record<string, unknown>;
  /** 1-based CSV row for provenance (CSV sources only) */
  sourceRow?: number;
}

/**
 * Check that every `required` column has at least one alias present among the
 * available source keys (CSV header, or first JSON record's keys). Emits one
 * error notice per missing required column; returns true when all present.
 */
export function checkRequiredColumns(
  profile: MappingProfile,
  availableKeys: string[],
  fileName: string,
  notices: IngestNotice[],
): boolean {
  let ok = true;
  for (const col of profile.columns) {
    if (!col.required) continue;
    if (!col.from.some((alias) => availableKeys.includes(alias))) {
      notices.push({
        level: 'error',
        message: `Required column "${col.to}" (source names: ${col.from.join(' | ')}) is missing in "${fileName}" — file contributes nothing`,
        fileName,
      });
      ok = false;
    }
  }
  return ok;
}

/**
 * Map source records to canonical records for a tabular role.
 * - Alias resolution: first `from` name present in the record wins
 *   (handles legacy `technician` vs `commanding_engineer`).
 * - Every canonical field starts at its kind default so records are always
 *   fully shaped regardless of which optional columns exist.
 * - A non-numeric value in a numeric field emits a warning notice and skips
 *   the record (never throws).
 * - Telemetry records get `sourceRow` provenance attached.
 */
export function mapTabularRecords<T>(
  profile: MappingProfile,
  role: TabularRole,
  records: SourceRecord[],
  fileName: string,
  notices: IngestNotice[],
): T[] {
  const kinds = roleFieldKinds[role];
  const out: T[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const rec = records[idx];
    const mapped: Record<string, unknown> = {};
    for (const [field, kind] of Object.entries(kinds)) {
      mapped[field] = defaultForKind(kind);
    }

    let skip = false;
    for (const col of profile.columns) {
      const kind = kinds[col.to];
      if (!kind) continue; // unknown target field for this role — ignore
      const alias = col.from.find((a) => a in rec.source);
      if (alias === undefined) continue; // missing column → default stands
      const result = coerceValue(kind, rec.source[alias]);
      if (!result.ok) {
        const where =
          rec.sourceRow !== undefined ? `row ${rec.sourceRow}` : `record ${idx + 1}`;
        notices.push({
          level: 'warning',
          message: `"${fileName}" ${where}: non-numeric value "${result.detail}" in numeric field "${col.to}" — record skipped`,
          fileName,
        });
        skip = true;
        break;
      }
      mapped[col.to] = result.value;
    }
    if (skip) continue;

    if (role === 'telemetry') mapped.sourceRow = rec.sourceRow ?? idx + 2;
    out.push(mapped as T);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timeline structural mapping (profile has columns: [])
// ---------------------------------------------------------------------------

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function toStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function toStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function mapScheduledFlight(raw: Record<string, unknown>): ScheduledFlight {
  return {
    flightId: toStr(raw.flight_id),
    sol: toNum(raw.sol),
    objective: toStr(raw.objective),
    targetSite: toStr(raw.target_site),
    priority: toStr(raw.priority),
    dependency: toStr(raw.dependency),
    notes: toStr(raw.notes),
    estimatedDurationMin: toNum(raw.estimated_duration_min),
    status: toStr(raw.status),
  };
}

function mapEarthReturnWindow(raw: Record<string, unknown>): EarthReturnWindow {
  return {
    windowOpenSol: toNum(raw.window_open_sol),
    windowCloseSol: toNum(raw.window_close_sol),
    samplesRequired: toNum(raw.samples_required),
    samplesCached: toNum(raw.samples_cached),
    samplesPendingRetrieval: toNum(raw.samples_pending_retrieval),
    pendingSampleFlights: toStrArray(raw.pending_sample_flights),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Structural snake_case → camelCase mapping per the MissionTimeline type. */
export function mapTimeline(raw: Record<string, unknown>): MissionTimeline {
  const flightsRaw = Array.isArray(raw.scheduled_flights) ? raw.scheduled_flights : [];
  const windowRaw = isRecord(raw.earth_return_window) ? raw.earth_return_window : {};
  return {
    currentSol: toNum(raw.current_sol),
    helicopterStatus: toStr(raw.helicopter_status),
    scheduledFlights: flightsRaw.filter(isRecord).map(mapScheduledFlight),
    earthReturnWindow: mapEarthReturnWindow(windowRaw),
    delayCostPerSolUsd: toNum(raw.delay_cost_per_sol_usd),
    notes: toStr(raw.notes),
  };
}
