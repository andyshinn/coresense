import type { Hono } from 'hono';
import { apiKeyBodySchema, mapSettingsBodySchema } from '../../../shared/api/schemas';
import type { MapSettings } from '../../../shared/types';
import { emit } from '../../events/bus';
import { clearApiKey, hasApiKey, setApiKey } from '../../map/api-key';
import { clampTileCacheMaxBytes, getTileCache } from '../../map/tile-cache';
import { commit } from '../../state/commit';
import { stateHolder } from '../../state/holder';
import { readJson } from '../body';
import { fail503 } from '../errors';

/** A key was just stored or cleared: broadcast the server-owned presence flag
 *  and reset the tile status, since a new key has not been rejected yet. */
function applyApiKeyPresence(hasKey: boolean): void {
  const holder = stateHolder();
  commit.mapSettings({ ...holder.getMapSettings(), hasProtomapsApiKey: hasKey });
  holder.setMapTileStatus({ keyConfigured: hasKey, keyRejected: false });
  emit.mapTileStatus(holder.getMapTileStatus());
}

export function registerMapRoutes(api: Hono): void {
  // Map panel preferences. `hasProtomapsApiKey` is server-owned (derived from
  // the encrypted blob's presence — Phase 4) and ignored from inbound bodies
  // so the renderer can't fake it. The API key itself never travels through
  // this endpoint; see /api/map/api-key (Phase 4).
  api.put('/api/settings/map', async (c) => {
    const body = await readJson(c, mapSettingsBodySchema);
    const holder = stateHolder();
    const current = holder.getMapSettings();
    // hasProtomapsApiKey is server-owned (derived from the encrypted blob's
    // existence); ignore the inbound value so the renderer can't forge it.
    const sanitized: MapSettings = {
      ...body,
      hasProtomapsApiKey: current.hasProtomapsApiKey,
      tileCacheMaxBytes: clampTileCacheMaxBytes(body.tileCacheMaxBytes),
    };
    commit.mapSettings(sanitized);
    void getTileCache().setMaxBytes(sanitized.tileCacheMaxBytes);
    return c.json({ ok: true });
  });

  // Protomaps hosted-API key. The plaintext is accepted only by POST and is
  // immediately written to an OS-encrypted blob via safeStorage; it is never
  // returned by any endpoint. Renderer learns key presence via
  // MapSettings.hasProtomapsApiKey (broadcast after set/clear).
  api.post('/api/map/api-key', async (c) => {
    const body = await readJson(c, apiKeyBodySchema);
    try {
      await setApiKey(body.key);
    } catch (err) {
      return fail503(c, err);
    }
    applyApiKeyPresence(true);
    return c.json({ ok: true, hasKey: true });
  });

  api.get('/api/map/api-key', (c) => c.json({ hasKey: hasApiKey() }));

  api.delete('/api/map/api-key', async (c) => {
    await clearApiKey();
    applyApiKeyPresence(false);
    return c.json({ ok: true, hasKey: false });
  });
}
