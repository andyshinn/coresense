import type { MenuAction } from '../../shared/types';
import { api } from '../lib/api';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

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
  const {
    baseUrl,
    apiKey,
    cycleThemePref,
    toggleLeftNav,
    toggleRightRail,
    togglePin,
    setActiveKey,
  } = deps;
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
