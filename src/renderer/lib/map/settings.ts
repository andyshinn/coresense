import type { MapSettings } from '../../../shared/types';
import { type ApiClient, api } from '../api';
import { notify } from '../notify';
import { useStore } from '../store';

/** Merge `patch` into the live map settings, apply it and persist the result.
 *  Merging into `getState()` rather than a caller's render-time snapshot keeps
 *  one writer from reverting a field another just changed (the viewport
 *  persist and the controls both write here). A failed PUT is reported and
 *  rolled back, unless a newer write has already replaced it. Without a client
 *  the change is applied locally only. */
export function updateMapSettings(client: ApiClient | null, patch: Partial<MapSettings>): void {
  const { mapSettings: prev, applyMapSettings } = useStore.getState();
  const next: MapSettings = { ...prev, ...patch };
  applyMapSettings(next);
  // applyMapSettings stores a copy (merged over the defaults), so "has a newer
  // write replaced ours?" compares against what it stored, not `next`.
  const applied = useStore.getState().mapSettings;
  if (!client) return;
  api.putMapSettings(client, next).catch((err: unknown) => {
    if (useStore.getState().mapSettings === applied) applyMapSettings(prev);
    notify.failure('Saving map settings', err);
  });
}
