/**
 * Hypothesis rail: top-3 causes visible (chunking), the long tail and the
 * methods line behind disclosures, AI-proposed hypotheses at the bottom with
 * their distinct no-posterior badge.
 */
import { Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { fmtPct } from '../shared/format';
import { Badge, Disclosure } from '../shared/ui';
import HypothesisCard from './HypothesisCard';

const VISIBLE_N = 3;

function AiProposedCards() {
  const narrative = useAppStore((s) => s.narrative);
  const proposals = narrative?.narrative.aiProposedHypotheses ?? [];
  if (proposals.length === 0) return null;
  return (
    <>
      {proposals.map((p) => (
        <li key={p.name} className="rounded-lg border border-violet-400/40 bg-violet-500/5 p-2.5">
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
  const selectedHypothesisId = useAppStore((s) => s.selectedHypothesisId);

  // If a tail hypothesis is selected (deep link), it must be visible.
  const tailSelected = useMemo(
    () =>
      Boolean(
        bayes &&
          selectedHypothesisId &&
          bayes.posteriors.slice(VISIBLE_N).some((p) => p.hypothesisId === selectedHypothesisId),
      ),
    [bayes, selectedHypothesisId],
  );

  if (!bayes) return null;
  const head = bayes.posteriors.slice(0, VISIBLE_N);
  const tail = bayes.posteriors.slice(VISIBLE_N);
  const tailMax = tail[0] ? fmtPct(tail[0].posterior, 1) : '0%';

  return (
    <ul className="space-y-2">
      {head.map((hp) => (
        <HypothesisCard key={hp.hypothesisId} posterior={hp} />
      ))}

      {tail.length > 0 && (
        <li>
          <Disclosure
            label={`${tail.length} more unlikely causes`}
            teaser={`each at ${tailMax} confidence or less — none ruled out, all one click away`}
            {...(tailSelected ? { open: true, onToggle: () => undefined } : {})}
          >
            <ul className="space-y-2">
              {tail.map((hp) => (
                <HypothesisCard key={hp.hypothesisId} posterior={hp} />
              ))}
            </ul>
          </Disclosure>
        </li>
      )}

      <AiProposedCards />
    </ul>
  );
}
