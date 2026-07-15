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
import { askQuestion as runAsk } from '../reasoning/llm/qa';
import { runTriage } from '../triage';
import type {
  BayesResult,
  DatasetRole,
  DecisionAnalysis,
  EvidencePackage,
  IngestNotice,
  MappingProfile,
  MissionModel,
  NarrativeAudience,
  NarrativeFocus,
  NarrativeRequest,
  NarrativeResult,
  QaTurn,
  RawFile,
  TriagePlan,
} from '../types';

export type TabId =
  | 'briefing'
  | 'home'
  | 'workbench'
  | 'decision'
  | 'triage'
  | 'flightdeck'
  | 'export';

export interface AppState {
  // inputs
  model: MissionModel | null;
  notices: IngestNotice[];
  unrecognized: string[];
  /** dataset roles absent from the ingested model → degraded capabilities */
  missingRoles: DatasetRole[];
  /** the raw file set behind the current model — re-ingested when a manual mapping is confirmed */
  lastFiles: RawFile[];
  /** user-confirmed runtime mapping profiles (mapping dialog) */
  customProfiles: MappingProfile[];
  // derived artifacts (null until a model with telemetry is loaded)
  evidence: EvidencePackage | null;
  bayes: BayesResult | null;
  decision: DecisionAnalysis | null;
  triage: TriagePlan | null;
  // async narrative
  narrative: NarrativeResult | null;
  narrativeLoading: boolean;
  /** review-board (plain) vs engineer (technical) tone for the narrative */
  narrativeAudience: NarrativeAudience;
  // "Ask TRIAGE" grounded chat (async)
  qaMessages: QaTurn[];
  qaLoading: boolean;
  askOpen: boolean;
  // ui state
  activeTab: TabId;
  selectedEvidenceId: string | null;
  selectedHypothesisId: string | null;
  /** bumped on every selectEvidence call so the stream re-scrolls even for a re-click */
  evidenceFocusNonce: number;
  // guided story mode (step definitions live in UI config, not the store)
  storyActive: boolean;
  storyStep: number;
  // actions
  loadDemo: () => void;
  ingestBrowserFiles: (files: File[]) => Promise<void>;
  /** confirm a mapping-dialog profile and re-ingest the current file set with it */
  applyManualMapping: (profile: MappingProfile) => void;
  /** generate (or, with focus, regenerate a single section of) the narrative */
  generateNarrative: (opts?: { focus?: NarrativeFocus }) => Promise<void>;
  /** switch narrative audience and regenerate if a narrative already exists */
  setNarrativeAudience: (audience: NarrativeAudience) => void;
  /** open/close the Ask-TRIAGE drawer (toggles when no arg is given) */
  toggleAsk: (open?: boolean) => void;
  /** ask a grounded question; appends the user turn + the async answer turn */
  askQuestion: (text: string) => Promise<void>;
  setActiveTab: (tab: TabId) => void;
  selectEvidence: (id: string | null) => void;
  selectHypothesis: (id: string | null) => void;
  startStory: () => void;
  exitStory: () => void;
  setStoryStep: (step: number) => void;
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
  | 'qaMessages'
  | 'qaLoading'
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
  qaMessages: [],
  qaLoading: false,
  selectedEvidenceId: null,
  selectedHypothesisId: null,
};

/**
 * The full synchronous derivation pipeline. Never throws: every stage failure
 * becomes an error notice and nulls the artifact + downstream artifacts.
 */
function deriveFromFiles(files: RawFile[], extraProfiles: MappingProfile[] = []): DerivedSlice {
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
    const result = ingestFiles(files, extraProfiles);
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
    qaMessages: [],
    qaLoading: false,
    selectedEvidenceId: null,
    selectedHypothesisId: bayes?.posteriors[0]?.hypothesisId ?? null,
  };
}

export const useAppStore = create<AppState>()((set, get) => ({
  ...EMPTY_SLICE,
  activeTab: 'home',
  narrativeAudience: 'board',
  askOpen: false,
  evidenceFocusNonce: 0,
  lastFiles: [],
  customProfiles: [],
  storyActive: false,
  storyStep: 0,

  loadDemo: () => {
    const derived = deriveFromFiles(msrhDemoFiles, get().customProfiles);
    // BLUF: a successful pipeline lands on the Briefing verdict; failures land
    // on Data & Sources where the notices explain what went wrong.
    set({
      ...derived,
      lastFiles: msrhDemoFiles,
      activeTab: derived.bayes ? 'briefing' : 'home',
    });
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
    const derived = deriveFromFiles(raw, get().customProfiles);
    set({
      ...derived,
      notices: [...readFailures, ...derived.notices],
      lastFiles: raw,
      activeTab: derived.bayes ? 'briefing' : 'home',
    });
  },

  applyManualMapping: (profile: MappingProfile) => {
    const { lastFiles, customProfiles } = get();
    // replace any earlier mapping for the same file/id, newest wins
    const profiles = [profile, ...customProfiles.filter((p) => p.id !== profile.id)];
    const derived = deriveFromFiles(lastFiles, profiles);
    set({
      ...derived,
      customProfiles: profiles,
      notices: [
        {
          level: 'info',
          message: `manual mapping "${profile.id}" applied (role ${profile.role}) — file set re-ingested`,
        },
        ...derived.notices,
      ],
      activeTab: derived.bayes ? 'briefing' : 'home',
    });
  },

  generateNarrative: async (opts) => {
    const { evidence, bayes, decision, triage, model, narrativeLoading, narrativeAudience } = get();
    if (narrativeLoading) return;
    if (!evidence || !bayes || !decision || !triage) return;
    const req: NarrativeRequest = {
      evidence,
      bayes,
      decision,
      triage,
      vehicle: model?.meta.vehicle ?? 'MSRH',
      audience: narrativeAudience,
    };
    set({ narrativeLoading: true });
    let result: NarrativeResult;
    try {
      result = await requestNarrative(req, opts);
    } catch (err) {
      // requestNarrative is contractually non-throwing; belt and braces.
      result = {
        status: 'fallback',
        narrative: buildFallbackNarrative(req),
        error: messageOf(err),
      };
    }
    // A focused regenerate swaps in only that section, preserving the rest of
    // the current narrative (the model returns empty arrays for other fields).
    const prev = get().narrative;
    if (opts?.focus === 'executiveSummary' && prev) {
      set({
        narrative: {
          ...result,
          narrative: { ...prev.narrative, executiveSummary: result.narrative.executiveSummary },
        },
        narrativeLoading: false,
      });
    } else {
      set({ narrative: result, narrativeLoading: false });
    }
  },

  setNarrativeAudience: (audience) => {
    if (get().narrativeAudience === audience) return;
    set({ narrativeAudience: audience });
    // Re-narrate under the new audience only if a narrative is already shown.
    if (get().narrative) void get().generateNarrative();
  },

  toggleAsk: (open) => set((s) => ({ askOpen: open ?? !s.askOpen })),

  askQuestion: async (text) => {
    const question = text.trim();
    if (question === '') return;
    const { evidence, bayes, decision, triage, model, qaLoading, qaMessages } = get();
    if (qaLoading) return;
    if (!evidence || !bayes || !decision || !triage) return;
    const req: NarrativeRequest = {
      evidence,
      bayes,
      decision,
      triage,
      vehicle: model?.meta.vehicle ?? 'MSRH',
    };
    const history = qaMessages;
    // Append the user turn immediately; mark loading.
    set({ qaMessages: [...qaMessages, { role: 'user', text: question }], qaLoading: true });
    let answer: QaTurn;
    try {
      answer = await runAsk(req, question, history);
    } catch (err) {
      // runAsk is contractually non-throwing; belt and braces.
      answer = {
        role: 'assistant',
        text: 'The AI assistant is unavailable right now. Open the Analysis and Decision views for the computed result.',
        fallback: true,
        status: 'fallback',
        error: messageOf(err),
      };
    }
    set((s) => ({ qaMessages: [...s.qaMessages, answer], qaLoading: false }));
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  selectEvidence: (id) =>
    set((s) => ({ selectedEvidenceId: id, evidenceFocusNonce: s.evidenceFocusNonce + 1 })),

  selectHypothesis: (id) => set({ selectedHypothesisId: id }),

  startStory: () => set({ storyActive: true, storyStep: 0 }),
  exitStory: () => set({ storyActive: false }),
  setStoryStep: (step) => set({ storyStep: step }),

  reset: () =>
    set({
      ...EMPTY_SLICE,
      activeTab: 'home',
      narrativeAudience: 'board',
      askOpen: false,
      lastFiles: [],
      customProfiles: [],
      storyActive: false,
      storyStep: 0,
    }),
}));
