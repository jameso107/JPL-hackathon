/**
 * Story overlay — a non-modal floating card that walks the seven steps.
 * It is a cursor, not a cage: it never traps focus or blocks navigation;
 * the user can wander off and Next simply re-applies the next step's tab.
 * Keyboard: ← → navigate, Escape exits.
 */
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { STORY_STEPS } from './storySteps';

export default function StoryOverlay() {
  const storyActive = useAppStore((s) => s.storyActive);
  const storyStep = useAppStore((s) => s.storyStep);
  const setStoryStep = useAppStore((s) => s.setStoryStep);
  const exitStory = useAppStore((s) => s.exitStory);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const step = STORY_STEPS[Math.max(0, Math.min(storyStep, STORY_STEPS.length - 1))];

  // Apply the step's tab + selection side effects, then scroll to its anchor.
  useEffect(() => {
    if (!storyActive || !step) return;
    const state = useAppStore.getState();
    setActiveTab(step.tab);
    step.apply?.(state);
    if (step.anchorId) {
      // wait a frame for the tab to mount
      const t = window.setTimeout(() => {
        document.getElementById(step.anchorId!)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 120);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyActive, storyStep]);

  // Keyboard navigation.
  useEffect(() => {
    if (!storyActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitStory();
      if (e.key === 'ArrowRight' && storyStep < STORY_STEPS.length - 1) setStoryStep(storyStep + 1);
      if (e.key === 'ArrowLeft' && storyStep > 0) setStoryStep(storyStep - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [storyActive, storyStep, exitStory, setStoryStep]);

  if (!storyActive || !step) return null;
  const state = useAppStore.getState();
  const last = storyStep >= STORY_STEPS.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-xl rounded-lg border border-sky-500/50 bg-slate-900/95 p-3 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400">
              guided tour · {storyStep + 1}/{STORY_STEPS.length}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-100">{step.title}</h3>
          </div>
          <button
            type="button"
            onClick={exitStory}
            className="text-slate-500 transition-colors hover:text-slate-200"
            aria-label="exit tour"
          >
            <X size={15} />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{step.body(state)}</p>
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            disabled={storyStep === 0}
            onClick={() => setStoryStep(storyStep - 1)}
            className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-400 transition-colors enabled:hover:text-slate-200 disabled:opacity-40"
          >
            <ChevronLeft size={12} /> back
          </button>
          <div className="mx-auto flex items-center gap-1.5">
            {STORY_STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStoryStep(i)}
                aria-label={`step ${i + 1}: ${s.title}`}
                className={
                  i === storyStep
                    ? 'h-2 w-2 rounded-full bg-sky-400'
                    : 'h-1.5 w-1.5 rounded-full bg-slate-600 transition-colors hover:bg-slate-400'
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => (last ? exitStory() : setStoryStep(storyStep + 1))}
            className="flex items-center gap-1 rounded border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/20"
          >
            {last ? 'finish' : 'next'} {!last && <ChevronRight size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}
