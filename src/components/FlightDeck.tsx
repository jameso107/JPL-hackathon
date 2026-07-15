/**
 * Flight Deck tab — Phase 2. Three modes over a shared scene stack:
 * Fleet History · Flight Replay · Spot the Anomaly. Terrain is a procedural
 * Mars-like heightfield (real Jezero DEM swaps in via scripts/bake_dem.py).
 */
import { clsx } from 'clsx';
import { Clapperboard, History, Puzzle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { analyticsConfig } from '../config';
import { reconstructFlight } from '../scenes/reconstruct';
import { useAppStore } from '../state/store';
import FleetHistory from './flightdeck/FleetHistory';
import FlightReplay from './flightdeck/FlightReplay';
import SpotAnomaly from './flightdeck/SpotAnomaly';
import { Badge, EmptyState } from './shared/ui';

type DeckMode = 'fleet' | 'replay' | 'spot';

const MODES: { id: DeckMode; label: string; icon: React.ReactNode }[] = [
  { id: 'fleet', label: 'Fleet History', icon: <History size={12} /> },
  { id: 'replay', label: 'Flight Replay', icon: <Clapperboard size={12} /> },
  { id: 'spot', label: 'Spot the Anomaly', icon: <Puzzle size={12} /> },
];

export default function FlightDeck() {
  const model = useAppStore((s) => s.model);
  const evidence = useAppStore((s) => s.evidence);
  const [mode, setMode] = useState<DeckMode>('fleet');
  const [selectedFlight, setSelectedFlight] = useState<number | null>(null);

  // threshold: prefer the analytics-extracted value, fall back to config
  const alertThresholdG = useMemo(() => {
    const item = evidence?.items.find((i) => Number.isFinite(i.value.thresholdCurrent));
    return item?.value.thresholdCurrent ?? analyticsConfig.defaultAlertThresholdG;
  }, [evidence]);

  const reconstructions = useMemo(
    () =>
      (model?.telemetry ?? [])
        .slice()
        .sort((a, b) => a.flightNumber - b.flightNumber)
        .map((f) => reconstructFlight(f, alertThresholdG)),
    [model, alertThresholdG],
  );

  if (!model || reconstructions.length === 0) {
    return (
      <EmptyState
        title="No flights to display"
        body="Load telemetry to reconstruct and replay the fleet's flight history over terrain."
      />
    );
  }

  const anomalyFlight =
    reconstructions.filter((r) => /EXCEEDANCE/i.test(r.flight.anomalyFlag ?? '')).pop() ??
    reconstructions[reconstructions.length - 1];
  const replayTarget =
    reconstructions.find((r) => r.flight.flightNumber === selectedFlight) ?? anomalyFlight;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-slate-700">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                mode === m.id
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-slate-500 hover:bg-slate-900 hover:text-slate-300',
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'replay' && (
          <select
            value={replayTarget.flight.flightNumber}
            onChange={(e) => setSelectedFlight(Number(e.target.value))}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
            aria-label="flight to replay"
          >
            {reconstructions.map((r) => (
              <option key={r.flight.flightNumber} value={r.flight.flightNumber}>
                F{r.flight.flightNumber} · Sol {r.flight.sol} ·{' '}
                {r.flight.objective.replace(/_/g, ' ')}
                {r.flight.anomalyFlag ? ` ⚠ ${r.flight.anomalyFlag}` : ''}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Badge tone="warning">reconstructed from summary telemetry</Badge>
          <Badge tone="neutral">procedural terrain — Jezero DEM pending</Badge>
        </div>
      </div>

      {mode === 'fleet' && (
        <div className="h-[560px]">
          <FleetHistory
            reconstructions={reconstructions}
            alertThresholdG={alertThresholdG}
            colorMode="severity"
            selectedFlight={selectedFlight}
            onSelectFlight={setSelectedFlight}
          />
        </div>
      )}

      {mode === 'replay' && (
        <FlightReplay
          key={replayTarget.flight.flightNumber}
          reconstruction={replayTarget}
          alertThresholdG={alertThresholdG}
        />
      )}

      {mode === 'spot' && (
        <SpotAnomaly reconstructions={reconstructions} alertThresholdG={alertThresholdG} />
      )}

      {mode === 'fleet' && selectedFlight !== null && (
        <button
          type="button"
          onClick={() => setMode('replay')}
          className="rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/20"
        >
          Replay F{selectedFlight} →
        </button>
      )}
    </div>
  );
}
