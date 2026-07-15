/**
 * Log-odds waterfall for one hypothesis (dataviz-skill compliant).
 *
 * Horizontal floating bars over ln-probability: the prior and posterior bars
 * are anchored at ln(p)=0 (certainty); each evidence bar floats from the
 * running cumulative before the step to after it, sign-colored (blue supports,
 * red argues against — the validated diverging pair); the normalization bar is
 * structural gray. Clicking an evidence bar selects that item in the evidence
 * stream (traceability contract).
 */
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAppStore } from '../../state/store';
import type { HypothesisPosterior, WaterfallStep } from '../../types';
import { AXIS_LINE, AXIS_TICK, ChartCaption, LegendRow, TipFrame, TipRow } from '../shared/charts';
import { fmtNum, fmtPct, fmtSigned, truncate } from '../shared/format';
import { prettyTag } from '../shared/names';
import { P } from '../shared/palette';

interface WfRow {
  key: string;
  label: string;
  kind: WaterfallStep['kind'];
  evidenceId?: string;
  delta: number;
  cumulative: number;
  span: [number, number];
}

/** Plain-language names for the structural steps (novice readability). */
const STRUCTURAL_LABELS: Record<string, string> = {
  prior: 'starting belief (history)',
  normalization: 'rebalance to 100%',
  posterior: 'final belief',
};

function buildRows(waterfall: WaterfallStep[]): WfRow[] {
  return waterfall.map((step, i) => {
    const isTotal = step.kind === 'prior' || step.kind === 'posterior';
    const from = isTotal ? 0 : step.cumulative - step.delta;
    const to = step.cumulative;
    const label =
      step.kind === 'evidence'
        ? `${step.evidenceId ?? ''} ${truncate(prettyTag(step.label), 26)}`.trim()
        : STRUCTURAL_LABELS[step.kind] ?? step.kind;
    return {
      key: `${i}|${label}`,
      label,
      kind: step.kind,
      evidenceId: step.evidenceId,
      delta: step.delta,
      cumulative: step.cumulative,
      span: [Math.min(from, to), Math.max(from, to)],
    };
  });
}

function rowColor(row: WfRow): string {
  switch (row.kind) {
    case 'evidence':
      return row.delta >= 0 ? P.blue : P.red;
    case 'posterior':
      return P.aqua;
    default:
      return P.inkMuted; // prior & normalization — structural steps
  }
}

interface WfTipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: WfRow }>;
}

function WfTip({ active, payload }: WfTipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipFrame title={row.kind === 'evidence' ? `${row.evidenceId} · ${row.label}` : row.kind}>
      {row.kind !== 'prior' && row.kind !== 'posterior' && (
        <TipRow label="Δ log-odds" value={fmtSigned(row.delta)} swatch={rowColor(row)} />
      )}
      <TipRow label="cumulative ln p" value={fmtNum(row.cumulative)} />
      <TipRow label="implied probability" value={fmtPct(Math.exp(row.cumulative))} />
      {row.evidenceId && (
        <p className="mt-1 text-[10px] text-sky-400">click bar → open {row.evidenceId}</p>
      )}
    </TipFrame>
  );
}

export function WaterfallChart({ posterior }: { posterior: HypothesisPosterior }) {
  const selectEvidence = useAppStore((s) => s.selectEvidence);
  const rows = buildRows(posterior.waterfall);
  if (rows.length === 0) {
    return <p className="text-xs text-slate-500">No waterfall steps available.</p>;
  }
  const lo = Math.min(0, ...rows.map((r) => r.span[0]));
  const hi = Math.max(0, ...rows.map((r) => r.span[1]));
  const pad = Math.max(0.3, (hi - lo) * 0.06);
  const height = rows.length * 26 + 36;

  return (
    <div>
      <LegendRow
        items={[
          { label: 'supports (+)', color: P.blue },
          { label: 'against (−)', color: P.red },
          { label: 'prior / normalization', color: P.inkMuted },
          { label: 'posterior', color: P.aqua },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 2, right: 12, bottom: 2, left: 4 }}
          barCategoryGap={4}
        >
          <XAxis
            type="number"
            domain={[lo - pad, hi + pad]}
            // Probability ticks on the log-probability axis: novices read
            // "1% … 100%", the scale stays honest (announced in the caption).
            ticks={[
              Math.log(0.001),
              Math.log(0.01),
              Math.log(0.05),
              Math.log(0.1),
              Math.log(0.25),
              Math.log(0.5),
              0,
            ].filter((t) => t >= lo - pad && t <= hi + pad)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtPct(Math.exp(v), Math.exp(v) < 0.02 ? 1 : 0)}
          />
          <YAxis
            type="category"
            dataKey="key"
            width={170}
            tick={{ ...AXIS_TICK, fontSize: 9 }}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(k: string) => k.slice(k.indexOf('|') + 1)}
          />
          <ReferenceLine x={0} stroke={P.axis} strokeWidth={1} />
          <Tooltip content={<WfTip />} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
          <Bar dataKey="span" barSize={14} radius={3} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.key}
                fill={rowColor(row)}
                fillOpacity={row.kind === 'evidence' ? 0.9 : 0.65}
                cursor={row.evidenceId ? 'pointer' : undefined}
                onClick={row.evidenceId ? () => selectEvidence(row.evidenceId ?? null) : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ChartCaption
        takeaway={`Evidence moved this cause from ${fmtPct(Math.exp(rows[0]?.cumulative ?? 0))} to ${fmtPct(posterior.posterior)}.`}
        method="log-probability scale (each tick is a big step) · bars: starting belief → per-evidence pushes (w·τ·ln LR) → rebalance → final belief · click an evidence bar to inspect it"
      />
    </div>
  );
}
