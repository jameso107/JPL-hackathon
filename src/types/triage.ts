/** Triage/diagnosis plan generator output. */

export interface PersonnelCandidate {
  name: string;
  role: string;
  score: number;
  /** e.g. "rotor_dynamics + vibration_analysis; Level A; available" */
  matchRationale: string;
  availability: string;
}

export interface DecisionGate {
  /** e.g. "Bearing-frequency sidebands present" */
  outcome: string;
  /** hypothesis ids this outcome supports */
  supports: string[];
  /** hypothesis ids this outcome argues against */
  refutes: string[];
  /** what to do next, e.g. "Branch B: mitigated critical-only flight plan" */
  nextAction: string;
}

export interface TriageStep {
  stepId: string;
  diagnosticId: string;
  name: string;
  description: string;
  /** why this step is ordered here (discrimination rationale) */
  rationale: string;
  durationSols: number;
  startSol: number;
  /** pairs-weighted discrimination score that produced the ordering */
  discriminationScore: number;
  /** hypothesis pairs this step separates, as "hypA vs hypB" */
  separates: string[];
  gates: DecisionGate[];
  candidates: PersonnelCandidate[];
  /** cost drawn from budget file when available */
  estimatedCostUsd?: number;
}

export interface TriagePlan {
  steps: TriageStep[];
  totalDurationSols: number;
  /** sol by which the plan completes, vs decision deadline */
  completionSol: number;
  notes: string[];
}
