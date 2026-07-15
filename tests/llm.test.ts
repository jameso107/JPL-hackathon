/**
 * §LLM tests — mock fetch via vi.stubGlobal; NO real network calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFallbackNarrative, requestNarrative } from '../src/reasoning/llm';
import { askQuestion, buildFallbackAnswer } from '../src/reasoning/llm/qa';
import { buildCompactPayload } from '../src/reasoning/llm/payload';
import {
  dispositionNarrativeSchema,
  extractJson,
  qaAnswerSchema,
  sanitizeCitedEvidence,
} from '../src/reasoning/llm/schema';
import type {
  BayesResult,
  DecisionAnalysis,
  EvidencePackage,
  HypothesisPosterior,
  NarrativeRequest,
  TriagePlan,
  WaterfallStep,
} from '../src/types';

// ---------------------------------------------------------------------------
// server helpers, loaded at runtime.
// The composite tsconfig.app project only includes src/ + tests/, so a static
// import of server/*.ts would fail `tsc -b` (TS6307). Variable specifiers keep
// tsc out of it; vitest resolves them at runtime through vite-node.
// ---------------------------------------------------------------------------

interface ChatMsg {
  role: string;
  content: string;
}
interface AssembledReq {
  messages: ChatMsg[];
  temperature: number;
  maxTokens: number;
}
interface ProxyBody {
  task?: 'disposition' | 'ask';
  payload?: unknown;
  audience?: 'board' | 'engineer';
  focus?: 'executiveSummary';
  retry?: { previousResponse?: unknown; zodError?: unknown };
  question?: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
}

interface ServerPromptModule {
  SYSTEM_PROMPT: string;
  QA_SYSTEM_PROMPT: string;
  TEMPERATURE: number;
  MAX_TOKENS: number;
  QA_TEMPERATURE: number;
  QA_MAX_TOKENS: number;
  buildMessages(
    payload: unknown,
    retry?: { previousResponse?: unknown; zodError?: unknown },
    audience?: 'board' | 'engineer',
    focus?: 'executiveSummary',
  ): ChatMsg[];
  buildRequest(body: ProxyBody): AssembledReq;
}

interface ServerUpstreamModule {
  chatCompletionsUrl(baseUrl: string): string;
  truncate(text: string, max?: number): string;
  handleDispositionRequest(
    rawBody: unknown,
    env?: Record<string, string | undefined>,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
}

const promptModulePath = '../server/prompt';
const upstreamModulePath = '../server/upstream';
const {
  SYSTEM_PROMPT,
  QA_SYSTEM_PROMPT,
  TEMPERATURE,
  MAX_TOKENS,
  QA_TEMPERATURE,
  QA_MAX_TOKENS,
  buildMessages,
  buildRequest,
} = (await import(promptModulePath)) as ServerPromptModule;
const { chatCompletionsUrl, truncate, handleDispositionRequest } = (await import(
  upstreamModulePath
)) as ServerUpstreamModule;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function posterior(
  id: string,
  name: string,
  prior: number,
  post: number,
  matchedEvidence: string[],
): HypothesisPosterior {
  const lnPrior = Math.log(prior);
  const lnPost = Math.log(post);
  const evidenceSteps: WaterfallStep[] = matchedEvidence.map((evId, i) => ({
    kind: 'evidence',
    evidenceId: evId,
    label: `pattern_${evId}`,
    delta: 0.5 + 0.25 * i,
    cumulative: lnPrior + 0.5 * (i + 1),
  }));
  return {
    hypothesisId: id,
    name,
    prior,
    posterior: post,
    logOddsShift: lnPost - lnPrior,
    waterfall: [
      { kind: 'prior', label: 'prior', delta: lnPrior, cumulative: lnPrior },
      ...evidenceSteps,
      { kind: 'normalization', label: 'normalization', delta: -0.4, cumulative: lnPost },
      { kind: 'posterior', label: 'posterior', delta: 0, cumulative: lnPost },
    ],
    priorContributions: [],
    matchedEvidence,
  };
}

function makeRequest(): NarrativeRequest {
  const evidence: EvidencePackage = {
    anomaly: {
      description: 'Flight 47 vibration exceedance: 0.22 g vs 0.15 g alert threshold',
      category: 'vibration',
      flightRef: 'F47',
    },
    items: [
      {
        id: 'EV-01',
        kind: 'exceedance',
        pattern: 'vibration_exceedance',
        statement: 'F47 vibration 0.22 g is 13.7 robust sigma above the 0.1285 g baseline median',
        value: { z: 13.71, vibration: 0.22 },
        provenance: { file: 'telemetry_flights.csv', rows: [48] },
        weight: 1,
      },
      {
        id: 'EV-02',
        kind: 'trend',
        pattern: 'monotonic_trend_vs_rotor_hours',
        statement: 'Vibration rises monotonically with cumulative rotor hours (R² 0.80)',
        value: { slope: 0.024504, r2: 0.7982 },
        provenance: { file: 'telemetry_flights.csv', rows: [2, 47] },
        weight: 0.7982,
      },
      {
        id: 'EV-08',
        kind: 'maintenance_correlation',
        pattern: 'bearing_play_near_limit',
        statement: 'Latest bearing play 0.0035 mm is 87.5% of the 0.004 mm spec limit',
        value: { ratio: 0.875 },
        provenance: { file: 'maintenance_log.json', recordIds: ['MA-010', 'MA-008'] },
        weight: 0.875,
      },
    ],
    computedAt: '2026-07-14T12:00:00.000Z',
  };

  const bayes: BayesResult = {
    posteriors: [
      posterior('bearing_degradation', 'Upper rotor bearing degradation', 0.36538, 0.72, [
        'EV-01',
        'EV-02',
        'EV-08',
      ]),
      posterior('sensor_artifact', 'Vibration sensor artifact', 0.07308, 0.12, ['EV-01']),
      posterior('dust_contamination', 'Dust contamination of rotor assembly', 0.14615, 0.06, [
        'EV-02',
      ]),
      posterior('unknown_other', 'Unknown / other', 0.05, 0.05, []),
      posterior('software_threshold_artifact', 'Software threshold artifact', 0.07308, 0.03, []),
      posterior('environmental_transient', 'Environmental transient', 0.07308, 0.02, ['EV-02']),
    ],
    priorsMeta: {
      usedRecords: ['ANM-001', 'ANM-003', 'ANM-007', 'ANM-010', 'ANM-013'],
      excludedRecords: ['ANM-015'],
      laplaceAlpha: 1,
      reservedUnknownMass: 0.05,
      uniformFallback: false,
    },
    tempering: 0.7,
  };

  const decision: DecisionAnalysis = {
    actions: [
      {
        actionId: 'fly_critical_only_mitigated',
        name: 'Fly critical flights only (mitigated)',
        summary: 'Lubricant service, then fly the four critical flights under mitigated LOV',
        flightsFlown: ['F48', 'F49', 'F51', 'F52'],
        delaySols: {
          value: 3,
          citation: 'risk_defaults.yaml actions.fly_critical_only_mitigated.prep_delay_sols',
          asserted: true,
        },
        directCostUsd: 856200,
        lovProbability: 0.031,
        expectedSamples: 1.88,
        marginConsumedSols: 3,
        expectedRiskAdjustedCostUsd: 2450000,
        perHypothesis: [],
        budgetViolations: [],
        mitigations: ['lubricant service before next flight'],
      },
      {
        actionId: 'ground_until_resupply',
        name: 'Ground until bearing resupply',
        summary: 'Stand down until the Sol 320 resupply delivers the upper bearing',
        flightsFlown: [],
        delaySols: {
          value: 85,
          citation: 'engineering estimate: robotic replacement + 3-flight verification',
          asserted: true,
        },
        directCostUsd: 24490400,
        lovProbability: 0.002,
        expectedSamples: 0,
        marginConsumedSols: 85,
        expectedRiskAdjustedCostUsd: 29000000,
        perHypothesis: [],
        budgetViolations: ['mission_operations + schedule_reserve'],
        mitigations: [],
      },
    ],
    recommendedActionId: 'fly_critical_only_mitigated',
    schedule: {
      currentSol: 245,
      effectiveDeadlineSol: {
        value: 320,
        citation: 'mission_timeline.json: window_open_sol 380 − 60 sols curing',
        asserted: false,
      },
      marginSols: { value: 75, citation: 'computed: 320 − 245', asserted: false },
      delayCostPerSolUsd: {
        value: 285000,
        citation: 'mission_timeline.json delay_cost_per_sol_usd',
        asserted: false,
      },
    },
    assertedInputs: [],
    sensitivityNotes: ['no flip in [0.1,0.9]'],
  };

  const triage: TriagePlan = {
    steps: [
      {
        stepId: 'TS-01',
        diagnosticId: 'ground_spin_spectrum',
        name: 'Ground spin spectrum test',
        description: 'Low-power ground spin with high-rate accelerometer capture',
        rationale:
          'Separates 6 hypothesis pairs (top: bearing_degradation vs sensor_artifact); expected outcome under leading hypothesis: bearing_sideband_signature',
        durationSols: 2,
        startSol: 246,
        discriminationScore: 0.21,
        separates: ['bearing_degradation vs sensor_artifact'],
        gates: [],
        candidates: [],
        estimatedCostUsd: 15000,
      },
      {
        stepId: 'TS-02',
        diagnosticId: 'lubrication_response_test',
        name: 'Lubrication response test',
        description: 'Apply one lubricant cartridge, re-run spin, compare spectra',
        rationale:
          'Separates 3 hypothesis pairs (top: bearing_degradation vs dust_contamination); expected outcome under leading hypothesis: vibration_reduced',
        durationSols: 3,
        startSol: 248,
        discriminationScore: 0.09,
        separates: ['bearing_degradation vs dust_contamination'],
        gates: [],
        candidates: [],
        estimatedCostUsd: 9000,
      },
    ],
    totalDurationSols: 5,
    completionSol: 250,
    notes: ['plan consumes 5 of 75-sol margin'],
  };

  return { evidence, bayes, decision, triage, vehicle: 'MSRH' };
}

function validNarrative() {
  return {
    executiveSummary:
      'Flight 47 exceeded its vibration limit at 0.22 g. Bearing degradation leads at 72% posterior; the recommended action is the mitigated critical-only flight plan.',
    hypothesisRationales: [
      {
        hypothesisId: 'bearing_degradation',
        narrative: 'Supported by the exceedance (EV-01) and near-limit bearing play (EV-08).',
        citedEvidence: ['EV-01', 'EV-08', 'EV-99'], // EV-99 invalid → filtered
      },
      {
        hypothesisId: 'made_up_hypothesis', // unknown → dropped
        narrative: 'Not a real hypothesis.',
        citedEvidence: ['EV-01'],
      },
    ],
    aiProposedHypotheses: [
      {
        name: 'Rotor mast fastener loosening',
        rationale: 'Progressive vibration is also consistent with fastener back-off.',
        distinguishingTest:
          'Torque-check the mast fasteners during the ground spin; back-off shows torque below spec.',
      },
      {
        name: 'Vague idea',
        rationale: 'Something else could be wrong.',
        distinguishingTest: '  ', // empty → dropped & counted
      },
    ],
    triageStepRationales: [{ stepId: 'TS-01', rationale: 'Run the spin test first.' }],
    caveats: ['Model-generated narrative.'],
  };
}

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function mockResponse({ status = 200, body = {} }: MockResponseInit): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// zod schema
// ---------------------------------------------------------------------------

describe('dispositionNarrativeSchema', () => {
  it('accepts a valid narrative', () => {
    expect(dispositionNarrativeSchema.safeParse(validNarrative()).success).toBe(true);
  });

  it('accepts a narrative without the optional aiProposedHypotheses', () => {
    const n = validNarrative() as Record<string, unknown>;
    delete n.aiProposedHypotheses;
    expect(dispositionNarrativeSchema.safeParse(n).success).toBe(true);
  });

  it('rejects a narrative missing executiveSummary', () => {
    const n = validNarrative() as Record<string, unknown>;
    delete n.executiveSummary;
    expect(dispositionNarrativeSchema.safeParse(n).success).toBe(false);
  });

  it('rejects hypothesis rationales missing citedEvidence', () => {
    const n = validNarrative();
    // @ts-expect-error deliberately malformed
    delete n.hypothesisRationales[0].citedEvidence;
    expect(dispositionNarrativeSchema.safeParse(n).success).toBe(false);
  });

  it('rejects wrong-typed caveats', () => {
    const n = validNarrative() as Record<string, unknown>;
    n.caveats = 'just one string';
    expect(dispositionNarrativeSchema.safeParse(n).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips think tags, fences, and preamble/trailing prose', () => {
    const text = [
      '<think>Let me reason about bearings... {not the answer}</think>',
      'Sure! Here is the disposition narrative you asked for:',
      '```json',
      '{"a": {"b": 2}}',
      '```',
      'Let me know if you need anything else.',
    ].join('\n');
    expect(extractJson(text)).toEqual({ a: { b: 2 } });
  });

  it('handles <thinking> variant and unlabeled fences', () => {
    const text = '<thinking>hmm</thinking>\n```\n{"x":true}\n```';
    expect(extractJson(text)).toEqual({ x: true });
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('I could not produce JSON, sorry.')).toThrow(/no JSON object/i);
  });
});

// ---------------------------------------------------------------------------
// compact payload
// ---------------------------------------------------------------------------

describe('buildCompactPayload', () => {
  const req = makeRequest();
  const payload = buildCompactPayload(req);

  it('omits provenance and raw values from evidence items', () => {
    expect(payload.evidence).toHaveLength(3);
    for (const item of payload.evidence) {
      expect(item).not.toHaveProperty('provenance');
      expect(item).not.toHaveProperty('value');
      expect(item.id).toMatch(/^EV-/);
      expect(item.statement.length).toBeGreaterThan(0);
    }
  });

  it('carries posteriors with top-3 waterfall contributors as text', () => {
    const bearing = payload.hypotheses.find((h) => h.id === 'bearing_degradation');
    expect(bearing).toBeDefined();
    expect(bearing?.posterior).toBeCloseTo(0.72, 6);
    expect(bearing?.topContributors).toHaveLength(3);
    expect(bearing?.topContributors[0]).toMatch(/EV-\d+ .*: [+-]\d+\.\d{3} log-odds/);
  });

  it('carries the decision table, schedule, triage steps, and library names+descriptions', () => {
    expect(payload.decision.recommendedActionId).toBe('fly_critical_only_mitigated');
    expect(payload.decision.schedule).toEqual({
      currentSol: 245,
      effectiveDeadlineSol: 320,
      marginSols: 75,
      delayCostPerSolUsd: 285000,
    });
    expect(payload.decision.actions.map((a) => a.id)).toEqual([
      'fly_critical_only_mitigated',
      'ground_until_resupply',
    ]);
    expect(payload.triageSteps).toEqual([
      { id: 'TS-01', name: 'Ground spin spectrum test', rationale: req.triage.steps[0].rationale },
      { id: 'TS-02', name: 'Lubrication response test', rationale: req.triage.steps[1].rationale },
    ]);
    expect(payload.hypothesisLibrary.length).toBeGreaterThan(0);
    for (const h of payload.hypothesisLibrary) {
      expect(h.name.length).toBeGreaterThan(0);
      expect(h.description.length).toBeGreaterThan(0);
    }
  });

  it('carries sensitivity notes and per-hypothesis matched evidence for grounded Q&A', () => {
    expect(payload.sensitivityNotes).toEqual(req.decision.sensitivityNotes);
    const bearing = payload.hypotheses.find((h) => h.id === 'bearing_degradation');
    expect(bearing?.matchedEvidence).toEqual(['EV-01', 'EV-02', 'EV-08']);
    for (const h of payload.hypotheses) {
      expect(Array.isArray(h.matchedEvidence)).toBe(true);
    }
  });

  it('stays compact (well under the 8K-token target)', () => {
    expect(JSON.stringify(payload).length).toBeLessThan(20000);
  });
});

// ---------------------------------------------------------------------------
// Q&A schema + citation sanitization
// ---------------------------------------------------------------------------

describe('qaAnswerSchema', () => {
  it('accepts a valid answer', () => {
    const ok = qaAnswerSchema.safeParse({
      answer: 'Bearing degradation leads because of the exceedance [EV-01].',
      citedEvidence: ['EV-01'],
      outsideAnalysis: false,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a missing outsideAnalysis flag', () => {
    const bad = qaAnswerSchema.safeParse({ answer: 'x', citedEvidence: [] });
    expect(bad.success).toBe(false);
  });

  it('rejects a non-string answer and a non-array citedEvidence', () => {
    expect(qaAnswerSchema.safeParse({ answer: 42, citedEvidence: [], outsideAnalysis: false }).success).toBe(
      false,
    );
    expect(
      qaAnswerSchema.safeParse({ answer: 'x', citedEvidence: 'EV-01', outsideAnalysis: false }).success,
    ).toBe(false);
  });
});

describe('sanitizeCitedEvidence', () => {
  const valid = new Set(['EV-01', 'EV-02', 'EV-08']);
  it('filters unknown ids and de-dupes preserving order', () => {
    expect(sanitizeCitedEvidence(['EV-08', 'EV-99', 'EV-01', 'EV-08'], valid)).toEqual([
      'EV-08',
      'EV-01',
    ]);
  });
  it('returns empty for all-invalid input', () => {
    expect(sanitizeCitedEvidence(['EV-99', 'nope'], valid)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// task-discriminated request assembly (server prompt)
// ---------------------------------------------------------------------------

describe('buildRequest task discriminator', () => {
  it('assembles the disposition task by default (absent task) with narrative params', () => {
    const r = buildRequest({ payload: { a: 1 } });
    expect(r.temperature).toBe(TEMPERATURE);
    expect(r.maxTokens).toBe(MAX_TOKENS);
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(r.messages[0].content).toContain('NO ARITHMETIC');
    expect(r.messages[1].content).toBe('{"a":1}');
  });

  it('assembles the ask task with the QA prompt, QA params, and the question last', () => {
    const r = buildRequest({
      task: 'ask',
      payload: { a: 1 },
      question: 'why not FOD?',
      history: [
        { role: 'user', text: 'earlier q' },
        { role: 'assistant', text: 'earlier a' },
      ],
    });
    expect(r.temperature).toBe(QA_TEMPERATURE);
    expect(r.maxTokens).toBe(QA_MAX_TOKENS);
    expect(r.messages[0].content).toBe(QA_SYSTEM_PROMPT);
    expect(r.messages[0].content).toMatch(/NO ARITHMETIC/);
    expect(r.messages[0].content).toMatch(/outsideAnalysis/);
    // system, analysis-user, history(user+assistant), question-user
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user']);
    expect(r.messages[r.messages.length - 1].content).toBe('QUESTION: why not FOD?');
  });

  it('tunes the disposition system prompt per audience', () => {
    const board = buildRequest({ task: 'disposition', payload: {}, audience: 'board' });
    const engineer = buildRequest({ task: 'disposition', payload: {}, audience: 'engineer' });
    expect(board.messages[0].content).toMatch(/REVIEW BOARD/);
    expect(engineer.messages[0].content).toMatch(/ENGINEER/);
    // no audience ⇒ byte-identical to the base prompt (backward compatible)
    expect(buildRequest({ payload: {} }).messages[0].content).toBe(SYSTEM_PROMPT);
  });

  it('adds a single-section focus directive when focus is set', () => {
    const focused = buildRequest({ task: 'disposition', payload: {}, focus: 'executiveSummary' });
    expect(focused.messages[0].content).toMatch(/Regenerate ONLY the executiveSummary/);
  });

  it('appends the corrective retry turn for the ask task', () => {
    const r = buildRequest({
      task: 'ask',
      payload: {},
      question: 'q',
      retry: { previousResponse: 'bad', zodError: 'oops' },
    });
    const roles = r.messages.map((m) => m.role);
    expect(roles.slice(-2)).toEqual(['assistant', 'user']);
    expect(r.messages[r.messages.length - 1].content).toMatch(/oops/);
  });
});

// ---------------------------------------------------------------------------
// requestNarrative
// ---------------------------------------------------------------------------

describe('requestNarrative', () => {
  it('accepts a valid first response, filters bad EV ids, drops unknown hypotheses & testless proposals', async () => {
    const content =
      '<think>reasoning...</think>\nHere you go:\n```json\n' +
      JSON.stringify(validNarrative()) +
      '\n```';
    const fetchMock = vi.fn(async () => mockResponse({ body: { content } }));
    vi.stubGlobal('fetch', fetchMock);

    const req = makeRequest();
    const result = await requestNarrative(req);

    expect(result.status).toBe('llm');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: string; signal: AbortSignal },
    ];
    expect(url).toBe('/api/disposition');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(init.body) as { payload?: unknown; retry?: unknown };
    expect(sent.payload).toBeDefined();
    expect(sent.retry).toBeUndefined();
    expect(JSON.stringify(sent.payload)).not.toContain('provenance');

    // unknown hypothesis dropped; invalid EV id filtered
    expect(result.narrative.hypothesisRationales).toHaveLength(1);
    expect(result.narrative.hypothesisRationales[0].hypothesisId).toBe('bearing_degradation');
    expect(result.narrative.hypothesisRationales[0].citedEvidence).toEqual(['EV-01', 'EV-08']);

    // proposal without a distinguishing test dropped & counted
    expect(result.narrative.aiProposedHypotheses).toHaveLength(1);
    expect(result.narrative.aiProposedHypotheses?.[0].name).toBe('Rotor mast fastener loosening');
    expect(result.droppedProposals).toBe(1);
  });

  it('retries once with the previous response + zod error, then succeeds (llm_retry)', async () => {
    const good = JSON.stringify(validNarrative());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ body: { content: 'no json here at all' } }))
      .mockResolvedValueOnce(mockResponse({ body: { content: good } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestNarrative(makeRequest());

    expect(result.status).toBe('llm_retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondInit = fetchMock.mock.calls[1][1] as { body: string };
    const secondBody = JSON.parse(secondInit.body) as {
      payload?: unknown;
      retry?: { previousResponse?: string; zodError?: string };
    };
    expect(secondBody.payload).toBeDefined();
    expect(secondBody.retry?.previousResponse).toBe('no json here at all');
    expect(typeof secondBody.retry?.zodError).toBe('string');
    expect((secondBody.retry?.zodError ?? '').length).toBeGreaterThan(0);
  });

  it('falls back after a failed retry, with a schema-valid narrative and an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ body: { content: 'still not json' } }))
      .mockResolvedValueOnce(
        mockResponse({ body: { content: '{"executiveSummary": 42}' } }), // parses, fails zod
      );
    vi.stubGlobal('fetch', fetchMock);

    const req = makeRequest();
    const result = await requestNarrative(req);

    expect(result.status).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/retry/i);
    expect(dispositionNarrativeSchema.safeParse(result.narrative).success).toBe(true);
  });

  it('falls back immediately on non-200 (e.g. 503 llm_unconfigured) without retrying', async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({ status: 503, body: { error: 'llm_unconfigured' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestNarrative(makeRequest());

    expect(result.status).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toContain('503');
  });

  it('falls back on network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestNarrative(makeRequest());

    expect(result.status).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toContain('fetch failed');
  });
});

// ---------------------------------------------------------------------------
// fallback narrative
// ---------------------------------------------------------------------------

describe('buildFallbackNarrative', () => {
  const req = makeRequest();
  const narrative = buildFallbackNarrative(req);

  it('is schema-valid', () => {
    expect(dispositionNarrativeSchema.safeParse(narrative).success).toBe(true);
  });

  it('mentions the anomaly, top hypothesis (percent, 0 decimals), margin, and recommended action', () => {
    expect(narrative.executiveSummary).toContain('Flight 47 vibration exceedance');
    expect(narrative.executiveSummary).toContain('Upper rotor bearing degradation');
    expect(narrative.executiveSummary).toContain('72%');
    expect(narrative.executiveSummary).toContain('75 sols');
    expect(narrative.executiveSummary).toContain('Fly critical flights only (mitigated)');
  });

  it('covers exactly the hypotheses with posterior >= 3%, citing only real EV ids', () => {
    const ids = narrative.hypothesisRationales.map((r) => r.hypothesisId);
    expect(ids).toEqual([
      'bearing_degradation',
      'sensor_artifact',
      'dust_contamination',
      'unknown_other',
      'software_threshold_artifact',
    ]);
    expect(ids).not.toContain('environmental_transient'); // 2% < 3%

    const realIds = new Set(req.evidence.items.map((i) => i.id));
    for (const r of narrative.hypothesisRationales) {
      for (const evId of r.citedEvidence) {
        expect(realIds.has(evId)).toBe(true);
      }
    }
    const bearing = narrative.hypothesisRationales[0];
    expect(bearing.citedEvidence).toEqual(['EV-01', 'EV-02', 'EV-08']);
    expect(bearing.narrative).toContain('EV-01');
  });

  it('copies the triage plan rationales and includes the fixed caveats + fallback notice', () => {
    expect(narrative.triageStepRationales).toEqual([
      { stepId: 'TS-01', rationale: req.triage.steps[0].rationale },
      { stepId: 'TS-02', rationale: req.triage.steps[1].rationale },
    ]);
    expect(narrative.caveats.length).toBeGreaterThanOrEqual(4);
    expect(narrative.caveats).toContain('AI narrative unavailable — deterministic disposition shown.');
    expect(narrative.caveats.join(' ')).toMatch(/inferred from vibration/i);
    expect(narrative.caveats.join(' ')).toMatch(/LOV/);
  });
});

// ---------------------------------------------------------------------------
// server helpers (prompt + upstream) — pure functions, mocked fetch
// ---------------------------------------------------------------------------

describe('server prompt', () => {
  it('system prompt carries the hard rules and inlined schema', () => {
    expect(SYSTEM_PROMPT).toMatch(/NO ARITHMETIC/i);
    expect(SYSTEM_PROMPT).toMatch(/evidence ids/i);
    expect(SYSTEM_PROMPT).toMatch(/falsifiable/i);
    expect(SYSTEM_PROMPT).toMatch(/STRICT JSON/i);
    expect(SYSTEM_PROMPT).toContain('executiveSummary');
    expect(SYSTEM_PROMPT).toContain('distinguishingTest');
    expect(TEMPERATURE).toBe(0.2);
    expect(MAX_TOKENS).toBe(4000);
  });

  it('buildMessages produces [system, user] and appends the corrective turn on retry', () => {
    const base = buildMessages({ a: 1 });
    expect(base.map((m) => m.role)).toEqual(['system', 'user']);
    expect(base[1].content).toBe('{"a":1}');

    const retried = buildMessages({ a: 1 }, { previousResponse: 'bad output', zodError: 'oops' });
    expect(retried.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(retried[2].content).toBe('bad output');
    expect(retried[3].content).toContain('oops');
    expect(retried[3].content).toMatch(/valid JSON/i);
  });
});

describe('server upstream', () => {
  it('chatCompletionsUrl string-concats without doubling', () => {
    expect(chatCompletionsUrl('https://chathpc.example/v1')).toBe(
      'https://chathpc.example/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://chathpc.example/v1/')).toBe(
      'https://chathpc.example/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://chathpc.example/v1/chat/completions')).toBe(
      'https://chathpc.example/v1/chat/completions',
    );
  });

  it('returns 503 llm_unconfigured when env is missing, without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleDispositionRequest({ payload: { a: 1 } }, {});

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'llm_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when payload is missing', async () => {
    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'k',
      CHATHPC_MODEL: 'm',
    };
    const res = await handleDispositionRequest({}, env);
    expect(res.status).toBe(400);
  });

  it('calls upstream with OpenAI chat format and returns { content }', async () => {
    const upstreamBody = {
      choices: [{ message: { content: '{"hello":"world"}' } }],
    };
    const fetchMock = vi.fn(async () => mockResponse({ body: upstreamBody }));
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'secret-key',
      CHATHPC_MODEL: 'test-model',
    };
    const res = await handleDispositionRequest(
      { payload: { a: 1 }, retry: { previousResponse: 'x', zodError: 'y' } },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: '{"hello":"world"}' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
    ];
    expect(url).toBe('https://chathpc.example/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer secret-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(init.body) as {
      model: string;
      temperature: number;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(sent.model).toBe('test-model');
    expect(sent.temperature).toBe(0.2);
    expect(sent.max_tokens).toBe(4000);
    expect(sent.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('maps upstream errors to 502 with the body truncated to 500 chars', async () => {
    const longError = 'E'.repeat(1000);
    const fetchMock = vi.fn(async () => mockResponse({ status: 500, body: longError }));
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'k',
      CHATHPC_MODEL: 'm',
    };
    const res = await handleDispositionRequest({ payload: {} }, env);

    expect(res.status).toBe(502);
    const err = res.body.error as string;
    expect(err.length).toBeLessThanOrEqual(500);
    expect(err).toContain('upstream 500');
  });

  it('an abort while reading the body returns a clean 502 timeout, never throws', async () => {
    // Reproduces the "This operation was aborted" 500: headers arrive, then the
    // body read is aborted by the upstream timeout. Must be caught → 502.
    const abortErr = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw abortErr;
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'k',
      CHATHPC_MODEL: 'm',
    };
    const res = await handleDispositionRequest({ payload: {} }, env);
    expect(res.status).toBe(502);
    expect(String(res.body.error)).toMatch(/upstream request failed|timed out/i);
  });

  it('rejects a masked (non-ASCII) API key with a clear 503 before calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'sk-3230e••••',
      CHATHPC_MODEL: 'm',
    };
    const res = await handleDispositionRequest({ payload: {} }, env);
    expect(res.status).toBe(503);
    expect(String(res.body.error)).toMatch(/non-ASCII|masked/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncate caps at the requested length', () => {
    expect(truncate('abc', 500)).toBe('abc');
    expect(truncate('x'.repeat(600))).toHaveLength(500);
  });

  it('returns 400 when task="ask" is missing a question, without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'k',
      CHATHPC_MODEL: 'm',
    };
    const res = await handleDispositionRequest({ task: 'ask', payload: { a: 1 } }, env);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/question/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes an ask request to the QA prompt with QA sampling params', async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse({ body: { choices: [{ message: { content: '{"answer":"a","citedEvidence":[],"outsideAnalysis":false}' } }] } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      CHATHPC_BASE_URL: 'https://chathpc.example/v1',
      CHATHPC_API_KEY: 'k',
      CHATHPC_MODEL: 'm',
    };
    const res = await handleDispositionRequest(
      { task: 'ask', payload: { a: 1 }, question: 'why not FOD?' },
      env,
    );
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, { body: string }];
    const sent = JSON.parse(init.body) as {
      temperature: number;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(sent.temperature).toBe(QA_TEMPERATURE);
    expect(sent.max_tokens).toBe(QA_MAX_TOKENS);
    expect(sent.messages[0].content).toBe(QA_SYSTEM_PROMPT);
    expect(sent.messages[sent.messages.length - 1].content).toBe('QUESTION: why not FOD?');
  });
});

// ---------------------------------------------------------------------------
// askQuestion (client) — grounded Q&A over the analysis
// ---------------------------------------------------------------------------

describe('askQuestion', () => {
  function qaContent(answer: string, citedEvidence: string[], outsideAnalysis = false): string {
    return JSON.stringify({ answer, citedEvidence, outsideAnalysis });
  }

  it('accepts a valid first answer and sanitizes cited ids (array + inline union, deduped)', async () => {
    const content = qaContent(
      'Bearing wins because of the exceedance [EV-01] and near-limit play [EV-08].',
      ['EV-01', 'EV-99'], // EV-99 invalid → dropped; EV-08 only inline → collected
    );
    const fetchMock = vi.fn(async () => mockResponse({ body: { content } }));
    vi.stubGlobal('fetch', fetchMock);

    const turn = await askQuestion(makeRequest(), 'why bearing?');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('/api/disposition');
    const sent = JSON.parse(init.body) as { task?: string; question?: string; payload?: unknown };
    expect(sent.task).toBe('ask');
    expect(sent.question).toBe('why bearing?');
    expect(JSON.stringify(sent.payload)).not.toContain('provenance');

    expect(turn.role).toBe('assistant');
    expect(turn.status).toBe('llm');
    expect(turn.fallback).toBeUndefined();
    expect(turn.citedEvidence).toEqual(['EV-01', 'EV-08']);
  });

  it('retries once on invalid output then succeeds (llm_retry)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ body: { content: 'not json' } }))
      .mockResolvedValueOnce(mockResponse({ body: { content: qaContent('ok [EV-02]', ['EV-02']) } }));
    vi.stubGlobal('fetch', fetchMock);

    const turn = await askQuestion(makeRequest(), 'explain');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(turn.status).toBe('llm_retry');
    expect(turn.citedEvidence).toEqual(['EV-02']);
    // the retry echoes the previous response + a zod error
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body) as {
      retry?: { previousResponse?: string };
    };
    expect(secondBody.retry?.previousResponse).toBe('not json');
  });

  it('falls back to a grounded, non-throwing answer on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const turn = await askQuestion(makeRequest(), 'why bearing?');
    expect(turn.fallback).toBe(true);
    expect(turn.status).toBe('fallback');
    expect(turn.error).toContain('fetch failed');
    expect(turn.text).toContain('Upper rotor bearing degradation');
    expect(turn.text).toContain('72%');
    // still cites only real EV ids
    for (const id of turn.citedEvidence ?? []) {
      expect(['EV-01', 'EV-02', 'EV-08']).toContain(id);
    }
  });

  it('falls back immediately on a non-200 proxy response without retrying', async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 503, body: { error: 'llm_unconfigured' } }));
    vi.stubGlobal('fetch', fetchMock);
    const turn = await askQuestion(makeRequest(), 'q');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(turn.fallback).toBe(true);
    expect(String(turn.error)).toContain('503');
  });
});

describe('buildFallbackAnswer', () => {
  it('is grounded, flags fallback, and cites only real EV ids', () => {
    const req = makeRequest();
    const turn = buildFallbackAnswer(req);
    expect(turn.role).toBe('assistant');
    expect(turn.fallback).toBe(true);
    expect(turn.text).toContain('Upper rotor bearing degradation');
    expect(turn.text).toContain('72%');
    const realIds = new Set(req.evidence.items.map((i) => i.id));
    for (const id of turn.citedEvidence ?? []) {
      expect(realIds.has(id)).toBe(true);
    }
  });
});
