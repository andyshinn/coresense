import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Message } from '../../shared/types';

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

// The earliest unread message worth jumping to: ts beyond the last-read marker
// and sent by someone other than the owner (owner-sent rows have no
// fromPublicKeyHex). Used by the notification "focusFirstUnread" action.
export function firstUnreadMessageId(messages: Message[], lastRead: number): string | null {
  for (const m of messages) {
    if (m.ts > lastRead && m.fromPublicKeyHex !== undefined) return m.id;
  }
  return null;
}
