/**
 * System prompt + message assembly for the ChatHPC disposition call.
 * Shared by the Express dev proxy (server/index.ts) and the Vercel function
 * (api/disposition.ts) via plain relative imports — keep this dependency-free.
 */

export const TEMPERATURE = 0.2;
export const MAX_TOKENS = 2000;

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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RetryInfo {
  previousResponse?: unknown;
  zodError?: unknown;
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');

/**
 * messages = [system, user(payload JSON)] plus, on retry, the previous
 * assistant response and a corrective user message echoing the validation error.
 */
export function buildMessages(payload: unknown, retry?: RetryInfo): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
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
