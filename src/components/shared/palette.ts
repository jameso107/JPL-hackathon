/**
 * Chart & chrome color tokens (dataviz-skill validated).
 *
 * Categorical slots were validated against the slate-950 surface (#020617)
 * with the skill's palette validator: lightness band, chroma floor, adjacent
 * CVD ΔE 41.3 worst pair, contrast ≥ 3:1 — all PASS. Categorical hues are
 * assigned in fixed order and follow the entity, never its rank. Status
 * colors are reserved for state and never reused as series colors.
 */
import type { EvidenceKind } from '../../types';

export const P = {
  // surfaces & chrome
  surface: '#020617', // slate-950 page
  card: '#0f172a', // slate-900 chart/card surface
  cardAlt: '#1e293b', // slate-800 raised
  grid: '#1e293b', // hairline gridlines
  axis: '#334155', // baseline / axis rule
  inkPrimary: '#f1f5f9',
  inkSecondary: '#94a3b8',
  inkMuted: '#64748b',

  // categorical series (fixed order, validated set)
  blue: '#3987e5', // slot 1 — primary data hue
  aqua: '#199e70', // slot 2
  yellow: '#c98500', // slot 3
  violet: '#9085e9', // slot 4
  red: '#e66767', // slot 5 (also the diverging "against" pole)
  magenta: '#d55181', // slot 6

  // status (reserved — never used as a series color)
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** Fixed hue per evidence kind — color follows the kind, never the row. */
export const KIND_COLORS: Record<EvidenceKind, string> = {
  exceedance: P.red,
  trend: P.blue,
  prediction: P.magenta,
  confounder: P.yellow,
  maintenance_correlation: P.violet,
  historical_match: P.aqua,
  constraint: P.inkMuted,
};

export const KIND_ORDER: EvidenceKind[] = [
  'exceedance',
  'trend',
  'prediction',
  'confounder',
  'maintenance_correlation',
  'historical_match',
  'constraint',
];
