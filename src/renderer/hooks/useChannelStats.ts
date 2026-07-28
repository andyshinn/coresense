import { useEffect, useState } from 'react';
import type { ChannelStats, Message } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

// One request per (client, channel, stats-version). The header count and the
// section body both call this hook for the same channel in the same render
// pass; without sharing, expanding the section would double every fetch.
//
// The cache is keyed on a cheap scalar "version" of the message list — length
// plus the last message's timestamp — rather than the array's identity.
// Channel stats (count, lastTs, roster) depend only on those two things, but
// `store.ts`'s `applyMessageState` rebuilds EVERY key's array (new identity,
// same length/order) on any message's state transition. Keying on identity
// meant an unrelated DM's pending → sent → delivered churn replaced this
// channel's array too, re-running the effect and re-hitting the server for
// data that provably hasn't changed.
const inflight = new Map<string, { version: string; promise: Promise<ChannelStats> }>();

/** Distinguishes requests against different servers/credentials so a stale
 *  baseUrl/apiKey combo's in-flight promise is never served to a caller using
 *  a new one. */
function clientId(client: ApiClient): string {
  return `${client.baseUrl}#${client.apiKey}`;
}

function statsVersion(messages: Message[] | undefined): string {
  return `${messages?.length ?? -1}:${messages?.at(-1)?.ts ?? 0}`;
}

function sharedStats(client: ApiClient, key: string, version: string): Promise<ChannelStats> {
  const cacheKey = `${clientId(client)}::${key}`;
  const hit = inflight.get(cacheKey);
  if (hit && hit.version === version) return hit.promise;
  const promise = api.getChannelStats(client, key);
  // A rejection must not be cached as a permanent failure — drop it so the
  // next render's effect retries instead of replaying the same error forever.
  // Only delete if we're still the current entry: if a newer call for this
  // key already replaced us (e.g. a fresh message arrived before we settled),
  // deleting unconditionally would evict that newer, still-pending entry.
  promise.catch(() => {
    if (inflight.get(cacheKey)?.promise === promise) inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, { version, promise });
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
  const version = statsVersion(messages);
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    sharedStats(client, key, version).then(
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
  }, [client, key, version]);

  return { stats, loading, error };
}
