/**
 * "Ask TRIAGE" — a right-side slide-over that turns the static disposition into
 * an interrogable expert. Questions are answered by ChatHPC grounded ONLY in the
 * computed analysis (evidence, posteriors, decision, sensitivity, triage); the
 * model narrates, never does arithmetic, and cites findings as [EV-..] chips that
 * deep-link into the Workbench. Unreachable ChatHPC ⇒ a graceful grounded fallback.
 */
import { Bot, Loader2, MessageCircleQuestion, Send, User, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useAppStore } from '../../state/store';
import type { QaTurn } from '../../types';
import { useElapsedSeconds } from '../shared/useElapsedSeconds';

/** Citation chip inside an answer: selects the evidence, jumps to the Workbench, closes the drawer. */
function CitationChip({ id }: { id: string }) {
  const selectEvidence = useAppStore((s) => s.selectEvidence);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const toggleAsk = useAppStore((s) => s.toggleAsk);
  return (
    <button
      type="button"
      onClick={() => {
        selectEvidence(id);
        setActiveTab('workbench');
        toggleAsk(false);
      }}
      title={`open ${id} in the analysis`}
      className="inline-flex items-center rounded border border-sky-500/30 bg-sky-500/5 px-1 py-px align-baseline font-mono text-[10px] text-sky-400 transition-colors hover:border-sky-400/60 hover:bg-sky-500/15"
    >
      {id}
    </button>
  );
}

/** Render answer prose with [EV-..] / EV-.. tokens as clickable chips (only cited ids),
 *  then a "sources" chip row for any cited ids that were not mentioned inline (e.g. the
 *  deterministic fallback answer, whose prose carries no inline tokens). */
function AnswerBody({ turn }: { turn: QaTurn }) {
  const cited = turn.citedEvidence ?? [];
  const citedSet = new Set(cited);
  const inline = new Set((turn.text.match(/EV-\d+/g) ?? []).filter((id) => citedSet.has(id)));
  const parts = turn.text.split(/(\[?EV-\d+\]?)/g);
  const extra = cited.filter((id) => !inline.has(id));
  return (
    <>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
        {parts.map((part, i) => {
          const m = part.match(/EV-\d+/);
          if (m && citedSet.has(m[0])) {
            return <CitationChip key={`${m[0]}-${i}`} id={m[0]} />;
          }
          return <Fragment key={i}>{part}</Fragment>;
        })}
      </p>
      {extra.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">sources</span>
          {extra.map((id) => (
            <CitationChip key={id} id={id} />
          ))}
        </div>
      )}
    </>
  );
}

function MessageBubble({ turn }: { turn: QaTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2">
          <p className="rounded-lg rounded-tr-sm border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-slate-100">
            {turn.text}
          </p>
          <User size={14} className="mt-1.5 shrink-0 text-sky-400" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[92%] items-start gap-2">
        <Bot size={14} className="mt-1 shrink-0 text-slate-400" />
        <div
          className={clsx(
            'rounded-lg rounded-tl-sm border px-3 py-2',
            turn.fallback
              ? 'border-orange-400/30 bg-orange-400/5'
              : 'border-slate-800 bg-slate-900/70',
          )}
        >
          <AnswerBody turn={turn} />
          {turn.fallback && (
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-orange-300/80">
              AI unavailable — deterministic answer
            </p>
          )}
          {turn.outsideAnalysis && !turn.fallback && (
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
              outside the computed analysis
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AskDrawer() {
  const askOpen = useAppStore((s) => s.askOpen);
  const toggleAsk = useAppStore((s) => s.toggleAsk);
  const qaMessages = useAppStore((s) => s.qaMessages);
  const qaLoading = useAppStore((s) => s.qaLoading);
  const askQuestion = useAppStore((s) => s.askQuestion);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  const ready = useAppStore((s) => Boolean(s.evidence && s.bayes && s.decision && s.triage));

  const [draft, setDraft] = useState('');
  const elapsed = useElapsedSeconds(qaLoading);
  const listRef = useRef<HTMLDivElement>(null);

  // Escape closes; keep it live only while open.
  useEffect(() => {
    if (!askOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleAsk(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askOpen, toggleAsk]);

  // Keep the newest message in view.
  useEffect(() => {
    if (askOpen && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [qaMessages, qaLoading, askOpen]);

  if (!askOpen) return null;

  const top = bayes?.posteriors[0];
  const runnerUp = bayes?.posteriors[1];
  const hasGround = decision?.actions.some((a) => a.actionId === 'ground_until_resupply');
  const starters: string[] = [];
  if (top && runnerUp) starters.push(`Why ${top.name.toLowerCase()} and not ${runnerUp.name.toLowerCase()}?`);
  starters.push('What is the strongest evidence for the leading cause?');
  starters.push('What is the risk of flying now?');
  if (hasGround) starters.push('Why is grounding so expensive?');
  starters.push('What would change the recommendation?');

  const submit = (text: string) => {
    if (!ready || qaLoading) return;
    const q = text.trim();
    if (q === '') return;
    setDraft('');
    void askQuestion(q);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* backdrop */}
      <button
        type="button"
        aria-label="close Ask TRIAGE"
        onClick={() => toggleAsk(false)}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px]"
      />
      {/* panel */}
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide text-slate-100">
              <MessageCircleQuestion size={15} className="text-sky-400" /> Ask TRIAGE
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              Answers come only from the computed analysis — cited, never recalculated.
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleAsk(false)}
            className="text-slate-500 transition-colors hover:text-slate-200"
            aria-label="close"
          >
            <X size={16} />
          </button>
        </header>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {!ready && (
            <p className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs leading-relaxed text-slate-400">
              Load mission data first — the assistant needs the computed evidence, posteriors,
              decision analysis, and triage plan to answer.
            </p>
          )}

          {ready && qaMessages.length === 0 && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-slate-400">
                Interrogate the disposition. Ask why a cause leads, what the evidence means, or what
                the risk of flying is. Try one of these:
              </p>
              <div className="flex flex-col gap-1.5">
                {starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:border-sky-500/50 hover:text-sky-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {qaMessages.map((turn, i) => (
            <MessageBubble key={i} turn={turn} />
          ))}

          {qaLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 size={13} className="animate-spin" />
              thinking… {elapsed > 0 && <span className="font-mono tabular-nums">{elapsed}s</span>}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-800 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              rows={2}
              disabled={!ready || qaLoading}
              placeholder={ready ? 'Ask about the analysis…' : 'Load mission data to ask'}
              className="min-h-[2.5rem] flex-1 resize-none rounded border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => submit(draft)}
              disabled={!ready || qaLoading || draft.trim() === ''}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-sky-500/50 bg-sky-500/10 text-sky-300 transition-colors enabled:hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="send question"
            >
              {qaLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-600">
            Enter to send · Shift+Enter for a new line · TRIAGE advises, humans decide.
          </p>
        </footer>
      </aside>
    </div>
  );
}
