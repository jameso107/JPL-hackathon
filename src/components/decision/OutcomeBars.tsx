/**
 * Per-hypothesis outcome, visually: which possible worlds drive this action's
 * expected cost. Bar = posterior × risk-adjusted cost contribution. Replaces
 * the nested numeric table at first view (the raw table sits one disclosure
 * away for engineers).
 */
import type { ActionEvaluation } from '../../types';
import { ChartCaption } from '../shared/charts';
import { fmtPct, fmtUsd, truncate } from '../shared/format';
import { hypName } from '../shared/names';
import { P } from '../shared/palette';
import { Disclosure, Term } from '../shared/ui';

export default function OutcomeBars({ action }: { action: ActionEvaluation }) {
  const rows = [...action.perHypothesis]
    .map((h) => ({ ...h, contribution: h.posterior * h.riskAdjustedCostUsd }))
    .filter((h) => h.posterior >= 0.005)
    .sort((a, b) => b.contribution - a.contribution);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.contribution, 0);
  const maxC = rows[0].contribution;
  const topShare = total > 0 ? rows[0].contribution / total : 0;

  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        what drives this plan's cost, by possible cause
      </p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.hypothesisId} className="flex items-center gap-2">
            <span className="w-40 truncate text-[10px] text-slate-400" title={hypName(r.hypothesisId)}>
              {truncate(hypName(r.hypothesisId), 30)}
            </span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-sm bg-slate-800/70">
              <span
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{ width: `${(r.contribution / maxC) * 100}%`, backgroundColor: P.blue }}
              />
            </span>
            <span className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-400">
              {fmtUsd(r.contribution)}
            </span>
          </li>
        ))}
      </ul>
      <ChartCaption
        takeaway={`The "${truncate(hypName(rows[0].hypothesisId), 34)}" world carries ${fmtPct(topShare, 0)} of this plan's expected cost.`}
        method="bar = confidence in that cause × the plan's risk-adjusted cost if it's true"
      />
      <Disclosure className="mt-1" label="show the numbers · per-world table">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-slate-800 text-left font-mono text-[9px] uppercase tracking-wider text-slate-500">
              <th className="py-1 pr-2 font-normal">cause</th>
              <th className="py-1 pr-2 text-right font-normal">
                <Term k="posterior" mode="plain" />
              </th>
              <th className="py-1 pr-2 text-right font-normal">
                <Term k="lov" mode="jargon" />
              </th>
              <th className="py-1 pr-2 text-right font-normal">
                <Term k="expectedSamples" mode="jargon" />
              </th>
              <th className="py-1 text-right font-normal">
                <Term k="riskAdjustedCost" mode="plain" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.hypothesisId} className="border-b border-slate-800/50 last:border-0">
                <td className="py-1 pr-2 text-slate-300">{truncate(hypName(h.hypothesisId), 34)}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">
                  {fmtPct(h.posterior, 0)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">
                  {fmtPct(h.lovProbability, 2)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">
                  {h.expectedSamples.toFixed(2)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-slate-400">
                  {fmtUsd(h.riskAdjustedCostUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>
    </div>
  );
}
