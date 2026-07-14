/**
 * Local dev proxy — see docs/CONTRACTS.md §LLM.
 * Holds the ChatHPC key (env via dotenv), solves CORS, 30s upstream timeout.
 * Vite proxies /api → this server (PROXY_PORT, default 8787).
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { handleDispositionRequest, readUpstreamConfig } from './upstream';

const app = express();
app.use(cors()); // permissive CORS — dev tool
app.use(express.json({ limit: '1mb' }));

app.post('/api/disposition', async (req, res) => {
  try {
    const { status, body } = await handleDispositionRequest(req.body);
    res.status(status).json(body);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const port = Number(process.env.PROXY_PORT ?? 8787);
app.listen(port, () => {
  const configured = readUpstreamConfig() !== null;
  console.log(
    `[triage-proxy] listening on :${port} — upstream ${
      configured ? 'configured' : 'NOT configured (will answer 503 llm_unconfigured)'
    }`,
  );
});
