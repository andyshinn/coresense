import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Message } from '../../shared/types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
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
