/** Review Board Packet: complete, provenance-bearing, offline-renderable. */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPacket, packetToMarkdown, type PacketModel } from '../src/export/packet';
import { packetToPrintHtml } from '../src/export/printHtml';
import { ingestFiles } from '../src/ingest';
import { runAnalytics } from '../src/analytics';
import { runBayes } from '../src/reasoning/bayes';
import { runDecision } from '../src/decision';
import { runTriage } from '../src/triage';
import {
  analyticsConfig,
  bayesConfig,
  diagnosticsCatalog,
  hypothesisLibrary,
  riskDefaults,
} from '../src/config';
import { msrhDemoFiles } from '../src/demo/msrhDemo';

let packet: PacketModel;
let md: string;
let html: string;

beforeAll(() => {
  const model = ingestFiles(msrhDemoFiles).model!;
  const evidence = runAnalytics(model, analyticsConfig);
  const bayes = runBayes(evidence, hypothesisLibrary, model, bayesConfig);
  const decision = runDecision(bayes, model, riskDefaults);
  const triage = runTriage(bayes, model, diagnosticsCatalog, hypothesisLibrary);
  // narrative: null → deterministic fallback must fill in (offline path)
  packet = buildPacket(
    { model, evidence, bayes, decision, triage, narrative: null },
    new Date('2028-09-01T00:00:00Z'),
  );
  md = packetToMarkdown(packet);
  html = packetToPrintHtml(packet);
});

describe('review board packet', () => {
  it('is complete offline: deterministic narrative source with a real summary', () => {
    expect(packet.narrativeSource).toBe('deterministic');
    expect(packet.narrative.executiveSummary.length).toBeGreaterThan(50);
    expect(packet.anomalyRef).toBe('F47');
  });

  it('markdown carries every section with evidence ids, provenance and citations', () => {
    for (const heading of [
      '# Anomaly Review Board Packet — MSRH F47',
      '## 1 · Executive summary',
      '## 2 · Evidence package',
      '## 3 · Hypothesis posteriors',
      '## 4 · Decision analysis',
      '## 5 · Triage / diagnosis plan',
      '## 7 · Caveats',
      '## Appendix · Source files',
    ]) {
      expect(md).toContain(heading);
    }
    // every evidence item appears with its provenance anchors
    for (const item of packet.inputs.evidence.items) expect(md).toContain(item.id);
    expect(md).toContain('MA-010');
    expect(md).toContain('telemetry_flights.csv');
    // top hypothesis + waterfall table
    expect(md).toContain('Progressive rotor bearing degradation');
    expect(md).toContain('Log-odds waterfall — Progressive rotor bearing degradation');
    // recommended action marked, sensitivity + asserted citations present
    expect(md).toContain('(recommended)');
    expect(md).toMatch(/Asserted risk inputs/);
    expect(md).toContain('TRIAGE advises, humans decide');
  });

  it('print HTML is self-contained, escaped, and mirrors the key content', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/src=|href=/); // no external assets
    expect(html).toContain('Progressive rotor bearing degradation');
    expect(html).toContain('recommended');
    expect(html).toContain('EV-01');
    // escaping: no raw angle brackets from data can break out of cells
    expect(html).not.toContain('<script');
  });

  it('markdown escapes pipes in table cells', () => {
    const evil = {
      ...packet,
      anomalyDescription: 'contains | a pipe',
      inputs: {
        ...packet.inputs,
        evidence: {
          ...packet.inputs.evidence,
          items: [
            { ...packet.inputs.evidence.items[0], statement: 'bad | pipe | statement' },
            ...packet.inputs.evidence.items.slice(1),
          ],
        },
      },
    };
    const evilMd = packetToMarkdown(evil);
    expect(evilMd).toContain('bad \\| pipe \\| statement');
  });
});
