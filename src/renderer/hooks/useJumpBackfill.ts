import { useEffect, useRef } from 'react';
import type { Message } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

/**
 * Fetch the history around a pending jump target that isn't loaded.
 *
 * Search runs FTS over the whole `messages` table, but a conversation only ever
 * loads its trailing window (200 rows). Clicking a hit older than that used to
 * do nothing at all: the list had no such row, so the scroll silently no-oped
 * and the user was left staring at the bottom of the conversation with no
 * feedback. Per-key history is unbounded in production — `trimPerKey` has no
 * caller — so this gap has no upper size.
 *
 * `applyMessages` merges by id, so the centred window splices into whatever is
 * already held rather than replacing it, and the jump stays pending until the
 * row actually exists (MessageList only consumes a jump it can see).
 */
export function useJumpBackfill(client: ApiClient | null, conversationKey: string, jumpToId: string | null): void {
  const messages = useStore((s) => s.messagesByKey[conversationKey]);
  const applyMessages = useStore((s) => s.applyMessages);
  // One fetch per target. Without this the effect would re-fire on every
  // broadcast for a target that genuinely no longer exists (deleted, or in
  // another conversation), hammering the API.
  const attemptedRef = useRef<string | null>(null);

  const loaded = jumpToId != null && (messages?.some((m: Message) => m.id === jumpToId) ?? false);

  useEffect(() => {
    if (!client || !jumpToId || loaded) return;
    if (attemptedRef.current === jumpToId) return;
    attemptedRef.current = jumpToId;

    let cancelled = false;
    void (async () => {
      try {
        const window = await api.getMessages(client, conversationKey, { around: jumpToId });
        if (!cancelled) applyMessages(conversationKey, window);
      } catch {
        // Non-fatal: the conversation keeps whatever it already had, and the
        // jump quietly expires rather than blocking the view.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, conversationKey, jumpToId, loaded, applyMessages]);
}
