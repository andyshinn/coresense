import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Channel messages carry no public key; the protocol layer encodes the
// originating node's display name as `fromPublicKeyHex = "name:<name>"`.
// Strip that prefix so callers can show the bare name. Returns '' when there
// is no usable name (owner-sent, or an unidentified sender).
export function deriveSenderName(fromPublicKeyHex: string | undefined): string {
  if (!fromPublicKeyHex) return '';
  if (fromPublicKeyHex === 'unknown') return '';
  if (fromPublicKeyHex.startsWith('name:')) return fromPublicKeyHex.slice(5);
  return `${fromPublicKeyHex.slice(0, 8)}…`;
}
