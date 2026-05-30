import type { Buffer } from 'node:buffer';

// Injectable wrapper over Electron safeStorage (used by map/api-key.ts).
// Production wires electron.safeStorage in index.ts; tests inject an in-memory
// plaintext impl. Mirrors the safeStorage API surface api-key.ts depends on.
export interface SecretStore {
  available(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(cipher: Buffer): string;
}

let injected: SecretStore | null = null;

export function setSecretStore(impl: SecretStore | null): void {
  injected = impl;
}

export function secretStore(): SecretStore {
  if (!injected) {
    throw new Error('secretStore not set — call setSecretStore() during bootstrap (index.ts)');
  }
  return injected;
}
