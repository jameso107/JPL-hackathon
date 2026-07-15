/**
 * "Ask TRIAGE" grounded Q&A adapter — see docs/CONTRACTS.md §LLM.
 *
 * Posts a question + the compact analysis payload to /api/disposition with
 * task:'ask' (the proxy holds the ChatHPC key). zod-validates the answer,
 * sanitizes cited evidence to real EV ids, retries once on a validation
 * failure, then falls back to a deterministic, grounded answer. Like the
 * narrative adapter, the model narrates — it never does arithmetic and never
 * invents an evidence id.
 */
import type { NarrativeRequest, QaTurn } from '../../types';
import { postLlm } from './index';
import { buildCompactPayload } from './payload';
import {
  extractJson,
  formatZodError,
  qaAnswerSchema,
  sanitizeCitedEvidence,
} from './schema';

/** Prior turns handed to the model as context, newest kept — capped for token budget. */
const MAX_HISTORY_TURNS = 8;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const fmtPctInt = (p: number): string => `${Math.round(p * 100)}%`;

/** Compact a stored conversation to the role+text pairs the prompt needs. */
function compactHistory(history: QaTurn[]): { role: 'user' | 'assistant'; text: string }[] {
  return history.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, text: t.text }));
}

/** Union of the model's citedEvidence array and any [EV-..] ids inline in the prose. */
function collectCitedIds(answer: string, cited: string[]): string[] {
  const inline = answer.match(/EV-\d+/g) ?? [];
  return [...cited, ...inline];
}

type QaParse =
  | { ok: true; answer: string; citedEvidence: string[]; outsideAnalysis: boolean }
  | { ok: false; error: string };

function parseQaContent(content: string, validIds: Set<string>): QaParse {
  let raw: unknown;
  try {
    raw = extractJson(content);
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
  const parsed = qaAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  const citedEvidence = sanitizeCitedEvidence(
    collectCitedIds(parsed.data.answer, parsed.data.citedEvidence),
    validIds,
  );
  return {
    ok: true,
    answer: parsed.data.answer.trim(),
    citedEvidence,
    outsideAnalysis: parsed.data.outsideAnalysis,
  };
}

/**
 * Deterministic, grounded answer used when ChatHPC is unreachable or its output
 * is invalid. Every number is copied from the analysis (never computed) and any
 * citation is a real EV id. Points the engineer at the deterministic views.
 */
export function buildFallbackAnswer(req: NarrativeRequest): QaTurn {
  const validIds = new Set(req.evidence.items.map((i) => i.id));
  const top = req.bayes.posteriors[0];
  const rec = req.decision.actions.find((a) => a.actionId === req.decision.recommendedActionId);
  const parts = ["The AI assistant is unavailable right now, so I can't answer in prose."];
  if (top) {
    parts.push(
      `From the computed analysis, the leading cause is ${top.name} (${fmtPctInt(top.posterior)} confidence).`,
    );
  }
  if (rec) {
    parts.push(`The recommended action is "${rec.name}".`);
  }
  parts.push('Open the Analysis view for the full evidence and the Decision view to compare options.');
  const citedEvidence = top ? sanitizeCitedEvidence(top.matchedEvidence, validIds) : [];
  return {
    role: 'assistant',
    text: parts.join(' '),
    citedEvidence,
    outsideAnalysis: false,
    fallback: true,
    status: 'fallback',
  };
}

/**
 * Ask a grounded question about the computed analysis. Never throws: transport
 * or validation failures resolve to a deterministic fallback turn.
 */
export async function askQuestion(
  req: NarrativeRequest,
  question: string,
  history: QaTurn[] = [],
): Promise<QaTurn> {
  const payload = buildCompactPayload(req);
  const validIds = new Set(req.evidence.items.map((i) => i.id));
  const hist = compactHistory(history);

  const fallback = (error: string): QaTurn => ({ ...buildFallbackAnswer(req), error });

  // Attempt 1.
  let firstContent: string;
  try {
    firstContent = await postLlm({ task: 'ask', payload, question, history: hist });
  } catch (err) {
    return fallback(messageOf(err));
  }
  const first = parseQaContent(firstContent, validIds);
  if (first.ok) {
    return {
      role: 'assistant',
      text: first.answer,
      citedEvidence: first.citedEvidence,
      outsideAnalysis: first.outsideAnalysis,
      status: 'llm',
    };
  }

  // Attempt 2: one corrective retry echoing the previous response + validation error.
  let secondContent: string;
  try {
    secondContent = await postLlm({
      task: 'ask',
      payload,
      question,
      history: hist,
      retry: { previousResponse: firstContent, zodError: first.error },
    });
  } catch (err) {
    return fallback(messageOf(err));
  }
  const second = parseQaContent(secondContent, validIds);
  if (second.ok) {
    return {
      role: 'assistant',
      text: second.answer,
      citedEvidence: second.citedEvidence,
      outsideAnalysis: second.outsideAnalysis,
      status: 'llm_retry',
    };
  }
  return fallback(`model output failed validation after one retry: ${second.error}`);
}
