/**
 * BLUF for the Decision tab: the recommended action leads the screen — name,
 * one-sentence summary, and the three numbers that matter. Everything else on
 * the tab is justification.
 */
import { BadgeCheck } from 'lucide-react';
import type { DecisionAnalysis } from '../../types';
import { fmtNum, fmtPct, fmtUsd } from '../shared/format';
import { Term } from '../shared/ui';

export default function RecommendationCard({ analysis }: { analysis: DecisionAnalysis }) {
  const rec = analysis.actions.find((a) => a.actionId === analysis.recommendedActionId);
  if (!rec) return null;
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
        <BadgeCheck size={13} /> recommended action
      </p>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-slate-100">{rec.name}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{rec.summary}</p>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-emerald-300">
            {fmtUsd(rec.expectedRiskAdjustedCostUsd)}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            <Term k="riskAdjustedCost" /> expected
          </p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-slate-100">
            {fmtNum(rec.delaySols.value)} sols
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            delay (<Term k="sol" mode="plain" />
            s)
          </p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-slate-100">
            {fmtPct(rec.lovProbability, 1)}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            <Term k="lov" mode="plain" />
          </p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-slate-100">
            {fmtNum(rec.expectedSamples)} / 2
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            <Term k="expectedSamples" mode="plain" />
          </p>
        </div>
      </div>
    </div>
  );
}
