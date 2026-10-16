import type { Hono } from 'hono';
import {
  type AutoAddConfig,
  type DeviceIdentity,
  type GpsConfig,
  isPathHashSize,
  type TelemetryPolicy,
} from '../../../shared/types';
import { emit } from '../../events/bus';
import { protocolSession } from '../../protocol';
import { stateHolder } from '../../state/holder';
import { transportManager } from '../../transport/manager';
import { fail503 } from '../errors';

export function registerDeviceRoutes(api: Hono): void {
  // ---- Device-side settings (parity with the official mobile app) ----

  api.put('/api/device/identity', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<DeviceIdentity> | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const session = protocolSession();
    const holder = stateHolder();
    const current = holder.getDeviceIdentity();
    if (!transportManager.isConnected()) {
      // App-only update — useful for staging before a connect.
      const next = { ...current, ...body } as DeviceIdentity;
      holder.setDeviceIdentity(next);
      emit.deviceIdentity(next);
      return c.json({ ok: true });
    }
    try {
      if (typeof body.name === 'string' && body.name !== current.name) {
        const ok = await session.setAdvertName(body.name);
        if (!ok) return c.json({ error: 'SET_ADVERT_NAME rejected by radio' }, 503);
      }
      if (
        (typeof body.lat === 'number' && body.lat !== current.lat) ||
        (typeof body.lon === 'number' && body.lon !== current.lon)
      ) {
        const lat = typeof body.lat === 'number' ? body.lat : (current.lat ?? 0);
        const lon = typeof body.lon === 'number' ? body.lon : (current.lon ?? 0);
        const ok = await session.setAdvertLatLon(lat, lon);
        if (!ok) return c.json({ error: 'SET_ADVERT_LATLON rejected by radio' }, 503);
      }
      if (typeof body.sharePositionInAdvert === 'boolean' && body.sharePositionInAdvert !== current.sharePositionInAdvert) {
        // sharePositionInAdvert lives in SET_OTHER_PARAMS along with telemetry
        // policy — re-emit the full frame with current telemetry values. The
        // manual-add byte is deliberately omitted so the library resends the
        // value it mirrored from RESP_SELF_INFO: byte 1 of this command is the
        // radio's auto-add master switch, and passing anything else here would
        // reconfigure auto-add as a side effect of saving an advert setting.
        const policy = holder.getTelemetryPolicy();
        const ok = await session.setOtherParams(policy, body.sharePositionInAdvert);
        if (!ok) return c.json({ error: 'SET_OTHER_PARAMS rejected by radio' }, 503);
      }
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  api.put('/api/device/auto-add', async (c) => {
    const body = (await c.req.json().catch(() => null)) as AutoAddConfig | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    const current = holder.getAutoAddConfig();
    const connected = transportManager.isConnected();
    // Everything that decides what goes ON THE WIRE is compared against the
    // library's mirror, never against the holder. The holder is written
    // optimistically below — while disconnected, and even when the radio
    // rejects the frame — so a "did this change?" test against it answers "no"
    // for edits the radio never received, and no later save ever retries them.
    // The mirror only moves when the radio reports a value or a command
    // actually reached the wire. See SessionAdapter.getLibAutoAddConfig.
    const session = connected ? protocolSession() : null;
    const onRadio = session?.getLibAutoAddConfig() ?? null;
    // `mode` is the user's edit of manual_add_contacts bit 0. Rewrite only that
    // bit: the rest of the byte is unused by the firmware today, and clobbering
    // bits we don't understand is exactly the class of bug this whole change is
    // undoing. The inbound body's own manualAddContacts is ignored — the panel
    // edits `mode`, not the raw byte.
    const baseManualAdd = onRadio?.manualAddContacts ?? current.manualAddContacts;
    const nextManualAdd = body.mode === 'selected' ? baseManualAdd | 1 : baseManualAdd & ~1;
    const next: AutoAddConfig = { ...body, manualAddContacts: nextManualAdd };
    // App-side fields (pull-to-refresh, show-pubkeys) are persisted regardless
    // of connection state. Wire flags only push when connected.
    holder.setAutoAddConfig(next);
    emit.autoAddConfig(next);
    if (session && onRadio) {
      const flags = {
        chat: body.mode === 'all' ? true : body.chat,
        repeater: body.mode === 'all' ? true : body.repeater,
        room: body.mode === 'all' ? true : body.room,
        sensor: body.mode === 'all' ? true : body.sensor,
        overwriteOldest: body.overwriteOldest,
        // Omitting this emits the 2-byte SET, which the firmware's `len >= 3`
        // guard leaves autoadd_max_hops untouched. Send the 3-byte form only
        // when the value differs from the one the radio is holding, so a save
        // can't reset a limit set on the radio itself — and so an edit made
        // while disconnected still goes out on the next connected save.
        radioMaxHops: body.radioMaxHops !== onRadio.radioMaxHops ? body.radioMaxHops : undefined,
      };
      const ok = await session.setAutoAddConfig(flags);
      if (!ok) return c.json({ error: 'SET_AUTO_ADD_CONFIG rejected by radio' }, 503);
      // The library's setAutoAddConfig() only encodes the frame — it leaves its
      // own mirror untouched. Write through, or the setOtherParams below re-emits
      // `autoAddConfig` built from a mirror that still holds the PREVIOUS kind
      // flags, and wireSessionEvents persists those right back over the selection
      // this request just saved.
      session.mirrorAutoAddConfig({
        mode: next.mode,
        chat: flags.chat,
        repeater: flags.repeater,
        room: flags.room,
        sensor: flags.sensor,
        overwriteOldest: flags.overwriteOldest,
        radioMaxHops: next.radioMaxHops,
      });
      // Then the master switch, and only when it actually changes. Order
      // matters: turning bit 0 on before the kind flags land would leave a
      // window where the radio honours the PREVIOUS selection. It also has to
      // be a separate command — the bit lives in CMD_SET_OTHER_PARAMS, which
      // carries the telemetry policy and advert-location policy along with it,
      // so sending it on every save would push those unrelated prefs too.
      if (nextManualAdd !== onRadio.manualAddContacts) {
        const share = holder.getDeviceIdentity().sharePositionInAdvert;
        const otherOk = await session.setOtherParams(holder.getTelemetryPolicy(), share, nextManualAdd);
        if (!otherOk) return c.json({ error: 'SET_OTHER_PARAMS (auto-add mode) rejected by radio' }, 503);
      }
    }
    return c.json({ ok: true });
  });

  api.get('/api/device/auto-add', (c) => c.json(stateHolder().getAutoAddConfig()));

  api.put('/api/device/telemetry-policy', async (c) => {
    const body = (await c.req.json().catch(() => null)) as TelemetryPolicy | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    holder.setTelemetryPolicy(body);
    emit.telemetryPolicy(body);
    if (transportManager.isConnected()) {
      const share = holder.getDeviceIdentity().sharePositionInAdvert;
      // Third argument omitted on purpose — see the identity route above: the
      // library round-trips the radio's own manual-add byte so a telemetry save
      // can't reconfigure auto-add.
      const ok = await protocolSession().setOtherParams(body, share);
      if (!ok) return c.json({ error: 'SET_OTHER_PARAMS rejected by radio' }, 503);
    }
    return c.json({ ok: true });
  });

  api.put('/api/device/gps', async (c) => {
    const body = (await c.req.json().catch(() => null)) as GpsConfig | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    holder.setGpsConfig(body);
    emit.gpsConfig(body);
    if (transportManager.isConnected()) {
      const ok = await protocolSession().setGpsConfig(body);
      if (!ok) return c.json({ error: 'GPS custom-var rejected by radio' }, 503);
    }
    return c.json({ ok: true });
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
    await session.requestDeviceInfo();
    await session.requestBattAndStorage();
    await session.requestAutoAddConfig();
    await session.requestCustomVars('gps');
    await session.requestCustomVars('gps_interval');
    return c.json({ ok: true });
  });

  api.post('/api/device/reboot', async (c) => {
    const r = await protocolSession().reboot();
    if (!r.ok) return c.json({ error: r.error }, 503);
    return c.json({ ok: true });
  });

  // Radio-wide path-hash mode (1, 2, or 3 bytes per hop).
  api.put('/api/radio/path-hash-mode', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { size?: number } | null;
    const size = body?.size;
    if (!isPathHashSize(size)) {
      return c.json({ error: 'size must be 1, 2, or 3' }, 400);
    }
    try {
      await protocolSession().setPathHashMode(size);
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });
}
