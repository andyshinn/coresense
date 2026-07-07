import { useEffect, useState } from 'react';
import type { ChannelStats } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: messagesByKey[key] is the refetch trigger, not read inside the effect
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getChannelStats(client, key).then(
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
