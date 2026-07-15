/**
 * MarginStrip — the schedule-cushion timeline: a linear sol axis from today to
 * the effective launch-window deadline, with computed markers (triage-plan
 * completion, critical sample flights, bearing resupply) and the plan's margin
 * consumption washed in. Position on a common scale (Cleveland–McGill #1) —
 * deliberately NOT a gauge, because the margin carries events, not one value.
 *
 * variant="compact": headline strip for Briefing/Decision.
 * variant="full": replaces the TriageTab gantt — includes the step blocks.
 */
import { useAppStore } from '../../state/store';
import { ChartCaption } from './charts';
import { P } from './palette';

const STEP_COLORS = [P.blue, P.aqua, P.yellow, P.violet, P.magenta, P.red];

export default function MarginStrip({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const decision = useAppStore((s) => s.decision);
  const triage = useAppStore((s) => s.triage);
  const model = useAppStore((s) => s.model);
  if (!decision) return null;

  const { currentSol, effectiveDeadlineSol, marginSols, resupplySol } = decision.schedule;
  const deadline = effectiveDeadlineSol.value;
  const span = Math.max(1, deadline - currentSol);
  const pos = (sol: number) => `${Math.max(0, Math.min(100, ((sol - currentSol) / span) * 100))}%`;
  const width = (sols: number) => `${Math.max(0.75, (sols / span) * 100)}%`;

  const criticalFlights = (model?.timeline?.scheduledFlights ?? []).filter(
    (f) => f.priority === 'critical' && f.objective === 'sample_retrieval',
  );
  const planEnd = triage?.completionSol;
  const remainingAfterPlan = planEnd !== undefined ? deadline - planEnd : undefined;
  const height = variant === 'full' ? 'h-16' : 'h-11';

  // sol gridlines every 25 sols
  const gridSols: number[] = [];
  for (let s = Math.ceil(currentSol / 25) * 25; s < deadline; s += 25) gridSols.push(s);

  return (
    <div>
      <div className={`relative ${height} overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60`}>
        {/* remaining margin field */}
        <div className="absolute inset-0 bg-emerald-500/5" />
        {/* margin consumed by the triage plan */}
        {planEnd !== undefined && (
          <div
            className="absolute inset-y-0 left-0 bg-sky-500/15"
            style={{ width: pos(planEnd) }}
            title={`triage plan consumes sols ${currentSol}–${planEnd}`}
          />
        )}
        {/* gridlines */}
        {gridSols.map((s) => (
          <div key={s} className="absolute inset-y-0 w-px bg-slate-800" style={{ left: pos(s) }}>
            <span className="absolute bottom-0 left-1 font-mono text-[8px] text-slate-600">
              {s}
            </span>
          </div>
        ))}
        {/* triage step blocks (full variant) */}
        {variant === 'full' &&
          triage?.steps.map((s, i) => (
            <div
              key={s.stepId}
              className="absolute top-1.5 h-6 rounded-sm border border-slate-950/60"
              style={{
                left: pos(s.startSol),
                width: width(s.durationSols),
                backgroundColor: STEP_COLORS[i % STEP_COLORS.length],
              }}
              title={`${s.stepId} ${s.name} · Sol ${s.startSol}–${s.startSol + s.durationSols}`}
            >
              <span className="block truncate px-0.5 font-mono text-[8px] leading-6 text-slate-950">
                {s.stepId}
              </span>
            </div>
          ))}
        {/* today */}
        <div className="absolute inset-y-0 w-[2px] bg-slate-200" style={{ left: pos(currentSol) }}>
          <span className="absolute top-0.5 left-1 whitespace-nowrap font-mono text-[9px] text-slate-300">
            today · Sol {currentSol}
          </span>
        </div>
        {/* plan completion */}
        {planEnd !== undefined && (
          <div className="absolute inset-y-0 w-px bg-sky-400" style={{ left: pos(planEnd) }}>
            <span
              className={`absolute ${variant === 'full' ? 'top-8' : 'top-0.5'} left-1 whitespace-nowrap font-mono text-[9px] text-sky-300`}
            >
              ▲ plan done {planEnd}
            </span>
          </div>
        )}
        {/* critical sample flights */}
        {criticalFlights.map((f) => (
          <div
            key={f.flightId}
            className="absolute inset-y-0 w-px bg-violet-400/70"
            style={{ left: pos(f.sol) }}
            title={`${f.flightId} · Sol ${f.sol} · ${f.notes}`}
          >
            <span className="absolute bottom-0.5 left-1 font-mono text-[8px] text-violet-300">
              {f.flightId}
            </span>
          </div>
        ))}
        {/* resupply */}
        {resupplySol && resupplySol.value <= deadline && (
          <div
            className="absolute inset-y-0 w-px bg-amber-400/80"
            style={{ left: pos(resupplySol.value) }}
            title={resupplySol.citation}
          >
            <span className="absolute top-0.5 right-1 whitespace-nowrap font-mono text-[9px] text-amber-300">
              resupply {resupplySol.value}
            </span>
          </div>
        )}
        {/* deadline edge */}
        <div className="absolute inset-y-0 right-0 w-[3px] bg-amber-400" title={effectiveDeadlineSol.citation} />
      </div>
      <ChartCaption
        takeaway={
          planEnd !== undefined && remainingAfterPlan !== undefined
            ? `Diagnosis completes Sol ${planEnd} — ${remainingAfterPlan} of the ${marginSols.value}-sol cushion left before the Sol ${deadline} deadline.`
            : `${marginSols.value} Mars days of cushion before the Sol ${deadline} deadline.`
        }
        method={`scale: sols, today → effective deadline (${effectiveDeadlineSol.citation})`}
      />
    </div>
  );
}
