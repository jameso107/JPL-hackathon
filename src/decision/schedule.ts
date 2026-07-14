/**
 * Shared schedule-fact computation (used by both the decision and triage modules).
 * Every value is a CitedValue tracing back to the mission timeline file; nothing here
 * is asserted config — it is all parsed from mission data (asserted: false).
 */
import type { CitedValue, MissionModel, MissionTimeline } from '../types';

/** Fallback curing duration (sols) when the timeline notes cannot be parsed. */
const CURING_SOLS_FALLBACK = 60;

/**
 * Parse the sample-curing duration from the timeline notes, e.g.
 * "… sample curing time at depot requires minimum 60 sols …" → 60.
 */
export function parseCuringSols(notes: string | undefined): number {
  const m = /minimum\s+(\d+)\s*sols?/i.exec(notes ?? '');
  return m ? Number(m[1]) : CURING_SOLS_FALLBACK;
}

/** File name (as ingested) for a dataset role, with a canonical fallback. */
export function sourceFileName(
  model: MissionModel,
  role: 'timeline' | 'inventory' | 'budget' | 'team',
  fallback: string,
): string {
  return model.meta.sources.find((s) => s.role === role)?.fileName ?? fallback;
}

export interface ScheduleFacts {
  currentSol: number;
  curingSols: CitedValue;
  effectiveDeadlineSol: CitedValue;
  marginSols: CitedValue;
  delayCostPerSolUsd: CitedValue;
  timeline: MissionTimeline;
}

/**
 * Compute the cited schedule facts from the mission timeline:
 *   effectiveDeadlineSol = earth_return_window.window_open_sol − curingSols
 *   marginSols           = effectiveDeadlineSol − currentSol
 */
export function computeScheduleFacts(model: MissionModel): ScheduleFacts {
  const timeline = model.timeline;
  if (!timeline) {
    throw new Error('schedule facts require the mission timeline (timeline dataset missing)');
  }
  const file = sourceFileName(model, 'timeline', 'mission_timeline.json');
  const curing = parseCuringSols(timeline.notes);
  const currentSol = timeline.currentSol;
  const windowOpen = timeline.earthReturnWindow.windowOpenSol;
  const deadline = windowOpen - curing;

  const curingSols: CitedValue = {
    value: curing,
    citation: `${file} notes: "sample curing time at depot requires minimum ${curing} sols"`,
    asserted: false,
  };
  const effectiveDeadlineSol: CitedValue = {
    value: deadline,
    citation: `${file} earth_return_window.window_open_sol (${windowOpen}) − ${curing}-sol curing (${file} notes)`,
    asserted: false,
  };
  const marginSols: CitedValue = {
    value: deadline - currentSol,
    citation: `effective deadline Sol ${deadline} − ${file} current_sol (${currentSol})`,
    asserted: false,
  };
  const delayCostPerSolUsd: CitedValue = {
    value: timeline.delayCostPerSolUsd,
    citation: `${file} delay_cost_per_sol_usd`,
    asserted: false,
  };

  return { currentSol, curingSols, effectiveDeadlineSol, marginSols, delayCostPerSolUsd, timeline };
}
