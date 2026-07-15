/**
 * Persistent mission-status ribbon (recognition over recall): vehicle, sol,
 * grounded state, and clickable verdict/action/cushion chips on every tab.
 * Absorbs the old HeaderStatus. Chips render only when their artifact exists.
 */
import { clsx } from 'clsx';
import { Play } from 'lucide-react';
import { useAppStore } from '../state/store';
import { fmtPct, fmtUsd } from './shared/format';
import { Badge } from './shared/ui';

function Chip({
  children,
  onClick,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'neutral' | 'sky' | 'emerald' | 'amber' | 'red';
  title?: string;
}) {
  const tones = {
    neutral: 'border-slate-700 text-slate-400',
    sky: 'border-sky-500/40 bg-sky-500/5 text-sky-300 hover:bg-sky-500/15',
    emerald: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/15',
    amber: 'border-amber-400/40 bg-amber-400/5 text-amber-300 hover:bg-amber-400/15',
    red: 'border-red-500/40 bg-red-500/5 text-red-300 hover:bg-red-500/15',
  };
  const cls = clsx(
    'inline-flex max-w-full items-center gap-1 truncate rounded border px-2 py-0.5 font-mono text-[10px] transition-colors',
    tones[tone],
    !onClick && 'cursor-default',
  );
  if (!onClick) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={title}>
      {children}
    </button>
  );
}

export default function StatusRibbon() {
  const model = useAppStore((s) => s.model);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  const narrative = useAppStore((s) => s.narrative);
  const loading = useAppStore((s) => s.narrativeLoading);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);
  const startStory = useAppStore((s) => s.startStory);
  const storyActive = useAppStore((s) => s.storyActive);

  if (!model) return null;
  const top = bayes?.posteriors[0];
  const rec = decision?.actions.find((a) => a.actionId === decision.recommendedActionId);
  const grounded = model.timeline && /ground|hold/i.test(model.timeline.helicopterStatus);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="accent">{model.meta.vehicle}</Badge>
      {typeof model.meta.currentSol === 'number' && (
        <span className="font-mono text-[11px] text-slate-400">Sol {model.meta.currentSol}</span>
      )}
      {grounded && (
        <Badge tone="critical">{model.timeline!.helicopterStatus.replace(/_/g, ' ')}</Badge>
      )}
      {top && (
        <Chip
          tone="sky"
          title="most likely cause — click to inspect the evidence"
          onClick={() => {
            selectHypothesis(top.hypothesisId);
            setActiveTab('workbench');
          }}
        >
          {top.name} · {fmtPct(top.posterior, 0)}
        </Chip>
      )}
      {rec && (
        <Chip tone="emerald" title="recommended action — click for the comparison" onClick={() => setActiveTab('decision')}>
          → {rec.name.split('—')[0].split(',')[0]} · {fmtUsd(rec.expectedRiskAdjustedCostUsd)}
        </Chip>
      )}
      {decision && (
        <Chip
          tone={decision.schedule.marginSols.value < 30 ? 'red' : 'amber'}
          title={decision.schedule.marginSols.citation}
          onClick={() => setActiveTab('decision')}
        >
          {decision.schedule.marginSols.value} sols cushion
        </Chip>
      )}
      {loading && <Badge tone="accent">narrative…</Badge>}
      {!loading && narrative && (
        <Badge tone={narrative.status === 'fallback' ? 'serious' : 'good'} title={narrative.error}>
          {narrative.status === 'fallback' ? 'deterministic mode' : 'ChatHPC narrative'}
        </Badge>
      )}
      {bayes && !storyActive && (
        <Chip tone="sky" title="60-second guided walkthrough of the whole case" onClick={startStory}>
          <Play size={10} /> guided tour
        </Chip>
      )}
    </div>
  );
}
