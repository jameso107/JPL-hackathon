/**
 * Expected-cost comparison as a LOG-SCALE dot plot. The four totals span
 * three decades ($855K direct → $325M) — a linear axis hides three of the
 * four, and stacked bars on a log axis lie (segment lengths lose meaning).
 * Dots + direct labels are the honest form; the log scale is announced.
 */
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis } from 'recharts';
import type { DecisionAnalysis } from '../../types';
import { AXIS_LINE, AXIS_TICK, ChartCaption } from '../shared/charts';
import { fmtUsd, truncate } from '../shared/format';
import { P } from '../shared/palette';

export default function CostDotPlot({ analysis }: { analysis: DecisionAnalysis }) {
  const rows = analysis.actions.map((a, i) => ({
    name: a.name,
    y: analysis.actions.length - i, // best (cheapest) at top
    total: a.expectedRiskAdjustedCostUsd,
    recommended: a.actionId === analysis.recommendedActionId,
  }));
  const min = Math.min(...rows.map((r) => r.total));
  const max = Math.max(...rows.map((r) => r.total));
  const lo = Math.pow(10, Math.floor(Math.log10(min)));
  const hi = Math.pow(10, Math.ceil(Math.log10(max)));
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t *= 10) ticks.push(t);
  const worst = rows.reduce((a, b) => (b.total > a.total ? b : a));
  const best = rows.reduce((a, b) => (b.total < a.total ? b : a));
  const ratio = Math.round(worst.total / best.total);

  return (
    <div>
      <ResponsiveContainer width="100%" height={rows.length * 34 + 40}>
        <ScatterChart margin={{ top: 6, right: 70, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke={P.grid} />
          <XAxis
            type="number"
            dataKey="total"
            scale="log"
            domain={[lo, hi]}
            ticks={ticks}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtUsd(v)}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0.5, rows.length + 0.5]}
            ticks={rows.map((r) => r.y)}
            tick={{ ...AXIS_TICK, fontSize: 9 }}
            tickLine={false}
            axisLine={AXIS_LINE}
            width={190}
            tickFormatter={(y: number) =>
              truncate(rows.find((r) => r.y === y)?.name ?? '', 32)
            }
          />
          <Scatter
            data={rows}
            shape={(props: unknown) => {
              const { cx, cy, payload } = props as {
                cx?: number;
                cy?: number;
                payload?: (typeof rows)[number];
              };
              if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return <g />;
              return (
                <g>
                  {payload.recommended && (
                    <circle cx={cx} cy={cy} r={9} fill="none" stroke={P.good} strokeWidth={1.5} />
                  )}
                  <circle cx={cx} cy={cy} r={5} fill={P.blue} stroke={P.card} strokeWidth={1.5} />
                  <text
                    x={cx + 12}
                    y={cy + 3}
                    fill={payload.recommended ? P.inkPrimary : P.inkSecondary}
                    fontSize={10}
                    fontFamily='"JetBrains Mono", monospace'
                    fontWeight={payload.recommended ? 600 : 400}
                  >
                    {fmtUsd(payload.total)}
                  </text>
                </g>
              );
            }}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
      <ChartCaption
        takeaway={`"${truncate(best.name, 44)}" is the cheapest path — the most expensive option costs ${ratio}× more.`}
        method="LOG SCALE — each gridline is 10× · dot = expected true cost (direct + dollar-priced risks) · green ring = recommended"
      />
    </div>
  );
}
