/**
 * Triage Plan tab: sol-scaled timeline against the launch-window margin,
 * step cards with decision gates and top-3 personnel candidate pickers.
 */
import { clsx } from 'clsx';
import { useState } from 'react';
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  GitBranch,
  ListOrdered,
  UserCheck,
} from 'lucide-react';
import { useAppStore } from '../state/store';
import type { TriageStep } from '../types';
import { fmtNum, fmtUsd } from './shared/format';
import MarginStrip from './shared/MarginStrip';
import { hypName, prettyPair, prettyTag } from './shared/names';
import { P } from './shared/palette';
import { Badge, Disclosure, EmptyState, Section, Term } from './shared/ui';

const STEP_COLORS = [P.blue, P.aqua, P.yellow, P.violet, P.magenta, P.red];

// ---------------------------------------------------------------------------
// Step card
// ---------------------------------------------------------------------------

function Gates({ step }: { step: TriageStep }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        <GitBranch size={11} /> decision gates
      </p>
      <ul className="space-y-1.5">
        {step.gates.map((g) => (
          <li key={g.outcome} className="rounded border border-slate-800 bg-slate-900/50 p-2">
            <p className="font-mono text-[11px] text-slate-200">{prettyTag(g.outcome)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {g.supports.map((h) => (
                <Badge key={h} tone="good" title={`outcome supports ${hypName(h)}`}>
                  ✓ {hypName(h).split(' ').slice(0, 3).join(' ')}
                </Badge>
              ))}
              {g.refutes.map((h) => (
                <Badge key={h} tone="critical" title={`outcome argues against ${hypName(h)}`}>
                  ✗ {hypName(h).split(' ').slice(0, 3).join(' ')}
                </Badge>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">→ {g.nextAction}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidatePicker({ step }: { step: TriageStep }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (step.candidates.length === 0) {
    return (
      <p className="text-[11px] text-slate-500">
        No personnel data loaded — candidate matching disabled.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        <UserCheck size={11} /> ranked candidates — the human picks
      </p>
      <ul className="space-y-1">
        {step.candidates.map((c) => (
          <li key={c.name}>
            <label
              className={clsx(
                'flex cursor-pointer items-start gap-2 rounded border p-2 transition-colors',
                picked === c.name
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-600',
              )}
            >
              <input
                type="radio"
                name={`cand-${step.stepId}`}
                checked={picked === c.name}
                onChange={() => setPicked(c.name)}
                className="mt-0.5 accent-emerald-500"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] font-medium text-slate-200">{c.name}</span>
                  <span className="text-[10px] text-slate-500">{c.role}</span>
                  <span className="font-mono text-[10px] tabular-nums text-slate-400">
                    score {fmtNum(c.score)}
                  </span>
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
                  {c.matchRationale}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({
  step,
  index,
  maxDisc,
  defaultOpen,
}: {
  step: TriageStep;
  index: number;
  /** largest discrimination score in the plan — keeps the header bars comparable */
  maxDisc: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={clsx(
          'flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left',
          open && 'border-b border-slate-800/80',
        )}
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-slate-500" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-slate-500" />
        )}
        <span
          className="flex h-5 w-9 items-center justify-center rounded font-mono text-[10px] font-bold text-slate-950"
          style={{ backgroundColor: STEP_COLORS[index % STEP_COLORS.length] }}
        >
          {step.stepId}
        </span>
        <h3 className="text-xs font-medium text-slate-100">{step.name}</h3>
        <span className="ml-auto flex flex-wrap items-center gap-3 font-mono text-[10px] text-slate-500">
          <span>
            Sol {step.startSol}–{step.startSol + step.durationSols} ({step.durationSols} sols)
          </span>
          {typeof step.estimatedCostUsd === 'number' && <span>{fmtUsd(step.estimatedCostUsd)}</span>}
          <span
            className="flex items-center gap-1.5"
            title={`tie-breaker power (discrimination score ${fmtNum(step.discriminationScore)}): how well this test separates the leading suspects`}
          >
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${maxDisc > 0 ? (step.discriminationScore / maxDisc) * 100 : 0}%`,
                  backgroundColor: P.aqua,
                }}
              />
            </span>
            tie-break
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 p-3">
          <p className="text-[11px] leading-snug text-slate-400">{step.description}</p>
          <p className="rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5 text-[11px] leading-snug text-slate-300">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">why here: </span>
            {step.rationale}
          </p>
          {step.separates.length > 0 && (
            <p className="text-[10px] leading-snug text-slate-500">
              separates: {step.separates.map(prettyPair).join(' · ')}
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <Gates step={step} />
            <Disclosure
              label="assign personnel · ranked candidates"
              teaser={
                step.candidates.length > 0
                  ? `top match: ${step.candidates[0].name} (${step.candidates[0].role})`
                  : 'no personnel data loaded'
              }
            >
              <CandidatePicker step={step} />
            </Disclosure>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export default function TriageTab() {
  const triage = useAppStore((s) => s.triage);

  if (!triage) {
    return (
      <EmptyState
        title="No triage plan"
        body="The diagnosis plan is generated from the hypothesis posteriors and the diagnostics catalog. Load mission data to build it."
      />
    );
  }

  const maxDisc = Math.max(...triage.steps.map((s) => s.discriminationScore), 0);

  return (
    <div className="space-y-3">
      <Section
        title="Plan timeline vs launch-window margin"
        icon={<CalendarRange size={13} />}
        id="plan-timeline"
      >
        <MarginStrip variant="full" />
      </Section>

      <Section
        title={`Diagnostic sequence · ${triage.steps.length} steps, ${triage.totalDurationSols} sols total`}
        icon={<ListOrdered size={13} />}
      >
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          Steps run in order of <Term k="discrimination" /> — the tests that best separate the
          leading suspects go first. Expand a step for its <Term k="gate" mode="plain" />s and
          candidate assignments.
        </p>
        <ul className="space-y-3">
          {triage.steps.map((s, i) => (
            <StepCard key={s.stepId} step={s} index={i} maxDisc={maxDisc} defaultOpen={i === 0} />
          ))}
        </ul>
      </Section>

      {triage.notes.length > 0 && (
        <Section title="Plan notes" icon={<GitBranch size={13} />}>
          <ul className="list-inside list-disc space-y-1 text-[11px] leading-snug text-slate-400">
            {triage.notes.map((n) => (
              <li key={n.slice(0, 48)}>{n}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
