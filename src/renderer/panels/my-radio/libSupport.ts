import { useSyncExternalStore } from 'react';

// Whether the main process's meshcore-ts can do My radio's telemetry calls.
// Main feature-detects them and answers 501 `lib_unsupported` otherwise, but
// doesn't advertise support up front, so the renderer learns it from the
// first 501. Self read, sensor settings (custom vars) and per-contact flags
// all arrive together in meshcore-ts 0.9, so one 501 marks the lot — My radio
// fetches the sensor settings on mount, which settles it before anyone clicks.
// The library ships inside the app, so the answer can't change until restart.

/** Copy for every control that needs the newer library. */
export const NEEDS_LIB = 'Needs meshcore-ts 0.9';

let unsupported = false;
const listeners = new Set<() => void>();

/** True for the server's 501 `lib_unsupported` answer. Duck-typed: tests mock lib/api wholesale. */
export function isLibUnsupportedError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null;
  return e?.code === 'lib_unsupported' || e?.status === 501;
}

export function markLibUnsupported(): void {
  if (unsupported) return;
  unsupported = true;
  for (const l of listeners) l();
}

/** Tests only: forget what was learned. */
export function resetLibSupport(): void {
  unsupported = false;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once main has answered `lib_unsupported` to any My radio call. */
export function useLibUnsupported(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unsupported,
    () => unsupported,
  );
}
