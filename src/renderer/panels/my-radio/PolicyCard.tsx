import { Shield } from 'lucide-react';
import { useRef, useState } from 'react';
import type { TelemetryPolicy } from '../../../shared/types';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { META, TelemetryCard } from '../../features/telemetry/ui';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { MODE_DENY, MODE_EVERYONE, MODE_PER_CONTACT, type PermGroup, perContactSummary, useFlagRows } from './flags';

// "Who can read my telemetry": the radio's three telemetry modes as
// segmented controls that write straight to the radio (no draft + Save). The
// radio is the source of truth: main reads the modes back from SELF_INFO and
// pushes `telemetryPolicy` after each accepted write.
//
// The store holds only what the radio confirmed; a choice in flight shows as
// a local override on top. Writes go one at a time: main merges each patch
// onto the radio's last confirmed policy, so two overlapping PUTs would each
// write the other's field back to its old value.

const MODES: ReadonlyArray<{ value: TelemetryPolicy['base']; label: string }> = [
  { value: MODE_DENY, label: 'Deny' },
  { value: MODE_PER_CONTACT, label: 'Per contact' },
  { value: MODE_EVERYONE, label: 'Everyone' },
];

const ROWS: ReadonlyArray<{ key: PermGroup; label: string; description: string }> = [
  { key: 'base', label: 'Base', description: 'Battery voltage, MCU temperature.' },
  { key: 'loc', label: 'Location', description: 'GPS position on channel 1, when GPS is on.' },
  { key: 'env', label: 'Environment', description: 'Every attached sensor, channel 2 onward.' },
];

// The design's segmented control: borderless bg-3 track, sans 12 px items, the
// selected one lifted onto cs-bg in accent. toggle-group.tsx bakes in
// first:/last: corner radii, hence the modifier-scoped overrides (see WindowTabs).
const GROUP = 'shrink-0 gap-0.5 rounded-[7px] bg-cs-bg-3 p-0.5';
const ITEM = cn(
  'h-6 min-w-0 flex-none rounded-[5px] px-2.5 text-[12px] font-medium first:rounded-[5px] last:rounded-[5px]',
  'text-cs-text-muted hover:bg-transparent hover:text-cs-text',
  'data-[state=on]:bg-cs-bg data-[state=on]:text-cs-accent data-[state=on]:shadow-[0_1px_0_rgba(0,0,0,0.3)]',
);

type Mode = TelemetryPolicy['base'];

export function PolicyCard({ client, connected }: { client: ApiClient | null; connected: boolean }) {
  const confirmed = useStore((s) => s.telemetryPolicy);
  const rows = useFlagRows();
  // Choices not yet confirmed by the radio, per field.
  const [pending, setPending] = useState<Partial<Record<PermGroup, Mode>>>({});
  // Newest choice per field: only its settling clears the override.
  const seq = useRef<Record<PermGroup, number>>({ base: 0, loc: 0, env: 0 });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const editable = !!client && connected;
  const policy: TelemetryPolicy = { ...confirmed, ...pending };

  const write = (field: PermGroup, value: Mode) => {
    if (!client || policy[field] === value) return;
    const mine = ++seq.current[field];
    setPending((p) => ({ ...p, [field]: value }));
    queue.current = queue.current.then(async () => {
      try {
        // Only the changed field: main merges it onto the radio's own value.
        await api.putTelemetryPolicy(client, { [field]: value });
        // Accepted: the radio holds it now. The telemetryPolicy push says the
        // same; applying it here keeps the control from flicking back first.
        const store = useStore.getState();
        store.applyTelemetryPolicy({ ...store.telemetryPolicy, [field]: value });
      } catch (err) {
        // Nothing to roll back: the store still holds the radio's value.
        notify.error(`Telemetry policy save failed: ${(err as Error).message}`, err);
      } finally {
        if (seq.current[field] === mine) {
          setPending(({ [field]: _settled, ...rest }) => rest);
        }
      }
    });
  };

  const summary = perContactSummary(policy, rows);

  return (
    <TelemetryCard
      aria-label="Who can read my telemetry"
      header={
        <>
          <Shield aria-hidden="true" className="size-3.5 shrink-0 text-cs-accent" />
          <h3 className="text-[13px] font-semibold text-cs-text">Who can read my telemetry</h3>
          <span className={cn(META, 'ml-auto')}>{editable ? 'saved on radio' : 'connect your radio to change'}</span>
        </>
      }
    >
      {ROWS.map((row) => (
        <div key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cs-border px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-cs-text">{row.label}</div>
            <div className="text-[11px] text-cs-text-muted">{row.description}</div>
          </div>
          <ToggleGroup
            type="single"
            value={String(policy[row.key])}
            // Radix emits '' when the active item is clicked again; keep the mode.
            onValueChange={(v) => {
              if (v) write(row.key, Number(v) as Mode);
            }}
            disabled={!editable}
            aria-label={row.label}
            className={GROUP}
          >
            {MODES.map((m) => (
              <ToggleGroupItem key={m.value} value={String(m.value)} className={ITEM}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ))}
      <div className="flex flex-col gap-1 px-3.5 pt-2 pb-2.5 text-[11px] leading-4 text-cs-text-dim">
        <p>
          “Per contact” uses the telemetry flags on each contact{summary ? '. ' : ', set in the rail.'}
          {summary}
        </p>
        {policy.base === MODE_DENY && (
          <p className="text-[rgb(var(--cs-hop-far))]">
            With Base on Deny the radio answers no one, whatever Location and Environment say.
          </p>
        )}
      </div>
    </TelemetryCard>
  );
}
