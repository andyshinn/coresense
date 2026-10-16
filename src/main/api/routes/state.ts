import type { Hono } from 'hono';
import { clampRetention } from '../../../shared/packetLog';
import type { StateSnapshot, UiState } from '../../../shared/types';
import { macrosStore } from '../../macros/store';
import { protocolSession } from '../../protocol';
import { commit } from '../../state/commit';
import { stateHolder } from '../../state/holder';
import { discoveredStore } from '../../storage/discoveredContacts';
import { packetStore } from '../../storage/packets';
import { transportManager } from '../../transport/manager';
import { buildTileManifest } from '../tiles';
import { buildCapabilities, type RoutesDeps } from './app';

export function registerStateRoutes(api: Hono, deps: RoutesDeps): void {
  const { bridgeStatus } = deps;
  // Single hydration endpoint. Renderer calls this on cold boot or after a
  // reconnect; thereafter it follows WS push events. Per-resource endpoints
  // (PUT /api/settings/app, etc.) update state and trigger broadcasts.
  api.get('/api/state/snapshot', async (c) => {
    const t = transportManager.getState();
    const holder = stateHolder();
    const retention = clampRetention(holder.getUiState().packetLog);
    const payload: StateSnapshot = {
      capabilities: buildCapabilities(deps),
      bridge: bridgeStatus(),
      transport: { state: t.state, deviceId: t.deviceId },
      owner: holder.getOwner(),
      channels: holder.getChannels(),
      channelPresence: protocolSession().getDevicePresence(),
      syncProgress: protocolSession().getSyncProgress(),
      contacts: holder.getContacts(),
      discoveredContacts: discoveredStore.list(holder.getBlockRules()),
      messages: holder.getRecentMessages(),
      appSettings: holder.getAppSettings(),
      radioSettings: holder.getRadioSettings(),
      mapSettings: holder.getMapSettings(),
      mapManifest: await buildTileManifest(),
      mapTileStatus: holder.getMapTileStatus(),
      // Serve the same clamped retention the history query just used.
      uiState: { ...holder.getUiState(), packetLog: retention },
      drafts: holder.getDrafts(),
      deviceIdentity: holder.getDeviceIdentity(),
      autoAddConfig: holder.getAutoAddConfig(),
      telemetryPolicy: holder.getTelemetryPolicy(),
      gpsConfig: holder.getGpsConfig(),
      deviceInfo: holder.getDeviceInfo(),
      deviceCapabilities: holder.getDeviceCapabilities(),
      blockRules: holder.getBlockRules(),
      macros: macrosStore.list(),
      packets: packetStore.recent(Math.min(retention.liveBufferSize, retention.storedHistorySize)),
    };
    return c.json(payload);
  });

  api.put('/api/ui-state', async (c) => {
    const body = (await c.req.json().catch(() => null)) as UiState | null;
    if (!body) return c.json({ error: 'invalid body' }, 400);
    // Retention sizes main's packets-table prune and is synced to every client,
    // so never store or fan out a missing/garbage value a client sent. A client
    // that predates packetLog omits it entirely; keep the current retention rather
    // than resetting it to defaults (an explicit null still normalises to defaults).
    const holder = stateHolder();
    const current = holder.getUiState().packetLog;
    const packetLog = body.packetLog === undefined ? current : clampRetention(body.packetLog);
    const next: UiState = { ...body, packetLog };
    commit.uiState(next);
    // A smaller stored history takes effect now. At 0 nothing is inserted, so
    // without this the old rows would linger and come back if it's raised again.
    if (packetLog.storedHistorySize < current.storedHistorySize) packetStore.prune(packetLog.storedHistorySize);
    return c.json({ ok: true });
  });

  // Composer drafts, one key at a time. Deliberately NOT part of the UiState
  // payload and deliberately NOT broadcast: draft text is per-window
  // in-progress typing, so fanning it to every connected client would fight a
  // second window's typist — and the server binds to 0.0.0.0 when the proxy is
  // configured with bindAll. The key travels in the BODY rather than the path
  // because conversation keys can contain a literal '%' (e.g. `ch:100% Club`),
  // which is the double-decode footgun fixed in c3ab086; see the note on the
  // `:key` routes in routes/channels.ts. Empty text deletes the entry.
  api.put('/api/drafts', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { key?: unknown; text?: unknown } | null;
    if (!body || typeof body.key !== 'string' || typeof body.text !== 'string') {
      return c.json({ error: 'invalid body' }, 400);
    }
    const next = { ...stateHolder().getDrafts() };
    if (body.text) next[body.key] = body.text;
    else delete next[body.key];
    stateHolder().setDrafts(next);
    return c.json({ ok: true });
  });

  api.post('/api/packets/clear', (c) => {
    packetStore.clear();
    return c.json({ ok: true } as const);
  });
}
