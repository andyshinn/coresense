import { open, stat } from 'node:fs/promises';
import type { Context, Hono } from 'hono';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import type { TileManifest, TileManifestEntry, TileSource } from '../../shared/types';
import { child } from '../log';
import { getApiKey as getProtomapsApiKey } from '../map/api-key';
import { allTileSources, tilePathIfExists } from '../map/tile-paths';

const log = child('tile-proxy');
const PROTOMAPS_TILE_BASE = 'https://api.protomaps.com/tiles/v4';

// PMTiles bundled with the app can be hundreds of MB. The renderer's pmtiles.js
// library issues HTTP Range requests against /api/tiles/:source and parses the
// PMTiles structure itself — we just need a faithful byte-range file server.
// A separate manifest endpoint summarizes the header so the renderer can pick
// an initial view and decide where the online fallback kicks in.

class FileSource implements Source {
  constructor(private readonly path: string) {}

  getKey(): string {
    return this.path;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const fh = await open(this.path, 'r');
    try {
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, offset);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return { data: ab as ArrayBuffer };
    } finally {
      await fh.close();
    }
  }
}

async function readManifestEntry(source: TileSource, path: string): Promise<TileManifestEntry> {
  const [stats, header] = await Promise.all([
    stat(path),
    new PMTiles(new FileSource(path)).getHeader(),
  ]);
  return {
    source,
    bytes: stats.size,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    center: {
      lng: header.centerLon,
      lat: header.centerLat,
      zoom: header.centerZoom,
    },
    tileType: header.tileType,
  };
}

export async function buildTileManifest(): Promise<TileManifest> {
  const entries = await Promise.all(
    allTileSources().map(async (source) => {
      const path = tilePathIfExists(source);
      if (!path) return [source, null] as const;
      try {
        return [source, await readManifestEntry(source, path)] as const;
      } catch {
        return [source, null] as const;
      }
    }),
  );
  const map = Object.fromEntries(entries) as Record<TileSource, TileManifestEntry | null>;
  return {
    missing: !map.basemap && !map.terrain,
    basemap: map.basemap,
    terrain: map.terrain,
  };
}

function isTileSource(value: string): value is TileSource {
  return value === 'basemap' || value === 'terrain';
}

async function serveRange(c: Context, filePath: string) {
  const stats = await stat(filePath);
  const total = stats.size;
  const rangeHeader = c.req.header('range');

  if (!rangeHeader) {
    // pmtiles.js always sends a Range; full reads only happen via curl/debug.
    const fh = await open(filePath, 'r');
    try {
      const buf = Buffer.alloc(total);
      await fh.read(buf, 0, total, 0);
      return c.body(toArrayBuffer(buf), 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
      });
    } finally {
      await fh.close();
    }
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return c.body(null, 416, { 'Content-Range': `bytes */${total}` });
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= total
  ) {
    return c.body(null, 416, { 'Content-Range': `bytes */${total}` });
  }
  const clampedEnd = Math.min(end, total - 1);
  const length = clampedEnd - start + 1;

  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return c.body(toArrayBuffer(buf), 206, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(length),
      'Content-Range': `bytes ${start}-${clampedEnd}/${total}`,
      'Accept-Ranges': 'bytes',
    });
  } finally {
    await fh.close();
  }
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function registerTileRoutes(api: Hono): void {
  api.get('/api/tiles/manifest', async (c) => c.json(await buildTileManifest()));

  api.get('/api/tiles/:source', async (c) => {
    const source = c.req.param('source');
    if (!isTileSource(source)) {
      return c.json({ error: 'unknown source' }, 400);
    }
    const path = tilePathIfExists(source);
    if (!path) {
      return c.json({ error: 'tiles_missing', source }, 404);
    }
    return serveRange(c, path);
  });

  // Proxy a single Protomaps API tile so the stored API key never leaves main.
  // Upstream failures degrade to 502 — MapLibre treats that as a missing tile
  // and renders blank rather than throwing, which is the desired UX when the
  // user goes offline mid-pan.
  api.get('/api/map/online-tile-proxy/:source/:z/:x/:y', async (c) => {
    const source = c.req.param('source');
    if (!isTileSource(source)) {
      return c.json({ error: 'unknown source' }, 400);
    }
    const key = await getProtomapsApiKey();
    if (!key) return c.json({ error: 'no_api_key' }, 404);

    const z = c.req.param('z');
    const x = c.req.param('x');
    const y = c.req.param('y');
    // Protomaps v4 hosts vector tiles for the same schema we render from PMTiles.
    // Terrain has no online fallback — Mapterhorn isn't on the Protomaps API.
    const upstream = `${PROTOMAPS_TILE_BASE}/${z}/${x}/${y}.mvt?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(upstream);
      if (res.status === 404) {
        // Out-of-coverage tile — return 204 so MapLibre stops retrying.
        return c.body(null, 204);
      }
      if (!res.ok) {
        log.warn(`upstream ${res.status} for ${z}/${x}/${y}`);
        return c.body(null, 502);
      }
      const buf = await res.arrayBuffer();
      return c.body(buf, 200, {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/vnd.mapbox-vector-tile',
        // Short cache so the renderer doesn't re-fetch on every pan in a session.
        'Cache-Control': 'private, max-age=300',
      });
    } catch (err) {
      log.warn(`fetch failed for ${z}/${x}/${y}: ${(err as Error).message}`);
      return c.body(null, 502);
    }
  });
}
