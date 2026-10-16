import type { Hono } from 'hono';
import { checkProxyPort } from '../../../shared/ports';
import type { AppSettings, RadioSettings } from '../../../shared/types';
import { applyRadioSettings } from '../../device/deviceSettings';
import { applyLoggingSettings } from '../../logging/apply';
import { commit } from '../../state/commit';
import type { RoutesDeps } from './app';

export function registerSettingsRoutes(api: Hono, deps: RoutesDeps): void {
  const { port } = deps;
  api.put('/api/settings/app', async (c) => {
    const body = (await c.req.json().catch(() => null)) as AppSettings | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    // Refuse a TCP proxy port the app cannot give away — above all its own HTTP
    // port, which the bridge would bind first and so stop the API server from
    // starting on the next boot (see shared/ports.ts). Enforced here rather
    // than only in the UI because this endpoint is reachable directly.
    if (body.proxy) {
      const conflict = checkProxyPort(body.proxy.port, port());
      if (conflict) return c.json({ error: conflict }, 400);
    }
    commit.appSettings(body);
    applyLoggingSettings(body.logging);
    return c.json({ ok: true });
  });

  // PUT /api/settings/radio. `pushToDevice` defaults to true; see
  // device/deviceSettings.applyRadioSettings.
  api.put('/api/settings/radio', async (c) => {
    const body = (await c.req.json().catch(() => null)) as (RadioSettings & { pushToDevice?: boolean }) | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const { pushToDevice, ...settings } = body;
    const res = await applyRadioSettings(settings, pushToDevice !== false);
    return res.status === 'ok' ? c.json({ ok: true }) : c.json({ error: res.message }, 503);
  });
}
