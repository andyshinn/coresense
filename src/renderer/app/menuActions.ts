import type { MenuAction } from '../../shared/types';
import { api } from '../lib/api';
import { loadLastDevice } from '../lib/lastDevice';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';
import { firstUnreadMessageId } from '../lib/utils';

export interface MenuActionHandlerDeps {
  baseUrl: string | null;
  apiKey: string | null;
  cycleThemePref: () => void;
  toggleLeftNav: () => void;
  toggleRightRail: () => void;
  togglePin: (key: string) => void;
  setActiveKey: (key: string) => void;
}

/** Factory for the menu/keyboard action dispatcher used by App.tsx. */
export function createMenuActionHandler(deps: MenuActionHandlerDeps): (action: MenuAction) => void {
  const { baseUrl, apiKey, cycleThemePref, toggleLeftNav, toggleRightRail, togglePin, setActiveKey } = deps;
  return (action: MenuAction) => {
    switch (action.kind) {
      case 'cycleTheme':
        cycleThemePref();
        break;
      case 'openPalette':
        useStore.getState().openPalette();
        break;
      case 'focusKey':
        setActiveKey(action.key);
        break;
      case 'focusMessage':
        setActiveKey(action.key);
        useStore.getState().setPendingJump(action.messageId);
        break;
      case 'focusFirstUnread': {
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
        const dirty = Object.values(st.settingsUi.dirtyById).some(Boolean);
        if (dirty) {
          st.setPendingTarget({ kind: 'quit' });
        } else if (baseUrl && apiKey) {
          void api.confirmQuit({ baseUrl, apiKey });
        }
        break;
      }
      case 'pinToggle': {
        const key = useStore.getState().ui.activeKey;
        if (key.startsWith('ch:') || key.startsWith('c:')) togglePin(key);
        break;
      }
      case 'sendAdvert': {
        if (!baseUrl || !apiKey) break;
        void api.sendAdvert({ baseUrl, apiKey }).then(
          () => notify.success('Self-advert sent'),
          (err) => notify.error(`Advert failed: ${(err as Error).message}`, err),
        );
        break;
      }
      case 'openPacketLog':
        setActiveKey('tool:packetlog');
        break;
      case 'reconnect': {
        if (!baseUrl || !apiKey) break;
        const last = loadLastDevice();
        if (!last) {
          notify.error('No previous device to reconnect to');
          break;
        }
        const ts = useStore.getState().transportState;
        if (ts !== 'idle' && ts !== 'error') break; // already connected/connecting
        void api.connect({ baseUrl, apiKey }, last.id).catch((err) => {
          notify.error(`Reconnect failed: ${(err as Error).message}`, err);
        });
        break;
      }
      case 'toggleRepeat': {
        if (!baseUrl || !apiKey) break;
        const rs = useStore.getState().radioSettings;
        void api.putRadioSettings({ baseUrl, apiKey }, { ...rs, repeatMode: !rs.repeatMode }).then(
          () => notify.success(`Repeat mode ${rs.repeatMode ? 'disabled' : 'enabled'}`),
          (err) => notify.error(`Repeat toggle failed: ${(err as Error).message}`, err),
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
      default:
        break;
    }
  };
}
