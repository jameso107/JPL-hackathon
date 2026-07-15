/**
 * App store — docs/CONTRACTS.md §Store/UI.
 *
 * Single zustand store: MissionModel + derived artifacts, recomputed in one
 * synchronous pass whenever inputs change. Derivation order:
 *   ingestFiles → runAnalytics → runBayes → runDecision → runTriage
 * Each stage is try/caught: a failure nulls that artifact + everything
 * downstream and pushes an error notice (graceful degradation, never a white
 * screen). Decision additionally requires model.timeline; triage tolerates a
 * missing team. Narrative generation is async and user-triggered, guarded on
 * all four artifacts being present.
 */
import { create } from 'zustand';
import { runAnalytics } from '../analytics';
import {
  analyticsConfig,
  bayesConfig,
  diagnosticsCatalog,
  hypothesisLibrary,
  riskDefaults,
} from '../config';
import { runDecision } from '../decision';
import { msrhDemoFiles } from '../demo/msrhDemo';
import { ingestFiles } from '../ingest';
import { runBayes } from '../reasoning/bayes';
import { buildFallbackNarrative, requestNarrative } from '../reasoning/llm';
import { runTriage } from '../triage';
import type {
  BayesResult,
  DatasetRole,
  DecisionAnalysis,
  EvidencePackage,
  IngestNotice,
  MissionModel,
  NarrativeRequest,
  NarrativeResult,
  RawFile,
  TriagePlan,
} from '../types';

export type TabId = 'home' | 'workbench' | 'decision' | 'triage';

export interface AppState {
  // inputs
  model: MissionModel | null;
  notices: IngestNotice[];
  unrecognized: string[];
  /** dataset roles absent from the ingested model → degraded capabilities */
  missingRoles: DatasetRole[];
  // derived artifacts (null until a model with telemetry is loaded)
  evidence: EvidencePackage | null;
  bayes: BayesResult | null;
  decision: DecisionAnalysis | null;
  triage: TriagePlan | null;
  // async narrative
  narrative: NarrativeResult | null;
  narrativeLoading: boolean;
  // ui state
  activeTab: TabId;
  selectedEvidenceId: string | null;
  selectedHypothesisId: string | null;
  /** bumped on every selectEvidence call so the stream re-scrolls even for a re-click */
  evidenceFocusNonce: number;
  // actions
  loadDemo: () => void;
  ingestBrowserFiles: (files: File[]) => Promise<void>;
  generateNarrative: () => Promise<void>;
  setActiveTab: (tab: TabId) => void;
  selectEvidence: (id: string | null) => void;
  selectHypothesis: (id: string | null) => void;
  reset: () => void;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type DerivedSlice = Pick<
  AppState,
  | 'model'
  | 'notices'
  | 'unrecognized'
  | 'missingRoles'
  | 'evidence'
  | 'bayes'
  | 'decision'
  | 'triage'
  | 'narrative'
  | 'narrativeLoading'
  | 'selectedEvidenceId'
  | 'selectedHypothesisId'
>;

const EMPTY_SLICE: DerivedSlice = {
  model: null,
  notices: [],
  unrecognized: [],
  missingRoles: [],
  evidence: null,
  bayes: null,
  decision: null,
  triage: null,
  narrative: null,
  narrativeLoading: false,
  selectedEvidenceId: null,
  selectedHypothesisId: null,
};

/**
 * The full synchronous derivation pipeline. Never throws: every stage failure
 * becomes an error notice and nulls the artifact + downstream artifacts.
 */
function deriveFromFiles(files: RawFile[]): DerivedSlice {
  const notices: IngestNotice[] = [];
  let model: MissionModel | null = null;
  let unrecognized: string[] = [];
  let missingRoles: DatasetRole[] = [];
  let evidence: EvidencePackage | null = null;
  let bayes: BayesResult | null = null;
  let decision: DecisionAnalysis | null = null;
  let triage: TriagePlan | null = null;

  // Stage 0: ingest (contractually never throws — but stay defensive anyway).
  try {
    const result = ingestFiles(files);
    model = result.model;
    unrecognized = result.unrecognized;
    missingRoles = result.missingRoles;
    notices.push(...result.notices);
  } catch (err) {
    notices.push({ level: 'error', message: `ingest failed: ${messageOf(err)}` });
    return { ...EMPTY_SLICE, notices };
  }

  if (model && model.telemetry.length > 0) {
    // Stage 1: analytics.
    try {
      evidence = runAnalytics(model, analyticsConfig);
    } catch (err) {
      evidence = null;
      notices.push({
        level: 'error',
        message: `analytics stage failed: ${messageOf(err)} — evidence, posteriors, decision and triage unavailable`,
      });
    }

    // Stage 2: bayes.
    if (evidence) {
      try {
        bayes = runBayes(evidence, hypothesisLibrary, model, bayesConfig);
      } catch (err) {
        bayes = null;
        notices.push({
          level: 'error',
          message: `bayes stage failed: ${messageOf(err)} — posteriors, decision and triage unavailable`,
        });
      }
    }

    // Stage 3: decision (requires the mission timeline).
    let decisionThrew = false;
    if (bayes) {
      if (!model.timeline) {
        decision = null;
        notices.push({
          level: 'info',
          message:
            'mission timeline missing — delay-cost math & window pressure disabled; decision analysis unavailable',
        });
      } else {
        try {
          decision = runDecision(bayes, model, riskDefaults);
        } catch (err) {
          decision = null;
          decisionThrew = true;
          notices.push({
            level: 'error',
            message: `decision stage failed: ${messageOf(err)} — decision analysis and triage plan unavailable`,
          });
        }
      }
    }

    // Stage 4: triage (team optional; missing timeline degrades but does not block).
    // A decision *failure* nulls downstream per contract; the expected
    // missing-timeline degradation does not.
    if (bayes && !decisionThrew) {
      try {
        triage = runTriage(bayes, model, diagnosticsCatalog, hypothesisLibrary);
      } catch (err) {
        triage = null;
        notices.push({
          level: 'error',
          message: `triage stage failed: ${messageOf(err)} — triage plan unavailable`,
        });
      }
    }
  }

  return {
    model,
    notices,
    unrecognized,
    missingRoles,
    evidence,
    bayes,
    decision,
    triage,
    narrative: null,
    narrativeLoading: false,
    selectedEvidenceId: null,
    selectedHypothesisId: bayes?.posteriors[0]?.hypothesisId ?? null,
  };
}

export const useAppStore = create<AppState>()((set, get) => ({
  ...EMPTY_SLICE,
  activeTab: 'home',
  evidenceFocusNonce: 0,

  loadDemo: () => {
    set(deriveFromFiles(msrhDemoFiles));
  },

  ingestBrowserFiles: async (files: File[]) => {
    const raw: RawFile[] = [];
    const readFailures: IngestNotice[] = [];
    for (const file of files) {
      try {
        raw.push({ name: file.name, text: await file.text() });
      } catch (err) {
        readFailures.push({
          level: 'error',
          message: `could not read file: ${messageOf(err)}`,
          fileName: file.name,
        });
      }
    }
    if (raw.length === 0) {
      set({ notices: [...get().notices, ...readFailures] });
      return;
    }
    const derived = deriveFromFiles(raw);
    set({ ...derived, notices: [...readFailures, ...derived.notices] });
  },

  generateNarrative: async () => {
    const { evidence, bayes, decision, triage, model, narrativeLoading } = get();
    if (narrativeLoading) return;
    if (!evidence || !bayes || !decision || !triage) return;
    const req: NarrativeRequest = {
      evidence,
      bayes,
      decision,
      triage,
      vehicle: model?.meta.vehicle ?? 'MSRH',
    };
    set({ narrativeLoading: true });
    let result: NarrativeResult;
    try {
      result = await requestNarrative(req);
    } catch (err) {
      // requestNarrative is contractually non-throwing; belt and braces.
      result = {
        status: 'fallback',
        narrative: buildFallbackNarrative(req),
        error: messageOf(err),
      };
    }
    set({ narrative: result, narrativeLoading: false });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  selectEvidence: (id) =>
    set((s) => ({ selectedEvidenceId: id, evidenceFocusNonce: s.evidenceFocusNonce + 1 })),

  selectHypothesis: (id) => set({ selectedHypothesisId: id }),

  reset: () => set({ ...EMPTY_SLICE, activeTab: 'home' }),
}));
