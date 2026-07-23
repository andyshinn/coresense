import { useEffect, useState } from 'react';
import { type ApiClient, api } from '@/lib/api';
import type { MacroTemplate } from '../../../../shared/macros/types';

export type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; len: number }
  | { status: 'error'; message: string };

/** Render every macro against one message's reply context, keyed by macro id.
 *
 *  Fetches when the panel opens and whenever the message or the macro set
 *  changes while open; never caches across opens, because reply context holds
 *  time-varying values (`received_ago`, `peer_last_seen`) and a stale preview
 *  would disagree with the text actually inserted. */
export function useReplyPreviews(
  client: ApiClient | null,
  messageId: string,
  macros: MacroTemplate[],
  open: boolean,
): Record<string, PreviewState> {
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
        // Catch per-macro: one transport failure must not leave every other
        // row stuck on 'loading'.
        try {
          const res = await api.renderMacro(client, {
            macroId: m.id,
            mode: 'reply',
            messageId,
            placeholder: '?',
          });
          const state: PreviewState = res.ok
            ? { status: 'ok', text: res.text, len: res.text.length }
            : { status: 'error', message: res.error.message };
          return [m.id, state] as const;
        } catch (err) {
          return [m.id, { status: 'error', message: (err as Error).message }] as const;
        }
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
