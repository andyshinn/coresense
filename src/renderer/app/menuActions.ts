import { conversationKind } from '../../shared/conversationKey';
import { type ActiveKey, isActiveKey } from '../../shared/keys';
import type { MenuAction } from '../../shared/types';
import { api } from '../lib/api';
import { getApiClient } from '../lib/apiClientContext';
import { loadLastDevice } from '../lib/lastDevice';
import { notify } from '../lib/notify';
import { selectAnySettingsDirty, selectIsConnected, useStore } from '../lib/store';
import { firstUnreadMessageId } from '../lib/utils';
import { flushDrafts } from './useDraftsPersistence';
import { flushUiState } from './useUiStatePersistence';

/** The client is not a dep: actions that call the API read the current one
 *  from getApiClient() when they run, so the handler never holds a stale one. */
export interface MenuActionHandlerDeps {
  cycleThemePref: () => void;
  toggleLeftNav: () => void;
  toggleRightRail: () => void;
  togglePin: (key: ActiveKey) => void;
  setActiveKey: (key: ActiveKey) => void;
}

/** Factory for the menu/keyboard action dispatcher used by App.tsx. */
export function createMenuActionHandler(deps: MenuActionHandlerDeps): (action: MenuAction) => void {
  const { cycleThemePref, toggleLeftNav, toggleRightRail, togglePin, setActiveKey } = deps;
  return (action: MenuAction) => {
    switch (action.kind) {
      case 'cycleTheme':
        cycleThemePref();
        break;
      case 'openPalette':
        useStore.getState().openPalette();
        break;
      // The keys come from main over the websocket as plain strings.
      case 'focusKey':
        if (isActiveKey(action.key)) setActiveKey(action.key);
        break;
      case 'focusMessage':
        if (!isActiveKey(action.key)) break;
        setActiveKey(action.key);
        useStore.getState().setPendingJump(action.messageId);
        break;
      case 'focusFirstUnread': {
        if (!isActiveKey(action.key)) break;
        setActiveKey(action.key);
        const st = useStore.getState();
        const msgs = st.messagesByKey[action.key] ?? [];
        const lastRead = st.ui.lastReadByKey[action.key] ?? 0;
        const mid = firstUnreadMessageId(msgs, lastRead);
        // Always set — clears any stale pending jump when there is no unread
        // message (MessageList only clears it after a *resolved* jump, so a
        // leftover id would otherwise linger and misfire on a later view).
        st.setPendingJump(mid);
        break;
      }
      case 'toggleLeftNav':
        toggleLeftNav();
        break;
      case 'toggleRightRail':
        toggleRightRail();
        break;
      case 'openSettings':
        setActiveKey('tool:settings:app');
        break;
      case 'requestQuit': {
        // Main deferred a quit/close. If a Settings section is dirty, raise
        // the unsaved-changes dialog; otherwise tell main it's safe to quit.
        const st = useStore.getState();
        const client = getApiClient();
        if (selectAnySettingsDirty(st)) {
          st.setPendingTarget({ kind: 'quit' });
        } else if (client) {
          // Last boundary: main quits ~immediately after confirmQuit, so get
          // any coalesced ui change and any unwritten draft onto disk first.
          void (async () => {
            await Promise.all([flushUiState(), flushDrafts()]);
            await api.confirmQuit(client);
          })();
        }
        break;
      }
      case 'pinToggle': {
        const key = useStore.getState().ui.activeKey;
        if (conversationKind(key) !== null) togglePin(key);
        break;
      }
      case 'sendAdvert': {
        const client = getApiClient();
        if (!client) break;
        void api.sendAdvert(client).then(
          () => notify.success('Self-advert sent'),
          (err) => notify.failure('Advert', err),
        );
        break;
      }
      case 'openPacketLog':
        setActiveKey('tool:packetlog');
        break;
      case 'reconnect': {
        const client = getApiClient();
        if (!client) break;
        const last = loadLastDevice();
        if (!last) {
          notify.error('No previous device to reconnect to');
          break;
        }
        const ts = useStore.getState().transportState;
        if (ts !== 'idle' && ts !== 'error') break; // already connected/connecting
        void api.connect(client, last.id).catch((err) => notify.failure('Reconnect', err));
        break;
      }
      case 'toggleRepeat': {
        const client = getApiClient();
        if (!client) break;
        const rs = useStore.getState().radioSettings;
        void api.putRadioSettings(client, { ...rs, repeatMode: !rs.repeatMode }).then(
          () => notify.success(`Repeat mode ${rs.repeatMode ? 'disabled' : 'enabled'}`),
          (err) => notify.failure('Repeat toggle', err),
        );
        break;
      }
      case 'cyclePinned': {
        const state = useStore.getState();
        const pinned = state.ui.pinned;
        if (pinned.length === 0) break;
        const i = pinned.indexOf(state.ui.activeKey);
        const next =
          action.direction === 'next'
            ? pinned[(i + 1 + pinned.length) % pinned.length]
            : pinned[(i - 1 + pinned.length) % pinned.length];
        if (next) state.setActiveKey(next);
        break;
      }
      case 'navigate': {
        const state = useStore.getState();
        if (action.direction === 'back') state.goBack();
        else state.goForward();
        break;
      }
      case 'newChannel': {
        // Same gate as the palette's "Add channel…": joining needs a radio.
        // Say so rather than swallow the click.
        const st = useStore.getState();
        if (selectIsConnected(st)) st.setAddChannelOpen(true);
        else notify.info('Connect a radio first');
        break;
      }
      case 'addContact':
        setActiveKey('tool:contacts');
        break;
      case 'disconnect': {
        const client = getApiClient();
        if (!client) break;
        void api.disconnect(client).catch((err) => notify.failure('Disconnect', err));
        break;
      }
      default:
        // A MenuAction kind with no case above fails to compile here.
        action satisfies never;
    }
  };
}
