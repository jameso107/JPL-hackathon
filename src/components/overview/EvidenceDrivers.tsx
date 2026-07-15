/**
 * Top evidence drivers — the novice-friendly digest of the log-odds waterfall:
 * the five findings that moved the leading hypothesis most, as signed bars
 * (blue supports / red argues against — the validated diverging pair).
 * Clicking a bar jumps to that evidence card (traceability at overview level).
 */
import { useAppStore } from '../../state/store';
import { ChartCaption } from '../shared/charts';
import { truncate } from '../shared/format';
import { P } from '../shared/palette';

const TOP_N = 5;

export default function EvidenceDrivers() {
  const bayes = useAppStore((s) => s.bayes);
  const evidence = useAppStore((s) => s.evidence);
  const selectEvidence = useAppStore((s) => s.selectEvidence);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  if (!bayes || !evidence) return null;

  const top = bayes.posteriors[0];
  const drivers = top.waterfall
    .filter((s) => s.kind === 'evidence' && s.evidenceId)
    .map((s) => {
      const item = evidence.items.find((i) => i.id === s.evidenceId);
      return {
        id: s.evidenceId!,
        delta: s.delta,
        label: item ? item.statement : s.label,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, TOP_N);
  if (drivers.length === 0) return null;

  const maxAbs = Math.max(...drivers.map((d) => Math.abs(d.delta)));
  const strongest = drivers[0];

  return (
    <div>
      <ul className="space-y-1.5">
        {drivers.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => {
                setActiveTab('workbench');
                selectEvidence(d.id);
              }}
              title={`${d.id} — click to inspect this evidence and its source rows`}
              className="block w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-800/40"
            >
              <span className="block truncate text-[11px] leading-snug text-slate-300">
                {truncate(d.label, 76)}
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className="relative h-2 flex-1 overflow-hidden rounded-sm bg-slate-800/80">
                  <span
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${(Math.abs(d.delta) / maxAbs) * 100}%`,
                      backgroundColor: d.delta >= 0 ? P.blue : P.red,
                    }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-500">
                  {d.delta >= 0 ? 'supports' : 'against'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ChartCaption
        takeaway={`"${truncate(strongest.label, 60)}" does the most work.`}
        method="bar length = how hard each finding pushed the leading cause (weight-tempered likelihood shift) · click to trace to source rows"
      />
    </div>
  );
}
