import type { DiscoveredContact } from '../../../shared/contacts/discovered';
import type { Contact, TelemetryPerms, TelemetryPolicy } from '../../../shared/types';
import { useStore } from '../../lib/store';

// Per-contact telemetry flags on MY radio (contact flags bits 1–3): which
// chat contacts may read which telemetry group when that group's policy is
// "Per contact". Only chat contacts ask a companion for telemetry.

export type PermGroup = keyof TelemetryPerms;

export const PERM_GROUPS: ReadonlyArray<{ key: PermGroup; label: string; short: string; noun: string }> = [
  { key: 'base', label: 'Base', short: 'Base', noun: 'base telemetry' },
  { key: 'loc', label: 'Location', short: 'Loc', noun: 'location' },
  { key: 'env', label: 'Environment', short: 'Env', noun: 'environment' },
];

/** Policy mode values (firmware NodePrefs): 0 deny, 1 per contact (flags), 2 everyone. */
export const MODE_DENY = 0;
export const MODE_PER_CONTACT = 1;
export const MODE_EVERYONE = 2;

export interface FlagRow {
  key: string;
  name: string;
  publicKeyHex: string;
  perms: TelemetryPerms;
}

const NONE: TelemetryPerms = { base: false, loc: false, env: false };

export const anyPerm = (p: TelemetryPerms): boolean => p.base || p.loc || p.env;

const samePerms = (a: TelemetryPerms, b: TelemetryPerms) => a.base === b.base && a.loc === b.loc && a.env === b.env;

const sameRows = (a: readonly FlagRow[], b: readonly FlagRow[]) =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i];
    return r.key === o.key && r.name === o.name && r.publicKeyHex === o.publicKeyHex && samePerms(r.perms, o.perms);
  });

// One cache for every subscriber (PolicyCard and the flags rail). `contacts`
// and `discovered` are re-broadcast up to once a second on a busy mesh while
// the flags almost never change: rebuild only when either array is new, and
// hand back the previous rows when their content didn't change, so the
// subscribers don't re-render.
interface FlagSource {
  contacts: readonly Contact[];
  discovered: readonly DiscoveredContact[];
}

let cache: (FlagSource & { rows: readonly FlagRow[] }) | null = null;

function selectFlagRows(s: FlagSource): readonly FlagRow[] {
  if (cache && cache.contacts === s.contacts && cache.discovered === s.discovered) return cache.rows;
  const stored = new Map(s.discovered.map((d) => [d.key, d.telemetryPerms]));
  const rows = s.contacts
    .filter((c) => c.kind === 'chat')
    .map((c) => ({
      key: c.key,
      name: c.name,
      publicKeyHex: c.publicKeyHex,
      perms: c.telemetryPerms ?? stored.get(c.key) ?? NONE,
    }))
    .sort((a, b) => Number(anyPerm(b.perms)) - Number(anyPerm(a.perms)) || a.name.localeCompare(b.name));
  const next = cache && sameRows(cache.rows, rows) ? cache.rows : rows;
  cache = { contacts: s.contacts, discovered: s.discovered, rows: next };
  return next;
}

/**
 * The radio's chat contacts with their flags, flagged first, then by name.
 * The contact's own `telemetryPerms` wins; a placeholder contact (synthesised
 * from a message, never reported by the radio) has none, and falls back to
 * the stored flags byte on the discovered row. The same array
 * until a row's content changes.
 */
export function useFlagRows(): readonly FlagRow[] {
  return useStore(selectFlagRows);
}

/** "3 contacts can read location, 5 can read environment." for the groups on "Per contact"; null when none is. */
export function perContactSummary(policy: TelemetryPolicy, rows: readonly FlagRow[]): string | null {
  const parts = PERM_GROUPS.filter((g) => policy[g.key] === MODE_PER_CONTACT).map((g, i) => {
    const n = rows.filter((r) => r.perms[g.key]).length;
    const who = i === 0 ? `${n} ${n === 1 ? 'contact' : 'contacts'}` : `${n}`;
    return `${who} can read ${g.noun}`;
  });
  return parts.length > 0 ? `${parts.join(', ')}.` : null;
}
