import type { EvidencePackage } from './evidence';
import type { BayesResult } from './hypothesis';
import type { DecisionAnalysis } from './decision';
import type { TriagePlan } from './triage';

/** LLM adapter contract (zod-validated in src/reasoning/llm). */

export interface HypothesisRationale {
  hypothesisId: string;
  narrative: string;
  /** must be valid EV ids from the evidence package */
  citedEvidence: string[];
}

export interface AiProposedHypothesis {
  name: string;
  rationale: string;
  /** falsifiable test — proposals without one are dropped by the adapter */
  distinguishingTest: string;
}

export interface TriageStepRationale {
  stepId: string;
  rationale: string;
}

export interface DispositionNarrative {
  executiveSummary: string;
  hypothesisRationales: HypothesisRationale[];
  aiProposedHypotheses?: AiProposedHypothesis[];
  triageStepRationales: TriageStepRationale[];
  caveats: string[];
}

export interface NarrativeRequest {
  evidence: EvidencePackage;
  bayes: BayesResult;
  decision: DecisionAnalysis;
  triage: TriagePlan;
  vehicle: string;
}

export type NarrativeStatus = 'llm' | 'llm_retry' | 'fallback';

export interface NarrativeResult {
  status: NarrativeStatus;
  narrative: DispositionNarrative;
  /** populated when status = fallback */
  error?: string;
  /** AI proposals dropped for lacking a distinguishing test */
  droppedProposals?: number;
}
