/**
 * AI narrative panel: user-triggered ChatHPC disposition narrative with
 * status badge (llm / llm after retry / deterministic fallback), per-hypothesis
 * rationales with clickable EV citations, AI-proposed hypotheses, caveats.
 */
import { Bot, Loader2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../state/store';
import type { NarrativeAudience } from '../../types';
import { truncate } from '../shared/format';
import { hypName } from '../shared/names';
import { Badge, Disclosure, EvChip } from '../shared/ui';
import { useElapsedSeconds } from '../shared/useElapsedSeconds';

const AUDIENCES: { id: NarrativeAudience; label: string; title: string }[] = [
  { id: 'board', label: 'Board', title: 'plain, decision-first — for a program review board' },
  { id: 'engineer', label: 'Engineer', title: 'technical, method-aware — for a subsystem engineer' },
];

/** Board ↔ engineer segmented toggle; switching re-narrates if a narrative exists. */
function AudienceToggle() {
  const audience = useAppStore((s) => s.narrativeAudience);
  const setAudience = useAppStore((s) => s.setNarrativeAudience);
  const loading = useAppStore((s) => s.narrativeLoading);
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-700" role="group" aria-label="narrative audience">
      {AUDIENCES.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={loading}
          onClick={() => setAudience(a.id)}
          title={a.title}
          aria-pressed={audience === a.id}
          className={clsx(
            'px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50',
            audience === a.id
              ? 'bg-sky-500/15 text-sky-300'
              : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300',
          )}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

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
  const elapsed = useElapsedSeconds(loading);

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
          {loading
            ? `generating… ${elapsed > 0 ? `${elapsed}s` : ''}`
            : narrative
              ? 'regenerate narrative'
              : 'generate narrative'}
        </button>
        <AudienceToggle />
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
            <div className="mb-1 flex items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                executive summary
              </p>
              <button
                type="button"
                disabled={loading}
                onClick={() => void generate({ focus: 'executiveSummary' })}
                title="regenerate just this summary (leaves the rest of the narrative in place)"
                className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-600 transition-colors enabled:hover:text-sky-300 disabled:opacity-40"
              >
                <RefreshCw size={9} className={loading ? 'animate-spin' : undefined} /> redo
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-200">{n.executiveSummary}</p>
          </div>

          {n.hypothesisRationales.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                why the leading cause
              </p>
              <RationaleCard hr={n.hypothesisRationales[0]} validIds={validIds} />
              {n.hypothesisRationales.length > 1 && (
                <Disclosure
                  className="mt-1.5"
                  label={`rationales for ${n.hypothesisRationales.length - 1} more causes`}
                >
                  <ul className="space-y-2">
                    {n.hypothesisRationales.slice(1).map((hr) => (
                      <RationaleCard key={hr.hypothesisId} hr={hr} validIds={validIds} />
                    ))}
                  </ul>
                </Disclosure>
              )}
            </div>
          )}

          {n.aiProposedHypotheses && n.aiProposedHypotheses.length > 0 && (
            <Disclosure
              label={`AI-proposed hypotheses (${n.aiProposedHypotheses.length})`}
              teaser="new causes the AI suggested — flagged, unscored, each with a falsifiable test"
            >
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
            </Disclosure>
          )}

          {n.caveats.length > 0 && (
            <Disclosure
              label={`caveats (${n.caveats.length})`}
              teaser={truncate(n.caveats[0], 90)}
            >
              <ul className="list-inside list-disc space-y-1 text-[11px] leading-snug text-slate-400">
                {n.caveats.map((c) => (
                  <li key={c.slice(0, 40)}>{c}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}

function RationaleCard({
  hr,
  validIds,
}: {
  hr: { hypothesisId: string; narrative: string; citedEvidence: string[] };
  validIds: Set<string>;
}) {
  return (
    <li className="list-none rounded border border-slate-800 bg-slate-900/50 p-2">
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
  );
}
