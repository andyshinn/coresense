import type { Hono } from 'hono';
import { checkProxyPort } from '../../../shared/ports';
import type { AppSettings, RadioSettings } from '../../../shared/types';
import { emit } from '../../events/bus';
import { applyLoggingSettings } from '../../logging/apply';
import { protocolSession } from '../../protocol';
import { stateHolder } from '../../state/holder';
import { transportManager } from '../../transport/manager';
import { fail503 } from '../errors';
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
    stateHolder().setAppSettings(body);
    emit.appSettings(body);
    applyLoggingSettings(body.logging);
    return c.json({ ok: true });
  });

  // PUT /api/settings/radio. When a radio is attached and `pushToDevice` is
  // true (default), this issues CMD_SET_RADIO_PARAMS + CMD_SET_RADIO_TX_POWER
  // and only commits the new values to local state on RESP_OK. When no radio
  // is connected, the values are stored app-side only — the next handshake
  // will reapply them.
  api.put('/api/settings/radio', async (c) => {
    const body = (await c.req.json().catch(() => null)) as (RadioSettings & { pushToDevice?: boolean }) | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const pushToDevice = body.pushToDevice !== false;
    const session = protocolSession();
    if (pushToDevice && transportManager.isConnected()) {
      // Only push fields that actually changed. SET_RADIO_PARAMS is split out
      // from SET_PATH_HASH_MODE because they use different opcodes and either
      // panel (Radio or Experimental) may save independently — re-pushing a
      // full unchanged radio-params frame is wasted bandwidth at best and can
      // be rejected by the radio at worst.
      const current = stateHolder().getRadioSettings();
      const radioParamsChanged =
        body.frequencyHz !== current.frequencyHz ||
        body.bandwidthHz !== current.bandwidthHz ||
        body.spreadingFactor !== current.spreadingFactor ||
        body.codingRate !== current.codingRate ||
        body.txPowerDbm !== current.txPowerDbm ||
        body.repeatMode !== current.repeatMode;
      if (radioParamsChanged) {
        const ok = await session.setRadioParams({
          frequencyHz: body.frequencyHz,
          bandwidthHz: body.bandwidthHz,
          spreadingFactor: body.spreadingFactor,
          codingRate: body.codingRate,
          txPowerDbm: body.txPowerDbm,
          repeatMode: body.repeatMode,
        });
        if (!ok) return c.json({ error: 'radio rejected SET_RADIO_PARAMS or timed out' }, 503);
      }
      if (body.pathHashMode !== current.pathHashMode) {
        try {
          await session.setPathHashMode(body.pathHashMode);
        } catch (err) {
          return fail503(c, err);
        }
      }
      return c.json({ ok: true });
    }
    // App-side only.
    const { pushToDevice: _push, ...rest } = body;
    stateHolder().setRadioSettings(rest);
    emit.radioSettings(rest);
    return c.json({ ok: true });
  });
}
