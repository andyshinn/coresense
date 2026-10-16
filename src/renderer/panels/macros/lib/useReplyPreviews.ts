import { useEffect, useState } from 'react';
import { useApiClient } from '@/lib/apiClientContext';
import type { MacroTemplate } from '../../../../shared/macros/types';
import { renderMacroSafe } from './inchat';

export type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; len: number }
  | { status: 'error'; message: string };

/** Render every macro against one message's reply context, keyed by macro id.
 *
 *  Fetches when the panel opens, when `messageId` changes while open, or when
 *  the applicable-macro *id list* changes (add/remove/reorder) while open.
 *  Editing a macro's template in place (same id) does not refresh an
 *  already-open panel — that's picked up on the next open. Never caches
 *  across opens, because reply context holds time-varying values
 *  (`received_ago`, `peer_last_seen`) and a stale preview would disagree with
 *  the text actually inserted. */
export function useReplyPreviews(messageId: string, macros: MacroTemplate[], open: boolean): Record<string, PreviewState> {
  const client = useApiClient();
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  // Stable string projection of the macro set — `macros` is a fresh array on
  // every render, so it can't be an effect dependency directly.
  const ids = macros.map((m) => m.id).join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` stands in for `macros`, which is a new array each render
  useEffect(() => {
    if (!open || !client || macros.length === 0) {
      setPreviews({});
      return;
    }
    let cancelled = false;
    setPreviews(Object.fromEntries(macros.map((m) => [m.id, { status: 'loading' } as PreviewState])));
    void Promise.all(
      macros.map(async (m) => {
        // renderMacroSafe settles per macro, never rejecting: one transport
        // failure must not leave every other row stuck on 'loading'.
        const res = await renderMacroSafe(client, m.id, { mode: 'reply', messageId });
        const state: PreviewState = res.ok
          ? { status: 'ok', text: res.text, len: res.text.length }
          : { status: 'error', message: res.message };
        return [m.id, state] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [open, client, messageId, ids]);

  return previews;
}
