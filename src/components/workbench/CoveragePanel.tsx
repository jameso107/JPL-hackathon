/**
 * Coverage & confidence basis — "state what's missing, not just what it found."
 *
 * A clean answer reads as a *checked* answer even when inputs were absent. This
 * panel discloses, from REAL data only: which of the seven data types were
 * present vs absent (and the capability lost when absent), and the honest basis
 * of the confidence (heritage records used vs uniform fallback, excluded
 * unresolved records, tempering). TRIAGE computes no "source reliability" or
 * "statistical fit" score, so we invent none — the posterior + its waterfall
 * remain the only confidence numbers.
 */
import { CircleCheck, CircleSlash, ShieldQuestion } from 'lucide-react';
import type { DatasetRole } from '../../types';
import { useAppStore } from '../../state/store';
import { DEGRADATION, ROLE_LABELS } from '../shared/names';
import { Badge, Disclosure, Term } from '../shared/ui';

const ROLES: DatasetRole[] = [
  'telemetry',
  'maintenance',
  'anomaly_history',
  'inventory',
  'timeline',
  'team',
  'budget',
];

function CoverageContent() {
  const model = useAppStore((s) => s.model);
  const missingRoles = useAppStore((s) => s.missingRoles);
  const bayes = useAppStore((s) => s.bayes);
  const evidence = useAppStore((s) => s.evidence);
  if (!model) return null;

  const recordsByRole = new Map(model.meta.sources.map((s) => [s.role, s]));
  const strong = evidence ? evidence.items.filter((i) => i.weight >= 0.5).length : 0;

  return (
    <div className="space-y-3">
      {/* per-dataset present / absent */}
      <div>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          data coverage
        </p>
        <ul className="space-y-1">
          {ROLES.map((role) => {
            const present = !missingRoles.includes(role);
            const src = recordsByRole.get(role);
            return (
              <li key={role} className="flex items-center gap-2 text-[11px]">
                {present ? (
                  <CircleCheck size={12} className="shrink-0 text-emerald-400" />
                ) : (
                  <CircleSlash size={12} className="shrink-0 text-slate-600" />
                )}
                <span className={present ? 'text-slate-300' : 'text-slate-500'}>
                  {ROLE_LABELS[role]}
                </span>
                {present ? (
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-slate-500">
                    {src ? `${src.recordCount} records` : 'loaded'}
                  </span>
                ) : (
                  <span className="ml-auto text-right text-[10px] text-amber-300/80">
                    {DEGRADATION[role] ?? 'capability reduced'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* what actually feeds the confidence (real, computed inputs only) */}
      {bayes && (
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            what feeds this confidence
          </p>
          <ul className="space-y-1 text-[11px] leading-snug text-slate-400">
            <li>
              <Term k="prior" mode="plain" />:{' '}
              {bayes.priorsMeta.uniformFallback ? (
                <span className="text-amber-300/90">
                  uniform — no anomaly history loaded (every cause starts equally likely)
                </span>
              ) : (
                <>
                  from {bayes.priorsMeta.usedRecords.length} heritage record
                  {bayes.priorsMeta.usedRecords.length === 1 ? '' : 's'}
                  {bayes.priorsMeta.usedRecords.length > 0 && (
                    <span className="font-mono text-[10px] text-slate-500">
                      {' '}
                      ({bayes.priorsMeta.usedRecords.join(', ')})
                    </span>
                  )}
                </>
              )}
            </li>
            {bayes.priorsMeta.excludedRecords.length > 0 && (
              <li>
                excluded as unresolved:{' '}
                <span className="font-mono text-[10px] text-slate-500">
                  {bayes.priorsMeta.excludedRecords.join(', ')}
                </span>
              </li>
            )}
            <li>
              evidence: {evidence?.items.length ?? 0} findings ({strong} carry strong weight)
            </li>
            <li>
              <Term k="tempering" mode="plain" /> τ = {bayes.tempering}{' '}
              <span className="text-slate-500">— evidence deliberately damped, never amplified</span>
            </li>
          </ul>
          <p className="mt-2 text-[10px] leading-snug text-slate-600">
            No reliability or goodness-of-fit score is fabricated — the posterior and its log-odds
            waterfall are the only confidence numbers, and both are computed from the inputs above.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * `compact` (Command View / Analysis header): a quiet one-line disclosure —
 * "coverage — N/7 data types · priors from k records" — that expands in place.
 * `full` (default): the content, always open, for a panel/section context.
 */
export default function CoveragePanel({ variant = 'full' }: { variant?: 'compact' | 'full' }) {
  const model = useAppStore((s) => s.model);
  const missingRoles = useAppStore((s) => s.missingRoles);
  const bayes = useAppStore((s) => s.bayes);
  if (!model) return null;

  if (variant === 'compact') {
    const present = ROLES.filter((r) => !missingRoles.includes(r)).length;
    const priors = bayes
      ? bayes.priorsMeta.uniformFallback
        ? 'uniform priors — no history'
        : `priors from ${bayes.priorsMeta.usedRecords.length} records`
      : 'priors pending';
    return (
      <Disclosure
        label={`coverage — ${present}/${ROLES.length} data types · ${priors}`}
        teaser="which inputs were present, and what feeds the confidence"
      >
        <CoverageContent />
      </Disclosure>
    );
  }

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
        <ShieldQuestion size={13} /> coverage &amp; confidence basis
      </p>
      <CoverageContent />
    </div>
  );
}
