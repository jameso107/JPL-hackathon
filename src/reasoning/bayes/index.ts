/**
 * STUB — implemented by the bayes agent. See docs/CONTRACTS.md §Bayes.
 *
 * Priors from same-category resolved anomaly-history records (Laplace-smoothed,
 * heritage included, catch-all keeps reserved mass; uniform fallback when history
 * is missing). Update: log-linear pooling — score = ln(prior) + Σ w·τ·ln(LR) over
 * matched patterns; softmax normalization. Emits per-hypothesis log-odds waterfalls.
 */
import type {
  BayesConfig,
  BayesResult,
  EvidencePackage,
  HypothesisLibrary,
  MissionModel,
} from '../../types';

export function runBayes(
  _pkg: EvidencePackage,
  _library: HypothesisLibrary,
  _model: MissionModel,
  _cfg: BayesConfig,
): BayesResult {
  throw new Error('not implemented: runBayes');
}
