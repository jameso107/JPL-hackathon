/**
 * Plain-language glossary — every technical term keeps its precise label but
 * gains a plain-English pairing (NN/g jargon guidance; NASA plain-language).
 * Rendered by the <Term> component in ui.tsx: plain word first, jargon muted,
 * definition in the tooltip.
 */

export interface GlossaryEntry {
  /** plain-English word shown first */
  plain: string;
  /** the precise technical term, shown muted */
  jargon: string;
  /** one-sentence tooltip definition */
  definition: string;
}

export const GLOSSARY = {
  posterior: {
    plain: 'confidence',
    jargon: 'posterior',
    definition: 'How likely this cause is after weighing all the evidence.',
  },
  prior: {
    plain: 'starting belief',
    jargon: 'prior',
    definition:
      "How likely this cause looked from fleet history, before this flight's evidence.",
  },
  logOdds: {
    plain: 'evidence push',
    jargon: 'log-odds shift',
    definition: 'How hard the evidence moved the belief up or down (log scale).',
  },
  likelihoodRatio: {
    plain: 'diagnostic strength',
    jargon: 'likelihood ratio',
    definition: 'How much more expected this finding is if the cause is true vs. not.',
  },
  confounder: {
    plain: 'alternative explanation',
    jargon: 'confounder',
    definition: 'Something else (wind, temperature, software) that could explain the same signal.',
  },
  lov: {
    plain: 'chance of losing the helicopter',
    jargon: 'P(LOV)',
    definition: 'Probability the vehicle is lost flying this plan.',
  },
  tempering: {
    plain: 'caution factor',
    jargon: 'tempering τ',
    definition: 'Deliberately dampens every piece of evidence so no single finding overwhelms.',
  },
  discrimination: {
    plain: 'tie-breaker power',
    jargon: 'discrimination score',
    definition: 'How well this test tells the leading suspects apart.',
  },
  normalization: {
    plain: 'rebalancing',
    jargon: 'normalization',
    definition: 'Probabilities across all causes must sum to 100%.',
  },
  weight: {
    plain: 'signal strength',
    jargon: 'weight w',
    definition: '0–1 significance; scales how much this finding counts in the update.',
  },
  riskAdjustedCost: {
    plain: 'true cost',
    jargon: 'risk-adjusted',
    definition: 'Direct dollars plus dollar-priced risks of vehicle loss and lost samples.',
  },
  margin: {
    plain: 'schedule cushion',
    jargon: 'margin',
    definition: 'Mars days of slack before the launch-window deadline.',
  },
  sol: {
    plain: 'Mars day',
    jargon: 'sol',
    definition: 'One Martian day ≈ 24 h 39 m.',
  },
  expectedSamples: {
    plain: "samples we'd still get",
    jargon: 'E[samples]',
    definition: 'Expected sample tubes retrieved, weighted by the chance the vehicle survives.',
  },
  heritagePrior: {
    plain: 'fleet history match',
    jargon: 'heritage prior',
    definition: 'A past anomaly on this or a sister vehicle that informs the starting belief.',
  },
  gate: {
    plain: 'if/then checkpoint',
    jargon: 'decision gate',
    definition: 'Each test outcome names which causes it supports and what to do next.',
  },
  exceedance: {
    plain: 'over the limit',
    jargon: 'exceedance',
    definition: 'A measured value crossed its alert threshold.',
  },
  assertedInput: {
    plain: 'stated assumption',
    jargon: 'asserted input',
    definition: 'A fixed engineering-judgment value, cited — not computed from the mission files.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
