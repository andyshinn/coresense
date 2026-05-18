import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { child } from '../log';

// Protomaps hosted-API key, stored at rest as an OS-keychain-encrypted blob.
// The renderer never sees the plaintext — it only learns hasKey() over the
// MapSettings WS broadcast and asks main to proxy individual tile requests.
//
// safeStorage uses Keychain on macOS, DPAPI on Windows, and libsecret /
// kwallet on Linux. If encryption isn't available (headless Linux without a
// keyring), we refuse to store the key rather than writing plaintext to disk.

const FILE = 'protomaps-api-key.enc';
const log = child('map-api-key');

function blobPath(): string {
  return join(app.getPath('userData'), FILE);
}

export function hasApiKey(): boolean {
  return existsSync(blobPath());
}

export async function getApiKey(): Promise<string | null> {
  const path = blobPath();
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('safeStorage unavailable; cannot decrypt protomaps key blob');
    return null;
  }
  try {
    const cipher = await readFile(path);
    return safeStorage.decryptString(cipher);
  } catch (err) {
    log.error(`failed to read api-key blob: ${(err as Error).message}`);
    return null;
  }
}

export async function setApiKey(key: string): Promise<void> {
  if (!key.trim()) throw new Error('key is empty');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (keychain/DPAPI/libsecret) is not available');
  }
  const cipher = safeStorage.encryptString(key.trim());
  const path = blobPath();
  const tmp = `${path}.tmp`;
  // Two-step write so a crash mid-encrypt can't leave a truncated blob in place.
  await writeFile(tmp, cipher, { mode: 0o600 });
  await rename(tmp, path);
}

export async function clearApiKey(): Promise<void> {
  await rm(blobPath(), { force: true });
}
