import type { Contact, MessageHop } from '../../../shared/types';

/** Generate a short opaque id for a synthetic Hop row. */
export function makeId(): string {
  return `hop-${Math.random().toString(36).slice(2, 10)}`;
}

/** All known repeaters whose pubkey starts with this hop's shortId prefix. */
export function candidatesFor(hop: MessageHop, knownRepeaters: Contact[]): Contact[] {
  if (hop.kind !== 'hop' || hop.shortId.length === 0) return [];
  const prefix = hop.shortId.toLowerCase();
  return knownRepeaters.filter((c) => c.publicKeyHex.toLowerCase().startsWith(prefix));
}

export interface ResolvedHop {
  candidates: Contact[];
  /** The first candidate, which the path viewer shows the hop as. */
  resolved: Contact | null;
  /** The hop's display name: the resolved repeater's, else the hop's own unless
   *  it is unnamed, else "Unknown sender" / "Unknown repeater". */
  label: string;
  /** More than one known repeater shares the prefix. */
  hasConflict: boolean;
}

/** One hop's resolution against the known repeaters, shared by the path summary
 *  row and the timeline so the precedence and fallback copy can't drift. */
export function resolveHop(hop: MessageHop, knownRepeaters: Contact[]): ResolvedHop {
  const candidates = candidatesFor(hop, knownRepeaters);
  const resolved = candidates[0] ?? null;
  const displayName = resolved ? resolved.name : hop.unnamed ? null : (hop.name ?? null);
  const label = displayName ?? (hop.kind === 'origin' ? 'Unknown sender' : 'Unknown repeater');
  return { candidates, resolved, label, hasConflict: candidates.length > 1 };
}
