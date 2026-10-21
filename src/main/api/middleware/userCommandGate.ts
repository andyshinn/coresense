// Tracks user-initiated commands in flight, so My Node's background poll can
// step aside for them.
//
// meshcore-ts doesn't queue commands: each one is written to the link at once
// and its reply matched afterwards. A poll frame written just ahead of a
// user's send therefore makes the send wait behind it. The poll routes check
// isUserCommandInFlight() before every frame and skip the tick when it is true
// (409 `busy_skip`), so a user command never queues behind a poll.
//
// Counted: mutating requests to the routes that talk to the radio. App-only
// writes (UI state, drafts, macros, block rules) don't touch the link, and
// counting them would skip every poll while someone types a draft. The poll
// routes themselves are excluded, or a poll would block the next one.

import type { MiddlewareHandler } from 'hono';
import { meshLockHolder } from '../../telemetry/meshLock';

const RADIO_ROUTE_PREFIXES = [
  '/api/device/',
  '/api/settings/radio',
  '/api/radio/',
  '/api/transport/',
  '/api/messages/',
  '/api/contacts',
  '/api/channels',
  '/api/repeater/',
  '/api/telemetry/',
];

/** The routes the My Node poller calls. */
export const POLL_ROUTES = new Set(['/api/telemetry/self/live', '/api/device/stats']);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let inFlight = 0;

/** True for a request that counts as a user command. */
export function countsAsUserCommand(method: string, path: string): boolean {
  if (!MUTATING.has(method) || POLL_ROUTES.has(path)) return false;
  return RADIO_ROUTE_PREFIXES.some((p) => path.startsWith(p));
}

export const userCommandGate: MiddlewareHandler = async (c, next) => {
  if (!countsAsUserCommand(c.req.method, c.req.path)) {
    await next();
    return;
  }
  inFlight++;
  try {
    await next();
  } finally {
    inFlight--;
  }
};

/** A user command is in flight, or a mesh request holds the radio. */
export function isUserCommandInFlight(): boolean {
  return inFlight > 0 || meshLockHolder() !== null;
}

/** Test seam. */
export function resetUserCommandGate(): void {
  inFlight = 0;
}
