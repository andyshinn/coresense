import { type ApiClient, api } from '../lib/api';
import { flushDrafts } from './useDraftsPersistence';
import { flushUiState } from './useUiStatePersistence';

/** Tell main it's safe to quit. Main exits almost at once after confirmQuit,
 *  so this is the last boundary: get any coalesced ui change and any
 *  unwritten draft onto disk first. The one quit path for menuActions'
 *  requestQuit and the unsaved-changes dialog. */
export async function flushAndConfirmQuit(client: ApiClient): Promise<void> {
  await Promise.all([flushUiState(), flushDrafts()]);
  await api.confirmQuit(client);
}
