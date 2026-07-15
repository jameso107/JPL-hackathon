/**
 * Self-contained print-friendly HTML rendering of the Review Board Packet —
 * used for the in-app preview iframe and for client-side PDF (print dialog).
 * No external assets; inline CSS; white paper styling.
 */
import type { PacketModel } from './packet';
import { compressRows } from './packet';
import { hypothesisLibrary } from '../config';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nameOf = (id: string) =>
  hypothesisLibrary.hypotheses.find((h) => h.id === id)?.name ?? id;

const pct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (v: number) => {
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 0.001) return v.toPrecision(3);
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return String(Number(v.toFixed(4)));
};

function table(header: string[], rows: string[][], cls = ''): string {
  return `<table class="${cls}"><thead><tr>${header
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 Georgia, 'Times New Roman', serif; color: #16181d; margin: 40px auto;
         max-width: 880px; padding: 0 24px; background: #ffffff; }
  h1 { font-size: 21px; border-bottom: 3px double #16181d; padding-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #9aa1ad; padding-bottom: 4px; }
  h3 { font-size: 13.5px; margin-top: 18px; }
  .meta, .fine { font-family: ui-monospace, 'Courier New', monospace; font-size: 11px; color: #444a55; }
  blockquote { border-left: 3px solid #9aa1ad; margin: 10px 0; padding: 4px 12px; color: #333;
               font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 11.5px; }
  th, td { border: 1px solid #c6ccd6; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #eef0f4; font-family: ui-monospace, monospace; font-size: 10px;
       text-transform: uppercase; letter-spacing: 0.06em; }
  td.mono, .mono { font-family: ui-monospace, monospace; font-size: 11px; white-space: nowrap; }
  .mono.wrap { white-space: normal; word-break: break-word; }
  tr.recommended td { background: #eaf5ec; font-weight: 600; }
  .badge { display: inline-block; border: 1px solid #444a55; border-radius: 3px; padding: 0 6px;
           font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; }
  ul { margin: 6px 0; padding-left: 22px; }
  .waterfall { page-break-inside: avoid; }
  footer { margin-top: 32px; border-top: 1px solid #9aa1ad; padding-top: 8px; font-size: 11px;
           color: #444a55; font-style: italic; }
  @page { margin: 18mm; }
  @media print { body { margin: 0 auto; } h2 { page-break-after: avoid; } }
`;

export function packetToPrintHtml(packet: PacketModel): string {
  const { inputs, narrative } = packet;
  const { evidence, bayes, decision, triage, model } = inputs;

  const evidenceRows = evidence.items.map((e) => [
    `<span class="mono">${esc(e.id)}</span>`,
    esc(e.kind),
    `<span class="mono">${esc(e.pattern ?? '—')}</span>`,
    esc(e.statement),
    `<span class="mono">${num(e.weight)}</span>`,
    `<span class="mono wrap">${esc(
      [
        e.provenance.file,
        e.provenance.rows?.length ? `rows ${compressRows(e.provenance.rows)}` : '',
        e.provenance.recordIds?.join(', ') ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
    )}</span>`,
  ]);

  const posteriorRows = bayes.posteriors.map((p) => [
    esc(p.name),
    `<span class="mono">${pct(p.prior)}</span>`,
    `<span class="mono"><b>${pct(p.posterior)}</b></span>`,
    `<span class="mono">${p.logOddsShift.toFixed(2)}</span>`,
    `<span class="mono">${esc(p.matchedEvidence.join(' ') || '—')}</span>`,
  ]);

  const waterfalls = bayes.posteriors
    .filter((p) => p.posterior >= 0.03)
    .map(
      (p) => `<div class="waterfall"><h3>Log-odds waterfall — ${esc(p.name)} (${pct(
        p.posterior,
      )})</h3>${table(
        ['Step', 'Evidence', 'Δ ln-odds', 'Cumulative ln p'],
        p.waterfall.map((w) => [
          esc(w.kind),
          `<span class="mono">${esc(w.evidenceId ?? w.label)}</span>`,
          `<span class="mono">${w.delta.toFixed(3)}</span>`,
          `<span class="mono">${w.cumulative.toFixed(3)}</span>`,
        ]),
      )}</div>`,
    )
    .join('');

  const actionRows = decision.actions.map((a) => {
    const rec = a.actionId === decision.recommendedActionId;
    return `<tr${rec ? ' class="recommended"' : ''}><td>${esc(a.name)}${
      rec ? ' <span class="badge">recommended</span>' : ''
    }</td><td class="mono">${num(a.delaySols.value)}</td><td class="mono">${usd(
      a.directCostUsd,
    )}</td><td class="mono">${pct(a.lovProbability, 2)}</td><td class="mono">${num(
      a.expectedSamples,
    )}</td><td class="mono">${usd(a.expectedRiskAdjustedCostUsd)}</td></tr>`;
  });

  const steps = triage.steps
    .map(
      (s) => `<h3>${esc(s.stepId)} · ${esc(s.name)} <span class="fine">(Sol ${s.startSol}–${
        s.startSol + s.durationSols
      })</span></h3>
      <p>${esc(s.description)}</p><p class="fine">${esc(s.rationale)}</p>
      ${table(
        ['Outcome', 'Supports', 'Refutes', 'Next action'],
        s.gates.map((g) => [
          `<span class="mono">${esc(g.outcome)}</span>`,
          esc(g.supports.map(nameOf).join('; ') || '—'),
          esc(g.refutes.map(nameOf).join('; ') || '—'),
          esc(g.nextAction),
        ]),
      )}
      ${
        s.candidates.length > 0
          ? `<p class="fine">Candidates (human picks): ${esc(
              s.candidates.map((c) => `${c.name} — ${c.matchRationale}`).join(' · '),
            )}</p>`
          : ''
      }`,
    )
    .join('');

  const rationales = narrative.hypothesisRationales
    .map(
      (hr) =>
        `<p><b>${esc(nameOf(hr.hypothesisId))}</b> — ${esc(hr.narrative)} <span class="mono">[${esc(
          hr.citedEvidence.join(', '),
        )}]</span></p>`,
    )
    .join('');

  const proposals =
    narrative.aiProposedHypotheses && narrative.aiProposedHypotheses.length > 0
      ? `<h2>AI-proposed hypotheses <span class="badge">no computed posterior</span></h2><ul>${narrative.aiProposedHypotheses
          .map(
            (p) =>
              `<li><b>${esc(p.name)}</b> — ${esc(p.rationale)} <i>Distinguishing test:</i> ${esc(
                p.distinguishingTest,
              )}</li>`,
          )
          .join('')}</ul>`
      : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(packet.title)}</title>
<style>${CSS}</style></head><body>
<h1>${esc(packet.title)}</h1>
<p class="meta">Vehicle ${esc(packet.vehicle)} · Current sol ${packet.currentSol ?? 'n/a'} ·
Generated ${esc(packet.generatedAtIso)} · Narrative source: ${esc(packet.narrativeSource)}</p>
<blockquote>${esc(packet.anomalyDescription)}</blockquote>

<h2>1 · Executive summary</h2><p>${esc(narrative.executiveSummary)}</p>

<h2>2 · Evidence package (computed, with provenance)</h2>
${table(['ID', 'Kind', 'Pattern', 'Statement', 'W', 'Provenance'], evidenceRows)}

<h2>3 · Hypothesis posteriors</h2>
<p class="fine">Priors: ${
    bayes.priorsMeta.uniformFallback
      ? 'uniform fallback (no anomaly history)'
      : `heritage records ${esc(bayes.priorsMeta.usedRecords.join(', '))} (excluded: ${esc(
          bayes.priorsMeta.excludedRecords.join(', ') || 'none',
        )})`
  } · Laplace α=${bayes.priorsMeta.laplaceAlpha} · reserved catch-all ${pct(
    bayes.priorsMeta.reservedUnknownMass,
    0,
  )} · tempering τ=${bayes.tempering}</p>
${table(['Hypothesis', 'Prior', 'Posterior', 'Δ log-odds', 'Matched evidence'], posteriorRows)}
${waterfalls}

<h2>4 · Decision analysis (actions × world states)</h2>
<p class="fine">Current sol ${decision.schedule.currentSol} · effective deadline sol ${
    decision.schedule.effectiveDeadlineSol.value
  } (${esc(decision.schedule.effectiveDeadlineSol.citation)}) · margin ${
    decision.schedule.marginSols.value
  } sols · delay ${usd(decision.schedule.delayCostPerSolUsd.value)}/sol</p>
<table><thead><tr><th>Action</th><th>Delay (sols)</th><th>Direct cost</th><th>P(LOV)</th>
<th>E[samples]</th><th>Risk-adj expected cost</th></tr></thead><tbody>${actionRows.join(
    '',
  )}</tbody></table>
<h3>Sensitivity</h3><ul>${decision.sensitivityNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<h3>Asserted risk inputs (cited)</h3>
${table(
    ['Input', 'Value', 'Citation'],
    decision.assertedInputs.map((a) => [esc(a.label), `<span class="mono">${esc(a.value)}</span>`, esc(a.citation)]),
  )}

<h2>5 · Triage / diagnosis plan</h2>
<p class="fine">${triage.steps.length} steps · ${triage.totalDurationSols} sols total · completes sol ${
    triage.completionSol
  }</p>
${steps}
${triage.notes.length > 0 ? `<ul>${triage.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}

${rationales ? `<h2>6 · Narrative rationales</h2>${rationales}` : ''}
${proposals}

<h2>7 · Caveats</h2>
<ul>${narrative.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>

<h2>Appendix · Source files</h2>
${table(
    ['File', 'Role', 'Profile', 'Records'],
    model.meta.sources.map((s) => [
      `<span class="mono">${esc(s.fileName)}</span>`,
      esc(s.role),
      `<span class="mono">${esc(s.profileId)}</span>`,
      `<span class="mono">${s.recordCount}</span>`,
    ]),
  )}
<footer>Generated by TRIAGE — numbers are computed, never generated; every claim traces to source
rows. TRIAGE advises, humans decide.</footer>
</body></html>`;
}
