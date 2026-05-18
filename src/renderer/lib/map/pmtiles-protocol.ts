import maplibregl from 'maplibre-gl';
import { FetchSource, PMTiles, Protocol } from 'pmtiles';
import type { ApiClient } from '../api';

// One PMTiles protocol registration per renderer lifetime. MapLibre is global;
// re-registering on every MapCanvas mount would leak. We rebuild the cache when
// the API client (and therefore the auth header) changes, since pmtiles.js
// otherwise reuses cached PMTiles instances forever.

let installed = false;
let activeProtocol: Protocol | null = null;
let activeClientKey: string | null = null;

function clientKey(client: ApiClient): string {
  return `${client.baseUrl}|${client.apiKey}`;
}

export function ensurePmtilesProtocol(client: ApiClient): void {
  const key = clientKey(client);
  if (installed && activeClientKey === key) return;

  if (installed && activeProtocol) {
    // Drop the old protocol so the GC can release the cached PMTiles instances
    // (each holds an in-memory directory tree from the header). MapLibre's
    // removeProtocol is a no-op if nothing is registered, so this is safe.
    maplibregl.removeProtocol('pmtiles');
  }

  const protocol = new Protocol();
  for (const source of ['basemap', 'terrain'] as const) {
    const url = `${client.baseUrl}/api/tiles/${source}`;
    const headers = new Headers({ Authorization: `Bearer ${client.apiKey}` });
    const fetchSource = new FetchSource(url, headers);
    protocol.add(new PMTiles(fetchSource));
  }
  maplibregl.addProtocol('pmtiles', protocol.tile);

  installed = true;
  activeProtocol = protocol;
  activeClientKey = key;
}

/** URL to embed in a MapLibre vector/raster source for a bundled extract. */
export function pmtilesUrl(baseUrl: string, source: 'basemap' | 'terrain'): string {
  return `pmtiles://${baseUrl}/api/tiles/${source}`;
}
