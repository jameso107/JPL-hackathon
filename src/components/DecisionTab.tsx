/**
 * Decision Analysis tab: action comparison table (recommended highlighted),
 * risk-adjusted cost-component chart, per-action expanders (per-hypothesis
 * outcomes, mitigations, budget violations), cited assumptions, schedule
 * facts, sensitivity notes.
 */
import { clsx } from 'clsx';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BadgeCheck,
  BookOpenCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Scale,
  SlidersHorizontal,
} from 'lucide-react';
import { riskDefaults } from '../config';
import { useAppStore } from '../state/store';
import type { ActionEvaluation, DecisionAnalysis } from '../types';
import { AXIS_LINE, AXIS_TICK, LegendRow, TipFrame, TipRow } from './shared/charts';
import { fmtNum, fmtPct, fmtUsd, fmtUsdFull, truncate } from './shared/format';
import { hypName } from './shared/names';
import { P } from './shared/palette';
import { Badge, EmptyState, Section, StatTile } from './shared/ui';

// ---------------------------------------------------------------------------
// Cost-component chart — direct cost vs dollarized LOV & sample-shortfall risk
// ---------------------------------------------------------------------------

interface CostRow {
  name: string;
  recommended: boolean;
  direct: number;
  lovRisk: number;
  shortfallRisk: number;
  total: number;
}

function buildCostRows(analysis: DecisionAnalysis, pendingSamples: number): CostRow[] {
  return analysis.actions.map((a) => {
    const lovRisk = a.lovProbability * riskDefaults.vehicleLossPenaltyUsd.value;
    const shortfallRisk =
      Math.max(0, pendingSamples - a.expectedSamples) *
      riskDefaults.sampleShortfallPenaltyUsd.value;
    return {
      name: a.name,
      recommended: a.actionId === analysis.recommendedActionId,
      direct: a.directCostUsd,
      lovRisk,
      shortfallRisk,
      total: a.expectedRiskAdjustedCostUsd,
    };
  });
}

interface CostTipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CostRow }>;
}

function CostTip({ active, payload }: CostTipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipFrame title={row.name}>
      <TipRow label="direct cost" value={fmtUsd(row.direct)} swatch={P.blue} />
      <TipRow label="vehicle-loss risk" value={fmtUsd(row.lovRisk)} swatch={P.red} />
      <TipRow label="sample-shortfall risk" value={fmtUsd(row.shortfallRisk)} swatch={P.yellow} />
      <TipRow label="expected total" value={fmtUsd(row.total)} />
    </TipFrame>
  );
}

function CostChart({ analysis, pendingSamples }: { analysis: DecisionAnalysis; pendingSamples: number }) {
  const rows = buildCostRows(analysis, pendingSamples);
  return (
    <div>
      <LegendRow
        items={[
          { label: 'direct cost (delay + parts + services)', color: P.blue },
          { label: 'vehicle-loss risk (P(LOV) × penalty)', color: P.red },
          { label: 'sample-shortfall risk', color: P.yellow },
        ]}
      />
      <ResponsiveContainer width="100%" height={rows.length * 44 + 30}>
        <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 56, bottom: 2, left: 4 }}>
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: number) => fmtUsd(v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={210}
            tick={{ ...AXIS_TICK, fontSize: 9 }}
            tickLine={false}
            axisLine={AXIS_LINE}
            tickFormatter={(v: string) => truncate(v, 34)}
          />
          <Tooltip content={<CostTip />} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
          <Bar dataKey="direct" stackId="c" fill={P.blue} isAnimationActive={false} barSize={18} />
          <Bar dataKey="lovRisk" stackId="c" fill={P.red} isAnimationActive={false} barSize={18} />
          <Bar
            dataKey="shortfallRisk"
            stackId="c"
            fill={P.yellow}
            isAnimationActive={false}
            barSize={18}
            radius={[0, 3, 3, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 px-1 text-[10px] leading-snug text-slate-500">
        posterior-weighted expected cost per action plan, decomposed · risk terms use the cited
        asserted penalties below
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table + per-action expanders
// ---------------------------------------------------------------------------

function ActionRow({
  action,
  recommended,
  pendingSamples,
}: {
  action: ActionEvaluation;
  recommended: boolean;
  pendingSamples: number;
}) {
  const [open, setOpen] = useState(recommended);
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'cursor-pointer border-b border-slate-800/70 transition-colors hover:bg-slate-800/30',
          recommended && 'bg-emerald-500/5',
        )}
      >
        <td className="px-2 py-2">
          <div className="flex items-start gap-1.5">
            {open ? (
              <ChevronDown size={13} className="mt-0.5 shrink-0 text-slate-500" />
            ) : (
              <ChevronRight size={13} className="mt-0.5 shrink-0 text-slate-500" />
            )}
            <div>
              <p className="text-xs font-medium leading-snug text-slate-200">{action.name}</p>
              {recommended && (
                <span className="mt-1 inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                  <BadgeCheck size={11} /> recommended
                </span>
              )}
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-slate-300" title={action.delaySols.citation}>
          {fmtNum(action.delaySols.value)}
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-slate-300" title={fmtUsdFull(action.directCostUsd)}>
          {fmtUsd(action.directCostUsd)}
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-slate-300">
          {fmtPct(action.lovProbability, 2)}
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-slate-300">
          {fmtNum(action.expectedSamples)} / {pendingSamples}
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-slate-300">
          {fmtNum(action.marginConsumedSols)}
        </td>
        <td className={clsx('px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums', recommended ? 'text-emerald-400' : 'text-slate-100')} title={fmtUsdFull(action.expectedRiskAdjustedCostUsd)}>
          {fmtUsd(action.expectedRiskAdjustedCostUsd)}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-800/70 bg-slate-900/40">
          <td colSpan={7} className="px-3 py-3">
            <p className="text-[11px] leading-snug text-slate-400">{action.summary}</p>
            {action.flightsFlown.length > 0 && (
              <p className="mt-1.5 font-mono text-[10px] text-slate-500">
                flights: {action.flightsFlown.join(' → ')}
              </p>
            )}

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  outcome by world state (hypothesis × posterior)
                </p>
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-left font-mono text-[9px] uppercase tracking-wider text-slate-500">
                      <th className="py-1 pr-2 font-normal">hypothesis</th>
                      <th className="py-1 pr-2 text-right font-normal">post.</th>
                      <th className="py-1 pr-2 text-right font-normal">P(LOV)</th>
                      <th className="py-1 pr-2 text-right font-normal">E[samples]</th>
                      <th className="py-1 text-right font-normal">risk-adj cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...action.perHypothesis]
                      .sort((a, b) => b.posterior - a.posterior)
                      .filter((h) => h.posterior >= 0.005)
                      .map((h) => (
                        <tr key={h.hypothesisId} className="border-b border-slate-800/50 last:border-0">
                          <td className="py-1 pr-2 text-slate-300">{truncate(hypName(h.hypothesisId), 34)}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">{fmtPct(h.posterior, 0)}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">{fmtPct(h.lovProbability, 2)}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums text-slate-400">{fmtNum(h.expectedSamples)}</td>
                          <td className="py-1 text-right font-mono tabular-nums text-slate-400">{fmtUsd(h.riskAdjustedCostUsd)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2.5">
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    mitigations
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-[11px] text-slate-400">
                    {action.mitigations.map((m) => (
                      <li key={m.slice(0, 40)}>{m}</li>
                    ))}
                  </ul>
                </div>
                {action.budgetViolations.length > 0 && (
                  <div>
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      budget violations
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {action.budgetViolations.map((v) => (
                        <Badge key={v} tone="critical">
                          {v.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cited assumptions & schedule facts
// ---------------------------------------------------------------------------

function AssumptionsPanel({ analysis }: { analysis: DecisionAnalysis }) {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Cited risk assumptions (asserted inputs)"
      icon={<SlidersHorizontal size={13} />}
      right={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
        >
          {open ? 'collapse' : `expand (${analysis.assertedInputs.length})`}
        </button>
      }
    >
      <p className="text-[11px] leading-snug text-slate-500">
        These values are engineering-judgment defaults from <span className="font-mono">config/risk_defaults.yaml</span> —
        deliberately fixed and cited, never fitted. Everything else in the table is computed
        from the mission files.
      </p>
      {open && (
        <table className="mt-2 w-full border-collapse text-[11px]">
          <tbody>
            {analysis.assertedInputs.map((a) => (
              <tr key={a.label} className="border-b border-slate-800/60 align-top last:border-0">
                <td className="py-1 pr-3 text-slate-300">{a.label}</td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums text-slate-200">{a.value}</td>
                <td className="py-1 text-slate-500">{a.citation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function ScheduleStrip({ analysis }: { analysis: DecisionAnalysis }) {
  const s = analysis.schedule;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <StatTile label="Current sol" value={s.currentSol} sub="mission_timeline.json" />
      <StatTile
        label="Effective deadline"
        value={`Sol ${s.effectiveDeadlineSol.value}`}
        sub={s.effectiveDeadlineSol.citation}
        title={s.effectiveDeadlineSol.citation}
        tone="warning"
      />
      <StatTile
        label="Margin remaining"
        value={`${s.marginSols.value} sols`}
        sub={s.marginSols.citation}
        title={s.marginSols.citation}
        tone={s.marginSols.value < 30 ? 'critical' : 'warning'}
      />
      <StatTile
        label="Delay burn"
        value={`${fmtUsd(s.delayCostPerSolUsd.value)}/sol`}
        sub={s.delayCostPerSolUsd.citation}
        title={s.delayCostPerSolUsd.citation}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export default function DecisionTab() {
  const decision = useAppStore((s) => s.decision);
  const model = useAppStore((s) => s.model);

  if (!decision) {
    return (
      <EmptyState
        title="No decision analysis"
        body="The expected-cost tree needs the mission timeline (plus posteriors). Load the demo case or include mission_timeline.json in your upload."
      />
    );
  }

  const pendingSamples = model?.timeline?.earthReturnWindow.samplesPendingRetrieval ?? 2;

  return (
    <div className="space-y-3">
      <ScheduleStrip analysis={decision} />

      <Section title="Action comparison — expected cost over world states" icon={<Scale size={13} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-slate-700 text-left font-mono text-[9px] uppercase tracking-wider text-slate-500">
                <th className="px-2 py-1.5 font-normal">action plan (click to expand)</th>
                <th className="px-2 py-1.5 text-right font-normal">delay sols</th>
                <th className="px-2 py-1.5 text-right font-normal">direct cost</th>
                <th className="px-2 py-1.5 text-right font-normal">P(LOV)</th>
                <th className="px-2 py-1.5 text-right font-normal">E[samples]</th>
                <th className="px-2 py-1.5 text-right font-normal">margin used</th>
                <th className="px-2 py-1.5 text-right font-normal">risk-adj expected cost</th>
              </tr>
            </thead>
            <tbody>
              {decision.actions.map((a) => (
                <ActionRow
                  key={a.actionId}
                  action={a}
                  recommended={a.actionId === decision.recommendedActionId}
                  pendingSamples={pendingSamples}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Expected-cost decomposition" icon={<Scale size={13} />}>
        <CostChart analysis={decision} pendingSamples={pendingSamples} />
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <AssumptionsPanel analysis={decision} />
        <Section title="Sensitivity" icon={<CalendarClock size={13} />}>
          <ul className="list-inside list-disc space-y-1.5 text-[11px] leading-snug text-slate-400">
            {decision.sensitivityNotes.map((n) => (
              <li key={n.slice(0, 48)}>{n}</li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-600">
            <BookOpenCheck size={11} />
            computed by re-evaluating the tree across parameter grids — see docs/CONTRACTS.md §Decision
          </p>
        </Section>
      </div>
    </div>
  );
}
