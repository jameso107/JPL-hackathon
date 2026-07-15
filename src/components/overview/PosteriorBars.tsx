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

export default function PosteriorBars() {
  const bayes = useAppStore((s) => s.bayes);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  if (!bayes || bayes.posteriors.length === 0) return null;

  const rows = bayes.posteriors;
  const top = rows[0];
  const runnerUp = rows[1];
  const ratio =
    runnerUp && runnerUp.posterior > 0 ? Math.round(top.posterior / runnerUp.posterior) : null;

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
