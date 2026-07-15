/**
 * Robust JSON extraction from model output + zod validation mirroring
 * DispositionNarrative (src/types/narrative.ts) + id sanitization.
 */
import { z } from 'zod';
import type { DispositionNarrative, NarrativeRequest } from '../../types';

/**
 * Mirrors DispositionNarrative. `distinguishingTest` is deliberately lenient
 * (optional) so proposals lacking one are DROPPED in sanitization rather than
 * failing the whole narrative.
 */
export const dispositionNarrativeSchema = z.object({
  executiveSummary: z.string().min(1),
  hypothesisRationales: z.array(
    z.object({
      hypothesisId: z.string().min(1),
      narrative: z.string().min(1),
      citedEvidence: z.array(z.string()),
    }),
  ),
  aiProposedHypotheses: z
    .array(
      z.object({
        name: z.string().min(1),
        rationale: z.string().min(1),
        distinguishingTest: z.string().optional(),
      }),
    )
    .optional(),
  triageStepRationales: z.array(
    z.object({
      stepId: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
  caveats: z.array(z.string()),
});

export type ParsedNarrative = z.infer<typeof dispositionNarrativeSchema>;

/** Mirrors QaAnswer (src/types/narrative.ts) — the "Ask TRIAGE" answer shape. */
export const qaAnswerSchema = z.object({
  answer: z.string().min(1),
  citedEvidence: z.array(z.string()),
  outsideAnalysis: z.boolean(),
});

export type ParsedQaAnswer = z.infer<typeof qaAnswerSchema>;

/**
 * Drop any cited evidence id that is not in the evidence package, de-dupe, and
 * preserve order — the same id-hygiene rule sanitizeNarrative applies, so a
 * model that invents an EV id never surfaces a dead citation chip.
 */
export function sanitizeCitedEvidence(ids: string[], validIds: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (validIds.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Extract a JSON object from raw model text: strip <think>/<thinking> blocks
 * and markdown fences, then take the substring from the first `{` to the
 * last `}`. Throws on parse failure or when no object is present.
 */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  t = t.replace(/```[a-zA-Z]*/g, '');
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new Error('no JSON object found in model output');
  }
  return JSON.parse(t.slice(first, last + 1)) as unknown;
}

export function formatZodError(error: z.ZodError): string {
  const text = error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return text.slice(0, 800);
}

export interface SanitizedNarrative {
  narrative: DispositionNarrative;
  /** AI proposals dropped for lacking a non-empty distinguishingTest */
  droppedProposals: number;
}

/**
 * Enforce id hygiene without failing the narrative:
 * - citedEvidence ids must exist in req.evidence — invalid ids filtered out;
 * - hypothesisRationales with unknown hypothesisId are dropped;
 * - AI proposals missing a non-empty distinguishingTest are dropped & counted.
 */
export function sanitizeNarrative(
  parsed: ParsedNarrative,
  req: NarrativeRequest,
): SanitizedNarrative {
  const evidenceIds = new Set(req.evidence.items.map((i) => i.id));
  const hypothesisIds = new Set(req.bayes.posteriors.map((p) => p.hypothesisId));

  const hypothesisRationales = parsed.hypothesisRationales
    .filter((r) => hypothesisIds.has(r.hypothesisId))
    .map((r) => ({
      hypothesisId: r.hypothesisId,
      narrative: r.narrative,
      citedEvidence: r.citedEvidence.filter((id) => evidenceIds.has(id)),
    }));

  let droppedProposals = 0;
  let aiProposedHypotheses: DispositionNarrative['aiProposedHypotheses'];
  if (parsed.aiProposedHypotheses !== undefined) {
    aiProposedHypotheses = [];
    for (const p of parsed.aiProposedHypotheses) {
      const test = (p.distinguishingTest ?? '').trim();
      if (test.length === 0) {
        droppedProposals += 1;
        continue;
      }
      aiProposedHypotheses.push({
        name: p.name,
        rationale: p.rationale,
        distinguishingTest: test,
      });
    }
  }

  const narrative: DispositionNarrative = {
    executiveSummary: parsed.executiveSummary,
    hypothesisRationales,
    triageStepRationales: parsed.triageStepRationales,
    caveats: parsed.caveats,
  };
  if (aiProposedHypotheses !== undefined) {
    narrative.aiProposedHypotheses = aiProposedHypotheses;
  }

  return { narrative, droppedProposals };
}
