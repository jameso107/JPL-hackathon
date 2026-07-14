/**
 * STUB — implemented by the llm agent. See docs/CONTRACTS.md §LLM.
 * Vercel serverless function for the same /api/disposition route the Express
 * dev proxy serves locally. Plain Node handler — no express dependency here.
 */
export default async function handler(
  _req: { method?: string; body?: unknown },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
  },
): Promise<void> {
  res.status(503).json({ error: 'proxy not implemented yet' });
}
