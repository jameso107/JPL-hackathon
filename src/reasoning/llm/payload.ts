/**
 * Compact payload builder — the LLM never sees raw files or provenance rows.
 * Target < 8K tokens: ids, statements, and headline numbers only.
 */
import { hypothesisLibrary } from '../../config';
import type { NarrativeRequest, WaterfallStep } from '../../types';

export interface CompactEvidenceItem {
  id: string;
  kind: string;
  pattern?: string;
  statement: string;
  weight: number;
}

export interface CompactHypothesis {
  id: string;
  name: string;
  prior: number;
  posterior: number;
  /** top-3 waterfall contributors rendered as text, e.g. "EV-08 bearing_play_near_limit: +1.234 log-odds" */
  topContributors: string[];
}

export interface CompactAction {
  id: string;
  name: string;
  expectedRiskAdjustedCostUsd: number;
  lovProbability: number;
  expectedSamples: number;
  marginConsumedSols: number;
}

export interface CompactPayload {
  vehicle: string;
  anomaly: { description: string; category: string; flightRef?: string };
  evidence: CompactEvidenceItem[];
  hypotheses: CompactHypothesis[];
  decision: {
    recommendedActionId: string;
    schedule: {
      currentSol: number;
      effectiveDeadlineSol: number;
      marginSols: number;
      delayCostPerSolUsd: number;
    };
    actions: CompactAction[];
  };
  triageSteps: { id: string; name: string; rationale: string }[];
  hypothesisLibrary: { id: string; name: string; description: string }[];
}

const round = (x: number, digits: number): number => Number(x.toFixed(digits));

function contributorText(step: WaterfallStep): string {
  const sign = step.delta >= 0 ? '+' : '';
  const prefix = step.evidenceId ? `${step.evidenceId} ` : '';
  return `${prefix}${step.label}: ${sign}${step.delta.toFixed(3)} log-odds`;
}

export function buildCompactPayload(req: NarrativeRequest): CompactPayload {
  return {
    vehicle: req.vehicle,
    anomaly: {
      description: req.evidence.anomaly.description,
      category: req.evidence.anomaly.category,
      ...(req.evidence.anomaly.flightRef !== undefined
        ? { flightRef: req.evidence.anomaly.flightRef }
        : {}),
    },
    evidence: req.evidence.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      ...(item.pattern !== undefined ? { pattern: item.pattern } : {}),
      statement: item.statement,
      weight: round(item.weight, 3),
    })),
    hypotheses: req.bayes.posteriors.map((p) => ({
      id: p.hypothesisId,
      name: p.name,
      prior: round(p.prior, 4),
      posterior: round(p.posterior, 4),
      topContributors: p.waterfall
        .filter((s) => s.kind === 'evidence')
        .slice()
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3)
        .map(contributorText),
    })),
    decision: {
      recommendedActionId: req.decision.recommendedActionId,
      schedule: {
        currentSol: req.decision.schedule.currentSol,
        effectiveDeadlineSol: req.decision.schedule.effectiveDeadlineSol.value,
        marginSols: req.decision.schedule.marginSols.value,
        delayCostPerSolUsd: req.decision.schedule.delayCostPerSolUsd.value,
      },
      actions: req.decision.actions.map((a) => ({
        id: a.actionId,
        name: a.name,
        expectedRiskAdjustedCostUsd: Math.round(a.expectedRiskAdjustedCostUsd),
        lovProbability: round(a.lovProbability, 4),
        expectedSamples: round(a.expectedSamples, 3),
        marginConsumedSols: a.marginConsumedSols,
      })),
    },
    triageSteps: req.triage.steps.map((s) => ({
      id: s.stepId,
      name: s.name,
      rationale: s.rationale,
    })),
    hypothesisLibrary: hypothesisLibrary.hypotheses.map((h) => ({
      id: h.id,
      name: h.name,
      description: h.description,
    })),
  };
}
