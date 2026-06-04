import { SHORTCUTS, type Shortcut } from '../../shared/shortcuts';
import { matchesEvent, type ShortcutKeyEvent } from '../../shared/shortcuts-format';

const RENDERER_SHORTCUTS = SHORTCUTS.filter((s) => s.surface === 'renderer');

function isDigit1to9(key: string): boolean {
  return key.length === 1 && key >= '1' && key <= '9';
}

/** Pure resolution: which renderer-surface shortcut (if any) this event triggers.
 *  `isTyping` suppresses shortcuts flagged `guardTyping`. */
export function resolveShortcut(ev: ShortcutKeyEvent, isTyping: boolean): Shortcut | null {
  for (const s of RENDERER_SHORTCUTS) {
    if (s.guardTyping && isTyping) continue;
    for (const chord of s.chords) {
      // switchChannel's chord key is the literal range token '1-9'; match any
      // 1–9 digit with the mod held (and no shift/alt).
      if (chord.key === '1-9') {
        const wantMod = chord.mods?.includes('mod') ?? false;
        if (
          (ev.metaKey || ev.ctrlKey) === wantMod &&
          !ev.shiftKey &&
          !ev.altKey &&
          isDigit1to9(ev.key)
        ) {
          return s;
        }
        continue;
      }
      if (matchesEvent(ev, chord)) return s;
    }
  }
  return null;
}
