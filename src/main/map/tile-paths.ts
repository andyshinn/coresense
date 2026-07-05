import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TileSource } from '../../shared/types';
import { appPath, isPackaged } from '../runtime/appInfo';

export type { TileSource };

function resolvedPath(name: TileSource): string {
  const file = `${name}.pmtiles`;
  return isPackaged() ? join(process.resourcesPath, file) : join(appPath(), 'resources', 'tiles', file);
}

export function tilePath(name: TileSource): string {
  return resolvedPath(name);
}

export function tilePathIfExists(name: TileSource): string | null {
  const p = resolvedPath(name);
  return existsSync(p) ? p : null;
}
