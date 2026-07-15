/**
 * TRIAGE dashboard shell: header (wordmark, vehicle/sol strip, narrative
 * status), free tab bar, active tab content. Tabs share the zustand store;
 * all derived artifacts recompute reactively when inputs change.
 */
import { clsx } from 'clsx';
import {
  Activity,
  ArrowLeft,
  Database,
  FileOutput,
  Plane,
  Scale,
  Stethoscope,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppStore, type TabId } from '../state/store';
import BriefingTab from './briefing/BriefingTab';
import StoryOverlay from './story/StoryOverlay';
import DecisionTab from './DecisionTab';
import ExportTab from './ExportTab';
import FlightDeck from './FlightDeck';
import MissionHome from './MissionHome';
import StatusRibbon from './StatusRibbon';
import TriageTab from './TriageTab';
import Workbench from './Workbench';

/** The six detail views, reached as drill-downs from the Command View. */
const DETAIL_TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'workbench', label: 'Analysis', icon: <Activity size={13} /> },
  { id: 'decision', label: 'Decision', icon: <Scale size={13} /> },
  { id: 'triage', label: 'Triage', icon: <Stethoscope size={13} /> },
  { id: 'flightdeck', label: 'Flight Deck', icon: <Plane size={13} /> },
  { id: 'export', label: 'Export', icon: <FileOutput size={13} /> },
  { id: 'home', label: 'Data', icon: <Database size={13} /> },
];

export default function Dashboard() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const onCommand = activeTab === 'briefing';

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setActiveTab('briefing')}
            className="text-left"
            title={onCommand ? undefined : 'back to command view'}
          >
            <h1 className="font-mono text-lg font-bold tracking-[0.28em] text-slate-100">TRIAGE</h1>
            {onCommand && (
              <p className="text-[10px] leading-tight tracking-wide text-slate-500">
                Telemetry Root-cause Inference And Guided Evaluation
              </p>
            )}
          </button>

          {/* Detail-view chrome only: back button + status ribbon for continuity.
              The Command View carries its own verdict, so the header stays bare there. */}
          {!onCommand && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('briefing')}
                className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-400 transition-colors hover:border-sky-500/50 hover:text-sky-300"
              >
                <ArrowLeft size={12} /> command
              </button>
              <div className="ml-auto">
                <StatusRibbon />
              </div>
            </>
          )}
        </div>

        {/* Quiet secondary sub-nav — detail views reachable from one another,
            without the loud 7-tab bar competing on the default screen. */}
        {!onCommand && (
          <nav className="mx-auto mt-3 flex max-w-[1600px] flex-wrap gap-1" role="tablist">
            {DETAIL_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx(
                  'flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                  activeTab === t.id
                    ? 'border-sky-400/60 bg-sky-500/10 text-sky-300'
                    : 'border-transparent text-slate-500 hover:bg-slate-900/40 hover:text-slate-300',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] p-4">
        {activeTab === 'briefing' && <BriefingTab />}
        {activeTab === 'home' && <MissionHome />}
        {activeTab === 'workbench' && <Workbench />}
        {activeTab === 'decision' && <DecisionTab />}
        {activeTab === 'triage' && <TriageTab />}
        {activeTab === 'flightdeck' && <FlightDeck />}
        {activeTab === 'export' && <ExportTab />}
      </main>

      <StoryOverlay />

      <footer className="mx-auto max-w-[1600px] px-4 pb-4">
        <p className="border-t border-slate-800/60 pt-2 text-[10px] leading-snug text-slate-600">
          Numbers are computed, never generated · every claim traces to source rows · TRIAGE
          advises, humans decide.
        </p>
      </footer>
    </div>
  );
}
