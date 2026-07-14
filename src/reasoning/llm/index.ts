/**
 * STUB — implemented by the llm agent. See docs/CONTRACTS.md §LLM.
 *
 * Posts a compact NarrativeRequest to /api/disposition (proxy holds the ChatHPC
 * key). zod-validates the DispositionNarrative response; one retry echoing the
 * zod error; then deterministic fallback narrative. The model never sees raw
 * files and never does arithmetic.
 */
import type { DispositionNarrative, NarrativeRequest, NarrativeResult } from '../../types';

export async function requestNarrative(_req: NarrativeRequest): Promise<NarrativeResult> {
  throw new Error('not implemented: requestNarrative');
}

/** Deterministic template narrative used when the LLM is unavailable/invalid. */
export function buildFallbackNarrative(_req: NarrativeRequest): DispositionNarrative {
  throw new Error('not implemented: buildFallbackNarrative');
}
