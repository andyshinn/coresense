import { describe, expect, it } from 'vitest';
import { shouldDeferQuit } from '../../../../src/main/window/quit';

describe('shouldDeferQuit', () => {
  it('asks a connected renderer before the first quit', () => {
    expect(shouldDeferQuit({ confirmed: false, hasWindow: true, rendererConnected: true })).toBe(true);
  });

  // The deadlock: requestQuit is a WS broadcast, and with no open socket it is
  // dropped. Deferring then waits for a reply that can never come, so the quit
  // never happens — which is what hung the e2e harness's app.close() when it
  // quit before the renderer's socket had opened.
  it('does not defer when no renderer is connected to answer', () => {
    expect(shouldDeferQuit({ confirmed: false, hasWindow: true, rendererConnected: false })).toBe(false);
  });

  it('does not defer once the renderer has confirmed', () => {
    expect(shouldDeferQuit({ confirmed: true, hasWindow: true, rendererConnected: true })).toBe(false);
  });

  it('does not defer with no window to prompt in', () => {
    expect(shouldDeferQuit({ confirmed: false, hasWindow: false, rendererConnected: true })).toBe(false);
  });
});
