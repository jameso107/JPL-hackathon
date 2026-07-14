/**
 * LLM narrative adapter — see docs/CONTRACTS.md §LLM.
 *
 * Posts a compact NarrativeRequest to /api/disposition (the proxy holds the
 * ChatHPC key; the browser never sees the key or upstream URL). zod-validates
 * the DispositionNarrative response; one corrective retry echoing the zod
 * error; then deterministic fallback narrative. The model never sees raw
 * files and never does arithmetic.
 */
import type { DispositionNarrative, NarrativeRequest, NarrativeResult } from '../../types';
import { buildFallbackNarrative } from './fallback';
import { buildCompactPayload } from './payload';
import {
  dispositionNarrativeSchema,
  extractJson,
  formatZodError,
  sanitizeNarrative,
} from './schema';

export { buildFallbackNarrative };

/** Client-side timeout on each proxy round-trip. */
export const CLIENT_TIMEOUT_MS = 15_000;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** POST to the dev/serverless proxy; returns the raw model text. Throws on any transport problem. */
async function postDisposition(body: unknown): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch('/api/disposition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`proxy request timed out after ${CLIENT_TIMEOUT_MS / 1000}s`);
      }
      throw new Error(`proxy request failed: ${messageOf(err)}`);
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* body unavailable — status alone is enough */
      }
      throw new Error(`proxy returned ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`proxy returned non-JSON body: ${messageOf(err)}`);
    }
    const content = (data as { content?: unknown } | null)?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('proxy response missing string `content`');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

type ParseOutcome =
  | { ok: true; narrative: DispositionNarrative; droppedProposals: number }
  | { ok: false; error: string };

function parseModelContent(content: string, req: NarrativeRequest): ParseOutcome {
  let raw: unknown;
  try {
    raw = extractJson(content);
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
  const parsed = dispositionNarrativeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const { narrative, droppedProposals } = sanitizeNarrative(parsed.data, req);
  return { ok: true, narrative, droppedProposals };
}

function fallbackResult(req: NarrativeRequest, error: string): NarrativeResult {
  return { status: 'fallback', narrative: buildFallbackNarrative(req), error };
}

export async function requestNarrative(req: NarrativeRequest): Promise<NarrativeResult> {
  const payload = buildCompactPayload(req);

  // Attempt 1. Transport failures (network, non-200, timeout) skip straight to fallback.
  let firstContent: string;
  try {
    firstContent = await postDisposition({ payload });
  } catch (err) {
    return fallbackResult(req, messageOf(err));
  }

  const first = parseModelContent(firstContent, req);
  if (first.ok) {
    return { status: 'llm', narrative: first.narrative, droppedProposals: first.droppedProposals };
  }

  // Attempt 2: one corrective retry echoing the previous response + validation error.
  let secondContent: string;
  try {
    secondContent = await postDisposition({
      payload,
      retry: { previousResponse: firstContent, zodError: first.error },
    });
  } catch (err) {
    return fallbackResult(req, messageOf(err));
  }

  const second = parseModelContent(secondContent, req);
  if (second.ok) {
    return {
      status: 'llm_retry',
      narrative: second.narrative,
      droppedProposals: second.droppedProposals,
    };
  }
  return fallbackResult(req, `model output failed validation after one retry: ${second.error}`);
}
