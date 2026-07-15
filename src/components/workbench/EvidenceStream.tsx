/**
 * Evidence stream (workbench left pane): filterable list of evidence cards.
 * Selection scrolls the card into view (evidenceFocusNonce re-triggers even on
 * re-click) — the receiving end of every traceability link in the app.
 */
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceItem, EvidenceKind } from '../../types';
import { useAppStore } from '../../state/store';
import { fmtNum, fmtRowList } from '../shared/format';
import { prettyTag } from '../shared/names';
import { KIND_COLORS, KIND_ORDER } from '../shared/palette';
import { Disclosure, KindBadge, Meter } from '../shared/ui';

function EvidenceCard({
  item,
  selected,
  onSelect,
  cardRef,
}: {
  item: EvidenceItem;
  selected: boolean;
  onSelect: () => void;
  cardRef: (el: HTMLLIElement | null) => void;
}) {
  const prov = item.provenance;
  return (
    <li ref={cardRef}>
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          'w-full rounded-lg border p-2.5 text-left transition-colors',
          selected
            ? 'border-sky-400/70 bg-sky-500/10'
            : 'border-slate-800 bg-slate-900/60 hover:border-slate-600',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] font-semibold text-slate-200">{item.id}</span>
          <KindBadge kind={item.kind} />
          {item.pattern && (
            <span className="font-mono text-[10px] text-slate-500">{prettyTag(item.pattern)}</span>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-snug text-slate-300">{item.statement}</p>
        {item.weight > 0 && (
          <div className="mt-2 flex items-center gap-2" title="evidence weight (soft-evidence exponent)">
            <Meter value={item.weight} color={KIND_COLORS[item.kind]} className="flex-1" />
            <span className="font-mono text-[10px] tabular-nums text-slate-500">
              w={fmtNum(item.weight)}
            </span>
          </div>
        )}
        <p className="mt-1.5 truncate font-mono text-[10px] text-slate-500">
          {prov.file}
          {prov.rows && prov.rows.length > 0 && ` · rows ${fmtRowList(prov.rows)}`}
          {prov.recordIds && prov.recordIds.length > 0 && ` · ${prov.recordIds.join(', ')}`}
        </p>
      </button>
    </li>
  );
}

export default function EvidenceStream() {
  const evidence = useAppStore((s) => s.evidence);
  const selectedId = useAppStore((s) => s.selectedEvidenceId);
  const focusNonce = useAppStore((s) => s.evidenceFocusNonce);
  const selectEvidence = useAppStore((s) => s.selectEvidence);
  const [kindFilter, setKindFilter] = useState<EvidenceKind | null>(null);
  const [supportingOpen, setSupportingOpen] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());

  const items = evidence?.items ?? [];
  const presentKinds = useMemo(
    () => KIND_ORDER.filter((k) => items.some((i) => i.kind === k)),
    [items],
  );
  // Chunking: strong findings (weight ≥ 0.5) lead; the long tail of context,
  // constraints and historical matches collapses. An active kind filter is an
  // explicit zoom, so it shows a flat filtered list instead.
  const keyItems = useMemo(() => items.filter((i) => i.weight >= 0.5), [items]);
  const supportingItems = useMemo(() => items.filter((i) => i.weight < 0.5), [items]);
  const visible = kindFilter ? items.filter((i) => i.kind === kindFilter) : items;

  // Traceability contract: a jump to evidence hidden by the current filter or
  // inside the collapsed supporting group must always land — clear the filter
  // and auto-open the group (keyed on focusNonce so re-clicks re-trigger).
  useEffect(() => {
    if (!selectedId) return;
    const item = items.find((i) => i.id === selectedId);
    if (!item) return;
    if (kindFilter && item.kind !== kindFilter) setKindFilter(null);
    if (item.weight < 0.5) setSupportingOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, focusNonce]);

  useEffect(() => {
    if (!selectedId) return;
    const el = cardRefs.current.get(selectedId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId, focusNonce, kindFilter, supportingOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 pb-2">
        <button
          type="button"
          onClick={() => setKindFilter(null)}
          className={clsx(
            'rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider transition-colors',
            kindFilter === null
              ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
              : 'border-slate-700 text-slate-500 hover:text-slate-300',
          )}
        >
          all ({items.length})
        </button>
        {presentKinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(kindFilter === k ? null : k)}
            className={clsx(
              'flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider transition-colors',
              kindFilter === k
                ? 'border-sky-400/60 bg-sky-500/15 text-sky-300'
                : 'border-slate-700 text-slate-500 hover:text-slate-300',
            )}
          >
            <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: KIND_COLORS[k] }} />
            {k.replace(/_/g, ' ')} ({items.filter((i) => i.kind === k).length})
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {kindFilter ? (
          <>
            {visible.map((item) => (
              <EvidenceCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => selectEvidence(item.id === selectedId ? null : item.id)}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(item.id, el);
                  else cardRefs.current.delete(item.id);
                }}
              />
            ))}
            {visible.length === 0 && (
              <li className="py-6 text-center text-xs text-slate-500">
                no evidence in this filter
              </li>
            )}
          </>
        ) : (
          <>
            {keyItems.map((item) => (
              <EvidenceCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => selectEvidence(item.id === selectedId ? null : item.id)}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(item.id, el);
                  else cardRefs.current.delete(item.id);
                }}
              />
            ))}
            {supportingItems.length > 0 && (
              <li>
                <Disclosure
                  label={`supporting & context evidence (${supportingItems.length})`}
                  teaser="constraints, historical matches and weaker signals — auto-opens when a citation points here"
                  open={supportingOpen}
                  onToggle={setSupportingOpen}
                >
                  <ul className="space-y-2">
                    {supportingItems.map((item) => (
                      <EvidenceCard
                        key={item.id}
                        item={item}
                        selected={item.id === selectedId}
                        onSelect={() => selectEvidence(item.id === selectedId ? null : item.id)}
                        cardRef={(el) => {
                          if (el) cardRefs.current.set(item.id, el);
                          else cardRefs.current.delete(item.id);
                        }}
                      />
                    ))}
                  </ul>
                </Disclosure>
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  );
}
