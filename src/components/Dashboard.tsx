/**
 * TRIAGE dashboard shell: header (wordmark, vehicle/sol strip, narrative
 * status), free tab bar, active tab content. Tabs share the zustand store;
 * all derived artifacts recompute reactively when inputs change.
 */
import { clsx } from 'clsx';
import { Activity, Home, Scale, Stethoscope } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppStore, type TabId } from '../state/store';
import DecisionTab from './DecisionTab';
import MissionHome from './MissionHome';
import TriageTab from './TriageTab';
import Workbench from './Workbench';
import { Badge } from './shared/ui';

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Mission Home', icon: <Home size={13} /> },
  { id: 'workbench', label: 'Anomaly Workbench', icon: <Activity size={13} /> },
  { id: 'decision', label: 'Decision Analysis', icon: <Scale size={13} /> },
  { id: 'triage', label: 'Triage Plan', icon: <Stethoscope size={13} /> },
];

function HeaderStatus() {
  const model = useAppStore((s) => s.model);
  const narrative = useAppStore((s) => s.narrative);
  const loading = useAppStore((s) => s.narrativeLoading);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {model && (
        <>
          <Badge tone="accent">{model.meta.vehicle}</Badge>
          {typeof model.meta.currentSol === 'number' && (
            <span className="font-mono text-[11px] text-slate-400">Sol {model.meta.currentSol}</span>
          )}
          {model.timeline && /ground|hold/i.test(model.timeline.helicopterStatus) && (
            <Badge tone="critical">{model.timeline.helicopterStatus.replace(/_/g, ' ')}</Badge>
          )}
        </>
      )}
      {loading && <Badge tone="accent">narrative…</Badge>}
      {!loading && narrative && (
        <Badge
          tone={narrative.status === 'fallback' ? 'serious' : 'good'}
          title={narrative.error}
        >
          {narrative.status === 'fallback' ? 'deterministic mode' : 'ChatHPC narrative'}
        </Badge>
      )}
    </div>
  );
}

export default function Dashboard() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <h1 className="font-mono text-lg font-bold tracking-[0.28em] text-slate-100">
              TRIAGE
            </h1>
            <p className="text-[10px] leading-tight tracking-wide text-slate-500">
              Telemetry Root-cause Inference And Guided Evaluation
            </p>
          </div>
          <div className="ml-auto">
            <HeaderStatus />
          </div>
        </div>
        <nav className="mx-auto mt-3 flex max-w-[1600px] flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={clsx(
                'flex items-center gap-1.5 rounded-t border-b-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors',
                activeTab === t.id
                  ? 'border-sky-400 bg-slate-900/70 text-sky-300'
                  : 'border-transparent text-slate-500 hover:bg-slate-900/40 hover:text-slate-300',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1600px] p-4">
        {activeTab === 'home' && <MissionHome />}
        {activeTab === 'workbench' && <Workbench />}
        {activeTab === 'decision' && <DecisionTab />}
        {activeTab === 'triage' && <TriageTab />}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pb-4">
        <p className="border-t border-slate-800/60 pt-2 text-[10px] leading-snug text-slate-600">
          Numbers are computed, never generated · every claim traces to source rows · TRIAGE
          advises, humans decide.
        </p>
      </footer>
    </div>
  );
}
