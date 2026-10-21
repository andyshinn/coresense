import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../../shared/errors';
import type { TelemetryPerms } from '../../../shared/types';
import { Checkbox } from '../../components/ui/checkbox';
import { LABEL_CAPS, META } from '../../features/telemetry/ui';
import { api } from '../../lib/api';
import { useApiClient } from '../../lib/apiClientContext';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { MODE_PER_CONTACT, PERM_GROUPS, type PermGroup, useFlagRows } from './flags';

// My radio's rail: the per-contact telemetry flags of every chat contact on
// the radio, editable inline. A column is live only while its policy mode is
// "Per contact" — under Deny or Everyone the radio never reads the flag.

const GRID = 'grid grid-cols-[minmax(0,1fr)_40px_40px_40px] items-center gap-1';

/** "7c01e2…a9f0" */
const shortKey = (hex: string) => (hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex);

const samePerms = (a: TelemetryPerms, b: TelemetryPerms) => a.base === b.base && a.loc === b.loc && a.env === b.env;

/** "Base and Location are greyed: …" for the columns whose mode isn't "Per contact". */
function greyedNote(off: string[]): string | null {
  if (off.length === 0) return null;
  const names = off.length === 1 ? off[0] : `${off.slice(0, -1).join(', ')} and ${off[off.length - 1]}`;
  return `${names} ${off.length === 1 ? 'is' : 'are'} greyed: the radio reads these flags only for a mode set to “Per contact”.`;
}

export function TelemetryFlagsRail() {
  const client = useApiClient();
  const rows = useFlagRows();
  const policy = useStore((s) => s.telemetryPolicy);
  const connected = useStore((s) => s.transportState === 'connected');
  const [query, setQuery] = useState('');
  // Optimistic values per contact until the store's copy catches up.
  const [pending, setPending] = useState<Record<string, TelemetryPerms>>({});

  // Drop overrides the store now agrees with (main's discovered push, or the
  // contact refresh on a newer library).
  useEffect(() => {
    setPending((p) => {
      const keep = Object.entries(p).filter(([key, perms]) => {
        const row = rows.find((r) => r.key === key);
        return row !== undefined && !samePerms(row.perms, perms);
      });
      return keep.length === Object.keys(p).length ? p : Object.fromEntries(keep);
    });
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.publicKeyHex.startsWith(q));
  }, [rows, query]);

  const editable = !!client && connected;
  const live = (g: PermGroup) => policy[g] === MODE_PER_CONTACT;

  const toggle = async (key: string, name: string, current: TelemetryPerms, group: PermGroup, on: boolean) => {
    if (!client) return;
    const next = { ...current, [group]: on };
    setPending((p) => ({ ...p, [key]: next }));
    const rollback = () =>
      setPending((p) => {
        if (p[key] !== next) return p;
        const { [key]: _, ...rest } = p;
        return rest;
      });
    try {
      await api.putContactTelemetryPerms(client, key, next);
    } catch (err) {
      rollback();
      notify.error(`Telemetry flags save failed for ${name}: ${errorMessage(err)}`, err);
    }
  };

  const off = PERM_GROUPS.filter((g) => !live(g.key)).map((g) => g.label);
  const note = greyedNote(off);

  return (
    <div className="flex flex-col pb-2">
      <div className="mx-3 mb-2 flex h-6.5 items-center gap-1.75 rounded-[7px] border border-cs-border bg-cs-bg-2 px-2">
        <Search size={11} aria-hidden className="shrink-0 text-cs-text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts"
          aria-label="Search contacts"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-cs-text outline-none placeholder:text-cs-text-dim"
        />
      </div>

      <div className={cn(GRID, 'border-y border-cs-border px-3 py-1.5')}>
        <span className={LABEL_CAPS}>Contact</span>
        {PERM_GROUPS.map((g) => (
          <span
            key={g.key}
            title={g.label}
            className={cn(LABEL_CAPS, 'text-center', live(g.key) ? 'text-cs-text-muted' : 'text-cs-text-dim')}
          >
            {g.short}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-cs-text-dim">No chat contacts on the radio.</p>
      ) : visible.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-cs-text-dim">No contacts match “{query.trim()}”.</p>
      ) : (
        <ul aria-label="Telemetry flags per contact" className="flex flex-col py-1">
          {visible.map((r) => {
            const perms = pending[r.key] ?? r.perms;
            return (
              <li key={r.key} data-contact-key={r.key} className={cn(GRID, 'px-3 py-1.5')}>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-cs-text">{r.name}</div>
                  <div className={META}>{shortKey(r.publicKeyHex)}</div>
                </div>
                {PERM_GROUPS.map((g) => (
                  <span key={g.key} className="flex justify-center">
                    <Checkbox
                      checked={perms[g.key]}
                      disabled={!editable || !live(g.key)}
                      onCheckedChange={(v) => void toggle(r.key, r.name, perms, g.key, v === true)}
                      aria-label={`${r.name}: ${g.label}`}
                      className="data-[state=checked]:border-cs-accent data-[state=checked]:bg-cs-accent data-[state=checked]:text-cs-bg"
                    />
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {note && <p className="mt-1 border-t border-cs-border px-3 pt-2 text-[11px] leading-4 text-cs-text-muted">{note}</p>}
    </div>
  );
}
