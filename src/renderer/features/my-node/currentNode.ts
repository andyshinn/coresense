import type { NodeCache, NodeCacheEntry } from '../../../shared/types';
import { loadLastDevice } from '../../lib/lastDevice';
import { useStore } from '../../lib/store';

/**
 * The radio My Node is about. Connected: the connected radio's entry.
 * Disconnected: the remembered radio's (matched on its BLE id), else the most
 * recently seen. Null when the cache has nothing to show.
 */
export function pickNodeEntry(
  cache: NodeCache,
  ownerKey: string | null,
  connected: boolean,
  rememberedBleId: string | null,
): NodeCacheEntry | null {
  if (connected && ownerKey) return cache.entries[ownerKey.toLowerCase()] ?? null;
  const entries = Object.values(cache.entries);
  if (rememberedBleId) {
    const remembered = entries.find((e) => e.bleId === rememberedBleId);
    if (remembered) return remembered;
  }
  return entries.reduce<NodeCacheEntry | null>(
    (best, e) => (best === null || (e.lastSeenAt ?? 0) > (best.lastSeenAt ?? 0) ? e : best),
    null,
  );
}

/** The cache entry My Node shows (see pickNodeEntry). */
export function useCurrentNode(): NodeCacheEntry | null {
  const cache = useStore((s) => s.nodeCache);
  const ownerKey = useStore((s) => s.owner?.publicKeyHex ?? null);
  const connected = useStore((s) => s.transportState === 'connected');
  return pickNodeEntry(cache, ownerKey, connected, loadLastDevice()?.id ?? null);
}
