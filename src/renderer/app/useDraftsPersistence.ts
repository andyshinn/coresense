import { useEffect } from 'react';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

/**
 * Persists composer drafts to drafts.json.
 *
 * There is no timer here, by design. Draft text changes on every keystroke, and
 * gating that on a debounce means every character is racing a clock. Instead
 * writes happen at the boundaries where the user has actually finished with a
 * draft for now:
 *
 *   - the draft was cleared or sent (flushed immediately — a sent draft that
 *     resurrects on relaunch is the worst failure mode here)
 *   - the user navigated somewhere else (ui.activeKey changed)
 *   - the window lost focus
 *   - the composer lost focus (Composer calls flushDrafts on blur)
 *   - the app is quitting (menuActions awaits flushDrafts)
 *
 * Writes are serialised through a single chain so a later flush can never land
 * behind an earlier one. Each write sends ONE key, so two windows editing
 * different conversations don't clobber each other.
 *
 * Not covered, and not claimed to be: renderer crash, devtools reload, SIGKILL.
 * Drafts are cheap to retype; the tradeoff is deliberate.
 */

let flushImpl: (() => Promise<void>) | null = null;

/** Flush any unwritten drafts. Resolves once they have landed. Safe to call
 *  when the hook isn't mounted (resolves immediately). */
export function flushDrafts(): Promise<void> {
  return flushImpl?.() ?? Promise.resolve();
}

function changedKeys(prev: Record<string, string>, next: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: string[] = [];
  for (const key of keys) if (prev[key] !== next[key]) out.push(key);
  return out;
}

export function useDraftsPersistence(client: ApiClient | null, hydrated: boolean): void {
  useEffect(() => {
    if (!client || !hydrated) return;

    // Keys whose on-disk value no longer matches the store.
    const pending = new Set<string>();
    let chain: Promise<void> = Promise.resolve();

    const flush = (): Promise<void> => {
      if (pending.size === 0) return chain;
      const keys = [...pending];
      pending.clear();
      const drafts = useStore.getState().drafts;
      chain = chain.then(async () => {
        for (const key of keys) {
          try {
            await api.putDraft(client, key, drafts[key] ?? '');
          } catch {
            // Non-fatal; the store is the source of truth for this session.
          }
        }
      });
      return chain;
    };
    flushImpl = flush;

    let prevDrafts = useStore.getState().drafts;
    let prevActiveKey = useStore.getState().ui.activeKey;
    let prevFocused = useStore.getState().windowFocused;

    const unsubscribe = useStore.subscribe((s) => {
      if (s.drafts !== prevDrafts) {
        const keys = changedKeys(prevDrafts, s.drafts);
        // A removal means the draft was sent or cleared. Write it through now:
        // if that delete never lands, the next launch re-offers text the user
        // already sent.
        const removed = keys.some((k) => s.drafts[k] === undefined);
        prevDrafts = s.drafts;
        for (const key of keys) pending.add(key);
        if (removed) void flush();
      }

      if (s.ui.activeKey !== prevActiveKey) {
        prevActiveKey = s.ui.activeKey;
        void flush();
      }

      if (s.windowFocused !== prevFocused) {
        const lostFocus = prevFocused && !s.windowFocused;
        prevFocused = s.windowFocused;
        if (lostFocus) void flush();
      }
    });

    return () => {
      unsubscribe();
      void flush();
      flushImpl = null;
    };
  }, [client, hydrated]);
}
