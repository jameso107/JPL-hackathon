/**
 * STUB — implemented by the ui agent. See docs/CONTRACTS.md §Store/UI.
 *
 * Single zustand store: MissionModel + derived artifacts, recomputed in one
 * pass whenever inputs change. Derivation order:
 *   ingestFiles → runAnalytics → runBayes → runDecision → runTriage
 * Narrative generation is async and explicitly user-triggered (LLM call),
 * falling back to buildFallbackNarrative.
 */
import { create } from 'zustand';
import type {
  BayesResult,
  DecisionAnalysis,
  EvidencePackage,
  IngestNotice,
  MissionModel,
  NarrativeResult,
  TriagePlan,
} from '../types';

export type TabId = 'home' | 'workbench' | 'decision' | 'triage';

export interface AppState {
  // inputs
  model: MissionModel | null;
  notices: IngestNotice[];
  unrecognized: string[];
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
  // actions
  loadDemo: () => void;
  ingestBrowserFiles: (files: File[]) => Promise<void>;
  generateNarrative: () => Promise<void>;
  setActiveTab: (tab: TabId) => void;
  selectEvidence: (id: string | null) => void;
  selectHypothesis: (id: string | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(() => {
  throw new Error('not implemented: store (ui agent)');
});
