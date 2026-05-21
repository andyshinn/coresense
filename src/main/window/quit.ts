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
