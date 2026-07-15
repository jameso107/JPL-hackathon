/**
 * The verdict headline — BLUF. Two deterministic sentences built entirely from
 * computed store values, null-safe per clause so degraded ingests still render
 * whatever is known. The single most important element in the app.
 */
import { useAppStore } from '../../state/store';
import { fmtPct, fmtUsd } from '../shared/format';
import VibSparkline from '../overview/VibSparkline';

export default function VerdictHeadline() {
  const model = useAppStore((s) => s.model);
  const evidence = useAppStore((s) => s.evidence);
  const bayes = useAppStore((s) => s.bayes);
  const decision = useAppStore((s) => s.decision);
  if (!model || !evidence) return null;

  const top = bayes?.posteriors[0];
  const rec = decision?.actions.find((a) => a.actionId === decision.recommendedActionId);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            {model.meta.vehicle} · flight {evidence.anomaly.flightRef ?? '—'} · anomaly briefing
          </p>
          <h2 className="mt-2 text-xl font-semibold leading-snug text-slate-100">
            {top ? (
              <>
                Most likely cause:{' '}
                <span className="text-sky-300">{top.name.toLowerCase()}</span> —{' '}
                <span className="font-mono tabular-nums">{fmtPct(top.posterior)}</span> confidence.
              </>
            ) : (
              <>Anomaly under review — posteriors unavailable with the loaded files.</>
            )}
          </h2>
          {rec && decision && (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Recommended: <span className="font-medium text-emerald-300">{rec.name}</span> —{' '}
              {fmtUsd(rec.expectedRiskAdjustedCostUsd)} expected total cost,{' '}
              {decision.schedule.marginSols.value} Mars days of cushion before the Sol{' '}
              {decision.schedule.effectiveDeadlineSol.value} deadline.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            {evidence.anomaly.description}
          </p>
        </div>
        <div className="shrink-0 rounded border border-slate-800 bg-slate-950/60 px-2.5 py-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
            vibration · {model.telemetry.length} flights
          </p>
          <VibSparkline />
          <p className="font-mono text-[9px] text-slate-500">dashed: alert limit · red: this flight</p>
        </div>
      </div>
    </div>
  );
}
