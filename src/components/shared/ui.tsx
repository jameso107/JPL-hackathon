/** Small shared UI atoms: badges, chips, meters, empty states, stat tiles. */
import { clsx } from 'clsx';
import { AlertTriangle, Info, Radar, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EvidenceKind, IngestNotice } from '../../types';
import { useAppStore } from '../../state/store';
import { KIND_COLORS } from './palette';

// ---------------------------------------------------------------------------
// Badges & chips
// ---------------------------------------------------------------------------

export type BadgeTone = 'good' | 'warning' | 'serious' | 'critical' | 'accent' | 'neutral' | 'violet';

const TONE_CLASSES: Record<BadgeTone, string> = {
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  serious: 'border-orange-400/40 bg-orange-400/10 text-orange-300',
  critical: 'border-red-500/40 bg-red-500/10 text-red-400',
  accent: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
  neutral: 'border-slate-600/60 bg-slate-800/60 text-slate-400',
  violet: 'border-violet-400/40 bg-violet-400/10 text-violet-300',
};

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider',
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Evidence-kind badge — fixed hue per kind (identity, not status). */
export function KindBadge({ kind }: { kind: EvidenceKind }) {
  const color = KIND_COLORS[kind];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-slate-700/70 bg-slate-800/50 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-slate-300"
      title={`evidence kind: ${kind}`}
    >
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
      {kind.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * Clickable evidence citation chip — the traceability primitive. Clicking
 * selects the evidence item; the evidence stream scrolls it into view.
 */
export function EvChip({ id, invalid = false }: { id: string; invalid?: boolean }) {
  const selectEvidence = useAppStore((s) => s.selectEvidence);
  const selectedId = useAppStore((s) => s.selectedEvidenceId);
  if (invalid) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center rounded border border-slate-700/60 px-1.5 py-px font-mono text-[10px] text-slate-600 line-through"
        title={`${id} is not in the evidence package`}
      >
        {id}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => selectEvidence(id)}
      title={`jump to ${id} in the evidence stream`}
      className={clsx(
        'inline-flex items-center rounded border px-1.5 py-px font-mono text-[10px] transition-colors',
        selectedId === id
          ? 'border-sky-400/70 bg-sky-500/20 text-sky-300'
          : 'border-sky-500/30 bg-sky-500/5 text-sky-400 hover:border-sky-400/60 hover:bg-sky-500/15',
      )}
    >
      {id}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Meter — thin horizontal fill bar (weight / posterior)
// ---------------------------------------------------------------------------

export function Meter({
  value,
  max = 1,
  color = '#3987e5',
  className,
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-slate-800', className)}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${frac * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section / panel scaffolding
// ---------------------------------------------------------------------------

export function Section({
  title,
  icon,
  right,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('rounded-lg border border-slate-800 bg-slate-900/60', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2">
        <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {icon}
          {title}
        </h2>
        {right}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  body,
  showDemo = true,
  icon,
}: {
  title: string;
  body: string;
  showDemo?: boolean;
  icon?: ReactNode;
}) {
  const loadDemo = useAppStore((s) => s.loadDemo);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-slate-700">{icon ?? <Radar size={40} strokeWidth={1.25} />}</div>
      <p className="font-mono text-sm uppercase tracking-widest text-slate-400">{title}</p>
      <p className="max-w-md text-sm text-slate-500">{body}</p>
      <div className="mt-2 flex items-center gap-3">
        {showDemo && (
          <button
            type="button"
            onClick={loadDemo}
            className="rounded border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-sky-400 transition-colors hover:bg-sky-500/20"
          >
            Load MSRH F47 demo case
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className="rounded border border-slate-700 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
        >
          Mission Home
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  return (
    <div
      className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5"
      title={title}
    >
      <p className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p
        className={clsx(
          'mt-1 truncate text-lg font-semibold leading-tight',
          tone === 'critical'
            ? 'text-red-400'
            : tone === 'warning'
              ? 'text-amber-300'
              : tone === 'good'
                ? 'text-emerald-400'
                : 'text-slate-100',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ingest / stage notices
// ---------------------------------------------------------------------------

export function NoticeRow({ notice }: { notice: IngestNotice }) {
  const icon =
    notice.level === 'error' ? (
      <XCircle size={13} className="mt-0.5 shrink-0 text-red-400" />
    ) : notice.level === 'warning' ? (
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" />
    ) : (
      <Info size={13} className="mt-0.5 shrink-0 text-slate-500" />
    );
  return (
    <li className="flex items-start gap-2 py-1 text-xs leading-snug text-slate-400">
      {icon}
      <span>
        {notice.fileName && (
          <span className="mr-1 font-mono text-[10px] text-slate-500">[{notice.fileName}]</span>
        )}
        {notice.message}
      </span>
    </li>
  );
}
