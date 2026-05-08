import { app } from 'electron';
import { Hono } from 'hono';
import type { Capabilities, ServerStatus } from '../../shared/types';
import { transportManager } from '../transport/manager';

interface RoutesDeps {
  port: () => number;
  wsClients: () => number;
}

export function createRoutes({ port, wsClients }: RoutesDeps) {
  const api = new Hono();

  api.get('/api/capabilities', (c) => {
    const payload: Capabilities = {
      isElectron: true,
      version: app.getVersion(),
      platform: process.platform,
      httpPort: port(),
    };
    return c.json(payload);
  });

  api.get('/api/status', (c) => {
    const t = transportManager.getState();
    const payload: ServerStatus = {
      port: port(),
      wsClients: wsClients(),
      transport: t.state,
      deviceId: t.deviceId,
    };
    return c.json(payload);
  });

  api.get('/api/transport/state', (c) => c.json(transportManager.getState()));

  api.post('/api/transport/scan', async (c) => {
    const transport = transportManager.getTransport();
    if (!transport?.scan) return c.json({ error: 'No scan-capable transport' }, 400);
    try {
      await transport.scan();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  api.post('/api/transport/connect', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { deviceId?: string };
    const deviceId = body.deviceId;
    if (!deviceId) return c.json({ error: 'deviceId is required' }, 400);
    const transport = transportManager.getTransport();
    if (!transport) return c.json({ error: 'No active transport' }, 400);
    try {
      await transport.connect(deviceId);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  api.post('/api/transport/disconnect', async (c) => {
    const transport = transportManager.getTransport();
    if (!transport) return c.json({ error: 'No active transport' }, 400);
    try {
      await transport.disconnect();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return api;
}
