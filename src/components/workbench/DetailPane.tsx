/**
 * Detail pane (workbench right): selected-evidence deep dive — statement,
 * value table, provenance, and a context chart chosen by evidence kind.
 */
import { Crosshair } from 'lucide-react';
import { useAppStore } from '../../state/store';
import type { EvidenceItem } from '../../types';
import { BearingPlayChart, VibrationScatterChart } from './ContextCharts';
import { fmtNum, fmtRowList } from '../shared/format';
import { prettyTag } from '../shared/names';
import { KindBadge } from '../shared/ui';

/** "residualOverRmse" → "residual over rmse". */
function prettyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function ValueTable({ item }: { item: EvidenceItem }) {
  const entries = Object.entries(item.value);
  if (entries.length === 0) return null;
  return (
    <table className="w-full border-collapse text-[11px]">
      <tbody>
        {entries.map(([key, v]) => (
          <tr key={key} className="border-b border-slate-800/60 last:border-0">
            <td className="py-1 pr-2 text-slate-500">{prettyKey(key)}</td>
            <td className="py-1 text-right font-mono tabular-nums text-slate-200">{fmtNum(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContextChart({ item }: { item: EvidenceItem }) {
  const model = useAppStore((s) => s.model);
  const evidence = useAppStore((s) => s.evidence);
  if (!model || !evidence) return null;
  switch (item.kind) {
    case 'trend':
    case 'exceedance':
    case 'confounder':
    case 'prediction':
      return <VibrationScatterChart model={model} evidence={evidence} />;
    case 'maintenance_correlation':
      return <BearingPlayChart model={model} />;
    default:
      return null; // constraints & historical matches: the value table is the story
  }
}

export default function DetailPane() {
  const evidence = useAppStore((s) => s.evidence);
  const selectedId = useAppStore((s) => s.selectedEvidenceId);
  const item = evidence?.items.find((i) => i.id === selectedId);

  if (!item) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
        <Crosshair size={28} strokeWidth={1.25} className="text-slate-700" />
        <p className="text-xs text-slate-500">
          Select an evidence card — or click any EV citation, waterfall bar, or matched-evidence
          chip — to trace it back to its source data here.
        </p>
      </div>
    );
  }

  const prov = item.provenance;
  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-slate-100">{item.id}</span>
          <KindBadge kind={item.kind} />
          {item.pattern && (
            <span className="font-mono text-[10px] text-slate-500">{prettyTag(item.pattern)}</span>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{item.statement}</p>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          provenance
        </p>
        <p className="font-mono text-[11px] text-slate-300">{prov.file}</p>
        {prov.rows && prov.rows.length > 0 && (
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
            rows {fmtRowList(prov.rows)}{' '}
            <span className="text-slate-600">(1-based, header = row 1)</span>
          </p>
        )}
        {prov.recordIds && prov.recordIds.length > 0 && (
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
            records {prov.recordIds.join(', ')}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          computed values
        </p>
        <ValueTable item={item} />
        {item.weight > 0 && (
          <p className="mt-1.5 font-mono text-[10px] text-slate-500">
            evidence weight w = {fmtNum(item.weight)} (soft-evidence exponent in the Bayes update)
          </p>
        )}
      </div>

      <ContextChart item={item} />
    </div>
  );
}
