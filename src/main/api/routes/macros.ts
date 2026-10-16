import type { Hono } from 'hono';
import {
  macroPatchBodySchema,
  newMacroBodySchema,
  renderMacroBodySchema,
  validateMacroBodySchema,
} from '../../../shared/api/schemas';
import { getManifest, validateTemplate } from '../../../shared/macros';
import { emit } from '../../events/bus';
import { buildMacroContextForRequest } from '../../macros/requestContext';
import { renderMacro } from '../../macros/service';
import { macrosStore } from '../../macros/store';
import { readJson } from '../body';

export function registerMacroRoutes(api: Hono): void {
  // ----- Macros -----
  api.get('/api/macros', (c) => c.json(macrosStore.list()));

  api.get('/api/macros/manifest', (c) => c.json(getManifest()));

  api.post('/api/macros/validate', async (c) => {
    const { template } = await readJson(c, validateMacroBodySchema);
    return c.json(validateTemplate(template));
  });

  api.post('/api/macros', async (c) => {
    const body = await readJson(c, newMacroBodySchema);
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
    const patch = await readJson(c, macroPatchBodySchema);
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
    const body = await readJson(c, renderMacroBodySchema);
    // Check the macro before doing any lookups for its context.
    if (body.macroId && !macrosStore.list().some((m) => m.id === body.macroId)) {
      return c.json({ error: 'macro not found' }, 404);
    }
    const context = buildMacroContextForRequest(body);
    if (!context) return c.json({ error: 'message not found' }, 404);
    const result = renderMacro(body.macroId ?? body.template ?? '', context, { placeholder: body.placeholder });
    return c.json(result);
  });
}
