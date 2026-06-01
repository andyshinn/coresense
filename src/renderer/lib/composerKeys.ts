/** Minimal view of a keydown event needed to decide whether it should send. */
export interface SendKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  // True while an IME or the macOS emoji/character picker (⌃⌘Space) is
  // composing. During composition the Return key confirms the candidate, so a
  // composing keydown must never be treated as the send shortcut.
  isComposing: boolean;
}

/**
 * Decide whether a composer keydown should send the message.
 *
 * `returnToSend` true  → Return sends, Shift+Return inserts a newline.
 * `returnToSend` false → Cmd/Ctrl+Return sends, Return inserts a newline.
 *
 * Returns false while a composition is active so confirming an emoji or IME
 * candidate with Return inserts it instead of firing a send. Without this
 * guard the macOS emoji picker's Return leaks through and sends the draft.
 */
export function shouldSendOnKey(e: SendKeyEvent, returnToSend: boolean): boolean {
  if (e.isComposing) return false;
  if (e.key !== 'Enter') return false;
  return returnToSend ? !e.shiftKey : e.metaKey || e.ctrlKey;
}
