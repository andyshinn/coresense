import { describe, expect, it } from 'vitest';
import { type SendKeyEvent, shouldSendOnKey } from '../../../../src/renderer/lib/composerKeys';

// Build a keydown view, defaulting every modifier/flag off.
function ev(over: Partial<SendKeyEvent> = {}): SendKeyEvent {
  return {
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    ...over,
  };
}

describe('shouldSendOnKey', () => {
  describe('returnToSend = true', () => {
    it('sends on a bare Return', () => {
      expect(shouldSendOnKey(ev(), true)).toBe(true);
    });

    it('does not send on Shift+Return (newline)', () => {
      expect(shouldSendOnKey(ev({ shiftKey: true }), true)).toBe(false);
    });
  });

  describe('returnToSend = false', () => {
    it('does not send on a bare Return (newline)', () => {
      expect(shouldSendOnKey(ev(), false)).toBe(false);
    });

    it('sends on Cmd+Return', () => {
      expect(shouldSendOnKey(ev({ metaKey: true }), false)).toBe(true);
    });

    it('sends on Ctrl+Return', () => {
      expect(shouldSendOnKey(ev({ ctrlKey: true }), false)).toBe(true);
    });
  });

  it('never sends for keys other than Enter', () => {
    expect(shouldSendOnKey(ev({ key: 'a' }), true)).toBe(false);
  });

  // Regression: macOS emoji picker (⌃⌘Space) confirms its selection with
  // Return while the field is composing. That keydown must insert the emoji,
  // not send the draft — regardless of the returnToSend mode.
  describe('while composing (emoji picker / IME)', () => {
    it('does not send on a composing Return when returnToSend is true', () => {
      expect(shouldSendOnKey(ev({ isComposing: true }), true)).toBe(false);
    });

    it('does not send on a composing Cmd+Return when returnToSend is false', () => {
      expect(shouldSendOnKey(ev({ isComposing: true, metaKey: true }), false)).toBe(false);
    });
  });
});
