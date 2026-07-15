/**
 * "How TRIAGE got here" — four cards teaching the pipeline shape in one glance
 * (Shneiderman overview), each deep-linking into its tab. Counts are computed.
 */
import { ArrowRight } from 'lucide-react';
import { useAppStore, type TabId } from '../../state/store';

export default function JourneyCards() {
  const evidence = useAppStore((s) => s.evidence);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  const triage = useAppStore((s) => s.triage);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const cards: { title: string; line: string; tab: TabId; available: boolean }[] = [
    {
      title: '1 · Evidence',
      line: evidence
        ? `${evidence.items.length} findings extracted from the mission files — every one traceable to its source rows.`
        : 'load telemetry to extract findings',
      tab: 'workbench',
      available: Boolean(evidence),
    },
    {
      title: '2 · Causes',
      line: bayes
        ? `${bayes.posteriors.length} candidate causes weighed against fleet history and this flight's evidence.`
        : 'requires evidence',
      tab: 'workbench',
      available: Boolean(bayes),
    },
    {
      title: '3 · Options',
      line: decision
        ? `${decision.actions.length} action plans costed across every possible cause, risk included.`
        : 'requires the mission timeline',
      tab: 'decision',
      available: Boolean(decision),
    },
    {
      title: '4 · Confirmation',
      line: triage
        ? `a ${triage.steps.length}-step test sequence to confirm the cause — done by Sol ${triage.completionSol}.`
        : 'requires posteriors',
      tab: 'triage',
      available: Boolean(triage),
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <button
          key={c.title}
          type="button"
          disabled={!c.available}
          onClick={() => setActiveTab(c.tab)}
          className="group rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors enabled:hover:border-sky-500/50 disabled:opacity-50"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {c.title}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-300">{c.line}</p>
          {c.available && (
            <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-sky-400">
              view <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
