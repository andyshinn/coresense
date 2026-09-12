import { useCallback, useState } from 'react';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';

/** Shared behaviour behind the two "re-read the radio's contacts" affordances —
 *  the Contacts header button and the rail quick action (#45 item 6).
 *
 *  `refreshing` is a per-control affordance (spinner + disabled), NOT the
 *  serialisation point: both controls are on screen at once with an instance of
 *  this hook each, and a remount resets it. Overlapping contact walks are a
 *  correctness problem, not just a waste (see main/state/contactWalk.ts), so the
 *  real guard is server-side and answers `skipped`.
 *
 *  Nothing is returned but the busy flag: the refreshed rows arrive over the
 *  websocket, so the toast is the whole user-visible result. */
export function useContactRefresh(client: ApiClient | null): { refreshing: boolean; refresh: () => Promise<void> } {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || refreshing) return;
    setRefreshing(true);
    try {
      const res = await api.refreshContacts(client);
      // The server answers `skipped` when a walk is already running — the
      // handshake's, the periodic re-read's, or the other control's. Claiming
      // "re-read 0 contacts" there would be a lie.
      if (res.skipped) notify.info('Radio is already syncing contacts');
      else notify.success(`Re-read ${res.count ?? 0} contact${res.count === 1 ? '' : 's'} from the radio`);
    } catch (err) {
      notify.error(`Contact refresh failed: ${(err as Error).message}`, err);
    } finally {
      setRefreshing(false);
    }
  }, [client, refreshing]);

  return { refreshing, refresh };
}
