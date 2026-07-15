/**
 * Ingest — docs/CONTRACTS.md §Ingest.
 *
 * Parses raw files (CSV/JSON), matches them against schema-mapping profiles
 * (config/schema_mappings), builds the canonical MissionModel, and reports
 * notices + degradation (missing roles). Telemetry is the only required role.
 * All error paths produce notices — ingestFiles never throws.
 */
import type {
  AnomalyRecord,
  BudgetLine,
  DatasetRole,
  EngineerRecord,
  FlightRecord,
  IngestNotice,
  IngestResult,
  MaintenanceRecord,
  MappingProfile,
  MissionModel,
  MissionTimeline,
  PartRecord,
  RawFile,
  SourceFileInfo,
} from '../types';
import { schemaMappings } from '../config';
import { parseCsvTable, rowToObject, type CsvTable } from './csv';
import {
  checkRequiredColumns,
  mapTabularRecords,
  mapTimeline,
  type SourceRecord,
  type TabularRole,
} from './mapping';

const ALL_ROLES: readonly DatasetRole[] = [
  'telemetry',
  'maintenance',
  'anomaly_history',
  'inventory',
  'timeline',
  'team',
  'budget',
];

/** Degradation matrix (PRD): capability disabled per missing (non-telemetry) role. */
const DEGRADATION: Partial<Record<DatasetRole, string>> = {
  anomaly_history: 'heritage priors → uniform prior',
  inventory: 'parts/lead-time joins disabled',
  timeline: 'delay-cost math & window pressure disabled',
  team: 'personnel matching disabled',
  budget: 'budget checks disabled',
  maintenance: 'maintenance-correlation evidence disabled',
};

// ---------------------------------------------------------------------------
// Lazy per-file content analysis (parse each format at most once)
// ---------------------------------------------------------------------------

interface FileAnalysis {
  getCsv(): CsvTable | null;
  getJson(): { ok: boolean; value?: unknown };
}

function analyzeFile(file: RawFile): FileAnalysis {
  let csv: CsvTable | null | undefined;
  let json: { ok: boolean; value?: unknown } | undefined;
  return {
    getCsv() {
      if (csv === undefined) {
        try {
          csv = parseCsvTable(file.text);
        } catch {
          csv = null;
        }
      }
      return csv;
    },
    getJson() {
      if (json === undefined) {
        try {
          json = { ok: true, value: JSON.parse(file.text) };
        } catch {
          json = { ok: false };
        }
      }
      return json;
    },
  };
}

// ---------------------------------------------------------------------------
// Profile matching: (a) filename regex, then (b) content signature.
// First profile that matches wins (profiles in config order).
// ---------------------------------------------------------------------------

function filenameMatches(pattern: string, fileName: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(fileName);
  } catch {
    return fileName.toLowerCase().includes(pattern.toLowerCase());
  }
}

/** Candidate source keys for a signature check, per the profile's format. */
function candidateKeys(format: MappingProfile['format'], analysis: FileAnalysis): string[] | null {
  if (format === 'csv') {
    const table = analysis.getCsv();
    return table ? table.header : null;
  }
  const json = analysis.getJson();
  if (!json.ok) return null;
  const value = json.value;
  if (Array.isArray(value)) {
    const first = value[0];
    return first !== null && typeof first === 'object' ? Object.keys(first as object) : null;
  }
  if (value !== null && typeof value === 'object') return Object.keys(value as object);
  return null;
}

function matchProfile(
  file: RawFile,
  analysis: FileAnalysis,
  extraProfiles: MappingProfile[],
): MappingProfile | null {
  // user-confirmed runtime profiles (mapping dialog) take precedence over config
  const profiles = [...extraProfiles, ...schemaMappings.profiles];
  // (a) filename match
  for (const profile of profiles) {
    if (profile.filePatterns.some((p) => filenameMatches(p, file.name))) return profile;
  }
  // (b) content signature: all signatureFields present in header / first record / top-level keys
  for (const profile of profiles) {
    const keys = candidateKeys(profile.format, analysis);
    if (keys && profile.signatureFields.every((f) => keys.includes(f))) return profile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-file extraction of source records
// ---------------------------------------------------------------------------

/** Extract source records (+ CSV provenance rows) for a matched file, or null on failure. */
function extractSourceRecords(
  file: RawFile,
  profile: MappingProfile,
  analysis: FileAnalysis,
  notices: IngestNotice[],
): SourceRecord[] | null {
  if (profile.format === 'csv') {
    const table = analysis.getCsv();
    if (!table) {
      notices.push({
        level: 'error',
        message: `"${file.name}" matched profile ${profile.id} but its CSV content could not be parsed — file contributes nothing`,
        fileName: file.name,
      });
      return null;
    }
    if (!checkRequiredColumns(profile, table.header, file.name, notices)) return null;
    return table.rows.map((row) => ({
      source: rowToObject(table.header, row.cells),
      sourceRow: row.rowNumber,
    }));
  }

  const json = analysis.getJson();
  if (!json.ok) {
    notices.push({
      level: 'error',
      message: `"${file.name}" matched profile ${profile.id} but its JSON content could not be parsed — file contributes nothing`,
      fileName: file.name,
    });
    return null;
  }
  const value = json.value;
  const records: Record<string, unknown>[] = Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
    : value !== null && typeof value === 'object'
      ? [value as Record<string, unknown>]
      : [];
  if (records.length === 0) {
    notices.push({
      level: 'warning',
      message: `"${file.name}" contains no records — file contributes nothing`,
      fileName: file.name,
    });
    return null;
  }
  if (profile.columns.length > 0) {
    if (!checkRequiredColumns(profile, Object.keys(records[0]), file.name, notices)) return null;
  }
  return records.map((source) => ({ source }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface Collected {
  telemetry?: { records: FlightRecord[]; source: SourceFileInfo };
  maintenance?: { records: MaintenanceRecord[]; source: SourceFileInfo };
  anomaly_history?: { records: AnomalyRecord[]; source: SourceFileInfo };
  inventory?: { records: PartRecord[]; source: SourceFileInfo };
  timeline?: { timeline: MissionTimeline; source: SourceFileInfo };
  team?: { records: EngineerRecord[]; source: SourceFileInfo };
  budget?: { records: BudgetLine[]; source: SourceFileInfo };
}

export function ingestFiles(files: RawFile[], extraProfiles: MappingProfile[] = []): IngestResult {
  const notices: IngestNotice[] = [];
  const unrecognized: string[] = [];
  const collected: Collected = {};
  const sourceOrder: SourceFileInfo[] = [];

  for (const file of files) {
    try {
      const analysis = analyzeFile(file);
      const profile = matchProfile(file, analysis, extraProfiles);
      if (!profile) {
        unrecognized.push(file.name);
        notices.push({
          level: 'info',
          message: `"${file.name}" matched no schema-mapping profile — file ignored`,
          fileName: file.name,
        });
        continue;
      }

      if (collected[profile.role]) {
        notices.push({
          level: 'warning',
          message: `"${file.name}" matched role ${profile.role}, which is already loaded from "${collected[profile.role]?.source.fileName}" — duplicate ignored`,
          fileName: file.name,
        });
        continue;
      }

      if (profile.role === 'timeline') {
        const json = analysis.getJson();
        if (!json.ok || json.value === null || typeof json.value !== 'object' || Array.isArray(json.value)) {
          notices.push({
            level: 'error',
            message: `"${file.name}" matched profile ${profile.id} but is not a JSON object — file contributes nothing`,
            fileName: file.name,
          });
          continue;
        }
        const timeline = mapTimeline(json.value as Record<string, unknown>);
        const source: SourceFileInfo = {
          role: 'timeline',
          fileName: file.name,
          profileId: profile.id,
          recordCount: timeline.scheduledFlights.length,
        };
        collected.timeline = { timeline, source };
        sourceOrder.push(source);
        continue;
      }

      const sourceRecords = extractSourceRecords(file, profile, analysis, notices);
      if (!sourceRecords) continue;

      const role = profile.role as TabularRole;
      const source: SourceFileInfo = {
        role,
        fileName: file.name,
        profileId: profile.id,
        recordCount: 0,
      };

      switch (role) {
        case 'telemetry': {
          const records = mapTabularRecords<FlightRecord>(profile, role, sourceRecords, file.name, notices);
          if (records.length === 0) break;
          records.sort((a, b) => a.flightNumber - b.flightNumber);
          source.recordCount = records.length;
          collected.telemetry = { records, source };
          sourceOrder.push(source);
          break;
        }
        case 'maintenance': {
          const records = mapTabularRecords<MaintenanceRecord>(profile, role, sourceRecords, file.name, notices);
          if (records.length === 0) break;
          source.recordCount = records.length;
          collected.maintenance = { records, source };
          sourceOrder.push(source);
          break;
        }
        case 'anomaly_history': {
          const records = mapTabularRecords<AnomalyRecord>(profile, role, sourceRecords, file.name, notices);
          if (records.length === 0) break;
          source.recordCount = records.length;
          collected.anomaly_history = { records, source };
          sourceOrder.push(source);
          break;
        }
        case 'inventory': {
          const records = mapTabularRecords<PartRecord>(profile, role, sourceRecords, file.name, notices);
          if (records.length === 0) break;
          source.recordCount = records.length;
          collected.inventory = { records, source };
          sourceOrder.push(source);
          break;
        }
        case 'team': {
          const records = mapTabularRecords<EngineerRecord>(profile, role, sourceRecords, file.name, notices);
          if (records.length === 0) break;
          source.recordCount = records.length;
          collected.team = { records, source };
          sourceOrder.push(source);
          break;
        }
        case 'budget': {
          const records = mapTabularRecords<BudgetLine>(profile, role, sourceRecords, file.name, notices);
          if (records.length === 0) break;
          source.recordCount = records.length;
          collected.budget = { records, source };
          sourceOrder.push(source);
          break;
        }
      }
    } catch (err) {
      notices.push({
        level: 'error',
        message: `Failed to ingest "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
        fileName: file.name,
      });
    }
  }

  // ---- degradation ---------------------------------------------------------
  const missingRoles = ALL_ROLES.filter((role) => !collected[role]);
  for (const role of missingRoles) {
    if (role === 'telemetry') continue; // handled below as a hard error
    const capability = DEGRADATION[role];
    if (capability) {
      notices.push({
        level: 'info',
        message: `Missing ${role} data: ${capability}`,
      });
    }
  }

  if (!collected.telemetry) {
    notices.push({
      level: 'error',
      message: 'telemetry is required — no telemetry dataset was ingested, so no mission model can be built',
    });
    return { model: null, notices, unrecognized, missingRoles };
  }

  // ---- assembly -------------------------------------------------------------
  const timeline = collected.timeline?.timeline;
  const model: MissionModel = {
    telemetry: collected.telemetry.records,
    ...(collected.maintenance ? { maintenance: collected.maintenance.records } : {}),
    ...(collected.anomaly_history ? { anomalyHistory: collected.anomaly_history.records } : {}),
    ...(collected.inventory ? { inventory: collected.inventory.records } : {}),
    ...(timeline ? { timeline } : {}),
    ...(collected.team ? { team: collected.team.records } : {}),
    ...(collected.budget ? { budget: collected.budget.records } : {}),
    meta: {
      vehicle: 'MSRH',
      ...(timeline ? { currentSol: timeline.currentSol } : {}),
      sources: sourceOrder,
    },
  };

  return { model, notices, unrecognized, missingRoles };
}
