// Central resolver for the writable userData directory. Production wires the
// real Electron path in index.ts bootstrap via setUserDataDir(); tests inject a
// temp dir. Resolution order: injected dir → CORESENSE_USER_DATA env → throw.
// This module deliberately does NOT import 'electron', so the storage/api graph
// stays Electron-free under Vitest.
let injected: string | null = null;

export function setUserDataDir(dir: string | null): void {
  injected = dir;
}

export function userDataDir(): string {
  if (injected) return injected;
  const fromEnv = process.env.CORESENSE_USER_DATA;
  if (fromEnv) return fromEnv;
  throw new Error(
    'userData directory not set — call setUserDataDir() during bootstrap (index.ts) or set CORESENSE_USER_DATA',
  );
}
