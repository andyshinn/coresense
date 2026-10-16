import type { Hono } from 'hono';
import { getManifest, validateTemplate } from '../../../shared/macros';
import type { MacroContext, MacroRenderMode, MacroScope } from '../../../shared/macros/types';
import { emit } from '../../events/bus';
import { buildReplyContext, buildSendContext } from '../../macros/contextBuilder';
import { renderMacro } from '../../macros/service';
import { macrosStore } from '../../macros/store';
import { stateHolder } from '../../state/holder';
import { messagesStore } from '../../storage/messages';

export function registerMacroRoutes(api: Hono): void {
  // ----- Macros -----
  api.get('/api/macros', (c) => c.json(macrosStore.list()));

  api.get('/api/macros/manifest', (c) => c.json(getManifest()));

  api.post('/api/macros/validate', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { template?: string } | null;
    if (!body || typeof body.template !== 'string') return c.json({ error: 'template required' }, 400);
    return c.json(validateTemplate(body.template));
  });

  api.post('/api/macros', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      template?: string;
      scope?: MacroScope;
      channelKey?: string;
      contactKey?: string;
    } | null;
    if (!body?.name || typeof body.template !== 'string' || !body.scope) {
      return c.json({ error: 'name, template, scope required' }, 400);
    }
    // A MacroValidationError propagates to onApiError, which answers 400.
    const macro = macrosStore.add({
      name: body.name,
      template: body.template,
      scope: body.scope,
      channelKey: body.channelKey,
      contactKey: body.contactKey,
    });
    emit.macros(macrosStore.list());
    return c.json({ macro });
  });

  api.put('/api/macros/:id', async (c) => {
    const id = c.req.param('id');
    const patch = (await c.req.json().catch(() => null)) as Partial<{
      name: string;
      template: string;
      scope: MacroScope;
      channelKey: string;
      contactKey: string;
    }> | null;
    if (!patch) return c.json({ error: 'invalid body' }, 400);
    // A MacroValidationError propagates to onApiError, which answers 400.
    const updated = macrosStore.update(id, patch);
    if (!updated) return c.json({ error: 'not found' }, 404);
    emit.macros(macrosStore.list());
    return c.json({ macro: updated });
  });

  api.delete('/api/macros/:id', (c) => {
    const id = c.req.param('id');
    if (!macrosStore.remove(id)) return c.json({ error: 'not found' }, 404);
    emit.macros(macrosStore.list());
    return c.json({ ok: true });
  });

  api.post('/api/macros/render', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      macroId?: string;
      template?: string;
      mode?: MacroRenderMode;
      messageId?: string;
      contactKey?: string;
      channelKey?: string;
      placeholder?: string;
    } | null;
    if (!body || (!body.macroId && typeof body.template !== 'string')) {
      return c.json({ error: 'macroId or template required' }, 400);
    }
    const holder = stateHolder();
    const self = {
      owner: holder.getOwner(),
      deviceInfo: holder.getDeviceInfo(),
      deviceIdentity: holder.getDeviceIdentity(),
    };
    const channelName = body.channelKey
      ? (holder.getChannels().find((ch) => ch.key === body.channelKey)?.name ?? body.channelKey.replace(/^ch:/, ''))
      : null;

    let context: MacroContext;
    if (body.mode === 'reply') {
      const message = body.messageId ? messagesStore.findById(body.messageId) : null;
      if (!message) return c.json({ error: 'message not found' }, 404);
      const senderContact = message.fromPublicKeyHex
        ? (holder.getContacts().find((ct) => ct.publicKeyHex === message.fromPublicKeyHex) ?? null)
        : null;
      const repeaters = holder.getContacts().filter((ct) => ct.kind === 'repeater');
      context = buildReplyContext({ self, message, senderContact, channelName, repeaters });
    } else {
      const peerContact = body.contactKey ? (holder.getContacts().find((ct) => ct.key === body.contactKey) ?? null) : null;
      context = buildSendContext({ self, peerContact, channelName });
    }

    if (body.macroId && !macrosStore.list().some((m) => m.id === body.macroId)) {
      return c.json({ error: 'macro not found' }, 404);
    }
    const result = renderMacro(body.macroId ?? (body.template as string), context, { placeholder: body.placeholder });
    return c.json(result);
  });
}
