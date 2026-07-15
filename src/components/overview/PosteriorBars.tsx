/**
 * Posterior overview — all hypotheses as horizontal bars on a common 0–100%
 * axis with a small PRIOR tick per bar (dumbbell). One chart answers both
 * "what's most likely?" and "how far did the evidence move beliefs?".
 * Position/length encoding per Cleveland–McGill; leader emphasized by opacity
 * and bold label, never by a status hue. Clicking a row drills into the
 * Workbench with that hypothesis selected.
 */
import { useAppStore } from '../../state/store';
import { ChartCaption } from '../shared/charts';
import { fmtPct } from '../shared/format';
import { P } from '../shared/palette';

/**
 * `compact` (hero) mode: the leader is a single prominent labeled bar; the other
 * causes are thin muted unlabeled bars with no per-row numbers and no prior ticks
 * (those live in the full Workbench version). One-glance trust visual for the
 * Command View — "one clear answer, everything else ruled out."
 */
export default function PosteriorBars({ compact = false }: { compact?: boolean }) {
  const bayes = useAppStore((s) => s.bayes);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  if (!bayes || bayes.posteriors.length === 0) return null;

  const rows = bayes.posteriors;
  const top = rows[0];
  const runnerUp = rows[1];
  const ratio =
    runnerUp && runnerUp.posterior > 0 ? Math.round(top.posterior / runnerUp.posterior) : null;

  if (compact) {
    const others = rows.slice(1);
    return (
      <div>
        {/* leader */}
        <div className="flex items-center gap-3">
          <span className="w-48 shrink-0 text-sm font-semibold text-slate-100">{top.name}</span>
          <span className="relative h-4 flex-1 overflow-hidden rounded bg-slate-800/80">
            <span
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${top.posterior * 100}%`, backgroundColor: P.blue }}
            />
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-slate-100">
            {fmtPct(top.posterior, 0)}
          </span>
        </div>
        {/* the rest — thin, muted, unlabeled */}
        <div className="mt-2 space-y-1">
          {others.map((p) => (
            <div key={p.hypothesisId} className="flex items-center gap-3">
              <span className="w-48 shrink-0 truncate text-[10px] text-slate-500">{p.name}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-sm bg-slate-800/60">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{ width: `${Math.max(p.posterior * 100, 0.6)}%`, backgroundColor: P.inkMuted }}
                />
              </span>
              <span className="w-14 shrink-0" aria-hidden />
            </div>
          ))}
        </div>
        <ChartCaption
          takeaway={
            ratio && ratio >= 2
              ? `${others.length} other causes were weighed and ruled out — the leader is ${ratio}× the next.`
              : `${others.length} other causes were weighed.`
          }
          method="each bar is a candidate cause; length = confidence after all the evidence"
        />
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-1">
        {rows.map((p, i) => (
          <li key={p.hypothesisId}>
            <button
              type="button"
              onClick={() => {
                selectHypothesis(p.hypothesisId);
                setActiveTab('workbench');
              }}
              title={`starting belief ${fmtPct(p.prior)} → confidence ${fmtPct(p.posterior)} — click to inspect the evidence`}
              className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-800/40"
            >
              <span
                className={
                  i === 0
                    ? 'w-44 truncate text-[11px] font-semibold text-slate-100'
                    : 'w-44 truncate text-[11px] text-slate-400'
                }
              >
                {p.name}
              </span>
              <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-slate-800/80">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${p.posterior * 100}%`,
                    backgroundColor: P.blue,
                    opacity: i === 0 ? 1 : 0.45,
                  }}
                />
                {/* prior tick */}
                <span
                  className="absolute inset-y-0 w-[2px]"
                  style={{ left: `${p.prior * 100}%`, backgroundColor: P.inkMuted }}
                  aria-hidden
                />
              </span>
              <span
                className={
                  i === 0
                    ? 'w-12 text-right font-mono text-[11px] font-semibold tabular-nums text-slate-100'
                    : 'w-12 text-right font-mono text-[11px] tabular-nums text-slate-500'
                }
              >
                {fmtPct(p.posterior, p.posterior >= 0.1 ? 1 : 1)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ChartCaption
        takeaway={
          ratio && ratio >= 2
            ? `${top.name}: ${fmtPct(top.posterior)} probable — ${ratio}× the next hypothesis.`
            : `${top.name} leads at ${fmtPct(top.posterior)}.`
        }
        method="bars: confidence after all evidence (posterior) · gray tick: starting belief from fleet history (prior) · click a row to see why"
      />
    </div>
  );
}
