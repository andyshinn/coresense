import type { Hono } from 'hono';
import { isChannelKey } from '../../../shared/conversationKey';
import type { Channel } from '../../../shared/types';
import { emit } from '../../events/bus';
import { protocolSession } from '../../protocol';
import { stateHolder } from '../../state/holder';

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
    const body = (await c.req.json().catch(() => null)) as Channel | null;
    if (!body || body.key !== key) return c.json({ error: 'invalid body' }, 400);
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
    const body = (await c.req.json().catch(() => null)) as { keys?: string[] } | null;
    if (!body || !Array.isArray(body.keys)) return c.json({ error: 'invalid body' }, 400);
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

  // Push an app-stored channel to a free slot on the connected device. If the
  // channel already has a confirmed `idx` (i.e. it's already on the device),
  // we overwrite that slot — effectively an "edit in place".
  api.post('/api/channels/:key/push-to-device', async (c) => {
    const key = c.req.param('key');
    const holder = stateHolder();
    const channel = holder.getChannels().find((ch) => ch.key === key);
    if (!channel) return c.json({ error: `unknown channel ${key}` }, 404);
    const session = protocolSession();
    const presence = new Set(session.getDevicePresence());
    const slotInUse = presence.has(key) && typeof channel.idx === 'number';
    const idx = slotInUse ? (channel.idx as number) : session.pickFreeSlot();
    if (idx === null) return c.json({ error: 'all 16 channel slots are in use' }, 409);
    const secret = channel.secretHex ?? session.deriveSecret(channel.name);
    const ok = await session.setChannel(idx, channel.name, secret);
    if (!ok) return c.json({ error: 'radio rejected SET_CHANNEL or timed out' }, 503);
    // Stamp the now-confirmed idx + derived secret onto our copy so future
    // sends route to the right slot even before the next enumeration.
    const updated = { ...channel, idx, secretHex: secret };
    holder.upsertChannel(updated);
    // Firmware doesn't push a CHANNEL_INFO back for SET — update local
    // presence state ourselves so the renderer un-grays the channel
    // immediately rather than waiting for the next reconnect enumeration.
    session.markChannelPresent(updated);
    emit.channels(holder.getChannels());
    return c.json({ ok: true, idx });
  });

  // "Remove from device" — zero out the slot so the firmware's empty-key
  // filter hides it on next enumeration. The channel stays in app storage
  // (history is preserved). Caller can DELETE /api/channels/:key separately
  // to forget it entirely.
  api.post('/api/channels/:key/remove-from-device', async (c) => {
    const key = c.req.param('key');
    const holder = stateHolder();
    const channel = holder.getChannels().find((ch) => ch.key === key);
    if (!channel) return c.json({ error: `unknown channel ${key}` }, 404);
    if (typeof channel.idx !== 'number') {
      return c.json({ error: 'channel has no known device slot' }, 409);
    }
    const session = protocolSession();
    const ok = await session.setChannel(channel.idx, '', '00'.repeat(16));
    if (!ok) return c.json({ error: 'radio rejected SET_CHANNEL or timed out' }, 503);
    // Free the slot in the dispatch map + clear presence so the renderer
    // grays the channel without waiting for the next enumeration.
    session.markChannelAbsent(channel.idx);
    // Forget the device slot — channel becomes "app-only" until pushed again.
    holder.upsertChannel({ ...channel, idx: undefined });
    emit.channels(holder.getChannels());
    return c.json({ ok: true });
  });
}
