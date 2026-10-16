import { shell } from 'electron';
import { errorMessage } from '../../shared/errors';
import { log } from '../log';

/**
 * Open a folder in the OS file manager. shell.openPath does not reject on
 * failure: it resolves with an error string (empty on success), so a bare
 * `.catch` never sees a missing folder or a refused open. Check both paths and
 * report through the main logger so failures reach the Logs panel and file sink.
 */
export async function revealPath(dir: string): Promise<void> {
  try {
    const failure = await shell.openPath(dir);
    if (failure) log.warn(`openPath failed for ${dir}: ${failure}`);
  } catch (err) {
    log.warn(`openPath failed for ${dir}: ${errorMessage(err)}`);
  }
}

/** Hand a URL to the user's default handler, logging (not leaking) a rejection. */
export function openExternal(url: string): void {
  shell.openExternal(url).catch((err) => log.warn(`openExternal failed: ${errorMessage(err)}`));
}

/** Open http(s) URLs in the user's browser; anything else is ignored. */
export function openExternalIfWeb(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) openExternal(url);
}
