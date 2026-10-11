import type { Context, Hono } from 'hono';
import {
  autoAddConfigSchema,
  customVarBodySchema,
  deviceIdentityPatchSchema,
  gpsConfigSchema,
  pathHashModeBodySchema,
  telemetryPolicyPatchSchema,
} from '../../../shared/api/schemas';
import { errorMessage } from '../../../shared/errors';
import {
  applyAutoAddConfig,
  applyDeviceIdentity,
  applyGpsConfig,
  applyTelemetryPolicy,
  type DeviceWriteResult,
} from '../../device/deviceSettings';
import { child } from '../../log';
import { protocolSession } from '../../protocol';
import { commit } from '../../state/commit';
import { stateHolder } from '../../state/holder';
import { transportManager } from '../../transport/manager';
import { readJson } from '../body';
import { fail503, knownErrorResponse } from '../errors';

const log = child('device');

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

  // A PATCH in all but verb: only the fields being changed, merged onto the
  // radio's value (see device/deviceSettings.applyTelemetryPolicy).
  api.put('/api/device/telemetry-policy', async (c) => {
    return deviceWriteResponse(c, await applyTelemetryPolicy(await readJson(c, telemetryPolicyPatchSchema)));
  });

  api.put('/api/device/gps', async (c) => {
    return deviceWriteResponse(c, await applyGpsConfig(await readJson(c, gpsConfigSchema)));
  });

  // Sensor settings: every custom var the radio reports (CMD_GET_CUSTOM_VARS),
  // as the raw key → value map. `{}` is a real answer — a radio with no GPS
  // hardware reports nothing — so "no GPS" is `!('gps' in vars)`, distinct
  // from a failed read (503). `gps_interval` is write-only in firmware and
  // never appears; GpsConfig.intervalSec is the value last set from CoreSense.
  // Needs meshcore-ts >= 0.9 (501 `lib_unsupported` before that).
  api.get('/api/device/custom-vars', async (c) => {
    if (!transportManager.isConnected()) return c.json({ error: 'no radio attached' }, 503);
    try {
      return c.json(await protocolSession().requestCustomVarsMap());
    } catch (err) {
      return knownErrorResponse(c, err) ?? fail503(c, err);
    }
  });

  // Write ONE sensor setting, `{ key, value }`. One per call so a key the radio
  // rejects (T1000 refuses `gps_interval`) fails alone and the UI can report a
  // partial save. A `gps`/`gps_interval` write also lands in GpsConfig, which
  // is where the write-only interval is remembered.
  api.put('/api/device/custom-vars', async (c) => {
    const { key, value } = await readJson(c, customVarBodySchema);
    if (!transportManager.isConnected()) return c.json({ error: 'no radio attached' }, 503);
    let ok: boolean;
    try {
      ok = await protocolSession().setCustomVar(key, value);
    } catch (err) {
      return knownErrorResponse(c, err) ?? fail503(c, err);
    }
    if (!ok) return c.json({ error: `radio rejected ${key}` }, 503);
    const gps = stateHolder().getGpsConfig();
    const interval = Number(value);
    if (key === 'gps') commit.gpsConfig({ ...gps, enabled: value !== '0' });
    else if (key === 'gps_interval' && Number.isFinite(interval)) commit.gpsConfig({ ...gps, intervalSec: interval });
    return c.json({ ok: true });
  });

  // POST /api/device/refresh — issues DEVICE_QUERY + GET_BATT_AND_STORAGE +
  // GET_AUTO_ADD_CONFIG + GET_CUSTOM_VARS. Each reply lands asynchronously and
  // is broadcast via WS — the caller just gets "ok" once the writes succeeded.
  //
  // Custom vars is one request, not one per key: firmware ignores the key and
  // returns every setting. It is fired, not awaited: meshcore-ts ≥ 0.9 makes
  // requestCustomVars await RESP_CUSTOM_VARS and reject on RESP_ERR (firmware
  // without CMD_GET_CUSTOM_VARS), a timeout or a not-yet-commandable session,
  // and none of those should fail the whole refresh.
  api.post('/api/device/refresh', async (c) => {
    if (!transportManager.isConnected()) {
      return c.json({ error: 'no radio attached' }, 503);
    }
    const session = protocolSession();
    try {
      await session.requestDeviceInfo();
      await session.requestBattAndStorage();
      await session.requestAutoAddConfig();
      void session
        .requestCustomVars('')
        .catch((err: unknown) => log.warn(`custom vars refresh failed: ${errorMessage(err)}`));
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
