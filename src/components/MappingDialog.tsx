/**
 * Schema-mapping dialog — Phase 3. Maps an unrecognized file's columns to the
 * canonical fields of a chosen dataset role; the confirmed mapping becomes a
 * runtime profile and the file set re-ingests through the normal pipeline.
 * Canonical field lists come from the built-in profiles for the same role.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { schemaMappings } from '../config';
import { parseCsvTable } from '../ingest/csv';
import { useAppStore } from '../state/store';
import type { DatasetRole, MappingProfile, RawFile } from '../types';
import { ROLE_LABELS } from './shared/names';
import { Badge } from './shared/ui';

const UNMAPPED = '__unmapped__';

/** Escape a filename into an exact-match regex for the runtime profile. */
const exactPattern = (name: string) => `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

/** Fuzzy prefill: exact (case-insensitive) → alias match → substring either way. */
function guessSource(canonical: string, aliases: string[], headers: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  for (const alias of [canonical, ...aliases]) {
    const i = lower.indexOf(alias.toLowerCase());
    if (i >= 0) return headers[i];
  }
  const canonLower = canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let i = 0; i < headers.length; i++) {
    const h = lower[i].replace(/[^a-z0-9]/g, '');
    if (h.includes(canonLower) || canonLower.includes(h)) return headers[i];
  }
  return UNMAPPED;
}

export default function MappingDialog({ file, onClose }: { file: RawFile; onClose: () => void }) {
  const applyManualMapping = useAppStore((s) => s.applyManualMapping);

  const format: 'csv' | 'json' = /\.json$/i.test(file.name) ? 'json' : 'csv';
  const headers = useMemo(() => {
    if (format === 'csv') {
      try {
        return parseCsvTable(file.text)?.header ?? [];
      } catch {
        return [];
      }
    }
    try {
      const value: unknown = JSON.parse(file.text);
      const first = Array.isArray(value) ? value[0] : value;
      return first && typeof first === 'object' ? Object.keys(first as object) : [];
    } catch {
      return [];
    }
  }, [file, format]);

  // roles whose built-in profile matches this file format and has explicit columns
  const roleOptions = useMemo(
    () =>
      schemaMappings.profiles
        .filter((p) => p.format === format && p.columns.length > 0)
        .map((p) => p.role),
    [format],
  );
  const [role, setRole] = useState<DatasetRole>(roleOptions[0] ?? 'telemetry');
  const template = schemaMappings.profiles.find((p) => p.role === role && p.columns.length > 0);

  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const col of template?.columns ?? []) {
      init[col.to] = guessSource(col.to, col.from, headers);
    }
    return init;
  });

  const switchRole = (next: DatasetRole) => {
    setRole(next);
    const tpl = schemaMappings.profiles.find((p) => p.role === next && p.columns.length > 0);
    const init: Record<string, string> = {};
    for (const col of tpl?.columns ?? []) init[col.to] = guessSource(col.to, col.from, headers);
    setAssignments(init);
  };

  const missingRequired = (template?.columns ?? []).filter(
    (c) => c.required && (assignments[c.to] ?? UNMAPPED) === UNMAPPED,
  );

  const confirm = () => {
    if (!template) return;
    const profile: MappingProfile = {
      id: `custom_${file.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
      role,
      format,
      filePatterns: [exactPattern(file.name)],
      signatureFields: [],
      columns: template.columns
        .filter((c) => (assignments[c.to] ?? UNMAPPED) !== UNMAPPED)
        .map((c) => ({ to: c.to, from: [assignments[c.to]], required: c.required })),
    };
    applyManualMapping(profile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm font-semibold text-slate-100">Map columns</h2>
            <p className="mt-0.5 font-mono text-[11px] text-slate-400">{file.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {headers.length === 0 ? (
          <p className="mt-4 text-xs text-red-300">
            Could not read column names from this file — it may be malformed {format.toUpperCase()}.
          </p>
        ) : (
          <>
            <label className="mt-4 block">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                dataset role
              </span>
              <select
                value={role}
                onChange={(e) => switchRole(e.target.value as DatasetRole)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                canonical field ← source column
              </p>
              {(template?.columns ?? []).map((col) => (
                <div key={col.to} className="flex items-center gap-2">
                  <span className="w-44 truncate font-mono text-[11px] text-slate-300">
                    {col.to}
                    {col.required && <span className="text-red-400"> *</span>}
                  </span>
                  <select
                    value={assignments[col.to] ?? UNMAPPED}
                    onChange={(e) =>
                      setAssignments((a) => ({ ...a, [col.to]: e.target.value }))
                    }
                    className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200"
                  >
                    <option value={UNMAPPED}>— not present —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={missingRequired.length > 0}
                onClick={confirm}
                className="rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-emerald-300 transition-colors enabled:hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm mapping & re-ingest
              </button>
              {missingRequired.length > 0 && (
                <Badge tone="warning">
                  {missingRequired.length} required field(s) unmapped
                </Badge>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
