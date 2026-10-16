import type { Hono } from 'hono';
import { searchOptionsSchema, sendMessageBodySchema } from '../../../shared/api/schemas';
import { conversationKind, isChannelKey } from '../../../shared/conversationKey';
import { emit } from '../../events/bus';
import { sendMessage } from '../../messaging/sendMessage';
import { stateHolder } from '../../state/holder';
import { searchMessages } from '../../storage/search';
import { readJson } from '../body';

export function registerMessageRoutes(api: Hono): void {
  api.get('/api/messages/:key', (c) => {
    const key = c.req.param('key');
    const limit = Number(c.req.query('limit') ?? '200');
    const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
    // `around=<mid>` returns a window centred on that message instead of the
    // trailing one, so a search hit older than the default window can be
    // scrolled to. Unknown ids fall back to the trailing window.
    const around = c.req.query('around') || undefined;
    return c.json(stateHolder().getMessagesForKey(key, { limit, before, around }));
  });

  api.post('/api/messages/:key', async (c) => {
    const key = c.req.param('key');
    if (conversationKind(key) === null) {
      return c.json({ error: 'key must be ch:<name> or c:<pubkey>' }, 400);
    }
    const body = await readJson(c, sendMessageBodySchema);
    const result = await sendMessage(key, body.body);
    if (isChannelKey(key)) {
      return result.ok ? c.json({ ok: true, id: result.id }) : c.json({ error: result.error }, 503);
    }
    return c.json({ ok: true, id: result.id });
  });

  // Local-only. MeshCore has no retract primitive, so unlike DELETE
  // /api/contacts/:key there is no radio round-trip to make and nothing to
  // desync with. A tombstone stops a re-heard packet resurrecting the row.
  api.delete('/api/messages/:key/:id', (c) => {
    const key = c.req.param('key');
    const id = c.req.param('id');
    if (conversationKind(key) === null) {
      return c.json({ error: 'key must be ch:<name> or c:<pubkey>' }, 400);
    }
    // The delete is scoped to `key` inside the DAO, so an id belonging to a
    // different conversation removes nothing and 404s here. The emitted key
    // drives the renderer's per-key cache prune and is exactly the key whose
    // rows were removed.
    const removed = stateHolder().removeMessages(key, [id]);
    if (removed.length === 0) return c.json({ error: 'not found' }, 404);
    emit.messagesDeleted({ key, ids: removed });
    return c.json({ ok: true });
  });

  // Full-text search over messages + conversations. Always a POST so the
  // (potentially long) query body isn't URL-encoded into a GET. Synchronous —
  // even at 100k messages, FTS5 returns in single-digit ms.
  api.post('/api/search', async (c) => {
    const body = await readJson(c, searchOptionsSchema);
    return c.json(searchMessages(body, stateHolder().getSearchBlockContext()));
  });
}
