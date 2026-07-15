/**
 * Command View — the calm default screen (BLUF, drastically sparse).
 *
 * Four regions, ~3 headline numbers, one hero visual, no tab bar. It answers
 * "what happened · how sure · what to do · how much time" at a glance; every
 * other number, chart, and paragraph lives one drill-down away in the detail
 * views. Numbers lead with plain-language phrases; the figures are trust anchors.
 */
import type { ReactNode } from 'react';
import {
  Bot,
  Database,
  FileOutput,
  FlaskConical,
  MessageCircleQuestion,
  Play,
  Plane,
  Scale,
  Stethoscope,
} from 'lucide-react';
import { useAppStore, type TabId } from '../../state/store';
import PosteriorBars from '../overview/PosteriorBars';
import VibSparkline from '../overview/VibSparkline';
import { fmtPct, fmtUsd } from '../shared/format';
import { Badge, EmptyState, StatTile } from '../shared/ui';
import { useElapsedSeconds } from '../shared/useElapsedSeconds';
import { confidencePhrase } from './confidence';

function DrillLink({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded border border-slate-800 px-2.5 py-1.5 font-mono text-[11px] text-slate-400 transition-colors hover:border-sky-500/50 hover:text-sky-300"
    >
      {icon}
      {label}
    </button>
  );
}

export default function BriefingTab() {
  const model = useAppStore((s) => s.model);
  const evidence = useAppStore((s) => s.evidence);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  const triage = useAppStore((s) => s.triage);
  const narrative = useAppStore((s) => s.narrative);
  const narrativeLoading = useAppStore((s) => s.narrativeLoading);
  const generateNarrative = useAppStore((s) => s.generateNarrative);
  const startStory = useAppStore((s) => s.startStory);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);
  const toggleAsk = useAppStore((s) => s.toggleAsk);
  const elapsed = useElapsedSeconds(narrativeLoading);

  if (!model || !bayes) {
    return (
      <EmptyState
        title="No briefing yet"
        body="Load mission data and TRIAGE opens with the verdict: what happened, how sure we are, what to do, and how much time there is — every detail one click away."
      />
    );
  }

  const top = bayes.posteriors[0];
  const rec = decision?.actions.find((a) => a.actionId === decision.recommendedActionId);
  const grounded = model.timeline && /ground|hold/i.test(model.timeline.helicopterStatus);
  const openCause = () => {
    selectHypothesis(top.hypothesisId);
    setActiveTab('workbench');
  };
  const ready = Boolean(evidence && bayes && decision && triage);

  const drills: { icon: ReactNode; label: string; tab: TabId }[] = [
    { icon: <Plane size={12} />, label: 'Replay the flight', tab: 'flightdeck' },
    { icon: <FlaskConical size={12} />, label: 'See the analysis', tab: 'workbench' },
    { icon: <Scale size={12} />, label: 'Compare options', tab: 'decision' },
    { icon: <Stethoscope size={12} />, label: 'Diagnosis plan', tab: 'triage' },
    { icon: <FileOutput size={12} />, label: 'Export', tab: 'export' },
    { icon: <Database size={12} />, label: 'Data', tab: 'home' },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-6">
      {/* 1 — situation line */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{model.meta.vehicle}</Badge>
        {typeof model.meta.currentSol === 'number' && (
          <span className="font-mono text-[11px] text-slate-400">Sol {model.meta.currentSol}</span>
        )}
        {evidence?.anomaly.flightRef && (
          <span className="font-mono text-[11px] text-slate-400">
            · Flight {evidence.anomaly.flightRef.replace(/^F/, '')}
          </span>
        )}
        {grounded && <Badge tone="critical">grounded</Badge>}
        <span className="text-xs text-slate-400">Rotor vibration exceeded its safe limit.</span>
        <span className="ml-auto">
          <VibSparkline width={120} height={26} />
        </span>
      </div>

      {/* 2 — verdict + hero visual (click-through to the evidence) */}
      <button
        type="button"
        onClick={openCause}
        className="block w-full rounded-lg border border-slate-800 bg-slate-900/50 p-5 text-left transition-colors hover:border-sky-500/40"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          most likely cause · {confidencePhrase(top.posterior)}
        </p>
        <h2 className="mt-1 text-2xl font-semibold leading-tight text-slate-100">
          {top.name}
        </h2>
        <div className="mt-4">
          <PosteriorBars compact />
        </div>
      </button>

      {/* 3 — the only numbers: three trust anchors */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatTile
          label="Confidence"
          value={fmtPct(top.posterior, 0)}
          sub={confidencePhrase(top.posterior)}
          size="lg"
          onClick={openCause}
          title="how likely this cause is after weighing all the evidence — click to see why"
        />
        <StatTile
          label="Recommended plan"
          value={rec ? fmtUsd(rec.expectedRiskAdjustedCostUsd) : '—'}
          sub={rec ? rec.name : 'timeline required'}
          size="lg"
          tone="good"
          onClick={decision ? () => setActiveTab('decision') : undefined}
          title="lowest expected total cost incl. dollar-priced risk — click to compare all options"
        />
        <StatTile
          label="Schedule cushion"
          value={decision ? `${decision.schedule.marginSols.value} sols` : '—'}
          sub={decision ? `before Sol ${decision.schedule.effectiveDeadlineSol.value}` : undefined}
          size="lg"
          tone={decision && decision.schedule.marginSols.value < 30 ? 'critical' : 'warning'}
          onClick={triage ? () => setActiveTab('triage') : undefined}
          title={decision?.schedule.marginSols.citation}
        />
      </div>

      {/* 4 — recommendation sentence + quiet drill row */}
      {rec && (
        <p className="text-sm leading-relaxed text-slate-300">
          <span className="text-slate-500">Recommended: </span>
          {rec.name}.
        </p>
      )}

      <div>
        <div className="flex flex-wrap gap-2">
          {drills.map((d) => (
            <DrillLink key={d.tab} icon={d.icon} label={d.label} onClick={() => setActiveTab(d.tab)} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={startStory}
            className="flex items-center gap-1 transition-colors hover:text-sky-300"
          >
            <Play size={10} /> 60-second guided tour
          </button>
          <button
            type="button"
            onClick={() => toggleAsk(true)}
            className="flex items-center gap-1 transition-colors hover:text-sky-300"
          >
            <MessageCircleQuestion size={10} /> ask TRIAGE about this
          </button>
          {!narrative && (
            <button
              type="button"
              disabled={!ready || narrativeLoading}
              onClick={() => void generateNarrative()}
              className="flex items-center gap-1 transition-colors hover:text-sky-300 disabled:opacity-40"
            >
              <Bot size={10} />{' '}
              {narrativeLoading
                ? `generating narrative… ${elapsed > 0 ? `${elapsed}s` : ''}`
                : 'generate AI narrative'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
