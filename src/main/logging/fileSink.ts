import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LogEntry } from '../../shared/types';
import { userDataDir } from '../runtime/userData';

const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let enabled = false;
let lastPruneTs = 0;
let cachedDateStr = '';
let cachedFilePath = '';
let cachedFolder = '';
let folderEnsured = false;
let writeChain: Promise<void> = Promise.resolve();

export function setEnabled(flag: boolean): void {
  enabled = flag;
}

export function folderPath(): string {
  if (!cachedFolder) cachedFolder = path.join(userDataDir(), 'logs');
  return cachedFolder;
}

export function currentPath(): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  if (dateStr !== cachedDateStr) {
    cachedDateStr = dateStr;
    cachedFilePath = path.join(folderPath(), `coresense-${dateStr}.log`);
    folderEnsured = false;
  }
  return cachedFilePath;
}

export function write(entry: LogEntry): void {
  if (!enabled) return;

  const filePath = currentPath();
  const folder = folderPath();
  const line =
    JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      source: entry.source,
      logger: entry.logger,
      message: entry.message,
      ...(entry.args !== undefined ? { args: entry.args } : {}),
    }) + '\n';

  // Serialize writes to preserve order; chain off the prior write.
  writeChain = writeChain.then(async () => {
    try {
      if (!folderEnsured) {
        await fs.mkdir(folder, { recursive: true });
        folderEnsured = true;
      }
      await fs.appendFile(filePath, line, 'utf8');
    } catch (err) {
      console.error('[fileSink] write error:', err);
    }
  });

  maybePrune(folder);
}

function maybePrune(folder: string): void {
  const now = Date.now();
  if (now - lastPruneTs < PRUNE_INTERVAL_MS) return;
  lastPruneTs = now;

  void (async () => {
    try {
      const files = await fs.readdir(folder);
      const cutoff = now - MAX_AGE_MS;
      for (const file of files) {
        if (!/^coresense-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;
        const fullPath = path.join(folder, file);
        try {
          const stat = await fs.stat(fullPath);
          if (stat.mtimeMs < cutoff) {
            await fs.unlink(fullPath);
          }
        } catch (innerErr) {
          console.error('[fileSink] prune stat/unlink error:', innerErr);
        }
      }
    } catch (err) {
      console.error('[fileSink] prune readdir error:', err);
    }
  })();
}
