import type { Platform } from '../../shared/shortcuts-format';
import type { Channel } from '../../shared/types';
import { sortChannels } from '../shell/leftnav/sorting';

/** True when a keydown originated in an editable field — used to suppress
 *  bare-key shortcuts (?, ⌥↑/↓) while the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Key of the Nth channel (1-based) in left-nav sort order, or null. Unread
 *  ordering is intentionally ignored so ⌘1–9 stays positionally stable. */
export function nthChannelKey(
  channels: Channel[],
  pinSet: Set<string>,
  pinnedOrder: string[],
  n: number,
): string | null {
  const sorted = sortChannels(channels, pinSet, pinnedOrder, null);
  return sorted[n - 1]?.key ?? null;
}

/** Given conversation keys in display order, return the next/previous one
 *  relative to `currentKey`, wrapping around. When `currentKey` is not in the
 *  list, returns the first (next) or last (prev) entry. Null if empty. */
export function adjacentUnreadKey(
  orderedKeys: string[],
  currentKey: string,
  dir: 'next' | 'prev',
): string | null {
  if (orderedKeys.length === 0) return null;
  const i = orderedKeys.indexOf(currentKey);
  if (i === -1) return dir === 'next' ? orderedKeys[0] : orderedKeys[orderedKeys.length - 1];
  const len = orderedKeys.length;
  const j = dir === 'next' ? (i + 1) % len : (i - 1 + len) % len;
  return orderedKeys[j];
}

function platformString(): string {
  return (
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  );
}

/** Coarse platform for display formatting (caps glyphs). */
export function rendererPlatform(): Platform {
  return /mac/i.test(platformString()) ? 'mac' : 'other';
}

/** Human OS label for the dialog kicker. */
export function osLabel(): string {
  const p = platformString();
  if (/mac/i.test(p)) return 'macOS';
  if (/win/i.test(p)) return 'Windows';
  return 'Linux';
}
