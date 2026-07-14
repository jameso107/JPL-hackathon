/**
 * Triage module — posterior-weighted diagnostic ordering with decision gates and
 * personnel candidates. See docs/CONTRACTS.md §Triage.
 *
 * Discrimination score per diagnostic d:
 *   Σ over unordered hypothesis pairs (i, j) with DIFFERENT expectedOutcomes labels
 *   (missing hypothesis in the map → label "inconclusive") of posterior_i × posterior_j.
 * The catch-all hypothesis participates.
 */
import type {
  BayesResult,
  DecisionGate,
  DiagnosticSpec,
  DiagnosticsCatalog,
  EngineerRecord,
  HypothesisLibrary,
  MissionModel,
  PersonnelCandidate,
  TriagePlan,
  TriageStep,
} from '../types';
import { parseCuringSols } from '../decision/schedule';

/** Diagnostics scoring at or below this are dropped as noise. */
const MIN_DISCRIMINATION_SCORE = 0.005;
/** Maximum number of triage steps. */
const MAX_STEPS = 6;
/** A hypothesis must carry at least this posterior to appear in a gate's `refutes`. */
const REFUTE_POSTERIOR_MIN = 0.05;
/** Fixed caveat: the bearing-play readings are themselves vibration-derived. */
const SENSOR_INFERENCE_CAVEAT =
  'MA-008/MA-010 bearing-play values are inferred from vibration data — sensor_artifact ' +
  'would contaminate them; sensor_cross_check de-risks this.';

const INCONCLUSIVE = 'inconclusive';

interface SeparatedPair {
  a: string;
  b: string;
  product: number;
}

interface ScoredDiagnostic {
  diagnostic: DiagnosticSpec;
  score: number;
  separatedPairs: SeparatedPair[];
}

function labelFor(diagnostic: DiagnosticSpec, hypothesisId: string): string {
  return diagnostic.expectedOutcomes[hypothesisId] ?? INCONCLUSIVE;
}

function scoreDiagnostic(
  diagnostic: DiagnosticSpec,
  posteriors: { id: string; p: number }[],
): ScoredDiagnostic {
  let score = 0;
  const separatedPairs: SeparatedPair[] = [];
  for (let i = 0; i < posteriors.length; i++) {
    for (let j = i + 1; j < posteriors.length; j++) {
      if (labelFor(diagnostic, posteriors[i].id) !== labelFor(diagnostic, posteriors[j].id)) {
        const product = posteriors[i].p * posteriors[j].p;
        score += product;
        separatedPairs.push({ a: posteriors[i].id, b: posteriors[j].id, product });
      }
    }
  }
  separatedPairs.sort((x, y) => y.product - x.product);
  return { diagnostic, score, separatedPairs };
}

function buildGates(
  diagnostic: DiagnosticSpec,
  posteriorOf: Map<string, number>,
): DecisionGate[] {
  // Distinct outcome labels in first-appearance order.
  const labels: string[] = [];
  for (const label of Object.values(diagnostic.expectedOutcomes)) {
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.map((label) => {
    const supports =
      label === INCONCLUSIVE
        ? [] // an inconclusive outcome supports nothing (catch-all excluded by rule)
        : Object.entries(diagnostic.expectedOutcomes)
            .filter(([, l]) => l === label)
            .map(([hyp]) => hyp);
    const refutes = Object.entries(diagnostic.expectedOutcomes)
      .filter(([hyp, l]) => l !== label && (posteriorOf.get(hyp) ?? 0) >= REFUTE_POSTERIOR_MIN)
      .map(([hyp]) => hyp);
    return {
      outcome: label,
      supports,
      refutes,
      nextAction: diagnostic.gateActions[label] ?? 'No gate action defined',
    };
  });
}

// ---------------------------------------------------------------------------
// Personnel candidate scoring
// ---------------------------------------------------------------------------

function certInfo(certifications: string[]): { bonus: number; level: string | null } {
  if (certifications.some((c) => /level a/i.test(c))) return { bonus: 1, level: 'Level A' };
  if (certifications.some((c) => /level b/i.test(c))) return { bonus: 0.5, level: 'Level B' };
  return { bonus: 0, level: null };
}

function availabilityWeight(availability: string): number {
  const s = availability.trim().toLowerCase();
  if (s === 'available') return 1;
  if (s.includes('partial')) return 0.5;
  if (s.includes('limited')) return 0.25;
  if (s.includes('24hr')) return 0.75;
  if (/after sol\s*\d+/i.test(s)) return 0.5;
  return 0.25;
}

/**
 * Candidate score: (2 × |expertise ∩ requiredExpertise| + certBonus) × availabilityWeight.
 * Expertise matching is exact tag equality, case-insensitive (the catalog lists tag
 * variants like vibration_analysis AND vibration_testing explicitly where needed).
 *
 * NOTE: the contract prose writes the availability term additively, but its golden
 * ranking (Chen & Rodriguez above Johansson for ground_spin_spectrum) only holds when
 * availability scales the score, so availabilityWeight is applied multiplicatively.
 */
function rankCandidates(
  team: EngineerRecord[],
  requiredExpertise: string[],
): PersonnelCandidate[] {
  const required = new Set(requiredExpertise.map((t) => t.toLowerCase()));
  const candidates = team
    .map((engineer) => {
      const matched = engineer.expertise.filter((tag) => required.has(tag.toLowerCase()));
      const { bonus, level } = certInfo(engineer.certifications);
      const weight = availabilityWeight(engineer.availability);
      const score = (2 * matched.length + bonus) * weight;
      const segments = [matched.join(' + ')];
      if (level) segments.push(level);
      segments.push(engineer.availability);
      return {
        name: engineer.name,
        role: engineer.role,
        score,
        matchRationale: segments.join('; '),
        availability: engineer.availability,
        overlap: matched.length,
      };
    })
    .filter((c) => c.overlap >= 1)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);
  return candidates.map(({ overlap: _overlap, ...candidate }) => candidate);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runTriage(
  bayes: BayesResult,
  model: MissionModel,
  catalog: DiagnosticsCatalog,
  library: HypothesisLibrary,
): TriagePlan {
  const posteriors = bayes.posteriors.map((p) => ({ id: p.hypothesisId, p: p.posterior }));
  const posteriorOf = new Map(posteriors.map((p) => [p.id, p.p]));
  const nameOf = (id: string) => library.hypotheses.find((h) => h.id === id)?.name ?? id;
  const leading = posteriors.reduce(
    (best, cur) => (cur.p > best.p ? cur : best),
    posteriors[0] ?? { id: 'unknown_other', p: 0 },
  );

  const scored = catalog.diagnostics
    .map((d) => scoreDiagnostic(d, posteriors))
    .filter((s) => s.score > MIN_DISCRIMINATION_SCORE)
    .sort(
      (a, b) => b.score - a.score || a.diagnostic.durationSols - b.diagnostic.durationSols,
    )
    .slice(0, MAX_STEPS);

  const currentSol = model.timeline?.currentSol ?? model.meta.currentSol ?? 0;
  let cursor = currentSol + 1; // step 1 starts the sol after the current one

  const steps: TriageStep[] = scored.map((s, index) => {
    const d = s.diagnostic;
    const startSol = cursor;
    cursor += d.durationSols;
    const top = s.separatedPairs[0];
    const rationale =
      `Separates ${s.separatedPairs.length} hypothesis pairs` +
      (top ? ` (top: ${nameOf(top.a)} vs ${nameOf(top.b)})` : '') +
      `; expected outcome under leading hypothesis: ${labelFor(d, leading.id)}`;
    return {
      stepId: `TS-${String(index + 1).padStart(2, '0')}`,
      diagnosticId: d.id,
      name: d.name,
      description: d.description,
      rationale,
      durationSols: d.durationSols,
      startSol,
      discriminationScore: s.score,
      separates: s.separatedPairs.slice(0, 5).map((pair) => `${pair.a} vs ${pair.b}`),
      gates: buildGates(d, posteriorOf),
      candidates: model.team ? rankCandidates(model.team, d.requiredExpertise) : [],
      estimatedCostUsd: d.estimatedCostUsd,
    };
  });

  const totalDurationSols = steps.reduce((sum, s) => sum + s.durationSols, 0);
  const completionSol = steps.length > 0 ? cursor : currentSol;

  const notes: string[] = [];
  if (model.timeline) {
    const curing = parseCuringSols(model.timeline.notes);
    const deadline = model.timeline.earthReturnWindow.windowOpenSol - curing;
    const margin = deadline - currentSol;
    notes.push(
      `Plan consumes ${completionSol - currentSol} of the ${margin}-sol effective margin ` +
        `(${totalDurationSols} sols of diagnostics, Sols ${currentSol + 1}–${completionSol}; ` +
        `effective deadline Sol ${deadline} = window open ${model.timeline.earthReturnWindow.windowOpenSol} − ${curing}-sol curing).`,
    );
    if (completionSol > deadline) {
      notes.push(
        `WARNING: plan completion Sol ${completionSol} exceeds the effective deadline Sol ${deadline}.`,
      );
    }
  } else {
    notes.push('Mission timeline unavailable — plan scheduled from an unknown current sol; margin check disabled.');
  }
  notes.push(SENSOR_INFERENCE_CAVEAT);
  if (!model.team) {
    notes.push('No engineering-team data — personnel candidate matching skipped.');
  }

  return { steps, totalDurationSols, completionSol, notes };
}
