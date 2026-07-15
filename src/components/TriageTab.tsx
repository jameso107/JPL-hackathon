/**
 * Triage Plan tab: sol-scaled timeline against the launch-window margin,
 * step cards with decision gates and top-3 personnel candidate pickers.
 */
import { clsx } from 'clsx';
import { useState } from 'react';
import {
  CalendarRange,
  GitBranch,
  ListOrdered,
  UserCheck,
} from 'lucide-react';
import { useAppStore } from '../state/store';
import type { TriagePlan, TriageStep } from '../types';
import { fmtNum, fmtUsd } from './shared/format';
import { hypName, prettyPair, prettyTag } from './shared/names';
import { P } from './shared/palette';
import { Badge, EmptyState, Section } from './shared/ui';

const STEP_COLORS = [P.blue, P.aqua, P.yellow, P.violet, P.magenta, P.red];

// ---------------------------------------------------------------------------
// Sol-scaled timeline + margin bar
// ---------------------------------------------------------------------------

function MarginTimeline({ plan }: { plan: TriagePlan }) {
  const decision = useAppStore((s) => s.decision);
  const startSol = plan.steps[0]?.startSol ?? 0;
  const deadline = decision?.schedule.effectiveDeadlineSol.value;
  const currentSol = decision?.schedule.currentSol ?? startSol - 1;
  // Scale: current sol → deadline (fallback: plan span padded).
  const spanEnd = deadline ?? plan.completionSol + 10;
  const span = Math.max(1, spanEnd - currentSol);
  const pos = (sol: number) => `${Math.max(0, Math.min(100, ((sol - currentSol) / span) * 100))}%`;
  const width = (sols: number) => `${Math.max(0.5, (sols / span) * 100)}%`;

  return (
    <div>
      <div className="relative h-16 rounded-lg border border-slate-800 bg-slate-900/60 px-0">
        {/* margin body */}
        <div className="absolute inset-y-0 left-0 right-0 rounded-lg bg-emerald-500/5" />
        {/* plan consumption */}
        <div
          className="absolute inset-y-0 rounded-l-lg bg-sky-500/10"
          style={{ left: pos(currentSol), width: width(plan.totalDurationSols + (plan.steps[0]?.startSol ?? 0) - currentSol) }}
          title={`triage plan: ${plan.totalDurationSols} sols`}
        />
        {/* step blocks */}
        {plan.steps.map((s, i) => (
          <div
            key={s.stepId}
            className="absolute top-2 h-7 rounded border border-slate-950/60"
            style={{ left: pos(s.startSol), width: width(s.durationSols), backgroundColor: STEP_COLORS[i % STEP_COLORS.length] }}
            title={`${s.stepId} ${s.name} · Sol ${s.startSol}–${s.startSol + s.durationSols}`}
          >
            <span className="block truncate px-1 font-mono text-[9px] leading-7 text-slate-950">
              {s.stepId}
            </span>
          </div>
        ))}
        {/* sol ticks */}
        <div className="absolute bottom-1 left-1 font-mono text-[9px] text-slate-500">
          Sol {currentSol} (today)
        </div>
        <div className="absolute bottom-1 right-1 font-mono text-[9px] text-amber-300">
          {deadline ? `Sol ${deadline} — effective deadline (window open − curing)` : `Sol ${spanEnd}`}
        </div>
        <div className="absolute bottom-6 font-mono text-[9px] text-slate-400" style={{ left: pos(plan.completionSol) }}>
          ▲ plan complete Sol {plan.completionSol}
        </div>
      </div>
      <p className="mt-1 px-1 text-[10px] leading-snug text-slate-500">
        sol-scaled: colored blocks are triage steps; the full bar spans today → effective
        launch-window deadline{deadline ? ` (${deadline - currentSol}-sol margin)` : ''}
      </p>
    </div>
  );
}

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
        <UserCheck size={11} /> candidates (ranked — the human picks)
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

function StepCard({ step, index }: { step: TriageStep; index: number }) {
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/60">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 px-3 py-2">
        <span
          className="flex h-5 w-9 items-center justify-center rounded font-mono text-[10px] font-bold text-slate-950"
          style={{ backgroundColor: STEP_COLORS[index % STEP_COLORS.length] }}
        >
          {step.stepId}
        </span>
        <h3 className="text-xs font-medium text-slate-100">{step.name}</h3>
        <span className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500">
          <span>
            Sol {step.startSol}–{step.startSol + step.durationSols} ({step.durationSols} sols)
          </span>
          {typeof step.estimatedCostUsd === 'number' && <span>{fmtUsd(step.estimatedCostUsd)}</span>}
          <span title="posterior-weighted pairs separated">disc {fmtNum(step.discriminationScore)}</span>
        </span>
      </header>
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
          <CandidatePicker step={step} />
        </div>
      </div>
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

  return (
    <div className="space-y-3">
      <Section title="Plan timeline vs launch-window margin" icon={<CalendarRange size={13} />}>
        <MarginTimeline plan={triage} />
      </Section>

      <Section
        title={`Diagnostic sequence · ${triage.steps.length} steps, ${triage.totalDurationSols} sols total`}
        icon={<ListOrdered size={13} />}
      >
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          Steps are ordered by discrimination value — how much posterior-weighted hypothesis mass
          each test separates. Each gate names the follow-on action for its outcome.
        </p>
        <ul className="space-y-3">
          {triage.steps.map((s, i) => (
            <StepCard key={s.stepId} step={s} index={i} />
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
