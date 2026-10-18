import type { Context, Hono } from 'hono';
import {
  autoAddConfigSchema,
  deviceIdentityPatchSchema,
  gpsConfigSchema,
  pathHashModeBodySchema,
  telemetryPolicySchema,
} from '../../../shared/api/schemas';
import {
  applyAutoAddConfig,
  applyDeviceIdentity,
  applyGpsConfig,
  applyTelemetryPolicy,
  type DeviceWriteResult,
} from '../../device/deviceSettings';
import { protocolSession } from '../../protocol';
import { stateHolder } from '../../state/holder';
import { transportManager } from '../../transport/manager';
import { readJson } from '../body';
import { fail503 } from '../errors';

function deviceWriteResponse(c: Context, res: DeviceWriteResult) {
  return res.status === 'ok' ? c.json({ ok: true }) : c.json({ error: res.message }, 503);
}

export function registerDeviceRoutes(api: Hono): void {
  // ---- Device-side settings (parity with the official mobile app) ----

  api.put('/api/device/identity', async (c) => {
    return deviceWriteResponse(c, await applyDeviceIdentity(await readJson(c, deviceIdentityPatchSchema)));
  });

  api.put('/api/device/auto-add', async (c) => {
    return deviceWriteResponse(c, await applyAutoAddConfig(await readJson(c, autoAddConfigSchema)));
  });

  api.get('/api/device/auto-add', (c) => c.json(stateHolder().getAutoAddConfig()));

  api.put('/api/device/telemetry-policy', async (c) => {
    return deviceWriteResponse(c, await applyTelemetryPolicy(await readJson(c, telemetryPolicySchema)));
  });

  api.put('/api/device/gps', async (c) => {
    return deviceWriteResponse(c, await applyGpsConfig(await readJson(c, gpsConfigSchema)));
  });

  // POST /api/device/refresh — issues DEVICE_QUERY + GET_BATT_AND_STORAGE +
  // GET_AUTO_ADD_CONFIG + GET_CUSTOM_VAR(gps,gps_interval). Each reply lands
  // asynchronously and is broadcast via WS — the caller just gets "ok" once
  // the writes succeeded.
  api.post('/api/device/refresh', async (c) => {
    if (!transportManager.isConnected()) {
      return c.json({ error: 'no radio attached' }, 503);
    }
    const session = protocolSession();
    try {
      await session.requestDeviceInfo();
      await session.requestBattAndStorage();
      await session.requestAutoAddConfig();
      await session.requestCustomVars('gps');
      await session.requestCustomVars('gps_interval');
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  api.post('/api/device/reboot', async (c) => {
    const r = await protocolSession().reboot();
    if (!r.ok) return c.json({ error: r.error }, 503);
    return c.json({ ok: true });
  });

  // Radio-wide path-hash mode (1, 2, or 3 bytes per hop).
  api.put('/api/radio/path-hash-mode', async (c) => {
    const { size } = await readJson(c, pathHashModeBodySchema);
    try {
      await protocolSession().setPathHashMode(size);
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });
}
