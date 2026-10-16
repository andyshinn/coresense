import type { Hono } from 'hono';
import { channelSchema, reorderChannelsBodySchema } from '../../../shared/api/schemas';
import { isChannelKey } from '../../../shared/conversationKey';
import { pushChannelToDevice, removeChannelFromDevice } from '../../channels/deviceSlots';
import { emit } from '../../events/bus';
import { stateHolder } from '../../state/holder';
import { readJson } from '../body';

export function registerChannelRoutes(api: Hono): void {
  // Conversation keys (`ch:<name>` / `c:<pubkeyHex>`) arrive percent-encoded and
  // Hono decodes them for us, so `c.req.param('key')` is already the real key —
  // do NOT decodeURIComponent it again. A second pass throws URIError on any
  // name holding a literal '%' (`ch:100% Club` → '% C' is not a valid escape),
  // which surfaced as a 500 on every route that touched such a channel.
  api.get('/api/channels', (c) => c.json(stateHolder().getChannels()));
  api.get('/api/channels/:key/stats', (c) => {
    const key = c.req.param('key');
    if (!isChannelKey(key)) return c.json({ error: 'not a channel key' }, 400);
    return c.json(stateHolder().getChannelStats(key));
  });
  api.get('/api/channels/:key/activity', (c) => {
    const key = c.req.param('key');
    if (!isChannelKey(key)) return c.json({ error: 'not a channel key' }, 400);
    return c.json(stateHolder().getChannelActivity(key));
  });
  api.put('/api/channels/:key', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, channelSchema);
    if (body.key !== key) return c.json({ error: 'body key does not match the path', code: 'invalid_body' }, 400);
    const holder = stateHolder();
    holder.upsertChannel(body);
    emit.channels(holder.getChannels());
    return c.json({ ok: true });
  });
  api.delete('/api/channels/:key', (c) => {
    const key = c.req.param('key');
    const holder = stateHolder();
    holder.removeChannel(key);
    emit.channels(holder.getChannels());
    return c.json({ ok: true });
  });

  // Reorder: renderer sends the full key array in desired order. We rewrite
  // each channel's `order` field by position. Unknown keys are ignored.
  api.post('/api/channels/reorder', async (c) => {
    const body = await readJson(c, reorderChannelsBodySchema);
    const holder = stateHolder();
    const orderByKey = new Map(body.keys.map((k, i) => [k, i]));
    const next = holder.getChannels().map((ch) => {
      const o = orderByKey.get(ch.key);
      return o === undefined ? ch : { ...ch, order: o };
    });
    holder.setChannels(next);
    emit.channels(next);
    return c.json({ ok: true });
  });

  // Device slot writes; see channels/deviceSlots.ts.
  api.post('/api/channels/:key/push-to-device', async (c) => {
    const key = c.req.param('key');
    const res = await pushChannelToDevice(key);
    switch (res.status) {
      case 'unknown':
        return c.json({ error: `unknown channel ${key}` }, 404);
      case 'noFreeSlot':
        return c.json({ error: 'all 16 channel slots are in use' }, 409);
      case 'rejected':
        return c.json({ error: res.message }, 503);
      default:
        return c.json({ ok: true, idx: res.idx });
    }
  });

  api.post('/api/channels/:key/remove-from-device', async (c) => {
    const key = c.req.param('key');
    const res = await removeChannelFromDevice(key);
    switch (res.status) {
      case 'unknown':
        return c.json({ error: `unknown channel ${key}` }, 404);
      case 'noSlot':
        return c.json({ error: 'channel has no known device slot' }, 409);
      case 'rejected':
        return c.json({ error: res.message }, 503);
      default:
        return c.json({ ok: true });
    }
  });
}
