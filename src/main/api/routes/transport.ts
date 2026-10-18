import type { Hono } from 'hono';
import { advertBodySchema, connectBodySchema } from '../../../shared/api/schemas';
import { protocolSession } from '../../protocol';
import { transportManager } from '../../transport/manager';
import { readJson } from '../body';
import { fail503 } from '../errors';

export function registerTransportRoutes(api: Hono): void {
  api.get('/api/transport/state', (c) => c.json(transportManager.getState()));

  api.post('/api/transport/advert', async (c) => {
    const body = await readJson(c, advertBodySchema, { optional: true });
    const result = await protocolSession().sendSelfAdvert(body.flood ?? true);
    if (!result.ok) return c.json({ error: result.error }, 503);
    return c.json({ ok: true });
  });

  api.post('/api/transport/scan', async (c) => {
    const transport = transportManager.getTransport();
    if (!transport?.scan) return c.json({ error: 'No scan-capable transport' }, 400);
    try {
      await transport.scan();
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  api.post('/api/transport/connect', async (c) => {
    const { deviceId } = await readJson(c, connectBodySchema, { optional: true });
    const transport = transportManager.getTransport();
    if (!transport) return c.json({ error: 'No active transport' }, 400);
    try {
      await transport.connect(deviceId);
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  api.post('/api/transport/disconnect', async (c) => {
    const transport = transportManager.getTransport();
    if (!transport) return c.json({ error: 'No active transport' }, 400);
    try {
      await transport.disconnect();
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });
}
