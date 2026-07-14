/**
 * Regex extraction of engineering facts from maintenance-log free text.
 * Every extracted number carries the source record id for provenance;
 * config fallbacks are used (and flagged by an undefined sourceId) when
 * the notes don't contain the fact.
 */
import type { AnalyticsConfig, MaintenanceRecord } from '../types';

const THRESHOLD_RE = /threshold lowered from ([0-9.]+)\s*g to ([0-9.]+)\s*g/i;
const BEARING_LIMIT_RE = /upper spec limit of ([0-9.]+)\s*mm/i;
const BEARING_PLAY_RE = /bearing play[^0-9]*([0-9.]+)\s*mm/gi;

export interface ThresholdInfo {
  originalG: number;
  currentG: number;
  /** maintenance record id the thresholds were parsed from; undefined → config fallback */
  sourceId?: string;
}

/** Vibration alert thresholds (original pre-patch, current) from maintenance notes. */
export function extractThresholds(
  maintenance: MaintenanceRecord[] | undefined,
  cfg: AnalyticsConfig,
): ThresholdInfo {
  let found: ThresholdInfo | undefined;
  for (const rec of sortBySol(maintenance)) {
    const m = THRESHOLD_RE.exec(rec.notes);
    if (m) {
      found = { originalG: Number(m[1]), currentG: Number(m[2]), sourceId: rec.actionId };
    }
  }
  return (
    found ?? { originalG: cfg.defaultOriginalThresholdG, currentG: cfg.defaultAlertThresholdG }
  );
}

export interface BearingLimitInfo {
  limitMm: number;
  /** maintenance record id the limit was parsed from; undefined → config fallback */
  sourceId?: string;
}

/** Bearing-play upper spec limit (mm) from maintenance notes. */
export function extractBearingLimit(
  maintenance: MaintenanceRecord[] | undefined,
  cfg: AnalyticsConfig,
): BearingLimitInfo {
  let found: BearingLimitInfo | undefined;
  for (const rec of sortBySol(maintenance)) {
    const m = BEARING_LIMIT_RE.exec(rec.notes);
    if (m) found = { limitMm: Number(m[1]), sourceId: rec.actionId };
  }
  return found ?? { limitMm: cfg.defaultBearingPlayLimitMm };
}

export interface BearingPlayPoint {
  valueMm: number;
  sol: number;
  actionId: string;
}

/** All bearing-play measurements found in maintenance notes, in sol order. */
export function extractBearingPlaySeries(
  maintenance: MaintenanceRecord[] | undefined,
): BearingPlayPoint[] {
  const points: BearingPlayPoint[] = [];
  for (const rec of sortBySol(maintenance)) {
    const re = new RegExp(BEARING_PLAY_RE.source, BEARING_PLAY_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(rec.notes)) !== null) {
      const value = Number(m[1]);
      if (Number.isFinite(value)) points.push({ valueMm: value, sol: rec.sol, actionId: rec.actionId });
    }
  }
  return points;
}

/** Sample-curing sols from timeline free-text notes ("minimum 60 sols"); fallback 60. */
export function extractCuringSols(notes: string | undefined, fallback = 60): number {
  if (notes) {
    const m = /minimum\s*(\d+)\s*sols?/i.exec(notes);
    if (m) return Number(m[1]);
  }
  return fallback;
}

/** First "$NNNK" figure in free text, as USD; undefined when absent. */
export function extractUsdK(notes: string | undefined): number | undefined {
  if (!notes) return undefined;
  const m = /\$(\d+(?:\.\d+)?)\s*K/i.exec(notes);
  return m ? Number(m[1]) * 1000 : undefined;
}

function sortBySol(maintenance: MaintenanceRecord[] | undefined): MaintenanceRecord[] {
  return [...(maintenance ?? [])].sort((a, b) => a.sol - b.sol);
}
