/**
 * Tufte word-sized sparkline: 47 flights of vibration, the alert-threshold
 * hairline, and the anomalous flight as a red (status) dot. No axes, no grid —
 * it reads inline like a word.
 */
import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { analyticsConfig } from '../../config';
import { P } from '../shared/palette';

export default function VibSparkline({
  width = 132,
  height = 34,
}: {
  width?: number;
  height?: number;
}) {
  const model = useAppStore((s) => s.model);
  const evidence = useAppStore((s) => s.evidence);

  const data = useMemo(() => {
    if (!model || model.telemetry.length < 2) return null;
    const flights = [...model.telemetry].sort((a, b) => a.flightNumber - b.flightNumber);
    const threshold =
      evidence?.items.find((i) => Number.isFinite(i.value.thresholdCurrent))?.value
        .thresholdCurrent ?? analyticsConfig.defaultAlertThresholdG;
    const vibs = flights.map((f) => f.vibrationG);
    const min = Math.min(...vibs);
    const max = Math.max(...vibs, threshold) * 1.04;
    const x = (i: number) => (i / (flights.length - 1)) * (width - 6) + 3;
    const y = (v: number) => height - 3 - ((v - min) / (max - min)) * (height - 6);
    const points = flights.map((f, i) => `${x(i).toFixed(1)},${y(f.vibrationG).toFixed(1)}`);
    const last = flights[flights.length - 1];
    return {
      path: `M${points.join(' L')}`,
      thresholdY: y(threshold),
      lastX: x(flights.length - 1),
      lastY: y(last.vibrationG),
      lastOver: last.vibrationG >= threshold,
    };
  }, [model, evidence, width, height]);

  if (!data) return null;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="vibration trend across all flights vs alert threshold"
      className="overflow-visible"
    >
      <line
        x1={0}
        x2={width}
        y1={data.thresholdY}
        y2={data.thresholdY}
        stroke={P.warning}
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.7}
      />
      <path d={data.path} fill="none" stroke={P.blue} strokeWidth={1.5} />
      <circle
        cx={data.lastX}
        cy={data.lastY}
        r={3}
        fill={data.lastOver ? P.critical : P.blue}
        stroke={P.card}
        strokeWidth={1.5}
      />
    </svg>
  );
}
