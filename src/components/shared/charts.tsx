/** Shared Recharts chrome: axis styling, tooltip shell, legend row, chart
 *  captions and the app-wide type tiers (dataviz-skill specs). */
import type { ReactNode } from 'react';
import { P } from './palette';

// ---------------------------------------------------------------------------
// Type tiers — the app-wide typographic hierarchy (apply consistently)
// ---------------------------------------------------------------------------
/** T1 — display number (verdict %, headline cost) */
export const T1 = 'font-mono text-3xl font-semibold tabular-nums leading-none tracking-tight text-slate-100';
/** T2 — section heading (matches Section header) */
export const T2 = 'font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400';
/** T3 — body copy */
export const T3 = 'text-xs leading-relaxed text-slate-300';
/** T4 — caption / annotation */
export const T4 = 'text-[10px] leading-snug text-slate-500';

export const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Recessive hairline axis + mono tick styling shared by every chart. */
export const AXIS_TICK = { fill: P.inkSecondary, fontSize: 10, fontFamily: MONO_STACK } as const;
export const AXIS_LINE = { stroke: P.axis, strokeWidth: 1 } as const;
export const GRID_PROPS = { stroke: P.grid, strokeWidth: 1, strokeDasharray: undefined } as const;

/** Tooltip shell — consistent dark card for all custom tooltip contents. */
export function TipFrame({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-slate-300 shadow-lg">
      {title && (
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

/** One key/value row inside a tooltip, with an optional series swatch. */
export function TipRow({
  label,
  value,
  swatch,
}: {
  label: string;
  value: ReactNode;
  swatch?: string;
}) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-slate-400">
        {swatch && (
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: swatch }} aria-hidden />
        )}
        {label}
      </span>
      <span className="font-mono tabular-nums text-slate-200">{value}</span>
    </p>
  );
}

/**
 * Every chart's caption: a bright plain-English TAKEAWAY (the conclusion,
 * with numbers computed at render) over a recessive METHOD line (how it was
 * computed). "One chart, one message."
 */
export function ChartCaption({ takeaway, method }: { takeaway: ReactNode; method?: ReactNode }) {
  return (
    <div className="mt-1.5 px-1">
      <p className="text-[11px] font-medium leading-snug text-slate-200">{takeaway}</p>
      {method && <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{method}</p>}
    </div>
  );
}

/** HTML legend row (custom — identity never relies on color alone; text wears ink). */
export function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}
