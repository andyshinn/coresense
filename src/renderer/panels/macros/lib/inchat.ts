import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
import type { MacroTemplate } from '../../../../shared/macros/types';

/** Map a conversation key (`ch:…` / `c:…`) to the render-context binding the
 *  macro engine expects, so peer/channel variables resolve. */
export function targetToContext(targetKey: string | undefined): { channelKey?: string; contactKey?: string } {
  if (targetKey?.startsWith('ch:')) return { channelKey: targetKey };
  if (targetKey?.startsWith('c:')) return { contactKey: targetKey };
  return {};
}

/** Expand a macro to plain text in the *send* context (composing a new
 *  message). Returns null and surfaces a toast on render failure. */
export async function expandMacro(
  client: ApiClient | null,
  macro: MacroTemplate,
  targetKey: string | undefined,
): Promise<string | null> {
  if (!client) return null;
  const res = await api.renderMacro(client, {
    macroId: macro.id,
    mode: 'send',
    ...targetToContext(targetKey),
    placeholder: '?',
  });
  if (res.ok) return res.text;
  notify.error(`Couldn’t expand “${macro.name}”: ${res.error.message}`);
  return null;
}

/** Render a macro against a received message's reply context, for insertion
 *  into the composer. Returns null and surfaces a toast on render failure. */
export async function expandMacroReply(
  client: ApiClient | null,
  macro: MacroTemplate,
  message: { id: string },
): Promise<string | null> {
  if (!client) return null;
  try {
    const res = await api.renderMacro(client, { macroId: macro.id, mode: 'reply', messageId: message.id, placeholder: '?' });
    if (res.ok) return res.text;
    notify.error(`Couldn’t expand “${macro.name}”: ${res.error.message}`);
    return null;
  } catch (err) {
    notify.error(`Couldn’t expand “${macro.name}”: ${(err as Error).message}`, err);
    return null;
  }
}
