/**
 * STUB — implemented by the decision agent. See docs/CONTRACTS.md §Triage.
 *
 * Orders diagnostics by posterior-weighted discrimination value, attaches decision
 * gates from the diagnostics catalog, and ranks personnel candidates from the team
 * file (the human picks — candidates only).
 */
import type {
  BayesResult,
  DiagnosticsCatalog,
  HypothesisLibrary,
  MissionModel,
  TriagePlan,
} from '../types';

export function runTriage(
  _bayes: BayesResult,
  _model: MissionModel,
  _catalog: DiagnosticsCatalog,
  _library: HypothesisLibrary,
): TriagePlan {
  throw new Error('not implemented: runTriage');
}
