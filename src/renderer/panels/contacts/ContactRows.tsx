import {
  Ban,
  ChevronDown,
  DoorOpen,
  Minus,
  Plus,
  RadioTower,
  Star,
  Thermometer,
  User,
} from 'lucide-react';
import { useState } from 'react';
import type { DiscoveredContact } from '../../../shared/contacts/discovered';
import type { ContactKind } from '../../../shared/types';
import { BlockSenderDialog } from '../../components/BlockSenderDialog';
import { copyToClipboard } from '../../components/ContextMenu';
import { Checkbox } from '../../components/ui/checkbox';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import type { CmSortField } from '../../lib/store';
import { useStore } from '../../lib/store';
import { fmtDateTime, fmtRelative } from '../../lib/time';
import { cn } from '../../lib/utils';

const KIND_ICON: Record<ContactKind, typeof User> = {
  chat: User,
  repeater: RadioTower,
  room: DoorOpen,
  sensor: Thermometer,
};

export function TypeGlyph({ kind, className }: { kind: ContactKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={cn('size-3.5 text-cs-text-muted', className)} aria-hidden="true" />;
}

const KIND_LABEL: Record<ContactKind, string> = {
  chat: 'Chat',
  repeater: 'Repeater',
  room: 'Room',
  sensor: 'Sensor',
};

export function StatusPill({ c }: { c: DiscoveredContact }) {
  if (c.blocked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cs-danger/40 bg-cs-danger/10 px-2 py-px font-mono text-[9.5px] text-cs-danger">
        Blocked
      </span>
    );
  }
  if (c.onRadio) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cs-online/40 bg-cs-online/10 px-2 py-px font-mono text-[9.5px] text-cs-online">
        On Radio
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cs-border px-2 py-px font-mono text-[9.5px] text-cs-text-dim">
      Discovered
    </span>
  );
}

export function HopChip({ hops }: { hops?: number }) {
  return (
    <span className="font-mono text-[10.5px] text-cs-text-muted">
      {hops == null ? '—' : `${hops} hop${hops === 1 ? '' : 's'}`}
    </span>
  );
}

export function RowActions({ c, client }: { c: DiscoveredContact; client: ApiClient | null }) {
  const [blockOpen, setBlockOpen] = useState(false);

  async function addToRadio(e: React.MouseEvent) {
    e.stopPropagation();
    if (!client) return;
    try {
      await api.addToRadio(client, c.publicKeyHex);
      notify.success(`Added ${c.name} to radio`);
    } catch (err) {
      notify.error(`Add failed: ${(err as Error).message}`, err);
    }
  }
  async function removeFromRadio(e: React.MouseEvent) {
    e.stopPropagation();
    if (!client) return;
    try {
      await api.removeFromRadio(client, c.publicKeyHex);
      notify.success(`Removed ${c.name} from radio`);
    } catch (err) {
      notify.error(`Remove failed: ${(err as Error).message}`, err);
    }
  }

  // Blocked rows have no add/remove affordance — block state is managed via
  // the Blocked-senders settings (there is no per-contact unblock api).
  if (c.blocked) {
    return (
      <span className="font-mono text-[9.5px] text-cs-text-dim opacity-0 transition-opacity group-hover:opacity-100">
        blocked
      </span>
    );
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      {c.onRadio ? (
        <button
          type="button"
          onClick={removeFromRadio}
          disabled={!client}
          title="Remove from radio"
          className="grid size-6 place-items-center rounded text-cs-text-muted hover:bg-cs-bg-3 disabled:opacity-40"
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={addToRadio}
          disabled={!client}
          title="Add to radio"
          className="grid size-6 place-items-center rounded text-cs-accent hover:bg-cs-bg-3 disabled:opacity-40"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setBlockOpen(true);
        }}
        disabled={!client}
        title="Block"
        className="grid size-6 place-items-center rounded text-cs-danger hover:bg-cs-bg-3 disabled:opacity-40"
      >
        <Ban className="size-3.5" aria-hidden="true" />
      </button>
      {blockOpen && (
        <BlockSenderDialog
          client={client}
          open
          prefill={{ pubkey: c.publicKeyHex, name: c.name }}
          onClose={() => setBlockOpen(false)}
        />
      )}
    </div>
  );
}

function SortHeader({
  field,
  label,
  className,
}: {
  field: CmSortField;
  label: string;
  className?: string;
}) {
  const sortField = useStore((s) => s.contactManager.sortField);
  const sortDir = useStore((s) => s.contactManager.sortDir);
  const setCmSort = useStore((s) => s.setCmSort);
  const active = sortField === field;
  return (
    <button
      type="button"
      onClick={() => setCmSort(field)}
      className={cn('flex items-center gap-1 uppercase hover:text-cs-text-muted', className)}
    >
      {label}
      {active && (
        <ChevronDown
          className={cn('size-3 transition-transform', sortDir === 'desc' && 'rotate-180')}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

export function TableView({
  rows,
  client,
}: {
  rows: DiscoveredContact[];
  client: ApiClient | null;
}) {
  const selected = useStore((s) => s.contactManager.selected);
  const focusKey = useStore((s) => s.contactManager.focusKey);
  const showKeys = useStore((s) => s.contactManager.showKeys);
  const compact = useStore((s) => s.contactManager.compact);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const toggleCmSelected = useStore((s) => s.toggleCmSelected);
  const setCmFocus = useStore((s) => s.setCmFocus);

  const pad = compact ? 'py-1.5' : 'py-2.5';
  const th = 'px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-cs-text-dim';

  return (
    <table className="w-full table-fixed border-collapse">
      <thead className="sticky top-0 z-1 bg-cs-bg">
        <tr className="border-b border-cs-border text-left">
          <th className={cn(th, 'w-9')} />
          <th className={cn(th, 'w-8')} />
          <th className={th}>
            <SortHeader field="name" label="Name" />
          </th>
          <th className={cn(th, 'w-24')}>
            <SortHeader field="type" label="Type" />
          </th>
          <th className={cn(th, 'w-16')}>
            <SortHeader field="hops" label="Hops" />
          </th>
          <th className={cn(th, 'w-27')}>
            <SortHeader field="firstHeard" label="First heard" />
          </th>
          <th className={cn(th, 'w-27')}>
            <SortHeader field="lastHeard" label="Last heard" />
          </th>
          <th className={cn(th, 'w-26')}>Status</th>
          <th className={cn(th, 'w-16')} />
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const pk = c.publicKeyHex;
          const isSelected = selected.includes(pk);
          const isFocused = focusKey === pk;
          return (
            <tr
              key={pk}
              tabIndex={0}
              onClick={() => setCmFocus(pk)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setCmFocus(pk);
                }
              }}
              className={cn(
                'group cursor-pointer border-b border-cs-border hover:bg-cs-bg-2',
                isFocused && 'bg-cs-bg-3',
                isSelected && 'bg-cs-accent-soft/15',
              )}
            >
              <td className={cn('px-2', pad)}>
                <Checkbox
                  checked={isSelected}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={() => toggleCmSelected(pk)}
                />
              </td>
              <td className={cn('px-2', pad)}>
                <TypeGlyph kind={c.kind} />
              </td>
              <td className={cn('px-2', pad)}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'truncate text-[12.5px] font-medium text-cs-text',
                      c.blocked && 'line-through opacity-60',
                    )}
                  >
                    {c.name}
                  </span>
                  {c.favourite && (
                    <Star
                      className="size-3 shrink-0 fill-cs-warn text-cs-warn"
                      aria-hidden="true"
                    />
                  )}
                </div>
                {showKeys && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(pk, () => notify.success('Public key copied'));
                    }}
                    title={`${pk} — click to copy`}
                    className="block w-full truncate text-left font-mono text-[10px] text-cs-text-dim hover:text-cs-text-muted"
                  >
                    {pk}
                  </button>
                )}
              </td>
              <td className={cn('whitespace-nowrap px-2 text-[11.5px] text-cs-text-muted', pad)}>
                {KIND_LABEL[c.kind]}
              </td>
              <td className={cn('px-2', pad)}>
                <HopChip hops={c.hops} />
              </td>
              <td
                className={cn('whitespace-nowrap px-2 font-mono text-[11px] text-cs-text-dim', pad)}
                title={fmtDateTime(c.firstHeardMs, timeFormat)}
              >
                {fmtRelative(c.firstHeardMs)}
              </td>
              <td
                className={cn('whitespace-nowrap px-2 font-mono text-[11px] text-cs-text-dim', pad)}
                title={c.lastHeardMs == null ? undefined : fmtDateTime(c.lastHeardMs, timeFormat)}
              >
                {c.lastHeardMs == null ? '—' : fmtRelative(c.lastHeardMs)}
              </td>
              <td className={cn('px-2', pad)}>
                <StatusPill c={c} />
              </td>
              <td className={cn('px-2', pad)}>
                <RowActions c={c} client={client} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ListRow({ c, client }: { c: DiscoveredContact; client: ApiClient | null }) {
  const selected = useStore((s) => s.contactManager.selected);
  const focusKey = useStore((s) => s.contactManager.focusKey);
  const showKeys = useStore((s) => s.contactManager.showKeys);
  const compact = useStore((s) => s.contactManager.compact);
  const setCmFocus = useStore((s) => s.setCmFocus);

  const pk = c.publicKeyHex;
  const isSelected = selected.includes(pk);
  const isFocused = focusKey === pk;
  const lastLabel = c.lastHeardMs == null ? 'never' : fmtRelative(c.lastHeardMs);
  const hopsLabel = c.hops == null ? '—' : `${c.hops} hop${c.hops === 1 ? '' : 's'}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> because RowActions renders nested buttons
    <div
      role="button"
      tabIndex={0}
      onClick={() => setCmFocus(pk)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setCmFocus(pk);
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 border-b border-cs-border px-4 hover:bg-cs-bg-2',
        compact ? 'py-1.5' : 'py-2.5',
        isFocused && 'bg-cs-bg-3',
        isSelected && 'bg-cs-accent-soft/15',
      )}
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-cs-border bg-cs-bg-3">
        <TypeGlyph kind={c.kind} className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[12.5px] font-medium text-cs-text',
              c.blocked && 'line-through opacity-60',
            )}
          >
            {c.name}
          </span>
          {c.favourite && (
            <Star className="size-3 shrink-0 fill-cs-warn text-cs-warn" aria-hidden="true" />
          )}
        </div>
        <div className="truncate font-mono text-[10.5px] text-cs-text-dim">
          {KIND_LABEL[c.kind]} · {lastLabel} · {hopsLabel}
          {showKeys && ` · ${pk}`}
        </div>
      </div>
      <StatusPill c={c} />
      <RowActions c={c} client={client} />
    </div>
  );
}

export function SelectAllBar({ rows }: { rows: DiscoveredContact[] }) {
  const selected = useStore((s) => s.contactManager.selected);
  const setCmSelected = useStore((s) => s.setCmSelected);
  const clearCmSelected = useStore((s) => s.clearCmSelected);

  const selectedSet = new Set(selected);
  const inFilter = rows.filter((r) => selectedSet.has(r.publicKeyHex)).length;
  const allSelected = rows.length > 0 && inFilter === rows.length;
  const someSelected = inFilter > 0 && !allSelected;

  return (
    <div className="flex items-center gap-2 border-b border-cs-border bg-cs-bg-2 px-4 py-1.5 text-xs">
      <Checkbox
        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
        onCheckedChange={() => {
          if (allSelected) clearCmSelected();
          else setCmSelected(rows.map((r) => r.publicKeyHex));
        }}
      />
      {selected.length > 0 ? (
        <>
          <span className="text-cs-text-muted">{selected.length} selected</span>
          <button
            type="button"
            onClick={() => clearCmSelected()}
            className="text-cs-accent hover:underline"
          >
            Clear
          </button>
        </>
      ) : (
        <span className="text-cs-text-dim">Select all {rows.length} filtered</span>
      )}
    </div>
  );
}
