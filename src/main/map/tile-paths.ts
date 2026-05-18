import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { TileSource } from '../../shared/types';

export type { TileSource };

const TILE_SOURCES: readonly TileSource[] = ['basemap', 'terrain'];

function resolvedPath(name: TileSource): string {
  const file = `${name}.pmtiles`;
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(app.getAppPath(), 'resources', 'tiles', file);
}

export function tilePath(name: TileSource): string {
  return resolvedPath(name);
}

export function tilePathIfExists(name: TileSource): string | null {
  const p = resolvedPath(name);
  return existsSync(p) ? p : null;
}

export function listAvailableTiles(): Record<TileSource, string | null> {
  return {
    basemap: tilePathIfExists('basemap'),
    terrain: tilePathIfExists('terrain'),
  };
}

export function allTileSources(): readonly TileSource[] {
  return TILE_SOURCES;
}
