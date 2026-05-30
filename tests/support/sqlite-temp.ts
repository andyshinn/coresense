import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setUserDataDir } from '../../src/main/runtime/userData';
import { closeDb } from '../../src/main/storage/db';

let currentDir: string | null = null;

/** Point storage at a fresh temp userData dir and reset the DB singleton. */
export function useTempUserData(): string {
  currentDir = mkdtempSync(join(tmpdir(), 'coresense-it-'));
  setUserDataDir(currentDir);
  closeDb();
  return currentDir;
}

/** Tear down: close the DB and remove the temp dir. */
export function cleanupTempUserData(): void {
  closeDb();
  if (currentDir) {
    rmSync(currentDir, { recursive: true, force: true });
    currentDir = null;
  }
  setUserDataDir(null);
}
