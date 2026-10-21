import type { Hono } from 'hono';
import { appSettingsSchema, radioSettingsBodySchema } from '../../../shared/api/schemas';
import { checkProxyPort } from '../../../shared/ports';
import { applyRadioSettings } from '../../device/deviceSettings';
import { applyLoggingSettings } from '../../logging/apply';
import { commit } from '../../state/commit';
import { stateHolder } from '../../state/holder';
import { normalizeTelemetrySettings, telemetryRetention } from '../../telemetry/retention';
import { applyTelemetryRetention } from '../../telemetry/service';
import { readJson } from '../body';
import type { RoutesDeps } from './app';

export function registerSettingsRoutes(api: Hono, deps: RoutesDeps): void {
  const { port } = deps;
  api.put('/api/settings/app', async (c) => {
    const body = await readJson(c, appSettingsSchema);
    // Refuse a TCP proxy port the app cannot give away — above all its own HTTP
    // port, which the bridge would bind first and so stop the API server from
    // starting on the next boot (see shared/ports.ts). Enforced here rather
    // than only in the UI because this endpoint is reachable directly.
    const conflict = checkProxyPort(body.proxy.port, port());
    if (conflict) return c.json({ error: conflict }, 400);
    // Telemetry retention sizes a per-node prune, so never store or fan out a
    // value a client sent unclamped.
    const current = stateHolder().getAppSettings();
    const next = normalizeTelemetrySettings(body, current);
    commit.appSettings(next);
    applyLoggingSettings(next.logging);
    // A smaller retention takes effect now, for every node, rather than as each
    // node is next requested.
    applyTelemetryRetention(telemetryRetention(current), telemetryRetention(next));
    return c.json({ ok: true });
  });

  // PUT /api/settings/radio. `pushToDevice` defaults to true; see
  // device/deviceSettings.applyRadioSettings.
  api.put('/api/settings/radio', async (c) => {
    const { pushToDevice, ...settings } = await readJson(c, radioSettingsBodySchema);
    const res = await applyRadioSettings(settings, pushToDevice !== false);
    return res.status === 'ok' ? c.json({ ok: true }) : c.json({ error: res.message }, 503);
  });
}
