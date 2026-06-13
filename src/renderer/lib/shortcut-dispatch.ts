import type { ShortcutKeyEvent } from '../../shared/shortcuts-format';
import { computeUnreadConversations } from '../hooks/useUnreads';
import { resolveShortcut } from './shortcut-resolve';
import { adjacentUnreadKey, isTypingTarget, nthChannelKey } from './shortcut-selectors';
import { useStore } from './store';

/** Run the side effect for a resolved shortcut id. */
function run(id: string, ev: ShortcutKeyEvent): void {
  const s = useStore.getState();
  switch (id) {
    case 'help':
      s.openHelp();
      break;
    case 'quickFind':
      s.setActiveKey('tool:search');
      s.requestSearchFocus();
      break;
    case 'markAllRead':
      s.markAllReadGlobal();
      break;
    case 'nextUnread':
    case 'prevUnread': {
      const ordered = computeUnreadConversations(s.messagesByKey, s.ui.lastReadByKey, s.channels, s.contacts).map(
        (u) => u.key,
      );
      const target = adjacentUnreadKey(ordered, s.ui.activeKey, id === 'nextUnread' ? 'next' : 'prev');
      if (target) s.setActiveKey(target);
      break;
    }
    case 'switchChannel': {
      const n = Number(ev.key);
      const key = nthChannelKey(s.channels, new Set(s.ui.pinned), s.ui.pinned, n);
      if (key) s.setActiveKey(key);
      break;
    }
    default:
      break;
  }
}

/** Match a global keydown against renderer-surface shortcuts and execute it.
 *  Returns true when handled (caller should preventDefault). */
export function dispatchShortcut(e: KeyboardEvent): boolean {
  const sc = resolveShortcut(e, isTypingTarget(e.target));
  if (!sc) return false;
  run(sc.id, e);
  return true;
}
