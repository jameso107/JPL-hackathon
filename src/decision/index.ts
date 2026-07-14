/**
 * STUB — implemented by the decision agent. See docs/CONTRACTS.md §Decision.
 *
 * Expected-cost tree: actions × world states (hypotheses weighted by posterior).
 * Computed inputs from mission files (delay cost/sol, parts, budget, margins);
 * asserted inputs from config/risk_defaults.yaml, every value cited.
 */
import type { BayesResult, DecisionAnalysis, MissionModel, RiskDefaults } from '../types';

export function runDecision(
  _bayes: BayesResult,
  _model: MissionModel,
  _risk: RiskDefaults,
): DecisionAnalysis {
  throw new Error('not implemented: runDecision');
}
