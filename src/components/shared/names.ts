/** Display-name lookups shared across tabs. */
import { hypothesisLibrary } from '../../config';
import type { DatasetRole } from '../../types';

const HYP_NAME = new Map(hypothesisLibrary.hypotheses.map((h) => [h.id, h.name]));

/** Human hypothesis name for an id; falls back to a prettified id. */
export function hypName(id: string): string {
  return HYP_NAME.get(id) ?? prettyTag(id);
}

/** "monotonic_trend_vs_rotor_hours" → "monotonic trend vs rotor hours". */
export function prettyTag(tag: string): string {
  return tag.replace(/_/g, ' ');
}

/** Format "hypA vs hypB" id pairs (triage `separates`) with display names. */
export function prettyPair(pair: string): string {
  const [a, b] = pair.split(' vs ');
  return a && b ? `${hypName(a)} vs ${hypName(b)}` : pair;
}

export const ROLE_LABELS: Record<DatasetRole, string> = {
  telemetry: 'flight telemetry',
  maintenance: 'maintenance log',
  anomaly_history: 'anomaly history',
  inventory: 'parts inventory',
  timeline: 'mission timeline',
  team: 'engineering team',
  budget: 'budget & contingency',
};

/** Degradation matrix (PRD): capability disabled per missing non-telemetry role. */
export const DEGRADATION: Partial<Record<DatasetRole, string>> = {
  anomaly_history: 'heritage priors → uniform prior',
  inventory: 'parts/lead-time joins disabled',
  timeline: 'delay-cost math & window pressure disabled',
  team: 'personnel matching disabled',
  budget: 'budget checks disabled',
  maintenance: 'maintenance-correlation evidence disabled',
};
