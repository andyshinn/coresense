import { child } from '../log';
import { protocolSession } from '../protocol';
import { transportManager } from '../transport/manager';
import { beginContactWalk, endContactWalk, endContactWalkIfSilent, isContactWalkInFlight } from './contactWalk';
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
 *  now", and the setting is opt-in precisely because this is not free. */
export const CONTACT_AUTO_REFRESH_MS = 15 * 60_000;

export type ContactRefreshResult =
  | { status: 'ok'; count: number }
  | { status: 'skipped' }
  | { status: 'offline' }
  | { status: 'failed'; message: string };

/** The ONE way to re-read the radio's contact store. Both callers — the manual
 *  `POST /api/contacts/refresh` and the periodic tick below — go through here,
 *  because the guard has to be shared to be a guard at all:
 *
 *   - the renderer's per-hook `refreshing` flag is per React component, and the
 *     Contacts panel mounts two refresh controls at once (header button + right
 *     rail), each with its own;
 *   - `getSyncProgress().phase === 'syncing'` only ever catches a HANDSHAKE.
 *     meshcore-ts sets that phase in handshakeInner and nowhere else, so a walk
 *     started by getContacts() leaves it on 'done' the whole time;
 *   - the lib's own `withSyncLock` QUEUES a second walk rather than rejecting
 *     it, and only until `getContacts()` resolves — which on a big radio is the
 *     10s END_OF_CONTACTS waiter timing out, mid-stream.
 *
 *  Overlapping walks are not merely wasteful: they make the library delete real
 *  contacts (see contactWalk.ts). Hence the shared guard rather than "await the
 *  promise" — two conditions, because neither covers the other:
 *    `pending`               our own request hasn't settled, so the lib's sync
 *                            lock is still held and a second call would queue.
 *    isContactWalkInFlight() frames are still arriving after our request
 *                            settled, i.e. the request resolved mid-stream on
 *                            the lib's 10s waiter timeout. */
let pending = false;

export async function refreshContacts(): Promise<ContactRefreshResult> {
  if (transportManager.getState().state !== 'connected') return { status: 'offline' };
  // A walk is already running: ours, another caller's, or the handshake's.
  if (pending || isContactWalkInFlight()) return { status: 'skipped' };
  // Cheap early out for the handshake's walk before its first frame lands.
  if (protocolSession().getSyncProgress().phase === 'syncing') return { status: 'skipped' };

  pending = true;
  beginContactWalk();
  try {
    const list = await protocolSession().getContacts();
    // Resolution means either END_OF_CONTACTS (the guard was already released by
    // the `contactsSynced` handler) or the lib's 10s waiter timing out. Only
    // release here if no contact frame ever arrived, i.e. nothing is streaming.
    endContactWalkIfSilent();
    return { status: 'ok', count: list.length };
  } catch (err) {
    endContactWalk();
    return { status: 'failed', message: (err as Error).message };
  } finally {
    pending = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** One automatic pass. Every guard is re-checked per tick rather than at start
 *  time, because all of them can change under us while the timer runs. */
async function tick(): Promise<void> {
  // The user's opt-in. Read live so flipping it takes effect on the next tick
  // rather than on the next connect.
  if (!stateHolder().getAutoAddConfig().autoRefreshContacts) return;

  const res = await refreshContacts();
  if (res.status === 'ok') log.debug(`auto-refresh re-read ${res.count} contacts`);
  // A refresh that fails is not worth bothering the user about — the next tick
  // retries, and a real disconnect surfaces through transportState.
  else if (res.status === 'failed') log.warn(`auto-refresh failed: ${res.message}`);
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
