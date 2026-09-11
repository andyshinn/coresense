import { child } from '../log';
import { protocolSession } from '../protocol';
import { transportManager } from '../transport/manager';
import { stateHolder } from './holder';

const log = child('contacts');

/** How long between automatic contact re-reads while connected.
 *
 *  A full GET_CONTACTS walk is not cheap: contactSync.ts measured a real
 *  300-contact BLE sync at ~15s (one RESP_CONTACT per ~50ms), so a 500-contact
 *  radio is ~25s of back-to-back frames on the companion link — which is also
 *  how inbound messages reach us, and what the discovered-emit coalescer exists
 *  to keep from pegging the renderer. (Nothing here touches mesh airtime; this
 *  is app↔radio only.) 15 minutes keeps the mirror honest for a contact the
 *  radio auto-added while we weren't looking without the link spending a
 *  meaningful fraction of its time re-listing contacts. Deliberately not
 *  user-configurable — the manual refresh button is the knob for "I want it
 *  now". */
export const CONTACT_AUTO_REFRESH_MS = 15 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
/** A walk we started and haven't seen finish. The lib's withSyncLock QUEUES a
 *  second walk rather than rejecting it, so without this a radio slower than
 *  the interval would accumulate back-to-back walks and effectively stop
 *  delivering messages. */
let inFlight = false;

/** One automatic pass. Every guard is re-checked per tick rather than at start
 *  time, because all three can change under us while the timer runs. */
async function tick(): Promise<void> {
  if (inFlight) return;
  // The user's toggle. Read live so flipping it takes effect on the next tick
  // rather than on the next connect.
  if (!stateHolder().getAutoAddConfig().pullToRefresh) return;
  if (transportManager.getState().state !== 'connected') return;
  // A handshake sync is already walking the same stream; queuing behind it would
  // just re-read what it is in the middle of delivering.
  if (protocolSession().getSyncProgress().phase === 'syncing') return;

  inFlight = true;
  try {
    const list = await protocolSession().getContacts();
    log.debug(`auto-refresh re-read ${list.length} contacts`);
  } catch (err) {
    // A refresh that fails is not worth bothering the user about — the next
    // tick retries, and a real disconnect surfaces through transportState.
    log.warn(`auto-refresh failed: ${(err as Error).message}`);
  } finally {
    inFlight = false;
  }
}

/** Start the periodic re-read. Idempotent: calling it while already running
 *  keeps the existing timer (and its phase) rather than restarting it. */
export function startContactAutoRefresh(intervalMs: number = CONTACT_AUTO_REFRESH_MS): void {
  if (timer) return;
  // Fires on the interval, never immediately: a connect has just completed the
  // handshake's own full contact sync, so an eager first pass would re-read
  // what we already have.
  timer = setInterval(() => void tick(), intervalMs);
  // Don't hold the event loop open for a background refresh.
  timer.unref?.();
}

/** Stop the periodic re-read. Safe to call when not running. An in-flight walk
 *  isn't cancellable (the lib owns the request); it just stops being followed
 *  by another one. */
export function stopContactAutoRefresh(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Test seam: whether the interval is currently armed. */
export function isContactAutoRefreshRunning(): boolean {
  return timer !== null;
}
