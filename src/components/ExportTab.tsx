/**
 * Export tab — Phase 3. One-click Review Board Packet: live print-styled
 * preview (iframe), Markdown / HTML downloads, and client-side PDF via the
 * print dialog. Always available offline (deterministic narrative fallback).
 */
import { useMemo, useRef } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { buildPacket, packetToMarkdown } from '../export/packet';
import { packetToPrintHtml } from '../export/printHtml';
import { useAppStore } from '../state/store';
import { Badge, EmptyState, Section } from './shared/ui';

function download(fileName: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportTab() {
  const model = useAppStore((s) => s.model);
  const evidence = useAppStore((s) => s.evidence);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  const triage = useAppStore((s) => s.triage);
  const narrative = useAppStore((s) => s.narrative);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const ready = model && evidence && bayes && decision && triage;
  const packet = useMemo(
    () =>
      ready
        ? buildPacket({ model: model!, evidence: evidence!, bayes: bayes!, decision: decision!, triage: triage!, narrative })
        : null,
    [ready, model, evidence, bayes, decision, triage, narrative],
  );
  const html = useMemo(() => (packet ? packetToPrintHtml(packet) : ''), [packet]);

  if (!packet) {
    return (
      <EmptyState
        title="Nothing to export yet"
        body="The Review Board Packet is assembled from the evidence package, posteriors, decision analysis and triage plan. Load mission data first."
      />
    );
  }

  const stem = `${packet.vehicle}_${packet.anomalyRef}_review_packet`.replace(/\s+/g, '_');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => download(`${stem}.md`, 'text/markdown', packetToMarkdown(packet))}
          className="flex items-center gap-1.5 rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/20"
        >
          <Download size={13} /> Markdown
        </button>
        <button
          type="button"
          onClick={() => download(`${stem}.html`, 'text/html', html)}
          className="flex items-center gap-1.5 rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/20"
        >
          <FileText size={13} /> HTML
        </button>
        <button
          type="button"
          onClick={() => iframeRef.current?.contentWindow?.print()}
          className="flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          <Printer size={13} /> Print / save as PDF
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={packet.narrativeSource === 'deterministic' ? 'serious' : 'good'}>
            narrative: {packet.narrativeSource}
          </Badge>
          <span className="font-mono text-[10px] text-slate-500">
            {evidence!.items.length} evidence · {bayes!.posteriors.length} hypotheses ·{' '}
            {decision!.actions.length} actions · {triage!.steps.length} steps
          </span>
        </div>
      </div>

      <Section title="Packet preview (print layout)" icon={<FileText size={13} />}>
        <iframe
          ref={iframeRef}
          title="Review Board Packet preview"
          srcDoc={html}
          className="h-[70vh] w-full rounded border border-slate-700 bg-white"
        />
      </Section>
    </div>
  );
}
