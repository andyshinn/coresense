// Tracks whether the renderer has confirmed it is safe to quit (no unsaved
// Settings changes, or the user chose to save/discard them). The window
// 'close' and app 'before-quit' handlers defer the first quit attempt and
// broadcast a `requestQuit` menu action; the renderer replies by hitting
// POST /api/app/quit, which sets this flag and re-issues the quit.
let quitConfirmed = false;

export function isQuitConfirmed(): boolean {
  return quitConfirmed;
}

export function markQuitConfirmed(): void {
  quitConfirmed = true;
}

/**
 * Whether a quit/close should be held back to ask the renderer first.
 *
 * Only when a renderer is connected to answer. The question is a `requestQuit`
 * WS broadcast, and a broadcast with no open socket goes nowhere — nothing
 * re-sends it — so deferring with nobody listening is a quit that never
 * happens. That gap is real: the shell paints before the renderer's socket
 * opens (the socket waits on the capabilities fetch), and the socket is gone
 * while it reconnects. Quitting straight away there can skip the
 * unsaved-Settings prompt, which beats a quit that silently does nothing.
 */
export function shouldDeferQuit(state: { confirmed: boolean; hasWindow: boolean; rendererConnected: boolean }): boolean {
  return !state.confirmed && state.hasWindow && state.rendererConnected;
}
