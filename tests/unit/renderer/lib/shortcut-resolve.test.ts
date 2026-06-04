import { describe, expect, it } from 'vitest';
import { resolveShortcut } from '../../../../src/renderer/lib/shortcut-resolve';
import type { ShortcutKeyEvent } from '../../../../src/shared/shortcuts-format';

function ev(over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over };
}

describe('resolveShortcut', () => {
  it('matches a renderer-surface shortcut and returns its id', () => {
    expect(resolveShortcut(ev({ metaKey: true, key: 'f' }), false)?.id).toBe('quickFind');
    expect(resolveShortcut(ev({ shiftKey: true, key: 'Escape' }), false)?.id).toBe('markAllRead');
    expect(resolveShortcut(ev({ key: '?', shiftKey: true }), false)?.id).toBe('help');
    expect(resolveShortcut(ev({ altKey: true, key: 'ArrowDown' }), false)?.id).toBe('nextUnread');
  });

  it('matches ⌘ + digit as switchChannel', () => {
    expect(resolveShortcut(ev({ metaKey: true, key: '3' }), false)?.id).toBe('switchChannel');
    expect(resolveShortcut(ev({ metaKey: true, key: '0' }), false)).toBeNull(); // 0 is out of 1-9
  });

  it('suppresses guarded shortcuts while typing', () => {
    expect(resolveShortcut(ev({ key: '?', shiftKey: true }), true)).toBeNull(); // help guarded
    expect(resolveShortcut(ev({ altKey: true, key: 'ArrowDown' }), true)).toBeNull(); // unread-nav guarded
  });

  it('keeps unguarded shortcuts working while typing', () => {
    expect(resolveShortcut(ev({ metaKey: true, key: 'f' }), true)?.id).toBe('quickFind');
    expect(resolveShortcut(ev({ shiftKey: true, key: 'Escape' }), true)?.id).toBe('markAllRead');
  });

  it('never resolves menu- or contextual-surface shortcuts', () => {
    // ⌘\ is a menu shortcut (toggleSidebar) — handled by Electron, not here.
    expect(resolveShortcut(ev({ metaKey: true, key: '\\' }), false)).toBeNull();
    // bare Enter is contextual (composer) — not a global shortcut.
    expect(resolveShortcut(ev({ key: 'Enter' }), false)).toBeNull();
  });

  it('returns null for unmapped keys', () => {
    expect(resolveShortcut(ev({ key: 'q' }), false)).toBeNull();
  });
});
