import { useEffect, useState } from 'react';
import type { ChannelStats } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

// One request per (channel, message-list identity). The header count and the
// section body both call this hook for the same channel in the same render
// pass; without sharing, expanding the section would double every fetch.
// The messages identity doubles as the cache key's version — it is exactly
// what the effect already refetches on, so a new message invalidates here too.
const inflight = new Map<string, { messages: unknown; promise: Promise<ChannelStats> }>();

function sharedStats(client: ApiClient, key: string, messages: unknown): Promise<ChannelStats> {
  const hit = inflight.get(key);
  if (hit && hit.messages === messages) return hit.promise;
  const promise = api.getChannelStats(client, key);
  // A rejection must not be cached as a permanent failure — drop it so the
  // next render's effect retries instead of replaying the same error forever.
  // Only delete if we're still the current entry: if a newer call for this
  // key already replaced us (e.g. a fresh message arrived before we settled),
  // deleting unconditionally would evict that newer, still-pending entry.
  promise.catch(() => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  });
  inflight.set(key, { messages, promise });
  return promise;
}

/** Test-only escape hatch: clears the module-level in-flight/last-settled
 *  cache. `inflight` is a module singleton, so it survives across `it()`
 *  blocks within one test file — without this, two tests reusing the same
 *  channel key would have the second silently reuse the first's already-
 *  settled promise instead of hitting the mock, producing a confusing
 *  pass/fail. Not referenced by any production code path. */
export function __resetChannelStatsCacheForTests(): void {
  inflight.clear();
}

/** Fetches channel stats lazily (the rail only mounts a section's body when it
 *  is expanded) and refetches whenever this channel's message list changes. */
export function useChannelStats(
  key: string,
  client: ApiClient | null,
): { stats: ChannelStats | null; loading: boolean; error: string | null } {
  const messages = useStore((s) => s.messagesByKey[key]);
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sharedStats(client, key, messages).then(
      (s) => {
        if (!cancelled) {
          setStats(s);
          setLoading(false);
        }
      },
      (e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, key, messages]);

  return { stats, loading, error };
}
