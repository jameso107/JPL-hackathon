/**
 * Decision module — expected-cost tree over actions × world states (hypotheses
 * weighted by posterior). See docs/CONTRACTS.md §Decision.
 *
 * Computed inputs come from mission files (delay cost/sol, parts, budget, margins);
 * asserted inputs come from config/risk_defaults.yaml. Every value is cited.
 */
import { diagnosticsCatalog } from '../config';
import type {
  ActionEvaluation,
  ActionId,
  ActionOutcomeForHypothesis,
  BayesResult,
  CitedValue,
  DecisionAnalysis,
  MissionModel,
  PartRecord,
  RiskDefaults,
  ScheduledFlight,
} from '../types';
import { computeScheduleFacts, sourceFileName, type ScheduleFacts } from './schedule';

export { computeScheduleFacts, parseCuringSols } from './schedule';

/** Fixed engineering estimate: robotic bearing replacement + 3-flight verification. */
const REPAIR_AND_VERIFY_SOLS = 10;
const REPAIR_AND_VERIFY_CITATION =
  'engineering estimate: robotic replacement + 3-flight verification';

/** Resupply-manifest slot fee (free text in the budget file, asserted here with citation). */
const LOGISTICS_FEE_USD = 35_000;
const LOGISTICS_FEE_CITATION =
  'budget_contingency.csv transportation_logistics notes: $35K reservation fee';

/** Post-repair 3-flight verification campaign (free text in the budget file). */
const VERIFICATION_CAMPAIGN_USD = 85_000;
const VERIFICATION_CAMPAIGN_CITATION =
  'budget_contingency.csv testing_verification notes: estimated $85K for 3-flight verification campaign';

/** Diagnostics run before flight under mitigation_service_then_reassess. */
const REASSESS_DIAGNOSTIC_IDS = ['ground_spin_spectrum', 'lubrication_response_test'];

const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------
// Sample-banking survival math
// ---------------------------------------------------------------------------

/**
 * Sequential-survival expectation of banked samples.
 *
 * Flights are flown in the given (sol-sorted) order; each survives independently
 * with probability (1 − perFlightLossP); a vehicle loss aborts all later flights.
 * A sample is banked when the vehicle has survived every flight up to and
 * including the pair-completing (banking) flight, so
 *   P(sample k banked) = (1 − p)^position(bankingFlight_k)  (1-based position).
 *
 * No hard-coded exponents: the walk multiplies survival up to each banking flight.
 */
export function expectedSamplesSequential(
  orderedFlightIds: string[],
  bankingFlightIds: string[],
  perFlightLossP: number,
): number {
  const banking = new Set(bankingFlightIds);
  let survival = 1;
  let expected = 0;
  for (const id of orderedFlightIds) {
    survival *= 1 - perFlightLossP;
    if (banking.has(id)) expected += survival;
  }
  return expected;
}

/**
 * Pairing rule: a pending sample is banked when its retrieval flight AND the
 * dependent transport flight both complete. A transport's `dependency` field
 * names its retrieval flight (e.g. "F48 completion" → F48).
 */
function bankingPairs(
  scheduledFlights: ScheduledFlight[],
  pendingSampleFlights: string[],
): { retrievalId: string; transportId: string }[] {
  const retrievals = new Set(pendingSampleFlights);
  const pairs: { retrievalId: string; transportId: string }[] = [];
  for (const f of scheduledFlights) {
    const m = /(F\d+)/.exec(f.dependency ?? '');
    if (m && retrievals.has(m[1])) {
      pairs.push({ retrievalId: m[1], transportId: f.flightId });
    }
  }
  return pairs;
}

/** Banking flights among the flights actually flown (retrieval must precede transport). */
function bankingFlightsFor(
  flownIds: string[],
  pairs: { retrievalId: string; transportId: string }[],
): string[] {
  const index = new Map(flownIds.map((id, i) => [id, i]));
  return pairs
    .filter((p) => {
      const r = index.get(p.retrievalId);
      const t = index.get(p.transportId);
      return r !== undefined && t !== undefined && r < t;
    })
    .map((p) => p.transportId);
}

// ---------------------------------------------------------------------------
// Action contexts
// ---------------------------------------------------------------------------

interface CostBreakdown {
  delayCostUsd: number;
  partsCostUsd: number;
  serviceCostUsd: number;
  verificationCostUsd: number;
  logisticsCostUsd: number;
  /** human-readable citations for the non-delay components */
  citations: string[];
}

interface ActionContext {
  id: ActionId;
  name: string;
  summary: string;
  lovProfile: string;
  flightsFlown: string[];
  bankingFlightIds: string[];
  delaySols: CitedValue;
  costs: CostBreakdown;
  directCostUsd: number;
  mitigations: string[];
  /** grounded action whose repair completes past the effective deadline → 0 samples */
  samplesForcedZero: boolean;
}

function findPart(inventory: PartRecord[] | undefined, re: RegExp): PartRecord | undefined {
  return inventory?.find((p) => re.test(p.description));
}

function buildActionContexts(
  model: MissionModel,
  risk: RiskDefaults,
  facts: ScheduleFacts,
): ActionContext[] {
  const timeline = facts.timeline;
  const inventoryFile = sourceFileName(model, 'inventory', 'parts_inventory.csv');
  const sorted = [...timeline.scheduledFlights].sort((a, b) => a.sol - b.sol);
  const criticalFlights = sorted.filter((f) => f.priority === 'critical');
  const fullManifest = sorted;
  const pairs = bankingPairs(sorted, timeline.earthReturnWindow.pendingSampleFlights);

  // Parts looked up from the inventory file (computed, cited).
  const upperBearing = model.inventory?.find(
    (p) => /bearing/i.test(p.description) && p.quantityMarsDepot === 0,
  );
  const dustSeal = findPart(model.inventory, /dust seal/i);
  const cartridge = findPart(model.inventory, /lubricant cartridge/i);

  const resupplySol = upperBearing?.nextResupplySol ?? facts.effectiveDeadlineSol.value;
  const delayPerSol = facts.delayCostPerSolUsd.value;

  const contexts: ActionContext[] = [];

  for (const id of Object.keys(risk.actions) as ActionId[]) {
    const meta = risk.actions[id];
    let flights: ScheduledFlight[];
    switch (id) {
      case 'ground_until_resupply':
        flights = [];
        break;
      case 'resume_full_manifest':
        flights = fullManifest;
        break;
      default:
        // fly_critical_only_mitigated & mitigation_service_then_reassess
        flights = criticalFlights;
        break;
    }
    const flownIds = flights.map((f) => f.flightId);

    let delaySols: CitedValue;
    const costs: CostBreakdown = {
      delayCostUsd: 0,
      partsCostUsd: 0,
      serviceCostUsd: 0,
      verificationCostUsd: 0,
      logisticsCostUsd: 0,
      citations: [],
    };
    let samplesForcedZero = false;
    let summary = meta.summary;

    if (id === 'ground_until_resupply') {
      const delay = resupplySol - facts.currentSol + REPAIR_AND_VERIFY_SOLS;
      delaySols = {
        value: delay,
        citation:
          `${inventoryFile} ${upperBearing?.partNumber ?? 'bearing part'} next_resupply_sol (${resupplySol}) − ` +
          `current sol (${facts.currentSol}) + ${REPAIR_AND_VERIFY_SOLS} sols (${REPAIR_AND_VERIFY_CITATION})`,
        asserted: false,
      };
      costs.partsCostUsd = (upperBearing?.unitCostUsd ?? 0) + (dustSeal?.unitCostUsd ?? 0);
      costs.citations.push(
        `parts: ${upperBearing?.partNumber ?? 'upper bearing'} ${usd(upperBearing?.unitCostUsd ?? 0)} + ` +
          `${dustSeal?.partNumber ?? 'dust seal kit'} ${usd(dustSeal?.unitCostUsd ?? 0)} (${inventoryFile})`,
      );
      costs.logisticsCostUsd = LOGISTICS_FEE_USD;
      costs.citations.push(`logistics: ${usd(LOGISTICS_FEE_USD)} (${LOGISTICS_FEE_CITATION})`);
      costs.verificationCostUsd = VERIFICATION_CAMPAIGN_USD;
      costs.citations.push(
        `verification: ${usd(VERIFICATION_CAMPAIGN_USD)} (${VERIFICATION_CAMPAIGN_CITATION})`,
      );

      // Samples would be banked only after repair completes — past the deadline → 0.
      const repairCompleteSol = resupplySol + REPAIR_AND_VERIFY_SOLS;
      if (repairCompleteSol > facts.effectiveDeadlineSol.value) {
        samplesForcedZero = true;
        summary +=
          ` Samples retrieved post-window-open deadline (repair completes ≈ Sol ${repairCompleteSol} > ` +
          `effective deadline Sol ${facts.effectiveDeadlineSol.value}); batch-3 shortfall ` +
          `${timeline.earthReturnWindow.samplesPendingRetrieval}.`;
      }
    } else {
      delaySols = {
        value: meta.prepDelaySols,
        citation: `config/risk_defaults.yaml actions.${id}.prep_delay_sols`,
        asserted: true,
      };
      if (id === 'fly_critical_only_mitigated' || id === 'mitigation_service_then_reassess') {
        costs.serviceCostUsd = cartridge?.unitCostUsd ?? 0;
        costs.citations.push(
          `service: one ${cartridge?.partNumber ?? 'lubricant cartridge'} ` +
            `${usd(cartridge?.unitCostUsd ?? 0)} (${inventoryFile})`,
        );
      }
      if (id === 'mitigation_service_then_reassess') {
        for (const diagId of REASSESS_DIAGNOSTIC_IDS) {
          const diag = diagnosticsCatalog.diagnostics.find((d) => d.id === diagId);
          if (diag?.estimatedCostUsd) {
            costs.verificationCostUsd += diag.estimatedCostUsd;
            costs.citations.push(
              `diagnostics: ${diag.name} ${usd(diag.estimatedCostUsd)} (config/diagnostics.yaml ${diag.id}.estimated_cost_usd)`,
            );
          }
        }
      }
    }

    costs.delayCostUsd = delaySols.value * delayPerSol;
    costs.citations.unshift(
      `delay: ${delaySols.value} sols × ${usd(delayPerSol)}/sol (${facts.delayCostPerSolUsd.citation})`,
    );
    const directCostUsd =
      costs.delayCostUsd +
      costs.partsCostUsd +
      costs.serviceCostUsd +
      costs.verificationCostUsd +
      costs.logisticsCostUsd;

    // Surface the cited cost breakdown on the action summary (the type has no
    // dedicated cost-breakdown field; citations must still be visible in the UI).
    summary += ` Cost basis — ${costs.citations.join('; ')}.`;

    contexts.push({
      id,
      name: meta.name,
      summary,
      lovProfile: meta.lovProfile,
      flightsFlown: flownIds,
      bankingFlightIds: bankingFlightsFor(flownIds, pairs),
      delaySols,
      costs,
      directCostUsd,
      mitigations: [...meta.mitigations],
      samplesForcedZero,
    });
  }
  return contexts;
}

// ---------------------------------------------------------------------------
// Per-hypothesis outcomes & aggregation
// ---------------------------------------------------------------------------

interface PosteriorEntry {
  hypothesisId: string;
  posterior: number;
}

function lovEntryFor(risk: RiskDefaults, hypothesisId: string, profile: string) {
  return (
    risk.lovPerFlight[hypothesisId]?.[profile] ?? {
      perFlight: risk.nominalPerFlightLov.value,
      citation: `${risk.nominalPerFlightLov.citation} (fallback: no LOV row for ${hypothesisId}/${profile})`,
    }
  );
}

function outcomeFor(
  ctx: ActionContext,
  risk: RiskDefaults,
  pending: number,
  hypothesisId: string,
  posterior: number,
): ActionOutcomeForHypothesis {
  const p = lovEntryFor(risk, hypothesisId, ctx.lovProfile).perFlight;
  let lov: number;
  let samples: number;
  if (ctx.flightsFlown.length === 0) {
    // Grounded: single dormancy term (documented simplification, per contract).
    lov = p;
    samples = ctx.samplesForcedZero ? 0 : pending;
  } else {
    lov = 1 - Math.pow(1 - p, ctx.flightsFlown.length);
    samples = expectedSamplesSequential(ctx.flightsFlown, ctx.bankingFlightIds, p);
  }
  const shortfall = pending - samples;
  const riskAdjusted =
    ctx.directCostUsd +
    lov * risk.vehicleLossPenaltyUsd.value +
    shortfall * risk.sampleShortfallPenaltyUsd.value;
  return {
    hypothesisId,
    posterior,
    lovProbability: lov,
    expectedSamples: samples,
    directCostUsd: ctx.directCostUsd,
    riskAdjustedCostUsd: riskAdjusted,
  };
}

/** Posterior-expected risk-adjusted cost for an action under an arbitrary posterior vector. */
function expectedCost(
  ctx: ActionContext,
  risk: RiskDefaults,
  pending: number,
  posteriors: PosteriorEntry[],
): number {
  let ec = 0;
  for (const { hypothesisId, posterior } of posteriors) {
    ec += posterior * outcomeFor(ctx, risk, pending, hypothesisId, posterior).riskAdjustedCostUsd;
  }
  return ec;
}

function budgetViolationsFor(ctx: ActionContext, model: MissionModel): string[] {
  const budget = model.budget;
  if (!budget || budget.length === 0) return [];
  const budgetFile = sourceFileName(model, 'budget', 'budget_contingency.csv');
  const line = (category: string) => budget.find((b) => b.category === category);
  const violations: string[] = [];

  const spareParts = line('spare_parts');
  if (spareParts && ctx.costs.partsCostUsd > spareParts.remainingUsd) {
    violations.push(
      `spare_parts: parts ${usd(ctx.costs.partsCostUsd)} exceeds remaining ` +
        `${usd(spareParts.remainingUsd)} (${budgetFile})`,
    );
  }

  const ops = line('mission_operations');
  const reserve = line('schedule_reserve');
  if (ops || reserve) {
    const combined = (ops?.remainingUsd ?? 0) + (reserve?.remainingUsd ?? 0);
    if (ctx.costs.delayCostUsd > combined) {
      violations.push(
        `mission_operations + schedule_reserve: delay cost ${usd(ctx.costs.delayCostUsd)} exceeds ` +
          `combined remaining ${usd(combined)} (${budgetFile} mission_operations + schedule_reserve)`,
      );
    }
  }

  const verification = line('testing_verification');
  if (verification && ctx.costs.verificationCostUsd > verification.remainingUsd) {
    violations.push(
      `testing_verification: verification ${usd(ctx.costs.verificationCostUsd)} exceeds remaining ` +
        `${usd(verification.remainingUsd)} (${budgetFile})`,
    );
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Sensitivity notes (both computed)
// ---------------------------------------------------------------------------

/** Rescale the posterior vector so `targetId` has posterior b, others proportional. */
function rescaledPosteriors(
  posteriors: PosteriorEntry[],
  targetId: string,
  b: number,
): PosteriorEntry[] {
  const base = posteriors.find((p) => p.hypothesisId === targetId)?.posterior ?? 0;
  const scale = base < 1 ? (1 - b) / (1 - base) : 0;
  return posteriors.map((p) => ({
    hypothesisId: p.hypothesisId,
    posterior: p.hypothesisId === targetId ? b : p.posterior * scale,
  }));
}

function flipPointNote(
  top: ActionContext,
  second: ActionContext,
  risk: RiskDefaults,
  pending: number,
  posteriors: PosteriorEntry[],
): string {
  const targetId = posteriors.some((p) => p.hypothesisId === 'bearing_degradation')
    ? 'bearing_degradation'
    : [...posteriors].sort((a, b) => b.posterior - a.posterior)[0].hypothesisId;
  const basePosterior = posteriors.find((p) => p.hypothesisId === targetId)?.posterior ?? 0;

  const flipped: number[] = [];
  for (let b = 0.1; b <= 0.9 + 1e-9; b += 0.05) {
    const grid = Math.round(b * 100) / 100;
    const rescaled = rescaledPosteriors(posteriors, targetId, grid);
    const ecTop = expectedCost(top, risk, pending, rescaled);
    const ecSecond = expectedCost(second, risk, pending, rescaled);
    if (ecTop > ecSecond) flipped.push(grid);
  }
  if (flipped.length === 0) {
    return (
      `No flip between "${top.name}" and "${second.name}" for ${targetId} posterior in ` +
      `[0.10, 0.90] (0.05 grid) — the recommendation is robust to the ${targetId} posterior.`
    );
  }
  const nearest = flipped.reduce((best, g) =>
    Math.abs(g - basePosterior) < Math.abs(best - basePosterior) ? g : best,
  );
  return (
    `Recommendation flips: "${second.name}" overtakes "${top.name}" at ${targetId} ` +
    `posterior ≈ ${nearest.toFixed(2)} (nearest 0.05 grid point; current ${basePosterior.toFixed(2)}).`
  );
}

function penaltyCrossoverNote(
  evaluated: { ctx: ActionContext; lov: number; shortfall: number }[],
  risk: RiskDefaults,
): string {
  const grounded = evaluated.find((e) => e.ctx.flightsFlown.length === 0);
  const flying = evaluated.filter((e) => e.ctx.flightsFlown.length > 0);
  if (!grounded || flying.length === 0) {
    return 'Penalty crossover for grounding not computable (no grounded/flying action pair).';
  }
  const V = risk.vehicleLossPenaltyUsd.value;
  const S = risk.sampleShortfallPenaltyUsd.value;
  const cost = (e: { ctx: ActionContext; lov: number; shortfall: number }, v: number) =>
    e.ctx.directCostUsd + e.lov * v + e.shortfall * S;
  const best = flying.reduce((a, b) => (cost(a, V) <= cost(b, V) ? a : b));

  // EC(ground) = EC(best flying), linear in the vehicle-loss penalty v:
  //   direct_g + lov_g·v + short_g·S = direct_f + lov_f·v + short_f·S
  const den = grounded.lov - best.lov;
  const num =
    best.ctx.directCostUsd +
    best.shortfall * S -
    (grounded.ctx.directCostUsd + grounded.shortfall * S);
  const crossover = den !== 0 ? num / den : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(crossover) || crossover <= 0 || crossover > 10 * V) {
    return (
      `Grounding ("${grounded.ctx.name}") never becomes competitive with "${best.ctx.name}" ` +
      `for any vehicle-loss penalty within 10× the asserted ${usd(V)}` +
      (Number.isFinite(crossover) && crossover > 0
        ? ` (crossover ≈ ${usd(crossover)}, ${(crossover / V).toFixed(1)}× asserted).`
        : '.')
    );
  }
  return (
    `Grounding ("${grounded.ctx.name}") becomes competitive with "${best.ctx.name}" only if the ` +
    `vehicle-loss penalty exceeds ≈ ${usd(crossover)} (${(crossover / V).toFixed(1)}× the asserted ${usd(V)}).`
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runDecision(
  bayes: BayesResult,
  model: MissionModel,
  risk: RiskDefaults,
): DecisionAnalysis {
  if (!model.timeline) {
    throw new Error('runDecision requires the mission timeline (delay-cost math & window pressure)');
  }
  const facts = computeScheduleFacts(model);
  const pending = facts.timeline.earthReturnWindow.samplesPendingRetrieval;
  const posteriors: PosteriorEntry[] = bayes.posteriors.map((p) => ({
    hypothesisId: p.hypothesisId,
    posterior: p.posterior,
  }));

  const contexts = buildActionContexts(model, risk, facts);

  const evaluated = contexts.map((ctx) => {
    const perHypothesis = posteriors.map(({ hypothesisId, posterior }) =>
      outcomeFor(ctx, risk, pending, hypothesisId, posterior),
    );
    const lov = perHypothesis.reduce((s, o) => s + o.posterior * o.lovProbability, 0);
    const samples = perHypothesis.reduce((s, o) => s + o.posterior * o.expectedSamples, 0);
    const ec = perHypothesis.reduce((s, o) => s + o.posterior * o.riskAdjustedCostUsd, 0);
    return { ctx, perHypothesis, lov, samples, shortfall: pending - samples, ec };
  });

  const sorted = [...evaluated].sort((a, b) => a.ec - b.ec);

  const actions: ActionEvaluation[] = sorted.map((e) => ({
    actionId: e.ctx.id,
    name: e.ctx.name,
    summary: e.ctx.summary,
    flightsFlown: e.ctx.flightsFlown,
    delaySols: e.ctx.delaySols,
    directCostUsd: e.ctx.directCostUsd,
    lovProbability: e.lov,
    expectedSamples: e.samples,
    marginConsumedSols: e.ctx.delaySols.value,
    expectedRiskAdjustedCostUsd: e.ec,
    perHypothesis: e.perHypothesis,
    budgetViolations: budgetViolationsFor(e.ctx, model),
    mitigations: e.ctx.mitigations,
  }));

  // Asserted inputs surfaced for the UI: LOV rows actually used + penalties + nominal.
  const assertedInputs: DecisionAnalysis['assertedInputs'] = [
    {
      label: 'Vehicle-loss penalty',
      value: usd(risk.vehicleLossPenaltyUsd.value),
      citation: risk.vehicleLossPenaltyUsd.citation,
    },
    {
      label: 'Sample-shortfall penalty (per batch-3 sample)',
      value: usd(risk.sampleShortfallPenaltyUsd.value),
      citation: risk.sampleShortfallPenaltyUsd.citation,
    },
    {
      label: 'Nominal per-flight LOV (healthy vehicle)',
      value: risk.nominalPerFlightLov.value.toString(),
      citation: risk.nominalPerFlightLov.citation,
    },
    {
      label: 'Repair + verification duration after resupply',
      value: `${REPAIR_AND_VERIFY_SOLS} sols`,
      citation: REPAIR_AND_VERIFY_CITATION,
    },
    {
      label: 'Resupply logistics reservation fee',
      value: usd(LOGISTICS_FEE_USD),
      citation: LOGISTICS_FEE_CITATION,
    },
    {
      label: 'Post-repair verification campaign',
      value: usd(VERIFICATION_CAMPAIGN_USD),
      citation: VERIFICATION_CAMPAIGN_CITATION,
    },
  ];
  const profilesUsed = [...new Set(contexts.map((c) => c.lovProfile))];
  for (const { hypothesisId } of posteriors) {
    for (const profile of profilesUsed) {
      const entry = lovEntryFor(risk, hypothesisId, profile);
      assertedInputs.push({
        label: `LOV per flight — ${hypothesisId} × ${profile}`,
        value: entry.perFlight.toString(),
        citation: entry.citation,
      });
    }
  }

  const sensitivityNotes: string[] = [];
  if (sorted.length >= 2) {
    sensitivityNotes.push(flipPointNote(sorted[0].ctx, sorted[1].ctx, risk, pending, posteriors));
  }
  sensitivityNotes.push(
    penaltyCrossoverNote(
      evaluated.map((e) => ({ ctx: e.ctx, lov: e.lov, shortfall: e.shortfall })),
      risk,
    ),
  );

  return {
    actions,
    recommendedActionId: sorted[0].ctx.id,
    schedule: {
      currentSol: facts.currentSol,
      effectiveDeadlineSol: facts.effectiveDeadlineSol,
      marginSols: facts.marginSols,
      delayCostPerSolUsd: facts.delayCostPerSolUsd,
    },
    assertedInputs,
    sensitivityNotes,
  };
}
