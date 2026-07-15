/**
 * ChatHPC upstream call + shared route logic for POST /api/disposition.
 * Used by both the Express dev proxy (server/index.ts) and the Vercel
 * serverless function (api/disposition.ts). Dependency-free plain TS.
 */
import { buildMessages, MAX_TOKENS, TEMPERATURE, type RetryInfo } from './prompt';

// A 31B reasoning model emits a <think> block before the JSON, so first-token
// and total latency run well past 30s. Give it real headroom.
export const UPSTREAM_TIMEOUT_MS = 120_000;
export const ERROR_TRUNCATE_CHARS = 500;

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** All three env vars must be present; otherwise the route answers 503 llm_unconfigured. */
export function readUpstreamConfig(
  env: Record<string, string | undefined> = process.env,
): UpstreamConfig | null {
  const baseUrl = env.CHATHPC_BASE_URL;
  const apiKey = env.CHATHPC_API_KEY;
  const model = env.CHATHPC_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

/**
 * `${base}/chat/completions` by plain string concat (trailing slashes trimmed).
 * If the base already ends with /chat/completions, don't double it.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

export function truncate(text: string, max = ERROR_TRUNCATE_CHARS): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** TLS trust codes that mean "Node doesn't trust this cert's CA" (JPL internal CA). */
const CERT_TRUST_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);

/**
 * fetch() failures hide the real reason in err.cause; surface its code+message
 * and, for a CA-trust failure, name the NODE_EXTRA_CA_CERTS remedy directly.
 */
export function describeFetchError(err: unknown): string {
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

export interface DispositionResponse {
  status: number;
  body: Record<string, unknown>;
}

interface DispositionRequestBody {
  payload?: unknown;
  retry?: RetryInfo;
}

/**
 * Full route logic: env check → payload check → upstream chat/completions
 * (OpenAI format, 30s AbortController timeout) → { content } | error status.
 */
export async function handleDispositionRequest(
  rawBody: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<DispositionResponse> {
  const cfg = readUpstreamConfig(env);
  if (cfg === null) {
    return { status: 503, body: { error: 'llm_unconfigured' } };
  }
  // A masked copy-paste (••••) puts non-ASCII chars in the key and the fetch
  // header building then fails with a cryptic ByteString error — say it plainly.
  if (!/^[\x21-\x7e]+$/.test(cfg.apiKey.trim())) {
    return {
      status: 503,
      body: {
        error:
          'CHATHPC_API_KEY contains non-ASCII characters (looks like a masked "•••" copy-paste) — re-enter the real key',
      },
    };
  }

  let body: DispositionRequestBody;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody) as DispositionRequestBody;
    } catch {
      return { status: 400, body: { error: 'request body is not valid JSON' } };
    }
  } else if (rawBody !== null && typeof rawBody === 'object') {
    body = rawBody as DispositionRequestBody;
  } else {
    return { status: 400, body: { error: 'missing request body' } };
  }
  if (body.payload === undefined) {
    return { status: 400, body: { error: 'missing `payload`' } };
  }

  const messages = buildMessages(body.payload, body.retry);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    let res: Awaited<ReturnType<typeof fetch>>;
    let text: string;
    try {
      res = await fetch(chatCompletionsUrl(cfg.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
        }),
        signal: controller.signal,
      });
      // Read the body INSIDE the try: a reasoning model can stream past the
      // timeout, and an abort during the body read must report as a clean
      // timeout — not escape as an uncaught 500 "This operation was aborted".
      text = await res.text();
    } catch (err) {
      const reason = controller.signal.aborted
        ? `upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — the model was still generating (reasoning models are slow); raise UPSTREAM_TIMEOUT_MS if this recurs`
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
