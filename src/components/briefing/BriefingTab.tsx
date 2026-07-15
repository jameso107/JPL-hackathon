/**
 * Briefing — the answer in 10 seconds (BLUF / inverted pyramid). The app lands
 * here after a successful ingest. Five chunked regions: verdict headline,
 * deep-link stat tiles, the two overview charts, the schedule strip, and the
 * pipeline journey. Everything links downward into the expert tabs.
 */
import { Bot, FlaskConical, Loader2, Play, ScanSearch, Timer } from 'lucide-react';
import { useAppStore } from '../../state/store';
import EvidenceDrivers from '../overview/EvidenceDrivers';
import PosteriorBars from '../overview/PosteriorBars';
import MarginStrip from '../shared/MarginStrip';
import { fmtPct, fmtUsd } from '../shared/format';
import { EmptyState, EvChip, Section, StatTile } from '../shared/ui';
import VerdictHeadline from './VerdictHeadline';
import JourneyCards from './JourneyCards';

function NarrativeSummary() {
  const evidence = useAppStore((s) => s.evidence);
  const narrative = useAppStore((s) => s.narrative);
  const loading = useAppStore((s) => s.narrativeLoading);
  const generate = useAppStore((s) => s.generateNarrative);
  const ready = useAppStore((s) => Boolean(s.evidence && s.bayes && s.decision && s.triage));

  if (!narrative) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
        <button
          type="button"
          disabled={!ready || loading}
          onClick={() => void generate()}
          className="inline-flex items-center gap-1.5 rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition-colors enabled:hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
          {loading ? 'writing the briefing narrative…' : 'generate AI narrative'}
        </button>
        <p className="text-[11px] leading-snug text-slate-500">
          The AI writes the story; every number in it comes from the computed analysis.
        </p>
      </div>
    );
  }

  const validIds = new Set(evidence?.items.map((i) => i.id) ?? []);
  return (
    <Section title="Narrative summary" icon={<Bot size={13} />}>
      <p className="text-xs leading-relaxed text-slate-200">
        {narrative.narrative.executiveSummary}
      </p>
      {narrative.narrative.hypothesisRationales[0] && (
        <div className="mt-2 flex flex-wrap gap-1">
          {narrative.narrative.hypothesisRationales[0].citedEvidence.map((id) => (
            <EvChip key={id} id={id} invalid={!validIds.has(id)} />
          ))}
        </div>
      )}
    </Section>
  );
}

export default function BriefingTab() {
  const model = useAppStore((s) => s.model);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  const triage = useAppStore((s) => s.triage);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const selectHypothesis = useAppStore((s) => s.selectHypothesis);

  if (!model || !bayes) {
    return (
      <EmptyState
        title="No briefing yet"
        body="Load mission data and TRIAGE will open with the verdict: most likely cause, recommended action, and the schedule pressure — each one click from its full evidence trail."
      />
    );
  }

  const top = bayes.posteriors[0];
  const rec = decision?.actions.find((a) => a.actionId === decision.recommendedActionId);

  return (
    <div className="space-y-3">
      <VerdictHeadline />

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatTile
          label="Most likely cause"
          value={fmtPct(top.posterior)}
          sub={top.name}
          size="lg"
          onClick={() => {
            selectHypothesis(top.hypothesisId);
            setActiveTab('workbench');
          }}
          title="click to inspect the evidence behind this"
        />
        <StatTile
          label="Recommended action"
          value={rec ? fmtUsd(rec.expectedRiskAdjustedCostUsd) : '—'}
          sub={rec ? rec.name : 'timeline required'}
          size="lg"
          tone="good"
          onClick={decision ? () => setActiveTab('decision') : undefined}
          title="expected total cost incl. dollar-priced risk — click for the comparison"
        />
        <StatTile
          label="Schedule cushion"
          value={decision ? `${decision.schedule.marginSols.value} sols` : '—'}
          sub={decision ? `deadline Sol ${decision.schedule.effectiveDeadlineSol.value}` : undefined}
          size="lg"
          tone={decision && decision.schedule.marginSols.value < 30 ? 'critical' : 'warning'}
          onClick={decision ? () => setActiveTab('decision') : undefined}
          title={decision?.schedule.marginSols.citation}
        />
        <StatTile
          label="Path to confirm"
          value={triage ? `${triage.totalDurationSols} sols` : '—'}
          sub={triage ? `${triage.steps.length} tests · done Sol ${triage.completionSol}` : undefined}
          size="lg"
          onClick={triage ? () => setActiveTab('triage') : undefined}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="All nine causes, weighed" icon={<FlaskConical size={13} />}>
          <PosteriorBars />
        </Section>
        <Section title="What the evidence says" icon={<ScanSearch size={13} />}>
          <EvidenceDrivers />
        </Section>
      </div>

      {decision && (
        <Section title="The clock" icon={<Timer size={13} />}>
          <MarginStrip variant="compact" />
        </Section>
      )}

      <NarrativeSummary />

      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
          how TRIAGE got here
        </p>
        <TourButton />
      </div>
      <JourneyCards />
    </div>
  );
}

function TourButton() {
  const startStory = useAppStore((s) => s.startStory);
  const storyActive = useAppStore((s) => s.storyActive);
  if (storyActive) return null;
  return (
    <button
      type="button"
      onClick={startStory}
      className="flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/15"
    >
      <Play size={11} /> take the 60-second tour
    </button>
  );
}
