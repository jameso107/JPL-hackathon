/**
 * Review Board Packet — Phase 3.
 *
 * Builds a structured PacketModel from the derived artifacts, then renders it
 * two ways: Markdown (download) and a self-contained print-friendly HTML
 * document (in-app preview iframe + client-side PDF via the print dialog).
 * If no AI narrative was generated, the deterministic fallback narrative is
 * used so the packet is always complete offline.
 */
import type {
  BayesResult,
  DecisionAnalysis,
  DispositionNarrative,
  EvidencePackage,
  MissionModel,
  NarrativeResult,
  TriagePlan,
} from '../types';
import { buildFallbackNarrative } from '../reasoning/llm';
import { hypothesisLibrary } from '../config';

export interface PacketInputs {
  model: MissionModel;
  evidence: EvidencePackage;
  bayes: BayesResult;
  decision: DecisionAnalysis;
  triage: TriagePlan;
  narrative: NarrativeResult | null;
}

export interface PacketModel {
  title: string;
  generatedAtIso: string;
  vehicle: string;
  currentSol?: number;
  anomalyRef: string;
  anomalyDescription: string;
  narrativeSource: 'ChatHPC (validated)' | 'ChatHPC (validated after retry)' | 'deterministic';
  narrative: DispositionNarrative;
  inputs: PacketInputs;
}

const nameOf = (id: string) =>
  hypothesisLibrary.hypotheses.find((h) => h.id === id)?.name ?? id;

export function buildPacket(inputs: PacketInputs, now: Date = new Date()): PacketModel {
  const { model, evidence, narrative } = inputs;
  const resolved: DispositionNarrative =
    narrative?.narrative ??
    buildFallbackNarrative({
      evidence: inputs.evidence,
      bayes: inputs.bayes,
      decision: inputs.decision,
      triage: inputs.triage,
      vehicle: model.meta.vehicle,
    });
  const narrativeSource =
    narrative?.status === 'llm'
      ? 'ChatHPC (validated)'
      : narrative?.status === 'llm_retry'
        ? 'ChatHPC (validated after retry)'
        : 'deterministic';
  return {
    title: `Anomaly Review Board Packet — ${model.meta.vehicle} ${evidence.anomaly.flightRef ?? ''}`.trim(),
    generatedAtIso: now.toISOString(),
    vehicle: model.meta.vehicle,
    currentSol: model.meta.currentSol,
    anomalyRef: evidence.anomaly.flightRef ?? 'n/a',
    anomalyDescription: evidence.anomaly.description,
    narrativeSource,
    narrative: resolved,
    inputs,
  };
}

// ---------------------------------------------------------------------------
// shared formatting
// ---------------------------------------------------------------------------

const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (v: number) => {
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 0.001) return v.toPrecision(3);
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return String(Number(v.toFixed(4)));
};

/** Compress a 1-based row list into ranges: [2,3,4,48] → "2–4, 48". */
export function compressRows(rows: number[]): string {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const cur of sorted.slice(1)) {
    if (cur === prev || cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = cur;
    prev = cur;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(', ');
}

function provenanceText(e: EvidencePackage['items'][number]): string {
  const parts = [e.provenance.file];
  if (e.provenance.rows?.length) parts.push(`rows ${compressRows(e.provenance.rows)}`);
  if (e.provenance.recordIds?.length) parts.push(e.provenance.recordIds.join(', '));
  return parts.join(' · ');
}

/** hypotheses that get a waterfall section (same ≥3% rule as the narrative) */
function waterfallHypotheses(bayes: BayesResult) {
  return bayes.posteriors.filter((p) => p.posterior >= 0.03);
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

const mdEscape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function mdTable(header: string[], rows: string[][]): string {
  const h = `| ${header.join(' | ')} |`;
  const sep = `| ${header.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(mdEscape).join(' | ')} |`).join('\n');
  return `${h}\n${sep}\n${body}`;
}

export function packetToMarkdown(packet: PacketModel): string {
  const { inputs, narrative } = packet;
  const { evidence, bayes, decision, triage, model } = inputs;
  const lines: string[] = [];
  const push = (...s: string[]) => lines.push(...s, '');

  push(`# ${packet.title}`);
  push(
    `**Vehicle:** ${packet.vehicle} · **Current sol:** ${packet.currentSol ?? 'n/a'} · ` +
      `**Generated:** ${packet.generatedAtIso} · **Narrative source:** ${packet.narrativeSource}`,
  );
  push(`> ${packet.anomalyDescription}`);

  push('## 1 · Executive summary');
  push(narrative.executiveSummary);

  push('## 2 · Evidence package (computed, with provenance)');
  push(
    mdTable(
      ['ID', 'Kind', 'Pattern', 'Statement', 'Weight', 'Provenance'],
      evidence.items.map((e) => [
        e.id,
        e.kind,
        e.pattern ?? '—',
        e.statement,
        num(e.weight),
        provenanceText(e),
      ]),
    ),
  );

  push('## 3 · Hypothesis posteriors');
  push(
    `Priors: ${
      bayes.priorsMeta.uniformFallback
        ? 'uniform fallback (no anomaly history)'
        : `heritage anomaly records ${bayes.priorsMeta.usedRecords.join(', ')} (excluded: ${
            bayes.priorsMeta.excludedRecords.join(', ') || 'none'
          })`
    }; Laplace α=${bayes.priorsMeta.laplaceAlpha}, reserved catch-all mass ${pct(
      bayes.priorsMeta.reservedUnknownMass,
      0,
    )}, evidence tempering τ=${bayes.tempering}.`,
  );
  push(
    mdTable(
      ['Hypothesis', 'Prior', 'Posterior', 'Δ log-odds', 'Matched evidence'],
      bayes.posteriors.map((p) => [
        p.name,
        pct(p.prior),
        pct(p.posterior),
        p.logOddsShift.toFixed(2),
        p.matchedEvidence.join(' ') || '—',
      ]),
    ),
  );

  for (const p of waterfallHypotheses(bayes)) {
    push(`### Log-odds waterfall — ${p.name} (${pct(p.posterior)})`);
    push(
      mdTable(
        ['Step', 'Evidence', 'Δ ln-odds', 'Cumulative ln p'],
        p.waterfall.map((w) => [
          w.kind,
          w.evidenceId ?? w.label,
          w.delta.toFixed(3),
          w.cumulative.toFixed(3),
        ]),
      ),
    );
  }

  push('## 4 · Decision analysis (actions × world states)');
  push(
    `Schedule: current sol ${decision.schedule.currentSol}; effective deadline sol ` +
      `${decision.schedule.effectiveDeadlineSol.value} (${decision.schedule.effectiveDeadlineSol.citation}); ` +
      `margin ${decision.schedule.marginSols.value} sols; delay cost ${usd(
        decision.schedule.delayCostPerSolUsd.value,
      )}/sol.`,
  );
  push(
    mdTable(
      ['Action', 'Delay (sols)', 'Direct cost', 'P(LOV)', 'E[samples]', 'Risk-adj expected cost'],
      decision.actions.map((a) => [
        `${a.actionId === decision.recommendedActionId ? '**→ ' : ''}${a.name}${
          a.actionId === decision.recommendedActionId ? '** (recommended)' : ''
        }`,
        num(a.delaySols.value),
        usd(a.directCostUsd),
        pct(a.lovProbability, 2),
        num(a.expectedSamples),
        usd(a.expectedRiskAdjustedCostUsd),
      ]),
    ),
  );
  push('### Sensitivity');
  push(...decision.sensitivityNotes.map((n) => `- ${n}`));
  push('### Asserted risk inputs (cited)');
  push(
    mdTable(
      ['Input', 'Value', 'Citation'],
      decision.assertedInputs.map((a) => [a.label, a.value, a.citation]),
    ),
  );

  push('## 5 · Triage / diagnosis plan');
  push(
    `${triage.steps.length} steps, ${triage.totalDurationSols} sols total; completes sol ${triage.completionSol}.`,
  );
  for (const s of triage.steps) {
    push(
      `### ${s.stepId} · ${s.name} (Sol ${s.startSol}–${s.startSol + s.durationSols})`,
      s.description,
      `*${s.rationale}*`,
    );
    push(
      mdTable(
        ['Outcome', 'Supports', 'Refutes', 'Next action'],
        s.gates.map((g) => [
          g.outcome,
          g.supports.map(nameOf).join('; ') || '—',
          g.refutes.map(nameOf).join('; ') || '—',
          g.nextAction,
        ]),
      ),
    );
    if (s.candidates.length > 0) {
      push(
        `Candidates (human picks): ${s.candidates
          .map((c) => `${c.name} (${c.matchRationale})`)
          .join(' · ')}`,
      );
    }
  }
  if (triage.notes.length > 0) push(...triage.notes.map((n) => `- ${n}`));

  if (narrative.hypothesisRationales.length > 0) {
    push('## 6 · Narrative rationales');
    for (const hr of narrative.hypothesisRationales) {
      push(`**${nameOf(hr.hypothesisId)}** — ${hr.narrative} _[${hr.citedEvidence.join(', ')}]_`);
    }
  }
  if (narrative.aiProposedHypotheses && narrative.aiProposedHypotheses.length > 0) {
    push('## AI-proposed hypotheses (no computed posterior)');
    for (const p of narrative.aiProposedHypotheses) {
      push(`- **${p.name}** — ${p.rationale} *Distinguishing test:* ${p.distinguishingTest}`);
    }
  }

  push('## 7 · Caveats');
  push(...narrative.caveats.map((c) => `- ${c}`));

  push('## Appendix · Source files');
  push(
    mdTable(
      ['File', 'Role', 'Profile', 'Records'],
      model.meta.sources.map((s) => [s.fileName, s.role, s.profileId, String(s.recordCount)]),
    ),
  );
  push(
    '---',
    '*Generated by TRIAGE — numbers are computed, never generated; every claim traces to source rows. TRIAGE advises, humans decide.*',
  );
  return lines.join('\n');
}
