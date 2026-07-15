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
 */

const UPSTREAM_TIMEOUT_MS = 30_000;
const ERROR_TRUNCATE_CHARS = 500;
const TEMPERATURE = 0.2;
const MAX_TOKENS = 2000;

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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface RetryInfo {
  previousResponse?: unknown;
  zodError?: unknown;
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');

const truncate = (text: string, max = ERROR_TRUNCATE_CHARS): string =>
  text.length <= max ? text : text.slice(0, max);

function buildMessages(payload: unknown, retry?: RetryInfo): ChatMessage[] {
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

  let body: { payload?: unknown; retry?: RetryInfo };
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody) as { payload?: unknown; retry?: RetryInfo };
    } catch {
      return { status: 400, body: { error: 'request body is not valid JSON' } };
    }
  } else if (rawBody !== null && typeof rawBody === 'object') {
    body = rawBody as { payload?: unknown; retry?: RetryInfo };
  } else {
    return { status: 400, body: { error: 'missing request body' } };
  }
  if (body.payload === undefined) {
    return { status: 400, body: { error: 'missing `payload`' } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(chatCompletionsUrl(baseUrl.trim()), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model.trim(),
          messages: buildMessages(body.payload, body.retry),
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = controller.signal.aborted
        ? `upstream timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s`
        : `upstream request failed: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 502, body: { error: truncate(reason) } };
    }

    const text = await res.text();
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
