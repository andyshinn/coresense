import { useCallback, useState } from 'react';
import { type ApiClient, api } from '../lib/api';
import { notify } from '../lib/notify';

/** Shared behaviour behind the two "re-read the radio's contacts" affordances —
 *  the Contacts header button and the rail quick action (#45 item 6). Both need
 *  the same in-flight guard: a full GET_CONTACTS walk is tens of seconds of
 *  serial traffic, and meshcore-ts QUEUES a second one rather than rejecting it.
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
      // The server answers `skipped` when the handshake is already walking the
      // same stream — claiming "re-read 0 contacts" there would be a lie.
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
