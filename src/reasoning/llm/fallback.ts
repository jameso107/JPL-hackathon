/**
 * Deterministic template narrative used when the LLM is unavailable or its
 * output is invalid. Every number is copied from the request (never computed
 * here) and every citation is a real EV id from the evidence package.
 */
import type { DispositionNarrative, HypothesisPosterior, NarrativeRequest } from '../../types';

/** Hypotheses below this posterior are omitted from fallback rationales. */
const MIN_RATIONALE_POSTERIOR = 0.03;

const fmtPct = (p: number): string => `${Math.round(p * 100)}%`;

function rationaleFor(p: HypothesisPosterior, citedEvidence: string[]): string {
  if (citedEvidence.length > 0) {
    const moved = p.posterior >= p.prior ? 'rose' : 'fell';
    return (
      `${p.name} ${moved} from a prior of ${fmtPct(p.prior)} to a posterior of ` +
      `${fmtPct(p.posterior)}, driven by matched evidence ${citedEvidence.join(', ')}.`
    );
  }
  return (
    `${p.name} holds a posterior of ${fmtPct(p.posterior)} from prior mass alone; ` +
    `no computed evidence pattern matched this hypothesis.`
  );
}

export function buildFallbackNarrative(req: NarrativeRequest): DispositionNarrative {
  const validEvidenceIds = new Set(req.evidence.items.map((i) => i.id));
  const top = req.bayes.posteriors[0];
  const recommended = req.decision.actions.find(
    (a) => a.actionId === req.decision.recommendedActionId,
  );
  const recommendedName = recommended?.name ?? req.decision.recommendedActionId;
  const { schedule } = req.decision;

  const summaryParts: string[] = [
    `${req.vehicle} anomaly under disposition: ${req.evidence.anomaly.description}`,
  ];
  if (top !== undefined) {
    summaryParts.push(
      `The leading hypothesis is ${top.name} at ${fmtPct(top.posterior)} posterior probability.`,
    );
  }
  summaryParts.push(
    `Schedule margin is ${schedule.marginSols.value} sols against the effective deadline of ` +
      `sol ${schedule.effectiveDeadlineSol.value}; the recommended action is "${recommendedName}".`,
  );

  const hypothesisRationales = req.bayes.posteriors
    .filter((p) => p.posterior >= MIN_RATIONALE_POSTERIOR)
    .map((p) => {
      const citedEvidence = p.matchedEvidence.filter((id) => validEvidenceIds.has(id));
      return {
        hypothesisId: p.hypothesisId,
        narrative: rationaleFor(p, citedEvidence),
        citedEvidence,
      };
    });

  const triageStepRationales = req.triage.steps.map((s) => ({
    stepId: s.stepId,
    rationale: s.rationale,
  }));

  const caveats = [
    'Telemetry vibration values are reconstructed flight-summary statistics, not raw high-rate accelerometer data.',
    'Maintenance-log bearing-play values are inferred from vibration data — a sensor artifact would contaminate both evidence streams; sensor cross-check de-risks this coupling.',
    'Asserted LOV probabilities and loss penalties are cited engineering judgment (risk defaults), not measured quantities.',
    'AI narrative unavailable — deterministic disposition shown.',
  ];

  return {
    executiveSummary: summaryParts.join(' '),
    hypothesisRationales,
    triageStepRationales,
    caveats,
  };
}
