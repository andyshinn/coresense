import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { type ApiClient, api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';

export async function saveApp(client: ApiClient | null, patch: Partial<AppSettingsType>, message: string): Promise<void> {
  if (!client) throw new Error('No server connection');
  await api.putAppSettings(client, { ...useStore.getState().appSettings, ...patch });
  notify.success(message);
}
