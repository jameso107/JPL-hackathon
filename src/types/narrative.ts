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

/** Who the disposition narrative is written for — tunes tone, not the numbers. */
export type NarrativeAudience = 'board' | 'engineer';

/** A single narrative field the user can regenerate in isolation. */
export type NarrativeFocus = 'executiveSummary';

export interface NarrativeRequest {
  evidence: EvidencePackage;
  bayes: BayesResult;
  decision: DecisionAnalysis;
  triage: TriagePlan;
  vehicle: string;
  /** review-board (plain) vs engineer (technical); defaults to board when absent */
  audience?: NarrativeAudience;
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

// ---------------------------------------------------------------------------
// "Ask TRIAGE" grounded Q&A (src/reasoning/llm/qa.ts)
// ---------------------------------------------------------------------------

/** The model's structured answer, validated by qaAnswerSchema. */
export interface QaAnswer {
  answer: string;
  /** evidence ids the answer cites — sanitized to real EV ids by the adapter */
  citedEvidence: string[];
  /** the model's own signal that the question falls outside the analysis */
  outsideAnalysis: boolean;
}

/** One turn in the Ask-TRIAGE conversation (user question or assistant answer). */
export interface QaTurn {
  role: 'user' | 'assistant';
  text: string;
  /** assistant turns: valid EV ids cited (rendered as clickable chips) */
  citedEvidence?: string[];
  /** assistant turns: the question fell outside the computed analysis */
  outsideAnalysis?: boolean;
  /** assistant turns: true when this is the graceful "AI unavailable" fallback */
  fallback?: boolean;
  /** assistant turns: transport/validation error behind a fallback */
  error?: string;
  /** assistant turns: whether ChatHPC answered directly, after a retry, or fell back */
  status?: NarrativeStatus;
}
