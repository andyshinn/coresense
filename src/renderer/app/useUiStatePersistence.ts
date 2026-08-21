import { useEffect } from 'react';
import type { UiState } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

/** Longest a `ui` change can sit unwritten while something is bursting. */
const UI_STATE_COALESCE_MS = 250;

let flushImpl: (() => Promise<void>) | null = null;

/** Write any coalesced `ui` change now. Resolves once it has landed. */
export function flushUiState(): Promise<void> {
  return flushImpl?.() ?? Promise.resolve();
}

/**
 * Persists `ui` to ui-state.json.
 *
 * Deliberately NOT `useStore((s) => s.ui)`. Reading it through the hook
 * subscribed the App ROOT to every `ui` mutation, and with no memo boundary
 * anywhere below it, that re-rendered the whole tree. Persistence is the only
 * consumer of the whole object, so it subscribes outside React's render cycle.
 *
 * Keep it that way: a component that selects `ui` wholesale brings the cascade
 * straight back. Select the individual fields you need.
 *
 * Writes are LEADING-edge coalesced, not debounced: the first change goes out
 * immediately (a pin or a rail toggle is durable at once, where the old 500ms
 * trailing debounce made it wait), and anything arriving inside the window
 * collapses into a single trailing write. Composer keystrokes no longer reach
 * this path at all — drafts moved to their own slice and their own file — but
 * `markRead` still fires per visible-range tick while scrolling a large unread
 * backlog, and each advance mutates ui.lastReadByKey. That burst is what the
 * window is for. There is no boundary event to hang a scroll cursor on, and it
 * has to survive a restart, so coalescing is the right tool here.
 */
export function useUiStatePersistence(client: ApiClient | null, hydrated: boolean): void {
  useEffect(() => {
    if (!client || !hydrated) return;

    // Seeded from what the server already has, so hydrating a snapshot doesn't
    // immediately PUT back the very object main just sent us.
    let sent: UiState | null = useStore.getState().ui;
    let lastWriteAt = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let chain: Promise<void> = Promise.resolve();

    const write = (): Promise<void> => {
      const ui = useStore.getState().ui;
      if (ui === sent) return chain;
      sent = ui;
      lastWriteAt = Date.now();
      chain = chain.then(async () => {
        try {
          await api.putUiState(client, ui);
        } catch {
          // Non-fatal; renderer state is the source of truth for this session.
        }
      });
      return chain;
    };

    const flush = (): Promise<void> => {
      if (trailing) {
        clearTimeout(trailing);
        trailing = undefined;
      }
      return write();
    };
    flushImpl = flush;

    const schedule = () => {
      if (trailing) return; // a trailing write is already booked
      const since = Date.now() - lastWriteAt;
      if (since >= UI_STATE_COALESCE_MS) {
        void write();
        return;
      }
      trailing = setTimeout(() => {
        trailing = undefined;
        void write();
      }, UI_STATE_COALESCE_MS - since);
    };

    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.ui !== prev.ui) schedule();
    });
    // Cover anything that landed between the render that mounted us and here.
    if (useStore.getState().ui !== sent) schedule();

    return () => {
      unsubscribe();
      if (trailing) clearTimeout(trailing);
      flushImpl = null;
    };
  }, [client, hydrated]);
}
