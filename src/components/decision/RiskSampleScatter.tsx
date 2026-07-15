/**
 * The trade-off at a glance: samples banked (x) vs chance of losing the
 * helicopter (y), one labeled dot per action plan, recommended ringed green.
 * Two aligned position scales — the highest-fidelity encoding for a 4-point
 * trade-off (Cleveland–McGill); the table behind it holds the exact numbers.
 */
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis } from 'recharts';
import { useAppStore } from '../../state/store';
import type { DecisionAnalysis } from '../../types';
import { AXIS_LINE, AXIS_TICK, ChartCaption } from '../shared/charts';
import { fmtNum, fmtPct, truncate } from '../shared/format';
import { P } from '../shared/palette';

export default function RiskSampleScatter({ analysis }: { analysis: DecisionAnalysis }) {
  const model = useAppStore((s) => s.model);
  const pending = model?.timeline?.earthReturnWindow.samplesPendingRetrieval ?? 2;
  const rows = analysis.actions.map((a) => ({
    name: a.name,
    x: a.expectedSamples,
    y: a.lovProbability,
    recommended: a.actionId === analysis.recommendedActionId,
  }));
  const rec = rows.find((r) => r.recommended);
  const worstRisk = Math.max(...rows.map((r) => r.y));
  const riskRatio = rec && rec.y > 0 ? Math.round(worstRisk / rec.y) : null;
  const yMax = Math.max(0.05, worstRisk * 1.25);

  return (
    <div>
      <ResponsiveContainer width="100%" height={230}>
        <ScatterChart margin={{ top: 10, right: 24, bottom: 18, left: 8 }}>
          <CartesianGrid stroke={P.grid} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, pending]}
            ticks={Array.from({ length: pending + 1 }, (_, i) => i)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            label={{
              value: '→ more samples safely banked',
              position: 'insideBottom',
              offset: -12,
              fill: P.inkMuted,
              fontSize: 9,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, Number(yMax.toFixed(3))]}
            width={52}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtPct(v, 0)}
            label={{
              value: '↑ loss risk',
              angle: -90,
              position: 'insideLeft',
              fill: P.inkMuted,
              fontSize: 9,
            }}
          />
          <Scatter
            data={rows}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const { cx, cy, payload } = props as {
                cx?: number;
                cy?: number;
                payload?: (typeof rows)[number];
              };
              if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return <g />;
              const labelLeft = payload.x > pending * 0.6;
              return (
                <g>
                  {payload.recommended && (
                    <circle cx={cx} cy={cy} r={9} fill="none" stroke={P.good} strokeWidth={1.5} />
                  )}
                  <circle cx={cx} cy={cy} r={5} fill={P.blue} stroke={P.card} strokeWidth={1.5} />
                  <text
                    x={labelLeft ? cx - 10 : cx + 10}
                    y={cy - 8}
                    textAnchor={labelLeft ? 'end' : 'start'}
                    fill={payload.recommended ? P.inkPrimary : P.inkSecondary}
                    fontSize={9}
                    fontFamily='"JetBrains Mono", monospace'
                  >
                    {truncate(payload.name, 30)}
                  </text>
                </g>
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
      <ChartCaption
        takeaway={
          rec
            ? `The recommended plan banks ${fmtNum(rec.x)} of ${pending} samples at ${fmtPct(rec.y, 1)} loss risk${
                riskRatio && riskRatio > 1 ? ` — the riskiest option runs ${riskRatio}× hotter` : ''
              }.`
            : 'Each dot is one action plan.'
        }
        method="x: expected samples banked (survival-weighted) · y: chance of losing the helicopter, weighted across all candidate causes"
      />
    </div>
  );
}
