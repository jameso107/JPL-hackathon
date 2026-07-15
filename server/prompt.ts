/**
 * System prompts + message assembly for the ChatHPC proxy.
 * Shared by the Express dev proxy (server/index.ts) and the Vercel function
 * (api/disposition.ts) via plain relative imports — keep this dependency-free.
 *
 * Two tasks ride one route, selected by `body.task`:
 *   'disposition' (default) — the one-shot review-board narrative (audience-tuned)
 *   'ask'                    — grounded Q&A over the already-computed analysis
 * Both obey the same hard fence: the model narrates, it never does arithmetic.
 */

// Disposition (narrative) generation params.
export const TEMPERATURE = 0.2;
// Reasoning is enabled on gemma4:31b — the <think> block consumes budget before
// the JSON answer, so keep enough headroom that the answer never truncates.
export const MAX_TOKENS = 4000;

// Ask-the-analysis Q&A params: a little warmer (explanatory prose) and much
// shorter (a single scoped answer, not the whole disposition).
export const QA_TEMPERATURE = 0.3;
export const QA_MAX_TOKENS = 1200;

const NARRATIVE_SCHEMA_INLINE = `{
  "executiveSummary": "string — <= 120 words; use the provided numbers verbatim",
  "hypothesisRationales": [
    {
      "hypothesisId": "string — MUST be a hypothesis id from the payload's hypotheses list",
      "narrative": "string — 1-3 sentences",
      "citedEvidence": ["string — MUST be evidence ids (EV-..) from the payload's evidence list"]
    }
  ],
  "aiProposedHypotheses": [
    {
      "name": "string",
      "rationale": "string",
      "distinguishingTest": "string — REQUIRED: a concrete, falsifiable test that would confirm or refute this proposal"
    }
  ],
  "triageStepRationales": [
    { "stepId": "string — MUST be a step id from the payload's triageSteps list", "rationale": "string" }
  ],
  "caveats": ["string"]
}`;

export const SYSTEM_PROMPT = `You are TRIAGE's flight-anomaly disposition assistant for a planetary rotorcraft (Mars Sample Return Helicopter). A deterministic pipeline has already computed all evidence, posteriors, decision costs, and the triage plan; your only job is to narrate that analysis for the flight-review board.

HARD RULES — violations make your output unusable:
1. NO ARITHMETIC. Never compute, re-derive, extrapolate, or invent numbers. Repeat the provided numbers verbatim.
2. CITE ONLY PROVIDED EVIDENCE IDS. citedEvidence entries must be evidence ids (EV-..) that appear in the payload; never invent ids. Use only hypothesis ids and triage step ids present in the payload.
3. You may propose additional hypotheses ONLY when you also supply a concrete, falsifiable distinguishingTest for each. Proposals without one are discarded.
4. STRICT JSON ONLY. Respond with exactly one JSON object matching this schema — no markdown fences, no <think> blocks, no prose before or after the JSON:
${NARRATIVE_SCHEMA_INLINE}
5. "aiProposedHypotheses" is optional; omit it if you have nothing rigorous to add. Every other field is required.
Keep the executive summary crisp (<= 120 words) and each rationale to 1-3 sentences.`;

const QA_SCHEMA_INLINE = `{
  "answer": "string — your answer, grounded ONLY in the provided analysis. Cite findings inline as [EV-05] using ids from the payload.",
  "citedEvidence": ["string — every evidence id (EV-..) you referenced; MUST appear in the payload"],
  "outsideAnalysis": "boolean — true if the question cannot be answered from the provided analysis"
}`;

export const QA_SYSTEM_PROMPT = `You are TRIAGE's flight-anomaly analysis assistant for a planetary rotorcraft (Mars Sample Return Helicopter). A deterministic pipeline has ALREADY computed the evidence, posteriors, decision costs, sensitivity notes, and triage plan supplied to you as JSON. An engineer is asking questions about that analysis. Answer as a careful, plain-spoken flight-review analyst.

HARD RULES — violations make your output unusable:
1. NO ARITHMETIC. Never compute, re-derive, estimate, or invent a number. Quote the numbers in the payload verbatim; if a number is not in the payload, say it is not in the analysis.
2. GROUND EVERY CLAIM in the provided analysis (evidence, hypotheses, decision actions, schedule, sensitivity notes, triage steps, hypothesis library). Do not use outside knowledge to assert facts about this vehicle or flight.
3. CITE FINDINGS INLINE as [EV-05], using only evidence ids that appear in the payload, and list those same ids in citedEvidence. Never invent an id.
4. WHAT-IF questions ("what if the wind were higher?", "what would flip the recommendation?") are answered QUALITATIVELY and by pointing at the provided sensitivityNotes. NEVER produce a new posterior, probability, or cost — the pipeline owns those numbers.
5. If the question cannot be answered from the analysis, set outsideAnalysis=true, say plainly what the analysis does and does not cover, and point the engineer to the deterministic views instead of speculating.
6. STRICT JSON ONLY. Respond with exactly one JSON object matching this schema — no markdown fences, no <think> blocks, no prose before or after the JSON:
${QA_SCHEMA_INLINE}
Keep the answer concise and readable (<= 180 words). Prefer short paragraphs over lists.`;

export type LlmTask = 'disposition' | 'ask';
export type NarrativeAudience = 'board' | 'engineer';
export type NarrativeFocus = 'executiveSummary';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RetryInfo {
  previousResponse?: unknown;
  zodError?: unknown;
}

export interface QaHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Whole request body accepted by the proxy route (both tasks). */
export interface ProxyRequestBody {
  task?: LlmTask;
  payload?: unknown;
  /** disposition only */
  audience?: NarrativeAudience;
  focus?: NarrativeFocus;
  retry?: RetryInfo;
  /** ask only */
  question?: string;
  history?: QaHistoryTurn[];
}

/** Per-task assembled request: the messages plus the sampling params. */
export interface AssembledRequest {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');

/**
 * Audience tuning for the disposition narrative. Appended to the system prompt.
 * `undefined` ⇒ no clause (byte-identical to the historical prompt), so existing
 * callers and tests are unaffected.
 */
export function audienceClause(audience?: NarrativeAudience): string {
  if (audience === 'board') {
    return (
      '\n\nAUDIENCE — REVIEW BOARD: Write for a program review board and non-specialist decision-makers. ' +
      'Lead with the decision. Use plain language, spell out jargon, and keep the executive summary to <= 100 words. ' +
      'Avoid method names (no "posterior", "log-odds", "tempering"); say "confidence", "evidence", "how sure we are".'
    );
  }
  if (audience === 'engineer') {
    return (
      '\n\nAUDIENCE — ENGINEER: Write for a subsystem engineer. Be precise and method-aware: ' +
      'you may reference posteriors, priors, likelihood ratios, and the specific evidence patterns by name. ' +
      'Prioritise technical specificity and the discriminating evidence over accessibility.'
    );
  }
  return '';
}

/** Section-focus directive: regenerate only one field, leave the rest empty. */
export function focusClause(focus?: NarrativeFocus): string {
  if (focus === 'executiveSummary') {
    return (
      '\n\nFOCUS: Regenerate ONLY the executiveSummary field. Return hypothesisRationales, ' +
      'triageStepRationales, and caveats as empty arrays ([]), and omit aiProposedHypotheses. ' +
      'Do not spend effort on any field other than executiveSummary.'
    );
  }
  return '';
}

/**
 * Disposition messages = [system, user(payload JSON)] plus, on retry, the
 * previous assistant response and a corrective user message echoing the error.
 * `audience`/`focus` tune the system prompt additively (both optional).
 */
export function buildMessages(
  payload: unknown,
  retry?: RetryInfo,
  audience?: NarrativeAudience,
  focus?: NarrativeFocus,
): ChatMessage[] {
  const system = SYSTEM_PROMPT + audienceClause(audience) + focusClause(focus);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) },
  ];
  if (retry !== undefined) {
    messages.push({ role: 'assistant', content: asText(retry.previousResponse) });
    messages.push({
      role: 'user',
      content:
        `Your previous response failed schema validation: ${asText(retry.zodError).slice(0, 800)}. ` +
        `Respond again with ONLY a single valid JSON object matching the schema exactly — ` +
        `no markdown fences, no commentary, no think tags, nothing outside the JSON object.`,
    });
  }
  return messages;
}

/**
 * Q&A messages = [system, user(analysis JSON), ...history, user(question)] plus,
 * on retry, the previous assistant response and a corrective user message.
 */
export function buildQaMessages(
  payload: unknown,
  question: string,
  history: QaHistoryTurn[] = [],
  retry?: RetryInfo,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: QA_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `ANALYSIS PACKAGE (the only source of truth for your answer):\n${JSON.stringify(payload)}`,
    },
  ];
  // Prior conversation turns, oldest first (already capped by the caller).
  for (const turn of history) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: turn.text });
    }
  }
  messages.push({ role: 'user', content: `QUESTION: ${question}` });
  if (retry !== undefined) {
    messages.push({ role: 'assistant', content: asText(retry.previousResponse) });
    messages.push({
      role: 'user',
      content:
        `Your previous response failed schema validation: ${asText(retry.zodError).slice(0, 800)}. ` +
        `Respond again with ONLY a single valid JSON object matching the Q&A schema exactly — ` +
        `no markdown fences, no commentary, no think tags, nothing outside the JSON object.`,
    });
  }
  return messages;
}

/**
 * Task router: assemble messages + sampling params for whichever task the body
 * names. Absent/unknown task ⇒ 'disposition', so an old client never breaks.
 */
export function buildRequest(body: ProxyRequestBody): AssembledRequest {
  if (body.task === 'ask') {
    return {
      messages: buildQaMessages(
        body.payload,
        body.question ?? '',
        body.history ?? [],
        body.retry,
      ),
      temperature: QA_TEMPERATURE,
      maxTokens: QA_MAX_TOKENS,
    };
  }
  return {
    messages: buildMessages(body.payload, body.retry, body.audience, body.focus),
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
  };
}
