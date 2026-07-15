/**
 * Compare causes side by side — "keep the runner-up in view." A lone top pick
 * invites over-trust; putting the leader next to its rivals shows how settled
 * the call really is. Each column draws only on computed fields
 * (prior→posterior movement, the waterfall's supporting/opposing findings, and
 * the DISTINGUISHING evidence a cause has that the others don't) — no new numbers.
 */
import type { ReactNode } from 'react';
import { hypothesisLibrary } from '../../config';
import { useAppStore } from '../../state/store';
import type { HypothesisPosterior, WaterfallStep } from '../../types';
import { ChartCaption } from '../shared/charts';
import { fmtPct, fmtSigned } from '../shared/format';
import { P } from '../shared/palette';
import { EvChip } from '../shared/ui';

/** Top-n evidence steps by |delta| on one side of the ledger (supporting or opposing). */
function sideEvidence(hp: HypothesisPosterior, sign: 1 | -1, n = 3): WaterfallStep[] {
  return hp.waterfall
    .filter((s) => s.kind === 'evidence' && s.evidenceId && Math.sign(s.delta) === sign)
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, n);
}

function ChipRow({ steps, empty }: { steps: WaterfallStep[]; empty: string }) {
  if (steps.length === 0) return <p className="text-[10px] text-slate-600">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((s) => (
        <EvChip key={s.evidenceId} id={s.evidenceId as string} />
      ))}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">{children}</p>
  );
}

function CauseColumn({ hp, distinguishing }: { hp: HypothesisPosterior; distinguishing: string[] }) {
  const hyp = hypothesisLibrary.hypotheses.find((h) => h.id === hp.hypothesisId);
  return (
    <div className="flex w-64 shrink-0 flex-col gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <p className="text-xs font-semibold leading-snug text-slate-100">{hp.name}</p>

      {/* posterior + prior→posterior movement */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {fmtPct(hp.posterior, 0)}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            from {fmtPct(hp.prior, 0)} · {fmtSigned(hp.logOddsShift)} log-odds
          </span>
        </div>
        <span className="relative mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-800">
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${hp.posterior * 100}%`,
              backgroundColor: hp.posterior >= 0.5 ? P.red : P.blue,
            }}
          />
          <span
            className="absolute inset-y-0 w-[2px]"
            style={{ left: `${hp.prior * 100}%`, backgroundColor: P.inkMuted }}
            aria-hidden
          />
        </span>
      </div>

      <div>
        <Label>supported by</Label>
        <ChipRow steps={sideEvidence(hp, 1)} empty="no supporting findings" />
      </div>
      <div>
        <Label>argued against by</Label>
        <ChipRow steps={sideEvidence(hp, -1)} empty="nothing argues against it" />
      </div>
      <div>
        <Label>only this cause</Label>
        {distinguishing.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {distinguishing.map((id) => (
              <EvChip key={id} id={id} />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-600">shares all its evidence with the others</p>
        )}
      </div>
      {hyp && hyp.repairOptions.length > 0 && (
        <div>
          <Label>if confirmed</Label>
          <ul className="list-inside list-disc space-y-0.5 text-[10px] leading-snug text-slate-400">
            {hyp.repairOptions.slice(0, 2).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function CompareCauses() {
  const bayes = useAppStore((s) => s.bayes);
  const compareIds = useAppStore((s) => s.compareIds);
  if (!bayes) return null;

  // Preserve posterior ranking, whatever order the user checked them in.
  const causes = bayes.posteriors.filter((p) => compareIds.includes(p.hypothesisId));

  if (causes.length < 2) {
    return (
      <p className="rounded border border-slate-800 bg-slate-900/60 px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
        Select at least two causes (checkboxes on the left) to compare them side by side — the
        leader against its closest rivals.
      </p>
    );
  }

  const top = causes[0];
  const second = causes[1];
  const ratio = second && second.posterior > 0 ? top.posterior / second.posterior : null;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {causes.map((hp) => {
          const othersUnion = new Set(
            causes.filter((c) => c.hypothesisId !== hp.hypothesisId).flatMap((c) => c.matchedEvidence),
          );
          const distinguishing = hp.matchedEvidence.filter((id) => !othersUnion.has(id));
          return <CauseColumn key={hp.hypothesisId} hp={hp} distinguishing={distinguishing} />;
        })}
      </div>
      <ChartCaption
        takeaway={
          ratio && ratio >= 1.5
            ? `${top.name} leads the field — ${Math.round(ratio)}× the confidence of ${second.name}.`
            : `${top.name} and ${second.name} are close — the call is not yet settled.`
        }
        method="each column is a candidate cause · 'only this cause' = evidence that points here and nowhere else"
      />
    </div>
  );
}
