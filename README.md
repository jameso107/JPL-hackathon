# TRIAGE — Telemetry Root-cause Inference And Guided Evaluation

A reusable anomaly-disposition tool for planetary flight systems. First test case:
the **Mars Sample Return Helicopter (MSRH) Flight 47 vibration anomaly** (JPL
hackathon, Challenge 2).

When a flight anomaly occurs, TRIAGE ingests the mission's data files and produces,
repeatably:

1. A **decomposition of candidate root causes** with quantified likelihoods
   (Bayesian posteriors over a configurable hypothesis library, priors learned from
   heritage anomaly history).
2. **Cost implications** per root cause — parts, logistics, delay burn, budget impact.
3. A **recommended triage/diagnosis plan** with decision gates and ranked personnel
   candidates (the human picks).
4. A **mission-risk evaluation of alternative action plans** — an explicit
   expected-cost tree over actions × world states (loss-of-vehicle probability,
   expected samples banked, margin consumed).
5. An **LLM-written narrative** (JPL ChatHPC) with evidence citations — and a fully
   deterministic fallback when the model is unavailable.

### Design principles

- **Numbers are computed, never generated.** All statistics, probabilities, and costs
  come from deterministic in-browser code (tested against independently computed
  golden values). The LLM writes narrative only, and may *propose* hypotheses —
  always visibly flagged, never given a computed posterior.
- **Every claim is traceable.** Each evidence item carries provenance (file, rows,
  record IDs); every likelihood has a clickable log-odds waterfall down to source rows.
- **Graceful degradation everywhere.** Missing input files disable features, never the
  app. LLM failure falls back to the deterministic disposition.
- **General by configuration.** Hypothesis libraries, likelihood ratios, risk defaults,
  diagnostics, and schema mappings live in `config/*.yaml`, not code.

## Quick start

```bash
npm install
npm run dev          # SPA only (LLM narrative falls back to deterministic mode)
# — or —
cp .env.example .env # add your ChatHPC key
npm run dev:full     # SPA + local proxy (enables the AI narrative)
```

Open http://localhost:5173 and click **Load MSRH Flight 47 demo case** (the seven
challenge files are bundled), or drag in your own files.

```bash
npm test             # Vitest: analytics/bayes/decision/triage/ingest/llm golden tests
npm run build        # typecheck + production build
```

## The MSRH Flight 47 case

An alert from MSRH: vibration 0.22 g in the final 30 s of Flight 47 — 18 % over the
0.186 g threshold. Auto-grounded; six sample flights scheduled in the next 30 sols;
the Earth-return window won't move. What TRIAGE computes from the seven files:

- A **wear trend**: vibration vs. cumulative rotor hours fits at R² ≈ 0.80
  (+0.0245 g/hr) across 46 flights — and F47 sits **+5σ above even that trend**.
- **Wind doesn't explain it**: a wind/temperature/RPM/duration regression leaves a
  4.8×RMSE residual; Flight 23 flew identical 11.9 m/s winds at 0.148 g.
- **The bearing story lines up**: measured play 0.002 → 0.003 → 0.0035 mm
  (MA-002/008/010) vs. a 0.004 mm limit; heritage records (ANM-003/007/010/013)
  make bearing/lubricant causes the dominant prior.
- **The constraint that bites**: the upper rotor bearing (MSRH-RA-002) is **not at the
  Mars depot** — next resupply Sol 320, exactly when the effective launch-window margin
  (75 sols incl. 60-sol sample curing) runs out.
- The decision module prices the four candidate action plans (ground-until-resupply,
  critical-only with mitigations, full manifest, service-then-reassess) against those
  facts, and the triage planner orders diagnostics by how many hypothesis pairs they
  separate (the ground rotor-spin spectral run goes first).

## Architecture

```
files → ingest (schema-mapping profiles) → MissionModel
      → analytics (trends, control limits, confounder regression,
                   signature matching, constraints)      → Evidence Package
      → bayes (heritage priors + likelihood-ratio config) → posteriors + waterfalls
      → decision (actions × world-states expected cost)   → ranked action plans
      → triage (discrimination-ordered diagnostics)       → gated plan + personnel
      → llm (ChatHPC via key-holding proxy)               → cited narrative (or fallback)
```

- **SPA:** Vite + React 18 + TypeScript strict, zustand, Recharts, Tailwind, zod.
- **Proxy:** `server/` (Express, local dev) and `api/` (Vercel serverless) — both do
  exactly two jobs: hold the ChatHPC key and solve CORS. The browser never sees the key.
- **Config:** `config/hypotheses.vibration.yaml` (hypotheses + likelihood ratios with
  citations), `config/risk_defaults.yaml` (cited LOV assertions + action catalog),
  `config/diagnostics.yaml` (tests, expected outcomes per hypothesis, decision gates),
  `config/schema_mappings/` (file → canonical-role mapping profiles).
- **Contracts & goldens:** `docs/CONTRACTS.md` — module formulas and independently
  computed golden numbers the test suite pins.

## Deployment (Vercel)

The repo deploys as a static Vite build plus one serverless function
(`api/disposition.ts`). Set these Environment Variables in the Vercel project:

| Variable | Value |
|---|---|
| `CHATHPC_BASE_URL` | `https://chathpc.jpl.nasa.gov/api` |
| `CHATHPC_MODEL` | `gemma4:31b-128k` |
| `CHATHPC_API_KEY` | *(your key — never commit it)* |

Without them the app still works end-to-end in deterministic mode.
Note: ChatHPC is reachable only from networks it allows; off-network deployments
run in deterministic mode by design.

## Data

The seven challenge files live at the repo root (source of truth) and are bundled
as the demo case from `examples/msrh/`. Telemetry is the only *required* file —
every other file adds capability per the degradation matrix in `docs/CONTRACTS.md`.

## Roadmap

- **Phase 1 (this build):** ingest → analytics → Bayesian disposition → decision &
  triage → ChatHPC narrative, four dashboard tabs, golden-number test suite.
- **Phase 2:** 3D Flight Deck (three.js) — fleet history colored by vibration,
  labeled flight replay with scrubber, spot-the-anomaly mode, Jezero DEM terrain.
- **Phase 3:** Review-board packet export; LLM-assisted schema mapping for
  unfamiliar files.
