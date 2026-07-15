/**
 * Hypothesis rail (workbench center pane): posterior-sorted cards with
 * expandable log-odds waterfalls, matched-evidence chips, heritage prior
 * contributions, and repair options. AI-proposed hypotheses (from the
 * narrative) render at the bottom with a distinct badge and no posterior.
 */
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { hypothesisLibrary } from '../../config';
import { useAppStore } from '../../state/store';
import type { HypothesisPosterior } from '../../types';
import { fmtPct } from '../shared/format';
import { P } from '../shared/palette';
import { Badge, EvChip, Meter } from '../shared/ui';
import { WaterfallChart } from './WaterfallChart';

function HypothesisCard({ posterior: hp }: { posterior: HypothesisPosterior }) {
  const selectedHypothesisId = useAppStore((s) => s.selectedHypothesisId);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);
  const expanded = selectedHypothesisId === hp.hypothesisId;
  const hyp = hypothesisLibrary.hypotheses.find((h) => h.id === hp.hypothesisId);
  const shiftUp = hp.posterior > hp.prior;

  return (
    <li
      className={clsx(
        'rounded-lg border transition-colors',
        expanded ? 'border-slate-600 bg-slate-900/80' : 'border-slate-800 bg-slate-900/60',
      )}
    >
      <button
        type="button"
        onClick={() => selectHypothesis(expanded ? null : hp.hypothesisId)}
        className="w-full p-2.5 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium leading-snug text-slate-200">{hp.name}</p>
          {expanded ? (
            <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-500" />
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Meter value={hp.posterior} color={hp.posterior >= 0.5 ? P.red : P.blue} className="flex-1" />
          <span className="w-14 text-right font-mono text-sm font-semibold tabular-nums text-slate-100">
            {fmtPct(hp.posterior)}
          </span>
        </div>
        <p className="mt-1 font-mono text-[10px] text-slate-500">
          prior {fmtPct(hp.prior)} → posterior {fmtPct(hp.posterior)}{' '}
          <span className={shiftUp ? 'text-sky-400' : 'text-slate-600'}>
            ({shiftUp ? '▲' : '▼'} {Math.abs(hp.logOddsShift).toFixed(2)} log-odds)
          </span>
        </p>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-800 p-2.5">
          {hyp?.description && (
            <p className="text-[11px] leading-snug text-slate-400">{hyp.description}</p>
          )}

          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              log-odds waterfall
            </p>
            <WaterfallChart posterior={hp} />
          </div>

          {hp.matchedEvidence.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                matched evidence
              </p>
              <div className="flex flex-wrap gap-1">
                {hp.matchedEvidence.map((id) => (
                  <EvChip key={id} id={id} />
                ))}
              </div>
            </div>
          )}

          {hp.priorContributions.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                heritage prior contributions
              </p>
              <ul className="space-y-0.5">
                {hp.priorContributions.map((c) => (
                  <li key={c.anomalyId} className="text-[11px] text-slate-400">
                    <span className="font-mono text-slate-300">{c.anomalyId}</span> ({c.vehicle})
                    <span className="text-slate-500"> — keyword “{c.matchedKeyword}”</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hyp && hyp.repairOptions.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                repair options
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-[11px] text-slate-400">
                {hyp.repairOptions.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AiProposedCards() {
  const narrative = useAppStore((s) => s.narrative);
  const proposals = narrative?.narrative.aiProposedHypotheses ?? [];
  if (proposals.length === 0) return null;
  return (
    <>
      {proposals.map((p) => (
        <li
          key={p.name}
          className="rounded-lg border border-violet-400/40 bg-violet-500/5 p-2.5"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles size={12} className="text-violet-300" />
            <p className="text-xs font-medium text-slate-200">{p.name}</p>
          </div>
          <div className="mt-1.5">
            <Badge tone="violet">AI-proposed — no computed posterior</Badge>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-400">{p.rationale}</p>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
            <span className="font-mono text-[10px] uppercase tracking-wider text-violet-300">
              distinguishing test:
            </span>{' '}
            {p.distinguishingTest}
          </p>
        </li>
      ))}
    </>
  );
}

export default function HypothesisRail() {
  const bayes = useAppStore((s) => s.bayes);
  if (!bayes) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="pb-2 font-mono text-[10px] leading-snug text-slate-500">
        priors: {bayes.priorsMeta.uniformFallback
          ? 'uniform fallback (no anomaly history)'
          : `heritage records ${bayes.priorsMeta.usedRecords.join(', ')}`}
        {' · '}tempering τ={bayes.tempering}
      </p>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {bayes.posteriors.map((hp) => (
          <HypothesisCard key={hp.hypothesisId} posterior={hp} />
        ))}
        <AiProposedCards />
      </ul>
    </div>
  );
}
