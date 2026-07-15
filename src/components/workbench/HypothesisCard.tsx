/**
 * One hypothesis card. Collapsed: name + mini-dumbbell meter (prior tick on
 * the posterior bar) + a computed plain-English movement sentence — the exact
 * log-odds arithmetic lives in the tooltip. Expanded: description + matched
 * evidence chips stay top-level (traceability); the waterfall and the
 * heritage/repair details sit behind disclosures ("details on demand").
 */
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { hypothesisLibrary } from '../../config';
import { useAppStore } from '../../state/store';
import type { HypothesisPosterior } from '../../types';
import { fmtPct, fmtSigned } from '../shared/format';
import { P } from '../shared/palette';
import { Disclosure, EvChip, Term } from '../shared/ui';
import { WaterfallChart } from './WaterfallChart';

/** Computed plain-English movement sentence (chunking: one fact, not four). */
function movementSentence(hp: HypothesisPosterior): string {
  const evidenceSteps = hp.waterfall.filter((s) => s.kind === 'evidence');
  const up = evidenceSteps.filter((s) => s.delta > 0).length;
  const down = evidenceSteps.filter((s) => s.delta < 0).length;
  const shift = hp.logOddsShift;
  if (evidenceSteps.length === 0) return 'no evidence bears on this cause — unchanged from fleet history';
  if (shift > 1.5) return `pushed up strongly by ${up} finding${up === 1 ? '' : 's'}`;
  if (shift > 0.3) return `nudged up by ${up} finding${up === 1 ? '' : 's'}`;
  if (shift < -1.5) return `pushed down strongly by ${down} finding${down === 1 ? '' : 's'}`;
  if (shift < -0.3) return `nudged down by ${down} finding${down === 1 ? '' : 's'}`;
  return 'barely moved by the evidence';
}

export default function HypothesisCard({ posterior: hp }: { posterior: HypothesisPosterior }) {
  const selectedHypothesisId = useAppStore((s) => s.selectedHypothesisId);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);
  const expanded = selectedHypothesisId === hp.hypothesisId;
  const hyp = hypothesisLibrary.hypotheses.find((h) => h.id === hp.hypothesisId);

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
        title={`starting belief ${fmtPct(hp.prior)} → confidence ${fmtPct(hp.posterior)} (evidence push ${fmtSigned(hp.logOddsShift)} log-odds)`}
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
          {/* mini dumbbell: posterior bar + prior tick */}
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${hp.posterior * 100}%`,
                backgroundColor: hp.posterior >= 0.5 ? P.red : P.blue,
              }}
            />
            <span
              className="absolute inset-y-0 w-[2px]"
              style={{ left: `${hp.prior * 100}%`, backgroundColor: P.inkMuted }}
              aria-hidden
            />
          </span>
          <span className="w-14 text-right font-mono text-sm font-semibold tabular-nums text-slate-100">
            {fmtPct(hp.posterior)}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-slate-500">{movementSentence(hp)}</p>
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-slate-800 p-2.5">
          {hyp?.description && (
            <p className="text-[11px] leading-snug text-slate-400">{hyp.description}</p>
          )}

          {hp.matchedEvidence.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                matched evidence — click to trace
              </p>
              <div className="flex flex-wrap gap-1">
                {hp.matchedEvidence.map((id) => (
                  <EvChip key={id} id={id} />
                ))}
              </div>
            </div>
          )}

          <Disclosure
            label="show the math · log-odds waterfall"
            teaser={
              <>
                how each finding moved the <Term k="posterior" mode="plain" /> from{' '}
                {fmtPct(hp.prior)} to {fmtPct(hp.posterior)}
              </>
            }
          >
            <WaterfallChart posterior={hp} />
          </Disclosure>

          <Disclosure
            label="details · fleet history & repair options"
            teaser={`${hp.priorContributions.length} fleet-history matches · ${hyp?.repairOptions.length ?? 0} repair options`}
          >
            {hp.priorContributions.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <Term k="heritagePrior" /> contributions
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
          </Disclosure>
        </div>
      )}
    </li>
  );
}
