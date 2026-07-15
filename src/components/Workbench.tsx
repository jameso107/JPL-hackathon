/**
 * Anomaly Workbench — causes-led. The ranked causes are the primary content
 * (the ranking itself keeps the runner-up in view); evidence is revealed only
 * on demand: click a finding inside a cause (or "browse all evidence") and its
 * detail opens in the context column. A Compare toggle swaps that column for a
 * side-by-side of the checked causes. The AI narrative sits full-width below.
 */
import { useEffect, useState } from 'react';
import { Activity, GitCompare, List, ScanSearch, Sparkles, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/store';
import CompareCauses from './workbench/CompareCauses';
import CoveragePanel from './workbench/CoveragePanel';
import DetailPane from './workbench/DetailPane';
import EvidenceStream from './workbench/EvidenceStream';
import HypothesisRail from './workbench/HypothesisRail';
import NarrativePanel from './workbench/NarrativePanel';
import { EmptyState, Section } from './shared/ui';

function CompareToggle() {
  const compareMode = useAppStore((s) => s.compareMode);
  const toggleCompareMode = useAppStore((s) => s.toggleCompareMode);
  const compareIds = useAppStore((s) => s.compareIds);
  return (
    <button
      type="button"
      onClick={() => toggleCompareMode()}
      className={clsx(
        'flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
        compareMode
          ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
          : 'border-slate-700 text-slate-400 hover:border-sky-500/50 hover:text-sky-300',
      )}
      title="compare causes side by side"
    >
      {compareMode ? <X size={11} /> : <GitCompare size={11} />}
      {compareMode ? `comparing ${compareIds.length}` : 'compare'}
    </button>
  );
}

export default function Workbench() {
  const evidence = useAppStore((s) => s.evidence);
  const bayes = useAppStore((s) => s.bayes);
  const compareMode = useAppStore((s) => s.compareMode);
  const selectedEvidenceId = useAppStore((s) => s.selectedEvidenceId);
  const focusNonce = useAppStore((s) => s.evidenceFocusNonce);
  const [browse, setBrowse] = useState(false);

  // Selecting a finding (from a cause row, a citation, or the browse list) is a
  // request to SEE it — always surface the detail, closing the browse list.
  useEffect(() => {
    if (selectedEvidenceId) setBrowse(false);
  }, [selectedEvidenceId, focusNonce]);

  if (!evidence || !bayes) {
    return (
      <EmptyState
        title="No disposition loaded"
        body="Load mission data to compute the evidence package and hypothesis posteriors. Every number here is computed from your files — the AI writes narrative only."
      />
    );
  }

  const contextTitle = compareMode
    ? 'Compare causes'
    : browse
      ? `Evidence · ${evidence.items.length} findings`
      : 'Finding detail';
  const contextIcon = compareMode ? (
    <GitCompare size={13} />
  ) : browse ? (
    <ScanSearch size={13} />
  ) : (
    <Activity size={13} />
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-5">
        {/* Causes — primary, ranked (runner-up always in view) */}
        <Section
          title="Causes · ranked by confidence"
          icon={<Activity size={13} />}
          id="hypothesis-rail"
          right={<CompareToggle />}
          className="xl:col-span-2 xl:h-[calc(100vh-150px)] xl:overflow-hidden [&>div]:h-[calc(100%-37px)]"
        >
          <div className="flex h-full min-h-0 flex-col gap-2">
            <CoveragePanel variant="compact" />
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <HypothesisRail />
            </div>
          </div>
        </Section>

        {/* Context — evidence detail on demand · browse all · or compare */}
        <Section
          title={contextTitle}
          icon={contextIcon}
          right={
            !compareMode ? (
              <button
                type="button"
                onClick={() => setBrowse((v) => !v)}
                className="flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:border-sky-500/50 hover:text-sky-300"
                title={browse ? 'back to the selected finding' : 'browse every finding'}
              >
                {browse ? <Activity size={11} /> : <List size={11} />}
                {browse ? 'detail' : 'browse all'}
              </button>
            ) : undefined
          }
          className="xl:col-span-3 xl:h-[calc(100vh-150px)] xl:overflow-hidden [&>div]:h-[calc(100%-37px)] [&>div]:overflow-y-auto"
        >
          {compareMode ? <CompareCauses /> : browse ? <EvidenceStream /> : <DetailPane />}
        </Section>
      </div>

      {/* AI narrative — full width, below the analysis */}
      <Section title="AI narrative" icon={<Sparkles size={13} />}>
        <NarrativePanel />
      </Section>
    </div>
  );
}
