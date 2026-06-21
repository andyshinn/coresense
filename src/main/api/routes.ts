import { Hono } from 'hono';
import type {
  AppSettings,
  AutoAddConfig,
  BridgeStatus,
  Capabilities,
  Channel,
  Contact,
  DeviceIdentity,
  GpsConfig,
  MapSettings,
  RadioSettings,
  SearchOptions,
  ServerStatus,
  StateSnapshot,
  TelemetryPolicy,
  UiState,
} from '../../shared/types';
import { adminSessions } from '../bridge/adminSession';
import { APP_VERSION, GIT_SHA } from '../build-info';
import { emit } from '../events/bus';
import { child } from '../log';
import { applyLoggingSettings } from '../logging/apply';
import { currentPath, folderPath } from '../logging/fileSink';
import { clearApiKey, hasApiKey, setApiKey } from '../map/api-key';
import { protocolSession } from '../protocol';
import { ContactTableFullError, UnknownContactError } from '../protocol/errors';
import { appLifecycle } from '../runtime/appLifecycle';
import { stateHolder } from '../state/holder';
import { discoveredStore } from '../storage/discoveredContacts';
import { searchMessages } from '../storage/search';
import { transportManager } from '../transport/manager';
import { updatesController } from '../updates/controller';
import { markQuitConfirmed } from '../window/quit';
import { getConfigPath } from './middleware/auth';
import { buildTileManifest, registerTileRoutes } from './tiles';

const log = child('api');

interface RoutesDeps {
  port: () => number;
  wsClients: () => number;
  bridgeStatus: () => BridgeStatus;
}

export function createRoutes({ port, wsClients, bridgeStatus }: RoutesDeps) {
  const api = new Hono();

  registerTileRoutes(api);

  const buildCapabilities = (): Capabilities => ({
    isElectron: true,
    version: APP_VERSION,
    gitSha: GIT_SHA,
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    platform: process.platform,
    httpPort: port(),
    configPath: getConfigPath(),
    logsFolder: folderPath(),
    logsCurrentFile: currentPath(),
  });

  api.get('/api/capabilities', (c) => c.json(buildCapabilities()));

  api.get('/api/status', (c) => {
    const t = transportManager.getState();
    const payload: ServerStatus = {
      port: port(),
      wsClients: wsClients(),
      transport: t.state,
      deviceId: t.deviceId,
      bridge: bridgeStatus(),
    };
    return c.json(payload);
  });

  // Single hydration endpoint. Renderer calls this on cold boot or after a
  // reconnect; thereafter it follows WS push events. Per-resource endpoints
  // (PUT /api/settings/app, etc.) update state and trigger broadcasts.
  api.get('/api/state/snapshot', async (c) => {
    const t = transportManager.getState();
    const holder = stateHolder();
    const payload: StateSnapshot = {
      capabilities: buildCapabilities(),
      bridge: bridgeStatus(),
      transport: { state: t.state, deviceId: t.deviceId },
      owner: holder.getOwner(),
      channels: holder.getChannels(),
      channelPresence: protocolSession().getDevicePresence(),
      syncProgress: protocolSession().getSyncProgress(),
      contacts: holder.getContacts(),
      discoveredContacts: discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()),
      messages: holder.getRecentMessages(),
      appSettings: holder.getAppSettings(),
      radioSettings: holder.getRadioSettings(),
      mapSettings: holder.getMapSettings(),
      mapManifest: await buildTileManifest(),
      uiState: holder.getUiState(),
      deviceIdentity: holder.getDeviceIdentity(),
      autoAddConfig: holder.getAutoAddConfig(),
      telemetryPolicy: holder.getTelemetryPolicy(),
      gpsConfig: holder.getGpsConfig(),
      deviceInfo: holder.getDeviceInfo(),
      deviceCapabilities: holder.getDeviceCapabilities(),
      blockRules: holder.getBlockRules(),
    };
    return c.json(payload);
  });

  api.put('/api/ui-state', async (c) => {
    const body = (await c.req.json().catch(() => null)) as UiState | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    stateHolder().setUiState(body);
    emit.uiState(body);
    return c.json({ ok: true });
  });

  // POST /api/app/quit — the renderer's reply to a `requestQuit` broadcast:
  // unsaved Settings changes were saved/discarded (or there were none), so
  // re-issue the quit, this time passing the before-quit guard.
  api.post('/api/app/quit', (c) => {
    markQuitConfirmed();
    // Defer so this HTTP response flushes before the app tears down.
    setTimeout(() => appLifecycle().quit(), 0);
    return c.json({ ok: true });
  });

  // POST /api/app/relaunch — used by Proxy settings after the user changes
  // port/bind/enabled/mdns. The bridge listeners are bound at startup, so the
  // simplest correct way to apply them is to restart the whole app.
  api.post('/api/app/relaunch', (c) => {
    markQuitConfirmed();
    setTimeout(() => {
      appLifecycle().relaunch();
      appLifecycle().exit(0);
    }, 0);
    return c.json({ ok: true });
  });

  api.post('/api/updates/check', async (c) => {
    const updateState = await updatesController().check();
    return c.json({ ok: true, updateState });
  });

  api.post('/api/updates/install', (c) => {
    updatesController().installAndRestart();
    return c.json({ ok: true });
  });

  api.put('/api/settings/app', async (c) => {
    const body = (await c.req.json().catch(() => null)) as AppSettings | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    stateHolder().setAppSettings(body);
    emit.appSettings(body);
    applyLoggingSettings(body.logging);
    return c.json({ ok: true });
  });

  // ----- Block rules -----
  // POST /api/blocks — bulk add (the dialog ticks N identifiers → N rules).
  api.post('/api/blocks', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      rules?: Array<{
        type: 'pubkey' | 'pubkeyPrefix' | 'name' | 'nameRegex';
        pattern: string;
        tsFrom: number;
        enabled: boolean;
        note?: string;
      }>;
    } | null;
    if (!body || !Array.isArray(body.rules) || body.rules.length === 0) {
      return c.json({ error: 'rules required' }, 400);
    }
    const holder = stateHolder();
    const inserted = holder.addBlockRules(body.rules);
    return c.json({ rules: inserted });
  });

  // PUT /api/blocks/:id — edit pattern / note / tsFrom / enabled.
  api.put('/api/blocks/:id', async (c) => {
    const id = c.req.param('id');
    const patch = (await c.req.json().catch(() => null)) as Partial<{
      pattern: string;
      tsFrom: number;
      enabled: boolean;
      note: string;
    }> | null;
    if (!patch) return c.json({ error: 'invalid body' }, 400);
    const updated = stateHolder().updateBlockRule(id, patch);
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ rule: updated });
  });

  // DELETE /api/blocks/:id — remove the rule entirely.
  api.delete('/api/blocks/:id', (c) => {
    const id = c.req.param('id');
    const ok = stateHolder().removeBlockRule(id);
    if (!ok) return c.json({ error: 'not found' }, 404);
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
    const t = transportManager.getState();
    if (pushToDevice && t.state === 'connected') {
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
          return c.json({ error: (err as Error).message }, 503);
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

  // ---- Device-side settings (parity with the official mobile app) ----

  api.put('/api/device/identity', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<DeviceIdentity> | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const session = protocolSession();
    const t = transportManager.getState();
    const holder = stateHolder();
    const current = holder.getDeviceIdentity();
    if (t.state !== 'connected') {
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
        // policy — re-emit the full frame with current telemetry values.
        const policy = holder.getTelemetryPolicy();
        const ok = await session.setOtherParams(policy, body.sharePositionInAdvert);
        if (!ok) return c.json({ error: 'SET_OTHER_PARAMS rejected by radio' }, 503);
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.put('/api/device/auto-add', async (c) => {
    const body = (await c.req.json().catch(() => null)) as AutoAddConfig | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    // App-side fields (mode, maxHops, pull-to-refresh, show-pubkeys) are
    // persisted regardless of connection state. Wire flags only push when
    // connected.
    holder.setAutoAddConfig(body);
    emit.autoAddConfig(body);
    if (transportManager.getState().state === 'connected') {
      const flags = {
        chat: body.mode === 'all' ? true : body.chat,
        repeater: body.mode === 'all' ? true : body.repeater,
        room: body.mode === 'all' ? true : body.room,
        sensor: body.mode === 'all' ? true : body.sensor,
        overwriteOldest: body.overwriteOldest,
      };
      const ok = await protocolSession().setAutoAddConfig(flags);
      if (!ok) return c.json({ error: 'SET_AUTO_ADD_CONFIG rejected by radio' }, 503);
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
    if (transportManager.getState().state === 'connected') {
      const share = holder.getDeviceIdentity().sharePositionInAdvert;
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
    if (transportManager.getState().state === 'connected') {
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
    if (transportManager.getState().state !== 'connected') {
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

  // Map panel preferences. `hasProtomapsApiKey` is server-owned (derived from
  // the encrypted blob's presence — Phase 4) and ignored from inbound bodies
  // so the renderer can't fake it. The API key itself never travels through
  // this endpoint; see /api/map/api-key (Phase 4).
  api.put('/api/settings/map', async (c) => {
    const body = (await c.req.json().catch(() => null)) as MapSettings | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    const current = holder.getMapSettings();
    // hasProtomapsApiKey is server-owned (derived from the encrypted blob's
    // existence); ignore the inbound value so the renderer can't forge it.
    const sanitized: MapSettings = {
      ...body,
      hasProtomapsApiKey: current.hasProtomapsApiKey,
    };
    holder.setMapSettings(sanitized);
    emit.mapSettings(sanitized);
    return c.json({ ok: true });
  });

  // Protomaps hosted-API key. The plaintext is accepted only by POST and is
  // immediately written to an OS-encrypted blob via safeStorage; it is never
  // returned by any endpoint. Renderer learns key presence via
  // MapSettings.hasProtomapsApiKey (broadcast after set/clear).
  api.post('/api/map/api-key', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { key?: string } | null;
    if (!body || typeof body.key !== 'string' || body.key.trim().length === 0) {
      return c.json({ error: 'key is required' }, 400);
    }
    try {
      await setApiKey(body.key);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
    const holder = stateHolder();
    const next: MapSettings = { ...holder.getMapSettings(), hasProtomapsApiKey: true };
    holder.setMapSettings(next);
    emit.mapSettings(next);
    return c.json({ ok: true, hasKey: true });
  });

  api.get('/api/map/api-key', (c) => c.json({ hasKey: hasApiKey() }));

  api.delete('/api/map/api-key', async (c) => {
    await clearApiKey();
    const holder = stateHolder();
    const next: MapSettings = { ...holder.getMapSettings(), hasProtomapsApiKey: false };
    holder.setMapSettings(next);
    emit.mapSettings(next);
    return c.json({ ok: true, hasKey: false });
  });

  api.get('/api/channels', (c) => c.json(stateHolder().getChannels()));
  api.put('/api/channels/:key', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as Channel | null;
    if (!body || body.key !== key) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    holder.upsertChannel(body);
    emit.channels(holder.getChannels());
    return c.json({ ok: true });
  });
  api.delete('/api/channels/:key', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
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
    const key = decodeURIComponent(c.req.param('key'));
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
    const key = decodeURIComponent(c.req.param('key'));
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

  api.get('/api/contacts', (c) => c.json(stateHolder().getContacts()));
  api.put('/api/contacts/:key', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as Contact | null;
    if (!body || body.key !== key) return c.json({ error: 'invalid body' }, 400);
    const holder = stateHolder();
    holder.upsertContact(body);
    emit.contacts(holder.getContacts());
    return c.json({ ok: true });
  });
  api.delete('/api/contacts/:key', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const holder = stateHolder();
    holder.removeContact(key);
    emit.contacts(holder.getContacts());
    return c.json({ ok: true });
  });

  // ---- Discovered-contacts pool ---------------------------------------
  api.get('/api/discovered-contacts', (c) => {
    const holder = stateHolder();
    return c.json(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
  });

  // Commit a discovered contact to the radio's store.
  api.post('/api/contacts/:key/add-to-radio', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    try {
      await protocolSession().addContactToRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof UnknownContactError) return c.json({ error: err.message }, 422);
      if (err instanceof ContactTableFullError) {
        return c.json({ error: err.message, code: 'CONTACT_TABLE_FULL' }, 409);
      }
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Delete a contact from the radio's store (stays in the discovered pool).
  api.post('/api/contacts/:key/remove-from-radio', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    try {
      await protocolSession().removeContactFromRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Toggle the radio-level favourite flag.
  api.put('/api/contacts/:key/favourite', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const pubkey = key.startsWith('c:') ? key.slice(2) : key;
    const body = (await c.req.json().catch(() => null)) as { favourite?: boolean } | null;
    if (!body || typeof body.favourite !== 'boolean') {
      return c.json({ error: 'favourite (boolean) required' }, 400);
    }
    try {
      await protocolSession().setContactFavourite(pubkey, body.favourite);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof UnknownContactError) return c.json({ error: err.message }, 422);
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Drop discovered-only rows (keeps on-radio contacts).
  api.post('/api/discovered-contacts/clear', (c) => {
    discoveredStore.clearDiscoveredOnly();
    const holder = stateHolder();
    emit.discovered(discoveredStore.list(holder.getRadioSettings().pathHashMode, holder.getBlockRules()));
    return c.json({ ok: true });
  });

  api.get('/api/messages/:key', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const limit = Number(c.req.query('limit') ?? '200');
    const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
    return c.json(stateHolder().getMessagesForKey(key, { limit, before }));
  });

  api.post('/api/messages/:key', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    if (!key.startsWith('ch:') && !key.startsWith('c:')) {
      return c.json({ error: 'key must be ch:<name> or c:<pubkey>' }, 400);
    }
    const body = (await c.req.json().catch(() => null)) as { body?: string } | null;
    if (!body || typeof body.body !== 'string' || body.body.length === 0) {
      return c.json({ error: 'body is required' }, 400);
    }
    const holder = stateHolder();
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Record the message locally first so the UI sees it immediately, then
    // hand to the protocol session for TX. The state starts as 'sending' and
    // flips to 'sent' on a successful write, 'failed' if the transport rejects.
    holder.insertMessage({
      id,
      key,
      body: body.body,
      ts: Date.now(),
      state: 'sending',
    });
    emit.messages(key, holder.getMessagesForKey(key));

    if (key.startsWith('ch:')) {
      const result = await protocolSession().sendChannelText(key, body.body);
      const nextState = result.ok ? 'sent' : 'failed';
      holder.setMessageState(id, nextState);
      emit.messageState(id, nextState);
      // Register the send so repeater relays we hear over the air (0x88) are
      // attributed back to this message — the lib then emits `messagePathHeard`,
      // which drives the green ✓×N "heard by N repeaters" counter.
      if (result.ok && result.channelHash != null) {
        protocolSession().registerChannelSend({ messageId: id, channelHash: result.channelHash });
      }
      return result.ok ? c.json({ ok: true, id }) : c.json({ error: result.error }, 503);
    }

    // DM: returns immediately after the first transport-level write so the UI
    // can render the optimistic message; sendDmTextWithRetry then drives the
    // 3-known-path + 2-flood retry loop in the background, transitioning the
    // message state via emit.messageState and emitting `pathLearned` if the
    // radio discovers a new out_path during fallback.
    protocolSession()
      .sendDmTextWithRetry(key, body.body, id)
      .catch((err) => {
        holder.setMessageState(id, 'failed');
        emit.messageState(id, 'failed');
        log.warn(`sendDmTextWithRetry id=${id}: ${(err as Error).message}`);
      });
    return c.json({ ok: true, id });
  });

  // ---- Per-contact path ------------------------------------------------
  // Writes the path back to the radio (firmware is the source of truth) and
  // updates the local Contact record on success. preferDirect is a local-only
  // flag — no firmware write needed.
  api.put('/api/contacts/:key/path', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as {
      outPathHex?: string;
      preferDirect?: boolean;
    } | null;
    if (!body) return c.json({ error: 'body required' }, 400);
    const outPathHex = (body.outPathHex ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
    try {
      if (typeof body.preferDirect === 'boolean') {
        protocolSession().setContactPreferDirect(key, body.preferDirect);
      }
      await protocolSession().setContactPath(key, outPathHex, {
        manual: true,
        preferDirect: body.preferDirect,
      });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.delete('/api/contacts/:key/path', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    try {
      await protocolSession().resetContactPath(key);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  // Radio-wide path-hash mode (1, 2, or 3 bytes per hop).
  api.put('/api/radio/path-hash-mode', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { size?: number } | null;
    const size = body?.size;
    if (size !== 1 && size !== 2 && size !== 3) {
      return c.json({ error: 'size must be 1, 2, or 3' }, 400);
    }
    try {
      await protocolSession().setPathHashMode(size as 1 | 2 | 3);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.get('/api/transport/state', (c) => c.json(transportManager.getState()));

  // Full-text search over messages + conversations. Always a POST so the
  // (potentially long) query body isn't URL-encoded into a GET. Synchronous —
  // even at 100k messages, FTS5 returns in single-digit ms.
  api.post('/api/search', async (c) => {
    const body = (await c.req.json().catch(() => null)) as SearchOptions | null;
    if (!body || typeof body.query !== 'string' || (body.sort !== 'relevance' && body.sort !== 'recency')) {
      return c.json({ error: 'query and sort are required' }, 400);
    }
    return c.json(searchMessages(body, stateHolder().getSearchBlockContext()));
  });

  // Repeater admin: request a status / telemetry snapshot from a contact.
  // Synchronous response = "did the radio accept the write"; the snapshot
  // itself arrives as a separate WS push event after the mesh round-trip.
  api.post('/api/repeater/:key/status', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const result = await protocolSession().sendStatusReq(key);
    if (!result.ok) return c.json({ error: result.error }, 503);
    return c.json({ ok: true });
  });

  api.post('/api/repeater/:key/telemetry', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const result = await protocolSession().sendTelemetryReq(key);
    if (!result.ok) return c.json({ error: result.error }, 503);
    return c.json({ ok: true });
  });

  // Repeater admin: full session-bearing flow. Login/logout track state in the
  // adminSessions store; ACL / neighbours / owner-info / CLI awaits the mesh
  // round-trip and returns the parsed result inline (5-30s typical).
  api.get('/api/repeater/:key/session', (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    return c.json({ session: adminSessions.getSession(key) });
  });

  api.post('/api/repeater/:key/login', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as {
      password?: string;
    } | null;
    if (!body || typeof body.password !== 'string') {
      return c.json({ error: 'password is required' }, 400);
    }
    try {
      const result = await protocolSession().repeaterLogin(key, body.password);
      return c.json({ ok: true, session: adminSessions.getSession(key), login: result });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/:key/logout', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    try {
      await protocolSession().repeaterLogout(key);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/:key/acl', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    try {
      const entries = await protocolSession().repeaterRequestAcl(key);
      return c.json({ ok: true, entries });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/:key/neighbours', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => ({}))) as {
      count?: number;
      offset?: number;
      orderBy?: number;
      prefixLen?: number;
    };
    try {
      const page = await protocolSession().repeaterRequestNeighbours(key, body);
      return c.json({ ok: true, page });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/:key/owner', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    try {
      const info = await protocolSession().repeaterRequestOwnerInfo(key);
      return c.json({ ok: true, info });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/:key/cli', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const body = (await c.req.json().catch(() => null)) as { command?: string } | null;
    if (!body || typeof body.command !== 'string' || body.command.length === 0) {
      return c.json({ error: 'command is required' }, 400);
    }
    try {
      const reply = await protocolSession().repeaterSendCli(key, body.command);
      return c.json({ ok: true, reply });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/:key/trace', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      tag?: number;
      authCode?: number;
      flags?: number;
      pathHex?: string;
    } | null;
    if (!body || typeof body.tag !== 'number' || typeof body.pathHex !== 'string') {
      return c.json({ error: 'tag and pathHex are required' }, 400);
    }
    try {
      const trace = await protocolSession().repeaterTracePath({
        tag: body.tag,
        authCode: body.authCode ?? 0,
        flags: body.flags,
        pathHex: body.pathHex,
      });
      return c.json({ ok: true, trace });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/repeater/local/stats', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      subtype?: 'CORE' | 'RADIO' | 'PACKETS';
    };
    const subtype = body.subtype ?? 'CORE';
    if (subtype !== 'CORE' && subtype !== 'RADIO' && subtype !== 'PACKETS') {
      return c.json({ error: 'invalid subtype' }, 400);
    }
    try {
      const stats = await protocolSession().repeaterGetLocalStats(subtype);
      return c.json({ ok: true, stats });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 503);
    }
  });

  api.post('/api/transport/advert', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { flood?: boolean };
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
