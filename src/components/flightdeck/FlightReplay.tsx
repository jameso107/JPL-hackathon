/**
 * Flight Replay — one flight's reconstructed profile animated over terrain:
 * helicopter marker along the path, 0.25×–4× playback with a scrubber,
 * synchronized strip charts (vibration / altitude / battery) with a playhead,
 * threshold alarm flash, and a prominent RECONSTRUCTED badge.
 */
import * as THREE from 'three';
import { clsx } from 'clsx';
import { Pause, Play, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReconstructedFlight } from '../../scenes/reconstruct';
import { vibrationRgb } from '../../scenes/reconstruct';
import {
  buildHelicopterMarker,
  buildPathTube,
  createDeckScene,
} from '../../scenes/sceneSetup';
import { AXIS_LINE, AXIS_TICK } from '../shared/charts';
import { fmtNum } from '../shared/format';
import { P } from '../shared/palette';
import { Badge } from '../shared/ui';

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

interface FlightReplayProps {
  reconstruction: ReconstructedFlight;
  alertThresholdG: number;
}

/** Sample a path/channel array at fractional progress p ∈ [0,1]. */
function sampleAt<T>(arr: T[], p: number): T {
  return arr[Math.max(0, Math.min(arr.length - 1, Math.round(p * (arr.length - 1))))];
}

function StripChart({
  data,
  dataKey,
  color,
  playheadT,
  unit,
  threshold,
}: {
  data: { t: number; [k: string]: number }[];
  dataKey: string;
  color: string;
  playheadT: number;
  unit: string;
  threshold?: number;
}) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 px-1 pt-1">
      <p className="px-2 font-mono text-[9px] uppercase tracking-wider text-slate-500">
        {dataKey} ({unit})
      </p>
      <ResponsiveContainer width="100%" height={74}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, 'dataMax']}
            tick={{ ...AXIS_TICK, fontSize: 8 }}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => `${Math.round(v)}s`}
            height={14}
          />
          <YAxis
            width={40}
            domain={['auto', 'auto']}
            tick={{ ...AXIS_TICK, fontSize: 8 }}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          {typeof threshold === 'number' && (
            <ReferenceLine y={threshold} stroke={P.critical} strokeDasharray="4 3" />
          )}
          <ReferenceLine x={playheadT} stroke={P.inkPrimary} strokeWidth={1} />
          <Line
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function FlightReplay({ reconstruction: r, alertThresholdG }: FlightReplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<THREE.Group | null>(null);
  const rotorRef = useRef<THREE.Mesh | null>(null);
  const trailRef = useRef<THREE.Mesh | null>(null);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  /** replay time in flight-seconds — chart playhead updates ~10 Hz */
  const [tDisplay, setTDisplay] = useState(0);
  const tRef = useRef(0);
  const speedRef = useRef<number>(speed);
  speedRef.current = speed;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const chartData = useMemo(
    () =>
      r.channels.map((c) => ({
        t: c.t,
        vibration: c.vibration,
        altitude: c.agl,
        battery: c.battery,
      })),
    [r],
  );

  // --- scene lifecycle -----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const deck = createDeckScene(container);

    const colors = r.channels.map((c) => vibrationRgb(c.vibration, alertThresholdG));
    const tube = buildPathTube(r.path, colors, 1.2);
    (tube.material as THREE.MeshBasicMaterial).transparent = true;
    (tube.material as THREE.MeshBasicMaterial).opacity = 0.85;
    deck.scene.add(tube);
    trailRef.current = tube;

    const { group, rotor } = buildHelicopterMarker();
    deck.scene.add(group);
    markerRef.current = group;
    rotorRef.current = rotor;

    // frame the flight: aim controls at the track midpoint
    const mid = r.path[Math.floor(r.path.length / 2)];
    deck.controls.target.set(mid.x, mid.y, mid.z);
    deck.camera.position.set(mid.x + 320, mid.y + 260, mid.z + 380);

    tRef.current = 0;
    let chartAccum = 0;
    const off = deck.onFrame((dt) => {
      if (playingRef.current) {
        tRef.current = Math.min(r.durationS, tRef.current + dt * speedRef.current * 6);
        // ×6: one real second ≈ six flight-seconds at 1× (flights are minutes long)
        if (tRef.current >= r.durationS) playingRef.current = false;
      }
      const p = r.durationS > 0 ? tRef.current / r.durationS : 0;
      const pos = sampleAt(r.path, p);
      group.position.set(pos.x, pos.y, pos.z);
      const ch = sampleAt(r.channels, p);
      rotor.rotation.y += dt * (ch.rpm / 60) * Math.PI * 0.4; // stylized spin
      const drawTotal = (tube.geometry.index?.count ?? 0) * p;
      tube.geometry.setDrawRange(0, Math.ceil(drawTotal));
      chartAccum += dt;
      if (chartAccum > 0.1) {
        chartAccum = 0;
        setTDisplay(tRef.current);
        if (!playingRef.current) setPlaying(false);
      }
    });

    return () => {
      off();
      deck.dispose();
    };
  }, [r, alertThresholdG]);

  const current = sampleAt(r.channels, r.durationS > 0 ? tDisplay / r.durationS : 0);
  const alarming = current.vibration >= alertThresholdG;

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      <div
        className={clsx(
          'relative h-[520px] overflow-hidden rounded-lg border transition-colors',
          alarming ? 'border-red-500/80 shadow-[inset_0_0_60px_rgba(208,59,59,0.25)]' : 'border-slate-800',
        )}
      >
        <div ref={containerRef} className="h-full w-full" />

        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <Badge tone="warning">RECONSTRUCTED FROM SUMMARY TELEMETRY</Badge>
          <Badge tone="accent">
            F{r.flight.flightNumber} · Sol {r.flight.sol} ·{' '}
            {r.flight.objective.replace(/_/g, ' ')}
          </Badge>
          {alarming && (
            <span className="flex animate-pulse items-center gap-1 rounded border border-red-500/60 bg-red-500/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-300">
              <TriangleAlert size={11} /> vibration exceedance
            </span>
          )}
        </div>

        {/* transport bar */}
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-950/85 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => {
              if (!playing && tRef.current >= r.durationS) {
                tRef.current = 0;
                setTDisplay(0);
              }
              setPlaying((p) => !p);
            }}
            className="rounded border border-sky-500/50 bg-sky-500/10 p-1.5 text-sky-300 transition-colors hover:bg-sky-500/20"
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <input
            type="range"
            min={0}
            max={r.durationS}
            step={0.5}
            value={tDisplay}
            onChange={(e) => {
              tRef.current = Number(e.target.value);
              setTDisplay(tRef.current);
            }}
            className="flex-1 accent-sky-500"
            aria-label="flight time (s)"
          />
          <span className="w-24 text-right font-mono text-[10px] tabular-nums text-slate-400">
            T+{Math.floor(tDisplay)}s / {Math.floor(r.durationS)}s
          </span>
          <div className="flex overflow-hidden rounded border border-slate-700">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={clsx(
                  'px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                  speed === s
                    ? 'bg-sky-500/25 text-sky-300'
                    : 'text-slate-500 hover:text-slate-300',
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* synchronized strip charts */}
      <div className="flex flex-col gap-2">
        <div className="rounded border border-slate-800 bg-slate-900/60 p-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            live channels · T+{Math.floor(tDisplay)}s
          </p>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            <div>
              <p
                className="font-mono text-sm font-semibold tabular-nums"
                style={{ color: alarming ? P.critical : P.inkPrimary }}
              >
                {fmtNum(current.vibration)}
              </p>
              <p className="text-[9px] text-slate-500">vib g</p>
            </div>
            <div>
              <p className="font-mono text-sm font-semibold tabular-nums text-slate-100">
                {fmtNum(current.agl)}
              </p>
              <p className="text-[9px] text-slate-500">alt m</p>
            </div>
            <div>
              <p className="font-mono text-sm font-semibold tabular-nums text-slate-100">
                {fmtNum(current.battery)}
              </p>
              <p className="text-[9px] text-slate-500">batt V</p>
            </div>
          </div>
        </div>
        <StripChart
          data={chartData}
          dataKey="vibration"
          color={P.red}
          playheadT={tDisplay}
          unit="g"
          threshold={alertThresholdG}
        />
        <StripChart data={chartData} dataKey="altitude" color={P.blue} playheadT={tDisplay} unit="m" />
        <StripChart data={chartData} dataKey="battery" color={P.aqua} playheadT={tDisplay} unit="V" />
        <p className="px-1 text-[10px] leading-snug text-slate-500">
          Profile parameterized from duration, max altitude, battery endpoints and objective;
          anomaly flags shape the vibration curve (F47 ramps to its recorded 0.22 g over the
          final 30 s). Recorded values are the anchors — the curves between them are
          reconstruction.
        </p>
      </div>
    </div>
  );
}
