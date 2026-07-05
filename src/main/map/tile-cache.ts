import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { TileCacheInfo } from '../../shared/types';
import { userDataDir } from '../runtime/userData';

/** Default on-disk cap for cached online tiles (512 MB). */
export const DEFAULT_TILE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
/** Clamp bounds for the user-configurable cap. */
export const MIN_TILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const MAX_TILE_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Clamp an inbound cap (from renderer settings) into the allowed range. */
export function clampTileCacheMaxBytes(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_TILE_CACHE_MAX_BYTES;
  return Math.min(MAX_TILE_CACHE_MAX_BYTES, Math.max(MIN_TILE_CACHE_MAX_BYTES, Math.floor(n)));
}

interface Entry {
  size: number;
  /** Monotonic access stamp for LRU ordering (higher = more recent). */
  atime: number;
}

/**
 * File-per-tile disk cache with an in-memory LRU index. Tiles live at
 * `<dir>/<key>.mvt` where key is `<source>/<z>/<x>/<y>`. The index is built
 * lazily by walking the dir; total bytes are tracked so a `put` past the cap
 * evicts least-recently-used files down to a 90% low-water mark.
 */
export class TileCache {
  private index = new Map<string, Entry>();
  private total = 0;
  private clock = 0;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private maxBytes: number,
  ) {}

  dirPath(): string {
    return this.dir;
  }

  async setMaxBytes(next: number): Promise<void> {
    this.maxBytes = next;
    await this.ensureIndex();
    await this.evictIfNeeded();
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}.mvt`);
  }

  private ensureIndex(): Promise<void> {
    if (!this.ready) this.ready = this.buildIndex();
    return this.ready;
  }

  private async buildIndex(): Promise<void> {
    this.index.clear();
    this.total = 0;
    let maxStamp = 0;
    let entries: Dirent[];
    try {
      entries = await readdir(this.dir, { recursive: true, withFileTypes: true });
    } catch {
      return; // dir doesn't exist yet
    }
    for (const d of entries) {
      if (!d.isFile() || !d.name.endsWith('.mvt')) continue;
      const full = join(d.parentPath, d.name);
      const rel = full.slice(this.dir.length + 1);
      const key = rel.slice(0, -'.mvt'.length).split(sep).join('/');
      const st = await stat(full);
      this.index.set(key, { size: st.size, atime: st.mtimeMs });
      this.total += st.size;
      if (st.mtimeMs > maxStamp) maxStamp = st.mtimeMs;
    }
    this.clock = maxStamp;
  }

  async get(key: string): Promise<Buffer | null> {
    await this.ensureIndex();
    const entry = this.index.get(key);
    if (!entry) return null;
    try {
      const bytes = await readFile(this.pathFor(key));
      entry.atime = ++this.clock;
      return bytes;
    } catch {
      this.index.delete(key);
      this.total -= entry.size;
      return null;
    }
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    await this.ensureIndex();
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    const prev = this.index.get(key);
    if (prev) this.total -= prev.size;
    this.index.set(key, { size: bytes.length, atime: ++this.clock });
    this.total += bytes.length;
    await this.evictIfNeeded();
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.total <= this.maxBytes) return;
    const low = Math.floor(this.maxBytes * 0.9);
    const ordered = [...this.index.entries()].sort((a, b) => a[1].atime - b[1].atime);
    for (const [key, entry] of ordered) {
      if (this.total <= low) break;
      await rm(this.pathFor(key), { force: true });
      this.index.delete(key);
      this.total -= entry.size;
    }
  }

  async size(): Promise<TileCacheInfo> {
    await this.ensureIndex();
    return { bytes: this.total, count: this.index.size };
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
    this.index.clear();
    this.total = 0;
    this.clock = 0;
    this.ready = null; // force a rebuild on next op
  }
}

let singleton: TileCache | null = null;

/** Process-wide cache bound to the current userData dir. Rebinds if the dir
 *  changes (e.g. between tests that inject a temp userData dir). */
export function getTileCache(): TileCache {
  const dir = join(userDataDir(), 'tile-cache');
  if (!singleton || singleton.dirPath() !== dir) {
    singleton = new TileCache(dir, DEFAULT_TILE_CACHE_MAX_BYTES);
  }
  return singleton;
}

// --- Open-in-file-manager seam (real impl injected from src/main/index.ts) ---
let opener: (dir: string) => void = () => {};

export function setTileCacheOpener(fn: (dir: string) => void): void {
  opener = fn;
}

export async function revealTileCache(): Promise<void> {
  const cache = getTileCache();
  await cache.ensureDir();
  opener(cache.dirPath());
}
