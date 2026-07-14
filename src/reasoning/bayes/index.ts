/**
 * Bayes engine — log-linear pooling over the hypothesis library.
 * See docs/CONTRACTS.md §Bayes.
 *
 * Priors come from same-category resolved anomaly-history records (Laplace-
 * smoothed keyword counts, reserved catch-all mass, uniform fallback when
 * history is missing — see ./priors).
 *
 * Update: score(h) = ln(prior(h)) + Σ over evidence items with a pattern of
 * w_i · τ · ln(LR(h, pattern_i)); an absent LR means 1.0 (zero contribution,
 * no waterfall bar). The catch-all's score is ln(prior) exactly. Posteriors
 * are a numerically-stable softmax (max-score subtraction). Every hypothesis
 * gets a log-odds waterfall: prior → evidence bars → normalization → posterior,
 * with the invariant cumulative(last) = ln(posterior) to 1e-9.
 */
import type {
  BayesConfig,
  BayesResult,
  EvidenceItem,
  EvidencePackage,
  Hypothesis,
  HypothesisLibrary,
  HypothesisPosterior,
  MissionModel,
  WaterfallStep,
} from '../../types';
import { computePriors } from './priors';

interface ScoredHypothesis {
  hypothesis: Hypothesis;
  prior: number;
  lnPrior: number;
  /** ln(prior) + Σ w·τ·ln(LR) */
  score: number;
  /** prior step + one evidence step per non-zero contribution */
  steps: WaterfallStep[];
  /** evidence ids that produced a waterfall bar */
  matchedEvidence: string[];
}

function scoreHypothesis(
  hypothesis: Hypothesis,
  prior: number,
  patternItems: EvidenceItem[],
  tempering: number,
): ScoredHypothesis {
  const lnPrior = Math.log(prior);
  const steps: WaterfallStep[] = [
    { kind: 'prior', label: 'prior', delta: lnPrior, cumulative: lnPrior },
  ];
  const matchedEvidence: string[] = [];
  let score = lnPrior;

  // Catch-all receives no likelihood updates by construction.
  if (!hypothesis.isCatchAll) {
    for (const item of patternItems) {
      const response = hypothesis.evidenceResponse.find((r) => r.pattern === item.pattern);
      if (!response) continue; // absent LR → 1.0 → zero contribution, no bar
      const delta = item.weight * tempering * Math.log(response.lr);
      if (delta === 0) continue; // zero contribution (lr = 1 or weight 0) → no bar
      score += delta;
      steps.push({
        kind: 'evidence',
        evidenceId: item.id,
        label: item.pattern as string,
        delta,
        cumulative: score,
      });
      matchedEvidence.push(item.id);
    }
  }

  return { hypothesis, prior, lnPrior, score, steps, matchedEvidence };
}

export function runBayes(
  pkg: EvidencePackage,
  library: HypothesisLibrary,
  model: MissionModel,
  cfg: BayesConfig,
): BayesResult {
  const { priors, contributions, usedRecords, excludedRecords, uniformFallback } =
    computePriors(model.anomalyHistory, pkg.anomaly.category, library.hypotheses, cfg);

  // Only pattern-bearing evidence participates in the update; historical_match
  // and constraint items carry no pattern and are display/decision inputs only.
  const patternItems = pkg.items.filter((item) => item.pattern !== undefined);

  const scored = library.hypotheses.map((h) =>
    scoreHypothesis(h, priors.get(h.id) ?? 0, patternItems, cfg.tempering),
  );

  // Numerically-stable softmax: subtract the max score before exponentiating.
  const maxScore = scored.reduce((m, s) => Math.max(m, s.score), -Infinity);
  const sumExp = scored.reduce((acc, s) => acc + Math.exp(s.score - maxScore), 0);
  // ln(Z') where Z' = Σ exp(score − maxScore) · exp(maxScore)
  const logZ = maxScore + Math.log(sumExp);

  const posteriors: HypothesisPosterior[] = scored.map((s) => {
    const logPosterior = s.score - logZ;
    const posterior = Math.exp(logPosterior);
    const waterfall: WaterfallStep[] = [
      ...s.steps,
      // ln(posterior) − score = −ln(Z')
      { kind: 'normalization', label: 'normalization', delta: -logZ, cumulative: logPosterior },
      { kind: 'posterior', label: 'posterior', delta: 0, cumulative: logPosterior },
    ];
    return {
      hypothesisId: s.hypothesis.id,
      name: s.hypothesis.name,
      prior: s.prior,
      posterior,
      logOddsShift: logPosterior - s.lnPrior,
      waterfall,
      priorContributions: contributions.get(s.hypothesis.id) ?? [],
      matchedEvidence: s.matchedEvidence,
    };
  });

  posteriors.sort((a, b) => b.posterior - a.posterior);

  return {
    posteriors,
    priorsMeta: {
      usedRecords,
      excludedRecords,
      laplaceAlpha: cfg.laplaceAlpha,
      reservedUnknownMass: cfg.reservedUnknownMass,
      uniformFallback,
    },
    tempering: cfg.tempering,
  };
}
