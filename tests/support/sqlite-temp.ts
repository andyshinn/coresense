import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetNodeCacheState } from '../../src/main/node/nodeCache';
import { setUserDataDir } from '../../src/main/runtime/userData';
import { resetAdvertPathState } from '../../src/main/state/advertPath';
import { closeDb } from '../../src/main/storage/db';
import { resetDiscoveredFlagCache } from '../../src/main/storage/discoveredContacts';
import { resetMeshLock } from '../../src/main/telemetry/meshLock';
import { forgetRadioTelemetryPolicy } from '../../src/main/telemetry/policy';
import { resetTelemetryState } from '../../src/main/telemetry/service';

let currentDir: string | null = null;

/** Point storage at a fresh temp userData dir and reset the DB singleton. */
export function useTempUserData(): string {
  currentDir = mkdtempSync(join(tmpdir(), 'coresense-it-'));
  setUserDataDir(currentDir);
  closeDb();
  // The flag cache is module state keyed by pubkey; a fresh DB must not inherit
  // what was written to the previous one.
  resetDiscoveredFlagCache();
  // Same story for the advert-path cooldown/in-flight maps: a cooldown armed
  // against the previous database would silently skip the radio round trip the
  // next test is asserting on.
  resetAdvertPathState();
  // Telemetry's in-flight registry, the radio-wide mesh lock and the "policy
  // read back from the radio" flag are module state too.
  resetTelemetryState();
  resetMeshLock();
  forgetRadioTelemetryPolicy();
  // The node cache loads node-cache.json once and remembers the connected radio.
  resetNodeCacheState();
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
