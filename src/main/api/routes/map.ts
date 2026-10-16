import type { Hono } from 'hono';
import type { MapSettings } from '../../../shared/types';
import { emit } from '../../events/bus';
import { clearApiKey, hasApiKey, setApiKey } from '../../map/api-key';
import { clampTileCacheMaxBytes, getTileCache } from '../../map/tile-cache';
import { stateHolder } from '../../state/holder';
import { fail503 } from '../errors';

export function registerMapRoutes(api: Hono): void {
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
      tileCacheMaxBytes: clampTileCacheMaxBytes(body.tileCacheMaxBytes),
    };
    holder.setMapSettings(sanitized);
    void getTileCache().setMaxBytes(sanitized.tileCacheMaxBytes);
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
      return fail503(c, err);
    }
    const holder = stateHolder();
    const next: MapSettings = { ...holder.getMapSettings(), hasProtomapsApiKey: true };
    holder.setMapSettings(next);
    emit.mapSettings(next);
    holder.setMapTileStatus({ keyConfigured: true, keyRejected: false });
    emit.mapTileStatus(holder.getMapTileStatus());
    return c.json({ ok: true, hasKey: true });
  });

  api.get('/api/map/api-key', (c) => c.json({ hasKey: hasApiKey() }));

  api.delete('/api/map/api-key', async (c) => {
    await clearApiKey();
    const holder = stateHolder();
    const next: MapSettings = { ...holder.getMapSettings(), hasProtomapsApiKey: false };
    holder.setMapSettings(next);
    emit.mapSettings(next);
    holder.setMapTileStatus({ keyConfigured: false, keyRejected: false });
    emit.mapTileStatus(holder.getMapTileStatus());
    return c.json({ ok: true, hasKey: false });
  });
}
