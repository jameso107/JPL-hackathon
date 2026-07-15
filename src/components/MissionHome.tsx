/** Mission Home — ingest surface: upload, demo case, source status, notices, fleet strip. */
import { clsx } from 'clsx';
import {
  Database,
  FileQuestion,
  FileText,
  FolderUp,
  ListChecks,
  Rocket,
  ShieldAlert,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useAppStore } from '../state/store';
import { fmtPct } from './shared/format';
import { DEGRADATION, ROLE_LABELS } from './shared/names';
import { Badge, NoticeRow, Section, StatTile } from './shared/ui';

function UploadZone() {
  const ingestBrowserFiles = useAppStore((s) => s.ingestBrowserFiles);
  const loadDemo = useAppStore((s) => s.loadDemo);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void ingestBrowserFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={clsx(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
        dragging
          ? 'border-sky-400/80 bg-sky-500/10'
          : 'border-slate-700 bg-slate-900/40 hover:border-slate-600',
      )}
    >
      <FolderUp size={32} strokeWidth={1.25} className="text-slate-600" />
      <p className="text-sm text-slate-300">
        Drop mission data files here{' '}
        <span className="text-slate-500">(telemetry, maintenance, anomaly history, …)</span>
      </p>
      <p className="text-xs text-slate-500">
        CSV / JSON · multiple files · schema profiles matched automatically
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={loadDemo}
          className="rounded border border-sky-500/60 bg-sky-500/15 px-4 py-2 font-mono text-xs uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/25"
        >
          <Rocket size={13} className="mr-1.5 inline-block align-[-2px]" />
          Load MSRH Flight 47 demo case
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded border border-slate-700 px-4 py-2 font-mono text-xs uppercase tracking-wider text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
        >
          Browse files…
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void ingestBrowserFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function FleetStrip() {
  const model = useAppStore((s) => s.model);
  if (!model) return null;
  const timeline = model.timeline;
  const lastAnomaly = [...model.telemetry].reverse().find((f) => f.anomalyFlag);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <StatTile
        label="Current sol"
        value={timeline?.currentSol ?? model.meta.currentSol ?? '—'}
        sub={`vehicle ${model.meta.vehicle}`}
      />
      <StatTile
        label="Helicopter status"
        value={timeline?.helicopterStatus?.replace(/_/g, ' ') ?? 'unknown'}
        tone={
          timeline && /ground|hold|stand.?down/i.test(timeline.helicopterStatus)
            ? 'warning'
            : undefined
        }
        sub={timeline ? 'from mission timeline' : 'timeline not loaded'}
      />
      <StatTile
        label="Flights flown"
        value={model.telemetry.length}
        sub={
          model.telemetry.length > 0
            ? `latest F${model.telemetry[model.telemetry.length - 1].flightNumber}`
            : undefined
        }
      />
      <StatTile
        label="Last anomaly flag"
        value={lastAnomaly ? `F${lastAnomaly.flightNumber}` : 'none'}
        tone={lastAnomaly && /EXCEEDANCE/i.test(lastAnomaly.anomalyFlag ?? '') ? 'critical' : undefined}
        sub={lastAnomaly?.anomalyFlag?.replace(/_/g, ' ').toLowerCase()}
      />
    </div>
  );
}

function SourceStatus() {
  const model = useAppStore((s) => s.model);
  const unrecognized = useAppStore((s) => s.unrecognized);
  if (!model && unrecognized.length === 0) return null;
  return (
    <Section title="Source files" icon={<Database size={13} />}>
      <ul className="divide-y divide-slate-800/70">
        {model?.meta.sources.map((src) => (
          <li key={src.fileName} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
            <FileText size={13} className="shrink-0 text-slate-500" />
            <span className="font-mono text-xs text-slate-200">{src.fileName}</span>
            <Badge tone="accent">{ROLE_LABELS[src.role] ?? src.role}</Badge>
            <span className="font-mono text-[10px] text-slate-500">profile {src.profileId}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-400">
              {src.recordCount} records
            </span>
          </li>
        ))}
        {unrecognized.map((name) => (
          <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
            <FileQuestion size={13} className="shrink-0 text-amber-300" />
            <span className="font-mono text-xs text-slate-400">{name}</span>
            <Badge tone="warning">unrecognized</Badge>
            <span className="text-[11px] text-slate-500">matched no schema-mapping profile</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Notices() {
  const notices = useAppStore((s) => s.notices);
  if (notices.length === 0) return null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...notices].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <Section title={`Ingest notices (${notices.length})`} icon={<ListChecks size={13} />}>
      <ul>
        {sorted.map((n, i) => (
          <NoticeRow key={`${n.level}-${i}-${n.message.slice(0, 24)}`} notice={n} />
        ))}
      </ul>
    </Section>
  );
}

function Degradation() {
  const model = useAppStore((s) => s.model);
  const missingRoles = useAppStore((s) => s.missingRoles);
  if (!model || missingRoles.length === 0) return null;
  return (
    <Section title="Degraded capabilities" icon={<ShieldAlert size={13} />}>
      <ul className="space-y-1.5">
        {missingRoles.map((role) => (
          <li key={role} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Badge tone={role === 'telemetry' ? 'critical' : 'warning'}>
              {ROLE_LABELS[role] ?? role} missing
            </Badge>
            <span>{DEGRADATION[role] ?? 'capability reduced'}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PipelineHint() {
  const bayes = useAppStore((s) => s.bayes);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  if (!bayes) return null;
  const top = bayes.posteriors[0];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
      <Badge tone="good">pipeline complete</Badge>
      <p className="text-xs text-slate-300">
        Leading hypothesis: <span className="font-medium text-slate-100">{top?.name}</span>{' '}
        <span className="font-mono text-emerald-400">{top ? fmtPct(top.posterior) : ''}</span>
      </p>
      <button
        type="button"
        onClick={() => setActiveTab('workbench')}
        className="ml-auto rounded border border-emerald-500/40 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-emerald-400 transition-colors hover:bg-emerald-500/10"
      >
        Open Anomaly Workbench →
      </button>
    </div>
  );
}

export default function MissionHome() {
  const model = useAppStore((s) => s.model);
  return (
    <div className="space-y-3">
      <FleetStrip />
      <PipelineHint />
      <UploadZone />
      {!model && (
        <p className="text-center text-xs text-slate-500">
          Nothing loaded yet — drop the seven MSRH files above, or load the bundled Flight 47 demo
          case to run the full disposition pipeline offline.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <SourceStatus />
        <div className="space-y-3">
          <Degradation />
          <Notices />
        </div>
      </div>
    </div>
  );
}
