/**
 * AI narrative panel: user-triggered ChatHPC disposition narrative with
 * status badge (llm / llm after retry / deterministic fallback), per-hypothesis
 * rationales with clickable EV citations, AI-proposed hypotheses, caveats.
 */
import { Bot, Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../state/store';
import { hypName } from '../shared/names';
import { Badge, EvChip } from '../shared/ui';

function StatusBadge() {
  const narrative = useAppStore((s) => s.narrative);
  if (!narrative) return null;
  if (narrative.status === 'llm') return <Badge tone="good">ChatHPC narrative</Badge>;
  if (narrative.status === 'llm_retry') {
    return <Badge tone="warning">ChatHPC narrative (after retry)</Badge>;
  }
  return (
    <Badge tone="serious" title={narrative.error}>
      deterministic fallback — AI narrative unavailable
    </Badge>
  );
}

export default function NarrativePanel() {
  const evidence = useAppStore((s) => s.evidence);
  const narrative = useAppStore((s) => s.narrative);
  const loading = useAppStore((s) => s.narrativeLoading);
  const generate = useAppStore((s) => s.generateNarrative);
  const ready = useAppStore((s) => Boolean(s.evidence && s.bayes && s.decision && s.triage));

  const validIds = new Set(evidence?.items.map((i) => i.id) ?? []);
  const n = narrative?.narrative;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!ready || loading}
          onClick={() => void generate()}
          className="inline-flex items-center gap-1.5 rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition-colors enabled:hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          title={ready ? undefined : 'requires evidence, posteriors, decision and triage artifacts'}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : narrative ? <RefreshCw size={13} /> : <Bot size={13} />}
          {loading ? 'generating…' : narrative ? 'regenerate narrative' : 'generate narrative'}
        </button>
        <StatusBadge />
        {typeof narrative?.droppedProposals === 'number' && narrative.droppedProposals > 0 && (
          <span className="text-[10px] text-slate-500">
            {narrative.droppedProposals} AI proposal(s) dropped — no falsifiable test
          </span>
        )}
      </div>

      {narrative?.status === 'fallback' && narrative.error && (
        <p className="rounded border border-orange-400/30 bg-orange-400/5 px-2.5 py-1.5 text-[11px] leading-snug text-orange-200/80">
          {narrative.error}
        </p>
      )}

      {!n && !loading && (
        <p className="text-xs leading-relaxed text-slate-500">
          The narrative layer writes rationale only — every number it cites comes from the
          computed evidence package and posteriors. Without ChatHPC connectivity the
          deterministic template narrative is used instead.
        </p>
      )}

      {n && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              executive summary
            </p>
            <p className="text-xs leading-relaxed text-slate-200">{n.executiveSummary}</p>
          </div>

          {n.hypothesisRationales.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                hypothesis rationales
              </p>
              <ul className="space-y-2">
                {n.hypothesisRationales.map((hr) => (
                  <li key={hr.hypothesisId} className="rounded border border-slate-800 bg-slate-900/50 p-2">
                    <p className="text-[11px] font-medium text-slate-300">{hypName(hr.hypothesisId)}</p>
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">{hr.narrative}</p>
                    {hr.citedEvidence.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {hr.citedEvidence.map((id) => (
                          <EvChip key={id} id={id} invalid={!validIds.has(id)} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {n.aiProposedHypotheses && n.aiProposedHypotheses.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                AI-proposed hypotheses
              </p>
              <ul className="space-y-2">
                {n.aiProposedHypotheses.map((p) => (
                  <li key={p.name} className="rounded border border-violet-400/40 bg-violet-500/5 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[11px] font-medium text-slate-200">{p.name}</p>
                      <Badge tone="violet">AI-proposed</Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">{p.rationale}</p>
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-violet-300">
                        test:
                      </span>{' '}
                      {p.distinguishingTest}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {n.caveats.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                caveats
              </p>
              <ul className="list-inside list-disc space-y-1 text-[11px] leading-snug text-slate-400">
                {n.caveats.map((c) => (
                  <li key={c.slice(0, 40)}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
