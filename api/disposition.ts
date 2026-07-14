/**
 * Vercel serverless function for the same /api/disposition route the Express
 * dev proxy serves locally. Plain Node handler — no express dependency here;
 * route logic shared with server/upstream.ts via relative import.
 */
import { handleDispositionRequest } from '../server/upstream';

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
    const { status, body } = await handleDispositionRequest(req.body);
    res.status(status).json(body);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
