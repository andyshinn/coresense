import { useEffect, useState } from 'react';
import type { ChannelActivity } from '../../shared/types';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';

/** Nothing in the app invalidates on wall-clock rollover, so an idle channel's
 *  trailing window would drift stale indefinitely. Re-poll coarsely. */
const REFRESH_MS = 300_000;

/** Fetches the channel activity histogram lazily (the rail only mounts a section's
 *  body when it is expanded) and refetches whenever this channel's message list
 *  changes or the refresh interval elapses. */
export function useChannelActivity(
  key: string,
  client: ApiClient | null,
): { activity: ChannelActivity | null; loading: boolean; error: string | null } {
  const messages = useStore((s) => s.messagesByKey[key]);
  const [activity, setActivity] = useState<ChannelActivity | null>(null);
  // Starts true: the first render happens before the fetch effect below has run,
  // so `activity` is still null then too. Defaulting this to false would make that
  // first frame indistinguishable from "checked, and there truly is no activity" —
  // an assertion about the channel we have not earned yet, and exactly the kind of
  // lie this redesign exists to stop telling.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messagesByKey[key] and tick are refetch triggers, not read inside the effect
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getChannelActivity(client, key).then(
      (a) => {
        if (!cancelled) {
          setActivity(a);
          setLoading(false);
        }
      },
      (e) => {
        if (!cancelled) {
          // Deliberately leave `activity` in place on a failed refetch: a transient
          // API/radio hiccup should not blank a chart that was correct a minute ago.
          // `error` is only ever surfaced when there is nothing to show — see the
          // `!activity` branch in the Activity section.
          setError((e as Error).message);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, key, messages, tick]);

  return { activity, loading, error };
}
