import type { Hono } from 'hono';
import type { BlockRuleType } from '../../../shared/types';
import { stateHolder } from '../../state/holder';

export function registerBlockRoutes(api: Hono): void {
  // ----- Block rules -----
  // POST /api/blocks — bulk add (the dialog ticks N identifiers → N rules).
  api.post('/api/blocks', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      rules?: Array<{
        type: BlockRuleType;
        pattern: string;
        tsFrom: number;
        enabled: boolean;
        note?: string;
      }>;
    } | null;
    if (!body || !Array.isArray(body.rules) || body.rules.length === 0) {
      return c.json({ error: 'rules required' }, 400);
    }
    const holder = stateHolder();
    const inserted = holder.addBlockRules(body.rules);
    return c.json({ rules: inserted });
  });

  // PUT /api/blocks/:id — edit pattern / note / tsFrom / enabled.
  api.put('/api/blocks/:id', async (c) => {
    const id = c.req.param('id');
    const patch = (await c.req.json().catch(() => null)) as Partial<{
      pattern: string;
      tsFrom: number;
      enabled: boolean;
      note: string;
    }> | null;
    if (!patch) return c.json({ error: 'invalid body' }, 400);
    const updated = stateHolder().updateBlockRule(id, patch);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ rule: updated });
  });

  // DELETE /api/blocks/:id — remove the rule entirely.
  api.delete('/api/blocks/:id', (c) => {
    const id = c.req.param('id');
    const ok = stateHolder().removeBlockRule(id);
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });
}
