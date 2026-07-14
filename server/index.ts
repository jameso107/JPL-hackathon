/**
 * STUB — implemented by the llm agent. See docs/CONTRACTS.md §LLM.
 * Local dev proxy: holds the ChatHPC key (env), solves CORS. ~40 lines when real.
 */
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/disposition', (_req, res) => {
  res.status(503).json({ error: 'proxy not implemented yet' });
});

const port = Number(process.env.PROXY_PORT ?? 8787);
app.listen(port, () => {
  console.log(`[triage-proxy] stub listening on :${port}`);
});
