import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';

// Re-requests the radio's device snapshot (DEVICE_QUERY + GET_BATT_AND_STORAGE +
// GET_AUTO_ADD_CONFIG + GPS custom vars). Shared by the Refresh rows in Radio →
// Device Info and Extra → Maintenance.
export function useDeviceRefresh(client: ApiClient | null) {
  const connected = useStore((s) => s.transportState === 'connected');

  const refresh = async () => {
    if (!client) return;
    try {
      await api.refreshDevice(client);
      notify.success('Device refresh requested');
    } catch (err) {
      notify.failure('Refresh', err);
    }
  };

  return { refresh, canRefresh: !!client && connected };
}
