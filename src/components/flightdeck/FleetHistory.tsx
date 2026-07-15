/**
 * Fleet History — all flights over terrain across mission time. Paths are
 * vertex-colored by reconstructed vibration (green→amber→red); the progressive
 * degradation is directly visible flight-by-flight with no synthesis. A sol
 * scrubber replays the mission; the newest flight draws on progressively.
 * Clicking a path selects the flight. `colorMode="neutral"` hides severity
 * colors (spot-the-anomaly mode).
 */
import * as THREE from 'three';
import { clsx } from 'clsx';
import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReconstructedFlight } from '../../scenes/reconstruct';
import { vibrationRgb } from '../../scenes/reconstruct';
import { buildPathTube, createDeckScene } from '../../scenes/sceneSetup';
import { fmtNum } from '../shared/format';
import { Badge } from '../shared/ui';

const NEUTRAL: [number, number, number] = [0.35, 0.55, 0.9];

interface FleetHistoryProps {
  reconstructions: ReconstructedFlight[];
  alertThresholdG: number;
  colorMode: 'severity' | 'neutral';
  selectedFlight: number | null;
  onSelectFlight: (flightNumber: number | null) => void;
  /** extra overlay content rendered top-right (mode-specific panels) */
  height?: number;
}

export default function FleetHistory({
  reconstructions,
  alertThresholdG,
  colorMode,
  selectedFlight,
  onSelectFlight,
}: FleetHistoryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tubesRef = useRef(new Map<number, THREE.Mesh>());
  const onSelectRef = useRef(onSelectFlight);
  onSelectRef.current = onSelectFlight;

  const sols = useMemo(() => reconstructions.map((r) => r.flight.sol), [reconstructions]);
  const minSol = Math.min(...sols);
  const maxSol = Math.max(...sols);
  const [cursorSol, setCursorSol] = useState(maxSol);
  const [playing, setPlaying] = useState(false);
  const cursorRef = useRef(cursorSol);
  cursorRef.current = cursorSol;

  // --- scene lifecycle -----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const deck = createDeckScene(container);
    const tubes = tubesRef.current;

    for (const r of reconstructions) {
      const colors: [number, number, number][] =
        colorMode === 'severity'
          ? r.channels.map((c) => vibrationRgb(c.vibration, alertThresholdG))
          : r.channels.map(() => NEUTRAL);
      const tube = buildPathTube(r.path, colors, 1.6);
      tube.userData.flightNumber = r.flight.flightNumber;
      tube.userData.sol = r.flight.sol;
      tubes.set(r.flight.flightNumber, tube);
      deck.scene.add(tube);
    }

    // click-to-select via raycaster (drag-safe: ignore moves > 5 px)
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 4 };
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      const rect = deck.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, deck.camera);
      const visibleTubes = [...tubes.values()].filter((t) => t.visible);
      const hits = ray.intersectObjects(visibleTubes, false);
      onSelectRef.current(
        hits.length > 0 ? (hits[0].object.userData.flightNumber as number) : null,
      );
    };
    deck.renderer.domElement.addEventListener('pointerdown', onDown);
    deck.renderer.domElement.addEventListener('pointerup', onUp);

    return () => {
      deck.renderer.domElement.removeEventListener('pointerdown', onDown);
      deck.renderer.domElement.removeEventListener('pointerup', onUp);
      tubes.clear();
      deck.dispose();
    };
    // scene rebuilds when the fleet or color mode changes
  }, [reconstructions, colorMode, alertThresholdG]);

  // --- mission-time playback ----------------------------------------------
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = cursorRef.current + dt * 14; // ~14 sols per second
      if (next >= maxSol) {
        setCursorSol(maxSol);
        setPlaying(false);
        return;
      }
      setCursorSol(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, maxSol]);

  // --- visibility + draw-on + selection styling ----------------------------
  useEffect(() => {
    for (const r of reconstructions) {
      const tube = tubesRef.current.get(r.flight.flightNumber);
      if (!tube) continue;
      const geo = tube.geometry as THREE.TubeGeometry;
      const total = geo.index?.count ?? Infinity;
      const solsSinceFlight = cursorSol - r.flight.sol;
      if (solsSinceFlight < 0) {
        tube.visible = false;
        continue;
      }
      tube.visible = true;
      // newest flight draws on over ~2 sols of scrub time
      const frac = Math.max(0, Math.min(1, solsSinceFlight / 2));
      geo.setDrawRange(0, Math.ceil(total * frac));
      const mat = tube.material as THREE.MeshBasicMaterial;
      const isSelected = selectedFlight === r.flight.flightNumber;
      mat.transparent = true;
      mat.opacity = selectedFlight === null ? 0.92 : isSelected ? 1 : 0.18;
    }
  }, [cursorSol, selectedFlight, reconstructions]);

  const flown = reconstructions.filter((r) => r.flight.sol <= cursorSol).length;
  const selected = reconstructions.find((r) => r.flight.flightNumber === selectedFlight);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-slate-800">
      <div ref={containerRef} className="h-full w-full" />

      {/* top-left: status + legend */}
      <div className="pointer-events-none absolute left-3 top-3 space-y-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">fleet history</Badge>
          <span className="font-mono text-[11px] text-slate-300">
            Sol {Math.round(cursorSol)} · {flown}/{reconstructions.length} flights
          </span>
        </div>
        {colorMode === 'severity' ? (
          <div className="flex items-center gap-2 rounded border border-slate-700/60 bg-slate-950/70 px-2 py-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
              vibration
            </span>
            <span
              className="h-2 w-24 rounded-full"
              style={{
                background: 'linear-gradient(90deg, #0ca30c, #fab219, #d03b3b)',
              }}
            />
            <span className="font-mono text-[9px] text-slate-400">
              0.12g → {fmtNum(alertThresholdG)}g+
            </span>
          </div>
        ) : (
          <div className="rounded border border-slate-700/60 bg-slate-950/70 px-2 py-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-violet-300">
              severity colors hidden — make your own call
            </span>
          </div>
        )}
      </div>

      {/* selected flight card */}
      {selected && (
        <div className="absolute right-3 top-3 w-60 rounded-lg border border-slate-700 bg-slate-950/85 p-2.5 backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs font-semibold text-slate-100">
              F{selected.flight.flightNumber}
            </p>
            <button
              type="button"
              onClick={() => onSelectFlight(null)}
              className="font-mono text-[10px] text-slate-500 hover:text-slate-300"
            >
              clear
            </button>
          </div>
          <dl className="mt-1 space-y-0.5 text-[11px] text-slate-400">
            <div className="flex justify-between">
              <dt>sol</dt>
              <dd className="font-mono text-slate-200">{selected.flight.sol}</dd>
            </div>
            <div className="flex justify-between">
              <dt>objective</dt>
              <dd className="font-mono text-slate-200">
                {selected.flight.objective.replace(/_/g, ' ')}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>duration</dt>
              <dd className="font-mono text-slate-200">{selected.flight.durationMin} min</dd>
            </div>
            {colorMode === 'severity' && (
              <div className="flex justify-between">
                <dt>vibration</dt>
                <dd className="font-mono text-slate-200">{selected.flight.vibrationG} g</dd>
              </div>
            )}
            {selected.flight.anomalyFlag && colorMode === 'severity' && (
              <div className="pt-1">
                <Badge tone="critical">{selected.flight.anomalyFlag.replace(/_/g, ' ')}</Badge>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* bottom: sol scrubber */}
      <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-lg border border-slate-700/60 bg-slate-950/80 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            if (!playing && cursorSol >= maxSol) setCursorSol(minSol);
            setPlaying((p) => !p);
          }}
          className="rounded border border-sky-500/50 bg-sky-500/10 p-1.5 text-sky-300 transition-colors hover:bg-sky-500/20"
          title={playing ? 'pause' : 'replay the mission'}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="font-mono text-[10px] text-slate-500">Sol {minSol}</span>
        <input
          type="range"
          min={minSol}
          max={maxSol}
          step={0.5}
          value={cursorSol}
          onChange={(e) => {
            setPlaying(false);
            setCursorSol(Number(e.target.value));
          }}
          className={clsx('flex-1 accent-sky-500')}
          aria-label="mission time (sol)"
        />
        <span className="font-mono text-[10px] text-slate-500">Sol {maxSol}</span>
      </div>
    </div>
  );
}
