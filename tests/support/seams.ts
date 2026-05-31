import { Buffer } from 'node:buffer';
import type { AppLifecycle } from '../../src/main/runtime/appLifecycle';
import type { SecretStore } from '../../src/main/runtime/secretStore';

export interface SpyLifecycle extends AppLifecycle {
  calls: string[];
}

/** AppLifecycle double that records calls instead of touching the process. */
export function spyLifecycle(): SpyLifecycle {
  const calls: string[] = [];
  return {
    calls,
    quit: () => void calls.push('quit'),
    relaunch: () => void calls.push('relaunch'),
    exit: (code) => void calls.push(`exit:${code ?? 0}`),
  };
}

/** In-memory SecretStore double — no OS keychain. */
export function memorySecretStore(): SecretStore {
  return {
    available: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  };
}
