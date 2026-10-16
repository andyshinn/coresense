import { log } from './logger';

// Convenience for clipboard copies — used by Copy items across menus and by
// copy buttons. `onDone` fires only on a confirmed write, so callers can key
// success UI (toast / "Copied!" popover) off it. Failures are logged rather
// than swallowed so a broken clipboard is debuggable from the DevTools console.
export function copyToClipboard(text: string, onDone?: () => void): void {
  if (!navigator.clipboard) {
    log.error('Clipboard write failed: navigator.clipboard is unavailable (insecure context?)');
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => onDone?.(),
    (err) => log.error('Clipboard write failed', err),
  );
}
