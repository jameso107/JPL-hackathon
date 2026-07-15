/**
 * Detail-pane context charts (dataviz-skill compliant).
 *
 * - VibrationScatterChart: vibration vs cumulative rotor hours; baseline
 *   flights, OLS trend line + ±2·RMSE band (from the trend evidence item),
 *   dashed threshold reference lines, F47 highlighted, precursor F38 annotated.
 * - BearingPlayChart: bearing-play progression vs sol with the spec-limit line.
 */
import {
  Area,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { extractBearingLimit, extractBearingPlaySeries } from '../../analytics/extractors';
import { analyticsConfig } from '../../config';
import type { EvidencePackage, FlightRecord, MissionModel } from '../../types';
import { AXIS_LINE, AXIS_TICK, LegendRow, TipFrame, TipRow } from '../shared/charts';
import { fmtNum } from '../shared/format';
import { P } from '../shared/palette';

// ---------------------------------------------------------------------------
// Vibration vs rotor hours
// ---------------------------------------------------------------------------

interface ScatterPt {
  hours: number;
  vib: number;
  flight: number;
  sol: number;
  flag?: string;
}

interface TrendPt {
  hours: number;
  trend: number;
  band: [number, number];
}

const toPt = (f: FlightRecord): ScatterPt => ({
  hours: f.cumulativeRotorHours,
  vib: f.vibrationG,
  flight: f.flightNumber,
  sol: f.sol,
  flag: f.anomalyFlag,
});

/** Custom scatter symbol: filled dot + 2px surface ring, optional direct label. */
function makeDot(fill: string, r: number, label?: (pt: ScatterPt) => string | undefined) {
  // Recharts passes cx/cy/payload to custom shapes; loosely typed upstream.
  return function Dot(props: unknown) {
    const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: ScatterPt };
    if (typeof cx !== 'number' || typeof cy !== 'number' || !Number.isFinite(cx + cy)) {
      return <g />;
    }
    const text = payload && label ? label(payload) : undefined;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={P.card} strokeWidth={2} />
        {text && (
          <text
            x={cx + r + 4}
            y={cy + 3}
            fill={P.inkSecondary}
            fontSize={9}
            fontFamily='"JetBrains Mono", monospace'
          >
            {text}
          </text>
        )}
      </g>
    );
  };
}

interface VibTipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Partial<ScatterPt & TrendPt> }>;
}

function VibTip({ active, payload }: VibTipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const isFlight = typeof row.flight === 'number';
  return (
    <TipFrame title={isFlight ? `Flight F${row.flight} · Sol ${row.sol}` : 'trend model'}>
      {typeof row.hours === 'number' && <TipRow label="rotor hours" value={fmtNum(row.hours)} />}
      {typeof row.vib === 'number' && (
        <TipRow label="vibration" value={`${fmtNum(row.vib)} g`} swatch={P.blue} />
      )}
      {typeof row.trend === 'number' && (
        <TipRow label="OLS trend" value={`${fmtNum(row.trend)} g`} swatch={P.blue} />
      )}
      {row.flag && <p className="mt-1 font-mono text-[10px] text-amber-300">{row.flag}</p>}
    </TipFrame>
  );
}

export function VibrationScatterChart({
  model,
  evidence,
}: {
  model: MissionModel;
  evidence: EvidencePackage;
}) {
  const telemetry = [...model.telemetry].sort(
    (a, b) => a.cumulativeRotorHours - b.cumulativeRotorHours,
  );
  if (telemetry.length === 0) return null;

  // Anomalous flight from the package's flightRef (fallback: max vibration).
  const refNum = Number(/^F(\d+)$/.exec(evidence.anomaly.flightRef ?? '')?.[1]);
  const anomFlight =
    telemetry.find((f) => f.flightNumber === refNum) ??
    telemetry.reduce((a, b) => (b.vibrationG > a.vibrationG ? b : a));

  const basePts: ScatterPt[] = [];
  const precPts: ScatterPt[] = [];
  for (const f of telemetry) {
    if (f === anomFlight) continue;
    if (f.anomalyFlag) precPts.push(toPt(f));
    else basePts.push(toPt(f));
  }
  const anomPts = [toPt(anomFlight)];

  // Trend + band from the trend evidence item; thresholds from the exceedance item.
  const trendItem = evidence.items.find((i) => i.pattern === 'monotonic_trend_vs_rotor_hours');
  const threshItem = evidence.items.find((i) => Number.isFinite(i.value.thresholdCurrent));
  const slope = trendItem?.value.slope;
  const intercept = trendItem?.value.intercept;
  const rmse = trendItem?.value.rmse ?? 0;

  const xMax = Math.max(...telemetry.map((f) => f.cumulativeRotorHours)) * 1.06;
  const trendData: TrendPt[] = [];
  if (typeof slope === 'number' && typeof intercept === 'number') {
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const h = (xMax * i) / n;
      const t = slope * h + intercept;
      trendData.push({ hours: h, trend: t, band: [t - 2 * rmse, t + 2 * rmse] });
    }
  }

  const vibs = telemetry.map((f) => f.vibrationG);
  const thrCur = threshItem?.value.thresholdCurrent;
  const thrOrig = threshItem?.value.thresholdOriginal;
  const yMax =
    Math.max(...vibs, thrCur ?? 0, thrOrig ?? 0, ...trendData.map((t) => t.band[1])) * 1.08;
  const yMin = Math.min(...vibs, ...trendData.map((t) => (t.band[0] > 0 ? t.band[0] : 1))) * 0.94;

  return (
    <div>
      <LegendRow
        items={[
          { label: 'baseline flights', color: P.blue },
          { label: 'flagged precursor', color: P.yellow },
          { label: `anomaly ${evidence.anomaly.flightRef ?? ''}`.trim(), color: P.red },
        ]}
      />
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={trendData} margin={{ top: 8, right: 14, bottom: 4, left: 0 }}>
          <XAxis
            type="number"
            dataKey="hours"
            domain={[0, Number(xMax.toFixed(2))]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <YAxis
            type="number"
            dataKey="vib"
            domain={[Number(yMin.toFixed(3)), Number(yMax.toFixed(3))]}
            width={44}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          {trendData.length > 0 && (
            <Area
              dataKey="band"
              stroke="none"
              fill={P.blue}
              fillOpacity={0.1}
              isAnimationActive={false}
              activeDot={false}
            />
          )}
          {trendData.length > 0 && (
            <Line
              dataKey="trend"
              stroke={P.blue}
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {typeof thrCur === 'number' && (
            <ReferenceLine
              y={thrCur}
              stroke={P.warning}
              strokeDasharray="5 4"
              label={{
                value: `alert ${fmtNum(thrCur)} g`,
                position: 'insideBottomRight',
                fill: P.warning,
                fontSize: 9,
              }}
            />
          )}
          {typeof thrOrig === 'number' && thrOrig !== thrCur && (
            <ReferenceLine
              y={thrOrig}
              stroke={P.inkMuted}
              strokeDasharray="5 4"
              label={{
                value: `original ${fmtNum(thrOrig)} g`,
                position: 'insideTopRight',
                fill: P.inkMuted,
                fontSize: 9,
              }}
            />
          )}
          <Tooltip content={<VibTip />} />
          <Scatter data={basePts} shape={makeDot(P.blue, 3.5)} isAnimationActive={false} />
          <Scatter
            data={precPts}
            shape={makeDot(P.yellow, 4.5, (pt) => `F${pt.flight}`)}
            isAnimationActive={false}
          />
          <Scatter
            data={anomPts}
            shape={makeDot(P.red, 5.5, (pt) => `F${pt.flight}`)}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 px-1 text-[10px] leading-snug text-slate-500">
        vibration (g) vs cumulative rotor hours · line: baseline OLS trend, wash: ±2·RMSE band
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bearing-play progression vs sol
// ---------------------------------------------------------------------------

interface PlayPt {
  sol: number;
  play: number;
  id: string;
}

interface PlayTipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: PlayPt }>;
}

function PlayTip({ active, payload }: PlayTipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipFrame title={`${row.id} · Sol ${row.sol}`}>
      <TipRow label="bearing play" value={`${fmtNum(row.play)} mm`} swatch={P.violet} />
    </TipFrame>
  );
}

export function BearingPlayChart({ model }: { model: MissionModel }) {
  const series = extractBearingPlaySeries(model.maintenance);
  const limit = extractBearingLimit(model.maintenance, analyticsConfig).limitMm;
  if (series.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No bearing-play measurements found in the maintenance log.
      </p>
    );
  }
  const data: PlayPt[] = series.map((p) => ({ sol: p.sol, play: p.valueMm, id: p.actionId }));
  const solMin = Math.min(...data.map((d) => d.sol));
  const solMax = Math.max(...data.map((d) => d.sol));
  const solPad = Math.max(5, Math.round((solMax - solMin) * 0.08));

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            type="number"
            dataKey="sol"
            domain={[solMin - solPad, solMax + solPad]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => `${Math.round(v)}`}
          />
          <YAxis
            type="number"
            domain={[0, Number((limit * 1.2).toFixed(4))]}
            width={48}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <ReferenceLine
            y={limit}
            stroke={P.critical}
            strokeDasharray="5 4"
            label={{
              value: `spec limit ${fmtNum(limit)} mm`,
              position: 'insideBottomRight',
              fill: P.critical,
              fontSize: 9,
            }}
          />
          <Tooltip content={<PlayTip />} />
          <Line
            dataKey="play"
            stroke={P.violet}
            strokeWidth={2}
            isAnimationActive={false}
            dot={{ r: 4, fill: P.violet, stroke: P.card, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: P.violet, stroke: P.card, strokeWidth: 2 }}
          >
            <LabelList
              dataKey="play"
              position="top"
              offset={8}
              formatter={(v: number) => fmtNum(v)}
              style={{ fill: P.inkSecondary, fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 px-1 text-[10px] leading-snug text-slate-500">
        rotor bearing play (mm) vs sol · maintenance-log measurements vs upper spec limit
      </p>
    </div>
  );
}
