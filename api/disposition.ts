/**
 * Vercel serverless function for POST /api/disposition — the ChatHPC proxy
 * (key custody + CORS). Mirrors server/upstream.ts + server/prompt.ts.
 *
 * DELIBERATELY SELF-CONTAINED: no imports at all. This repo is ESM
 * ("type": "module") and cross-directory extensionless TS imports are the
 * canonical cause of FUNCTION_INVOCATION_FAILED cold-start crashes on the
 * Vercel Node builder. Keep this file dependency-free; the Express dev proxy
 * (server/) remains the imported, unit-tested implementation — apply logic
 * changes in BOTH places.
 *
 * Two tasks ride this one route, selected by body.task:
 *   'disposition' (default) — the audience-tuned review-board narrative
 *   'ask'                    — grounded Q&A over the already-computed analysis
 */

const UPSTREAM_TIMEOUT_MS = 120_000;
const ERROR_TRUNCATE_CHARS = 500;
const TEMPERATURE = 0.2;
const MAX_TOKENS = 4000;
const QA_TEMPERATURE = 0.3;
const QA_MAX_TOKENS = 1200;

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

const SYSTEM_PROMPT = `You are TRIAGE's flight-anomaly disposition assistant for a planetary rotorcraft (Mars Sample Return Helicopter). A deterministic pipeline has already computed all evidence, posteriors, decision costs, and the triage plan; your only job is to narrate that analysis for the flight-review board.

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

const QA_SYSTEM_PROMPT = `You are TRIAGE's flight-anomaly analysis assistant for a planetary rotorcraft (Mars Sample Return Helicopter). A deterministic pipeline has ALREADY computed the evidence, posteriors, decision costs, sensitivity notes, and triage plan supplied to you as JSON. An engineer is asking questions about that analysis. Answer as a careful, plain-spoken flight-review analyst.

HARD RULES — violations make your output unusable:
1. NO ARITHMETIC. Never compute, re-derive, estimate, or invent a number. Quote the numbers in the payload verbatim; if a number is not in the payload, say it is not in the analysis.
2. GROUND EVERY CLAIM in the provided analysis (evidence, hypotheses, decision actions, schedule, sensitivity notes, triage steps, hypothesis library). Do not use outside knowledge to assert facts about this vehicle or flight.
3. CITE FINDINGS INLINE as [EV-05], using only evidence ids that appear in the payload, and list those same ids in citedEvidence. Never invent an id.
4. WHAT-IF questions ("what if the wind were higher?", "what would flip the recommendation?") are answered QUALITATIVELY and by pointing at the provided sensitivityNotes. NEVER produce a new posterior, probability, or cost — the pipeline owns those numbers.
5. If the question cannot be answered from the analysis, set outsideAnalysis=true, say plainly what the analysis does and does not cover, and point the engineer to the deterministic views instead of speculating.
6. STRICT JSON ONLY. Respond with exactly one JSON object matching this schema — no markdown fences, no <think> blocks, no prose before or after the JSON:
${QA_SCHEMA_INLINE}
Keep the answer concise and readable (<= 180 words). Prefer short paragraphs over lists.`;

type LlmTask = 'disposition' | 'ask';
type NarrativeAudience = 'board' | 'engineer';
type NarrativeFocus = 'executiveSummary';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface RetryInfo {
  previousResponse?: unknown;
  zodError?: unknown;
}

interface QaHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface ProxyRequestBody {
  task?: LlmTask;
  payload?: unknown;
  audience?: NarrativeAudience;
  focus?: NarrativeFocus;
  retry?: RetryInfo;
  question?: string;
  history?: QaHistoryTurn[];
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');

const truncate = (text: string, max = ERROR_TRUNCATE_CHARS): string =>
  text.length <= max ? text : text.slice(0, max);

/** TLS trust codes that mean "Node doesn't trust this cert's CA" (JPL internal CA). */
const CERT_TRUST_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);

/** fetch() hides the real reason in err.cause; surface its code + message. */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    if (code && CERT_TRUST_CODES.has(code)) {
      return `${err.message}: ${code} — Node does not trust this server's CA (likely the JPL internal CA). Set NODE_EXTRA_CA_CERTS to the CA bundle (e.g. /etc/ssl/cert.pem) and restart.`;
    }
    return `${err.message}: ${code ? `${code} — ` : ''}${cause.message}`;
  }
  return err.message;
}

function audienceClause(audience?: NarrativeAudience): string {
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

function focusClause(focus?: NarrativeFocus): string {
  if (focus === 'executiveSummary') {
    return (
      '\n\nFOCUS: Regenerate ONLY the executiveSummary field. Return hypothesisRationales, ' +
      'triageStepRationales, and caveats as empty arrays ([]), and omit aiProposedHypotheses. ' +
      'Do not spend effort on any field other than executiveSummary.'
    );
  }
  return '';
}

function buildMessages(
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

function buildQaMessages(
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

interface AssembledRequest {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}

function buildRequest(body: ProxyRequestBody): AssembledRequest {
  if (body.task === 'ask') {
    return {
      messages: buildQaMessages(body.payload, body.question ?? '', body.history ?? [], body.retry),
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

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

interface DispositionResponse {
  status: number;
  body: Record<string, unknown>;
}

async function handleDisposition(rawBody: unknown): Promise<DispositionResponse> {
  const baseUrl = process.env.CHATHPC_BASE_URL;
  const apiKey = process.env.CHATHPC_API_KEY;
  const model = process.env.CHATHPC_MODEL;
  if (!baseUrl || !apiKey || !model) {
    return { status: 503, body: { error: 'llm_unconfigured' } };
  }
  // A masked copy-paste (••••) puts non-ASCII chars in the key and the fetch
  // header building then fails with a cryptic ByteString error — say it plainly.
  if (!/^[\x21-\x7e]+$/.test(apiKey.trim())) {
    return {
      status: 503,
      body: {
        error:
          'CHATHPC_API_KEY contains non-ASCII characters (looks like a masked "•••" copy-paste) — re-enter the real key',
      },
    };
  }

  let body: ProxyRequestBody;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody) as ProxyRequestBody;
    } catch {
      return { status: 400, body: { error: 'request body is not valid JSON' } };
    }
  } else if (rawBody !== null && typeof rawBody === 'object') {
    body = rawBody as ProxyRequestBody;
  } else {
    return { status: 400, body: { error: 'missing request body' } };
  }
  if (body.payload === undefined) {
    return { status: 400, body: { error: 'missing `payload`' } };
  }
  if (body.task === 'ask' && (typeof body.question !== 'string' || body.question.trim() === '')) {
    return { status: 400, body: { error: 'missing `question` for task "ask"' } };
  }

  const { messages, temperature, maxTokens } = buildRequest(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    let res: Awaited<ReturnType<typeof fetch>>;
    let text: string;
    try {
      res = await fetch(chatCompletionsUrl(baseUrl.trim()), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model.trim(),
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      // Body read inside the try: an abort during the read must report as a
      // clean timeout, not escape as an uncaught 500.
      text = await res.text();
    } catch (err) {
      const reason = controller.signal.aborted
        ? `upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — the model was still generating (reasoning models are slow)`
        : `upstream request failed: ${describeFetchError(err)}`;
      return { status: 502, body: { error: truncate(reason) } };
    }
    if (!res.ok) {
      return { status: 502, body: { error: truncate(`upstream ${res.status}: ${text}`) } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 502, body: { error: truncate(`upstream returned non-JSON: ${text}`) } };
    }
    const content = (parsed as { choices?: { message?: { content?: unknown } }[] } | null)
      ?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return {
        status: 502,
        body: { error: truncate(`upstream response missing choices[0].message.content: ${text}`) },
      };
    }
    return { status: 200, body: { content } };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Vercel Node handler
// ---------------------------------------------------------------------------

interface NodeLikeRequest {
  method?: string;
  body?: unknown;
}

interface NodeLikeResponse {
  status: (code: number) => { json: (body: unknown) => void };
  setHeader?: (name: string, value: string) => void;
  end?: () => void;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(
  req: NodeLikeRequest,
  res: NodeLikeResponse,
): Promise<void> {
  if (typeof res.setHeader === 'function') {
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(name, value);
    }
  }

  if (req.method === 'OPTIONS') {
    if (typeof res.end === 'function') {
      res.status(204);
      res.end();
    } else {
      res.status(200).json({});
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  try {
    const { status, body } = await handleDisposition(req.body);
    res.status(status).json(body);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
