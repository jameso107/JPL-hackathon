/**
 * Anomaly Workbench — the centerpiece. Three panes: evidence stream ·
 * hypothesis rail · detail pane, with the AI narrative panel under the detail.
 */
import { Activity, FlaskConical, ScanSearch, Sparkles } from 'lucide-react';
import { useAppStore } from '../state/store';
import EvidenceStream from './workbench/EvidenceStream';
import HypothesisRail from './workbench/HypothesisRail';
import DetailPane from './workbench/DetailPane';
import NarrativePanel from './workbench/NarrativePanel';
import { EmptyState, Section } from './shared/ui';

export default function Workbench() {
  const evidence = useAppStore((s) => s.evidence);
  const bayes = useAppStore((s) => s.bayes);

  if (!evidence || !bayes) {
    return (
      <EmptyState
        title="No disposition loaded"
        body="Load mission data to compute the evidence package and hypothesis posteriors. Every number here is computed from your files — the AI writes narrative only."
      />
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <Section
        title={`Evidence stream · ${evidence.items.length} items`}
        icon={<ScanSearch size={13} />}
        className="xl:h-[calc(100vh-140px)] xl:overflow-hidden [&>div]:h-[calc(100%-37px)]"
      >
        <EvidenceStream />
      </Section>

      <Section
        title="Hypotheses · posterior ranked"
        icon={<FlaskConical size={13} />}
        className="xl:h-[calc(100vh-140px)] xl:overflow-hidden [&>div]:h-[calc(100%-37px)]"
      >
        <HypothesisRail />
      </Section>

      <div className="flex min-h-0 flex-col gap-3 xl:h-[calc(100vh-140px)]">
        <Section
          title="Traceability detail"
          icon={<Activity size={13} />}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <DetailPane />
        </Section>
        <Section
          title="AI narrative"
          icon={<Sparkles size={13} />}
          className="min-h-0 max-h-[45%] overflow-y-auto"
        >
          <NarrativePanel />
        </Section>
      </div>
    </div>
  );
}
