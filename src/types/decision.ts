/** Decision & mission-risk module: actions × world states → expected cost. */

export type ActionId =
  | 'ground_until_resupply'
  | 'fly_critical_only_mitigated'
  | 'resume_full_manifest'
  | 'mitigation_service_then_reassess';

export interface CitedValue {
  value: number;
  /** provenance: file+field for computed inputs, or config citation for asserted inputs */
  citation: string;
  asserted: boolean;
}

export interface ActionOutcomeForHypothesis {
  hypothesisId: string;
  posterior: number;
  /** P(loss of vehicle) over the action's flight profile under this hypothesis */
  lovProbability: number;
  /** expected batch-3 samples retrieved (of pending), survival-weighted */
  expectedSamples: number;
  /** direct cost (delay + parts + services + verification), USD */
  directCostUsd: number;
  /** direct + dollarized LOV & sample-shortfall penalties, USD */
  riskAdjustedCostUsd: number;
}

export interface ActionEvaluation {
  actionId: ActionId;
  name: string;
  summary: string;
  /** flights flown within the decision horizon, in order */
  flightsFlown: string[];
  delaySols: CitedValue;
  directCostUsd: number;
  /** Σ posterior × P(LOV | action, hypothesis) */
  lovProbability: number;
  /** Σ posterior × expected samples (of timeline.earthReturnWindow.samplesPendingRetrieval) */
  expectedSamples: number;
  /** sols of the effective launch-window margin consumed */
  marginConsumedSols: number;
  /** ranking key: Σ posterior × riskAdjustedCostUsd */
  expectedRiskAdjustedCostUsd: number;
  perHypothesis: ActionOutcomeForHypothesis[];
  /** budget categories whose remaining funds this action would exceed */
  budgetViolations: string[];
  mitigations: string[];
}

export interface DecisionAnalysis {
  /** sorted by expectedRiskAdjustedCostUsd, ascending (best first) */
  actions: ActionEvaluation[];
  recommendedActionId: ActionId;
  /** computed schedule facts, all cited */
  schedule: {
    currentSol: number;
    effectiveDeadlineSol: CitedValue;
    marginSols: CitedValue;
    delayCostPerSolUsd: CitedValue;
    /** next resupply sol for the missing critical part (from inventory), when known */
    resupplySol?: CitedValue;
  };
  /** asserted config inputs surfaced for the UI (LOV table, penalties) with citations */
  assertedInputs: { label: string; value: string; citation: string }[];
  /** one-line sensitivity notes, e.g. "recommendation flips to X if bearing posterior < Y" */
  sensitivityNotes: string[];
}
