import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { isChannelKey, isContactKey } from '../../../../shared/conversationKey';
import { errorMessage } from '../../../../shared/errors';
import { MACRO_PLACEHOLDER } from '../../../../shared/macros';
import type { MacroRenderMode, MacroTemplate } from '../../../../shared/macros/types';

/** Map a conversation key (`ch:…` / `c:…`) to the render-context binding the
 *  macro engine expects, so peer/channel variables resolve. */
export function targetToContext(targetKey: string | undefined): { channelKey?: string; contactKey?: string } {
  if (targetKey && isChannelKey(targetKey)) return { channelKey: targetKey };
  if (targetKey && isContactKey(targetKey)) return { contactKey: targetKey };
  return {};
}

/** What a macro renders against: the mode, plus the received message (reply) or
 *  the conversation (send) that binds its variables. */
export interface MacroRenderTarget {
  mode: MacroRenderMode;
  messageId?: string;
  channelKey?: string;
  contactKey?: string;
}

export type MacroRenderOutcome = { ok: true; text: string } | { ok: false; message: string; cause?: unknown };

/** Render a stored macro on the server. Never rejects: a transport failure
 *  (non-2xx, network) comes back as a failed outcome, the same as a template
 *  error, so no caller can leave an unhandled rejection behind. */
export async function renderMacroSafe(
  client: ApiClient,
  macroId: string,
  target: MacroRenderTarget,
): Promise<MacroRenderOutcome> {
  try {
    const res = await api.renderMacro(client, { macroId, ...target, placeholder: MACRO_PLACEHOLDER });
    return res.ok ? { ok: true, text: res.text } : { ok: false, message: res.error.message };
  } catch (err) {
    return { ok: false, message: errorMessage(err), cause: err };
  }
}

/** Render a macro for insertion into the composer. Returns null and surfaces a
 *  toast on any failure. */
async function expandOrToast(
  client: ApiClient | null,
  macro: MacroTemplate,
  target: MacroRenderTarget,
): Promise<string | null> {
  if (!client) return null;
  const res = await renderMacroSafe(client, macro.id, target);
  if (res.ok) return res.text;
  const msg = `Couldn’t expand “${macro.name}”: ${res.message}`;
  if (res.cause === undefined) notify.error(msg);
  else notify.error(msg, res.cause);
  return null;
}

/** Expand a macro to plain text in the *send* context (composing a new
 *  message). Returns null and surfaces a toast on failure. */
export function expandMacro(
  client: ApiClient | null,
  macro: MacroTemplate,
  targetKey: string | undefined,
): Promise<string | null> {
  return expandOrToast(client, macro, { mode: 'send', ...targetToContext(targetKey) });
}

/** Render a macro against a received message's reply context, for insertion
 *  into the composer. Returns null and surfaces a toast on failure. */
export function expandMacroReply(
  client: ApiClient | null,
  macro: MacroTemplate,
  message: { id: string },
): Promise<string | null> {
  return expandOrToast(client, macro, { mode: 'reply', messageId: message.id });
}
