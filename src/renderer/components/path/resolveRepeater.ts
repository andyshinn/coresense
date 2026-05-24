import type { Contact, MessageHop, PathHashSize } from '../../../shared/types';

/** Split a contiguous hex string into per-hop chunks of `hashSize` bytes
 *  (i.e. hashSize*2 hex chars), discarding any trailing fragment. */
export function splitHopsHex(hex: string, hashSize: PathHashSize): string[] {
  const chunkLen = hashSize * 2;
  const out: string[] = [];
  for (let i = 0; i + chunkLen <= hex.length; i += chunkLen) {
    out.push(hex.slice(i, i + chunkLen));
  }
  return out;
}

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

/** Humanised "Nm ago" / "Nh ago" / "Nd ago" relative timestamp. */
export function formatLastSeen(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** First repeater whose pubkey hex starts with `prefix` (case-insensitive). */
export function resolveRepeaterForPrefix(
  prefix: string,
  repeaters: Contact[],
): Contact | undefined {
  if (prefix.length === 0) return undefined;
  const lower = prefix.toLowerCase();
  return repeaters.find(
    (c) => c.kind === 'repeater' && c.publicKeyHex.toLowerCase().startsWith(lower),
  );
}
