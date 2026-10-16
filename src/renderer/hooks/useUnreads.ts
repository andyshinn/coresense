import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { collectMutedKeys, computeUnreadByKey, computeUnreadConversations, type UnreadConversation } from '../lib/unreads';

// Store-subscribed, memoised views of lib/unreads.ts, which holds what
// "unread" means.

// Counts-only hook — what the LeftNav needs for its unread badges.
export function useUnreadByKey(): Record<string, number> {
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  return useMemo(
    () => computeUnreadByKey(messagesByKey, lastReadByKey, collectMutedKeys(channels, contacts)),
    [messagesByKey, lastReadByKey, channels, contacts],
  );
}

// Rich aggregate hook — what the Unreads panel needs.
export function useUnreadConversations(): UnreadConversation[] {
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);

  return useMemo(
    () => computeUnreadConversations(messagesByKey, lastReadByKey, channels, contacts),
    [messagesByKey, lastReadByKey, channels, contacts],
  );
}
