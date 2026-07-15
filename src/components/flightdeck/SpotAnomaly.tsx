/**
 * Spot-the-anomaly — the fleet history with severity colors HIDDEN. The
 * engineer scrubs the mission, picks the flight where they think the problem
 * first shows and their root-cause call; only then does the AI disposition
 * reveal (colors on, posteriors shown, guesses graded).
 */
import { Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { hypothesisLibrary } from '../../config';
import type { ReconstructedFlight } from '../../scenes/reconstruct';
import { useAppStore } from '../../state/store';
import { fmtPct } from '../shared/format';
import { hypName } from '../shared/names';
import { Badge, Meter } from '../shared/ui';
import { P } from '../shared/palette';
import FleetHistory from './FleetHistory';

interface SpotAnomalyProps {
  reconstructions: ReconstructedFlight[];
  alertThresholdG: number;
}

function gradeFlightGuess(guess: number, reconstructions: ReconstructedFlight[]): string {
  const flagged = reconstructions
    .filter((r) => r.flight.anomalyFlag)
    .map((r) => r.flight.flightNumber)
    .sort((a, b) => a - b);
  const firstFlag = flagged[0];
  const alarm = flagged[flagged.length - 1];
  if (guess === firstFlag) {
    return `Exact call — F${firstFlag} carried the MINOR_VIBRATION_NOTE precursor that triggered the unscheduled bearing inspection (MA-008).`;
  }
  if (guess === alarm) {
    return `F${alarm} is the alarm itself. The fleet trend (and the F${firstFlag} precursor note) were visible well before the auto-grounding.`;
  }
  if (guess >= 22 && guess < alarm) {
    return `Defensible — the rotor-hours wear trend is already climbing by F${guess}. The first hard precursor flag came on F${firstFlag}.`;
  }
  return `Early flights still sit in the nominal band; the wear trend only becomes statistically clear from roughly F22 onward (precursor flag: F${firstFlag}).`;
}

export default function SpotAnomaly({ reconstructions, alertThresholdG }: SpotAnomalyProps) {
  const bayes = useAppStore((s) => s.bayes);
  const [flightGuess, setFlightGuess] = useState<number | null>(null);
  const [hypGuess, setHypGuess] = useState<string>('');
  const [revealed, setRevealed] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState<number | null>(null);

  const flightOptions = useMemo(
    () => reconstructions.map((r) => r.flight.flightNumber).sort((a, b) => a - b),
    [reconstructions],
  );
  const topHyp = bayes?.posteriors[0];
  const guessPosterior = bayes?.posteriors.find((p) => p.hypothesisId === hypGuess);

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      <div className="h-[520px]">
        <FleetHistory
          reconstructions={reconstructions}
          alertThresholdG={alertThresholdG}
          colorMode={revealed ? 'severity' : 'neutral'}
          selectedFlight={selectedFlight ?? flightGuess}
          onSelectFlight={(fn) => {
            setSelectedFlight(fn);
            if (!revealed && fn !== null) setFlightGuess(fn);
          }}
        />
      </div>

      <div className="space-y-3">
        {!revealed ? (
          <div className="rounded-lg border border-violet-400/40 bg-violet-500/5 p-3">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-violet-300">
              <EyeOff size={12} /> disposition hidden
            </p>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              Scrub the mission and study the flight paths — severity colors are off. Commit your
              own diagnosis before the AI shows its hand.
            </p>

            <label className="mt-3 block">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                1 · where does the problem first show?
              </span>
              <select
                value={flightGuess ?? ''}
                onChange={(e) => setFlightGuess(e.target.value ? Number(e.target.value) : null)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
              >
                <option value="">pick a flight (or click a path)</option>
                {flightOptions.map((fn) => (
                  <option key={fn} value={fn}>
                    F{fn}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                2 · your root-cause call
              </span>
              <select
                value={hypGuess}
                onChange={(e) => setHypGuess(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">pick a hypothesis</option>
                {hypothesisLibrary.hypotheses
                  .filter((h) => !h.isCatchAll)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>

            <button
              type="button"
              disabled={flightGuess === null || hypGuess === ''}
              onClick={() => setRevealed(true)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded border border-violet-400/50 bg-violet-500/15 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-violet-200 transition-colors enabled:hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eye size={13} /> commit & reveal
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                revealed — your call vs the computed disposition
              </p>
              <p className="mt-2 text-[11px] leading-snug text-slate-300">
                {flightGuess !== null && gradeFlightGuess(flightGuess, reconstructions)}
              </p>
              <div className="mt-3 space-y-1.5 text-[11px]">
                <p className="text-slate-400">
                  your call:{' '}
                  <span className="font-medium text-slate-200">{hypName(hypGuess)}</span>{' '}
                  {guessPosterior && (
                    <span className="font-mono text-slate-400">
                      ({fmtPct(guessPosterior.posterior)} posterior)
                    </span>
                  )}
                </p>
                {topHyp && (
                  <p className="text-slate-400">
                    computed №1:{' '}
                    <span className="font-medium text-slate-200">{topHyp.name}</span>{' '}
                    <span className="font-mono text-emerald-400">{fmtPct(topHyp.posterior)}</span>
                  </p>
                )}
                {topHyp && hypGuess === topHyp.hypothesisId ? (
                  <Badge tone="good">agrees with the disposition</Badge>
                ) : (
                  <Badge tone="warning">differs — inspect the waterfall in the Workbench</Badge>
                )}
              </div>
            </div>

            {bayes && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  posterior ranking
                </p>
                <ul className="space-y-1.5">
                  {bayes.posteriors.slice(0, 5).map((p) => (
                    <li key={p.hypothesisId} className="flex items-center gap-2">
                      <span className="w-36 truncate text-[10px] text-slate-400">{p.name}</span>
                      <Meter value={p.posterior} color={p.hypothesisId === hypGuess ? P.violet : P.blue} className="flex-1" />
                      <span className="w-11 text-right font-mono text-[10px] tabular-nums text-slate-300">
                        {fmtPct(p.posterior, 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setRevealed(false);
                setFlightGuess(null);
                setHypGuess('');
                setSelectedFlight(null);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              <RotateCcw size={12} /> try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
