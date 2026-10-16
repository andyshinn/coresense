import type { Hono } from 'hono';
import type { AddBlockRulesResponse, BlockRuleResponse } from '../../../shared/api/contract';
import { addBlockRulesBodySchema, blockRulePatchSchema } from '../../../shared/api/schemas';
import { stateHolder } from '../../state/holder';
import { readJson } from '../body';

export function registerBlockRoutes(api: Hono): void {
  // ----- Block rules -----
  // POST /api/blocks — bulk add (the dialog ticks N identifiers → N rules).
  api.post('/api/blocks', async (c) => {
    const body = await readJson(c, addBlockRulesBodySchema);
    const holder = stateHolder();
    const inserted = holder.addBlockRules(body.rules);
    return c.json({ rules: inserted } satisfies AddBlockRulesResponse);
  });

  // PUT /api/blocks/:id — edit pattern / note / tsFrom / enabled.
  api.put('/api/blocks/:id', async (c) => {
    const id = c.req.param('id');
    const patch = await readJson(c, blockRulePatchSchema);
    const updated = stateHolder().updateBlockRule(id, patch);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ rule: updated } satisfies BlockRuleResponse);
  });

  // DELETE /api/blocks/:id — remove the rule entirely.
  api.delete('/api/blocks/:id', (c) => {
    const id = c.req.param('id');
    const ok = stateHolder().removeBlockRule(id);
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });
}
